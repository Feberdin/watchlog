/**
 * Purpose: Minimal Jellyseerr API client for connection tests.
 * Input/Output: Saved Jellyseerr URL/API key produce a status response.
 * Invariants: API keys are only sent in headers and never returned or logged.
 * Debugging: Use /api/settings/jellyseerr/test; connection errors usually mean URL or container networking is wrong.
 */

import { fetchJson, normalizeBaseUrl } from "./integrationHttp.js";

type JellyseerrStatus = {
  version?: string;
  commitTag?: string;
  updateAvailable?: boolean;
};

export type JellyseerrConnectionResult = {
  version: string | null;
  commitTag: string | null;
  updateAvailable: boolean | null;
};

export async function testJellyseerrConnection(baseUrl: string, apiKey: string | null | undefined): Promise<JellyseerrConnectionResult> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl, "Jellyseerr");
  if (!apiKey) {
    throw new Error("Jellyseerr: API-Key fehlt. Bitte in den Integrationen speichern.");
  }

  const status = await fetchJson<JellyseerrStatus>("Jellyseerr", `${normalizedBaseUrl}/api/v1/status`, {
    headers: { "X-Api-Key": apiKey },
  });

  return {
    version: status.version ?? null,
    commitTag: status.commitTag ?? null,
    updateAvailable: typeof status.updateAvailable === "boolean" ? status.updateAvailable : null,
  };
}
