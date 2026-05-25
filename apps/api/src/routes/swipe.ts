/**
 * Purpose: HTTP API for the swipe queue and explicit media decisions.
 * Input/Output: Browser clients fetch candidate cards and submit seen/skip/want actions.
 * Invariants: Every route requires an authenticated user; external actions are never automatic.
 * Debugging: Validation errors usually mean an invalid mediaId/action; integration errors name the missing service.
 */

import type { FastifyPluginAsync } from "fastify";
import { swipeActionSchema, swipeCandidateQuerySchema } from "@watchlog/shared";
import { applySwipeAction, listSwipeCandidates, listSwipeHistory } from "../services/swipe.js";

export const swipeRoutes: FastifyPluginAsync = async (app) => {
  app.get("/swipe/candidates", async (request) => {
    const user = request.requireUser();
    const input = swipeCandidateQuerySchema.parse(request.query);
    return listSwipeCandidates(app.prisma, user.id, input);
  });

  app.post("/swipe/action", async (request) => {
    const user = request.requireUser();
    const input = swipeActionSchema.parse(request.body);
    return applySwipeAction(app.prisma, user, input.mediaId, input.action);
  });

  app.get("/swipe/history", async (request) => {
    const user = request.requireUser();
    return listSwipeHistory(app.prisma, user.id);
  });
};
