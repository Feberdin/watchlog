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
};
