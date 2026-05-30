/**
 * Purpose: Resolve known and estimated runtimes for watchtime statistics.
 * Input/Output: WatchEvent/media runtime fields become a seconds value plus estimation metadata.
 * Invariants: Positive event durations win over media runtimes; missing runtimes use explicit defaults.
 * Debugging: If totals look wrong, log the returned `source`, `seconds`, and media `type`.
 */

export type RuntimeMediaType = "movie" | "show" | "season" | "episode" | string;

export type RuntimeInput = {
  type: RuntimeMediaType;
  durationSeconds?: number | null;
  runtimeSeconds?: number | null;
};

export type RuntimeResolution = {
  seconds: number;
  estimated: boolean;
  source: "event" | "media" | "estimated" | "missing";
};

export const ESTIMATED_RUNTIME_SECONDS = {
  movie: 105 * 60,
  show: 8 * 45 * 60,
  season: 8 * 45 * 60,
  episode: 45 * 60,
} as const;

function positiveSeconds(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

/**
 * Why this exists: WatchLog imports from multiple sources, and not every source
 * carries a duration. Returning estimation metadata keeps the UI honest instead
 * of silently undercounting total watchtime.
 */
export function estimateRuntimeSeconds(type: RuntimeMediaType) {
  if (type === "movie") return ESTIMATED_RUNTIME_SECONDS.movie;
  if (type === "show") return ESTIMATED_RUNTIME_SECONDS.show;
  if (type === "season") return ESTIMATED_RUNTIME_SECONDS.season;
  if (type === "episode") return ESTIMATED_RUNTIME_SECONDS.episode;
  return 0;
}

export function resolveRuntimeSeconds(input: RuntimeInput): RuntimeResolution {
  const eventSeconds = positiveSeconds(input.durationSeconds);
  if (eventSeconds !== null) {
    return { seconds: eventSeconds, estimated: false, source: "event" };
  }

  const mediaSeconds = positiveSeconds(input.runtimeSeconds);
  if (mediaSeconds !== null) {
    return { seconds: mediaSeconds, estimated: false, source: "media" };
  }

  const estimatedSeconds = estimateRuntimeSeconds(input.type);
  if (estimatedSeconds > 0) {
    return { seconds: estimatedSeconds, estimated: true, source: "estimated" };
  }

  return { seconds: 0, estimated: false, source: "missing" };
}
