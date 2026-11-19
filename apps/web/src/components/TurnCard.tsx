type Value = Record<string, any>;

export function messageText(p: any): string {
  if (typeof p === "string") return p;
  if (!p) return "";
  if (typeof p.text === "string") return p.text;
  if (typeof p.content === "string") return p.content;
  if (Array.isArray(p.content)) {
    return p.content
      .filter((v: Value) => v.type === "text" || v.type === "output_text")
      .map((v: Value) => v.text)
      .join("\n");
  }
  if (p.message) return messageText(p.message);
  return "";
}

/** Readable reason for a failed native turn; null for successful or cancelled turns. */
export function failureText(p: Value | undefined): string | null {
  if (!p || p.outcome !== "failed") return null;
  const error = p.error ?? p.reason ?? p.turn?.error ?? {};
  const errors = Array.isArray(p.errors)
    ? p.errors.filter((value: unknown) => typeof value === "string" && value.trim()).join("\n")
    : "";
  const text =
    (typeof error === "string" ? error : null) ??
    error.underlyingErrorMessage ??
    error.message ??
    (errors || null) ??
    (typeof p.message === "string" ? p.message : null);
  return typeof text === "string" && text.trim() ? text.trim() : "本轮执行失败，原生未提供原因。";
}
