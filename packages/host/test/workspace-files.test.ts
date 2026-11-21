import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { createServer, get } from "node:http";
import type { AddressInfo } from "node:net";
import { PreviewService } from "../src/workspaces/preview.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Workspace, RuntimeEvent } from "@kodo/protocol";
import {
  listWorkspaceFiles,
  previewWorkspaceFile,
  workspaceFileContent,
  workspaceChanges,
  workspaceFileDiff,
} from "../src/workspaces/files.js";
import { workspaceLinkPath, involvedFiles } from "../../../apps/web/src/lib/workspace-files.js";
import { Store } from "../src/storage/store.js";
import { SessionService } from "../src/session-service.js";
import { workspaceGit } from "../src/workspaces/git.js";
import { createHostServer } from "../src/http/server.js";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-file-preview-"));
  const root = join(dir, "workspace");
  mkdirSync(root);
  const workspace: Workspace = { id: "test", hostId: "test", projectId: null, rootPath: root };
  return { dir, root, workspace, close: () => rmSync(dir, { recursive: true, force: true }) };
}

test("concurrent previews share the listener limit and cannot finish opening after disposal", async () => {
  const previews = new PreviewService();
  try {
    const results = await Promise.allSettled(
      Array.from({ length: 17 }, () => previews.openPort(8123, undefined)),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 16);
    assert.equal(results[16]?.status, "rejected");
  } finally {
    previews.dispose();
  }
  const closing = new PreviewService();
  const opening = closing.openPort(8123, undefined);
  closing.dispose();
  await assert.rejects(opening, /预览服务已关闭/);
});

test("development previews serve the selected loopback port without forwarding credentials or redirects", async () => {
  const previews = new PreviewService();
  const upstream = createServer((req, res) => {
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers.authorization, undefined);
    if (req.url === "/redirect") res.writeHead(302, { location: "https://example.invalid/" }).end();
    else
      res.writeHead(200, { "content-type": "text/html", "set-cookie": "secret=1" }).end("preview");
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  try {
    const port = (upstream.address() as AddressInfo).port;
    assert.throws(() => previews.openPort(port, port));
    const { url } = await previews.openPort(port, undefined);
    const address = new URL(url);
    for (const path of ["/", "/redirect"]) {
      const req = get({
        hostname: "127.0.0.1",
        port: address.port,
        path,
        headers: { host: address.host, cookie: "private=1", authorization: "Bearer private" },
      });
      const [res] = await once(req, "response");
      assert.equal(res.statusCode, path === "/" ? 200 : 404);
      assert.equal(res.headers["set-cookie"], undefined);
      assert.equal(res.headers.location, undefined);
      assert.match(res.headers["content-security-policy"], /sandbox allow-scripts/);
      res.resume();
    }
  } finally {
    previews.dispose();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});

test("Git delivery stages one hunk, rejects stale edits and fast-forwards a clean parent", async () => {
  const f = fixture();
  const store = new Store(join(f.dir, "git-delivery.sqlite"));
  const service = new SessionService(store, { dataDir: f.dir, adapters: [] });
  const git = (root: string, ...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true }).trim();
  try {
    git(f.root, "init", "-q");
    git(f.root, "config", "user.name", "Delivery Test");
    git(f.root, "config", "user.email", "git@example.invalid");
    git(f.root, "config", "core.autocrlf", "false");
    const lines = Array.from({ length: 40 }, (_, i) => String(i)).join("\n") + "\n";
    const filename = join(f.root, "lines.txt");
    writeFileSync(filename, lines);
    git(f.root, "add", ".");
    git(f.root, "commit", "-qm", "initial");
    const workspace = service.addWorkspace(null, f.root);
    const run = (action: string, body: unknown) =>
      workspaceGit(service, workspace, action, body, "desktop");
    const edited = lines.replace("10\n", "first\n").replace("30\n", "second\n");
    writeFileSync(filename, edited);
    const hunks = (await run("hunks", { path: "lines.txt" })) as { id: string }[];
    assert.equal(hunks.length, 2);
    await run("stage-hunk", { path: "lines.txt", id: hunks[0]!.id });
    assert.match(git(f.root, "diff", "--cached"), /\+first/);
    assert.doesNotMatch(git(f.root, "diff", "--cached"), /\+second/);
    writeFileSync(filename, edited.replace("second", "third"));
    await assert.rejects(
      run("discard-hunk", { path: "lines.txt", id: hunks[1]!.id, confirmed: true }),
      /刷新/,
    );
    const [remaining] = (await run("hunks", { path: "lines.txt" })) as { id: string }[];
    await run("discard-hunk", { path: "lines.txt", id: remaining!.id, confirmed: true });
    await run("commit", { message: "partial" });
    const created = await service.worktrees.create(workspace, {
      rootPath: join(f.dir, "worker"),
      branchName: "delivery-test",
    });
    assert.equal(created.kind, "worktree");
    if (created.kind !== "worktree") return;
    const wt = created.workspace;
    writeFileSync(join(wt.rootPath, "delivery.txt"), "done");
    git(wt.rootPath, "add", ".");
    git(wt.rootPath, "commit", "-qm", "worker");
    assert.deepEqual(await run("branches", {}), [
      { workspaceId: wt.id, branchName: "delivery-test" },
    ]);
    writeFileSync(join(f.root, "untracked"), "preserve");
    await assert.rejects(run("merge", { worktreeId: wt.id, mode: "ff" }), /DIRTY/);
    rmSync(join(f.root, "untracked"));
    await run("merge", { worktreeId: wt.id, mode: "ff" });
    assert.equal(git(f.root, "rev-parse", "HEAD"), git(wt.rootPath, "rev-parse", "HEAD"));
  } finally {
    await service.dispose();
    store.close();
    f.close();
  }
});

test("workspace file browsing handles Unicode, dot names, directories and missing files", async () => {
  const f = fixture();
  try {
    mkdirSync(join(f.root, "子目录"));
    mkdirSync(join(f.root, ".git"));
    writeFileSync(join(f.root, "..notes.md"), "# 中文\n");
    writeFileSync(join(f.root, "子目录", "file.txt"), "nested");
    const listing = await listWorkspaceFiles(f.workspace);
    assert.deepEqual(
      listing.entries.map((entry) => entry.name),
      ["子目录", "..notes.md"],
    );
    assert.equal(
      (await listWorkspaceFiles(f.workspace, "子目录")).entries[0]!.path,
      "子目录/file.txt",
    );
    assert.equal((await previewWorkspaceFile(f.workspace, "..notes.md")).text, "# 中文\n");
    await assert.rejects(previewWorkspaceFile(f.workspace, "missing.txt"), /不存在/);
    await assert.rejects(previewWorkspaceFile(f.workspace, "子目录"), /普通文件/);
  } finally {
    f.close();
  }
});

test("preview classifies images and PDFs, rejects binary-as-text and bounds file sizes", async () => {
  const f = fixture();
  try {
    const image = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGQAAAABJRU5ErkJggg==",
      "base64",
    );
    writeFileSync(join(f.root, "picture.png"), image);
    writeFileSync(join(f.root, "paper.pdf"), "%PDF-1.4\n%%EOF\n");
    writeFileSync(join(f.root, "binary.docx"), Buffer.from([0x50, 0x4b, 0, 0xff]));
    writeFileSync(join(f.root, "large.txt"), Buffer.alloc(512 * 1024 + 1, 65));
    assert.equal((await previewWorkspaceFile(f.workspace, "picture.png")).kind, "image");
    assert.equal((await previewWorkspaceFile(f.workspace, "paper.pdf")).kind, "pdf");
    assert.equal((await previewWorkspaceFile(f.workspace, "binary.docx")).kind, "unsupported");
    assert.equal((await previewWorkspaceFile(f.workspace, "large.txt")).kind, "unsupported");
    const bytes = await workspaceFileContent(f.workspace, "picture.png");
    assert.equal(bytes.mime, "image/png");
    assert.deepEqual(bytes.bytes, image);
  } finally {
    f.close();
  }
});

test("workspace traversal and external directory links cannot expose other files", async () => {
  const f = fixture();
  try {
    const outside = join(f.dir, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "secret.txt"), "private");
    symlinkSync(outside, join(f.root, "linked"), process.platform === "win32" ? "junction" : "dir");
    for (const path of ["../outside/secret.txt", join(outside, "secret.txt"), "linked/secret.txt"])
      await assert.rejects(previewWorkspaceFile(f.workspace, path), /之外|超出/);
    await assert.rejects(listWorkspaceFiles(f.workspace, "linked"), /之外|超出/);
    await assert.rejects(workspaceFileContent(f.workspace, "linked/secret.txt"), /之外|超出/);
    assert.equal((await listWorkspaceFiles(f.workspace)).entries.length, 0);
  } finally {
    f.close();
  }
});

test("Git review includes new, modified, deleted, staged and renamed files with literal paths", async () => {
  const f = fixture();
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", f.root, ...args], { windowsHide: true, encoding: "utf8" });
  try {
    git("init", "--quiet");
    git("config", "user.name", "Kooyu Test");
    git("config", "user.email", "test@example.invalid");
    // Unique contents keep Git's rename matching deterministic across platforms.
    for (const name of ["modified.txt", "deleted.txt", "old name.txt", "staged.txt"])
      writeFileSync(join(f.root, name), `before ${name}\n`);
    git("add", ".");
    git("commit", "-qm", "initial");
    writeFileSync(join(f.root, "modified.txt"), "after\n");
    rmSync(join(f.root, "deleted.txt"));
    renameSync(join(f.root, "old name.txt"), join(f.root, "新 name.txt"));
    git("add", "-A");
    writeFileSync(join(f.root, "staged.txt"), "staged change\n");
    git("add", "staged.txt");
    writeFileSync(join(f.root, "new file.txt"), "new body\n");
    const changes = await workspaceChanges(f.workspace);
    assert.equal(changes.git, true);
    assert.equal(
      changes.files.find((file) => file.path === "deleted.txt")?.status,
      "deleted",
      JSON.stringify(changes.files),
    );
    assert.equal(changes.files.find((file) => file.path === "new file.txt")!.status, "untracked");
    assert.equal(
      changes.files.find((file) => file.path === "新 name.txt")!.previousPath,
      "old name.txt",
    );
    assert.match((await workspaceFileDiff(f.workspace, "modified.txt")).text, /\+after/);
    assert.match((await workspaceFileDiff(f.workspace, "deleted.txt")).text, /-before/);
    assert.match((await workspaceFileDiff(f.workspace, "new file.txt")).text, /new body/);
    await assert.rejects(workspaceFileDiff(f.workspace, "*"), /不在改动列表/);
  } finally {
    f.close();
  }
});

test("Git review confines nested workspaces to their own subtree and handles unborn or non-Git roots", async () => {
  const f = fixture();
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", f.root, ...args], { windowsHide: true, encoding: "utf8" });
  try {
    assert.equal((await workspaceChanges(f.workspace)).git, false);
    git("init", "--quiet");
    mkdirSync(join(f.root, "nested"));
    writeFileSync(join(f.root, "outside.txt"), "not visible");
    writeFileSync(join(f.root, "nested", "inside.txt"), "inside");
    const nested = { ...f.workspace, rootPath: join(f.root, "nested") };
    const changes = await workspaceChanges(nested);
    assert.equal(changes.baseline, "empty");
    assert.deepEqual(
      changes.files.map((file) => file.path),
      ["inside.txt"],
    );
    assert.match((await workspaceFileDiff(nested, "inside.txt")).text, /inside/);
  } finally {
    f.close();
  }
});

test("file links and native tool evidence distinguish external URLs and preserve Windows paths", () => {
  assert.equal(workspaceLinkPath("https://example.com/image.png"), null);
  assert.equal(workspaceLinkPath("javascript:alert(1)"), null);
  assert.equal(workspaceLinkPath("src/file.ts:42:3"), "src/file.ts");
  assert.equal(workspaceLinkPath("C:\\repo\\file.ts:42"), "C:\\repo\\file.ts");
  assert.equal(workspaceLinkPath("file:///C:/repo/hello%20world.png"), "C:/repo/hello world.png");
  const events = [
    { type: "tool", payload: { input: { file_path: "readme.md" } } },
    { type: "tool", payload: { type: "fileChange", changes: [{ path: "output.png" }] } },
    {
      type: "subagent",
      payload: { event: { type: "tool", payload: { args: { path: "child.txt" } } } },
    },
  ] as RuntimeEvent[];
  assert.deepEqual(involvedFiles(events), ["child.txt", "output.png", "readme.md"]);
});

test("Host file routes keep binary content separate, validate scopes and return useful errors", async () => {
  const f = fixture(),
    store = new Store(":memory:");
  const service = new SessionService(store, { dataDir: f.dir, adapters: [] });
  const options = { port: 0, webRoot: f.dir };
  const server = createHostServer(service, options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  options.port = (server.address() as { port: number }).port;
  const origin = "http://127.0.0.1:" + options.port;
  try {
    writeFileSync(
      join(f.root, "image.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
    );
    const workspace = service.addWorkspace(null, f.root);
    const base = origin + "/api/workspaces/" + workspace.id;
    assert.equal((await fetch(base + "/files")).status, 200);
    assert.equal(
      (await (await fetch(base + "/files/preview?path=image.svg")).json()).kind,
      "image",
    );
    const binary = await fetch(base + "/files/content?path=image.svg");
    assert.equal(binary.headers.get("content-type"), "image/svg+xml");
    assert.match(binary.headers.get("content-security-policy")!, /sandbox/);
    assert.match(await binary.text(), /<svg/);
    const download = await fetch(base + "/files/content?path=image.svg&download=1");
    assert.match(download.headers.get("content-disposition")!, /^attachment/);
    await download.arrayBuffer();
    assert.equal((await fetch(base + "/files/preview?path=not-found")).status, 404);
    assert.equal((await fetch(base + "/files/content?path=../outside")).status, 400);
    assert.equal(
      (
        await fetch(base + "/files/preview?path=image.svg", {
          headers: { Origin: "https://untrusted.example" },
        })
      ).status,
      401,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await service.dispose();
    store.close();
    f.close();
  }
});
