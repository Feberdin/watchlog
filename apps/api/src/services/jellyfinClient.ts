/**
 * Purpose: Minimal Jellyfin API client for connection tests and user discovery.
 * Input/Output: Saved Jellyfin URL/API key produce server info and users.
 * Invariants: API keys are only sent in headers and never returned or logged.
 * Debugging: Use /api/settings/jellyfin/test; 401 usually means an invalid Jellyfin API key.
 */

import { fetchJson, normalizeBaseUrl } from "./integrationHttp.js";

type JellyfinSystemInfo = {
  ServerName?: string;
  Version?: string;
  Id?: string;
};

type JellyfinUser = {
  Id?: string;
  Name?: string;
};

export type JellyfinConnectionResult = {
  serverName: string | null;
  version: string | null;
  id: string | null;
  users: Array<{ id: string; name: string }>;
};

export async function testJellyfinConnection(baseUrl: string, apiKey: string | null | undefined): Promise<JellyfinConnectionResult> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl, "Jellyfin");
  if (!apiKey) {
    throw new Error("Jellyfin: API-Key fehlt. Bitte in den Integrationen speichern.");
  }

  const headers = { "X-Emby-Token": apiKey };
  const info = await fetchJson<JellyfinSystemInfo>("Jellyfin", `${normalizedBaseUrl}/System/Info`, { headers });
  const users = await fetchJson<JellyfinUser[]>("Jellyfin", `${normalizedBaseUrl}/Users`, { headers });

  return {
    serverName: info.ServerName ?? null,
    version: info.Version ?? null,
    id: info.Id ?? null,
    users: users
      .filter((user): user is { Id: string; Name: string } => Boolean(user.Id && user.Name))
      .map((user) => ({ id: user.Id, name: user.Name })),
  };
}
