/**
 * Purpose: Configure Jellyfin, Jellyseerr, and TMDb integration settings.
 * Input/Output: Authenticated admins read masked settings and write validated JSON settings.
 * Invariants: Secrets are never returned in cleartext; sync-back remains disabled unless explicitly set.
 * Debugging: Use the test endpoints after saving URLs and tokens.
 */

import type { FastifyPluginAsync } from "fastify";
import { jellyfinSettingsSchema, jellyseerrSettingsSchema, tmdbSettingsSchema } from "@watchlog/shared";
import type { IntegrationTestResponse } from "@watchlog/shared";
import { getSetting, maskSettings, saveSetting } from "../services/settings.js";
import { listJellyfinUsers, testJellyfinConnection } from "../services/jellyfinClient.js";
import { testJellyseerrConnection } from "../services/jellyseerrClient.js";
import { testTmdbConnection, type TmdbSettingsForClient } from "../services/tmdbClient.js";

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

function preserveSecret<T extends Record<string, unknown>>(input: T, current: T, secretKey: keyof T): T {
  if ((input[secretKey] === null || input[secretKey] === undefined || input[secretKey] === "") && typeof current[secretKey] === "string" && current[secretKey].length > 0) {
    return { ...input, [secretKey]: current[secretKey] };
  }

  return input;
}

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/settings/jellyfin", async (request) => {
    request.requireUser();
    const settings = await getSetting(app.prisma, "jellyfin", jellyfinDefaults);
    return maskSettings(settings);
  });

  app.put("/settings/jellyfin", async (request) => {
    const user = request.requireUser();
    if (user.role !== "admin") {
      throw app.httpErrors.forbidden("Nur Admins koennen Jellyfin-Einstellungen aendern.");
    }

    const current = await getSetting(app.prisma, "jellyfin", jellyfinDefaults);
    const input = preserveSecret(jellyfinSettingsSchema.parse(request.body), current, "jellyfinApiKey");
    const settings = await saveSetting(app.prisma, "jellyfin", input);
    return maskSettings(settings);
  });

  app.post("/settings/jellyfin/test", async (request): Promise<IntegrationTestResponse> => {
    request.requireUser();
    const settings = await getSetting(app.prisma, "jellyfin", jellyfinDefaults);
    if (!settings.jellyfinBaseUrl) {
      throw app.httpErrors.badRequest("Jellyfin URL fehlt. Bitte erst Einstellungen speichern.");
    }

    const result = await testJellyfinConnection(settings.jellyfinBaseUrl, settings.jellyfinApiKey);
    return {
      ok: true,
      service: "jellyfin",
      message: `Jellyfin erreichbar${result.serverName ? `: ${result.serverName}` : ""}.`,
      details: {
        serverName: result.serverName,
        version: result.version,
        users: result.users.length,
      },
    };
  });

  app.get("/settings/jellyfin/users", async (request) => {
    request.requireUser();
    const settings = await getSetting(app.prisma, "jellyfin", jellyfinDefaults);
    if (!settings.jellyfinBaseUrl) {
      throw app.httpErrors.badRequest("Jellyfin URL fehlt. Bitte erst Einstellungen speichern.");
    }

    return listJellyfinUsers(settings.jellyfinBaseUrl, settings.jellyfinApiKey);
  });

  app.get("/settings/tmdb", async (request) => {
    request.requireUser();
    const settings = await getSetting(app.prisma, "tmdb", tmdbDefaults);
    return maskSettings(settings);
  });

  app.put("/settings/tmdb", async (request) => {
    const user = request.requireUser();
    if (user.role !== "admin") {
      throw app.httpErrors.forbidden("Nur Admins koennen TMDb-Einstellungen aendern.");
    }

    const current = await getSetting(app.prisma, "tmdb", tmdbDefaults);
    const input = preserveSecret(tmdbSettingsSchema.parse(request.body), current, "tmdbBearerToken");
    const settings = await saveSetting(app.prisma, "tmdb", input);
    return maskSettings(settings);
  });

  app.post("/settings/tmdb/test", async (request): Promise<IntegrationTestResponse> => {
    request.requireUser();
    const settings = await getSetting(app.prisma, "tmdb", tmdbDefaults);
    if (!settings.tmdbBearerToken) {
      throw app.httpErrors.badRequest("TMDb Bearer Token fehlt. Bitte erst Einstellungen speichern.");
    }

    const result = await testTmdbConnection(settings as TmdbSettingsForClient);
    return {
      ok: true,
      service: "tmdb",
      message: "TMDb erreichbar.",
      details: {
        imageBaseUrl: result.imageBaseUrl,
        posterSizes: result.posterSizes.length,
      },
    };
  });

  app.get("/settings/jellyseerr", async (request) => {
    request.requireUser();
    const settings = await getSetting(app.prisma, "jellyseerr", jellyseerrDefaults);
    return maskSettings(settings);
  });

  app.put("/settings/jellyseerr", async (request) => {
    const user = request.requireUser();
    if (user.role !== "admin") {
      throw app.httpErrors.forbidden("Nur Admins koennen Jellyseerr-Einstellungen aendern.");
    }

    const current = await getSetting(app.prisma, "jellyseerr", jellyseerrDefaults);
    const input = preserveSecret(jellyseerrSettingsSchema.parse(request.body), current, "jellyseerrApiKey");
    const settings = await saveSetting(app.prisma, "jellyseerr", input);
    return maskSettings(settings);
  });

  app.post("/settings/jellyseerr/test", async (request): Promise<IntegrationTestResponse> => {
    request.requireUser();
    const settings = await getSetting(app.prisma, "jellyseerr", jellyseerrDefaults);
    if (!settings.jellyseerrBaseUrl) {
      throw app.httpErrors.badRequest("Jellyseerr URL fehlt. Bitte erst Einstellungen speichern.");
    }

    const result = await testJellyseerrConnection(settings.jellyseerrBaseUrl, settings.jellyseerrApiKey);
    return {
      ok: true,
      service: "jellyseerr",
      message: "Jellyseerr erreichbar.",
      details: {
        version: result.version,
        updateAvailable: result.updateAvailable,
      },
    };
  });
};
