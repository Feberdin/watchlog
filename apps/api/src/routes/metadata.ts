/**
 * Purpose: Metadata endpoints for searching and importing TMDb movie/show data.
 * Input/Output: Authenticated search/import requests return normalized metadata or create Media rows.
 * Invariants: TMDb is the only external host used here; secrets stay in Settings and are never returned.
 * Debugging: First run /api/settings/tmdb/test, then inspect search errors for missing token or bad title/year.
 */

import type { FastifyPluginAsync } from "fastify";
import { tmdbImportSchema, tmdbSearchSchema } from "@watchlog/shared";
import { getSetting } from "../services/settings.js";
import { getTmdbDetails, searchTmdb, type TmdbSettingsForClient } from "../services/tmdbClient.js";

const tmdbDefaults = {
  tmdbBearerToken: null,
  preferredLanguage: "de-DE",
  fallbackLanguage: "en-US",
  imageBaseUrl: "https://image.tmdb.org/t/p",
};

export const metadataRoutes: FastifyPluginAsync = async (app) => {
  app.get("/metadata/tmdb/search", async (request) => {
    request.requireUser();
    const query = tmdbSearchSchema.parse(request.query);
    const settings = await getSetting(app.prisma, "tmdb", tmdbDefaults);

    return searchTmdb(settings as TmdbSettingsForClient, query.query, query.type, query.year);
  });

  app.post("/metadata/tmdb/import", async (request, reply) => {
    const user = request.requireUser();
    if (user.role !== "admin") {
      throw app.httpErrors.forbidden("Nur Admins koennen TMDb-Medien importieren.");
    }

    const input = tmdbImportSchema.parse(request.body);
    const settings = await getSetting(app.prisma, "tmdb", tmdbDefaults);
    const detail = await getTmdbDetails(settings as TmdbSettingsForClient, input.type, input.tmdbId);
    const existing = await app.prisma.media.findFirst({
      where: {
        type: input.type,
        tmdbId: String(input.tmdbId),
      },
    });

    const data = {
      type: input.type,
      title: detail.title,
      originalTitle: detail.originalTitle,
      year: detail.year,
      overview: detail.overview,
      runtimeSeconds: detail.runtimeSeconds,
      tmdbId: String(input.tmdbId),
      imdbId: detail.imdbId,
      posterPath: detail.posterPath,
      backdropPath: detail.backdropPath,
      posterUrl: detail.posterUrl,
      backdropUrl: detail.backdropUrl,
      metadataSource: "tmdb",
      metadataLastSyncedAt: new Date(),
    };

    if (existing) {
      return app.prisma.media.update({
        where: { id: existing.id },
        data,
      });
    }

    reply.code(201);
    return app.prisma.media.create({ data });
  });
};
