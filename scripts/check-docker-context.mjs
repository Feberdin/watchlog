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
  "*.tsbuildinfo",
  "**/*.tsbuildinfo",
];

for (const requiredRule of requiredRules) {
  assert.ok(rules.has(requiredRule), `.dockerignore: missing required rule ${requiredRule}`);
}

console.log(`Validated ${requiredRules.length} required Docker context exclusions.`);

// Why this exists: recursive ownership changes over node_modules made the
// classic Unraid builder exceed the Broker timeout even with a small context.
const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
assert.match(dockerfile, /RUN npm prune --omit=dev/u, "Dockerfile: production dependencies must be pruned");
assert.doesNotMatch(dockerfile, /COPY --chown/u, "Dockerfile: immutable files must not be recursively re-owned");
assert.doesNotMatch(
  dockerfile,
  /chown[^\n]*\/app/u,
  "Dockerfile: immutable /app content must not be recursively re-owned",
);
assert.match(
  dockerfile,
  /chown -R node:node \/cache \/config/u,
  "Dockerfile: writable runtime directories must belong to the node user",
);

console.log("Validated bounded production image ownership and dependency rules.");
