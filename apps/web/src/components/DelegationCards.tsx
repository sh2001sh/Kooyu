import type { DelegationTicket, Session, Snapshot } from "@kodo/protocol";
import {
  ArrowUpRight,
  CheckCircle2,
  FileDiff,
  GitBranch,
  Hand,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { api } from "../lib/host-client";
import { useT, type MessageKey } from "../lib/i18n";
import { HARNESS_NAMES } from "../lib/harnesses";
import { HarnessGlyph } from "./KooyuBrand";

const STATUS_KEYS: Record<DelegationTicket["status"], MessageKey> = {
  provisioning: "delegation.status.provisioning",
  running: "delegation.status.running",
  "awaiting-review": "delegation.status.awaiting-review",
  completed: "delegation.status.completed",
  blocked: "delegation.status.blocked",
  cancelled: "delegation.status.cancelled",
  failed: "delegation.status.failed",
};

/** Restrained header toolbar button to hand a standalone direct session off to Kooyu supervisor. */
export function EscalateToKooyuButton({
  session,
  snapshot,
  act,
  busy,
}: {
  session: Session;
  snapshot: Snapshot;
  act: (work: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
}) {
  const t = useT();
  if (session.kind !== "direct") return null;
  const tickets = snapshot.delegationTickets ?? [];
  const alreadyDelegated = tickets.some((tk) => tk.workerSessionId === session.id);
  if (alreadyDelegated) return null;
  return (
    <button
      type="button"
      className="nx-btn nx-btn--sm"
      disabled={busy}
      title={t("delegation.escalate")}
      onClick={() =>
        void act(() => api("/delegations/escalate", "POST", { workerSessionId: session.id }))
      }
    >
      <Sparkles size={13} />
      <span>{t("delegation.escalate")}</span>
    </button>
  );
}

export function DelegationCards({
  session,
  snapshot,
  choose,
  act,
  busy,
  onReviewDiff,
}: {
  session: Session;
  snapshot: Snapshot;
  choose: (id: string) => void;
  act: (work: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
  onReviewDiff?: (workerSessionId: string) => void;
}) {
  const t = useT();
  const tickets = snapshot.delegationTickets;
  if (!tickets?.length) return null;
  const worker = session.kind === "direct";
  const related = tickets.filter((tk) =>
    worker ? tk.workerSessionId === session.id : tk.controllerSessionId === session.id,
  );
  if (!related.length) return null;

  if (worker) {
    const ticket = related[0]!;
    return (
      <section className="delegation-dock" aria-label={t("delegation.section")}>
        <div className="delegation-banner">
          <div className="delegation-banner__lead">
            <HarnessGlyph harnessId="kodo" size={16} />
            <div>
              <strong>{ticket.title}</strong>
              <div>{t("delegation.managedBanner")}</div>
            </div>
          </div>
          <div className="delegation-card__actions">
            <span className={`delegation-badge delegation-badge--${ticket.status}`}>
              <span className="delegation-dot" />
              {t(STATUS_KEYS[ticket.status])}
            </span>
            <button
              type="button"
              className="nx-btn nx-btn--sm"
              onClick={() => choose(ticket.controllerSessionId)}
            >
              <ArrowUpRight size={13} />
              {t("delegation.viewController")}
            </button>
            {ticket.status === "blocked" && (
              <button
                type="button"
                className="nx-btn nx-btn--sm nx-btn--coral"
                disabled={busy}
                onClick={() =>
                  void act(() => api(`/delegations/${ticket.id}/handback`, "POST", {}))
                }
              >
                <RotateCcw size={13} />
                {t("delegation.handback")}
              </button>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="delegation-dock" aria-label={t("delegation.section")}>
      {related.map((ticket) => {
        const report = ticket.report;
        const passedChecks = report?.hostVerifications.filter((v) => v.passed).length ?? 0;
        const totalChecks = report?.hostVerifications.length ?? 0;
        return (
          <article key={ticket.id} className="delegation-card">
            <div className="delegation-card__head">
              <div className="delegation-card__title">
                <HarnessGlyph harnessId={ticket.harnessId} size={17} />
                <strong>{ticket.title}</strong>
              </div>
              <span className={`delegation-badge delegation-badge--${ticket.status}`}>
                <span className="delegation-dot" />
                {t(STATUS_KEYS[ticket.status])}
              </span>
            </div>

            <div className="delegation-card__meta">
              <span>{HARNESS_NAMES[ticket.harnessId] ?? ticket.harnessId}</span>
              <span className="delegation-chip">
                <GitBranch size={11} />
                {ticket.mandate.worktreeBranch ?? t("delegation.sharedWorkspace")}
              </span>
            </div>

            {ticket.lastError && <p className="delegation-card__error">{ticket.lastError}</p>}

            {report && (
              <>
                <div className="delegation-card__facts">
                  <span>{report.gitFacts.diffStat.filesChanged} files</span>
                  <span className="delegation-diff-add">
                    +{report.gitFacts.diffStat.insertions}
                  </span>
                  <span className="delegation-diff-del">-{report.gitFacts.diffStat.deletions}</span>
                  {totalChecks > 0 && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <CheckCircle2 size={13} />
                      Host {passedChecks}/{totalChecks}
                    </span>
                  )}
                </div>
                {report.workerClaim.replyExcerpt && (
                  <p className="delegation-card__excerpt">{report.workerClaim.replyExcerpt}</p>
                )}
              </>
            )}

            <div className="delegation-card__actions">
              {ticket.workerSessionId && (
                <button
                  type="button"
                  className="nx-btn nx-btn--sm"
                  onClick={() => choose(ticket.workerSessionId!)}
                >
                  <ArrowUpRight size={13} />
                  {t("delegation.viewWorker")}
                </button>
              )}
              {ticket.workerSessionId && onReviewDiff && (
                <button
                  type="button"
                  className="nx-btn nx-btn--sm"
                  onClick={() => onReviewDiff(ticket.workerSessionId!)}
                >
                  <FileDiff size={13} />
                  {t("delegation.reviewDiff")}
                </button>
              )}
              {ticket.status === "running" && ticket.watchId && (
                <button
                  type="button"
                  className="nx-btn nx-btn--sm"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await api(`/watches/${ticket.watchId}`, "PATCH", { state: "paused" });
                      if (ticket.workerSessionId) choose(ticket.workerSessionId);
                    })
                  }
                >
                  <Hand size={13} />
                  {t("delegation.takeover")}
                </button>
              )}
              {ticket.status === "blocked" && (
                <button
                  type="button"
                  className="nx-btn nx-btn--sm nx-btn--coral"
                  disabled={busy}
                  onClick={() =>
                    void act(() => api(`/delegations/${ticket.id}/handback`, "POST", {}))
                  }
                >
                  <RotateCcw size={13} />
                  {t("delegation.handback")}
                </button>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
