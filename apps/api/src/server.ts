/**
 * Purpose: API process entry point.
 * Input/Output: Loads env, builds the Fastify app, and listens on APP_PORT.
 * Invariants: Startup must fail fast on invalid configuration.
 * Debugging: Check the first log lines for validated port, log level, and database errors.
 */

import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { assertStartupDependencies, logConfigLoaded, logShutdown, logStartup } from "./services/operability.js";

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

try {
  logConfigLoaded(app, env);
  await assertStartupDependencies(app, env);
  await app.listen({ host: "0.0.0.0", port: env.APP_PORT });
  logStartup(app, env);
} catch (error) {
  app.log.error({ error }, "WatchLog konnte nicht starten.");
  process.exit(1);
}
