import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
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
import { createHostServer } from "../src/http/server.js";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-file-preview-"));
  const root = join(dir, "workspace");
  mkdirSync(root);
  const workspace: Workspace = { id: "test", hostId: "test", projectId: null, rootPath: root };
  return { dir, root, workspace, close: () => rmSync(dir, { recursive: true, force: true }) };
}

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
