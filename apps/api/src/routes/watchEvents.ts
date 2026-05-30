/**
 * Purpose: WatchEvent endpoints for timeline display and manual historical entries.
 * Input/Output: Authenticated requests list, create, update, and delete watch history.
 * Invariants: Manual events preserve date precision; rewatch index increments per user/media pair.
 * Debugging: If a manual date looks wrong, inspect `datePrecision` and `watchedAt` together.
 */

import type { FastifyPluginAsync } from "fastify";
import { manualWatchEventSchema } from "@watchlog/shared";
import { createManualWatchEvent } from "../services/watchEvents.js";

type WatchEventStatsRow = {
  watchedAt: Date | null;
  createdAt: Date;
  durationSeconds: number | null;
  rewatchIndex: number;
  source: string;
  media: {
    id: string;
    type: string;
    title: string;
    runtimeSeconds: number | null;
    seasonNumber: number | null;
    parent: { id: string; title: string } | null;
    originalTitle: string | null;
  };
};

type StatsDetail = {
  title: string;
  type: "movie" | "series";
  count: number;
  watchtimeSeconds: number;
};

type StatsBucket = {
  label: string;
  count: number;
  watchtimeSeconds: number;
  items: StatsDetail[];
};

const weekdayLabels = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const monthLabels = ["Jan", "Feb", "Maer", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

function secondsFor(row: WatchEventStatsRow) {
  return row.durationSeconds ?? row.media.runtimeSeconds ?? 0;
}

function periodStart(days: number) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days + 1);
  return start;
}

function monthStart() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(1);
  return start;
}

function yearStart() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setMonth(0, 1);
  return start;
}

function summarizePeriod(rows: WatchEventStatsRow[], from: Date) {
  const periodRows = rows.filter((row) => row.watchedAt && row.watchedAt >= from);
  const uniqueMovies = new Set(periodRows.filter((row) => row.media.type === "movie").map((row) => row.media.id));
  const uniqueSeries = new Set(periodRows
    .filter((row) => row.media.type === "episode" || row.media.type === "show")
    .map((row) => row.media.parent?.id ?? row.media.originalTitle ?? row.media.id));

  return {
    total: periodRows.length,
    movies: uniqueMovies.size,
    series: uniqueSeries.size,
    episodes: periodRows.filter((row) => row.media.type === "episode").length,
    watchtimeSeconds: periodRows.reduce((sum, row) => sum + secondsFor(row), 0),
  };
}

function buildMonthlyTrend(rows: WatchEventStatsRow[]) {
  const now = new Date();
  const buckets = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (11 - index), 1);
    return {
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      label: `${monthLabels[date.getMonth()]} ${String(date.getFullYear()).slice(2)}`,
      count: 0,
      watchtimeSeconds: 0,
      items: [] as StatsDetail[],
    };
  });
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));

  for (const row of rows) {
    if (!row.watchedAt) continue;
    const key = `${row.watchedAt.getFullYear()}-${String(row.watchedAt.getMonth() + 1).padStart(2, "0")}`;
    const bucket = byKey.get(key);
    if (!bucket) continue;
    addRowToBucket(bucket, row, "all");
  }

  return buckets;
}

function mediaStatsTitle(row: WatchEventStatsRow, mode: "movie" | "series" | "all") {
  if (row.media.type === "movie") {
    return row.media.title;
  }

  const seriesTitle = row.media.parent?.title ?? row.media.originalTitle ?? row.media.title;
  if (mode === "series" && row.media.seasonNumber !== null) {
    return `${seriesTitle} - Staffel ${row.media.seasonNumber}`;
  }

  return seriesTitle;
}

function addRowToBucket(bucket: StatsBucket, row: WatchEventStatsRow, mode: "movie" | "series" | "all") {
  const seconds = secondsFor(row);
  bucket.count += 1;
  bucket.watchtimeSeconds += seconds;

  const type = row.media.type === "movie" ? "movie" : "series";
  const title = mediaStatsTitle(row, mode);
  const existing = bucket.items.find((item) => item.title === title && item.type === type);
  if (existing) {
    existing.count += 1;
    existing.watchtimeSeconds += seconds;
    return;
  }

  bucket.items.push({ title, type, count: 1, watchtimeSeconds: seconds });
}

function topDetails(details: StatsDetail[]) {
  return [...details]
    .sort((left, right) => right.watchtimeSeconds - left.watchtimeSeconds || right.count - left.count || left.title.localeCompare(right.title, "de"))
    .slice(0, 8);
}

function finalizeBucket<T extends StatsBucket>(bucket: T): T {
  return {
    ...bucket,
    items: topDetails(bucket.items),
  };
}

function buildWeekdayBuckets(rows: WatchEventStatsRow[], mode: "movie" | "series") {
  const buckets: StatsBucket[] = weekdayLabels.map((label) => ({ label, count: 0, watchtimeSeconds: 0, items: [] }));
  for (const row of rows) {
    if (!row.watchedAt) continue;
    if (mode === "movie" && row.media.type !== "movie") continue;
    if (mode === "series" && row.media.type !== "episode" && row.media.type !== "show") continue;
    const weekday = buckets[row.watchedAt.getDay()];
    if (weekday) {
      addRowToBucket(weekday, row, mode);
    }
  }
  return buckets.map(finalizeBucket);
}

function buildMonthlyTrendFor(rows: WatchEventStatsRow[], mode: "movie" | "series") {
  const allBuckets = buildMonthlyTrend(rows.map((row) => row));
  for (const bucket of allBuckets) {
    bucket.count = 0;
    bucket.watchtimeSeconds = 0;
    bucket.items = [];
  }
  const byLabel = new Map(allBuckets.map((bucket) => [bucket.label, bucket]));

  for (const row of rows) {
    if (!row.watchedAt) continue;
    if (mode === "movie" && row.media.type !== "movie") continue;
    if (mode === "series" && row.media.type !== "episode" && row.media.type !== "show") continue;
    const label = `${monthLabels[row.watchedAt.getMonth()]} ${String(row.watchedAt.getFullYear()).slice(2)}`;
    const bucket = byLabel.get(label);
    if (bucket) {
      addRowToBucket(bucket, row, mode);
    }
  }

  return allBuckets.map(finalizeBucket);
}

function topEntry<T extends { count?: number; watchtimeSeconds?: number }>(items: T[], key: "count" | "watchtimeSeconds") {
  return [...items].sort((left, right) => (right[key] ?? 0) - (left[key] ?? 0))[0] ?? null;
}

export const watchEventRoutes: FastifyPluginAsync = async (app) => {
  app.get("/watch-events", async (request) => {
    const user = request.requireUser();
    const rows = await app.prisma.watchEvent.findMany({
      where: { userId: user.id, media: { metadataSource: { not: "swipe-tmdb" } } },
      include: { media: { include: { parent: true } } },
      orderBy: [{ watchedAt: "desc" }, { createdAt: "desc" }],
      take: 300,
    });

    const exactDuplicateKeys = new Set<string>();
    const uniqueRows = rows.filter((row) => {
      const watchedKey = row.watchedAt?.getTime().toString() ?? "unknown";
      const key = `${row.mediaId}:${row.source}:${watchedKey}`;
      if (exactDuplicateKeys.has(key)) {
        return false;
      }

      exactDuplicateKeys.add(key);
      return true;
    });

    return uniqueRows.map((row) => ({
      id: row.id,
      mediaId: row.mediaId,
      title: row.media.title,
      type: row.media.type,
      year: row.media.year,
      genres: row.media.genres.length > 0 ? row.media.genres : row.media.parent?.genres ?? [],
      cast: row.media.cast.length > 0 ? row.media.cast : row.media.parent?.cast ?? [],
      runtimeSeconds: row.durationSeconds ?? row.media.runtimeSeconds,
      posterUrl: row.media.posterUrl,
      watchedAt: row.watchedAt?.toISOString() ?? null,
      datePrecision: row.datePrecision,
      source: row.source,
      rewatchIndex: row.rewatchIndex,
      note: row.note,
      seriesId: row.media.parent?.id ?? row.media.jellyfinSeriesId ?? null,
      seriesTitle: row.media.parent?.title ?? row.media.originalTitle ?? null,
      seriesPosterUrl: row.media.parent?.posterUrl ?? null,
      seasonNumber: row.media.seasonNumber,
      episodeNumber: row.media.episodeNumber,
    }));
  });

  app.get("/watch-events/stats", async (request) => {
    const user = request.requireUser();
    const datedRows = await app.prisma.watchEvent.findMany({
      where: {
        userId: user.id,
        watchedAt: { not: null },
        media: { metadataSource: { not: "swipe-tmdb" } },
      },
      include: { media: { include: { parent: true } } },
      orderBy: [{ watchedAt: "desc" }, { createdAt: "desc" }],
      take: 5000,
    });
    const totalRows = await app.prisma.watchEvent.findMany({
      where: {
        userId: user.id,
        media: { metadataSource: { not: "swipe-tmdb" } },
      },
      include: { media: { include: { parent: true } } },
      orderBy: [{ watchedAt: "desc" }, { createdAt: "desc" }],
      take: 5000,
    });

    const typedRows = totalRows as WatchEventStatsRow[];
    const datedTypedRows = datedRows as WatchEventStatsRow[];
    const jellyfinRows = typedRows.filter((row) => row.source === "jellyfin");
    const datedJellyfinRows = datedTypedRows.filter((row) => row.source === "jellyfin");
    const titles = new Map<string, { id: string; title: string; type: string; count: number; watchtimeSeconds: number }>();

    for (const row of jellyfinRows) {
      if (!row.watchedAt) continue;
      const titleKey = row.media.type === "episode"
        ? `${row.media.parent?.id ?? row.media.originalTitle ?? row.media.id}:season:${row.media.seasonNumber ?? "unknown"}`
        : row.media.id;
      const title = row.media.type === "episode"
        ? `${row.media.parent?.title ?? row.media.originalTitle ?? row.media.title}${row.media.seasonNumber !== null ? ` - Staffel ${row.media.seasonNumber}` : ""}`
        : row.media.title;
      const existing = titles.get(titleKey) ?? {
        id: titleKey,
        title,
        type: row.media.type === "episode" ? "series" : row.media.type,
        count: 0,
        watchtimeSeconds: 0,
      };
      existing.count += 1;
      existing.watchtimeSeconds += secondsFor(row);
      titles.set(titleKey, existing);
    }

    const totalWatchtimeSeconds = typedRows.reduce((sum, row) => sum + secondsFor(row), 0);
    const jellyfinWatchtimeSeconds = jellyfinRows.reduce((sum, row) => sum + secondsFor(row), 0);
    const firstWatchedAt = typedRows.length > 0
      ? typedRows.reduce<Date | null>((oldest, row) => {
        if (!row.watchedAt) return oldest;
        return !oldest || row.watchedAt < oldest ? row.watchedAt : oldest;
      }, null)
      : null;
    const topTitle = topEntry(Array.from(titles.values()), "count");
    const movieWeekdays = buildWeekdayBuckets(datedJellyfinRows, "movie");
    const seriesWeekdays = buildWeekdayBuckets(datedJellyfinRows, "series");
    const movieMonthlyTrend = buildMonthlyTrendFor(datedJellyfinRows, "movie");
    const seriesMonthlyTrend = buildMonthlyTrendFor(datedJellyfinRows, "series");
    const combinedWeekdays = movieWeekdays.map((bucket, index) => {
      const seriesBucket = seriesWeekdays[index] ?? { count: 0, watchtimeSeconds: 0, items: [] as StatsDetail[] };
      return {
        ...bucket,
        count: bucket.count + seriesBucket.count,
        watchtimeSeconds: bucket.watchtimeSeconds + seriesBucket.watchtimeSeconds,
        items: topDetails([...bucket.items, ...seriesBucket.items]),
      };
    });
    const topWeekday = topEntry([...movieWeekdays, ...seriesWeekdays], "watchtimeSeconds");
    const monthlyTrend = buildMonthlyTrend(datedJellyfinRows).map(finalizeBucket);
    const topMonth = topEntry(monthlyTrend, "count");

    return {
      sourceNote: "Gesamte Watchtime summiert alle gespeicherten Filme, Serien und Episoden mit Laufzeit. Wochentage, Trends und Fun Facts beruecksichtigen nur datierbare Jellyfin-WatchEvents.",
      periods: {
        week: summarizePeriod(datedJellyfinRows, periodStart(7)),
        month: summarizePeriod(datedJellyfinRows, monthStart()),
        year: summarizePeriod(datedJellyfinRows, yearStart()),
      },
      totals: {
        events: typedRows.length,
        watchtimeSeconds: totalWatchtimeSeconds,
        jellyfinEvents: jellyfinRows.length,
        jellyfinWatchtimeSeconds,
        rewatches: typedRows.filter((row) => row.rewatchIndex > 1).length,
        firstWatchedAt: firstWatchedAt?.toISOString() ?? null,
      },
      weekdays: combinedWeekdays,
      monthlyTrend,
      movies: {
        weekdays: movieWeekdays,
        monthlyTrend: movieMonthlyTrend,
        topWeekday: topEntry(movieWeekdays, "watchtimeSeconds"),
        topMonth: topEntry(movieMonthlyTrend, "count"),
      },
      series: {
        weekdays: seriesWeekdays,
        monthlyTrend: seriesMonthlyTrend,
        topWeekday: topEntry(seriesWeekdays, "watchtimeSeconds"),
        topMonth: topEntry(seriesMonthlyTrend, "count"),
      },
      funFacts: {
        topWeekday,
        topTitle,
        topMonth,
        averageWatchtimeSeconds: jellyfinRows.length > 0 ? Math.round(jellyfinWatchtimeSeconds / jellyfinRows.length) : 0,
      },
    };
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
