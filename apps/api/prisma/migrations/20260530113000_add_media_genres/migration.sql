-- Purpose: Store normalized movie/show genres and cast directly on Media rows for filtering and poster overlays.
-- Input/Output: Existing Media rows receive empty text-array defaults; future imports can persist TMDb/Jellyfin genres and TMDb cast.
-- Invariants: Genres are optional metadata and must never block existing watch history rows.
-- Debugging: If deploy migration fails, inspect the Media table type and verify the database is PostgreSQL.

ALTER TABLE "Media"
ADD COLUMN "genres" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "cast" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
