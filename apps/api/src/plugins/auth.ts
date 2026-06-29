/**
 * Purpose: Fastify auth helpers for session cookies and protected routes.
 * Input/Output: Reads a cookie, loads the session user, and decorates requests.
 * Invariants: Session tokens are stored only as hashes; cookies are HTTP-only.
 * Debugging: Use LOG_LEVEL=debug and inspect 401 responses for missing or expired cookies.
 */

import fp from "fastify-plugin";
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { SESSION_COOKIE_NAME } from "@watchlog/shared";
import type { User } from "@prisma/client";
import { sha256 } from "../utils/crypto.js";

declare module "fastify" {
  interface FastifyRequest {
    currentUser: User | null;
    requireUser: () => User;
  }
}

type AuthPluginOptions = {
  secureCookies: boolean;
};

export const authPlugin: FastifyPluginAsync<AuthPluginOptions> = fp(async (app: FastifyInstance, options: AuthPluginOptions) => {
  app.decorateRequest("currentUser", null);
  app.decorateRequest("requireUser", function requireUser(this: FastifyRequest) {
    if (!this.currentUser) {
      throw app.httpErrors.unauthorized("Bitte zuerst anmelden.");
    }

    return this.currentUser;
  });

  app.addHook("preHandler", async (request: FastifyRequest) => {
    const rawToken = request.cookies[SESSION_COOKIE_NAME];
    request.currentUser = null;
    const isProtectedApiRequest =
      request.url.startsWith("/api/") &&
      !request.url.startsWith("/api/auth/login") &&
      !request.url.startsWith("/api/auth/register") &&
      !request.url.startsWith("/api/health") &&
      !request.url.startsWith("/api/readyz") &&
      !request.url.startsWith("/api/heimdall/") &&
      !request.url.startsWith("/api/webhooks/");

    if (!rawToken) {
      if (isProtectedApiRequest) {
        request.log.info({ path: request.url }, "No session cookie received for protected API request.");
      }
      return;
    }

    const unsigned = request.unsignCookie(rawToken);
    if (!unsigned.valid) {
      request.log.warn({ path: request.url }, "Ignoring invalid session cookie signature.");
      return;
    }

    const token = unsigned.value;

    const session = await app.prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });

    if (!session || session.expiresAt < new Date()) {
      if (isProtectedApiRequest) {
        request.log.info({ path: request.url }, "Session cookie did not match an active session.");
      }
      return;
    }

    request.currentUser = session.user;
  });

  app.decorate("setSessionCookie", (reply: FastifyReply, token: string) => {
    reply.header("cache-control", "no-store");
    reply.setCookie(SESSION_COOKIE_NAME, token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: options.secureCookies,
      signed: true,
      maxAge: 60 * 60 * 24 * 30,
    });
  });

  app.decorate("clearSessionCookie", (reply: FastifyReply) => {
    reply.header("cache-control", "no-store");
    reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
  });
});

declare module "fastify" {
  interface FastifyInstance {
    setSessionCookie: (reply: FastifyReply, token: string) => void;
    clearSessionCookie: (reply: FastifyReply) => void;
  }
}
