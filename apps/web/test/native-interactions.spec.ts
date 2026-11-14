import { test, expect, type Page } from "@playwright/test";
test.use({ locale: "zh-CN" });

async function interaction(page: Page, payload: Record<string, unknown>) {
  const session = await (
    await page.request.post("/api/sessions", {
      data: { title: "Native interaction verification", harnessId: "kodo", kind: "supervisor" },
    })
  ).json();
  const received: unknown[] = [],
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/snapshot", async (route) => {
    const response = await route.fetch(),
      snapshot = await response.json();
    if (!received.length)
      snapshot.inbox.push({
        id: session.id + ":native-question",
        sessionId: session.id,
        type: "interaction",
        resolved: false,
        createdAt: new Date().toISOString(),
        payload,
      });
    await route.fulfill({ response, json: snapshot });
  });
  await page.route("**/api/interactions/**", async (route) => {
    received.push(route.request().postDataJSON().answer);
    await route.fulfill({ json: { status: "processed" } });
  });
  await page.addInitScript((id) => localStorage.setItem("kodo.session", id), session.id);
  await page.goto("/");
  await expect(page.locator(".interaction").first()).toBeVisible();
  return {
    received,
    errors,
    close: async () => {
      await page.unrouteAll({ behavior: "wait" });
      await page.request.delete("/api/sessions/" + session.id);
    },
  };
}

for (const mobile of [false, true])
  for (const protocol of ["codex", "claude", "opencode"]) {
    test(
      protocol + " questions submit native answers on " + (mobile ? "phone" : "desktop"),
      async ({ page }) => {
        if (mobile) await page.setViewportSize({ width: 390, height: 844 });
        const question = "选择数据存储方式，并确认离线使用和多设备同步的需求？";
        const questions = [
          {
            id: "__proto__",
            question,
            header: "存储",
            isOther: true,
            multiSelect: true,
            multiple: true,
            options: [
              { label: "本地存储", description: "在当前设备保存，离线时仍可访问。" },
              { label: "远程同步", description: "在多台设备之间同步，需要网络连接。" },
            ],
          },
        ];
        const payload =
          protocol === "claude"
            ? { protocol, toolName: "AskUserQuestion", input: { questions } }
            : {
                protocol,
                method: "item/tool/requestUserInput",
                type: "question.asked",
                params: { questions },
              };
        const f = await interaction(page, payload);
        try {
          const card = page.locator(".interaction").first();
          await expect(card.getByRole("button", { name: "提交回答", exact: true })).toBeDisabled();
          await card
            .getByRole(protocol === "codex" ? "radio" : "checkbox", { name: /本地存储/ })
            .check();
          if (protocol !== "codex") await card.getByRole("checkbox", { name: /远程同步/ }).check();
          await expect(card.getByRole("button", { name: "提交回答", exact: true })).toBeEnabled();
          if (protocol === "codex") {
            await card
              .getByRole("textbox", { name: question + "：其他回答", exact: true })
              .fill("自建服务");
            await expect(card.getByRole("radio", { name: /本地存储/ })).not.toBeChecked();
          }
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          if (protocol === "opencode")
            await page.screenshot({
              path: "../../.local/native-questions-" + (mobile ? "mobile" : "desktop") + ".png",
              fullPage: true,
            });
          await card.getByRole("button", { name: "提交回答", exact: true }).click();
          await expect.poll(() => f.received.length).toBe(1);
          expect(f.received[0]).toEqual(
            protocol === "codex"
              ? { answers: Object.fromEntries([["__proto__", { answers: ["自建服务"] }]]) }
              : protocol === "claude"
                ? {
                    behavior: "allow",
                    updatedInput: { answers: { [question]: "本地存储, 远程同步" } },
                  }
                : { answers: [["本地存储", "远程同步"]] },
          );
          expect(f.errors).toEqual([]);
        } finally {
          await f.close();
        }
      },
    );
  }
test("OpenCode approvals send once and cancelled questions have explicit rejection semantics", async ({
  page,
}) => {
  const f = await interaction(page, {
    protocol: "opencode",
    type: "permission.asked",
    params: { permission: "read", patterns: ["workspace.txt"] },
  });
  try {
    await page
      .locator(".interaction")
      .first()
      .getByRole("button", { name: "允许本次", exact: true })
      .click();
    await expect.poll(() => f.received).toEqual([{ reply: "once" }]);
  } finally {
    await f.close();
  }
});
test("OpenCode questions can be cancelled without selecting a fabricated answer", async ({
  page,
}) => {
  const f = await interaction(page, {
    protocol: "opencode",
    type: "question.asked",
    params: { questions: [{ question: "选择环境", options: [{ label: "测试" }], custom: false }] },
  });
  try {
    await page
      .locator(".interaction")
      .first()
      .getByRole("button", { name: "取消回答", exact: true })
      .click();
    await expect.poll(() => f.received).toEqual([{ cancelled: true }]);
  } finally {
    await f.close();
  }
});
test("ACP permissions can be cancelled and invalid structured JSON stays editable", async ({
  page,
}) => {
  const f = await interaction(page, {
    protocol: "acp",
    method: "session/request_permission",
    params: { toolCall: { title: "Read workspace.txt" } },
    options: [{ optionId: "allow_once", name: "允许读取" }],
  });
  try {
    const card = page.locator(".interaction").first();
    await card.getByRole("button", { name: "结构化回答", exact: true }).click();
    await card.getByRole("textbox", { name: "原生回答 JSON" }).fill("{invalid");
    await card.getByRole("button", { name: "提交回答", exact: true }).click();
    await expect(card.getByRole("alert")).toContainText("JSON 格式无效");
    expect(f.received).toEqual([]);
    await expect(card.getByRole("textbox", { name: "原生回答 JSON" })).toHaveValue("{invalid");
    await card.getByRole("button", { name: "取消请求", exact: true }).click();
    await expect.poll(() => f.received).toEqual([{ outcome: { outcome: "cancelled" } }]);
  } finally {
    await f.close();
  }
});

for (const mobile of [false, true])
  test(
    "Kimi native option IDs, combined answers and skip on " + (mobile ? "phone" : "desktop"),
    async ({ page }) => {
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      const f = await interaction(page, {
        protocol: "kimi",
        method: "question/request",
        params: {
          questions: [
            {
              id: "__proto__",
              question: "选择需要支持的运行环境",
              body: "可同时选择多个环境，并补充其他要求。",
              multi_select: true,
              allow_other: true,
              options: [
                { id: "local-id", label: "本地运行" },
                { id: "remote-id", label: "远程执行" },
              ],
            },
            {
              id: "skip-me",
              question: "是否补充部署方案？",
              options: [
                { id: "yes", label: "是" },
                { id: "no", label: "否" },
              ],
            },
          ],
        },
      });
      try {
        const card = page.locator(".interaction").first();
        await card.getByRole("checkbox", { name: "本地运行" }).check();
        await card
          .getByRole("textbox", { name: "选择需要支持的运行环境：其他回答" })
          .fill("还需要离线使用");
        await expect(card.getByRole("checkbox", { name: "本地运行" })).toBeChecked();
        await card
          .getByRole("group", { name: "是否补充部署方案？" })
          .getByRole("button", { name: "跳过此题" })
          .click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path:
            "../../.local/verification/kimi-questions-" + (mobile ? "mobile" : "desktop") + ".png",
          fullPage: true,
        });
        await card.getByRole("button", { name: "提交回答", exact: true }).click();
        await expect
          .poll(() => f.received)
          .toEqual([
            {
              method: "click",
              answers: Object.fromEntries([
                [
                  "__proto__",
                  {
                    kind: "multi_with_other",
                    option_ids: ["local-id"],
                    other_text: "还需要离线使用",
                  },
                ],
                ["skip-me", { kind: "skipped" }],
              ]),
            },
          ]);
        expect(f.errors).toEqual([]);
      } finally {
        await f.close();
      }
    },
  );

test("Kimi single choice submits its ID and cancellation dismisses the native question", async ({
  page,
}) => {
  for (const cancel of [false, true]) {
    const f = await interaction(page, {
      protocol: "kimi",
      method: "question/request",
      params: {
        questions: [
          {
            id: "environment",
            question: "选择部署环境",
            options: [
              { id: "dev", label: "开发" },
              { id: "prod", label: "生产" },
            ],
          },
        ],
      },
    });
    try {
      const card = page.locator(".interaction").first();
      if (cancel) await card.getByRole("button", { name: "取消回答" }).click();
      else {
        await card.getByRole("radio", { name: "开发" }).check();
        await card.getByRole("button", { name: "提交回答", exact: true }).click();
      }
      await expect
        .poll(() => f.received)
        .toEqual(
          cancel
            ? [{ cancelled: true }]
            : [{ method: "click", answers: { environment: { kind: "single", option_id: "dev" } } }],
        );
    } finally {
      await f.close();
    }
  }
});
