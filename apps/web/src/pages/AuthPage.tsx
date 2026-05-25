/**
 * Purpose: Login and first-admin registration screen.
 * Input/Output: User credentials produce an authenticated session through the API.
 * Invariants: Passwords stay in component state only long enough to submit.
 * Debugging: Failed login messages are shown inline and details are visible in Network tab.
 */

import { useState } from "react";
import type { AuthUser } from "@watchlog/shared";
import { apiRequest } from "../api/client";

type AuthPageProps = {
  onAuthenticated: (user: AuthUser) => void;
};

export function AuthPage({ onAuthenticated }: AuthPageProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [jellyfinUserId, setJellyfinUserId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const payload = mode === "login"
        ? { email, password }
        : { email, password, displayName, jellyfinUserId };
      const user = await apiRequest<AuthUser>(path, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      onAuthenticated(user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Anmeldung fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
      <section className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-900 p-6 shadow-xl">
        <h1 className="text-2xl font-semibold">WatchLog</h1>
        <p className="mt-2 text-sm text-slate-300">
          Melde dich an oder erstelle beim ersten Start den Admin-Benutzer.
        </p>

        <div className="mt-6 grid grid-cols-2 rounded-md bg-slate-950 p-1">
          <button className={`rounded px-3 py-2 text-sm ${mode === "login" ? "bg-teal-400 text-slate-950" : ""}`} onClick={() => setMode("login")}>
            Login
          </button>
          <button className={`rounded px-3 py-2 text-sm ${mode === "register" ? "bg-teal-400 text-slate-950" : ""}`} onClick={() => setMode("register")}>
            Setup
          </button>
        </div>

        <form className="mt-6 space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <label className="block text-sm">
            E-Mail
            <input className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
          </label>
          {mode === "register" && (
            <>
              <label className="block text-sm">
                Anzeigename
                <input className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required />
              </label>
              <label className="block text-sm">
                Jellyfin UserId
                <input className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={jellyfinUserId} onChange={(event) => setJellyfinUserId(event.target.value)} placeholder="optional, fuer Webhooks wichtig" />
              </label>
            </>
          )}
          <label className="block text-sm">
            Passwort
            <input className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={password} onChange={(event) => setPassword(event.target.value)} type="password" required minLength={mode === "register" ? 10 : 1} />
          </label>
          {error && <p className="rounded-md border border-red-500/40 bg-red-950 px-3 py-2 text-sm text-red-100">{error}</p>}
          <button disabled={busy} className="w-full rounded-md bg-teal-400 px-4 py-2 font-medium text-slate-950 disabled:opacity-60">
            {busy ? "Bitte warten..." : mode === "login" ? "Anmelden" : "Admin erstellen"}
          </button>
        </form>
      </section>
    </main>
  );
}
