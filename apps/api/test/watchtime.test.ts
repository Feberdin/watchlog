/**
 * Purpose: Unit tests for WatchLog runtime resolution and estimation defaults.
 * Input/Output: Runtime inputs become known or estimated seconds for statistics.
 * Invariants: Known durations must win over estimates so user corrections stay authoritative.
 * Debugging: If totals regress, compare these expectations with Timeline and share-image summaries.
 */

import { describe, expect, it } from "vitest";
import { ESTIMATED_RUNTIME_SECONDS, resolveRuntimeSeconds } from "../src/services/watchtime.js";

describe("watchtime runtime resolution", () => {
  it("uses the event duration before the media runtime", () => {
    const runtime = resolveRuntimeSeconds({ type: "movie", durationSeconds: 7200, runtimeSeconds: 6000 });

    expect(runtime).toEqual({ seconds: 7200, estimated: false, source: "event" });
  });

  it("uses the media runtime when the event has no duration", () => {
    const runtime = resolveRuntimeSeconds({ type: "episode", durationSeconds: null, runtimeSeconds: 2700 });

    expect(runtime).toEqual({ seconds: 2700, estimated: false, source: "media" });
  });

  it("estimates missing movie and episode runtimes", () => {
    expect(resolveRuntimeSeconds({ type: "movie" })).toEqual({
      seconds: ESTIMATED_RUNTIME_SECONDS.movie,
      estimated: true,
      source: "estimated",
    });
    expect(resolveRuntimeSeconds({ type: "episode" })).toEqual({
      seconds: ESTIMATED_RUNTIME_SECONDS.episode,
      estimated: true,
      source: "estimated",
    });
  });

  it("treats full show or season entries as a short season estimate", () => {
    expect(resolveRuntimeSeconds({ type: "show" }).seconds).toBe(8 * 45 * 60);
    expect(resolveRuntimeSeconds({ type: "season" }).seconds).toBe(8 * 45 * 60);
  });
});
