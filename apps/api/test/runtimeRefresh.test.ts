/**
 * Purpose: Unit tests for refreshing missing runtimes from TMDb.
 * Input/Output: Fake watch events and mocked TMDb responses become Media runtime updates.
 * Invariants: Only estimated runtimes are refreshed; existing known runtimes are left untouched.
 * Debugging: If refresh counts look wrong, inspect candidate filtering before the TMDb fetch.
 */

import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshEstimatedRuntimesFromTmdb } from "../src/services/runtimeRefresh.js";

const settings = {
  tmdbBearerToken: "token",
  preferredLanguage: "de-DE",
  fallbackLanguage: "en-US",
  imageBaseUrl: "https://image.tmdb.org/t/p",
};

describe("refreshEstimatedRuntimesFromTmdb", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates watched movies that currently rely on estimated runtime", async () => {
    const update = vi.fn(async (args: unknown) => args);
    const prisma = {
      watchEvent: {
        findMany: async () => [{
          durationSeconds: null,
          media: {
            id: "movie-1",
            type: "movie",
            title: "The Matrix",
            year: 1999,
            genres: [],
            cast: [],
            overview: null,
            runtimeSeconds: null,
            tmdbId: "603",
            imdbId: null,
            posterPath: null,
            backdropPath: null,
            posterUrl: null,
            backdropUrl: null,
            metadataSource: "jellyfin",
            seasonNumber: null,
            episodeNumber: null,
            parent: null,
          },
        }],
      },
      media: { update },
    } as unknown as PrismaClient;

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 603,
        title: "The Matrix",
        release_date: "1999-03-31",
        runtime: 136,
        poster_path: "/matrix.jpg",
        genres: [{ id: 28, name: "Action" }],
        credits: { cast: [{ name: "Keanu Reeves", order: 0 }] },
      }),
    } as Response);

    const result = await refreshEstimatedRuntimesFromTmdb(prisma, "user-1", settings);

    expect(result.updated).toBe(1);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "movie-1" },
      data: expect.objectContaining({
        runtimeSeconds: 8160,
        posterUrl: "https://image.tmdb.org/t/p/w342/matrix.jpg",
        metadataSource: "jellyfin+tmdb",
      }),
    }));
  });
});
