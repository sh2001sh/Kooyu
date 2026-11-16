import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  automationInputSchema,
  editorTrigger,
  scheduleEditorValue,
  type AutomationInput,
  type Command,
  type InboxItem,
} from "@kodo/protocol";
import { nextOccurrence, previewSchedule } from "../src/automations/schedule.js";
import { Store } from "../src/storage/store.js";
import { SessionService } from "../src/session-service.js";
import { createSelfHostedTools } from "../src/kodo/self-hosted-tools.js";

type Schedule = Pick<AutomationInput, "trigger" | "timeZone">;
const at = (schedule: Schedule, after: string) => nextOccurrence(schedule, new Date(after));
test("automation limits accept zero as unlimited and reject negative or fractional counts", () => {
  const schema = automationInputSchema.shape.limits;
  assert.deepEqual(schema.parse({ maxRuns: 0, maxCostUsd: 0 }), { maxRuns: 0, maxCostUsd: 0 });
  assert.equal(schema.safeParse({ maxRuns: -1 }).success, false);
  assert.equal(schema.safeParse({ maxRuns: 1.5 }).success, false);
  assert.equal(schema.safeParse({ maxCostUsd: -0.1 }).success, false);
  assert.equal(schema.safeParse({ maxCostUsd: Infinity }).success, false);
});
test("calendar selections respect timezone, weekdays and missing month dates", () => {
  const daily: Schedule = {
    timeZone: "Asia/Shanghai",
    trigger: { kind: "calendar", frequency: "daily", time: "09:30" },
  };
  assert.equal(at(daily, "2026-11-16T00:00:00Z"), "2026-11-16T01:30:00.000Z");
  assert.equal(
    at(
      {
        ...daily,
        trigger: {
          ...(daily.trigger as object),
          kind: "calendar",
          frequency: "weekdays",
          time: "09:30",
        },
      },
      "2026-11-20T02:00:00Z",
    ),
    "2026-11-23T01:30:00.000Z",
  );
  assert.equal(
    at(
      {
        ...daily,
        trigger: { kind: "calendar", frequency: "weekly", weekdays: [0, 2], time: "09:30" },
      },
      "2026-11-16T00:00:00Z",
    ),
    "2026-11-17T01:30:00.000Z",
  );
  assert.equal(
    at(
      {
        ...daily,
        trigger: { kind: "calendar", frequency: "monthly", dayOfMonth: 31, time: "09:30" },
      },
      "2026-04-01T00:00:00Z",
    ),
    "2026-05-31T01:30:00.000Z",
  );
});
test("calendar single execution validates real dates and DST, with no second fallback occurrence", () => {
  const once: Schedule = {
    timeZone: "America/New_York",
    trigger: { kind: "calendar", frequency: "once", date: "2026-11-01", time: "01:30" },
  };
  assert.equal(at(once, "2026-10-31T00:00:00Z"), "2026-11-01T05:30:00.000Z");
  assert.equal(at(once, "2026-11-01T05:45:00Z"), null);
  assert.throws(
    () =>
      at(
        {
          ...once,
          trigger: { kind: "calendar", frequency: "once", date: "2026-03-08", time: "02:30" },
        },
        "2026-01-01T00:00:00Z",
      ),
    /不存在/,
  );
  assert.throws(
    () =>
      at(
        {
          ...once,
          trigger: { kind: "calendar", frequency: "once", date: "2026-02-30", time: "09:00" },
        },
        "2026-01-01T00:00:00Z",
      ),
    /日期无效/,
  );
  assert.throws(() => at({ ...once, timeZone: "Invalid/Zone" }, "2026-01-01T00:00:00Z"));
  assert.throws(
    () =>
      at(
        { ...once, trigger: { kind: "calendar", frequency: "weekly", time: "09:00" } },
        "2026-01-01T00:00:00Z",
      ),
    /星期/,
  );
  const daily: Schedule = {
    timeZone: once.timeZone,
    trigger: { kind: "calendar", frequency: "daily", time: "02:30" },
  };
  assert.equal(at(daily, "2026-03-08T00:00:00Z"), "2026-03-09T06:30:00.000Z");
  assert.equal(
    at(
      { ...daily, trigger: { kind: "calendar", frequency: "daily", time: "01:30" } },
      "2026-11-01T05:45:00Z",
    ),
    "2026-11-02T06:30:00.000Z",
  );
});
test("90 minute intervals keep their original anchor across late scans, serialization and DST", () => {
  const p: Schedule = {
    timeZone: "America/New_York",
    trigger: { kind: "interval", every: 90, unit: "minutes", startAt: "2026-11-01T00:10:00-04:00" },
  };
  assert.deepEqual(previewSchedule(p, new Date("2026-11-01T04:00:00Z")), [
    "2026-11-01T04:10:00.000Z",
    "2026-11-01T05:40:00.000Z",
    "2026-11-01T07:10:00.000Z",
  ]);
  assert.equal(
    at(JSON.parse(JSON.stringify(p)), "2026-11-01T07:50:00Z"),
    "2026-11-01T08:40:00.000Z",
  );
  assert.equal(at(p, "2026-11-01T08:40:00Z"), "2026-11-01T10:10:00.000Z");
});
test("legacy editor conversion preserves next runs and offset single dates", () => {
  for (const expression of [
    "30 9 * * *",
    "30 9 * * 1-5",
    "30 9 * * 1,3,7",
    "30 9 31 * *",
    "*/13 3-9 * * 2-4",
  ]) {
    const trigger = { kind: "cron" as const, expression };
    assert.deepEqual(
      previewSchedule(
        { trigger: editorTrigger(scheduleEditorValue(trigger)), timeZone: "Asia/Shanghai" },
        new Date("2026-11-01T00:00:00Z"),
      ),
      previewSchedule({ trigger, timeZone: "Asia/Shanghai" }, new Date("2026-11-01T00:00:00Z")),
    );
  }
  const trigger = { kind: "once" as const, at: "2027-02-01T09:00:00+08:00" };
  assert.deepEqual(editorTrigger(scheduleEditorValue(trigger)), trigger);
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-schedules-"));
  const store = new Store(":memory:");
  const service = new SessionService(store, { dataDir: dir, adapters: [] });
  const owner = service.createDraft({ title: "Schedules", harnessId: "kodo", kind: "supervisor" });
  const turn = (origin: Command["origin"] = "user") => {
    const id = randomUUID();
    store.saveCommand({
      id,
      sessionId: owner.id,
      kind: "send",
      origin,
      status: "dispatched",
      body: { text: "每天九点检查项目", mode: "new" },
      createdAt: new Date().toISOString(),
      generation: store.session(owner.id).ownerEpoch,
      bindingRevision: null,
      nativeRunId: null,
      controllerId: null,
    });
    store.put("active-tool-turn", owner.id, { id });
    return id;
  };
  const input = () => ({
    requestId: randomUUID(),
    controllerSessionId: owner.id,
    name: "检查项目",
    promptTemplate: "检查项目并汇总",
    timeZone: "Asia/Shanghai",
    trigger: { kind: "calendar" as const, frequency: "daily" as const, time: "09:00" },
  });
  const answer = (decision = "accept") => {
    const inbox = store
      .records<InboxItem>("inbox")
      .filter((i) => i.type === "interaction" && !i.resolved);
    assert.equal(inbox.length, 1);
    service.answerInteraction(inbox[0]!.id, { decision }, randomUUID());
  };
  return {
    store,
    service,
    owner,
    turn,
    input,
    answer,
    async close() {
      await service.dispose();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("conversation approval creates authorization and plan once, including concurrent replay", async () => {
  const f = fixture();
  try {
    f.turn();
    const input = f.input();
    const work = f.service.automations.saveFromConversation(input);
    const replay = f.service.automations.saveFromConversation(input);
    assert.equal(f.service.automations.definitions.all().length, 0);
    assert.equal(f.service.permissions.grants.all().length, 0);
    await assert.rejects(
      f.service.automations.saveFromConversation({ ...input, name: "changed" }),
      /内容已改变/,
    );
    f.answer();
    const plan = await work;
    assert.deepEqual(await replay, plan);
    assert.deepEqual(await f.service.automations.saveFromConversation(input), plan);
    assert.equal(f.service.permissions.grants.all().length, 1);
    assert.equal(f.service.automations.definitions.all().length, 1);
    f.service.permissions.require(plan.grantId, {
      controllerSessionId: f.owner.id,
      operation: "automation.execute",
      resource: "session:" + f.owner.id,
    });
    const next = f.service.automations.saveFromConversation(
      {
        ...f.input(),
        expectedRevision: plan.revision,
        trigger: { kind: "interval", every: 90, unit: "minutes", startAt: "2027-01-01T00:00:00Z" },
      },
      plan.id,
    );
    f.answer();
    assert.equal((await next).revision, 2);
    await assert.rejects(
      f.service.automations.saveFromConversation({ ...f.input(), expectedRevision: 1 }, plan.id),
      /已修改/,
    );
  } finally {
    await f.close();
  }
});
test("decline, stop during confirmation, invalid input and automated turns create no authority", async () => {
  const f = fixture();
  try {
    f.turn();
    const input = f.input();
    const work = f.service.automations.saveFromConversation(input);
    const denied = assert.rejects(work, /用户未允许/);
    f.answer("decline");
    await denied;
    await assert.rejects(f.service.automations.saveFromConversation(input), /用户未允许/);
    const stopped = f.service.automations.saveFromConversation(f.input());
    const stoppedCheck = assert.rejects(stopped, /已停止/);
    const owner = f.store.session(f.owner.id);
    f.store.saveSession({ ...owner, ownerEpoch: owner.ownerEpoch + 1 });
    f.answer();
    await stoppedCheck;
    f.turn("automation");
    await assert.rejects(f.service.automations.saveFromConversation(f.input()), /用户在主对话/);
    f.turn();
    await assert.rejects(
      f.service.automations.saveFromConversation({
        ...f.input(),
        trigger: { kind: "interval", every: 0, unit: "minutes", startAt: "2027-01-01T00:00:00Z" },
      }),
    );
    assert.equal(f.service.permissions.grants.all().length, 0);
    assert.equal(f.service.automations.definitions.all().length, 0);
  } finally {
    await f.close();
  }
});
test("tool preview needs no grant and actual tool creation waits for a user answer", async () => {
  const f = fixture();
  try {
    f.turn();
    const tool = createSelfHostedTools(f.service, f.owner).find((t) => t.name === "automation")!;
    const { requestId: _r, controllerSessionId: _s, ...input } = f.input();
    const invoke = (action: string) =>
      tool.execute(randomUUID(), { action, input }, undefined, undefined, {} as never);
    const preview = await invoke("preview");
    assert.equal(JSON.parse((preview.content[0] as { text: string }).text).occurrences.length, 3);
    assert.equal(f.service.permissions.grants.all().length, 0);
    const pending = invoke("create");
    f.answer();
    await pending;
    assert.equal(f.service.automations.definitions.all().length, 1);
  } finally {
    await f.close();
  }
});
test("ordinary chat preserves schedules; takeover of active scheduled work and Stop pause them", async () => {
  const f = fixture();
  try {
    const plan = f.service.automations.save({
      ...f.input(),
      grantId: f.service.automations.authorize(f.owner.id, randomUUID()).id,
    });
    const chat = f.service.acceptSend(f.owner.id, {
      requestId: randomUUID(),
      text: "列出我的计划",
      mode: "new",
    });
    assert.equal(f.service.automations.definitions.get(plan.id).enabled, true);
    f.store.saveCommand({ ...chat, status: "cancelled" });
    const scheduled: Command = {
      ...chat,
      id: randomUUID(),
      origin: "automation",
      status: "accepted",
    };
    f.store.saveCommand(scheduled);
    f.service.acceptSend(f.owner.id, { requestId: randomUUID(), text: "我来接管", mode: "queue" });
    assert.equal(f.service.automations.definitions.get(plan.id).enabled, false);
    const latest = f.service.automations.definitions.get(plan.id);
    f.service.automations.save(
      { ...f.input(), expectedRevision: latest.revision, grantId: plan.grantId },
      plan.id,
    );
    await f.service.stop(f.owner.id);
    assert.equal(f.service.automations.definitions.get(plan.id).enabled, false);
    assert.equal(
      automationInputSchema.safeParse({
        ...f.input(),
        grantId: plan.grantId,
        trigger: { kind: "interval", every: -1, unit: "hours", startAt: "2027-01-01T00:00:00Z" },
      }).success,
      false,
    );
  } finally {
    await f.close();
  }
});
