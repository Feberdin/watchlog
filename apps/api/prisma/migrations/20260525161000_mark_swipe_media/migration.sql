-- Purpose: Move already-swiped TMDb-only recommendation rows out of the normal media catalog.
-- Input/Output: Media rows that only came from SwipeDecision history become `swipe-tmdb`.
-- Invariants: Jellyfin-linked media remains visible in the normal catalog.
-- Debugging: If a recommendation still appears in Series, verify it has no Jellyfin item and no episode children.

UPDATE "Media"
SET "metadataSource" = 'swipe-tmdb'
WHERE "metadataSource" = 'tmdb'
  AND "jellyfinItemId" IS NULL
  AND "id" IN (
    SELECT DISTINCT "mediaId"
    FROM "SwipeDecision"
  );
