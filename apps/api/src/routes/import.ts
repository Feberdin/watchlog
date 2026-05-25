/**
 * Purpose: Explicit import endpoints for historical or external watch data.
 * Input/Output: Authenticated requests trigger imports and return count summaries.
 * Invariants: Imports never run automatically and are scoped to the current WatchLog user.
 * Debugging: Start with POST /api/import/jellyfin/watched, then inspect ImportJob rows and server logs.
 */

import type { FastifyPluginAsync } from "fastify";
import { importWatchedFromJellyfin } from "../services/jellyfinImport.js";

export const importRoutes: FastifyPluginAsync = async (app) => {
  app.post("/import/jellyfin/watched", async (request) => {
    const user = request.requireUser();
    return importWatchedFromJellyfin(app.prisma, user);
  });
};
