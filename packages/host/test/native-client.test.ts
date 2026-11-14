import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { once } from "node:events";
import { Store } from "../src/storage/store.js";
import { SessionService } from "../src/session-service.js";
import { createHostServer } from "../src/http/server.js";
import { nativeActions } from "../src/devices/native-client.js";
import { PROTOCOL_VERSION, type InboxItem } from "@kodo/protocol";

test("native pairing delivers bearer once, rejects browser origins, survives revoke without exposing browser tokens", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-native-"));
  const store = new Store(":memory:");
  const service = new SessionService(store, { dataDir: dir, adapters: [] });
  const server = createHostServer(service, {
    port: 4310,
    webRoot: dir,
    publicOrigin: "https://kooyu.test",
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    new Promise<{ status: number; value: any; headers: Record<string, any> }>((resolve, reject) => {
      const r = request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method,
          headers: {
            host: "127.0.0.1:4310",
            ...(body === undefined ? {} : { "content-type": "application/json" }),
            ...headers,
          },
        },
        (response) => {
          let data = "";
          response.on("data", (v) => {
            data += v;
          });
          response.on("end", () =>
            resolve({
              status: response.statusCode!,
              value: JSON.parse(data),
              headers: response.headers,
            }),
          );
        },
      );
      r.on("error", reject);
      r.end(body === undefined ? undefined : JSON.stringify(body));
    });
  const remote = { host: "kooyu.test", "x-forwarded-for": "192.0.2.1" };
  try {
    assert.equal((await call("/api/health")).value.protocolVersion, PROTOCOL_VERSION);
    const invitation = (await call("/api/pairing", "POST", {})).value;
    assert.equal(
      (
        await call(
          "/api/pair/native",
          "POST",
          { code: invitation.code, name: "Browser" },
          { ...remote, origin: "https://kooyu.test" },
        )
      ).status,
      401,
    );
    const paired = await call(
      "/api/pair/native",
      "POST",
      { code: invitation.code, name: "Native fixture" },
      remote,
    );
    assert.equal(paired.status, 201);
    assert.equal(paired.value.protocolVersion, PROTOCOL_VERSION);
    assert.equal(paired.value.hostId, store.hostId);
    assert.match(paired.value.token, /^[A-Za-z0-9_-]{40,}$/);
    assert.equal(paired.headers["set-cookie"], undefined);
    assert.equal(paired.headers["cache-control"], "no-store");
    assert.equal(
      JSON.stringify(store.records("device-secret")).includes(paired.value.token),
      false,
    );
    assert.equal(
      (await call("/api/pair/native", "POST", { code: invitation.code, name: "Replay" }, remote))
        .status,
      401,
    );
    assert.equal((await call("/api/native/snapshot", "GET", undefined, remote)).status, 401);
    const headers = { ...remote, authorization: "Bearer " + paired.value.token };
    const snapshot = await call("/api/native/snapshot", "GET", undefined, headers);
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.value.hostId, store.hostId);
    // Exercise the mobile workbench using its remote bearer, including the permission route.
    const project = await call(
      "/api/projects",
      "POST",
      { name: "Mobile project", rootPath: dir },
      headers,
    );
    assert.equal(project.status, 201);
    const workspace = (
      await call("/api/native/snapshot", "GET", undefined, headers)
    ).value.workspaces.find((w: any) => w.projectId === project.value.id);
    const draft = await call(
      "/api/sessions",
      "POST",
      {
        title: "Mobile draft",
        harnessId: "kodo",
        kind: "supervisor",
        projectId: project.value.id,
        workspaceId: workspace.id,
      },
      headers,
    );
    assert.equal(draft.status, 201);
    assert.equal(
      (await call(`/api/sessions/${draft.value.id}/permissions`, "GET", undefined, headers)).status,
      200,
    );
    assert.equal(
      (
        await call(
          `/api/sessions/${draft.value.id}`,
          "PATCH",
          { title: "Renamed", pinned: true },
          headers,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await call(
          `/api/sessions/${draft.value.id}`,
          "PATCH",
          { permissionMode: "kodo-tools-read" },
          headers,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await call(
          `/api/sessions/${draft.value.id}`,
          "PATCH",
          { title: "Mixed invalid update", permissionMode: null },
          headers,
        )
      ).status,
      400,
    );
    assert.equal(
      (await call(`/api/sessions/${draft.value.id}?tail=300`, "GET", undefined, headers)).status,
      200,
    );
    assert.equal((await call("/api/usage", "GET", undefined, headers)).status, 200);
    assert.equal(
      (await call("/api/budgets", "POST", { projectId: project.value.id, usd: 10 }, headers))
        .status,
      201,
    );
    assert.equal(
      (await call("/api/provider-configuration", "GET", undefined, headers)).status,
      200,
    );
    const settings = await call("/api/app-settings", "GET", undefined, headers);
    assert.equal(settings.status, 200);
    assert.equal(
      (
        await call(
          "/api/app-settings",
          "PATCH",
          { ...settings.value, defaultHarnessId: "kodo", personalInstructions: "Mobile parity" },
          headers,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await call("/api/native/snapshot", "GET", undefined, {
          ...headers,
          "x-kooyu-protocol": String(PROTOCOL_VERSION - 1),
        })
      ).status,
      409,
    );
    assert.equal((await call("/api/devices/" + paired.value.device.id, "DELETE")).status, 200);
    assert.equal((await call("/api/native/snapshot", "GET", undefined, headers)).status, 401);
    const webInvite = (await call("/api/pairing", "POST", {})).value;
    const browser = await call(
      "/api/pair",
      "POST",
      { code: webInvite.code, name: "Web fixture" },
      remote,
    );
    assert.equal(browser.status, 201);
    assert.equal(browser.value.token, undefined);
    assert.match(browser.headers["set-cookie"][0], /HttpOnly; SameSite=Strict/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("native action projection preserves protocol-specific approval semantics and refuses unknown questions", () => {
  const item = (payload: unknown, resolved = false) =>
    ({
      id: "test",
      sessionId: "test",
      type: "interaction",
      createdAt: "",
      resolved,
      payload,
    }) as InboxItem;
  assert.deepEqual(
    nativeActions(item({ protocol: "codex", method: "item/commandExecution/requestApproval" }))[0]
      ?.answer,
    { decision: "accept" },
  );
  assert.deepEqual(nativeActions(item({ protocol: "claude" }))[1]?.answer, { behavior: "deny" });
  assert.deepEqual(
    nativeActions(item({ protocol: "opencode", type: "permission.asked" }))[0]?.answer,
    { reply: "once" },
  );
  assert.deepEqual(
    nativeActions(item({ protocol: "acp", options: [{ optionId: "once", name: "Allow" }] }))[0]
      ?.answer,
    { outcome: { outcome: "selected", optionId: "once" } },
  );
  assert.deepEqual(nativeActions(item({ protocol: "claude", toolName: "AskUserQuestion" })), []);
  assert.deepEqual(
    nativeActions(item({ protocol: "unrecognized", method: "approval/request" })),
    [],
  );
  assert.deepEqual(nativeActions(item({ protocol: "__proto__", method: "approval/request" })), []);
  assert.deepEqual(nativeActions(item({ protocol: "acp", options: [null, 0, {}] })), [
    { label: "取消请求", answer: { outcome: { outcome: "cancelled" } }, destructive: true },
  ]);
  assert.deepEqual(
    nativeActions(
      item({ protocol: "codex", method: "item/commandExecution/requestApproval" }, true),
    ),
    [],
  );
});
