/**
 * Purpose: Guard WatchLog Compose files against accidentally building the same
 * application image once per service.
 * Input/Output: Reads the three tracked Compose variants and exits successfully
 * only when the app is built once and the permissions helper reuses that image.
 * Invariants: No environment values or secrets are resolved or printed.
 * Debugging: Run `npm run test:compose`; the error names the file and violated
 * image/build invariant.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

const composeFiles = [
  "docker-compose.yml",
  "docker-compose.unraid.example.yml",
  "docker-compose.broker.yml",
];

// Why this exists: Compose treats separate build definitions as separate build
// targets, even when their contexts match. On slower hosts that doubled build can
// exceed the broker's bounded deployment timeout.
for (const composeFile of composeFiles) {
  const source = await readFile(new URL(`../${composeFile}`, import.meta.url), "utf8");
  const compose = parse(source);
  const services = compose?.services;

  assert.ok(services, `${composeFile}: services must be defined`);

  const app = services.watchlog;
  const permissions = services["watchlog-permissions"];
  assert.ok(app, `${composeFile}: watchlog service is missing`);
  assert.ok(permissions, `${composeFile}: watchlog-permissions service is missing`);
  assert.ok(app.build, `${composeFile}: watchlog must own the single image build`);
  assert.equal(
    permissions.build,
    undefined,
    `${composeFile}: watchlog-permissions must reuse the app image instead of rebuilding it`,
  );
  assert.equal(
    permissions.image,
    app.image,
    `${composeFile}: watchlog and watchlog-permissions must use the same image`,
  );
  assert.equal(
    permissions.pull_policy,
    "never",
    `${composeFile}: the local helper image must not be pulled from a registry`,
  );

  const buildCount = Object.values(services).filter((service) => service?.build).length;
  assert.equal(buildCount, 1, `${composeFile}: expected exactly one service build, got ${buildCount}`);
}

console.log(`Validated single-build image reuse in ${composeFiles.length} Compose files.`);
