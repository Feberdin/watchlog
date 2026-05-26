/**
 * Purpose: Normalize Jellyfin Webhook Plugin JSON into WatchLog's internal event shape.
 * Input/Output: Unknown webhook payloads become typed normalized events or validation errors.
 * Invariants: Missing fields are tolerated, empty strings become null, and secrets are never parsed from payloads.
 * Debugging: Use tests in `apps/api/test/jellyfinParser.test.ts` with real sanitized webhook samples.
 */

import { z } from "zod";

const rawWebhookSchema = z.object({}).passthrough();

export type NormalizedJellyfinWebhook = {
  notificationType: string;
  timestamp: Date;
  jellyfinUserId: string;
  username: string | null;
  itemId: string;
  itemType: "Movie" | "Episode" | "Other";
  title: string;
  overview: string | null;
  year: number | null;
  runtimeSeconds: number | null;
  positionSeconds: number | null;
  progressPercent: number | null;
  playedToCompletion: boolean;
  played: boolean;
  tmdbId: string | null;
  imdbId: string | null;
  tvdbId: string | null;
  seriesName: string | null;
  seriesId: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  clientName: string | null;
  deviceName: string | null;
  sessionId: string | null;
  playSessionId: string | null;
  rawForHash: unknown;
};

function text(value: unknown): string | null {
  if (typeof value !== "string") {
    return value == null ? null : String(value);
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function numberValue(value: unknown): number | null {
  const asText = text(value);
  if (!asText) {
    return null;
  }

  const parsed = Number(asText);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  const asText = text(value)?.toLowerCase();
  return asText === "true" || asText === "1" || asText === "yes";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function read(source: unknown, ...keys: string[]): unknown {
  if (!isRecord(source)) {
    return undefined;
  }

  for (const key of keys) {
    if (key in source) {
      return source[key];
    }
  }

  return undefined;
}

function readPath(source: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => read(current, key), source);
}

function firstValue(...values: unknown[]): unknown {
  return values.find((value) => text(value) != null);
}

function normalizeNotificationType(value: unknown): string {
  const asText = text(value) ?? "Unknown";
  const lowered = asText.toLowerCase();

  if (lowered === "play") {
    return "PlaybackStart";
  }
  if (lowered === "progress" || lowered === "scrobble") {
    return "PlaybackProgress";
  }
  if (lowered === "stop") {
    return "PlaybackStop";
  }
  if (lowered === "markplayed" || lowered === "markunplayed") {
    return "UserDataSaved";
  }

  return asText;
}

function ticksToSeconds(value: unknown): number | null {
  const ticks = numberValue(value);
  if (ticks == null || ticks <= 0) {
    return null;
  }

  return Math.round(ticks / 10_000_000);
}

function parseDate(value: unknown): Date {
  const asText = text(value);
  if (!asText) {
    return new Date();
  }

  const parsed = new Date(asText);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function mediaType(value: unknown): "Movie" | "Episode" | "Other" {
  const asText = text(value)?.toLowerCase();
  if (asText === "movie") {
    return "Movie";
  }
  if (asText === "episode") {
    return "Episode";
  }
  return "Other";
}

export function parseJellyfinWebhook(input: unknown): NormalizedJellyfinWebhook {
  const payload = rawWebhookSchema.parse(input);
  const item = firstValue(read(payload, "item"), read(payload, "Item"));
  const user = firstValue(read(payload, "user"), read(payload, "User"), read(payload, "Account"));
  const client = firstValue(read(payload, "client"), read(payload, "Client"));
  const session = firstValue(read(payload, "session"), read(payload, "Session"), read(payload, "Player"));
  const playback = firstValue(read(payload, "playback"), read(payload, "Playback"));
  const series = firstValue(read(payload, "series"), read(payload, "Series"));
  const providerIds = firstValue(read(item, "ProviderIds", "providerIds"), readPath(item, ["ProviderIds"]), readPath(item, ["providerIds"]));
  const userData = firstValue(read(item, "UserData", "userData"), readPath(item, ["UserData"]), readPath(item, ["userData"]));
  const notificationType = normalizeNotificationType(firstValue(
    read(payload, "notification_type"),
    read(payload, "notificationType"),
    read(payload, "NotificationType"),
    read(payload, "event"),
    read(payload, "Event"),
  ));
  const itemId = text(firstValue(read(item, "id", "Id"), readPath(payload, ["Metadata", "ratingKey"])));
  const jellyfinUserId = text(read(user, "id", "Id"));
  const title = text(firstValue(read(item, "name", "Name"), read(item, "title", "Title")));

  if (!itemId) {
    throw new Error("Jellyfin webhook enthaelt keine item.id. Bitte Webhook-Template pruefen.");
  }
  if (!jellyfinUserId) {
    throw new Error("Jellyfin webhook enthaelt keine user.id. Bitte Webhook-Template pruefen.");
  }
  if (!title) {
    throw new Error("Jellyfin webhook enthaelt keinen item.name. Bitte Webhook-Template pruefen.");
  }

  const runtimeSeconds = ticksToSeconds(firstValue(
    read(item, "runtime_ticks"),
    read(item, "runtimeTicks"),
    read(item, "RunTimeTicks"),
    read(item, "runTimeTicks"),
  ));
  const positionSeconds = ticksToSeconds(firstValue(
    read(playback, "position_ticks"),
    read(playback, "positionTicks"),
    readPath(session, ["PlayState", "PositionTicks"]),
    readPath(session, ["playState", "positionTicks"]),
  ));
  const progressPercent = runtimeSeconds && positionSeconds
    ? Math.min(100, Math.round((positionSeconds / runtimeSeconds) * 10_000) / 100)
    : null;
  const pluginEvent = text(firstValue(read(payload, "Event"), read(payload, "event")))?.toLowerCase();
  const eventMeansPlayed = pluginEvent === "scrobble" || pluginEvent === "markplayed";

  return {
    notificationType,
    timestamp: parseDate(firstValue(
      read(payload, "utc_timestamp"),
      read(payload, "utcTimestamp"),
      read(payload, "timestamp"),
      read(payload, "Timestamp"),
      read(playback, "last_played_date"),
      read(playback, "lastPlayedDate"),
      read(userData, "LastPlayedDate"),
      read(userData, "lastPlayedDate"),
    )),
    jellyfinUserId,
    username: text(read(user, "name", "Name", "username", "Username", "title", "Title")),
    itemId,
    itemType: mediaType(read(item, "type", "Type")),
    title,
    overview: text(read(item, "overview", "Overview")),
    year: numberValue(firstValue(read(item, "year"), read(item, "Year"), read(item, "productionYear"), read(item, "ProductionYear"))),
    runtimeSeconds,
    positionSeconds,
    progressPercent,
    playedToCompletion: booleanValue(firstValue(read(playback, "played_to_completion"), read(playback, "playedToCompletion"))) || eventMeansPlayed,
    played: booleanValue(firstValue(read(playback, "played"), read(playback, "Played"), read(userData, "Played"), read(userData, "played"))) || eventMeansPlayed,
    tmdbId: text(firstValue(read(item, "tmdb_id"), read(item, "tmdbId"), read(providerIds, "Tmdb", "tmdb", "TMDb"))),
    imdbId: text(firstValue(read(item, "imdb_id"), read(item, "imdbId"), read(providerIds, "Imdb", "imdb", "IMDb"))),
    tvdbId: text(firstValue(read(item, "tvdb_id"), read(item, "tvdbId"), read(providerIds, "Tvdb", "tvdb", "TVDb"))),
    seriesName: text(firstValue(read(item, "series_name"), read(item, "seriesName", "SeriesName"), read(series, "name", "Name"))),
    seriesId: text(firstValue(read(item, "series_id"), read(item, "seriesId", "SeriesId"), read(series, "id", "Id"))),
    seasonNumber: numberValue(firstValue(read(item, "season_number"), read(item, "seasonNumber"), read(item, "ParentIndexNumber", "parentIndexNumber"))),
    episodeNumber: numberValue(firstValue(read(item, "episode_number"), read(item, "episodeNumber"), read(item, "IndexNumber", "indexNumber"))),
    clientName: text(firstValue(read(client, "name"), read(session, "Client", "client"), read(session, "title", "Title"))),
    deviceName: text(firstValue(read(client, "device_name"), read(client, "deviceName"), read(session, "DeviceName", "deviceName"))),
    sessionId: text(firstValue(read(payload, "session_id"), read(payload, "sessionId"), read(session, "Id", "id"), read(client, "device_id"), read(client, "deviceId"))),
    playSessionId: text(firstValue(read(payload, "play_session_id"), read(payload, "playSessionId"))),
    rawForHash: payload,
  };
}
