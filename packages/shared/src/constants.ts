/**
 * Purpose: Central constants shared by the API and web UI.
 * Input/Output: Imports produce stable labels, defaults, and enum-like values.
 * Invariants: Defaults must be safe for self-hosted deployments and avoid surprise sync.
 * Debugging: If UI and API disagree on labels or thresholds, check this file first.
 */

export const APP_NAME = "WatchLog";
export const APP_VERSION = "0.1.0";

export const DEFAULT_MOVIE_THRESHOLD_PERCENT = 90;
export const DEFAULT_EPISODE_THRESHOLD_PERCENT = 90;
export const DEFAULT_DEDUPE_WINDOW_MINUTES = 30;

export const DATE_PRECISIONS = ["exact", "date", "month", "year", "unknown"] as const;
export const MEDIA_TYPES = ["movie", "show", "season", "episode"] as const;
export const WATCH_EVENT_SOURCES = ["jellyfin", "manual", "import"] as const;

export const SESSION_COOKIE_NAME = "watchlog_session";
