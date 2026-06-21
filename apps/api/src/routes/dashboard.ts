/**
 * Purpose: Aggregated metrics for the Dashboard.
 * Input/Output: Authenticated GET /api/dashboard returns counts and recent WatchEvents.
 * Invariants: Metrics are scoped to the current WatchLog user.
 * Debugging: Compare counts with `/api/watch-events` for the same account.
 */

import type { FastifyPluginAsync } from "fastify";
import { isCacheablePosterUrl, isCustomPosterRef } from "../services/posterCache.js";

function posterUrlForMedia(media: { id: string; posterUrl: string | null }) {
  return isCacheablePosterUrl(media.posterUrl) || isCustomPosterRef(media.posterUrl)
    ? `/api/media/${media.id}/poster.webp`
    : media.posterUrl;
}

type CollageItem = {
  id: string;
  title: string;
  type: "movie" | "show" | "season";
  year: number | null;
  genres: string[];
  cast: string[];
  seasonNumber: number | null;
  watchedAt: string | null;
  addedAt: string;
  posterUrl: string | null;
};

type CollageMovieEvent = {
  mediaId: string;
  watchedAt: Date | null;
  createdAt: Date;
  media: { id: string; title: string; type: string; year: number | null; genres: string[]; cast: string[]; posterUrl: string | null };
};

type CollageShowEvent = {
  mediaId: string;
  watchedAt: Date | null;
  createdAt: Date;
  media: { id: string; title: string; type: string; year: number | null; genres: string[]; cast: string[]; posterUrl: string | null; tmdbId: string | null };
};

type CollageShow = {
  id: string;
  tmdbId: string | null;
  title: string;
  year: number | null;
  genres: string[];
  cast: string[];
  posterUrl: string | null;
  children: Array<{
    seasonNumber: number | null;
    year: number | null;
    watchEvents: Array<{ watchedAt: Date | null; createdAt: Date }>;
  }>;
};

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get("/dashboard", async (request) => {
    const user = request.requireUser();
    const [events, genreEvents, movieCollageEvents, showCollageEvents, showsWithEpisodes, movieCount, episodeCount, rewatchCount] = await Promise.all([
      app.prisma.watchEvent.findMany({
        where: { userId: user.id, media: { metadataSource: { not: "swipe-tmdb" } } },
        include: { media: true },
        orderBy: [{ watchedAt: "desc" }, { createdAt: "desc" }],
        take: 10,
      }),
      app.prisma.watchEvent.findMany({
        where: { userId: user.id, media: { metadataSource: { not: "swipe-tmdb" } } },
        include: { media: { include: { parent: true } } },
        orderBy: [{ watchedAt: "desc" }, { createdAt: "desc" }],
        take: 10000,
      }),
      app.prisma.watchEvent.findMany({
        where: {
          userId: user.id,
          media: {
            type: "movie",
            metadataSource: { not: "swipe-tmdb" },
            posterUrl: { not: null },
          },
        },
        include: { media: true },
        orderBy: [{ createdAt: "desc" }],
        take: 5000,
      }),
      app.prisma.watchEvent.findMany({
        where: {
          userId: user.id,
          media: {
            type: "show",
            metadataSource: { not: "swipe-tmdb" },
            posterUrl: { not: null },
          },
        },
        include: { media: true },
        orderBy: [{ createdAt: "desc" }],
        take: 5000,
      }),
      app.prisma.media.findMany({
        where: {
          type: "show",
          metadataSource: { not: "swipe-tmdb" },
          children: {
            some: {
              type: "episode",
              seasonNumber: { not: null },
              metadataSource: { not: "swipe-tmdb" },
            },
          },
        },
        include: {
          children: {
            where: {
              type: "episode",
              seasonNumber: { not: null },
              metadataSource: { not: "swipe-tmdb" },
            },
            include: {
              watchEvents: {
                where: { userId: user.id },
                orderBy: [{ watchedAt: "desc" }, { createdAt: "desc" }],
                take: 1,
              },
            },
          },
        },
      }),
      app.prisma.watchEvent.count({ where: { userId: user.id, media: { type: "movie", metadataSource: { not: "swipe-tmdb" } } } }),
      app.prisma.watchEvent.count({ where: { userId: user.id, media: { type: "episode", metadataSource: { not: "swipe-tmdb" } } } }),
      app.prisma.watchEvent.count({ where: { userId: user.id, rewatchIndex: { gt: 1 }, media: { metadataSource: { not: "swipe-tmdb" } } } }),
    ]);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayCount = await app.prisma.watchEvent.count({
      where: { userId: user.id, watchedAt: { gte: todayStart }, media: { metadataSource: { not: "swipe-tmdb" } } },
    });

    return {
      metrics: {
        today: todayCount,
        movies: movieCount,
        episodes: episodeCount,
        rewatches: rewatchCount,
      },
      collage: buildDashboardCollage(movieCollageEvents, showCollageEvents, showsWithEpisodes),
      shareGenres: buildShareGenres(genreEvents),
      recent: events.map((event) => ({
        id: event.id,
        title: event.media.title,
        type: event.media.type,
        genres: event.media.genres,
        cast: event.media.cast,
        watchedAt: event.watchedAt?.toISOString() ?? null,
        seasonNumber: event.media.seasonNumber,
        datePrecision: event.datePrecision,
        posterUrl: posterUrlForMedia(event.media),
      })),
    };
  });
};

function buildShareGenres(events: Array<{ media: { genres: string[]; parent?: { genres: string[] } | null } }>) {
  const byName = new Map<string, string>();
  for (const event of events) {
    const genres = event.media.genres.length > 0 ? event.media.genres : event.media.parent?.genres ?? [];
    for (const genre of genres) {
      const normalized = genre.trim();
      if (normalized) {
        byName.set(normalized.toLocaleLowerCase("de-DE"), normalized);
      }
    }
  }

  return [...byName.values()].sort((left, right) => left.localeCompare(right, "de"));
}

function showMergeKeys(show: { id: string; tmdbId?: string | null }) {
  return [`id:${show.id}`, show.tmdbId ? `tmdb:${show.tmdbId}` : null].filter((key): key is string => Boolean(key));
}

export function buildDashboardCollage(
  movieEvents: CollageMovieEvent[],
  showEvents: CollageShowEvent[],
  shows: CollageShow[],
): CollageItem[] {
  const movies: CollageItem[] = Array.from(new Map(movieEvents.map((event) => [event.mediaId, event])).values()).map((event) => ({
    id: event.media.id,
    title: event.media.title,
    type: "movie",
    year: event.media.year,
    genres: event.media.genres,
    cast: event.media.cast,
    seasonNumber: null,
    watchedAt: (event.watchedAt ?? event.createdAt).toISOString(),
    addedAt: event.createdAt.toISOString(),
    posterUrl: posterUrlForMedia(event.media),
  }));

  const showsRepresentedByEpisodes = new Set<string>();

  const completedSeasons = shows.flatMap((show) => {
    const episodesBySeason = new Map<number, typeof show.children>();
    for (const episode of show.children) {
      if (episode.watchEvents.length > 0) {
        for (const key of showMergeKeys(show)) {
          showsRepresentedByEpisodes.add(key);
        }
      }
      if (episode.seasonNumber === null || episode.seasonNumber === 0) continue;
      const seasonEpisodes = episodesBySeason.get(episode.seasonNumber) ?? [];
      seasonEpisodes.push(episode);
      episodesBySeason.set(episode.seasonNumber, seasonEpisodes);
    }

    const seasons: CollageItem[] = [];
    for (const [seasonNumber, episodes] of episodesBySeason) {
      if (episodes.length === 0 || episodes.some((episode) => episode.watchEvents.length === 0)) continue;

      const watchedDates = episodes
        .map((episode) => episode.watchEvents[0]?.watchedAt ?? episode.watchEvents[0]?.createdAt)
        .filter((value): value is Date => value instanceof Date);
      const addedDates = episodes
        .map((episode) => episode.watchEvents[0]?.createdAt)
        .filter((value): value is Date => value instanceof Date);
      const lastWatchedAt = watchedDates.length > 0
        ? new Date(Math.max(...watchedDates.map((value) => value.getTime())))
        : null;
      const lastAddedAt = addedDates.length > 0
        ? new Date(Math.max(...addedDates.map((value) => value.getTime())))
        : new Date(0);

      seasons.push({
        id: `season:${show.id}:${seasonNumber}`,
        title: `${show.title} - Staffel ${seasonNumber}`,
        type: "season",
        year: firstKnownYear(episodes) ?? show.year,
        genres: show.genres,
        cast: show.cast,
        seasonNumber,
        watchedAt: lastWatchedAt?.toISOString() ?? null,
        addedAt: lastAddedAt.toISOString(),
        posterUrl: posterUrlForMedia(show),
      });
    }
    return seasons;
  });

  const watchedShows: CollageItem[] = Array.from(new Map(showEvents.map((event) => [event.mediaId, event])).values())
    .filter((event) => showMergeKeys(event.media).every((key) => !showsRepresentedByEpisodes.has(key)))
    .map((event) => ({
      id: event.media.id,
      title: event.media.title,
      type: "show",
      year: event.media.year,
      genres: event.media.genres,
      cast: event.media.cast,
      seasonNumber: null,
      watchedAt: (event.watchedAt ?? event.createdAt).toISOString(),
      addedAt: event.createdAt.toISOString(),
      posterUrl: posterUrlForMedia(event.media),
    }));

  return [...movies, ...watchedShows, ...completedSeasons]
    .sort((left, right) => Date.parse(right.addedAt) - Date.parse(left.addedAt));
}

function firstKnownYear(episodes: Array<{ year: number | null }>) {
  const years = episodes.map((episode) => episode.year).filter((year): year is number => typeof year === "number");
  return years.length > 0 ? Math.min(...years) : null;
}
