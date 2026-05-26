/**
 * Purpose: Chronological watch history with compact movie rows and collapsible series groups.
 * Input/Output: Loads `/api/watch-events`, groups episodes by series, filters locally, and renders watch dates.
 * Invariants: Episodes stay visible inside their series; unknown dates remain visible at the bottom.
 * Debugging: If a series is not grouped, inspect the API fields `seriesId`, `seriesTitle`, and `seasonNumber`.
 */

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Film, Search, Tv } from "lucide-react";
import type { TimelineGroup, TimelineItem } from "@watchlog/shared";
import { apiRequest } from "../api/client";

type SortMode = "latest" | "title" | "type";

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

function Poster({ src, icon }: { src: string | null; icon: "movie" | "series" }) {
  const Icon = icon === "movie" ? Film : Tv;
  return src ? (
    <img className="h-24 w-16 shrink-0 rounded-md object-cover ring-1 ring-slate-800" src={src} alt="" loading="lazy" />
  ) : (
    <div className="flex h-24 w-16 shrink-0 items-center justify-center rounded-md bg-slate-800 ring-1 ring-slate-700">
      <Icon className="h-7 w-7 text-slate-500" aria-hidden="true" />
    </div>
  );
}

export function TimelinePage() {
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("latest");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<TimelineItem[]>("/api/watch-events").then(setItems).catch((caught) => {
      setError(caught instanceof Error ? caught.message : "Timeline konnte nicht geladen werden.");
    });
  }, []);

  const filteredGroups = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = normalized
      ? items.filter((item) => {
        const searchable = [item.title, item.seriesTitle, item.year?.toString()].filter(Boolean).join(" ").toLowerCase();
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

      <div className="mt-5 space-y-3">
        {filteredGroups.length === 0 ? (
          <p className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">Keine Eintraege gefunden.</p>
        ) : filteredGroups.map((group) => {
          if (group.kind === "movie") {
            const item = group.item;
            return (
              <article key={item.id} className="flex gap-4 rounded-lg border border-slate-800 bg-slate-900 p-3">
                <Poster src={item.posterUrl} icon={item.type === "movie" ? "movie" : "series"} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{item.title} {item.year ? <span className="text-slate-400">({item.year})</span> : null}</p>
                      <p className="mt-1 text-sm text-slate-400">{mediaTypeLabel(item.type)} · Quelle: {item.source} · Rewatch #{item.rewatchIndex}</p>
                    </div>
                    <time className="text-sm text-slate-300">{formatWatchDate(item.watchedAt, item.datePrecision)}</time>
                  </div>
                  {item.note && <p className="mt-2 text-sm text-slate-300">{item.note}</p>}
                </div>
              </article>
            );
          }

          const open = expanded[group.seriesId] ?? false;
          return (
            <article key={group.seriesId} className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
              <button
                type="button"
                className="flex w-full gap-4 p-3 text-left hover:bg-slate-800/60"
                onClick={() => setExpanded((current) => ({ ...current, [group.seriesId]: !open }))}
              >
                <Poster src={group.posterUrl} icon="series" />
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
                      </p>
                    </div>
                    <time className="text-sm text-slate-300">{formatWatchDate(group.lastWatchedAt, "unknown")}</time>
                  </div>
                </div>
              </button>
              {open && (
                <div className="border-t border-slate-800 bg-slate-950/60">
                  {group.episodes.map((episode) => (
                    <div key={episode.id} className="grid gap-2 border-b border-slate-800 px-4 py-3 last:border-b-0 sm:grid-cols-[1fr_auto]">
                      <div>
                        <p className="font-medium">{episodeLabel(episode)} {episode.title}</p>
                        <p className="text-sm text-slate-400">Quelle: {episode.source} · Rewatch #{episode.rewatchIndex}</p>
                      </div>
                      <time className="text-sm text-slate-300">{formatWatchDate(episode.watchedAt, episode.datePrecision)}</time>
                    </div>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
