import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { RelayWriter } from "../src/devices/relay-writer.js";

test("v2 congestion preserves controls and evicts complete stale pictures", async () => {
  const sent: string[] = [];
  const socket = {
    bufferedAmount: 4 * 1024 * 1024,
    send(data: Buffer) {
      sent.push(data.toString());
    },
  };
  const writer = new RelayWriter(socket);
  try {
    for (const name of ["first", "second", "third"]) {
      writer.picture([Buffer.from(name)], () => {
        writer.reliable(Buffer.from("drop:" + name));
      });
    }
    writer.reliable(Buffer.from("input"));
    assert.deepEqual(sent, []);
    socket.bufferedAmount = 0;
    await delay(30);
    assert.deepEqual(sent, ["drop:first", "input", "second", "third"]);
  } finally {
    writer.close();
  }
});
