# Unraid Setup

Purpose: Explain how to run WatchLog on Unraid.
Input/Output: A Docker Compose stack stores database and cache data under persistent volumes or appdata.
Invariants: Secrets stay in local `.env` files or a broker secret store and are not committed.
Debugging: Use Unraid container logs, WatchLog `/api/health`, and PostgreSQL healthchecks.

## Option A: Normal Unraid Compose

Use this if you do not use the private Unraid Deployment Broker.

1. Create an appdata directory, for example `/mnt/user/appdata/watchlog`.
2. Copy `.env.example` to `.env`.
3. Generate long values for `POSTGRES_PASSWORD`, `SESSION_SECRET`, and `WEBHOOK_SECRET`.
4. Put the PostgreSQL password into both `POSTGRES_PASSWORD` and `DATABASE_URL`.
5. Start with `docker-compose.yml` or adapt it into an Unraid Compose Manager stack.
6. Open `http://UNRAID_IP:8111`.

The public `docker-compose.yml` uses named Docker volumes. If you prefer appdata bind mounts, map:

- `/mnt/user/appdata/watchlog/postgres` to `/var/lib/postgresql/data`
- `/mnt/user/appdata/watchlog/config` to `/config`
- `/mnt/user/appdata/watchlog/cache` to `/cache`

## Option B: Private Deployment Broker

Use this only if you operate the private broker that understands `secret://...`.

1. Create `/mnt/user/appdata/watchlog`.
2. Configure the stack with `allowed_appdata_path=/mnt/user/appdata/watchlog`.
3. Use `docker-compose.broker.yml`.
4. Store required secrets in the broker:
   - `WATCHLOG_POSTGRES_PASSWORD`
   - `WATCHLOG_DATABASE_URL`
   - `WATCHLOG_SESSION_SECRET`
   - `WATCHLOG_WEBHOOK_SECRET`
   - `WATCHLOG_JELLYFIN_URL`
   - `WATCHLOG_JELLYFIN_API_KEY`
   - `WATCHLOG_JELLYSEERR_URL`
   - `WATCHLOG_JELLYSEERR_API_KEY`
   - `WATCHLOG_TMDB_BEARER_TOKEN`
5. Run broker validation, deploy plan, approval if required, and apply.

## Common Problems

- Port already used: change `APP_PORT` in `.env`.
- Database permission errors: make sure the PostgreSQL data directory is writable by Docker.
- Login cookie issues behind reverse proxy: set `APP_URL` to the public HTTPS URL and `SECURE_COOKIES=true`.
- Webhook 401: verify the URL query `?secret=...` or the `X-WatchLog-Webhook-Secret` header.
