/**
 * Purpose: Own the Prisma client singleton used by API services.
 * Input/Output: Imports receive a connected PrismaClient instance on demand.
 * Invariants: One process should reuse one client to avoid connection churn.
 * Debugging: Health checks call `$queryRaw` to expose database connectivity failures.
 */

import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
