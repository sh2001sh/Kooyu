import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
const execute = promisify(execFile);
const root = resolve(
  process.env.KOOYU_ANDROID_OUTPUT ?? "output/playwright/global-memory-2026-11-16/android",
);
const temporary = resolve(".local/tmp");
mkdirSync(root, { recursive: true });
mkdirSync(temporary, { recursive: true });
const adb = resolve(process.env.KOOYU_ADB ?? ".local/android-sdk/platform-tools/adb.exe");
const base = process.env.KODO_HOST_URL ?? "http://127.0.0.1:4397";
const uiProbe = true;
const plannedPages = ["设置入口", "共享记忆配置", "新增与编辑", "对话形成记忆", "来源与待确认建议"];
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
  readFileSync(".local/verification/global-memory-20261116/fixture.json", "utf8"),
);
const api = async (path) => {
  const r = await fetch(base + "/api" + path);
  if (!r.ok) throw Error(path + ":" + r.status);
  return r.json();
};
const stage = process.argv[2] ?? "dump";
try {
  if (!fixture.fixture || (await api("/health")).hostId !== fixture.hostId)
    throw Error("Wrong fixture");
  if (stage === "pair") {
    await tap("设置");
    await tap("添加另一台电脑");
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
    await tap("设置");
    for (let i = 0; i < 12; i++) {
      const s = await state();
      if (s.nodes.some((n) => n.text === "全局记忆")) break;
      await scrollDown(s);
    }
    await capture("01-settings-entry", "设置一级入口", "全局记忆");
    await tap("全局记忆");
    await capture("02-global-memory", "全局记忆与共享配置", "启用全局记忆");
  }
  if (stage === "open") {
    for (let i = 0; i < 12; i++) {
      const s = await state();
      if (s.nodes.some((n) => n.text === "全局记忆")) break;
      await scrollDown(s);
    }
    await capture("01-settings-entry", "设置一级入口", "全局记忆");
    await tap("全局记忆");
    await capture("02-global-memory", "全局记忆与共享配置", "启用全局记忆");
  }
  if (stage === "manage") {
    if (!(await api("/memory/settings")).automaticSaving) {
      await tap("自动保存对话记忆");
      await pause(2000);
    }
    if (!(await api("/memory/settings")).automaticSaving)
      throw Error("Mobile automatic saving did not persist");
    await tap("新增记忆");
    await field("约定主题", "Mobile");
    await device("shell", "input", "text", "%spreference");
    await field("约定内容", "Use");
    await device("shell", "input", "text", "%sshort%ssummaries");
    await capture("03-editor", "全局记忆编辑", "保存并确认");
    await tap("保存并确认");
    await waitForText("新增记忆");
    if (
      !(await api("/memory")).some(
        (e) => e.subject === "Mobile preference" && e.content === "Use short summaries",
      )
    )
      throw Error("Mobile memory not saved");
    await capture("04-shared-settings", "手机修改自动保存，桌面读取", "启用全局记忆");
  }
  if (stage === "sources") {
    for (let i = 0; i < 8; i++) {
      const s = await state();
      if (s.nodes.some((n) => n.text === "查看来源")) break;
      await scrollDown(s);
    }
    await tap("查看来源");
    await scrollDown(await state());
    await capture("05-provenance", "记忆来源");
  }
  if (stage === "chat") {
    await tap("关闭");
    await tap("对话");
    await tap("平台验收主对话");
    await field("消息", "MemoryQA:");
    await device("shell", "input", "text", "%sremember%sPrefer%smobile%ssummaries");
    await tap("发送消息");
    await waitForText("已记住你的偏好。");
    if (
      !(await api("/memory")).some(
        (e) => e.subject === "Prefer mobile summaries" && e.status === "confirmed",
      )
    )
      throw Error("Conversation did not capture global memory");
    await capture("06-chat-memory", "手机主对话形成全局记忆");
    await tap("返回");
    await tap("设置");
  }
  if (stage === "review-start") {
    for (let i = 0; i < 12; i++) {
      const s = await state();
      if (s.nodes.some((n) => n.text === "全局记忆")) break;
      await scrollDown(s);
    }
    await tap("全局记忆");
    await pause(2000);
    await tap("自动保存对话记忆");
    await pause(2000);
    if ((await api("/memory/settings")).automaticSaving) throw Error("Proposal mode not saved");
    await tap("关闭");
    await tap("对话");
    await tap("平台验收主对话");
    await field("消息", "MemoryQA:");
    await device("shell", "input", "text", "%sremember%sPrefer%sexplicit%sverification");
    await tap("发送消息");
    await pause(2000);
    const proposal = (await api("/memory")).find(
      (e) => e.subject === "Prefer explicit verification",
    );
    if (proposal?.status !== "proposed") throw Error("Mobile proposal missing");
    await capture("07-chat-proposal", "手机主对话形成待确认建议");
    await tap("返回");
    await tap("设置");
    for (let i = 0; i < 12; i++) {
      const s = await state();
      if (s.nodes.some((n) => n.text === "全局记忆")) break;
      await scrollDown(s);
    }
    await tap("全局记忆");
    for (let i = 0; i < 8; i++) {
      const s = await state();
      if (s.nodes.some((n) => n.text === "查看并确认" && bounds(n)[1] < 1800)) break;
      await scrollDown(s);
    }
    await capture("08-proposal", "手机确认记忆建议", "查看并确认");
    await tap("查看并确认");
    await tap("保存并确认");
    await pause(1500);
    if ((await api("/memory")).find((e) => e.id === proposal.id)?.status !== "confirmed")
      throw Error("Proposal not confirmed");
    report.confirmedProposal = proposal.id;
  }
  if (stage === "finish") {
    await tap("全局记忆");
    await pause(1500);
    for (let i = 0; i < 8; i++) {
      const view = await state();
      const index = view.nodes.findIndex((n) => n.text === "Mobile preference");
      const action =
        index >= 0 ? view.nodes.slice(index + 1).find((n) => n.text === "编辑记忆") : null;
      if (action && bounds(action)[1] < 1800) {
        await device("shell", "input", "tap", ...bounds(action).map(String));
        await pause(500);
        break;
      }
      await scrollDown(view);
    }
    await waitForText("保存并确认");
    const view = await state();
    const input = view.nodes.find(
      (n) => n.class === "android.widget.EditText" && n.children.some((c) => c.text === "约定内容"),
    );
    if (!input) throw Error("Memory editor input missing");
    await device("shell", "input", "tap", ...bounds(input).map(String));
    await device("shell", "input", "keyevent", "KEYCODE_MOVE_END");
    await device("shell", "input", "text", "%sand%slimitations");
    await tap("保存并确认");
    await pause(1500);
    if (
      !(await api("/memory")).some(
        (e) =>
          e.subject === "Mobile preference" && e.content === "Use short summaries and limitations",
      )
    )
      throw Error("Mobile edit failed");
    for (let i = 0; i < 8; i++) {
      const view = await state();
      const index = view.nodes.findIndex((n) => n.text === "Mobile preference");
      const action =
        index >= 0 ? view.nodes.slice(index + 1).find((n) => n.text === "编辑记忆") : null;
      if (action && bounds(action)[1] < 1800) {
        await device("shell", "input", "tap", ...bounds(action).map(String));
        await pause(500);
        break;
      }
      await scrollDown(view);
    }
    await tap("删除约定");
    await capture("09-delete-confirm", "删除记忆确认", "删除");
    await tap("删除");
    await pause(1500);
    if ((await api("/memory")).some((e) => e.subject === "Mobile preference"))
      throw Error("Mobile delete failed");
    for (let i = 0; i < 8; i++) {
      const view = await state();
      if (view.nodes.some((n) => n["content-desc"] === "自动保存对话记忆")) break;
      await device("shell", "input", "swipe", "540", "400", "540", "1550", "350");
    }
    await tap("刷新全局记忆");
    await pause(1000);
    if (!(await api("/memory/settings")).automaticSaving) {
      await tap("自动保存对话记忆");
      await pause(1500);
    }
    await capture("10-final-memory", "最终全局记忆配置", "启用全局记忆");
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
          checked: n.checked,
        })),
    );
  }
  if (stage === "restore") {
    if ((await state()).nodes.some((n) => n["content-desc"] === "关闭")) await tap("关闭");
    await tap("对话");
    await tap("切换电脑");
    await tap("电脑 3");
    await waitForText("电脑 3");
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
