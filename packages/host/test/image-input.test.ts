import assert from "node:assert/strict";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { query } from "@anthropic-ai/claude-agent-sdk";
import type { BindingRuntime, Session } from "@kodo/protocol";
import type { AdapterContext, NativeInput, Wire } from "../src/harnesses/adapter.js";
import { codexAdapter } from "../src/harnesses/codex.js";
import { opencodeAdapter } from "../src/harnesses/opencode.js";
import { adapters } from "../src/harnesses/registry.js";
import { claudeAdapterWithQuery, claudeUsesCustomEndpoint } from "../src/harnesses/claude-code.js";
import {
  codexModelOptions,
  openCodeModelAcceptsImages,
  openCodeModelOptions,
  zcodeUserModelOptions,
} from "../src/harnesses/model-options.js";
import { dshNativeModelOptions } from "../src/harnesses/dsh-native.js";
import { stringify } from "yaml";

const peer = (name: string) => fileURLToPath(new URL("./fixtures/" + name, import.meta.url));
const context = (args: string[], env: NodeJS.ProcessEnv): AdapterContext => ({
  cwd: tmpdir(),
  dataDir: tmpdir(),
  env: { ...process.env, ...env },
  launch: { command: process.execPath, args },
  emit: () => {},
  interact: async () => ({}),
});
const image: NonNullable<NativeInput["images"]>[number] = {
  type: "image",
  data: Buffer.from("png-bytes").toString("base64"),
  mimeType: "image/png",
  path: join(tmpdir(), "kooyu-shot.png"),
};
const calls = async (path: string) =>
  (await readFile(path, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Wire);

test("Codex gets localImage input only for models whose inputModalities include image", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kooyu-codex-image-"));
  const log = join(dir, "wire.jsonl");
  const runtime = await codexAdapter.connect(
    { id: randomUUID(), nativeSessionId: null } as Session,
    {
      ...context([peer("native-peer.mjs"), "codex"], { SYNTHETIC_WIRE_LOG: log }),
      model: "model-a",
    },
  );
  try {
    assert.equal(await runtime.supportsImages!("model-a"), true);
    assert.equal(await runtime.supportsImages!("model-b"), false);
    assert.equal(await runtime.supportsImages!("unknown"), false);
    assert.equal(await runtime.supportsImages!(null), true);
    await runtime.send("看图", randomUUID(), "new", undefined, { images: [image] });
    await runtime.send("", randomUUID(), "new", undefined, { images: [image] });
    const starts = (await calls(log)).filter((c) => c.method === "turn/start");
    assert.deepEqual(starts[0]!.params.input, [
      { type: "text", text: "看图" },
      { type: "localImage", path: image.path },
    ]);
    assert.deepEqual(starts[1]!.params.input, [{ type: "localImage", path: image.path }]);
  } finally {
    await runtime.close();
    await rm(dir, { recursive: true, force: true });
  }
});

for (const harness of ["gemini", "cursor", "kimi-code", "grok-build"] as const)
  test(`${harness}: ACP sends images only with protocol capability`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "kooyu-acp-image-"));
    const gemini = adapters.find((a) => a.descriptor.id === harness)!;
    try {
      for (const declared of [true, false]) {
        const log = join(dir, `${declared}.jsonl`);
        const runtime = await gemini.connect(
          { id: randomUUID(), nativeSessionId: null } as Session,
          context([peer("native-peer.mjs"), "acp"], {
            SYNTHETIC_WIRE_LOG: log,
            ...(declared ? { SYNTHETIC_ACP_IMAGE: "1" } : {}),
          }),
        );
        try {
          assert.equal(await runtime.supportsImages!(null), declared);
          if (declared) {
            await runtime.send("描述图片", randomUUID(), "new", undefined, { images: [image] });
            const prompt = (await calls(log)).find((c) => c.method === "session/prompt")!;
            assert.deepEqual(prompt.params.prompt, [
              { type: "text", text: "描述图片" },
              { type: "image", data: image.data, mimeType: "image/png" },
            ]);
          } else
            await assert.rejects(
              runtime.send("x", randomUUID(), "new", undefined, { images: [image] }),
              /未声明图片输入/,
            );
        } finally {
          await runtime.close();
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

test("OpenCode attaches a data-URL file part when /provider declares image input", async () => {
  assert.equal(
    openCodeModelAcceptsImages(
      { all: [{ id: "p", models: { m: { modalities: { input: ["text", "image"] } } } }] },
      { provider: "p", model: "m" },
    ),
    true,
  );
  assert.equal(
    openCodeModelAcceptsImages(
      {
        all: [{ id: "p", models: { m: { capabilities: { input: { image: true } } } } }],
        connected: [],
      },
      { provider: "p", model: "m" },
    ),
    false,
  );
  const dir = await mkdtemp(join(tmpdir(), "kooyu-opencode-image-"));
  const log = join(dir, "wire.jsonl");
  const runtime = await opencodeAdapter.connect(
    { id: randomUUID(), nativeSessionId: null } as Session,
    {
      ...context([peer("opencode-peer.mjs")], { SYNTHETIC_WIRE_LOG: log }),
      model: "provider/model-a",
    },
  );
  try {
    assert.equal(await runtime.supportsImages!("provider/model-a"), true);
    assert.equal(await runtime.supportsImages!("provider/model-b"), false);
    await runtime.send("看看", randomUUID(), "new", undefined, { images: [image] });
    const prompt = (await calls(log)).find((c) => String(c.path).endsWith("/prompt_async"))!;
    assert.deepEqual(prompt.data.parts, [
      { type: "text", text: "看看" },
      {
        type: "file",
        mime: "image/png",
        filename: "kooyu-shot.png",
        url: `data:image/png;base64,${image.data}`,
      },
    ]);
  } finally {
    await runtime.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Claude Code streams an image block unless a custom endpoint makes support unknown", async () => {
  const home = await mkdtemp(join(tmpdir(), "kooyu-claude-image-"));
  const prompts: unknown[] = [];
  const run = ((input: { prompt: unknown }) => {
    prompts.push(input.prompt);
    return (async function* () {
      if (typeof input.prompt !== "string")
        for await (const message of input.prompt as AsyncIterable<unknown>) prompts.push(message);
      yield { type: "result", is_error: false, modelUsage: {} };
    })();
  }) as unknown as typeof query;
  const env = { CLAUDE_CONFIG_DIR: join(home, "config") };
  try {
    assert.equal(claudeUsesCustomEndpoint(env, null), false);
    const runtime = await claudeAdapterWithQuery(run).connect(
      { id: randomUUID(), nativeSessionId: null } as Session,
      {
        cwd: home,
        dataDir: home,
        env,
        launch: { command: "claude-sdk", args: [] },
        emit: () => {},
        interact: async () => ({}),
      },
    );
    try {
      assert.equal(await runtime.supportsImages!(null), true);
      await runtime.send("这张图是什么？", randomUUID(), "new", undefined, { images: [image] });
      const message = prompts[1] as Wire;
      assert.equal(message.type, "user");
      assert.deepEqual(message.message.content, [
        { type: "image", source: { type: "base64", media_type: "image/png", data: image.data } },
        { type: "text", text: "这张图是什么？" },
      ]);
      await runtime.send("纯文本", randomUUID(), "new");
      assert.equal(prompts.at(-1), "纯文本");
    } finally {
      await runtime.close();
    }
    // A relay configured in native settings or the environment makes support unknown.
    await mkdir(join(home, "config"), { recursive: true });
    await writeFile(
      join(home, "config", "settings.json"),
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://relay.example" } }),
    );
    assert.equal(claudeUsesCustomEndpoint(env, null), true);
    assert.equal(claudeUsesCustomEndpoint({ ANTHROPIC_BASE_URL: "https://x.example" }, null), true);
    await writeFile(join(home, "config", "settings.json"), "{broken");
    assert.equal(claudeUsesCustomEndpoint(env, null), true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

const binding = (input: ("text" | "image")[]): BindingRuntime => ({
  id: randomUUID(),
  revision: 1,
  name: "Image test",
  provider: "provider",
  model: "model-a",
  credentialRef: null,
  protocol: "anthropic-messages",
  modelParameters: { input },
  binding: { route: "direct" } as BindingRuntime["binding"],
});

for (const harness of ["gemini", "cursor", "kimi-code", "grok-build"] as const)
  test(`${harness}: ACP checks selected model and frozen binding, and never overrides protocol limits`, async () => {
    const adapter = adapters.find((a) => a.descriptor.id === harness)!;
    for (const scenario of [
      "catalog",
      "text-binding",
      "image-binding",
      "no-capability",
      "gateway",
    ]) {
      const ctx = context(
        [peer("native-peer.mjs"), "acp"],
        scenario === "no-capability" ? {} : { SYNTHETIC_ACP_IMAGE: "1" },
      );
      ctx.modelInput = ({ id }) => (id === "model-a" ? ["text", "image"] : ["text"]);
      if (scenario !== "catalog")
        ctx.configuration = binding(scenario === "text-binding" ? ["text"] : ["text", "image"]);
      if (scenario === "gateway") {
        ctx.configuration!.protocol = "google-generative-ai";
        ctx.configuration!.binding!.route = "gateway";
      }
      const runtime = await adapter.connect(
        { id: randomUUID(), nativeSessionId: null } as Session,
        ctx,
      );
      try {
        const allowed =
          scenario === "catalog" ||
          scenario === "image-binding" ||
          (scenario === "gateway" && harness !== "gemini");
        assert.equal(await runtime.supportsImages!("model-a"), allowed, scenario);
        if (scenario === "catalog") assert.equal(await runtime.supportsImages!("model-b"), false);
        if (!allowed)
          await assert.rejects(
            runtime.send("x", randomUUID(), "new", undefined, { images: [image] }),
            /未声明图片输入/,
          );
      } finally {
        await runtime.close();
      }
    }
  });

test("native model options preserve explicit image and text declarations", () => {
  assert.deepEqual(
    codexModelOptions([{ model: "m", inputModalities: ["text", "image"] }])[0]!.input,
    ["text", "image"],
  );
  const catalog = {
    all: [
      {
        id: "p",
        models: {
          m: {
            capabilities: { input: { image: false } },
            modalities: { input: ["text", "image"] },
          },
        },
      },
    ],
  };
  assert.equal(openCodeModelAcceptsImages(catalog, { provider: "p", model: "m" }), false);
  assert.deepEqual(openCodeModelOptions(catalog)[0]!.input, ["text"]);
  assert.deepEqual(
    dshNativeModelOptions({
      providers: { p: { models: [{ id: "m", input: ["text", "image"] }] } },
      defaultModel: null,
    })[0]!.input,
    ["text", "image"],
  );
  assert.deepEqual(
    zcodeUserModelOptions({
      config: {
        providerConfigRules: {
          providerRules: [{ providerId: "p", config: { personalModelIds: ["m"] } }],
        },
        modelConfigRules: {
          providerModelRules: [
            {
              providerId: "p",
              modelId: "m",
              config: { properties: { inputFormat: { supportsImage: false } } },
            },
          ],
        },
      },
    })[0]!.input,
    ["text"],
  );
});

test("Codex uses catalog fallback for unknown declarations, preserves native text-only, and guards send", async () => {
  const runtime = await codexAdapter.connect(
    { id: randomUUID(), nativeSessionId: null } as Session,
    {
      ...context([peer("native-peer.mjs"), "codex"], {}),
      modelInput: ({ declaredInput }) => declaredInput ?? ["text", "image"],
    },
  );
  try {
    assert.equal(await runtime.supportsImages!("unknown"), true);
    assert.equal(await runtime.supportsImages!("model-b"), false);
    await assert.rejects(
      runtime.send(
        "x",
        randomUUID(),
        "new",
        { model: "model-b", reasoning: null, revision: 0 },
        { images: [image] },
      ),
      /未声明图片输入/,
    );
  } finally {
    await runtime.close();
  }
});

test("OpenCode resolves and pins its native default for image-only input", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kooyu-opencode-default-"));
  const log = join(dir, "wire.jsonl");
  const runtime = await opencodeAdapter.connect(
    { id: randomUUID(), nativeSessionId: null } as Session,
    context([peer("opencode-peer.mjs")], { SYNTHETIC_WIRE_LOG: log }),
  );
  try {
    assert.equal(await runtime.supportsImages!(null), true);
    await runtime.send("", randomUUID(), "new", undefined, { images: [image] });
    const prompt = (await calls(log)).find((c) => String(c.path).endsWith("/prompt_async"))!;
    assert.deepEqual(prompt.data.model, { providerID: "provider", modelID: "model-a" });
    assert.equal(prompt.data.parts[0].type, "file");
    await assert.rejects(
      runtime.send(
        "x",
        randomUUID(),
        "new",
        { model: "provider/model-b", reasoning: null, revision: 0 },
        { images: [image] },
      ),
      /未声明图片输入/,
    );
  } finally {
    await runtime.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("DSH resolves route overrides into its runtime overlay and forwards images across model replacement", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kooyu-dsh-image-"));
  const log = join(dir, "wire.jsonl");
  const profile = join(dir, "profiles", "sdk");
  await mkdir(profile, { recursive: true });
  await writeFile(
    join(profile, "cordis.patch.yml"),
    stringify([
      {
        id: "llm-pi-ai",
        config: {
          providers: {
            provider: {
              api: "openai-completions",
              baseURL: "https://relay.example/v1",
              models: [
                { id: "model-a", input: ["text"] },
                { id: "model-b", input: ["text", "image"] },
                { id: "model-c", input: ["text"] },
              ],
            },
          },
        },
      },
    ]),
  );
  const runtime = await adapters
    .find((a) => a.descriptor.id === "deepseek-harness")!
    .connect({ id: randomUUID(), nativeSessionId: null } as Session, {
      ...context([peer("native-peer.mjs"), "dsh"], { DSH_HOME: dir, SYNTHETIC_WIRE_LOG: log }),
      dataDir: dir,
      configuration: { ...binding(["text"]), binding: undefined },
      modelInput: ({ id, api, baseUrl, declaredInput }) => {
        assert.equal(api, "openai-completions");
        assert.equal(baseUrl, "https://relay.example/v1");
        return id === "model-a" ? ["text", "image"] : declaredInput;
      },
    });
  try {
    assert.equal(await runtime.supportsImages!("provider/model-a"), true);
    assert.equal(await runtime.supportsImages!("provider/model-c"), false);
    assert.deepEqual((await runtime.models!())[0]!.input, ["text", "image"]);
    await runtime.send("", randomUUID(), "new", undefined, { images: [image] });
    await runtime.send(
      "look",
      randomUUID(),
      "new",
      { model: "provider/model-b", reasoning: null, revision: 1 },
      { images: [image] },
    );
    const prompts = (await calls(log)).filter((c) => c.method === "session/prompt");
    assert.deepEqual(prompts[0]!.params.contentBlocks, [
      { type: "image", data: image.data, mimeType: image.mimeType },
    ]);
    assert.equal(prompts[1]!.params.contentBlocks[1].type, "image");
    await assert.rejects(
      runtime.send(
        "x",
        randomUUID(),
        "new",
        { model: "provider/model-c", reasoning: null, revision: 2 },
        { images: [image] },
      ),
      /未声明图片输入/,
    );
  } finally {
    await runtime.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("ZCode uploads images in checked chunks before submitting attachment references", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kooyu-zcode-image-"));
  const log = join(dir, "wire.jsonl");
  const runtime = await adapters
    .find((a) => a.descriptor.id === "zcode")!
    .connect({ id: randomUUID(), hostId: "test", nativeSessionId: null } as Session, {
      ...context([peer("native-peer.mjs"), "zcode"], { SYNTHETIC_WIRE_LOG: log, ZCODE_HOME: dir }),
      modelInput: ({ id }) => (id === "model-a" ? ["text", "image"] : ["text"]),
    });
  try {
    assert.equal(await runtime.supportsImages!(null), true);
    const large = { ...image, data: Buffer.alloc(600 * 1024, 7).toString("base64") };
    await runtime.send("", randomUUID(), "new", undefined, { images: [large] });
    const wire = await calls(log);
    assert.equal(wire.filter((c) => c.method === "v4/attachment/chunk").length, 2);
    const sent = wire.find((c) => c.method === "v4/command" && c.params.type === "sendText")!;
    assert.equal(sent.params.payload.attachments[0].bytes, 600 * 1024);
    assert.match(sent.params.payload.attachments[0].ref, /^attachment:/);
    assert.equal(sent.params.payload.text, "");
    assert.ok(wire.findIndex((c) => c.method === "v4/attachment/commit") < wire.indexOf(sent));
    await assert.rejects(
      runtime.send(
        "x",
        randomUUID(),
        "new",
        { model: "provider/model-b", reasoning: null, revision: 0 },
        { images: [image] },
      ),
      /未声明图片输入/,
    );
  } finally {
    await runtime.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Claude custom endpoint resolves the selected route and respects text-only overrides and gateway limits", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kooyu-claude-route-"));
  const prompts: unknown[] = [];
  const run = ((input: { prompt: unknown }) =>
    (async function* () {
      if (typeof input.prompt !== "string")
        for await (const message of input.prompt as AsyncIterable<unknown>) prompts.push(message);
      yield { type: "result", is_error: false, modelUsage: {} };
    })()) as unknown as typeof query;
  const ctx: AdapterContext = {
    ...context([], { CLAUDE_CONFIG_DIR: dir, ANTHROPIC_BASE_URL: "https://relay.example/v1" }),
    cwd: dir,
    dataDir: dir,
    model: "vision",
    modelInput: ({ baseUrl, api, id }) => {
      assert.equal(baseUrl, "https://relay.example/v1");
      assert.equal(api, "anthropic-messages");
      return id === "vision" ? ["text", "image"] : ["text"];
    },
  };
  const runtime = await claudeAdapterWithQuery(run).connect(
    { id: randomUUID(), nativeSessionId: null } as Session,
    ctx,
  );
  try {
    assert.equal(await runtime.supportsImages!("vision"), true);
    assert.equal(await runtime.supportsImages!("text"), false);
    await runtime.send("", randomUUID(), "new", undefined, { images: [image] });
    assert.equal((prompts[0] as Wire).message.content[0].type, "image");
    await assert.rejects(
      runtime.send(
        "x",
        randomUUID(),
        "new",
        { model: "text", reasoning: null, revision: 0 },
        { images: [image] },
      ),
      /未声明图片输入/,
    );
  } finally {
    await runtime.close();
  }
  ctx.configuration = binding(["text", "image"]);
  ctx.configuration.binding!.route = "gateway";
  const gateway = await claudeAdapterWithQuery(run).connect(
    { id: randomUUID(), nativeSessionId: null } as Session,
    ctx,
  );
  try {
    assert.equal(await gateway.supportsImages!("vision"), false);
    await assert.rejects(
      gateway.send("x", randomUUID(), "new", undefined, { images: [image] }),
      /未声明图片输入/,
    );
  } finally {
    await gateway.close();
    await rm(dir, { recursive: true, force: true });
  }
});
