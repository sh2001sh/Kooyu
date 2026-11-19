import type { Command, RuntimeEvent } from "@kodo/protocol";

/** A terminal turn proves that its own command is no longer waiting for delivery. */
export function completedCommandIds(events: RuntimeEvent[]): Set<string> {
  const completed = new Set<string>();
  let dispatched: string | undefined;
  for (const event of events) {
    const payload = event.payload as { commandId?: string; role?: string } | null;
    if (event.type === "message" && payload?.role === "user") dispatched = payload.commandId;
    if (event.type !== "turn-ended" && event.type !== "settled") continue;
    const id = payload?.commandId ?? dispatched;
    if (id) completed.add(id);
    dispatched = undefined;
  }
  return completed;
}

export function reconcileCompletedCommands(commands: Command[], completed: Set<string>): Command[] {
  let changed = false;
  const next = commands.map((command) => {
    if (
      command.kind !== "send" ||
      !completed.has(command.id) ||
      !["accepted", "dispatched"].includes(command.status)
    )
      return command;
    changed = true;
    // Confirmed records delivery, not a successful model answer. The turn keeps its failure.
    return { ...command, status: "confirmed" as const };
  });
  return changed ? next : commands;
}
