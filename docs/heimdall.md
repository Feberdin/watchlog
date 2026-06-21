<!--
Purpose: Provide practical Heimdall dashboard information for the WatchLog Unraid stack.
Input/Output: Operators use this page to create or verify a Heimdall tile; it outputs names, URLs, labels, and safe debug steps.
Invariants: Secrets are never shown, Heimdall writes happen only through the Unraid Deployment Broker, and database containers are not linked as web apps.
Debugging: Start with the Broker Docker view, then WatchLog `/readyz`, then WatchLog logs through the Broker.
-->

# Heimdall Information

## Recommended Tile

Why this exists: Heimdall should show the one URL a normal user opens, not every internal container in the stack.

What happens here: Use these values for the WatchLog dashboard tile or as the expected result of a Broker-managed Heimdall sync.

| Field | Value |
| --- | --- |
| Name | `WatchLog` |
| URL | `http://192.168.57.10:8111` |
| Category | `Medien` |
| Description | `Gesehene Filme, Serien, Staffeln und Episoden verwalten, Poster-Kollagen exportieren und Jahresrueckblicke teilen.` |
| Icon suggestion | `fa-film` or `fa-tv` |
| Tags | `media`, `movies`, `series`, `jellyfin`, `jellyseerr`, `tmdb`, `watchtime` |
| Health check | `http://192.168.57.10:8111/readyz` |
| Stack | `watchlog` |
| Web container | `watchlog` |
| Internal database | `watchlog-db`, do not add to Heimdall |

The Broker auto-sync derives names from container names and may create the tile as `Watchlog`. Use `WatchLog` as the preferred human-readable display name when a custom label is supported.

## Broker Sync Expectation

Why this exists: The Heimdall sync should be predictable and avoid noisy or unsafe dashboard entries.

What happens here: In the global Docker preview the Broker may detect many web containers. For the WatchLog stack, only the public WatchLog web port is relevant.

- Include `watchlog`, because it publishes `0.0.0.0:8111->8111/tcp` and is a user-facing web app.
- Skip `watchlog-db`, because PostgreSQL only exposes `5432/tcp` inside the stack and is not a browser UI.
- Prefer `http://192.168.57.10:8111` unless the stack is later placed behind a reverse proxy with HTTPS.
- Keep manual Heimdall entries untouched unless the Broker plan explicitly marks them as Broker-managed.
- Expect a full Broker sync to include other web containers too. Review the plan for unrelated create/update actions before applying.

## Safe Sync Workflow

Why this exists: Heimdall stores its dashboard in SQLite, so direct edits can corrupt or overwrite manual dashboard work.

What happens here: All write operations go through the Unraid Deployment Broker, which previews, plans, backs up, and applies changes.

1. Confirm the Heimdall sync tools are visible in Codex: `heimdall_status`, `heimdall_preview`, `heimdall_plan_sync`, and `heimdall_apply_sync_plan`.
2. Run a preview and verify that `WatchLog` points to `http://192.168.57.10:8111`.
3. Create a sync plan and review whether it will create or update only the WatchLog tile.
4. Apply only the approved Broker plan. Do not use SSH, Docker CLI, raw HTTP, or direct SQLite edits.
5. Re-open Heimdall at `http://192.168.57.10:9999` and verify the tile opens WatchLog.

If the Heimdall sync tools are not loaded in Codex, restart the Codex session with the Unraid Deployment Broker MCP server enabled before applying dashboard changes.

## Operations And Debugging

Why this exists: A broken tile can mean Heimdall, WatchLog, routing, or auth is failing. These checks narrow the problem without exposing secrets.

What happens here: Check from the outside in, using Broker read-only status before changing anything.

| Symptom | Check | Next step |
| --- | --- | --- |
| Tile is missing | Broker Heimdall preview | Enable Heimdall sync in the Broker Admin UI, then plan/apply through the Broker |
| Tile opens but page fails | WatchLog `/readyz` | Check `watchlog` container status and logs through the Broker |
| Login or session loops | `APP_URL` and `SECURE_COOKIES` settings | Use `http://192.168.57.10:8111` with `SECURE_COOKIES=false`, or configure HTTPS consistently |
| Poster images fail | WatchLog logs and `/cache` volume | Verify the `watchlog-cache` volume and TMDb integration status |
| Heimdall shows database | Heimdall sync preview | Remove or skip `watchlog-db`; it is not a web application |

## Current Runtime Snapshot

Why this exists: These values document the known-good state used when this Heimdall guidance was created.

What happens here: The data comes from the Unraid Deployment Broker Docker view and stack source status.

- Stack source: `watchlog`
- Git source: `Feberdin/watchlog`
- Compose file: `docker-compose.broker.yml`
- Current commit: check with the Broker `stack_source_status` tool before changing Heimdall
- Web container: `watchlog`, status `healthy`
- Web image: `watchlog-watchlog`
- Web port: `8111`
- Database container: `watchlog-db`, status `healthy`
- Heimdall container: `heimdall`
- Heimdall URL: `http://192.168.57.10:9999`

## Security Notes

Why this exists: Heimdall links are visible operational metadata and must not leak credentials.

What happens here: Store only non-secret URLs and labels in Heimdall.

- Do not place API keys, webhook secrets, session secrets, passwords, cookies, or tokens in Heimdall names, descriptions, URLs, or notes.
- Do not use URLs with embedded credentials.
- Keep WatchLog secrets in the Broker secret store as `secret://...` references.
- Use the WatchLog UI for integration settings and the Broker Admin UI for secret availability checks.
