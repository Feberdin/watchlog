/**
 * Purpose: API process entry point.
 * Input/Output: Loads env, builds the Fastify app, and listens on APP_PORT.
 * Invariants: Startup must fail fast on invalid configuration.
 * Debugging: Check the first log lines for validated port, log level, and database errors.
 */

import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";

const env = loadEnv();
const app = await buildApp(env);

try {
  await app.listen({ host: "0.0.0.0", port: env.APP_PORT });
} catch (error) {
  app.log.error({ error }, "WatchLog konnte nicht starten.");
  process.exit(1);
}
