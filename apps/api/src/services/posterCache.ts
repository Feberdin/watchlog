/**
 * Purpose: Cache known remote poster URLs as small WebP files for dashboard-heavy views.
 * Input/Output: A Media row with a trusted posterUrl becomes an optimized local WebP buffer.
 * Invariants: This is not an open proxy; only URLs already stored for a Media row and from allowed hosts are fetched.
 * Debugging: Check `/cache/posters`, HTTP status errors, and LOG_LEVEL=debug when posters do not appear.
 */

import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const POSTER_MAX_BYTES = 8 * 1024 * 1024;
const POSTER_TIMEOUT_MS = 10_000;
const CACHEABLE_HOSTS = new Set([
  "image.tmdb.org",
  "www.themoviedb.org",
]);

export function isCacheablePosterUrl(value: string | null | undefined): value is string {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" && CACHEABLE_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function cachePath(cacheDir: string, posterUrl: string) {
  const hash = crypto.createHash("sha256").update(posterUrl).digest("hex");
  return path.join(cacheDir, "posters", `${hash}.webp`);
}

async function fetchPosterBytes(posterUrl: string): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), POSTER_TIMEOUT_MS);

  try {
    const response = await fetch(posterUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Poster konnte nicht geladen werden: HTTP ${response.status}.`);
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > POSTER_MAX_BYTES) {
      throw new Error("Poster ist groesser als das erlaubte Cache-Limit.");
    }

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > POSTER_MAX_BYTES) {
      throw new Error("Poster ist groesser als das erlaubte Cache-Limit.");
    }

    return bytes;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getCachedPoster(cacheDir: string, posterUrl: string): Promise<Buffer> {
  if (!isCacheablePosterUrl(posterUrl)) {
    throw new Error("Poster-URL wird nicht gecacht, weil sie nicht von einer erlaubten Bildquelle stammt.");
  }

  const targetPath = cachePath(cacheDir, posterUrl);
  const existing = await readFile(targetPath).catch(() => null);
  if (existing) {
    return existing;
  }

  const raw = await fetchPosterBytes(posterUrl);
  const optimized = await sharp(Buffer.from(raw))
    .resize({ width: 360, height: 540, fit: "cover", withoutEnlargement: true })
    .webp({ quality: 72, effort: 4 })
    .toBuffer();

  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, optimized, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") {
      throw error;
    }
  });

  return readFile(targetPath);
}
