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
            tvdbId: null,
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

  it("recalculates watched shows from TMDb episodes and creates missing episode rows", async () => {
    const update = vi.fn(async (args: unknown) => args);
    const createdEpisodes: Array<{ id: string; title: string }> = [];
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = {
        id: `episode-${createdEpisodes.length + 1}`,
        title: String(data.title),
        year: typeof data.year === "number" ? data.year : null,
        overview: typeof data.overview === "string" ? data.overview : null,
        genres: Array.isArray(data.genres) ? data.genres : [],
        cast: Array.isArray(data.cast) ? data.cast : [],
        runtimeSeconds: typeof data.runtimeSeconds === "number" ? data.runtimeSeconds : null,
        tmdbId: typeof data.tmdbId === "string" ? data.tmdbId : null,
        posterUrl: typeof data.posterUrl === "string" ? data.posterUrl : null,
        seasonNumber: typeof data.seasonNumber === "number" ? data.seasonNumber : null,
        episodeNumber: typeof data.episodeNumber === "number" ? data.episodeNumber : null,
      };
      createdEpisodes.push(row);
      return row;
    });
    const prisma = {
      watchEvent: {
        findMany: async () => [{
          durationSeconds: null,
          media: {
            id: "show-1",
            type: "show",
            title: "Example Show",
            year: 2020,
            genres: [],
            cast: [],
            overview: null,
            runtimeSeconds: 3600,
            tmdbId: "123",
            imdbId: null,
            tvdbId: null,
            posterPath: null,
            backdropPath: null,
            posterUrl: null,
            backdropUrl: null,
            metadataSource: "tv-memory-tmdb",
            seasonNumber: null,
            episodeNumber: null,
            parent: null,
          },
        }],
      },
      media: {
        findMany: async () => [],
        update,
        create,
      },
    } as unknown as PrismaClient;

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/tv/123/season/1")) {
        return {
          ok: true,
          json: async () => ({
            episodes: [
              { id: 1001, name: "Pilot", season_number: 1, episode_number: 1, air_date: "2020-01-01", runtime: 42, still_path: "/pilot.jpg" },
              { id: 1002, name: "Second", season_number: 1, episode_number: 2, air_date: "2020-01-08", runtime: 44, still_path: null },
            ],
          }),
        } as Response;
      }
      if (url.includes("/tv/123/season/2")) {
        return {
          ok: true,
          json: async () => ({
            episodes: [
              { id: 2001, name: "Return", season_number: 2, episode_number: 1, air_date: "2021-02-01", runtime: 50, still_path: "/return.jpg" },
            ],
          }),
        } as Response;
      }
      if (url.includes("/tv/123")) {
        return {
          ok: true,
          json: async () => ({
            id: 123,
            name: "Example Show",
            original_name: "Example Show",
            first_air_date: "2020-01-01",
            overview: "A show used in tests.",
            poster_path: "/show.jpg",
            backdrop_path: "/backdrop.jpg",
            genres: [{ id: 18, name: "Drama" }],
            external_ids: { imdb_id: "tt123", tvdb_id: 456 },
            credits: { cast: [{ name: "Lead Actor", order: 0 }] },
            seasons: [
              { id: 9000, season_number: 0, name: "Specials", episode_count: 1, air_date: "2019-12-01", poster_path: "/special.jpg" },
              { id: 9001, season_number: 1, name: "Season 1", episode_count: 2, air_date: "2020-01-01", poster_path: "/s1.jpg" },
              { id: 9002, season_number: 2, name: "Season 2", episode_count: 1, air_date: "2021-02-01", poster_path: "/s2.jpg" },
            ],
          }),
        } as Response;
      }

      throw new Error(`Unexpected TMDb URL: ${url}`);
    });

    const result = await refreshEstimatedRuntimesFromTmdb(prisma, "user-1", settings);

    expect(result.candidates).toBe(1);
    expect(result.updated).toBe(1);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "show-1" },
      data: expect.objectContaining({
        runtimeSeconds: 8160,
        tvdbId: "456",
        metadataSource: "tv-memory-tmdb",
      }),
    }));
    expect(create).toHaveBeenCalledTimes(3);
    expect(createdEpisodes.map((episode) => episode.title)).toEqual(["Pilot", "Second", "Return"]);
    expect(fetchMock.mock.calls.map((call) => String(call[0])).some((url) => url.includes("/season/0"))).toBe(false);
  });
});
