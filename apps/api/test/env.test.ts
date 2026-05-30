/**
 * Purpose: Verify environment parsing for security-sensitive runtime flags.
 * Input/Output: Test-only env objects are parsed into typed configuration.
 * Invariants: String "false" must stay false because Docker Compose passes env values as strings.
 * Debugging: If these tests fail, inspect apps/api/src/config/env.ts before deploying auth or registration changes.
 */

import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.js";

function baseEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    DATABASE_URL: "postgresql://watchlog:watchlog@db:5432/watchlog",
    SESSION_SECRET: "test-session-secret-32-characters",
    WEBHOOK_SECRET: "test-webhook-secret",
    ...overrides,
  };
}

describe("loadEnv", () => {
  it("parses Docker Compose string booleans without treating 'false' as true", () => {
    const env = loadEnv(baseEnv({
      REGISTRATION_ENABLED: "false",
      SECURE_COOKIES: "false",
    }));

    expect(env.REGISTRATION_ENABLED).toBe(false);
    expect(env.SECURE_COOKIES).toBe(false);
  });

  it("accepts explicit true values for boolean flags", () => {
    const env = loadEnv(baseEnv({
      REGISTRATION_ENABLED: "true",
      SECURE_COOKIES: "1",
    }));

    expect(env.REGISTRATION_ENABLED).toBe(true);
    expect(env.SECURE_COOKIES).toBe(true);
  });

  it("fails fast when required secrets are missing", () => {
    expect(() => loadEnv(baseEnv({
      DATABASE_URL: undefined,
      SESSION_SECRET: undefined,
    }))).toThrow(/DATABASE_URL|SESSION_SECRET/);
  });

  it("keeps the deployment commit available for startup logs", () => {
    const env = loadEnv(baseEnv({ APP_COMMIT: "abc123" }));

    expect(env.APP_COMMIT).toBe("abc123");
  });
});
