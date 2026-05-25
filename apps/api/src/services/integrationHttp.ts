/**
 * Purpose: Shared HTTP helpers for self-hosted integration clients.
 * Input/Output: Validated base URLs and fetch responses become typed JSON or clear errors.
 * Invariants: External calls use short timeouts and never include secrets in thrown messages.
 * Debugging: Connection errors name the target service and URL origin, not API keys or tokens.
 */

export function normalizeBaseUrl(rawUrl: string, serviceName: string): string {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${serviceName}: URL ist ungueltig. Bitte inklusive http:// oder https:// eintragen.`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${serviceName}: Nur http:// und https:// URLs sind erlaubt.`);
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export async function fetchJson<T>(
  serviceName: string,
  url: string,
  options: RequestInit = {},
  timeoutMs = 8000,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(options.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(`${serviceName}: HTTP ${response.status} von ${new URL(url).origin}. Bitte URL und API-Key pruefen.`);
    }

    return await response.json() as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${serviceName}: Zeitueberschreitung beim Verbindungsaufbau. Bitte Netzwerk und Container-Erreichbarkeit pruefen.`);
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error(`${serviceName}: Unerwarteter Fehler beim HTTP-Aufruf.`);
  } finally {
    clearTimeout(timeout);
  }
}
