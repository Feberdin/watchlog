/**
 * Purpose: Emit operator-facing startup, config, dependency, and shutdown signals for broker deployments.
 * Input/Output: Validated app config and Fastify dependencies become structured, secret-free log events.
 * Invariants: Secret values are never logged; only availability states are emitted.
 * Debugging: Search logs for `event` values such as `config_loaded`, `dependency_failed`, or `shutdown`.
 */

import { constants as fsConstants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { APP_VERSION } from "@watchlog/shared";
import type { AppEnv } from "../config/env.js";

function secretStatus(value: string | null | undefined) {
  return value && value.trim() ? "available" : "missing";
}

function integrationStatus(parts: Record<string, string | null | undefined>) {
  const statuses = Object.fromEntries(
    Object.entries(parts).map(([key, value]) => [key, secretStatus(value)]),
  );
  const enabled = Object.values(statuses).every((status) => status === "available");
  return { enabled, ...statuses };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "unknown_error";
}

export function logConfigLoaded(app: FastifyInstance, env: AppEnv) {
  app.log.info({
    event: "config_loaded",
    environment: env.NODE_ENV,
    appUrlConfigured: secretStatus(env.APP_URL),
    integrations: {
      jellyfin: integrationStatus({
        url: env.JELLYFIN_URL,
        apiKey: env.JELLYFIN_API_KEY,
      }),
      jellyseerr: integrationStatus({
        url: env.JELLYSEERR_URL,
        apiKey: env.JELLYSEERR_API_KEY,
      }),
      tmdb: integrationStatus({
        bearerToken: env.TMDB_BEARER_TOKEN,
      }),
    },
    registrationEnabled: env.REGISTRATION_ENABLED,
    secureCookies: env.SECURE_COOKIES,
  }, "config_loaded");
}

export function logStartup(app: FastifyInstance, env: AppEnv) {
  app.log.info({
    event: "startup",
    version: APP_VERSION,
    commit: env.APP_COMMIT,
    port: env.APP_PORT,
    environment: env.NODE_ENV,
  }, "startup");
}

async function assertDatabaseReady(app: FastifyInstance) {
  try {
    await app.prisma.$queryRaw`SELECT 1`;
    app.log.info({
      event: "dependency_ready",
      dependency: "database",
      nextCheck: "Bei Fehlern DATABASE_URL und PostgreSQL-Containerstatus pruefen.",
    }, "dependency_ready");
  } catch (error) {
    app.log.error({
      event: "dependency_failed",
      dependency: "database",
      reason: errorMessage(error),
      nextStep: "DATABASE_URL, PostgreSQL-Containerstatus und Migrationen pruefen.",
    }, "dependency_failed");
    throw error;
  }
}

async function assertCacheReady(app: FastifyInstance, cacheDir: string) {
  try {
    await mkdir(cacheDir, { recursive: true });
    await access(cacheDir, fsConstants.R_OK | fsConstants.W_OK);
    app.log.info({
      event: "dependency_ready",
      dependency: "cache",
      path: cacheDir,
      nextCheck: "Bei Fehlern Volume-Mount und Schreibrechte pruefen.",
    }, "dependency_ready");
  } catch (error) {
    app.log.error({
      event: "dependency_failed",
      dependency: "cache",
      reason: errorMessage(error),
      nextStep: `CACHE_DIR '${cacheDir}' und Volume-Schreibrechte pruefen.`,
    }, "dependency_failed");
    throw error;
  }
}

/**
 * Why this exists: broker deployments need failures before listen to be
 * distinguishable from request-time errors. The checks are intentionally small
 * and deterministic so startup stays fast.
 */
export async function assertStartupDependencies(app: FastifyInstance, env: AppEnv) {
  await assertDatabaseReady(app);
  await assertCacheReady(app, env.CACHE_DIR);
}

export function logShutdown(app: FastifyInstance, signal: string) {
  app.log.info({
    event: "shutdown",
    signal,
  }, "shutdown");
}
