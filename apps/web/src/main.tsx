/**
 * Purpose: Browser entry point and minimal client-side page router.
 * Input/Output: Mounts React into #root and chooses pages based on auth state and local tab state.
 * Invariants: Auth state is confirmed by `/api/auth/me` on load; no tokens are stored in localStorage.
 * Debugging: If the screen is blank, check console errors and Vite overlay first.
 */

import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AuthUser } from "@watchlog/shared";
import { apiRequest } from "./api/client";
import { Layout } from "./components/Layout";
import { AuthPage } from "./pages/AuthPage";
import { DashboardPage } from "./pages/DashboardPage";
import { TimelinePage } from "./pages/TimelinePage";
import { ManualAddPage } from "./pages/ManualAddPage";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import "./styles/index.css";

type Page = "dashboard" | "timeline" | "manual" | "integrations";

function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Page>("dashboard");

  useEffect(() => {
    apiRequest<AuthUser>("/api/auth/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function logout() {
    await apiRequest("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => undefined);
    setUser(null);
  }

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">WatchLog wird geladen...</main>;
  }

  if (!user) {
    return <AuthPage onAuthenticated={setUser} />;
  }

  return (
    <Layout active={active} setActive={setActive} onLogout={() => void logout()}>
      {active === "dashboard" && <DashboardPage />}
      {active === "timeline" && <TimelinePage />}
      {active === "manual" && <ManualAddPage />}
      {active === "integrations" && <IntegrationsPage user={user} onUserUpdated={setUser} />}
    </Layout>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
