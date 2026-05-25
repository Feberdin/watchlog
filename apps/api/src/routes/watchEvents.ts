/**
 * Purpose: WatchEvent endpoints for timeline display and manual historical entries.
 * Input/Output: Authenticated requests list, create, update, and delete watch history.
 * Invariants: Manual events preserve date precision; rewatch index increments per user/media pair.
 * Debugging: If a manual date looks wrong, inspect `datePrecision` and `watchedAt` together.
 */

import type { FastifyPluginAsync } from "fastify";
import { manualWatchEventSchema } from "@watchlog/shared";
import { createManualWatchEvent } from "../services/watchEvents.js";

export const watchEventRoutes: FastifyPluginAsync = async (app) => {
  app.get("/watch-events", async (request) => {
    const user = request.requireUser();
    const rows = await app.prisma.watchEvent.findMany({
      where: { userId: user.id },
      include: { media: true },
      orderBy: [{ watchedAt: "desc" }, { createdAt: "desc" }],
      take: 300,
    });

    return rows.map((row) => ({
      id: row.id,
      mediaId: row.mediaId,
      title: row.media.title,
      type: row.media.type,
      year: row.media.year,
      posterUrl: row.media.posterUrl,
      watchedAt: row.watchedAt?.toISOString() ?? null,
      datePrecision: row.datePrecision,
      source: row.source,
      rewatchIndex: row.rewatchIndex,
      note: row.note,
    }));
  });

  app.post("/watch-events/manual", async (request, reply) => {
    const user = request.requireUser();
    const input = manualWatchEventSchema.parse(request.body);
    const event = await createManualWatchEvent(app.prisma, user.id, input);
    reply.code(201);
    return event;
  });

  app.delete("/watch-events/:id", async (request) => {
    const user = request.requireUser();
    const { id } = request.params as { id: string };
    await app.prisma.watchEvent.deleteMany({ where: { id, userId: user.id } });
    return { ok: true };
  });
};
