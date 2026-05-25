/**
 * Purpose: Seed integration settings from broker-injected environment variables.
 * Input/Output: AppEnv plus Prisma Settings rows become persisted Jellyfin/Jellyseerr/TMDb settings.
 * Invariants: Empty env values never erase existing settings; secret values are never logged or returned.
 * Debugging: Use the Integrationen page after startup to verify masked values and run connection tests.
 */

import type { PrismaClient } from "@prisma/client";
import type { AppEnv } from "../config/env.js";
import { getSetting, saveSetting } from "./settings.js";

const jellyfinDefaults = {
  jellyfinBaseUrl: null,
  jellyfinApiKey: null,
  enabledUserIds: [] as string[],
  syncBackEnabled: false,
  watchedThresholdMoviePercent: 90,
  watchedThresholdEpisodePercent: 90,
};

const tmdbDefaults = {
  tmdbBearerToken: null,
  preferredLanguage: "de-DE",
  fallbackLanguage: "en-US",
  imageBaseUrl: "https://image.tmdb.org/t/p",
};

const jellyseerrDefaults = {
  jellyseerrBaseUrl: null,
  jellyseerrApiKey: null,
};

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function seedIntegrationSettingsFromEnv(prisma: PrismaClient, env: AppEnv): Promise<void> {
  const jellyfinUrl = nonEmpty(env.JELLYFIN_URL);
  const jellyfinApiKey = nonEmpty(env.JELLYFIN_API_KEY);
  if (jellyfinUrl || jellyfinApiKey) {
    const current = await getSetting(prisma, "jellyfin", jellyfinDefaults);
    await saveSetting(prisma, "jellyfin", {
      ...current,
      jellyfinBaseUrl: jellyfinUrl ?? current.jellyfinBaseUrl,
      jellyfinApiKey: jellyfinApiKey ?? current.jellyfinApiKey,
    });
  }

  const jellyseerrUrl = nonEmpty(env.JELLYSEERR_URL);
  const jellyseerrApiKey = nonEmpty(env.JELLYSEERR_API_KEY);
  if (jellyseerrUrl || jellyseerrApiKey) {
    const current = await getSetting(prisma, "jellyseerr", jellyseerrDefaults);
    await saveSetting(prisma, "jellyseerr", {
      ...current,
      jellyseerrBaseUrl: jellyseerrUrl ?? current.jellyseerrBaseUrl,
      jellyseerrApiKey: jellyseerrApiKey ?? current.jellyseerrApiKey,
    });
  }

  const tmdbBearerToken = nonEmpty(env.TMDB_BEARER_TOKEN);
  if (tmdbBearerToken) {
    const current = await getSetting(prisma, "tmdb", tmdbDefaults);
    await saveSetting(prisma, "tmdb", {
      ...current,
      tmdbBearerToken,
    });
  }
}
