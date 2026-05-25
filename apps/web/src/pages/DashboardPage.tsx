/**
 * Purpose: Dashboard summary for recent watching activity.
 * Input/Output: Loads `/api/dashboard` and renders metrics plus latest items.
 * Invariants: Empty states must tell the user the next useful action.
 * Debugging: If counts are unexpected, compare with Timeline and API response JSON.
 */

import { useEffect, useState } from "react";
import { apiRequest } from "../api/client";

type DashboardResponse = {
  metrics: {
    today: number;
    movies: number;
    episodes: number;
    rewatches: number;
  };
  recent: Array<{
    id: string;
    title: string;
    type: string;
    watchedAt: string | null;
    datePrecision: string;
    posterUrl: string | null;
  }>;
};

export function DashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<DashboardResponse>("/api/dashboard").then(setData).catch((caught) => {
      setError(caught instanceof Error ? caught.message : "Dashboard konnte nicht geladen werden.");
    });
  }, []);

  if (error) {
    return <p className="rounded-md border border-red-500/40 bg-red-950 p-4 text-red-100">{error}</p>;
  }

  if (!data) {
    return <p className="text-slate-300">Dashboard wird geladen...</p>;
  }

  const metrics = [
    ["Heute gesehen", data.metrics.today],
    ["Filme insgesamt", data.metrics.movies],
    ["Episoden insgesamt", data.metrics.episodes],
    ["Rewatches", data.metrics.rewatches],
  ];

  return (
    <section>
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map(([label, value]) => (
          <article key={label} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <p className="text-sm text-slate-400">{label}</p>
            <p className="mt-2 text-3xl font-semibold">{value}</p>
          </article>
        ))}
      </div>

      <h2 className="mt-8 text-lg font-semibold">Zuletzt gesehen</h2>
      <div className="mt-3 overflow-hidden rounded-lg border border-slate-800">
        {data.recent.length === 0 ? (
          <p className="bg-slate-900 p-4 text-sm text-slate-300">Noch keine WatchEvents vorhanden. Lege manuell einen Film an oder sende einen Jellyfin-Webhook.</p>
        ) : (
          data.recent.map((item) => (
            <div key={item.id} className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3 last:border-b-0">
              <div>
                <p className="font-medium">{item.title}</p>
                <p className="text-sm text-slate-400">{item.type} · {item.datePrecision}</p>
              </div>
              <time className="text-sm text-slate-300">{item.watchedAt ? new Date(item.watchedAt).toLocaleString("de-DE") : "Datum unbekannt"}</time>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
