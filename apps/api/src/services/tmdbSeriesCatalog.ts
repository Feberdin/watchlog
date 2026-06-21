/**
 * Purpose: Resolve TMDb TV catalogs, sum episode runtimes, and keep local series episode rows complete.
 * Input/Output: A local show row plus TMDb settings becomes updated show metadata and episode Media children.
 * Invariants: Whole-show runtime ignores specials and future-dated episodes; existing Jellyfin data is only filled where missing.
 * Debugging: Inspect the returned episode counts, missing runtime count, and created/updated counts when a series total looks wrong.
 */

import type { PrismaClient } from "@prisma/client";
import {
  getTmdbSeasonEpisodes,
  getTmdbTvCatalog,
  searchTmdb,
  type TmdbSettingsForClient,
  type TmdbTvCatalog,
  type TmdbTvEpisode,
  type TmdbTvSeasonSummary,
} from "./tmdbClient.js";

export type TmdbSeriesShowInput = {
  id: string;
  title: string;
  year: number | null;
  overview: string | null;
  genres: string[];
  cast: string[];
  runtimeSeconds: number | null;
  tmdbId: string | null;
  imdbId: string | null;
  tvdbId: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  metadataSource: string | null;
};

export type TmdbSeasonEpisodeCache = Map<string, Promise<TmdbTvEpisode[]>>;

export type TmdbSeriesCatalogRefresh = {
  found: boolean;
  tmdbId: number | null;
  runtimeSeconds: number | null;
  seasonCount: number;
  episodeCount: number;
  missingRuntimeEpisodes: number;
  createdEpisodes: number;
  updatedEpisodes: number;
};

type ExistingEpisodeMedia = {
  id: string;
  title: string;
  year: number | null;
  overview: string | null;
  genres: string[];
  cast: string[];
  runtimeSeconds: number | null;
  tmdbId: string | null;
  posterUrl: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
};

type SeasonEpisodeGroup = {
  season: TmdbTvSeasonSummary;
  episodes: TmdbTvEpisode[];
};

function positiveTmdbId(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeTitleForMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tmdbMergedMetadataSource(source: string | null) {
  if (!source || source === "manual") return "tmdb";
  if (source.includes("jellyfin")) return "jellyfin+tmdb";
  return source.includes("tmdb") ? source : `${source}+tmdb`;
}

function isRegularSeason(season: TmdbTvSeasonSummary) {
  return season.seasonNumber > 0;
}

function isAlreadyAired(episode: TmdbTvEpisode, now: Date) {
  if (!episode.airDate) {
    return true;
  }

  const airDate = Date.parse(`${episode.airDate}T00:00:00.000Z`);
  return Number.isNaN(airDate) || airDate <= now.getTime();
}

/**
 * Why this exists: long-running shows can have many seasons. Fetching every
 * season strictly one after another makes startup repairs look stuck, while
 * unbounded parallelism would be rude to TMDb and harder to debug.
 */
async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]!, index);
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function hasMeaningfulEpisodeUpdate(existing: ExistingEpisodeMedia, episode: TmdbTvEpisode, catalog: TmdbTvCatalog) {
  return !existing.year && episode.year !== null
    || !existing.overview && episode.overview !== null
    || existing.genres.length === 0 && catalog.genres.length > 0
    || existing.cast.length === 0 && catalog.cast.length > 0
    || !existing.runtimeSeconds && episode.runtimeSeconds !== null
    || !existing.tmdbId
    || !existing.posterUrl && episode.posterUrl !== null;
}

async function getCachedSeasonEpisodes(
  settings: TmdbSettingsForClient,
  tmdbId: number,
  seasonNumber: number,
  seasonCache?: TmdbSeasonEpisodeCache,
) {
  const cacheKey = `${tmdbId}:${seasonNumber}`;
  const cached = seasonCache?.get(cacheKey);
  if (cached) {
    return cached;
  }

  const promise = getTmdbSeasonEpisodes(settings, tmdbId, seasonNumber).catch(() => []);
  seasonCache?.set(cacheKey, promise);
  return promise;
}

/**
 * Why this exists: TMDb stores TV runtime on episodes, not on the show row.
 * Resolving by ID first avoids accidental title matches, while the title search
 * keeps old manual entries repairable when only name/year were stored.
 */
export async function resolveTmdbCatalogForShow(show: {
  title: string;
  year: number | null;
  tmdbId: string | null;
}, tmdbSettings: TmdbSettingsForClient): Promise<TmdbTvCatalog | null> {
  const existingTmdbId = positiveTmdbId(show.tmdbId);
  if (existingTmdbId) {
    return getTmdbTvCatalog(tmdbSettings, existingTmdbId).catch(() => null);
  }

  const results = await searchTmdb(tmdbSettings, show.title, "show", show.year).catch(() => []);
  const normalizedShowTitle = normalizeTitleForMatch(show.title);
  const match = results.find((result) => normalizeTitleForMatch(result.title) === normalizedShowTitle && (!show.year || result.year === show.year))
    ?? results.find((result) => normalizeTitleForMatch(result.title) === normalizedShowTitle)
    ?? results.find((result) => show.year && result.year === show.year)
    ?? results[0]
    ?? null;

  return match ? getTmdbTvCatalog(tmdbSettings, match.tmdbId).catch(() => null) : null;
}

async function loadRegularAiredEpisodes(
  settings: TmdbSettingsForClient,
  catalog: TmdbTvCatalog,
  options: { seasonCache?: TmdbSeasonEpisodeCache; now?: Date } = {},
): Promise<SeasonEpisodeGroup[]> {
  const now = options.now ?? new Date();
  const regularSeasons = catalog.seasons.filter(isRegularSeason);

  return mapWithConcurrency(regularSeasons, 4, async (season) => {
    const episodes = await getCachedSeasonEpisodes(settings, catalog.tmdbId, season.seasonNumber, options.seasonCache);
    return {
      season,
      episodes: episodes.filter((episode) => isAlreadyAired(episode, now)),
    };
  });
}

async function upsertTmdbEpisodes(
  prisma: PrismaClient,
  show: TmdbSeriesShowInput,
  catalog: TmdbTvCatalog,
  groups: SeasonEpisodeGroup[],
) {
  const existingEpisodes = await prisma.media.findMany({
    where: {
      parentMediaId: show.id,
      type: "episode",
    },
    select: {
      id: true,
      title: true,
      year: true,
      overview: true,
      genres: true,
      cast: true,
      runtimeSeconds: true,
      tmdbId: true,
      posterUrl: true,
      seasonNumber: true,
      episodeNumber: true,
    },
  });
  const existingBySeasonEpisode = new Map(
    (existingEpisodes as ExistingEpisodeMedia[])
      .filter((episode) => episode.seasonNumber !== null && episode.episodeNumber !== null)
      .map((episode) => [`${episode.seasonNumber}:${episode.episodeNumber}`, episode]),
  );

  let createdEpisodes = 0;
  let updatedEpisodes = 0;
  for (const group of groups) {
    for (const episode of group.episodes) {
      const key = `${episode.seasonNumber}:${episode.episodeNumber}`;
      const existing = existingBySeasonEpisode.get(key);
      if (existing) {
        if (hasMeaningfulEpisodeUpdate(existing, episode, catalog)) {
          await prisma.media.update({
            where: { id: existing.id },
            data: {
              ...(existing.year ? {} : { year: episode.year }),
              ...(existing.overview ? {} : { overview: episode.overview }),
              ...(existing.genres.length > 0 ? {} : { genres: catalog.genres }),
              ...(existing.cast.length > 0 ? {} : { cast: catalog.cast }),
              ...(existing.runtimeSeconds ? {} : { runtimeSeconds: episode.runtimeSeconds }),
              ...(existing.tmdbId ? {} : { tmdbId: String(episode.tmdbId) }),
              ...(existing.posterUrl ? {} : { posterUrl: episode.posterUrl ?? group.season.posterUrl }),
              metadataLastSyncedAt: new Date(),
            },
          });
          updatedEpisodes += 1;
        }
        continue;
      }

      const created = await prisma.media.create({
        data: {
          type: "episode",
          title: episode.title,
          originalTitle: catalog.title,
          year: episode.year,
          overview: episode.overview,
          genres: catalog.genres,
          cast: catalog.cast,
          runtimeSeconds: episode.runtimeSeconds,
          tmdbId: String(episode.tmdbId),
          parentMediaId: show.id,
          seasonNumber: episode.seasonNumber,
          episodeNumber: episode.episodeNumber,
          posterUrl: episode.posterUrl ?? group.season.posterUrl,
          metadataSource: "tmdb",
          metadataLastSyncedAt: new Date(),
        },
      });
      existingBySeasonEpisode.set(key, {
        id: created.id,
        title: created.title,
        year: created.year,
        overview: created.overview,
        genres: created.genres,
        cast: created.cast,
        runtimeSeconds: created.runtimeSeconds,
        tmdbId: created.tmdbId,
        posterUrl: created.posterUrl,
        seasonNumber: created.seasonNumber,
        episodeNumber: created.episodeNumber,
      });
      createdEpisodes += 1;
    }
  }

  return { createdEpisodes, updatedEpisodes };
}

/**
 * Why this exists: a show-level WatchEvent means "this series was watched",
 * but TMDb does not expose a trustworthy whole-series runtime. Summing the
 * individual aired episodes keeps watchtime accurate and also materializes the
 * season/episode tree for the Series page.
 */
export async function refreshTmdbSeriesCatalog(
  prisma: PrismaClient,
  settings: TmdbSettingsForClient,
  show: TmdbSeriesShowInput,
  options: { seasonCache?: TmdbSeasonEpisodeCache; now?: Date } = {},
): Promise<TmdbSeriesCatalogRefresh> {
  const catalog = await resolveTmdbCatalogForShow(show, settings);
  if (!catalog) {
    return {
      found: false,
      tmdbId: null,
      runtimeSeconds: null,
      seasonCount: 0,
      episodeCount: 0,
      missingRuntimeEpisodes: 0,
      createdEpisodes: 0,
      updatedEpisodes: 0,
    };
  }

  const groups = await loadRegularAiredEpisodes(settings, catalog, options);
  const runtimeSeconds = groups.reduce((sum, group) => (
    sum + group.episodes.reduce((seasonSum, episode) => seasonSum + (episode.runtimeSeconds ?? 0), 0)
  ), 0);
  const episodeCount = groups.reduce((sum, group) => sum + group.episodes.length, 0);
  const missingRuntimeEpisodes = groups.reduce((sum, group) => (
    sum + group.episodes.filter((episode) => !episode.runtimeSeconds).length
  ), 0);
  const episodeResult = await upsertTmdbEpisodes(prisma, show, catalog, groups);

  await prisma.media.update({
    where: { id: show.id },
    data: {
      ...(runtimeSeconds > 0 ? { runtimeSeconds } : {}),
      title: show.title || catalog.title,
      originalTitle: catalog.originalTitle,
      tmdbId: show.tmdbId ?? String(catalog.tmdbId),
      year: show.year ?? catalog.startYear,
      overview: show.overview ?? catalog.overview,
      genres: show.genres.length > 0 ? show.genres : catalog.genres,
      cast: show.cast.length > 0 ? show.cast : catalog.cast,
      imdbId: show.imdbId ?? catalog.imdbId,
      tvdbId: show.tvdbId ?? catalog.tvdbId,
      posterUrl: show.posterUrl ?? catalog.posterUrl,
      backdropUrl: show.backdropUrl ?? catalog.backdropUrl,
      metadataSource: tmdbMergedMetadataSource(show.metadataSource),
      metadataLastSyncedAt: new Date(),
    },
  });

  return {
    found: true,
    tmdbId: catalog.tmdbId,
    runtimeSeconds: runtimeSeconds > 0 ? runtimeSeconds : null,
    seasonCount: groups.length,
    episodeCount,
    missingRuntimeEpisodes,
    ...episodeResult,
  };
}
