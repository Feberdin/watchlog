/**
 * Purpose: Validate Docker Compose operability settings that the Unraid Deployment Broker inspects.
 * Input/Output: Compose/Dockerfile text becomes assertions for health, privileges, and log rotation.
 * Invariants: Long-running services are monitorable; the API is non-root; helper privileges stay bounded.
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
  user?: string;
  command?: string[];
  read_only?: boolean;
  cap_drop?: string[];
  cap_add?: string[];
  security_opt?: string[];
  depends_on?: Record<string, { condition?: string }>;
  logging?: {
    driver?: string;
    options?: Record<string, string>;
  };
};

type ComposeNetwork = {
  driver?: string;
  ipam?: {
    config?: Array<{
      subnet?: string;
      gateway?: string;
    }>;
  };
};

function loadCompose(fileName: string) {
  const filePath = resolve(process.cwd(), "../../", fileName);
  return parse(readFileSync(filePath, "utf8")) as {
    services: Record<string, ComposeService>;
    networks?: Record<string, ComposeNetwork>;
  };
}

describe("Compose operability settings", () => {
  for (const fileName of composeFiles) {
    it(`${fileName} defines healthchecks, restart policy, and bounded logs`, () => {
      const compose = loadCompose(fileName);

      for (const serviceName of ["db", "watchlog"]) {
        const service = compose.services[serviceName];
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

    it(`${fileName} constrains the one-shot volume ownership helper`, () => {
      const compose = loadCompose(fileName);
      const helper = compose.services["watchlog-permissions"];

      expect(helper).toMatchObject({
        restart: "no",
        healthcheck: { disable: true },
        user: "0:0",
        read_only: true,
        cap_drop: ["ALL"],
        cap_add: ["CHOWN", "DAC_OVERRIDE", "FOWNER"],
        security_opt: ["no-new-privileges:true"],
      });
      expect(helper.command?.join(" ")).toContain("chown -R 1000:1000 /config /cache");
      expect(helper.logging).toMatchObject({
        driver: "json-file",
        options: {
          "max-size": "10m",
          "max-file": "3",
        },
      });
      expect(compose.services.watchlog?.depends_on?.["watchlog-permissions"]?.condition)
        .toBe("service_completed_successfully");
    });
  }

  it("docker-compose.broker.yml pins the Docker bridge subnet to the allowed broker pool", () => {
    const compose = loadCompose("docker-compose.broker.yml");

    expect(compose.networks?.default).toMatchObject({
      driver: "bridge",
      ipam: {
        config: [
          {
            subnet: "10.200.4.0/24",
            gateway: "10.200.4.1",
          },
        ],
      },
    });
  });

  it("the runtime image has a readiness healthcheck and runs as the node user", () => {
    const dockerfilePath = resolve(process.cwd(), "../../Dockerfile");
    const dockerfile = readFileSync(dockerfilePath, "utf8");

    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain("/readyz");
    expect(dockerfile).toMatch(/\nUSER node\n/);
  });
});
