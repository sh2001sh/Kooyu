import { createHash, randomUUID } from "node:crypto";
import type { Command, HeartbeatAnomaly, HeartbeatStatus, InboxItem } from "@kodo/protocol";
import type { SessionService } from "../session-service.js";
import { runCheckScript } from "./check-script.js";

function shortHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

/**
 * Kooyu's Zero-Token Harness Health Radar & `HEARTBEAT.md` patrol monitor.
 *
 * Scans live Host state (stalled Harness sessions, stale unresolved interactions,
 * blocked Goals) and optional `HEARTBEAT.md` check scripts with 0 LLM tokens.
 * Stays completely silent when healthy; emits deduplicated alerts or wakes the
 * Kooyu supervisor only when something genuinely changes or needs attention.
 */
export class HeartbeatMonitor {
  private readonly startedAt = Date.now();
  private scanning = false;
  private lastCheckedAt: string | null = null;
  private lastOutcome: HeartbeatStatus["lastOutcome"] = "idle";
  private activeAnomalies: HeartbeatAnomaly[] = [];
  private lastError: string | null = null;

  constructor(private readonly service: SessionService) {}

  status(): HeartbeatStatus {
    const config = this.service.memory.docs?.parseHeartbeatConfig() ?? {
      enabled: false,
      intervalMinutes: 15,
      stallMinutes: 15,
      checks: [],
    };
    return {
      enabled: config.enabled,
      intervalMinutes: config.intervalMinutes,
      stallMinutes: config.stallMinutes,
      lastCheckedAt: this.lastCheckedAt,
      lastOutcome: this.lastOutcome,
      activeAnomalies: this.activeAnomalies,
      lastError: this.lastError,
    };
  }

  /** Periodic scan invoked from Host's background timer; respects `interval_minutes` in HEARTBEAT.md. */
  async tick(now = new Date()): Promise<HeartbeatStatus | null> {
    if (this.scanning || this.service.lifecycle.status().frozen) return null;
    const config = this.service.memory.docs?.parseHeartbeatConfig();
    if (!config?.enabled) return null;
    const intervalMs = config.intervalMinutes * 60_000;
    if (!this.lastCheckedAt) {
      if (now.getTime() - this.startedAt < Math.min(intervalMs, 60_000)) return null;
    } else if (now.getTime() - Date.parse(this.lastCheckedAt) < intervalMs) {
      return null;
    }
    return this.scan(now);
  }

  /** Executes a full zero-Token health scan immediately (used by tick, API, and agent tool). */
  async scan(now = new Date()): Promise<HeartbeatStatus> {
    if (this.scanning) return this.status();
    this.scanning = true;
    try {
      const config = this.service.memory.docs?.parseHeartbeatConfig() ?? {
        enabled: true,
        intervalMinutes: 15,
        stallMinutes: 15,
        checks: [],
      };
      const stallMs = config.stallMinutes * 60_000;
      const nowMs = now.getTime();
      const anomalies: HeartbeatAnomaly[] = [];

      // 1. Stalled Harness sessions watchdog (all managed Harnesses!)
      for (const session of this.service.store.sessions()) {
        if (session.runState !== "running") continue;
        const lastEvent = this.service.store.eventPage(session.id, undefined, 1).events.at(-1);
        const lastActivityIso = lastEvent?.createdAt ?? session.createdAt;
        const lastActivityMs = Date.parse(lastActivityIso);
        if (!Number.isFinite(lastActivityMs)) continue;
        const idleMs = nowMs - lastActivityMs;
        if (idleMs >= stallMs) {
          const idleMinutes = Math.max(1, Math.round(idleMs / 60_000));
          anomalies.push({
            fingerprint: `stalled:${session.id}:${lastActivityIso}`,
            kind: "stalled-session",
            severity: "warning",
            title: `引擎会话疑似卡顿：${session.title}`,
            detail: `${session.harnessId} 会话「${session.title}」已连续 ${idleMinutes} 分钟无新活动事件（阈值 ${config.stallMinutes} 分钟）。请检查是否卡在命令、等待输入或需要人工介入。`,
            sessionId: session.id,
            onHit: "notify",
          });
        }
      }

      // 2. Stale unresolved interaction cards waiting on user
      for (const item of this.service.store.records<InboxItem>("inbox")) {
        if (item.type !== "interaction" || item.resolved) continue;
        const createdMs = Date.parse(item.createdAt);
        if (!Number.isFinite(createdMs)) continue;
        if (nowMs - createdMs >= stallMs) {
          const waitMinutes = Math.max(1, Math.round((nowMs - createdMs) / 60_000));
          anomalies.push({
            fingerprint: `stale-interaction:${item.id}`,
            kind: "stale-interaction",
            severity: "info",
            title: `有等待你确认的请求已超过 ${waitMinutes} 分钟`,
            detail: `会话 ${item.sessionId} 有一条待处理的审批或提问卡片尚未回复。`,
            sessionId: item.sessionId,
            onHit: "notify",
          });
        }
      }

      // 3. Blocked Goals
      for (const goal of this.service.goals.list()) {
        if (goal.status !== "blocked") continue;
        anomalies.push({
          fingerprint: `blocked-goal:${goal.id}:${goal.revision}`,
          kind: "blocked-goal",
          severity: "warning",
          title: `目标受阻：${goal.title}`,
          detail: goal.blockedReason || "该目标当前处于阻塞状态，等待你的决策或解除依赖。",
          sessionId: goal.controllerSessionId,
          goalId: goal.id,
          onHit: "notify",
        });
      }

      // 4. Optional zero-Token check scripts declared in HEARTBEAT.md
      const fallbackCwd = this.service.memory.docs?.dir ?? process.cwd();
      for (const check of config.checks) {
        const result = await runCheckScript(
          { command: check.command, timeoutSec: 60, mode: "non-empty-stdout-is-hit" },
          fallbackCwd,
        );
        if (result.outcome === "hit") {
          anomalies.push({
            fingerprint: `check:${shortHash(check.command + "\n" + result.output)}`,
            kind: "check-script",
            severity: "info",
            title: `巡检脚本命中：${check.command.slice(0, 60)}`,
            detail: result.output,
            onHit: check.onHit,
          });
        } else if (result.outcome === "failed") {
          anomalies.push({
            fingerprint: `check-err:${shortHash(check.command + "\n" + (result.reason ?? ""))}`,
            kind: "check-script",
            severity: "error",
            title: `巡检脚本执行失败：${check.command.slice(0, 60)}`,
            detail: result.reason ?? "脚本非零退出",
            onHit: "notify",
          });
        }
      }

      this.lastCheckedAt = now.toISOString();
      this.activeAnomalies = anomalies;
      this.lastError = null;

      // Filter to newly observed anomalies so repeat ticks never spam
      const freshAnomalies: HeartbeatAnomaly[] = [];
      for (const anomaly of anomalies) {
        if (this.service.store.record("heartbeat-seen", anomaly.fingerprint)) continue;
        this.service.store.put("heartbeat-seen", anomaly.fingerprint, {
          at: this.lastCheckedAt,
          kind: anomaly.kind,
        });
        freshAnomalies.push(anomaly);
      }

      if (!freshAnomalies.length) {
        this.lastOutcome = anomalies.length ? "hit" : "quiet";
        return this.status();
      }

      this.lastOutcome = "hit";
      const supervisor = this.findPrimarySupervisor();
      const wakeAnomalies: HeartbeatAnomaly[] = [];

      for (const anomaly of freshAnomalies) {
        const targetSessionId =
          (anomaly.sessionId && this.hasSession(anomaly.sessionId) ? anomaly.sessionId : null) ??
          supervisor?.id ??
          null;
        if (targetSessionId) {
          this.service.inbox(`heartbeat:${anomaly.fingerprint}`, targetSessionId, "notification", {
            source: "heartbeat",
            kind: anomaly.kind,
            severity: anomaly.severity,
            title: anomaly.title,
            message: anomaly.detail,
            goalId: anomaly.goalId ?? null,
          });
        }
        if (anomaly.onHit === "wake") {
          wakeAnomalies.push(anomaly);
        }
      }

      // Only wake the LLM supervisor when an explicit `check(wake):` hit occurred and supervisor is idle
      if (wakeAnomalies.length && supervisor && supervisor.runState === "idle") {
        const busy = this.service.store
          .commands(supervisor.id)
          .some((c) => ["accepted", "dispatched", "unknown"].includes(c.status));
        if (!busy) {
          const cmd: Command = {
            id: randomUUID(),
            sessionId: supervisor.id,
            kind: "send",
            origin: "automation",
            controllerId: null,
            generation: supervisor.ownerEpoch,
            bindingRevision: supervisor.bindingRevision,
            status: "accepted",
            nativeRunId: null,
            body: {
              mode: "queue",
              text: JSON.stringify({
                type: "heartbeat-wake",
                checkedAt: this.lastCheckedAt,
                anomalies: wakeAnomalies.map((a) => ({
                  kind: a.kind,
                  title: a.title,
                  detail: a.detail,
                })),
                note: "以上来自 HEARTBEAT.md 零 Token 预检命中。如评估无需打扰用户，请在回复末尾输出 NO_REPLY 以静默结束本轮；如确需处理或告知用户，请简明行动或汇报。",
              }),
            },
            createdAt: this.lastCheckedAt,
          };
          this.service.store.saveCommand(cmd);
          this.service.resumeWork();
        }
      }

      return this.status();
    } catch (error) {
      this.lastCheckedAt = now.toISOString();
      this.lastOutcome = "error";
      this.lastError = error instanceof Error ? error.message : String(error);
      return this.status();
    } finally {
      this.scanning = false;
    }
  }

  private hasSession(id: string): boolean {
    return this.service.store.sessions().some((s) => s.id === id);
  }

  private findPrimarySupervisor() {
    return this.service.store
      .sessions()
      .filter((s) => s.harnessId === "kodo" && s.kind === "supervisor")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }
}
