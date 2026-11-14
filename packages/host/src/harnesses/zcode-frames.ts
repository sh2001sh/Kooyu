// Wire facts checked against ZCode a9fe401e, shared/zcode-protocol-v4.
// This is a local decoder for the fields Kodo consumes, not a runtime import
// from the reference checkout. Unknown additive presentation fields survive.
import { z } from "zod";
import { crc32 } from "node:zlib";
import type { Wire } from "./adapter.js";
const natural = z.number().int().nonnegative();
const row = z
  .object({
    rowId: natural,
    turnId: z.string(),
    kind: z.string(),
    text: z.string().optional(),
    inputText: z.string().optional(),
    toolCallId: z.string().optional(),
    toolName: z.string().optional(),
    status: z.string().optional(),
  })
  .passthrough();
const control = z
  .object({
    phase: z.enum([
      "draft",
      "prewarming",
      "running",
      "completedSuccess",
      "completedInterrupted",
      "error",
    ]),
    stopState: z.enum(["idle", "stoppable", "stopping"]),
    activeWorks: z.array(
      z.object({ kind: z.string(), foregroundExecutionId: z.string().optional() }).passthrough(),
    ),
  })
  .passthrough();
const patch = z
  .object({
    control: control.optional(),
    usage: z
      .object({
        cumulative: z
          .object({
            inputTokens: natural,
            outputTokens: natural,
            cacheReadTokens: natural,
            cacheWriteTokens: natural,
          })
          .passthrough(),
      })
      .passthrough()
      .optional(),
    pendingInteractions: z
      .array(
        z
          .object({
            interactionId: z.string(),
            kind: z.string(),
            payload: z.object({ kind: z.string() }).passthrough(),
          })
          .passthrough(),
      )
      .optional(),
    backgroundWorks: z
      .array(
        z
          .object({
            workId: z.string(),
            status: z.enum(["running", "resultPending", "failed", "cancelled"]),
          })
          .passthrough(),
      )
      .optional(),
    pendingCommands: z.array(z.record(z.string(), z.unknown())).optional(),
    queue: z
      .object({ items: z.array(z.record(z.string(), z.unknown())), autoDrain: z.boolean() })
      .passthrough()
      .optional(),
  })
  .passthrough();
const snapshot = patch.extend({
  protocolVersion: z.literal(1),
  sessionId: z.string(),
  logEpoch: z.string(),
  seq: natural,
  revision: natural,
  control,
  rows: z
    .object({ window: z.array(row), totalCount: natural, firstRowId: natural.nullable() })
    .passthrough(),
});
const delta = z.discriminatedUnion("op", [
  z.object({ op: z.literal("row.appended"), row }),
  z.object({ op: z.literal("row.upserted"), row }),
  z.object({ op: z.literal("row.removed"), fromRowId: natural }),
  z.object({
    op: z.literal("row.delta"),
    rowId: natural,
    path: z.enum(["text", "inputText", "output.text", "summaryText"]),
    append: z.string(),
  }),
  z.object({ op: z.literal("state.updated"), patch }),
  // These live presentation updates do not affect Kodo's execution state.
  z
    .object({
      op: z.enum([
        "pluginUi.resourceUpdated",
        "pluginUi.resourceListChanged",
        "pluginUi.instanceClosed",
        "pluginUi.appToolCall",
        "workflowRun.updated",
        "workflowRun.removed",
      ]),
    })
    .passthrough(),
]);
const frame = z.object({
  topic: z.string(),
  subscriptionId: z.string(),
  fromSeq: natural,
  toSeq: natural,
  sentAt: z.number(),
  payload: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("snapshot"), snapshot }),
    z.object({ kind: z.literal("deltas"), deltas: z.array(delta) }),
  ]),
});
const indexFrame = frame.extend({
  payload: z.object({
    kind: z.literal("snapshot"),
    snapshot: z
      .object({
        protocolVersion: z.literal(1),
        workspaceId: z.string(),
        logEpoch: z.string(),
        sessions: z.array(
          z
            .object({ sessionId: z.string().min(1), workspaceId: z.string(), title: z.string() })
            .passthrough(),
        ),
      })
      .passthrough(),
  }),
});
type Assembly = {
  meta: string;
  bytes: number;
  parts: Map<number, Buffer>;
  wire: Wire;
  startedAt: number;
};
export class ZCodeFrames {
  private pending = new Map<string, Assembly>();
  private staged = 0;
  private ordinal = 0;
  constructor(
    readonly topic: string,
    readonly subscriptionId: string,
  ) {}
  expire(now = Date.now()): void {
    for (const a of this.pending.values())
      if (now - a.startedAt >= 30000)
        throw new Error(
          "ZCode physical frame assembly timed out; restore the native subscription.",
        );
  }
  clear(): void {
    this.pending.clear();
    this.staged = 0;
  }
  accept(w: Wire): Wire | undefined {
    if (w.topic !== this.topic || w.subscriptionId !== this.subscriptionId) return;
    this.expire();
    if (Buffer.byteLength(JSON.stringify(w)) > 1024 * 1024)
      throw new Error("ZCode physical frame exceeds the pinned protocol limit.");
    if (
      w.wireVersion !== 3 ||
      !["initial", "online", "recovery"].includes(w.deliveryKind) ||
      !Number.isSafeInteger(w.logicalFrameOrdinal) ||
      w.logicalFrameOrdinal < 1 ||
      typeof w.logicalFrameId !== "string"
    )
      throw new Error("Unsupported ZCode physical frame metadata.");
    if (w.logicalFrameOrdinal <= this.ordinal) return;
    let value: unknown;
    if (w.kind === "complete") value = w.frame;
    else if (w.kind === "fragment") {
      if (
        !Number.isInteger(w.fragmentCount) ||
        w.fragmentCount < 1 ||
        w.fragmentCount > 1024 ||
        !Number.isInteger(w.fragmentIndex) ||
        w.fragmentIndex < 0 ||
        w.fragmentIndex >= w.fragmentCount ||
        !Number.isInteger(w.logicalBytes) ||
        w.logicalBytes < 1 ||
        w.logicalBytes > 16 * 1024 * 1024 ||
        w.checksum?.algorithm !== "crc32" ||
        !/^[0-9a-f]{8}$/.test(w.checksum?.value) ||
        typeof w.dataBase64 !== "string"
      )
        throw new Error("Unsupported ZCode fragment metadata.");
      const bytes = Buffer.from(w.dataBase64, "base64");
      if (bytes.toString("base64") !== w.dataBase64)
        throw new Error("Invalid ZCode base64 fragment.");
      const meta = JSON.stringify([
        w.logicalFrameOrdinal,
        w.deliveryKind,
        w.fragmentCount,
        w.logicalBytes,
        w.checksum,
      ]);
      let a = this.pending.get(w.logicalFrameId);
      if (!a) {
        if (this.pending.size >= 32) throw new Error("ZCode frame assembly capacity reached.");
        a = { meta, bytes: 0, parts: new Map(), wire: w, startedAt: Date.now() };
        this.pending.set(w.logicalFrameId, a);
      }
      if (a.meta !== meta)
        throw new Error("ZCode fragment metadata changed within one logical frame.");
      const previous = a.parts.get(w.fragmentIndex);
      if (previous) {
        if (!previous.equals(bytes)) throw new Error("ZCode duplicate fragment differs.");
        return;
      }
      a.parts.set(w.fragmentIndex, bytes);
      a.bytes += bytes.length;
      this.staged += bytes.length;
      if (a.bytes > w.logicalBytes || this.staged > 32 * 1024 * 1024)
        throw new Error("ZCode frame assembly byte capacity reached.");
      if (a.parts.size !== w.fragmentCount) return;
      const all = Buffer.concat(
        Array.from({ length: w.fragmentCount }, (_, i) => a!.parts.get(i)!),
      );
      this.pending.delete(w.logicalFrameId);
      this.staged -= a.bytes;
      if (
        all.length !== w.logicalBytes ||
        crc32(all).toString(16).padStart(8, "0") !== w.checksum.value
      )
        throw new Error("ZCode logical frame length/checksum mismatch.");
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(all));
    } else throw new Error("Unsupported ZCode physical frame kind.");
    const parsed = (this.topic.startsWith("sessions-index/") ? indexFrame : frame).parse(value);
    if (
      parsed.topic !== this.topic ||
      parsed.subscriptionId !== this.subscriptionId ||
      parsed.toSeq < parsed.fromSeq
    )
      throw new Error("ZCode logical frame ownership/sequence mismatch.");
    if (
      parsed.payload.kind === "snapshot" &&
      (parsed.fromSeq !== 0 ||
        ("seq" in parsed.payload.snapshot && parsed.payload.snapshot.seq !== parsed.toSeq))
    )
      throw new Error("ZCode snapshot sequence mismatch.");
    this.ordinal = w.logicalFrameOrdinal;
    for (const [id, a] of this.pending)
      if (a.wire.logicalFrameOrdinal <= this.ordinal) {
        this.staged -= a.bytes;
        this.pending.delete(id);
      }
    return { ...parsed, deliveryKind: w.deliveryKind };
  }
}
