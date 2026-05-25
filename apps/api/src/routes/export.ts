/**
 * Purpose: Export user watch history as CSV or JSON.
 * Input/Output: Authenticated GET requests return downloadable history data.
 * Invariants: Exports are scoped to the current user and never include password hashes or session tokens.
 * Debugging: If CSV columns look wrong, compare with docs/import-export.md.
 */

import type { FastifyPluginAsync } from "fastify";

function csvCell(value: unknown): string {
  if (value == null) {
    return "";
  }

  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

export const exportRoutes: FastifyPluginAsync = async (app) => {
  app.get("/export/json", async (request) => {
    const user = request.requireUser();
    return app.prisma.watchEvent.findMany({
      where: { userId: user.id, media: { metadataSource: { not: "swipe-tmdb" } } },
      include: { media: true },
      orderBy: [{ watchedAt: "desc" }, { createdAt: "desc" }],
    });
  });

  app.get("/export/csv", async (request, reply) => {
    const user = request.requireUser();
    const rows = await app.prisma.watchEvent.findMany({
      where: { userId: user.id, media: { metadataSource: { not: "swipe-tmdb" } } },
      include: { media: true },
      orderBy: [{ watchedAt: "desc" }, { createdAt: "desc" }],
    });

    const header = ["type", "title", "year", "watched_at", "date_precision", "tmdb_id", "imdb_id", "jellyfin_item_id", "note", "rating"];
    const body = rows.map((row) => [
      row.media.type,
      row.media.title,
      row.media.year,
      row.watchedAt?.toISOString() ?? "",
      row.datePrecision,
      row.media.tmdbId,
      row.media.imdbId,
      row.media.jellyfinItemId,
      row.note,
      row.rating,
    ].map(csvCell).join(","));

    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", "attachment; filename=watchlog-export.csv");
    return [header.join(","), ...body].join("\n");
  });
};
