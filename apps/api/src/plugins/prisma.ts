/**
 * Purpose: Attach Prisma to Fastify so routes and tests use the same access pattern.
 * Input/Output: Decorates Fastify with `app.prisma`.
 * Invariants: The client is disconnected during app shutdown.
 * Debugging: If route code cannot access `app.prisma`, verify this plugin is registered first.
 */

import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db/prisma.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export const prismaPlugin: FastifyPluginAsync = fp(async (app) => {
  app.decorate("prisma", prisma);
  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });
});
