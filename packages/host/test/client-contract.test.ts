import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { KodoError, type HarnessBinding } from "@kodo/protocol";
import { Store } from "../src/storage/store.js";
import { SessionService } from "../src/session-service.js";
import { createHostServer } from "../src/http/server.js";
import { operationAccess } from "../src/clients/access.js";
import { ClientOperations } from "../src/clients/operations.js";
import { NativeSync } from "../src/clients/sync.js";
import { goalDetail } from "../src/clients/details.js";
import { nativeSnapshot } from "../src/devices/native-client.js";
import { workbenchOverview } from "../src/clients/workbench.js";
import { descriptor } from "../src/harnesses/adapter.js";

const local = { local: true, deviceId: "desktop" };
const sha = (v: Buffer | string) => createHash("sha256").update(v).digest("hex");

test("schedule authorization is explicit and local-only while paired preview remains available", async () => {
  const f = await setup();
  try {
    const phone = await f.pair();
    const input = { requestId: randomUUID(), controllerSessionId: f.controller.id };
    assert.equal(
      (await f.call("/api/automations/authorize", "POST", input, phone.headers)).status,
      401,
    );
    assert.equal(f.service.permissions.grants.all().length, 0);
    const preview = {
      ...input,
      name: "Schedule",
      promptTemplate: "Review project",
      timeZone: "Asia/Shanghai",
      trigger: { kind: "interval", every: 90, unit: "minutes", startAt: "2027-01-01T00:00:00Z" },
    };
    const response = await f.call("/api/automations/preview", "POST", preview, phone.headers);
    assert.equal(response.status, 200);
    assert.equal(response.value.occurrences.length, 3);
    assert.equal(f.service.permissions.grants.all().length, 0);
    const grant = await f.call("/api/automations/authorize", "POST", input);
    assert.equal(grant.status, 201);
    assert.equal(
      (await f.call("/api/automations/authorize", "POST", input)).value.id,
      grant.value.id,
    );
    assert.equal(f.service.permissions.grants.all().length, 1);
  } finally {
    await f.close();
  }
});

test("workbench scopes projects, preserves artifact provenance and exposes no execution side effects", async () => {
  const f = await setup();
  try {
    const phone = await f.pair();
    const other = f.service.createProject({ name: "Other" });
    const otherController = f.service.createDraft({
      title: "Other controller",
      harnessId: "kodo",
      kind: "supervisor",
      projectId: other.id,
    });
    const goal = await f.service.goals.create(
      { requestId: randomUUID(), controllerSessionId: f.controller.id, title: "Deliver report" },
      "user",
    );
    await f.service.goals.create(
      { requestId: randomUUID(), controllerSessionId: otherController.id, title: "Other work" },
      "user",
    );
    writeFileSync(join(f.dir, "hub-result.md"), "Verified source");
    const artifact = await f.service.files.publish(
      {
        requestId: randomUUID(),
        goalId: goal.id,
        workspaceId: f.workspace.id,
        path: "hub-result.md",
        title: "Report",
      },
      "user",
    );
    f.service.memory.save(
      {
        requestId: randomUUID(),
        scope: "user",
        subject: "Global",
        content: "Shared",
        sourceRefs: ["user"],
        status: "confirmed",
      },
      "user",
    );
    f.service.memory.save(
      {
        requestId: randomUUID(),
        scope: "project",
        projectId: other.id,
        subject: "Other convention",
        content: "Only other",
        sourceRefs: ["user"],
        status: "confirmed",
      },
      "user",
    );
    const result = await f.call(
      `/api/workbench?projectId=${f.project.id}`,
      "GET",
      undefined,
      phone.headers,
    );
    assert.equal(result.status, 200);
    assert.deepEqual(
      result.value.goals.map((g: any) => g.id),
      [goal.id],
    );
    assert.equal(result.value.artifacts[0].artifact.id, artifact.id);
    assert.equal(result.value.artifacts[0].available, true);
    assert.equal(result.value.artifacts[0].artifact.goalId, goal.id);
    assert.equal(result.value.memories.length, 1);
    const all = (await f.call("/api/workbench", "GET", undefined, phone.headers)).value;
    assert.equal(all.memories.length, 2, "global memory is not duplicated across projects");
    assert.equal(all.goals.length, 2);
    // A busy unrelated project must not consume the current project's result limit.
    const insert = f.store.db.prepare("INSERT INTO artifacts VALUES (?,?,?,?,?,?,?,?)");
    f.store.transaction(() => {
      for (let i = 0; i < 501; i++) {
        const copy = {
          ...artifact,
          id: randomUUID(),
          goalId: null,
          sessionId: otherController.id,
          createdAt: "2099-01-01T00:00:00.000Z",
        };
        insert.run(
          copy.id,
          copy.fileId,
          null,
          copy.sessionId,
          copy.id,
          1,
          copy.createdAt,
          JSON.stringify(copy),
        );
      }
    });
    const bounded = workbenchOverview(f.service, f.project.id, local);
    assert.deepEqual(
      bounded.artifacts.map((item) => item.artifact.id),
      [artifact.id],
    );
    assert.equal(f.launches(), 0);
    assert.equal(
      (await f.call("/api/workbench?projectId=invalid", "GET", undefined, phone.headers)).status,
      400,
    );
    assert.equal(
      (await f.call(`/api/workbench?projectId=${randomUUID()}`, "GET", undefined, phone.headers))
        .status,
      404,
    );
    f.store.put("deleted-session", f.controller.id, { id: f.controller.id });
    const after = workbenchOverview(f.service, null, local);
    assert.ok(!after.goals.some((g) => g.id === goal.id));
    assert.ok(!after.artifacts.some((a) => a.artifact.id === artifact.id));
  } finally {
    await f.close();
  }
});

test("paired workbench mutations reconcile plan pauses, memory edits and goal reviews by receipt", async () => {
  const f = await setup();
  try {
    const phone = await f.pair();
    const grant = f.service.permissions.create({
      requestId: randomUUID(),
      controllerSessionId: f.controller.id,
      operations: ["automation.execute"],
      resources: [`session:${f.controller.id}`],
    });
    const plan = f.service.automations.save({
      requestId: randomUUID(),
      name: "Daily review",
      controllerSessionId: f.controller.id,
      promptTemplate: "Review project",
      trigger: { kind: "cron", expression: "0 9 * * *" },
      timeZone: "Asia/Shanghai",
      grantId: grant.id,
    });
    const input = {
      requestId: randomUUID(),
      method: "POST",
      path: `/api/automations/${plan.id}/pause`,
      body: { expectedRevision: plan.revision },
    };
    const first = await f.call("/api/client/operations", "POST", input, phone.headers);
    const replay = await f.call("/api/client/operations", "POST", input, phone.headers);
    assert.equal(first.value.status, "confirmed");
    assert.deepEqual(first.value, replay.value);
    assert.equal(f.service.automations.definitions.get(plan.id).revision, plan.revision + 1);
    assert.equal(f.service.automations.definitions.get(plan.id).enabled, false);
    const mem = {
      requestId: randomUUID(),
      method: "POST",
      path: "/api/memory",
      body: {
        scope: "project",
        projectId: f.project.id,
        subject: "Test policy",
        content: "Run relevant checks",
        sourceRefs: ["user"],
        status: "confirmed",
      },
    };
    const saved = (await f.call("/api/client/operations", "POST", mem, phone.headers)).value;
    assert.equal(saved.status, "confirmed");
    assert.equal(
      (await f.call("/api/client/operations", "POST", mem, phone.headers)).value.result.id,
      saved.result.id,
    );
    const stale = await f.call(
      "/api/client/operations",
      "POST",
      {
        requestId: randomUUID(),
        method: "PATCH",
        path: `/api/memory/${saved.result.id}`,
        body: { ...mem.body, expectedRevision: 99 },
      },
      phone.headers,
    );
    assert.equal(stale.value.status, "failed");
    assert.equal(stale.value.error.code, "CONFLICT");
    const goal = await f.service.goals.create(
      { requestId: randomUUID(), controllerSessionId: f.controller.id, title: "Manual review" },
      "user",
    );
    const review = {
      requestId: randomUUID(),
      method: "POST",
      path: `/api/goals/${goal.id}/review`,
      body: {
        decision: "accept",
        expectedRevision: goal.revision,
        remainingUncertainty: "No automated checks recorded",
      },
    };
    assert.equal(
      (await f.call("/api/client/operations", "POST", review, phone.headers)).value.result.status,
      "completed",
    );
    assert.equal(
      (await f.call("/api/client/operations", "POST", review, phone.headers)).value.status,
      "confirmed",
    );
    f.service.lifecycle.quiesce();
    assert.equal(
      (
        await f.call(
          `/api/automations/${plan.id}/run`,
          "POST",
          { requestId: randomUUID() },
          phone.headers,
        )
      ).status,
      503,
    );
    assert.equal(
      (
        await f.call(
          "/api/client/operations",
          "POST",
          { requestId: randomUUID(), method: "POST", path: `/api/automations/${plan.id}/run` },
          phone.headers,
        )
      ).status,
      503,
    );
    assert.equal(f.launches(), 0);
  } finally {
    await f.close();
  }
});
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-contract-"));
  const store = new Store(":memory:");
  let launches = 0;
  const service = new SessionService(store, {
    dataDir: join(dir, "data"),
    adapters: [
      ...(["codex", "gemini"] as const).map((id) => ({
        descriptor: descriptor(id, id, "acp", [], "test", "implemented"),
        connect: async () => {
          launches++;
          throw new Error("Read must not launch a harness");
        },
      })),
    ],
  });
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
    new Promise<{ status: number; value: any; raw: Buffer; headers: Record<string, any> }>(
      (resolve, reject) => {
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
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("error", reject);
            res.on("end", () => {
              const raw = Buffer.concat(chunks);
              resolve({
                status: res.statusCode!,
                value:
                  raw.length && String(res.headers["content-type"]).startsWith("application/json")
                    ? JSON.parse(raw.toString())
                    : undefined,
                raw,
                headers: res.headers,
              });
            });
          },
        );
        r.on("error", reject);
        r.end(body === undefined ? undefined : JSON.stringify(body));
      },
    );
  const pair = async () => {
    const invitation = (await call("/api/pairing", "POST", {})).value;
    const result = await call(
      "/api/pair/native",
      "POST",
      { code: invitation.code, name: "Contract phone" },
      { host: "kooyu.test" },
    );
    assert.equal(result.status, 201);
    return {
      deviceId: result.value.device.id as string,
      headers: { host: "kooyu.test", authorization: `Bearer ${result.value.token}` },
    };
  };
  const project = service.createProject({ name: "Contract", rootPath: dir });
  const workspace = store.workspaces().find((w) => w.projectId === project.id)!;
  const controller = service.createDraft({
    title: "Controller",
    harnessId: "kodo",
    kind: "supervisor",
    projectId: project.id,
    workspaceId: workspace.id,
  });
  const close = async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return {
    dir,
    store,
    service,
    call,
    pair,
    project,
    workspace,
    controller,
    close,
    launches: () => launches,
  };
}

test("capabilities preserve old flags, reject unknown operations and enforce device-scoped local delegation", async () => {
  const f = await setup();
  try {
    const phone = await f.pair(),
      other = await f.pair();
    const caps = (await f.call("/api/capabilities", "GET", undefined, phone.headers)).value;
    assert.equal(caps.capabilities.goals, 1);
    assert.equal(caps.capabilities.nativeSync, 1);
    assert.equal(caps.localAdministrator, false);
    assert.equal(caps.operations["goals.check"].allowed, false);
    assert.equal(caps.operations["devices.manage"].allowed, false);
    assert.equal(caps.operations["desktop.control"].supported, false);
    assert.equal(operationAccess(f.service, local, "invented.operation").supported, false);
    const goal = await f.service.goals.create(
      { requestId: randomUUID(), controllerSessionId: f.controller.id, title: "Check" },
      "user",
    );
    const check = {
      requestId: randomUUID(),
      command: 'node -e "process.exit(0)"',
      timeoutSeconds: 10,
    };
    assert.equal(
      (await f.call(`/api/goals/${goal.id}/checks`, "POST", check, phone.headers)).status,
      401,
    );
    const accessPath = `/api/devices/${phone.deviceId}/access`;
    assert.equal(
      (
        await f.call(
          accessPath,
          "PUT",
          { expectedRevision: 0, operations: ["goals.check"] },
          phone.headers,
        )
      ).status,
      401,
    );
    assert.equal(
      (await f.call(accessPath, "PUT", { expectedRevision: 0, operations: ["devices.manage"] }))
        .status,
      400,
    );
    assert.equal(
      (await f.call(accessPath, "PUT", { expectedRevision: 0, operations: ["goals.check"] })).value
        .revision,
      1,
    );
    assert.equal(
      (await f.call(accessPath, "PUT", { expectedRevision: 0, operations: [] })).status,
      409,
    );
    assert.equal(
      (await f.call(`/api/goals/${goal.id}/checks`, "POST", check, other.headers)).status,
      401,
    );
    const result = await f.call(`/api/goals/${goal.id}/checks`, "POST", check, phone.headers);
    assert.equal(result.status, 201);
    assert.equal(result.value.recordedBy, "host");
    assert.equal(result.value.exitCode, 0);
    f.service.lifecycle.quiesce();
    const frozen = (await f.call("/api/capabilities", "GET", undefined, phone.headers)).value
      .operations["goals.check"];
    assert.equal(frozen.allowed, true);
    assert.equal(frozen.available, false);
    assert.equal(
      (
        await f.call(
          `/api/goals/${goal.id}/checks`,
          "POST",
          { ...check, requestId: randomUUID() },
          phone.headers,
        )
      ).status,
      503,
    );
    await f.call(accessPath, "PUT", { expectedRevision: 1, operations: [] });
    assert.equal(
      (await f.call(`/api/goals/${goal.id}/checks`, "POST", check, phone.headers)).status,
      401,
    );
    await f.call(`/api/devices/${phone.deviceId}`, "DELETE");
    assert.equal((await f.call("/api/native/sync", "GET", undefined, phone.headers)).status, 401);
    assert.equal(f.store.record("client-access", phone.deviceId), undefined);
  } finally {
    await f.close();
  }
});

test("native sync reconstructs additions, changes, removals, ordering and goals; lost cursors reset", async () => {
  const f = await setup();
  try {
    const phone = await f.pair();
    const initial = (await f.call("/api/native/sync", "GET", undefined, phone.headers)).value;
    assert.equal(initial.resetRequired, true);
    assert.ok(initial.snapshot.goals);
    const same = (
      await f.call(`/api/native/sync?cursor=${initial.cursor}`, "GET", undefined, phone.headers)
    ).value;
    assert.equal(same.resetRequired, false);
    assert.deepEqual(same.collections, {});
    assert.deepEqual(same.values, {});
    const next = f.service.createProject({ name: "Added" });
    f.service.updateProject(f.project.id, { name: "Changed" });
    await f.service.goals.create(
      { requestId: randomUUID(), controllerSessionId: f.controller.id, title: "Synced" },
      "user",
    );
    const changed = (
      await f.call(`/api/native/sync?cursor=${initial.cursor}`, "GET", undefined, phone.headers)
    ).value;
    assert.equal(changed.baseCursor, initial.cursor);
    assert.equal(changed.collections.projects.upsert.length, 2);
    assert.equal(changed.collections.goals.upsert.length, 1);
    const reconstructed = structuredClone(initial.snapshot);
    for (const [name, delta] of Object.entries(changed.collections) as [string, any][]) {
      const key = (row: any) =>
        name === "projectGrants" ? `${row.controllerSessionId}:${row.projectId}` : row.id;
      const rows = new Map(reconstructed[name].map((row: any) => [key(row), row]));
      delta.remove.forEach((id: string) => rows.delete(id));
      delta.upsert.forEach((row: any) => rows.set(key(row), row));
      reconstructed[name] = delta.order.map((id: string) => rows.get(id));
    }
    Object.assign(reconstructed, changed.values);
    const full = (await f.call("/api/native/sync", "GET", undefined, phone.headers)).value.snapshot;
    assert.deepEqual(reconstructed, full);
    await f.service.deleteProject(next.id, "keep");
    const removed = (
      await f.call(`/api/native/sync?cursor=${changed.cursor}`, "GET", undefined, phone.headers)
    ).value;
    assert.deepEqual(removed.collections.projects.remove, [next.id]);
    assert.equal(
      (await f.call("/api/native/sync?cursor=lost", "GET", undefined, phone.headers)).value
        .resetRequired,
      true,
    );
    assert.equal(
      (await f.call("/api/native/snapshot", "GET", undefined, phone.headers)).value.goals,
      undefined,
    );
    const cache = new NativeSync(1),
      first = cache.read(full);
    cache.read({ ...full, eventCursor: full.eventCursor + 1 });
    assert.equal(cache.read(full, first.cursor).resetRequired, true);
    assert.equal(new NativeSync().read(full, initial.cursor).resetRequired, true);
    assert.equal(new NativeSync(32, 1).read(full, first.cursor).resetRequired, true);
    assert.equal(
      new NativeSync().read({ ...full, hostId: randomUUID() }, first.cursor).resetRequired,
      true,
    );
    f.store.put("removed-project", f.project.id, { id: f.project.id });
    assert.deepEqual((await f.call("/api/native/sync")).value.snapshot.goals, []);
  } finally {
    await f.close();
  }
});

test("management receipts deduplicate concurrent requests, reject conflicts and isolate devices", async () => {
  const f = await setup();
  try {
    const phone = await f.pair(),
      other = await f.pair();
    const input = {
      requestId: randomUUID(),
      method: "POST",
      path: "/api/projects",
      body: { name: "Once", rootPath: f.dir },
    };
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        f.call("/api/client/operations", "POST", input, phone.headers),
      ),
    );
    assert.ok(results.every((r) => r.status === 200 && r.value.status === "confirmed"));
    const id = results[0]!.value.result.id;
    assert.ok(results.every((r) => r.value.result.id === id));
    assert.equal(f.store.projects().filter((p) => p.name === "Once").length, 1);
    const canonical = await f.call(
      "/api/client/operations",
      "POST",
      { ...input, body: { rootPath: f.dir, name: "Once" } },
      phone.headers,
    );
    assert.equal(canonical.value.result.id, id);
    assert.equal(
      (
        await f.call(
          "/api/client/operations",
          "POST",
          { ...input, body: { name: "Different" } },
          phone.headers,
        )
      ).status,
      409,
    );
    assert.equal(
      (await f.call(`/api/client/operations/${input.requestId}`, "GET", undefined, other.headers))
        .status,
      404,
    );
    assert.equal(
      (await f.call("/api/client/operations", "POST", input, other.headers)).value.status,
      "confirmed",
    );
    assert.equal(f.store.projects().filter((p) => p.name === "Once").length, 2);
    for (const path of [
      "/api/pairing",
      "/api/harnesses/codex/install",
      "/internal/resume",
      "/api/sessions/x/send",
      "/api/projects?admin=1",
    ]) {
      assert.equal(
        (
          await f.call(
            "/api/client/operations",
            "POST",
            { ...input, requestId: randomUUID(), path },
            phone.headers,
          )
        ).status,
        501,
      );
    }
    const failed = {
      ...input,
      requestId: randomUUID(),
      body: { name: "Bad", rootPath: "relative/path" },
    };
    assert.equal(
      (await f.call("/api/client/operations", "POST", failed, phone.headers)).value.status,
      "failed",
    );
    assert.equal(
      (await f.call(`/api/client/operations/${failed.requestId}`, "GET", undefined, phone.headers))
        .value.error.code,
      "INVALID_INPUT",
    );
    assert.equal(
      (await f.call(`/api/client/operations/${input.requestId}`, "GET", undefined, phone.headers))
        .value.result.id,
      id,
    );
  } finally {
    await f.close();
  }
});

test("receipts roll back synchronous changes and never replay an uncertain native side effect", async () => {
  const f = await setup();
  try {
    const ops = new ClientOperations(f.service),
      original = f.service.createProject.bind(f.service);
    f.service.createProject = (value) => {
      original(value);
      throw new KodoError("CONFLICT", "Injected transaction failure");
    };
    const failed = await ops.execute(local, {
      requestId: randomUUID(),
      method: "POST",
      path: "/api/projects",
      body: { name: "Rollback" },
    });
    assert.equal(failed.status, "failed");
    assert.equal(failed.result, undefined);
    assert.equal(
      f.store.projects().some((p) => p.name === "Rollback"),
      false,
    );
    f.service.createProject = (value) => {
      const result = original(value);
      f.store.afterCommit(() => {
        throw new KodoError("CONFLICT", "Injected subscriber failure");
      });
      return result;
    };
    const committed = await ops.execute(local, {
      requestId: randomUUID(),
      method: "POST",
      path: "/api/projects",
      body: { name: "Committed" },
    });
    assert.equal(committed.status, "confirmed");
    assert.equal(
      f.store.projects().some((p) => p.name === "Committed"),
      true,
    );
    let attempts = 0;
    f.service.updatePermissionMode = async () => {
      attempts++;
      f.store.put("test-effect", "native", { attempted: true });
      throw new Error("Lost acknowledgement");
    };
    const input = {
      requestId: randomUUID(),
      method: "PATCH",
      path: `/api/sessions/${f.controller.id}`,
      body: { permissionMode: "kodo-tools-read" },
    };
    const unknown = await ops.execute(local, input);
    assert.equal(unknown.status, "unknown");
    assert.equal(unknown.retryable, false);
    assert.equal((await ops.execute(local, input)).status, "unknown");
    assert.equal(attempts, 1);
    assert.ok(f.store.record("test-effect", "native"));
  } finally {
    await f.close();
  }
});

test("in-flight management writes share completion and expose pending status", async () => {
  const f = await setup();
  try {
    let finish!: (v: any) => void,
      attempts = 0;
    f.service.deleteProject = async () => {
      attempts++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    };
    const ops = new ClientOperations(f.service),
      input = { requestId: randomUUID(), method: "DELETE", path: `/api/projects/${f.project.id}` };
    const first = ops.execute(local, input),
      second = ops.execute(local, input);
    assert.equal(ops.get(local, input.requestId).status, "pending");
    assert.equal(attempts, 1);
    finish({ removed: true, sessionsDeleted: 0, sessionsKept: 1 });
    assert.deepEqual(await first, await second);
    assert.equal(ops.get(local, input.requestId).status, "confirmed");
  } finally {
    await f.close();
  }
});

test("receipts survive actual database reopen; abandoned pending work becomes unknown without replay", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-receipt-restart-")),
    db = join(dir, "state.sqlite");
  let store = new Store(db),
    service = new SessionService(store, { dataDir: dir, adapters: [] });
  try {
    let ops = new ClientOperations(service);
    const confirmed = {
      requestId: randomUUID(),
      method: "POST",
      path: "/api/projects",
      body: { name: "Durable" },
    };
    const input = { ...confirmed, requestId: randomUUID(), body: { name: "Uncertain" } };
    const result = await ops.execute(local, confirmed);
    await ops.execute(local, input);
    const key = `desktop:${input.requestId}`,
      pending = store.record<any>("client-operation", key)!;
    pending.receipt.status = "pending";
    delete pending.receipt.result;
    store.put("client-operation", key, pending);
    await service.dispose();
    store.close();
    store = new Store(db);
    service = new SessionService(store, { dataDir: dir, adapters: [] });
    ops = new ClientOperations(service);
    assert.deepEqual(ops.get(local, confirmed.requestId), result);
    assert.equal(ops.get(local, input.requestId).status, "unknown");
    assert.equal((await ops.execute(local, input)).status, "unknown");
    assert.equal(store.projects().filter((p) => p.name === "Uncertain").length, 1);
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("goal details aggregate artifacts and missing links; notification context is a pure read", async () => {
  const f = await setup();
  try {
    const phone = await f.pair();
    const worker = f.service.createDraft({
      title: "Worker",
      harnessId: "codex",
      kind: "direct",
      projectId: f.project.id,
      workspaceId: f.workspace.id,
    });
    const goal = await f.service.goals.create(
      {
        requestId: randomUUID(),
        title: "Delivery",
        controllerSessionId: f.controller.id,
        sessionIds: [worker.id],
      },
      "user",
    );
    writeFileSync(join(f.dir, "result.md"), "delivered");
    const artifact = await f.service.files.publish(
      {
        requestId: randomUUID(),
        goalId: goal.id,
        workspaceId: f.workspace.id,
        path: "result.md",
        title: "Result",
      },
      "user",
    );
    f.store.put("deleted-session", worker.id, { id: worker.id });
    const detail = (await f.call(`/api/goals/${goal.id}/detail`, "GET", undefined, phone.headers))
      .value;
    assert.equal(detail.controller.id, f.controller.id);
    assert.ok(detail.missingSessionIds.includes(worker.id));
    assert.equal(detail.artifacts[0].artifact.id, artifact.id);
    assert.equal(detail.artifacts[0].available, true);
    assert.equal(detail.actions.check.allowed, false);
    assert.equal(detail.actions.update.available, true);
    const inboxId = randomUUID();
    f.store.put("inbox", inboxId, {
      id: inboxId,
      sessionId: f.controller.id,
      type: "interaction",
      title: "Approve",
      payload: { protocol: "codex", method: "item/commandExecution/requestApproval" },
      resolved: false,
      read: false,
      createdAt: new Date().toISOString(),
    });
    const notice = f.service.feed.publish({
      id: randomUUID(),
      kind: "approval-required",
      sessionId: f.controller.id,
      goalId: goal.id,
      inboxItemId: inboxId,
    })!;
    const context = (
      await f.call(`/api/notifications/${notice.id}/context`, "GET", undefined, phone.headers)
    ).value;
    assert.deepEqual(context.target, { kind: "inbox", id: inboxId });
    assert.equal(context.state, "actionable");
    assert.equal(context.inbox.actions.length, 2);
    assert.equal(f.service.feed.get(notice.id).readAt, null);
    assert.equal(f.store.record<any>("inbox", inboxId).resolved, false);
    f.store.put("inbox", inboxId, { ...f.store.record<any>("inbox", inboxId), resolved: true });
    assert.equal((await f.call(`/api/notifications/${notice.id}/context`)).value.state, "resolved");
    f.store.put("deleted-session", f.controller.id, { id: f.controller.id });
    const missing = (await f.call(`/api/notifications/${notice.id}/context`)).value;
    assert.equal(missing.state, "unavailable");
    assert.deepEqual(missing.target, context.target);
    assert.equal((await f.call(`/api/goals/${goal.id}/detail`)).status, 404);
    assert.equal((await f.call("/api/notifications?limit=1.5")).status, 400);
    assert.equal((await f.call("/api/notifications?limit=Infinity")).status, 400);
  } finally {
    await f.close();
  }
});

test("session configuration resolves pinned bindings and runtime-only permissions without launching a harness", async () => {
  const f = await setup();
  try {
    const phone = await f.pair();
    const draft = f.service.createDraft({
      title: "Config",
      harnessId: "codex",
      kind: "direct",
      permissionMode: "read-only",
      model: "test-model",
    });
    const path = `/api/sessions/${draft.id}/configuration`;
    const config = (await f.call(path, "GET", undefined, phone.headers)).value;
    assert.equal(config.model.selected, "test-model");
    assert.equal(config.model.source, "session");
    assert.deepEqual(
      config.permissions.options.map((o: any) => o.value),
      ["read-only", "workspace-write", "full-access"],
    );
    assert.equal(config.permissions.canChange, true);
    assert.equal(config.permissions.current, "read-only");
    assert.equal((await f.call(path)).value.configurationRevision, config.configurationRevision);
    f.store.saveSession({ ...draft, runState: "running" });
    assert.equal((await f.call(path)).value.permissions.canChange, false);
    const acp = f.service.createDraft({ title: "ACP", harnessId: "gemini", kind: "direct" });
    const dynamic = (await f.call(`/api/sessions/${acp.id}/configuration`)).value;
    assert.equal(dynamic.permissions.source, "unresolved");
    assert.deepEqual(dynamic.permissions.options, []);
    assert.equal(dynamic.permissions.canChange, false);
    assert.equal(
      (await f.call("/api/harnesses/gemini/configuration")).value.permissions.requiresConnection,
      true,
    );
    f.store.saveSession({ ...acp, permissionMode: "acp:previous", connectionState: "connected" });
    f.service.sessionPermissionOptions = async () => ({
      current: null,
      options: [{ value: "acp:plan", label: "Plan" }],
    });
    const reported = (await f.call("/api/sessions/" + acp.id + "/configuration")).value.permissions;
    assert.equal(reported.selected, "acp:previous");
    assert.equal(reported.current, null);
    assert.equal(reported.observed, null);
    assert.equal(reported.source, "runtime");
    assert.equal(reported.canChange, true);
    const b: HarnessBinding = {
      id: randomUUID(),
      revision: 1,
      name: "Pinned",
      harnessId: "codex",
      providerId: randomUUID(),
      providerRevision: 1,
      endpointId: randomUUID(),
      modelId: randomUUID(),
      modelRevision: 1,
      model: "pinned-model",
      reasoning: null,
      route: "direct",
      protocol: "openai-responses",
      parameters: {},
      sources: {},
      updatedAt: new Date().toISOString(),
    };
    f.store.put("harness-binding", b.id, b);
    f.store.put("harness-binding-revision", `${b.id}:1`, b);
    const bound = f.service.createDraft({
      title: "Bound",
      harnessId: "codex",
      kind: "direct",
      bindingId: b.id,
    });
    f.service.updateBindingDefaults({ expectedRevision: 0, harnessBindingIds: { codex: null } });
    const pinned = (await f.call(`/api/sessions/${bound.id}/configuration`)).value;
    assert.equal(pinned.binding.id, b.id);
    assert.equal(pinned.model.effective, "pinned-model");
    assert.equal(pinned.model.source, "binding");
    assert.equal(pinned.model.observed, null);
    assert.equal(pinned.newSessionDefaults.host.harnessBindingIds.codex, null);
    f.store.remove("harness-binding-revision", `${b.id}:1`);
    const missing = (await f.call(`/api/sessions/${bound.id}/configuration`)).value;
    assert.equal(missing.binding.available, false);
    assert.equal(missing.model.effective, null);
    assert.equal(missing.model.source, "unresolved");
    assert.equal(f.launches(), 0);
  } finally {
    await f.close();
  }
});

test("sync handles reordering, composite grant keys, immutable history and Host identity", async () => {
  const f = await setup();
  try {
    const cache = new NativeSync();
    const a = f.service.createDraft({ title: "Second", harnessId: "codex", kind: "direct" });
    const state = { ...nativeSnapshot(f.service.snapshot()), goals: [] };
    const originalTitle = state.sessions[0]!.title;
    const first = cache.read(state);
    state.sessions[0]!.title = "Mutated after read";
    const update = cache.read(state, first.cursor);
    assert.equal(update.collections!.sessions!.upsert.length, 1);
    assert.notEqual((update.collections!.sessions!.upsert[0] as any).title, originalTitle);
    const reverse = { ...state, sessions: [...state.sessions].reverse() };
    const order = cache.read(reverse, update.cursor);
    assert.deepEqual(order.collections!.sessions!.upsert, []);
    assert.deepEqual(
      order.collections!.sessions!.order,
      reverse.sessions.map((row) => row.id),
    );
    assert.ok(order.collections!.sessions!.order.includes(a.id));
    const grant = {
      controllerSessionId: f.controller.id,
      projectId: f.project.id,
      state: "active",
    } as any;
    const withGrant = { ...reverse, projectGrants: [grant] };
    const added = cache.read(withGrant, order.cursor);
    assert.deepEqual(added.collections!.projectGrants!.order, [
      f.controller.id + ":" + f.project.id,
    ]);
    const removed = cache.read(reverse, added.cursor);
    assert.deepEqual(removed.collections!.projectGrants!.remove, [
      f.controller.id + ":" + f.project.id,
    ]);
    assert.equal(
      cache.read({ ...reverse, hostId: randomUUID() }, removed.cursor).resetRequired,
      true,
    );
  } finally {
    await f.close();
  }
});

test("goal aggregation keeps all linked artifacts and reports missing records or content", async () => {
  const f = await setup();
  try {
    const goal = await f.service.goals.create(
      { requestId: randomUUID(), controllerSessionId: f.controller.id, title: "Evidence" },
      "user",
    );
    const artifact = await f.service.files.publish(
      {
        requestId: randomUUID(),
        goalId: goal.id,
        title: "Evidence",
        content: "result",
        displayName: "evidence.txt",
      },
      "user",
    );
    const ids: string[] = [];
    f.store.transaction(() => {
      const insert = f.store.db.prepare("INSERT INTO artifacts VALUES (?,?,?,?,?,?,?,?)");
      for (let i = 0; i < 501; i++) {
        const id = randomUUID();
        ids.push(id);
        const row = { ...artifact, id, version: i + 2 };
        insert.run(
          id,
          row.fileId,
          goal.id,
          row.sessionId,
          artifact.id,
          row.version,
          row.createdAt,
          JSON.stringify(row),
        );
      }
    });
    const latest = f.service.goals.get(goal.id);
    const missingId = randomUUID();
    latest.artifactIds = [artifact.id, ...ids, missingId];
    f.store.db.prepare("UPDATE goals SET data=? WHERE id=?").run(JSON.stringify(latest), goal.id);
    const detail = goalDetail(f.service, goal.id, local);
    assert.equal(detail.artifacts.length, 502);
    assert.deepEqual(detail.missingArtifactIds, [missingId]);
    const file = f.service.files.file(artifact.fileId);
    const object = join(f.dir, "data", "files", "objects", file.sha256.slice(0, 2), file.sha256);
    writeFileSync(object, "wrong length");
    assert.throws(() => f.service.files.open(file.id), /大小不符/);
    assert.equal(
      goalDetail(f.service, goal.id, local).artifacts.every((item) => !item.available),
      true,
    );
    rmSync(object);
    assert.equal(
      goalDetail(f.service, goal.id, local).artifacts.every((item) => !item.available),
      true,
    );
  } finally {
    await f.close();
  }
});

test("management whitelist covers drafts, metadata, workspace and revision-controlled defaults", async () => {
  const f = await setup();
  try {
    const ops = new ClientOperations(f.service);
    const execute = (method: string, path: string, body?: object) =>
      ops.execute(local, { requestId: randomUUID(), method, path, body });
    const draft = await execute("POST", "/api/sessions", {
      title: "Receipted",
      harnessId: "codex",
      kind: "direct",
    });
    assert.equal(draft.status, "confirmed");
    const id = (draft.result as any).id;
    assert.equal(
      (await execute("PATCH", "/api/sessions/" + id, { title: "Renamed", pinned: true })).status,
      "confirmed",
    );
    assert.equal(f.store.session(id).pinned, true);
    assert.equal(
      (await execute("PATCH", "/api/sessions/" + id, { permissionMode: "read-only" })).status,
      "confirmed",
    );
    assert.equal(f.store.session(id).permissionMode, "read-only");
    await assert.rejects(execute("PATCH", "/api/sessions/" + id, { injected: true }));
    assert.equal(
      (await execute("POST", "/api/workspaces", { projectId: f.project.id, rootPath: f.dir }))
        .status,
      "confirmed",
    );
    const defaults = await execute("PATCH", "/api/binding-defaults", {
      expectedRevision: 0,
      harnessBindingIds: { codex: null },
    });
    assert.equal(defaults.status, "confirmed");
    assert.equal(
      (
        await execute("PATCH", "/api/binding-defaults", {
          expectedRevision: 0,
          harnessBindingIds: {},
        })
      ).status,
      "failed",
    );
    assert.equal(
      (
        await execute("PATCH", "/api/projects/" + f.project.id + "/binding-defaults", {
          expectedRevision: 0,
          bindingDefaults: { codex: null },
        })
      ).status,
      "confirmed",
    );
    assert.equal(
      (await execute("PATCH", "/api/projects/" + f.project.id, { name: "Updated" })).status,
      "confirmed",
    );
    assert.equal(
      (await execute("PATCH", "/api/app-settings", { revision: 0, theme: "dark" })).status,
      "confirmed",
    );
    assert.equal(
      (await execute("PATCH", "/api/app-settings", { revision: 0, theme: "light" })).status,
      "failed",
    );
    const deepseek = f.service.createDraft({
      title: "Native",
      harnessId: "deepseek-harness",
      kind: "direct",
    });
    const permissions = (await f.call("/api/sessions/" + deepseek.id + "/configuration")).value
      .permissions;
    assert.equal(permissions.canChange, true);
    assert.deepEqual(
      permissions.options.map((option: { value: string }) => option.value),
      ["dsh:ask", "dsh:allow", "dsh:deny"],
    );
  } finally {
    await f.close();
  }
});

test("managed content streams authenticated ranges, HEAD, validators and safe download types", async () => {
  const f = await setup();
  try {
    const phone = await f.pair(),
      body = Buffer.from("0123456789");
    const upload = f.service.files.createUpload({
      requestId: randomUUID(),
      displayName: "数据.txt",
      mediaType: "text/plain",
      size: body.length,
      sha256: sha(body),
    });
    f.service.files.appendChunk(upload.id, 0, body);
    const file = await f.service.files.completeUpload(upload.id),
      path = `/api/files/${file.id}/content`;
    assert.equal((await f.call(path, "GET", undefined, { host: "kooyu.test" })).status, 401);
    const all = await f.call(path, "GET", undefined, phone.headers);
    assert.equal(all.status, 200);
    assert.deepEqual(all.raw, body);
    assert.equal(all.headers.etag, `"${file.sha256}"`);
    const head = await f.call(path, "HEAD", undefined, phone.headers);
    assert.equal(head.status, 200);
    assert.equal(head.raw.length, 0);
    assert.equal(head.headers["content-length"], "10");
    for (const [range, expected, contentRange] of [
      ["bytes=2-5", "2345", "bytes 2-5/10"],
      ["bytes=-3", "789", "bytes 7-9/10"],
      ["bytes=8-", "89", "bytes 8-9/10"],
      ["bytes=8-999", "89", "bytes 8-9/10"],
    ]) {
      const part = await f.call(path, "GET", undefined, { ...phone.headers, range: range! });
      assert.equal(part.status, 206);
      assert.equal(part.raw.toString(), expected);
      assert.equal(part.headers["content-range"], contentRange);
    }
    for (const range of [
      "bytes=10-",
      "bytes=6-2",
      "bytes=-0",
      "bytes=",
      "bytes=1-2,4-5",
      "bytes=999999999999999999999-",
    ]) {
      const bad = await f.call(path, "GET", undefined, { ...phone.headers, range });
      assert.equal(bad.status, 416);
      assert.equal(bad.headers["content-range"], "bytes */10");
    }
    const stale = await f.call(path, "GET", undefined, {
      ...phone.headers,
      range: "bytes=1-3",
      "if-range": '"stale"',
    });
    assert.equal(stale.status, 200);
    assert.deepEqual(stale.raw, body);
    assert.equal(
      (
        await f.call(path, "GET", undefined, {
          ...phone.headers,
          range: "bytes=1-3",
          "if-range": all.headers.etag,
        })
      ).status,
      206,
    );
    const unchanged = await f.call(path, "GET", undefined, {
      ...phone.headers,
      "if-none-match": all.headers.etag,
    });
    assert.equal(unchanged.status, 304);
    assert.equal(unchanged.raw.length, 0);
    assert.equal(
      (await f.call(path + "?download=1", "GET", undefined, phone.headers)).headers[
        "content-disposition"
      ].startsWith("attachment"),
      true,
    );
    const access = (await f.call(`/api/files/${file.id}/access`, "GET", undefined, phone.headers))
      .value;
    assert.equal(access.preview.available, true);
    assert.equal(access.downloadUrl.includes("token"), false);
    const html = f.service.files.createUpload({
      requestId: randomUUID(),
      displayName: "page.html",
      mediaType: "text/html",
      size: body.length,
      sha256: sha(body),
    });
    f.service.files.appendChunk(html.id, 0, body);
    const htmlFile = await f.service.files.completeUpload(html.id);
    const response = await f.call(`/api/files/${htmlFile.id}/content`);
    assert.equal(response.headers["content-type"], "text/plain; charset=utf-8");
    assert.match(response.headers["content-security-policy"], /sandbox/);
    assert.equal((await f.call(`/api/files/${htmlFile.id}/access`)).value.preview.available, false);
    const empty = f.service.files.createUpload({
      requestId: randomUUID(),
      displayName: "empty.txt",
      size: 0,
      sha256: sha(""),
    });
    const emptyFile = await f.service.files.completeUpload(empty.id);
    assert.equal(
      (await f.call(`/api/files/${emptyFile.id}/content`, "GET", undefined, { range: "bytes=0-0" }))
        .status,
      416,
    );
  } finally {
    await f.close();
  }
});
