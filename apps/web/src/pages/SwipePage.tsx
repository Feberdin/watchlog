/**
 * Purpose: Mobile-first swipe workflow for deciding what is watched, skipped, or requested.
 * Input/Output: Loads `/api/swipe/candidates` and posts explicit swipe decisions to WatchLog.
 * Invariants: Buttons mirror gestures so the flow remains usable when touch events are unreliable.
 * Debugging: If cards do not move, check browser network calls to `/api/swipe/action` and server logs.
 */

import { ArrowDown, ArrowLeft, ArrowUp, Check, EyeOff, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SwipeActionResult, SwipeCandidate } from "@watchlog/shared";
import { apiRequest } from "../api/client";

type SwipeAction = "seen" | "skip" | "want";

const actionText: Record<SwipeAction, string> = {
  seen: "Gesehen",
  skip: "Nicht gesehen",
  want: "Will ich sehen",
};

function runtimeLabel(seconds: number | null) {
  if (!seconds) return null;
  return `${Math.round(seconds / 60)} Min.`;
}

function actionFromDrag(deltaX: number, deltaY: number): SwipeAction | null {
  const horizontal = Math.abs(deltaX);
  const vertical = Math.abs(deltaY);
  if (vertical > 90 && deltaY < 0 && vertical > horizontal * 0.8) return "want";
  if (horizontal > 100 && horizontal > vertical) return deltaX < 0 ? "seen" : "skip";
  return null;
}

export function SwipePage() {
  const [cards, setCards] = useState<SwipeCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("Lade Vorschlaege...");
  const [drag, setDrag] = useState({ active: false, startX: 0, startY: 0, x: 0, y: 0 });
  const [lastResult, setLastResult] = useState<SwipeActionResult | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const current = cards[0] ?? null;
  const previewAction = useMemo(() => actionFromDrag(drag.x, drag.y), [drag.x, drag.y]);

  async function loadCandidates() {
    setLoading(true);
    try {
      const next = await apiRequest<SwipeCandidate[]>("/api/swipe/candidates?limit=30&type=all");
      setCards(next);
      setStatus(next.length > 0 ? `${next.length} Medien bereit zum Swipen.` : "Keine offenen Medien gefunden. Importiere oder synchronisiere zuerst Filme/Serien.");
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Swipe-Kandidaten konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCandidates();
  }, []);

  async function submitAction(action: SwipeAction) {
    if (!current || pending) return;
    setPending(true);
    setStatus(`${actionText[action]} wird gespeichert...`);
    try {
      const result = await apiRequest<SwipeActionResult>("/api/swipe/action", {
        method: "POST",
        body: JSON.stringify({ mediaId: current.id, action }),
      });
      setLastResult(result);
      setCards((existing) => existing.slice(1));
      setStatus(result.message);
      setDrag({ active: false, startX: 0, startY: 0, x: 0, y: 0 });
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Swipe konnte nicht gespeichert werden.");
    } finally {
      setPending(false);
    }
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!current || pending) return;
    cardRef.current?.setPointerCapture(event.pointerId);
    setDrag({ active: true, startX: event.clientX, startY: event.clientY, x: 0, y: 0 });
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!drag.active || pending) return;
    setDrag((currentDrag) => ({
      ...currentDrag,
      x: event.clientX - currentDrag.startX,
      y: event.clientY - currentDrag.startY,
    }));
  }

  function handlePointerUp() {
    if (!drag.active || pending) return;
    const action = actionFromDrag(drag.x, drag.y);
    if (action) {
      void submitAction(action);
      return;
    }
    setDrag({ active: false, startX: 0, startY: 0, x: 0, y: 0 });
  }

  const transform = drag.active ? `translate(${drag.x}px, ${drag.y}px) rotate(${drag.x / 24}deg)` : "translate(0, 0) rotate(0)";

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Swipen</h1>
          <p className="mt-1 max-w-2xl text-slate-400">
            Links: gesehen und nach Jellyfin syncen. Rechts: nicht gesehen ueberspringen. Hoch: ueber Jellyseerr anfragen.
          </p>
        </div>
        <button className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800" onClick={() => void loadCandidates()}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Neu laden
        </button>
      </div>

      <div className="mx-auto max-w-md">
        <div className="mb-3 min-h-12 rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-300">
          {status}
          {lastResult && (
            <span className="mt-1 block text-xs text-slate-500">
              Letzte Aktion: {actionText[lastResult.action]}{lastResult.jellyfinSynced ? " · Jellyfin aktualisiert" : ""}{lastResult.jellyseerrRequested ? " · Jellyseerr angefragt" : ""}
            </span>
          )}
        </div>

        <div className="relative h-[560px] overflow-hidden rounded-lg border border-slate-800 bg-slate-950 p-3">
          {loading && <div className="flex h-full items-center justify-center text-slate-400">Medien werden geladen...</div>}

          {!loading && !current && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-slate-400">
              <Check className="h-10 w-10 text-teal-300" aria-hidden="true" />
              <p>Keine offenen Karten.</p>
              <p className="text-sm">Neue Kandidaten entstehen, wenn Medien mit TMDb/Jellyfin-Daten importiert oder synchronisiert werden.</p>
            </div>
          )}

          {current && (
            <div
              ref={cardRef}
              className="absolute inset-3 touch-none select-none overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-2xl"
              style={{ transform, transition: drag.active ? "none" : "transform 160ms ease" }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              {current.backdropUrl && <div className="h-36 bg-cover bg-center opacity-80" style={{ backgroundImage: `url(${current.backdropUrl})` }} />}
              <div className="p-4">
                <div className="flex gap-4">
                  <div className="h-40 w-28 shrink-0 overflow-hidden rounded-md bg-slate-800">
                    {current.posterUrl ? (
                      <img className="h-full w-full object-cover" src={current.posterUrl} alt="" draggable={false} />
                    ) : (
                      <div className="flex h-full items-center justify-center text-slate-500">{current.type === "movie" ? "Film" : "Serie"}</div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm uppercase tracking-wide text-teal-300">{current.type === "movie" ? "Film" : "Serie"}</p>
                    <h2 className="mt-1 text-2xl font-semibold leading-tight">{current.title}</h2>
                    <p className="mt-2 text-sm text-slate-400">
                      {[current.year, runtimeLabel(current.runtimeSeconds)].filter(Boolean).join(" · ") || "Keine Laufzeit/Jahr hinterlegt"}
                    </p>
                  </div>
                </div>
                <p className="mt-4 line-clamp-[8] text-sm leading-6 text-slate-300">
                  {current.overview || "Keine Beschreibung vorhanden."}
                </p>
              </div>
              {previewAction && (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-950/65 text-2xl font-semibold text-white">
                  {actionText[previewAction]}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <button disabled={!current || pending} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-md bg-emerald-500 px-3 py-2 font-medium text-slate-950 disabled:opacity-50" onClick={() => void submitAction("seen")}>
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            Gesehen
          </button>
          <button disabled={!current || pending} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-md bg-amber-300 px-3 py-2 font-medium text-slate-950 disabled:opacity-50" onClick={() => void submitAction("want")}>
            <ArrowUp className="h-5 w-5" aria-hidden="true" />
            Will ich
          </button>
          <button disabled={!current || pending} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-md bg-slate-800 px-3 py-2 font-medium text-slate-100 disabled:opacity-50" onClick={() => void submitAction("skip")}>
            <EyeOff className="h-5 w-5" aria-hidden="true" />
            <ArrowDown className="hidden h-4 w-4" aria-hidden="true" />
            Nicht gesehen
          </button>
        </div>
      </div>
    </section>
  );
}
