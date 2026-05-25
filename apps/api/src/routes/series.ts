/**
 * Purpose: Series catalog endpoints for browsing seasons/episodes, refreshing metadata, and marking old watches.
 * Input/Output: Authenticated requests list cached local series, explicitly sync Jellyfin/TMDb, and create manual WatchEvents.
 * Invariants: Marking watched is explicit and idempotent; existing WatchEvents are not overwritten.
 * Debugging: If a season is missing, run POST /api/series/sync-jellyfin and inspect the returned count.
 */

import type { FastifyPluginAsync } from "fastify";
import { markWatchedSchema } from "@watchlog/shared";
import { getSeriesCatalog, markMediaWatched, syncJellyfinSeriesCatalog } from "../services/seriesCatalog.js";

export const seriesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/series", async (request) => {
    const user = request.requireUser();
    const query = request.query as { includeSpecials?: string };
    return getSeriesCatalog(app.prisma, user.id, { includeSpecials: query.includeSpecials === "true" });
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
