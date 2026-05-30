/**
 * Purpose: Metadata endpoints for searching and importing TMDb movie/show data.
 * Input/Output: Authenticated search/import requests return normalized metadata or create Media rows.
 * Invariants: TMDb is the only external host used here; secrets stay in Settings and are never returned.
 * Debugging: First run /api/settings/tmdb/test, then inspect search errors for missing token or bad title/year.
 */

import type { FastifyPluginAsync } from "fastify";
import type { Media } from "@prisma/client";
import { tmdbBulkJellyseerrRequestSchema, tmdbImportSchema, tmdbSearchSchema } from "@watchlog/shared";
import { getSetting } from "../services/settings.js";
import { getTmdbDetails, searchTmdb, type TmdbSettingsForClient } from "../services/tmdbClient.js";
import { requestMediaInJellyseerr } from "../services/swipe.js";

const tmdbDefaults = {
  tmdbBearerToken: null,
  preferredLanguage: "de-DE",
  fallbackLanguage: "en-US",
  imageBaseUrl: "https://image.tmdb.org/t/p",
};

async function upsertTmdbMedia(app: Parameters<FastifyPluginAsync>[0], input: { type: "movie" | "show"; tmdbId: number }): Promise<Media> {
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
    genres: detail.genres,
    cast: detail.cast,
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

  return app.prisma.media.create({ data });
}

export const metadataRoutes: FastifyPluginAsync = async (app) => {
  app.get("/metadata/tmdb/search", async (request) => {
    request.requireUser();
    const query = tmdbSearchSchema.parse(request.query);
    const settings = await getSetting(app.prisma, "tmdb", tmdbDefaults);

    return searchTmdb(settings as TmdbSettingsForClient, query.query, query.type, query.year, { includeCast: true });
  });

  app.post("/metadata/tmdb/import", async (request, reply) => {
    request.requireUser();
    const input = tmdbImportSchema.parse(request.body);
    const existing = await app.prisma.media.findFirst({ where: { type: input.type, tmdbId: String(input.tmdbId) } });
    const media = await upsertTmdbMedia(app, input);
    if (!existing) {
      reply.code(201);
    }
    return media;
  });

  app.post("/metadata/tmdb/request-jellyseerr", async (request) => {
    request.requireUser();
    const input = tmdbBulkJellyseerrRequestSchema.parse(request.body);
    const uniqueItems = [...new Map(input.items.map((item) => [`${item.type}:${item.tmdbId}`, item])).values()];
    const results: Array<{
      type: "movie" | "show";
      tmdbId: number;
      title: string | null;
      status: "requested" | "already_requested" | "failed";
      message: string;
    }> = [];

    for (const item of uniqueItems) {
      let title: string | null = null;
      try {
        const media = await upsertTmdbMedia(app, item);
        title = media.title;
        const result = await requestMediaInJellyseerr(app.prisma, media);
        results.push({
          type: item.type,
          tmdbId: item.tmdbId,
          title,
          status: result.alreadyRequested ? "already_requested" : "requested",
          message: result.message,
        });
      } catch (error) {
        results.push({
          type: item.type,
          tmdbId: item.tmdbId,
          title,
          status: "failed",
          message: error instanceof Error ? error.message : "Jellyseerr-Anfrage ist fehlgeschlagen.",
        });
      }
    }

    return {
      requested: results.filter((result) => result.status === "requested").length,
      alreadyRequested: results.filter((result) => result.status === "already_requested").length,
      failed: results.filter((result) => result.status === "failed").length,
      results,
    };
  });
};
