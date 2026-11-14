import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/storage/store.js";
import { onboardingState, saveOnboarding } from "../src/configuration/onboarding.js";

test("first launch is pinned before setup writes and survives Host restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-onboarding-")),
    path = join(dir, "state.sqlite");
  let store = new Store(path);
  try {
    assert.equal(onboardingState(store).status, "active");
    store.put("provider", "added-during-setup", { id: "added-during-setup" });
    assert.equal(onboardingState(store).status, "active");
    const next = saveOnboarding(store, { expectedRevision: 0, step: 1, status: "active" });
    store.close();
    store = new Store(path);
    assert.deepEqual(onboardingState(store), next);
    assert.equal(next.step, 1);
    assert.throws(
      () => saveOnboarding(store, { expectedRevision: 0, step: 2, status: "skipped" }),
      /另一窗口/,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("existing installations are not interrupted and may explicitly reopen onboarding", () => {
  for (const kind of ["provider", "harness-binding", "app-settings"]) {
    const store = new Store(":memory:");
    try {
      store.put(kind, "global", { revision: 1 });
      const migrated = onboardingState(store);
      assert.equal(migrated.status, "skipped");
      const open = saveOnboarding(store, {
        expectedRevision: migrated.revision,
        step: 0,
        status: "active",
      });
      assert.equal(open.status, "active");
    } finally {
      store.close();
    }
  }
});

test("API setup is optional, skipping preserves configuration, and state rejects secrets", () => {
  const store = new Store(":memory:");
  try {
    assert.throws(() => saveOnboarding(store, { expectedRevision: 0, step: 3, status: "active" }));
    assert.throws(() =>
      saveOnboarding(store, {
        expectedRevision: 0,
        step: 0,
        status: "active",
        apiKey: "must-not-persist",
      }),
    );
    const skipped = saveOnboarding(store, { expectedRevision: 0, step: 0, status: "skipped" });
    assert.equal(skipped.status, "skipped");
    store.put("provider", "keep", { id: "keep" });
    const done = saveOnboarding(store, {
      expectedRevision: skipped.revision,
      step: 2,
      status: "completed",
    });
    assert.equal(done.status, "completed");
    assert.equal(store.records("harness-binding").length, 0);
    assert.equal(store.records("provider").length, 1);
    assert.doesNotMatch(JSON.stringify(store.records("onboarding")), /apiKey|must-not-persist/);
  } finally {
    store.close();
  }
});
