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

export const manualMediaSchema = z.object({
  type: mediaTypeSchema,
  title: z.string().trim().min(1).max(300),
  year: z.number().int().min(1888).max(2200).nullable().optional(),
  tmdbId: nullableTrimmedString,
  imdbId: nullableTrimmedString,
  jellyfinItemId: nullableTrimmedString,
  overview: nullableTrimmedString,
  runtimeSeconds: z.number().int().positive().nullable().optional(),
  posterUrl: nullableTrimmedString,
});

export const manualWatchEventSchema = z.object({
  mediaId: z.string().cuid().optional(),
  media: manualMediaSchema.optional(),
  watchedAt: z.preprocess(emptyStringToNull, z.string().trim().min(1).nullable().optional()),
  datePrecision: datePrecisionSchema,
  note: nullableTrimmedString,
  rating: z.number().min(0).max(10).nullable().optional(),
}).refine((value) => value.mediaId || value.media, {
  message: "Entweder mediaId oder media muss angegeben werden.",
  path: ["mediaId"],
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

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ManualMediaInput = z.infer<typeof manualMediaSchema>;
export type ManualWatchEventInput = z.infer<typeof manualWatchEventSchema>;
export type JellyfinSettingsInput = z.infer<typeof jellyfinSettingsSchema>;
export type TmdbSettingsInput = z.infer<typeof tmdbSettingsSchema>;
export type JellyseerrSettingsInput = z.infer<typeof jellyseerrSettingsSchema>;
export type TmdbSearchInput = z.infer<typeof tmdbSearchSchema>;
export type TmdbImportInput = z.infer<typeof tmdbImportSchema>;
