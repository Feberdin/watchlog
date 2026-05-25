# WatchLog Development Plan

Purpose: This file keeps implementation scope visible for maintainers and non-programmers.
Input/Output: Maintainers update it when MVP scope changes; it outputs a shared checklist.
Invariants: Prefer correctness, readability, and safe defaults before feature breadth.
Debugging: If work feels unclear, compare the current code with the checklist below.

## MVP Iteration 1

1. Create the npm workspace structure for API, web UI, and shared validation.
2. Define the Prisma schema for users, settings, media, watch events, playback sessions, imports, and mappings.
3. Build Fastify with health checks, local auth, protected routes, and safe logging.
4. Implement a tolerant Jellyfin webhook parser that does not assume every plugin variable exists.
5. Create WatchEvent logic for threshold completion, duplicate suppression, and rewatch indexing.
6. Add a small React UI for first admin setup/login, dashboard metrics, timeline, and manual watch entry.
7. Add Docker Compose for PostgreSQL and a multi-stage Dockerfile for the app.
8. Document Docker, Unraid, Jellyfin webhook setup, security, and import/export.
9. Add focused tests around parser, auth, and WatchEvent behavior.
10. Run typecheck, lint, tests, and document any limitations.

## Known Risks

- Jellyfin Webhook Plugin variables vary by version and template. Parser code must accept missing fields.
- Back-sync to Jellyfin is security-sensitive and stays explicit/manual.
- SQLite is useful for local development, but PostgreSQL remains the production target.
- TMDb calls need rate-limit-friendly caching; the MVP includes a client and search endpoint, not a full background enrichment worker.

## Later Iterations

- Full TMDb enrichment worker and image cache.
- CSV import UI with row-level preview.
- Jellyfin library scan and item reconciliation.
- OIDC support for Authelia/Authentik.
- Complete i18n and richer statistics.

## Validation Log

- 2026-05-25: `npm run typecheck` passed.
- 2026-05-25: `npm run lint` passed.
- 2026-05-25: `npm test` passed with 7 API tests.
- 2026-05-25: `npm run build` passed for shared, web, and API packages.
- 2026-05-25: `npm install` reported 11 npm audit findings in dependencies/transitives; these need dependency review before a hardened release.
- 2026-05-25: Initial PostgreSQL migration added; Docker runtime now uses `prisma migrate deploy`.
