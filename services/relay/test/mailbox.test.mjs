import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { Mailbox, signedMailboxBytes } from "../src/mailbox.mjs";
import { WakePush } from "../src/push.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("mailbox binds sender, host, expiry and command, with bounded storage", () => {
  let now = Date.now();
  const box = new Mailbox(":memory:", () => now);
  const {publicKey, privateKey} = generateKeyPairSync("ed25519");
  const host = "a".repeat(64), deviceId = randomUUID();
  function envelope(commandId = randomUUID(), ciphertext = "aGVsbG8") {
    const m = { deviceId, commandId, expiresAt: now + 1000, ciphertext };
    return {...m, signature: sign(null, signedMailboxBytes(host,m), privateKey).toString("base64url")};
  }
  try {
    const first = envelope();
    assert.equal(box.put(host,first),403);
    box.register(host,deviceId,publicKey.export({type:"spki",format:"der"}).toString("base64"),now + 60000);
    assert.equal(box.put(host,{...first, ciphertext:"bm8"}),403);
    assert.equal(box.put(host,first),201);
    assert.equal(box.put(host,first),200);
    assert.equal(box.put(host,envelope(first.commandId,"bm8")),409);
    assert.equal(box.put(host,envelope(randomUUID(),"a".repeat(32768))),413);
    for(let i=1;i<32;i++) assert.equal(box.put(host,envelope()),201);
    assert.equal(box.put(host,envelope()),429);
    assert.equal(box.pending(host).length,32);
    box.ack(host, first.commandId);
    assert.equal(box.put(host,first),409);
    now += 1001;
    assert.deepEqual(box.pending(host),[]);
    assert.equal(box.put(host,first),400);
    assert.equal(box.put(host,envelope()),201);
    box.revoke(host,deviceId);
    assert.deepEqual(box.pending(host),[]);
    assert.equal(box.put(host,envelope()),403);
  } finally { box.close(); }
});

test("VAPID identity survives restart and wake requests carry no message content", async () => {
  const dir = mkdtempSync(join(tmpdir(),"kooyu-wake-"));
  const path = join(dir,"mailbox.sqlite");
  let box = new Mailbox(path);
  try {
    const device = randomUUID(), host = "a".repeat(64);
    const publicKey = generateKeyPairSync("ed25519").publicKey.export({type:"spki",format:"der"}).toString("base64");
    box.register(host,device,publicKey,Date.now()+10000);
    const registration = new WakePush(box.db,"https://relay.example");
    assert.throws(()=>registration.subscribe(host,device,"https://localhost/wake"));
    registration.subscribe(host,device,"https://fcm.googleapis.com/fcm/send/fixture");
    box.close();
    box = new Mailbox(path);
    let requests = 0;
    const wake = new WakePush(box.db,"https://relay.example",async (url, opts) => {
      requests++;
      assert.equal(new URL(url).host,"fcm.googleapis.com");
      assert.equal(opts.body,undefined);
      assert.match(opts.headers.Authorization,/^vapid t=.+, k=/);
      return new Response(null,{status:410});
    });
    assert.equal(wake.publicKey,registration.publicKey);
    await wake.wake(host,device);
    await wake.wake(host,device);
    assert.equal(requests,1);
  } finally { box.close(); rmSync(dir,{recursive:true,force:true}); }
});
