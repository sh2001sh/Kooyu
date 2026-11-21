import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";

function pushEndpoint(raw) {
  const url = new URL(raw);
  const known = url.hostname === "fcm.googleapis.com" || url.hostname === "web.push.apple.com" ||
    url.hostname.endsWith(".push.apple.com") || url.hostname === "updates.push.services.mozilla.com" ||
    url.hostname.endsWith(".notify.windows.com");
  if (!known || url.protocol !== "https:" || url.port || url.username || url.password || url.hash || url.href.length > 4096)
    throw Error("Invalid Web Push service");
  return url;
}
export class WakePush {
  constructor(db, origin, fetcher = fetch) {
    this.db = db;
    this.origin = origin;
    this.fetcher = fetcher;
    db.exec(`CREATE TABLE IF NOT EXISTS vapid_identity(id INTEGER PRIMARY KEY CHECK(id=1), key TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS wake_subscriptions(host TEXT, device TEXT, endpoint TEXT NOT NULL,
        PRIMARY KEY(host,device), FOREIGN KEY(host,device) REFERENCES mailbox_keys(host,device) ON DELETE CASCADE);`);
    if (!db.prepare("SELECT id FROM vapid_identity WHERE id=1").get()) {
      const pair = generateKeyPairSync("ec",{namedCurve:"prime256v1"});
      db.prepare("INSERT OR IGNORE INTO vapid_identity VALUES(1,?)").run(pair.privateKey.export({format:"pem",type:"pkcs8"}));
    }
    this.privateKey = createPrivateKey(db.prepare("SELECT key FROM vapid_identity WHERE id=1").get().key);
    const jwk = this.privateKey.export({format:"jwk"});
    this.publicKey = Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,"base64url"),Buffer.from(jwk.y,"base64url")]).toString("base64url");
  }
  subscribe(host, device, endpoint) {
    this.db.prepare("INSERT OR REPLACE INTO wake_subscriptions VALUES(?,?,?)").run(host,device,pushEndpoint(endpoint).href);
  }
  unsubscribe(host, device) {
    this.db.prepare("DELETE FROM wake_subscriptions WHERE host=? AND device=?").run(host,device);
  }
  async wake(host, device) {
    const row = this.db.prepare("SELECT s.endpoint FROM wake_subscriptions s JOIN mailbox_keys k USING(host,device) WHERE s.host=? AND s.device=? AND k.expires>?").get(host,device,Date.now());
    if (!row) return;
    const endpoint = pushEndpoint(row.endpoint);
    const part = data => Buffer.from(JSON.stringify(data)).toString("base64url");
    const jwt = part({typ:"JWT",alg:"ES256"})+"."+part({aud:endpoint.origin,exp:Math.floor(Date.now()/1000)+3600,sub:this.origin});
    const signature = sign("sha256",Buffer.from(jwt),{key:this.privateKey,dsaEncoding:"ieee-p1363"}).toString("base64url");
    const resp = await this.fetcher(endpoint.href,{method:"POST",redirect:"error",signal:AbortSignal.timeout(10000),
      headers:{TTL:"300",Authorization:"vapid t="+jwt+"."+signature+", k="+this.publicKey}});
    await resp.body?.cancel();
    if (resp.status === 404 || resp.status === 410)
      this.db.prepare("DELETE FROM wake_subscriptions WHERE host=? AND device=? AND endpoint=?").run(host,device,row.endpoint);
    else if (!resp.ok) throw Error("Wake delivery failed");
  }
}
