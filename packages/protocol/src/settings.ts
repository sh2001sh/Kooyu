import { z } from "zod";
import { HARNESS_IDS } from "./client.js";

export const appSettingsSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    /** Interface language; "system" follows the browser/OS. */
    language: z.enum(["system", "zh-CN", "en", "ja"]).default("system"),
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
  canRestore: boolean;
  job?: EngineInstallJob;
}
