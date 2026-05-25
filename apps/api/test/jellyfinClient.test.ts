/**
 * Purpose: Verify Jellyfin API client parsing without calling a real Jellyfin server.
 * Input/Output: Mocked fetch responses become watched item arrays and image/runtime helpers.
 * Invariants: API keys stay in headers and are never included in errors or URLs.
 * Debugging: If Jellyfin imports return zero rows, compare this query shape with a sanitized real response.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { jellyfinPrimaryImageUrl, listWatchedJellyfinItems, ticksToSeconds } from "../src/services/jellyfinClient.js";

describe("jellyfinClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("converts ticks and builds primary image URLs without API tokens", () => {
    expect(ticksToSeconds(90_000_000)).toBe(9);
    expect(jellyfinPrimaryImageUrl("http://jellyfin.local:8096", {
      Id: "item 1",
      ImageTags: { Primary: "tag 1" },
    })).toBe("http://jellyfin.local:8096/Items/item%201/Images/Primary?tag=tag%201");
  });

  it("loads watched movies and episodes for one Jellyfin user", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        TotalRecordCount: 1,
        Items: [{ Id: "movie-1", Name: "Heat", Type: "Movie", UserData: { Played: true } }],
      }),
    } as Response);

    const items = await listWatchedJellyfinItems("http://jellyfin.local:8096", "api-key", "jf-user-1");
    const calledUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));

    expect(items).toHaveLength(1);
    expect(items[0]?.Name).toBe("Heat");
    expect(calledUrl.pathname).toBe("/Users/jf-user-1/Items");
    expect(calledUrl.searchParams.get("Filters")).toBe("IsPlayed");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ "X-Emby-Token": "api-key" }),
    });
  });
});
