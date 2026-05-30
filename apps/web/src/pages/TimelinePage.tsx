/**
 * Purpose: Chronological watch history with compact movie rows and collapsible series groups.
 * Input/Output: Loads `/api/watch-events`, groups episodes by series, filters locally, and renders watch dates.
 * Invariants: Episodes stay visible inside their series; unknown dates remain visible at the bottom.
 * Debugging: If a series is not grouped, inspect the API fields `seriesId`, `seriesTitle`, and `seasonNumber`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, Clock3, Search, Sparkles, X } from "lucide-react";
import type { TimelineGroup, TimelineItem } from "@watchlog/shared";
import { apiRequest } from "../api/client";
import { PosterPreview } from "../components/PosterPreview";
import { castLabel, genreLabel, metadataLabel } from "../utils/mediaMetadata";

type SortMode = "latest" | "title" | "type";

type TimelineSeasonGroup = {
  seasonNumber: number | null;
  episodes: TimelineItem[];
  watchedEpisodes: number;
  watchtimeSeconds: number;
  lastWatchedAt: string | null;
};

type PeriodStats = {
  total: number;
  movies: number;
  series: number;
  episodes: number;
  watchtimeSeconds: number;
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

type RuntimeEstimateItem = {
  mediaId: string;
  title: string;
  type: string;
  year: number | null;
  seriesTitle: string | null;
  estimatedRuntimeSeconds: number;
  watchEvents: number;
};

type RuntimeStats = {
  knownEvents: number;
  estimatedEvents: number;
  estimatedSeconds: number;
  estimatedMovies: number;
  estimatedSeries: number;
  estimatedEpisodes: number;
  estimatedSeasons: number;
  estimatedItems: RuntimeEstimateItem[];
};

type TimelineStats = {
  sourceNote: string;
  periods: {
    week: PeriodStats;
    month: PeriodStats;
    year: PeriodStats;
  };
  totals: {
    events: number;
    watchtimeSeconds: number;
    jellyfinEvents: number;
    jellyfinWatchtimeSeconds: number;
    rewatches: number;
    firstWatchedAt: string | null;
    runtime: RuntimeStats;
  };
  weekdays: StatsBucket[];
  monthlyTrend: StatsBucket[];
  movies: {
    weekdays: StatsBucket[];
    monthlyTrend: StatsBucket[];
    topWeekday: StatsBucket | null;
    topMonth: StatsBucket | null;
  };
  series: {
    weekdays: StatsBucket[];
    monthlyTrend: StatsBucket[];
    topWeekday: StatsBucket | null;
    topMonth: StatsBucket | null;
  };
  funFacts: {
    topWeekday: StatsBucket | null;
    topTitle: { title: string; type: string; count: number; watchtimeSeconds: number } | null;
    topMonth: StatsBucket | null;
    averageWatchtimeSeconds: number;
  };
};

function formatDuration(seconds: number) {
  if (!seconds || seconds <= 0) {
    return "0 h";
  }

  const hours = seconds / 3600;
  if (hours < 1) {
    return `${Math.round(seconds / 60)} min`;
  }

  return `${hours.toLocaleString("de-DE", { maximumFractionDigits: hours >= 10 ? 0 : 1 })} h`;
}

function formatWatchDate(value: string | null, precision: string) {
  if (!value) {
    return `Datum: ${precision}`;
  }

  return new Date(value).toLocaleString("de-DE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function episodeLabel(item: TimelineItem) {
  const season = item.seasonNumber != null ? `S${String(item.seasonNumber).padStart(2, "0")}` : null;
  const episode = item.episodeNumber != null ? `E${String(item.episodeNumber).padStart(2, "0")}` : null;
  return [season, episode].filter(Boolean).join(" ");
}

function mergeUnique(left: string[], right: string[]) {
  const byName = new Map<string, string>();
  for (const value of [...left, ...right]) {
    const normalized = value.trim();
    if (!normalized) continue;
    byName.set(normalized.toLocaleLowerCase("de-DE"), normalized);
  }

  return [...byName.values()];
}

function groupTimelineItems(items: TimelineItem[]): TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  const seriesMap = new Map<string, Extract<TimelineGroup, { kind: "series" }>>();

  for (const item of items) {
    const fallbackSeriesId = item.seriesId ?? (item.type === "episode" && item.seriesTitle ? `series-title:${item.seriesTitle}` : null);
    if (item.type === "episode" && fallbackSeriesId) {
      const seriesTitle = item.seriesTitle ?? "Unbekannte Serie";
      const existing = seriesMap.get(fallbackSeriesId);
      if (existing) {
        existing.episodes.push(item);
        existing.watchedEpisodes += 1;
        existing.watchtimeSeconds += item.runtimeSeconds ?? 0;
        existing.genres = mergeUnique(existing.genres, item.genres);
        existing.cast = mergeUnique(existing.cast, item.cast);
        if (!existing.lastWatchedAt || (item.watchedAt && item.watchedAt > existing.lastWatchedAt)) {
          existing.lastWatchedAt = item.watchedAt;
        }
        if (!existing.posterUrl && item.seriesPosterUrl) {
          existing.posterUrl = item.seriesPosterUrl;
        }
      } else {
        const group: Extract<TimelineGroup, { kind: "series" }> = {
          kind: "series",
          seriesId: fallbackSeriesId,
          seriesTitle,
          posterUrl: item.seriesPosterUrl ?? item.posterUrl,
          genres: item.genres,
          cast: item.cast,
          watchtimeSeconds: item.runtimeSeconds ?? 0,
          watchedEpisodes: 1,
          totalEpisodes: null,
          isComplete: null,
          lastWatchedAt: item.watchedAt,
          episodes: [item],
        };
        seriesMap.set(fallbackSeriesId, group);
        groups.push(group);
      }
      continue;
    }

    groups.push({ kind: "movie", sortDate: item.watchedAt, item });
  }

  for (const group of seriesMap.values()) {
    group.episodes.sort((a, b) => {
      const seasonDelta = (a.seasonNumber ?? 999) - (b.seasonNumber ?? 999);
      if (seasonDelta !== 0) return seasonDelta;
      const episodeDelta = (a.episodeNumber ?? 999) - (b.episodeNumber ?? 999);
      if (episodeDelta !== 0) return episodeDelta;
      return a.title.localeCompare(b.title, "de");
    });
  }

  return groups;
}

function groupSeriesEpisodesBySeason(episodes: TimelineItem[]): TimelineSeasonGroup[] {
  const seasons = new Map<string, TimelineSeasonGroup>();
  for (const episode of episodes) {
    const key = episode.seasonNumber === null ? "unknown" : String(episode.seasonNumber);
    const current = seasons.get(key) ?? {
      seasonNumber: episode.seasonNumber,
      episodes: [],
      watchedEpisodes: 0,
      watchtimeSeconds: 0,
      lastWatchedAt: null,
    };
    current.episodes.push(episode);
    current.watchedEpisodes += 1;
    current.watchtimeSeconds += episode.runtimeSeconds ?? 0;
    if (!current.lastWatchedAt || (episode.watchedAt && episode.watchedAt > current.lastWatchedAt)) {
      current.lastWatchedAt = episode.watchedAt;
    }
    seasons.set(key, current);
  }

  return [...seasons.values()].sort((left, right) => (left.seasonNumber ?? 9999) - (right.seasonNumber ?? 9999));
}

function seasonLabel(seasonNumber: number | null) {
  return seasonNumber === null ? "Staffel unbekannt" : `Staffel ${seasonNumber}`;
}

function groupTitle(group: TimelineGroup) {
  return group.kind === "movie" ? group.item.title : group.seriesTitle;
}

function groupSortDate(group: TimelineGroup) {
  return group.kind === "movie" ? group.sortDate : group.lastWatchedAt;
}

function mediaTypeLabel(type: TimelineItem["type"]) {
  if (type === "movie") return "Film";
  if (type === "show") return "Serie";
  if (type === "season") return "Staffel";
  return "Episode";
}

function runtimeMediaLabel(type: string) {
  if (type === "movie") return "Film";
  if (type === "show") return "Serie";
  if (type === "season") return "Staffel";
  if (type === "episode") return "Episode";
  return "Medium";
}

function sortGroups(groups: TimelineGroup[], sortMode: SortMode) {
  return [...groups].sort((a, b) => {
    if (sortMode === "title") {
      return groupTitle(a).localeCompare(groupTitle(b), "de");
    }

    if (sortMode === "type") {
      if (a.kind !== b.kind) return a.kind === "movie" ? -1 : 1;
      return groupTitle(a).localeCompare(groupTitle(b), "de");
    }

    const left = groupSortDate(a) ? new Date(groupSortDate(a)!).getTime() : 0;
    const right = groupSortDate(b) ? new Date(groupSortDate(b)!).getTime() : 0;
    return right - left;
  });
}

function StatCard({ label, stats }: { label: string; stats: PeriodStats }) {
  return (
    <article className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400">{label}</p>
          <p className="mt-2 text-3xl font-semibold">{stats.total}</p>
        </div>
        <span className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-950 text-teal-300 ring-1 ring-slate-800">
          <CalendarDays className="h-5 w-5" aria-hidden="true" />
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-400">
        <span>{stats.movies} Filme</span>
        <span>{stats.series} Serien</span>
        <span>{stats.episodes} Folgen</span>
      </div>
      <p className="mt-2 flex items-center gap-1 text-sm text-slate-300">
        <Clock3 className="h-4 w-4 text-slate-500" aria-hidden="true" />
        {formatDuration(stats.watchtimeSeconds)}
      </p>
    </article>
  );
}

function detailText(items: StatsDetail[]) {
  if (items.length === 0) {
    return "Keine Jellyfin-Titel in diesem Zeitraum.";
  }

  return items.map((item) => `${item.title}: ${formatDuration(item.watchtimeSeconds)}${item.count > 1 ? `, ${item.count} Eintraege` : ""}`).join("\n");
}

function BarList({ items, mode }: { items: StatsBucket[]; mode: "count" | "watchtime" }) {
  const max = Math.max(1, ...items.map((item) => mode === "count" ? item.count : item.watchtimeSeconds));

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const value = mode === "count" ? item.count : item.watchtimeSeconds;
        const width = Math.max(3, Math.round((value / max) * 100));
        return (
          <div key={item.label} className="group relative grid grid-cols-[72px_1fr_70px] items-center gap-3 text-sm" title={detailText(item.items)}>
            <span className="truncate text-slate-400">{item.label}</span>
            <span className="h-3 overflow-hidden rounded-full bg-slate-800">
              <span className="block h-full rounded-full bg-teal-300" style={{ width: `${width}%` }} />
            </span>
            <span className="text-right text-slate-300">{mode === "count" ? item.count : formatDuration(item.watchtimeSeconds)}</span>
            {item.items.length > 0 && (
              <span className="pointer-events-none absolute left-16 top-5 z-30 hidden w-80 rounded-md border border-slate-700 bg-slate-950 p-3 text-xs text-slate-200 shadow-xl group-hover:block">
                <span className="mb-2 block font-medium text-teal-200">{item.label}</span>
                {item.items.map((detail) => (
                  <span key={`${detail.type}-${detail.title}`} className="mb-1 block">
                    {detail.title}
                    <span className="text-slate-400"> · {formatDuration(detail.watchtimeSeconds)}{detail.count > 1 ? ` · ${detail.count}x` : ""}</span>
                  </span>
                ))}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RuntimeAdjustmentDialog({
  stats,
  onClose,
  onSaved,
}: {
  stats: RuntimeStats;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [draftMinutes, setDraftMinutes] = useState<Record<string, string>>(() => Object.fromEntries(
    stats.estimatedItems.map((item) => [item.mediaId, String(Math.round(item.estimatedRuntimeSeconds / 60))]),
  ));
  const [savingId, setSavingId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function saveRuntime(item: RuntimeEstimateItem) {
    const minutes = Number(draftMinutes[item.mediaId]);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
      setStatus("Bitte eine Laufzeit zwischen 1 und 1440 Minuten eintragen.");
      return;
    }

    setSavingId(item.mediaId);
    setStatus(null);
    try {
      await apiRequest(`/api/media/${item.mediaId}/runtime`, {
        method: "PATCH",
        body: JSON.stringify({ runtimeSeconds: Math.round(minutes * 60) }),
      });
      await onSaved();
      setStatus(`Laufzeit fuer "${item.title}" wurde gespeichert.`);
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Laufzeit konnte nicht gespeichert werden.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
      <section className="max-h-[86vh] w-full max-w-3xl overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-4 py-3">
          <div>
            <h2 className="font-semibold">Laufzeiten anpassen</h2>
            <p className="mt-1 text-sm text-slate-400">
              {stats.estimatedEvents} Einträge nutzen aktuell Schätzwerte: {stats.estimatedMovies} Filme, {stats.estimatedSeries} Serien, {stats.estimatedEpisodes} Episoden.
            </p>
          </div>
          <button type="button" className="rounded-md p-2 text-slate-300 hover:bg-slate-800" onClick={onClose} aria-label="Schließen">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="max-h-[62vh] overflow-y-auto p-4">
          {stats.estimatedItems.length === 0 ? (
            <p className="rounded-md border border-slate-800 bg-slate-950 p-3 text-sm text-slate-300">Alle sichtbaren WatchEvents haben bereits eine Laufzeit.</p>
          ) : (
            <div className="space-y-2">
              {stats.estimatedItems.map((item) => (
                <article key={item.mediaId} className="grid gap-3 rounded-md border border-slate-800 bg-slate-950 p-3 sm:grid-cols-[1fr_150px_auto] sm:items-center">
                  <div className="min-w-0">
                    <h3 className="truncate font-medium">{item.seriesTitle ? `${item.seriesTitle} · ${item.title}` : item.title}</h3>
                    <p className="mt-1 text-sm text-slate-400">
                      {[runtimeMediaLabel(item.type), item.year ?? "ohne Jahr", `${item.watchEvents} WatchEvent${item.watchEvents === 1 ? "" : "s"}`, `Schätzung ${formatDuration(item.estimatedRuntimeSeconds)}`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <label className="block text-sm text-slate-300">
                    Minuten
                    <input
                      className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2"
                      inputMode="numeric"
                      value={draftMinutes[item.mediaId] ?? ""}
                      onChange={(event) => setDraftMinutes((current) => ({ ...current, [item.mediaId]: event.target.value }))}
                    />
                  </label>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded-md bg-teal-400 px-3 py-2 text-sm font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={savingId === item.mediaId}
                    onClick={() => void saveRuntime(item)}
                  >
                    {savingId === item.mediaId ? "Speichert..." : "Speichern"}
                  </button>
                </article>
              ))}
            </div>
          )}
        </div>

        {status && <p className="border-t border-slate-800 px-4 py-3 text-sm text-slate-300">{status}</p>}
      </section>
    </div>
  );
}

function TimelineStatsPanel({ stats, onRuntimeSaved }: { stats: TimelineStats | null; onRuntimeSaved: () => Promise<void> }) {
  const [runtimeDialogOpen, setRuntimeDialogOpen] = useState(false);

  if (!stats) {
    return <p className="mt-5 rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">Statistiken werden geladen...</p>;
  }

  const runtime = stats.totals.runtime;
  const runtimeHint = `Geschätzt: ${runtime.estimatedMovies} Filme, ${runtime.estimatedSeries} Serien, ${runtime.estimatedEpisodes} Episoden.`;

  return (
    <section className="mt-5 space-y-4">
      <article className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Gesamte Watchtime</h2>
            <p className="mt-1 text-sm text-slate-400">Alle gespeicherten Filme, Serien und Episoden; fehlende Laufzeiten werden markiert geschätzt.</p>
          </div>
          <button
            type="button"
            className="rounded-md px-3 py-2 text-right hover:bg-slate-800"
            title={runtimeHint}
            onClick={() => setRuntimeDialogOpen(true)}
          >
            <span className="block text-3xl font-semibold text-teal-200">{formatDuration(stats.totals.watchtimeSeconds)}</span>
            {runtime.estimatedEvents > 0 && (
              <span className="mt-1 block text-xs text-slate-400">{runtime.estimatedEvents} geschätzte WatchEvents</span>
            )}
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500">{stats.sourceNote}</p>
      </article>

      {runtimeDialogOpen && (
        <RuntimeAdjustmentDialog stats={runtime} onClose={() => setRuntimeDialogOpen(false)} onSaved={onRuntimeSaved} />
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        <StatCard label="Letzte 7 Tage" stats={stats.periods.week} />
        <StatCard label="Dieser Monat" stats={stats.periods.month} />
        <StatCard label="Dieses Jahr" stats={stats.periods.year} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <div className="mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-teal-300" aria-hidden="true" />
            <h2 className="font-semibold">Filme: Watchtime nach Wochentag</h2>
          </div>
          <BarList items={stats.movies.weekdays} mode="watchtime" />
        </article>

        <article className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <div className="mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-teal-300" aria-hidden="true" />
            <h2 className="font-semibold">Filme: Trend der letzten 12 Monate</h2>
          </div>
          <BarList items={stats.movies.monthlyTrend} mode="count" />
        </article>

        <article className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <div className="mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-teal-300" aria-hidden="true" />
            <h2 className="font-semibold">Serien: Watchtime nach Wochentag</h2>
          </div>
          <BarList items={stats.series.weekdays} mode="watchtime" />
        </article>

        <article className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <div className="mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-teal-300" aria-hidden="true" />
            <h2 className="font-semibold">Serien: Trend der letzten 12 Monate</h2>
          </div>
          <BarList items={stats.series.monthlyTrend} mode="count" />
        </article>
      </div>

      <article className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-teal-300" aria-hidden="true" />
          <h2 className="font-semibold">Fun Facts</h2>
        </div>
        {stats.totals.jellyfinEvents === 0 ? (
          <p className="text-sm text-slate-300">Noch nicht genug Daten für belastbare Fun Facts.</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            <p className="rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300">
              Film-Top-Tag: {stats.movies.topWeekday ? `${stats.movies.topWeekday.label}, ${formatDuration(stats.movies.topWeekday.watchtimeSeconds)}` : "noch offen"}.
            </p>
            <p className="rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300">
              Serien-Top-Tag: {stats.series.topWeekday ? `${stats.series.topWeekday.label}, ${formatDuration(stats.series.topWeekday.watchtimeSeconds)}` : "noch offen"}.
            </p>
            <p className="rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300">
              Film-Trendmonat: {stats.movies.topMonth && stats.movies.topMonth.count > 0 ? `${stats.movies.topMonth.label} mit ${stats.movies.topMonth.count} Jellyfin-Eintraegen` : "noch offen"}.
            </p>
            <p className="rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300">
              Serien-Trendmonat: {stats.series.topMonth && stats.series.topMonth.count > 0 ? `${stats.series.topMonth.label} mit ${stats.series.topMonth.count} Jellyfin-Eintraegen` : "noch offen"}.
            </p>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Gesamt: {stats.totals.events} Einträge, {formatDuration(stats.totals.watchtimeSeconds)} Watchtime, davon {stats.totals.jellyfinEvents} Jellyfin-Einträge mit {formatDuration(stats.totals.jellyfinWatchtimeSeconds)}.
        </p>
      </article>
    </section>
  );
}

export function TimelinePage() {
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [stats, setStats] = useState<TimelineStats | null>(null);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("latest");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [expandedSeasons, setExpandedSeasons] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const loadTimeline = useCallback(async () => {
    setError(null);
    try {
      const [loadedItems, loadedStats] = await Promise.all([
        apiRequest<TimelineItem[]>("/api/watch-events"),
        apiRequest<TimelineStats>("/api/watch-events/stats"),
      ]);
      setItems(loadedItems);
      setStats(loadedStats);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Timeline konnte nicht geladen werden.");
    }
  }, []);

  useEffect(() => {
    void loadTimeline();
  }, [loadTimeline]);

  const filteredGroups = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = normalized
      ? items.filter((item) => {
        const searchable = [item.title, item.seriesTitle, item.year?.toString(), ...item.genres, ...item.cast].filter(Boolean).join(" ").toLowerCase();
        return searchable.includes(normalized);
      })
      : items;

    return sortGroups(groupTimelineItems(filtered), sortMode);
  }, [items, query, sortMode]);

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Timeline</h1>
          <p className="mt-1 text-sm text-slate-400">Filme einzeln, Serien kompakt mit aufklappbaren Episoden.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-sm">
            Suche
            <span className="mt-1 flex w-72 max-w-full items-center gap-2 rounded-md border border-slate-700 bg-slate-950 px-3 py-2">
              <Search className="h-4 w-4 text-slate-500" aria-hidden="true" />
              <input className="min-w-0 flex-1 bg-transparent outline-none" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Titel oder Serie" />
            </span>
          </label>
          <label className="block text-sm">
            Sortierung
            <select className="mt-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
              <option value="latest">Zuletzt gesehen</option>
              <option value="title">Titel A-Z</option>
              <option value="type">Filme zuerst</option>
            </select>
          </label>
        </div>
      </div>

      {error && <p className="mt-4 rounded-md border border-red-500/40 bg-red-950 p-4 text-red-100">{error}</p>}

      <TimelineStatsPanel stats={stats} onRuntimeSaved={loadTimeline} />

      <div className="mt-5 space-y-3">
        {filteredGroups.length === 0 ? (
          <p className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">Keine Eintraege gefunden.</p>
        ) : filteredGroups.map((group) => {
          if (group.kind === "movie") {
            const item = group.item;
            return (
              <article key={item.id} className="flex gap-4 rounded-lg border border-slate-800 bg-slate-900 p-3">
                <PosterPreview
                  src={item.posterUrl}
                  title={item.title}
                  kind={item.type === "movie" ? "movie" : "series"}
                  className="h-24 w-16"
                  typeLabel={mediaTypeLabel(item.type)}
                  year={item.year}
                  meta={[genreLabel(item.genres), castLabel(item.cast), `Quelle: ${item.source}`, `Rewatch #${item.rewatchIndex}`, formatWatchDate(item.watchedAt, item.datePrecision)]}
                  cast={item.cast}
                  overview={item.note}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{item.title} {item.year ? <span className="text-slate-400">({item.year})</span> : null}</p>
                      <p className="mt-1 text-sm text-slate-400">
                        {[mediaTypeLabel(item.type), metadataLabel(item.genres), `Quelle: ${item.source}`, `Rewatch #${item.rewatchIndex}`].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <time className="text-sm text-slate-300">{formatWatchDate(item.watchedAt, item.datePrecision)}</time>
                  </div>
                  {item.note && <p className="mt-2 text-sm text-slate-300">{item.note}</p>}
                </div>
              </article>
            );
          }

          const open = expanded[group.seriesId] ?? false;
          const seasons = groupSeriesEpisodesBySeason(group.episodes);
          return (
            <article key={group.seriesId} className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
              <button
                type="button"
                className="flex w-full gap-4 p-3 text-left hover:bg-slate-800/60"
                onClick={() => setExpanded((current) => ({ ...current, [group.seriesId]: !open }))}
              >
                <PosterPreview
                  src={group.posterUrl}
                  title={group.seriesTitle}
                  kind="series"
                  className="h-24 w-16"
                  typeLabel="Serie"
                  meta={[
                    genreLabel(group.genres),
                    castLabel(group.cast),
                    `${group.watchedEpisodes} Episode${group.watchedEpisodes === 1 ? "" : "n"} gesehen`,
                    group.totalEpisodes ? `${group.totalEpisodes} Episoden gesamt` : null,
                    group.watchtimeSeconds > 0 ? formatDuration(group.watchtimeSeconds) : null,
                    formatWatchDate(group.lastWatchedAt, "unknown"),
                  ]}
                  cast={group.cast}
                  focusable={false}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-medium">
                        {open ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
                        <span className="truncate">{group.seriesTitle}</span>
                        {group.isComplete === true && <CheckCircle2 className="h-5 w-5 text-teal-300" aria-label="Komplett gesehen" />}
                      </p>
                      <p className="mt-1 text-sm text-slate-400">
                        Serie · {group.watchedEpisodes} Episode{group.watchedEpisodes === 1 ? "" : "n"} gesehen
                        {group.totalEpisodes ? ` von ${group.totalEpisodes}` : ""}
                        {group.genres.length > 0 ? ` · ${metadataLabel(group.genres)}` : ""}
                        {group.watchtimeSeconds > 0 ? ` · ${formatDuration(group.watchtimeSeconds)}` : ""}
                      </p>
                    </div>
                    <time className="text-sm text-slate-300">{formatWatchDate(group.lastWatchedAt, "unknown")}</time>
                  </div>
                </div>
              </button>
              {open && (
                <div className="border-t border-slate-800 bg-slate-950/60">
                  {seasons.map((season) => {
                    const seasonKey = `${group.seriesId}:${season.seasonNumber ?? "unknown"}`;
                    const seasonOpen = expandedSeasons[seasonKey] ?? false;
                    return (
                      <section key={seasonKey} className="border-b border-slate-800 last:border-b-0">
                        <button
                          type="button"
                          className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-900"
                          onClick={() => setExpandedSeasons((current) => ({ ...current, [seasonKey]: !seasonOpen }))}
                        >
                          <span className="flex items-center gap-2 font-medium">
                            {seasonOpen ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
                            {seasonLabel(season.seasonNumber)}
                          </span>
                          <span className="text-sm text-slate-400">
                            {season.watchedEpisodes} Episode{season.watchedEpisodes === 1 ? "" : "n"}
                            {season.watchtimeSeconds > 0 ? ` · ${formatDuration(season.watchtimeSeconds)}` : ""}
                            {" · "}{formatWatchDate(season.lastWatchedAt, "unknown")}
                          </span>
                        </button>
                        {seasonOpen && (
                          <div className="divide-y divide-slate-800">
                            {season.episodes.map((episode) => (
                              <div key={episode.id} className="grid gap-2 px-6 py-3 sm:grid-cols-[1fr_auto]">
                                <div>
                                  <p className="font-medium">{episodeLabel(episode)} {episode.title}</p>
                                  <p className="text-sm text-slate-400">
                                    {[metadataLabel(episode.genres), `Quelle: ${episode.source}`, `Rewatch #${episode.rewatchIndex}`].filter(Boolean).join(" · ")}
                                  </p>
                                </div>
                                <time className="text-sm text-slate-300">{formatWatchDate(episode.watchedAt, episode.datePrecision)}</time>
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
