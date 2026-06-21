/**
 * Purpose: Unit tests for dashboard poster collage grouping.
 * Input/Output: WatchEvent-like rows become unique movie, show, and completed-season collage tiles.
 * Invariants: A series represented by watched episodes must not also render a show-level duplicate.
 * Debugging: If duplicate series posters return, inspect merge keys in dashboard.ts.
 */

import { describe, expect, it } from "vitest";
import { buildDashboardCollage } from "../src/routes/dashboard.js";

describe("buildDashboardCollage", () => {
  it("hides a show-level tile when completed seasons exist for the same TMDb series", () => {
    const now = new Date("2026-06-01T12:00:00.000Z");
    const collage = buildDashboardCollage([], [{
      mediaId: "swipe-show",
      watchedAt: now,
      createdAt: now,
      media: {
        id: "swipe-show",
        title: "The Mandalorian",
        type: "show",
        year: 2019,
        genres: ["Sci-Fi"],
        cast: [],
        posterUrl: "https://image.tmdb.org/t/p/w342/mandalorian.jpg",
        tmdbId: "82856",
      },
    }], [{
      id: "catalog-show",
      tmdbId: "82856",
      title: "The Mandalorian",
      year: 2019,
      genres: ["Sci-Fi"],
      cast: [],
      posterUrl: "https://image.tmdb.org/t/p/w342/mandalorian.jpg",
      children: [
        { seasonNumber: 1, year: 2019, watchEvents: [{ watchedAt: now, createdAt: now }] },
        { seasonNumber: 1, year: 2019, watchEvents: [{ watchedAt: now, createdAt: now }] },
        { seasonNumber: 2, year: 2020, watchEvents: [{ watchedAt: now, createdAt: now }] },
        { seasonNumber: 2, year: 2020, watchEvents: [{ watchedAt: now, createdAt: now }] },
      ],
    }]);

    expect(collage.map((item) => item.id)).toEqual([
      "season:catalog-show:1",
      "season:catalog-show:2",
    ]);
    expect(collage.some((item) => item.id === "swipe-show")).toBe(false);
  });
});
