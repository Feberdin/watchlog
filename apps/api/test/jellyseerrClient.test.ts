/**
 * Purpose: Verify Jellyseerr request calls without contacting a real Jellyseerr instance.
 * Input/Output: Mocked HTTP responses become normalized request results.
 * Invariants: API keys are sent only in headers and never appear in URLs or errors.
 * Debugging: If "Will ich sehen" fails, compare the request path/body with Jellyseerr API logs.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { requestJellyseerrMedia } from "../src/services/jellyseerrClient.js";

describe("jellyseerrClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests a movie by TMDb id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 201,
    } as Response);

    const result = await requestJellyseerrMedia("http://jellyseerr.local:5055", "api-key", "movie", 603);
    const calledUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;

    expect(result).toEqual({ accepted: true, alreadyRequested: false });
    expect(calledUrl.pathname).toBe("/api/v1/request");
    expect(JSON.parse(String(options.body))).toEqual({ mediaType: "movie", mediaId: 603 });
    expect(options.headers).toMatchObject({ "X-Api-Key": "api-key" });
  });

  it("treats an existing request as accepted", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ seasons: [{ seasonNumber: 0 }, { seasonNumber: 1 }, { seasonNumber: 2 }] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
      } as Response);

    await expect(requestJellyseerrMedia("http://jellyseerr.local:5055", "api-key", "tv", 66732))
      .resolves.toEqual({ accepted: true, alreadyRequested: true });
  });

  it("requests TV shows with non-special seasons", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ seasons: [{ seasonNumber: 0 }, { seasonNumber: 1 }, { seasonNumber: 3 }] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
      } as Response);

    await requestJellyseerrMedia("http://jellyseerr.local:5055", "api-key", "tv", 66732);
    const detailUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    const requestUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    const requestOptions = fetchMock.mock.calls[1]?.[1] as RequestInit;

    expect(detailUrl.pathname).toBe("/api/v1/tv/66732");
    expect(requestUrl.pathname).toBe("/api/v1/request");
    expect(JSON.parse(String(requestOptions.body))).toEqual({ mediaType: "tv", mediaId: 66732, seasons: [1, 3] });
  });

  it("includes safe Jellyseerr error details when available", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: "No seasons available" }),
    } as Response);

    await expect(requestJellyseerrMedia("http://jellyseerr.local:5055", "api-key", "movie", 603))
      .rejects.toThrow("No seasons available");
  });
});
