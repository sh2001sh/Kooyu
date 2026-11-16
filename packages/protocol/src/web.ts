import { z } from "zod";

/** A source actually retrieved by the Host. A model claiming it searched is not a source. */
export interface WebSource {
  id: string;
  sessionId: string | null;
  goalId: string | null;
  kind: "search" | "fetch";
  /** Search query or requested URL. */
  request: string;
  /** Final URL after redirects (fetch) or null (search). */
  url: string | null;
  title: string | null;
  provider: string | null;
  providerRequestId: string | null;
  status: "ok" | "no-results" | "failed" | "unsupported" | "partial";
  /** Short excerpt; full fetched text is not persisted. */
  snippet: string | null;
  sha256: string | null;
  contentType: string | null;
  truncated: boolean;
  error: string | null;
  accessedAt: string;
  results?: { title: string; url: string; snippet: string }[];
}

export const WEB_SEARCH_PROVIDERS = ["brave", "tavily", "searxng"] as const;
export type WebSearchProvider = (typeof WEB_SEARCH_PROVIDERS)[number];

export interface WebSearchStatus {
  provider: WebSearchProvider | null;
  endpoint: string | null;
  configured: boolean;
  source: "environment" | "settings" | null;
  revision: number;
}

export const webSearchConfigSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    provider: z.enum(WEB_SEARCH_PROVIDERS).nullable(),
    /** SearXNG base URL configured by the Host owner. */
    endpoint: z.string().trim().url().max(2000).nullable().optional(),
    /** Write-only; stored in the credential vault, never returned. */
    apiKey: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
