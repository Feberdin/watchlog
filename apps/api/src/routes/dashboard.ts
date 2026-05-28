/**
 * Purpose: Aggregated metrics for the Dashboard.
 * Input/Output: Authenticated GET /api/dashboard returns counts and recent WatchEvents.
 * Invariants: Metrics are scoped to the current WatchLog user.
 * Debugging: Compare counts with `/api/watch-events` for the same account.
 */

import type { FastifyPluginAsync } from "fastify";
import { isCacheablePosterUrl } from "../services/posterCache.js";

function posterUrlForMedia(media: { id: string; posterUrl: string | null }) {
  return isCacheablePosterUrl(media.posterUrl)
    ? `/api/media/${media.id}/poster.webp`
    : media.posterUrl;
}

type CollageItem = {
  id: string;
  title: string;
  type: "movie" | "season";
  year: number | null;
  watchedAt: string | null;
  posterUrl: string | null;
};

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get("/dashboard", async (request) => {
    const user = request.requireUser();
    const [events, movieCollageEvents, showsWithEpisodes, movieCount, episodeCount, rewatchCount] = await Promise.all([
      app.prisma.watchEvent.findMany({
        where: { userId: user.id, media: { metadataSource: { not: "swipe-tmdb" } } },
        include: { media: true },
        orderBy: [{ watchedAt: "desc" }, { createdAt: "desc" }],
        take: 10,
      }),
      app.prisma.watchEvent.findMany({
        where: {
          userId: user.id,
          media: {
            type: "movie",
            metadataSource: { not: "swipe-tmdb" },
          },
        },
        include: { media: true },
        orderBy: [{ watchedAt: "desc" }, { createdAt: "desc" }],
        take: 80,
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
      collage: buildDashboardCollage(movieCollageEvents, showsWithEpisodes),
      recent: events.map((event) => ({
        id: event.id,
        title: event.media.title,
        type: event.media.type,
        watchedAt: event.watchedAt?.toISOString() ?? null,
        datePrecision: event.datePrecision,
        posterUrl: posterUrlForMedia(event.media),
      })),
    };
  });
};

function buildDashboardCollage(
  movieEvents: Array<{
    mediaId: string;
    watchedAt: Date | null;
    createdAt: Date;
    media: { id: string; title: string; type: string; year: number | null; posterUrl: string | null };
  }>,
  shows: Array<{
    id: string;
    title: string;
    year: number | null;
    posterUrl: string | null;
    children: Array<{
      seasonNumber: number | null;
      year: number | null;
      watchEvents: Array<{ watchedAt: Date | null; createdAt: Date }>;
    }>;
  }>,
): CollageItem[] {
  const movies: CollageItem[] = Array.from(new Map(movieEvents.map((event) => [event.mediaId, event])).values()).map((event) => ({
    id: event.media.id,
    title: event.media.title,
    type: "movie",
    year: event.media.year,
    watchedAt: (event.watchedAt ?? event.createdAt).toISOString(),
    posterUrl: posterUrlForMedia(event.media),
  }));

  const completedSeasons = shows.flatMap((show) => {
    const episodesBySeason = new Map<number, typeof show.children>();
    for (const episode of show.children) {
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
      const lastWatchedAt = watchedDates.length > 0
        ? new Date(Math.max(...watchedDates.map((value) => value.getTime())))
        : null;

      seasons.push({
        id: `season:${show.id}:${seasonNumber}`,
        title: `${show.title} - Staffel ${seasonNumber}`,
        type: "season",
        year: firstKnownYear(episodes) ?? show.year,
        watchedAt: lastWatchedAt?.toISOString() ?? null,
        posterUrl: posterUrlForMedia(show),
      });
    }
    return seasons;
  });

  return [...movies, ...completedSeasons]
    .sort((left, right) => Date.parse(right.watchedAt ?? "1970-01-01") - Date.parse(left.watchedAt ?? "1970-01-01"))
    .slice(0, 48);
}

function firstKnownYear(episodes: Array<{ year: number | null }>) {
  const years = episodes.map((episode) => episode.year).filter((year): year is number => typeof year === "number");
  return years.length > 0 ? Math.min(...years) : null;
}
