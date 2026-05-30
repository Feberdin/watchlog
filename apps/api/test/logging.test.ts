/**
 * Purpose: Verify request-log sanitizing before secrets reach Docker logs.
 * Input/Output: Example request URLs become safe log URLs.
 * Invariants: Sensitive query values are masked, non-sensitive query values remain useful for debugging.
 * Debugging: If these tests fail after adding an integration, update apps/api/src/utils/logging.ts.
 */

import { describe, expect, it } from "vitest";
import { sanitizeRequestUrlForLog } from "../src/utils/logging.js";

describe("sanitizeRequestUrlForLog", () => {
  it("redacts webhook secrets while preserving the endpoint path", () => {
    const result = sanitizeRequestUrlForLog("/api/webhooks/jellyfin?secret=very-secret-value&itemId=movie-1");

    expect(result).toBe("/api/webhooks/jellyfin?secret=redacted&itemId=movie-1");
    expect(result).not.toContain("very-secret-value");
  });

  it("redacts common token variants in query parameters", () => {
    const result = sanitizeRequestUrlForLog("/api/callback?api_key=tmdb-secret&access-token=session-token&safe=value");

    expect(result).toBe("/api/callback?api_key=redacted&access-token=redacted&safe=value");
    expect(result).not.toContain("tmdb-secret");
    expect(result).not.toContain("session-token");
  });

  it("keeps normal query parameters unchanged", () => {
    expect(sanitizeRequestUrlForLog("/api/media?page=2&sort=title")).toBe("/api/media?page=2&sort=title");
  });
});
