import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels, type Model, type Api } from "@earendil-works/pi-ai";
import type { HarnessModelOption } from "@kodo/protocol";
import { nativeParameters, kodoModelOption } from "./model-metadata.js";

let catalogPromise: Promise<HarnessModelOption[]> | null = null;

export async function getKodoConfiguredCatalog(
  root = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
  label = "pi 本机原生配置",
): Promise<HarnessModelOption[]> {
  const path = join(root, "models.json");
  if (!existsSync(path)) return [];
  const configured = readKodoNativeModels(root, label).models;
  const keys = new Set(configured.map((m) => `${m.provider}/${m.id}`));
  const runtime = await ModelRuntime.create({ modelsPath: path });
  const providers = JSON.parse(readFileSync(path, "utf8")).providers ?? {};
  return configured.map((entry) => {
    const model = runtime.getModel(entry.provider!, entry.id);
    const declaration = providers[entry.provider!]?.models?.find(
      (m: { id?: string }) => m.id === entry.id,
    );
    // Local config is not a manufacturer's specification. Never expose SDK defaults
    // for omitted fields as if they were declared by this endpoint.
    if (!model || !keys.has(`${model.provider}/${model.id}`)) return entry;
    const source = { kind: "native-config", label } as const;
    // Limits the user declared in models.json are what pi actually runs with.
    const limits = nativeParameters(
      { contextWindow: declaration?.contextWindow, maxOutputTokens: declaration?.maxTokens },
      source,
    );
    const reasoning =
      declaration?.reasoning === false ||
      (declaration?.reasoning === true && declaration.thinkingLevelMap)
        ? nativeParameters({ reasoning: getSupportedThinkingLevels(model) }, source)
        : {};
    return {
      ...entry,
      ...limits,
      ...reasoning,
      parameterSources: {
        ...entry.parameterSources,
        ...limits.parameterSources,
        ...reasoning.parameterSources,
      },
    };
  });
}

/** Merge model lists by (provider, id), keeping highest-priority source first. */
export function mergeModelOptions(...lists: HarnessModelOption[][]): HarnessModelOption[] {
  const rank: Record<HarnessModelOption["source"], number> = {
    discovered: 0,
    recent: 2,
    "native-catalog": 1,
  };
  const merged = new Map<string, HarnessModelOption>();
  const known = new Set(
    lists
      .flat()
      .filter((m) => m.provider)
      .map((m) => `${m.provider}/${m.id}`),
  );
  for (const list of lists) {
    for (const raw of list) {
      if (!raw.id) continue;
      // A recent "provider/model" route is the same model as a catalog entry with a provider.
      const item =
        !raw.provider && known.has(raw.id)
          ? {
              ...raw,
              provider: raw.id.slice(0, raw.id.indexOf("/")),
              id: raw.id.slice(raw.id.indexOf("/") + 1),
            }
          : raw;
      const key = `${item.provider ?? ""}\u0000${item.id}`;
      const prev = merged.get(key);
      if (!prev) {
        merged.set(key, item);
        continue;
      }
      const [winner, other] = rank[item.source] < rank[prev.source] ? [item, prev] : [prev, item];
      // A discovered native route may use different limits than the SDK catalog.
      if (winner.source === "discovered") {
        merged.set(key, winner);
        continue;
      }
      // Keep the higher-priority entry, filling limits it does not report.
      const filled: HarnessModelOption = {
        ...winner,
        parameterSources: { ...winner.parameterSources },
      };
      for (const field of [
        "contextWindow",
        "maxInputTokens",
        "maxOutputTokens",
        "reasoning",
        "pricing",
      ] as const)
        if (filled[field] === undefined && other[field] !== undefined) {
          (filled as unknown as Record<string, unknown>)[field] = other[field];
          const source = other.parameterSources?.[field];
          if (source) filled.parameterSources![field] = source;
        }
      merged.set(key, filled);
    }
  }
  return [...merged.values()];
}

/** Lazy-load the built-in @earendil-works/pi-coding-agent model catalog once per process. */
export function getKodoBuiltinCatalog(): Promise<HarnessModelOption[]> {
  if (!catalogPromise) {
    catalogPromise = ModelRuntime.create({ modelsPath: null })
      .then((runtime) =>
        runtime
          .getAllModels()
          .filter((m) => "maxTokens" in m && "reasoning" in m)
          .map((m) => kodoModelOption(m as Model<Api>)),
      )
      .catch(() => {
        catalogPromise = null;
        return [];
      });
  }
  return catalogPromise;
}

/** Read local ~/.pi/agent settings/models without probing external services or keyrings. */
export function readKodoNativeModels(
  root = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
  label = "pi 本机原生配置",
): {
  models: HarnessModelOption[];
  defaultModel: { provider?: string; model: string } | null;
} {
  let defaultModel: { provider?: string; model: string } | null = null;
  const discovered: HarnessModelOption[] = [];

  try {
    const settingsPath = join(root, "settings.json");
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
      if (typeof settings.defaultModel === "string" && settings.defaultModel) {
        defaultModel = {
          ...(typeof settings.defaultProvider === "string" && settings.defaultProvider
            ? { provider: settings.defaultProvider }
            : {}),
          model: settings.defaultModel,
        };
      }
    }
  } catch {}

  try {
    const modelsPath = join(root, "models.json");
    if (existsSync(modelsPath)) {
      const data = JSON.parse(readFileSync(modelsPath, "utf8")) as {
        providers?: Record<
          string,
          {
            models?: Array<{
              id?: string;
              name?: string;
              reasoning?: boolean;
              contextWindow?: unknown;
              maxTokens?: unknown;
            }>;
          }
        >;
      };
      for (const [provider, entry] of Object.entries(data.providers ?? {})) {
        for (const m of entry?.models ?? []) {
          if (typeof m?.id === "string" && m.id) {
            discovered.push({
              id: m.id,
              name: typeof m.name === "string" ? m.name : undefined,
              provider,
              source: "discovered",
              ...nativeParameters(
                {
                  contextWindow: m.contextWindow,
                  maxOutputTokens: m.maxTokens,
                  ...(m.reasoning === false ? { reasoning: [] } : {}),
                },
                { kind: "native-config", label },
              ),
            });
          }
        }
      }
    }
  } catch {}

  return { models: discovered, defaultModel };
}
