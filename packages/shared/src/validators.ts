/**
 * Purpose: Zod validators shared by API routes and UI forms.
 * Input/Output: Unknown input is parsed into typed, validated payloads or rejected with readable errors.
 * Invariants: Empty user-entered optional strings become null so database rows stay consistent.
 * Debugging: Validation failures include field paths; inspect API responses or browser network details.
 */

import { z } from "zod";
import { DATE_PRECISIONS, MEDIA_TYPES, WATCH_EVENT_SOURCES } from "./constants.js";

export const emptyStringToNull = (value: unknown) => {
  if (typeof value === "string" && value.trim() === "") {
    return null;
  }

  return value;
};

export const nullableTrimmedString = z.preprocess(
  emptyStringToNull,
  z.string().trim().min(1).nullable().optional(),
);

const genreListSchema = z.array(z.string().trim().min(1).max(80)).max(30).default([]);
const castListSchema = z.array(z.string().trim().min(1).max(120)).max(30).default([]);

export const datePrecisionSchema = z.enum(DATE_PRECISIONS);
export const mediaTypeSchema = z.enum(MEDIA_TYPES);
export const watchEventSourceSchema = z.enum(WATCH_EVENT_SOURCES);

export const registerSchema = z.object({
  email: z.string().email(),
  displayName: z.string().trim().min(1).max(120),
  password: z.string().min(10, "Passwort muss mindestens 10 Zeichen lang sein."),
  jellyfinUserId: nullableTrimmedString,
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  jellyfinUserId: nullableTrimmedString,
});

export const manualMediaSchema = z.object({
  type: mediaTypeSchema,
  title: z.string().trim().min(1).max(300),
  year: z.number().int().min(1888).max(2200).nullable().optional(),
  tmdbId: nullableTrimmedString,
  imdbId: nullableTrimmedString,
  jellyfinItemId: nullableTrimmedString,
  overview: nullableTrimmedString,
  genres: genreListSchema,
  cast: castListSchema,
  runtimeSeconds: z.number().int().positive().nullable().optional(),
  posterUrl: nullableTrimmedString,
});

export const manualWatchEventSchema = z.object({
  mediaId: z.string().cuid().optional(),
  media: manualMediaSchema.optional(),
  seasonNumbers: z.array(z.number().int().min(1).max(1000)).max(100).optional(),
  watchedAt: z.preprocess(emptyStringToNull, z.string().trim().min(1).nullable().optional()),
  datePrecision: datePrecisionSchema,
  note: nullableTrimmedString,
  rating: z.number().min(0).max(10).nullable().optional(),
}).refine((value) => value.mediaId || value.media, {
  message: "Entweder mediaId oder media muss angegeben werden.",
  path: ["mediaId"],
});

export const mediaRuntimeUpdateSchema = z.object({
  runtimeSeconds: z.number().int().min(60).max(24 * 60 * 60).nullable(),
});

export const tmdbRuntimeRefreshSchema = z.object({
  limit: z.number().int().min(1).max(1000).optional(),
});

export const jellyfinSettingsSchema = z.object({
  jellyfinBaseUrl: z.string().url().nullable().optional(),
  jellyfinApiKey: nullableTrimmedString,
  enabledUserIds: z.array(z.string().min(1)).default([]),
  syncBackEnabled: z.boolean().default(false),
  watchedThresholdMoviePercent: z.number().int().min(1).max(100).default(90),
  watchedThresholdEpisodePercent: z.number().int().min(1).max(100).default(90),
});

export const tmdbSettingsSchema = z.object({
  tmdbBearerToken: nullableTrimmedString,
  preferredLanguage: z.string().min(2).default("de-DE"),
  fallbackLanguage: z.string().min(2).default("en-US"),
  imageBaseUrl: z.string().url().default("https://image.tmdb.org/t/p"),
});

export const jellyseerrSettingsSchema = z.object({
  jellyseerrBaseUrl: z.string().url().nullable().optional(),
  jellyseerrApiKey: nullableTrimmedString,
});

export const tmdbSearchSchema = z.object({
  query: z.string().trim().min(1).max(200),
  type: z.enum(["movie", "show"]),
  year: z.coerce.number().int().min(1888).max(2200).nullable().optional(),
});

export const tmdbImportSchema = z.object({
  type: z.enum(["movie", "show"]),
  tmdbId: z.coerce.number().int().positive(),
});

export const tmdbBulkJellyseerrRequestSchema = z.object({
  items: z.array(tmdbImportSchema).min(1).max(50),
});

export const markWatchedSchema = z.object({
  mediaIds: z.array(z.string().cuid()).min(1).max(500),
  watchedAt: z.preprocess(emptyStringToNull, z.string().trim().min(1).nullable().optional()),
});

export const swipeCandidateQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  type: z.enum(["movie", "show", "all"]).default("all"),
});

export const swipeActionSchema = z.object({
  mediaId: z.string().cuid(),
  action: z.enum(["seen", "skip", "want"]),
});

export const cinemaCandidatesQuerySchema = z.object({
  birthYear: z.coerce.number().int().min(1900).max(2020),
  startAge: z.coerce.number().int().min(0).max(99).default(10),
  endAge: z.coerce.number().int().min(0).max(99).default(24),
  limit: z.coerce.number().int().min(10).max(100).default(100),
}).refine((value) => value.endAge >= value.startAge, {
  message: "Das Endalter muss groesser oder gleich dem Startalter sein.",
  path: ["endAge"],
});

export const cinemaActionSchema = z.object({
  mediaId: z.string().cuid(),
  action: z.enum(["seen", "skip", "want"]),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ManualMediaInput = z.infer<typeof manualMediaSchema>;
export type ManualWatchEventInput = z.infer<typeof manualWatchEventSchema>;
export type MediaRuntimeUpdateInput = z.infer<typeof mediaRuntimeUpdateSchema>;
export type TmdbRuntimeRefreshInput = z.infer<typeof tmdbRuntimeRefreshSchema>;
export type JellyfinSettingsInput = z.infer<typeof jellyfinSettingsSchema>;
export type TmdbSettingsInput = z.infer<typeof tmdbSettingsSchema>;
export type JellyseerrSettingsInput = z.infer<typeof jellyseerrSettingsSchema>;
export type TmdbSearchInput = z.infer<typeof tmdbSearchSchema>;
export type TmdbImportInput = z.infer<typeof tmdbImportSchema>;
export type TmdbBulkJellyseerrRequestInput = z.infer<typeof tmdbBulkJellyseerrRequestSchema>;
export type MarkWatchedInput = z.infer<typeof markWatchedSchema>;
export type SwipeCandidateQueryInput = z.infer<typeof swipeCandidateQuerySchema>;
export type SwipeActionInput = z.infer<typeof swipeActionSchema>;
export type CinemaCandidatesQueryInput = z.infer<typeof cinemaCandidatesQuerySchema>;
export type CinemaActionInput = z.infer<typeof cinemaActionSchema>;
