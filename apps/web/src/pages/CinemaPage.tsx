/**
 * Purpose: Fast table workflow for classifying likely cinema memories from youth years.
 * Input/Output: Birth-year settings load 100 TMDb movies; action buttons store seen/want/skip decisions.
 * Invariants: "Gesehen" stores only year precision; "Will ich sehen" explicitly triggers Jellyseerr.
 * Debugging: Status messages show failed actions; API failures are visible in the browser Network tab.
 */

import { useMemo, useState } from "react";
import { Check, Download, Film, Search, X } from "lucide-react";
import type { CinemaMemoryCandidate, SwipeActionResult } from "@watchlog/shared";
import { apiRequest } from "../api/client";

type Action = "seen" | "want" | "skip";

function actionLabel(status: CinemaMemoryCandidate["status"]) {
  if (status === "seen") return "gesehen";
  if (status === "want") return "will ich sehen";
  if (status === "skip") return "archiviert";
  return "offen";
}

function Poster({ src }: { src: string | null }) {
  return src ? (
    <img className="h-20 w-14 rounded object-cover ring-1 ring-slate-800" src={src} alt="" loading="lazy" />
  ) : (
    <div className="flex h-20 w-14 items-center justify-center rounded bg-slate-800 ring-1 ring-slate-700">
      <Film className="h-5 w-5 text-slate-500" aria-hidden="true" />
    </div>
  );
}

export function CinemaPage() {
  const [birthYear, setBirthYear] = useState("1986");
  const [startAge, setStartAge] = useState("10");
  const [endAge, setEndAge] = useState("24");
  const [items, setItems] = useState<CinemaMemoryCandidate[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const summary = useMemo(() => ({
    seen: items.filter((item) => item.status === "seen").length,
    want: items.filter((item) => item.status === "want").length,
    skip: items.filter((item) => item.status === "skip").length,
    open: items.filter((item) => item.status === "open").length,
  }), [items]);

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
      const loaded = await apiRequest<CinemaMemoryCandidate[]>(`/api/cinema/candidates?${params.toString()}`);
      setItems(loaded);
      setStatus(`${loaded.length} Kino-Kandidaten geladen.`);
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Kino-Liste konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }

  async function act(item: CinemaMemoryCandidate, action: Action) {
    setBusyId(item.id);
    setStatus(null);
    try {
      const result = await apiRequest<SwipeActionResult>("/api/cinema/action", {
        method: "POST",
        body: JSON.stringify({ mediaId: item.id, action }),
      });
      setItems((current) => current.map((candidate) => (
        candidate.id === item.id ? { ...candidate, status: action } : candidate
      )));
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
        <h1 className="text-2xl font-semibold">Kino-Erinnerungen</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          Lade eine TMDb-basierte Liste populärer Filme aus deiner Jugendzeit und markiere schnell, was du gesehen hast, noch sehen willst oder archivieren möchtest.
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
            {loading ? "Lade..." : "100 Filme laden"}
          </button>
        </form>
        {status && <p className="mt-4 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm">{status}</p>}
      </section>

      {items.length > 0 && (
        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          <p className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm"><span className="block text-2xl font-semibold">{summary.open}</span> offen</p>
          <p className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm"><span className="block text-2xl font-semibold">{summary.seen}</span> gesehen</p>
          <p className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm"><span className="block text-2xl font-semibold">{summary.want}</span> will ich sehen</p>
          <p className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm"><span className="block text-2xl font-semibold">{summary.skip}</span> archiviert</p>
        </div>
      )}

      <section className="mt-5 overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
        {items.length === 0 ? (
          <div className="flex min-h-56 items-center justify-center p-6 text-center text-sm text-slate-400">
            Gib dein Geburtsjahr ein und lade die Kandidatenliste.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-800 text-sm">
              <thead className="bg-slate-950 text-left text-slate-300">
                <tr>
                  <th className="w-20 px-4 py-3">Poster</th>
                  <th className="px-4 py-3">Film</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {items.map((item) => (
                  <tr key={item.id} className="align-top">
                    <td className="px-4 py-3"><Poster src={item.posterUrl} /></td>
                    <td className="px-4 py-3">
                      <h2 className="font-medium">{item.title}</h2>
                      <p className="mt-1 text-slate-400">{item.year ?? "ohne Jahr"} · TMDb {item.tmdbId ?? "-"}{item.voteAverage ? ` · ${item.voteAverage.toFixed(1)}/10` : ""}</p>
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
    </section>
  );
}
