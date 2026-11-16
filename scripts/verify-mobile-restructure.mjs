import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
const execute = promisify(execFile);
const root = resolve(
  process.env.KOOYU_ANDROID_OUTPUT ?? "output/playwright/mobile-restructure-2026-11-15/android",
);
const temporary = resolve(".local/tmp");
mkdirSync(root, { recursive: true });
mkdirSync(temporary, { recursive: true });
const adb = resolve(process.env.KOOYU_ADB ?? ".local/android-sdk/platform-tools/adb.exe");
const base = process.env.KODO_HOST_URL ?? "http://127.0.0.1:4367";
const uiProbe = true;
const plannedPages = [
  "项目分组首页",
  "桌面式输入框与配置",
  "电脑目录选择与新建项目",
  "用量",
  "模型来源、绑定、引擎默认配置",
  "远程连接与二级设置",
  "收件箱与问题回答",
  "权限审批",
  "平板与大字体",
  "队列编辑、撤回与自动排队",
  "键盘展开输入框",
];
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
    if (attempt < 4) await pause(500);
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

const previousManifest = join(root, "manifest.json");
if (existsSync(previousManifest)) {
  const previous = JSON.parse(readFileSync(previousManifest, "utf8"));
  Object.assign(report, previous, { plannedPages, result: "unverified", errors: [] });
}
report.stageHistory ??= [];

const fixture = JSON.parse(
  readFileSync(resolve(".local/verification/mobile-restructure-20261115/fixture.json"), "utf8"),
);
const stage = process.argv[2] ?? "pair";
const back = async () => {
  await device("shell", "input", "keyevent", "4");
  await pause(400);
};
const api = async (path) => {
  const r = await fetch(base + "/api" + path);
  if (!r.ok) throw new Error("Host read failed: " + path);
  return r.json();
};
try {
  if ((await api("/health")).hostId !== fixture.hostId || fixture.fixture !== true)
    throw new Error("Mismatched QA fixture");
  if (stage === "pair" || stage === "pair-continue") {
    if (stage === "pair") {
      const install = await device(
        "install",
        "-r",
        resolve("apps/android/app/build/outputs/apk/debug/app-debug.apk"),
      );
      if (!install.includes("Success")) throw new Error(install);
      await device("shell", "am", "force-stop", "app.kooyu.android");
      await device("shell", "am", "start", "-n", "app.kooyu.android/.MainActivity");
      await pause(1500);
      let s = await state();
      if (!s.nodes.some((n) => n.text === "手动输入连接信息")) {
        await tap("设置");
        await tap("添加另一台电脑");
      }
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
    await capture("01-project-home", "按项目组织的首页", "平台验收主对话");
  }
  if (stage === "home") {
    await tap("对话");
    await capture("01-project-home", "按项目组织的首页", "平台验收主对话");
  }
  if (stage === "draft") {
    await tap("新建对话");
    await capture("02-draft-composer", "欢迎页与桌面式输入框", "今天想做些什么？");
    await tap("Kooyu · 主对话");
    await capture("03-harness-picker", "引擎选择");
    await back();
    await tap("默认工具");
    await capture("04-permission-picker", "工具权限选择");
    await back();
    await tap("gpt-5");
    await capture("05-model-picker", "模型来源与模型选择");
    await back();
    await tap("对话设置");
    await capture("06-draft-context", "对话二级设置");
    await tap("浏览电脑目录…");
    await capture("07-computer-directory", "远程电脑目录选择", "选择此目录");
    await tap("选择此目录");
    await tap("关闭");
    await tap("关闭");
  }
  if (stage === "projects") {
    await tap("管理项目");
    await capture("08-project-management", "项目管理");
    await tap("新建项目");
    await capture("09-project-create", "新建项目");
    await tap("选择电脑目录");
    await capture("10-project-directory", "通过目录选择新建项目", "选择此目录");
    await tap("选择此目录");
    await tap("保存");
    await pause(1200);
    await capture("11-project-created", "已选择目录并建立项目");
    await tap("关闭");
  }
  if (stage === "configuration") {
    await tap("用量");
    await capture("12-usage", "用量一级页");
    await tap("模型来源");
    await capture("13-model-sources", "模型来源一级页");
    await tap("管理内容");
    await tap("引擎绑定");
    await capture("14-bindings", "各引擎的来源和模型绑定");
    await tap("管理内容");
    await tap("默认配置");
    await capture("15-harness-defaults", "按引擎配置默认来源");
    await tap("设置");
    await capture("16-settings-connections", "设置一级显示远程连接", "远程连接");
    await tap("执行引擎");
    await capture("17-engine-settings", "执行引擎二级页");
    await tap("关闭");
    await tap("通用与外观");
    await capture("18-general-settings", "通用与外观二级页");
    await tap("深色");
    await tap("关闭");
    await tap("对话");
    await tap("新建对话");
    await capture("19-dark-composer", "深色输入界面");
    await tap("关闭");
    await tap("设置");
    await tap("通用与外观");
    await tap("浅色");
    await tap("关闭");
    await tap("对话");
  }
  if (stage === "interactions") {
    await tap("收件箱");
    await capture("20-inbox", "右上角收件箱", "收件箱");
    await tap("Android 与桌面互通验收");
    await capture("21-question-and-queue", "收件箱跳转对话：问题与队列", "首页应该如何组织？");
    await tap("编辑");
    await capture("22-queue-edit", "编辑排队消息");
    await tap("取消");
    await tap("按项目分组");
    await tap("提交回答");
    await pause(1300);
    const log = JSON.parse(readFileSync(join(fixture.dataDir, "answers.json"), "utf8"));
    if (
      log.find((x) => x.label === "codex-question")?.answer?.answers?.navigation?.answers?.[0] !==
      "按项目分组"
    )
      throw new Error("Question answer did not reach Host");
    report.questionSubmitted = true;
    await tap("返回会话列表");
    await tap("收件箱");
    await tap("平台验收主对话");
    await capture("23-project-approval", "主对话的项目创建审批", "允许本次");
    await tap("允许本次");
    await capture("24-approval-confirmation", "审批确认弹层");
    await tap("允许本次");
    await pause(1000);
    const answers = JSON.parse(readFileSync(join(fixture.dataDir, "answers.json"), "utf8"));
    if (answers.find((x) => x.label === "project-approval")?.answer?.decision !== "accept")
      throw new Error("Approval answer did not reach Host");
    report.approvalSubmitted = true;
    await tap("返回会话列表");
  }
  if (stage === "queue-keyboard") {
    if ((await state()).nodes.some((n) => n["content-desc"] === "返回会话列表"))
      await tap("返回会话列表");
    await tap("对话");
    await tap("Android 与桌面互通验收");
    const sessionId = "77cef2a2-6ddb-4736-81b8-2186e49c4030";
    const before = await api("/sessions/" + sessionId);
    const pending = before.commands.find((c) => c.kind === "send" && c.status === "accepted");
    if (!pending) throw new Error("Missing initial queued command");
    await tap("编辑");
    const input = (await state()).nodes.find((n) => n.class === "android.widget.EditText");
    await device("shell", "input", "tap", ...bounds(input).map(String));
    await device("shell", "input", "keyevent", "123");
    await device("shell", "input", "text", "-ui-edited");
    await tap("保存");
    await pause(1000);
    const edited = (await api("/sessions/" + sessionId)).commands.find((c) => c.id === pending.id);
    if (
      !edited.body.text.endsWith("-ui-edited") ||
      edited.body.pendingRevision !== (pending.body.pendingRevision ?? 0) + 1
    )
      throw new Error("Queue edit was not persisted with next revision");
    report.queueEdited = true;
    await capture("28-queue-edited", "排队消息已保存编辑");
    await tap("撤回");
    await pause(1000);
    if (
      (await api("/sessions/" + sessionId)).commands.find((c) => c.id === pending.id)?.status ===
      "accepted"
    )
      throw new Error("Queue withdrawal was not persisted");
    report.queueWithdrawn = true;
    const ime = (
      await device("shell", "settings", "get", "secure", "show_ime_with_hard_keyboard")
    ).trim();
    try {
      await device("shell", "settings", "put", "secure", "show_ime_with_hard_keyboard", "1");
      await field("消息", "automatic-queue-ui-check");
      await pause(1000);
      const keyboard = await device("shell", "dumpsys", "input_method");
      if (!/mInputShown=true|isInputViewShown=true/.test(keyboard))
        throw new Error("Soft keyboard is not shown");
      await capture("29-keyboard-composer", "键盘展开时的对话输入框", "发送消息");
      report.keyboardShown = true;
      await back();
      await tap("发送消息");
      await pause(1200);
      const sent = (await api("/sessions/" + sessionId)).commands.find(
        (c) => c.body.text === "automatic-queue-ui-check",
      );
      if (sent?.body.mode !== "queue" || sent.status !== "accepted")
        throw new Error("Running conversation did not automatically queue");
      report.automaticQueueSubmitted = true;
      await capture("30-automatic-queue", "运行中发送自动排队");
      await tap("撤回");
      await pause(800);
    } finally {
      await device(
        "shell",
        "settings",
        "put",
        "secure",
        "show_ime_with_hard_keyboard",
        ime === "null" ? "0" : ime,
      );
    }
    await tap("返回会话列表");
  }
  if (stage === "grant-settings") {
    report.plannedPages = ["设置一级页", "会话托管", "移除项目授权表单后的页面底部"];
    await tap("设置");
    await capture("01-settings", "项目授权移出设置后的一级页", "远程连接");
    for (let i = 0; i < 6; i++) {
      const snapshot = await state();
      if (snapshot.nodes.some((n) => n.text === "会话托管")) break;
      if (!(await scrollDown(snapshot))) throw new Error("Supervision entry is not reachable");
    }
    await tap("会话托管");
    await capture("02-session-supervision", "会话托管与按需授权说明", "当前托管");
    let previous = "";
    let reachedEnd = false;
    for (let i = 0; i < 12; i++) {
      const snapshot = await state();
      if (snapshot.nodes.some((n) => /提交项目授权|授权能力|授权项目/.test(n.text ?? "")))
        throw new Error("Project grant configuration still exists");
      const content = snapshot.nodes.map((n) => [n.text, n.bounds].join(":")).join("|");
      if (content === previous || !(await scrollDown(snapshot))) {
        reachedEnd = true;
        break;
      }
      previous = content;
    }
    if (!reachedEnd) throw new Error("Did not reach the end of supervision settings");
    await capture("03-supervision-bottom", "托管页面底部已移除项目授权表单");
    report.projectGrantSettingsRemoved = true;
    await tap("关闭");
    await device("shell", "input", "swipe", "540", "350", "540", "1400", "400");
    await waitForText("远程连接");
    report.supervisionCloseReturnsToSettings = true;
    await tap("对话");
  }
  if (stage === "tablet") {
    const originalScale = (await device("shell", "settings", "get", "system", "font_scale")).trim();
    try {
      await device("shell", "wm", "size", "1600x1200");
      await device("shell", "wm", "density", "160");
      await pause(1200);
      await capture("25-tablet-home", "平板侧栏与主内容分栏");
      await tap("新建对话");
      await capture("26-tablet-composer", "平板输入框");
      await tap("关闭");
      await device("shell", "wm", "size", "reset");
      await device("shell", "wm", "density", "reset");
      await pause(1000);
      const scale = (await device("shell", "settings", "get", "system", "font_scale")).trim();
      await device("shell", "settings", "put", "system", "font_scale", "1.3");
      await pause(1000);
      await tap("新建对话");
      await capture("27-large-font-composer", "大字体输入框");
      await tap("关闭");
      await device(
        "shell",
        "settings",
        "put",
        "system",
        "font_scale",
        scale === "null" ? "1.0" : scale,
      );
    } finally {
      await device("shell", "wm", "size", "reset");
      await device("shell", "wm", "density", "reset");
      await device(
        "shell",
        "settings",
        "put",
        "system",
        "font_scale",
        originalScale === "null" ? "1.0" : originalScale,
      );
    }
  }
  const answers = JSON.parse(readFileSync(join(fixture.dataDir, "answers.json"), "utf8"));
  report.questionSubmitted = answers.some(
    (x) =>
      x.label === "codex-question" && x.answer?.answers?.navigation?.answers?.[0] === "按项目分组",
  );
  report.approvalSubmitted = answers.some(
    (x) => x.label === "project-approval" && x.answer?.decision === "accept",
  );
  report.stageHistory.push({ stage, result: "passed", finishedAt: new Date().toISOString() });
  report.completedStage = stage;
  report.result = "passed";
  report.finishedAt = new Date().toISOString();
  report.apkSha256 = createHash("sha256")
    .update(readFileSync(resolve("apps/android/app/build/outputs/apk/debug/app-debug.apk")))
    .digest("hex");
} catch (e) {
  report.stageHistory.push({ stage, result: "failed", finishedAt: new Date().toISOString() });
  report.result = "failed";
  report.errors.push(String(e.stack ?? e));
  writeFileSync(join(root, "failure-ui.xml"), (await state()).xml);
  process.exitCode = 1;
  console.error(String(e));
} finally {
  writeFileSync(join(root, "manifest.json"), JSON.stringify(report, null, 2));
}
