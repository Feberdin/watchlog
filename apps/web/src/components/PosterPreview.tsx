/**
 * Purpose: Shared poster thumbnail with a viewport-safe hover/focus preview overlay.
 * Input/Output: Receives an optional poster URL plus media metadata and renders a small poster that can reveal a larger preview.
 * Invariants: The overlay is rendered in a portal so table/card overflow cannot clip it; missing posters must still show a useful placeholder.
 * Debugging: If the preview is misplaced, inspect the thumbnail bounding box and the fixed-position style calculated in `overlayStyle`.
 */

import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
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
  overview?: string | null;
  badge?: ReactNode;
  imageClassName?: string;
  focusable?: boolean;
};

const overlayGap = 14;
const viewportPadding = 16;
const overlayWidth = 300;
const expectedOverlayHeight = 520;

function compactDetails(details: Array<string | number | null | undefined | false>) {
  return details
    .filter((detail): detail is string | number => detail !== null && detail !== undefined && detail !== false && String(detail).trim().length > 0)
    .map((detail) => String(detail));
}

function overlayStyle(anchor: DOMRect | null): CSSProperties {
  if (!anchor) {
    return { opacity: 0 };
  }

  const width = Math.min(overlayWidth, window.innerWidth - viewportPadding * 2);
  const opensRight = anchor.right + overlayGap + width <= window.innerWidth - viewportPadding;
  const preferredLeft = opensRight ? anchor.right + overlayGap : anchor.left - overlayGap - width;
  const left = Math.min(Math.max(preferredLeft, viewportPadding), window.innerWidth - width - viewportPadding);
  const preferredTop = anchor.top + anchor.height / 2 - expectedOverlayHeight / 2;
  const top = Math.min(Math.max(preferredTop, viewportPadding), Math.max(viewportPadding, window.innerHeight - expectedOverlayHeight - viewportPadding));

  return {
    left,
    top,
    width,
  };
}

export function PosterPreview({
  src,
  title,
  kind,
  className,
  typeLabel,
  year,
  meta = [],
  overview,
  badge,
  imageClassName = "rounded-md",
  focusable = true,
}: PosterPreviewProps) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [open, setOpen] = useState(false);
  const Icon = kind === "movie" ? Film : Tv;
  const details = useMemo(() => compactDetails([typeLabel, year ? year : "ohne Jahr", ...meta]), [meta, typeLabel, year]);
  const style = useMemo(() => overlayStyle(anchor), [anchor]);

  function refreshAnchor() {
    setAnchor(anchorRef.current?.getBoundingClientRect() ?? null);
  }

  function showPreview() {
    refreshAnchor();
    setOpen(true);
  }

  function hidePreview() {
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return undefined;

    function handleViewportChange() {
      refreshAnchor();
    }

    window.addEventListener("scroll", handleViewportChange, true);
    window.addEventListener("resize", handleViewportChange);

    return () => {
      window.removeEventListener("scroll", handleViewportChange, true);
      window.removeEventListener("resize", handleViewportChange);
    };
  }, [open]);

  return (
    <>
      <span
        ref={anchorRef}
        className={`relative block shrink-0 cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-teal-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${className}`}
        tabIndex={focusable ? 0 : undefined}
        aria-label={`${title} Poster anzeigen`}
        onMouseEnter={showPreview}
        onMouseLeave={hidePreview}
        onPointerEnter={showPreview}
        onPointerLeave={hidePreview}
        onFocus={showPreview}
        onBlur={hidePreview}
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
          className="pointer-events-none fixed z-[90] max-h-[calc(100vh-2rem)] overflow-hidden rounded-lg border border-slate-700 bg-slate-950 text-slate-100 shadow-2xl shadow-slate-950/80 ring-1 ring-white/10"
          style={style}
          aria-hidden="true"
        >
          <div className="bg-slate-900">
            {src ? (
              <img className="h-80 w-full object-cover" src={src} alt="" />
            ) : (
              <div className="flex h-80 w-full items-center justify-center bg-slate-800">
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
          </div>
        </aside>,
        document.body,
      )}
    </>
  );
}
