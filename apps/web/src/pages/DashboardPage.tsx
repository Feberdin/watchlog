/**
 * Purpose: Dashboard summary with growing poster collage and recent watching activity.
 * Input/Output: Loads `/api/dashboard`, renders metrics, optimized posters, and latest WatchEvents.
 * Invariants: Empty states must show the next useful action; broken posters degrade to simple placeholders.
 * Debugging: If posters are missing, inspect `collage[].posterUrl` and `/api/media/:id/poster.webp` responses.
 */

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Clapperboard, Film, History, Repeat2, Tv } from "lucide-react";
import { apiRequest } from "../api/client";

type DashboardPoster = {
  id: string;
  title: string;
  type: string;
  year: number | null;
  seasonNumber: number | null;
  watchedAt: string | null;
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

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }) : "Datum unbekannt";
}

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

  return (
    <article className={`group relative min-h-24 overflow-hidden rounded-md border border-slate-800 bg-slate-900 ${sizeClass}`}>
      {item.posterUrl ? (
        <img className="h-full w-full object-cover transition duration-300 group-hover:scale-105" src={item.posterUrl} alt="" loading="lazy" />
      ) : (
        <div className="flex h-full min-h-32 items-center justify-center bg-slate-800">
          <Film className="h-8 w-8 text-slate-500" aria-hidden="true" />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-slate-950/95 via-slate-950/65 to-transparent p-2 opacity-0 transition group-hover:opacity-100">
        <h3 className="line-clamp-2 text-sm font-medium">{item.title}</h3>
        <p className="mt-1 text-xs text-slate-300">{item.year ?? "ohne Jahr"} · {typeLabel(item.type)}</p>
      </div>
      {item.type === "season" && item.seasonNumber !== null && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-slate-950/10">
          <span className="rounded-md bg-slate-950/45 px-3 py-1 text-4xl font-black text-white/80 ring-1 ring-white/10 sm:text-5xl">
            S{String(item.seasonNumber).padStart(2, "0")}
          </span>
        </div>
      )}
    </article>
  );
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (error) {
    return <p className="rounded-md border border-red-500/40 bg-red-950 p-4 text-red-100">{error}</p>;
  }

  if (!data) {
    return <p className="text-slate-300">Dashboard wird geladen...</p>;
  }

  const denseCollage = data.collage.length >= 18;
  const visiblePosters = data.collage.slice(0, data.collage.length >= 30 ? 40 : 24);

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-400">Deine gesehene Sammlung wächst als Poster-Kollage mit.</p>
        </div>
        <p className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-300">
          {data.collage.length} Filme/Staffeln
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
            <p className="mt-1 text-sm text-slate-400">Gezeigte Titel sind gesehene Filme und vollständig gesehene Staffeln, damit Episoden die Wand nicht überfüllen.</p>
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

      <section className="mt-6">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-slate-400" aria-hidden="true" />
          <h2 className="text-lg font-semibold">Zuletzt gesehen</h2>
        </div>
        <div className="mt-3 overflow-hidden rounded-lg border border-slate-800">
          {data.recent.length === 0 ? (
            <p className="bg-slate-900 p-4 text-sm text-slate-300">Noch keine WatchEvents vorhanden. Lege manuell einen Film an oder sende einen Jellyfin-Webhook.</p>
          ) : (
            data.recent.map((item) => (
              <article key={item.id} className="flex items-center gap-3 border-b border-slate-800 bg-slate-900 px-4 py-3 last:border-b-0">
                {item.posterUrl ? (
                  <img className="h-16 w-11 rounded object-cover ring-1 ring-slate-800" src={item.posterUrl} alt="" loading="lazy" />
                ) : (
                  <div className="flex h-16 w-11 items-center justify-center rounded bg-slate-800">
                    <Film className="h-5 w-5 text-slate-500" aria-hidden="true" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{item.title}</p>
                  <p className="text-sm text-slate-400">{typeLabel(item.type)} · {item.datePrecision}</p>
                </div>
                <time className="shrink-0 text-right text-sm text-slate-300">{formatDate(item.watchedAt)}</time>
              </article>
            ))
          )}
        </div>
      </section>
    </section>
  );
}
