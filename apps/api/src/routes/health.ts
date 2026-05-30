/**
 * Purpose: Health and readiness endpoints for Docker, operators, reverse proxies, and the deployment broker.
 * Input/Output: GET /healthz is liveness; GET /readyz checks database readiness; GET /api/health remains compatible.
 * Invariants: Endpoints never expose secrets, connection strings, cookies, or user data.
 * Debugging: If readiness is unhealthy, check DATABASE_URL, PostgreSQL container health, and migration logs.
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { APP_VERSION } from "@watchlog/shared";

type HealthState = "ready" | "degraded" | "unhealthy";

let lastLoggedState: HealthState | null = null;

async function databaseStatus(app: FastifyInstance) {
  try {
    await app.prisma.$queryRaw`SELECT 1`;
    return "ok" as const;
  } catch (error) {
    app.log.error({
      event: "dependency_failed",
      dependency: "database",
      reason: error instanceof Error ? error.message : "unknown_error",
      nextStep: "DATABASE_URL, PostgreSQL-Containerstatus und Migrationen pruefen.",
    }, "dependency_failed");
    return "error" as const;
  }
}

function logHealthTransition(app: FastifyInstance, state: HealthState, db: "ok" | "error") {
  if (lastLoggedState === state) {
    return;
  }

  lastLoggedState = state;
  const level = state === "ready" ? "info" : state === "degraded" ? "warn" : "error";
  app.log[level]({
    event: `health_${state}`,
    status: state,
    db,
    nextStep: db === "error" ? "PostgreSQL-Container und DATABASE_URL pruefen." : "Keine Aktion erforderlich.",
  }, `health_${state}`);
}

function baseHealthPayload() {
  return {
    version: APP_VERSION,
    time: new Date().toISOString(),
  };
}

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/healthz", async () => ({
    status: "ok",
    ...baseHealthPayload(),
  }));

  app.get("/readyz", async (_request, reply) => {
    const db = await databaseStatus(app);
    const ready = db === "ok";
    logHealthTransition(app, ready ? "ready" : "unhealthy", db);
    if (!ready) {
      reply.code(503);
    }
    return {
      status: ready ? "ready" : "unhealthy",
      db,
      reason: ready ? null : "database_unavailable",
      nextStep: ready ? null : "PostgreSQL-Container, DATABASE_URL und Migrationen pruefen.",
      ...baseHealthPayload(),
    };
  });

  app.get("/health", async () => {
    const db = await databaseStatus(app);
    logHealthTransition(app, db === "ok" ? "ready" : "degraded", db);

    return {
      status: db === "ok" ? "ok" : "degraded",
      db,
      ...baseHealthPayload(),
    };
  });
};
