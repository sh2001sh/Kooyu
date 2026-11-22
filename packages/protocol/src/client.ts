import type { EndpointProtocol, ModelParameters } from "./providers.js";
export { assistantContent, isThinkingChannel, splitAssistantText } from "./assistant-content.js";
// Browser-safe constants/helpers: clients do not ship Host validation schemas.
export const NATIVE_HARNESS_IDS = [
  "pi",
  "codex",
  "claude-code",
  "deepseek-harness",
  "zcode",
  "opencode",
  "gemini",
  "cursor",
  "kimi-code",
  "antigravity",
  "grok-build",
] as const;
// Kodo is the product agent. Its use of the pi SDK does not make it the pi harness.
export const HARNESS_IDS = ["kodo", ...NATIVE_HARNESS_IDS] as const;
export const PROTOCOL_VERSION = 2;

/** Native custom-provider entry points; installation and login are checked separately. */
export const HARNESS_PROVIDER_PROTOCOLS: Record<
  (typeof HARNESS_IDS)[number],
  readonly EndpointProtocol[]
> = {
  kodo: ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"],
  pi: ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"],
  codex: ["openai-responses"],
  "claude-code": ["anthropic-messages"],
  "deepseek-harness": ["openai-completions", "openai-responses", "anthropic-messages"],
  zcode: ["openai-completions", "openai-responses", "anthropic-messages"],
  opencode: ["openai-completions", "openai-responses", "anthropic-messages"],
  gemini: ["google-generative-ai"],
  cursor: [],
  "kimi-code": [
    "openai-completions",
    "openai-responses",
    "anthropic-messages",
    "google-generative-ai",
  ],
  antigravity: [],
  "grok-build": ["openai-completions", "openai-responses", "anthropic-messages"],
};

/** Only declared choices; SDK and browser menus share the same binding rules. */
export function bindingReasoningLevels(
  p: ModelParameters,
  harness?: (typeof HARNESS_IDS)[number],
): string[] | undefined {
  const sdk = harness === "pi" || harness === "kodo" || harness === "deepseek-harness";
  if (p.reasoning === false) return sdk ? ["off"] : [];
  if (sdk && p.thinkingLevelMap)
    return Object.entries(p.thinkingLevelMap)
      .filter(([, v]) => v !== null)
      .map(([k]) => k);
  const options = p.reasoningOptions?.filter((o) => o.type === "effort");
  if (!options?.length) return undefined;
  const declared = [...new Set(options.flatMap((o) => o.values))];
  if (harness === "gemini")
    return declared.filter((v) => ["minimal", "low", "medium", "high"].includes(v));
  if (harness === "grok-build")
    return declared.filter((v) =>
      ["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(v),
    );
  return sdk
    ? [...new Set(declared.map((v) => (v === "none" ? "off" : v)))].filter((v) =>
        ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(v),
      )
    : harness === "zcode"
      ? [...new Set(declared.map((v) => (v === "none" || v === "off" ? "disabled" : v)))]
      : declared;
}

/** Keep the SDK's internal off level distinct from the wire value none. */
export function bindingThinkingLevelMap(
  p: ModelParameters,
): NonNullable<ModelParameters["thinkingLevelMap"]> {
  const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
  const declared =
    p.reasoningOptions?.flatMap((option) => (option.type === "effort" ? option.values : [])) ?? [];
  return Object.fromEntries(
    levels.map((level) => [
      level,
      p.thinkingLevelMap
        ? (p.thinkingLevelMap[level] ?? null)
        : level === "off" && declared.includes("none")
          ? "none"
          : declared.includes(level)
            ? level
            : null,
    ]),
  );
}
