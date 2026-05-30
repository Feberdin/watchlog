/**
 * Purpose: TV-memory workflow for quickly classifying popular shows from a user's youth.
 * Input/Output: Birth-year queries create TMDb-backed show rows and user actions create WatchEvents or decisions.
 * Invariants: Suggestions are shows only; "seen" stores year precision, while "want" explicitly calls Jellyseerr.
 * Debugging: Check TMDb settings first, then SwipeDecision rows for want/skip state and WatchEvent rows for seen state.
 */

import type { FastifyPluginAsync } from "fastify";
import { cinemaActionSchema, cinemaCandidatesQuerySchema } from "@watchlog/shared";
import type { CinemaMemoryCandidate } from "@watchlog/shared";
import type { PrismaClient, User } from "@prisma/client";
import { getSetting } from "../services/settings.js";
import { getTmdbTvMemoryShows, type TmdbSettingsForClient, type TmdbTvMemoryShow } from "../services/tmdbClient.js";
import { refreshTmdbSeriesCatalog } from "../services/tmdbSeriesCatalog.js";
import { applySwipeAction } from "../services/swipe.js";
import { nextRewatchIndex } from "../services/watchEvents.js";

const tmdbDefaults = {
  tmdbBearerToken: null,
  preferredLanguage: "de-DE",
  fallbackLanguage: "en-US",
  imageBaseUrl: "https://image.tmdb.org/t/p",
};

async function upsertTvMemoryShow(prisma: PrismaClient, show: TmdbTvMemoryShow) {
  const data = {
    type: "show" as const,
    title: show.title,
    originalTitle: show.originalTitle,
    year: show.year,
    overview: show.overview,
    genres: show.genres,
    cast: show.cast,
    tmdbId: String(show.tmdbId),
    posterPath: show.posterPath,
    backdropPath: show.backdropPath,
    posterUrl: show.posterUrl,
    backdropUrl: show.backdropUrl,
    metadataSource: "tv-memory-tmdb",
    metadataLastSyncedAt: new Date(),
  };

  const existing = await prisma.media.findFirst({
    where: { type: "show", tmdbId: String(show.tmdbId) },
  });

  return existing
    ? prisma.media.update({ where: { id: existing.id }, data })
    : prisma.media.create({ data });
}

async function findExistingShow(prisma: PrismaClient, show: TmdbTvMemoryShow) {
  return prisma.media.findFirst({
    where: { type: "show", tmdbId: String(show.tmdbId) },
  });
}

async function classifyStatus(prisma: PrismaClient, userId: string, mediaId: string): Promise<CinemaMemoryCandidate["status"]> {
  const [watchEvent, decision] = await Promise.all([
    prisma.watchEvent.findFirst({ where: { userId, mediaId }, select: { id: true } }),
    prisma.swipeDecision.findUnique({ where: { userId_mediaId: { userId, mediaId } } }),
  ]);

  if (watchEvent) return "seen";
  if (decision?.action === "want" || decision?.action === "skip") return decision.action;
  return "open";
}

async function markTvMemorySeen(prisma: PrismaClient, user: User, mediaId: string) {
  const media = await prisma.media.findUniqueOrThrow({ where: { id: mediaId } });
  if (media.type !== "show") {
    throw new Error("TV-Erinnerungen koennen nur Serien als gesehen speichern.");
  }

  const existing = await prisma.watchEvent.findFirst({
    where: { userId: user.id, mediaId },
    select: { id: true },
  });

  if (!existing) {
    await prisma.watchEvent.create({
      data: {
        userId: user.id,
        mediaId,
        source: "manual",
        watchedAt: media.year ? new Date(`${media.year}-01-01T00:00:00.000Z`) : null,
        datePrecision: media.year ? "year" : "unknown",
        completed: true,
        rewatchIndex: await nextRewatchIndex(prisma, user.id, mediaId),
        note: "Per TV-Erinnerungen als gesehen markiert.",
      },
    });
  }

  await prisma.swipeDecision.upsert({
    where: { userId_mediaId: { userId: user.id, mediaId } },
    create: { userId: user.id, mediaId, action: "seen", externalStatus: "local" },
    update: { action: "seen", externalStatus: "local", errorMessage: null },
  });

  return {
    ok: true,
    action: "seen" as const,
    mediaId,
    message: media.year
      ? `Als gesehen mit Startjahr ${media.year} gespeichert.`
      : "Als gesehen mit unbekanntem Datum gespeichert.",
    jellyfinSynced: false,
    jellyseerrRequested: false,
  };
}

export const tvMemoryRoutes: FastifyPluginAsync = async (app) => {
  app.get("/tv-memory/candidates", async (request) => {
    const user = request.requireUser();
    const input = cinemaCandidatesQuerySchema.parse(request.query);
    const settings = await getSetting(app.prisma, "tmdb", tmdbDefaults);
    if (!settings.tmdbBearerToken) {
      throw new Error("TMDb Bearer Token fehlt. Bitte in den Integrationen speichern, damit WatchLog TV-Erinnerungen laden kann.");
    }

    const shows = await getTmdbTvMemoryShows(settings as TmdbSettingsForClient, input);
    const candidates: CinemaMemoryCandidate[] = [];
    for (const show of shows) {
      const existingMedia = await findExistingShow(app.prisma, show);
      if (existingMedia && await classifyStatus(app.prisma, user.id, existingMedia.id) !== "open") {
        continue;
      }

      const media = existingMedia ?? await upsertTvMemoryShow(app.prisma, show);
      const status = await classifyStatus(app.prisma, user.id, media.id);
      if (status !== "open") {
        continue;
      }

      candidates.push({
        id: media.id,
        title: media.title,
        year: media.year,
        genres: media.genres,
        cast: media.cast,
        overview: media.overview,
        posterUrl: media.posterUrl,
        tmdbId: media.tmdbId,
        status,
        voteAverage: show.voteAverage,
        voteCount: show.voteCount,
      });
      if (candidates.length >= input.limit) {
        break;
      }
    }
    return candidates;
  });

  app.post("/tv-memory/action", async (request) => {
    const user = request.requireUser();
    const input = cinemaActionSchema.parse(request.body);
    if (input.action === "seen") {
      const settings = await getSetting(app.prisma, "tmdb", tmdbDefaults);
      const result = await markTvMemorySeen(app.prisma, user, input.mediaId);
      const media = await app.prisma.media.findUnique({ where: { id: input.mediaId } });

      // Why this exists: TV-memory shows should not hide their season tree
      // until a separate Jellyfin catalog sync happens.
      if (media?.type === "show" && (settings as TmdbSettingsForClient).tmdbBearerToken) {
        await refreshTmdbSeriesCatalog(app.prisma, settings as TmdbSettingsForClient, media).catch((error) => {
          request.log.warn({ error, mediaId: media.id }, "TMDb-Serienkatalog fuer TV-Erinnerung konnte nicht aktualisiert werden.");
        });
      }

      return result;
    }

    return applySwipeAction(app.prisma, user, input.mediaId, input.action);
  });
};
