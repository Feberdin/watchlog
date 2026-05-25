/**
 * Purpose: Validate and normalize WatchLog environment variables before the server starts.
 * Input/Output: Reads process.env and outputs a typed config object.
 * Invariants: Missing critical secrets fail fast in production-like environments.
 * Debugging: Startup errors name the exact variable and suggested fix.
 */

import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  APP_URL: z.string().url().default("http://localhost:8111"),
  APP_PORT: z.coerce.number().int().min(1).max(65535).default(8111),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET muss mindestens 16 Zeichen lang sein."),
  WEBHOOK_SECRET: z.string().min(8, "WEBHOOK_SECRET muss mindestens 8 Zeichen lang sein."),
  JELLYFIN_URL: z.string().optional().default(""),
  JELLYFIN_API_KEY: z.string().optional().default(""),
  TMDB_BEARER_TOKEN: z.string().optional().default(""),
  REGISTRATION_ENABLED: z.coerce.boolean().default(false),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),
  SECURE_COOKIES: z.coerce.boolean().default(false),
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
