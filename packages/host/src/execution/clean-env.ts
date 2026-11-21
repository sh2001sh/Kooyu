const AMBIENT_SECRET_KEYS = new Set([
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "DEEPSEEK_API_KEY",
  "OPENROUTER_API_KEY",
  "XAI_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "CLAUDECODE",
]);

const AMBIENT_SECRET_PREFIXES = ["CLAUDE_CODE_"];
const AMBIENT_SECRET_PATTERN = /^(KODO|KOOYU)_.*(KEY|TOKEN|SECRET)/i;

/**
 * Strips host-inherited third-party LLM/Kooyu API credentials from a subprocess environment
 * so local preflight check scripts and helper commands cannot accidentally read user secrets.
 */
export function stripAmbientSecrets(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (AMBIENT_SECRET_KEYS.has(key)) continue;
    if (AMBIENT_SECRET_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    if (AMBIENT_SECRET_PATTERN.test(key)) continue;
    clean[key] = value;
  }
  return clean;
}
