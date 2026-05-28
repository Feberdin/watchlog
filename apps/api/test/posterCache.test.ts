/**
 * Purpose: Unit tests for local custom poster storage.
 * Input/Output: Uploaded image bytes become optimized WebP bytes readable through the poster cache.
 * Invariants: Custom poster references are internal identifiers, never user-controlled filesystem paths.
 * Debugging: If uploads break, inspect the temporary cache path and sharp image conversion errors.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { customPosterRef, getCachedPoster, isCustomPosterRef, saveCustomPoster } from "../src/services/posterCache.js";

let cacheDir: string | null = null;

afterEach(async () => {
  if (cacheDir) {
    await rm(cacheDir, { recursive: true, force: true });
    cacheDir = null;
  }
});

describe("custom poster cache", () => {
  it("stores uploaded images as internal WebP poster references", async () => {
    cacheDir = await mkdtemp(join(tmpdir(), "watchlog-poster-"));
    const source = await sharp({
      create: {
        width: 20,
        height: 30,
        channels: 3,
        background: "#14b8a6",
      },
    }).png().toBuffer();

    const ref = await saveCustomPoster(cacheDir, "media-1", source);
    const poster = await getCachedPoster(cacheDir, ref);

    expect(ref).toBe(customPosterRef("media-1"));
    expect(isCustomPosterRef(ref)).toBe(true);
    expect(poster.subarray(0, 4).toString("hex")).toBe("52494646");
  });
});
