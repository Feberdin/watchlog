/**
 * Purpose: Fast table workflow for classifying likely TV memories from youth years.
 * Input/Output: Birth-year settings load 100 TMDb shows; action buttons store seen/want/skip decisions.
 * Invariants: "Gesehen" stores only year precision; "Will ich sehen" explicitly triggers Jellyseerr for shows.
 * Debugging: Status messages show failed actions; API failures are visible in the browser Network tab.
 */

import { useMemo, useState } from "react";
import { Check, Download, Search, X } from "lucide-react";
import type { CinemaMemoryCandidate, SwipeActionResult } from "@watchlog/shared";
import { apiRequest } from "../api/client";
import { PosterPreview } from "../components/PosterPreview";

type Action = "seen" | "want" | "skip";

function actionLabel(status: CinemaMemoryCandidate["status"]) {
  if (status === "seen") return "gesehen";
  if (status === "want") return "will ich sehen";
  if (status === "skip") return "archiviert";
  return "offen";
}

export function TvMemoryPage() {
  const [birthYear, setBirthYear] = useState("1986");
  const [startAge, setStartAge] = useState("6");
  const [endAge, setEndAge] = useState("24");
  const [items, setItems] = useState<CinemaMemoryCandidate[]>([]);
  const [archivedItems, setArchivedItems] = useState<CinemaMemoryCandidate[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const summary = useMemo(() => ({
    remaining: items.length,
    seen: archivedItems.filter((item) => item.status === "seen").length,
    want: archivedItems.filter((item) => item.status === "want").length,
    skip: archivedItems.filter((item) => item.status === "skip").length,
  }), [items, archivedItems]);

  async function loadCandidates() {
    setLoading(true);
    setStatus(null);
    try {
      const params = new URLSearchParams({
        birthYear,
        startAge,
        endAge,
        limit: "100",
      });
      const loaded = await apiRequest<CinemaMemoryCandidate[]>(`/api/tv-memory/candidates?${params.toString()}`);
      setItems(loaded);
      setArchivedItems([]);
      setStatus(`${loaded.length} offene TV-Kandidaten geladen. Bereits einsortierte Serien werden ausgeblendet.`);
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "TV-Liste konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }

  async function act(item: CinemaMemoryCandidate, action: Action) {
    setBusyId(item.id);
    setStatus(null);
    try {
      const result = await apiRequest<SwipeActionResult>("/api/tv-memory/action", {
        method: "POST",
        body: JSON.stringify({ mediaId: item.id, action }),
      });
      const archived = { ...item, status: action };
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setArchivedItems((current) => [archived, ...current]);
      setStatus(`${item.title}: ${result.message}`);
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Aktion konnte nicht gespeichert werden.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section>
      <div>
        <h1 className="text-2xl font-semibold">TV-Erinnerungen</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          Lade eine TMDb-basierte Liste populärer Serien aus deiner Kindheit und Jugend und sortiere sie schnell in gesehen, will ich sehen oder Archiv.
        </p>
      </div>

      <section className="mt-5 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <form className="grid gap-3 md:grid-cols-[140px_120px_120px_auto]" onSubmit={(event) => { event.preventDefault(); void loadCandidates(); }}>
          <label className="block text-sm">
            Geburtsjahr
            <input className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={birthYear} onChange={(event) => setBirthYear(event.target.value)} inputMode="numeric" />
          </label>
          <label className="block text-sm">
            ab Alter
            <input className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={startAge} onChange={(event) => setStartAge(event.target.value)} inputMode="numeric" />
          </label>
          <label className="block text-sm">
            bis Alter
            <input className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={endAge} onChange={(event) => setEndAge(event.target.value)} inputMode="numeric" />
          </label>
          <button className="inline-flex items-center justify-center gap-2 self-end rounded-md bg-teal-400 px-4 py-2 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-60" disabled={loading}>
            <Search className="h-4 w-4" aria-hidden="true" />
            {loading ? "Lade..." : "100 Serien laden"}
          </button>
        </form>
        {status && <p className="mt-4 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm">{status}</p>}
      </section>

      {items.length > 0 && (
        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          <p className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm"><span className="block text-2xl font-semibold">{summary.remaining}</span> offen</p>
          <p className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm"><span className="block text-2xl font-semibold">{summary.seen}</span> gerade gesehen</p>
          <p className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm"><span className="block text-2xl font-semibold">{summary.want}</span> gerade gewünscht</p>
          <p className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm"><span className="block text-2xl font-semibold">{summary.skip}</span> gerade archiviert</p>
        </div>
      )}

      <section className="mt-5 overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
        {items.length === 0 ? (
          <div className="flex min-h-56 items-center justify-center p-6 text-center text-sm text-slate-400">
            Gib dein Geburtsjahr ein und lade die Serien-Kandidatenliste.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-800 text-sm">
              <thead className="bg-slate-950 text-left text-slate-300">
                <tr>
                  <th className="w-20 px-4 py-3">Poster</th>
                  <th className="px-4 py-3">Serie</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {items.map((item) => (
                  <tr key={item.id} className="align-top">
                    <td className="px-4 py-3">
                      <PosterPreview
                        src={item.posterUrl}
                        title={item.title}
                        kind="series"
                        className="h-20 w-14"
                        typeLabel="Serie"
                        year={item.year}
                        meta={[item.tmdbId ? `TMDb ${item.tmdbId}` : null, item.voteAverage ? `${item.voteAverage.toFixed(1)}/10` : null, actionLabel(item.status)]}
                        overview={item.overview}
                        imageClassName="rounded"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <h2 className="font-medium">{item.title}</h2>
                      <p className="mt-1 text-slate-400">{item.year ?? "ohne Startjahr"} · TMDb {item.tmdbId ?? "-"}{item.voteAverage ? ` · ${item.voteAverage.toFixed(1)}/10` : ""}</p>
                      <p className="mt-2 line-clamp-2 max-w-3xl text-slate-300">{item.overview ?? "Keine Beschreibung vorhanden."}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{actionLabel(item.status)}</td>
                    <td className="px-4 py-3">
                      <div className="flex min-w-72 flex-wrap gap-2">
                        <button className="inline-flex items-center gap-2 rounded-md bg-emerald-500 px-3 py-2 text-sm font-medium text-slate-950 disabled:opacity-50" disabled={busyId === item.id || item.status === "seen"} onClick={() => void act(item, "seen")}>
                          <Check className="h-4 w-4" aria-hidden="true" />
                          Hab ich gesehen
                        </button>
                        <button className="inline-flex items-center gap-2 rounded-md bg-amber-300 px-3 py-2 text-sm font-medium text-slate-950 disabled:opacity-50" disabled={busyId === item.id || item.status === "want"} onClick={() => void act(item, "want")}>
                          <Download className="h-4 w-4" aria-hidden="true" />
                          Will ich noch sehen
                        </button>
                        <button className="inline-flex items-center gap-2 rounded-md bg-slate-800 px-3 py-2 text-sm text-slate-100 disabled:opacity-50" disabled={busyId === item.id || item.status === "skip"} onClick={() => void act(item, "skip")}>
                          <X className="h-4 w-4" aria-hidden="true" />
                          Nicht sehen
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {archivedItems.length > 0 && (
        <section className="mt-5 rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-lg font-semibold">Gerade einsortiert</h2>
          <p className="mt-1 text-sm text-slate-400">Diese Serien wurden aus der offenen Liste entfernt. Beim naechsten Laden erscheinen sie nicht mehr als Kandidaten.</p>
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {archivedItems.map((item) => (
              <article key={`${item.id}-${item.status}`} className="flex items-center gap-3 rounded-md border border-slate-800 bg-slate-950 p-3">
                <PosterPreview
                  src={item.posterUrl}
                  title={item.title}
                  kind="series"
                  className="h-20 w-14"
                  typeLabel="Serie"
                  year={item.year}
                  meta={[actionLabel(item.status), item.tmdbId ? `TMDb ${item.tmdbId}` : null]}
                  overview={item.overview}
                  imageClassName="rounded"
                />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-medium">{item.title}</h3>
                  <p className="text-sm text-slate-400">{item.year ?? "ohne Startjahr"} · {actionLabel(item.status)}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
