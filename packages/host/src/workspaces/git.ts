import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { KodoError, type Workspace } from "@kodo/protocol";
import { workspaceChanges } from "./files.js";
import type { SessionService } from "../session-service.js";

const file = z.string().min(1).max(4096);
const hunk = z.object({ path: file, id: z.string().regex(/^[a-f0-9]{64}$/) });
const actions = {
  stage: z.object({ path: file }),
  unstage: z.object({ path: file }),
  "discard-file": z.object({ path: file, confirmed: z.literal(true) }),
  hunks: z.object({ path: file }),
  "stage-hunk": hunk,
  "discard-hunk": hunk.extend({ confirmed: z.literal(true) }),
  "suggest-message": z.object({}),
  commit: z.object({ message: z.string().trim().min(1).max(4000) }),
  merge: z.object({ worktreeId: z.string().uuid(), mode: z.enum(["ff", "squash"]) }),
  "abort-merge": z.object({}),
  pr: z.object({ title: z.string().trim().min(1).max(250), body: z.string().max(30000) }),
};

function execute(workspace: Workspace, binary: string, args: string[], input?: string) {
  return new Promise<string>((resolve, reject) => {
    const child = execFile(
      binary,
      args,
      {
        cwd: workspace.rootPath,
        windowsHide: true,
        timeout: 60000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" },
      },
      (error, stdout, stderr) =>
        error
          ? reject(new KodoError("CONFLICT", (stderr || error.message).slice(-2000)))
          : resolve(stdout),
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  });
}

async function workingHunks(workspace: Workspace, path: string) {
  const diff = await execute(workspace, "git", [
    "--literal-pathspecs",
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--no-renames",
    "--",
    path,
  ]);
  const parts = diff.split(/(?=^@@ )/m);
  const header = parts.shift() ?? "";
  return parts.filter(Boolean).map((text) => ({
    id: createHash("sha256")
      .update(header + text)
      .digest("hex"),
    text,
    patch: header + text,
  }));
}

function synthesizeCommitMessage(nameStatusRaw: string, shortStatRaw: string): string {
  const entries = nameStatusRaw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status = "M", ...rest] = line.split(/\t+/);
      const path = rest.at(-1) ?? "";
      return { status: status[0] ?? "M", path };
    })
    .filter((e) => e.path);
  if (!entries.length) return "chore: update workspace changes";
  const allTests = entries.every((e) =>
    /(^|\/)(test|tests|__tests__)\/|\.test\.|\.spec\./i.test(e.path),
  );
  const allDocs = entries.every(
    (e) => /\.(md|mdx|txt)$/i.test(e.path) || e.path.startsWith("docs/"),
  );
  const allAdded = entries.every((e) => e.status === "A");
  const allDeleted = entries.every((e) => e.status === "D");
  const type = allTests
    ? "test"
    : allDocs
      ? "docs"
      : allAdded
        ? "feat"
        : allDeleted
          ? "chore"
          : "fix";
  const scopes = [...new Set(entries.map((e) => e.path.split("/").slice(0, 2).join("/")))];
  const scope = scopes.length === 1 ? scopes[0]!.replace(/[^a-zA-Z0-9._/-]/g, "") : "";
  const firstFiles = entries
    .slice(0, 3)
    .map((e) => e.path.split("/").pop())
    .join(", ");
  const extra = entries.length > 3 ? ` (+${entries.length - 3} files)` : "";
  const summary =
    entries.length === 1
      ? `${allAdded ? "add" : allDeleted ? "remove" : "update"} ${entries[0]!.path}`
      : `update ${firstFiles}${extra}`;
  const stat = shortStatRaw.trim();
  const header = scope ? `${type}(${scope}): ${summary}` : `${type}: ${summary}`;
  return stat ? `${header}\n\n${stat}` : header;
}

async function createPrWithGithubApi(
  token: string,
  repo: string,
  branch: string,
  base: string,
  title: string,
  body: string,
): Promise<string> {
  const owner = repo.split("/")[0]!;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "Kooyu-Host",
    "Content-Type": "application/json",
  };
  const existingRes = await fetch(
    `https://api.github.com/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`,
    { headers, signal: AbortSignal.timeout(20000) },
  );
  if (existingRes.ok) {
    const existing = (await existingRes.json()) as Array<{ html_url?: string }>;
    if (existing[0]?.html_url) return existing[0].html_url;
  }
  const createRes = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title, body, head: branch, base }),
    signal: AbortSignal.timeout(20000),
  });
  const payload = (await createRes.json().catch(() => ({}))) as {
    html_url?: string;
    message?: string;
  };
  if (!createRes.ok || !payload.html_url) {
    throw new KodoError(
      "CONFLICT",
      `分支已推送，但 GitHub API 创建 PR 失败：${payload.message ?? `HTTP ${createRes.status}`}`,
    );
  }
  return payload.html_url;
}

export async function workspaceGit(
  service: SessionService,
  workspace: Workspace,
  operation: string,
  raw: unknown,
  actor: string,
) {
  if (workspace.hostId !== service.store.hostId)
    throw new KodoError("UNSUPPORTED", "请选择本机工作区。");
  if (operation === "branches")
    return service.worktrees
      .list({ parentWorkspaceId: workspace.id })
      .filter((wt) => wt.lifecycleState === "ready" && !wt.branchName.startsWith("detached-"))
      .map(({ workspaceId, branchName }) => ({ workspaceId, branchName }));
  if (!Object.hasOwn(actions, operation)) throw new KodoError("NOT_FOUND", "未知 Git 操作。");
  const data = actions[operation as keyof typeof actions].strict().parse(raw);
  const locked = "worktreeId" in data ? [workspace.id, data.worktreeId] : [workspace.id];
  return service.worktrees.mutex.runMany(locked, async () => {
    const git = (args: string[], input?: string) => execute(workspace, "git", args, input);
    if (
      operation !== "hunks" &&
      operation !== "suggest-message" &&
      service.store
        .sessions()
        .some((s) => s.workspaceId && locked.includes(s.workspaceId) && s.runState !== "idle")
    )
      throw new KodoError("CONFLICT", "请先暂停此工作区内运行的会话。");
    if (operation === "suggest-message") {
      let nameStatus = await git(["diff", "--cached", "--name-status"]).catch(() => "");
      let shortStat = await git(["diff", "--cached", "--shortstat"]).catch(() => "");
      let scope: "staged" | "working" = "staged";
      if (!nameStatus.trim()) {
        nameStatus = await git(["diff", "--name-status"]).catch(() => "");
        shortStat = await git(["diff", "--shortstat"]).catch(() => "");
        scope = "working";
      }
      return { message: synthesizeCommitMessage(nameStatus, shortStat), scope };
    }
    if (operation === "abort-merge") {
      await git(["merge", "--abort"]);
      return workspaceChanges(workspace);
    }
    if ("path" in data) {
      const changes = await workspaceChanges(workspace);
      const entry = changes.files.find((f) => f.path === data.path);
      if (!entry) throw new KodoError("CONFLICT", "文件改动已更新，请刷新。");
      if (operation === "stage") await git(["--literal-pathspecs", "add", "--", data.path]);
      else if (operation === "unstage")
        await git(
          changes.baseline === "empty"
            ? ["--literal-pathspecs", "rm", "--cached", "--", data.path]
            : ["--literal-pathspecs", "reset", "HEAD", "--", data.path],
        );
      else if (operation === "discard-file") {
        if (entry.status === "untracked") {
          throw new KodoError(
            "INVALID_INPUT",
            "未跟踪的新文件不能通过 Git 丢弃，请在文件区手动删除。",
          );
        }
        const id = randomUUID();
        const audit = {
          id,
          actor,
          workspaceId: workspace.id,
          path: data.path,
          kind: "file",
          at: new Date().toISOString(),
        };
        service.store.put("git-discard", id, { ...audit, status: "dispatched" });
        if (changes.baseline !== "empty") {
          await git(["--literal-pathspecs", "checkout", "HEAD", "--", data.path]);
        } else {
          await git(["--literal-pathspecs", "rm", "--cached", "--", data.path]);
        }
        service.store.put("git-discard", id, { ...audit, status: "confirmed" });
      } else {
        const hunks = await workingHunks(workspace, data.path);
        if (operation === "hunks") return hunks.map(({ id, text }) => ({ id, text }));
        const selected = hunks.find((h) => "id" in data && h.id === data.id);
        if (!selected) throw new KodoError("CONFLICT", "差异块已变化，请刷新后重新选择。");
        if (operation === "discard-hunk") {
          const id = randomUUID();
          const audit = {
            id,
            actor,
            workspaceId: workspace.id,
            path: data.path,
            hunk: selected.id,
            at: new Date().toISOString(),
          };
          service.store.put("git-discard", id, { ...audit, status: "dispatched" });
          await git(["apply", "--reverse", "--whitespace=nowarn", "-"], selected.patch);
          service.store.put("git-discard", id, { ...audit, status: "confirmed" });
          return { discarded: selected.id };
        }
        await git(["apply", "--cached", "--whitespace=nowarn", "-"], selected.patch);
      }
    } else {
      if ((await git(["rev-parse", "--show-prefix"])).trim())
        throw new KodoError("INVALID_INPUT", "此操作需要绑定仓库根目录。");
      if ("message" in data) await git(["commit", "-m", data.message]);
      if ("worktreeId" in data) {
        const wt = service.worktrees.get(data.worktreeId);
        if (!wt || wt.parentWorkspaceId !== workspace.id || wt.lifecycleState !== "ready")
          throw new KodoError("INVALID_INPUT", "请选择此主工作区的就绪分支。");
        if ((await git(["status", "--porcelain"])).trim())
          throw new KodoError("CONFLICT", "PRIMARY_WORKSPACE_DIRTY");
        try {
          await git(["merge", data.mode === "ff" ? "--ff-only" : "--squash", "--", wt.branchName]);
        } catch (err) {
          const conflictsRaw = await git(["diff", "--name-only", "--diff-filter=U"]).catch(
            () => "",
          );
          const conflictedFiles = conflictsRaw
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean);
          if (conflictedFiles.length > 0) {
            throw new KodoError("CONFLICT", `MERGE_CONFLICT:${conflictedFiles.join(",")}`);
          }
          throw err;
        }
      }
      if ("title" in data) {
        const branch = (await git(["branch", "--show-current"])).trim();
        if (!branch) throw new KodoError("CONFLICT", "请先切换到具名分支。");
        const remote = (await git(["remote", "get-url", "origin"])).trim();
        const match =
          /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(
            remote,
          );
        const repo = match?.[1];
        if (!repo) throw new KodoError("UNSUPPORTED", "请将 origin 配置为 GitHub 仓库以创建 PR。");
        await git(["push", "--set-upstream", "origin", "HEAD"]);
        const lookup = async () => {
          const rows: { url: string; headRepositoryOwner?: { login: string } }[] = JSON.parse(
            await execute(workspace, "gh", [
              "pr",
              "list",
              "--repo",
              repo,
              "--state",
              "open",
              "--head",
              branch,
              "--json",
              "url,headRepositoryOwner",
            ]),
          );
          return rows.find(
            (row) =>
              row.headRepositoryOwner?.login.toLowerCase() === repo.split("/")[0]!.toLowerCase(),
          )?.url;
        };
        try {
          const existing = await lookup();
          if (existing) return { url: existing };
          return {
            url: (
              await execute(
                workspace,
                "gh",
                [
                  "pr",
                  "create",
                  "--repo",
                  repo,
                  "--head",
                  branch,
                  "--title",
                  data.title,
                  "--body-file",
                  "-",
                ],
                data.body,
              )
            ).trim(),
          };
        } catch (cause) {
          const confirmed = await lookup().catch(() => undefined);
          if (confirmed) return { url: confirmed };
          const token = await service.applications.githubToken();
          if (token) {
            const defaultBase =
              (await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).catch(() => ""))
                .trim()
                .replace(/^origin\//, "") || "main";
            const url = await createPrWithGithubApi(
              token,
              repo,
              branch,
              defaultBase,
              data.title,
              data.body ?? "",
            );
            return { url };
          }
          throw new KodoError(
            "CONFLICT",
            "分支已推送，PR 创建结果待核对。可重试以查询已有 PR。" +
              (cause instanceof Error ? " " + cause.message : ""),
          );
        }
      }
    }
    return workspaceChanges(workspace);
  });
}
