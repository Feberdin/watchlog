/**
 * Purpose: Verify broker-facing health and readiness endpoints.
 * Input/Output: A fake Prisma dependency becomes HTTP responses for liveness and readiness.
 * Invariants: Health responses must not expose secrets and readiness must fail when the database fails.
 * Debugging: If these tests fail, inspect routes/health.ts and Docker healthcheck URLs.
 */

import fastify from "fastify";
import { describe, expect, it } from "vitest";
import { healthRoutes } from "../src/routes/health.js";

function buildHealthApp(queryRaw: () => Promise<unknown>) {
  const app = fastify({ logger: false });
  app.decorate("prisma", {
    $queryRaw: queryRaw,
  });
  return app.register(healthRoutes);
}

describe("healthRoutes", () => {
  it("returns a secret-free liveness payload without touching dependencies", async () => {
    const app = await buildHealthApp(async () => {
      throw new Error("should not be called");
    });

    const response = await app.inject({ method: "GET", url: "/healthz" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok" });
    expect(response.body).not.toContain("DATABASE_URL");
    await app.close();
  });

  it("returns ready when the database dependency is reachable", async () => {
    const app = await buildHealthApp(async () => 1);

    const response = await app.inject({ method: "GET", url: "/readyz" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ready", db: "ok" });
    await app.close();
  });

  it("returns unhealthy readiness when the database dependency fails", async () => {
    const app = await buildHealthApp(async () => {
      throw new Error("database unavailable");
    });

    const response = await app.inject({ method: "GET", url: "/readyz" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: "unhealthy",
      db: "error",
      reason: "database_unavailable",
    });
    expect(response.body).not.toContain("postgresql://");
    await app.close();
  });
});
