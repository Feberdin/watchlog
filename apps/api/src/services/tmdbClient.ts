/**
 * Purpose: TMDb API client for metadata search, movie/show import, and optional TV episode catalog completion.
 * Input/Output: A bearer token plus search/import parameters become normalized WatchLog metadata.
 * Invariants: Calls are limited to api.themoviedb.org and image URLs to the configured image base.
 * Debugging: Use /api/settings/tmdb/test first; catalog gaps usually mean missing TMDb IDs on the Jellyfin series.
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
  vote_average?: number;
  vote_count?: number;
};

type TmdbShowResult = {
  id: number;
  name?: string;
  original_name?: string;
  overview?: string;
  first_air_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  vote_count?: number;
};

type TmdbVideoResult = {
  key?: string;
  name?: string;
  site?: string;
  type?: string;
  official?: boolean;
  iso_639_1?: string;
  published_at?: string;
};

type TmdbVideosResponse = {
  results?: TmdbVideoResult[];
};

type TmdbMovieDetail = TmdbMovieResult & {
  runtime?: number | null;
  imdb_id?: string | null;
};

type TmdbShowDetail = TmdbShowResult & {
  episode_run_time?: number[];
  seasons?: Array<{
    id?: number;
    name?: string;
    season_number?: number;
    air_date?: string | null;
    episode_count?: number;
    poster_path?: string | null;
  }>;
  external_ids?: {
    imdb_id?: string | null;
    tvdb_id?: number | null;
  };
};

type TmdbSeasonDetail = {
  id?: number;
  name?: string;
  season_number?: number;
  air_date?: string | null;
  poster_path?: string | null;
  episodes?: Array<{
    id?: number;
    name?: string;
    overview?: string;
    air_date?: string | null;
    runtime?: number | null;
    season_number?: number;
    episode_number?: number;
    still_path?: string | null;
  }>;
};

export type TmdbSettingsForClient = {
  tmdbBearerToken: string | null;
  preferredLanguage: string;
  fallbackLanguage: string;
  imageBaseUrl: string;
};

export type TmdbTvSeasonSummary = {
  tmdbId: number;
  seasonNumber: number;
  name: string | null;
  airDate: string | null;
  startYear: number | null;
  episodeCount: number | null;
  posterUrl: string | null;
};

export type TmdbTvEpisode = {
  tmdbId: number;
  title: string;
  overview: string | null;
  airDate: string | null;
  year: number | null;
  seasonNumber: number;
  episodeNumber: number;
  runtimeSeconds: number | null;
  posterUrl: string | null;
};

export type TmdbTvCatalog = {
  tmdbId: number;
  title: string;
  originalTitle: string | null;
  startYear: number | null;
  overview: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  imdbId: string | null;
  tvdbId: string | null;
  seasons: TmdbTvSeasonSummary[];
};

export type TmdbRecommendationBucket = "new" | "classic" | "random";

export type TmdbRecommendation = TmdbSearchResult & {
  recommendationBucket: TmdbRecommendationBucket;
  voteAverage: number | null;
  voteCount: number | null;
  trailerUrl: string | null;
  trailerSite: string | null;
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

function runtimeMinutesToSeconds(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.round(value * 60);
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

function recommendationFromResult(
  result: TmdbMovieResult | TmdbShowResult,
  type: "movie" | "show",
  bucket: TmdbRecommendationBucket,
  imageBaseUrl: string,
  trailer: { url: string; site: string } | null = null,
): TmdbRecommendation {
  const normalized = type === "movie"
    ? movieToSearchResult(result as TmdbMovieResult, imageBaseUrl)
    : showToSearchResult(result as TmdbShowResult, imageBaseUrl);

  return {
    ...normalized,
    recommendationBucket: bucket,
    voteAverage: typeof result.vote_average === "number" ? result.vote_average : null,
    voteCount: typeof result.vote_count === "number" ? result.vote_count : null,
    trailerUrl: trailer?.url ?? null,
    trailerSite: trailer?.site ?? null,
  };
}

function youtubeTrailerUrl(video: TmdbVideoResult): string | null {
  if (video.site !== "YouTube" || !video.key) {
    return null;
  }

  return `https://www.youtube.com/watch?v=${encodeURIComponent(video.key)}`;
}

function trailerScore(video: TmdbVideoResult, preferredLanguage: string, fallbackLanguage: string): number {
  let score = 0;
  if (video.type === "Trailer") score += 50;
  if (video.official) score += 20;
  if (video.site === "YouTube") score += 10;
  if (video.iso_639_1 && preferredLanguage.toLowerCase().startsWith(video.iso_639_1.toLowerCase())) score += 8;
  if (video.iso_639_1 && fallbackLanguage.toLowerCase().startsWith(video.iso_639_1.toLowerCase())) score += 4;
  if (video.published_at) score += Math.min(new Date(video.published_at).getTime() / 1_000_000_000_000, 2);
  return score;
}

function selectTrailer(videos: TmdbVideoResult[], settings: TmdbSettingsForClient): { url: string; site: string } | null {
  const candidates = videos
    .filter((video) => video.type === "Trailer" && youtubeTrailerUrl(video))
    .sort((a, b) => trailerScore(b, settings.preferredLanguage, settings.fallbackLanguage) - trailerScore(a, settings.preferredLanguage, settings.fallbackLanguage));
  const selected = candidates[0];
  const url = selected ? youtubeTrailerUrl(selected) : null;
  return selected && url ? { url, site: selected.site ?? "YouTube" } : null;
}

async function getTmdbTrailer(
  settings: TmdbSettingsForClient,
  type: "movie" | "show",
  tmdbId: number,
): Promise<{ url: string; site: string } | null> {
  const path = type === "movie" ? `/movie/${tmdbId}/videos` : `/tv/${tmdbId}/videos`;
  const response = await tmdbGet<TmdbVideosResponse>(path, settings, {
    language: settings.preferredLanguage,
  }).catch(() => null);
  const preferredTrailer = response ? selectTrailer(response.results ?? [], settings) : null;
  if (preferredTrailer) {
    return preferredTrailer;
  }

  const fallbackResponse = settings.fallbackLanguage === settings.preferredLanguage
    ? null
    : await tmdbGet<TmdbVideosResponse>(path, settings, { language: settings.fallbackLanguage }).catch(() => null);
  return fallbackResponse ? selectTrailer(fallbackResponse.results ?? [], settings) : null;
}

function isoDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function shuffled<T>(values: T[]): T[] {
  return [...values].sort(() => Math.random() - 0.5);
}

async function discoverRecommendations(
  settings: TmdbSettingsForClient,
  type: "movie" | "show",
  bucket: TmdbRecommendationBucket,
  searchParams: Record<string, string | number | undefined>,
): Promise<TmdbRecommendation[]> {
  const path = type === "movie" ? "/discover/movie" : "/discover/tv";
  const response = await tmdbGet<TmdbSearchResponse<TmdbMovieResult | TmdbShowResult>>(path, settings, {
    language: settings.preferredLanguage,
    include_adult: "false",
    include_video: type === "movie" ? "false" : undefined,
    ...searchParams,
  });

  return (response.results ?? [])
    .filter((result) => Boolean(result.poster_path))
    .map((result) => recommendationFromResult(result, type, bucket, settings.imageBaseUrl));
}

async function recommendationPool(
  settings: TmdbSettingsForClient,
  bucket: TmdbRecommendationBucket,
  now: Date,
): Promise<TmdbRecommendation[]> {
  const recentStart = new Date(now);
  recentStart.setDate(recentStart.getDate() - 180);
  const randomPage = 1 + Math.floor(Math.random() * 20);

  if (bucket === "new") {
    const [movies, shows] = await Promise.all([
      discoverRecommendations(settings, "movie", bucket, {
        sort_by: "vote_average.desc",
        "vote_count.gte": 80,
        "vote_average.gte": 7,
        "primary_release_date.gte": isoDateOnly(recentStart),
        "primary_release_date.lte": isoDateOnly(now),
        page: 1,
      }),
      discoverRecommendations(settings, "show", bucket, {
        sort_by: "vote_average.desc",
        "vote_count.gte": 80,
        "vote_average.gte": 7,
        "first_air_date.gte": isoDateOnly(recentStart),
        "first_air_date.lte": isoDateOnly(now),
        page: 1,
      }),
    ]);
    return shuffled([...movies, ...shows]);
  }

  if (bucket === "classic") {
    const [movies, shows] = await Promise.all([
      discoverRecommendations(settings, "movie", bucket, {
        sort_by: "vote_average.desc",
        "vote_count.gte": 700,
        "vote_average.gte": 7.5,
        "primary_release_date.lte": "2005-12-31",
        page: 1,
      }),
      discoverRecommendations(settings, "show", bucket, {
        sort_by: "vote_average.desc",
        "vote_count.gte": 500,
        "vote_average.gte": 7.5,
        "first_air_date.lte": "2005-12-31",
        page: 1,
      }),
    ]);
    return shuffled([...movies, ...shows]);
  }

  const [movies, shows] = await Promise.all([
    discoverRecommendations(settings, "movie", bucket, {
      sort_by: "popularity.desc",
      "vote_count.gte": 300,
      "vote_average.gte": 7,
      page: randomPage,
    }),
    discoverRecommendations(settings, "show", bucket, {
      sort_by: "popularity.desc",
      "vote_count.gte": 300,
      "vote_average.gte": 7,
      page: randomPage,
    }),
  ]);
  return shuffled([...movies, ...shows]);
}

export async function getTmdbSwipeRecommendations(settings: TmdbSettingsForClient, now = new Date()): Promise<TmdbRecommendation[]> {
  const [fresh, classics, random] = await Promise.all([
    recommendationPool(settings, "new", now),
    recommendationPool(settings, "classic", now),
    recommendationPool(settings, "random", now),
  ]);

  const recommendations = [
    ...fresh.slice(0, 10),
    ...classics.slice(0, 10),
    ...random.slice(0, 10),
  ];
  return Promise.all(recommendations.map(async (recommendation) => ({
    ...recommendation,
    ...(await getTmdbTrailer(settings, recommendation.type, recommendation.tmdbId)
      .then((trailer) => ({ trailerUrl: trailer?.url ?? null, trailerSite: trailer?.site ?? null }))),
  })));
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

function seasonSummaryFromTmdb(season: NonNullable<TmdbShowDetail["seasons"]>[number], imageBaseUrl: string): TmdbTvSeasonSummary | null {
  if (typeof season.season_number !== "number") {
    return null;
  }

  return {
    tmdbId: season.id ?? season.season_number,
    seasonNumber: season.season_number,
    name: season.name ?? null,
    airDate: season.air_date ?? null,
    startYear: yearFromDate(season.air_date ?? undefined),
    episodeCount: typeof season.episode_count === "number" ? season.episode_count : null,
    posterUrl: buildTmdbImageUrl(imageBaseUrl, season.poster_path, "w342"),
  };
}

function episodeFromTmdb(episode: NonNullable<TmdbSeasonDetail["episodes"]>[number], imageBaseUrl: string): TmdbTvEpisode | null {
  if (typeof episode.id !== "number" || typeof episode.season_number !== "number" || typeof episode.episode_number !== "number") {
    return null;
  }

  return {
    tmdbId: episode.id,
    title: episode.name?.trim() || `Episode ${episode.episode_number}`,
    overview: episode.overview ?? null,
    airDate: episode.air_date ?? null,
    year: yearFromDate(episode.air_date ?? undefined),
    seasonNumber: episode.season_number,
    episodeNumber: episode.episode_number,
    runtimeSeconds: runtimeMinutesToSeconds(episode.runtime),
    posterUrl: buildTmdbImageUrl(imageBaseUrl, episode.still_path, "w342"),
  };
}

export async function getTmdbTvCatalog(settings: TmdbSettingsForClient, tmdbId: number): Promise<TmdbTvCatalog> {
  const detail = await tmdbGet<TmdbShowDetail>(`/tv/${tmdbId}`, settings, {
    language: settings.preferredLanguage,
    append_to_response: "external_ids",
  });
  const result = showToSearchResult(detail, settings.imageBaseUrl);

  return {
    tmdbId,
    title: result.title,
    originalTitle: result.originalTitle,
    startYear: result.year,
    overview: result.overview,
    posterUrl: result.posterUrl,
    backdropUrl: result.backdropUrl,
    imdbId: detail.external_ids?.imdb_id ?? null,
    tvdbId: detail.external_ids?.tvdb_id ? String(detail.external_ids.tvdb_id) : null,
    seasons: (detail.seasons ?? [])
      .map((season) => seasonSummaryFromTmdb(season, settings.imageBaseUrl))
      .filter((season): season is TmdbTvSeasonSummary => Boolean(season)),
  };
}

export async function getTmdbSeasonEpisodes(settings: TmdbSettingsForClient, tmdbId: number, seasonNumber: number): Promise<TmdbTvEpisode[]> {
  const detail = await tmdbGet<TmdbSeasonDetail>(`/tv/${tmdbId}/season/${seasonNumber}`, settings, {
    language: settings.preferredLanguage,
  });

  return (detail.episodes ?? [])
    .map((episode) => episodeFromTmdb(episode, settings.imageBaseUrl))
    .filter((episode): episode is TmdbTvEpisode => Boolean(episode));
}
