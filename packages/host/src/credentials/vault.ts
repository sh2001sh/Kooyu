import { AsyncEntry, Entry } from "@napi-rs/keyring";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { KodoError } from "@kodo/protocol";

export type VaultBackend = "system" | "file";
export interface VaultStatus {
  backend: VaultBackend;
  available: boolean;
  reason?: string;
  location?: string;
}

/**
 * One interface for every secret the Host keeps: provider keys, search keys, native
 * credential caches and the Relay identity. Desktop uses the OS keyring; a headless
 * server uses an encrypted file whose master key comes from a mounted secret file.
 * There is no plaintext fallback.
 */
export interface SecretVault {
  readonly backend: VaultBackend;
  status(): VaultStatus;
  get(service: string, account: string): Promise<string | null>;
  set(service: string, account: string, value: string): Promise<void>;
  delete(service: string, account: string): Promise<void>;
  getSync(service: string, account: string): string | null;
  setSync(service: string, account: string, value: string): void;
}

class SystemVault implements SecretVault {
  readonly backend = "system" as const;
  status(): VaultStatus {
    return { backend: "system", available: true };
  }
  get(service: string, account: string) {
    return new AsyncEntry(service, account).getPassword().then((v) => v ?? null);
  }
  async set(service: string, account: string, value: string) {
    await new AsyncEntry(service, account).setPassword(value);
  }
  async delete(service: string, account: string) {
    await new AsyncEntry(service, account).deletePassword();
  }
  getSync(service: string, account: string) {
    return new Entry(service, account).getPassword() ?? null;
  }
  setSync(service: string, account: string, value: string) {
    new Entry(service, account).setPassword(value);
  }
}

interface VaultFile {
  version: 1;
  salt: string;
  entries: Record<string, { iv: string; tag: string; data: string }>;
}

const INFO = "kooyu-vault-v1";
const entryName = (service: string, account: string) => `${service}\u0000${account}`;

/** AES-256-GCM entries; the key is derived from a master secret file via HKDF. */
export class FileVault implements SecretVault {
  readonly backend = "file" as const;
  private material: Buffer | null = null;
  private problem: string | undefined;
  constructor(
    readonly path: string,
    private readonly keyFile: string | undefined,
  ) {
    this.problem = this.loadKey();
  }
  private loadKey(): string | undefined {
    if (!this.keyFile) return "未配置 KOOYU_VAULT_KEY_FILE，服务器凭据库不可用。";
    try {
      if (process.platform !== "win32" && (statSync(this.keyFile).mode & 0o077) !== 0)
        return "主密钥文件权限过宽（需仅所有者可读，例如 chmod 600）。";
      const material = readFileSync(this.keyFile);
      const trimmed = Buffer.from(material.toString("utf8").trim(), "utf8");
      if (trimmed.length < 32) return "主密钥过短，至少需要 32 字节随机内容。";
      this.material = trimmed;
      return undefined;
    } catch {
      return "无法读取主密钥文件。";
    }
  }
  status(): VaultStatus {
    return {
      backend: "file",
      available: !this.problem,
      ...(this.problem ? { reason: this.problem } : {}),
      location: this.path,
    };
  }
  private require(): Buffer {
    if (this.problem || !this.material)
      throw new KodoError("UNAVAILABLE", this.problem ?? "服务器凭据库不可用。");
    return this.material;
  }
  private read(): VaultFile {
    if (!existsSync(this.path))
      return { version: 1, salt: randomBytes(16).toString("base64"), entries: {} };
    const value = JSON.parse(readFileSync(this.path, "utf8")) as VaultFile;
    if (value.version !== 1 || typeof value.salt !== "string" || typeof value.entries !== "object")
      throw new KodoError("UNAVAILABLE", "凭据库文件格式无效。");
    return value;
  }
  private write(value: VaultFile) {
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
    renameSync(temp, this.path);
  }
  private key(material: Buffer, salt: string): Buffer {
    return Buffer.from(hkdfSync("sha256", material, Buffer.from(salt, "base64"), INFO, 32));
  }
  private decrypt(key: Buffer, name: string, entry: VaultFile["entries"][string]): string {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(entry.iv, "base64"));
    decipher.setAAD(Buffer.from(name, "utf8"));
    decipher.setAuthTag(Buffer.from(entry.tag, "base64"));
    try {
      return Buffer.concat([
        decipher.update(Buffer.from(entry.data, "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new KodoError("UNAVAILABLE", "凭据无法解密：主密钥不匹配或文件已损坏。");
    }
  }
  private encrypt(key: Buffer, name: string, value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(name, "utf8"));
    const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return {
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: data.toString("base64"),
    };
  }
  getSync(service: string, account: string): string | null {
    const material = this.require();
    const file = this.read();
    const name = entryName(service, account);
    const entry = file.entries[name];
    return entry ? this.decrypt(this.key(material, file.salt), name, entry) : null;
  }
  setSync(service: string, account: string, value: string): void {
    const material = this.require();
    const file = this.read();
    const name = entryName(service, account);
    file.entries[name] = this.encrypt(this.key(material, file.salt), name, value);
    this.write(file);
  }
  async get(service: string, account: string) {
    return this.getSync(service, account);
  }
  async set(service: string, account: string, value: string) {
    this.setSync(service, account, value);
  }
  async delete(service: string, account: string) {
    this.require();
    const file = this.read();
    delete file.entries[entryName(service, account)];
    this.write(file);
  }
  /** Re-encrypt every entry under a new master secret (key rotation). */
  rekey(newKeyFile: string): number {
    const material = this.require();
    const file = this.read();
    const next = new FileVault(this.path, newKeyFile);
    const nextMaterial = next.require();
    const oldKey = this.key(material, file.salt);
    const salt = randomBytes(16).toString("base64");
    const newKey = this.key(nextMaterial, salt);
    const entries: VaultFile["entries"] = {};
    for (const [name, entry] of Object.entries(file.entries))
      entries[name] = this.encrypt(newKey, name, this.decrypt(oldKey, name, entry));
    this.write({ version: 1, salt, entries });
    this.material = nextMaterial;
    return Object.keys(entries).length;
  }
}

let current: SecretVault | undefined;

/** Select the backend once at startup from KOOYU_CREDENTIAL_BACKEND. */
export function configureVault(dataDir: string, env: NodeJS.ProcessEnv = process.env): SecretVault {
  const backend = (env.KOOYU_CREDENTIAL_BACKEND ?? "system").toLowerCase();
  if (backend !== "system" && backend !== "file")
    throw new Error("KOOYU_CREDENTIAL_BACKEND must be 'system' or 'file'.");
  current =
    backend === "file"
      ? new FileVault(
          env.KOOYU_VAULT_FILE ?? join(dataDir, "credentials.vault.json"),
          env.KOOYU_VAULT_KEY_FILE,
        )
      : new SystemVault();
  return current;
}
export function secretVault(): SecretVault {
  return (current ??= new SystemVault());
}
/** Tests only. */
export function setSecretVault(vault: SecretVault | undefined) {
  current = vault;
}

/** Ref-addressed view used by provider, binding and search credentials. */
export const kooyuSecrets = {
  get: async (ref: string) =>
    (await secretVault().get("Kooyu", ref)) ?? (await secretVault().get("Kodo", ref)),
  set: (ref: string, value: string) => secretVault().set("Kooyu", ref, value),
  delete: async (ref: string) => {
    await secretVault().delete("Kooyu", ref);
    await secretVault().delete("Kodo", ref);
  },
};
/** @deprecated Alias preserved for compatibility; use `kooyuSecrets`. */
export const kodoSecrets = kooyuSecrets;
