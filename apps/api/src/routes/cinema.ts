/**
 * Purpose: Cinema-memory workflow for quickly classifying popular movies from a user's youth.
 * Input/Output: Birth-year queries create TMDb-backed movie rows and user actions create WatchEvents or decisions.
 * Invariants: Suggestions are movies only; "seen" stores year precision, while "want" explicitly calls Jellyseerr.
 * Debugging: Check TMDb settings first, then SwipeDecision rows for want/skip state and WatchEvent rows for seen state.
 */

import type { FastifyPluginAsync } from "fastify";
import { cinemaActionSchema, cinemaCandidatesQuerySchema } from "@watchlog/shared";
import type { CinemaMemoryCandidate } from "@watchlog/shared";
import type { PrismaClient, User } from "@prisma/client";
import { getSetting } from "../services/settings.js";
import { getTmdbCinemaMemoryMovies, type TmdbCinemaMemoryMovie, type TmdbSettingsForClient } from "../services/tmdbClient.js";
import { applySwipeAction } from "../services/swipe.js";
import { nextRewatchIndex } from "../services/watchEvents.js";

const tmdbDefaults = {
  tmdbBearerToken: null,
  preferredLanguage: "de-DE",
  fallbackLanguage: "en-US",
  imageBaseUrl: "https://image.tmdb.org/t/p",
};

async function upsertCinemaMovie(prisma: PrismaClient, movie: TmdbCinemaMemoryMovie) {
  const data = {
    type: "movie" as const,
    title: movie.title,
    originalTitle: movie.originalTitle,
    year: movie.year,
    overview: movie.overview,
    tmdbId: String(movie.tmdbId),
    posterPath: movie.posterPath,
    backdropPath: movie.backdropPath,
    posterUrl: movie.posterUrl,
    backdropUrl: movie.backdropUrl,
    metadataSource: "cinema-tmdb",
    metadataLastSyncedAt: new Date(),
  };

  const existing = await prisma.media.findFirst({
    where: { type: "movie", tmdbId: String(movie.tmdbId) },
  });

  return existing
    ? prisma.media.update({ where: { id: existing.id }, data })
    : prisma.media.create({ data });
}

async function findExistingMovie(prisma: PrismaClient, movie: TmdbCinemaMemoryMovie) {
  return prisma.media.findFirst({
    where: { type: "movie", tmdbId: String(movie.tmdbId) },
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

async function markCinemaSeen(prisma: PrismaClient, user: User, mediaId: string) {
  const media = await prisma.media.findUniqueOrThrow({ where: { id: mediaId } });
  if (media.type !== "movie") {
    throw new Error("Kino-Erinnerungen koennen nur Filme als gesehen speichern.");
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
        note: "Per Kino-Erinnerungen als gesehen markiert.",
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
      ? `Als gesehen mit Jahr ${media.year} gespeichert.`
      : "Als gesehen mit unbekanntem Datum gespeichert.",
    jellyfinSynced: false,
    jellyseerrRequested: false,
  };
}

export const cinemaRoutes: FastifyPluginAsync = async (app) => {
  app.get("/cinema/candidates", async (request) => {
    const user = request.requireUser();
    const input = cinemaCandidatesQuerySchema.parse(request.query);
    const settings = await getSetting(app.prisma, "tmdb", tmdbDefaults);
    if (!settings.tmdbBearerToken) {
      throw new Error("TMDb Bearer Token fehlt. Bitte in den Integrationen speichern, damit WatchLog Kino-Erinnerungen laden kann.");
    }

    const movies = await getTmdbCinemaMemoryMovies(settings as TmdbSettingsForClient, input);
    const candidates: CinemaMemoryCandidate[] = [];
    for (const movie of movies) {
      const existingMedia = await findExistingMovie(app.prisma, movie);
      if (existingMedia && await classifyStatus(app.prisma, user.id, existingMedia.id) !== "open") {
        continue;
      }

      const media = existingMedia ?? await upsertCinemaMovie(app.prisma, movie);
      const status = await classifyStatus(app.prisma, user.id, media.id);
      if (status !== "open") {
        continue;
      }

      candidates.push({
        id: media.id,
        title: media.title,
        year: media.year,
        overview: media.overview,
        posterUrl: media.posterUrl,
        tmdbId: media.tmdbId,
        status,
        voteAverage: movie.voteAverage,
        voteCount: movie.voteCount,
      });
      if (candidates.length >= input.limit) {
        break;
      }
    }
    return candidates;
  });

  app.post("/cinema/action", async (request) => {
    const user = request.requireUser();
    const input = cinemaActionSchema.parse(request.body);
    if (input.action === "seen") {
      return markCinemaSeen(app.prisma, user, input.mediaId);
    }

    return applySwipeAction(app.prisma, user, input.mediaId, input.action);
  });
};
