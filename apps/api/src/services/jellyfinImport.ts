/**
 * Purpose: Import Jellyfin's current watched state into durable WatchLog media and events.
 * Input/Output: A mapped WatchLog user plus Jellyfin settings produce Media and WatchEvent rows.
 * Invariants: Imports are explicit, idempotent per item/date marker, and never overwrite existing watch history.
 * Debugging: If counts are lower than Jellyfin, verify the local user's jellyfinUserId and Jellyfin API permissions.
 */

import type { PrismaClient, User } from "@prisma/client";
import type { JellyfinWatchedImportResult } from "@watchlog/shared";
import {
  getJellyfinItem,
  jellyfinPrimaryImageUrl,
  listJellyfinUsers,
  listWatchedJellyfinItems,
  ticksToSeconds,
  type JellyfinWatchedItem,
} from "./jellyfinClient.js";
import { getSetting } from "./settings.js";
import { nextRewatchIndex } from "./watchEvents.js";

const jellyfinDefaults = {
  jellyfinBaseUrl: null,
  jellyfinApiKey: null,
  enabledUserIds: [] as string[],
  syncBackEnabled: false,
  watchedThresholdMoviePercent: 90,
  watchedThresholdEpisodePercent: 90,
};

type ImportCounters = {
  totalItems: number;
  imported: number;
  skipped: number;
  failed: number;
};

type SeriesCache = Map<string, { id: string; title: string; posterUrl: string | null }>;

function providerId(item: JellyfinWatchedItem, key: string): string | null {
  const value = item.ProviderIds?.[key] ?? item.ProviderIds?.[key.toLowerCase()] ?? item.ProviderIds?.[key.toUpperCase()];
  return value && value.trim() ? value.trim() : null;
}

function parseLastPlayedDate(item: JellyfinWatchedItem): Date | null {
  const raw = item.UserData?.LastPlayedDate;
  if (!raw) {
    return null;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function importMarker(item: JellyfinWatchedItem, watchedAt: Date | null): string {
  return `jellyfin-import:${item.Id ?? "unknown"}:${watchedAt?.toISOString() ?? "unknown"}`;
}

function sameWatchedAtFilter(watchedAt: Date | null) {
  return watchedAt ? { watchedAt } : { watchedAt: null };
}

function mediaTypeFromJellyfin(item: JellyfinWatchedItem): "movie" | "episode" | null {
  if (item.Type === "Movie") {
    return "movie";
  }

  if (item.Type === "Episode") {
    return "episode";
  }

  return null;
}

async function importOneWatchedItem(
  prisma: PrismaClient,
  user: User,
  baseUrl: string,
  apiKey: string | null | undefined,
  item: JellyfinWatchedItem,
  seriesCache: SeriesCache,
): Promise<"imported" | "skipped" | "failed"> {
  const mediaType = mediaTypeFromJellyfin(item);
  if (!item.Id || !item.Name || !mediaType || item.UserData?.Played !== true) {
    return "skipped";
  }

  const itemDetails = mediaType === "episode" && (!item.SeriesId || !item.SeriesName)
    ? await getJellyfinItem(baseUrl, apiKey, item.Id).catch(() => null)
    : null;
  const seriesId = item.SeriesId ?? itemDetails?.SeriesId ?? null;
  const seriesName = item.SeriesName ?? itemDetails?.SeriesName ?? null;
  const seasonNumber = item.ParentIndexNumber ?? itemDetails?.ParentIndexNumber ?? null;
  const episodeNumber = item.IndexNumber ?? itemDetails?.IndexNumber ?? null;
  const posterUrl = jellyfinPrimaryImageUrl(baseUrl, item) ?? (itemDetails ? jellyfinPrimaryImageUrl(baseUrl, itemDetails) : null);

  let parentMediaId: string | null = null;
  let seriesTitle: string | null = null;
  if (mediaType === "episode" && seriesId) {
    const cachedSeries = seriesCache.get(seriesId);
    let series = cachedSeries;
    if (!series) {
      const seriesItem = await getJellyfinItem(baseUrl, apiKey, seriesId).catch(() => null);
      series = {
        id: seriesId,
        title: seriesItem?.Name ?? seriesName ?? "Unbekannte Serie",
        posterUrl: seriesItem ? jellyfinPrimaryImageUrl(baseUrl, seriesItem) : null,
      };
      seriesCache.set(seriesId, series);
    }

    seriesTitle = series.title;
    const parent = await prisma.media.upsert({
      where: { jellyfinItemId: series.id },
      update: {
        title: series.title,
        posterUrl: series.posterUrl,
        metadataSource: "jellyfin",
        metadataLastSyncedAt: new Date(),
      },
      create: {
        type: "show",
        title: series.title,
        jellyfinItemId: series.id,
        posterUrl: series.posterUrl,
        metadataSource: "jellyfin",
        metadataLastSyncedAt: new Date(),
      },
    });
    parentMediaId = parent.id;
  }

  const watchedAt = parseLastPlayedDate(item);
  const marker = importMarker(item, watchedAt);
  const media = await prisma.media.upsert({
    where: { jellyfinItemId: item.Id },
    update: {
      title: item.Name,
      year: item.ProductionYear ?? null,
      overview: item.Overview ?? null,
      runtimeSeconds: ticksToSeconds(item.RunTimeTicks),
      tmdbId: providerId(item, "Tmdb"),
      imdbId: providerId(item, "Imdb"),
      tvdbId: providerId(item, "Tvdb"),
      jellyfinSeriesId: seriesId,
      originalTitle: seriesTitle,
      parentMediaId,
      seasonNumber,
      episodeNumber,
      posterUrl,
      metadataSource: "jellyfin",
      metadataLastSyncedAt: new Date(),
    },
    create: {
      type: mediaType,
      title: item.Name,
      year: item.ProductionYear ?? null,
      overview: item.Overview ?? null,
      runtimeSeconds: ticksToSeconds(item.RunTimeTicks),
      tmdbId: providerId(item, "Tmdb"),
      imdbId: providerId(item, "Imdb"),
      tvdbId: providerId(item, "Tvdb"),
      jellyfinItemId: item.Id,
      jellyfinSeriesId: seriesId,
      originalTitle: seriesTitle,
      parentMediaId,
      seasonNumber,
      episodeNumber,
      posterUrl,
      metadataSource: "jellyfin",
      metadataLastSyncedAt: new Date(),
    },
  });

  const existing = await prisma.watchEvent.findFirst({
    where: {
      userId: user.id,
      mediaId: media.id,
      source: "jellyfin",
      ...sameWatchedAtFilter(watchedAt),
    },
  });
  if (existing) {
    return "skipped";
  }

  await prisma.watchEvent.create({
    data: {
      userId: user.id,
      mediaId: media.id,
      source: "jellyfin",
      watchedAt,
      datePrecision: watchedAt ? "exact" : "unknown",
      completed: true,
      rewatchIndex: await nextRewatchIndex(prisma, user.id, media.id),
      jellyfinPlaySessionId: marker,
      note: watchedAt
        ? "Aus Jellyfin-Played-Status importiert."
        : "Aus Jellyfin-Played-Status importiert; Jellyfin lieferte kein LastPlayedDate.",
    },
  });

  return "imported";
}

async function resolveJellyfinUserId(
  baseUrl: string,
  apiKey: string | null | undefined,
  savedUserValue: string,
): Promise<{ id: string; wasNameMatch: boolean }> {
  const users = await listJellyfinUsers(baseUrl, apiKey);
  const normalized = savedUserValue.trim().toLowerCase();
  const byId = users.find((candidate) => candidate.id.toLowerCase() === normalized);
  if (byId) {
    return { id: byId.id, wasNameMatch: false };
  }

  const byName = users.filter((candidate) => candidate.name.toLowerCase() === normalized);
  const uniqueNameMatch = byName[0];
  if (byName.length === 1 && uniqueNameMatch) {
    return { id: uniqueNameMatch.id, wasNameMatch: true };
  }

  if (byName.length > 1) {
    throw new Error(`Jellyfin-Benutzername "${savedUserValue}" ist nicht eindeutig. Waehle bitte die konkrete Jellyfin-UserId aus.`);
  }

  throw new Error(`Jellyfin-Benutzer "${savedUserValue}" wurde nicht gefunden. Waehle unter Integrationen einen Benutzer aus der Jellyfin-Liste.`);
}

export async function importWatchedFromJellyfin(prisma: PrismaClient, user: User): Promise<JellyfinWatchedImportResult> {
  if (!user.jellyfinUserId) {
    throw new Error("Dein WatchLog-Benutzer hat keine Jellyfin-UserId. Trage sie unter Integrationen ein und starte den Import erneut.");
  }

  const settings = await getSetting(prisma, "jellyfin", jellyfinDefaults);
  if (!settings.jellyfinBaseUrl) {
    throw new Error("Jellyfin URL fehlt. Bitte zuerst die Broker-Secrets oder Integrationseinstellungen pruefen.");
  }

  const resolvedUser = await resolveJellyfinUserId(settings.jellyfinBaseUrl, settings.jellyfinApiKey, user.jellyfinUserId);
  if (resolvedUser.wasNameMatch) {
    await prisma.user.update({
      where: { id: user.id },
      data: { jellyfinUserId: resolvedUser.id },
    });
  }

  const items = await listWatchedJellyfinItems(settings.jellyfinBaseUrl, settings.jellyfinApiKey, resolvedUser.id);
  const counters: ImportCounters = { totalItems: items.length, imported: 0, skipped: 0, failed: 0 };
  const seriesCache: SeriesCache = new Map();

  const job = await prisma.importJob.create({
    data: {
      userId: user.id,
      source: "jellyfin",
      status: "running",
      totalRows: items.length,
    },
  });

  for (const item of items) {
    try {
      const result = await importOneWatchedItem(prisma, user, settings.jellyfinBaseUrl, settings.jellyfinApiKey, item, seriesCache);
      counters[result] += 1;
    } catch {
      counters.failed += 1;
    }
  }

  await prisma.importJob.update({
    where: { id: job.id },
    data: {
      status: counters.failed > 0 ? "completed_with_errors" : "completed",
      successRows: counters.imported,
      failedRows: counters.failed,
      errorSummary: counters.failed > 0 ? `${counters.failed} Jellyfin-Eintraege konnten nicht importiert werden. Details stehen im Serverlog mit Request-ID.` : null,
      finishedAt: new Date(),
    },
  });

  return {
    ok: true,
    source: "jellyfin",
    userId: user.id,
    jellyfinUserId: resolvedUser.id,
    ...counters,
    message: `${counters.imported} gesehen(e) Jellyfin-Eintraege importiert, ${counters.skipped} uebersprungen, ${counters.failed} fehlgeschlagen.`,
  };
}
