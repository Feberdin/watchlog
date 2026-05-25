-- Purpose: Initial PostgreSQL schema for WatchLog Phase 1.
-- Input/Output: `prisma migrate deploy` applies this migration to create all MVP tables and indexes.
-- Invariants: Rewatches are separate WatchEvent rows; unique constraints must not block multiple watch events.
-- Debugging: If deployment fails, check PostgreSQL version, permissions, and enum/table existence.

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'user');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('movie', 'show', 'season', 'episode');

-- CreateEnum
CREATE TYPE "WatchEventSource" AS ENUM ('jellyfin', 'manual', 'import');

-- CreateEnum
CREATE TYPE "DatePrecision" AS ENUM ('exact', 'date', 'month', 'year', 'unknown');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'user',
    "jellyfinUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "valueEncrypted" TEXT,
    "valueJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Media" (
    "id" TEXT NOT NULL,
    "type" "MediaType" NOT NULL,
    "title" TEXT NOT NULL,
    "originalTitle" TEXT,
    "sortTitle" TEXT,
    "year" INTEGER,
    "overview" TEXT,
    "runtimeSeconds" INTEGER,
    "tmdbId" TEXT,
    "imdbId" TEXT,
    "tvdbId" TEXT,
    "jellyfinItemId" TEXT,
    "jellyfinSeriesId" TEXT,
    "parentMediaId" TEXT,
    "seasonNumber" INTEGER,
    "episodeNumber" INTEGER,
    "posterPath" TEXT,
    "backdropPath" TEXT,
    "posterUrl" TEXT,
    "backdropUrl" TEXT,
    "metadataSource" TEXT,
    "metadataLastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "source" "WatchEventSource" NOT NULL,
    "watchedAt" TIMESTAMP(3),
    "datePrecision" "DatePrecision" NOT NULL,
    "startedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "progressPercent" DOUBLE PRECISION,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "rewatchIndex" INTEGER NOT NULL DEFAULT 1,
    "clientName" TEXT,
    "deviceName" TEXT,
    "jellyfinSessionId" TEXT,
    "jellyfinPlaySessionId" TEXT,
    "note" TEXT,
    "rating" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaybackSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "jellyfinUserId" TEXT NOT NULL,
    "jellyfinItemId" TEXT NOT NULL,
    "mediaId" TEXT,
    "playSessionId" TEXT,
    "sessionId" TEXT,
    "notificationType" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "lastProgressAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "progressPercent" DOUBLE PRECISION,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "clientName" TEXT,
    "deviceName" TEXT,
    "rawHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaybackSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "successRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaMapping" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "verifiedByUser" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_jellyfinUserId_key" ON "User"("jellyfinUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Settings_key_key" ON "Settings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Media_jellyfinItemId_key" ON "Media"("jellyfinItemId");

-- CreateIndex
CREATE INDEX "Media_jellyfinItemId_idx" ON "Media"("jellyfinItemId");

-- CreateIndex
CREATE INDEX "Media_tmdbId_idx" ON "Media"("tmdbId");

-- CreateIndex
CREATE INDEX "Media_imdbId_idx" ON "Media"("imdbId");

-- CreateIndex
CREATE INDEX "Media_type_title_idx" ON "Media"("type", "title");

-- CreateIndex
CREATE INDEX "WatchEvent_userId_watchedAt_idx" ON "WatchEvent"("userId", "watchedAt");

-- CreateIndex
CREATE INDEX "WatchEvent_mediaId_watchedAt_idx" ON "WatchEvent"("mediaId", "watchedAt");

-- CreateIndex
CREATE INDEX "WatchEvent_source_idx" ON "WatchEvent"("source");

-- CreateIndex
CREATE INDEX "PlaybackSession_jellyfinItemId_jellyfinUserId_playSessionId_idx" ON "PlaybackSession"("jellyfinItemId", "jellyfinUserId", "playSessionId");

-- CreateIndex
CREATE INDEX "PlaybackSession_sessionId_idx" ON "PlaybackSession"("sessionId");

-- CreateIndex
CREATE INDEX "ImportJob_userId_createdAt_idx" ON "ImportJob"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "MediaMapping_mediaId_idx" ON "MediaMapping"("mediaId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaMapping_source_externalId_key" ON "MediaMapping"("source", "externalId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_parentMediaId_fkey" FOREIGN KEY ("parentMediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchEvent" ADD CONSTRAINT "WatchEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchEvent" ADD CONSTRAINT "WatchEvent_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybackSession" ADD CONSTRAINT "PlaybackSession_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaMapping" ADD CONSTRAINT "MediaMapping_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;
