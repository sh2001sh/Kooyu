/** Assemble streamed answers per native child; thought/user echoes are not answer evidence. */
export function subagentEvidence(events, marker) {
  const streams = new Map();
  const hasOutput = (rows) => {
    let found = false;
    for (const event of rows) {
      const payload = event.payload;
      if (payload?.role === "user" || payload?.channel === "thought") continue;
      if (event.type === "message") found ||= JSON.stringify(payload).includes(marker);
      if (event.type === "text-delta") {
        const key = JSON.stringify([event.agentId ?? "root", payload?.itemId, payload?.channel]);
        const text = (streams.get(key) ?? "") + (payload?.text ?? "");
        streams.set(key, text);
        found ||= text.includes(marker);
      }
    }
    return found;
  };
  const children = events.filter((event) => event.type === "subagent");
  const end = events.filter((event) => event.type === "turn-ended").at(-1);
  return {
    childIdentity: children.some((event) => Boolean(event.payload?.agentId)),
    childOutput: hasOutput(
      children
        .filter((event) => event.payload?.event)
        .map((event) => ({ ...event.payload.event, agentId: event.payload.agentId })),
    ),
    parentOutput: hasOutput(
      events.filter((event) => ["message", "text-delta"].includes(event.type)),
    ),
    ...(end ? { completed: ["completed", "complete"].includes(end.payload?.outcome) } : {}),
  };
}
