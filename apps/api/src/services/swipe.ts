/**
 * Purpose: Provide Tinder-style media decisions backed by WatchLog, Jellyfin, and Jellyseerr.
 * Input/Output: Authenticated users receive unwatched media candidates and submit one explicit action per card.
 * Invariants: A swipe never overwrites WatchEvents; external calls happen only after a user action.
 * Debugging: Check SwipeDecision rows first, then WatchEvent rows and integration settings for external failures.
 */

import type { Media, MediaType, PrismaClient, User } from "@prisma/client";
import type { SwipeActionResult, SwipeCandidate, SwipeHistoryItem } from "@watchlog/shared";
import { markJellyfinItemPlayed } from "./jellyfinClient.js";
import { requestJellyseerrMedia } from "./jellyseerrClient.js";
import { getSetting } from "./settings.js";
import { getTmdbSwipeRecommendations, type TmdbRecommendation, type TmdbSettingsForClient } from "./tmdbClient.js";
import { nextRewatchIndex } from "./watchEvents.js";

const jellyfinDefaults = {
  jellyfinBaseUrl: null,
  jellyfinApiKey: null,
  enabledUserIds: [] as string[],
  syncBackEnabled: false,
  watchedThresholdMoviePercent: 90,
  watchedThresholdEpisodePercent: 90,
};

const jellyseerrDefaults = {
  jellyseerrBaseUrl: null,
  jellyseerrApiKey: null,
};

const tmdbDefaults = {
  tmdbBearerToken: null,
  preferredLanguage: "de-DE",
  fallbackLanguage: "en-US",
  imageBaseUrl: "https://image.tmdb.org/t/p",
};

function toCandidate(media: Media, recommendation?: TmdbRecommendation): SwipeCandidate {
  return {
    id: media.id,
    type: media.type as "movie" | "show",
    title: media.title,
    year: media.year,
    overview: media.overview,
    runtimeSeconds: media.runtimeSeconds,
    posterUrl: media.posterUrl,
    backdropUrl: media.backdropUrl,
    tmdbId: media.tmdbId,
    jellyfinItemId: media.jellyfinItemId,
    recommendationBucket: recommendation?.recommendationBucket ?? null,
    voteAverage: recommendation?.voteAverage ?? null,
    voteCount: recommendation?.voteCount ?? null,
  };
}

const SWIPE_METADATA_SOURCE = "swipe-tmdb";

async function upsertRecommendation(prisma: PrismaClient, recommendation: TmdbRecommendation): Promise<Media> {
  const existing = await prisma.media.findFirst({
    where: {
      type: recommendation.type,
      tmdbId: String(recommendation.tmdbId),
    },
  });

  const data = {
    type: recommendation.type,
    title: recommendation.title,
    originalTitle: recommendation.originalTitle,
    year: recommendation.year,
    overview: recommendation.overview,
    tmdbId: String(recommendation.tmdbId),
    posterPath: recommendation.posterPath,
    backdropPath: recommendation.backdropPath,
    posterUrl: recommendation.posterUrl,
    backdropUrl: recommendation.backdropUrl,
    metadataSource: SWIPE_METADATA_SOURCE,
    metadataLastSyncedAt: new Date(),
  };

  if (existing) {
    return prisma.media.update({
      where: { id: existing.id },
      data,
    });
  }

  return prisma.media.create({ data });
}

async function hasUserDecisionOrWatch(prisma: PrismaClient, userId: string, mediaId: string): Promise<boolean> {
  const [watchEvent, swipeDecision] = await Promise.all([
    prisma.watchEvent.findFirst({ where: { userId, mediaId }, select: { id: true } }),
    prisma.swipeDecision.findFirst({
      where: {
        userId,
        mediaId,
        NOT: { externalStatus: "failed" },
      },
      select: { id: true },
    }),
  ]);

  return Boolean(watchEvent || swipeDecision);
}

async function listTmdbSwipeCandidates(prisma: PrismaClient, userId: string, limit: number): Promise<SwipeCandidate[]> {
  const settings = await getSetting(prisma, "tmdb", tmdbDefaults);
  if (!settings.tmdbBearerToken) {
    throw new Error("TMDb Bearer Token fehlt. Bitte in den Integrationen speichern, damit WatchLog Swipe-Vorschlaege laden kann.");
  }

  const recommendations = await getTmdbSwipeRecommendations(settings as TmdbSettingsForClient);
  const candidates: SwipeCandidate[] = [];
  const seenTmdbKeys = new Set<string>();

  for (const recommendation of recommendations) {
    const key = `${recommendation.type}:${recommendation.tmdbId}`;
    if (seenTmdbKeys.has(key)) {
      continue;
    }
    seenTmdbKeys.add(key);

    const media = await upsertRecommendation(prisma, recommendation);
    if (await hasUserDecisionOrWatch(prisma, userId, media.id)) {
      continue;
    }

    candidates.push(toCandidate(media, recommendation));
    if (candidates.length >= limit) {
      break;
    }
  }

  return candidates;
}

export async function listSwipeCandidates(
  prisma: PrismaClient,
  userId: string,
  options: { limit: number; type: "movie" | "show" | "all" },
): Promise<SwipeCandidate[]> {
  if (options.type === "all") {
    return listTmdbSwipeCandidates(prisma, userId, options.limit);
  }

  const typeFilter: MediaType[] = [options.type];
  const media = await prisma.media.findMany({
    where: {
      type: { in: typeFilter },
      watchEvents: { none: { userId } },
      swipeDecisions: { none: { userId, NOT: { externalStatus: "failed" } } },
    },
    orderBy: [
      { posterUrl: "desc" },
      { metadataLastSyncedAt: "desc" },
      { updatedAt: "desc" },
      { title: "asc" },
    ],
    take: options.limit,
  });

  return media.map((item) => toCandidate(item));
}

export async function listSwipeHistory(prisma: PrismaClient, userId: string): Promise<SwipeHistoryItem[]> {
  const decisions = await prisma.swipeDecision.findMany({
    where: { userId },
    include: { media: true },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  return decisions
    .filter((decision) => decision.action === "seen" || decision.action === "skip" || decision.action === "want")
    .map((decision) => ({
      decisionId: decision.id,
      mediaId: decision.mediaId,
      action: decision.action as "seen" | "skip" | "want",
      externalStatus: decision.externalStatus,
      errorMessage: decision.errorMessage,
      decidedAt: decision.updatedAt.toISOString(),
      title: decision.media.title,
      type: decision.media.type as "movie" | "show",
      year: decision.media.year,
      posterUrl: decision.media.posterUrl,
      tmdbId: decision.media.tmdbId,
    }));
}

async function markSeen(prisma: PrismaClient, user: User, media: Media): Promise<Pick<SwipeActionResult, "jellyfinSynced" | "jellyseerrRequested" | "message">> {
  const watchedAt = new Date();
  const existing = await prisma.watchEvent.findFirst({
    where: { userId: user.id, mediaId: media.id },
    orderBy: { watchedAt: "desc" },
  });

  if (!existing) {
    await prisma.watchEvent.create({
      data: {
        userId: user.id,
        mediaId: media.id,
        source: "manual",
        watchedAt,
        datePrecision: "exact",
        completed: true,
        rewatchIndex: await nextRewatchIndex(prisma, user.id, media.id),
        note: "Per Swipe als gesehen markiert.",
      },
    });
  }

  let jellyfinSynced = false;
  if (media.jellyfinItemId && user.jellyfinUserId) {
    const settings = await getSetting(prisma, "jellyfin", jellyfinDefaults);
    if (settings.jellyfinBaseUrl) {
      await markJellyfinItemPlayed(settings.jellyfinBaseUrl, settings.jellyfinApiKey, user.jellyfinUserId, media.jellyfinItemId, watchedAt);
      jellyfinSynced = true;
    }
  }

  return {
    jellyfinSynced,
    jellyseerrRequested: false,
    message: jellyfinSynced
      ? "Als gesehen gespeichert und an Jellyfin gesendet."
      : "Als gesehen gespeichert. Jellyfin-Sync wurde uebersprungen, weil Verknuepfung oder Einstellung fehlt.",
  };
}

async function requestWantToWatch(prisma: PrismaClient, media: Media): Promise<Pick<SwipeActionResult, "jellyfinSynced" | "jellyseerrRequested" | "message">> {
  if (!media.tmdbId || !/^\d+$/.test(media.tmdbId)) {
    throw new Error("Jellyseerr braucht eine TMDb-ID. Bitte das Medium zuerst mit TMDb-Metadaten verknuepfen.");
  }

  const settings = await getSetting(prisma, "jellyseerr", jellyseerrDefaults);
  if (!settings.jellyseerrBaseUrl) {
    throw new Error("Jellyseerr URL fehlt. Bitte in den Integrationen speichern.");
  }

  const result = await requestJellyseerrMedia(
    settings.jellyseerrBaseUrl,
    settings.jellyseerrApiKey,
    media.type === "show" ? "tv" : "movie",
    Number(media.tmdbId),
  );

  return {
    jellyfinSynced: false,
    jellyseerrRequested: true,
    message: result.alreadyRequested
      ? "War in Jellyseerr bereits angefragt. Swipe wurde gespeichert."
      : "In Jellyseerr angefragt. Der Download laeuft ueber deine Jellyseerr/Radarr/Sonarr-Regeln.",
  };
}

export async function applySwipeAction(
  prisma: PrismaClient,
  user: User,
  mediaId: string,
  action: "seen" | "skip" | "want",
): Promise<SwipeActionResult> {
  const media = await prisma.media.findUniqueOrThrow({ where: { id: mediaId } });
  if (media.type !== "movie" && media.type !== "show") {
    throw new Error("Swipes sind im MVP nur fuer Filme und Serien verfuegbar.");
  }

  let result: Pick<SwipeActionResult, "jellyfinSynced" | "jellyseerrRequested" | "message"> = {
    jellyfinSynced: false,
    jellyseerrRequested: false,
    message: "Entscheidung gespeichert.",
  };

  try {
    if (action === "seen") {
      result = await markSeen(prisma, user, media);
    } else if (action === "want") {
      result = await requestWantToWatch(prisma, media);
    } else {
      result = {
        jellyfinSynced: false,
        jellyseerrRequested: false,
        message: "Als nicht gesehen/uebersprungen gespeichert.",
      };
    }

    await prisma.swipeDecision.upsert({
      where: { userId_mediaId: { userId: user.id, mediaId } },
      create: {
        userId: user.id,
        mediaId,
        action,
        externalStatus: result.jellyfinSynced || result.jellyseerrRequested ? "sent" : "local",
      },
      update: {
        action,
        externalStatus: result.jellyfinSynced || result.jellyseerrRequested ? "sent" : "local",
        errorMessage: null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Swipe-Fehler.";
    await prisma.swipeDecision.upsert({
      where: { userId_mediaId: { userId: user.id, mediaId } },
      create: {
        userId: user.id,
        mediaId,
        action,
        externalStatus: "failed",
        errorMessage: message,
      },
      update: {
        action,
        externalStatus: "failed",
        errorMessage: message,
      },
    });
    throw error;
  }

  return {
    ok: true,
    action,
    mediaId,
    ...result,
  };
}
