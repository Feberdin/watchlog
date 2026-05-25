# Unraid Setup

Purpose: Explain how to run WatchLog on Unraid.
Input/Output: A Docker Compose stack stores database and config under `/mnt/user/appdata/watchlog`.
Invariants: Secrets stay in local `.env` files and are not committed.
Debugging: Use Unraid container logs and verify appdata permissions.

## Steps

1. Create `/mnt/user/appdata/watchlog`.
2. Copy `.env.example` to `.env`.
3. Store required secrets in the Deployment Broker:
   - `WATCHLOG_POSTGRES_PASSWORD`
   - `WATCHLOG_DATABASE_URL`
   - `WATCHLOG_SESSION_SECRET`
   - `WATCHLOG_WEBHOOK_SECRET`
   - `WATCHLOG_JELLYFIN_URL`
   - `WATCHLOG_JELLYFIN_API_KEY`
   - `WATCHLOG_JELLYSEERR_URL`
   - `WATCHLOG_JELLYSEERR_API_KEY`
   - `WATCHLOG_TMDB_BEARER_TOKEN`
4. Use `docker-compose.yml` for GitOps broker deployment.
5. Start the stack through the broker and open `http://tower.local:8111` or your server IP.

## Common Problems

- Port already used: change host port mapping from `8111:8111` to another host port.
- Database permission errors: make sure `/mnt/user/appdata/watchlog/postgres` is writable by Docker.
- Login cookie issues behind reverse proxy: set `APP_URL` to the public HTTPS URL and `SECURE_COOKIES=true`.
