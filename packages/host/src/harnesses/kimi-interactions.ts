import type { Wire } from "./adapter.js";

const object = (value: unknown): value is Wire =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
const invalid = (): never => {
  throw new Error("Kimi 原生交互回答格式无效。");
};

/** Kimi Server 2.5 interactionRespondRequestSchema; keep the native discriminator authoritative. */
export function kimiInteractionResponse(kind: "approval" | "question", answer: unknown): Wire {
  const value = answer ?? {};
  if (!object(value)) return invalid();
  if (kind === "approval") {
    const decision =
      value.cancelled === true
        ? "cancelled"
        : value.decision === "accept"
          ? "approved"
          : value.decision === "decline"
            ? "rejected"
            : (value.decision ?? "cancelled");
    if (!["approved", "rejected", "cancelled"].includes(decision)) return invalid();
    if (value.scope !== undefined && value.scope !== "session") return invalid();
    const result: Wire = {
      kind,
      decision,
      ...(value.scope === "session" ? { scope: "session" } : {}),
    };
    for (const key of ["feedback", "selected_label"]) {
      if (value[key] === undefined) continue;
      if (typeof value[key] !== "string") return invalid();
      result[key] = value[key];
    }
    return result;
  }
  if (value.cancelled === true) return { kind, dismissed: true };
  if (value.dismissed !== undefined && value.dismissed !== true) return invalid();
  if ((value.dismissed === true) === (value.answers !== undefined)) return invalid();
  const result: Wire = { kind };
  if (value.dismissed === true) result.dismissed = true;
  else {
    if (!object(value.answers)) return invalid();
    result.answers = Object.fromEntries(
      Object.entries(value.answers).map(([id, item]) => {
        if (!id || !object(item)) return invalid();
        if (item.kind === "single" && typeof item.option_id === "string" && item.option_id)
          return [id, { kind: item.kind, option_id: item.option_id }];
        if (item.kind === "multi" && strings(item.option_ids) && item.option_ids.length)
          return [id, { kind: item.kind, option_ids: item.option_ids }];
        if (item.kind === "other" && typeof item.text === "string")
          return [id, { kind: item.kind, text: item.text }];
        if (
          item.kind === "multi_with_other" &&
          strings(item.option_ids) &&
          typeof item.other_text === "string"
        )
          return [
            id,
            { kind: item.kind, option_ids: item.option_ids, other_text: item.other_text },
          ];
        if (item.kind === "skipped") return [id, { kind: item.kind }];
        return invalid();
      }),
    );
  }
  if (value.method !== undefined) {
    if (!["enter", "space", "number_key", "click"].includes(value.method)) return invalid();
    result.method = value.method;
  }
  if (value.note !== undefined) {
    if (typeof value.note !== "string") return invalid();
    result.note = value.note;
  }
  return result;
}
