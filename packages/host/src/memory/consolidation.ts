import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { KodoError, type ConsolidationProposal } from "@kodo/protocol";
import type { SessionService } from "../session-service.js";

const PLAYBOOK_HINT =
  /(?:构建|测试|lint|typecheck|部署|命令|报错|踩坑|修复|配置|nginx|docker|git|worktree|pnpm|npm|gradle|swift|build|test|deploy|fix|ci|pr)/i;

function stableProposalId(targetDoc: string, content: string): string {
  const h = createHash("sha256")
    .update(`${targetDoc}:${content.trim().toLowerCase()}`)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Nightly & On-Demand Memory / Playbook Consolidation Engine.
 *
 * Scans recent rolling daily logs (`memory/YYYY-MM-DD.md`) and completed/blocked Goals
 * to extract durable lessons into user-confirmable proposals targeting `MEMORY.md` or
 * `AGENTS.md`. Never silently overwrites user-authored Markdown files.
 */
export class MemoryConsolidationService {
  constructor(private readonly service: SessionService) {}

  list(status?: ConsolidationProposal["status"]): ConsolidationProposal[] {
    const all = this.service.store
      .records<ConsolidationProposal>("consolidation-proposal")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return status ? all.filter((p) => p.status === status) : all;
  }

  /**
   * Deterministically extracts candidate lessons from the last `days` of daily logs
   * and recent Goals with 0 LLM tokens, deduplicating against existing docs & proposals.
   */
  generateProposals(days = 7, now = new Date()): ConsolidationProposal[] {
    const docs = this.service.memory.docs;
    if (!docs) return [];
    const memoryContent = docs.get("MEMORY.md").content.toLowerCase();
    const agentsContent = docs.get("AGENTS.md").content.toLowerCase();
    const created: ConsolidationProposal[] = [];

    // 1. Scan recent memory/YYYY-MM-DD.md bullet entries
    if (existsSync(docs.dailyDir)) {
      const files = readdirSync(docs.dailyDir)
        .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
        .sort()
        .reverse()
        .slice(0, Math.max(1, Math.min(days, 30)));
      for (const file of files) {
        const text = readFileSync(join(docs.dailyDir, file), "utf8");
        for (const rawLine of text.split(/\r?\n/)) {
          const match = /^-\s*(?:\[\d{2}:\d{2}\]\s*)?(.+)$/.exec(rawLine.trim());
          if (!match) continue;
          const note = match[1]!.trim();
          if (note.length < 10 || note.length > 500) continue;
          const targetDoc: "MEMORY.md" | "AGENTS.md" = PLAYBOOK_HINT.test(note)
            ? "AGENTS.md"
            : "MEMORY.md";
          const targetBody = targetDoc === "AGENTS.md" ? agentsContent : memoryContent;
          if (targetBody.includes(note.toLowerCase().slice(0, Math.min(28, note.length)))) continue;
          const id = stableProposalId(targetDoc, note);
          if (this.service.store.record<ConsolidationProposal>("consolidation-proposal", id))
            continue;
          const proposal: ConsolidationProposal = {
            id,
            targetDoc,
            title: note.slice(0, 64) + (note.length > 64 ? "…" : ""),
            content: `- ${note}`,
            sources: [`memory/${file}`],
            status: "pending",
            createdAt: now.toISOString(),
          };
          this.service.store.put("consolidation-proposal", id, proposal);
          created.push(proposal);
        }
      }
    }

    // 2. Scan recently completed or blocked Goals with summaries/limitations for AGENTS.md
    for (const goal of this.service.goals.list({ includeClosed: true }).slice(0, 20)) {
      const lesson =
        goal.status === "blocked" && goal.blockedReason
          ? `目标「${goal.title}」阻塞原因：${goal.blockedReason}`
          : goal.status === "completed" && goal.result?.summary
            ? `目标「${goal.title}」交付要点：${goal.result.summary}`
            : null;
      if (!lesson || lesson.length < 12) continue;
      if (agentsContent.includes(lesson.toLowerCase().slice(0, 28))) continue;
      const id = stableProposalId("AGENTS.md", lesson);
      if (this.service.store.record<ConsolidationProposal>("consolidation-proposal", id)) continue;
      const proposal: ConsolidationProposal = {
        id,
        targetDoc: "AGENTS.md",
        title: `复盘：${goal.title}`.slice(0, 64),
        content: `- ${lesson.slice(0, 420)}`,
        sources: [`goal:${goal.id}`],
        status: "pending",
        createdAt: now.toISOString(),
      };
      this.service.store.put("consolidation-proposal", id, proposal);
      created.push(proposal);
    }

    this.service.store.put("consolidation-meta", "last-run", {
      at: now.toISOString(),
      createdCount: created.length,
    });
    return created;
  }

  /** Runs at most once per 24h from Host maintenance. */
  runDailyIfDue(now = new Date()): ConsolidationProposal[] {
    const last = this.service.store.record<{ at: string }>("consolidation-meta", "last-run");
    if (last && now.getTime() - Date.parse(last.at) < 20 * 3600_000) return [];
    return this.generateProposals(7, now);
  }

  /** Approves a proposal and atomically appends it into `MEMORY.md` or `AGENTS.md`. */
  approve(
    id: string,
    requestId: string = randomUUID(),
  ): {
    proposal: ConsolidationProposal;
    doc: ReturnType<NonNullable<SessionService["memory"]["docs"]>["get"]>;
  } {
    const docs = this.service.memory.docs;
    if (!docs) throw new KodoError("UNAVAILABLE", "本地工作区文档不可用。");
    const proposal = this.service.store.record<ConsolidationProposal>("consolidation-proposal", id);
    if (!proposal) throw new KodoError("NOT_FOUND", "未找到该记忆蒸馏提案。");
    if (proposal.status === "approved") {
      return { proposal, doc: docs.get(proposal.targetDoc) };
    }
    const doc = docs.applyAgentEdit(
      proposal.targetDoc,
      "append",
      proposal.content,
      requestId,
      undefined,
      this.service.memory.list(null, false),
    );
    const updated: ConsolidationProposal = {
      ...proposal,
      status: "approved",
      resolvedAt: new Date().toISOString(),
    };
    this.service.store.put("consolidation-proposal", id, updated);
    return { proposal: updated, doc };
  }

  dismiss(id: string): ConsolidationProposal {
    const proposal = this.service.store.record<ConsolidationProposal>("consolidation-proposal", id);
    if (!proposal) throw new KodoError("NOT_FOUND", "未找到该记忆蒸馏提案。");
    const updated: ConsolidationProposal = {
      ...proposal,
      status: "dismissed",
      resolvedAt: new Date().toISOString(),
    };
    this.service.store.put("consolidation-proposal", id, updated);
    return updated;
  }
}
