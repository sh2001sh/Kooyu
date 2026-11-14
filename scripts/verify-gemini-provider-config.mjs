// Real Gemini CLI configuration/ACP handshake only. No inference response is
// simulated, and this script is not evidence of a successful model conversation.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Store } from "../packages/host/dist/storage/store.js";
import { SessionService } from "../packages/host/dist/session-service.js";

const dir = resolve(`.local/verification/provider-gemini-config-${Date.now()}`);
mkdirSync(dir, { recursive: true });
const requests = [];
const upstream = createServer((req, res) => {
  requests.push({ method: req.method, path: req.url });
  res.writeHead(503, { "content-type": "application/json" });
  res.end(
    JSON.stringify({ error: { message: "Configuration validation only; no inference service." } }),
  );
});
await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const store = new Store(join(dir, "state.sqlite"));
const service = new SessionService(store, { dataDir: dir });
const report = {
  scope: "native-config-and-ACP-handshake-only",
  nativeVersion: "0.67.0",
  inference: "not-tested",
  result: "unverified",
  requests,
};
try {
  writeFileSync(
    join(dir, "installations.json"),
    JSON.stringify({
      gemini: {
        command: process.execPath,
        args: [
          resolve(
            ".local/verification/native-tools/node_modules/@google/gemini-cli/bundle/gemini.js",
          ),
          "--acp",
        ],
      },
    }),
  );
  await service.providers.refreshCatalog();
  const p = await service.providers.saveProvider({
    name: "Configuration validation only",
    endpoints: [
      {
        name: "Google format",
        protocol: "google-generative-ai",
        baseUrl: `http://127.0.0.1:${upstream.address().port}`,
        apiKey: "CONFIGURATION_ONLY_NO_REAL_CREDENTIAL",
      },
    ],
  });
  const m = await service.providers.saveModel({
    providerId: p.id,
    endpointId: p.endpoints[0].id,
    model: "gemini-3.1-pro-preview",
    catalogKey: "google/gemini-3.1-pro-preview",
  });
  const b = service.providers.saveBinding({
    name: "Gemini configuration validation",
    harnessId: "gemini",
    modelId: m.id,
    reasoning: "high",
  });
  const project = service.createProject({ name: "Configuration validation", rootPath: dir });
  const workspace = store.workspaces().find((w) => w.projectId === project.id);
  const session = service.createDraft({
    title: "Native handshake only",
    harnessId: "gemini",
    kind: "direct",
    projectId: project.id,
    workspaceId: workspace.id,
    bindingId: b.id,
  });
  await service.openNative(session.id);
  report.nativeSessionId = store.session(session.id).nativeSessionId;
  assert.ok(report.nativeSessionId);
  assert.equal(
    store.commands(session.id).some((c) => c.kind === "send"),
    false,
  );
  report.result = "passed";
} catch (e) {
  report.result = "failed";
  report.error = e.message;
  process.exitCode = 1;
} finally {
  await service.dispose();
  store.close();
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
  writeFileSync(join(dir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`Report: ${dir}`);
}
