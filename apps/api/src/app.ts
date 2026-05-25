/**
 * Purpose: Build the Fastify application with plugins, routes, and production static serving.
 * Input/Output: Environment config becomes a ready-to-listen Fastify instance.
 * Invariants: Register Prisma before routes, auth before protected handlers, and error handling before listen.
 * Debugging: Use `npm run dev -w @watchlog/api` and inspect structured logs.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import formbody from "@fastify/formbody";
import multipart from "@fastify/multipart";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import staticPlugin from "@fastify/static";
import { ZodError } from "zod";
import type { AppEnv } from "./config/env.js";
import { prismaPlugin } from "./plugins/prisma.js";
import { authPlugin } from "./plugins/auth.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { mediaRoutes } from "./routes/media.js";
import { watchEventRoutes } from "./routes/watchEvents.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { settingsRoutes } from "./routes/settings.js";
import { exportRoutes } from "./routes/export.js";
import { importRoutes } from "./routes/import.js";
import { metadataRoutes } from "./routes/metadata.js";
import { seriesRoutes } from "./routes/series.js";
import { swipeRoutes } from "./routes/swipe.js";
import { seedIntegrationSettingsFromEnv } from "./services/envSettings.js";

function isAllowedBrowserOrigin(origin: string, env: AppEnv): boolean {
  const configuredOrigins = new Set([
    env.APP_URL,
    `http://localhost:${env.APP_PORT}`,
    `http://127.0.0.1:${env.APP_PORT}`,
  ]);

  if (configuredOrigins.has(origin)) {
    return true;
  }

  try {
    const parsedOrigin = new URL(origin);
    const isExpectedPort = parsedOrigin.port === String(env.APP_PORT);
    const isPrivateHost =
      parsedOrigin.hostname === "localhost" ||
      parsedOrigin.hostname === "127.0.0.1" ||
      parsedOrigin.hostname.startsWith("192.168.") ||
      parsedOrigin.hostname.startsWith("10.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(parsedOrigin.hostname);

    return isExpectedPort && isPrivateHost;
  } catch {
    return false;
  }
}

export async function buildApp(env: AppEnv) {
  const app = fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: ["req.headers.authorization", "req.headers.cookie", "body.password", "body.jellyfinApiKey", "body.tmdbBearerToken", "body.jellyseerrApiKey"],
    },
  });

  await app.register(sensible);
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(cors, {
    credentials: true,
    origin(origin, callback) {
      if (!origin || isAllowedBrowserOrigin(origin, env)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin not allowed by WatchLog CORS policy."), false);
    },
  });
  await app.register(formbody);
  await app.register(multipart);
  await app.register(swagger, {
    openapi: {
      info: { title: "WatchLog API", version: "0.1.0" },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/api/docs" });
  await app.register(prismaPlugin);
  await seedIntegrationSettingsFromEnv(app.prisma, env);
  await app.register(authPlugin, { secureCookies: env.SECURE_COOKIES || env.APP_URL.startsWith("https://") });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      reply.status(400).send({
        error: "ValidationError",
        message: "Eingabe ist ungueltig. Bitte markierte Felder pruefen.",
        details: error.issues,
      });
      return;
    }

    request.log.error({
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    }, "Request failed");
    const statusCode = "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
    reply.status(statusCode).send({
      error: error.name,
      message: error.message,
    });
  });

  await app.register(async (api) => {
    await api.register(healthRoutes);
    await api.register(authRoutes, { registrationEnabled: env.REGISTRATION_ENABLED });
    await api.register(webhookRoutes, { webhookSecret: env.WEBHOOK_SECRET });
    await api.register(mediaRoutes);
    await api.register(watchEventRoutes);
    await api.register(dashboardRoutes);
    await api.register(settingsRoutes);
    await api.register(exportRoutes);
    await api.register(importRoutes);
    await api.register(metadataRoutes);
    await api.register(seriesRoutes);
    await api.register(swipeRoutes);
  }, { prefix: "/api" });

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const webDist = path.resolve(__dirname, "../web");
  const hasWebBuild = existsSync(path.join(webDist, "index.html"));
  if (hasWebBuild) {
    await app.register(staticPlugin, {
      root: webDist,
      prefix: "/",
      setHeaders(response, filePath) {
        if (filePath.endsWith("index.html")) {
          response.setHeader("cache-control", "no-store");
        }
      },
    });
  }

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      reply.status(404).send({ error: "NotFound", message: "API-Endpunkt nicht gefunden." });
      return;
    }

    if (hasWebBuild) {
      reply.header("cache-control", "no-store");
      reply.sendFile("index.html");
      return;
    }

    reply.status(404).send({
      error: "WebBuildMissing",
      message: "Web-Build nicht gefunden. In Entwicklung bitte `npm run dev -w @watchlog/web` starten.",
    });
  });

  return app;
}
