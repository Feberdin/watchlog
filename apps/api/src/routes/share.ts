/**
 * Purpose: Social sharing endpoints for dashboard and yearly recap PNGs.
 * Input/Output: Authenticated requests return JSON recap data or generated PNG image bytes.
 * Invariants: Share data is scoped to the signed-in user and never exposes secrets or private config.
 * Debugging: Use `/api/share/year/:year` first to validate counts before requesting the PNG route.
 */

import type { FastifyPluginAsync } from "fastify";
import { buildShareRecap, renderShareImage } from "../services/shareImages.js";

function parseShareYear(value: string) {
  const year = Number(value);
  const currentYear = new Date().getFullYear();
  if (!Number.isInteger(year) || year < 1888 || year > currentYear + 1) {
    return null;
  }

  return year;
}

export const shareRoutes: FastifyPluginAsync = async (app) => {
  app.get("/share/dashboard.png", async (request, reply) => {
    const user = request.requireUser();
    const { genre } = request.query as { genre?: string };
    const image = await renderShareImage(app.prisma, user.id, { genre: genre ?? null });
    return reply
      .type("image/png")
      .header("cache-control", "no-store")
      .header("content-disposition", 'inline; filename="watchlog-dashboard.png"')
      .send(image);
  });

  app.get("/share/year/:year", async (request) => {
    const user = request.requireUser();
    const { year: rawYear } = request.params as { year: string };
    const { genre } = request.query as { genre?: string };
    const year = parseShareYear(rawYear);
    if (year === null) {
      throw app.httpErrors.badRequest("Jahr muss zwischen 1888 und dem naechsten Kalenderjahr liegen.");
    }
    const { summary } = await buildShareRecap(app.prisma, user.id, { year, genre: genre ?? null });
    return summary;
  });

  app.get("/share/year/:year.png", async (request, reply) => {
    const user = request.requireUser();
    const { year: rawYear } = request.params as { year: string };
    const { genre } = request.query as { genre?: string };
    const year = parseShareYear(rawYear);
    if (year === null) {
      throw app.httpErrors.badRequest("Jahr muss zwischen 1888 und dem naechsten Kalenderjahr liegen.");
    }
    const image = await renderShareImage(app.prisma, user.id, { year, genre: genre ?? null });
    return reply
      .type("image/png")
      .header("cache-control", "no-store")
      .header("content-disposition", `inline; filename="watchlog-${year}.png"`)
      .send(image);
  });
};
