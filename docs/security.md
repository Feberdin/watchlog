# Security

Purpose: Capture the security model and operational expectations.
Input/Output: Operators use this to configure WatchLog safely.
Invariants: No telemetry, no secret logging, and no automatic back-sync without explicit user action.
Debugging: Use `LOG_LEVEL=debug`, but never paste logs publicly without checking for hostnames and user identifiers.

## Authentication

- Passwords are hashed with Argon2id.
- Sessions are stored server-side in the database and referenced by HTTP-only cookies.
- Registration is allowed only before the first admin exists, unless `REGISTRATION_ENABLED=true`.

## Webhooks

- `/api/webhooks/jellyfin` requires `X-WatchLog-Webhook-Secret` or `?secret=...`.
- Failed webhook authentication returns `401`.
- Secrets are masked in logs and never persisted in raw webhook payloads.

## External Requests

- Jellyfin base URLs are validated to avoid malformed input.
- TMDb calls use `https://api.themoviedb.org`.
- Back-sync to Jellyfin is manual and disabled unless configured.

## Secrets

Use long random values for:

```bash
SESSION_SECRET
WEBHOOK_SECRET
JELLYFIN_API_KEY
TMDB_BEARER_TOKEN
```

## Broker Secret Names

GitOps deployment references these values by name only:

- `secret://WATCHLOG_POSTGRES_PASSWORD`
- `secret://WATCHLOG_DATABASE_URL`
- `secret://WATCHLOG_SESSION_SECRET`
- `secret://WATCHLOG_WEBHOOK_SECRET`
- `secret://WATCHLOG_JELLYFIN_API_KEY` optional
- `secret://WATCHLOG_TMDB_BEARER_TOKEN` optional
