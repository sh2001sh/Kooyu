import { Check, Loader2, Mic, Square, X } from "lucide-react";
import { useT } from "../lib/i18n";
import type { VoiceInputHandle } from "../lib/voice";

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function VoiceInputButton({
  voice,
  disabled,
}: {
  voice: VoiceInputHandle;
  disabled?: boolean;
}) {
  const t = useT();
  const active = voice.state === "listening" || voice.state === "recording";
  const transcribing = voice.state === "transcribing";
  const label = active
    ? t("voice.stop")
    : transcribing
      ? t("voice.transcribing")
      : t("voice.start");

  return (
    <button
      type="button"
      className={`composer-voice-btn ${active ? "is-active" : ""} ${transcribing ? "is-busy" : ""}`}
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled || transcribing}
      onClick={voice.toggle}
    >
      {transcribing ? (
        <Loader2 size={15} className="spin" aria-hidden="true" />
      ) : active ? (
        <Square size={12} fill="currentColor" aria-hidden="true" />
      ) : (
        <Mic size={16} strokeWidth={2} aria-hidden="true" />
      )}
    </button>
  );
}

export function VoiceRecordingBar({ voice }: { voice: VoiceInputHandle }) {
  const t = useT();
  const active = voice.state === "listening" || voice.state === "recording";
  const transcribing = voice.state === "transcribing";

  if (!active && !transcribing && !voice.error) return null;

  if (voice.error && !active && !transcribing) {
    return (
      <div className="composer-voice-error" role="alert">
        <span>{voice.error}</span>
        <button
          type="button"
          className="composer-voice-icon-btn"
          aria-label="关闭提示"
          onClick={voice.clearError}
        >
          <X size={13} />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`composer-voice-strip ${transcribing ? "is-busy" : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="composer-voice-strip__lead">
        {transcribing ? (
          <Loader2 size={14} className="spin composer-voice-spinner" aria-hidden="true" />
        ) : (
          <span className="composer-voice-waves" aria-hidden="true">
            {voice.levels.map((lv, idx) => (
              <span
                key={idx}
                className="composer-voice-bar"
                style={{ transform: `scaleY(${lv.toFixed(2)})` }}
              />
            ))}
          </span>
        )}
        <span className="composer-voice-strip__status">
          {transcribing
            ? t("voice.transcribing")
            : voice.state === "listening"
              ? t("voice.listening")
              : t("voice.recording")}
        </span>
        {active && (
          <span className="composer-voice-strip__time">{formatElapsed(voice.elapsedSec)}</span>
        )}
        {voice.interim && <span className="composer-voice-strip__interim">{voice.interim}</span>}
      </div>

      {active && (
        <div className="composer-voice-strip__actions">
          <button
            type="button"
            className="composer-voice-icon-btn"
            aria-label={t("voice.cancel")}
            title={t("voice.cancel")}
            onClick={voice.cancel}
          >
            <X size={14} />
          </button>
          <button
            type="button"
            className="composer-voice-done-btn"
            aria-label={t("voice.stop")}
            title={t("voice.stop")}
            onClick={voice.stop}
          >
            <Check size={14} strokeWidth={2.4} />
          </button>
        </div>
      )}
    </div>
  );
}
