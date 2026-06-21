/**
 * Purpose: Manual historical watch entry form backed by TMDb search.
 * Input/Output: Users search TMDb, select an exact movie/show, and create a manual WatchEvent.
 * Invariants: Free-text titles are not stored from this page; manual deletes never remove Jellyfin-linked media.
 * Debugging: Search/import/save/delete errors are shown inline; browser Network tab shows the exact API step.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Download, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import type { TmdbJellyseerrBulkRequestResult, TmdbSearchResult, TmdbSeasonOption } from "@watchlog/shared";
import { apiRequest } from "../api/client";
import { PosterPreview } from "../components/PosterPreview";
import { castLabel, genreLabel, metadataLabel } from "../utils/mediaMetadata";

type DatePrecision = "exact" | "date" | "month" | "year" | "unknown";

type MediaRecord = {
  id: string;
  type: "movie" | "show" | "season" | "episode";
  title: string;
  year: number | null;
  genres: string[];
  cast: string[];
  posterUrl: string | null;
  tmdbId: string | null;
  jellyfinItemId: string | null;
  metadataSource: string;
};

type DeleteMediaResponse = {
  deletedMedia: boolean;
  deletedWatchEvents: number;
  message: string;
};

const precisionHelp: Record<DatePrecision, string> = {
  exact: "z. B. 2020-04-01T20:15:00",
  date: "z. B. 2020-04-01",
  month: "z. B. 2020-04",
  year: "z. B. 2020",
  unknown: "leer lassen",
};

function mediaLabel(type: MediaRecord["type"] | TmdbSearchResult["type"]) {
  return type === "movie" ? "Film" : "Serie";
}

function canDeleteMedia(media: MediaRecord) {
  return !media.jellyfinItemId && ["manual", "tmdb"].includes(media.metadataSource);
}

function resultKey(result: TmdbSearchResult) {
  return `${result.type}-${result.tmdbId}`;
}

function defaultWatchedAtFor(result: TmdbSearchResult, precision: DatePrecision, value: string) {
  if (precision === "unknown") {
    return null;
  }

  if (value.trim()) {
    return value.trim();
  }

  return precision === "year" && result.year ? String(result.year) : null;
}

export function ManualAddPage() {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"movie" | "show">("movie");
  const [year, setYear] = useState("");
  const [results, setResults] = useState<TmdbSearchResult[]>([]);
  const [selected, setSelected] = useState<TmdbSearchResult | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [datePrecision, setDatePrecision] = useState<DatePrecision>("year");
  const [watchedAt, setWatchedAt] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [seasonOptions, setSeasonOptions] = useState<TmdbSeasonOption[]>([]);
  const [selectedSeasonNumbers, setSelectedSeasonNumbers] = useState<Set<number>>(new Set());
  const [media, setMedia] = useState<MediaRecord[]>([]);
  const [missingPosters, setMissingPosters] = useState<MediaRecord[]>([]);
  const [posterBusyId, setPosterBusyId] = useState<string | null>(null);
  const [deleteQuery, setDeleteQuery] = useState("");
  const seasonRequestId = useRef(0);

  const deletableMedia = useMemo(
    () => media.filter(canDeleteMedia).sort((left, right) => left.title.localeCompare(right.title, "de")),
    [media],
  );

  const visibleDeletableMedia = useMemo(() => {
    const normalized = deleteQuery.trim().toLocaleLowerCase("de-DE");
    if (!normalized) {
      return deletableMedia;
    }

    return deletableMedia.filter((item) => [item.title, item.year?.toString(), item.tmdbId, item.metadataSource, ...item.genres]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("de-DE")
      .includes(normalized));
  }, [deleteQuery, deletableMedia]);

  useEffect(() => {
    void loadMedia().catch((caught) => {
      setStatus(caught instanceof Error ? caught.message : "Manuell angelegte Titel konnten nicht geladen werden.");
    });
    void loadMissingPosters().catch(() => undefined);
  }, []);

  async function loadMedia() {
    const loaded = await apiRequest<MediaRecord[]>("/api/media");
    setMedia(loaded);
  }

  async function loadMissingPosters() {
    const loaded = await apiRequest<MediaRecord[]>("/api/media/missing-posters");
    setMissingPosters(loaded);
  }

  async function search() {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setStatus("Bitte mindestens zwei Zeichen suchen.");
      return;
    }

    setLoading(true);
    setStatus(null);
    setSelected(null);
    setSeasonOptions([]);
    setSelectedSeasonNumbers(new Set());
    try {
      const params = new URLSearchParams({ query: trimmed, type });
      if (year.trim()) {
        params.set("year", year.trim());
      }
      const found = await apiRequest<TmdbSearchResult[]>(`/api/metadata/tmdb/search?${params.toString()}`);
      setResults(found);
      setSelectedKeys(new Set());
      setStatus(found.length === 0 ? "Keine TMDb-Treffer gefunden. Bitte Titel oder Jahr anpassen." : null);
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "TMDb-Suche ist fehlgeschlagen.");
    } finally {
      setLoading(false);
    }
  }

  function selectResult(result: TmdbSearchResult) {
    setSelected(result);
    if (datePrecision === "year" && !watchedAt.trim() && result.year) {
      setWatchedAt(String(result.year));
    }
    void loadSeasonsForResult(result);
  }

  async function loadSeasonsForResult(result: TmdbSearchResult) {
    seasonRequestId.current += 1;
    const requestId = seasonRequestId.current;
    setSeasonOptions([]);
    setSelectedSeasonNumbers(new Set());
    if (result.type !== "show") {
      return;
    }

    setSeasonLoading(true);
    try {
      const seasons = await apiRequest<TmdbSeasonOption[]>(`/api/metadata/tmdb/show/${result.tmdbId}/seasons`);
      if (seasonRequestId.current !== requestId) {
        return;
      }
      setSeasonOptions(seasons);
      setSelectedSeasonNumbers(new Set(seasons.map((season) => season.seasonNumber)));
      if (seasons.length === 0) {
        setStatus("TMDb liefert fuer diese Serie keine aktuellen Staffeln.");
      }
    } catch (caught) {
      if (seasonRequestId.current !== requestId) {
        return;
      }
      setStatus(caught instanceof Error ? caught.message : "Staffeln konnten nicht von TMDb geladen werden.");
    } finally {
      if (seasonRequestId.current === requestId) {
        setSeasonLoading(false);
      }
    }
  }

  function toggleResult(result: TmdbSearchResult) {
    const key = resultKey(result);
    setSelectedKeys((existing) => {
      const next = new Set(existing);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function toggleSeasonNumber(seasonNumber: number) {
    setSelectedSeasonNumbers((existing) => {
      const next = new Set(existing);
      if (next.has(seasonNumber)) {
        next.delete(seasonNumber);
      } else {
        next.add(seasonNumber);
      }
      return next;
    });
  }

  async function createWatchForResult(result: TmdbSearchResult, seasonNumbers?: number[]) {
    const imported = await apiRequest<MediaRecord>("/api/metadata/tmdb/import", {
      method: "POST",
      body: JSON.stringify({ type: result.type, tmdbId: result.tmdbId }),
    });
    await apiRequest("/api/watch-events/manual", {
      method: "POST",
      body: JSON.stringify({
        mediaId: imported.id,
        datePrecision,
        watchedAt: defaultWatchedAtFor(result, datePrecision, watchedAt),
        note,
        ...(result.type === "show" && seasonNumbers && seasonNumbers.length > 0 ? { seasonNumbers } : {}),
      }),
    });
    return imported;
  }

  async function submit() {
    if (!selected) {
      setStatus("Bitte zuerst einen TMDb-Treffer auswaehlen.");
      return;
    }

    setSaving(true);
    setStatus(null);
    try {
      if (selected.type === "show" && seasonOptions.length > 0 && selectedSeasonNumbers.size === 0) {
        setStatus("Bitte mindestens eine Staffel auswaehlen.");
        return;
      }

      const imported = await createWatchForResult(
        selected,
        selected.type === "show" ? [...selectedSeasonNumbers] : undefined,
      );
      setWatchedAt("");
      setNote("");
      setSelected(null);
      setSeasonOptions([]);
      setSelectedSeasonNumbers(new Set());
      await loadMedia();
      setStatus(selected.type === "show"
        ? `${imported.title} wurde fuer die ausgewaehlten Staffeln als gesehen gespeichert.`
        : `${imported.title} wurde als gesehen gespeichert.`);
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Eintrag konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  async function submitSelected() {
    const selectedResults = results.filter((result) => selectedKeys.has(resultKey(result)));
    if (selectedResults.length === 0) {
      setStatus("Bitte mindestens einen TMDb-Treffer fuer die Massenauswahl markieren.");
      return;
    }

    setSaving(true);
    setStatus(`0/${selectedResults.length} Titel gespeichert...`);
    try {
      for (let index = 0; index < selectedResults.length; index += 1) {
        await createWatchForResult(selectedResults[index]!);
        setStatus(`${index + 1}/${selectedResults.length} Titel gespeichert...`);
      }
      setWatchedAt("");
      setNote("");
      setSelected(null);
      setSeasonOptions([]);
      setSelectedSeasonNumbers(new Set());
      setSelectedKeys(new Set());
      await Promise.all([loadMedia(), loadMissingPosters()]);
      setStatus(`${selectedResults.length} Titel wurden als gesehen gespeichert.`);
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Massenauswahl konnte nicht vollstaendig gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  async function requestSelectedInJellyseerr() {
    const selectedResults = results.filter((result) => selectedKeys.has(resultKey(result)));
    if (selectedResults.length === 0) {
      setStatus("Bitte mindestens einen TMDb-Treffer fuer Jellyseerr markieren.");
      return;
    }

    setRequesting(true);
    setStatus(`${selectedResults.length} Titel werden bei Jellyseerr angefragt...`);
    try {
      const response = await apiRequest<TmdbJellyseerrBulkRequestResult>("/api/metadata/tmdb/request-jellyseerr", {
        method: "POST",
        body: JSON.stringify({
          items: selectedResults.map((result) => ({ type: result.type, tmdbId: result.tmdbId })),
        }),
      });
      await loadMedia();
      setStatus(`${response.requested} neu angefragt, ${response.alreadyRequested} bereits vorhanden, ${response.failed} fehlgeschlagen.`);
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Jellyseerr-Massenanfrage ist fehlgeschlagen.");
    } finally {
      setRequesting(false);
    }
  }

  async function deleteMedia(mediaId: string, title: string) {
    const confirmed = window.confirm(`"${title}" und deine zugehoerigen manuellen WatchEvents loeschen?`);
    if (!confirmed) {
      return;
    }

    setStatus(null);
    try {
      const result = await apiRequest<DeleteMediaResponse>(`/api/media/${mediaId}`, { method: "DELETE" });
      await loadMedia();
      await loadMissingPosters();
      setStatus(result.message);
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Titel konnte nicht geloescht werden.");
    }
  }

  async function refreshPoster(mediaId: string, title: string) {
    setPosterBusyId(mediaId);
    setStatus(null);
    try {
      await apiRequest<MediaRecord>(`/api/media/${mediaId}/poster/refresh`, {
        method: "POST",
        body: "{}",
      });
      await Promise.all([loadMedia(), loadMissingPosters()]);
      setStatus(`Poster fuer "${title}" wurde neu von TMDb geladen.`);
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Poster konnte nicht neu geladen werden.");
    } finally {
      setPosterBusyId(null);
    }
  }

  async function uploadPoster(mediaId: string, title: string, file: File | undefined) {
    if (!file) {
      return;
    }

    setPosterBusyId(mediaId);
    setStatus(null);
    try {
      const body = new FormData();
      body.append("poster", file);
      await apiRequest<MediaRecord>(`/api/media/${mediaId}/poster/upload`, {
        method: "POST",
        body,
      });
      await Promise.all([loadMedia(), loadMissingPosters()]);
      setStatus(`Poster fuer "${title}" wurde hochgeladen.`);
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Poster konnte nicht hochgeladen werden.");
    } finally {
      setPosterBusyId(null);
    }
  }

  return (
    <section className="max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold">Manuell hinzufügen</h1>
        <p className="mt-1 text-sm text-slate-400">Titel werden über TMDb gesucht, damit Poster, Jahr und IDs eindeutig bleiben.</p>
      </div>

      <section className="mt-5 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-lg font-semibold">TMDb-Suche</h2>
        <form className="mt-4 grid gap-3 md:grid-cols-[1fr_150px_110px_auto]" onSubmit={(event) => { event.preventDefault(); void search(); }}>
          <label className="sr-only" htmlFor="manual-query">Titel suchen</label>
          <span className="flex min-w-0 items-center gap-2 rounded-md border border-slate-700 bg-slate-950 px-3 py-2">
            <Search className="h-4 w-4 text-slate-500" aria-hidden="true" />
            <input id="manual-query" className="min-w-0 flex-1 bg-transparent outline-none" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Titel suchen" required />
          </span>
          <select className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={type} onChange={(event) => setType(event.target.value as "movie" | "show")}>
            <option value="movie">Film</option>
            <option value="show">Serie</option>
          </select>
          <input className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={year} onChange={(event) => setYear(event.target.value)} placeholder="Jahr" inputMode="numeric" />
          <button className="inline-flex items-center justify-center gap-2 rounded-md bg-teal-400 px-4 py-2 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-60" disabled={loading}>
            <Search className="h-4 w-4" aria-hidden="true" />
            {loading ? "Suche..." : "Suchen"}
          </button>
        </form>

        {results.length > 0 && (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {results.map((result) => {
              const active = selected?.type === result.type && selected.tmdbId === result.tmdbId;
              const checked = selectedKeys.has(resultKey(result));
              return (
                <article
                  key={`${result.type}-${result.tmdbId}`}
                  className={`flex gap-3 rounded-md border p-3 text-left transition ${active ? "border-teal-300 bg-teal-950/40" : "border-slate-800 bg-slate-950 hover:border-slate-600"}`}
                >
                  <PosterPreview
                    src={result.posterUrl}
                    title={result.title}
                    kind={result.type === "movie" ? "movie" : "series"}
                    className="h-32 w-20"
                    typeLabel={mediaLabel(result.type)}
                    year={result.year}
                    meta={[genreLabel(result.genres), castLabel(result.cast), `TMDb ${result.tmdbId}`]}
                    cast={result.cast}
                    overview={result.overview}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-3">
                      <span>
                        <span className="block font-medium">{result.title}</span>
                        <span className="mt-1 block text-sm text-slate-400">
                          {[mediaLabel(result.type), result.year ?? "ohne Jahr", metadataLabel(result.genres), `TMDb ${result.tmdbId}`].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <label className="inline-flex shrink-0 items-center gap-2 rounded-md bg-slate-900 px-2 py-1 text-xs text-slate-200 ring-1 ring-slate-700">
                        <input
                          className="h-4 w-4 accent-teal-400"
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleResult(result)}
                        />
                        Mehrfach
                      </label>
                    </span>
                    <span className="mt-2 line-clamp-3 block text-sm text-slate-300">{result.overview ?? "Keine Beschreibung vorhanden."}</span>
                    <button
                      type="button"
                      className={`mt-3 inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm ${active ? "bg-teal-400 text-slate-950" : "bg-slate-800 text-slate-100 hover:bg-slate-700"}`}
                      onClick={() => selectResult(result)}
                    >
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      {active ? "Ausgewaehlt" : "Einzeln auswaehlen"}
                    </button>
                  </span>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-5 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-lg font-semibold">WatchEvent speichern</h2>
        {selected ? (
          <p className="mt-2 text-sm text-slate-300">Ausgewählt: <span className="font-medium text-slate-100">{selected.title}</span> {selected.year ? `(${selected.year})` : ""}</p>
        ) : (
          <p className="mt-2 text-sm text-slate-400">Suche und wähle zuerst einen TMDb-Titel aus.</p>
        )}
        {selected?.type === "show" && (
          <div className="mt-4 rounded-md border border-slate-800 bg-slate-950 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-medium">Gesehene Staffeln</h3>
                <p className="mt-1 text-xs text-slate-400">Ausgewählte Staffeln werden als Episoden gespeichert, damit Kollage und Watchtime korrekt bleiben.</p>
              </div>
              {seasonOptions.length > 0 && (
                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    className="rounded-md bg-slate-800 px-2 py-1 hover:bg-slate-700"
                    onClick={() => setSelectedSeasonNumbers(new Set(seasonOptions.map((season) => season.seasonNumber)))}
                  >
                    Alle
                  </button>
                  <button
                    type="button"
                    className="rounded-md bg-slate-800 px-2 py-1 hover:bg-slate-700"
                    onClick={() => setSelectedSeasonNumbers(new Set())}
                  >
                    Keine
                  </button>
                </div>
              )}
            </div>
            {seasonLoading ? (
              <p className="mt-3 text-sm text-slate-300">Staffeln werden geladen...</p>
            ) : seasonOptions.length === 0 ? (
              <p className="mt-3 text-sm text-slate-300">Keine Staffeln geladen. Ohne Auswahl werden beim Speichern alle aktuell von TMDb gefundenen Staffeln verwendet.</p>
            ) : (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {seasonOptions.map((season) => {
                  const checked = selectedSeasonNumbers.has(season.seasonNumber);
                  return (
                    <label key={season.seasonNumber} className="flex items-center gap-3 rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm">
                      <input
                        className="h-4 w-4 accent-teal-400"
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSeasonNumber(season.seasonNumber)}
                      />
                      <span className="min-w-0">
                        <span className="block font-medium">Staffel {season.seasonNumber}{season.startYear ? ` (${season.startYear})` : ""}</span>
                        <span className="block text-xs text-slate-400">
                          {[season.name, season.episodeCount != null ? `${season.episodeCount} Episoden` : null].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}
        <form className="mt-4 space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              Datengenauigkeit
              <select
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
                value={datePrecision}
                onChange={(event) => {
                  const nextPrecision = event.target.value as DatePrecision;
                  setDatePrecision(nextPrecision);
                  if (nextPrecision === "year" && !watchedAt.trim() && selected?.year) {
                    setWatchedAt(String(selected.year));
                  }
                }}
              >
                <option value="exact">exakt</option>
                <option value="date">Datum</option>
                <option value="month">Monat/Jahr</option>
                <option value="year">nur Jahr</option>
                <option value="unknown">unbekannt</option>
              </select>
            </label>
            <label className="block text-sm">
              Gesehen am
              <input
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={watchedAt}
                onChange={(event) => setWatchedAt(event.target.value)}
                placeholder={precisionHelp[datePrecision]}
                disabled={datePrecision === "unknown"}
              />
            </label>
          </div>
          <label className="block text-sm">
            Notiz
            <textarea className="mt-1 min-h-24 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          {status && <p className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm">{status}</p>}
          <div className="flex flex-wrap gap-2">
            <button className="inline-flex items-center gap-2 rounded-md bg-teal-400 px-4 py-2 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-60" disabled={saving || requesting || seasonLoading || !selected}>
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              {saving ? "Speichern..." : "Als gesehen speichern"}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md bg-slate-800 px-4 py-2 font-medium text-slate-100 disabled:cursor-not-allowed disabled:opacity-60 hover:bg-slate-700"
              disabled={saving || requesting || selectedKeys.size === 0}
              onClick={() => void submitSelected()}
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Auswahl speichern ({selectedKeys.size})
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md bg-amber-300 px-4 py-2 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-60 hover:bg-amber-200"
              disabled={saving || requesting || selectedKeys.size === 0}
              onClick={() => void requestSelectedInJellyseerr()}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Auswahl bei Jellyseerr anfragen ({selectedKeys.size})
            </button>
          </div>
        </form>
      </section>

      <section className="mt-5 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Manuelle und TMDb-Titel löschen</h2>
            <p className="mt-1 text-sm text-slate-400">Jellyfin-verknüpfte Titel bleiben geschützt. Hier kannst du verschriebene lokale oder per TMDb importierte Filme/Serien entfernen.</p>
          </div>
          <span className="flex min-w-64 max-w-full items-center gap-2 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm">
            <Search className="h-4 w-4 text-slate-500" aria-hidden="true" />
            <input className="min-w-0 flex-1 bg-transparent outline-none" value={deleteQuery} onChange={(event) => setDeleteQuery(event.target.value)} placeholder="Löschliste filtern" />
          </span>
        </div>
        <div className="mt-4 space-y-2">
          {visibleDeletableMedia.length === 0 ? (
            <p className="rounded-md border border-slate-800 bg-slate-950 p-3 text-sm text-slate-300">
              {deletableMedia.length === 0 ? "Keine manuell löschbaren Titel vorhanden." : "Keine passenden Titel in der Löschliste gefunden."}
            </p>
          ) : visibleDeletableMedia.map((item) => (
            <article key={item.id} className="flex items-center gap-3 rounded-md border border-slate-800 bg-slate-950 p-3">
              <PosterPreview
                src={item.posterUrl}
                title={item.title}
                kind={item.type === "movie" ? "movie" : "series"}
                className="h-32 w-20"
                typeLabel={mediaLabel(item.type)}
                year={item.year}
                meta={[genreLabel(item.genres), castLabel(item.cast), item.tmdbId ? `TMDb ${item.tmdbId}` : item.metadataSource]}
                cast={item.cast}
              />
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-medium">{item.title}</h3>
                <p className="text-sm text-slate-400">
                  {[mediaLabel(item.type), item.year ?? "ohne Jahr", metadataLabel(item.genres), item.tmdbId ? `TMDb ${item.tmdbId}` : item.metadataSource].filter(Boolean).join(" · ")}
                </p>
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-md bg-red-500/15 px-3 py-2 text-sm text-red-100 ring-1 ring-red-500/30 hover:bg-red-500/25"
                onClick={() => void deleteMedia(item.id, item.title)}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Löschen
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-5 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Fehlende Poster pflegen</h2>
            <p className="mt-1 text-sm text-slate-400">Lade Poster erneut aus TMDb oder hinterlege ein eigenes JPEG, PNG oder WebP. Uploads werden lokal als kleines WebP gespeichert.</p>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700"
            onClick={() => void loadMissingPosters()}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Liste aktualisieren
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {missingPosters.length === 0 ? (
            <p className="rounded-md border border-slate-800 bg-slate-950 p-3 text-sm text-slate-300">Keine Filme oder Serien ohne Poster gefunden.</p>
          ) : missingPosters.map((item) => (
            <article key={item.id} className="flex flex-wrap items-center gap-3 rounded-md border border-slate-800 bg-slate-950 p-3">
              <PosterPreview
                src={item.posterUrl}
                title={item.title}
                kind={item.type === "movie" ? "movie" : "series"}
                className="h-32 w-20"
                typeLabel={mediaLabel(item.type)}
                year={item.year}
                meta={[genreLabel(item.genres), castLabel(item.cast), item.tmdbId ? `TMDb ${item.tmdbId}` : "ohne TMDb-ID"]}
                cast={item.cast}
              />
              <div className="min-w-48 flex-1">
                <h3 className="truncate font-medium">{item.title}</h3>
                <p className="text-sm text-slate-400">
                  {[mediaLabel(item.type), item.year ?? "ohne Jahr", metadataLabel(item.genres), item.tmdbId ? `TMDb ${item.tmdbId}` : "ohne TMDb-ID"].filter(Boolean).join(" · ")}
                </p>
              </div>
              <button
                type="button"
                disabled={posterBusyId === item.id || !item.tmdbId}
                className="inline-flex items-center gap-2 rounded-md bg-slate-800 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50 hover:bg-slate-700"
                onClick={() => void refreshPoster(item.id, item.title)}
                title={!item.tmdbId ? "Dieser Titel hat keine TMDb-ID." : undefined}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                TMDb neu laden
              </button>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-teal-400 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-teal-300">
                <Upload className="h-4 w-4" aria-hidden="true" />
                Datei hochladen
                <input
                  className="sr-only"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={posterBusyId === item.id}
                  onChange={(event) => {
                    void uploadPoster(item.id, item.title, event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
