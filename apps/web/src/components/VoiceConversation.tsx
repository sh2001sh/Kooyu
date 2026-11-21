import { useEffect, useRef, useState } from "react";
import type { RuntimeEvent } from "@kodo/protocol";
import { assistantContent } from "@kodo/protocol/client";
import { Phone, PhoneOff, Radio, X } from "lucide-react";
import { callRecognition } from "../lib/voice";
import { useT } from "../lib/i18n";

interface Call {
  stopped: boolean;
  speaking: boolean;
  seen: number;
  recognition?: InstanceType<NonNullable<ReturnType<typeof callRecognition>>>;
  retry?: ReturnType<typeof setTimeout>;
  listen: () => void;
}

export interface VoiceCallState {
  supported: boolean;
  active: boolean;
  status: string;
  error: string;
  start: () => Promise<void>;
  end: () => void;
  clearError: () => void;
}

export function useVoiceConversation({
  events,
  send,
}: {
  events: RuntimeEvent[];
  send: (text: string) => Promise<boolean>;
}): VoiceCallState {
  const t = useT();
  const call = useRef<Call | null>(null);
  const sender = useRef(send);
  sender.current = send;
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const end = () => {
    const c = call.current;
    if (!c) return;
    c.stopped = true;
    call.current = null;
    clearTimeout(c.retry);
    c.recognition?.abort();
    if (c.speaking) window.speechSynthesis.cancel();
    setStatus("");
  };

  useEffect(() => end, []);

  useEffect(() => {
    const c = call.current;
    if (!c) return;
    for (const event of events) {
      if (event.sequence <= c.seen) continue;
      c.seen = event.sequence;
      if (
        event.type !== "message" ||
        !event.payload ||
        typeof event.payload !== "object" ||
        ("role" in event.payload && event.payload.role !== "assistant")
      )
        continue;
      const text = assistantContent(event.payload).text.trim();
      if (!text) continue;
      c.speaking = true;
      c.recognition?.abort();
      setStatus(t("voiceCall.speaking"));
      const utterance = new SpeechSynthesisUtterance(text);
      const resume = () => {
        if (c.stopped || window.speechSynthesis.pending) return;
        c.speaking = false;
        c.listen();
      };
      utterance.onend = resume;
      utterance.onerror = resume;
      window.speechSynthesis.speak(utterance);
    }
  }, [events, t]);

  const start = async () => {
    const Recognition = callRecognition();
    if (!Recognition || call.current) return;
    const c: Call = {
      stopped: false,
      speaking: false,
      seen: events.at(-1)?.sequence ?? 0,
      listen: () => {},
    };
    call.current = c;
    setError("");
    setStatus(t("voiceCall.opening"));
    try {
      // Request mic permission cleanly then release the preview stream so SpeechRecognition
      // never conflicts with exclusive audio capture on Windows.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      stream.getTracks().forEach((tr) => tr.stop());
      if (c.stopped) return;
      c.listen = () => {
        if (c.stopped || c.speaking || c.recognition) return;
        const recognition = new Recognition();
        c.recognition = recognition;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = navigator.language;
        let delivered = 0;
        let transmit = Promise.resolve();
        recognition.onresult = (event) => {
          if (c.stopped || c.speaking) return;
          for (let i = delivered; i < event.results.length; i++) {
            const part = event.results[i];
            const text = part?.[0]?.transcript.trim();
            if (!part?.isFinal) {
              if (text) setStatus(text);
              break;
            }
            delivered = i + 1;
            if (text)
              transmit = transmit
                .then(async () => {
                  if (c.stopped) return;
                  if (!(await sender.current(text))) throw Error("语音消息未获 Host 确认。");
                  if (!c.stopped && !c.speaking) setStatus(t("voiceCall.listening"));
                })
                .catch((e) => {
                  if (!c.stopped) {
                    end();
                    setError(String(e.message ?? e));
                  }
                });
          }
        };
        recognition.onend = () => {
          if (c.recognition === recognition) c.recognition = undefined;
          if (!c.stopped && !c.speaking) c.retry = setTimeout(c.listen, 250);
        };
        recognition.onerror = (ev) => {
          if (c.stopped || ev.error === "aborted" || ev.error === "no-speech") return;
          end();
          setError("语音通话中断：" + ev.error);
        };
        try {
          recognition.start();
          setStatus(t("voiceCall.listening"));
        } catch (e) {
          end();
          setError(e instanceof Error ? e.message : String(e));
        }
      };
      c.listen();
    } catch (e) {
      if (!c.stopped) {
        end();
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  };

  const supported = Boolean(
    callRecognition() &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof window !== "undefined" &&
    "speechSynthesis" in window,
  );

  return {
    supported,
    active: Boolean(status),
    status,
    error,
    start,
    end,
    clearError: () => setError(""),
  };
}

export function VoiceConversationButton({
  call,
  disabled,
}: {
  call: VoiceCallState;
  disabled: boolean;
}) {
  const t = useT();
  if (!call.supported) return null;
  return (
    <button
      type="button"
      className={`composer-voice-btn ${call.active ? "is-active" : ""}`}
      aria-label={call.active ? t("voiceCall.end") : t("voiceCall.start")}
      aria-pressed={call.active}
      title={call.active ? call.status : t("voiceCall.start")}
      disabled={!call.active && disabled}
      onClick={() => (call.active ? call.end() : void call.start())}
    >
      {call.active ? <PhoneOff size={16} /> : <Phone size={16} />}
    </button>
  );
}

export function VoiceConversationBar({ call }: { call: VoiceCallState }) {
  const t = useT();
  if (!call.active && !call.error) return null;
  return (
    <div
      className={`nx-voice-bar ${call.error && !call.active ? "nx-voice-bar--error" : ""}`}
      role={call.error && !call.active ? "alert" : "status"}
    >
      <div className="nx-voice-bar__lead">
        <Radio size={14} />
        <span>{call.active ? call.status : call.error}</span>
      </div>
      {call.active ? (
        <button type="button" className="nx-btn nx-btn--sm nx-btn--danger" onClick={call.end}>
          <PhoneOff size={12} />
          {t("voiceCall.end")}
        </button>
      ) : (
        <button
          type="button"
          className="nx-btn nx-btn--sm nx-btn--ghost"
          aria-label={t("common.close")}
          onClick={call.clearError}
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}
