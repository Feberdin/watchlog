/**
 * Purpose: Series catalog endpoints for browsing seasons/episodes, refreshing metadata, and marking old watches.
 * Input/Output: Authenticated requests sync Jellyfin/TMDb catalog, list local series, and create manual WatchEvents.
 * Invariants: Marking watched is explicit and idempotent; existing WatchEvents are not overwritten.
 * Debugging: If a season is missing, run POST /api/series/sync-jellyfin and inspect the returned count.
 */

import type { FastifyPluginAsync } from "fastify";
import { markWatchedSchema } from "@watchlog/shared";
import { getSeriesCatalog, markMediaWatched, syncJellyfinSeriesCatalog, syncJellyfinSeriesCatalogIfStale } from "../services/seriesCatalog.js";

export const seriesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/series", async (request) => {
    const user = request.requireUser();
    try {
      await syncJellyfinSeriesCatalogIfStale(app.prisma, user);
    } catch (error) {
      request.log.warn({ error: error instanceof Error ? error.message : "unknown" }, "Stale series catalog refresh failed");
    }
    return getSeriesCatalog(app.prisma, user.id);
  });

  app.post("/series/sync-jellyfin", async (request) => {
    const user = request.requireUser();
    return syncJellyfinSeriesCatalog(app.prisma, user);
  });

  app.post("/series/mark-watched", async (request) => {
    const user = request.requireUser();
    const input = markWatchedSchema.parse(request.body);
    return markMediaWatched(app.prisma, user.id, input.mediaIds, input.watchedAt);
  });
};
