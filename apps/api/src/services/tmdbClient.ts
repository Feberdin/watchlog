/**
 * Purpose: TMDb API client for metadata search and movie/show detail import.
 * Input/Output: A bearer token and search/import parameters become normalized WatchLog metadata.
 * Invariants: Calls are limited to api.themoviedb.org and image URLs to the configured image base.
 * Debugging: Use /api/settings/tmdb/test and /api/metadata/tmdb/search with sanitized titles.
 */

import type { TmdbSearchResult } from "@watchlog/shared";
import { fetchJson } from "./integrationHttp.js";

const TMDB_API_BASE = "https://api.themoviedb.org/3";

type TmdbConfiguration = {
  images?: {
    secure_base_url?: string;
    poster_sizes?: string[];
    backdrop_sizes?: string[];
  };
};

type TmdbSearchResponse<T> = {
  results?: T[];
};

type TmdbMovieResult = {
  id: number;
  title?: string;
  original_title?: string;
  overview?: string;
  release_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
};

type TmdbShowResult = {
  id: number;
  name?: string;
  original_name?: string;
  overview?: string;
  first_air_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
};

type TmdbMovieDetail = TmdbMovieResult & {
  runtime?: number | null;
  imdb_id?: string | null;
};

type TmdbShowDetail = TmdbShowResult & {
  episode_run_time?: number[];
};

export type TmdbSettingsForClient = {
  tmdbBearerToken: string | null;
  preferredLanguage: string;
  fallbackLanguage: string;
  imageBaseUrl: string;
};

function authHeaders(settings: TmdbSettingsForClient) {
  if (!settings.tmdbBearerToken) {
    throw new Error("TMDb: Bearer Token fehlt. Bitte in den Integrationen speichern.");
  }

  return { authorization: `Bearer ${settings.tmdbBearerToken}` };
}

function yearFromDate(value: string | undefined): number | null {
  if (!value || value.length < 4) {
    return null;
  }

  const parsed = Number(value.slice(0, 4));
  return Number.isInteger(parsed) ? parsed : null;
}

export function buildTmdbImageUrl(imageBaseUrl: string, filePath: string | null | undefined, size = "w342"): string | null {
  if (!filePath) {
    return null;
  }

  const normalizedBase = imageBaseUrl.replace(/\/+$/, "");
  const normalizedPath = filePath.startsWith("/") ? filePath : `/${filePath}`;
  return `${normalizedBase}/${size}${normalizedPath}`;
}

function movieToSearchResult(movie: TmdbMovieResult, imageBaseUrl: string): TmdbSearchResult {
  return {
    type: "movie",
    tmdbId: movie.id,
    title: movie.title ?? movie.original_title ?? `TMDb ${movie.id}`,
    originalTitle: movie.original_title ?? null,
    year: yearFromDate(movie.release_date),
    overview: movie.overview ?? null,
    posterPath: movie.poster_path ?? null,
    backdropPath: movie.backdrop_path ?? null,
    posterUrl: buildTmdbImageUrl(imageBaseUrl, movie.poster_path, "w342"),
    backdropUrl: buildTmdbImageUrl(imageBaseUrl, movie.backdrop_path, "w780"),
  };
}

function showToSearchResult(show: TmdbShowResult, imageBaseUrl: string): TmdbSearchResult {
  return {
    type: "show",
    tmdbId: show.id,
    title: show.name ?? show.original_name ?? `TMDb ${show.id}`,
    originalTitle: show.original_name ?? null,
    year: yearFromDate(show.first_air_date),
    overview: show.overview ?? null,
    posterPath: show.poster_path ?? null,
    backdropPath: show.backdrop_path ?? null,
    posterUrl: buildTmdbImageUrl(imageBaseUrl, show.poster_path, "w342"),
    backdropUrl: buildTmdbImageUrl(imageBaseUrl, show.backdrop_path, "w780"),
  };
}

async function tmdbGet<T>(path: string, settings: TmdbSettingsForClient, searchParams: Record<string, string | number | undefined> = {}) {
  const url = new URL(`${TMDB_API_BASE}${path}`);
  Object.entries(searchParams).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  return fetchJson<T>("TMDb", url.toString(), { headers: authHeaders(settings) });
}

export async function testTmdbConnection(settings: TmdbSettingsForClient): Promise<{ imageBaseUrl: string; posterSizes: string[] }> {
  const configuration = await tmdbGet<TmdbConfiguration>("/configuration", settings);
  return {
    imageBaseUrl: configuration.images?.secure_base_url ?? settings.imageBaseUrl,
    posterSizes: configuration.images?.poster_sizes ?? [],
  };
}

export async function searchTmdb(settings: TmdbSettingsForClient, query: string, type: "movie" | "show", year?: number | null) {
  const path = type === "movie" ? "/search/movie" : "/search/tv";
  const yearKey = type === "movie" ? "year" : "first_air_date_year";
  const response = await tmdbGet<TmdbSearchResponse<TmdbMovieResult | TmdbShowResult>>(path, settings, {
    query,
    language: settings.preferredLanguage,
    include_adult: "false",
    [yearKey]: year ?? undefined,
  });

  return (response.results ?? []).slice(0, 10).map((result) => (
    type === "movie"
      ? movieToSearchResult(result as TmdbMovieResult, settings.imageBaseUrl)
      : showToSearchResult(result as TmdbShowResult, settings.imageBaseUrl)
  ));
}

export async function getTmdbDetails(settings: TmdbSettingsForClient, type: "movie" | "show", tmdbId: number): Promise<TmdbSearchResult & { runtimeSeconds: number | null; imdbId: string | null }> {
  if (type === "movie") {
    const detail = await tmdbGet<TmdbMovieDetail>(`/movie/${tmdbId}`, settings, { language: settings.preferredLanguage });
    const result = movieToSearchResult(detail, settings.imageBaseUrl);
    return {
      ...result,
      runtimeSeconds: detail.runtime ? detail.runtime * 60 : null,
      imdbId: detail.imdb_id ?? null,
    };
  }

  const detail = await tmdbGet<TmdbShowDetail>(`/tv/${tmdbId}`, settings, { language: settings.preferredLanguage });
  const result = showToSearchResult(detail, settings.imageBaseUrl);
  return {
    ...result,
    runtimeSeconds: detail.episode_run_time?.[0] ? detail.episode_run_time[0] * 60 : null,
    imdbId: null,
  };
}
