/**
 * Purpose: Small API client for WatchLog's browser UI.
 * Input/Output: Typed helper functions send JSON requests and return parsed JSON.
 * Invariants: Credentials are included so HTTP-only session cookies work.
 * Debugging: Browser Network tab shows failed requests and API validation messages.
 */

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const response = await fetch(path, {
    ...options,
    cache: "no-store",
    credentials: "include",
    headers: isFormData
      ? { ...(options.headers ?? {}) }
      : {
        "content-type": "application/json",
        ...(options.headers ?? {}),
      },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(body.message ?? "API-Anfrage fehlgeschlagen.");
  }

  return response.json() as Promise<T>;
}
