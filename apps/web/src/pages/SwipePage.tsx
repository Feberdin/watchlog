/**
 * Purpose: Mobile-first swipe workflow for deciding what is watched, skipped, or requested.
 * Input/Output: Loads `/api/swipe/candidates` and posts explicit swipe decisions to WatchLog.
 * Invariants: Buttons mirror gestures so the flow remains usable when touch events are unreliable.
 * Debugging: If cards do not move, check browser network calls to `/api/swipe/action` and server logs.
 */

import { ArrowDown, ArrowLeft, ArrowUp, Check, EyeOff, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SwipeActionResult, SwipeCandidate, SwipeHistoryItem } from "@watchlog/shared";
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

function bucketLabel(bucket: SwipeCandidate["recommendationBucket"]) {
  if (bucket === "new") return "Neu und gut bewertet";
  if (bucket === "classic") return "Klassiker mit Top-Bewertung";
  if (bucket === "random") return "Zufallstreffer mit guter Bewertung";
  return "Vorschlag";
}

function ratingLabel(value: number | null) {
  if (typeof value !== "number") return "n/a";
  return value.toFixed(1);
}

function actionFromDrag(deltaX: number, deltaY: number): SwipeAction | null {
  const horizontal = Math.abs(deltaX);
  const vertical = Math.abs(deltaY);
  if (vertical > 90 && deltaY < 0 && vertical > horizontal * 0.8) return "want";
  if (horizontal > 100 && horizontal > vertical) return deltaX < 0 ? "seen" : "skip";
  return null;
}

function openTrailer(url: string | null) {
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

export function SwipePage() {
  const [cards, setCards] = useState<SwipeCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("Lade Vorschlaege...");
  const [drag, setDrag] = useState({ active: false, startX: 0, startY: 0, x: 0, y: 0 });
  const [lastResult, setLastResult] = useState<SwipeActionResult | null>(null);
  const [history, setHistory] = useState<SwipeHistoryItem[]>([]);
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

  async function loadHistory() {
    const next = await apiRequest<SwipeHistoryItem[]>("/api/swipe/history");
    setHistory(next);
  }

  useEffect(() => {
    void loadCandidates();
    void loadHistory().catch(() => undefined);
  }, []);

  async function submitAction(action: SwipeAction) {
    if (!current || pending) return;
    setPending(true);
    setLastResult(null);
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
      await loadHistory();
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Swipe konnte nicht gespeichert werden.");
      setLastResult(null);
      setDrag({ active: false, startX: 0, startY: 0, x: 0, y: 0 });
      await loadHistory().catch(() => undefined);
    } finally {
      setPending(false);
    }
  }

  async function submitHistoryAction(mediaId: string, action: SwipeAction) {
    if (pending) return;
    setPending(true);
    setLastResult(null);
    setStatus(`${actionText[action]} wird gespeichert...`);
    try {
      const result = await apiRequest<SwipeActionResult>("/api/swipe/action", {
        method: "POST",
        body: JSON.stringify({ mediaId, action }),
      });
      setStatus(result.message);
      setLastResult(result);
      setCards((existing) => existing.filter((card) => card.id !== mediaId));
      await loadHistory();
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Swipe-Entscheidung konnte nicht geaendert werden.");
      setLastResult(null);
      await loadHistory().catch(() => undefined);
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
              <div className="relative h-full">
                {current.posterUrl ? (
                  <img className="h-full w-full object-cover" src={current.posterUrl} alt="" draggable={false} />
                ) : current.backdropUrl ? (
                  <img className="h-full w-full object-cover" src={current.backdropUrl} alt="" draggable={false} />
                ) : (
                  <div className="flex h-full items-center justify-center bg-slate-800 text-slate-500">{current.type === "movie" ? "Film" : "Serie"}</div>
                )}
                <div className="absolute right-4 top-4 rounded-lg border border-amber-200/50 bg-slate-950/85 px-3 py-2 text-right shadow-lg backdrop-blur">
                  <p className="text-xs font-medium uppercase text-amber-200">TMDb</p>
                  <p className="text-3xl font-semibold leading-none text-amber-200">{ratingLabel(current.voteAverage)}</p>
                  {current.voteCount && <p className="mt-1 text-xs text-slate-300">{current.voteCount} Stimmen</p>}
                </div>
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950 via-slate-950/85 to-transparent p-4 pt-28">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-medium">
                    <span className="rounded bg-teal-300 px-2 py-1 text-slate-950">{bucketLabel(current.recommendationBucket)}</span>
                    <span className="rounded bg-slate-900/90 px-2 py-1 text-slate-200">{current.type === "movie" ? "Film" : "Serie"}</span>
                  </div>
                  <h2 className="text-3xl font-semibold leading-tight drop-shadow">{current.title}</h2>
                  <p className="mt-2 text-sm text-slate-300">
                    {[current.year, runtimeLabel(current.runtimeSeconds), current.voteCount ? `${current.voteCount} Stimmen` : null].filter(Boolean).join(" · ") || "Keine Laufzeit/Jahr hinterlegt"}
                  </p>
                  <p className="mt-4 line-clamp-4 text-sm leading-6 text-slate-200">
                    {current.overview || "Keine Beschreibung vorhanden."}
                  </p>
                  <button
                    className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-semibold text-slate-950 disabled:bg-slate-700 disabled:text-slate-400"
                    disabled={!current.trailerUrl}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      openTrailer(current.trailerUrl);
                    }}
                  >
                    <Play className="h-4 w-4" aria-hidden="true" />
                    {current.trailerUrl ? `Trailer ansehen${current.trailerSite ? ` (${current.trailerSite})` : ""}` : "Kein Trailer gefunden"}
                  </button>
                </div>
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

      <div className="mx-auto max-w-md rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Swipe-Verlauf</h2>
            <p className="text-sm text-slate-400">Hier kannst du spaeter eine Entscheidung aendern.</p>
          </div>
          <button className="rounded-md bg-slate-800 px-3 py-2 text-sm text-slate-200" onClick={() => void loadHistory()}>
            Aktualisieren
          </button>
        </div>
        <div className="mt-4 space-y-3">
          {history.length === 0 && <p className="text-sm text-slate-400">Noch keine Swipe-Entscheidungen.</p>}
          {history.slice(0, 20).map((item) => (
            <div key={item.decisionId} className="flex gap-3 rounded-md border border-slate-800 bg-slate-950 p-2">
              <div className="h-20 w-14 shrink-0 overflow-hidden rounded bg-slate-800">
                {item.posterUrl && <img className="h-full w-full object-cover" src={item.posterUrl} alt="" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{item.title}</p>
                <p className="text-xs text-slate-400">
                  {item.type === "movie" ? "Film" : "Serie"}{item.year ? ` · ${item.year}` : ""} · {actionText[item.action]}
                </p>
                {item.errorMessage && <p className="mt-1 line-clamp-2 text-xs text-amber-200">{item.errorMessage}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button className="rounded bg-emerald-500 px-2 py-1 text-xs font-medium text-slate-950" onClick={() => void submitHistoryAction(item.mediaId, "seen")}>
                    Gesehen
                  </button>
                  <button className="rounded bg-amber-300 px-2 py-1 text-xs font-medium text-slate-950" onClick={() => void submitHistoryAction(item.mediaId, "want")}>
                    Will ich
                  </button>
                  <button className="rounded bg-slate-800 px-2 py-1 text-xs font-medium text-slate-100" onClick={() => void submitHistoryAction(item.mediaId, "skip")}>
                    Nicht gesehen
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
