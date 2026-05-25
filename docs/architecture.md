# Architecture

Purpose: Explain how WatchLog is structured and why the boundaries exist.
Input/Output: Developers read this before changing services; it outputs shared mental models.
Invariants: The API owns data integrity, the web UI owns presentation, shared validators define cross-package contracts.
Debugging: Start with API logs, then database rows, then browser network requests.

## Components

- `apps/api`: Fastify HTTP API, Prisma persistence, webhook processing, auth, import/export, and external clients.
- `apps/web`: React/Vite single-page UI served by the API container in production.
- `packages/shared`: TypeScript types, constants, and Zod validators shared between API and web.
- `docs`: Operator documentation for Docker, Unraid, Jellyfin, security, and API usage.

## Data Flow

1. Jellyfin sends a webhook to `/api/webhooks/jellyfin` with a shared secret.
2. The parser normalizes booleans, empty strings, timestamps, ticks, and media type names.
3. The service upserts media records and updates playback session state.
4. A WatchEvent is created when completion is explicit or progress crosses the configured threshold.
5. Duplicate stops within the dedupe window are ignored, while later genuine rewatches create a new WatchEvent.
6. The React UI reads timeline and dashboard data from authenticated API routes.

## Decision Notes

- Fastify is used because it is small, explicit, and a good fit for a self-hosted container.
- Prisma keeps migrations and schema readable for maintainers who are not database specialists.
- MIT is used initially to reduce adoption friction. AGPL-3.0 is a valid future choice if hosted-service reciprocity becomes important.
- Sessions use HTTP-only cookies so tokens are not exposed to browser JavaScript.
