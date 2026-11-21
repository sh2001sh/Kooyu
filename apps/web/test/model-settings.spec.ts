import { test, expect } from "@playwright/test";

test("desktop and phone persist model/effort changes without opening or replacing a native conversation", async ({
  page,
}) => {
  const create = await page.request.post("/api/sessions", {
    data: {
      title: "模型设置界面验收",
      harnessId: "pi",
      kind: "direct",
      bindingId: null,
      model: "openai/gpt-5",
    },
  });
  const session = await create.json();
  try {
    await page.goto("/");
    await page.locator(".session-row").filter({ hasText: session.title }).click();
    await page.getByRole("button", { name: "模型配置", exact: true }).click();
    const modelPopover = page.locator(".ms-popover");
    await expect(modelPopover.getByLabel("搜索模型")).toBeVisible();
    await expect(
      modelPopover.getByRole("definition").filter({ hasText: "400,000 tokens" }),
    ).toHaveCount(1);
    await expect(modelPopover.getByLabel("模型自动参数").locator("small")).toHaveCount(0);
    await expect(modelPopover.getByLabel("模型自动参数")).toContainText("128,000 tokens");
    await expect(modelPopover.locator('input[type="number"]')).toHaveCount(0);
    await page.getByRole("button", { name: "思考强度", exact: true }).click();
    const reasoningPopover = page.locator(".ms-popover--reasoning");
    await expect(reasoningPopover.locator(".reasoning-slider__scale")).not.toContainText("xhigh");
    const slider = reasoningPopover.getByRole("slider", { name: "会话思考强度" });
    await expect(slider).toBeEnabled();
    await slider.focus();
    await slider.press("End");
    await expect
      .poll(async () => {
        const stored = await (
          await page.request.get(`/api/sessions/${session.id}/settings`)
        ).json();
        return stored.session.reasoning;
      })
      .toBe("high");
    await page.screenshot({
      path: "../../output/playwright/model-settings-desktop.png",
      animations: "disabled",
    });
    const stored = await (await page.request.get(`/api/sessions/${session.id}/settings`)).json();
    expect(stored.session.reasoning).toBe("high");
    expect(stored.session.nativeSessionId).toBeNull();
    expect(stored.session.settingsRevision).toBe(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "模型配置", exact: true }).click();
    const form = page.locator(".ms-popover");
    await form.getByLabel("搜索模型").fill("openai/gpt-5-mini");
    await page.screenshot({
      path: "../../output/playwright/model-settings-mobile.png",
      animations: "disabled",
    });
    const plusRect = await page
      .getByRole("button", { name: "添加附件、权限或模板", exact: true })
      .boundingBox();
    const modelRect = await page
      .getByRole("button", { name: "模型配置", exact: true })
      .boundingBox();
    expect(modelRect!.x).toBeGreaterThanOrEqual(plusRect!.x + plusRect!.width);
    expect(
      (await page.locator(".composer-model-button__label").boundingBox())!.width,
    ).toBeGreaterThan(25);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const rect = await form.boundingBox();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.y).toBeGreaterThanOrEqual(0);
    await form.locator('.ms-model-scroll button[data-value="openai/gpt-5-mini"]').first().click();
    await expect(form).toHaveCount(0);
    await expect(page.getByRole("button", { name: "模型配置", exact: true })).toContainText(
      "gpt-5-mini",
    );
    const latest = await (await page.request.get(`/api/sessions/${session.id}/settings`)).json();
    expect(latest.session.reasoning).toBeNull();
    expect(latest.session.settingsRevision).toBe(2);
    expect(latest.session.nativeSessionId).toBeNull();
    await page.getByRole("button", { name: "模型配置", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "模型配置", exact: true })).toBeFocused();
  } finally {
    await page.request.delete(`/api/sessions/${session.id}`);
  }
});

test("unknown model capabilities stay read-only and do not offer handwritten efforts on desktop or phone", async ({
  page,
}) => {
  const session = await (
    await page.request.post("/api/sessions", {
      data: {
        title: "未知能力验收",
        harnessId: "pi",
        kind: "direct",
        bindingId: null,
        model: "unconfirmed-synthetic-model",
      },
    })
  ).json();
  try {
    await page.goto("/");
    await page.locator(".session-row").filter({ hasText: session.title }).click();
    for (const viewport of [
      { width: 1440, height: 960 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.getByRole("button", { name: "模型配置", exact: true }).click();
      const form = page.locator(".ms-popover");
      await expect(form.getByLabel("模型自动参数")).toContainText("参数未确认");
      if (viewport.width >= 761) {
        await page.getByRole("button", { name: "思考强度", exact: true }).click();
      }
      const reasoningContainer =
        viewport.width >= 761 ? page.locator(".ms-popover--reasoning") : form;
      await expect(reasoningContainer.getByLabel("会话思考强度")).toBeDisabled();
      await expect(reasoningContainer.locator(".reasoning-slider__scale")).toHaveText("原生");
      const response = await page.request.post(`/api/sessions/${session.id}/settings`, {
        data: {
          requestId: crypto.randomUUID(),
          expectedRevision: 0,
          model: "unconfirmed-synthetic-model",
          reasoning: "high",
        },
      });
      expect(response.status()).toBe(501);
      await page.keyboard.press("Escape");
    }
  } finally {
    await page.request.delete(`/api/sessions/${session.id}`);
  }
});

test("pointer release saves a selected effort", async ({ page }) => {
  const session = await (
    await page.request.post("/api/sessions", {
      data: { title: "滑动思考档位", harnessId: "pi", kind: "direct", model: "openai/gpt-5" },
    })
  ).json();
  try {
    await page.goto("/");
    await page.locator(".session-row").filter({ hasText: session.title }).click();
    await page.getByRole("button", { name: "思考强度", exact: true }).click();
    const slider = page.getByRole("slider", { name: "会话思考强度" });
    await expect(slider).toBeEnabled();
    const box = await slider.boundingBox();
    await slider.click({ position: { x: box!.width - 10, y: box!.height / 2 } });
    await expect
      .poll(async () => {
        const value = await (await page.request.get(`/api/sessions/${session.id}/settings`)).json();
        return value.session.reasoning;
      })
      .toBe("high");
    await page
      .locator(".ms-popover--reasoning .reasoning-slider__stop", { hasText: "low" })
      .click();
    await expect(page.locator(".ms-popover--reasoning .reasoning-slider__value")).toHaveText("low");
    await expect
      .poll(async () => {
        const value = await (await page.request.get(`/api/sessions/${session.id}/settings`)).json();
        return value.session.reasoning;
      })
      .toBe("low");
  } finally {
    await page.request.delete(`/api/sessions/${session.id}`);
  }
});

test("empty native model discovery offers a retry instead of a silent picker", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/harnesses/zcode/models?discover=1", async (route) => {
    requests++;
    await route.fulfill({
      json: { harnessId: "zcode", modelSupport: "native-models", defaultModel: null, models: [] },
    });
  });
  await page.goto("/");
  await page.locator(".new-conversation").click();
  await page.getByRole("button", { name: "Harness", exact: true }).click();
  await page.locator('.ios-popover [role="option"][data-value="zcode"]').click();
  await page.getByRole("button", { name: "模型配置" }).click();
  await expect(page.getByText("原生目录未返回模型候选。请检查 Harness 安装或登录。")).toBeVisible();
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect.poll(() => requests).toBe(2);
});

test("an idle ZCode session opens bundled model choices without starting a native conversation", async ({
  page,
}) => {
  const session = await (
    await page.request.post("/api/sessions", {
      data: { title: "ZCode 模型发现", harnessId: "zcode", kind: "direct" },
    })
  ).json();
  let discoveries = 0;
  await page.route(`**/api/sessions/${session.id}/settings?discover=1`, async (route) => {
    discoveries++;
    await route.fulfill({
      json: {
        session,
        modelSupport: "native-models",
        nativeCatalog: false,
        defaultModel: null,
        effectiveModel: null,
        models: [
          {
            id: "account:test/GLM-5.3",
            source: "native-catalog",
            contextWindow: 1000000,
            parameterSources: {
              contextWindow: { kind: "native-catalog", label: "ZCode 内置规则" },
            },
          },
        ],
      },
    });
  });
  try {
    await page.goto("/");
    await page.locator(".session-row").filter({ hasText: session.title }).click();
    await page.getByRole("button", { name: "模型配置", exact: true }).click();
    const form = page.locator(".ms-popover");
    await expect(form.locator('[data-value="account:test/GLM-5.3"]')).toBeVisible();
    expect(discoveries).toBe(1);
    await form.locator('[data-value="account:test/GLM-5.3"]').click();
    await expect
      .poll(async () => {
        const stored = await (
          await page.request.get(`/api/sessions/${session.id}/settings`)
        ).json();
        return stored.session.model;
      })
      .toBe("account:test/GLM-5.3");
    await page.getByRole("button", { name: "模型配置", exact: true }).click();
    await expect(form.getByText("1,000,000 tokens")).toBeVisible();
    const stored = await (await page.request.get(`/api/sessions/${session.id}/settings`)).json();
    expect(stored.session.nativeSessionId).toBeNull();
  } finally {
    await page.request.delete(`/api/sessions/${session.id}`);
  }
});

test("Codex draft and existing session expose the same permission choices", async ({ page }) => {
  await page.goto("/");
  await page.locator(".new-conversation").click();
  await page.getByRole("button", { name: "Harness", exact: true }).click();
  await page.locator('.ios-popover [role="option"][data-value="codex"]').click();
  await page.getByRole("button", { name: "会话权限" }).click();
  await page.getByRole("button", { name: /工作区写入/ }).click();
  await page.getByLabel("标题", { exact: true }).fill("Codex 权限选择验收");
  await page.getByRole("button", { name: "创建会话" }).click();
  await expect(page.getByRole("button", { name: "会话权限" })).toContainText("工作区写入");
  const snapshot = await (await page.request.get("/api/snapshot")).json();
  const session = snapshot.sessions.find(
    (s: { title: string }) => s.title === "Codex 权限选择验收",
  );
  expect(session.permissionMode).toBe("workspace-write");
  await page.getByRole("button", { name: "会话权限" }).click();
  await page.getByRole("button", { name: /只读/ }).click();
  await expect
    .poll(async () => {
      const latest = await (await page.request.get("/api/snapshot")).json();
      return latest.sessions.find((s: { id: string }) => s.id === session.id)?.permissionMode;
    })
    .toBe("read-only");
  await page.request.delete(`/api/sessions/${session.id}`);
});

test("Claude Code exposes its SDK permission modes and rejects Codex-only modes", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".new-conversation").click();
  await page.getByRole("button", { name: "Harness", exact: true }).click();
  await page.locator('.ios-popover [role="option"][data-value="claude-code"]').click();
  await page.getByRole("button", { name: "会话权限" }).click();
  await page.getByRole("button", { name: /自动接受编辑/ }).click();
  await page.getByLabel("标题", { exact: true }).fill("Claude 权限选择验收");
  await page.getByRole("button", { name: "创建会话" }).click();
  const snapshot = await (await page.request.get("/api/snapshot")).json();
  const session = snapshot.sessions.find(
    (s: { title: string }) => s.title === "Claude 权限选择验收",
  );
  try {
    expect(session.permissionMode).toBe("accept-edits");
    await page.getByRole("button", { name: "会话权限" }).click();
    await page.getByRole("button", { name: /跳过审批/ }).click();
    await expect
      .poll(async () => {
        const latest = await (await page.request.get("/api/snapshot")).json();
        return latest.sessions.find((s: { id: string }) => s.id === session.id)?.permissionMode;
      })
      .toBe("bypass-permissions");
    const invalid = await page.request.patch(`/api/sessions/${session.id}`, {
      data: { permissionMode: "workspace-write" },
    });
    expect(invalid.status()).toBe(501);
  } finally {
    await page.request.delete(`/api/sessions/${session.id}`);
  }
});

test("ZCode draft and existing session expose native modes and reject foreign modes", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".new-conversation").click();
  await page.getByRole("button", { name: "Harness", exact: true }).click();
  await page.locator('.ios-popover [role="option"][data-value="zcode"]').click();
  await page.getByRole("button", { name: "会话权限" }).click();
  await page.getByRole("button", { name: /Guarded/ }).click();
  await page.getByLabel("标题", { exact: true }).fill("ZCode 权限选择验收");
  await page.getByRole("button", { name: "创建会话" }).click();
  const snapshot = await (await page.request.get("/api/snapshot")).json();
  const session = snapshot.sessions.find(
    (s: { title: string }) => s.title === "ZCode 权限选择验收",
  );
  try {
    expect(session.permissionMode).toBe("guarded");
    await page.getByRole("button", { name: "会话权限" }).click();
    await page.getByRole("button", { name: /YOLO/ }).click();
    await expect
      .poll(async () => {
        const latest = await (await page.request.get("/api/snapshot")).json();
        return latest.sessions.find((s: { id: string }) => s.id === session.id)?.permissionMode;
      })
      .toBe("yolo");
    const invalid = await page.request.patch(`/api/sessions/${session.id}`, {
      data: { permissionMode: "full-access" },
    });
    expect(invalid.status()).toBe(501);
  } finally {
    await page.request.delete(`/api/sessions/${session.id}`);
  }
});

test("OpenCode exposes tool rules in new and existing conversations", async ({ page }) => {
  await page.goto("/");
  await page.locator(".new-conversation").click();
  await page.getByRole("button", { name: "Harness", exact: true }).click();
  await page.locator('.ios-popover [role="option"][data-value="opencode"]').click();
  await page.getByRole("button", { name: "会话权限" }).click();
  await expect(page.getByText("工具审批规则", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "../../output/playwright/opencode-permissions-desktop.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: /禁用工具/ }).click();
  await page.getByLabel("标题", { exact: true }).fill("OpenCode 权限选择验收");
  await page.getByRole("button", { name: "创建会话" }).click();
  const snapshot = await (await page.request.get("/api/snapshot")).json();
  const session = snapshot.sessions.find(
    (s: { title: string }) => s.title === "OpenCode 权限选择验收",
  );
  try {
    expect(session.permissionMode).toBe("opencode-deny");
    await expect(page.getByRole("button", { name: "会话权限" })).toContainText("禁用工具");
    await page.getByRole("button", { name: "会话权限" }).click();
    await page.getByRole("button", { name: /逐项询问/ }).click();
    await expect
      .poll(async () => {
        const latest = await (await page.request.get("/api/snapshot")).json();
        return latest.sessions.find((s: { id: string }) => s.id === session.id)?.permissionMode;
      })
      .toBe("opencode-ask");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "添加附件、权限或模板", exact: true }).click();
    await page
      .getByRole("dialog", { name: "添加与设置" })
      .getByRole("button", { name: "会话权限" })
      .click();
    await expect(page.getByRole("button", { name: /原生代理规则/ })).toBeVisible();
    await page.screenshot({
      path: "../../output/playwright/opencode-permissions-mobile.png",
      animations: "disabled",
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const invalid = await page.request.patch(`/api/sessions/${session.id}`, {
      data: { permissionMode: "full-access" },
    });
    expect(invalid.status()).toBe(501);
  } finally {
    await page.request.delete(`/api/sessions/${session.id}`);
  }
});

test("ACP offers only modes reported by a connected native session", async ({ page }) => {
  await page.goto("/");
  await page.locator(".new-conversation").click();
  await page.getByRole("button", { name: "Harness", exact: true }).click();
  await page.locator('.ios-popover [role="option"][data-value="gemini"]').click();
  await page.getByRole("button", { name: "会话权限" }).click();
  await expect(page.locator(".ios-popover .ios-menu__section-label")).toHaveText("原生运行模式");
  await expect(page.getByText("ACP · 待连接", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /自动允许/ })).toHaveCount(0);
});

test("Kimi draft offers Server permission modes without ACP wording", async ({ page }) => {
  await page.goto("/");
  await page.locator(".new-conversation").click();
  await page.getByRole("button", { name: "Harness", exact: true }).click();
  await page.locator('.ios-popover [role="option"][data-value="kimi-code"]').click();
  await page.getByRole("button", { name: "会话权限" }).click();
  await expect(page.getByText("ACP · 待连接", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "逐项审批" })).toBeVisible();
  await page.getByRole("button", { name: "逐项审批" }).click();
  await expect(page.getByRole("button", { name: "会话权限" })).toContainText("逐项审批");
  await page.getByLabel("标题", { exact: true }).fill("Kimi Server 权限草稿验收");
  await page.getByRole("button", { name: "创建会话" }).click();
  const snapshot = await (await page.request.get("/api/snapshot")).json();
  const session = snapshot.sessions.find(
    (item: { title: string }) => item.title === "Kimi Server 权限草稿验收",
  );
  try {
    expect(session.permissionMode).toBe("kimi:manual");
  } finally {
    await page.request.delete(`/api/sessions/${session.id}`);
  }
});

test("pi tool rules are available in new and existing conversations", async ({ page }) => {
  await page.goto("/");
  await page.locator(".new-conversation").click();
  await page.getByRole("button", { name: "Harness", exact: true }).click();
  await page.locator('.ios-popover [role="option"][data-value="pi"]').click();
  await page.getByRole("button", { name: "会话权限" }).click();
  await expect(page.locator(".ios-popover .ios-menu__section-label")).toHaveText("工具使用规则");
  await page.getByRole("button", { name: /仅阅读工具/ }).click();
  await page.getByLabel("标题", { exact: true }).fill("pi 工具规则验收");
  await page.getByRole("button", { name: "创建会话" }).click();
  const snapshot = await (await page.request.get("/api/snapshot")).json();
  const session = snapshot.sessions.find((s: { title: string }) => s.title === "pi 工具规则验收");
  try {
    expect(session.permissionMode).toBe("kodo-tools-read");
    await page.getByRole("button", { name: "会话权限" }).click();
    await page.getByRole("button", { name: /禁用工具/ }).click();
    await expect
      .poll(async () => {
        const latest = await (await page.request.get("/api/snapshot")).json();
        return latest.sessions.find((s: { id: string }) => s.id === session.id)?.permissionMode;
      })
      .toBe("kodo-tools-none");
  } finally {
    await page.request.delete(`/api/sessions/${session.id}`);
  }
});

test("settings HTTP receipts reconcile a lost acknowledgement and reject concurrent edits", async ({
  request,
}) => {
  const session = await (
    await request.post("/api/sessions", {
      data: { title: "模型 CAS", harnessId: "pi", kind: "direct", bindingId: null },
    })
  ).json();
  const body = {
    requestId: crypto.randomUUID(),
    expectedRevision: 0,
    model: "openai/gpt-5",
    reasoning: null,
  };
  const path = `/api/sessions/${session.id}/settings`;
  const a = await request.post(path, { data: body });
  expect(a.ok()).toBe(true);
  const b = await request.post(path, { data: body });
  expect(await a.json()).toEqual(await b.json());
  const receipt = await request.get(`${path}?requestId=${body.requestId}`);
  expect((await receipt.json()).settingsRevision).toBe(1);
  const stale = await request.post(path, { data: { ...body, requestId: crypto.randomUUID() } });
  expect(stale.status()).toBe(409);
  await request.delete(`/api/sessions/${session.id}`);
});

test("switching from model popover to reasoning popover during slow discovery does not lock the reasoning slider", async ({
  page,
}) => {
  const session = await (
    await page.request.post("/api/sessions", {
      data: {
        title: "慢发现切换思考强度",
        harnessId: "pi",
        kind: "direct",
        bindingId: null,
        model: "openai/gpt-5",
      },
    })
  ).json();
  let releaseDiscover!: () => void;
  const discoverGate = new Promise<void>((resolve) => {
    releaseDiscover = resolve;
  });
  let discoverSeen = false;
  await page.route(`**/api/sessions/${session.id}/settings?discover=1`, async (route) => {
    discoverSeen = true;
    await discoverGate;
    await route.continue();
  });
  try {
    await page.goto("/");
    await page.locator(".session-row").filter({ hasText: session.title }).click();
    await page.getByRole("button", { name: "模型配置", exact: true }).click();
    await expect.poll(() => discoverSeen).toBe(true);
    // Switch directly to reasoning while ?discover=1 is still in flight.
    await page.getByRole("button", { name: "思考强度", exact: true }).click();
    releaseDiscover();
    const slider = page
      .locator(".ms-popover--reasoning")
      .getByRole("slider", { name: "会话思考强度" });
    await expect(slider).toBeEnabled();
  } finally {
    releaseDiscover();
    await page.request.delete(`/api/sessions/${session.id}`);
  }
});
