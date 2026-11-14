import { KodoError, type HarnessId } from "@kodo/protocol";
import { piAdapter } from "./pi.js";
import { kodoAdapter } from "./kodo.js";
import { codexAdapter } from "./codex.js";
import { claudeCodeAdapter } from "./claude-code.js";
import { deepSeekAdapter } from "./deepseek-harness.js";
import { zcodeAdapter } from "./zcode.js";
import { opencodeAdapter } from "./opencode.js";
import { geminiAdapter } from "./gemini.js";
import { cursorAdapter } from "./cursor.js";
import { kimiCodeAdapter } from "./kimi-code.js";
import { grokBuildAdapter } from "./grok-build.js";

export const adapters = [
  kodoAdapter,
  piAdapter,
  codexAdapter,
  claudeCodeAdapter,
  deepSeekAdapter,
  zcodeAdapter,
  opencodeAdapter,
  geminiAdapter,
  cursorAdapter,
  kimiCodeAdapter,
  grokBuildAdapter,
];
export function getAdapter(id: HarnessId) {
  const adapter = adapters.find((entry) => entry.descriptor.id === id);
  if (!adapter) throw new KodoError("NOT_FOUND", "找不到该 harness。");
  return adapter;
}
