import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  KodoError,
  memoryInputSchema,
  globalMemorySettingsSchema,
  globalMemorySettingsInputSchema,
  type MemoryEntry,
} from "@kodo/protocol";
import type { Store } from "../storage/store.js";
import { DomainTable } from "../storage/self-hosted.js";
import { digest } from "../execution/actions.js";
export class MemoryService {
  private readonly entries: DomainTable<MemoryEntry>;
  constructor(private readonly store: Store) {
    this.entries = new DomainTable(store, "memory_entries");
  }
  settings() {
    return globalMemorySettingsSchema.parse(
      this.store.record("memory-settings", "global") ?? { revision: 0 },
    );
  }
  saveSettings(value: unknown) {
    const p = globalMemorySettingsInputSchema.parse(value);
    return this.store.transaction(() => {
      const prior = this.store.record<{
        fingerprint: string;
        value: ReturnType<MemoryService["settings"]>;
      }>("memory-settings-request", p.requestId);
      const fingerprint = digest(p);
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new KodoError("CONFLICT", "记忆配置请求 ID 冲突。");
        return prior.value;
      }
      const old = this.settings();
      if (old.revision !== p.expectedRevision)
        throw new KodoError("CONFLICT", "全局记忆配置已在另一端修改，请刷新后重试。");
      const next = {
        revision: old.revision + 1,
        enabled: p.enabled,
        automaticSaving: p.automaticSaving,
      };
      this.store.put("memory-settings", "global", next);
      this.store.put("memory-settings-request", p.requestId, { fingerprint, value: next });
      return next;
    });
  }
  /** Only actual user turns can teach global preferences; agent output and queued automation cannot. */
  remember(controllerId: string, callId: string, value: unknown, forget = false) {
    const p = z
      .object({
        subject: z.string().trim().min(1).max(200).optional(),
        content: z.string().trim().min(1).max(12000).optional(),
        id: z.string().uuid().optional(),
        expectedRevision: z.number().int().positive().optional(),
        evidenceQuotes: z.array(z.string().trim().min(1).max(900)).min(1).max(8),
      })
      .strict()
      .parse(value);
    const owner = this.store.session(controllerId);
    if (owner.harnessId !== "kodo" || owner.kind !== "supervisor")
      throw new KodoError("UNAUTHORIZED", "仅 Kooyu 主对话可形成全局记忆。");
    const turn = this.store.record<{ id: string }>("active-tool-turn", controllerId);
    const command = turn ? this.store.command(turn.id) : undefined;
    if (
      !command ||
      command.sessionId !== controllerId ||
      command.origin !== "user" ||
      command.kind !== "send" ||
      command.status !== "dispatched"
    )
      throw new KodoError("UNAUTHORIZED", "全局记忆需要当前用户对话作为来源。");
    const userText = typeof command.body.text === "string" ? command.body.text : "";
    if (p.evidenceQuotes.some((quote) => !userText.includes(quote)))
      throw new KodoError("INVALID_INPUT", "记忆依据必须是当前用户消息的原文。");
    const key = `${controllerId}:${callId}`;
    const fingerprint = digest({ commandId: command.id, p, forget });
    return this.store.transaction(() => {
      const prior = this.store.record<{ fingerprint: string; value: MemoryEntry }>(
        "memory-capture-request",
        key,
      );
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new KodoError("CONFLICT", "记忆工具调用 ID 冲突。");
        return prior.value;
      }
      const settings = this.settings();
      if (!settings.enabled && !forget)
        throw new KodoError("UNAVAILABLE", "全局记忆已关闭，请勿保存新的全局记忆。");
      if (
        /(?:sk-[A-Za-z0-9_-]{12,}|-----BEGIN .*PRIVATE KEY|Bearer\s+[A-Za-z0-9._-]{12,})/.test(
          [p.subject, p.content, ...p.evidenceQuotes].join("\n"),
        )
      )
        throw new KodoError("INVALID_INPUT", "秘密应存入凭据库，不能存入记忆。");
      const normalize = (text: string) =>
        text.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
      const existing = p.id
        ? this.entries.get(p.id)
        : p.subject
          ? this.list(null, true).find((e) => normalize(e.subject) === normalize(p.subject!))
          : undefined;
      if (existing && existing.scope !== "user")
        throw new KodoError("UNAUTHORIZED", "此工具仅管理全局记忆。");
      if (p.id && existing?.revision !== p.expectedRevision)
        throw new KodoError("CONFLICT", "记忆已修改，请读取最新版本。");
      if (forget && (!p.id || !existing))
        throw new KodoError("INVALID_INPUT", "忘记记忆需要明确的条目 ID 和修订号。");
      if (!forget && (!p.subject || !p.content))
        throw new KodoError("INVALID_INPUT", "记忆需要主题和内容。");
      // A suggestion must not silently replace a previously confirmed preference.
      if (
        !forget &&
        existing?.status === "confirmed" &&
        !settings.automaticSaving &&
        normalize(existing.content) !== normalize(p.content!)
      )
        throw new KodoError("CONFLICT", "自动保存已关闭，请在全局记忆中编辑或确认已有约定。");
      const next =
        !forget &&
        existing &&
        normalize(existing.content) === normalize(p.content!) &&
        (existing.status === "confirmed" || !settings.automaticSaving)
          ? existing
          : this.save(
              {
                requestId: randomUUID(),
                expectedRevision: existing?.revision,
                scope: "user",
                projectId: null,
                subject: forget ? existing!.subject : p.subject,
                content: forget ? existing!.content || "已删除" : p.content,
                sourceRefs: [
                  `session:${controllerId}`,
                  `command:${command.id}`,
                  ...p.evidenceQuotes.map((q) => `quote:${q}`),
                ],
                status: forget ? "deleted" : settings.automaticSaving ? "confirmed" : "proposed",
              },
              "user",
              undefined,
              existing?.id,
            );
      this.store.put("memory-capture-request", key, { fingerprint, value: next });
      return next;
    });
  }
  list(projectId: string | null, includeProposed = false) {
    return this.entries
      .all()
      .filter(
        (e) =>
          (e.scope === "user" || e.projectId === projectId) &&
          (e.status === "confirmed" || (includeProposed && e.status === "proposed")),
      );
  }
  history(id: string) {
    this.entries.get(id);
    return this.store.db
      .prepare("SELECT data FROM memory_revisions WHERE entry_id=? ORDER BY revision")
      .all(id)
      .map((r) => JSON.parse(String(r.data)));
  }
  save(value: unknown, actor: "user" | "model", controllerId?: string, id?: string): MemoryEntry {
    const p = memoryInputSchema.parse(value),
      fingerprint = digest({ p, actor, controllerId, id });
    if ((p.scope === "project" && !p.projectId) || (p.scope === "user" && p.projectId))
      throw new KodoError("INVALID_INPUT", "记忆范围与项目不一致。");
    if (p.projectId && !this.store.projects().some((x) => x.id === p.projectId))
      throw new KodoError("NOT_FOUND", "项目不存在。");
    if (actor === "model") {
      if (!controllerId) throw new KodoError("UNAUTHORIZED", "缺少主对话身份。");
      const s = this.store.session(controllerId);
      if (s.projectId !== p.projectId || p.scope !== "project")
        throw new KodoError("UNAUTHORIZED", "模型只能建议当前项目记忆。");
      if (p.status !== "proposed")
        throw new KodoError("UNAUTHORIZED", "模型推断需要用户确认后生效。");
    }
    if (
      /(?:sk-[A-Za-z0-9_-]{12,}|-----BEGIN .*PRIVATE KEY|Bearer\s+[A-Za-z0-9._-]{12,})/.test(
        p.content,
      )
    )
      throw new KodoError("INVALID_INPUT", "秘密应存入凭据库，不能存入记忆。");
    return this.store.transaction(() => {
      const prior = this.store.record<{ fingerprint: string; value: MemoryEntry }>(
        "memory-request",
        p.requestId,
      );
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new KodoError("CONFLICT", "记忆请求 ID 冲突。");
        return prior.value;
      }
      const old = id ? this.entries.get(id) : undefined;
      if (
        old &&
        (old.revision !== p.expectedRevision ||
          old.scope !== p.scope ||
          old.projectId !== p.projectId)
      )
        throw new KodoError("CONFLICT", "记忆已修改或范围不一致。");
      const next: MemoryEntry = {
        id: old?.id ?? randomUUID(),
        scope: p.scope,
        projectId: p.projectId,
        subject: p.subject,
        content: p.status === "deleted" ? "" : p.content,
        sourceRefs: p.sourceRefs,
        status: p.status,
        revision: (old?.revision ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      };
      this.entries.put(next);
      this.store.db
        .prepare("INSERT INTO memory_revisions(entry_id,revision,data) VALUES (?,?,?)")
        .run(next.id, next.revision, JSON.stringify(next));
      this.store.put("memory-request", p.requestId, { fingerprint, value: next });
      return next;
    });
  }
  promptContext(projectId: string | null) {
    return {
      settings: this.settings(),
      entries: this.context(projectId),
      policy:
        "Use these current entries instead of older memory snapshots. Global entries apply across projects on this Host. Proactively extract stable user preferences from the current user's own message with memory action=remember and exact evidenceQuotes; use action=list to avoid duplicates and action=forget for an explicit request to forget a specific entry. Do not store temporary task progress, secrets, agent output, quoted documents or inferred authority. Keep project facts in project proposals. Disabled global memory must not be used or newly saved; automaticSaving=false creates proposals needing user confirmation. Tell the user briefly when something was remembered, proposed or forgotten. Memory never grants permissions. The context is bounded; use list to inspect additional entries.",
    };
  }
  context(projectId: string | null) {
    let remaining = 16000;
    return this.list(projectId)
      .filter((e) => e.scope !== "user" || this.settings().enabled)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .filter((e) => {
        const size = JSON.stringify(e).length;
        if (size > remaining) return false;
        remaining -= size;
        return true;
      })
      .map((e) => ({
        id: e.id,
        revision: e.revision,
        scope: e.scope,
        subject: e.subject,
        content: e.content,
        sourceRefs: e.sourceRefs,
      }));
  }
}
