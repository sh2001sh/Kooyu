import { createPublicKey, verify } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const lifetime = 12 * 60 * 60 * 1000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function signedMailboxBytes(hostId, m) {
  return Buffer.from(JSON.stringify(["kooyu-mailbox-v2", hostId, m.deviceId, m.commandId, m.expiresAt, m.ciphertext]));
}
export class Mailbox {
  constructor(path = ":memory:", now = Date.now) {
    this.now = now;
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS mailbox_keys(host TEXT, device TEXT, key TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(host,device));
      CREATE TABLE IF NOT EXISTS mailbox_messages(host TEXT, device TEXT, command TEXT, envelope TEXT NOT NULL, expires INTEGER NOT NULL,
        PRIMARY KEY(host,command), FOREIGN KEY(host,device) REFERENCES mailbox_keys(host,device) ON DELETE CASCADE);
      CREATE INDEX IF NOT EXISTS mailbox_expiry ON mailbox_messages(expires);
      CREATE TABLE IF NOT EXISTS mailbox_receipts(host TEXT, command TEXT, expires INTEGER NOT NULL, PRIMARY KEY(host,command));
      CREATE INDEX IF NOT EXISTS receipt_expiry ON mailbox_receipts(expires);`);
  }
  register(host, device, key, expires) {
    if (!uuid.test(device) || typeof key !== "string" || key.length > 128 ||
        !Number.isSafeInteger(expires) || expires <= this.now()) throw Error("Invalid mailbox key");
    if (createPublicKey({key:Buffer.from(key,"base64"),format:"der",type:"spki"}).asymmetricKeyType !== "ed25519")
      throw Error("Invalid mailbox key type");
    const previous = this.db.prepare("SELECT key FROM mailbox_keys WHERE host=? AND device=?").get(host,device);
    if (previous && previous.key !== key) throw Error("Device key changed");
    if (!previous && this.db.prepare("SELECT count(*) AS n FROM mailbox_keys").get().n >= 8192)
      throw Error("Relay mailbox capacity reached");
    if (!previous && this.db.prepare("SELECT count(*) AS n FROM mailbox_keys WHERE host=?").get(host).n >= 256)
      throw Error("Mailbox device limit reached");
    this.db.prepare("INSERT INTO mailbox_keys VALUES(?,?,?,?) ON CONFLICT(host,device) DO UPDATE SET expires=excluded.expires")
      .run(host,device,key,expires);
  }
  revoke(host, device) {
    this.db.prepare("DELETE FROM mailbox_keys WHERE host=? AND device=?").run(host, device);
  }
  sync(host, devices) {
    if (!Array.isArray(devices) || devices.length > 256) throw Error("Invalid device list");
    const ids = new Set(devices.map(d => d.deviceId));
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of this.db.prepare("SELECT device FROM mailbox_keys WHERE host=?").all(host))
        if (!ids.has(row.device)) this.revoke(host, row.device);
      for (const d of devices) this.register(host, d.deviceId, d.publicKey, d.expiresAt);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  prune() {
    this.db.prepare("DELETE FROM mailbox_receipts WHERE expires<=?").run(this.now());
    this.db.prepare("DELETE FROM mailbox_messages WHERE expires<=?").run(this.now());
    this.db.prepare("DELETE FROM mailbox_keys WHERE expires<=?").run(this.now());
  }
  put(host, m, { maxPending = 32, onAccept } = {}) {
    const now = this.now();
    if (!m || !uuid.test(m.deviceId) || !uuid.test(m.commandId) || !Number.isSafeInteger(m.expiresAt) ||
      m.expiresAt <= now || m.expiresAt > now + lifetime || typeof m.ciphertext !== "string" ||
      !/^[A-Za-z0-9_-]+$/.test(m.ciphertext) || typeof m.signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(m.signature))
      return 400;
    const envelope = JSON.stringify({deviceId:m.deviceId,commandId:m.commandId,expiresAt:m.expiresAt,ciphertext:m.ciphertext,signature:m.signature});
    if (Buffer.byteLength(envelope) > 32768) return 413;
    const row = this.db.prepare("SELECT key FROM mailbox_keys WHERE host=? AND device=? AND expires>?").get(host,m.deviceId,now);
    if (!row || !verify(null, signedMailboxBytes(host,m), createPublicKey({key:Buffer.from(row.key,"base64"),format:"der",type:"spki"}),
        Buffer.from(m.signature,"base64url"))) return 403;
    if (this.db.prepare("SELECT 1 FROM mailbox_receipts WHERE host=? AND command=? AND expires>?").get(host,m.commandId,now)) return 409;
    const existing = this.db.prepare("SELECT envelope FROM mailbox_messages WHERE host=? AND command=?").get(host,m.commandId);
    if (existing) return existing.envelope === envelope ? 200 : 409;
    this.db.prepare("DELETE FROM mailbox_messages WHERE host=? AND expires<=?").run(host,now);
    if (this.db.prepare("SELECT count(*) AS n FROM mailbox_messages").get().n >= 4096) return 429;
    if (this.db.prepare("SELECT count(*) AS n FROM mailbox_messages WHERE host=?").get(host).n >= maxPending) return 429;
    // Charge only an authenticated, new envelope; invalid/replayed mail cannot burn the Host budget.
    if (onAccept && !onAccept()) return 429;
    this.db.prepare("INSERT INTO mailbox_messages VALUES(?,?,?,?,?)").run(host,m.deviceId,m.commandId,envelope,m.expiresAt);
    return 201;
  }
  pending(host) {
    return this.db.prepare("SELECT envelope FROM mailbox_messages WHERE host=? AND expires>? ORDER BY rowid")
      .all(host,this.now()).map(row => JSON.parse(row.envelope));
  }
  ack(host, commandId) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT OR REPLACE INTO mailbox_receipts SELECT host,command,expires FROM mailbox_messages WHERE host=? AND command=?").run(host,commandId);
      this.db.prepare("DELETE FROM mailbox_messages WHERE host=? AND command=?").run(host,commandId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close() { this.db.close(); }
}
