/**
 * Purpose: Verify Jellyfin webhook normalization without a running server.
 * Input/Output: Sample payloads produce normalized events used by WatchEvent services.
 * Invariants: Empty strings become null, booleans parse from strings, and ticks produce percentages.
 * Debugging: Add sanitized real payloads here when Jellyfin plugin templates vary.
 */

import { describe, expect, it } from "vitest";
import { parseJellyfinWebhook } from "../src/webhooks/jellyfinParser.js";

const basePayload = {
  notification_type: "PlaybackStop",
  utc_timestamp: "2026-05-25T12:00:00Z",
  user: { id: "jf-user-1", name: "Joachim" },
  client: { name: "Jellyfin Web", device_name: "Firefox", device_id: "device-1" },
  item: {
    id: "item-1",
    type: "Movie",
    name: "Heat",
    year: "1995",
    runtime_ticks: "102000000000",
    tmdb_id: "",
    imdb_id: "tt0113277",
  },
  playback: {
    position_ticks: "102000000000",
    played_to_completion: "true",
    played: "false",
  },
};

describe("parseJellyfinWebhook", () => {
  it("parses a completed movie PlaybackStop", () => {
    const parsed = parseJellyfinWebhook(basePayload);

    expect(parsed.itemType).toBe("Movie");
    expect(parsed.playedToCompletion).toBe(true);
    expect(parsed.runtimeSeconds).toBe(10_200);
    expect(parsed.progressPercent).toBe(100);
    expect(parsed.tmdbId).toBeNull();
    expect(parsed.imdbId).toBe("tt0113277");
  });

  it("parses an episode with season and episode numbers", () => {
    const parsed = parseJellyfinWebhook({
      ...basePayload,
      item: {
        ...basePayload.item,
        type: "Episode",
        name: "Pilot",
        series_name: "Example Show",
        series_id: "series-1",
        season_number: "1",
        episode_number: "2",
      },
    });

    expect(parsed.itemType).toBe("Episode");
    expect(parsed.seriesName).toBe("Example Show");
    expect(parsed.seasonNumber).toBe(1);
    expect(parsed.episodeNumber).toBe(2);
  });

  it("calculates progress under and over threshold", () => {
    const under = parseJellyfinWebhook({
      ...basePayload,
      playback: { ...basePayload.playback, position_ticks: "45000000000", played_to_completion: "false" },
    });
    const over = parseJellyfinWebhook({
      ...basePayload,
      playback: { ...basePayload.playback, position_ticks: "92000000000", played_to_completion: "false" },
    });

    expect(under.progressPercent).toBeCloseTo(44.12);
    expect(over.progressPercent).toBeCloseTo(90.2);
  });

  it("throws a readable error when required fields are missing", () => {
    expect(() => parseJellyfinWebhook({ item: {}, user: {} })).toThrow(/item.id/);
  });
});
