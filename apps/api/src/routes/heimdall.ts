/**
 * Purpose: Public Heimdall metadata endpoint for the Unraid Deployment Broker.
 * Input/Output: Aggregated WatchLog database counts become a small JSON status payload for dashboard live stats.
 * Invariants: Never expose secrets, cookies, tokens, request bodies, raw logs, stack traces, user IDs, titles, notes, or watch history rows.
 * Debugging: Call `GET /api/heimdall/v1`; if counts are unavailable, verify `/readyz` and PostgreSQL through the Broker.
 */

import type { FastifyPluginAsync } from "fastify";

type HeimdallPayload = {
  status: "ok" | "degraded";
  summary: string;
  stats: Array<{ label: string; value: string }>;
  details: string[];
};

const visibleMediaWhere = {
  metadataSource: { not: "swipe-tmdb" },
} as const;

/**
 * Why this exists: Heimdall live stats are public inside the home dashboard.
 * Counts are useful for this app without revealing personal titles, users,
 * notes, API settings, webhook payloads, or individual watch events.
 */
export const heimdallRoutes: FastifyPluginAsync = async (app) => {
  app.get("/heimdall/v1", async (): Promise<HeimdallPayload> => {
    try {
      const [mediaCount, watchedEntryCount] = await Promise.all([
        app.prisma.media.count({ where: visibleMediaWhere }),
        app.prisma.watchEvent.count({ where: { media: visibleMediaWhere } }),
      ]);

      return {
        status: "ok",
        summary: `WatchLog online - ${mediaCount} Medien, ${watchedEntryCount} Seh-Eintraege`,
        stats: [
          { label: "Status", value: "online" },
          { label: "Medien", value: String(mediaCount) },
          { label: "Eintraege", value: String(watchedEntryCount) },
        ],
        details: ["LiveStats ohne Login verfuegbar."],
      };
    } catch {
      app.log.warn({
        event: "dependency_failed",
        dependency: "database",
        reason: "database_count_failed",
        nextStep: "WatchLog /readyz, PostgreSQL-Container und DATABASE_URL pruefen.",
      }, "heimdall_metadata_degraded");

      return {
        status: "degraded",
        summary: "WatchLog online - Datenbankmetriken aktuell nicht verfuegbar",
        stats: [
          { label: "Status", value: "online" },
        ],
        details: ["Datenbankmetriken aktuell nicht verfuegbar."],
      };
    }
  });
};
