import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { listDirectories } from "../src/workspaces/directories.js";

test("directory picker lists folders on the Host without returning files", async () => {
  const root = mkdtempSync(join(tmpdir(), "kodo-directories-"));
  try {
    mkdirSync(join(root, "project"));
    writeFileSync(join(root, "note.txt"), "not a folder");
    const listing = await listDirectories(root);
    assert.equal(listing.path, root);
    assert.deepEqual(listing.directories, [{ name: "project", path: join(root, "project") }]);
    assert.equal(listing.parent, dirname(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
