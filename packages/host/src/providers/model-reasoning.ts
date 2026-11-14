import type { EndpointProtocol, ModelParameters } from "@kodo/protocol";

/** Verified fallback for DeepSeek V4.1 Flash, not a reseller's protocol choices.
 * https://api-docs.deepseek.com/guides/thinking_mode (checked 2026-11-12).
 * Explicit route metadata and user overrides take precedence.
 */
export function officialModelReasoning(
  model: string,
  protocol: EndpointProtocol,
): ModelParameters | undefined {
  if (!/^deepseek-v4\.1-flash(?:-1017)?$/i.test(model)) return undefined;
  if (protocol === "openai-responses")
    return {
      reasoning: true,
      reasoningOptions: [{ type: "effort", values: ["none", "low", "high", "max"] }],
    };
  if (protocol === "openai-completions" || protocol === "anthropic-messages")
    return {
      reasoning: true,
      reasoningOptions: [{ type: "toggle" }, { type: "effort", values: ["low", "high", "max"] }],
    };
  return undefined;
}
