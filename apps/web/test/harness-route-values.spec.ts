import { expect, test } from "@playwright/test";
import { HARNESS_IDS, type HarnessId } from "@kodo/protocol";
import { modelOptionValue } from "../src/lib/harnesses";

test("every harness serializes its model selection without losing or doubling the provider", () => {
  for (const harnessId of HARNESS_IDS) {
    const routed = ["kodo", "pi", "opencode", "zcode", "deepseek-harness"].includes(harnessId);
    expect(
      modelOptionValue(harnessId, { id: "model", provider: "vendor", source: "discovered" }),
    ).toBe(routed ? "vendor/model" : "model");
    expect(
      modelOptionValue(harnessId, { id: "vendor/model", provider: "vendor", source: "discovered" }),
    ).toBe("vendor/model");
    expect(
      modelOptionValue(harnessId, { id: "model", provider: "kodo-binding", source: "discovered" }),
    ).toBe("model");
    expect(
      modelOptionValue(harnessId, { id: "model", provider: "vendor", source: "discovered" }, true),
    ).toBe("model");
  }
});

for (const harnessId of ["deepseek-harness", "opencode", "zcode"] as HarnessId[])
  test(`${harnessId} draft keeps provider route and permissions in saved session`, async ({
    page,
  }) => {
    await page.route(`**/api/harnesses/${harnessId}/models?*`, (route) =>
      route.fulfill({
        json: {
          harnessId,
          modelSupport: "native-models",
          defaultModel: null,
          models: [
            { id: "model-a", provider: "vendor", name: "Native route test", source: "discovered" },
          ],
        },
      }),
    );
    await page.addInitScript((id) => localStorage.setItem("kodo.draftHarness", id), harnessId);
    await page.goto("/");
    await page.getByRole("button", { name: "新建会话", exact: true }).first().click();
    // The normal harness picker is shared with all other draft flows.
    await page.getByRole("button", { name: "Harness", exact: true }).click();
    await page
      .getByRole("option", {
        name: new RegExp(
          harnessId === "deepseek-harness"
            ? "DeepSeek"
            : harnessId === "opencode"
              ? "OpenCode"
              : "ZCode",
        ),
      })
      .click();
    await page.getByRole("button", { name: "模型配置", exact: true }).click();
    await page.getByRole("option", { name: /Native route test|model-a/ }).click();
    if (harnessId === "deepseek-harness") {
      await page.getByRole("button", { name: "会话权限", exact: true }).click();
      await page.getByRole("button", { name: /自动允许/ }).click();
    }
    // Save via the existing draft action; no native model request is sent by this test.
    const saved = page.waitForRequest(
      (r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/sessions",
    );
    await page.getByTitle("保存空草稿", { exact: true }).click();
    const input = (await saved).postDataJSON();
    expect(input.model).toBe("vendor/model-a");
    if (harnessId === "deepseek-harness") expect(input.permissionMode).toBe("dsh:allow");
  });
