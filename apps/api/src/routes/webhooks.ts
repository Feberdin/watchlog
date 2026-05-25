/**
 * Purpose: Secure Jellyfin webhook receiver.
 * Input/Output: POST /api/webhooks/jellyfin accepts plugin JSON and may create WatchEvents.
 * Invariants: Shared secret is required; invalid payloads fail fast; raw secrets are never logged.
 * Debugging: Use docs/webhook-template.md and compare parser errors against template fields.
 */

import type { FastifyPluginAsync } from "fastify";
import { parseJellyfinWebhook } from "../webhooks/jellyfinParser.js";
import { handleJellyfinWebhookEvent } from "../services/watchEvents.js";

export const webhookRoutes: FastifyPluginAsync<{ webhookSecret: string }> = async (app, options) => {
  app.post("/webhooks/jellyfin", async (request, reply) => {
    const headerSecret = request.headers["x-watchlog-webhook-secret"];
    const querySecret = typeof request.query === "object" && request.query
      ? (request.query as { secret?: string }).secret
      : undefined;
    const providedSecret = Array.isArray(headerSecret) ? headerSecret[0] : headerSecret ?? querySecret;

    if (providedSecret !== options.webhookSecret) {
      throw app.httpErrors.unauthorized("Webhook-Secret ist ungueltig.");
    }

    const parsed = parseJellyfinWebhook(request.body);
    const result = await handleJellyfinWebhookEvent(app.prisma, parsed);
    reply.code(result.created ? 201 : 202);

    return {
      ok: true,
      created: result.created,
      ignoredReason: result.ignoredReason ?? null,
      watchEventId: result.watchEvent?.id ?? null,
    };
  });
};
