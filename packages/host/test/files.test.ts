import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Store } from "../src/storage/store.js";
import { SessionService } from "../src/session-service.js";
import { createHostServer } from "../src/http/server.js";
import { createWorkTools } from "../src/kodo/work-tools.js";
import { FileVault, setSecretVault } from "../src/credentials/vault.js";
import { runDoctor } from "../src/lifecycle/doctor.js";
import { descriptor } from "../src/harnesses/adapter.js";

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-files-"));
  const store = new Store(":memory:");
  const service = new SessionService(store, { dataDir: join(dir, "data"), adapters: [] });
  writeFileSync(join(dir, "outside.txt"), "secret");
  const project = service.createProject({ name: "交付", rootPath: dir });
  const workspace = service.snapshot().workspaces.find((w) => w.projectId === project.id)!;
  const controller = service.createDraft({
    title: "Kooyu",
    harnessId: "kodo",
    kind: "supervisor",
    projectId: project.id,
    workspaceId: workspace.id,
  });
  return { dir, store, service, workspace, controller };
}

test("uploads become usable only after ordered chunks match size and hash", async () => {
  const { dir, store, service, controller } = setup();
  try {
    const body = Buffer.from("第一部分|第二部分");
    const requestId = randomUUID();
    const input = {
      requestId,
      displayName: "资料.txt",
      mediaType: "text/plain; charset=utf-8",
      size: body.length,
      sha256: sha(body),
      sessionId: controller.id,
    };
    const upload = service.files.createUpload(input);
    assert.equal(service.files.createUpload(input).id, upload.id);
    assert.throws(() => service.files.createUpload({ ...input, size: 1 }), /不同的上传/);
    assert.throws(
      () => service.files.createUpload({ ...input, requestId: randomUUID(), displayName: "../x" }),
      /路径/,
    );
    await assert.rejects(service.files.completeUpload(upload.id), /尚未完成/);
    assert.throws(() => service.files.appendChunk(upload.id, 5, body.subarray(5)), /不连续/);
    service.files.appendChunk(upload.id, 0, body.subarray(0, 5));
    // A resent chunk that was already stored is acknowledged, not written twice.
    assert.equal(service.files.appendChunk(upload.id, 0, body.subarray(0, 5)).received, 5);
    service.files.appendChunk(upload.id, 5, body.subarray(5));
    const file = await service.files.completeUpload(upload.id);
    assert.equal(file.state, "available");
    assert.equal((await service.files.completeUpload(upload.id)).id, file.id);
    assert.equal(service.files.readText(file.id).text, body.toString());
    assert.deepEqual(
      service.files.list({ sessionId: controller.id }).map((f) => f.id),
      [file.id],
    );

    const bad = service.files.createUpload({ ...input, requestId: randomUUID(), sha256: sha("x") });
    service.files.appendChunk(bad.id, 0, body);
    await assert.rejects(service.files.completeUpload(bad.id), /哈希不匹配/);
    assert.equal(service.files.upload(bad.id).state, "cancelled");
    assert.throws(
      () => service.files.createUpload({ ...input, requestId: randomUUID(), size: 64 * 1024 ** 2 }),
      /上限/,
    );
    const stale = service.files.createUpload({ ...input, requestId: randomUUID() });
    assert.equal(service.files.collect(Date.now() + 2 * 86400000), 1);
    assert.equal(service.files.upload(stale.id).state, "cancelled");
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("artifacts are immutable versioned snapshots attached to the goal", async () => {
  const { dir, store, service, controller, workspace } = setup();
  try {
    const goal = await service.goals.create(
      { requestId: randomUUID(), controllerSessionId: controller.id, title: "报告" },
      "user",
    );
    writeFileSync(join(dir, "report.md"), "# v1\n");
    const tools = createWorkTools(service, controller);
    const files = tools.find((t) => t.name === "files")!;
    const call = async (id: string, input: unknown) =>
      JSON.parse(
        (
          (await files.execute(id, input as never, undefined, undefined, {} as never))
            .content[0] as { text: string }
        ).text,
      );
    const v1 = await call("c1", {
      action: "publish",
      goalId: goal.id,
      path: "report.md",
      title: "报告",
    });
    assert.equal(v1.version, 1);
    assert.equal(v1.mediaType, "text/markdown; charset=utf-8");
    assert.deepEqual(v1.source, { workspaceId: workspace.id, path: "report.md" });
    // Replaying the same tool call returns the same artifact.
    assert.equal(
      (await call("c1", { action: "publish", goalId: goal.id, path: "report.md", title: "报告" }))
        .id,
      v1.id,
    );
    writeFileSync(join(dir, "report.md"), "# v2\n");
    const v2 = await call("c2", {
      action: "publish",
      goalId: goal.id,
      path: "report.md",
      title: "报告",
    });
    assert.equal(v2.version, 2);
    assert.equal(service.files.readText(v1.fileId).text, "# v1\n");
    assert.equal(service.files.readText(v2.fileId).text, "# v2\n");
    const inline = await call("c3", {
      action: "publish",
      goalId: goal.id,
      content: "# 摘要",
      displayName: "summary.md",
    });
    assert.equal(inline.source, null);
    assert.deepEqual(service.goals.get(goal.id).artifactIds, [v1.id, v2.id, inline.id]);
    await assert.rejects(
      call("c4", { action: "publish", goalId: goal.id, path: "../outside.txt" }),
      /超出|之外/,
    );
    const listed = await call("c5", { action: "list", goalId: goal.id });
    assert.equal(listed.artifacts.length, 3);
    const read = await call("c6", { action: "read", fileId: inline.fileId });
    assert.equal(read.untrustedContent, "# 摘要");

    const other = service.createDraft({ title: "另一个", harnessId: "kodo", kind: "supervisor" });
    const foreign = createWorkTools(service, other).find((t) => t.name === "files")!;
    await assert.rejects(
      foreign.execute(
        "x",
        { action: "read", fileId: inline.fileId } as never,
        undefined,
        undefined,
        {} as never,
      ),
      /不属于/,
    );
    const accepted = await service.goals.review(goal.id, {
      requestId: randomUUID(),
      expectedRevision: service.goals.get(goal.id).revision,
      decision: "accept",
    });
    assert.equal(accepted.status, "completed");
    await assert.rejects(
      call("c7", { action: "publish", goalId: goal.id, content: "x", displayName: "late.md" }),
      /已结束/,
    );
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("file routes stream content safely and accept raw chunks", async () => {
  const { dir, store, service, controller } = setup();
  const options = { port: 0, webRoot: dir };
  const server = createHostServer(service, options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  options.port = (server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${options.port}`;
  try {
    const html = Buffer.from("<script>alert(1)</script>");
    const created = await fetch(`${origin}/api/files/uploads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: randomUUID(),
        displayName: "page.html",
        mediaType: "text/html",
        size: html.length,
        sha256: sha(html),
        sessionId: controller.id,
      }),
    });
    assert.equal(created.status, 201);
    const upload = await created.json();
    const chunk = await fetch(`${origin}/api/files/uploads/${upload.id}/chunks?offset=0`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: html,
    });
    assert.equal((await chunk.json()).received, html.length);
    const file = await (
      await fetch(`${origin}/api/files/uploads/${upload.id}/complete`, { method: "POST" })
    ).json();
    const content = await fetch(`${origin}/api/files/${file.id}/content`);
    assert.equal(content.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.match(content.headers.get("content-disposition")!, /^attachment/);
    assert.match(content.headers.get("content-security-policy")!, /sandbox/);
    assert.equal(await content.text(), html.toString());
    const published = await fetch(`${origin}/api/artifacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: randomUUID(),
        title: "说明",
        content: "hello",
        displayName: "note.txt",
      }),
    });
    assert.equal(published.status, 201);
    const artifact = await published.json();
    const inline = await fetch(`${origin}/api/files/${artifact.fileId}/content`);
    assert.match(inline.headers.get("content-disposition")!, /^inline/);
    assert.equal(await inline.text(), "hello");
    const doctor = await (await fetch(`${origin}/api/host/doctor`)).json();
    assert.ok(["ok", "degraded", "failing"].includes(doctor.status));
    assert.equal(doctor.checks.find((c: any) => c.id === "database").status, "ok");
  } finally {
    server.closeAllConnections();
    server.close();
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the server vault encrypts secrets, refuses weak or missing keys and rotates", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-vault-"));
  try {
    const keyFile = join(dir, "master.key"),
      next = join(dir, "next.key"),
      path = join(dir, "vault.json");
    writeFileSync(keyFile, randomUUID() + randomUUID(), { mode: 0o600 });
    writeFileSync(next, randomUUID() + randomUUID(), { mode: 0o600 });
    const vault = new FileVault(path, keyFile);
    assert.equal(vault.status().available, true);
    await vault.set("Kodo", "provider:1", "sk-test-secret-value");
    assert.doesNotMatch(readFileSync(path, "utf8"), /sk-test-secret-value/);
    assert.equal(await vault.get("Kodo", "provider:1"), "sk-test-secret-value");
    assert.equal(vault.getSync("Kodo", "missing"), null);

    assert.equal(new FileVault(path, undefined).status().available, false);
    await assert.rejects(
      new FileVault(path, undefined).get("Kodo", "provider:1"),
      /KOOYU_VAULT_KEY_FILE/,
    );
    const short = join(dir, "short.key");
    writeFileSync(short, "tiny", { mode: 0o600 });
    assert.match(new FileVault(path, short).status().reason!, /过短/);
    if (process.platform !== "win32") {
      const loose = join(dir, "loose.key");
      writeFileSync(loose, randomUUID() + randomUUID());
      chmodSync(loose, 0o644);
      assert.match(new FileVault(path, loose).status().reason!, /权限/);
    }
    await assert.rejects(new FileVault(path, next).get("Kodo", "provider:1"), /无法解密/);
    assert.equal(vault.rekey(next), 1);
    assert.equal(await new FileVault(path, next).get("Kodo", "provider:1"), "sk-test-secret-value");
    await assert.rejects(new FileVault(path, keyFile).get("Kodo", "provider:1"), /无法解密/);

    // Host features use the configured vault; an unavailable vault fails the doctor check.
    setSecretVault(new FileVault(path, undefined));
    const store = new Store(":memory:");
    const service = new SessionService(store, { dataDir: join(dir, "data"), adapters: [] });
    try {
      const report = await runDoctor(service);
      assert.equal(report.status, "failing");
      assert.equal(report.checks.find((c) => c.id === "vault")!.status, "fail");
    } finally {
      await service.dispose();
      store.close();
    }
  } finally {
    setSecretVault(undefined);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("message attachments are inlined, sent as images or referenced according to capability", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-attach-"));
  const sent: { text: string; images: number; session: string }[] = [];
  const adapterFor = (id: "codex" | "kodo", images: boolean) => ({
    descriptor: descriptor(id, id, "sdk", ["steer"], "ISOLATED TEST PEER", "implemented"),
    async connect(session: { id: string }) {
      return {
        nativeSessionId: randomUUID(),
        supportsImages: () => images,
        async send(
          text: string,
          _c: string,
          _m: string,
          _s: unknown,
          input?: { images?: unknown[] },
        ) {
          sent.push({ text, images: input?.images?.length ?? 0, session: session.id });
          return { nativeRunId: null };
        },
        async cancel() {},
        async close() {},
      };
    },
  });
  const store = new Store(":memory:");
  const service = new SessionService(store, {
    dataDir: join(dir, "data"),
    adapters: [adapterFor("codex", false), adapterFor("kodo", true)] as never,
  });
  const upload = async (sessionId: string | null, name: string, type: string, body: Buffer) => {
    const u = service.files.createUpload({
      requestId: randomUUID(),
      displayName: name,
      mediaType: type,
      size: body.length,
      sha256: sha(body),
      sessionId,
    });
    service.files.appendChunk(u.id, 0, body);
    return (await service.files.completeUpload(u.id)).id;
  };
  const settle = async (commandId: string) => {
    for (let i = 0; i < 200 && store.command(commandId)?.status !== "confirmed"; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(store.command(commandId)?.status, "confirmed");
  };
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  try {
    const codex = service.createDraft({ title: "Codex", harnessId: "codex", kind: "direct" });
    const kodo = service.createDraft({ title: "Kooyu", harnessId: "kodo", kind: "supervisor" });
    const note = await upload(codex.id, "notes.md", "text/markdown", Buffer.from("# 要点\n- A"));
    const image = await upload(codex.id, "shot.png", "image/png", png);
    const pdf = await upload(null, "spec.pdf", "application/pdf", Buffer.from("%PDF-1.7 test"));

    assert.throws(
      () => service.acceptSend(codex.id, { requestId: randomUUID(), text: "  " }),
      /正文或附件/,
    );
    const requestId = randomUUID();
    const command = service.acceptSend(codex.id, {
      requestId,
      text: "请看附件",
      attachmentIds: [note, image, pdf],
    });
    assert.throws(
      () => service.acceptSend(codex.id, { requestId, text: "请看附件", attachmentIds: [note] }),
      /不同内容/,
    );
    await settle(command.id);
    const delivered = sent.find((s) => s.session === codex.id)!;
    assert.match(delivered.text, /^请看附件/);
    assert.match(delivered.text, /--- 附加文件：notes\.md ---\n# 要点\n- A\n--- 文件结束 ---/);
    assert.match(delivered.text, /附件：shot\.png（image\/png/);
    assert.match(delivered.text, /当前模型未声明图片输入/);
    assert.equal(delivered.images, 0);
    const deliveries = (store.command(command.id)!.body.attachments as any[]).map(
      (a) => a.delivery,
    );
    assert.deepEqual(deliveries, ["inline-text", "file-reference", "file-reference"]);
    const pdfPath = (store.command(command.id)!.body.attachments as any[])[2].path as string;
    assert.equal(readFileSync(pdfPath, "utf8"), "%PDF-1.7 test");
    const message = store
      .events(codex.id)
      .find((e) => e.type === "message" && (e.payload as any).commandId === command.id)!;
    assert.deepEqual(
      (message.payload as any).attachments.map((a: any) => a.displayName),
      ["notes.md", "shot.png", "spec.pdf"],
    );

    // A file uploaded to another session cannot be sent here.
    assert.throws(
      () =>
        service.acceptSend(kodo.id, { requestId: randomUUID(), text: "x", attachmentIds: [note] }),
      /另一个会话/,
    );
    const own = await upload(kodo.id, "shot.png", "image/png", png);
    const onlyImage = service.acceptSend(kodo.id, {
      requestId: randomUUID(),
      text: "",
      attachmentIds: [own],
    });
    await settle(onlyImage.id);
    const kodoSent = sent.find((s) => s.session === kodo.id)!;
    assert.equal(kodoSent.images, 1);
    assert.equal(kodoSent.text, "");
    assert.equal((store.command(onlyImage.id)!.body.attachments as any[])[0].delivery, "image");
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
