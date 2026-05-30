/**
 * Purpose: Small display helpers for repeated media metadata such as genres and cast names.
 * Input/Output: API arrays become compact German labels for rows, filters, and poster overlays.
 * Invariants: Empty arrays stay null so UI elements do not render noisy placeholders.
 * Debugging: If a genre/filter is missing, inspect the API response array before this formatter.
 */

export function metadataLabel(values: string[] | null | undefined, limit = 3): string | null {
  const unique = (values ?? [])
    .map((value) => value.trim())
    .filter((value, index, all) => value.length > 0 && all.findIndex((candidate) => candidate.toLocaleLowerCase("de-DE") === value.toLocaleLowerCase("de-DE")) === index);
  const compact = unique.slice(0, limit);

  if (compact.length === 0) {
    return null;
  }

  const remaining = Math.max(0, unique.length - compact.length);
  return remaining > 0 ? `${compact.join(", ")} +${remaining}` : compact.join(", ");
}

export function genreLabel(values: string[] | null | undefined, limit = 3): string | null {
  const label = metadataLabel(values, limit);
  return label ? `Genre: ${label}` : null;
}

export function castLabel(values: string[] | null | undefined, limit = 4): string | null {
  const label = metadataLabel(values, limit);
  return label ? `Cast: ${label}` : null;
}

export function genreOptions<T extends { genres?: string[] }>(items: T[]): string[] {
  const byName = new Map<string, string>();
  for (const item of items) {
    for (const genre of item.genres ?? []) {
      const normalized = genre.trim();
      if (!normalized) continue;
      byName.set(normalized.toLocaleLowerCase("de-DE"), normalized);
    }
  }

  return [...byName.values()].sort((left, right) => left.localeCompare(right, "de"));
}
