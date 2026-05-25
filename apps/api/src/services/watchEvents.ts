/**
 * Purpose: Convert normalized webhook and manual inputs into durable WatchEvent records.
 * Input/Output: Services receive trusted normalized data and write Media, PlaybackSession, and WatchEvent rows.
 * Invariants: Existing WatchEvents are not overwritten; dedupe only suppresses near-identical webhook repeats.
 * Debugging: Check PlaybackSession rows first, then WatchEvent rows filtered by userId/mediaId/watchedAt.
 */

import type { PrismaClient, WatchEvent } from "@prisma/client";
import { DEFAULT_DEDUPE_WINDOW_MINUTES, DEFAULT_EPISODE_THRESHOLD_PERCENT, DEFAULT_MOVIE_THRESHOLD_PERCENT } from "@watchlog/shared";
import type { ManualWatchEventInput } from "@watchlog/shared";
import { sha256 } from "../utils/crypto.js";
import type { NormalizedJellyfinWebhook } from "../webhooks/jellyfinParser.js";

export type WatchEventServiceOptions = {
  movieThresholdPercent?: number;
  episodeThresholdPercent?: number;
  dedupeWindowMinutes?: number;
};

function thresholdFor(event: NormalizedJellyfinWebhook, options: WatchEventServiceOptions): number {
  return event.itemType === "Episode"
    ? options.episodeThresholdPercent ?? DEFAULT_EPISODE_THRESHOLD_PERCENT
    : options.movieThresholdPercent ?? DEFAULT_MOVIE_THRESHOLD_PERCENT;
}

function shouldCreateWatchEvent(event: NormalizedJellyfinWebhook, options: WatchEventServiceOptions): boolean {
  if (event.playedToCompletion || event.played) {
    return true;
  }

  return event.progressPercent != null && event.progressPercent >= thresholdFor(event, options);
}

async function nextRewatchIndex(prisma: PrismaClient, userId: string, mediaId: string): Promise<number> {
  const latest = await prisma.watchEvent.findFirst({
    where: { userId, mediaId },
    orderBy: { rewatchIndex: "desc" },
  });

  return (latest?.rewatchIndex ?? 0) + 1;
}

function parseManualWatchedAt(value: string | null | undefined, precision: ManualWatchEventInput["datePrecision"]): Date | null {
  if (!value || precision === "unknown") {
    return null;
  }

  const normalized = value.trim();
  const expanded = precision === "year" && /^\d{4}$/.test(normalized)
    ? `${normalized}-01-01T00:00:00.000Z`
    : precision === "month" && /^\d{4}-\d{2}$/.test(normalized)
      ? `${normalized}-01T00:00:00.000Z`
      : precision === "date" && /^\d{4}-\d{2}-\d{2}$/.test(normalized)
        ? `${normalized}T00:00:00.000Z`
        : normalized;
  const parsed = new Date(expanded);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Ungueltiges gesehen-Datum "${value}". Nutze ISO-Datum, Jahr oder leer.`);
  }

  return parsed;
}

export async function handleJellyfinWebhookEvent(
  prisma: PrismaClient,
  event: NormalizedJellyfinWebhook,
  options: WatchEventServiceOptions = {},
): Promise<{ created: boolean; ignoredReason?: string; watchEvent?: WatchEvent }> {
  if (event.itemType === "Other") {
    return { created: false, ignoredReason: "Medientyp wird im MVP ignoriert." };
  }

  const user = await prisma.user.findFirst({ where: { jellyfinUserId: event.jellyfinUserId } });
  if (!user) {
    return { created: false, ignoredReason: "Kein WatchLog-Benutzer fuer Jellyfin-UserId gefunden." };
  }

  const media = await prisma.media.upsert({
    where: { jellyfinItemId: event.itemId },
    update: {
      title: event.title,
      year: event.year,
      overview: event.overview,
      runtimeSeconds: event.runtimeSeconds,
      tmdbId: event.tmdbId,
      imdbId: event.imdbId,
      tvdbId: event.tvdbId,
      jellyfinSeriesId: event.seriesId,
      seasonNumber: event.seasonNumber,
      episodeNumber: event.episodeNumber,
      metadataSource: "jellyfin",
    },
    create: {
      type: event.itemType === "Episode" ? "episode" : "movie",
      title: event.title,
      year: event.year,
      overview: event.overview,
      runtimeSeconds: event.runtimeSeconds,
      tmdbId: event.tmdbId,
      imdbId: event.imdbId,
      tvdbId: event.tvdbId,
      jellyfinItemId: event.itemId,
      jellyfinSeriesId: event.seriesId,
      seasonNumber: event.seasonNumber,
      episodeNumber: event.episodeNumber,
      metadataSource: "jellyfin",
    },
  });

  await prisma.playbackSession.create({
    data: {
      userId: user.id,
      jellyfinUserId: event.jellyfinUserId,
      jellyfinItemId: event.itemId,
      mediaId: media.id,
      playSessionId: event.playSessionId,
      sessionId: event.sessionId,
      notificationType: event.notificationType,
      startedAt: event.notificationType === "PlaybackStart" ? event.timestamp : null,
      lastProgressAt: event.notificationType === "PlaybackProgress" ? event.timestamp : null,
      stoppedAt: event.notificationType === "PlaybackStop" ? event.timestamp : null,
      progressPercent: event.progressPercent,
      completed: event.playedToCompletion || event.played,
      clientName: event.clientName,
      deviceName: event.deviceName,
      rawHash: sha256(JSON.stringify(event.rawForHash)),
    },
  });

  if (!shouldCreateWatchEvent(event, options)) {
    return { created: false, ignoredReason: "Fortschritt liegt unterhalb der Schwelle." };
  }

  const dedupeWindowMs = (options.dedupeWindowMinutes ?? DEFAULT_DEDUPE_WINDOW_MINUTES) * 60 * 1000;
  const from = new Date(event.timestamp.getTime() - dedupeWindowMs);
  const to = new Date(event.timestamp.getTime() + dedupeWindowMs);
  const duplicate = await prisma.watchEvent.findFirst({
    where: {
      userId: user.id,
      mediaId: media.id,
      source: "jellyfin",
      watchedAt: { gte: from, lte: to },
    },
  });

  if (duplicate) {
    return { created: false, ignoredReason: "Doppelter Webhook innerhalb des Dedupe-Fensters." };
  }

  const watchEvent = await prisma.watchEvent.create({
    data: {
      userId: user.id,
      mediaId: media.id,
      source: "jellyfin",
      watchedAt: event.timestamp,
      datePrecision: "exact",
      stoppedAt: event.notificationType === "PlaybackStop" ? event.timestamp : null,
      durationSeconds: event.positionSeconds,
      progressPercent: event.progressPercent,
      completed: true,
      rewatchIndex: await nextRewatchIndex(prisma, user.id, media.id),
      clientName: event.clientName,
      deviceName: event.deviceName,
      jellyfinSessionId: event.sessionId,
      jellyfinPlaySessionId: event.playSessionId,
    },
  });

  return { created: true, watchEvent };
}

export async function createManualWatchEvent(
  prisma: PrismaClient,
  userId: string,
  input: ManualWatchEventInput,
): Promise<WatchEvent> {
  const media = input.mediaId
    ? await prisma.media.findUniqueOrThrow({ where: { id: input.mediaId } })
    : await prisma.media.create({
      data: {
        type: input.media!.type,
        title: input.media!.title,
        year: input.media!.year ?? null,
        tmdbId: input.media!.tmdbId ?? null,
        imdbId: input.media!.imdbId ?? null,
        jellyfinItemId: input.media!.jellyfinItemId ?? null,
        overview: input.media!.overview ?? null,
        runtimeSeconds: input.media!.runtimeSeconds ?? null,
        posterUrl: input.media!.posterUrl ?? null,
        metadataSource: input.media!.tmdbId ? "tmdb" : "manual",
      },
    });

  const watchedAt = parseManualWatchedAt(input.watchedAt, input.datePrecision);

  return prisma.watchEvent.create({
    data: {
      userId,
      mediaId: media.id,
      source: "manual",
      watchedAt,
      datePrecision: input.datePrecision,
      completed: true,
      rewatchIndex: await nextRewatchIndex(prisma, userId, media.id),
      note: input.note ?? null,
      rating: input.rating ?? null,
    },
  });
}
