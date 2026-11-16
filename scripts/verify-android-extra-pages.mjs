import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

export async function verifyAndroidScannerPage({
  report,
  device,
  pause,
  tap,
  capture,
  waitForText,
}) {
  await tap("设置");
  await tap("添加另一台电脑");
  await device("shell", "pm", "grant", "app.kooyu.android", "android.permission.CAMERA");
  try {
    await tap("扫描桌面二维码");
    await waitForText("图像仅在本机识别，不会上传");
    assert.match(
      await device("shell", "dumpsys", "activity", "activities"),
      /topResumedActivity=.*QrScannerActivity/,
    );
    await pause(800);
    await capture(
      "37-qr-scanner-protected",
      "原生扫码器（FLAG_SECURE保护）",
      "图像仅在本机识别，不会上传",
      true,
    );
    const page = report.pages.find((p) => p.id === "37-qr-scanner-protected");
    if (page) {
      page.protectedSurface = true;
      page.note =
        "The scanner deliberately sets FLAG_SECURE. ADB may return a black protected surface; no capture bypass or camera QR decoding claim. Activity and native accessibility content verified.";
    }
    await tap("取消");
    await capture("38-qr-scanner-return", "扫码取消返回添加电脑", "手动输入连接信息");
    await tap("关闭");
    report.lifecycle.scannerActivityOpenedAndCancelled = true;
  } finally {
    await device("shell", "pm", "revoke", "app.kooyu.android", "android.permission.CAMERA");
    await device("shell", "am", "start", "-n", "app.kooyu.android/.MainActivity");
  }
}

// Runs only through the isolated BlueStacks driver; never chooses a USB device.
export async function verifyAndroidExtraPages(api) {
  const {
    root,
    report,
    fixture,
    base,
    serial,
    device,
    command,
    state,
    pause,
    tap,
    capture,
    waitForText,
    scrollDown,
  } = api;
  report.extendedPlannedPages = [
    "项目添加目录",
    "项目重命名",
    "项目删除确认",
    "预算设置",
    "会话操作菜单",
    "会话重命名",
    "会话删除确认",
    "已归档会话",
    "电脑切换菜单",
    "长引擎列表",
    "深色主题",
    "后台提醒及通知深链",
  ];
  report.lifecycle = { coldStartRestoredConnection: true };
  // The preceding baseline finishes inside a modal. Start this phase from the
  // same verified cold-launch state used by an independent extra-only run.
  await device("shell", "am", "force-stop", "app.kooyu.android");
  await device("shell", "am", "start", "-n", "app.kooyu.android/.MainActivity");
  await waitForText("平台验收主对话");
  const request = async (path, body) => {
    const r = await fetch(base + "/api" + path, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const value = await r.json();
    assert.ok(r.ok, "Isolated fixture API failed: " + path);
    return value;
  };
  const signature = (snapshot) =>
    JSON.stringify(snapshot.nodes.map((n) => [n.text, n["content-desc"], n.bounds]));
  async function longPage(id, label, expected) {
    await capture(id, label, expected);
    let previous = await state();
    let moves = 0;
    for (; moves < 24; moves++) {
      if (!(await scrollDown(previous))) break;
      const next = await state();
      if (signature(next) === signature(previous)) break;
      await capture(
        id + "-scroll-" + String(moves + 1).padStart(2, "0"),
        label + " · 滚动 " + (moves + 1),
      );
      previous = next;
    }
    assert.ok(moves < 24, "Long page did not reach the end: " + id);
    const pane = previous.nodes
      .filter((n) => n.scrollable === "true")
      .map((n) => [...n.bounds.matchAll(/\d+/g)].map((m) => +m[0]))
      .filter((b) => b.length === 4)
      .sort((a, b) => (b[2] - b[0]) * (b[3] - b[1]) - (a[2] - a[0]) * (a[3] - a[1]))[0];
    if (pane) {
      const [l, t, r, b] = pane;
      for (let i = 0; i < moves + 1; i++)
        await device(
          "shell",
          "input",
          "swipe",
          String(Math.floor((l + r) / 2)),
          String(Math.floor(t + (b - t) * 0.25)),
          String(Math.floor(t + (b - t) * 0.85)),
          "200",
        );
      await pause(350);
    }
    report.scrollCoverage ??= [];
    report.scrollCoverage.push({ id, additionalScreenshots: moves, reachedEnd: true });
  }
  async function captureSystem(id, label, expected) {
    const s = await waitForText(expected);
    assert.ok(
      s.nodes.some((n) => n.package === "com.android.systemui"),
      "Expected Android SystemUI",
    );
    const png = await command(["-s", serial, "exec-out", "screencap", "-p"], true);
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    const path = join(root, id + ".png");
    writeFileSync(path, png);
    writeFileSync(join(root, id + ".xml"), s.xml);
    const entry = {
      id,
      label,
      path,
      expected,
      source: "android-systemui",
      width: png.readUInt32BE(16),
      height: png.readUInt32BE(20),
      sha256: createHash("sha256").update(png).digest("hex"),
    };
    const existing = report.pages.findIndex((p) => p.id === id);
    if (existing < 0) report.pages.push(entry);
    else report.pages[existing] = entry;
    writeFileSync(join(root, "manifest.json"), JSON.stringify(report, null, 2));
    console.log("CAPTURED " + id + " " + label);
  }

  await tap("项目");
  await waitForText("新建项目");
  await tap("添加目录");
  await capture("22-project-directory", "项目添加工作目录", "电脑绝对路径");
  await tap("取消");
  await tap("重命名");
  await capture("23-project-rename", "项目重命名", "项目名称");
  await tap("取消");
  await tap("删除");
  await capture("24-project-delete-confirm", "项目删除确认（取消操作）", "取消");
  await tap("取消");
  await tap("用量");
  await waitForText("设置预算");
  await tap("设置预算");
  await capture("25-budget", "项目预算设置", "限额 (USD)");
  await tap("取消");
  await tap("会话");
  await waitForText("平台验收主对话");
  await tap("会话操作");
  await capture("26-conversation-menu", "会话操作菜单", "归档会话");
  await tap("重命名");
  await capture("27-conversation-rename", "会话重命名", "对话标题");
  await tap("取消");
  await tap("会话操作");
  await tap("删除会话");
  await capture(
    "28-conversation-delete-confirm",
    "会话删除确认（取消操作）",
    "从当前电脑删除此会话记录，此操作不能撤销。",
  );
  await tap("取消");
  await tap("已归档");
  await capture("29-archived", "已归档会话空状态", "暂无匹配会话");
  await tap("进行中");
  await tap("切换电脑");
  await capture("30-device-menu", "电脑切换菜单", "添加电脑");
  await tap("电脑 1");
  await tap("设置");
  await tap("执行引擎");
  await longPage("10-engines", "执行引擎", "已注册执行引擎");
  await tap("通用设置");
  await longPage("11-general", "通用设置", "电脑宿主通用设置");
  await device("shell", "cmd", "uimode", "night", "yes");
  try {
    await pause(1000);
    await capture("31-dark-settings", "深色主题通用设置", "保存通用设置");
  } finally {
    await device("shell", "cmd", "uimode", "night", "no");
  }
  await tap("已配对电脑");
  await waitForText("开启后台提醒");
  // The test creates this emulator instance; grant only the app's runtime notification permission.
  await device(
    "shell",
    "pm",
    "grant",
    "app.kooyu.android",
    "android.permission.POST_NOTIFICATIONS",
  );
  await tap("开启后台提醒");
  await capture(
    "32-background-enabled",
    "后台提醒已连接",
    "后台连接已建立；系统回收或强行停止后请返回应用检查。",
  );
  const services = await device("shell", "dumpsys", "activity", "services", "app.kooyu.android");
  assert.match(services, /ReminderService/);
  assert.match(services, /isForeground=true/);
  report.lifecycle.foregroundServiceStarted = true;
  await device("shell", "input", "keyevent", "3");
  await pause(1500);
  assert.match(
    await device("shell", "dumpsys", "activity", "services", "app.kooyu.android"),
    /isForeground=true/,
  );
  report.lifecycle.serviceSurvivesBackground = true;
  const goal = await request("/goals", {
    requestId: randomUUID(),
    controllerSessionId: fixture.sessionId,
    title: "Android 原生提醒验收（演示）",
    acceptanceCriteria: ["保存通知截图"],
  });
  await request("/goals/" + goal.id + "/complete", {
    requestId: randomUUID(),
    expectedRevision: goal.revision,
    summary: "隔离测试事件；没有执行模型任务。",
    deliverables: [],
  });
  await pause(6500);
  await device("shell", "cmd", "statusbar", "expand-notifications");
  await captureSystem("33-system-notifications", "Android 后台事项与常驻通知", "Kooyu 需要你处理");
  report.lifecycle.backgroundNotificationDelivered = true;
  await tap("Kooyu 需要你处理");
  await capture("34-notification-open", "通知点击回到同一会话", "平台验收主对话");
  const feed = await request("/notifications?after=0");
  assert.ok(
    feed.items.some((n) => n.goalId === goal.id && n.readAt),
    "Notification open did not persist a read receipt",
  );
  report.lifecycle.notificationClickReadReceipt = true;
  await tap("返回会话列表");
  await tap("设置");
  await tap("已配对电脑");
  await tap("关闭提醒");
  await capture(
    "35-background-disabled",
    "后台提醒关闭并获Host确认",
    "后台提醒已关闭，Host 已确认。",
  );
  report.lifecycle.reminderRevocationConfirmed = true;
  await device("shell", "am", "force-stop", "app.kooyu.android");
  await device("shell", "am", "start", "-n", "app.kooyu.android/.MainActivity");
  await capture("36-cold-start-restored", "最终冷启动恢复电脑与会话", "平台验收主对话");
  report.lifecycle.finalColdStartRestoredConnection = true;
}
