import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { ChevronDown, ChevronRight, MessageSquarePlus, TerminalSquare } from "lucide-react";
import { api, apiPath } from "../lib/host-client";
import { useT } from "../lib/i18n";

function readTerminalTheme() {
  const dark = document.documentElement.classList.contains("dark");
  return dark
    ? {
        background: "#121316",
        foreground: "#eceef2",
        cursor: "#f17561",
        selectionBackground: "rgba(241, 117, 97, 0.28)",
      }
    : {
        background: "#eff0f3",
        foreground: "#141518",
        cursor: "#e6533c",
        selectionBackground: "rgba(20, 21, 24, 0.14)",
      };
}

function stripAnsi(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g, "");
}

export function WorkspaceTerminal({
  workspaceId,
  onSendToAgent,
}: {
  workspaceId: string;
  onSendToAgent?: (text: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const mount = useRef<HTMLDivElement>(null);
  const tailRef = useRef("");
  const writeRef = useRef<((data: string) => void) | null>(null);

  useEffect(() => {
    if (!open || !mount.current) return;
    const hostEl = mount.current;
    const term = new Terminal({
      cols: 80,
      rows: 14,
      fontSize: 12,
      fontFamily: "var(--font-mono)",
      theme: readTerminalTheme(),
      cursorBlink: true,
    });
    term.open(hostEl);
    tailRef.current = "";

    const themeObserver = new MutationObserver(() => {
      term.options.theme = readTerminalTheme();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    let disposed = false;
    let id = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let source: EventSource | null = null;
    let pending = Promise.resolve();
    let lastCols = term.cols;
    let lastRows = term.rows;

    const fail = (e: unknown) => {
      if (!disposed) setError(e instanceof Error ? e.message : String(e));
    };

    const sendInput = (data: string) => {
      if (!id || disposed) return;
      pending = pending
        .then(async () => {
          if (!disposed && id) await api("/terminals/" + id, "POST", { data });
        })
        .catch(fail);
    };
    writeRef.current = sendInput;

    const fitSize = () => {
      const rect = hostEl.getBoundingClientRect();
      if (rect.width < 120 || rect.height < 80) return;
      const cols = Math.max(32, Math.min(240, Math.floor((rect.width - 20) / 7.4)));
      const rows = Math.max(8, Math.min(80, Math.floor((rect.height - 14) / 16.5)));
      if (cols === lastCols && rows === lastRows) return;
      lastCols = cols;
      lastRows = rows;
      term.resize(cols, rows);
      if (id && !disposed) {
        void api("/terminals/" + id, "POST", { cols, rows }).catch(() => {});
      }
    };

    const resizeObserver = new ResizeObserver(() => fitSize());
    resizeObserver.observe(hostEl);

    const start = async () => {
      id = (await api<{ id: string }>("/terminals", "POST", { workspaceId })).id;
      const path = "/terminals/" + id;
      if (disposed) {
        await api(path, "DELETE");
        return;
      }
      fitSize();
      await api(path, "POST", { cols: term.cols, rows: term.rows });
      if (disposed) return;
      term.onData(sendInput);
      term.focus();

      let cursor = 0;
      const applyChunk = (result: {
        text: string;
        cursor: number;
        closed: boolean;
        reset: boolean;
      }) => {
        if (disposed) return;
        if (result.reset) {
          term.reset();
          tailRef.current = "";
        }
        if (result.text) {
          term.write(result.text);
          tailRef.current = (tailRef.current + result.text).slice(-4000);
        }
        cursor = result.cursor;
      };

      const startPolling = () => {
        const poll = async () => {
          const result = await api<{
            text: string;
            cursor: number;
            closed: boolean;
            reset: boolean;
          }>(path + "?cursor=" + cursor);
          if (disposed) return;
          applyChunk(result);
          if (!result.closed) timer = setTimeout(() => void poll().catch(fail), 180);
        };
        void poll().catch(fail);
      };

      // Prefer real-time SSE stream; fall back seamlessly to HTTP polling if unavailable.
      if (typeof EventSource !== "undefined") {
        const es = new EventSource(apiPath(path + "/stream?cursor=" + cursor), {
          withCredentials: true,
        });
        source = es;
        let receivedAny = false;
        es.onmessage = (event) => {
          receivedAny = true;
          try {
            const payload = JSON.parse(event.data) as {
              text: string;
              cursor: number;
              closed: boolean;
              reset: boolean;
            };
            applyChunk(payload);
            if (payload.closed) es.close();
          } catch {}
        };
        es.onerror = () => {
          es.close();
          if (source === es) source = null;
          if (!disposed && !receivedAny) startPolling();
          else if (!disposed) timer = setTimeout(startPolling, 350);
        };
      } else {
        startPolling();
      }
    };

    void start().catch(fail);
    return () => {
      disposed = true;
      writeRef.current = null;
      clearTimeout(timer);
      source?.close();
      resizeObserver.disconnect();
      themeObserver.disconnect();
      term.dispose();
      if (id) void api("/terminals/" + id, "DELETE").catch(() => {});
    };
  }, [workspaceId, open]);

  const quoteTail = () => {
    const clean = stripAnsi(tailRef.current).trim().slice(-2400);
    if (!clean || !onSendToAgent) return;
    onSendToAgent(`终端输出如下，请帮我分析并修复问题：\n\`\`\`\n${clean}\n\`\`\``);
  };

  return (
    <section className="nx-card workspace-terminal" aria-label={t("terminal.title")}>
      <button
        type="button"
        className="nx-card__toggle"
        aria-expanded={open}
        onClick={() => {
          setError("");
          setOpen((v) => !v);
        }}
      >
        <span className="nx-card__toggle-lead">
          <TerminalSquare size={15} />
          <span>{open ? t("terminal.close") : t("terminal.open")}</span>
        </span>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>

      {open && (
        <div className="nx-card__body">
          <div className="nx-row">
            <div className="nx-terminal-shortcuts" aria-label="快捷按键">
              {[
                { label: "Ctrl+C", seq: "\x03" },
                { label: "Tab", seq: "\t" },
                { label: "↑", seq: "\x1b[A" },
                { label: "↓", seq: "\x1b[B" },
                { label: "Esc", seq: "\x1b" },
              ].map((k) => (
                <button
                  key={k.label}
                  type="button"
                  className="nx-key-chip"
                  onClick={() => writeRef.current?.(k.seq)}
                >
                  {k.label}
                </button>
              ))}
            </div>
            {onSendToAgent && (
              <button type="button" className="nx-btn nx-btn--sm" onClick={quoteTail}>
                <MessageSquarePlus size={12} />
                {t("terminal.quoteError")}
              </button>
            )}
          </div>
          <div ref={mount} className="nx-terminal-host" />
          {error && (
            <p className="nx-feedback nx-feedback--error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
