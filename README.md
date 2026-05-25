# WatchLog

Purpose: WatchLog is a self-hosted watch history logger for Jellyfin users.
Input/Output: Jellyfin webhooks, manual entries, and later imports become durable WatchEvents in PostgreSQL.
Invariants: No telemetry, no hidden cloud services, no automatic Jellyfin back-sync.
Debugging: Start with `/api/health`, then container logs, then database rows.

## Features in this MVP

- Fastify API with Health, Auth, Jellyfin webhook, Media, WatchEvents, Settings, Dashboard, and CSV/JSON export.
- PostgreSQL via Prisma.
- Local auth with Argon2id password hashing and HTTP-only cookie sessions.
- Secure Jellyfin webhook endpoint with `X-WatchLog-Webhook-Secret` or `?secret=...`.
- Tolerant webhook parser for missing fields, string booleans, empty strings, and Jellyfin ticks.
- Duplicate suppression for repeated PlaybackStop events within 30 minutes.
- Rewatch support through separate WatchEvent rows.
- React/Vite UI with Login/Setup, Dashboard, Timeline, and manual historical entries.
- Docker Compose and Unraid example.

## Quickstart

```bash
cp .env.template .env
# For local Docker without the broker, replace secret:// references with local development values.
docker compose up --build
```

Open `http://localhost:8111`, switch to `Setup`, and create the first admin user.

## Local Development

```bash
npm install
npm run prisma:generate
npm run db:push -w @watchlog/api
npm run dev
```

For local development with PostgreSQL, keep `docker compose up db` running and set `DATABASE_URL` to a local PostgreSQL connection string that matches your local password. Do not commit that value.

## Tests and Quality

```bash
npm run typecheck
npm run lint
npm test
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_URL` | `http://localhost:8111` | Public URL used for CORS/cookies |
| `APP_PORT` | `8111` | Container listen port |
| `DATABASE_URL` | `secret://WATCHLOG_DATABASE_URL` | Prisma database connection |
| `POSTGRES_PASSWORD` | `secret://WATCHLOG_POSTGRES_PASSWORD` | PostgreSQL password |
| `SESSION_SECRET` | `secret://WATCHLOG_SESSION_SECRET` | Cookie/session signing secret |
| `WEBHOOK_SECRET` | `secret://WATCHLOG_WEBHOOK_SECRET` | Jellyfin webhook shared secret |
| `REGISTRATION_ENABLED` | `false` | Allows registration after first admin |
| `LOG_LEVEL` | `info` | `debug` is useful while integrating Jellyfin |
| `SECURE_COOKIES` | `false` | Set `true` behind HTTPS |

## Required Secrets

The Unraid Deployment Broker must provide these secrets:

| Secret | Used by | Notes |
| --- | --- | --- |
| `WATCHLOG_POSTGRES_PASSWORD` | PostgreSQL | Password for database user `watchlog` |
| `WATCHLOG_DATABASE_URL` | WatchLog API | Example shape: `postgresql://watchlog:<password>@db:5432/watchlog` |
| `WATCHLOG_SESSION_SECRET` | WatchLog API | Long random value for HTTP-only sessions |
| `WATCHLOG_WEBHOOK_SECRET` | WatchLog API | Shared secret for Jellyfin webhook requests |

Optional future/metadata secrets:

| Secret | Used by | Notes |
| --- | --- | --- |
| `WATCHLOG_JELLYFIN_API_KEY` | Jellyfin API client | Not required for Phase 1 webhook ingest |
| `WATCHLOG_TMDB_BEARER_TOKEN` | TMDb metadata | Not required for Phase 1 |

Never commit real secret values. In GitOps files, use only `secret://NAME`.

## Deployment über Unraid Deployment Broker

This repository is prepared for broker-based GitOps deployment:

1. Register this repo with the `unraid_deploy` broker.
2. Ensure the required secrets above exist in the broker secret store.
3. Run broker scan.
4. Run `stack_validate`.
5. Create a deploy plan.
6. Apply only an approved, valid plan.
7. Verify container state, deployment status, logs, and `/api/health` through the broker.

No privileged containers, host networking, or host mounts outside appdata are required.

## Jellyfin Webhook

Configure the Jellyfin Webhook Plugin to send JSON to:

```text
http://WATCHLOG_HOST:8111/api/webhooks/jellyfin
```

Add header:

```text
X-WatchLog-Webhook-Secret: your-secret
```

Use the template in [docs/webhook-template.md](docs/webhook-template.md).

After creating a WatchLog user with Jellyfin UserId `jf-user-1`, this sample should create a WatchEvent:

```bash
curl -i \
  -X POST "http://localhost:8111/api/webhooks/jellyfin" \
  -H "content-type: application/json" \
  -H "X-WatchLog-Webhook-Secret: $WEBHOOK_SECRET" \
  --data-binary @docs/example-playbackstop-webhook.json
```

## Troubleshooting

- `401 Webhook-Secret ist ungueltig`: header or query secret does not match `WEBHOOK_SECRET`.
- `Kein WatchLog-Benutzer fuer Jellyfin-UserId gefunden`: add the Jellyfin user ID to the WatchLog account.
- `db: error` in `/api/health`: check `WATCHLOG_DATABASE_URL`, `WATCHLOG_POSTGRES_PASSWORD`, and database container logs through the broker.
- Login loops: verify `APP_URL`, reverse proxy HTTPS settings, and `SECURE_COOKIES`.

## Security Notes

- Secrets are masked in logs and are not returned by settings endpoints.
- Passwords are stored as Argon2id hashes.
- Webhook payloads are hashed for debugging instead of storing raw bodies.
- Back-sync to Jellyfin is planned as manual-only and is not automatic in this MVP.

## License

MIT for the first public iteration. AGPL-3.0 remains a reasonable future option if the project needs network-copyleft guarantees.
