import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
const execute = promisify(execFile);
const root = resolve(
  process.env.KOOYU_ANDROID_OUTPUT ?? "output/playwright/mobile-reasoning-2026-11-15/android",
);
const temporary = resolve(".local/tmp");
mkdirSync(root, { recursive: true });
mkdirSync(temporary, { recursive: true });
const adb = resolve(process.env.KOOYU_ADB ?? ".local/android-sdk/platform-tools/adb.exe");
const base = process.env.KODO_HOST_URL ?? "http://127.0.0.1:4387";
const uiProbe = true;
const plannedPages = ["原生引擎档位保存", "默认恢复", "新建对话", "空档位提示", "窄屏键盘与大字体"];
const report = {
  startedAt: new Date().toISOString(),
  platform: "android-bluestacks",
  result: "unverified",
  plannedPages,
  pages: [],
  errors: [],
  fixture: true,
  modelInference: false,
  uiCapture: uiProbe ? "native-ui-automation-probe" : "uiautomator",
};
let serial = "127.0.0.1:5555";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function command(args, binary = false) {
  const r = await execute(adb, args, {
    env: { ...process.env, TEMP: temporary, TMP: temporary },
    timeout: 30000,
    maxBuffer: 20 * 1024 * 1024,
    encoding: binary ? "buffer" : "utf8",
    windowsHide: true,
  });
  return r.stdout;
}
const device = (...args) => command(["-s", serial, ...args]);
const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
async function state() {
  let xml;
  if (uiProbe) {
    const result = await device(
      "shell",
      "am",
      "instrument",
      "-w",
      "-r",
      "app.kooyu.qaprobe/.UiDumpInstrumentation",
    );
    xml = /KOOYU_UI_XML_BEGIN([\s\S]*?)KOOYU_UI_XML_END/.exec(result)?.[1];
    if (!xml) throw new Error("Native UI probe did not return a fresh accessibility hierarchy");
  } else {
    const dumped = await device("shell", "uiautomator", "dump", "/sdcard/kooyu-qa-window.xml");
    if (!dumped.includes("dumped to:"))
      throw new Error("Android hierarchy capture failed; refusing stale XML: " + dumped.trim());
    xml = await device("exec-out", "cat", "/sdcard/kooyu-qa-window.xml");
  }
  const nodes = [];
  const stack = [];
  for (const token of xml.matchAll(/<node\b([^>]*?)>|<\/node>/g)) {
    if (token[1] === undefined) {
      stack.pop();
      continue;
    }
    const node = Object.fromEntries(
      [...token[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], decode(a[2])]),
    );
    node.children = [];
    if (stack.at(-1)?.enabled === "false") node.enabled = "false";
    stack.at(-1)?.children.push(node);
    nodes.push(node);
    if (!token[1].endsWith("/")) stack.push(node);
  }
  if (nodes.some((n) => /keeps stopping|屡次停止|不断停止/.test(n.text ?? "")))
    throw new Error("Android reports an application crash");
  return { xml, nodes };
}
function bounds(node) {
  const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(node.bounds ?? "");
  if (!b || +b[3] <= +b[1] || +b[4] <= +b[2]) throw new Error("UI element has no visible bounds");
  return [Math.floor((+b[1] + +b[3]) / 2), Math.floor((+b[2] + +b[4]) / 2)];
}
async function scrollDown(snapshot) {
  const panes = snapshot.nodes
    .filter((n) => n.scrollable === "true")
    .map((n) => ({ n, b: [...n.bounds.matchAll(/\d+/g)].map((m) => +m[0]) }))
    .filter(({ b }) => b.length === 4 && b[3] - b[1] > 200);
  panes.sort(
    (a, b) => (b.b[2] - b.b[0]) * (b.b[3] - b.b[1]) - (a.b[2] - a.b[0]) * (a.b[3] - a.b[1]),
  );
  if (!panes.length) return false;
  const [left, top, right, bottom] = panes[0].b;
  const x = Math.floor((left + right) / 2);
  await device(
    "shell",
    "input",
    "swipe",
    String(x),
    String(Math.floor(top + (bottom - top) * 0.8)),
    String(x),
    String(Math.floor(top + (bottom - top) * 0.25)),
    "350",
  );
  await pause(300);
  return true;
}
async function tap(label) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const s = await state();
    const matches = s.nodes.filter(
      (n) => (n.text === label || n["content-desc"] === label) && n.enabled !== "false",
    );
    const n = matches.find((n) => n["content-desc"] === label) ?? matches.at(-1);
    if (n) {
      await device("shell", "input", "tap", ...bounds(n).map(String));
      await pause(500);
      return;
    }
    if (attempt < 4) {
      if (attempt > 0) await scrollDown(s);
      await pause(500);
    }
  }
  throw new Error("Visible Android control not found: " + label);
}
async function waitForText(label, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const snapshot = await state();
    if (snapshot.nodes.some((n) => n.text === label || n["content-desc"] === label))
      return snapshot;
    await pause(1000);
  }
  throw new Error("Expected Android screen content not found: " + label);
}
async function capture(id, label, expected, protectedSurface = false) {
  if (expected) await waitForText(expected);
  await pause(400);
  const s = await state();
  if (!s.nodes.some((n) => n.package === "app.kooyu.android"))
    throw new Error("Kooyu is not the foreground application");
  const png = await command(["-s", serial, "exec-out", "screencap", "-p"], true);
  if (
    protectedSurface &&
    !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    writeFileSync(join(root, id + ".xml"), s.xml);
    const reason =
      "The native scanner sets FLAG_SECURE. ADB returned no usable PNG (" +
      png.length +
      " bytes). Native Activity/accessibility checks passed; screenshot protection was not bypassed.";
    writeFileSync(join(root, id + ".capture.txt"), reason);
    report.protectedPages = [{ id, label, expected, reason }];
    console.log("PROTECTED " + id + " " + reason);
    return;
  }
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    throw new Error("ADB returned an invalid PNG");
  const path = join(root, id + ".png");
  writeFileSync(path, png);
  writeFileSync(join(root, id + ".xml"), s.xml);
  const entry = {
    id,
    label,
    capturedAt: new Date().toISOString(),
    apkSha256: createHash("sha256")
      .update(readFileSync(resolve("apps/android/app/build/outputs/apk/debug/app-debug.apk")))
      .digest("hex"),
    path,
    expected: expected ?? null,
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    sha256: createHash("sha256").update(png).digest("hex"),
  };
  const existing = report.pages.findIndex((p) => p.id === id);
  if (existing === -1) report.pages.push(entry);
  else report.pages[existing] = entry;
  writeFileSync(join(root, "manifest.json"), JSON.stringify(report, null, 2));
  console.log("CAPTURED " + id + " " + label);
}
async function field(label, value) {
  if (!/^[A-Za-z0-9:/.#=_-]+$/.test(value))
    throw new Error("Use ASCII test data without shell metacharacters");
  const containsLabel = (n) =>
    n.text === label || n["content-desc"] === label || n.children.some(containsLabel);
  let input;
  for (let attempt = 0; attempt < 4; attempt++) {
    const snapshot = await state();
    input = snapshot.nodes.find((n) => n.class === "android.widget.EditText" && containsLabel(n));
    if (input || !(await scrollDown(snapshot))) break;
  }
  if (!input) throw new Error("Input not visible: " + label);
  await device("shell", "input", "tap", ...bounds(input).map(String));
  await device("shell", "input", "text", value);
}

const fixture = JSON.parse(
  readFileSync(resolve(".local/verification/mobile-reasoning-20261115/fixture.json"), "utf8"),
);
const api = async (path) => {
  const r = await fetch(base + "/api" + path);
  if (!r.ok) throw new Error("Host read failed: " + path);
  return r.json();
};
const stage = process.argv[2] ?? "pair";
try {
  if ((await api("/health")).hostId !== fixture.hostId || !fixture.fixture)
    throw new Error("Mismatched isolated fixture");
  if (stage === "pair") {
    const installed = await device(
      "install",
      "-r",
      resolve("apps/android/app/build/outputs/apk/debug/app-debug.apk"),
    );
    if (!installed.includes("Success")) throw new Error(installed);
    await device("shell", "am", "force-stop", "app.kooyu.android");
    await device("shell", "am", "start", "-n", "app.kooyu.android/.MainActivity");
    await pause(1700);
    if (!(await state()).nodes.some((n) => n.text === "手动输入连接信息")) {
      await tap("设置");
      await tap("添加另一台电脑");
    }
    await tap("手动输入连接信息");
    const r = await fetch(base + "/api/pairing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const invite = await r.json();
    if (!r.ok) throw new Error("Pairing unavailable");
    const url = new URL(invite.url);
    url.hash = "";
    await field("HTTPS 地址", url.toString());
    await field("配对码", invite.code);
    await tap("完成配对");
    await pause(1500);
    await tap("对话");
    await capture("01-home", "隔离测试项目", "平台验收主对话");
  }
  if (stage === "sessions") {
    if ((await state()).nodes.some((n) => n["content-desc"] === "返回")) await tap("返回");
    report.settings = [];
    for (const item of [...fixture.reasoningCases].reverse()) {
      await tap(item.title);
      await tap("思考强度");
      await waitForText("high");
      await capture(
        "02-" + item.harnessId + "-options",
        item.harnessId + " 声明的思考档位",
        "high",
      );
      await tap("high");
      await pause(700);
      let settings = await api("/sessions/" + item.id + "/settings");
      if (
        settings.session.reasoning !== "high" ||
        !settings.session.model ||
        settings.session.settingsRevision < 1
      )
        throw new Error("Effort not persisted for " + item.harnessId);
      report.settings.push({
        harnessId: item.harnessId,
        model: settings.session.model,
        reasoning: settings.session.reasoning,
        revision: settings.session.settingsRevision,
      });
      await capture("03-" + item.harnessId + "-saved", item.harnessId + " 保存成功", "high");
      await tap("思考强度");
      await tap("默认思考");
      await pause(600);
      settings = await api("/sessions/" + item.id + "/settings");
      if (settings.session.reasoning !== null || settings.session.settingsRevision < 2)
        throw new Error("Default reset not persisted for " + item.harnessId);
      await tap("返回");
    }
  }
  if (stage === "draft") {
    if (!(await state()).nodes.some((n) => n.text === "新建对话")) {
      await tap("新建");
      await tap("Kooyu · 主对话");
      await tap("Codex");
    }
    await tap("思考强度");
    await waitForText("high");
    await capture("04-draft-codex-options", "新建 Codex 对话的思考档位", "high");
    await tap("high");
    await capture("05-draft-codex-configured", "新建对话的模型和强度在输入框上方", "high");
    if ((await state()).nodes.some((n) => n.text === "全局会话")) {
      await tap("全局会话");
      await tap("平台验收演示项目");
    }
    await tap("对话设置");
    await field("对话标题（可选）", "ReasoningDraftCodex");
    await tap("关闭");
    await tap("创建会话");
    await pause(900);
    const snapshot = await api("/snapshot");
    const created = snapshot.sessions.find((x) => x.title === "ReasoningDraftCodex");
    if (
      !created ||
      created.reasoning !== "high" ||
      created.model !== "qa-openai/qa-gpt-5" ||
      created.harnessId !== "codex"
    )
      throw new Error("Draft effort/model not stored together");
    report.created = { id: created.id, model: created.model, reasoning: created.reasoning };
    await capture("06-draft-created", "新建对话保存模型和思考强度", "high");
    await tap("返回");
  }
  if (stage === "empty") {
    await tap("Reasoning codex");
    await tap("思考强度");
    await tap("high");
    await tap("模型配置");
    await tap("No effort metadata");
    await pause(600);
    const item = fixture.reasoningCases.find((x) => x.harnessId === "codex");
    const settings = await api("/sessions/" + item.id + "/settings");
    if (settings.session.model !== "qa-no-effort" || settings.session.reasoning !== null)
      throw new Error("Model switch did not clear unsupported effort");
    await tap("思考强度");
    await capture(
      "07-no-effort",
      "未声明档位时给出说明与刷新入口",
      "当前模型未提供可选思考档位。可刷新选项，或在模型配置中选择支持的模型。",
    );
    if ((await state()).nodes.some((n) => n.text === "high"))
      throw new Error("Unsupported effort leaked from prior model");
    await tap("关闭");
    await tap("模型配置");
    await tap("Codex QA long model name for narrow screens");
    await tap("返回");
  }
  if (stage === "display") {
    await tap("Reasoning codex");
    const size = await device("shell", "wm", "size");
    const density = await device("shell", "wm", "density");
    const font = (await device("shell", "settings", "get", "system", "font_scale")).trim();
    const ime = (
      await device("shell", "settings", "get", "secure", "show_ime_with_hard_keyboard")
    ).trim();
    writeFileSync(
      join(root, "device-before-display.json"),
      JSON.stringify({ size, density, font, ime }, null, 2),
    );
    try {
      await device("shell", "wm", "size", "720x1280");
      await device("shell", "wm", "density", "360");
      await pause(1100);
      await capture("08-narrow-320dp", "320dp 窄屏中两个配置项始终可见", "思考强度");
      await device("shell", "settings", "put", "secure", "show_ime_with_hard_keyboard", "1");
      await field("消息", "KeyboardCheck");
      await pause(600);
      await capture("09-narrow-keyboard", "窄屏键盘弹出后仍可配置", "思考强度");
      await device("shell", "input", "keyevent", "4");
      await tap("思考强度");
      await waitForText("high");
      await capture("10-narrow-options", "窄屏可直接修改思考档位", "high");
      await tap("关闭");
      await device("shell", "settings", "put", "system", "font_scale", "1.3");
      await pause(1000);
      await capture("11-large-font", "窄屏 130% 字体", "思考强度");
    } finally {
      const oldSize = /Override size: (\d+x\d+)/.exec(size)?.[1] ?? "reset";
      const oldDensity = /Override density: (\d+)/.exec(density)?.[1] ?? "reset";
      await device("shell", "wm", "size", oldSize);
      await device("shell", "wm", "density", oldDensity);
      await device("shell", "settings", "put", "system", "font_scale", font);
      if (ime === "null")
        await device("shell", "settings", "delete", "secure", "show_ime_with_hard_keyboard");
      else await device("shell", "settings", "put", "secure", "show_ime_with_hard_keyboard", ime);
      await pause(1000);
    }
    await tap("返回");
    await tap("设置");
    await tap("通用与外观");
    await tap("深色");
    await tap("关闭");
    await tap("对话");
    await tap("Reasoning codex");
    await capture("12-dark", "深色输入框上方的模型与思考强度", "思考强度");
    await tap("返回");
    await tap("设置");
    await tap("通用与外观");
    await tap("浅色");
    await tap("关闭");
    await tap("对话");
  }
  if (stage === "binding") {
    const post = async (path, body) => {
      const r = await fetch(base + "/api" + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(path === "/sessions" ? {} : { requestId: randomUUID() }),
          ...body,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(JSON.stringify(data));
      return data;
    };
    const provider = await post("/providers", {
      name: "Reasoning QA bound provider",
      endpoints: [
        { name: "Isolated", protocol: "openai-responses", baseUrl: "http://127.0.0.1:1/v1" },
      ],
    });
    const model = await post("/provider-models", {
      providerId: provider.id,
      endpointId: provider.endpoints[0].id,
      model: "qa-bound-model",
      overrides: {
        reasoning: true,
        reasoningOptions: [{ type: "effort", values: ["low", "high"] }],
      },
    });
    const binding = await post("/harness-bindings", {
      name: "Reasoning QA binding",
      harnessId: "codex",
      modelId: model.id,
      reasoning: "low",
    });
    const created = await post("/sessions", {
      title: "Reasoning bound codex",
      harnessId: "codex",
      kind: "direct",
      projectId: fixture.projectId,
      workspaceId: fixture.workspaceId,
      bindingId: binding.id,
    });
    await tap("刷新数据");
    await pause(700);
    await tap(created.title);
    await tap("思考强度");
    await waitForText("high");
    await capture("13-bound-options", "Codex 来源绑定声明的思考档位", "high");
    await tap("high");
    await pause(700);
    const settings = await api("/sessions/" + created.id + "/settings");
    if (
      settings.session.reasoning !== "high" ||
      settings.session.model !== "qa-bound-model" ||
      settings.session.bindingId !== binding.id
    )
      throw new Error("Binding/model not preserved when reasoning changed");
    report.binding = {
      model: settings.session.model,
      reasoning: settings.session.reasoning,
      bindingPreserved: true,
    };
    await capture("14-bound-saved", "来源绑定下保存强度且保留绑定", "high");
    await tap("返回");
  }
  if (stage === "confirm") {
    const installed = await device(
      "install",
      "-r",
      resolve("apps/android/app/build/outputs/apk/debug/app-debug.apk"),
    );
    if (!installed.includes("Success")) throw new Error(installed);
    await device("shell", "am", "force-stop", "app.kooyu.android");
    await device("shell", "am", "start", "-n", "app.kooyu.android/.MainActivity");
    await pause(1600);
    await tap("Reasoning codex");
    await tap("思考强度");
    await waitForText("high");
    await tap("high");
    await pause(700);
    const item = fixture.reasoningCases.find((x) => x.harnessId === "codex");
    const saved = await api("/sessions/" + item.id + "/settings");
    if (saved.session.reasoning !== "high" || !saved.session.model)
      throw new Error("Final APK failed effort persistence");
    await capture("15-final-composer", "最终 APK：模型与强度位于输入框上方", "high");
    await tap("思考强度");
    await waitForText("high");
    await capture("16-final-options", "最终 APK：档位与当前选择", "high");
    await tap("关闭");
    const before = JSON.parse(readFileSync(join(root, "device-before-display.json"), "utf8"));
    try {
      await device("shell", "wm", "size", "720x1280");
      await device("shell", "wm", "density", "360");
      await pause(1000);
      await capture("17-final-narrow", "最终 APK：320dp 窄屏", "思考强度");
    } finally {
      await device(
        "shell",
        "wm",
        "size",
        /Override size: (\d+x\d+)/.exec(before.size)?.[1] ?? "reset",
      );
      await device(
        "shell",
        "wm",
        "density",
        /Override density: (\d+)/.exec(before.density)?.[1] ?? "reset",
      );
      await pause(800);
    }
    await tap("返回");
  }
  if (stage === "restore") {
    if (!(await state()).nodes.some((n) => n.text === "选择电脑")) await tap("切换电脑");
    await tap("电脑 3");
    await pause(1000);
    await waitForText("电脑 3");
    report.previousComputerRestored = true;
  }
  if (stage === "dump") {
    const view = await state();
    writeFileSync(join(root, "current.xml"), view.xml);
    console.log(
      view.nodes
        .filter((n) => n.text || n["content-desc"])
        .map((n) => ({
          text: n.text,
          description: n["content-desc"],
          bounds: n.bounds,
          enabled: n.enabled,
        })),
    );
  }
  report.result = "passed";
} catch (e) {
  report.result = "failed";
  report.errors.push(e.stack);
  console.error(e);
  process.exitCode = 1;
}
report.finishedAt = new Date().toISOString();
report.stage = stage;
writeFileSync(join(root, stage + "-manifest.json"), JSON.stringify(report, null, 2));
