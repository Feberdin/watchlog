-- Purpose: Store per-user swipe choices so skipped/requested media disappear from the swipe queue.
-- Input/Output: Adds a durable decision table linked to WatchLog users and media.
-- Invariants: A user has at most one current swipe decision per media item.
-- Debugging: Inspect rows by userId/mediaId when a card unexpectedly does or does not reappear.

CREATE TABLE "SwipeDecision" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "externalStatus" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SwipeDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SwipeDecision_userId_mediaId_key" ON "SwipeDecision"("userId", "mediaId");
CREATE INDEX "SwipeDecision_action_createdAt_idx" ON "SwipeDecision"("action", "createdAt");

ALTER TABLE "SwipeDecision" ADD CONSTRAINT "SwipeDecision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SwipeDecision" ADD CONSTRAINT "SwipeDecision_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;
