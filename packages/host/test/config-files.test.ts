import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkToml, readConfigFile, writeConfigFile } from "../src/configuration/config-files.js";

test("TOML check accepts real configs and rejects broken ones", () => {
  checkToml(
    [
      'model = "gpt-6.1-sol"',
      "# comment",
      "[model_providers.custom]",
      'name = "x" # trailing',
      'base_url = "https://a/v1"',
      'env = { A = "1", B = "]" }',
      "list = [",
      '  "a",',
      "]",
      'notes = """',
      "anything [ here",
      '"""',
      "[[agents]]",
      "max = 1",
    ].join("\n"),
  );
  for (const bad of ['model = "x"\nbroken line', "a = [1, 2", "[t]\nk = { a = 1"])
    assert.throws(() => checkToml(bad));
});

test("config files: only listed paths, version check, validation and backup", (t) => {
  const home = mkdtempSync(join(tmpdir(), "kodo-cfg-"));
  const data = mkdtempSync(join(tmpdir(), "kodo-data-"));
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  t.after(() => {
    if (previous === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous;
    rmSync(home, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  });
  const path = join(home, "config.toml");
  writeFileSync(path, 'model = "a"\n');
  assert.throws(() => readConfigFile("codex", join(home, "other.toml"), data), /只能编辑/);
  const file = readConfigFile("codex", path, data);
  assert.equal(file.content, 'model = "a"\n');
  assert.throws(
    () => writeConfigFile("codex", { path, content: "broken line", version: file.version }, data),
    /格式不正确/,
  );
  const saved = writeConfigFile(
    "codex",
    { path, content: 'model = "b"\n', version: file.version },
    data,
  );
  assert.equal(readFileSync(path, "utf8"), 'model = "b"\n');
  assert.equal(readdirSync(join(data, "config-backups", "codex")).length, 1);
  assert.throws(
    () => writeConfigFile("codex", { path, content: 'model = "c"\n', version: file.version }, data),
    /已在别处修改/,
  );
  assert.ok(existsSync(path) && saved.version !== file.version);
});
