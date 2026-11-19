import { _electron as electron } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { electronEnvironment } from "./electron-environment.mjs";
import { resolveElectronRuntime } from "./electron-runtime.mjs";

const outDir =
  "C:/Users/admin/.gemini/antigravity/brain/caf3214e-ad51-4064-be34-697d7f06adc8/screenshots";
mkdirSync(outDir, { recursive: true });

const data = resolve(`.local/verification/desktop-scrollbar-scroll-${Date.now()}`);
mkdirSync(data, { recursive: true });
const port = "4360";

const runtime = await resolveElectronRuntime();
console.log("Using Electron runtime:", runtime.path);

const app = await electron.launch({
  executablePath: runtime.path,
  args: [resolve("apps/desktop")],
  env: {
    ...electronEnvironment(),
    KODO_DATA_DIR: data,
    KODO_HOST_PORT: port,
  },
  timeout: 45000,
});

async function safeClose() {
  try {
    const closing = app.close();
    await Promise.race([closing, new Promise((r) => setTimeout(r, 4000))]);
  } catch {}
  try {
    app.process()?.kill();
  } catch {}
}

try {
  const page = await app.firstWindow({ timeout: 30000 });
  await page.waitForTimeout(2000);

  const skipBtn = page.getByRole("button", { name: "跳过引导" });
  if (await skipBtn.isVisible().catch(() => false)) {
    console.log("Clicking skip onboarding...");
    await skipBtn.click();
    await page.waitForTimeout(1500);
  }

  console.log("Waiting for Host connected...");
  await page.getByText("Host 已连接", { exact: true }).waitFor({ timeout: 20000 });
  console.log("Host connected!");

  const hostFile = join(data, "host.json");
  const discovery = JSON.parse(readFileSync(hostFile, "utf8"));
  const hostUrl = discovery.url;

  async function api(path, body) {
    const response = await fetch(hostUrl + "/api" + path, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    const value = await response.json();
    if (value.error) throw new Error(value.error.message);
    return value;
  }

  console.log("Creating project and 25 sessions for a prominent scrollbar...");
  const project = await api("/projects", {
    name: "滑动块验收测试",
    rootPath: process.cwd(),
  });

  const snapshot = await api("/snapshot");
  const workspace = snapshot.workspaces.find((w) => w.projectId === project.id);

  for (let i = 1; i <= 25; i++) {
    await api("/sessions", {
      title: `长会话 ${i.toString().padStart(2, "0")} · 验证滑动块交互顺畅`,
      harnessId: "codex",
      kind: "direct",
      projectId: project.id,
      workspaceId: workspace.id,
    });
  }
  console.log("25 sessions created!");

  await page.reload();
  await page.waitForTimeout(1500);

  // Measure geometry
  const geom = await page.evaluate(() => {
    const sessionRows = document.querySelector(".session-rows");
    const sidebar = document.querySelector(".sidebar");
    const resizer = document.querySelector(".sidebar-resizer");

    const r = sessionRows.getBoundingClientRect();
    const s = sidebar.getBoundingClientRect();
    const z = resizer.getBoundingClientRect();

    return {
      sessionRows: {
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
        width: r.width,
        height: r.height,
        scrollHeight: sessionRows.scrollHeight,
        clientHeight: sessionRows.clientHeight,
        scrollTop: sessionRows.scrollTop,
      },
      sidebar: { left: s.left, right: s.right, width: s.width },
      resizer: { left: z.left, right: z.right, width: z.width },
    };
  });

  console.log("Geometry:", JSON.stringify(geom, null, 2));

  // The scrollbar thumb is at the top of .session-rows right inside its right edge
  // sessionRows.right is ~315.2, so x = 310 is 5px inside the right edge.
  // sessionRows.top is ~273, so y = 300 is 27px below the top of sessionRows (right on the thumb)
  const thumbX = Math.round(geom.sessionRows.right - 5);
  const thumbY = Math.round(geom.sessionRows.top + 35);

  console.log(`Hovering at scrollbar thumb: (${thumbX}, ${thumbY})`);
  await page.mouse.move(thumbX, thumbY);
  await page.waitForTimeout(500);

  // Take screenshot while hovering thumb
  await page.screenshot({
    path: join(outDir, "desktop-scrollbar-hover.png"),
  });
  console.log("Saved desktop-scrollbar-hover.png");

  // Take zoomed screenshot of the thumb and boundary
  await page.screenshot({
    path: join(outDir, "desktop-scrollbar-thumb-zoom.png"),
    clip: {
      x: thumbX - 30,
      y: geom.sessionRows.top,
      width: 60,
      height: 140,
    },
  });
  console.log("Saved desktop-scrollbar-thumb-zoom.png");

  // Check element at point
  const elAtPoint = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return { tag: el?.tagName, className: el?.className };
    },
    [thumbX, thumbY],
  );
  console.log("Element at thumb:", elAtPoint);

  // Drag the scrollbar thumb down by 150px
  console.log("Dragging scrollbar thumb down...");
  await page.mouse.down();
  await page.mouse.move(thumbX, thumbY + 150, { steps: 15 });
  await page.waitForTimeout(400);

  // Capture screenshot during active drag
  await page.screenshot({
    path: join(outDir, "desktop-scrollbar-active-drag.png"),
  });

  await page.mouse.up();
  await page.waitForTimeout(400);

  const afterState = await page.evaluate(() => {
    const sessionRows = document.querySelector(".session-rows");
    const sidebar = document.querySelector(".sidebar");
    return {
      scrollTop: sessionRows?.scrollTop ?? 0,
      sidebarWidth: sidebar?.getBoundingClientRect().width ?? 0,
    };
  });

  console.log("After scrollbar drag state:", afterState);
  console.log(`ScrollTop moved from ${geom.sessionRows.scrollTop} to ${afterState.scrollTop}`);
  console.log(
    `Sidebar width remained: ${afterState.sidebarWidth}px (initial: ${geom.sidebar.width}px)`,
  );

  // Verify dragging the scrollbar scrolled the content without resizing sidebar
  const scrolled = afterState.scrollTop > 0;
  const sidebarNotResized = Math.abs(afterState.sidebarWidth - geom.sidebar.width) < 0.5;

  console.log("VERIFICATION RESULT:", {
    scrolled,
    sidebarNotResized,
    pass: scrolled && sidebarNotResized,
  });
} finally {
  await safeClose();
}
