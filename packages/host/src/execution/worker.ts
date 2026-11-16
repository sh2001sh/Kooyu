import {
  readFileSync,
  realpathSync,
  mkdirSync,
  lstatSync,
  openSync,
  writeFileSync,
  closeSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Store } from "../storage/store.js";
import { SessionService } from "../session-service.js";
import { configureVault } from "../credentials/vault.js";
import type { MessageAttachment } from "@kodo/protocol";

/** Run explicitly with scripts/worker.mjs; credentials and native history stay here. */
export async function runWorker(configFile: string) {
  const config = z
    .object({
      hostUrl: z.string().url(),
      executorId: z.string().uuid(),
      tokenFile: z.string().min(1),
      dataDir: z.string().min(1),
      roots: z.array(z.string()).min(1),
      harnessIds: z.array(z.string()).min(1),
    })
    .strict()
    .parse(JSON.parse(readFileSync(configFile, "utf8")));
  const url = new URL(config.hostUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Worker requires an HTTPS Host origin");
  const tokenStat = lstatSync(config.tokenFile);
  if (!tokenStat.isFile() || (process.platform !== "win32" && (tokenStat.mode & 0o077) !== 0))
    throw new Error("Worker token file must be private (0600)");
  const token = readFileSync(config.tokenFile, "utf8").trim();
  if (token.length < 32) throw new Error("Worker token is missing");
  mkdirSync(config.dataDir, { recursive: true });
  const lock = join(config.dataDir, "host.lock");
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, "utf8"));
    try {
      process.kill(pid, 0);
      throw new Error("Worker data directory already in use");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e;
    }
    unlinkSync(lock);
  }
  const fd = openSync(lock, "wx", 0o600);
  writeFileSync(fd, String(process.pid));
  closeSync(fd);
  const unlock = () => {
    try {
      if (readFileSync(lock, "utf8") === String(process.pid)) unlinkSync(lock);
    } catch {}
  };
  process.once("exit", unlock);
  configureVault(config.dataDir);
  const roots = config.roots.map((p) => realpathSync(p)),
    store = new Store(join(config.dataDir, "worker.sqlite"));
  store.recover();
  // A Host task with an intent but no receipt is reported as unknown below.
  // Fence its local queued input too, before SessionService's recovery timer can
  // dispatch it independently of that report.
  store.transaction(() => {
    for (const command of store.commands())
      if (command.status === "accepted")
        store.saveCommand({
          ...command,
          status: "unknown",
          error:
            "Worker restarted before its task receipt; reconcile native history before retrying.",
        });
  });
  const service = new SessionService(store, { dataDir: config.dataDir });
  let stopping = false;
  const running = new Set<string>();
  const jobs = new Set<Promise<void>>();
  const endpoint = (action: string) =>
    config.hostUrl.replace(/\/$/, "") + "/worker/" + config.executorId + "/" + action;
  const post = async (action: string, p: unknown) => {
    const r = await fetch(endpoint(action), {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(p),
      redirect: "error",
      signal: AbortSignal.timeout(35000),
    });
    if (!r.ok) throw new Error("Host refused worker request: " + r.status);
    return r.json() as Promise<any>;
  };
  const localSession = (hostSessionId: string) => {
    const m = store.record<{ sessionId: string }>("host-session", hostSessionId);
    if (!m) throw new Error("Remote session mapping missing");
    return store.session(m.sessionId);
  };
  const execute = async (task: any) => {
    if (running.has(task.id)) return;
    running.add(task.id);
    try {
      const saved = store.record<{ status: string; result: unknown; fingerprint: string }>(
        "worker-result",
        task.id,
      );
      if (saved) {
        if (saved.fingerprint !== task.fingerprint)
          throw new Error("Remote action fingerprint conflict");
        await post("result", { id: task.id, ...saved });
        return;
      }
      const intent = store.record<{ fingerprint: string }>("worker-intent", task.id);
      if (intent) {
        if (intent.fingerprint !== task.fingerprint)
          throw new Error("Remote action fingerprint conflict");
        const receipt = {
          status: "unknown",
          result: {
            error:
              "Worker restarted after accepting this action; inspect native history before retrying.",
          },
          fingerprint: task.fingerprint,
        };
        store.put("worker-result", task.id, receipt);
        await post("result", { id: task.id, ...receipt });
        return;
      }
      // Persist before any native action: loss of the result never repeats a write.
      store.put("worker-intent", task.id, { fingerprint: task.fingerprint });
      let result: unknown,
        status = "confirmed";
      const args = task.arguments;
      try {
        if (task.operation === "open") {
          if (!config.harnessIds.includes(args.harnessId))
            throw new Error("Harness is outside this node's configured capability");
          const root = realpathSync(args.rootPath);
          if (
            !roots.some((base) => {
              const rel = relative(base, root);
              return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
            })
          )
            throw new Error("Workspace is outside allowed roots");
          let mapped = store.record<{ sessionId: string }>("host-session", task.sessionId);
          if (!mapped)
            mapped = store.transaction(() => {
              const workspace = service.addWorkspace(null, root);
              const local = service.createDraft({
                title: args.title,
                harnessId: args.harnessId,
                kind: "direct",
                workspaceId: workspace.id,
                model: args.model,
                reasoning: args.reasoning,
                permissionMode: args.permissionMode,
              });
              const value = { sessionId: local.id, hostSessionId: task.sessionId };
              store.put("host-session", task.sessionId, value);
              return value;
            });
          const opened = await service.openNative(mapped.sessionId);
          result = { nativeSessionId: opened.nativeSessionId };
        } else {
          const s = localSession(task.sessionId);
          if (task.operation === "send") {
            const files: string[] = [];
            for (const file of args.attachments as MessageAttachment[]) {
              const old = store.record<{ fileId: string }>("host-file", s.id + ":" + file.fileId);
              if (old) {
                files.push(old.fileId);
                continue;
              }
              const r = await fetch(endpoint("file") + "?id=" + encodeURIComponent(file.fileId), {
                headers: { Authorization: "Bearer " + token },
                redirect: "error",
                signal: AbortSignal.timeout(60000),
              });
              if (!r.ok || !r.body) throw new Error("Attachment transfer failed");
              const upload = service.files.createUpload({
                requestId: randomUUID(),
                displayName: file.displayName,
                size: file.size,
                sha256: file.sha256,
                mediaType: file.mediaType,
                sessionId: s.id,
              });
              let offset = 0;
              try {
                for await (const chunk of r.body) {
                  const bytes = Buffer.from(chunk);
                  service.files.appendChunk(upload.id, offset, bytes);
                  offset += bytes.length;
                  if (offset > file.size) throw new Error("Transfer size exceeded");
                }
                const imported = await service.files.completeUpload(upload.id);
                store.put("host-file", s.id + ":" + file.fileId, {
                  fileId: imported.id,
                  sha256: imported.sha256,
                });
                files.push(imported.id);
              } catch (e) {
                service.files.cancelUpload(upload.id);
                throw e;
              }
            }
            const prior = store.command(args.commandId);
            if (!prior && args.settings)
              await service.setModelSettings(s.id, {
                requestId: randomUUID(),
                expectedRevision: s.settingsRevision ?? 0,
                model: args.settings.model,
                reasoning: args.settings.reasoning,
              });
            service.acceptSend(s.id, {
              requestId: args.commandId,
              text: args.text,
              mode: args.mode,
              attachmentIds: files,
            });
            for (;;) {
              const command = store.command(args.commandId)!;
              if (command.status === "confirmed") {
                result = { nativeRunId: command.nativeRunId };
                break;
              }
              if (["unknown", "rejected", "cancelled"].includes(command.status))
                throw new Error("Native command is " + command.status);
              if (stopping) throw new Error("Worker stopping with pending native command");
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
          } else if (task.operation === "cancel") result = await service.stop(s.id, true);
          else if (task.operation === "read") result = await service.nativeRead(s.id);
          else if (task.operation === "list") result = await service.nativeList(s.id);
          else if (task.operation === "quota") result = await service.quota(s.id);
          else if (task.operation === "models") result = await service.sessionModelOptions(s.id);
          else if (task.operation === "answer")
            result = service.answerInteraction(args.requestId, args.answer, task.id);
          else throw new Error("Unsupported worker operation");
        }
      } catch {
        status = "unknown";
        result = { error: "节点未能确认执行结果，请检查节点原生历史与动作回执。" };
      }
      const receipt = { status, result: result ?? null, fingerprint: task.fingerprint };
      store.put("worker-result", task.id, receipt);
      await post("result", { id: task.id, ...receipt });
    } finally {
      running.delete(task.id);
    }
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      stopping = true;
    });
  try {
    while (!stopping) {
      try {
        const cursor = store.record<{ sequence: number }>("host-events", "cursor")?.sequence ?? 0;
        const events = store.events(undefined, cursor, 100),
          mappings = store.records<{ sessionId: string; hostSessionId: string }>("host-session");
        const outgoing = events.flatMap((event) => {
          const mapping = mappings.find((m) => m.sessionId === event.sessionId);
          return mapping ? [{ sessionId: mapping.hostSessionId, event }] : [];
        });
        const response = await post("poll", {
          capabilities: ["files", ...config.harnessIds.map((id) => "harness:" + id)],
          platform: process.platform,
          events: outgoing,
        });
        if (events.length)
          store.put("host-events", "cursor", { sequence: events.at(-1)!.sequence });
        for (const task of response.tasks) {
          if (stopping) break;
          const job = execute(task)
            .catch(() => {})
            .finally(() => jobs.delete(job));
          jobs.add(job);
        }
      } catch {
        /* Retain receipts and cursor until the Host is reachable again. */
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } finally {
    stopping = true;
    await Promise.allSettled([...jobs]);
    await service.dispose();
    store.close();
    unlock();
    process.removeListener("exit", unlock);
  }
}
