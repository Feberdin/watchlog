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
  durationSeconds: number | null;
  rewatchIndex: number;
  media: {
    id: string;
    type: string;
    title: string;
    runtimeSeconds: number | null;
    parent: { id: string; title: string } | null;
    originalTitle: string | null;
  };
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
    .filter((row) => row.media.type === "episode")
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
    };
  });
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));

  for (const row of rows) {
    if (!row.watchedAt) continue;
    const key = `${row.watchedAt.getFullYear()}-${String(row.watchedAt.getMonth() + 1).padStart(2, "0")}`;
    const bucket = byKey.get(key);
    if (!bucket) continue;
    bucket.count += 1;
    bucket.watchtimeSeconds += secondsFor(row);
  }

  return buckets;
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
    const rows = await app.prisma.watchEvent.findMany({
      where: {
        userId: user.id,
        watchedAt: { not: null },
        media: { metadataSource: { not: "swipe-tmdb" } },
      },
      include: { media: { include: { parent: true } } },
      orderBy: [{ watchedAt: "desc" }, { createdAt: "desc" }],
      take: 5000,
    });

    const typedRows = rows as WatchEventStatsRow[];
    const weekdays = weekdayLabels.map((label) => ({ label, count: 0, watchtimeSeconds: 0 }));
    const titles = new Map<string, { id: string; title: string; type: string; count: number; watchtimeSeconds: number }>();

    for (const row of typedRows) {
      if (!row.watchedAt) continue;
      const weekday = weekdays[row.watchedAt.getDay()];
      if (!weekday) continue;
      weekday.count += 1;
      weekday.watchtimeSeconds += secondsFor(row);

      const titleKey = row.media.type === "episode"
        ? row.media.parent?.id ?? row.media.originalTitle ?? row.media.id
        : row.media.id;
      const title = row.media.type === "episode"
        ? row.media.parent?.title ?? row.media.originalTitle ?? row.media.title
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
    const firstWatchedAt = typedRows.length > 0
      ? typedRows.reduce<Date | null>((oldest, row) => {
        if (!row.watchedAt) return oldest;
        return !oldest || row.watchedAt < oldest ? row.watchedAt : oldest;
      }, null)
      : null;
    const topTitle = topEntry(Array.from(titles.values()), "count");
    const topWeekday = topEntry(weekdays, "watchtimeSeconds");
    const monthlyTrend = buildMonthlyTrend(typedRows);
    const topMonth = topEntry(monthlyTrend, "count");

    return {
      periods: {
        week: summarizePeriod(typedRows, periodStart(7)),
        month: summarizePeriod(typedRows, monthStart()),
        year: summarizePeriod(typedRows, yearStart()),
      },
      totals: {
        events: typedRows.length,
        watchtimeSeconds: totalWatchtimeSeconds,
        rewatches: typedRows.filter((row) => row.rewatchIndex > 1).length,
        firstWatchedAt: firstWatchedAt?.toISOString() ?? null,
      },
      weekdays,
      monthlyTrend,
      funFacts: {
        topWeekday,
        topTitle,
        topMonth,
        averageWatchtimeSeconds: typedRows.length > 0 ? Math.round(totalWatchtimeSeconds / typedRows.length) : 0,
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
