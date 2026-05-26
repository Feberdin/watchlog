/**
 * Purpose: Media CRUD endpoints for manual entries and UI browsing.
 * Input/Output: Authenticated JSON requests create, list, update, or delete media records.
 * Invariants: Deleting media also removes dependent watch events through database relations.
 * Debugging: Validation errors point to missing title/type/year fields.
 */

import type { FastifyPluginAsync } from "fastify";
import { manualMediaSchema } from "@watchlog/shared";

export const mediaRoutes: FastifyPluginAsync = async (app) => {
  app.get("/media", async (request) => {
    request.requireUser();
    return app.prisma.media.findMany({
      where: { metadataSource: { not: "swipe-tmdb" } },
      orderBy: [{ updatedAt: "desc" }],
      take: 200,
    });
  });

  app.get("/media/:id", async (request) => {
    request.requireUser();
    const { id } = request.params as { id: string };
    return app.prisma.media.findUniqueOrThrow({
      where: { id },
      include: { watchEvents: { orderBy: { watchedAt: "desc" } } },
    });
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
    return media;
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
