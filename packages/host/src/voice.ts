import { KodoError, type VoiceStatus, type VoiceTranscriptionResult } from "@kodo/protocol";
import { appSettings } from "./configuration/preferences.js";
import type { ProviderService } from "./providers/service.js";
import type { Store } from "./storage/store.js";

export const MAX_VOICE_BYTES = 20 * 1024 * 1024;
const TRANSCRIBE_TIMEOUT_MS = 45_000;

/**
 * Normalize any OpenAI-compatible baseUrl (e.g. `https://api.openai.com/v1`,
 * `https://proxy.example.com/v1/responses`, `https://proxy.example.com`)
 * into its `/audio/transcriptions` endpoint URL.
 */
export function normalizeTranscriptionUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new KodoError("INVALID_INPUT", `无效的语音转写接口地址：${baseUrl}`);
  }
  const cleanPath = parsed.pathname
    .replace(/\/+$/, "")
    .replace(/\/(chat\/completions|responses|audio\/transcriptions)$/i, "");
  parsed.pathname =
    !cleanPath || cleanPath === "/"
      ? "/v1/audio/transcriptions"
      : `${cleanPath}/audio/transcriptions`;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

/** OpenAI Whisper / Transcriptions API expects ISO-639-1 2-letter codes ("zh", "en", "ja"). */
export function normalizeWhisperLanguage(language?: string | null): string | undefined {
  const raw = (language ?? "").trim().toLowerCase();
  if (!raw || raw === "auto" || raw === "system") return undefined;
  const primary = raw.split(/[-_]/)[0];
  return primary && /^[a-z]{2,3}$/.test(primary) ? primary : undefined;
}

export function audioExtensionForMime(mimeType?: string | null): {
  ext: string;
  mime: string;
} {
  const clean = (mimeType ?? "audio/webm").split(";")[0]!.trim().toLowerCase();
  switch (clean) {
    case "audio/mp4":
    case "audio/m4a":
    case "audio/x-m4a":
    case "video/mp4":
      return { ext: "m4a", mime: "audio/mp4" };
    case "audio/mpeg":
    case "audio/mp3":
      return { ext: "mp3", mime: "audio/mpeg" };
    case "audio/ogg":
    case "audio/opus":
      return { ext: "ogg", mime: "audio/ogg" };
    case "audio/wav":
    case "audio/wave":
    case "audio/x-wav":
      return { ext: "wav", mime: "audio/wav" };
    case "audio/flac":
      return { ext: "flac", mime: "audio/flac" };
    case "audio/webm":
    case "video/webm":
    default:
      return { ext: "webm", mime: "audio/webm" };
  }
}

export function getVoiceStatus(store: Store, providers: ProviderService): VoiceStatus {
  const settings = appSettings(store);
  const voice = settings.voice;
  const available = providers.listVoiceProviders();
  const matched = voice.providerId
    ? (available.find((p) => p.providerId === voice.providerId) ?? available[0])
    : available[0];
  return {
    providerAvailable: Boolean(matched),
    providers: available,
    configuredProviderId: voice.providerId,
    activeProviderId: matched?.providerId ?? null,
    model: voice.model || "whisper-1",
    engine: voice.engine,
    language: voice.language,
    autoSend: voice.autoSend,
  };
}

export async function transcribeVoice(
  store: Store,
  providers: ProviderService,
  input: {
    audio: Buffer;
    mimeType?: string;
    language?: string;
    providerId?: string;
    model?: string;
    prompt?: string;
  },
): Promise<VoiceTranscriptionResult> {
  if (!input.audio || input.audio.length === 0) {
    throw new KodoError("INVALID_INPUT", "未收到有效的音频数据。");
  }
  if (input.audio.length > MAX_VOICE_BYTES) {
    throw new KodoError("INVALID_INPUT", "语音文件超过 20 MB 限制，请缩短录音时长。");
  }
  const settings = appSettings(store);
  const voice = settings.voice;
  const endpoint = await providers.resolveVoiceEndpoint(input.providerId ?? voice.providerId);
  if (!endpoint) {
    throw new KodoError(
      "UNAVAILABLE",
      "尚未配置可用的 OpenAI 兼容模型来源。请先在「设置 → 模型来源」添加支持 /audio/transcriptions 的来源，或在浏览器中使用系统语音。",
    );
  }
  const model = (input.model ?? voice.model ?? "whisper-1").trim() || "whisper-1";
  const url = normalizeTranscriptionUrl(endpoint.baseUrl);
  const { ext, mime } = audioExtensionForMime(input.mimeType);

  const resolvedLanguage = normalizeWhisperLanguage(
    input.language && input.language !== "auto"
      ? input.language
      : voice.language !== "auto"
        ? voice.language
        : settings.language !== "system"
          ? settings.language
          : undefined,
  );

  const form = new FormData();
  const bytes = new Uint8Array(input.audio.byteLength);
  bytes.set(input.audio);
  form.append("file", new Blob([bytes], { type: mime }), `voice.${ext}`);
  form.append("model", model);
  form.append("response_format", "json");
  if (resolvedLanguage) form.append("language", resolvedLanguage);
  if (input.prompt?.trim()) form.append("prompt", input.prompt.trim().slice(0, 400));

  const headers: Record<string, string> = {};
  if (endpoint.apiKey) headers["authorization"] = `Bearer ${endpoint.apiKey}`;

  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS);
  try {
    const fetcher = providers.getFetcher();
    const res = await fetcher(url, {
      method: "POST",
      headers,
      body: form,
      signal: controller.signal,
    });
    const raw = await res.text();
    if (!res.ok) {
      let detail = raw.slice(0, 240).trim();
      try {
        const parsed = JSON.parse(raw) as { error?: { message?: string }; message?: string };
        detail = parsed.error?.message ?? parsed.message ?? detail;
      } catch {}
      throw new KodoError(
        "UNAVAILABLE",
        `语音转写失败（${endpoint.providerName} · HTTP ${res.status}）：${detail || "接口返回错误"}`,
      );
    }
    let text = "";
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json") || raw.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(raw) as { text?: string; transcript?: string };
        text = (parsed.text ?? parsed.transcript ?? "").trim();
      } catch {
        text = raw.trim();
      }
    } else {
      text = raw.trim();
    }
    return {
      text,
      providerId: endpoint.providerId,
      providerName: endpoint.providerName,
      model,
      durationMs: Math.max(1, Date.now() - startedAt),
    };
  } catch (err) {
    if (err instanceof KodoError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new KodoError("UNAVAILABLE", "语音转写超时，请检查网络连接或模型来源设置。");
    }
    throw new KodoError(
      "UNAVAILABLE",
      `语音转写请求失败：${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}
