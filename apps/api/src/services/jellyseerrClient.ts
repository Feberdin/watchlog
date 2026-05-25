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

export type JellyseerrRequestResult = {
  accepted: boolean;
  alreadyRequested: boolean;
};

type JellyseerrTvDetail = {
  seasons?: Array<{
    seasonNumber?: number;
    status?: number;
  }>;
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

async function responseErrorMessage(serviceName: string, response: Response): Promise<string> {
  const fallback = `${serviceName}: Request konnte nicht angelegt werden (HTTP ${response.status}). Bitte Jellyseerr-Regeln, Sonarr/Radarr-Zuordnung und API-Key pruefen.`;

  try {
    const body = await response.json() as { message?: unknown; error?: unknown; errorMessage?: unknown };
    const detail = [body.message, body.errorMessage, body.error].find((value) => typeof value === "string" && value.trim().length > 0);
    return detail ? `${fallback} Detail: ${detail}` : fallback;
  } catch {
    return fallback;
  }
}

async function jellyseerrRequestBody(
  normalizedBaseUrl: string,
  apiKey: string,
  mediaType: "movie" | "tv",
  tmdbId: number,
): Promise<{ mediaType: "movie" | "tv"; mediaId: number; seasons?: number[] }> {
  if (mediaType === "movie") {
    return { mediaType, mediaId: tmdbId };
  }

  const detail = await fetchJson<JellyseerrTvDetail>("Jellyseerr", `${normalizedBaseUrl}/api/v1/tv/${tmdbId}`, {
    headers: { "X-Api-Key": apiKey },
  });
  const seasons = (detail.seasons ?? [])
    .map((season) => season.seasonNumber)
    .filter((seasonNumber): seasonNumber is number => typeof seasonNumber === "number" && seasonNumber > 0);

  if (seasons.length === 0) {
    throw new Error("Jellyseerr: Fuer diese Serie wurden keine anfragbaren Staffeln gefunden. Bitte in Jellyseerr pruefen, ob die Serie bereits vorhanden ist oder Sonarr die Serie matchen kann.");
  }

  return { mediaType, mediaId: tmdbId, seasons };
}

export async function requestJellyseerrMedia(
  baseUrl: string,
  apiKey: string | null | undefined,
  mediaType: "movie" | "tv",
  tmdbId: number,
): Promise<JellyseerrRequestResult> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl, "Jellyseerr");
  if (!apiKey) {
    throw new Error("Jellyseerr: API-Key fehlt. Bitte in den Integrationen speichern.");
  }

  const body = await jellyseerrRequestBody(normalizedBaseUrl, apiKey, mediaType, tmdbId);
  const response = await fetch(`${normalizedBaseUrl}/api/v1/request`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "X-Api-Key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (response.status === 409) {
    return { accepted: true, alreadyRequested: true };
  }

  if (!response.ok) {
    throw new Error(await responseErrorMessage("Jellyseerr", response));
  }

  return { accepted: true, alreadyRequested: false };
}
