import { useEffect, useRef, useState } from "react";
import { CalendarClock, Camera, CircleDot, Download, Globe, Square } from "lucide-react";
import { api, apiPath } from "../lib/host-client";
import { useT } from "../lib/i18n";
import { ScreenshotAnnotation } from "./ScreenshotAnnotation";

interface FramePayload {
  dropped?: boolean;
  sequence: number;
  frame: string;
  pageId: string;
  tabs?: { id: string; origin: string }[];
}

export function BrowserControl({ id, generation }: { id: string; generation: number }) {
  const t = useT();
  const [image, setImage] = useState("");
  const [tabs, setTabs] = useState<{ id: string; origin: string }[]>([]);
  const [pageId, setPageId] = useState("");
  const [annotation, setAnnotation] = useState("");
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const [demo, setDemo] = useState<{ recordingId: string; markdown: string }>();
  const [time, setTime] = useState("09:00");
  const [scheduled, setScheduled] = useState(false);
  const [saving, setSaving] = useState(false);
  const queue = useRef(Promise.resolve());
  const base = "/browsers/" + id;

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let source: EventSource | null = null;
    let after = -1;

    const applyFrame = (result: FramePayload) => {
      if (stopped || result.dropped) return;
      if (result.frame) setImage("data:image/jpeg;base64," + result.frame);
      if (result.pageId) setPageId(result.pageId);
      if (result.tabs) setTabs(result.tabs);
      after = result.sequence;
    };

    const startPolling = () => {
      const poll = async () => {
        try {
          const result = await api<FramePayload>(
            base + "/frame?generation=" + generation + "&after=" + after,
          );
          if (stopped) return;
          applyFrame(result);
          timer = setTimeout(() => void poll(), 200);
        } catch (e) {
          if (!stopped) setError(e instanceof Error ? e.message : String(e));
        }
      };
      void poll();
    };

    if (typeof EventSource !== "undefined") {
      const es = new EventSource(apiPath(base + "/stream?generation=" + generation), {
        withCredentials: true,
      });
      source = es;
      let gotAny = false;
      es.onmessage = (event) => {
        gotAny = true;
        try {
          applyFrame(JSON.parse(event.data) as FramePayload);
        } catch {}
      };
      es.onerror = () => {
        es.close();
        if (source === es) source = null;
        if (!stopped && !gotAny) startPolling();
        else if (!stopped) timer = setTimeout(startPolling, 400);
      };
    } else {
      startPolling();
    }

    return () => {
      stopped = true;
      clearTimeout(timer);
      source?.close();
    };
  }, [base, generation]);

  const input = (value: unknown) => {
    queue.current = queue.current
      .then(async () => {
        await api(base + "/input?generation=" + generation, "POST", value);
      })
      .catch((e) => setError(e.message));
  };

  return (
    <div className="nx-browser-panel">
      <div className="nx-browser-toolbar">
        {tabs.length > 1 && (
          <label className="nx-row" style={{ gap: 6 }}>
            <Globe size={14} />
            <select
              className="nx-select"
              aria-label={t("browser.tabs")}
              value={pageId}
              onChange={(event) => {
                const selected = event.target.value;
                queue.current = queue.current
                  .then(async () => {
                    await api(base + "/select-tab?generation=" + generation, "POST", {
                      pageId: selected,
                    });
                  })
                  .catch((e) => setError(e.message));
              }}
            >
              {tabs.map((tab, i) => (
                <option key={tab.id} value={tab.id}>
                  {i + 1} · {tab.origin}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          className={`nx-btn nx-btn--sm ${recording ? "nx-btn--danger" : ""}`}
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await queue.current;
              const result = await api<{
                recording: boolean;
                recordingId?: string;
                markdown?: string;
              }>(base + "/record?generation=" + generation, "POST", { start: !recording });
              setRecording(result.recording);
              setScheduled(false);
              setDemo(
                result.recordingId && result.markdown
                  ? { recordingId: result.recordingId, markdown: result.markdown }
                  : undefined,
              );
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setSaving(false);
            }
          }}
        >
          {recording ? <Square size={12} /> : <CircleDot size={12} />}
          {recording ? t("browser.recordStop") : t("browser.recordStart")}
        </button>

        {image && !annotation && (
          <button type="button" className="nx-btn nx-btn--sm" onClick={() => setAnnotation(image)}>
            <Camera size={12} />
            {t("browser.annotate")}
          </button>
        )}
      </div>

      {demo && (
        <div className="nx-card">
          <div className="nx-card__body">
            <span className="nx-section-label">SKILL.md</span>
            <pre className="work-json" style={{ maxHeight: 180, overflow: "auto", margin: 0 }}>
              {demo.markdown}
            </pre>
            <div className="nx-row">
              <button
                type="button"
                className="nx-btn nx-btn--sm"
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([demo.markdown], { type: "text/markdown" }),
                  );
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "SKILL.md";
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                <Download size={12} />
                {t("browser.downloadSkill")}
              </button>
              <div className="delegation-card__actions">
                <label className="nx-row" style={{ gap: 6, fontSize: 12 }}>
                  <span>{t("browser.dailyTime")}</span>
                  <input
                    className="nx-input"
                    style={{ width: 108, height: 26 }}
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="nx-btn nx-btn--sm nx-btn--primary"
                  disabled={saving || scheduled || !time}
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await api(base + "/schedule-recording", "POST", {
                        requestId: demo.recordingId,
                        recordingId: demo.recordingId,
                        name: "浏览器示教计划",
                        time,
                        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                      });
                      setScheduled(true);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  <CalendarClock size={12} />
                  {scheduled ? t("browser.scheduled") : t("browser.createSchedule")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {annotation && (
        <ScreenshotAnnotation
          frame={annotation}
          fileName="kooyu-browser-screenshot.png"
          close={() => setAnnotation("")}
        />
      )}

      {image && !annotation && (
        <button
          type="button"
          className="nx-browser-viewport"
          aria-label="受管浏览器画面，点击后可使用键盘输入"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            input({
              type: "click",
              x: (1280 * (e.clientX - r.left)) / r.width,
              y: (900 * (e.clientY - r.top)) / r.height,
            });
          }}
          onKeyDown={(e) => {
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (
              [
                "Tab",
                "Enter",
                "Backspace",
                "Escape",
                "ArrowLeft",
                "ArrowRight",
                "ArrowDown",
                "ArrowUp",
              ].includes(e.key)
            ) {
              if (e.key === "Tab" && e.shiftKey) return;
              e.preventDefault();
              input({ type: "key", key: e.key });
            } else if (e.key.length === 1) {
              e.preventDefault();
              input({ type: "text", text: e.key });
            }
          }}
          onPaste={(e) => {
            e.preventDefault();
            input({ type: "text", text: e.clipboardData.getData("text").slice(0, 2048) });
          }}
        >
          <img src={image} alt="受管浏览器实时画面" />
        </button>
      )}

      {error && (
        <p className="nx-feedback nx-feedback--error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
