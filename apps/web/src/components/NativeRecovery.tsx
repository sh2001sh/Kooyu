import { useState } from "react";
import type { Command, Session } from "@kodo/protocol";
import { api } from "../lib/host-client";

export function NativeRecovery({
  session,
  commands,
  act,
}: {
  session: Session;
  commands: Command[];
  act: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const [nativeId, setNativeId] = useState("");
  const [note, setNote] = useState("");
  const [idle, setIdle] = useState(false);
  const [stopped, setStopped] = useState(false);
  const unknown = commands.filter((c) => c.status === "unknown");

  return (
    <section className="detail-sub-stack">
      <h3>原生恢复与对账</h3>
      {session.phase === "draft" && unknown.length === 0 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(() =>
              api(`/sessions/${session.id}/attach`, "POST", {
                nativeSessionId: nativeId,
                externalStopped: stopped,
              }),
            );
          }}
        >
          <label>
            已有原生会话 ID
            <input required value={nativeId} onChange={(e) => setNativeId(e.target.value)} />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              required
              checked={stopped}
              onChange={(e) => setStopped(e.target.checked)}
            />
            <span>外部执行已结束，允许在 Kooyu 恢复</span>
          </label>
          <div className="actions">
            <button type="submit">绑定已有会话</button>
          </div>
        </form>
      )}
      {unknown.length > 0 && (
        <>
          <label>
            核对依据
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="原生历史中的消息、时间与运行状态…"
            />
          </label>
          {unknown.some((c) => c.kind === "open") && (
            <label>
              已核对的原生会话 ID
              <input value={nativeId} onChange={(e) => setNativeId(e.target.value)} />
            </label>
          )}
          <label className="check-label">
            <input type="checkbox" checked={idle} onChange={(e) => setIdle(e.target.checked)} />
            <span>已确认原生当前空闲，允许继续递送排队输入</span>
          </label>
          {unknown.map((c) => (
            <div className="watch-row" key={c.id}>
              <code>
                {c.kind} · {c.id}
              </code>
              <div className="actions">
                {(["confirmed", "rejected"] as const).map((resolution) => (
                  <button
                    type="button"
                    key={resolution}
                    disabled={
                      !note.trim() || (resolution === "confirmed" && c.kind === "open" && !nativeId)
                    }
                    onClick={() =>
                      void act(() =>
                        api(`/sessions/${session.id}/reconcile`, "POST", {
                          commandId: c.id,
                          resolution,
                          note,
                          idleConfirmed: idle,
                          ...(c.kind === "open" && resolution === "confirmed"
                            ? { nativeSessionId: nativeId }
                            : {}),
                        }),
                      )
                    }
                  >
                    {resolution === "confirmed" ? "原生已接收" : "确认原生未接收"}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
