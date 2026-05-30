/**
 * Purpose: Dashboard summary with growing poster collage and recent watching activity.
 * Input/Output: Loads `/api/dashboard`, renders metrics, optimized posters, and latest WatchEvents.
 * Invariants: Empty states must show the next useful action; broken posters degrade to simple placeholders.
 * Debugging: If posters are missing, inspect `collage[].posterUrl` and `/api/media/:id/poster.webp` responses.
 */

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Clapperboard, Film, Repeat2, Tv } from "lucide-react";
import { apiRequest } from "../api/client";
import { PosterPreview } from "../components/PosterPreview";
import { castLabel, genreLabel, metadataLabel } from "../utils/mediaMetadata";

type DashboardPoster = {
  id: string;
  title: string;
  type: string;
  year: number | null;
  genres: string[];
  cast: string[];
  seasonNumber: number | null;
  watchedAt: string | null;
  addedAt?: string;
  posterUrl: string | null;
};

type DashboardResponse = {
  metrics: {
    today: number;
    movies: number;
    episodes: number;
    rewatches: number;
  };
  collage: DashboardPoster[];
  recent: Array<DashboardPoster & {
    datePrecision: string;
  }>;
};

type CollageFilter = "all" | "movie" | "series";
type CollageSort = "addedDesc" | "watchedDesc" | "yearAsc" | "yearDesc" | "titleAsc";

function typeLabel(type: string) {
  if (type === "movie") return "Film";
  if (type === "season") return "Staffel";
  if (type === "episode") return "Episode";
  if (type === "show") return "Serie";
  return "Medium";
}

function PosterTile({ item, index, dense }: { item: DashboardPoster; index: number; dense: boolean }) {
  const sizeClass = dense
    ? index % 11 === 0 ? "col-span-2 row-span-2" : "col-span-1 row-span-1"
    : index % 7 === 0 ? "col-span-2 row-span-2" : "col-span-1 row-span-1";
  const label = typeLabel(item.type);
  const seasonBadge = item.type === "season" && item.seasonNumber !== null ? (
    <span className="pointer-events-none absolute right-2 top-2 z-10 flex h-8 min-w-8 items-center justify-center rounded-full bg-slate-950/55 px-2 text-lg font-black text-white/85 ring-1 ring-white/15">
      {item.seasonNumber}
    </span>
  ) : null;

  return (
    <article className={`group relative min-h-24 overflow-hidden rounded-md border border-slate-800 bg-slate-900 ${sizeClass}`}>
      <PosterPreview
        src={item.posterUrl}
        title={item.title}
        kind={item.type === "movie" ? "movie" : "series"}
        className="h-full w-full"
        typeLabel={label}
        year={item.year}
        meta={[genreLabel(item.genres), castLabel(item.cast), item.seasonNumber !== null ? `Staffel ${item.seasonNumber}` : null]}
        cast={item.cast}
        badge={seasonBadge}
        imageClassName="rounded-none transition duration-300 group-hover:scale-105"
      />
      <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-slate-950/95 via-slate-950/65 to-transparent p-2 opacity-0 transition group-hover:opacity-100">
        <h3 className="line-clamp-2 text-sm font-medium">{item.title}</h3>
        <p className="mt-1 text-xs text-slate-300">{[item.year ?? "ohne Jahr", label, metadataLabel(item.genres, 2)].filter(Boolean).join(" · ")}</p>
      </div>
    </article>
  );
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collageFilter, setCollageFilter] = useState<CollageFilter>("all");
  const [collageSort, setCollageSort] = useState<CollageSort>("addedDesc");

  useEffect(() => {
    apiRequest<DashboardResponse>("/api/dashboard").then(setData).catch((caught) => {
      setError(caught instanceof Error ? caught.message : "Dashboard konnte nicht geladen werden.");
    });
  }, []);

  const metrics = useMemo(() => data ? [
    { label: "Heute", value: data.metrics.today, detail: "heute gesehen", icon: CalendarDays },
    { label: "Filme", value: data.metrics.movies, detail: "WatchEvents", icon: Clapperboard },
    { label: "Episoden", value: data.metrics.episodes, detail: "WatchEvents", icon: Tv },
    { label: "Rewatches", value: data.metrics.rewatches, detail: "mehrfach gesehen", icon: Repeat2 },
  ] : [], [data]);

  const visiblePosters = useMemo(() => {
    const collage = data?.collage ?? [];
    const filtered = collage.filter((item) => {
      if (collageFilter === "movie") return item.type === "movie";
      if (collageFilter === "series") return item.type === "show" || item.type === "season";
      return true;
    });

    return [...filtered].sort((left, right) => {
      if (collageSort === "titleAsc") return left.title.localeCompare(right.title, "de");
      if (collageSort === "yearAsc") return (left.year ?? 9999) - (right.year ?? 9999) || left.title.localeCompare(right.title, "de");
      if (collageSort === "yearDesc") return (right.year ?? 0) - (left.year ?? 0) || left.title.localeCompare(right.title, "de");
      if (collageSort === "watchedDesc") return Date.parse(right.watchedAt ?? right.addedAt ?? "0") - Date.parse(left.watchedAt ?? left.addedAt ?? "0");
      return Date.parse(right.addedAt ?? "0") - Date.parse(left.addedAt ?? "0");
    });
  }, [collageFilter, collageSort, data]);

  if (error) {
    return <p className="rounded-md border border-red-500/40 bg-red-950 p-4 text-red-100">{error}</p>;
  }

  if (!data) {
    return <p className="text-slate-300">Dashboard wird geladen...</p>;
  }

  const denseCollage = data.collage.length >= 18;

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-400">Deine gesehene Sammlung wächst als Poster-Kollage mit.</p>
        </div>
        <p className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-300">
          {visiblePosters.length} von {data.collage.length} Postern
        </p>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <article key={metric.label} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-slate-400">{metric.label}</p>
                  <p className="mt-2 text-3xl font-semibold">{metric.value}</p>
                  <p className="mt-1 text-xs text-slate-500">{metric.detail}</p>
                </div>
                <span className="flex h-11 w-11 items-center justify-center rounded-md bg-slate-950 text-teal-300 ring-1 ring-slate-800">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
              </div>
            </article>
          );
        })}
      </div>

      <section className="mt-6 overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900 px-4 py-3">
          <div>
            <h2 className="font-semibold">Poster-Kollage</h2>
            <p className="mt-1 text-sm text-slate-400">Gezeigt werden alle gesehenen Filme und vollständig gesehene Staffeln, damit die Wand mit deiner Sammlung weiterwächst.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label>
              <span className="sr-only">Kollage filtern</span>
              <select className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={collageFilter} onChange={(event) => setCollageFilter(event.target.value as CollageFilter)}>
                <option value="all">Alle</option>
                <option value="movie">Filme</option>
                <option value="series">Serien</option>
              </select>
            </label>
            <label>
              <span className="sr-only">Kollage sortieren</span>
              <select className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={collageSort} onChange={(event) => setCollageSort(event.target.value as CollageSort)}>
                <option value="addedDesc">Neu in WatchLog</option>
                <option value="watchedDesc">Zuletzt gesehen</option>
                <option value="yearAsc">Erscheinungsjahr aufsteigend</option>
                <option value="yearDesc">Erscheinungsjahr absteigend</option>
                <option value="titleAsc">Titel A-Z</option>
              </select>
            </label>
          </div>
        </div>
        {visiblePosters.length === 0 ? (
          <div className="flex min-h-64 items-center justify-center p-6 text-center">
            <div>
              <Film className="mx-auto h-10 w-10 text-slate-600" aria-hidden="true" />
              <p className="mt-3 text-sm text-slate-300">Noch keine Poster vorhanden. TMDb-Suche oder Jellyfin-Sync ergänzt Bilder für die Kollage.</p>
            </div>
          </div>
        ) : (
          <div className={`grid auto-rows-[96px] gap-2 p-3 sm:auto-rows-[120px] ${denseCollage ? "grid-cols-4 md:grid-cols-8 xl:grid-cols-10" : "grid-cols-3 md:grid-cols-6 xl:grid-cols-8"}`}>
            {visiblePosters.map((item, index) => <PosterTile key={item.id} item={item} index={index} dense={denseCollage} />)}
          </div>
        )}
      </section>
    </section>
  );
}
