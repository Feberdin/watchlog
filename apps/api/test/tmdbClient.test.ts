/**
 * Purpose: Unit tests for TMDb metadata normalization helpers.
 * Input/Output: Image base/path inputs produce browser-ready URLs.
 * Invariants: Missing image paths stay null; callers should not render broken URLs.
 * Debugging: If poster images break in the UI, verify TMDb imageBaseUrl settings and this helper first.
 */

import { describe, expect, it } from "vitest";
import { buildTmdbImageUrl } from "../src/services/tmdbClient.js";

describe("buildTmdbImageUrl", () => {
  it("builds a TMDb image URL with a size segment", () => {
    expect(buildTmdbImageUrl("https://image.tmdb.org/t/p/", "/poster.jpg", "w342"))
      .toBe("https://image.tmdb.org/t/p/w342/poster.jpg");
  });

  it("returns null when TMDb has no image path", () => {
    expect(buildTmdbImageUrl("https://image.tmdb.org/t/p", null)).toBeNull();
  });
});
