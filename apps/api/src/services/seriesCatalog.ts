/**
 * Purpose: Keep a local Jellyfin/TMDb series catalog and expose season/episode progress.
 * Input/Output: Jellyfin episode lists plus optional TMDb TV details become Media rows and UI-friendly series trees.
 * Invariants: Syncing catalog never deletes local history and only creates WatchEvents for Jellyfin-played episodes.
 * Debugging: If a series misses episodes, verify the Jellyfin series has a TMDb provider ID and run the catalog sync.
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
import { getTmdbSeasonEpisodes, getTmdbTvCatalog, searchTmdb, type TmdbSettingsForClient, type TmdbTvCatalog } from "./tmdbClient.js";
import { nextRewatchIndex } from "./watchEvents.js";

const jellyfinDefaults = {
  jellyfinBaseUrl: null,
  jellyfinApiKey: null,
  enabledUserIds: [] as string[],
  syncBackEnabled: false,
  watchedThresholdMoviePercent: 90,
  watchedThresholdEpisodePercent: 90,
};

const tmdbDefaults: TmdbSettingsForClient = {
  tmdbBearerToken: null,
  preferredLanguage: "de-DE",
  fallbackLanguage: "en-US",
  imageBaseUrl: "https://image.tmdb.org/t/p",
};

function providerId(item: JellyfinWatchedItem, key: string): string | null {
  const value = item.ProviderIds?.[key] ?? item.ProviderIds?.[key.toLowerCase()] ?? item.ProviderIds?.[key.toUpperCase()];
  return value && value.trim() ? value.trim() : null;
}

function normalizedTextList(values: string[] | null | undefined): string[] {
  const unique = new Map<string, string>();
  for (const value of values ?? []) {
    const normalized = value.trim();
    if (!normalized) continue;
    unique.set(normalized.toLocaleLowerCase("de-DE"), normalized);
  }

  return [...unique.values()];
}

function parsedLastPlayedAt(item: JellyfinWatchedItem): Date | null {
  const raw = item.UserData?.LastPlayedDate;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeTitleForMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function shouldRefresh(lastSyncedAt: Date | null, now = new Date()): boolean {
  if (!lastSyncedAt) {
    return true;
  }

  const maxAgeMs = 12 * 60 * 60 * 1000;
  return now.getTime() - lastSyncedAt.getTime() > maxAgeMs;
}

function sameWatchedAtFilter(watchedAt: Date | null) {
  return watchedAt ? { watchedAt } : { watchedAt: null };
}

async function hasExistingJellyfinWatchEvent(prisma: PrismaClient, userId: string, mediaId: string, watchedAt: Date | null): Promise<boolean> {
  const existing = await prisma.watchEvent.findFirst({
    where: {
      userId,
      mediaId,
      source: "jellyfin",
      ...sameWatchedAtFilter(watchedAt),
    },
  });

  return Boolean(existing);
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
  const seriesPosterUrl = seriesItem ? jellyfinPrimaryImageUrl(baseUrl, seriesItem) : null;
  const seriesTmdbId = seriesItem ? providerId(seriesItem, "Tmdb") : null;
  const seriesImdbId = seriesItem ? providerId(seriesItem, "Imdb") : null;
  const seriesTvdbId = seriesItem ? providerId(seriesItem, "Tvdb") : null;
  const parentData = {
    title: seriesTitle,
    ...(seriesItem?.ProductionYear ? { year: seriesItem.ProductionYear } : {}),
    ...(seriesItem?.Overview ? { overview: seriesItem.Overview } : {}),
    genres: normalizedTextList(seriesItem?.Genres),
    ...(seriesTmdbId ? { tmdbId: seriesTmdbId } : {}),
    ...(seriesImdbId ? { imdbId: seriesImdbId } : {}),
    ...(seriesTvdbId ? { tvdbId: seriesTvdbId } : {}),
    ...(seriesPosterUrl ? { posterUrl: seriesPosterUrl } : {}),
    metadataSource: "jellyfin",
    metadataLastSyncedAt: new Date(),
  };
  const existingSwipeShow = seriesTmdbId
    ? await prisma.media.findFirst({
        where: {
          type: "show",
          tmdbId: seriesTmdbId,
          jellyfinItemId: null,
          metadataSource: { in: ["swipe-tmdb", "tmdb"] },
        },
      })
    : null;
  const parent = existingSwipeShow
    ? await prisma.media.update({
      where: { id: existingSwipeShow.id },
      data: {
        ...parentData,
        jellyfinItemId: seriesId,
      },
    })
    : await prisma.media.upsert({
      where: { jellyfinItemId: seriesId },
      update: parentData,
      create: {
        type: "show",
        title: seriesTitle,
        year: seriesItem?.ProductionYear ?? null,
        overview: seriesItem?.Overview ?? null,
        genres: normalizedTextList(seriesItem?.Genres),
        tmdbId: seriesTmdbId,
        imdbId: seriesImdbId,
        tvdbId: seriesTvdbId,
        jellyfinItemId: seriesId,
        posterUrl: seriesPosterUrl,
        metadataSource: "jellyfin",
        metadataLastSyncedAt: new Date(),
      },
    });

  const episodeTmdbId = providerId(item, "Tmdb");
  const episodeImdbId = providerId(item, "Imdb");
  const episodeTvdbId = providerId(item, "Tvdb");
  const episodePosterUrl = jellyfinPrimaryImageUrl(baseUrl, item) ?? (itemDetails ? jellyfinPrimaryImageUrl(baseUrl, itemDetails) : null);
  const episodeGenres = normalizedTextList(item.Genres ?? itemDetails?.Genres ?? seriesItem?.Genres);
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
      genres: episodeGenres,
      runtimeSeconds: ticksToSeconds(item.RunTimeTicks ?? itemDetails?.RunTimeTicks),
      ...(episodeTmdbId ? { tmdbId: episodeTmdbId } : {}),
      ...(episodeImdbId ? { imdbId: episodeImdbId } : {}),
      ...(episodeTvdbId ? { tvdbId: episodeTvdbId } : {}),
      ...(episodePosterUrl ? { posterUrl: episodePosterUrl } : {}),
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
      genres: episodeGenres,
      runtimeSeconds: ticksToSeconds(item.RunTimeTicks ?? itemDetails?.RunTimeTicks),
      tmdbId: episodeTmdbId,
      imdbId: episodeImdbId,
      tvdbId: episodeTvdbId,
      posterUrl: episodePosterUrl,
      metadataSource: "jellyfin",
      metadataLastSyncedAt: new Date(),
    },
  });

  if (item.UserData?.Played === true) {
    const watchedAt = parsedLastPlayedAt(item);
    const marker = `jellyfin-catalog:${item.Id}:${watchedAt?.toISOString() ?? "unknown"}`;
    if (!(await hasExistingJellyfinWatchEvent(prisma, user.id, episode.id, watchedAt))) {
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

async function resolveTmdbCatalogForShow(show: {
  title: string;
  year: number | null;
  tmdbId: string | null;
}, tmdbSettings: TmdbSettingsForClient): Promise<TmdbTvCatalog | null> {
  const existingTmdbId = Number(show.tmdbId);
  if (Number.isInteger(existingTmdbId) && existingTmdbId > 0) {
    return getTmdbTvCatalog(tmdbSettings, existingTmdbId).catch(() => null);
  }

  const results = await searchTmdb(tmdbSettings, show.title, "show", show.year).catch(() => []);
  const normalizedShowTitle = normalizeTitleForMatch(show.title);
  const match = results.find((result) => normalizeTitleForMatch(result.title) === normalizedShowTitle)
    ?? results.find((result) => result.year === show.year)
    ?? results[0]
    ?? null;

  return match ? getTmdbTvCatalog(tmdbSettings, match.tmdbId).catch(() => null) : null;
}

async function enrichSeriesFromTmdb(prisma: PrismaClient, tmdbSettings: TmdbSettingsForClient): Promise<{ created: number; updated: number }> {
  if (!tmdbSettings.tmdbBearerToken) {
    return { created: 0, updated: 0 };
  }

  const shows = await prisma.media.findMany({
    where: { type: "show", metadataSource: { not: "swipe-tmdb" } },
    include: { children: { where: { type: "episode" } } },
    orderBy: { title: "asc" },
  });

  let created = 0;
  let updated = 0;
  for (const show of shows) {
    const catalog = await resolveTmdbCatalogForShow(show, tmdbSettings);
    if (!catalog) {
      continue;
    }

    await prisma.media.update({
      where: { id: show.id },
      data: {
        title: show.title || catalog.title,
        originalTitle: catalog.originalTitle,
        tmdbId: show.tmdbId ?? String(catalog.tmdbId),
        year: show.year ?? catalog.startYear,
        overview: show.overview ?? catalog.overview,
        genres: catalog.genres.length > 0 ? catalog.genres : show.genres,
        cast: catalog.cast.length > 0 ? catalog.cast : show.cast,
        imdbId: show.imdbId ?? catalog.imdbId,
        tvdbId: show.tvdbId ?? catalog.tvdbId,
        posterUrl: show.posterUrl ?? catalog.posterUrl,
        backdropUrl: show.backdropUrl ?? catalog.backdropUrl,
        metadataSource: "jellyfin+tmdb",
        metadataLastSyncedAt: new Date(),
      },
    });

    const existingBySeasonEpisode = new Map(
      show.children
        .filter((episode) => episode.seasonNumber != null && episode.episodeNumber != null)
        .map((episode) => [`${episode.seasonNumber}:${episode.episodeNumber}`, episode]),
    );
    const knownSeasonEpisodes = new Set(existingBySeasonEpisode.keys());

    for (const season of catalog.seasons) {
      const episodes = await getTmdbSeasonEpisodes(tmdbSettings, catalog.tmdbId, season.seasonNumber).catch(() => []);
      for (const episode of episodes) {
        const key = `${episode.seasonNumber}:${episode.episodeNumber}`;
        const existing = existingBySeasonEpisode.get(key);
        if (existing) {
          await prisma.media.update({
            where: { id: existing.id },
            data: {
              ...(existing.year ? {} : { year: episode.year }),
              ...(existing.overview ? {} : { overview: episode.overview }),
              ...(existing.genres.length > 0 ? {} : { genres: catalog.genres }),
              ...(existing.cast.length > 0 ? {} : { cast: catalog.cast }),
              ...(existing.runtimeSeconds ? {} : { runtimeSeconds: episode.runtimeSeconds }),
              ...(existing.tmdbId ? {} : { tmdbId: String(episode.tmdbId) }),
              ...(existing.posterUrl ? {} : { posterUrl: episode.posterUrl ?? season.posterUrl }),
              metadataLastSyncedAt: new Date(),
            },
          });
          updated += 1;
          continue;
        }
        if (knownSeasonEpisodes.has(key)) {
          continue;
        }

        await prisma.media.create({
          data: {
            type: "episode",
            title: episode.title,
            year: episode.year,
            overview: episode.overview,
            genres: catalog.genres,
            cast: catalog.cast,
            runtimeSeconds: episode.runtimeSeconds,
            tmdbId: String(episode.tmdbId),
            parentMediaId: show.id,
            seasonNumber: episode.seasonNumber,
            episodeNumber: episode.episodeNumber,
            posterUrl: episode.posterUrl ?? season.posterUrl,
            metadataSource: "tmdb",
            metadataLastSyncedAt: new Date(),
          },
        });
        knownSeasonEpisodes.add(key);
        created += 1;
      }
    }
  }

  return { created, updated };
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

  const tmdbSettings = await getSetting(prisma, "tmdb", tmdbDefaults);
  const tmdbResult = await enrichSeriesFromTmdb(prisma, tmdbSettings);

  return {
    ok: true,
    synced,
    tmdbCreated: tmdbResult.created,
    tmdbUpdated: tmdbResult.updated,
    message: `${synced} Jellyfin-Episoden synchronisiert, ${tmdbResult.created} fehlende TMDb-Episode(n) ergaenzt, ${tmdbResult.updated} Episode(n) aktualisiert.`,
  };
}

export async function syncJellyfinSeriesCatalogIfStale(prisma: PrismaClient, user: User): Promise<boolean> {
  const staleShow = await prisma.media.findFirst({
    where: {
      type: "show",
      metadataSource: { not: "swipe-tmdb" },
      OR: [
        { jellyfinItemId: { not: null } },
        { children: { some: { type: "episode" } } },
      ],
      AND: {
        OR: [
          { metadataLastSyncedAt: null },
          { posterUrl: null },
        ],
      },
    },
  });
  const oldestSyncedShow = await prisma.media.findFirst({
    where: {
      type: "show",
      metadataSource: { not: "swipe-tmdb" },
      OR: [
        { jellyfinItemId: { not: null } },
        { children: { some: { type: "episode" } } },
      ],
    },
    orderBy: { metadataLastSyncedAt: "asc" },
  });

  if (!staleShow && oldestSyncedShow && !shouldRefresh(oldestSyncedShow.metadataLastSyncedAt)) {
    return false;
  }

  await syncJellyfinSeriesCatalog(prisma, user);
  return true;
}

export async function getSeriesCatalog(prisma: PrismaClient, userId: string, options: { includeSpecials?: boolean } = {}): Promise<SeriesCatalogItem[]> {
  const shows = await prisma.media.findMany({
    where: {
      type: "show",
      metadataSource: { not: "swipe-tmdb" },
      OR: [
        { jellyfinItemId: { not: null } },
        { children: { some: { type: "episode" } } },
      ],
    },
    include: {
      children: {
        where: {
          type: "episode",
          ...(options.includeSpecials ? {} : { seasonNumber: { not: 0 } }),
        },
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
      const current = seasons.get(seasonNumber) ?? {
        seasonNumber,
        startYear: null,
        genres: show.genres,
        cast: show.cast,
        episodes: [],
        watchedEpisodes: 0,
        totalEpisodes: 0,
        complete: false,
      };
      current.episodes.push({
        id: episode.id,
        title: episode.title,
        year: episode.year,
        genres: episode.genres.length > 0 ? episode.genres : show.genres,
        cast: episode.cast.length > 0 ? episode.cast : show.cast,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        watched: Boolean(watchedEvent),
        watchedAt: watchedEvent?.watchedAt?.toISOString() ?? null,
        posterUrl: episode.posterUrl,
      });
      current.startYear = [current.startYear, episode.year]
        .filter((year): year is number => typeof year === "number")
        .sort((a, b) => a - b)[0] ?? null;
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
      startYear: show.year,
      genres: show.genres,
      cast: show.cast,
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

  const uniqueMediaIds = [...new Set(mediaIds)];
  const existing = await prisma.watchEvent.findMany({
    where: { userId, mediaId: { in: uniqueMediaIds } },
    select: { mediaId: true },
  });
  const existingMediaIds = new Set(existing.map((event) => event.mediaId));
  const missingMediaIds = uniqueMediaIds.filter((mediaId) => !existingMediaIds.has(mediaId));

  if (missingMediaIds.length > 0) {
    await prisma.watchEvent.createMany({
      data: missingMediaIds.map((mediaId) => ({
        userId,
        mediaId,
        source: "manual",
        watchedAt,
        datePrecision: "exact",
        completed: true,
        rewatchIndex: 1,
        note: "Manuell aus Serienansicht als gesehen markiert.",
      })),
    });
  }

  return { ok: true, created: missingMediaIds.length, skipped: uniqueMediaIds.length - missingMediaIds.length };
}
