import assert from "node:assert/strict";
import { test } from "node:test";
import type { AdapterContext } from "../src/harnesses/adapter.js";
import { NativeInteractions } from "../src/harnesses/native-interactions.js";

for (const ending of ["answer", "external", "close", "failure"] as const) {
  test("native request ownership handles " + ending + " without duplicate replies", async () => {
    let respond!: (value: unknown) => void;
    let asked = 0,
      replied = 0,
      errors = 0;
    const resolved: string[] = [];
    const ctx = {
      interact: () => {
        asked++;
        return new Promise((resolve) => {
          respond = resolve;
        });
      },
      resolveInteraction: (id: string) => resolved.push(id),
      emit: (type: string) => {
        if (type === "error") errors++;
      },
    } as unknown as AdapterContext;
    const tracker = new NativeInteractions(ctx);
    const reply = async () => {
      replied++;
      if (ending === "failure") throw new Error("native rejection");
    };
    tracker.ask("one", {}, reply);
    tracker.ask("one", {}, reply);
    assert.equal(asked, 1);
    if (ending === "external") tracker.resolve("one");
    if (ending === "close") tracker.close();
    respond({ decision: "accept" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    tracker.ask("one", {}, reply);
    assert.equal(asked, 1);
    assert.equal(replied, ending === "answer" || ending === "failure" ? 1 : 0);
    assert.equal(errors, ending === "failure" ? 1 : 0);
    assert.deepEqual(resolved, ["one"]);
    tracker.close();
    assert.deepEqual(resolved, ["one"]);
  });
}

test("native resolved events precede stale pending snapshots", () => {
  const tracker = new NativeInteractions({
    interact: () => assert.fail("stale snapshot reopened"),
  } as unknown as AdapterContext);
  tracker.resolve("old");
  tracker.ask("old", {}, async () => assert.fail("stale snapshot replied"));
  tracker.close();
});
