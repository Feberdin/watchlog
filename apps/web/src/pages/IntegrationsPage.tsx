/**
 * Purpose: Operator UI for Jellyfin, Jellyseerr, and TMDb connection setup.
 * Input/Output: Admin-entered URLs/tokens are saved through API settings endpoints and can be tested.
 * Invariants: Existing secrets are displayed only as masked placeholders; empty secret fields keep old values hidden server-side.
 * Debugging: Use each "Testen" button and then inspect server logs for non-secret connection context.
 */

import { useEffect, useState } from "react";
import type { AuthUser, IntegrationTestResponse, JellyfinWatchedImportResult, TmdbSearchResult } from "@watchlog/shared";
import { apiRequest } from "../api/client";

type JellyfinSettings = {
  jellyfinBaseUrl: string | null;
  jellyfinApiKey: string | null;
  enabledUserIds: string[];
  syncBackEnabled: boolean;
  watchedThresholdMoviePercent: number;
  watchedThresholdEpisodePercent: number;
};

type TmdbSettings = {
  tmdbBearerToken: string | null;
  preferredLanguage: string;
  fallbackLanguage: string;
  imageBaseUrl: string;
};

type JellyseerrSettings = {
  jellyseerrBaseUrl: string | null;
  jellyseerrApiKey: string | null;
};

type JellyfinUserOption = {
  id: string;
  name: string;
};

const masked = "********";

function secretInputValue(value: string | null | undefined) {
  return value === masked ? "" : value ?? "";
}

type IntegrationsPageProps = {
  user: AuthUser;
  onUserUpdated: (user: AuthUser) => void;
};

export function IntegrationsPage({ user, onUserUpdated }: IntegrationsPageProps) {
  const [jellyfin, setJellyfin] = useState<JellyfinSettings | null>(null);
  const [tmdb, setTmdb] = useState<TmdbSettings | null>(null);
  const [jellyseerr, setJellyseerr] = useState<JellyseerrSettings | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"movie" | "show">("movie");
  const [year, setYear] = useState("");
  const [results, setResults] = useState<TmdbSearchResult[]>([]);
  const [jellyfinUserId, setJellyfinUserId] = useState(user.jellyfinUserId ?? "");
  const [jellyfinUsers, setJellyfinUsers] = useState<JellyfinUserOption[]>([]);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    void Promise.all([
      apiRequest<JellyfinSettings>("/api/settings/jellyfin").then(setJellyfin),
      apiRequest<TmdbSettings>("/api/settings/tmdb").then(setTmdb),
      apiRequest<JellyseerrSettings>("/api/settings/jellyseerr").then(setJellyseerr),
    ]).catch((caught) => setStatus(caught instanceof Error ? caught.message : "Integrationen konnten nicht geladen werden."));
  }, []);

  async function saveJellyfin() {
    if (!jellyfin) return;
    const saved = await apiRequest<JellyfinSettings>("/api/settings/jellyfin", {
      method: "PUT",
      body: JSON.stringify(jellyfin),
    });
    setJellyfin(saved);
    setStatus("Jellyfin-Einstellungen gespeichert.");
  }

  async function saveTmdb() {
    if (!tmdb) return;
    const saved = await apiRequest<TmdbSettings>("/api/settings/tmdb", {
      method: "PUT",
      body: JSON.stringify(tmdb),
    });
    setTmdb(saved);
    setStatus("TMDb-Einstellungen gespeichert.");
  }

  async function saveJellyseerr() {
    if (!jellyseerr) return;
    const saved = await apiRequest<JellyseerrSettings>("/api/settings/jellyseerr", {
      method: "PUT",
      body: JSON.stringify(jellyseerr),
    });
    setJellyseerr(saved);
    setStatus("Jellyseerr-Einstellungen gespeichert.");
  }

  async function test(path: string) {
    const response = await apiRequest<IntegrationTestResponse>(path, { method: "POST", body: "{}" });
    setStatus(response.message);
  }

  async function loadJellyfinUsers() {
    const users = await apiRequest<JellyfinUserOption[]>("/api/settings/jellyfin/users");
    setJellyfinUsers(users);
    setStatus(`${users.length} Jellyfin-Benutzer geladen.`);
  }

  async function saveProfileMapping() {
    const updated = await apiRequest<AuthUser>("/api/auth/me", {
      method: "PUT",
      body: JSON.stringify({ displayName: user.displayName, jellyfinUserId }),
    });
    onUserUpdated(updated);
    setJellyfinUserId(updated.jellyfinUserId ?? "");
    setStatus("Jellyfin-UserId fuer deinen WatchLog-Benutzer gespeichert.");
  }

  async function importWatchedFromJellyfin() {
    setImporting(true);
    try {
      const response = await apiRequest<JellyfinWatchedImportResult>("/api/import/jellyfin/watched", {
        method: "POST",
        body: "{}",
      });
      setStatus(response.message);
    } finally {
      setImporting(false);
    }
  }

  async function searchTmdb() {
    const params = new URLSearchParams({ query, type });
    if (year) params.set("year", year);
    const found = await apiRequest<TmdbSearchResult[]>(`/api/metadata/tmdb/search?${params.toString()}`);
    setResults(found);
    setStatus(`${found.length} TMDb-Treffer gefunden.`);
  }

  async function importTmdb(result: TmdbSearchResult) {
    await apiRequest("/api/metadata/tmdb/import", {
      method: "POST",
      body: JSON.stringify({ type: result.type, tmdbId: result.tmdbId }),
    });
    setStatus(`${result.title} wurde als Medium gespeichert.`);
  }

  if (!jellyfin || !tmdb || !jellyseerr) {
    return <section className="text-slate-200">Integrationen werden geladen...</section>;
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Integrationen</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">
          Verbinde WatchLog mit deinen lokalen Diensten. Tokens werden serverseitig gespeichert und hier nur maskiert angezeigt.
        </p>
      </div>

      {status && <p className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm">{status}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <form className="rounded-lg border border-slate-800 bg-slate-900 p-4" onSubmit={(event) => { event.preventDefault(); void saveJellyfin(); }}>
          <h2 className="text-lg font-semibold">Jellyfin</h2>
          <label className="mt-4 block text-sm">
            Server-URL
            <input className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={jellyfin.jellyfinBaseUrl ?? ""} onChange={(event) => setJellyfin({ ...jellyfin, jellyfinBaseUrl: event.target.value })} placeholder="http://192.168.57.10:8096" />
          </label>
          <label className="mt-3 block text-sm">
            API-Key
            <input className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={secretInputValue(jellyfin.jellyfinApiKey)} onChange={(event) => setJellyfin({ ...jellyfin, jellyfinApiKey: event.target.value })} placeholder={jellyfin.jellyfinApiKey === masked ? "Gespeichert" : ""} />
          </label>
          <div className="mt-4 flex gap-2">
            <button className="rounded-md bg-teal-400 px-3 py-2 text-sm font-medium text-slate-950">Speichern</button>
            <button type="button" className="rounded-md bg-slate-800 px-3 py-2 text-sm" onClick={() => void test("/api/settings/jellyfin/test")}>Testen</button>
          </div>
        </form>

        <form className="rounded-lg border border-slate-800 bg-slate-900 p-4" onSubmit={(event) => { event.preventDefault(); void saveTmdb(); }}>
          <h2 className="text-lg font-semibold">TMDb</h2>
          <label className="mt-4 block text-sm">
            Bearer Token
            <input className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={secretInputValue(tmdb.tmdbBearerToken)} onChange={(event) => setTmdb({ ...tmdb, tmdbBearerToken: event.target.value })} placeholder={tmdb.tmdbBearerToken === masked ? "Gespeichert" : ""} />
          </label>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              Sprache
              <input className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={tmdb.preferredLanguage} onChange={(event) => setTmdb({ ...tmdb, preferredLanguage: event.target.value })} />
            </label>
            <label className="block text-sm">
              Fallback
              <input className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={tmdb.fallbackLanguage} onChange={(event) => setTmdb({ ...tmdb, fallbackLanguage: event.target.value })} />
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <button className="rounded-md bg-teal-400 px-3 py-2 text-sm font-medium text-slate-950">Speichern</button>
            <button type="button" className="rounded-md bg-slate-800 px-3 py-2 text-sm" onClick={() => void test("/api/settings/tmdb/test")}>Testen</button>
          </div>
        </form>

        <form className="rounded-lg border border-slate-800 bg-slate-900 p-4" onSubmit={(event) => { event.preventDefault(); void saveJellyseerr(); }}>
          <h2 className="text-lg font-semibold">Jellyseerr</h2>
          <label className="mt-4 block text-sm">
            Server-URL
            <input className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={jellyseerr.jellyseerrBaseUrl ?? ""} onChange={(event) => setJellyseerr({ ...jellyseerr, jellyseerrBaseUrl: event.target.value })} placeholder="http://192.168.57.10:5055" />
          </label>
          <label className="mt-3 block text-sm">
            API-Key
            <input className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={secretInputValue(jellyseerr.jellyseerrApiKey)} onChange={(event) => setJellyseerr({ ...jellyseerr, jellyseerrApiKey: event.target.value })} placeholder={jellyseerr.jellyseerrApiKey === masked ? "Gespeichert" : ""} />
          </label>
          <div className="mt-4 flex gap-2">
            <button className="rounded-md bg-teal-400 px-3 py-2 text-sm font-medium text-slate-950">Speichern</button>
            <button type="button" className="rounded-md bg-slate-800 px-3 py-2 text-sm" onClick={() => void test("/api/settings/jellyseerr/test")}>Testen</button>
          </div>
        </form>
      </div>

      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-lg font-semibold">Jellyfin-Watchstate importieren</h2>
        <p className="mt-2 text-sm text-slate-400">
          Importiert Filme und Episoden, die Jellyfin fuer deinen Benutzer als gesehen markiert. Jellyfin liefert dabei normalerweise den aktuellen Gesehen-Status und das letzte Gesehen-Datum, aber keine vollstaendige alte Rewatch-Historie.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_auto]">
          <label className="block text-sm">
            Dein Jellyfin-Benutzer
            {jellyfinUsers.length > 0 ? (
              <select
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
                value={jellyfinUserId}
                onChange={(event) => setJellyfinUserId(event.target.value)}
              >
                <option value="">Benutzer waehlen</option>
                {jellyfinUsers.map((option) => (
                  <option key={option.id} value={option.id}>{option.name}</option>
                ))}
              </select>
            ) : (
              <input
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
                value={jellyfinUserId}
                onChange={(event) => setJellyfinUserId(event.target.value)}
                placeholder="Jellyfin UserId oder Benutzername"
              />
            )}
          </label>
          <button type="button" className="self-end rounded-md bg-slate-800 px-3 py-2 text-sm" onClick={() => void loadJellyfinUsers()}>
            Benutzer laden
          </button>
          <button type="button" className="self-end rounded-md bg-slate-800 px-3 py-2 text-sm" onClick={() => void saveProfileMapping()}>
            UserId speichern
          </button>
          <button
            type="button"
            disabled={importing}
            className="self-end rounded-md bg-teal-400 px-3 py-2 text-sm font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void importWatchedFromJellyfin()}
          >
            {importing ? "Import laeuft..." : "Gesehene Medien importieren"}
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-lg font-semibold">TMDb-Suche</h2>
        <form className="mt-4 grid gap-3 md:grid-cols-[1fr_160px_120px_auto]" onSubmit={(event) => { event.preventDefault(); void searchTmdb(); }}>
          <input className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Titel suchen" required />
          <select className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={type} onChange={(event) => setType(event.target.value as "movie" | "show")}>
            <option value="movie">Film</option>
            <option value="show">Serie</option>
          </select>
          <input className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={year} onChange={(event) => setYear(event.target.value)} placeholder="Jahr" inputMode="numeric" />
          <button className="rounded-md bg-teal-400 px-4 py-2 font-medium text-slate-950">Suchen</button>
        </form>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {results.map((result) => (
            <article key={`${result.type}-${result.tmdbId}`} className="flex gap-3 rounded-md border border-slate-800 bg-slate-950 p-3">
              {result.posterUrl ? <img className="h-28 w-20 rounded object-cover" src={result.posterUrl} alt="" /> : <div className="h-28 w-20 rounded bg-slate-800" />}
              <div className="min-w-0 flex-1">
                <h3 className="font-medium">{result.title}</h3>
                <p className="text-sm text-slate-400">{result.year ?? "ohne Jahr"} · TMDb {result.tmdbId}</p>
                <p className="mt-2 line-clamp-3 text-sm text-slate-300">{result.overview ?? "Keine Beschreibung vorhanden."}</p>
                <button className="mt-3 rounded-md bg-slate-800 px-3 py-2 text-sm" onClick={() => void importTmdb(result)}>Als Medium speichern</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
