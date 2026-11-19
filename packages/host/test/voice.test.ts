import assert from "node:assert/strict";
import { test } from "node:test";
import { ProviderService, type ProviderVault } from "../src/providers/service.js";
import { Store } from "../src/storage/store.js";
import {
  audioExtensionForMime,
  getVoiceStatus,
  normalizeTranscriptionUrl,
  normalizeWhisperLanguage,
  transcribeVoice,
} from "../src/voice.js";

function memoryVault(): ProviderVault {
  const map = new Map<string, string>();
  return {
    async get(ref) {
      return map.get(ref) ?? null;
    },
    async set(ref, value) {
      map.set(ref, value);
    },
    async delete(ref) {
      map.delete(ref);
    },
  };
}

test("voice helpers normalize OpenAI-compatible URLs, languages and audio mime types", () => {
  assert.equal(
    normalizeTranscriptionUrl("https://api.openai.com/v1"),
    "https://api.openai.com/v1/audio/transcriptions",
  );
  assert.equal(
    normalizeTranscriptionUrl("https://codegoai.com/v1/responses"),
    "https://codegoai.com/v1/audio/transcriptions",
  );
  assert.equal(
    normalizeTranscriptionUrl("https://proxy.example.com/v1/chat/completions/"),
    "https://proxy.example.com/v1/audio/transcriptions",
  );
  assert.equal(
    normalizeTranscriptionUrl("https://proxy.example.com"),
    "https://proxy.example.com/v1/audio/transcriptions",
  );

  assert.equal(normalizeWhisperLanguage("zh-CN"), "zh");
  assert.equal(normalizeWhisperLanguage("en-US"), "en");
  assert.equal(normalizeWhisperLanguage("ja-JP"), "ja");
  assert.equal(normalizeWhisperLanguage("auto"), undefined);
  assert.equal(normalizeWhisperLanguage("system"), undefined);

  assert.deepEqual(audioExtensionForMime("audio/webm;codecs=opus"), {
    ext: "webm",
    mime: "audio/webm",
  });
  assert.deepEqual(audioExtensionForMime("audio/mp4"), {
    ext: "m4a",
    mime: "audio/mp4",
  });
});

test("getVoiceStatus and transcribeVoice forward multipart audio to configured OpenAI-compatible provider", async () => {
  const store = new Store(":memory:");
  const vault = memoryVault();
  const captured: Array<{
    url: string;
    auth: string | null;
    model: string | null;
    lang: string | null;
    fileName: string | null;
  }> = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers);
    const body = init?.body as FormData;
    const file = body.get("file") as File | null;
    captured.push({
      url,
      auth: headers.get("authorization"),
      model: String(body.get("model") ?? ""),
      lang: body.get("language") ? String(body.get("language")) : null,
      fileName: file?.name ?? null,
    });
    return new Response(JSON.stringify({ text: "帮我重构一下侧边栏布局" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const providers = new ProviderService(store, {
    vault,
    fetcher: mockFetch,
    autoDiscover: false,
  });

  try {
    const emptyStatus = getVoiceStatus(store, providers);
    assert.equal(emptyStatus.providerAvailable, false);
    await assert.rejects(
      () => transcribeVoice(store, providers, { audio: Buffer.from("fake-audio") }),
      /OpenAI 兼容模型来源/,
    );

    await providers.saveProvider({
      name: "codego",
      endpoints: [
        {
          name: "OpenAI Responses",
          protocol: "openai-responses",
          baseUrl: "https://codegoai.com/v1",
          apiKey: "sk-voice-secret",
        },
      ],
    });

    const readyStatus = getVoiceStatus(store, providers);
    assert.equal(readyStatus.providerAvailable, true);
    assert.equal(readyStatus.providers.length, 1);
    assert.equal(readyStatus.providers[0]!.providerName, "codego");

    const result = await transcribeVoice(store, providers, {
      audio: Buffer.from("webm-audio-bytes"),
      mimeType: "audio/webm;codecs=opus",
      language: "zh-CN",
      model: "gpt-4o-mini-transcribe",
    });

    assert.equal(result.text, "帮我重构一下侧边栏布局");
    assert.equal(result.providerName, "codego");
    assert.equal(result.model, "gpt-4o-mini-transcribe");
    assert.equal(captured.length, 1);
    assert.equal(captured[0]!.url, "https://codegoai.com/v1/audio/transcriptions");
    assert.equal(captured[0]!.auth, "Bearer sk-voice-secret");
    assert.equal(captured[0]!.model, "gpt-4o-mini-transcribe");
    assert.equal(captured[0]!.lang, "zh");
    assert.equal(captured[0]!.fileName, "voice.webm");
  } finally {
    await providers.close();
    store.close();
  }
});
