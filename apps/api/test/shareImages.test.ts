/**
 * Purpose: Unit tests for social recap summaries without rendering full PNGs.
 * Input/Output: Fake Prisma watch events become category-aware recap metrics.
 * Invariants: Genre filters must match parent series genres for episode rows.
 * Debugging: If genre collages miss series, inspect `media.parent.genres` in the watch event query.
 */

import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { buildShareRecap } from "../src/services/shareImages.js";

function fakePrisma(rows: unknown[]) {
  return {
    watchEvent: {
      findMany: async () => rows,
    },
  } as unknown as PrismaClient;
}

describe("share recap summaries", () => {
  it("filters dashboard and yearly recaps by movie and parent-series genre", async () => {
    const rows = [
      {
        mediaId: "movie-1",
        watchedAt: new Date("2026-01-10T20:00:00.000Z"),
        createdAt: new Date("2026-01-10T20:00:00.000Z"),
        durationSeconds: null,
        media: {
          id: "movie-1",
          title: "Fast Laugh",
          originalTitle: null,
          type: "movie",
          year: 2026,
          genres: ["Action", "Komödie"],
          posterUrl: "https://image.tmdb.org/t/p/w342/action.jpg",
          runtimeSeconds: 6000,
          parent: null,
        },
      },
      {
        mediaId: "episode-1",
        watchedAt: new Date("2026-02-10T20:00:00.000Z"),
        createdAt: new Date("2026-02-10T20:00:00.000Z"),
        durationSeconds: null,
        media: {
          id: "episode-1",
          title: "Pilot",
          originalTitle: null,
          type: "episode",
          year: 2026,
          genres: [],
          posterUrl: null,
          runtimeSeconds: null,
          parent: {
            id: "show-1",
            title: "Quiet Drama",
            year: 2025,
            genres: ["Drama"],
            runtimeSeconds: null,
            posterUrl: "https://image.tmdb.org/t/p/w342/drama.jpg",
          },
        },
      },
    ];

    const action = await buildShareRecap(fakePrisma(rows), "user-1", { year: 2026, genre: "Action" });
    const drama = await buildShareRecap(fakePrisma(rows), "user-1", { year: 2026, genre: "Drama" });

    expect(action.summary.movies).toBe(1);
    expect(action.summary.series).toBe(0);
    expect(action.items.map((item) => item.title)).toEqual(["Fast Laugh"]);
    expect(drama.summary.movies).toBe(0);
    expect(drama.summary.series).toBe(1);
    expect(drama.summary.estimatedEvents).toBe(1);
    expect(drama.items.map((item) => item.title)).toEqual(["Quiet Drama"]);
  });

  it("keeps titles without renderable posters out of the collage grid", async () => {
    const rows = [{
      mediaId: "movie-1",
      watchedAt: new Date("2026-01-10T20:00:00.000Z"),
      createdAt: new Date("2026-01-10T20:00:00.000Z"),
      durationSeconds: null,
      media: {
        id: "movie-1",
        title: "Local Poster Only",
        originalTitle: null,
        type: "movie",
        year: 2026,
        genres: ["Drama"],
        posterUrl: "http://jellyfin.local/items/movie-1/Images/Primary",
        runtimeSeconds: 6000,
        parent: null,
      },
    }];

    const recap = await buildShareRecap(fakePrisma(rows), "user-1", { year: 2026 });

    expect(recap.summary.totalTitles).toBe(1);
    expect(recap.summary.posterCount).toBe(0);
    expect(recap.summary.posterlessCount).toBe(1);
    expect(recap.items).toEqual([]);
  });
});
