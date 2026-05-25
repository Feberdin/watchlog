/**
 * Purpose: Aggregated metrics for the Dashboard.
 * Input/Output: Authenticated GET /api/dashboard returns counts and recent WatchEvents.
 * Invariants: Metrics are scoped to the current WatchLog user.
 * Debugging: Compare counts with `/api/watch-events` for the same account.
 */

import type { FastifyPluginAsync } from "fastify";

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get("/dashboard", async (request) => {
    const user = request.requireUser();
    const [events, movieCount, episodeCount, rewatchCount] = await Promise.all([
      app.prisma.watchEvent.findMany({
        where: { userId: user.id },
        include: { media: true },
        orderBy: [{ watchedAt: "desc" }, { createdAt: "desc" }],
        take: 10,
      }),
      app.prisma.watchEvent.count({ where: { userId: user.id, media: { type: "movie" } } }),
      app.prisma.watchEvent.count({ where: { userId: user.id, media: { type: "episode" } } }),
      app.prisma.watchEvent.count({ where: { userId: user.id, rewatchIndex: { gt: 1 } } }),
    ]);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayCount = await app.prisma.watchEvent.count({
      where: { userId: user.id, watchedAt: { gte: todayStart } },
    });

    return {
      metrics: {
        today: todayCount,
        movies: movieCount,
        episodes: episodeCount,
        rewatches: rewatchCount,
      },
      recent: events.map((event) => ({
        id: event.id,
        title: event.media.title,
        type: event.media.type,
        watchedAt: event.watchedAt?.toISOString() ?? null,
        datePrecision: event.datePrecision,
        posterUrl: event.media.posterUrl,
      })),
    };
  });
};
