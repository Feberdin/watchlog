/**
 * Purpose: Run database migrations with structured logs before starting the WatchLog API.
 * Input/Output: Container process starts Prisma migrate deploy, then the compiled server.
 * Invariants: No environment values or secrets are logged; only event names and exit codes are emitted.
 * Debugging: Search container logs for migration_started, migration_succeeded, migration_failed, and shutdown.
 */

import { spawn } from "node:child_process";
import path from "node:path";

function log(event, data = {}) {
  console.log(JSON.stringify({
    level: event.endsWith("_failed") ? "error" : "info",
    event,
    time: new Date().toISOString(),
    ...data,
  }));
}

function run(command, args) {
  const child = spawn(command, args, { stdio: "inherit" });

  return new Promise((resolve) => {
    child.on("exit", (code, signal) => {
      resolve({ code: code ?? (signal ? 1 : 0), signal });
    });
    child.on("error", (error) => {
      resolve({ code: 1, signal: null, error });
    });
  });
}

log("migration_started", {
  command: "prisma migrate deploy",
});
const prismaCli = path.resolve(process.cwd(), "../../node_modules/prisma/build/index.js");
const migration = await run("node", [prismaCli, "migrate", "deploy"]);
if (migration.code !== 0) {
  log("migration_failed", {
    exitCode: migration.code,
    signal: migration.signal,
    reason: migration.error instanceof Error ? migration.error.message : "migration_command_failed",
    nextStep: "DATABASE_URL, PostgreSQL-Erreichbarkeit und Prisma-Migrationen pruefen.",
  });
  process.exit(migration.code);
}
log("migration_succeeded");

const server = spawn("node", ["dist/server.js"], { stdio: "inherit" });

function forwardShutdown(signal) {
  log("shutdown", { signal });
  server.kill(signal);
}

process.on("SIGTERM", () => forwardShutdown("SIGTERM"));
process.on("SIGINT", () => forwardShutdown("SIGINT"));

server.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 0 : 1));
});
