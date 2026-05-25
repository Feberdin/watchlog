/**
 * Purpose: Local registration, login, logout, and current-user API.
 * Input/Output: JSON credentials produce a server-side session and HTTP-only cookie.
 * Invariants: Registration is limited to first admin unless enabled by env; passwords are Argon2id hashes.
 * Debugging: 401 means bad credentials or missing cookie; 403 means registration is intentionally closed.
 */

import { randomBytes } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import argon2 from "argon2";
import { loginSchema, registerSchema, SESSION_COOKIE_NAME } from "@watchlog/shared";
import { sha256 } from "../utils/crypto.js";

export const authRoutes: FastifyPluginAsync<{ registrationEnabled: boolean }> = async (app, options) => {
  app.post("/auth/register", async (request, reply) => {
    const input = registerSchema.parse(request.body);
    const userCount = await app.prisma.user.count();
    const registrationAllowed = userCount === 0 || options.registrationEnabled;

    if (!registrationAllowed) {
      throw app.httpErrors.forbidden("Registrierung ist deaktiviert. Bitte Admin um Einladung bitten.");
    }

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const user = await app.prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        displayName: input.displayName,
        passwordHash,
        role: userCount === 0 ? "admin" : "user",
        jellyfinUserId: input.jellyfinUserId ?? null,
      },
    });

    const token = randomBytes(32).toString("base64url");
    await app.prisma.session.create({
      data: {
        tokenHash: sha256(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    app.setSessionCookie(reply, token);

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      jellyfinUserId: user.jellyfinUserId,
    };
  });

  app.post("/auth/login", async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const user = await app.prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });

    if (!user || !(await argon2.verify(user.passwordHash, input.password))) {
      throw app.httpErrors.unauthorized("E-Mail oder Passwort ist falsch.");
    }

    const token = randomBytes(32).toString("base64url");
    await app.prisma.session.create({
      data: {
        tokenHash: sha256(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    app.setSessionCookie(reply, token);

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      jellyfinUserId: user.jellyfinUserId,
    };
  });

  app.post("/auth/logout", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    if (token) {
      await app.prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
    }

    app.clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/auth/me", async (request) => {
    const user = request.requireUser();
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      jellyfinUserId: user.jellyfinUserId,
    };
  });
};
