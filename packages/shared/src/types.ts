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
  posterUrl: string | null;
  watchedAt: string | null;
  datePrecision: DatePrecision;
  source: WatchEventSource;
  rewatchIndex: number;
  note: string | null;
};

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
