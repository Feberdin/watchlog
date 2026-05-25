/**
 * Purpose: Store operator settings while masking secrets in API responses.
 * Input/Output: JSON objects are persisted in Settings rows and returned with secret fields hidden.
 * Invariants: API keys and bearer tokens are write-only through public settings endpoints.
 * Debugging: Query Settings rows locally only in trusted environments; production logs must not include values.
 */

import { Prisma, type PrismaClient } from "@prisma/client";

const SECRET_KEYS = new Set(["jellyfinApiKey", "tmdbBearerToken", "jellyseerrApiKey"]);

export async function getSetting<T extends Record<string, unknown>>(
  prisma: PrismaClient,
  key: string,
  defaults: T,
): Promise<T> {
  const row = await prisma.settings.findUnique({ where: { key } });
  return { ...defaults, ...((row?.valueJson as T | null) ?? {}) };
}

export async function saveSetting<T extends Record<string, unknown>>(
  prisma: PrismaClient,
  key: string,
  value: T,
): Promise<T> {
  await prisma.settings.upsert({
    where: { key },
    update: { valueJson: value as Prisma.InputJsonObject },
    create: { key, valueJson: value as Prisma.InputJsonObject },
  });

  return value;
}

export function maskSettings<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (SECRET_KEYS.has(key) && typeof entry === "string" && entry.length > 0) {
        return [key, "********"];
      }

      return [key, entry];
    }),
  ) as T;
}
