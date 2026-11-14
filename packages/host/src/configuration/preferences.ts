import { appSettingsSchema, KodoError, type AppSettings } from "@kodo/protocol";
import type { Store } from "../storage/store.js";

export function appSettings(store: Store): AppSettings {
  return appSettingsSchema.parse(store.record("app-settings", "global") ?? { revision: 0 });
}
export function saveAppSettings(store: Store, value: unknown): AppSettings {
  const input = appSettingsSchema.parse(value);
  return store.transaction(() => {
    const current = appSettings(store);
    if (current.revision !== input.revision)
      throw new KodoError("CONFLICT", "配置已在另一窗口修改，请刷新后重试。");
    const next = { ...input, revision: current.revision + 1 };
    store.put("app-settings-history", String(current.revision), current);
    store.put("app-settings", "global", next);
    return next;
  });
}
