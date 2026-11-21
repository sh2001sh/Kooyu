import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { secretVault } from "../credentials/vault.js";
import {
  InMemoryCredentialStore,
  type Credential,
  type CredentialStore,
} from "@earendil-works/pi-ai";

// Read native login once without writing its global file. Kodo-owned copies and
// refreshed OAuth tokens are stored by the OS, never in the product database.
type NativeConfiguration = {
  credentials: CredentialStore;
  modelsPath: string | null;
  settings: Record<string, unknown>;
};
const configurations = new Map<string, Promise<NativeConfiguration>>();
export function nativeKodoConfiguration(
  root = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
): Promise<NativeConfiguration> {
  let configuration = configurations.get(root);
  if (!configuration) {
    configuration = load(root);
    configurations.set(root, configuration);
    void configuration.catch(() => configurations.delete(root));
  }
  return configuration;
}
async function load(root: string): Promise<NativeConfiguration> {
  const read = (file: string) =>
    existsSync(join(root, file)) ? JSON.parse(readFileSync(join(root, file), "utf8")) : {};
  const auth = read("auth.json") as Record<string, Credential>,
    memory = new InMemoryCredentialStore(),
    hashes = new Map<string, string>();
  for (const [provider, credential] of Object.entries(auth)) {
    if (!["api_key", "oauth"].includes(credential.type)) continue;
    const account = `native:${createHash("sha256").update(root).digest("hex")}:${provider}`;
    const sourceHash = createHash("sha256").update(JSON.stringify(credential)).digest("hex");
    hashes.set(provider, sourceHash);
    const cached =
      (await secretVault().get("Kooyu", account)) ?? (await secretVault().get("Kodo", account));
    const saved = cached
      ? (JSON.parse(cached) as { sourceHash: string; credential: Credential })
      : undefined;
    const current = saved?.sourceHash === sourceHash ? saved.credential : credential;
    await secretVault().set("Kooyu", account, JSON.stringify({ sourceHash, credential: current }));
    await memory.modify(provider, async () => current);
  }
  const credentials: CredentialStore = {
    read: (id, options) => memory.read(id, options),
    list: (options) => memory.list(options),
    async modify(id, fn, options) {
      return memory.modify(
        id,
        async (current) => {
          const next = await fn(current);
          if (next)
            await secretVault().set(
              "Kooyu",
              `native:${createHash("sha256").update(root).digest("hex")}:${id}`,
              JSON.stringify({ sourceHash: hashes.get(id), credential: next }),
            );
          return next;
        },
        options,
      );
    },
    async delete(id, options) {
      await memory.delete(id, options);
      const accountKey = `native:${createHash("sha256").update(root).digest("hex")}:${id}`;
      await secretVault().delete("Kooyu", accountKey);
      await secretVault().delete("Kodo", accountKey);
    },
  };
  return {
    credentials,
    modelsPath: existsSync(join(root, "models.json")) ? join(root, "models.json") : null,
    settings: read("settings.json"),
  };
}
