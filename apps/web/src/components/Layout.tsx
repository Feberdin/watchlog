/**
 * Purpose: Shared page shell with navigation and status affordances.
 * Input/Output: Wraps page content and exposes consistent navigation.
 * Invariants: Keep controls compact and readable on mobile and desktop.
 * Debugging: Layout bugs usually come from child pages using fixed widths.
 */

import { Clapperboard, Film, LayoutDashboard, List, LogOut, Plug, PlusCircle, Sparkles, Tv } from "lucide-react";
import type { ReactNode } from "react";

type LayoutProps = {
  children: ReactNode;
  onLogout: () => void;
  active: "dashboard" | "timeline" | "series" | "swipe" | "cinema" | "tvMemory" | "manual" | "integrations";
  setActive: (page: "dashboard" | "timeline" | "series" | "swipe" | "cinema" | "tvMemory" | "manual" | "integrations") => void;
};

export function Layout({ children, onLogout, active, setActive }: LayoutProps) {
  const items = [
    { id: "dashboard" as const, label: "Dashboard", icon: LayoutDashboard },
    { id: "timeline" as const, label: "Timeline", icon: List },
    { id: "series" as const, label: "Serien", icon: Tv },
    { id: "swipe" as const, label: "Swipen", icon: Sparkles },
    { id: "cinema" as const, label: "Kino", icon: Clapperboard },
    { id: "tvMemory" as const, label: "TV", icon: Tv },
    { id: "manual" as const, label: "Manuell", icon: PlusCircle },
    { id: "integrations" as const, label: "Integrationen", icon: Plug },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <button className="flex items-center gap-2 text-left" onClick={() => setActive("dashboard")}>
            <Film className="h-6 w-6 text-accent" aria-hidden="true" />
            <span className="text-xl font-semibold">WatchLog</span>
          </button>
          <nav className="flex flex-wrap items-center gap-2">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setActive(item.id)}
                  className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                    active === item.id ? "bg-teal-400 text-slate-950" : "bg-slate-900 text-slate-200 hover:bg-slate-800"
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {item.label}
                </button>
              );
            })}
            <button
              onClick={onLogout}
              className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Abmelden
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
