import { expect, test } from "@playwright/test";

test("conversation composer uploads files to the Host and sends only their IDs", async ({
  page,
  request,
}) => {
  const session = await (
    await request.post("/api/sessions", {
      data: { title: "附件会话", harnessId: "codex", kind: "direct" },
    })
  ).json();
  let sent: { text: string; attachmentIds?: string[] } | undefined;
  await page.route(`**/api/sessions/${session.id}/send`, async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: (sent as { requestId?: string }).requestId,
        sessionId: session.id,
        kind: "send",
        origin: "user",
        controllerId: null,
        generation: 0,
        bindingRevision: null,
        status: "accepted",
        nativeRunId: null,
        body: { text: sent?.text, mode: "new" },
        createdAt: new Date().toISOString(),
      }),
    });
  });
  await page.addInitScript((id) => localStorage.setItem("kodo.session", id), session.id);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "附件会话", level: 1 })).toBeVisible();
  const big = Buffer.alloc(1_200_000, 7); // spans several upload chunks
  await page.getByLabel("选择附件").setInputFiles([
    { name: "data.bin", mimeType: "application/octet-stream", buffer: big },
    { name: "shot.png", mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71, 13, 10]) },
  ]);
  const list = page.getByLabel("附件", { exact: true });
  await expect(list).toContainText("data.bin");
  await expect(list).toContainText("shot.png");
  await page.getByRole("button", { name: "移除附件 shot.png" }).click();
  await expect(list).not.toContainText("shot.png");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect.poll(() => sent?.attachmentIds?.length).toBe(1);
  expect(sent!.text).toBe("");
  const file = await (await request.get(`/api/files/${sent!.attachmentIds![0]}`)).json();
  expect(file.displayName).toBe("data.bin");
  expect(file.size).toBe(big.length);
  expect(file.sessionId).toBe(session.id);
  await expect(list).toHaveCount(0);
});
