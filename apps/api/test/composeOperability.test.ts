/**
 * Purpose: Validate Docker Compose operability settings that the Unraid Deployment Broker inspects.
 * Input/Output: Compose YAML files become assertions for healthchecks, restart policy, and log rotation.
 * Invariants: Long-running services must be monitorable and Docker logs must be bounded.
 * Debugging: If this test fails, update every Compose variant, not only the broker file.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const composeFiles = [
  "docker-compose.yml",
  "docker-compose.broker.yml",
  "docker-compose.unraid.example.yml",
];

type ComposeService = {
  restart?: string;
  healthcheck?: unknown;
  logging?: {
    driver?: string;
    options?: Record<string, string>;
  };
};

function loadCompose(fileName: string) {
  const filePath = resolve(process.cwd(), "../../", fileName);
  return parse(readFileSync(filePath, "utf8")) as { services: Record<string, ComposeService> };
}

describe("Compose operability settings", () => {
  for (const fileName of composeFiles) {
    it(`${fileName} defines healthchecks, restart policy, and log rotation`, () => {
      const compose = loadCompose(fileName);

      for (const [serviceName, service] of Object.entries(compose.services)) {
        expect(service.restart, `${fileName}:${serviceName} restart`).toBe("unless-stopped");
        expect(service.healthcheck, `${fileName}:${serviceName} healthcheck`).toBeDefined();
        expect(service.logging, `${fileName}:${serviceName} logging`).toMatchObject({
          driver: "json-file",
          options: {
            "max-size": "10m",
            "max-file": "3",
          },
        });
      }

      expect(JSON.stringify(compose.services.watchlog?.healthcheck)).toContain("/readyz");
    });
  }
});
