/**
 * Purpose: Verify repair of manual show-level WatchEvents into episode WatchEvents.
 * Input/Output: Fake Prisma rows plus a fake TMDb refresh become created episode events and a removed show event.
 * Invariants: Only selected seasons are marked watched, and existing episode events are never duplicated.
 * Debugging: If this fails, inspect manualSeriesWatch.ts before touching dashboard rendering.
 */

import { describe, expect, it } from "vitest";
import { materializeManualShowWatchEvent } from "../src/services/manualSeriesWatch.js";

describe("materializeManualShowWatchEvent", () => {
  it("replaces one manual show event with selected season episode events", async () => {
    const createdWatchEvents: unknown[] = [];
    const deletedShowEvents: unknown[] = [];
    const episodes = [
      { id: "episode-s1", seasonNumber: 1 },
      { id: "episode-s2", seasonNumber: 2 },
      { id: "episode-s3", seasonNumber: 3 },
    ];
    const showEvent = {
      id: "watch-show",
      userId: "user-1",
      mediaId: "show-1",
      source: "manual",
      watchedAt: new Date("2024-01-01T00:00:00.000Z"),
      datePrecision: "year",
      note: "gesehen",
      rating: 8,
      media: {
        id: "show-1",
        type: "show",
        title: "Loki",
        year: 2021,
        overview: null,
        genres: ["Sci-Fi"],
        cast: [],
        runtimeSeconds: null,
        tmdbId: "84958",
        imdbId: null,
        tvdbId: null,
        posterUrl: null,
        backdropUrl: null,
        metadataSource: "tmdb",
      },
    };
    const prisma = {
      media: {
        findFirst: async () => null,
        findMany: async ({ where }: { where: { seasonNumber: { in?: number[]; gt?: number } } }) => episodes
          .filter((episode) => where.seasonNumber.in ? where.seasonNumber.in.includes(episode.seasonNumber) : episode.seasonNumber > (where.seasonNumber.gt ?? 0)),
      },
      watchEvent: {
        findUnique: async () => showEvent,
        findMany: async () => [{ mediaId: "episode-s3" }],
        findFirst: async () => null,
        create: async ({ data }: { data: unknown }) => {
          createdWatchEvents.push(data);
          return { id: `created-${createdWatchEvents.length}`, ...data };
        },
        deleteMany: async ({ where }: { where: unknown }) => {
          deletedShowEvents.push(where);
          return { count: 1 };
        },
      },
    };

    const result = await materializeManualShowWatchEvent(prisma as never, {
      tmdbBearerToken: "available",
      preferredLanguage: "de-DE",
      fallbackLanguage: "en-US",
      imageBaseUrl: "https://image.tmdb.org/t/p",
    }, "watch-show", {
      seasonNumbers: [1, 3],
      refreshCatalog: async () => ({
        found: true,
        tmdbId: 84958,
        runtimeSeconds: null,
        seasonCount: 3,
        episodeCount: 18,
        missingRuntimeEpisodes: 0,
        createdEpisodes: 0,
        updatedEpisodes: 0,
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      reason: "materialized",
      selectedSeasons: [1, 3],
      createdEvents: 1,
      skippedEvents: 1,
      episodeCount: 2,
      deletedShowEvent: true,
    });
    expect(createdWatchEvents).toEqual([expect.objectContaining({
      mediaId: "episode-s1",
      watchedAt: showEvent.watchedAt,
      datePrecision: "year",
      note: "gesehen",
      rating: 8,
    })]);
    expect(deletedShowEvents).toHaveLength(1);
  });
});
