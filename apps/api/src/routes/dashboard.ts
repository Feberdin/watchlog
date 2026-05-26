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

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get("/dashboard", async (request) => {
    const user = request.requireUser();
    const [events, collageEvents, movieCount, episodeCount, rewatchCount] = await Promise.all([
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
            metadataSource: { not: "swipe-tmdb" },
            posterUrl: { not: null },
          },
        },
        include: { media: true },
        orderBy: [{ watchedAt: "desc" }, { createdAt: "desc" }],
        take: 80,
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
      collage: Array.from(new Map(collageEvents.map((event) => [event.mediaId, event])).values()).slice(0, 48).map((event) => ({
        id: event.media.id,
        title: event.media.title,
        type: event.media.type,
        year: event.media.year,
        watchedAt: event.watchedAt?.toISOString() ?? null,
        posterUrl: posterUrlForMedia(event.media),
      })),
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
