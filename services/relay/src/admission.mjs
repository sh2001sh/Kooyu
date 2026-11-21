import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const hostPattern = /^[a-f0-9]{64}$/;
const digest = (s) => createHash("sha256").update(s).digest("hex");
export class AdmissionError extends Error {
  constructor(status, code, message, retryAt) {
    super(message); this.status = status; this.code = code; this.retryAt = retryAt;
  }
}
/** The WebSocket handshake proves the key before this service may create an identity. */
export class RelayAdmission {
  constructor({ path = ":memory:", monthlyBytes = 1024 ** 3, globalMonthlyBytes = 100 * 1024 ** 3,
    newPerIpDay = 20, maxIdentities = 10000, now = Date.now } = {}) {
    for (const n of [monthlyBytes, globalMonthlyBytes, newPerIpDay, maxIdentities])
      if (!Number.isSafeInteger(n) || n < 1) throw Error("Invalid anonymous Relay limits");
    this.monthlyBytes = monthlyBytes; this.globalMonthlyBytes = globalMonthlyBytes;
    this.newPerIpDay = newPerIpDay; this.maxIdentities = maxIdentities; this.now = now;
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS anonymous_identities(host TEXT PRIMARY KEY, id TEXT UNIQUE NOT NULL, created INTEGER NOT NULL, blocked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS anonymous_tokens(hash TEXT PRIMARY KEY, host TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS anonymous_usage(subject TEXT, period TEXT, bytes INTEGER NOT NULL, PRIMARY KEY(subject,period));
      CREATE TABLE IF NOT EXISTS anonymous_registrations(source TEXT, day TEXT, count INTEGER NOT NULL, PRIMARY KEY(source,day));
      CREATE TABLE IF NOT EXISTS anonymous_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS anonymous_token_expiry ON anonymous_tokens(expires);`);
    this.db.prepare("INSERT OR IGNORE INTO anonymous_settings VALUES('source-salt',?)").run(randomBytes(32).toString("hex"));
    this.salt = this.db.prepare("SELECT value FROM anonymous_settings WHERE key='source-salt'").get().value;
  }
  period() { return new Date(this.now()).toISOString().slice(0,7); }
  resetAt() { const d = new Date(this.now()); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+1, 1); }
  allowed(host) {
    return hostPattern.test(host) && !!this.db.prepare("SELECT 1 FROM anonymous_identities WHERE host=? AND blocked=0").get(host);
  }
  admit(host, source) {
    if (!hostPattern.test(host)) throw new AdmissionError(403,"INVALID_IDENTITY","设备身份无效。");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      let row = this.db.prepare("SELECT * FROM anonymous_identities WHERE host=?").get(host);
      if (row?.blocked) throw new AdmissionError(403,"IDENTITY_REVOKED","此设备的远程连接权限已停用。");
      if (!row) {
        const day = new Date(this.now()).toISOString().slice(0,10);
        const key = createHmac("sha256",this.salt).update(String(source)).digest("hex");
        const count = this.db.prepare("SELECT count FROM anonymous_registrations WHERE source=? AND day=?").get(key,day)?.count ?? 0;
        if (count >= this.newPerIpDay) throw new AdmissionError(429,"IDENTITY_RATE_LIMIT","此网络今天创建的设备身份过多，请稍后重试。",Date.parse(day)+86400000);
        if (this.db.prepare("SELECT count(*) AS n FROM anonymous_identities").get().n >= this.maxIdentities)
          throw new AdmissionError(503,"IDENTITY_CAPACITY","连接服务暂时无法接受新设备，请稍后重试。",this.now()+60000);
        this.db.prepare("INSERT INTO anonymous_identities VALUES(?,?,?,0)").run(host,randomUUID(),this.now());
        this.db.prepare("INSERT INTO anonymous_registrations VALUES(?,?,1) ON CONFLICT(source,day) DO UPDATE SET count=count+1").run(key,day);
        row = this.db.prepare("SELECT * FROM anonymous_identities WHERE host=?").get(host);
      }
      this.db.exec("COMMIT");
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
    if (!this.available(host)) throw this.quotaError();
    return this.issue(host);
  }
  quotaError() { return new AdmissionError(429,"RELAY_QUOTA_EXCEEDED","远程连接流量额度已用尽，将在下个周期恢复；本地任务继续运行。",this.resetAt()); }
  usage(subject) { return this.db.prepare("SELECT bytes FROM anonymous_usage WHERE subject=? AND period=?").get(subject,this.period())?.bytes ?? 0; }
  available(host) { return this.allowed(host) && this.usage(host) < this.monthlyBytes && this.usage("*") < this.globalMonthlyBytes; }
  consume(host, bytes) {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || !this.allowed(host)) return false;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.usage(host)+bytes > this.monthlyBytes || this.usage("*")+bytes > this.globalMonthlyBytes) {
        this.db.exec("ROLLBACK"); return false;
      }
      for (const subject of [host,"*"]) this.db.prepare("INSERT INTO anonymous_usage VALUES(?,?,?) ON CONFLICT(subject,period) DO UPDATE SET bytes=bytes+excluded.bytes")
        .run(subject,this.period(),bytes);
      this.db.exec("COMMIT"); return true;
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
  view(host) {
    const row = this.db.prepare("SELECT id,created,blocked FROM anonymous_identities WHERE host=?").get(host);
    if (!row) return undefined;
    return { id:row.id, kind:"anonymous", hostId:host, createdAt:new Date(row.created).toISOString(),
      blocked:!!row.blocked, usage:{bytes:this.usage(host),limitBytes:this.monthlyBytes,resetAt:new Date(this.resetAt()).toISOString()},
      limits:{maxConcurrentRequests:8,mailboxMessages:8} };
  }
  issue(host) {
    if (!this.allowed(host)) throw new AdmissionError(403,"IDENTITY_REVOKED","设备身份已停用。");
    const token = randomBytes(32).toString("base64url"), expires = this.now()+3600000;
    this.db.prepare("DELETE FROM anonymous_tokens WHERE host=?").run(host);
    this.db.prepare("INSERT INTO anonymous_tokens VALUES(?,?,?)").run(digest(token),host,expires);
    return { identity:this.view(host), credential:{token,expiresAt:new Date(expires).toISOString()} };
  }
  authenticate(token) {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    const row = this.db.prepare("SELECT host FROM anonymous_tokens WHERE hash=? AND expires>?").get(digest(token),this.now());
    return row && this.allowed(row.host) ? row.host : undefined;
  }
  revoke(host) {
    this.db.prepare("UPDATE anonymous_identities SET blocked=1 WHERE host=?").run(host);
    this.db.prepare("DELETE FROM anonymous_tokens WHERE host=?").run(host);
  }
  prune() {
    this.db.prepare("DELETE FROM anonymous_tokens WHERE expires<=?").run(this.now());
    const old = new Date(this.now()-7*86400000).toISOString().slice(0,10);
    this.db.prepare("DELETE FROM anonymous_registrations WHERE day<?").run(old);
  }
  close() { this.db.close(); }
}
