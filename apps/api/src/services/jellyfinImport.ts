/**
 * Purpose: Import Jellyfin's current watched state into durable WatchLog media and events.
 * Input/Output: A mapped WatchLog user plus Jellyfin settings produce Media and WatchEvent rows.
 * Invariants: Imports are explicit, idempotent per item/date marker, and never overwrite existing watch history.
 * Debugging: If counts are lower than Jellyfin, verify the local user's jellyfinUserId and Jellyfin API permissions.
 */

import type { PrismaClient, User } from "@prisma/client";
import type { JellyfinWatchedImportResult } from "@watchlog/shared";
import {
  jellyfinPrimaryImageUrl,
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
  item: JellyfinWatchedItem,
): Promise<"imported" | "skipped" | "failed"> {
  const mediaType = mediaTypeFromJellyfin(item);
  if (!item.Id || !item.Name || !mediaType || item.UserData?.Played !== true) {
    return "skipped";
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
      jellyfinSeriesId: item.SeriesId ?? null,
      seasonNumber: item.ParentIndexNumber ?? null,
      episodeNumber: item.IndexNumber ?? null,
      posterUrl: jellyfinPrimaryImageUrl(baseUrl, item),
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
      jellyfinSeriesId: item.SeriesId ?? null,
      seasonNumber: item.ParentIndexNumber ?? null,
      episodeNumber: item.IndexNumber ?? null,
      posterUrl: jellyfinPrimaryImageUrl(baseUrl, item),
      metadataSource: "jellyfin",
      metadataLastSyncedAt: new Date(),
    },
  });

  const existing = await prisma.watchEvent.findFirst({
    where: {
      userId: user.id,
      mediaId: media.id,
      jellyfinPlaySessionId: marker,
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

export async function importWatchedFromJellyfin(prisma: PrismaClient, user: User): Promise<JellyfinWatchedImportResult> {
  if (!user.jellyfinUserId) {
    throw new Error("Dein WatchLog-Benutzer hat keine Jellyfin-UserId. Trage sie unter Integrationen ein und starte den Import erneut.");
  }

  const settings = await getSetting(prisma, "jellyfin", jellyfinDefaults);
  if (!settings.jellyfinBaseUrl) {
    throw new Error("Jellyfin URL fehlt. Bitte zuerst die Broker-Secrets oder Integrationseinstellungen pruefen.");
  }

  const items = await listWatchedJellyfinItems(settings.jellyfinBaseUrl, settings.jellyfinApiKey, user.jellyfinUserId);
  const counters: ImportCounters = { totalItems: items.length, imported: 0, skipped: 0, failed: 0 };

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
      const result = await importOneWatchedItem(prisma, user, settings.jellyfinBaseUrl, item);
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
    jellyfinUserId: user.jellyfinUserId,
    ...counters,
    message: `${counters.imported} gesehen(e) Jellyfin-Eintraege importiert, ${counters.skipped} uebersprungen, ${counters.failed} fehlgeschlagen.`,
  };
}
