import type { SubagentEvent } from "@kodo/protocol";
import type { AdapterContext } from "./adapter.js";

/** Only native parent/child evidence grants membership; unrelated sessions are ignored. */
export class NativeSubagents {
  private agents = new Map<string, Omit<SubagentEvent, "event">>();
  constructor(
    private ctx: AdapterContext,
    private root: () => string,
  ) {}
  has(id: unknown): id is string {
    return typeof id === "string" && this.agents.has(id);
  }
  register(
    agentId: unknown,
    parentAgentId: unknown,
    details: Partial<SubagentEvent> = {},
  ): boolean {
    if (
      typeof agentId !== "string" ||
      !agentId ||
      agentId === this.root() ||
      typeof parentAgentId !== "string" ||
      (parentAgentId !== this.root() && !this.has(parentAgentId))
    )
      return false;
    const previous = this.agents.get(agentId);
    if (previous && previous.parentAgentId !== parentAgentId) return false;
    const value = { ...previous, ...details, agentId, parentAgentId };
    delete value.event;
    this.agents.set(agentId, value);
    if (JSON.stringify(previous) !== JSON.stringify(value)) this.ctx.emit("subagent", value);
    return true;
  }
  emit(
    agentId: string,
    type: NonNullable<SubagentEvent["event"]>["type"],
    payload: unknown,
    nativeEventId?: string,
  ) {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    const value = payload as { outcome?: string; runState?: string } | null;
    const status =
      type === "turn-ended" ? value?.outcome : type === "state" ? value?.runState : undefined;
    if (typeof status === "string") agent.status = status;
    // Parent state transitions and accounting must never see a child's terminal/usage event.
    this.ctx.emit(
      "subagent",
      { ...agent, event: { type, payload } } satisfies SubagentEvent,
      nativeEventId === undefined
        ? undefined
        : JSON.stringify(["subagent", agentId, nativeEventId]),
    );
  }
}
