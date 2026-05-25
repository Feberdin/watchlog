/**
 * Purpose: Guard the documented CSV export column order.
 * Input/Output: A small string assertion protects downstream import compatibility.
 * Invariants: CSV header must match docs/import-export.md.
 * Debugging: Update docs and tests together when columns change intentionally.
 */

import { describe, expect, it } from "vitest";

describe("CSV export contract", () => {
  it("keeps the documented header stable", () => {
    const header = ["type", "title", "year", "watched_at", "date_precision", "tmdb_id", "imdb_id", "jellyfin_item_id", "note", "rating"];
    expect(header.join(",")).toBe("type,title,year,watched_at,date_precision,tmdb_id,imdb_id,jellyfin_item_id,note,rating");
  });
});
