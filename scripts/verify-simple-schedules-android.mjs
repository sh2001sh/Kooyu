import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
const execute = promisify(execFile);
const root = resolve(
  process.env.KOOYU_ANDROID_OUTPUT ?? "output/playwright/simple-schedules-2026-11-16/android",
);
const temporary = resolve(".local/tmp");
mkdirSync(root, { recursive: true });
mkdirSync(temporary, { recursive: true });
const adb = resolve(process.env.KOOYU_ADB ?? ".local/android-sdk/platform-tools/adb.exe");
const apk = resolve(
  process.env.KOOYU_QA_APK ??
    "output/playwright/simple-schedules-2026-11-16/kooyu-schedule-debug.apk",
);
const base = process.env.KODO_HOST_URL ?? "http://127.0.0.1:4407";
const uiProbe = true;
const plannedPages = [
  "任务列表",
  "频率与时间",
  "日期与时间选择器",
  "固定间隔与预览",
  "对话审批",
  "保存和暂停",
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
async function enableDeadline() {
  await scrollDown(await state());
  const snapshot = await state();
  const label = snapshot.nodes.find((n) => n.text === "设置截止时间");
  if (!label) throw Error("Deadline switch label missing");
  const containsLabel = (n) => n.text === "设置截止时间" || n.children.some(containsLabel);
  const toggle = snapshot.nodes.find((n) => n.clickable === "true" && containsLabel(n));
  if (!toggle) throw Error("Deadline switch missing");
  if (toggle.checked !== "true") {
    await device("shell", "input", "tap", ...bounds(toggle).map(String));
    await pause(500);
  }
  await scrollDown(await state());
}
async function capture(id, label, expected, protectedSurface = false) {
  if (expected) await waitForText(expected);
  const apkSha256 = createHash("sha256").update(readFileSync(apk)).digest("hex");
  const packagePath = (await device("shell", "pm", "path", "app.kooyu.android"))
    .trim()
    .replace(/^package:/, "");
  if (!/^\/data\/app\/[A-Za-z0-9_.~+/=-]+\/base\.apk$/.test(packagePath))
    throw Error("Unexpected installed APK path");
  const installedSha256 = (await device("shell", "sha256sum", packagePath)).split(/\s/)[0];
  if (installedSha256 !== apkSha256)
    throw Error("Installed APK changed; do not mix screenshot and package evidence");
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
    apkSha256,
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
  readFileSync(".local/verification/simple-schedules-20261116/fixture.json", "utf8"),
);
const stage = process.argv[2] ?? "dump";
const api = async (path) => {
  const r = await fetch(base + "/api" + path);
  if (!r.ok) throw Error(path + ":" + r.status);
  return r.json();
};
try {
  if (stage === "tap") await tap(process.argv[3]);
  if (stage === "scroll") await scrollDown(await state());
  if (stage === "controls") {
    await tap("设置");
    await tap("点击切换其它设备");
    const devices = await waitForText("已保存设备");
    const add = devices.nodes.find((n) => n.text === "添加设备");
    const heading = devices.nodes.find((n) => n.text === "已保存设备");
    if (!add || !heading || bounds(add)[1] >= bounds(heading)[1])
      throw Error("Add device action is not above the list");
    await capture("13-devices-add-first", "添加设备置于列表顶部", "添加设备");
    await tap("关闭");
    await tap("托管管理");
    const limits = await state();
    if (
      limits.nodes.filter((n) => n.class === "android.widget.EditText" && n.text === "0").length !==
      3
    )
      throw Error("All three supervision limits must default to zero");
    await capture("14-zero-limits", "托管默认 0 不限制", "0 表示不限制；留空保存时按 0 处理。");
    await enableDeadline();
    const date = (await state()).nodes.find((n) => n.text?.startsWith("截止日期："));
    if (!date) throw Error("Deadline date selection missing");
    await tap(date.text);
    await capture("15-deadline-calendar", "截止日期选择器");
    await tap("取消");
    const time = (await state()).nodes.find((n) => n.text?.startsWith("截止时间："));
    if (!time) throw Error("Deadline time selection missing");
    await tap(time.text);
    await capture("16-deadline-clock", "截止时间选择器");
    await tap("取消");
    await tap("关闭");
    await tap("对话");
  }
  if (stage === "deadline-rest") {
    await enableDeadline();
    const date = (await state()).nodes.find((n) => n.text?.startsWith("截止日期："));
    if (!date) throw Error("Deadline date selection missing");
    await tap(date.text);
    await capture("15-deadline-calendar", "截止日期选择器");
    await tap("取消");
    const time = (await state()).nodes.find((n) => n.text?.startsWith("截止时间："));
    if (!time) throw Error("Deadline time selection missing");
    await tap(time.text);
    await capture("16-deadline-clock", "截止时间选择器");
    await tap("取消");
    await tap("关闭");
    await tap("对话");
  }
  if (stage === "evidence-rest") {
    await capture(
      "08-conversation-created",
      "手机审批后创建任务",
      "已创建定时任务「对话创建的每日检查」，每天 09:00（Asia/Shanghai）。隔离测试任务保持暂停。",
    );
    await tap("返回");
    await tap("工作记录与成果");
    await tap("自动计划");
    await capture("12-paused", "手机暂停定时任务", "已暂停 · Asia/Shanghai · 每隔 2 小时");
    if ((await api("/automations")).some((plan) => plan.enabled))
      throw Error("Fixture tasks must remain paused");
    await tap("关闭");
    await tap("切换设备");
    await tap("设备 3");
  }
  if (stage === "evidence") {
    await tap("切换设备");
    await tap("设备 6");
    await waitForText("定时任务对话验收");
    await tap("定时任务对话验收");
    await capture(
      "08-conversation-created",
      "手机审批后创建任务",
      "已创建定时任务「对话创建的每日检查」，每天 09:00（Asia/Shanghai）。隔离测试任务保持暂停。",
    );
    await tap("返回");
    await tap("工作记录与成果");
    await tap("自动计划");
    await capture("12-paused", "手机暂停定时任务", "已暂停 · Asia/Shanghai · 每隔 2 小时");
    await tap("关闭");
    await tap("切换设备");
    await tap("设备 3");
  }
  if (stage === "approve") {
    await tap("定时任务对话验收");
    await capture("07-conversation-approval", "手机审批对话创建的定时任务", "允许本次");
    await tap("允许本次");
    await tap("允许本次");
    await pause(1200);
    const plans = await api("/automations");
    if (
      !plans.some(
        (p) => p.name === "对话创建的每日检查" && p.trigger.kind === "calendar" && !p.enabled,
      )
    )
      throw Error("Conversation plan missing");
    await capture("08-conversation-created", "手机审批后创建任务");
    await tap("返回");
  }
  if (stage === "work-open") {
    await tap("工作记录与成果");
    await tap("自动计划");
    await capture("01-plans", "定时任务列表", "项目每日检查");
    await tap("项目每日检查");
    await capture("02-editor", "时间选择编辑器", "执行频率");
  }
  if ((await api("/health")).hostId !== fixture.hostId) throw Error("Wrong Host");
  if (stage === "pair") {
    await tap("手动输入连接信息");
    const r = await fetch(base + "/api/pairing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const invite = await r.json();
    if (!r.ok) throw Error("Pairing failed");
    const url = new URL(invite.url);
    url.hash = "";
    await field("HTTPS 地址", url.toString());
    await field("配对码", invite.code);
    await tap("完成配对");
    await pause(2000);
    await tap("对话");
    await waitForText("平台验收主对话");
  }
  if (stage === "open") {
    await tap("自动计划");
    await capture("01-plans", "定时任务列表", "项目每日检查");
    await tap("项目每日检查");
    await capture("02-editor", "时间选择编辑器", "执行频率");
  }
  if (stage === "time") {
    await tap("执行时间：09:00");
    await capture("03-time-picker", "Android 原生时间选择器");
  }
  if (stage === "time-setup") {
    await tap("每隔一段时间");
    await capture("04-frequency-menu", "执行频率选项");
    await tap("周一至周五");
    await tap("执行时间：09:00");
    await capture("03-time-picker", "Android 原生时间选择器");
  }
  if (stage === "modes") {
    await tap("取消");
    await tap("周一至周五");
    await capture("04-frequency-menu", "执行频率选项");
    await tap("只执行一次");
    await tap("执行日期：" + new Date().toLocaleDateString("sv-SE"));
    await capture("05-date-picker", "Android 原生日期选择器");
  }
  if (stage === "interval") {
    await tap("取消");
    await tap("只执行一次");
    await tap("每隔一段时间");
    await capture("06-interval", "固定间隔设置", "每隔");
  }
  if (stage === "save-interval") {
    await tap("关闭");
    await tap("刷新");
    await pause(900);
    await tap("项目每日检查");
    const snapshot = await state();
    const contains = (n) => n.text === "每隔" || n.children.some(contains);
    const input = snapshot.nodes.find((n) => n.class === "android.widget.EditText" && contains(n));
    if (!input) throw Error("Interval input missing");
    await device("shell", "input", "tap", ...bounds(input).map(String));
    await device("shell", "input", "keyevent", "123", ...Array(20).fill("67"));
    await device("shell", "input", "text", "2");
    await tap("分钟");
    await tap("小时");
    await capture("09-edited-interval", "每隔两小时执行", "每隔");
    await tap("预览接下来执行时间");
    await capture("10-interval-preview", "手机预览执行时间");
    await tap("保存并启用");
    await pause(700);
    const plans = await api("/automations");
    const plan = plans.find((p) => p.name === "项目每日检查");
    if (
      plan.trigger.kind !== "interval" ||
      plan.trigger.every !== 2 ||
      plan.trigger.unit !== "hours" ||
      !plan.enabled
    )
      throw Error("Mobile save did not persist");
    await capture("11-saved-interval", "手机修改已同步到 Host");
    await tap("项目每日检查");
    await tap("暂停计划");
    await pause(500);
    if ((await api("/automations")).find((p) => p.id === plan.id).enabled)
      throw Error("Mobile pause failed");
    await capture("12-paused", "手机暂停定时任务");
  }
  if (stage === "dump") {
    const s = await state();
    writeFileSync(join(root, "current.xml"), s.xml);
    console.log(
      s.nodes
        .filter((n) => n.text || n["content-desc"])
        .map((n) => ({
          text: n.text,
          description: n["content-desc"],
          bounds: n.bounds,
          enabled: n.enabled,
        })),
    );
  }
  if (stage === "restore") {
    if ((await state()).nodes.some((n) => n["content-desc"] === "关闭")) await tap("关闭");
    if ((await state()).nodes.some((n) => n["content-desc"] === "关闭")) await tap("关闭");
    await tap("对话");
    await tap("切换设备");
    await tap("设备 3");
  }
  report.result = "passed";
} catch (e) {
  report.result = "failed";
  report.errors.push(e.stack);
  console.error(e);
  process.exitCode = 1;
}
report.stage = stage;
report.finishedAt = new Date().toISOString();
writeFileSync(join(root, stage + "-manifest.json"), JSON.stringify(report, null, 2));
