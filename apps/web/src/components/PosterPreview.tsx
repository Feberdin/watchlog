/**
 * Purpose: Shared poster thumbnail with a large viewport-centered hover/focus preview overlay.
 * Input/Output: Receives an optional poster URL plus media metadata and renders a small poster that can reveal a larger preview.
 * Invariants: The overlay is rendered in a portal so table/card overflow cannot clip it; poster images use object-contain so the full artwork stays visible.
 * Debugging: If the preview size feels wrong, inspect `overlayStyle` and `posterPanelStyle`; if posters are blank, check the supplied `src`.
 */

import { type CSSProperties, type ReactNode, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Film, Tv } from "lucide-react";

type PosterKind = "movie" | "series";

type PosterPreviewProps = {
  src: string | null;
  title: string;
  kind: PosterKind;
  className: string;
  typeLabel: string;
  year?: number | null;
  meta?: Array<string | number | null | undefined | false>;
  cast?: string[];
  overview?: string | null;
  badge?: ReactNode;
  imageClassName?: string;
  focusable?: boolean;
};

const overlayStyle: CSSProperties = {
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  width: "min(50vw, calc(100vw - 2rem))",
  minWidth: "min(420px, calc(100vw - 2rem))",
  maxWidth: "760px",
  maxHeight: "calc(100vh - 2rem)",
};

const posterPanelStyle: CSSProperties = {
  height: "min(68vh, 680px)",
};

function compactDetails(details: Array<string | number | null | undefined | false>) {
  return details
    .filter((detail): detail is string | number => detail !== null && detail !== undefined && detail !== false && String(detail).trim().length > 0)
    .map((detail) => String(detail));
}

export function PosterPreview({
  src,
  title,
  kind,
  className,
  typeLabel,
  year,
  meta = [],
  cast = [],
  overview,
  badge,
  imageClassName = "rounded-md",
  focusable = true,
}: PosterPreviewProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const Icon = kind === "movie" ? Film : Tv;
  const details = useMemo(() => compactDetails([typeLabel, year ? year : "ohne Jahr", ...meta]), [meta, typeLabel, year]);
  const castDetails = useMemo(() => compactDetails(cast).slice(0, 10), [cast]);
  const open = hovered || focused;

  return (
    <>
      <span
        className={`relative block shrink-0 cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-teal-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${className}`}
        tabIndex={focusable ? 0 : undefined}
        aria-label={`${title} Poster anzeigen`}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onClick={() => setFocused(true)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        {src ? (
          <img className={`h-full w-full object-cover ring-1 ring-slate-800 ${imageClassName}`} src={src} alt={`${title} Poster`} loading="lazy" />
        ) : (
          <span className={`flex h-full w-full items-center justify-center bg-slate-800 ring-1 ring-slate-700 ${imageClassName}`}>
            <Icon className="h-7 w-7 text-slate-500" aria-hidden="true" />
          </span>
        )}
        {badge}
      </span>

      {open && createPortal(
        <aside
          className="pointer-events-none fixed z-[90] overflow-hidden rounded-lg border border-slate-700 bg-slate-950 text-slate-100 shadow-2xl shadow-slate-950/80 ring-1 ring-white/10"
          style={overlayStyle}
          aria-hidden="true"
        >
          <div className="flex items-center justify-center bg-slate-900 p-3" style={posterPanelStyle}>
            {src ? (
              <img className="h-full max-h-full w-full max-w-full object-contain" src={src} alt="" />
            ) : (
              <div className="flex h-full w-full items-center justify-center rounded-md bg-slate-800">
                <Icon className="h-14 w-14 text-slate-500" aria-hidden="true" />
              </div>
            )}
          </div>
          <div className="space-y-3 p-4">
            <div>
              <h3 className="line-clamp-2 text-base font-semibold leading-snug">{title}</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {details.map((detail) => (
                  <span key={detail} className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 ring-1 ring-slate-700">
                    {detail}
                  </span>
                ))}
              </div>
            </div>
            <p className="line-clamp-5 text-sm leading-6 text-slate-300">
              {overview?.trim() || "Keine Beschreibung vorhanden."}
            </p>
            {castDetails.length > 0 && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Besetzung</p>
                <p className="mt-1 line-clamp-3 text-sm leading-6 text-slate-300">{castDetails.join(", ")}</p>
              </div>
            )}
          </div>
        </aside>,
        document.body,
      )}
    </>
  );
}
