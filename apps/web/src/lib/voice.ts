import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_VOICE_SETTINGS, type VoiceTranscriptionResult } from "@kodo/protocol";
import { apiPath, HostError } from "./host-client";
import { useT } from "./i18n";
import { useAppPreferences } from "./preferences";

export type VoiceState = "idle" | "listening" | "recording" | "transcribing";

interface BrowserSpeechRecognitionEvent {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [alt: number]: { transcript: string };
    };
  };
}

interface BrowserSpeechRecognitionErrorEvent {
  error: string;
  message?: string;
}

interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionCtor = new () => BrowserSpeechRecognition;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function isElectronRuntime(): boolean {
  return typeof navigator !== "undefined" && /\bElectron\//i.test(navigator.userAgent);
}

function pickRecorderMimeType(): string {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "audio/webm";
  }
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

/** Merge a newly recognized voice phrase smoothly into the composer's existing text. */
export function appendVoiceTranscript(current: string, addition: string): string {
  const clean = addition.trim();
  if (!clean) return current;
  if (!current.trim()) return clean;
  if (/\s$/.test(current)) return current + clean;
  const lastChar = current[current.length - 1] ?? "";
  const firstChar = clean[0] ?? "";
  const asciiWord = /[A-Za-z0-9]/;
  if (asciiWord.test(lastChar) && asciiWord.test(firstChar)) {
    return `${current} ${clean}`;
  }
  return current + clean;
}

const IDLE_LEVELS = [0.18, 0.24, 0.2, 0.24, 0.18];

export interface VoiceInputHandle {
  state: VoiceState;
  interim: string;
  elapsedSec: number;
  levels: number[];
  error: string;
  clearError: () => void;
  toggle: () => void;
  stop: () => void;
  cancel: () => void;
}

export function useVoiceInput({
  disabled = false,
  onTranscript,
  onAutoSend,
}: {
  disabled?: boolean;
  onTranscript: (text: string) => void;
  onAutoSend?: (text: string) => void;
}): VoiceInputHandle {
  const t = useT();
  const { settings } = useAppPreferences();
  const voiceSettings = settings.voice ?? DEFAULT_VOICE_SETTINGS;

  const [state, setState] = useState<VoiceState>("idle");
  const [interim, setInterim] = useState("");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [levels, setLevels] = useState<number[]>(IDLE_LEVELS);
  const [error, setError] = useState("");

  const stateRef = useRef<VoiceState>("idle");
  const onTranscriptRef = useRef(onTranscript);
  const onAutoSendRef = useRef(onAutoSend);
  const voiceSettingsRef = useRef(voiceSettings);
  const localeRef = useRef(t.locale);
  onTranscriptRef.current = onTranscript;
  onAutoSendRef.current = onAutoSend;
  voiceSettingsRef.current = voiceSettings;
  localeRef.current = t.locale;

  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef(false);
  const finalBufferRef = useRef("");
  const interimRef = useRef("");
  const deliveredRef = useRef(false);

  const setVoiceState = useCallback((next: VoiceState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const stopMeterAndStream = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    setLevels(IDLE_LEVELS);
  }, []);

  const startTimer = useCallback(() => {
    setElapsedSec(0);
    const started = Date.now();
    if (timerRef.current !== null) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - started) / 1000));
    }, 250);
  }, []);

  const attachAudioMeter = useCallback((stream: MediaStream) => {
    try {
      const AudioCtx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      audioCtxRef.current = ctx;
      const data = new Uint8Array(analyser.frequencyBinCount);
      let lastTick = 0;
      const tick = (now: number) => {
        if (!audioCtxRef.current) return;
        if (now - lastTick >= 55) {
          lastTick = now;
          analyser.getByteFrequencyData(data);
          const pick = (i: number) => Math.min(1, Math.max(0.16, (data[i] ?? 0) / 185));
          setLevels([pick(2), pick(5), pick(8), pick(12), pick(16)]);
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      // Visual meter is optional; never fail voice capture because of Web Audio.
    }
  }, []);

  const resolveSpeechLang = useCallback(() => {
    const pref = voiceSettingsRef.current.language;
    if (pref && pref !== "auto") return pref;
    if (localeRef.current === "en") return "en-US";
    if (localeRef.current === "ja") return "ja-JP";
    return "zh-CN";
  }, []);

  const deliverTranscript = useCallback((rawText: string) => {
    const text = rawText.trim();
    if (!text) return false;
    onTranscriptRef.current(text);
    if (voiceSettingsRef.current.autoSend && onAutoSendRef.current) {
      onAutoSendRef.current(text);
    }
    return true;
  }, []);

  const startProviderRecording = useCallback(async () => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError(t("voice.err.unsupported"));
      setVoiceState("idle");
      return;
    }

    cancelledRef.current = false;
    chunksRef.current = [];
    setError("");
    setInterim("");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setError(t("voice.err.permission"));
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setError(t("voice.err.noMic"));
      } else {
        setError(err instanceof Error ? err.message : t("voice.err.permission"));
      }
      setVoiceState("idle");
      return;
    }

    streamRef.current = stream;
    attachAudioMeter(stream);

    const mimeType = pickRecorderMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      recorder = new MediaRecorder(stream);
    }
    recorderRef.current = recorder;

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
    };

    recorder.onstop = () => {
      recorderRef.current = null;
      stopMeterAndStream();
      if (cancelledRef.current) {
        chunksRef.current = [];
        setVoiceState("idle");
        return;
      }
      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || mimeType || "audio/webm",
      });
      chunksRef.current = [];
      if (blob.size < 16) {
        setError(t("voice.err.empty"));
        setVoiceState("idle");
        return;
      }

      setVoiceState("transcribing");
      const params = new URLSearchParams();
      params.set("language", resolveSpeechLang());
      if (voiceSettingsRef.current.providerId) {
        params.set("providerId", voiceSettingsRef.current.providerId);
      }
      if (voiceSettingsRef.current.model) {
        params.set("model", voiceSettingsRef.current.model);
      }

      void (async () => {
        try {
          const response = await fetch(apiPath(`/voice/transcribe?${params.toString()}`), {
            method: "POST",
            headers: { "content-type": blob.type || "audio/webm" },
            body: blob,
            credentials: "same-origin",
          });
          const value = (await response.json()) as VoiceTranscriptionResult & {
            error?: { message?: string; code?: string };
          };
          if (!response.ok) {
            throw new HostError(
              value.error?.message ?? `HTTP ${response.status}`,
              value.error?.code ?? "UNKNOWN",
            );
          }
          if (!deliverTranscript(value.text)) {
            setError(t("voice.err.empty"));
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setVoiceState("idle");
        }
      })();
    };

    recorder.start(250);
    startTimer();
    setVoiceState("recording");
  }, [
    attachAudioMeter,
    deliverTranscript,
    resolveSpeechLang,
    setVoiceState,
    startTimer,
    stopMeterAndStream,
    t,
  ]);

  const startBrowserSpeech = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      void startProviderRecording();
      return;
    }

    cancelledRef.current = false;
    deliveredRef.current = false;
    finalBufferRef.current = "";
    interimRef.current = "";
    setError("");
    setInterim("");

    const recognition = new Ctor();
    recognition.lang = resolveSpeechLang();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    let fellBack = false;

    recognition.onresult = (event) => {
      let finals = "";
      let live = "";
      for (let i = 0; i < event.results.length; i++) {
        const res = event.results[i];
        const part = res?.[0]?.transcript ?? "";
        if (!part) continue;
        if (res?.isFinal) finals += part;
        else live += part;
      }
      finalBufferRef.current = finals.trim();
      interimRef.current = live.trim();
      setInterim([finalBufferRef.current, interimRef.current].filter(Boolean).join(" ").trim());
    };

    recognition.onerror = (event) => {
      const code = event.error;
      if (cancelledRef.current || code === "aborted") return;
      // Electron & offline Chromium emit "network" / "service-not-allowed": transparently fall back to Host provider STT.
      if (
        (code === "network" || code === "service-not-allowed") &&
        voiceSettingsRef.current.engine === "auto"
      ) {
        fellBack = true;
        recognitionRef.current = null;
        stopMeterAndStream();
        setInterim("");
        void startProviderRecording();
        return;
      }
      if (code === "not-allowed") {
        setError(t("voice.err.permission"));
      } else if (code === "audio-capture") {
        setError(t("voice.err.noMic"));
      } else if (code === "no-speech") {
        setError(t("voice.err.empty"));
      } else {
        setError(event.message || t("voice.err.unsupported"));
      }
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      stopMeterAndStream();
      if (fellBack) return;
      const combined = [finalBufferRef.current, interimRef.current]
        .filter(Boolean)
        .join(" ")
        .trim();
      setInterim("");
      if (!cancelledRef.current && !deliveredRef.current && combined) {
        deliveredRef.current = true;
        deliverTranscript(combined);
      }
      setVoiceState("idle");
    };

    try {
      recognition.start();
      startTimer();
      setVoiceState("listening");
      // Optional visual meter via mic stream when supported alongside Web Speech.
      if (navigator.mediaDevices?.getUserMedia) {
        void navigator.mediaDevices
          .getUserMedia({ audio: true })
          .then((stream) => {
            if (stateRef.current !== "listening") {
              for (const track of stream.getTracks()) track.stop();
              return;
            }
            streamRef.current = stream;
            attachAudioMeter(stream);
          })
          .catch(() => {});
      }
    } catch {
      recognitionRef.current = null;
      void startProviderRecording();
    }
  }, [
    attachAudioMeter,
    deliverTranscript,
    resolveSpeechLang,
    setVoiceState,
    startProviderRecording,
    startTimer,
    stopMeterAndStream,
    t,
  ]);

  const stop = useCallback(() => {
    if (stateRef.current === "listening" && recognitionRef.current) {
      const combined = [finalBufferRef.current, interimRef.current]
        .filter(Boolean)
        .join(" ")
        .trim();
      if (combined && !deliveredRef.current) {
        deliveredRef.current = true;
        deliverTranscript(combined);
      }
      try {
        recognitionRef.current.stop();
      } catch {
        recognitionRef.current = null;
        stopMeterAndStream();
        setInterim("");
        setVoiceState("idle");
      }
      return;
    }
    if (stateRef.current === "recording" && recorderRef.current) {
      try {
        recorderRef.current.stop();
      } catch {
        recorderRef.current = null;
        stopMeterAndStream();
        setVoiceState("idle");
      }
    }
  }, [deliverTranscript, setVoiceState, stopMeterAndStream]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setInterim("");
    setError("");
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
      recognitionRef.current = null;
    }
    if (recorderRef.current) {
      try {
        recorderRef.current.stop();
      } catch {}
      recorderRef.current = null;
    }
    stopMeterAndStream();
    setVoiceState("idle");
  }, [setVoiceState, stopMeterAndStream]);

  const toggle = useCallback(() => {
    if (disabled) return;
    if (stateRef.current === "listening" || stateRef.current === "recording") {
      stop();
      return;
    }
    if (stateRef.current === "transcribing") return;

    const mode = voiceSettingsRef.current.engine;
    const hasBrowserSpeech = Boolean(getSpeechRecognitionCtor());
    if (mode === "provider") {
      void startProviderRecording();
    } else if (mode === "browser") {
      if (!hasBrowserSpeech) {
        setError(t("voice.err.unsupported"));
        return;
      }
      startBrowserSpeech();
    } else {
      // "auto": Electron uses Host/Provider transcription reliably; browsers use live Web Speech with auto-fallback.
      if (isElectronRuntime() || !hasBrowserSpeech) {
        void startProviderRecording();
      } else {
        startBrowserSpeech();
      }
    }
  }, [disabled, startBrowserSpeech, startProviderRecording, stop, t]);

  useEffect(() => {
    if (state !== "listening" && state !== "recording") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancel, state]);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
        recognitionRef.current = null;
      }
      if (recorderRef.current) {
        try {
          recorderRef.current.stop();
        } catch {}
        recorderRef.current = null;
      }
      stopMeterAndStream();
    };
  }, [stopMeterAndStream]);

  return {
    state,
    interim,
    elapsedSec,
    levels,
    error,
    clearError: () => setError(""),
    toggle,
    stop,
    cancel,
  };
}
