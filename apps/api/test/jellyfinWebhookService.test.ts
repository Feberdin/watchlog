/**
 * Purpose: Verify that a completed PlaybackStop creates one WatchEvent and duplicate stops are ignored.
 * Input/Output: A fake Prisma boundary captures service writes without requiring PostgreSQL.
 * Invariants: Dedupe suppresses near-identical Jellyfin events, but the first completed event is stored.
 * Debugging: If this fails, inspect handleJellyfinWebhookEvent before testing Fastify routing.
 */

import { describe, expect, it } from "vitest";
import { handleJellyfinWebhookEvent } from "../src/services/watchEvents.js";
import { parseJellyfinWebhook } from "../src/webhooks/jellyfinParser.js";

const playbackStopPayload = {
  notification_type: "PlaybackStop",
  utc_timestamp: "2026-05-25T10:00:00Z",
  user: { id: "jf-user-1", name: "Example User" },
  client: { name: "Jellyfin Web", device_name: "Firefox", device_id: "example-device" },
  item: {
    id: "jf-item-heat-1995",
    type: "Movie",
    name: "Heat",
    year: "1995",
    runtime_ticks: "102000000000",
    tmdb_id: "949",
    imdb_id: "tt0113277",
  },
  playback: {
    position_ticks: "102000000000",
    played_to_completion: "true",
    played: "true",
  },
};

describe("handleJellyfinWebhookEvent", () => {
  it("creates a WatchEvent from PlaybackStop and suppresses an immediate duplicate", async () => {
    const watchEvents: Array<{ id: string; userId: string; mediaId: string; watchedAt: Date; source: string; rewatchIndex: number }> = [];
    const prisma = {
      user: {
        findFirst: async () => ({ id: "user-1", jellyfinUserId: "jf-user-1" }),
      },
      media: {
        upsert: async () => ({ id: "media-1" }),
      },
      playbackSession: {
        create: async () => ({ id: "session-1" }),
      },
      watchEvent: {
        findFirst: async ({ where, orderBy }: { where: { source?: string; watchedAt?: { gte: Date; lte: Date } }; orderBy?: unknown }) => {
          if (where.source === "jellyfin" && where.watchedAt) {
            return watchEvents.find((event) => event.watchedAt >= where.watchedAt!.gte && event.watchedAt <= where.watchedAt!.lte) ?? null;
          }

          if (orderBy) {
            return watchEvents.at(-1) ?? null;
          }

          return null;
        },
        create: async ({ data }: { data: { userId: string; mediaId: string; watchedAt: Date; source: string; rewatchIndex: number } }) => {
          const row = { id: `watch-${watchEvents.length + 1}`, ...data };
          watchEvents.push(row);
          return row;
        },
      },
    };
    const event = parseJellyfinWebhook(playbackStopPayload);

    const first = await handleJellyfinWebhookEvent(prisma as never, event);
    const second = await handleJellyfinWebhookEvent(prisma as never, event);

    expect(first.created).toBe(true);
    expect(first.watchEvent?.id).toBe("watch-1");
    expect(second.created).toBe(false);
    expect(second.ignoredReason).toMatch(/Doppelter Webhook/);
    expect(watchEvents).toHaveLength(1);
  });
});
