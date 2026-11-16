import type { AdapterContext } from "./adapter.js";

export type ModelInput = ("text" | "image")[];

/** Preserve an explicit text-only declaration; missing data remains unknown. */
export function declaredInput(value: unknown): ModelInput | undefined {
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value.filter((v): v is "text" | "image" => v === "text" || v === "image"))];
}

/** Without a verified endpoint, only native metadata and the public catalog apply. */
export function resolveInput(
  ctx: AdapterContext,
  provider: string,
  id: string,
  input?: ModelInput,
  route?: { baseUrl: string; api: string },
): ModelInput | undefined {
  return (
    ctx.modelInput?.({
      provider,
      id,
      baseUrl: route?.baseUrl ?? "",
      api: route?.api ?? "",
      declaredInput: input,
    }) ?? input
  );
}
