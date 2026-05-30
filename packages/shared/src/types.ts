/**
 * Purpose: Shared TypeScript types for WatchLog API contracts.
 * Input/Output: API and web imports use these types for consistent object shapes.
 * Invariants: Types mirror public contracts, not private Prisma implementation details.
 * Debugging: When a route response changes, update the corresponding type here.
 */

import type { DATE_PRECISIONS, MEDIA_TYPES, WATCH_EVENT_SOURCES } from "./constants.js";

export type DatePrecision = (typeof DATE_PRECISIONS)[number];
export type MediaType = (typeof MEDIA_TYPES)[number];
export type WatchEventSource = (typeof WATCH_EVENT_SOURCES)[number];

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "user";
  jellyfinUserId: string | null;
};

export type HealthResponse = {
  status: "ok" | "degraded";
  version: string;
  db: "ok" | "error";
  time: string;
};

export type TimelineItem = {
  id: string;
  mediaId: string;
  title: string;
  type: MediaType;
  year: number | null;
  genres: string[];
  cast: string[];
  runtimeSeconds: number | null;
  posterUrl: string | null;
  watchedAt: string | null;
  datePrecision: DatePrecision;
  source: WatchEventSource;
  rewatchIndex: number;
  note: string | null;
  seriesId: string | null;
  seriesTitle: string | null;
  seriesPosterUrl: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
};

export type TimelineMovieGroup = {
  kind: "movie";
  sortDate: string | null;
  item: TimelineItem;
};

export type TimelineSeriesGroup = {
  kind: "series";
  seriesId: string;
  seriesTitle: string;
  posterUrl: string | null;
  genres: string[];
  cast: string[];
  watchtimeSeconds: number;
  watchedEpisodes: number;
  totalEpisodes: number | null;
  isComplete: boolean | null;
  lastWatchedAt: string | null;
  episodes: TimelineItem[];
};

export type TimelineGroup = TimelineMovieGroup | TimelineSeriesGroup;

export type IntegrationTestResponse = {
  ok: boolean;
  service: "jellyfin" | "jellyseerr" | "tmdb";
  message: string;
  details?: Record<string, string | number | boolean | null>;
};

export type TmdbSearchResult = {
  type: "movie" | "show";
  tmdbId: number;
  title: string;
  originalTitle: string | null;
  year: number | null;
  genres: string[];
  cast: string[];
  overview: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
};

export type JellyfinWatchedImportResult = {
  ok: true;
  source: "jellyfin";
  userId: string;
  jellyfinUserId: string;
  totalItems: number;
  imported: number;
  skipped: number;
  failed: number;
  message: string;
};

export type SeriesEpisode = {
  id: string;
  title: string;
  year: number | null;
  genres: string[];
  cast: string[];
  seasonNumber: number | null;
  episodeNumber: number | null;
  watched: boolean;
  watchedAt: string | null;
  posterUrl: string | null;
};

export type SeriesSeason = {
  seasonNumber: number | null;
  startYear: number | null;
  genres: string[];
  cast: string[];
  episodes: SeriesEpisode[];
  watchedEpisodes: number;
  totalEpisodes: number;
  complete: boolean;
};

export type SeriesCatalogItem = {
  id: string;
  title: string;
  startYear: number | null;
  genres: string[];
  cast: string[];
  posterUrl: string | null;
  watchedEpisodes: number;
  totalEpisodes: number;
  complete: boolean;
  seasons: SeriesSeason[];
};

export type SwipeCandidate = {
  id: string;
  type: "movie" | "show";
  title: string;
  year: number | null;
  genres: string[];
  cast: string[];
  overview: string | null;
  runtimeSeconds: number | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  tmdbId: string | null;
  jellyfinItemId: string | null;
  recommendationBucket: "new" | "classic" | "random" | null;
  voteAverage: number | null;
  voteCount: number | null;
  trailerUrl: string | null;
  trailerSite: string | null;
};

export type SwipeActionResult = {
  ok: true;
  action: "seen" | "skip" | "want";
  mediaId: string;
  message: string;
  jellyfinSynced: boolean;
  jellyseerrRequested: boolean;
};

export type SwipeHistoryItem = {
  decisionId: string;
  mediaId: string;
  action: "seen" | "skip" | "want";
  externalStatus: string | null;
  errorMessage: string | null;
  decidedAt: string;
  title: string;
  type: "movie" | "show";
  year: number | null;
  genres: string[];
  cast: string[];
  posterUrl: string | null;
  tmdbId: string | null;
};

export type CinemaMemoryCandidate = {
  id: string;
  title: string;
  year: number | null;
  genres: string[];
  cast: string[];
  overview: string | null;
  posterUrl: string | null;
  tmdbId: string | null;
  status: "open" | "seen" | "want" | "skip";
  voteAverage: number | null;
  voteCount: number | null;
};

export type TmdbJellyseerrBulkRequestResult = {
  requested: number;
  alreadyRequested: number;
  failed: number;
  results: Array<{
    type: "movie" | "show";
    tmdbId: number;
    title: string | null;
    status: "requested" | "already_requested" | "failed";
    message: string;
  }>;
};
