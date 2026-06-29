/**
 * Purpose: Verify the public Heimdall metadata endpoint.
 * Input/Output: Mocked aggregate database counts become a small dashboard JSON payload.
 * Invariants: The endpoint is session-free and must not expose secrets, users, titles, notes, logs, stack traces, or request data.
 * Debugging: If these tests fail, inspect routes/heimdall.ts and the Auth plugin public-path allowlist.
 */

import fastify from "fastify";
import { describe, expect, it } from "vitest";
import { heimdallRoutes } from "../src/routes/heimdall.js";

function buildHeimdallApp(mediaCount: number, watchedEntryCount: number) {
  const app = fastify({ logger: false });
  app.decorate("prisma", {
    media: {
      count: async () => mediaCount,
    },
    watchEvent: {
      count: async () => watchedEntryCount,
    },
  });
  return app.register(heimdallRoutes, { prefix: "/api" });
}

describe("heimdallRoutes", () => {
  it("returns a small happy-path payload without a browser session", async () => {
    const app = await buildHeimdallApp(331, 430);

    const response = await app.inject({ method: "GET", url: "/api/heimdall/v1" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      summary: "WatchLog online - 331 Medien, 430 Seh-Eintraege",
      stats: [
        { label: "Status", value: "online" },
        { label: "Medien", value: "331" },
        { label: "Eintraege", value: "430" },
      ],
      details: ["LiveStats ohne Login verfuegbar."],
    });
    await app.close();
  });

  it("always includes at least one stat entry", async () => {
    const app = await buildHeimdallApp(0, 0);

    const response = await app.inject({ method: "GET", url: "/api/heimdall/v1" });
    const body = response.json() as { stats: unknown[] };

    expect(response.statusCode).toBe(200);
    expect(body.stats.length).toBeGreaterThanOrEqual(1);
    await app.close();
  });

  it("does not expose sensitive fields or private raw data", async () => {
    const app = await buildHeimdallApp(12, 34);

    const response = await app.inject({ method: "GET", url: "/api/heimdall/v1" });
    const body = response.body.toLowerCase();

    expect(response.statusCode).toBe(200);
    expect(body).not.toContain("secret");
    expect(body).not.toContain("token");
    expect(body).not.toContain("cookie");
    expect(body).not.toContain("api_key");
    expect(body).not.toContain("apikey");
    expect(body).not.toContain("password");
    expect(body).not.toContain("authorization");
    expect(body).not.toContain("stack");
    expect(body).not.toContain("trace");
    expect(body).not.toContain("request");
    expect(body).not.toContain("body");
    expect(body).not.toContain("email");
    expect(body).not.toContain("userid");
    expect(body).not.toContain("title");
    expect(body).not.toContain("note");
    await app.close();
  });
});
