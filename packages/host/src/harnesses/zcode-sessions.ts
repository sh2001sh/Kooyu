import { randomUUID } from "node:crypto";
import { needCwd, type AdapterContext, type Wire } from "./adapter.js";
import { JsonRpc } from "./rpc.js";
import { ZCodeFrames } from "./zcode-frames.js";
import { NATIVE_HISTORY_LIMIT } from "./native-history.js";

/** A passive index snapshot. The native cold seed is bounded, not an all-time archive list. */
export async function listZCodeSessions(ctx: AdapterContext) {
  const workspaceId = needCwd(ctx),
    topic = `sessions-index/${workspaceId}`;
  const rpc = new JsonRpc(ctx, false);
  let frames: ZCodeFrames | undefined,
    epoch = "",
    bytes = 0;
  const early: Wire[] = [];
  let resolve!: (snapshot: Wire) => void, reject!: (error: Error) => void;
  const ready = new Promise<Wire>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const accept = (wire: Wire) => {
    if (wire.topic !== topic) return;
    try {
      bytes += Buffer.byteLength(JSON.stringify(wire));
      if (bytes > NATIVE_HISTORY_LIMIT || early.length >= 128)
        throw new Error("ZCode 会话列表超过读取上限。");
      if (!frames) {
        early.push(wire);
        return;
      }
      const frame = frames.accept(wire);
      if (!frame) return;
      const snapshot = frame.payload.snapshot;
      if (
        snapshot.workspaceId !== workspaceId ||
        snapshot.logEpoch !== epoch ||
        snapshot.sessions.some((row: Wire) => row.workspaceId !== workspaceId) ||
        new Set(snapshot.sessions.map((row: Wire) => row.sessionId)).size !==
          snapshot.sessions.length
      )
        throw new Error("ZCode 会话列表工作区、纪元或身份不匹配。");
      resolve({
        source: "zcode-sessions-index",
        workspaceId,
        sessions: snapshot.sessions,
        coverage: "native-index-window",
        complete: false,
      });
    } catch (error) {
      reject(error as Error);
    }
  };
  rpc.onClose = reject;
  rpc.onNotification = (method, params) => {
    if (method === "v4/conversation/frame") accept(params);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const operation = (async () => {
      const result = await rpc.request("v4/conversation/subscribe", {
        topic,
        connectionId: randomUUID(),
        clientMode: "desktop-continuous",
      });
      if (!result.ack?.subscriptionId || !result.ack.logEpoch || result.ack.mode !== "snapshot")
        throw new Error("ZCode 会话列表未返回有效订阅 ACK。");
      epoch = result.ack.logEpoch;
      frames = new ZCodeFrames(topic, result.ack.subscriptionId);
      for (const wire of early.splice(0)) accept(wire);
      return ready;
    })();
    // Observe rejection immediately even if a malformed early frame precedes the ACK.
    void ready.catch(() => {});
    return await Promise.race([
      operation,
      new Promise<never>((_, fail) => {
        timer = setTimeout(() => fail(new Error("ZCode 会话列表初始快照超时。")), 15000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    frames?.clear();
    await rpc.close();
  }
}
