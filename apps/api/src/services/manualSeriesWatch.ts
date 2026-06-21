/**
 * Purpose: Turn manual show-level WatchEvents into season/episode WatchEvents.
 * Input/Output: A manual show WatchEvent plus TMDb settings becomes watched episode rows and a removed show row.
 * Invariants: No existing episode WatchEvent is overwritten; a show row is removed only after matching episodes exist.
 * Debugging: Check manual_series_* log events and compare WatchEvent rows for the old show id and its episode children.
 */

import type { Media, PrismaClient, WatchEvent } from "@prisma/client";
import { getSetting } from "./settings.js";
import { refreshTmdbSeriesCatalog, type TmdbSeriesCatalogRefresh, type TmdbSeriesShowInput } from "./tmdbSeriesCatalog.js";
import type { TmdbSettingsForClient } from "./tmdbClient.js";
import { nextRewatchIndex } from "./watchEvents.js";

const tmdbDefaults: TmdbSettingsForClient = {
  tmdbBearerToken: null,
  preferredLanguage: "de-DE",
  fallbackLanguage: "en-US",
  imageBaseUrl: "https://image.tmdb.org/t/p",
};

type ManualShowEvent = WatchEvent & {
  media: Media;
};

type EpisodeMedia = {
  id: string;
  seasonNumber: number | null;
};

type ManualSeriesMaterializeOptions = {
  seasonNumbers?: number[];
  refreshCatalog?: typeof refreshTmdbSeriesCatalog;
};

export type ManualSeriesMaterializeResult = {
  ok: boolean;
  reason: "materialized" | "not_found" | "not_show" | "missing_tmdb" | "catalog_missing" | "no_matching_episodes";
  showEventId: string;
  showMediaId: string | null;
  selectedSeasons: number[] | null;
  createdEvents: number;
  skippedEvents: number;
  episodeCount: number;
  deletedShowEvent: boolean;
  catalog: TmdbSeriesCatalogRefresh | null;
};

export type ManualSeriesBackfillResult = {
  scanned: number;
  materialized: number;
  createdEvents: number;
  skippedEvents: number;
  deletedShowEvents: number;
  unresolved: number;
  message: string;
};

export type ManualSeriesBackfillProgress =
  | { stage: "started"; scanned: number }
  | { stage: "event_started"; index: number; total: number; showEventId: string; showMediaId: string }
  | {
    stage: "event_finished";
    index: number;
    total: number;
    showEventId: string;
    showMediaId: string | null;
    ok: boolean;
    reason: ManualSeriesMaterializeResult["reason"];
    createdEvents: number;
    skippedEvents: number;
    deletedShowEvent: boolean;
  };

type ManualSeriesBackfillOptions = {
  limit?: number;
  onProgress?: (progress: ManualSeriesBackfillProgress) => void | Promise<void>;
};

async function reportProgress(
  options: ManualSeriesBackfillOptions,
  progress: ManualSeriesBackfillProgress,
) {
  try {
    await options.onProgress?.(progress);
  } catch {
    // Progress logging must never break the repair job itself.
  }
}

function uniqueSeasonNumbers(values: number[] | undefined): number[] | null {
  if (!values || values.length === 0) {
    return null;
  }

  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))].sort((left, right) => left - right);
}

function showInput(media: Media): TmdbSeriesShowInput {
  return {
    id: media.id,
    title: media.title,
    year: media.year,
    overview: media.overview,
    genres: media.genres,
    cast: media.cast,
    runtimeSeconds: media.runtimeSeconds,
    tmdbId: media.tmdbId,
    imdbId: media.imdbId,
    tvdbId: media.tvdbId,
    posterUrl: media.posterUrl,
    backdropUrl: media.backdropUrl,
    metadataSource: media.metadataSource,
  };
}

async function canonicalShowForManualEvent(prisma: PrismaClient, media: Media): Promise<Media> {
  if (!media.tmdbId) {
    return media;
  }

  const sameSeriesWhere = {
    id: { not: media.id },
    type: "show" as const,
    tmdbId: media.tmdbId,
    metadataSource: { not: "swipe-tmdb" },
  };
  const existingWithEpisodes = await prisma.media.findFirst({
    where: {
      ...sameSeriesWhere,
      children: { some: { type: "episode" } },
    },
    orderBy: [{ metadataLastSyncedAt: "desc" }, { updatedAt: "desc" }],
  });
  if (existingWithEpisodes) {
    return existingWithEpisodes;
  }

  const existing = await prisma.media.findFirst({
    where: {
      ...sameSeriesWhere,
    },
    orderBy: [{ metadataLastSyncedAt: "desc" }, { updatedAt: "desc" }],
  });

  return existing ?? media;
}

async function loadEpisodeChildren(prisma: PrismaClient, showMediaId: string, selectedSeasons: number[] | null): Promise<EpisodeMedia[]> {
  return prisma.media.findMany({
    where: {
      parentMediaId: showMediaId,
      type: "episode",
      seasonNumber: selectedSeasons ? { in: selectedSeasons } : { gt: 0 },
      metadataSource: { not: "swipe-tmdb" },
    },
    select: {
      id: true,
      seasonNumber: true,
    },
    orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }, { title: "asc" }],
  });
}

async function createMissingEpisodeEvents(
  prisma: PrismaClient,
  showEvent: ManualShowEvent,
  episodes: EpisodeMedia[],
) {
  const existing = await prisma.watchEvent.findMany({
    where: {
      userId: showEvent.userId,
      mediaId: { in: episodes.map((episode) => episode.id) },
    },
    select: { mediaId: true },
  });
  const existingMediaIds = new Set(existing.map((event) => event.mediaId));
  let createdEvents = 0;

  for (const episode of episodes) {
    if (existingMediaIds.has(episode.id)) {
      continue;
    }

    await prisma.watchEvent.create({
      data: {
        userId: showEvent.userId,
        mediaId: episode.id,
        source: "manual",
        watchedAt: showEvent.watchedAt,
        datePrecision: showEvent.datePrecision,
        completed: true,
        rewatchIndex: await nextRewatchIndex(prisma, showEvent.userId, episode.id),
        note: showEvent.note ?? "Aus manueller Serienauswahl uebernommen.",
        rating: showEvent.rating,
      },
    });
    createdEvents += 1;
  }

  return {
    createdEvents,
    skippedEvents: episodes.length - createdEvents,
  };
}

/**
 * Why this exists: old manual imports stored a whole series as one watched row.
 * The dashboard needs completed seasons, and watchtime should come from episodes,
 * so the show event is replaced only after TMDb episode rows are available.
 */
export async function materializeManualShowWatchEvent(
  prisma: PrismaClient,
  settings: TmdbSettingsForClient,
  showEventId: string,
  options: ManualSeriesMaterializeOptions = {},
): Promise<ManualSeriesMaterializeResult> {
  const showEvent = await prisma.watchEvent.findUnique({
    where: { id: showEventId },
    include: { media: true },
  });
  const selectedSeasons = uniqueSeasonNumbers(options.seasonNumbers);
  const baseResult = {
    showEventId,
    showMediaId: showEvent?.mediaId ?? null,
    selectedSeasons,
    createdEvents: 0,
    skippedEvents: 0,
    episodeCount: 0,
    deletedShowEvent: false,
    catalog: null,
  };

  if (!showEvent) {
    return { ok: false, reason: "not_found", ...baseResult };
  }

  if (showEvent.media.type !== "show") {
    return { ok: false, reason: "not_show", ...baseResult, showMediaId: showEvent.mediaId };
  }

  if (!settings.tmdbBearerToken) {
    return { ok: false, reason: "missing_tmdb", ...baseResult, showMediaId: showEvent.mediaId };
  }

  const targetShow = await canonicalShowForManualEvent(prisma, showEvent.media);
  const refreshCatalog = options.refreshCatalog ?? refreshTmdbSeriesCatalog;
  const catalog = await refreshCatalog(prisma, settings, showInput(targetShow));
  if (!catalog.found) {
    return { ok: false, reason: "catalog_missing", ...baseResult, showMediaId: showEvent.mediaId, catalog };
  }

  const episodes = await loadEpisodeChildren(prisma, targetShow.id, selectedSeasons);
  if (episodes.length === 0) {
    return { ok: false, reason: "no_matching_episodes", ...baseResult, showMediaId: showEvent.mediaId, catalog };
  }

  const eventResult = await createMissingEpisodeEvents(prisma, showEvent, episodes);
  await prisma.watchEvent.deleteMany({
    where: {
      id: showEvent.id,
      userId: showEvent.userId,
      mediaId: showEvent.mediaId,
      source: "manual",
    },
  });

  return {
    ok: true,
    reason: "materialized",
    ...baseResult,
    showMediaId: showEvent.mediaId,
    createdEvents: eventResult.createdEvents,
    skippedEvents: eventResult.skippedEvents,
    episodeCount: episodes.length,
    deletedShowEvent: true,
    catalog,
  };
}

/**
 * Why this exists: deployments cannot run ad-hoc DB repair commands. This
 * idempotent startup repair converts existing manual show rows once TMDb is
 * configured, then future starts have nothing left to change.
 */
export async function backfillManualShowWatchEvents(
  prisma: PrismaClient,
  options: ManualSeriesBackfillOptions = {},
): Promise<ManualSeriesBackfillResult> {
  const settings = await getSetting(prisma, "tmdb", tmdbDefaults);
  if (!settings.tmdbBearerToken) {
    return {
      scanned: 0,
      materialized: 0,
      createdEvents: 0,
      skippedEvents: 0,
      deletedShowEvents: 0,
      unresolved: 0,
      message: "TMDb ist nicht konfiguriert; manuelle Serien wurden nicht repariert.",
    };
  }

  const showEvents = await prisma.watchEvent.findMany({
    where: {
      source: "manual",
      media: {
        type: "show",
        metadataSource: { not: "swipe-tmdb" },
      },
    },
    include: { media: true },
    orderBy: [{ createdAt: "asc" }],
    take: options.limit ?? 500,
  });
  await reportProgress(options, { stage: "started", scanned: showEvents.length });

  let materialized = 0;
  let createdEvents = 0;
  let skippedEvents = 0;
  let deletedShowEvents = 0;
  let unresolved = 0;

  for (const [index, event] of showEvents.entries()) {
    const current = index + 1;
    await reportProgress(options, {
      stage: "event_started",
      index: current,
      total: showEvents.length,
      showEventId: event.id,
      showMediaId: event.mediaId,
    });

    const result = await materializeManualShowWatchEvent(prisma, settings, event.id);
    if (!result.ok) {
      unresolved += 1;
      await reportProgress(options, {
        stage: "event_finished",
        index: current,
        total: showEvents.length,
        showEventId: event.id,
        showMediaId: result.showMediaId,
        ok: false,
        reason: result.reason,
        createdEvents: result.createdEvents,
        skippedEvents: result.skippedEvents,
        deletedShowEvent: result.deletedShowEvent,
      });
      continue;
    }

    materialized += 1;
    createdEvents += result.createdEvents;
    skippedEvents += result.skippedEvents;
    if (result.deletedShowEvent) {
      deletedShowEvents += 1;
    }
    await reportProgress(options, {
      stage: "event_finished",
      index: current,
      total: showEvents.length,
      showEventId: event.id,
      showMediaId: result.showMediaId,
      ok: true,
      reason: result.reason,
      createdEvents: result.createdEvents,
      skippedEvents: result.skippedEvents,
      deletedShowEvent: result.deletedShowEvent,
    });
  }

  return {
    scanned: showEvents.length,
    materialized,
    createdEvents,
    skippedEvents,
    deletedShowEvents,
    unresolved,
    message: `${materialized}/${showEvents.length} manuelle Serien repariert, ${createdEvents} Episoden-WatchEvents erstellt, ${deletedShowEvents} Serien-WatchEvents entfernt.`,
  };
}
