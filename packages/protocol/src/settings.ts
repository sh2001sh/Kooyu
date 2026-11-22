import { z } from "zod";
import { HARNESS_IDS } from "./client.js";

export const voiceSettingsSchema = z
  .object({
    /** "auto" prefers Web Speech API in browsers and falls back to Host/Provider transcription (including Desktop Electron). */
    engine: z.enum(["auto", "browser", "provider"]).default("auto"),
    /** Preferred Provider ID for OpenAI-compatible audio transcription; null auto-picks the first compatible provider. */
    providerId: z.string().trim().min(1).max(120).nullable().default(null),
    /** Transcription model ID (e.g. "whisper-1", "gpt-4o-mini-transcribe"). */
    model: z.string().trim().min(1).max(120).default("whisper-1"),
    /** Speech recognition language; "auto" follows the active interface language. */
    language: z.enum(["auto", "zh-CN", "en-US", "ja-JP"]).default("auto"),
    /** Automatically send the message after voice transcription completes. */
    autoSend: z.boolean().default(false),
  })
  .strict();
export type VoiceSettings = z.infer<typeof voiceSettingsSchema>;

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  engine: "auto",
  providerId: null,
  model: "whisper-1",
  language: "auto",
  autoSend: false,
};

export const updateSettingsSchema = z
  .object({
    /** "stable" tracks vX.Y.Z releases; "preview" also includes preview-X.Y.Z-N builds. */
    channel: z.enum(["stable", "preview"]).default("stable"),
    /** Automatically check for new Kooyu releases. */
    autoCheck: z.boolean().default(true),
    /** GitHub repository ("owner/repo") to check for releases. */
    repository: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
      .default("sh2001sh/Kooyu"),
  })
  .strict();
export type UpdateSettings = z.infer<typeof updateSettingsSchema>;

export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = {
  channel: "stable",
  autoCheck: true,
  repository: "sh2001sh/Kooyu",
};

export const appSettingsSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    /** Interface language; "system" follows the browser/OS. */
    language: z.enum(["system", "zh-CN", "en", "ja"]).default("system"),
    voice: voiceSettingsSchema.default(DEFAULT_VOICE_SETTINGS),
    update: updateSettingsSchema.default(DEFAULT_UPDATE_SETTINGS),
    defaultHarnessId: z.enum(HARNESS_IDS).default("kodo"),
    theme: z.enum(["system", "light", "dark"]).default("system"),
    messageFontSize: z.number().int().min(12).max(22).default(15),
    sendShortcut: z.enum(["enter", "mod-enter"]).default("enter"),
    reduceMotion: z.boolean().default(false),
    autoRefreshModels: z.boolean().default(true),
    personalInstructions: z.string().max(16000).default(""),
    /** Show the thinking process expanded while a reply streams. */
    expandThinking: z.boolean().default(true),
    /** Tool calls in a reply start collapsed. */
    collapseTools: z.boolean().default(true),
    /** Values a new chat starts with per harness; empty keeps the harness's own config. */
    harnessDefaults: z
      .partialRecord(
        z.enum(HARNESS_IDS),
        z
          .object({
            model: z.string().trim().min(1).max(200).nullable().default(null),
            reasoning: z.string().trim().min(1).max(100).nullable().default(null),
            permissionMode: z.string().trim().min(1).max(100).nullable().default(null),
            /**
             * Model slots the harness asks for by role, mapped to models of its source.
             * Claude Code: main, sonnet, opus, haiku, fast (ANTHROPIC_* model variables).
             */
            modelMap: z
              .partialRecord(
                z.enum(["main", "sonnet", "opus", "haiku", "fast"]),
                z.string().trim().min(1).max(200),
              )
              .default({}),
          })
          .strict(),
      )
      .default({}),
  })
  .strict();
export type AppSettings = z.infer<typeof appSettingsSchema>;

export interface EngineInstallJob {
  id: string;
  harnessId: (typeof HARNESS_IDS)[number];
  state: "running" | "succeeded" | "failed";
  action: "install" | "upgrade";
  version?: string;
  message: string;
  startedAt: string;
  finishedAt?: string;
}
export interface EngineInstallationOption {
  harnessId: (typeof HARNESS_IDS)[number];
  kind: "managed-npm" | "bundled" | "external";
  packageName?: string;
  documentation: string;
  command?: string;
  args?: string[];
  managedVersion?: string;
  proxyUrl?: string;
  canRestore: boolean;
  job?: EngineInstallJob;
}
