/**
 * Purpose: API process entry point.
 * Input/Output: Loads env, builds the Fastify app, and listens on APP_PORT.
 * Invariants: Startup must fail fast on invalid configuration.
 * Debugging: Check the first log lines for validated port, log level, and database errors.
 */

import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { assertStartupDependencies, logConfigLoaded, logShutdown, logStartup } from "./services/operability.js";
import { backfillManualShowWatchEvents, type ManualSeriesBackfillProgress } from "./services/manualSeriesWatch.js";

const env = loadEnv();
const app = await buildApp(env);
let shutdownStarted = false;

async function shutdown(signal: string) {
  if (shutdownStarted) {
    return;
  }

  shutdownStarted = true;
  logShutdown(app, signal);
  await app.close();
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

function logManualSeriesBackfillProgress(progress: ManualSeriesBackfillProgress) {
  if (progress.stage === "started") {
    app.log.info({
      event: "manual_series_backfill_started",
      scanned: progress.scanned,
    }, "manual_series_backfill_started");
    return;
  }

  if (progress.stage === "event_started") {
    if (progress.index === 1 || progress.total <= 10 || progress.index % 10 === 0) {
      app.log.info({
        event: "manual_series_backfill_progress",
        stage: progress.stage,
        index: progress.index,
        total: progress.total,
        showMediaId: progress.showMediaId,
      }, "manual_series_backfill_progress");
    }
    return;
  }

  if (!progress.ok) {
    app.log.warn({
      event: "manual_series_backfill_progress",
      stage: progress.stage,
      index: progress.index,
      total: progress.total,
      showMediaId: progress.showMediaId,
      reason: progress.reason,
    }, "manual_series_backfill_progress");
    return;
  }

  if (progress.total <= 10 || progress.index % 10 === 0 || progress.index === progress.total) {
    app.log.info({
      event: "manual_series_backfill_progress",
      stage: progress.stage,
      index: progress.index,
      total: progress.total,
      createdEvents: progress.createdEvents,
      skippedEvents: progress.skippedEvents,
      deletedShowEvent: progress.deletedShowEvent,
    }, "manual_series_backfill_progress");
  }
}

try {
  logConfigLoaded(app, env);
  await assertStartupDependencies(app, env);
  await app.listen({ host: "0.0.0.0", port: env.APP_PORT });
  logStartup(app, env);
  void backfillManualShowWatchEvents(app.prisma, {
    onProgress: logManualSeriesBackfillProgress,
  })
    .then((result) => {
      app.log.info({
        event: "manual_series_backfill_succeeded",
        scanned: result.scanned,
        materialized: result.materialized,
        createdEvents: result.createdEvents,
        skippedEvents: result.skippedEvents,
        deletedShowEvents: result.deletedShowEvents,
        unresolved: result.unresolved,
      }, "manual_series_backfill_succeeded");
    })
    .catch((error) => {
      app.log.warn({
        event: "manual_series_backfill_failed",
        error: error instanceof Error ? { name: error.name, message: error.message } : { message: "unknown_error" },
        nextStep: "TMDb-Integration und manuelle Serien-WatchEvents pruefen.",
      }, "manual_series_backfill_failed");
    });
} catch (error) {
  app.log.error({ error }, "WatchLog konnte nicht starten.");
  process.exit(1);
}
