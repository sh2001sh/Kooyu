import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
const execute = promisify(execFile);
const root = resolve(
  process.env.KOOYU_ANDROID_OUTPUT ?? "output/playwright/marvis-workbench-2026-11-15/android",
);
const temporary = resolve(".local/tmp");
mkdirSync(root, { recursive: true });
mkdirSync(temporary, { recursive: true });
const adb = resolve(process.env.KOOYU_ADB ?? ".local/android-sdk/platform-tools/adb.exe");
const base = process.env.KODO_HOST_URL ?? "http://127.0.0.1:4377";
const uiProbe = true;
const plannedPages = [
  "项目工作",
  "成果与预览",
  "自动计划与时间预览",
  "项目概览",
  "项目约定编辑",
  "执行能力",
  "常用任务草稿",
  "收件箱回答与审批",
  "深色与大字体",
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
  readFileSync(resolve(".local/verification/marvis-workbench-20261115/fixture.json"), "utf8"),
);
const stage = process.argv[2] ?? "pair";
const api = async (path) => {
  const r = await fetch(base + "/api" + path);
  if (!r.ok) throw new Error("Host read failed: " + path);
  return r.json();
};
try {
  if ((await api("/health")).hostId !== fixture.hostId || !fixture.fixture)
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

  if (stage === "template") {
    await capture("14-template-draft", "模板填入草稿");
  }
  if (stage === "interactions") {
    await tap("对话");
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
    await pause(1800);
  }
  if (stage === "work" || stage === "confirm") {
    await tap("工作记录与成果");
    await capture("02-work", "工作记录", "跨端工作台优化验收");
    await tap("全部项目");
    await tap("平台验收演示项目");
    await capture("03-project-work", "项目范围", "跨端工作台优化验收");
    await tap("成果");
    await capture("04-artifacts", "项目成果", "工作台验收说明");
    await tap("工作台验收说明");
    await capture("05-artifact-preview", "原生文件预览", "保存文件");
    await tap("关闭");
  }
  if (stage === "work" || stage === "work-rest" || stage === "confirm") {
    if (stage === "work-rest") {
      await capture("05-artifact-preview", "原生文件预览", "保存文件");
      await tap("关闭");
    }
    await tap("自动计划");
    await capture("06-plans", "自动计划", "项目每日检查");
    await tap("项目每日检查");
    await capture("07-plan-detail", "计划详情", "计划名称");
    await tap("预览接下来执行时间");
    await capture("08-plan-preview", "计划触发预览");
    await tap("关闭");
    await tap("项目概览");
    await capture("09-project-overview", "项目概览", "最近对话");
    // Scroll the horizontal tab strip to expose secondary pages.
    let st = await state();
    const strip = st.nodes.find(
      (n) =>
        n.scrollable === "true" &&
        n.bounds &&
        (() => {
          const b = [...n.bounds.matchAll(/\d+/g)].map((x) => +x[0]);
          return b.length === 4 && b[3] - b[1] < 150 && b[2] - b[0] > 300;
        })(),
    );
    if (strip) {
      const b = [...strip.bounds.matchAll(/\d+/g)].map((x) => +x[0]);
      await device(
        "shell",
        "input",
        "swipe",
        String(b[2] - 30),
        String((b[1] + b[3]) / 2),
        String(b[0] + 25),
        String((b[1] + b[3]) / 2),
        "350",
      );
    }
    await tap("项目约定");
    await capture("10-memory", "项目约定", "交付约定");
    await tap("交付约定");
    await capture("11-memory-editor", "约定编辑", "保存并确认");
    await tap("保存并确认");
    await tap("执行能力");
    await capture("12-capabilities", "真实执行能力");
    await tap("常用任务");
    await capture("13-templates", "常用任务", "检查项目");
    await tap("检查项目");
    await capture("14-template-draft", "模板填入可编辑草稿", "新建对话");
    await tap("关闭");
    if ((await state()).nodes.some((n) => n["content-desc"] === "关闭")) await tap("关闭");
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
  if (stage === "confirm") {
    await tap("工作记录与成果");
    await tap("跨端工作台优化验收");
    await capture("15-goal-review", "工作验收详情");
    for (let i = 0; i < 8; i++) {
      const view = await state();
      if (view.nodes.some((n) => n.text === "接受成果")) break;
      if (!(await scrollDown(view))) break;
    }
    await capture("15b-goal-review-actions", "工作验收操作", "接受成果");
    await tap("接受成果");
    const info = await api("/workbench");
    if (info.goals.find((g) => g.title === "跨端工作台优化验收")?.status !== "completed")
      throw new Error("Goal acceptance not stored");
    await capture("16-goal-accepted", "成果验收完成");
    await tap("成果");
    await tap("返回来源对话");
    await capture("17-source-conversation", "返回来源对话", "项目工作与成果");
    await tap("返回会话列表");
    await tap("设置");
  }
  if (stage === "confirm" || stage === "theme") {
    await tap("通用与外观");
    await tap("深色");
    await tap("关闭");
    await tap("对话");
    await tap("工作记录与成果");
    await capture("18-dark-work", "深色工作记录");
    await tap("关闭");
    await tap("设置");
    await tap("通用与外观");
    await tap("浅色");
    await tap("关闭");
    await tap("对话");
    const fontBefore = (await device("shell", "settings", "get", "system", "font_scale")).trim();
    try {
      await device("shell", "settings", "put", "system", "font_scale", "1.3");
      await pause(1000);
      await tap("工作记录与成果");
      await capture("19-large-font", "大字体工作记录");
      await tap("关闭");
    } finally {
      await device("shell", "settings", "put", "system", "font_scale", fontBefore);
    }
  }
  report.result = "passed";
  report.stage = stage;
} catch (e) {
  report.result = "failed";
  report.errors.push(e.stack);
  console.error(e);
  process.exitCode = 1;
}
report.finishedAt = new Date().toISOString();
writeFileSync(join(root, stage + "-manifest.json"), JSON.stringify(report, null, 2));
