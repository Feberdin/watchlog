/**
 * Purpose: Unit tests for TMDb metadata normalization helpers and TV catalog loading.
 * Input/Output: Image paths and mocked TMDb responses become browser-ready metadata.
 * Invariants: Missing image paths stay null; callers should not render broken URLs.
 * Debugging: If poster images or missing episodes break in the UI, verify TMDb image settings and mocked response shapes.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTmdbImageUrl, getTmdbSeasonEpisodes, getTmdbSwipeRecommendations, getTmdbTvCatalog } from "../src/services/tmdbClient.js";

describe("buildTmdbImageUrl", () => {
  it("builds a TMDb image URL with a size segment", () => {
    expect(buildTmdbImageUrl("https://image.tmdb.org/t/p/", "/poster.jpg", "w342"))
      .toBe("https://image.tmdb.org/t/p/w342/poster.jpg");
  });

  it("returns null when TMDb has no image path", () => {
    expect(buildTmdbImageUrl("https://image.tmdb.org/t/p", null)).toBeNull();
  });
});

describe("TMDb TV catalog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes show seasons and season episodes", async () => {
    const settings = {
      tmdbBearerToken: "token",
      preferredLanguage: "de-DE",
      fallbackLanguage: "en-US",
      imageBaseUrl: "https://image.tmdb.org/t/p",
    };

    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 66732,
          name: "Stranger Things",
          first_air_date: "2016-07-15",
          poster_path: "/show.jpg",
          external_ids: { imdb_id: "tt4574334", tvdb_id: 305288 },
          seasons: [{ id: 1, name: "Staffel 1", season_number: 1, air_date: "2016-07-15", episode_count: 8 }],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 11,
          season_number: 1,
          episodes: [{ id: 101, name: "Kapitel eins", season_number: 1, episode_number: 1, air_date: "2016-07-15", runtime: 49 }],
        }),
      } as Response);

    const catalog = await getTmdbTvCatalog(settings, 66732);
    const episodes = await getTmdbSeasonEpisodes(settings, 66732, 1);
    const firstUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));

    expect(catalog).toMatchObject({
      title: "Stranger Things",
      startYear: 2016,
      imdbId: "tt4574334",
      tvdbId: "305288",
    });
    expect(catalog.seasons[0]).toMatchObject({ seasonNumber: 1, startYear: 2016, episodeCount: 8 });
    expect(episodes[0]).toMatchObject({ title: "Kapitel eins", seasonNumber: 1, episodeNumber: 1, year: 2016, runtimeSeconds: 2940 });
    expect(firstUrl.searchParams.get("append_to_response")).toBe("external_ids");
  });
});

describe("TMDb swipe recommendations", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads ten new, ten classic, and ten random recommendations when TMDb has enough results", async () => {
    const settings = {
      tmdbBearerToken: "token",
      preferredLanguage: "de-DE",
      fallbackLanguage: "en-US",
      imageBaseUrl: "https://image.tmdb.org/t/p",
    };
    const responseFor = (prefix: string) => ({
      ok: true,
      json: async () => ({
        results: Array.from({ length: 20 }, (_, index) => ({
          id: Number(`${prefix}${index + 1}`),
          title: `Movie ${prefix}-${index + 1}`,
          name: `Show ${prefix}-${index + 1}`,
          release_date: "2026-01-01",
          first_air_date: "2026-01-01",
          poster_path: `/poster-${prefix}-${index + 1}.jpg`,
          vote_average: 8.1,
          vote_count: 1200,
        })),
      }),
    } as Response);

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(responseFor("10"))
      .mockResolvedValueOnce(responseFor("11"))
      .mockResolvedValueOnce(responseFor("20"))
      .mockResolvedValueOnce(responseFor("21"))
      .mockResolvedValueOnce(responseFor("30"))
      .mockResolvedValueOnce(responseFor("31"));

    const recommendations = await getTmdbSwipeRecommendations(settings, new Date("2026-05-25T00:00:00.000Z"));

    expect(recommendations).toHaveLength(30);
    expect(recommendations.filter((item) => item.recommendationBucket === "new")).toHaveLength(10);
    expect(recommendations.filter((item) => item.recommendationBucket === "classic")).toHaveLength(10);
    expect(recommendations.filter((item) => item.recommendationBucket === "random")).toHaveLength(10);
    expect(recommendations[0]).toMatchObject({ voteAverage: 8.1, voteCount: 1200 });
  });
});
