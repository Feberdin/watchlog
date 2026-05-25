/**
 * Purpose: Provide Tinder-style media decisions backed by WatchLog, Jellyfin, and Jellyseerr.
 * Input/Output: Authenticated users receive unwatched media candidates and submit one explicit action per card.
 * Invariants: A swipe never overwrites WatchEvents; external calls happen only after a user action.
 * Debugging: Check SwipeDecision rows first, then WatchEvent rows and integration settings for external failures.
 */

import type { Media, MediaType, PrismaClient, User } from "@prisma/client";
import type { SwipeActionResult, SwipeCandidate } from "@watchlog/shared";
import { markJellyfinItemPlayed } from "./jellyfinClient.js";
import { requestJellyseerrMedia } from "./jellyseerrClient.js";
import { getSetting } from "./settings.js";
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

function toCandidate(media: Media): SwipeCandidate {
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
  };
}

export async function listSwipeCandidates(
  prisma: PrismaClient,
  userId: string,
  options: { limit: number; type: "movie" | "show" | "all" },
): Promise<SwipeCandidate[]> {
  const typeFilter: MediaType[] = options.type === "all" ? ["movie", "show"] : [options.type];
  const media = await prisma.media.findMany({
    where: {
      type: { in: typeFilter },
      watchEvents: { none: { userId } },
      swipeDecisions: { none: { userId } },
    },
    orderBy: [
      { posterUrl: "desc" },
      { metadataLastSyncedAt: "desc" },
      { updatedAt: "desc" },
      { title: "asc" },
    ],
    take: options.limit,
  });

  return media.map(toCandidate);
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
