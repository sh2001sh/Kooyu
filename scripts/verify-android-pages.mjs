import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import {
  verifyAndroidExtraPages,
  verifyAndroidScannerPage,
} from "./verify-android-extra-pages.mjs";

const execute = promisify(execFile);
const root = resolve(
  process.env.KOOYU_ANDROID_SCREENSHOT_DIR ??
    "output/playwright/desktop-android-2026-11-15/android",
);
const temporary = resolve(".local/tmp");
mkdirSync(root, { recursive: true });
mkdirSync(temporary, { recursive: true });
const adb = resolve(process.env.KOOYU_ADB ?? ".local/android-sdk/platform-tools/adb.exe");
const base = process.env.KODO_HOST_URL ?? "http://127.0.0.1:4357";
const uiProbe = process.env.KOOYU_ANDROID_UI_PROBE === "1";
const resume = process.env.KOOYU_ANDROID_RESUME === "1";
const extraOnly = process.env.KOOYU_ANDROID_EXTRA_ONLY === "1";
const scannerOnly = process.env.KOOYU_ANDROID_SCANNER_ONLY === "1";
const plannedPages = [
  "首次配对",
  "手动配对",
  "会话列表",
  "新建对话",
  "项目",
  "新建项目",
  "待处理",
  "用量",
  "已配对电脑",
  "执行引擎",
  "通用设置",
  "电脑重命名",
  "添加电脑",
  "会话正文",
  "会话用量",
  "基础配置",
  "事件记录",
  "指令队列",
  "工作区文件",
  "文本预览",
  "Git 变更",
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
if ((resume || extraOnly || scannerOnly) && existsSync(join(root, "manifest.json"))) {
  const previous = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  report.pages =
    extraOnly || scannerOnly
      ? previous.pages
      : previous.pages.filter((p) => /^(01|02)-/.test(p.id));
  report.resumedPairing = true;
  if (scannerOnly) {
    report.lifecycle = previous.lifecycle;
    report.scrollCoverage = previous.scrollCoverage;
    report.extendedPlannedPages = previous.extendedPlannedPages;
  }
}
let serial = process.env.KOOYU_ADB_SERIAL;
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
try {
  await command(["start-server"]);
  const conf =
    process.env.KOOYU_BLUESTACKS_CONFIG ??
    join(process.env.ProgramData ?? "C:/ProgramData", "BlueStacks_nxt", "bluestacks.conf");
  if (!serial && existsSync(conf)) {
    const ports = [
      ...readFileSync(conf, "utf8").matchAll(/^bst\.instance\.[^.]+\.adb_port="(\d+)"/gm),
    ].map((m) => +m[1]);
    for (const port of ports)
      if (port > 0 && port < 65536) await command(["connect", "127.0.0.1:" + port]).catch(() => {});
  }
  const list = await command(["devices", "-l"]);
  const connected = list
    .split(/\r?\n/)
    .filter((l) => /^\S+\s+device\b/.test(l))
    .map((l) => l.split(/\s+/)[0]);
  report.connectedDevices = connected;
  const loopbackDevices = connected.filter((id) => /^127\.0\.0\.1:\d+$/.test(id));
  if (!serial && loopbackDevices.length === 1) serial = loopbackDevices[0];
  if (!serial || !connected.includes(serial)) {
    report.result = "blocked";
    report.reason =
      "BlueStacks installation/ADB device unavailable. No Android page has been verified or fabricated.";
  } else {
    if (!/^127\.0\.0\.1:\d+$/.test(serial))
      throw new Error(
        "This BlueStacks runner requires a loopback ADB endpoint; it never selects a USB phone.",
      );
    const fixture = JSON.parse(
      readFileSync(
        resolve(
          process.env.KOOYU_QA_DIR ?? ".local/verification/platform-pages-20261115",
          "fixture.json",
        ),
        "utf8",
      ),
    );
    const health = await (
      await fetch(base + "/api/health", { signal: AbortSignal.timeout(5000) })
    ).json();
    if (fixture.fixture !== true || fixture.url !== base || fixture.hostId !== health.hostId)
      throw new Error("The matching isolated visual-QA Host is required.");
    report.serial = serial;
    report.androidVersion = (await device("shell", "getprop", "ro.build.version.release")).trim();
    report.sdk = (await device("shell", "getprop", "ro.build.version.sdk")).trim();
    report.displaySize = (await device("shell", "wm", "size")).trim();
    report.displayDensity = (await device("shell", "wm", "density")).trim();
    if (uiProbe) {
      const probe = resolve(".local/verification/android-ui-probe/probe.apk");
      if (!existsSync(probe)) throw new Error("Build scripts/build-android-ui-probe.mjs first");
      if (!(await device("install", "-r", probe)).includes("Success"))
        throw new Error("UI probe installation failed");
    }
    const apk = resolve("apps/android/app/build/outputs/apk/debug/app-debug.apk");
    report.apkSha256 = createHash("sha256").update(readFileSync(apk)).digest("hex");
    const install = await device("install", "-r", apk);
    if (!install.includes("Success")) throw new Error("APK installation did not succeed");
    await device("shell", "am", "force-stop", "app.kooyu.android");
    await device("shell", "am", "start", "-n", "app.kooyu.android/.MainActivity");
    await pause(2000);
    if (!extraOnly && !scannerOnly) {
      if (!resume) {
        await capture("01-pair-welcome", "首次配对", "手动输入连接信息");
        await tap("手动输入连接信息");
        await capture("02-pair-manual", "手动配对", "HTTPS 地址");
        const r = await fetch(base + "/api/pairing", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
          signal: AbortSignal.timeout(18000),
        });
        const invite = await r.json();
        if (!r.ok) throw new Error("Isolated Host pairing is unavailable");
        const url = new URL(invite.url);
        url.hash = "";
        await field("HTTPS 地址", url.toString());
        await field("配对码", invite.code);
        await tap("完成配对");
      }
      await capture("03-sessions", "会话列表", "平台验收主对话");
      await tap("新建对话");
      await capture("04-new-conversation", "新建对话", "对话标题（可选）");
      await tap("关闭");
      await tap("项目");
      await capture("05-projects", "项目", "新建项目");
      await tap("新建项目");
      await capture("06-new-project", "新建项目", "取消");
      await tap("取消");
      await tap("待处理");
      await capture("07-inbox", "待处理");
      await tap("用量");
      await capture("08-usage", "用量");
      await tap("设置");
      await capture("09-devices", "已配对电脑与后台提醒", "后台事项提醒");
      await tap("执行引擎");
      await capture("10-engines", "执行引擎", "已注册执行引擎");
      await tap("通用设置");
      await capture("11-general", "通用设置", "保存通用设置");
      await tap("已配对电脑");
      await tap("重命名");
      await capture("12-rename-device", "电脑重命名", "电脑名称");
      await tap("取消");
      await tap("添加另一台电脑");
      await capture("13-add-device", "添加电脑", "手动输入连接信息");
      await tap("关闭");
      await tap("会话");
      await tap("平台验收主对话");
      await capture("14-conversation", "会话正文");
      await tap("当前会话用量");
      await capture("15-session-usage", "会话用量", "会话用量");
      await tap("关闭");
      await tap("会话配置与工具记录");
      await capture("16-session-settings", "基础配置", "保存基础配置");
      await tap("事件记录");
      await capture("17-session-events", "事件记录", "事件与运行记录");
      await tap("指令队列");
      await capture("18-session-queue", "指令队列", "指令队列 (Command Queue)");
      await tap("工作区文件");
      await capture("19-workspace-files", "工作区文件", "README.md");
      await tap("README.md");
      await capture("20-file-preview", "文本预览");
      await tap("Git 变更");
      await capture("21-git-changes", "Git 变更");
    }
    if (extraOnly || process.env.KOOYU_ANDROID_EXTRAS === "1")
      await verifyAndroidExtraPages({
        root,
        report,
        fixture,
        base,
        serial,
        device,
        command,
        state,
        bounds,
        pause,
        tap,
        capture,
        waitForText,
        scrollDown,
      });
    if (scannerOnly || process.env.KOOYU_ANDROID_EXTRAS === "1")
      await verifyAndroidScannerPage({ report, device, pause, tap, capture, waitForText });
    report.result = "passed";
  }
} catch (e) {
  report.result = "failed";
  report.errors.push(e.message);
  if (serial) {
    const diagnostic = join(root, "diagnostics");
    mkdirSync(diagnostic, { recursive: true });
    const stamp = report.startedAt.replace(/[^0-9]/g, "");
    try {
      const png = await command(["-s", serial, "exec-out", "screencap", "-p"], true);
      writeFileSync(join(diagnostic, stamp + ".png"), png);
      writeFileSync(join(diagnostic, stamp + ".xml"), (await state()).xml);
    } catch {}
  }
} finally {
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(root, "manifest.json"), JSON.stringify(report, null, 2));
  const escape = (s) =>
    String(s).replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );
  writeFileSync(
    join(root, "index.html"),
    "<!doctype html><meta charset=utf-8><title>Kooyu Android QA</title><style>body{font:16px system-ui;background:#eee;margin:24px}main{display:flex;flex-wrap:wrap;gap:20px}article{background:white;padding:16px;width:340px}img{width:100%}</style><h1>Kooyu Android 原生页面截图</h1><p>" +
      escape(report.result) +
      " · ADB screencap · 独立演示数据</p><main>" +
      report.pages
        .map(
          (p) =>
            "<article><h2>" +
            escape(p.label) +
            "</h2><a href=" +
            escape(p.id + ".png") +
            "><img loading=lazy src=" +
            escape(p.id + ".png") +
            " alt=" +
            escape(p.id) +
            "></a></article>",
        )
        .join("") +
      "</main>",
  );
  console.log(
    JSON.stringify({
      result: report.result,
      screenshots: report.pages.length,
      reason: report.reason,
      errors: report.errors,
    }),
  );
  if (report.result !== "passed") process.exitCode = 2;
}
