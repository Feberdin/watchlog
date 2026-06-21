# WatchLog

Self-hosted watch history for Jellyfin users.

WatchLog records which movies and TV episodes a Jellyfin user watched, stores the history in its own PostgreSQL database, and provides a local web UI for timeline browsing, manual historical entries, imports/exports, statistics, series progress, and recommendations. It is designed for Unraid, Docker Compose, and normal Linux servers.

No telemetry. No hidden cloud service. No automatic back-sync to Jellyfin.

## Status

WatchLog is an early public MVP. The current version is useful for self-hosted testing and personal use, but the API and database model may still change before a stable `1.0` release.

## Features

- Jellyfin webhook receiver with shared-secret authentication.
- Support for native Jellyfin Webhooks `Default` payloads and template-based webhook payloads.
- Automatic WatchEvent creation for completed playback, scrobbles, `MarkPlayed`, or threshold-based progress.
- Duplicate suppression for repeated webhook events in a short window.
- Separate WatchEvents for rewatches.
- Jellyfin watched-state import for movies and episodes.
- Local users with Argon2id password hashing and HTTP-only cookie sessions.
- User mapping to Jellyfin UserIds.
- Manual historical watch entries through TMDb search.
- Imprecise dates: exact datetime, date, month/year, year, or unknown.
- Timeline with collapsible series groups and statistics.
- Dashboard with a growing poster collage.
- Local poster cache as optimized WebP files.
- Series page with seasons, episodes, progress, and quick manual marking.
- Swipe/recommendation screen backed by TMDb, with optional Jellyseerr requests.
- CSV/JSON export and CSV import foundation.
- PostgreSQL production database through Prisma migrations.
- Docker Compose, Unraid example, and broker-oriented GitOps compose file.

## Screens and UI

The UI currently includes:

- Login / first-admin setup
- Dashboard
- Timeline
- Series
- Swipe
- Manual add
- Integrations

The interface is intentionally practical rather than marketing-heavy: dark mode, compact controls, poster cards, tables/lists, and clear operational states.

## Quickstart With Docker Compose

Requirements:

- Docker Engine with Compose v2
- Git
- A host that can reach Jellyfin if webhooks/imports should work

Clone and configure:

```bash
git clone https://github.com/Feberdin/watchlog.git
cd watchlog
cp .env.example .env
```

Generate local secrets:

```bash
openssl rand -base64 32
openssl rand -base64 32
openssl rand -base64 24
```

Edit `.env`:

- Set `POSTGRES_PASSWORD`.
- Put the same password into `DATABASE_URL`.
- Set `SESSION_SECRET`.
- Set `WEBHOOK_SECRET`.
- Optionally set `JELLYFIN_URL`, `JELLYFIN_API_KEY`, `JELLYSEERR_URL`, `JELLYSEERR_API_KEY`, and `TMDB_BEARER_TOKEN`.

Start:

```bash
docker compose up -d --build
```

Open:

```text
http://localhost:8111
```

Create the first admin user. After the first admin exists, registration is closed unless `REGISTRATION_ENABLED=true`.

## Docker Compose Files

| File | Purpose |
| --- | --- |
| `docker-compose.yml` | Public standalone install. Uses `.env` values and named Docker volumes. |
| `docker-compose.unraid.example.yml` | Unraid-oriented example with appdata bind mounts and broker-style secrets. |
| `docker-compose.broker.yml` | Private GitOps/Broker compose using `secret://...` references. |

Most users should start with `docker-compose.yml`.

Heimdall dashboard values for the Unraid/Broker setup are documented in [docs/heimdall.md](docs/heimdall.md).

## Configuration

| Variable | Required | Example | Notes |
| --- | --- | --- | --- |
| `APP_URL` | Yes | `http://localhost:8111` | Public URL used for CORS/cookies. |
| `APP_PORT` | Yes | `8111` | Host port exposed by Compose. |
| `TZ` | No | `Europe/Berlin` | Container timezone. |
| `POSTGRES_DB` | Yes | `watchlog` | PostgreSQL database name. |
| `POSTGRES_USER` | Yes | `watchlog` | PostgreSQL username. |
| `POSTGRES_PASSWORD` | Yes | generated value | Must match `DATABASE_URL`. |
| `DATABASE_URL` | Yes | `postgresql://watchlog:...@db:5432/watchlog` | Prisma connection string. |
| `SESSION_SECRET` | Yes | generated value | Long random cookie/session secret. |
| `WEBHOOK_SECRET` | Yes | generated value | Shared secret for Jellyfin webhooks. |
| `JELLYFIN_URL` | No | `http://192.168.1.10:8096` | Can also be set in UI. |
| `JELLYFIN_API_KEY` | No | empty | Used for imports and sync actions. |
| `JELLYSEERR_URL` | No | `http://192.168.1.10:5055` | Used for swipe "want" requests. |
| `JELLYSEERR_API_KEY` | No | empty | Used only if Jellyseerr is configured. |
| `TMDB_BEARER_TOKEN` | No | empty | Enables TMDb search, posters, metadata, and recommendations. |
| `REGISTRATION_ENABLED` | No | `false` | Allows additional registration after first admin. |
| `LOG_LEVEL` | No | `info` | Use `debug` while integrating. |
| `SECURE_COOKIES` | No | `false` | Set `true` behind HTTPS. |
| `CACHE_DIR` | No | `/cache` | Poster WebP cache path inside the container. |

Never commit your real `.env`.

## Jellyfin Setup

WatchLog accepts the webhook secret either as query parameter or header.

Recommended URL:

```text
http://WATCHLOG_HOST:8111/api/webhooks/jellyfin?secret=YOUR_WEBHOOK_SECRET
```

If your webhook plugin supports custom headers, this is also supported:

```text
X-WatchLog-Webhook-Secret: YOUR_WEBHOOK_SECRET
```

### Webhooks Plugin With `Default`, `Get`, `Plex`

Use:

- Payload format: `Default`
- Events: `Play`, `Progress`, `Stop`, `Scrobble`, `MarkPlayed`
- User filter: select the Jellyfin user you want to track, or configure one webhook per user

Do not use `Get`; it does not send enough playback data. `Plex` is intended for Plex-compatible scrobblers, not WatchLog.

### Template-Based Webhook Plugin

Use the JSON template in [docs/webhook-template.md](docs/webhook-template.md).

More setup details are in [docs/jellyfin-setup.md](docs/jellyfin-setup.md).

## First Import From Jellyfin

1. Open `Integrationen`.
2. Save Jellyfin URL and API key, or provide them through `.env`.
3. Save the Jellyfin UserId on your WatchLog user.
4. Run `Gesehene Medien importieren`.

Jellyfin usually exposes the current watched state and latest watched date, not a full historic rewatch list. Future webhooks capture rewatches as separate WatchEvents.

## TMDb And Jellyseerr

TMDb is optional but strongly recommended for:

- manual add search
- posters/backdrops
- series catalog completion
- swipe recommendations
- trailer links

Jellyseerr is optional and only used when you actively swipe a title to `Will ich`.

WatchLog does not send telemetry to TMDb or Jellyseerr. It only calls the APIs you configure.

## Import And Export

CSV export format:

```csv
type,title,year,watched_at,date_precision,tmdb_id,imdb_id,jellyfin_item_id,note,rating
movie,Heat,1995,2018-11-01,date,,tt0113277,,ungefähres Datum,
movie,Alien,1979,2010,year,,tt0078748,,nur Jahr bekannt,
```

See [docs/import-export.md](docs/import-export.md).

## Development

Requirements:

- Node.js 20+
- npm
- Docker for PostgreSQL, or a local PostgreSQL instance

Install:

```bash
npm install
```

Run PostgreSQL:

```bash
docker compose up -d db
```

Run migrations/generate client:

```bash
npm run prisma:generate
npm run db:push -w @watchlog/api
```

Run dev servers:

```bash
npm run dev
```

Quality checks:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Architecture

Monorepo layout:

```text
apps/api      Fastify API, Prisma, integrations, webhooks
apps/web      React/Vite UI
packages/shared  shared validators, constants, and API types
docs          operator and design documentation
```

Primary decisions:

- Fastify keeps the self-hosted API small.
- Prisma gives explicit migrations and a typed DB boundary.
- PostgreSQL is the production database.
- Sessions use HTTP-only cookies and server-side session rows.
- Secrets are redacted from logs and masked in settings responses.
- Poster caching is local and limited to known trusted image hosts.

More details are in [docs/architecture.md](docs/architecture.md).

## Security

Security-sensitive defaults:

- No telemetry.
- No hidden external service.
- No automatic back-sync to Jellyfin.
- Webhook endpoint requires a secret.
- Passwords use Argon2id.
- Sessions are stored server-side and cookies are HTTP-only.
- Integration tokens are not returned by settings endpoints.
- Public Compose uses normal environment variables; private broker Compose uses `secret://...` references.

Report vulnerabilities privately. See [SECURITY.md](SECURITY.md).

## Troubleshooting

### `unhealthy` in `/readyz` or `db: error` in `/api/health`

Check:

```bash
curl http://localhost:8111/healthz
curl http://localhost:8111/readyz
docker compose logs db
docker compose logs watchlog
docker compose exec db pg_isready -U watchlog -d watchlog
```

Verify that `POSTGRES_PASSWORD` and `DATABASE_URL` use the same password.
The Docker healthcheck uses `/readyz`; `/healthz` only confirms that the API process is alive.

### Login works but immediately returns to login

Check:

- `APP_URL` matches the URL you use in the browser.
- `SECURE_COOKIES=false` for plain HTTP.
- `SECURE_COOKIES=true` only behind HTTPS.

### Jellyfin webhook returns `401`

The query secret or `X-WatchLog-Webhook-Secret` header does not match `WEBHOOK_SECRET`.

### Webhook arrives but no WatchEvent appears

Common causes:

- Jellyfin UserId is not mapped to the WatchLog user.
- Event was below the watched threshold.
- Media type was not Movie/Episode.
- Duplicate event was suppressed.

### Posters are missing

Run TMDb metadata search/import or Jellyfin sync. The dashboard cache only optimizes poster URLs already known in the database.

## Roadmap

- Webhook diagnostics UI
- scheduled Jellyfin watched-state sync
- richer import preview
- backup/restore UI
- OIDC / Authentik / Authelia
- full i18n
- Trakt import
- Jellystat / Playback Reporting import
- calendar view
- Radarr/Sonarr/Jellyseerr library status

## Contributing

Contributions are welcome, but keep the project self-hosted and understandable. Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
