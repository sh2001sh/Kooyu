import { randomUUID } from "node:crypto";
import type { HarnessId } from "@kodo/protocol";
import type { SessionService } from "../session-service.js";

const QUOTA_ERROR_PATTERN =
  /(?:429|rate[_\s-]?limit|too many requests|quota exceeded|usage limit|capacity exhausted|overloaded|credit balance|insufficient_quota|限流|配额|额度.*(?:用尽|不足|耗尽))/i;

const KEYWORD_TAG_MAP: [RegExp, string[]][] = [
  [
    /(?:重构|架构|设计|多模块|refactor|architect|complex|migrate)/gi,
    ["refactor", "architecture", "complex"],
  ],
  [/(?:debug|修复|报错|bug|单测|测试|test|backend|接口|api)/gi, ["debug", "backend", "tests"]],
  [/(?:文档|注释|lint|格式|文案|quick|docs|readme|typo)/gi, ["docs", "lint", "quick"]],
  [/(?:调研|总结|分析|对比|研报|research|summary|general)/gi, ["research", "summary", "general"]],
];

export interface RouteRecommendation {
  recommended: HarnessId;
  matchedTags: string[];
  chain: HarnessId[];
  availableChain: HarnessId[];
  autoHandoffOnQuota: boolean;
  reason: string;
}

export interface QuotaHandoffResult {
  triggered: boolean;
  reason: string;
  fromHarnessId: HarnessId;
  toHarnessId?: HarnessId;
  summary?: string;
  handoffRecordId?: string;
}

export function isQuotaOrRateLimitError(errorText: string): boolean {
  return QUOTA_ERROR_PATTERN.test(errorText);
}

/**
 * Recommends the best available Harness for a task based on `ROUTING.md` rules
 * and live Harness availability on this Host.
 */
export function recommendHarness(
  service: SessionService,
  input: { taskText?: string; tags?: string[]; exclude?: HarnessId[] },
): RouteRecommendation {
  const config = service.memory.docs?.parseRoutingConfig() ?? {
    autoHandoffOnQuota: true,
    routes: [],
    fallbackChain: ["claude-code", "codex", "gemini", "deepseek-harness", "opencode"],
  };
  const excluded = new Set(input.exclude ?? []);
  const tagWeights = new Map<string, number>();
  for (const rawTag of input.tags ?? []) {
    const tag = rawTag.toLowerCase();
    tagWeights.set(tag, (tagWeights.get(tag) ?? 0) + 3);
  }
  if (input.taskText) {
    for (const [pattern, tags] of KEYWORD_TAG_MAP) {
      const hits = [...input.taskText.matchAll(pattern)].length;
      if (hits > 0) {
        for (const tag of tags) {
          tagWeights.set(tag, (tagWeights.get(tag) ?? 0) + hits);
        }
      }
    }
  }
  const inferredTags = new Set(tagWeights.keys());

  // Match best routing rule from ROUTING.md using keyword-hit weights
  let bestRule = config.routes[0];
  let bestScore = 0;
  for (const rule of config.routes) {
    const score = rule.tags.reduce((sum, t) => sum + (tagWeights.get(t) ?? 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestRule = rule;
    }
  }

  const rawChain = (
    bestScore > 0 && bestRule ? bestRule.chain : config.fallbackChain
  ) as HarnessId[];
  const availableIds = new Set(
    service
      .snapshot()
      .harnesses.filter(
        (h) => h.implementation !== "pending" && h.capabilities.directChat === "supported",
      )
      .map((h) => h.id),
  );
  const availableChain = rawChain.filter((id) => !excluded.has(id) && availableIds.has(id));
  const fallbackAvailable = (config.fallbackChain as HarnessId[]).filter(
    (id) => !excluded.has(id) && availableIds.has(id),
  );
  const finalChain = availableChain.length ? availableChain : fallbackAvailable;
  const recommended: HarnessId = finalChain[0] ?? "kodo";

  return {
    recommended,
    matchedTags: [...inferredTags],
    chain: rawChain,
    availableChain: finalChain,
    autoHandoffOnQuota: config.autoHandoffOnQuota,
    reason:
      bestScore > 0
        ? `命中 ROUTING.md 规则（${bestRule!.tags.join("/")}），优先推荐 ${recommended}`
        : `按 ROUTING.md 默认接力链优先推荐 ${recommended}`,
  };
}

/**
 * Prepares a structured quota/rate-limit fallback handoff plan when a Harness hits 429 or
 * exhausts its subscription quota, capturing exact session progress so work continues seamlessly.
 */
export function prepareQuotaFallbackHandoff(
  service: SessionService,
  sessionId: string,
  errorText: string,
): QuotaHandoffResult {
  const session = service.store.session(sessionId);
  const config = service.memory.docs?.parseRoutingConfig();
  if (!config?.autoHandoffOnQuota) {
    return {
      triggered: false,
      reason: "ROUTING.md 已关闭限流自动接力（auto_handoff_on_quota: false）。",
      fromHarnessId: session.harnessId,
    };
  }
  if (!isQuotaOrRateLimitError(errorText)) {
    return {
      triggered: false,
      reason: "该错误不是限流或配额耗尽错误。",
      fromHarnessId: session.harnessId,
    };
  }

  const progress = service.progress(sessionId);
  const rec = recommendHarness(service, {
    taskText: `${session.title} ${progress.lastRequest ?? ""}`,
    exclude: [session.harnessId, "kodo"],
  });
  const nextHarness = rec.availableChain[0];
  if (!nextHarness) {
    return {
      triggered: false,
      reason: "没有其他可用的备用 Harness 可接力。",
      fromHarnessId: session.harnessId,
    };
  }

  const summary = [
    `[自动限额接力] 原引擎 ${session.harnessId} 遇到限流/配额限制（${errorText.slice(0, 180)}）。`,
    `原会话：${session.title}（${session.id}）`,
    progress.lastRequest ? `最近任务目标：${progress.lastRequest}` : "",
    progress.lastReply ? `最近进展摘要：${progress.lastReply}` : "",
    `请基于当前工作区现状继续完成未竟工作，勿重复已完成修改。`,
  ]
    .filter(Boolean)
    .join("\n");

  const handoffRecordId = randomUUID();
  service.store.put("quota-handoff", handoffRecordId, {
    id: handoffRecordId,
    fromSessionId: sessionId,
    fromHarnessId: session.harnessId,
    toHarnessId: nextHarness,
    errorText: errorText.slice(0, 400),
    summary,
    createdAt: new Date().toISOString(),
  });

  service.inbox(`quota-handoff:${handoffRecordId}`, sessionId, "notification", {
    source: "quota-handoff",
    title: `引擎 ${session.harnessId} 触发限流，已生成 ${nextHarness} 无缝接力方案`,
    message: summary,
    fromHarnessId: session.harnessId,
    toHarnessId: nextHarness,
    handoffRecordId,
  });

  return {
    triggered: true,
    reason: `已按 ROUTING.md 接力链选中备用引擎 ${nextHarness}`,
    fromHarnessId: session.harnessId,
    toHarnessId: nextHarness,
    summary,
    handoffRecordId,
  };
}
