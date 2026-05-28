/**
 * Purpose: Media CRUD endpoints for manual entries and UI browsing.
 * Input/Output: Authenticated JSON requests create, list, update, or delete media records.
 * Invariants: Deleting media also removes dependent watch events through database relations.
 * Debugging: Validation errors point to missing title/type/year fields.
 */

import type { FastifyPluginAsync } from "fastify";
import { manualMediaSchema } from "@watchlog/shared";
import { getSetting } from "../services/settings.js";
import { getTmdbDetails, type TmdbSettingsForClient } from "../services/tmdbClient.js";
import {
  customPosterRef,
  deleteCustomPoster,
  getCachedPoster,
  isCacheablePosterUrl,
  isCustomPosterRef,
  saveCustomPoster,
} from "../services/posterCache.js";

const tmdbDefaults = {
  tmdbBearerToken: null,
  preferredLanguage: "de-DE",
  fallbackLanguage: "en-US",
  imageBaseUrl: "https://image.tmdb.org/t/p",
};

function publicPosterUrl(media: { id: string; posterUrl: string | null }) {
  return isCacheablePosterUrl(media.posterUrl) || isCustomPosterRef(media.posterUrl)
    ? `/api/media/${media.id}/poster.webp`
    : media.posterUrl;
}

function mediaResponse<T extends { id: string; posterUrl: string | null }>(media: T) {
  return {
    ...media,
    posterUrl: publicPosterUrl(media),
  };
}

export const mediaRoutes: FastifyPluginAsync = async (app) => {
  app.get("/media/:id/poster.webp", async (request, reply) => {
    request.requireUser();
    const { id } = request.params as { id: string };
    const media = await app.prisma.media.findUnique({ where: { id } });

    if (!media?.posterUrl) {
      throw app.httpErrors.notFound("Fuer dieses Medium ist kein Poster gespeichert.");
    }

    if (!isCacheablePosterUrl(media.posterUrl) && !isCustomPosterRef(media.posterUrl)) {
      throw app.httpErrors.unprocessableEntity("Dieses Poster stammt nicht aus einer cachebaren Quelle.");
    }

    const poster = await getCachedPoster(process.env.CACHE_DIR ?? "/cache", media.posterUrl);
    return reply
      .type("image/webp")
      .header("cache-control", "public, max-age=86400")
      .send(poster);
  });

  app.get("/media/missing-posters", async (request) => {
    request.requireUser();
    const media = await app.prisma.media.findMany({
      where: {
        metadataSource: { not: "swipe-tmdb" },
        type: { in: ["movie", "show"] },
        posterUrl: null,
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 50,
    });

    return media.map(mediaResponse);
  });

  app.get("/media", async (request) => {
    request.requireUser();
    const media = await app.prisma.media.findMany({
      where: { metadataSource: { not: "swipe-tmdb" } },
      orderBy: [{ updatedAt: "desc" }],
      take: 200,
    });
    return media.map(mediaResponse);
  });

  app.get("/media/:id", async (request) => {
    request.requireUser();
    const { id } = request.params as { id: string };
    const media = await app.prisma.media.findUniqueOrThrow({
      where: { id },
      include: { watchEvents: { orderBy: { watchedAt: "desc" } } },
    });
    return mediaResponse(media);
  });

  app.post("/media/manual", async (request, reply) => {
    request.requireUser();
    const input = manualMediaSchema.parse(request.body);
    const media = await app.prisma.media.create({
      data: {
        ...input,
        year: input.year ?? null,
        tmdbId: input.tmdbId ?? null,
        imdbId: input.imdbId ?? null,
        jellyfinItemId: input.jellyfinItemId ?? null,
        overview: input.overview ?? null,
        runtimeSeconds: input.runtimeSeconds ?? null,
        posterUrl: input.posterUrl ?? null,
        metadataSource: input.tmdbId ? "tmdb" : "manual",
      },
    });
    reply.code(201);
    return mediaResponse(media);
  });

  app.post("/media/:id/poster/refresh", async (request) => {
    request.requireUser();
    const { id } = request.params as { id: string };
    const media = await app.prisma.media.findUniqueOrThrow({ where: { id } });

    if ((media.type !== "movie" && media.type !== "show") || !media.tmdbId || !/^\d+$/.test(media.tmdbId)) {
      throw app.httpErrors.conflict("Poster kann nur fuer Filme oder Serien mit verknuepfter TMDb-ID neu geladen werden.");
    }

    const settings = await getSetting(app.prisma, "tmdb", tmdbDefaults);
    const detail = await getTmdbDetails(settings as TmdbSettingsForClient, media.type, Number(media.tmdbId));
    if (!detail.posterUrl) {
      throw app.httpErrors.notFound("TMDb liefert fuer diesen Titel aktuell kein Poster.");
    }

    const updated = await app.prisma.media.update({
      where: { id },
      data: {
        title: detail.title,
        originalTitle: detail.originalTitle,
        year: detail.year,
        overview: detail.overview,
        runtimeSeconds: detail.runtimeSeconds,
        imdbId: detail.imdbId,
        posterPath: detail.posterPath,
        backdropPath: detail.backdropPath,
        posterUrl: detail.posterUrl,
        backdropUrl: detail.backdropUrl,
        metadataSource: media.metadataSource === "manual" ? "tmdb" : media.metadataSource,
        metadataLastSyncedAt: new Date(),
      },
    });

    if (isCustomPosterRef(media.posterUrl)) {
      await deleteCustomPoster(process.env.CACHE_DIR ?? "/cache", id);
    }

    return mediaResponse(updated);
  });

  app.post("/media/:id/poster/upload", async (request) => {
    request.requireUser();
    const { id } = request.params as { id: string };
    const media = await app.prisma.media.findUnique({ where: { id } });
    if (!media) {
      throw app.httpErrors.notFound("Medium wurde nicht gefunden.");
    }

    const file = await request.file({ limits: { fileSize: 8 * 1024 * 1024 } });
    if (!file) {
      throw app.httpErrors.badRequest("Bitte eine Bilddatei als Form-Feld `poster` hochladen.");
    }

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      throw app.httpErrors.unsupportedMediaType("Poster-Upload akzeptiert nur JPEG, PNG oder WebP.");
    }

    const bytes = await file.toBuffer();
    const posterRef = await saveCustomPoster(process.env.CACHE_DIR ?? "/cache", id, bytes).catch((error) => {
      throw app.httpErrors.badRequest(error instanceof Error ? error.message : "Poster konnte nicht verarbeitet werden.");
    });

    const updated = await app.prisma.media.update({
      where: { id },
      data: {
        posterUrl: posterRef,
        metadataLastSyncedAt: new Date(),
      },
    });

    return mediaResponse({ ...updated, posterUrl: customPosterRef(id) });
  });

  app.delete("/media/:id", async (request) => {
    const user = request.requireUser();
    const { id } = request.params as { id: string };
    const media = await app.prisma.media.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            children: true,
            playbackSessions: true,
          },
        },
      },
    });

    if (!media) {
      throw app.httpErrors.notFound("Medium wurde nicht gefunden.");
    }

    if (media.jellyfinItemId) {
      throw app.httpErrors.conflict("Jellyfin-verknuepfte Medien koennen nicht geloescht werden. Entferne sie in Jellyfin oder loesche nur einzelne WatchEvents.");
    }

    if (!["manual", "tmdb"].includes(media.metadataSource ?? "")) {
      throw app.httpErrors.conflict("Nur manuell oder per TMDb angelegte Medien koennen direkt geloescht werden.");
    }

    if (media._count.children > 0 || media._count.playbackSessions > 0) {
      throw app.httpErrors.conflict("Dieses Medium hat abhaengige Serien-/Playback-Daten. Bitte loesche einzelne WatchEvents statt den Titel.");
    }

    return app.prisma.$transaction(async (tx) => {
      const deletedWatchEvents = await tx.watchEvent.deleteMany({
        where: { mediaId: id, userId: user.id },
      });
      const remainingWatchEvents = await tx.watchEvent.count({ where: { mediaId: id } });

      if (remainingWatchEvents > 0) {
        return {
          deletedMedia: false,
          deletedWatchEvents: deletedWatchEvents.count,
          message: "Deine WatchEvents wurden geloescht. Der Titel bleibt bestehen, weil andere Nutzer ihn noch verwenden.",
        };
      }

      await tx.media.delete({ where: { id } });
      return {
        deletedMedia: true,
        deletedWatchEvents: deletedWatchEvents.count,
        message: "Manuell angelegter Titel wurde geloescht.",
      };
    });
  });
};
