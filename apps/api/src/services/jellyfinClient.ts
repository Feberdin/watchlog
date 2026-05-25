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

type JellyfinItemsResponse = {
  Items?: JellyfinWatchedItem[];
  TotalRecordCount?: number;
};

export type JellyfinWatchedItem = {
  Id?: string;
  Name?: string;
  Type?: string;
  ProductionYear?: number;
  Overview?: string;
  RunTimeTicks?: number;
  ProviderIds?: Record<string, string | undefined>;
  SeriesId?: string;
  SeriesName?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  ImageTags?: Record<string, string | undefined>;
  UserData?: {
    Played?: boolean;
    LastPlayedDate?: string;
    PlayCount?: number;
  };
};

export type JellyfinConnectionResult = {
  serverName: string | null;
  version: string | null;
  id: string | null;
  users: Array<{ id: string; name: string }>;
};

export async function listJellyfinUsers(baseUrl: string, apiKey: string | null | undefined): Promise<Array<{ id: string; name: string }>> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl, "Jellyfin");
  const users = await fetchJson<JellyfinUser[]>("Jellyfin", `${normalizedBaseUrl}/Users`, { headers: jellyfinHeaders(apiKey) });
  return users
    .filter((user): user is { Id: string; Name: string } => Boolean(user.Id && user.Name))
    .map((user) => ({ id: user.Id, name: user.Name }));
}

export async function testJellyfinConnection(baseUrl: string, apiKey: string | null | undefined): Promise<JellyfinConnectionResult> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl, "Jellyfin");
  if (!apiKey) {
    throw new Error("Jellyfin: API-Key fehlt. Bitte in den Integrationen speichern.");
  }

  const headers = { "X-Emby-Token": apiKey };
  const info = await fetchJson<JellyfinSystemInfo>("Jellyfin", `${normalizedBaseUrl}/System/Info`, { headers });
  const users = await listJellyfinUsers(baseUrl, apiKey);

  return {
    serverName: info.ServerName ?? null,
    version: info.Version ?? null,
    id: info.Id ?? null,
    users,
  };
}

function jellyfinHeaders(apiKey: string | null | undefined): Record<string, string> {
  if (!apiKey) {
    throw new Error("Jellyfin: API-Key fehlt. Bitte in den Integrationen speichern.");
  }

  return { "X-Emby-Token": apiKey };
}

export function ticksToSeconds(ticks: number | null | undefined): number | null {
  if (typeof ticks !== "number" || !Number.isFinite(ticks) || ticks <= 0) {
    return null;
  }

  return Math.round(ticks / 10_000_000);
}

export function jellyfinPrimaryImageUrl(baseUrl: string, item: JellyfinWatchedItem): string | null {
  if (!item.Id) {
    return null;
  }

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl, "Jellyfin");
  if (item.ImageTags?.Primary) {
    return `${normalizedBaseUrl}/Items/${encodeURIComponent(item.Id)}/Images/Primary?tag=${encodeURIComponent(item.ImageTags.Primary)}`;
  }

  return `${normalizedBaseUrl}/Items/${encodeURIComponent(item.Id)}/Images/Primary`;
}

export async function listWatchedJellyfinItems(
  baseUrl: string,
  apiKey: string | null | undefined,
  jellyfinUserId: string,
): Promise<JellyfinWatchedItem[]> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl, "Jellyfin");
  const headers = jellyfinHeaders(apiKey);
  const limit = 200;
  const items: JellyfinWatchedItem[] = [];

  for (let startIndex = 0; startIndex < 10_000; startIndex += limit) {
    const url = new URL(`${normalizedBaseUrl}/Users/${encodeURIComponent(jellyfinUserId)}/Items`);
    url.searchParams.set("Recursive", "true");
    url.searchParams.set("IncludeItemTypes", "Movie,Episode");
    url.searchParams.set("Filters", "IsPlayed");
    url.searchParams.set("Fields", "ProviderIds,Overview,RunTimeTicks,UserData,ProductionYear,SeriesName,SeriesId,ParentIndexNumber,IndexNumber,ImageTags");
    url.searchParams.set("SortBy", "DatePlayed");
    url.searchParams.set("SortOrder", "Descending");
    url.searchParams.set("StartIndex", String(startIndex));
    url.searchParams.set("Limit", String(limit));

    const response = await fetchJson<JellyfinItemsResponse>("Jellyfin", url.toString(), { headers });
    const page = response.Items ?? [];
    items.push(...page);

    const total = response.TotalRecordCount ?? items.length;
    if (page.length < limit || items.length >= total) {
      break;
    }
  }

  return items;
}

export async function listAllJellyfinEpisodes(
  baseUrl: string,
  apiKey: string | null | undefined,
  jellyfinUserId: string,
): Promise<JellyfinWatchedItem[]> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl, "Jellyfin");
  const headers = jellyfinHeaders(apiKey);
  const limit = 300;
  const items: JellyfinWatchedItem[] = [];

  for (let startIndex = 0; startIndex < 20_000; startIndex += limit) {
    const url = new URL(`${normalizedBaseUrl}/Users/${encodeURIComponent(jellyfinUserId)}/Items`);
    url.searchParams.set("Recursive", "true");
    url.searchParams.set("IncludeItemTypes", "Episode");
    url.searchParams.set("Fields", "ProviderIds,Overview,RunTimeTicks,UserData,ProductionYear,SeriesName,SeriesId,ParentIndexNumber,IndexNumber,ImageTags");
    url.searchParams.set("SortBy", "SeriesSortName,ParentIndexNumber,IndexNumber");
    url.searchParams.set("SortOrder", "Ascending");
    url.searchParams.set("StartIndex", String(startIndex));
    url.searchParams.set("Limit", String(limit));

    const response = await fetchJson<JellyfinItemsResponse>("Jellyfin", url.toString(), { headers }, 15_000);
    const page = response.Items ?? [];
    items.push(...page);

    const total = response.TotalRecordCount ?? items.length;
    if (page.length < limit || items.length >= total) {
      break;
    }
  }

  return items;
}

export async function getJellyfinItem(
  baseUrl: string,
  apiKey: string | null | undefined,
  itemId: string,
): Promise<JellyfinWatchedItem | null> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl, "Jellyfin");
  const url = new URL(`${normalizedBaseUrl}/Items/${encodeURIComponent(itemId)}`);
  url.searchParams.set("Fields", "ProviderIds,Overview,RunTimeTicks,ProductionYear,SeriesName,SeriesId,ParentIndexNumber,IndexNumber,ImageTags");

  return fetchJson<JellyfinWatchedItem>("Jellyfin", url.toString(), { headers: jellyfinHeaders(apiKey) });
}

export async function markJellyfinItemPlayed(
  baseUrl: string,
  apiKey: string | null | undefined,
  jellyfinUserId: string,
  itemId: string,
  datePlayed: Date,
): Promise<void> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl, "Jellyfin");
  const url = new URL(`${normalizedBaseUrl}/Users/${encodeURIComponent(jellyfinUserId)}/PlayedItems/${encodeURIComponent(itemId)}`);
  url.searchParams.set("DatePlayed", datePlayed.toISOString());

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: jellyfinHeaders(apiKey),
  });

  if (!response.ok) {
    throw new Error(`Jellyfin: Konnte Medium nicht als gesehen markieren (HTTP ${response.status}). Bitte Jellyfin-UserId und API-Key pruefen.`);
  }
}
