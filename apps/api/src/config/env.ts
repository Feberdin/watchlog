/**
 * Purpose: Validate and normalize WatchLog environment variables before the server starts.
 * Input/Output: Reads process.env and outputs a typed config object.
 * Invariants: Missing critical secrets fail fast in production-like environments.
 * Debugging: Startup errors name the exact variable and suggested fix.
 */

import { z } from "zod";
import { BUILD_COMMIT } from "../generated/buildInfo.js";

// Why this exists:
// Docker Compose injects every environment value as a string. `z.coerce.boolean()`
// treats any non-empty string, including "false", as true because it follows
// JavaScript's Boolean() rules. For security flags that would silently enable
// behavior the operator explicitly disabled.
const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return false;
    }

    if (typeof value === "boolean") {
      return value;
    }

    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", "off", ""].includes(normalized)) {
      return false;
    }

    throw new Error(`Boolean-Wert '${value}' ist ungueltig. Erlaubt sind true/false, 1/0, yes/no oder on/off.`);
  });

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  APP_COMMIT: z.string().min(1).default(BUILD_COMMIT),
  APP_URL: z.string().url().default("http://localhost:8111"),
  APP_PORT: z.coerce.number().int().min(1).max(65535).default(8111),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET muss mindestens 16 Zeichen lang sein."),
  WEBHOOK_SECRET: z.string().min(8, "WEBHOOK_SECRET muss mindestens 8 Zeichen lang sein."),
  JELLYFIN_URL: z.string().optional().default(""),
  JELLYFIN_API_KEY: z.string().optional().default(""),
  JELLYSEERR_URL: z.string().optional().default(""),
  JELLYSEERR_API_KEY: z.string().optional().default(""),
  TMDB_BEARER_TOKEN: z.string().optional().default(""),
  REGISTRATION_ENABLED: booleanFromEnv,
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),
  SECURE_COOKIES: booleanFromEnv,
  CACHE_DIR: z.string().min(1).default("/cache"),
  TZ: z.string().default("Europe/Berlin"),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(input);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Ungueltige WatchLog-Konfiguration: ${details}. Bitte .env pruefen.`);
  }

  return parsed.data;
}
