/**
 * Purpose: Normalize Jellyfin Webhook Plugin JSON into WatchLog's internal event shape.
 * Input/Output: Unknown webhook payloads become typed normalized events or validation errors.
 * Invariants: Missing fields are tolerated, empty strings become null, and secrets are never parsed from payloads.
 * Debugging: Use tests in `apps/api/test/jellyfinParser.test.ts` with real sanitized webhook samples.
 */

import { z } from "zod";

const rawWebhookSchema = z.object({
  notification_type: z.unknown().optional(),
  timestamp: z.unknown().optional(),
  utc_timestamp: z.unknown().optional(),
  user: z.object({
    id: z.unknown().optional(),
    name: z.unknown().optional(),
  }).optional(),
  client: z.object({
    name: z.unknown().optional(),
    device_name: z.unknown().optional(),
    device_id: z.unknown().optional(),
  }).optional(),
  item: z.object({
    id: z.unknown().optional(),
    type: z.unknown().optional(),
    name: z.unknown().optional(),
    overview: z.unknown().optional(),
    year: z.unknown().optional(),
    runtime_ticks: z.unknown().optional(),
    tmdb_id: z.unknown().optional(),
    imdb_id: z.unknown().optional(),
    tvdb_id: z.unknown().optional(),
    series_name: z.unknown().optional(),
    series_id: z.unknown().optional(),
    season_number: z.unknown().optional(),
    episode_number: z.unknown().optional(),
  }).optional(),
  playback: z.object({
    position_ticks: z.unknown().optional(),
    played_to_completion: z.unknown().optional(),
    played: z.unknown().optional(),
    play_count: z.unknown().optional(),
    last_played_date: z.unknown().optional(),
  }).optional(),
  session_id: z.unknown().optional(),
  play_session_id: z.unknown().optional(),
}).passthrough();

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
  const notificationType = text(payload.notification_type) ?? "Unknown";
  const itemId = text(payload.item?.id);
  const jellyfinUserId = text(payload.user?.id);
  const title = text(payload.item?.name);

  if (!itemId) {
    throw new Error("Jellyfin webhook enthaelt keine item.id. Bitte Webhook-Template pruefen.");
  }
  if (!jellyfinUserId) {
    throw new Error("Jellyfin webhook enthaelt keine user.id. Bitte Webhook-Template pruefen.");
  }
  if (!title) {
    throw new Error("Jellyfin webhook enthaelt keinen item.name. Bitte Webhook-Template pruefen.");
  }

  const runtimeSeconds = ticksToSeconds(payload.item?.runtime_ticks);
  const positionSeconds = ticksToSeconds(payload.playback?.position_ticks);
  const progressPercent = runtimeSeconds && positionSeconds
    ? Math.min(100, Math.round((positionSeconds / runtimeSeconds) * 10_000) / 100)
    : null;

  return {
    notificationType,
    timestamp: parseDate(payload.utc_timestamp ?? payload.timestamp ?? payload.playback?.last_played_date),
    jellyfinUserId,
    username: text(payload.user?.name),
    itemId,
    itemType: mediaType(payload.item?.type),
    title,
    overview: text(payload.item?.overview),
    year: numberValue(payload.item?.year),
    runtimeSeconds,
    positionSeconds,
    progressPercent,
    playedToCompletion: booleanValue(payload.playback?.played_to_completion),
    played: booleanValue(payload.playback?.played),
    tmdbId: text(payload.item?.tmdb_id),
    imdbId: text(payload.item?.imdb_id),
    tvdbId: text(payload.item?.tvdb_id),
    seriesName: text(payload.item?.series_name),
    seriesId: text(payload.item?.series_id),
    seasonNumber: numberValue(payload.item?.season_number),
    episodeNumber: numberValue(payload.item?.episode_number),
    clientName: text(payload.client?.name),
    deviceName: text(payload.client?.device_name),
    sessionId: text(payload.session_id ?? payload.client?.device_id),
    playSessionId: text(payload.play_session_id),
    rawForHash: payload,
  };
}
