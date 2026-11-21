import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Store } from "../src/storage/store.js";
import { SessionService } from "../src/session-service.js";
import { createSelfHostedTools } from "../src/kodo/self-hosted-tools.js";
import { createHostServer } from "../src/http/server.js";
import { SkillSedimentService } from "../src/configuration/skill-sediment.js";
import { isQuotaOrRateLimitError } from "../src/delegation/routing.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-p234-"));
  const store = new Store(join(dir, "host.sqlite"));
  const service = new SessionService(store, { dataDir: dir });
  const controller = service.createDraft({
    title: "Kooyu 主助手",
    harnessId: "kodo",
    kind: "supervisor",
  });
  const setActiveUserTurn = (text: string) => {
    const commandId = randomUUID();
    store.saveCommand({
      id: commandId,
      sessionId: controller.id,
      kind: "send",
      origin: "user",
      controllerId: null,
      generation: controller.ownerEpoch,
      bindingRevision: null,
      nativeRunId: null,
      status: "dispatched",
      body: { text },
      createdAt: new Date().toISOString(),
    });
    store.put("active-tool-turn", controller.id, { id: commandId });
  };
  const callTool = async (name: string, args: Record<string, unknown>) => {
    const tool = createSelfHostedTools(service, controller).find((t) => t.name === name);
    assert.ok(tool, `tool ${name} should exist`);
    const res = await (
      tool.execute as (...a: unknown[]) => Promise<{ content: { text: string }[] }>
    )(randomUUID(), args);
    return JSON.parse(res.content[0]!.text);
  };
  const cleanup = async () => {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { dir, store, service, controller, setActiveUserTurn, callTool, cleanup };
}

test("SkillSedimentService versions skills, distributes to shared ~/.agents/skills, rolls back 5-version history, and blocks secrets/traversal", () => {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-sediment-"));
  const shared = join(dir, "shared-agents-skills");
  try {
    const svc = new SkillSedimentService(dir, { sharedAgentsDir: shared });

    // Rejects secrets and path traversal
    assert.throws(
      () =>
        svc.sediment({
          name: "bad-secret",
          title: "Secret",
          description: "desc",
          body: "Use sk-1234567890abcdef",
        }),
      /密钥/,
    );
    assert.throws(
      () =>
        svc.sediment({
          name: "bad-path",
          title: "Path",
          description: "desc",
          body: "safe body",
          scripts: [{ path: "../escape.sh", content: "echo hi" }],
        }),
      /路径/,
    );

    // Sediment v1 with script + cross-Harness shared distribution
    const v1 = svc.sediment({
      name: "release-check",
      title: "发布前构建检查",
      description: "自动执行 typecheck、lint 和核心回归测试。",
      body: "## 步骤\n1. npm run typecheck\n2. npm run lint",
      scripts: [{ path: "verify.sh", content: "npm run typecheck" }],
      fromHarnessId: "claude-code",
      distributeToShared: true,
    });
    assert.equal(v1.record.version, 1);
    assert.equal(v1.distributedToShared, true);
    assert.ok(existsSync(join(shared, "release-check", "SKILL.md")));

    // Update to v2 -> v1 snapshot saved into .history/1
    const v2 = svc.sediment({
      name: "release-check",
      title: "发布前构建检查 v2",
      description: "新增打包验证。",
      body: "## 步骤 v2\n1. npm run build",
      distributeToShared: true,
    });
    assert.equal(v2.record.version, 2);
    assert.deepEqual(v2.record.historyVersions, [1]);
    assert.ok(readFileSync(v2.record.path, "utf8").includes("步骤 v2"));

    // Rollback to v1 -> content restored and synced to shared dir
    const rolled = svc.rollback("release-check", 1);
    assert.equal(rolled.version, 3);
    assert.ok(readFileSync(rolled.path, "utf8").includes("npm run typecheck"));
    assert.ok(
      readFileSync(join(shared, "release-check", "SKILL.md"), "utf8").includes("npm run typecheck"),
    );

    // Archive removes active skill and shared copy without permanent deletion
    const archived = svc.archive("release-check");
    assert.equal(archived.archived, true);
    assert.ok(existsSync(archived.archivePath));
    assert.equal(existsSync(join(shared, "release-check")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MemoryConsolidationService extracts MEMORY.md & AGENTS.md proposals from daily logs and approves cleanly", async () => {
  const f = setup();
  try {
    f.setActiveUserTurn(
      "记一下：Windows 下运行 PowerShell 不能用 && 串联命令要改用分号；另外我每周五下午习惯复盘本周目标。",
    );
    await f.callTool("memory", {
      action: "log_daily",
      input: {
        note: "构建踩坑：Windows PowerShell 5.1 执行构建命令不能用 &&，改用分号和 $LASTEXITCODE。",
        evidenceQuotes: ["Windows 下运行 PowerShell 不能用 && 串联命令要改用分号"],
      },
    });
    await f.callTool("memory", {
      action: "log_daily",
      input: {
        note: "个人节奏：每周五下午习惯复盘本周目标并整理下周优先级。",
        evidenceQuotes: ["我每周五下午习惯复盘本周目标"],
      },
    });

    const gen = await f.callTool("memory", { action: "consolidate" });
    assert.equal(gen.created.length, 2);
    const agentsProp = gen.created.find((p: { targetDoc: string }) => p.targetDoc === "AGENTS.md");
    const memoryProp = gen.created.find((p: { targetDoc: string }) => p.targetDoc === "MEMORY.md");
    assert.ok(agentsProp, "build pitfall should target AGENTS.md");
    assert.ok(memoryProp, "personal habit should target MEMORY.md");

    // Approve AGENTS.md proposal -> appears in AGENTS.md and next turn prompt
    await f.callTool("memory", {
      action: "approve_proposal",
      input: { id: agentsProp.id },
    });
    assert.ok(f.service.memory.docs!.get("AGENTS.md").content.includes("PowerShell 5.1"));
    assert.ok(f.service.memory.renderPromptBlock(null).includes("## AGENTS.md"));
  } finally {
    await f.cleanup();
  }
});

test("KnowledgeService mounts Obsidian/docs roots read-only with CJK-normalized zero-vector search and traversal protection", async () => {
  const f = setup();
  const vaultDir = mkdtempSync(join(tmpdir(), "kooyu-obsidian-"));
  try {
    mkdirSync(join(vaultDir, "architecture"), { recursive: true });
    writeFileSync(
      join(vaultDir, "architecture", "gateway.md"),
      "# 网关设计\n\n使用零拷贝转发，超时设置 90s。\n⻔门户鉴权采用双向签名。\n",
      "utf8",
    );

    const mount = f.service.knowledge.addMount({
      requestId: randomUUID(),
      label: "Obsidian Vault",
      path: vaultDir,
    });
    assert.equal(f.service.knowledge.listMounts().length, 1);

    // Kangxi radical '⻔' normalized to '门' matches '门户鉴权'
    const searchRes = await f.callTool("knowledge", {
      action: "search",
      input: { query: "门户鉴权" },
    });
    assert.equal(searchRes.hits.length, 1);
    assert.equal(searchRes.hits[0].relativePath, "architecture/gateway.md");
    assert.equal(searchRes.hits[0].line, 4);

    // Bounded slice read works, traversal blocked
    const slice = await f.callTool("knowledge", {
      action: "read",
      input: {
        mountId: mount.id,
        relativePath: "architecture/gateway.md",
        startLine: 1,
        endLine: 10,
      },
    });
    assert.ok(slice.content.includes("零拷贝转发"));

    await assert.rejects(
      () =>
        f.callTool("knowledge", {
          action: "read",
          input: { mountId: mount.id, relativePath: "../../etc/passwd" },
        }),
      /挂载目录/,
    );
  } finally {
    rmSync(vaultDir, { recursive: true, force: true });
    await f.cleanup();
  }
});

test("show_page sanitizes scripts and serves offline-CSP Kooyu themed HTML over Host HTTP", async () => {
  const f = setup();
  const options = { port: 0, webRoot: f.dir };
  const server = createHostServer(f.service, options);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  assert.ok(addr && typeof addr !== "string");
  options.port = addr.port;
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    const page = await f.callTool("show_page", {
      title: "引擎对比研报",
      summary: "Claude Code vs Codex 实测对比",
      html: "<table><tr><th>引擎</th><th>结果</th></tr><tr><td>Claude Code</td><td>通过</td></tr></table><script>alert(1)</script>",
    });
    const res = await fetch(`${base}${page.url}`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get("content-security-policy")?.includes("default-src 'none'"));
    const body = await res.text();
    assert.ok(body.includes("引擎对比研报"));
    assert.ok(body.includes("Claude Code"));
    assert.equal(body.includes("<script>"), false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await f.cleanup();
  }
});

test("ROUTING.md smart router recommends Harnesses and prepares seamless quota-fallback handoff", async () => {
  const f = setup();
  try {
    const recRefactor = await f.callTool("routing", {
      action: "recommend",
      input: { taskText: "请帮我做一个跨模块架构重构" },
    });
    assert.equal(recRefactor.recommended, "claude-code");

    const recDocs = await f.callTool("routing", {
      action: "recommend",
      input: { taskText: "更新 README 文档和 lint 修复" },
    });
    assert.equal(recDocs.recommended, "gemini");

    // Simulate a Claude Code session hitting 429 rate limit -> auto fallback to Codex
    assert.equal(isQuotaOrRateLimitError("HTTP 429 Too Many Requests: rate_limit_exceeded"), true);
    const project = f.service.createProject({ name: "核心服务", rootPath: f.dir });
    const ws = f.service.snapshot().workspaces.find((w) => w.projectId === project.id)!;
    const claudeSession = f.service.createDraft({
      title: "重构订单状态机",
      harnessId: "claude-code",
      kind: "direct",
      projectId: project.id,
      workspaceId: ws.id,
    });
    const handoff = await f.callTool("routing", {
      action: "quota_handoff",
      input: { sessionId: claudeSession.id, errorText: "429 rate limit exceeded" },
    });
    assert.equal(handoff.triggered, true);
    assert.equal(handoff.fromHarnessId, "claude-code");
    assert.equal(handoff.toHarnessId, "codex");
    assert.ok(handoff.summary.includes("自动限额接力"));
  } finally {
    await f.cleanup();
  }
});

test("GitCheckpointService captures zero-pollution hidden snapshots and restores tracked + untracked files cleanly", async () => {
  const f = setup();
  const repoDir = mkdtempSync(join(tmpdir(), "kooyu-cp-repo-"));
  const runGit = (...args: string[]) =>
    execFileSync("git", args, { cwd: repoDir, encoding: "utf8", windowsHide: true }).trim();
  try {
    runGit("init");
    runGit("config", "core.autocrlf", "false");
    runGit("config", "user.name", "Test");
    runGit("config", "user.email", "test@kooyu.local");
    writeFileSync(join(repoDir, "app.ts"), "export const version = 1;\n", "utf8");
    runGit("add", "app.ts");
    runGit("commit", "-m", "initial");

    // Capture checkpoint before risky edits
    const cp = await f.callTool("checkpoint", {
      action: "capture",
      input: { workspaceRoot: repoDir, label: "重构前快照" },
    });
    assert.ok(cp.ref.startsWith("refs/kooyu/checkpoints/"));
    // Real git log must NOT be polluted
    assert.equal(runGit("rev-list", "--count", "HEAD"), "1");

    // Make messy edits + untracked garbage file
    writeFileSync(join(repoDir, "app.ts"), "export const version = 999; // broken\n", "utf8");
    writeFileSync(join(repoDir, "messy-temp.ts"), "garbage", "utf8");

    // Restore checkpoint -> original file restored, messy untracked file removed, safety snapshot created!
    const restored = await f.callTool("checkpoint", {
      action: "restore",
      input: { checkpointId: cp.id },
    });
    assert.equal(readFileSync(join(repoDir, "app.ts"), "utf8"), "export const version = 1;\n");
    assert.equal(existsSync(join(repoDir, "messy-temp.ts")), false);
    assert.ok(restored.safetyCheckpoint.id);
    assert.equal(runGit("rev-list", "--count", "HEAD"), "1");
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
    await f.cleanup();
  }
});

test("MultiHarnessArenaService compares isolated worktrees with real checkCommand and accepts winning contender", async () => {
  const f = setup();
  const wtA = mkdtempSync(join(tmpdir(), "kooyu-arena-a-"));
  const wtB = mkdtempSync(join(tmpdir(), "kooyu-arena-b-"));
  const initRepo = (dir: string, content: string) => {
    execFileSync("git", ["init"], { cwd: dir, windowsHide: true });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, windowsHide: true });
    execFileSync("git", ["config", "user.email", "t@kooyu.local"], { cwd: dir, windowsHide: true });
    writeFileSync(join(dir, "ok.txt"), "base\n", "utf8");
    execFileSync("git", ["add", "ok.txt"], { cwd: dir, windowsHide: true });
    execFileSync("git", ["commit", "-m", "init"], { cwd: dir, windowsHide: true });
    writeFileSync(join(dir, "ok.txt"), content, "utf8");
  };
  try {
    initRepo(wtA, "PASS\n");
    initRepo(wtB, "FAIL\n");
    const project = f.service.createProject({ name: "竞技场项目", rootPath: wtA });
    const ws = f.service.snapshot().workspaces.find((w) => w.projectId === project.id)!;
    const sA = f.service.createDraft({
      title: "Claude 方案",
      harnessId: "claude-code",
      kind: "direct",
      projectId: project.id,
      workspaceId: ws.id,
    });
    const sB = f.service.createDraft({
      title: "Codex 方案",
      harnessId: "codex",
      kind: "direct",
      projectId: project.id,
      workspaceId: ws.id,
    });

    const arenaId = randomUUID();
    f.store.put("harness-arena", arenaId, {
      id: arenaId,
      controllerSessionId: f.controller.id,
      title: "性能优化对决",
      task: "把 ok.txt 改为 PASS",
      projectId: project.id,
      workspaceId: ws.id,
      checkCommand: `${JSON.stringify(process.execPath)} -e "process.exit(require('fs').readFileSync('ok.txt','utf8').trim()==='PASS'?0:1)"`,
      competitors: [
        {
          harnessId: "claude-code",
          ticketId: "ticket-a",
          sessionId: sA.id,
          worktreePath: wtA,
          branchName: "arena-a",
        },
        {
          harnessId: "codex",
          ticketId: "ticket-b",
          sessionId: sB.id,
          worktreePath: wtB,
          branchName: "arena-b",
        },
      ],
      status: "running",
      winnerTicketId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const compared = await f.callTool("harness_arena", {
      action: "compare",
      input: { arenaId },
    });
    assert.equal(compared.scorecard.length, 2);
    assert.equal(compared.scorecard[0].checkPassed, true);
    assert.equal(compared.scorecard[1].checkPassed, false);

    const accepted = await f.callTool("harness_arena", {
      action: "accept",
      input: { arenaId, winnerTicketId: "ticket-a" },
    });
    assert.equal(accepted.status, "accepted");
    assert.equal(accepted.winnerTicketId, "ticket-a");
  } finally {
    rmSync(wtA, { recursive: true, force: true });
    rmSync(wtB, { recursive: true, force: true });
    await f.cleanup();
  }
});
