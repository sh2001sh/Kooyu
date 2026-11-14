import { request, type FullConfig } from "@playwright/test";

/** Legacy workbench specs start past first launch; onboarding specs reset via the real API. */
export default async function workbenchSetup(config: FullConfig) {
  const client = await request.newContext({ baseURL: config.projects[0]!.use.baseURL });
  try {
    const response = await client.get("/api/onboarding");
    if (!response.ok()) throw new Error("Onboarding test setup could not read Host state");
    const state = await response.json();
    if (state.status === "active") {
      const saved = await client.patch("/api/onboarding", {
        data: { expectedRevision: state.revision, step: 0, status: "skipped" },
      });
      if (!saved.ok()) throw new Error("Onboarding test setup could not prepare workbench state");
    }
  } finally {
    await client.dispose();
  }
}
