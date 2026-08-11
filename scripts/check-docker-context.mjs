/**
 * Purpose: Prevent large or host-specific files from entering Docker builds.
 * Input/Output: Reads .dockerignore and fails when a required boundary is absent.
 * Invariants: Local dependencies, generated outputs, VCS data, and env files stay
 * outside the Linux build context.
 * Debugging: Run `npm run test:docker-context`; the error names the missing rule.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dockerignore = await readFile(new URL("../.dockerignore", import.meta.url), "utf8");
const rules = new Set(
  dockerignore
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#")),
);

// Why this exists: these are the paths that made the local repository hundreds
// of megabytes and could overwrite Linux build artifacts with host artifacts.
const requiredRules = [
  ".git",
  ".env",
  ".env.*",
  "node_modules",
  "**/node_modules",
  "dist",
  "**/dist",
  "coverage",
  "**/coverage",
];

for (const requiredRule of requiredRules) {
  assert.ok(rules.has(requiredRule), `.dockerignore: missing required rule ${requiredRule}`);
}

console.log(`Validated ${requiredRules.length} required Docker context exclusions.`);
