/**
 * Purpose: Keep HTTP request logs useful while removing secrets before Pino writes them.
 * Input/Output: Fastify request data becomes a small, structured, secret-free log object.
 * Invariants: Authentication headers, cookies, and sensitive query parameters must never be logged as raw values.
 * Debugging: Add a unit test here first when a new endpoint accepts credentials in query parameters.
 */

import type { FastifyRequest } from "fastify";

const REDACTED_VALUE = "redacted";

type SanitizedRequestLog = {
  method?: string;
  url: string;
  hostname?: string;
  remoteAddress?: string;
  remotePort?: number;
};

// These names cover current webhook/query credentials and common future integration variants.
const SENSITIVE_QUERY_KEYS = new Set([
  "accesskey",
  "accesstoken",
  "apikey",
  "api-key",
  "authorization",
  "auth",
  "code",
  "cookie",
  "jwt",
  "password",
  "secret",
  "session",
  "token",
]);

function isSensitiveQueryKey(key: string): boolean {
  const normalizedKey = key.toLowerCase();
  const compactKey = normalizedKey.replace(/[-_]/g, "");

  return SENSITIVE_QUERY_KEYS.has(normalizedKey) || SENSITIVE_QUERY_KEYS.has(compactKey);
}

export function sanitizeRequestUrlForLog(url: string | undefined): string | undefined {
  if (!url) {
    return url;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url, "http://watchlog.local");
  } catch {
    const queryStart = url.indexOf("?");
    return queryStart >= 0 ? `${url.slice(0, queryStart)}?${REDACTED_VALUE}` : url;
  }

  for (const key of Array.from(parsedUrl.searchParams.keys())) {
    if (isSensitiveQueryKey(key)) {
      parsedUrl.searchParams.set(key, REDACTED_VALUE);
    }
  }

  return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
}

export function sanitizeRequestForLog(request: FastifyRequest): SanitizedRequestLog {
  const sanitizedRequest: SanitizedRequestLog = {
    method: request.method,
    url: sanitizeRequestUrlForLog(request.url) ?? "",
    hostname: request.hostname,
    remoteAddress: request.ip,
  };

  if (request.socket.remotePort !== undefined) {
    sanitizedRequest.remotePort = request.socket.remotePort;
  }

  return sanitizedRequest;
}
