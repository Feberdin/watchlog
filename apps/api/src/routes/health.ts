/**
 * Purpose: Health endpoint for Docker, operators, and reverse proxies.
 * Input/Output: GET /api/health returns app version, database status, and server time.
 * Invariants: The endpoint does not expose secrets or user data.
 * Debugging: If `db` is `error`, check DATABASE_URL and PostgreSQL container logs.
 */

import type { FastifyPluginAsync } from "fastify";
import { APP_VERSION } from "@watchlog/shared";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => {
    let db: "ok" | "error" = "ok";

    try {
      await app.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      app.log.error({ error }, "Database health check failed");
      db = "error";
    }

    return {
      status: db === "ok" ? "ok" : "degraded",
      version: APP_VERSION,
      db,
      time: new Date().toISOString(),
    };
  });
};
