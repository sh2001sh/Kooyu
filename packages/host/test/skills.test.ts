import assert from "node:assert/strict";
import { test } from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { HarnessSkills } from "../src/configuration/skills.js";
import { Store } from "../src/storage/store.js";
import { loadSkills } from "@earendil-works/pi-coding-agent";

const content = (body = "Follow the supplied local procedure.") =>
  [
    "---",
    "name: local-procedure",
    "description: Run a supplied local procedure.",
    "---",
    "",
    body,
    "",
  ].join("\n");
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "kodo-skills-"));
  const store = new Store(":memory:"),
    home = join(root, "home"),
    data = join(root, "data"),
    workspace = join(root, "project");
  mkdirSync(home);
  mkdirSync(data);
  mkdirSync(workspace);
  return {
    root,
    home,
    data,
    store,
    workspace,
    manager: new HarnessSkills(store, data, "kodo", { home, env: {}, workspace }),
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test("skills: create/read/edit with content versions, validation and backups", () => {
  const f = fixture();
  try {
    const root = join(f.data, "kodo", "skills");
    const created = f.manager.create(root, "local-procedure", content());
    assert.equal(created.enabled, true);
    assert.equal(created.name, "local-procedure");
    assert.equal(f.manager.list().skills.length, 1);
    assert.throws(() => f.manager.create(root, "local-procedure", content()), /已存在/);
    assert.throws(() => f.manager.create(root, "../escape", content()), /目录名称/);
    assert.throws(() => f.manager.create(f.root, "escape", content()), /可写/);
    assert.throws(
      () => f.manager.save(created.path, "invalid markdown", created.version),
      /格式不正确/,
    );
    const edited = f.manager.save(created.path, content("Updated procedure."), created.version);
    assert.notEqual(edited.version, created.version);
    assert.equal(f.manager.read(created.path).content, content("Updated procedure."));
    assert.equal(readdirSync(join(f.data, "skill-backups", "kodo")).length, 1);
    assert.throws(() => f.manager.save(created.path, content(), created.version), /别处修改/);
    assert.throws(() => f.manager.read(join(f.root, "SKILL.md")), /未在此引擎/);
  } finally {
    f.close();
  }
});
test("skills: disabling changes discovery and enabling preserves resources; archive retains bundle", () => {
  const f = fixture();
  try {
    const created = f.manager.create(join(f.data, "kodo", "skills"), "local-procedure", content());
    writeFileSync(join(dirname(created.path), "resource.txt"), "keep resource");
    const discovered = () =>
      loadSkills({
        cwd: f.workspace,
        agentDir: join(f.data, "kodo"),
        skillPaths: [],
        includeDefaults: true,
      }).skills;
    assert(discovered().some((skill) => skill.filePath === created.path));
    const disabled = f.manager.toggle(created.path, false, created.version);
    assert.equal(disabled.enabled, false);
    assert.equal(existsSync(created.path), false);
    assert.equal(existsSync(created.path + ".kodo-disabled"), true);
    assert(!discovered().some((skill) => skill.filePath === created.path));
    assert.throws(() => f.manager.toggle(created.path, true, created.version), /别处修改/);
    const enabled = f.manager.toggle(created.path, true, disabled.version);
    assert.equal(enabled.enabled, true);
    assert.equal(readFileSync(created.path, "utf8"), content());
    assert(discovered().some((skill) => skill.filePath === created.path));
    const moved = f.manager.archive(created.path, enabled.version);
    assert.equal(f.manager.list().skills.length, 0);
    assert.equal(existsSync(dirname(created.path)), false);
    assert.equal(readFileSync(join(moved.path, "resource.txt"), "utf8"), "keep resource");
    assert.equal(readFileSync(join(moved.path, "SKILL.md"), "utf8"), content());
  } finally {
    f.close();
  }
});
test("skills: import preserves the complete bundle without running scripts or overwriting", () => {
  const f = fixture();
  try {
    const source = join(f.root, "source");
    mkdirSync(join(source, "scripts"), { recursive: true });
    writeFileSync(join(source, "SKILL.md"), content());
    writeFileSync(join(source, "scripts", "action.js"), "throw new Error('must never execute');");
    const root = join(f.data, "kodo", "skills"),
      imported = f.manager.import(root, source, "local-procedure");
    assert.equal(
      readFileSync(join(dirname(imported.path), "scripts", "action.js"), "utf8"),
      "throw new Error('must never execute');",
    );
    assert.throws(() => f.manager.import(root, source, "local-procedure"), /已存在/);
    assert.throws(() => f.manager.import(root, "relative-path"), /绝对路径/);
    assert.equal(f.manager.list().skills.length, 1);
  } finally {
    f.close();
  }
});
test("skills: shared/project paths, explicit custom roots and read-only linked/system skills", () => {
  const f = fixture();
  try {
    const shared = join(f.home, ".agents", "skills"),
      project = join(f.workspace, ".agents", "skills");
    const created = f.manager.create(shared, "local-procedure", content());
    f.manager.create(project, "project-procedure", content());
    const codex = new HarnessSkills(f.store, f.data, "codex", { home: f.home, env: {} });
    assert.equal(codex.list().skills.length, 1);
    const disabled = codex.toggle(created.path, false, created.version);
    assert.equal(f.manager.read(disabled.path).enabled, false);
    const system = join(shared, ".system", "protected");
    mkdirSync(system, { recursive: true });
    writeFileSync(join(system, "SKILL.md"), content());
    const protectedSkill = f.manager
      .list()
      .skills.find((skill) => skill.path === join(system, "SKILL.md"))!;
    assert.equal(protectedSkill.writable, false);
    assert.throws(
      () => f.manager.toggle(protectedSkill.path, false, protectedSkill.version),
      /只读/,
    );
    const target = join(f.root, "linked-target");
    mkdirSync(target);
    writeFileSync(join(target, "SKILL.md"), content());
    symlinkSync(target, join(shared, "linked-skill"), "junction");
    const linked = f.manager.list().skills.find((skill) => skill.path.includes("linked-skill"))!;
    assert.equal(linked.writable, false);
    assert.throws(() => f.manager.archive(linked.path, linked.version), /只读/);
    const unknown = new HarnessSkills(f.store, f.data, "grok-build", { home: f.home, env: {} });
    assert.equal(unknown.list().directories.length, 0);
    unknown.attach(target);
    assert.equal(unknown.list().skills.length, 1);
    unknown.detach(target);
    assert.equal(unknown.list().skills.length, 0);
    assert.equal(existsSync(join(target, "SKILL.md")), true);
    assert.throws(() => unknown.attach(f.home), /用户根目录/);
  } finally {
    f.close();
  }
});
