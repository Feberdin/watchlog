/**
 * Purpose: Build social-media-ready PNG recap images from watched movies and series.
 * Input/Output: Prisma watch history rows become a 1080x1350 PNG plus JSON summary metrics.
 * Invariants: Only the current user's watch events are used; poster tiles only use cacheable images.
 * Debugging: If a tile is missing, inspect `posterlessCount` and whether TMDb poster URLs are present.
 */

import type { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import type { OverlayOptions } from "sharp";
import { getCachedPoster, isCacheablePosterUrl, isCustomPosterRef } from "./posterCache.js";
import { resolveRuntimeSeconds } from "./watchtime.js";

type ShareMedia = {
  id: string;
  title: string;
  originalTitle: string | null;
  type: string;
  year: number | null;
  genres: string[];
  posterUrl: string | null;
  runtimeSeconds: number | null;
  parent: {
    id: string;
    title: string;
    year: number | null;
    genres: string[];
    runtimeSeconds: number | null;
    posterUrl: string | null;
  } | null;
};

type ShareWatchEvent = {
  mediaId: string;
  watchedAt: Date | null;
  createdAt: Date;
  durationSeconds: number | null;
  media: ShareMedia;
};

export type ShareRecapSummary = {
  year: number | null;
  genre: string | null;
  title: string;
  subtitle: string;
  movies: number;
  series: number;
  episodes: number;
  watchtimeSeconds: number;
  estimatedEvents: number;
  estimatedMovies: number;
  estimatedSeries: number;
  posterCount: number;
  totalTitles: number;
  posterlessCount: number;
};

type SharePosterItem = {
  key: string;
  title: string;
  type: "movie" | "series";
  year: number | null;
  posterUrl: string | null;
  sortDate: Date;
};

const IMAGE_WIDTH = 1080;
const IMAGE_HEIGHT = 1350;
const IMAGE_PADDING = 54;
const HEADER_HEIGHT = 190;
const FOOTER_HEIGHT = 70;
const TILE_GAP = 5;
const MAX_VISIBLE_POSTERS = 180;
const SVG_FONT = "DejaVu Sans, Liberation Sans, Arial, sans-serif";

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatHours(seconds: number) {
  const hours = seconds / 3600;
  return `${hours.toLocaleString("de-DE", { maximumFractionDigits: hours >= 10 ? 0 : 1 })} h`;
}

function posterMediaFor(event: ShareWatchEvent) {
  if ((event.media.type === "episode" || event.media.type === "season") && event.media.parent) {
    return event.media.parent;
  }

  return event.media;
}

function normalizedGenre(value: string) {
  return value.trim().toLocaleLowerCase("de-DE");
}

function eventGenres(event: ShareWatchEvent) {
  const genres = event.media.genres.length > 0 ? event.media.genres : event.media.parent?.genres ?? [];
  return new Set(genres.map(normalizedGenre));
}

function posterItemFor(event: ShareWatchEvent): SharePosterItem {
  const posterMedia = posterMediaFor(event);
  const isMovie = event.media.type === "movie";
  const title = isMovie ? event.media.title : posterMedia.title;

  return {
    key: `${isMovie ? "movie" : "series"}:${posterMedia.id}`,
    title,
    type: isMovie ? "movie" : "series",
    year: posterMedia.year,
    posterUrl: posterMedia.posterUrl,
    sortDate: event.watchedAt ?? event.createdAt,
  };
}

function canRenderPoster(item: SharePosterItem) {
  return isCacheablePosterUrl(item.posterUrl) || isCustomPosterRef(item.posterUrl);
}

/**
 * Why this exists: Dashboard and annual recap images need repeatable, compact
 * counts. The function keeps watchtime estimation aligned with the Timeline.
 */
export async function buildShareRecap(
  prisma: PrismaClient,
  userId: string,
  options: { year?: number; genre?: string | null } = {},
): Promise<{ summary: ShareRecapSummary; items: SharePosterItem[] }> {
  const yearFilter = options.year
    ? {
      watchedAt: {
        gte: new Date(Date.UTC(options.year, 0, 1)),
        lt: new Date(Date.UTC(options.year + 1, 0, 1)),
      },
    }
    : {};

  const rows = await prisma.watchEvent.findMany({
    where: {
      userId,
      ...yearFilter,
      media: { metadataSource: { not: "swipe-tmdb" } },
    },
    include: { media: { include: { parent: true } } },
    orderBy: [{ watchedAt: "desc" }, { createdAt: "desc" }],
    take: 10000,
  });

  const genre = options.genre?.trim() || null;
  const genreKey = genre ? normalizedGenre(genre) : null;
  const events = (rows as ShareWatchEvent[]).filter((event) => !genreKey || eventGenres(event).has(genreKey));
  const movieIds = new Set<string>();
  const seriesIds = new Set<string>();
  const estimatedMovieIds = new Set<string>();
  const estimatedSeriesIds = new Set<string>();
  const posterItems = new Map<string, SharePosterItem>();
  let episodes = 0;
  let watchtimeSeconds = 0;
  let estimatedEvents = 0;

  for (const event of events) {
    const runtime = resolveRuntimeSeconds({
      type: event.media.type,
      durationSeconds: event.durationSeconds,
      runtimeSeconds: event.media.runtimeSeconds ?? (event.media.type === "episode" ? event.media.parent?.runtimeSeconds ?? null : null),
    });
    watchtimeSeconds += runtime.seconds;

    if (event.media.type === "movie") {
      movieIds.add(event.media.id);
      if (runtime.estimated) estimatedMovieIds.add(event.media.id);
    } else {
      const seriesId = event.media.parent?.id ?? event.media.id;
      seriesIds.add(seriesId);
      if (runtime.estimated) estimatedSeriesIds.add(seriesId);
      if (event.media.type === "episode") episodes += 1;
    }

    if (runtime.estimated) estimatedEvents += 1;

    const item = posterItemFor(event);
    const existing = posterItems.get(item.key);
    if (!existing || item.sortDate > existing.sortDate) {
      posterItems.set(item.key, item);
    }
  }

  const allItems = [...posterItems.values()].sort((left, right) => right.sortDate.getTime() - left.sortDate.getTime());
  const items = allItems.filter(canRenderPoster);
  const genreSuffix = genre ? `: ${genre}` : "";
  const title = options.year ? `Mein Filmjahr ${options.year}${genreSuffix}` : `Meine WatchLog-Kollage${genreSuffix}`;
  const subtitle = `${movieIds.size} Filme · ${seriesIds.size} Serien · ${episodes} Episoden · ${formatHours(watchtimeSeconds)}`;

  return {
    summary: {
      year: options.year ?? null,
      genre,
      title,
      subtitle,
      movies: movieIds.size,
      series: seriesIds.size,
      episodes,
      watchtimeSeconds,
      estimatedEvents,
      estimatedMovies: estimatedMovieIds.size,
      estimatedSeries: estimatedSeriesIds.size,
      posterCount: items.length,
      totalTitles: allItems.length,
      posterlessCount: allItems.length - items.length,
    },
    items,
  };
}

function gridFor(count: number) {
  const gridWidth = IMAGE_WIDTH - IMAGE_PADDING * 2;
  const gridHeight = IMAGE_HEIGHT - HEADER_HEIGHT - FOOTER_HEIGHT - IMAGE_PADDING;
  let columns = Math.max(3, Math.ceil(Math.sqrt(count * 0.85)));
  let tileWidth = 0;
  let tileHeight = 0;
  let rows = 0;

  while (columns <= 24) {
    rows = Math.ceil(count / columns);
    tileWidth = Math.floor((gridWidth - TILE_GAP * (columns - 1)) / columns);
    tileHeight = Math.floor(tileWidth * 1.5);
    if (rows * tileHeight + TILE_GAP * (rows - 1) <= gridHeight) break;
    columns += 1;
  }

  return { columns, rows, tileWidth, tileHeight, gridWidth };
}

function headerSvg(summary: ShareRecapSummary) {
  const estimated = summary.estimatedEvents > 0
    ? `inkl. ${summary.estimatedEvents} geschätzte Laufzeiten`
    : "alle Laufzeiten direkt hinterlegt";
  const posterNote = summary.posterlessCount > 0
    ? `${summary.posterCount} Poster im Bild · ${summary.posterlessCount} ohne Poster ausgeblendet`
    : `${summary.posterCount} Poster im Bild`;

  return Buffer.from(`
    <svg width="${IMAGE_WIDTH}" height="${HEADER_HEIGHT}" viewBox="0 0 ${IMAGE_WIDTH} ${HEADER_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${IMAGE_WIDTH}" height="${HEADER_HEIGHT}" fill="#0f172a"/>
      <text x="${IMAGE_PADDING}" y="66" fill="#f8fafc" font-family="${SVG_FONT}" font-size="48" font-weight="800">${escapeXml(summary.title)}</text>
      <text x="${IMAGE_PADDING}" y="113" fill="#99f6e4" font-family="${SVG_FONT}" font-size="27" font-weight="700">${escapeXml(summary.subtitle)}</text>
      <text x="${IMAGE_PADDING}" y="149" fill="#94a3b8" font-family="${SVG_FONT}" font-size="21">${escapeXml(estimated)}</text>
      <text x="${IMAGE_PADDING}" y="177" fill="#64748b" font-family="${SVG_FONT}" font-size="17">${escapeXml(posterNote)}</text>
    </svg>
  `);
}

function footerSvg(visibleCount: number, totalCount: number) {
  const extra = totalCount > visibleCount ? ` · +${totalCount - visibleCount} weitere Poster` : "";
  return Buffer.from(`
    <svg width="${IMAGE_WIDTH}" height="${FOOTER_HEIGHT}" viewBox="0 0 ${IMAGE_WIDTH} ${FOOTER_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${IMAGE_WIDTH}" height="${FOOTER_HEIGHT}" fill="#0f172a"/>
      <text x="${IMAGE_PADDING}" y="42" fill="#cbd5e1" font-family="${SVG_FONT}" font-size="22" font-weight="700">WatchLog${escapeXml(extra)}</text>
      <text x="${IMAGE_WIDTH - IMAGE_PADDING}" y="42" text-anchor="end" fill="#64748b" font-family="${SVG_FONT}" font-size="18">share.watchlog</text>
    </svg>
  `);
}

function placeholderSvg(item: SharePosterItem, width: number, height: number) {
  const title = item.title.length > 42 ? `${item.title.slice(0, 39)}...` : item.title;
  const year = item.year ? String(item.year) : item.type === "movie" ? "Film" : "Serie";

  return Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="#1e293b"/>
      <rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="#334155" stroke-width="2"/>
      <text x="${width / 2}" y="${Math.max(42, height / 2 - 18)}" text-anchor="middle" fill="#99f6e4" font-family="${SVG_FONT}" font-size="${Math.max(24, Math.min(44, width / 3))}" font-weight="800">${escapeXml(item.type === "movie" ? "FILM" : "SERIE")}</text>
      <text x="${width / 2}" y="${height - 52}" text-anchor="middle" fill="#f8fafc" font-family="${SVG_FONT}" font-size="${Math.max(12, Math.min(22, width / 8))}" font-weight="700">${escapeXml(title)}</text>
      <text x="${width / 2}" y="${height - 24}" text-anchor="middle" fill="#94a3b8" font-family="${SVG_FONT}" font-size="${Math.max(10, Math.min(18, width / 10))}">${escapeXml(year)}</text>
    </svg>
  `);
}

async function posterBuffer(item: SharePosterItem, width: number, height: number) {
  if (item.posterUrl && (isCacheablePosterUrl(item.posterUrl) || isCustomPosterRef(item.posterUrl))) {
    const cached = await getCachedPoster(process.env.CACHE_DIR ?? "/cache", item.posterUrl).catch(() => null);
    if (cached) {
      return sharp(cached)
        .resize(width, height, { fit: "cover", position: "centre" })
        .png()
        .toBuffer();
    }
  }

  return placeholderSvg(item, width, height);
}

export async function renderShareImage(
  prisma: PrismaClient,
  userId: string,
  options: { year?: number; genre?: string | null } = {},
) {
  const { summary, items } = await buildShareRecap(prisma, userId, options);
  const visibleItems = items.slice(0, MAX_VISIBLE_POSTERS);
  const itemCount = Math.max(1, visibleItems.length);
  const grid = gridFor(itemCount);
  const startY = HEADER_HEIGHT;
  const composites: OverlayOptions[] = [
    { input: headerSvg(summary), left: 0, top: 0 },
    { input: footerSvg(visibleItems.length, items.length), left: 0, top: IMAGE_HEIGHT - FOOTER_HEIGHT },
  ];

  if (visibleItems.length === 0) {
    const emptyItem: SharePosterItem = {
      key: "empty",
      title: "Noch keine gesehenen Titel",
      type: "movie",
      year: null,
      posterUrl: null,
      sortDate: new Date(0),
    };
    const width = IMAGE_WIDTH - IMAGE_PADDING * 2;
    const height = IMAGE_HEIGHT - HEADER_HEIGHT - FOOTER_HEIGHT - IMAGE_PADDING;
    composites.push({
      input: await posterBuffer(emptyItem, width, height),
      left: IMAGE_PADDING,
      top: startY,
    });
  } else {
    const usedColumns = Math.min(grid.columns, visibleItems.length);
    const usedGridWidth = usedColumns * grid.tileWidth + TILE_GAP * (usedColumns - 1);
    const gridLeft = Math.round((IMAGE_WIDTH - usedGridWidth) / 2);

    for (let index = 0; index < visibleItems.length; index += 1) {
      const item = visibleItems[index]!;
      const column = index % grid.columns;
      const row = Math.floor(index / grid.columns);
      const left = gridLeft + column * (grid.tileWidth + TILE_GAP);
      const top = startY + row * (grid.tileHeight + TILE_GAP);
      composites.push({
        input: await posterBuffer(item, grid.tileWidth, grid.tileHeight),
        left,
        top,
      });
    }
  }

  return sharp({
    create: {
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
      channels: 4,
      background: "#0f172a",
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}
