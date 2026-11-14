import { KodoError, onboardingUpdateSchema, type OnboardingState } from "@kodo/protocol";
import type { Store } from "../storage/store.js";

/** Pin the first decision before setup creates providers or bindings. */
export function onboardingState(store: Store): OnboardingState {
  return store.transaction(() => {
    const saved = store.record<OnboardingState>("onboarding", "global");
    if (saved) return saved;
    const existing =
      store.sessions().length ||
      store.projects().length ||
      store.records("provider").length ||
      store.records("harness-binding").length ||
      store.record("app-settings", "global");
    const state: OnboardingState = {
      version: 1,
      revision: 0,
      step: 0,
      status: existing ? "skipped" : "active",
      updatedAt: new Date().toISOString(),
    };
    store.put("onboarding", "global", state);
    return state;
  });
}
export function saveOnboarding(store: Store, value: unknown): OnboardingState {
  const input = onboardingUpdateSchema.parse(value);
  return store.transaction(() => {
    const current = onboardingState(store);
    if (current.revision !== input.expectedRevision)
      throw new KodoError("CONFLICT", "引导已在另一窗口更新，请重新载入后继续。");
    // Completing the guide is not an assertion that a model or account is configured.
    const next: OnboardingState = {
      version: 1,
      revision: current.revision + 1,
      step: input.step,
      status: input.status,
      updatedAt: new Date().toISOString(),
    };
    store.put("onboarding", "global", next);
    return next;
  });
}
