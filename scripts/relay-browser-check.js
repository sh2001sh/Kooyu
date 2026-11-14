// Run with playwright-cli run-code after opening the fixture's desktop devices page.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- Playwright run-code consumes this callback expression.
async (page) => {
  const desktop = new URL(page.url()).origin;
  const resultPromise = page.waitForResponse(
    (response) =>
      response.url() === desktop + "/api/pairing" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "生成配对码", exact: true }).click();
  const inviteResponse = await resultPromise;
  if (inviteResponse.status() !== 201)
    throw new Error("Pairing invite failed: " + inviteResponse.status());
  const invitation = await inviteResponse.json();
  await page.getByRole("img", { name: "手机配对二维码" }).waitFor();
  const mobile = await page.context().newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  const errors = [];
  mobile.on("pageerror", (error) => errors.push(error.message));
  await mobile.goto(invitation.url);
  await mobile.getByLabel("设备名称").fill("Browser relay verification");
  await mobile.getByRole("button", { name: "配对并连接", exact: true }).click();
  await mobile.waitForFunction(() => location.hash === "");
  const base = invitation.url.split("#")[0].slice(0, -1);
  await mobile
    .getByRole("button", { name: /Relay 隔离验收项目/ })
    .first()
    .waitFor();
  const snapshotResponse = await mobile.request.get(base + "/api/snapshot");
  if (snapshotResponse.status() !== 200) throw new Error("Authenticated mobile snapshot failed");
  const snapshot = await snapshotResponse.json();
  const device = snapshot.devices.find((d) => d.name === "Browser relay verification");
  if (!device) throw new Error("Paired device missing");
  const noOverflow = await mobile.evaluate(
    () => document.documentElement.scrollWidth <= innerWidth,
  );
  if (!noOverflow) throw new Error("Mobile horizontal overflow");
  await page.getByText("Browser relay verification", { exact: true }).waitFor();
  await page.screenshot({ path: "output/playwright/relay-desktop.png", fullPage: true });
  await mobile.screenshot({ path: "output/playwright/relay-mobile.png", fullPage: true });
  const created = await mobile.request.post(base + "/api/projects", {
    data: { name: "手机操作验收", rootPath: snapshot.workspaces[0].rootPath },
  });
  if (created.status() !== 201) throw new Error("Remote mutation failed: " + created.status());
  await mobile.reload();
  await mobile
    .getByRole("button", { name: /手机操作验收/ })
    .first()
    .waitFor();
  // Foreground/network recovery must rebuild both snapshot and event stream.
  await mobile.evaluate(() => window.dispatchEvent(new Event("offline")));
  await mobile.evaluate(() => window.dispatchEvent(new Event("online")));
  await mobile.waitForFunction(() => document.body.textContent.includes("Host 已连接"));
  const cachesSafe = await mobile.evaluate(async () => {
    const keys = await caches.keys();
    for (const key of keys)
      for (const request of await (await caches.open(key)).keys())
        if (new URL(request.url).pathname.includes("/api/")) return false;
    return true;
  });
  if (!cachesSafe) throw new Error("Sensitive API response cached");
  const revoked = await page.request.delete(desktop + "/api/devices/" + device.id);
  if (revoked.status() !== 200) throw new Error("Revocation failed");
  await mobile.getByRole("heading", { name: "连接 Kooyu Host", exact: true }).waitFor();
  if ((await mobile.request.get(base + "/api/snapshot")).status() !== 401)
    throw new Error("Revoked device remains authorized");
  if (errors.length) throw new Error("Browser page errors: " + errors.join("; "));
  return {
    pairing: true,
    mobileSnapshot: true,
    remoteMutation: true,
    reconnect: true,
    revocation: true,
    sensitiveCacheAbsent: true,
    noOverflow,
    pageErrors: errors.length,
  };
};
