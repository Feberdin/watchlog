/**
 * Purpose: Test manual historical entries with imprecise dates through the service boundary.
 * Input/Output: A fake Prisma client captures created WatchEvent data.
 * Invariants: Year precision stores January 1 for sorting while preserving datePrecision.
 * Debugging: If this test fails, inspect manual date parsing in watchEvents.ts.
 */

import { describe, expect, it } from "vitest";
import { createManualWatchEvent } from "../src/services/watchEvents.js";

describe("createManualWatchEvent", () => {
  it("creates a manual entry with year-only precision", async () => {
    const createdWatchEvents: unknown[] = [];
    const prisma = {
      media: {
        create: async () => ({ id: "media-1" }),
      },
      watchEvent: {
        findFirst: async () => null,
        create: async ({ data }: { data: unknown }) => {
          createdWatchEvents.push(data);
          return { id: "watch-1", ...data };
        },
      },
    };

    const result = await createManualWatchEvent(prisma as never, "user-1", {
      datePrecision: "year",
      watchedAt: "2010",
      note: "nur Jahr bekannt",
      rating: null,
      media: {
        type: "movie",
        title: "Alien",
        year: 1979,
      },
    });

    expect(result.rewatchIndex).toBe(1);
    expect(createdWatchEvents).toHaveLength(1);
    expect((createdWatchEvents[0] as { watchedAt: Date }).watchedAt.toISOString()).toBe("2010-01-01T00:00:00.000Z");
  });
});
