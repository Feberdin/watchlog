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
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 409,
    } as Response);

    await expect(requestJellyseerrMedia("http://jellyseerr.local:5055", "api-key", "tv", 66732))
      .resolves.toEqual({ accepted: true, alreadyRequested: true });
  });
});
