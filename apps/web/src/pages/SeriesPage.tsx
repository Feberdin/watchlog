/**
 * Purpose: Browse all synced series, seasons, and episodes with quick manual watched marking.
 * Input/Output: Loads `/api/series`, can sync Jellyfin catalog, and posts selected episodes as watched.
 * Invariants: Existing watched events are never removed; bulk actions only add missing WatchEvents.
 * Debugging: If the list is empty, click "Serien synchronisieren" and check the status message.
 */

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, RefreshCw, Search, Tv } from "lucide-react";
import type { SeriesCatalogItem, SeriesEpisode, SeriesSeason } from "@watchlog/shared";
import { apiRequest } from "../api/client";

function episodeTitle(episode: SeriesEpisode) {
  const number = episode.episodeNumber != null ? `E${String(episode.episodeNumber).padStart(2, "0")}` : "E?";
  const year = episode.year ? ` (${episode.year})` : "";
  return `${number} ${episode.title}${year}`;
}

function watchedDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString("de-DE") : "nicht gesehen";
}

export function SeriesPage() {
  const [series, setSeries] = useState<SeriesCatalogItem[]>([]);
  const [query, setQuery] = useState("");
  const [expandedSeries, setExpandedSeries] = useState<Record<string, boolean>>({});
  const [expandedSeasons, setExpandedSeasons] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  async function loadSeries() {
    setLoading(true);
    try {
      setSeries(await apiRequest<SeriesCatalogItem[]>("/api/series"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSeries().catch((caught) => setStatus(caught instanceof Error ? caught.message : "Serien konnten nicht geladen werden."));
  }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return series;
    return series.filter((item) => item.title.toLowerCase().includes(normalized));
  }, [query, series]);

  async function syncJellyfin() {
    setSyncing(true);
    try {
      const response = await apiRequest<{ message: string }>("/api/series/sync-jellyfin", { method: "POST", body: "{}" });
      setStatus(response.message);
      await loadSeries();
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Jellyfin-Sync fehlgeschlagen.");
    } finally {
      setSyncing(false);
    }
  }

  async function markWatched(mediaIds: string[]) {
    const response = await apiRequest<{ created: number; skipped: number }>("/api/series/mark-watched", {
      method: "POST",
      body: JSON.stringify({ mediaIds }),
    });
    setStatus(`${response.created} Episode(n) als gesehen markiert, ${response.skipped} bereits vorhanden.`);
    await loadSeries();
  }

  function markSeason(season: SeriesSeason) {
    const missing = season.episodes.filter((episode) => !episode.watched).map((episode) => episode.id);
    if (missing.length > 0) void markWatched(missing);
  }

  function markSeries(item: SeriesCatalogItem) {
    const missing = item.seasons.flatMap((season) => season.episodes).filter((episode) => !episode.watched).map((episode) => episode.id);
    if (missing.length > 0) void markWatched(missing);
  }

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Serien</h1>
          <p className="mt-1 text-sm text-slate-400">Alle synchronisierten Staffeln und Episoden mit Schnellmarkierung.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-sm">
            Suche
            <span className="mt-1 flex w-72 max-w-full items-center gap-2 rounded-md border border-slate-700 bg-slate-950 px-3 py-2">
              <Search className="h-4 w-4 text-slate-500" aria-hidden="true" />
              <input className="min-w-0 flex-1 bg-transparent outline-none" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Serie suchen" />
            </span>
          </label>
          <button
            className="inline-flex items-center gap-2 rounded-md bg-teal-400 px-3 py-2 text-sm font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={syncing}
            onClick={() => void syncJellyfin()}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {syncing ? "Sync laeuft..." : "Serien synchronisieren"}
          </button>
        </div>
      </div>

      {status && <p className="mt-4 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm">{status}</p>}
      {loading && <p className="mt-4 text-sm text-slate-300">Serien werden geladen...</p>}

      <div className="mt-5 space-y-3">
        {!loading && filtered.length === 0 ? (
          <p className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
            Noch keine Serien vorhanden. Starte zuerst `Serien synchronisieren`.
          </p>
        ) : filtered.map((item) => {
          const open = expandedSeries[item.id] ?? false;
          return (
            <article key={item.id} className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
              <div className="flex gap-4 p-3">
                {item.posterUrl ? <img className="h-28 w-20 rounded-md object-cover ring-1 ring-slate-800" src={item.posterUrl} alt="" /> : (
                  <div className="flex h-28 w-20 items-center justify-center rounded-md bg-slate-800 ring-1 ring-slate-700">
                    <Tv className="h-7 w-7 text-slate-500" aria-hidden="true" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <button className="flex min-w-0 items-center gap-2 text-left font-medium" onClick={() => setExpandedSeries((current) => ({ ...current, [item.id]: !open }))}>
                    {open ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
                    <span className="truncate">{item.title}{item.startYear ? ` (${item.startYear})` : ""}</span>
                    {item.complete && <CheckCircle2 className="h-5 w-5 text-teal-300" aria-label="Komplett gesehen" />}
                  </button>
                  <p className="mt-1 text-sm text-slate-400">{item.watchedEpisodes} / {item.totalEpisodes} Episoden gesehen</p>
                  <button className="mt-3 rounded-md bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700" disabled={item.complete} onClick={() => markSeries(item)}>
                    Ganze Serie als gesehen markieren
                  </button>
                </div>
              </div>

              {open && (
                <div className="border-t border-slate-800 bg-slate-950/60">
                  {item.seasons.map((season) => {
                    const seasonKey = `${item.id}:${season.seasonNumber ?? "unknown"}`;
                    const seasonOpen = expandedSeasons[seasonKey] ?? false;
                    return (
                      <section key={seasonKey} className="border-b border-slate-800 last:border-b-0">
                        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                          <button className="flex items-center gap-2 text-left font-medium" onClick={() => setExpandedSeasons((current) => ({ ...current, [seasonKey]: !seasonOpen }))}>
                            {seasonOpen ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
                            Staffel {season.seasonNumber ?? "?"}{season.startYear ? ` (${season.startYear})` : ""}
                            {season.complete && <CheckCircle2 className="h-4 w-4 text-teal-300" aria-label="Staffel komplett gesehen" />}
                          </button>
                          <div className="flex items-center gap-3 text-sm text-slate-400">
                            <span>{season.watchedEpisodes} / {season.totalEpisodes}</span>
                            <button className="rounded-md bg-slate-800 px-3 py-2 text-slate-100 hover:bg-slate-700" disabled={season.complete} onClick={() => markSeason(season)}>
                              Staffel als gesehen
                            </button>
                          </div>
                        </div>
                        {seasonOpen && (
                          <div className="divide-y divide-slate-800">
                            {season.episodes.map((episode) => (
                              <div key={episode.id} className="grid gap-2 px-6 py-3 sm:grid-cols-[1fr_auto_auto]">
                                <p className={episode.watched ? "text-slate-300" : "text-slate-100"}>{episodeTitle(episode)}</p>
                                <span className="text-sm text-slate-400">{watchedDate(episode.watchedAt)}</span>
                                <button className="rounded-md bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700" disabled={episode.watched} onClick={() => void markWatched([episode.id])}>
                                  Als gesehen
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
