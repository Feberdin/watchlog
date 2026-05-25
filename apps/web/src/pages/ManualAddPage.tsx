/**
 * Purpose: Manual historical watch entry form.
 * Input/Output: User-entered media and date precision create a manual WatchEvent.
 * Invariants: Unknown or imprecise dates are stored with explicit datePrecision.
 * Debugging: API validation errors appear inline and fields remain editable.
 */

import { useState } from "react";
import { apiRequest } from "../api/client";

export function ManualAddPage() {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<"movie" | "episode">("movie");
  const [year, setYear] = useState("");
  const [datePrecision, setDatePrecision] = useState<"exact" | "date" | "month" | "year" | "unknown">("year");
  const [watchedAt, setWatchedAt] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  async function submit() {
    setStatus(null);
    try {
      await apiRequest("/api/watch-events/manual", {
        method: "POST",
        body: JSON.stringify({
          media: {
            type,
            title,
            year: year ? Number(year) : null,
          },
          datePrecision,
          watchedAt: watchedAt || null,
          note,
        }),
      });
      setTitle("");
      setYear("");
      setWatchedAt("");
      setNote("");
      setStatus("Eintrag wurde gespeichert.");
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Eintrag konnte nicht gespeichert werden.");
    }
  }

  return (
    <section className="max-w-2xl">
      <h1 className="text-2xl font-semibold">Manuell hinzufügen</h1>
      <form className="mt-5 space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label className="block text-sm">
          Titel
          <input className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={title} onChange={(event) => setTitle(event.target.value)} required />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            Typ
            <select className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={type} onChange={(event) => setType(event.target.value as "movie" | "episode")}>
              <option value="movie">Film</option>
              <option value="episode">Episode</option>
            </select>
          </label>
          <label className="block text-sm">
            Jahr
            <input className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={year} onChange={(event) => setYear(event.target.value)} inputMode="numeric" placeholder="z. B. 1995" />
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            Datengenauigkeit
            <select className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={datePrecision} onChange={(event) => setDatePrecision(event.target.value as typeof datePrecision)}>
              <option value="exact">exakt</option>
              <option value="date">Datum</option>
              <option value="month">Monat/Jahr</option>
              <option value="year">nur Jahr</option>
              <option value="unknown">unbekannt</option>
            </select>
          </label>
          <label className="block text-sm">
            Gesehen am
            <input className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={watchedAt} onChange={(event) => setWatchedAt(event.target.value)} placeholder="2020 oder 2020-04-01 oder leer" />
          </label>
        </div>
        <label className="block text-sm">
          Notiz
          <textarea className="mt-1 min-h-24 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        {status && <p className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm">{status}</p>}
        <button className="rounded-md bg-teal-400 px-4 py-2 font-medium text-slate-950">Speichern</button>
      </form>
    </section>
  );
}
