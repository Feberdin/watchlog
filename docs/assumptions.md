# Assumptions

Purpose: Document decisions made without perfect external certainty.
Input/Output: Project contributors add assumptions here; future work can confirm or replace them.
Invariants: Security-sensitive assumptions must default to deny, skip, or manual confirmation.
Debugging: Check this file when an integration behaves differently in a real Jellyfin installation.

## Runtime

- Node.js 20 or newer is available in development and Docker builds.
- Production deployments use PostgreSQL. SQLite is supported for simple local development through Prisma-compatible code paths.
- The default public port is `8111`.
- Docker Compose v2 is available on Linux servers and Unraid.

## Jellyfin Webhooks

- The Jellyfin Webhook Plugin can send JSON templates with fields such as `NotificationType`, `UserId`, `ItemId`, `ItemType`, `PlaybackPositionTicks`, `RunTimeTicks`, and provider IDs.
- Not every documented or community-template variable is guaranteed in every plugin version. WatchLog treats empty strings as missing values and never requires provider IDs.
- Boolean-like values may arrive as booleans or strings such as `"true"` and `"false"`.
- Tick values are Jellyfin/.NET ticks where 10,000,000 ticks equal one second.

## Security

- `SESSION_SECRET` and `WEBHOOK_SECRET` must be long random values in production.
- API keys and tokens are never returned in plaintext from settings endpoints.
- Jellyfin and TMDb outbound requests are constrained by URL validation; TMDb uses the official API host.
