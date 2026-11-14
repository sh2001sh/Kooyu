import type { CatalogModel, Provider } from "@kodo/protocol";

/** Group the same API model ID for display, retaining each source's own settings. */
export function groupCatalogModels(models: CatalogModel[]) {
  const groups = new Map<string, Map<string, CatalogModel>>();
  for (const model of models) {
    let sources = groups.get(model.model);
    if (!sources) {
      sources = new Map();
      groups.set(model.model, sources);
    }
    sources.set(model.id, model);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([model, sources]) => ({
      model,
      sources: [...sources.values()],
    }));
}

export function catalogModelSource(model: CatalogModel, providers: Provider[]): string {
  const provider = providers.find((item) => item.id === model.providerId);
  const endpoint = provider?.endpoints.find((item) => item.id === model.endpointId);
  return `${provider?.name ?? model.providerId} · ${endpoint?.name ?? model.endpointId}`;
}
