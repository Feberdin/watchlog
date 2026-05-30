/**
 * Purpose: Refresh WatchLog runtimes and TV episode catalogs from TMDb for already watched media.
 * Input/Output: Current user's runtime candidates become updated Media rows and missing show episodes when TMDb has data.
 * Invariants: Movies keep known runtimes; shows are recalculated from regular aired episodes; TMDb secrets stay inside settings.
 * Debugging: The returned detail rows explain whether a title was updated, skipped, unchanged, or failed.
 */

import type { PrismaClient } from "@prisma/client";
import {
  getTmdbDetails,
  getTmdbSeasonEpisodes,
  searchTmdb,
  type TmdbSettingsForClient,
  type TmdbTvEpisode,
} from "./tmdbClient.js";
import { refreshTmdbSeriesCatalog, type TmdbSeasonEpisodeCache } from "./tmdbSeriesCatalog.js";
import { resolveRuntimeSeconds } from "./watchtime.js";

type RuntimeRefreshMedia = {
  id: string;
  type: string;
  title: string;
  year: number | null;
  genres: string[];
  cast: string[];
  overview: string | null;
  runtimeSeconds: number | null;
  tmdbId: string | null;
  imdbId: string | null;
  tvdbId: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  metadataSource: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  parent: {
    id: string;
    type: string;
    title: string;
    year: number | null;
    runtimeSeconds: number | null;
    tmdbId: string | null;
    posterUrl: string | null;
  } | null;
};

type RuntimeRefreshWatchEvent = {
  durationSeconds: number | null;
  media: RuntimeRefreshMedia;
};

type RuntimeRefreshStatus = "updated" | "unchanged" | "skipped" | "failed";

export type RuntimeRefreshResult = {
  scanned: number;
  candidates: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  message: string;
  details: Array<{
    mediaId: string;
    title: string;
    type: string;
    status: RuntimeRefreshStatus;
    message: string;
    runtimeSeconds: number | null;
  }>;
};

function positiveInteger(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizedTitle(value: string) {
  return value
    .toLocaleLowerCase("de-DE")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function metadataSourceAfterTmdb(media: RuntimeRefreshMedia) {
  if (media.metadataSource?.includes("jellyfin")) return "jellyfin+tmdb";
  return media.metadataSource ?? "tmdb";
}

function effectiveRuntimeSeconds(media: RuntimeRefreshMedia, durationSeconds: number | null) {
  return resolveRuntimeSeconds({
    type: media.type,
    durationSeconds,
    runtimeSeconds: media.runtimeSeconds,
  });
}

function detail(status: RuntimeRefreshStatus, media: RuntimeRefreshMedia, message: string, runtimeSeconds: number | null = null) {
  return {
    mediaId: media.id,
    title: media.parent && media.type === "episode" ? `${media.parent.title} - ${media.title}` : media.title,
    type: media.type,
    status,
    message,
    runtimeSeconds,
  };
}

async function resolveTmdbId(
  settings: TmdbSettingsForClient,
  media: Pick<RuntimeRefreshMedia, "type" | "title" | "year" | "tmdbId">,
) {
  const existing = positiveInteger(media.tmdbId);
  if (existing) return existing;
  if (media.type !== "movie" && media.type !== "show") return null;

  const type = media.type;
  const results = await searchTmdb(settings, media.title, type, media.year).catch(() => []);
  const wantedTitle = normalizedTitle(media.title);
  const match = results.find((result) => normalizedTitle(result.title) === wantedTitle && (!media.year || result.year === media.year))
    ?? results.find((result) => normalizedTitle(result.title) === wantedTitle)
    ?? results.find((result) => media.year && result.year === media.year)
    ?? null;

  return match?.tmdbId ?? null;
}

async function updateMovieOrShowRuntime(
  prisma: PrismaClient,
  settings: TmdbSettingsForClient,
  media: RuntimeRefreshMedia,
  seasonCache: TmdbSeasonEpisodeCache,
) {
  if (media.type !== "movie" && media.type !== "show") {
    return detail("skipped", media, "Nur Filme und Serien koennen direkt per TMDb-Detail aktualisiert werden.");
  }

  if (media.type === "show") {
    const result = await refreshTmdbSeriesCatalog(prisma, settings, media, { seasonCache });
    if (!result.found) {
      return detail("skipped", media, "Keine sichere TMDb-Serie gefunden.");
    }
    if (!result.runtimeSeconds) {
      return detail("unchanged", media, "TMDb liefert fuer diese Serie keine Episodenlaufzeiten.");
    }

    const catalogInfo = [
      `${result.episodeCount} Episode(n)`,
      `${result.seasonCount} Staffel(n)`,
      result.createdEpisodes > 0 ? `${result.createdEpisodes} neu angelegt` : null,
      result.updatedEpisodes > 0 ? `${result.updatedEpisodes} aktualisiert` : null,
      result.missingRuntimeEpisodes > 0 ? `${result.missingRuntimeEpisodes} ohne Laufzeit` : null,
    ].filter(Boolean).join(", ");

    return detail("updated", media, `Serienlaufzeit aus TMDb-Episoden summiert (${catalogInfo}).`, result.runtimeSeconds);
  }

  const tmdbId = await resolveTmdbId(settings, media);
  if (!tmdbId) {
    return detail("skipped", media, "Keine sichere TMDb-ID gefunden.");
  }

  const tmdb = await getTmdbDetails(settings, media.type, tmdbId);
  if (!tmdb.runtimeSeconds) {
    return detail("unchanged", media, "TMDb liefert fuer diesen Titel keine Laufzeit.");
  }

  await prisma.media.update({
    where: { id: media.id },
    data: {
      runtimeSeconds: tmdb.runtimeSeconds,
      tmdbId: media.tmdbId ?? String(tmdbId),
      title: media.title || tmdb.title,
      originalTitle: tmdb.originalTitle,
      year: media.year ?? tmdb.year,
      overview: media.overview ?? tmdb.overview,
      genres: media.genres.length > 0 ? media.genres : tmdb.genres,
      cast: media.cast.length > 0 ? media.cast : tmdb.cast,
      imdbId: media.imdbId ?? tmdb.imdbId,
      posterPath: media.posterPath ?? tmdb.posterPath,
      backdropPath: media.backdropPath ?? tmdb.backdropPath,
      posterUrl: media.posterUrl ?? tmdb.posterUrl,
      backdropUrl: media.backdropUrl ?? tmdb.backdropUrl,
      metadataSource: metadataSourceAfterTmdb(media),
      metadataLastSyncedAt: new Date(),
    },
  });

  return detail("updated", media, "Laufzeit von TMDb aktualisiert.", tmdb.runtimeSeconds);
}

async function updateEpisodeOrSeasonRuntime(
  prisma: PrismaClient,
  settings: TmdbSettingsForClient,
  media: RuntimeRefreshMedia,
  seasonCache: TmdbSeasonEpisodeCache,
) {
  if ((media.type !== "episode" && media.type !== "season") || !media.parent) {
    return detail("skipped", media, "Kein Serienkontext vorhanden.");
  }

  if (media.seasonNumber === null) {
    return detail("skipped", media, "Staffelnummer fehlt.");
  }

  const parentTmdbId = await resolveTmdbId(settings, {
    type: "show",
    title: media.parent.title,
    year: media.parent.year,
    tmdbId: media.parent.tmdbId,
  });
  if (!parentTmdbId) {
    return detail("skipped", media, "Keine sichere TMDb-ID fuer die Serie gefunden.");
  }

  const cacheKey = `${parentTmdbId}:${media.seasonNumber}`;
  const episodesPromise = seasonCache.get(cacheKey) ?? getTmdbSeasonEpisodes(settings, parentTmdbId, media.seasonNumber);
  seasonCache.set(cacheKey, episodesPromise);
  const episodes = await episodesPromise;

  if (media.type === "season") {
    const seasonSeconds = episodes.reduce((sum, episode) => sum + (episode.runtimeSeconds ?? 0), 0);
    if (seasonSeconds <= 0) {
      return detail("unchanged", media, "TMDb liefert fuer diese Staffel keine Episodenlaufzeiten.");
    }

    await prisma.media.update({
      where: { id: media.id },
      data: {
        runtimeSeconds: seasonSeconds,
        metadataSource: metadataSourceAfterTmdb(media),
        metadataLastSyncedAt: new Date(),
      },
    });
    return detail("updated", media, "Staffellaufzeit aus TMDb-Episoden summiert.", seasonSeconds);
  }

  if (media.episodeNumber === null) {
    return detail("skipped", media, "Episodennummer fehlt.");
  }

  const episode = episodes.find((candidate) => candidate.episodeNumber === media.episodeNumber);
  if (!episode?.runtimeSeconds) {
    return detail("unchanged", media, "TMDb liefert fuer diese Episode keine Laufzeit.");
  }

  await prisma.$transaction([
    prisma.media.update({
      where: { id: media.id },
      data: {
        runtimeSeconds: episode.runtimeSeconds,
        tmdbId: media.tmdbId ?? String(episode.tmdbId),
        year: media.year ?? episode.year,
        overview: media.overview ?? episode.overview,
        posterUrl: media.posterUrl ?? episode.posterUrl,
        metadataSource: metadataSourceAfterTmdb(media),
        metadataLastSyncedAt: new Date(),
      },
    }),
    prisma.media.update({
      where: { id: media.parent.id },
      data: {
        tmdbId: media.parent.tmdbId ?? String(parentTmdbId),
        metadataLastSyncedAt: new Date(),
      },
    }),
  ]);

  return detail("updated", media, "Episodenlaufzeit von TMDb aktualisiert.", episode.runtimeSeconds);
}

export async function refreshEstimatedRuntimesFromTmdb(
  prisma: PrismaClient,
  userId: string,
  settings: TmdbSettingsForClient,
  options: { limit?: number | undefined } = {},
): Promise<RuntimeRefreshResult> {
  if (!settings.tmdbBearerToken) {
    throw new Error("TMDb: Bearer Token fehlt. Bitte in den Integrationen speichern.");
  }

  const rows = await prisma.watchEvent.findMany({
    where: {
      userId,
      media: { metadataSource: { not: "swipe-tmdb" } },
    },
    include: { media: { include: { parent: true } } },
    orderBy: [{ watchedAt: "desc" }, { createdAt: "desc" }],
    take: 10000,
  });

  const candidates = new Map<string, RuntimeRefreshMedia>();
  for (const row of rows as RuntimeRefreshWatchEvent[]) {
    const runtime = effectiveRuntimeSeconds(row.media, row.durationSeconds);
    if (runtime.estimated || row.media.type === "show" || row.media.type === "season") {
      candidates.set(row.media.id, row.media);
    }
  }

  const limit = Math.min(Math.max(options.limit ?? 500, 1), 1000);
  const limitedCandidates = [...candidates.values()].slice(0, limit);
  const seasonCache = new Map<string, Promise<TmdbTvEpisode[]>>();
  const details: RuntimeRefreshResult["details"] = [];

  for (const media of limitedCandidates) {
    try {
      const result = media.type === "movie" || media.type === "show"
        ? await updateMovieOrShowRuntime(prisma, settings, media, seasonCache)
        : await updateEpisodeOrSeasonRuntime(prisma, settings, media, seasonCache);
      details.push(result);
    } catch (error) {
      details.push(detail("failed", media, error instanceof Error ? error.message : "TMDb-Aktualisierung ist fehlgeschlagen."));
    }
  }

  const updated = details.filter((item) => item.status === "updated").length;
  const unchanged = details.filter((item) => item.status === "unchanged").length;
  const skipped = details.filter((item) => item.status === "skipped").length;
  const failed = details.filter((item) => item.status === "failed").length;

  return {
    scanned: rows.length,
    candidates: candidates.size,
    updated,
    unchanged,
    skipped,
    failed,
    message: `${updated} Laufzeit(en) aktualisiert, ${unchanged} ohne TMDb-Laufzeit, ${skipped} ohne sichere TMDb-Zuordnung, ${failed} fehlgeschlagen.`,
    details,
  };
}
