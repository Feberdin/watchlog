/**
 * Purpose: Configure Jellyfin and TMDb integration settings.
 * Input/Output: Authenticated admins read masked settings and write validated JSON settings.
 * Invariants: Secrets are never returned in cleartext; sync-back remains disabled unless explicitly set.
 * Debugging: Use the test endpoints after saving URLs and tokens.
 */

import type { FastifyPluginAsync } from "fastify";
import { jellyfinSettingsSchema, tmdbSettingsSchema } from "@watchlog/shared";
import { getSetting, maskSettings, saveSetting } from "../services/settings.js";

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

    const input = jellyfinSettingsSchema.parse(request.body);
    const settings = await saveSetting(app.prisma, "jellyfin", input);
    return maskSettings(settings);
  });

  app.post("/settings/jellyfin/test", async (request) => {
    request.requireUser();
    const settings = await getSetting(app.prisma, "jellyfin", jellyfinDefaults);
    if (!settings.jellyfinBaseUrl) {
      throw app.httpErrors.badRequest("Jellyfin URL fehlt. Bitte erst Einstellungen speichern.");
    }

    return {
      ok: true,
      message: "Konfiguration ist syntaktisch vorhanden. Netzwerk-Test folgt in einer spaeteren Iteration.",
    };
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

    const input = tmdbSettingsSchema.parse(request.body);
    const settings = await saveSetting(app.prisma, "tmdb", input);
    return maskSettings(settings);
  });

  app.post("/settings/tmdb/test", async (request) => {
    request.requireUser();
    const settings = await getSetting(app.prisma, "tmdb", tmdbDefaults);
    if (!settings.tmdbBearerToken) {
      throw app.httpErrors.badRequest("TMDb Bearer Token fehlt. Bitte erst Einstellungen speichern.");
    }

    return {
      ok: true,
      message: "TMDb Token ist gesetzt. Voller API-Test folgt in einer spaeteren Iteration.",
    };
  });
};
