/**
 * Purpose: Keep a local Jellyfin series catalog and expose season/episode progress.
 * Input/Output: Jellyfin episode lists become Media rows; Media rows become UI-friendly series trees.
 * Invariants: Syncing catalog never deletes local history and only creates WatchEvents for Jellyfin-played episodes.
 * Debugging: If a series has no episodes, run the catalog sync and inspect Media rows with type `episode`.
 */

import type { PrismaClient, User } from "@prisma/client";
import type { SeriesCatalogItem } from "@watchlog/shared";
import {
  getJellyfinItem,
  jellyfinPrimaryImageUrl,
  listAllJellyfinEpisodes,
  listJellyfinUsers,
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

function providerId(item: JellyfinWatchedItem, key: string): string | null {
  const value = item.ProviderIds?.[key] ?? item.ProviderIds?.[key.toLowerCase()] ?? item.ProviderIds?.[key.toUpperCase()];
  return value && value.trim() ? value.trim() : null;
}

function parsedLastPlayedAt(item: JellyfinWatchedItem): Date | null {
  const raw = item.UserData?.LastPlayedDate;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function resolveJellyfinUserId(baseUrl: string, apiKey: string | null | undefined, savedUserValue: string): Promise<string> {
  const users = await listJellyfinUsers(baseUrl, apiKey);
  const normalized = savedUserValue.trim().toLowerCase();
  const byId = users.find((candidate) => candidate.id.toLowerCase() === normalized);
  if (byId) return byId.id;
  const byName = users.find((candidate) => candidate.name.toLowerCase() === normalized);
  if (byName) return byName.id;
  throw new Error(`Jellyfin-Benutzer "${savedUserValue}" wurde nicht gefunden. Bitte unter Integrationen den Benutzer neu auswaehlen.`);
}

async function upsertEpisodeFromJellyfin(
  prisma: PrismaClient,
  user: User,
  baseUrl: string,
  apiKey: string | null | undefined,
  item: JellyfinWatchedItem,
) {
  if (!item.Id || !item.Name) return;
  const itemDetails = !item.SeriesId || !item.SeriesName ? await getJellyfinItem(baseUrl, apiKey, item.Id).catch(() => null) : null;
  const seriesId = item.SeriesId ?? itemDetails?.SeriesId ?? null;
  if (!seriesId) return;

  const seriesItem = await getJellyfinItem(baseUrl, apiKey, seriesId).catch(() => null);
  const seriesTitle = seriesItem?.Name ?? item.SeriesName ?? itemDetails?.SeriesName ?? "Unbekannte Serie";
  const parent = await prisma.media.upsert({
    where: { jellyfinItemId: seriesId },
    update: {
      title: seriesTitle,
      posterUrl: seriesItem ? jellyfinPrimaryImageUrl(baseUrl, seriesItem) : null,
      metadataSource: "jellyfin",
      metadataLastSyncedAt: new Date(),
    },
    create: {
      type: "show",
      title: seriesTitle,
      jellyfinItemId: seriesId,
      posterUrl: seriesItem ? jellyfinPrimaryImageUrl(baseUrl, seriesItem) : null,
      metadataSource: "jellyfin",
      metadataLastSyncedAt: new Date(),
    },
  });

  const episode = await prisma.media.upsert({
    where: { jellyfinItemId: item.Id },
    update: {
      title: item.Name,
      originalTitle: seriesTitle,
      parentMediaId: parent.id,
      jellyfinSeriesId: seriesId,
      seasonNumber: item.ParentIndexNumber ?? itemDetails?.ParentIndexNumber ?? null,
      episodeNumber: item.IndexNumber ?? itemDetails?.IndexNumber ?? null,
      overview: item.Overview ?? itemDetails?.Overview ?? null,
      runtimeSeconds: ticksToSeconds(item.RunTimeTicks ?? itemDetails?.RunTimeTicks),
      tmdbId: providerId(item, "Tmdb"),
      imdbId: providerId(item, "Imdb"),
      tvdbId: providerId(item, "Tvdb"),
      posterUrl: jellyfinPrimaryImageUrl(baseUrl, item) ?? (itemDetails ? jellyfinPrimaryImageUrl(baseUrl, itemDetails) : null),
      metadataSource: "jellyfin",
      metadataLastSyncedAt: new Date(),
    },
    create: {
      type: "episode",
      title: item.Name,
      originalTitle: seriesTitle,
      parentMediaId: parent.id,
      jellyfinItemId: item.Id,
      jellyfinSeriesId: seriesId,
      seasonNumber: item.ParentIndexNumber ?? itemDetails?.ParentIndexNumber ?? null,
      episodeNumber: item.IndexNumber ?? itemDetails?.IndexNumber ?? null,
      overview: item.Overview ?? itemDetails?.Overview ?? null,
      runtimeSeconds: ticksToSeconds(item.RunTimeTicks ?? itemDetails?.RunTimeTicks),
      tmdbId: providerId(item, "Tmdb"),
      imdbId: providerId(item, "Imdb"),
      tvdbId: providerId(item, "Tvdb"),
      posterUrl: jellyfinPrimaryImageUrl(baseUrl, item) ?? (itemDetails ? jellyfinPrimaryImageUrl(baseUrl, itemDetails) : null),
      metadataSource: "jellyfin",
      metadataLastSyncedAt: new Date(),
    },
  });

  if (item.UserData?.Played === true) {
    const watchedAt = parsedLastPlayedAt(item);
    const marker = `jellyfin-catalog:${item.Id}:${watchedAt?.toISOString() ?? "unknown"}`;
    const existing = await prisma.watchEvent.findFirst({
      where: { userId: user.id, mediaId: episode.id, jellyfinPlaySessionId: marker },
    });
    if (!existing) {
      await prisma.watchEvent.create({
        data: {
          userId: user.id,
          mediaId: episode.id,
          source: "jellyfin",
          watchedAt,
          datePrecision: watchedAt ? "exact" : "unknown",
          completed: true,
          rewatchIndex: await nextRewatchIndex(prisma, user.id, episode.id),
          jellyfinPlaySessionId: marker,
          note: "Aus Jellyfin-Serienkatalog importiert.",
        },
      });
    }
  }
}

export async function syncJellyfinSeriesCatalog(prisma: PrismaClient, user: User) {
  if (!user.jellyfinUserId) {
    throw new Error("Dein WatchLog-Benutzer hat keine Jellyfin-UserId. Bitte unter Integrationen Benutzer laden und speichern.");
  }

  const settings = await getSetting(prisma, "jellyfin", jellyfinDefaults);
  if (!settings.jellyfinBaseUrl) {
    throw new Error("Jellyfin URL fehlt. Bitte Integrationseinstellungen pruefen.");
  }

  const jellyfinUserId = await resolveJellyfinUserId(settings.jellyfinBaseUrl, settings.jellyfinApiKey, user.jellyfinUserId);
  const episodes = await listAllJellyfinEpisodes(settings.jellyfinBaseUrl, settings.jellyfinApiKey, jellyfinUserId);

  let synced = 0;
  for (const episode of episodes) {
    await upsertEpisodeFromJellyfin(prisma, user, settings.jellyfinBaseUrl, settings.jellyfinApiKey, episode);
    synced += 1;
  }

  return { ok: true, synced, message: `${synced} Jellyfin-Episoden synchronisiert.` };
}

export async function getSeriesCatalog(prisma: PrismaClient, userId: string): Promise<SeriesCatalogItem[]> {
  const shows = await prisma.media.findMany({
    where: { type: "show" },
    include: {
      children: {
        where: { type: "episode" },
        include: { watchEvents: { where: { userId }, orderBy: [{ watchedAt: "desc" }, { createdAt: "desc" }] } },
        orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }, { title: "asc" }],
      },
    },
    orderBy: [{ title: "asc" }],
  });

  return shows.map((show) => {
    const seasons = new Map<number | null, SeriesCatalogItem["seasons"][number]>();
    for (const episode of show.children) {
      const watchedEvent = episode.watchEvents[0] ?? null;
      const seasonNumber = episode.seasonNumber;
      const current = seasons.get(seasonNumber) ?? { seasonNumber, episodes: [], watchedEpisodes: 0, totalEpisodes: 0, complete: false };
      current.episodes.push({
        id: episode.id,
        title: episode.title,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        watched: Boolean(watchedEvent),
        watchedAt: watchedEvent?.watchedAt?.toISOString() ?? null,
        posterUrl: episode.posterUrl,
      });
      current.totalEpisodes += 1;
      if (watchedEvent) current.watchedEpisodes += 1;
      current.complete = current.totalEpisodes > 0 && current.watchedEpisodes === current.totalEpisodes;
      seasons.set(seasonNumber, current);
    }

    const seasonList = [...seasons.values()].sort((a, b) => (a.seasonNumber ?? 9999) - (b.seasonNumber ?? 9999));
    const totalEpisodes = seasonList.reduce((sum, season) => sum + season.totalEpisodes, 0);
    const watchedEpisodes = seasonList.reduce((sum, season) => sum + season.watchedEpisodes, 0);

    return {
      id: show.id,
      title: show.title,
      posterUrl: show.posterUrl,
      watchedEpisodes,
      totalEpisodes,
      complete: totalEpisodes > 0 && watchedEpisodes === totalEpisodes,
      seasons: seasonList,
    };
  });
}

export async function markMediaWatched(prisma: PrismaClient, userId: string, mediaIds: string[], watchedAtInput?: string | null) {
  const watchedAt = watchedAtInput ? new Date(watchedAtInput) : new Date();
  if (Number.isNaN(watchedAt.getTime())) {
    throw new Error("Ungueltiges gesehen-Datum. Bitte ISO-Datum verwenden oder leer lassen.");
  }

  let created = 0;
  for (const mediaId of mediaIds) {
    const existing = await prisma.watchEvent.findFirst({ where: { userId, mediaId } });
    if (existing) continue;
    await prisma.watchEvent.create({
      data: {
        userId,
        mediaId,
        source: "manual",
        watchedAt,
        datePrecision: "exact",
        completed: true,
        rewatchIndex: await nextRewatchIndex(prisma, userId, mediaId),
        note: "Manuell aus Serienansicht als gesehen markiert.",
      },
    });
    created += 1;
  }

  return { ok: true, created, skipped: mediaIds.length - created };
}
