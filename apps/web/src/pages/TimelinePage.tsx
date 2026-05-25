/**
 * Purpose: Chronological watch history page.
 * Input/Output: Loads `/api/watch-events`, filters locally, and renders a scan-friendly list.
 * Invariants: Unknown dates remain visible instead of being hidden by date sorting.
 * Debugging: Use the search field to verify imported/manual titles are present.
 */

import { useEffect, useMemo, useState } from "react";
import type { TimelineItem } from "@watchlog/shared";
import { apiRequest } from "../api/client";

export function TimelinePage() {
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<TimelineItem[]>("/api/watch-events").then(setItems).catch((caught) => {
      setError(caught instanceof Error ? caught.message : "Timeline konnte nicht geladen werden.");
    });
  }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return items;
    }

    return items.filter((item) => item.title.toLowerCase().includes(normalized));
  }, [items, query]);

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Timeline</h1>
          <p className="mt-1 text-sm text-slate-400">Chronologische Liste deiner gesehenen Medien.</p>
        </div>
        <label className="block text-sm">
          Suche
          <input className="mt-1 w-72 max-w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Titel suchen" />
        </label>
      </div>

      {error && <p className="mt-4 rounded-md border border-red-500/40 bg-red-950 p-4 text-red-100">{error}</p>}
      <div className="mt-5 overflow-hidden rounded-lg border border-slate-800">
        {filtered.length === 0 ? (
          <p className="bg-slate-900 p-4 text-sm text-slate-300">Keine Eintraege gefunden.</p>
        ) : filtered.map((item) => (
          <article key={item.id} className="grid gap-2 border-b border-slate-800 bg-slate-900 px-4 py-3 last:border-b-0 sm:grid-cols-[1fr_auto]">
            <div>
              <p className="font-medium">{item.title} {item.year ? <span className="text-slate-400">({item.year})</span> : null}</p>
              <p className="text-sm text-slate-400">{item.type} · Quelle: {item.source} · Rewatch #{item.rewatchIndex}</p>
              {item.note && <p className="mt-1 text-sm text-slate-300">{item.note}</p>}
            </div>
            <time className="text-sm text-slate-300">{item.watchedAt ? new Date(item.watchedAt).toLocaleString("de-DE") : `Datum: ${item.datePrecision}`}</time>
          </article>
        ))}
      </div>
    </section>
  );
}
