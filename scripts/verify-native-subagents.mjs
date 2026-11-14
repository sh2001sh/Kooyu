// Explicit authenticated model acceptance in an isolated workspace; only generated markers are read.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Store } from "../packages/host/dist/storage/store.js";
import { SessionService } from "../packages/host/dist/session-service.js";
import { nativeLaunch } from "../packages/host/dist/configuration/config.js";
import { getAdapter } from "../packages/host/dist/harnesses/registry.js";
import { subagentEvidence } from "./native-subagent-evidence.mjs";

function terminalDetails(events) {
  const end = events.filter((event) => event.type === "turn-ended").at(-1);
  const error = end?.payload?.error ?? end?.payload?.turn?.error;
  // Keep only diagnostic messages; native errors may also contain request headers.
  const message = typeof error === "string" ? error : error?.message;
  return {
    ...(end ? { outcome: end.payload?.outcome } : {}),
    ...(typeof message === "string" ? { terminalError: message.slice(0, 2000) } : {}),
  };
}

const ids = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
if (process.argv.includes("--recheck")) {
  for (const directory of ids) {
    const root = resolve(directory),
      report = JSON.parse(await readFile(join(root, "report.json"), "utf8"));
    const store = new Store(join(root, "state.sqlite"));
    try {
      const marker = await readFile(join(root, "workspace", "marker.txt"), "utf8");
      const events = store.events(store.sessions()[0].id, 0, 10000);
      report.checks = subagentEvidence(events, marker);
      Object.assign(report, terminalDetails(events));
      report.ok =
        !report.error &&
        !report.closeError &&
        report.checks.completed === true &&
        Object.values(report.checks).every(Boolean);
      delete report.unsupported;
      await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ ...report, report: join(root, "report.json") }, null, 2));
    } finally {
      store.close();
    }
  }
  process.exit(0);
}
if (!ids.length) throw new Error("Specify harness IDs for authenticated model acceptance");
const installedDataDir =
  process.env.KODO_DATA_DIR ??
  join(process.env.LOCALAPPDATA ?? join(homedir(), ".local", "share"), "Kodo", "host");
for (const harnessId of ids) {
  const root = resolve(`.local/verification/subagent-${harnessId}-${Date.now()}`),
    workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  const marker = "CHILD_READ_" + randomUUID(),
    filename = join(workspace, "marker.txt");
  await writeFile(filename, marker);
  const launch = nativeLaunch(installedDataDir, harnessId);
  await writeFile(
    join(root, "installations.json"),
    JSON.stringify({
      [harnessId]: {
        command: launch.command,
        args: launch.args,
      },
    }),
  );
  const adapter = getAdapter(harnessId);
  const store = new Store(join(root, "state.sqlite")),
    service = new SessionService(store, {
      dataDir: root,
      adapters: [
        {
          ...adapter,
          connect: (session, ctx) => adapter.connect(session, { ...ctx, launch }),
          ...(adapter.discoverModels
            ? { discoverModels: (ctx) => adapter.discoverModels({ ...ctx, launch }) }
            : {}),
        },
      ],
    });
  const report = {
    harnessId,
    kind: "authenticated-native-model",
    startedAt: new Date().toISOString(),
    ok: false,
    checks: {},
  };
  let session;
  try {
    const project = service.createProject({
      name: "Isolated subagent acceptance",
      rootPath: workspace,
    });
    const location = store.workspaces().find((item) => item.projectId === project.id);
    session = service.createDraft({
      title: "Native subagent acceptance",
      harnessId,
      kind: "direct",
      projectId: project.id,
      workspaceId: location.id,
    });
    const commandId = randomUUID();
    service.acceptSend(session.id, {
      requestId: commandId,
      mode: "new",
      text:
        "Use one native subagent (Agent/task/spawn_subagent/spawn_agent as provided by your runtime). " +
        "Ask that child to read marker.txt in the current working directory using its native file tool and return the exact contents. " +
        "Wait for its result, then reply with those contents. Do not read the file in the parent. " +
        "Do not change files or run shell commands. If no native subagent tool exists, reply SUBAGENT_UNAVAILABLE.",
    });
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 150));
      const command = store.command(commandId),
        events = store.events(session.id, 0, 10000);
      if (["unknown", "rejected"].includes(command?.status))
        throw new Error(command.error ?? command.status);
      report.checks = subagentEvidence(events, marker);
      const end = events.filter((event) => event.type === "turn-ended").at(-1);
      if (end && command?.status === "confirmed") {
        Object.assign(report, terminalDetails(events));
        report.checks.completed = ["completed", "complete"].includes(report.outcome);
        report.ok = Object.values(report.checks).every(Boolean);
        break;
      }
      const error = events
        .filter((event) => event.type === "error" || event.type === "disconnected")
        .at(-1);
      if (error)
        throw new Error(
          String(error.payload?.message ?? error.payload?.error?.message ?? "Native runtime error"),
        );
    }
    if (!report.outcome) {
      report.error = "Native subagent acceptance timed out";
      let timer;
      try {
        await Promise.race([
          service.stop(session.id, true, randomUUID()),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Native cancel acknowledgment timed out")),
              5000,
            );
          }),
        ]);
      } catch (error) {
        report.cancelError = error.message;
      } finally {
        clearTimeout(timer);
      }
    }
    report.events = store
      .events(session.id, 0, 10000)
      .reduce((counts, event) => ({ ...counts, [event.type]: (counts[event.type] ?? 0) + 1 }), {});
  } catch (error) {
    report.error = error.message;
  } finally {
    try {
      await service.dispose();
    } catch (error) {
      report.closeError = error.message;
      report.ok = false;
    }
    store.close();
    report.finishedAt = new Date().toISOString();
    await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, report: join(root, "report.json") }, null, 2));
  }
  if (!report.ok) process.exitCode = 1;
}
