/**
 * Purpose: Hash session tokens and payload snapshots without storing raw secrets.
 * Input/Output: Plain strings become SHA-256 hex digests.
 * Invariants: Hashing is one-way and never used as encryption.
 * Debugging: Compare hashes only for equality; original values cannot be recovered.
 */

import { createHash } from "node:crypto";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function maskSecret(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  if (value.length <= 6) {
    return "***";
  }

  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}
