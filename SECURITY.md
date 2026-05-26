# Security Policy

Purpose: Explain how to report vulnerabilities and how WatchLog handles sensitive data.
Input/Output: Users and researchers know where to report issues and what information is safe to include.
Invariants: Do not publish secrets, tokens, database dumps, private logs, or exploit details in public issues.
Debugging: Share sanitized reproduction steps, versions, config shape, and non-secret logs.

## Supported Versions

WatchLog is currently pre-1.0. Security fixes target the `main` branch until stable releases exist.

## Reporting A Vulnerability

Please do not open a public GitHub issue for vulnerabilities.

Use GitHub private vulnerability reporting if it is enabled for the repository. If it is not enabled, contact the maintainer through the GitHub profile and provide only a high-level summary until a private channel is available.

Include:

- affected commit or version
- deployment method
- reproduction steps
- expected impact
- sanitized logs
- whether secrets, webhook payloads, or user data may have been exposed

Do not include:

- real `SESSION_SECRET`
- real `WEBHOOK_SECRET`
- Jellyfin/Jellyseerr/TMDb API keys
- database dumps
- cookies
- private media library metadata that you do not want public

## Security Model

- No telemetry.
- No hidden external services.
- Local auth uses Argon2id password hashes.
- Sessions use HTTP-only cookies and server-side database rows.
- Webhooks require a shared secret.
- Settings endpoints mask stored tokens.
- Poster caching only fetches URLs already stored on media records and only from allowed image hosts.
- Back-sync actions are explicit user actions, not automatic background behavior.

## Operator Checklist

- Generate long random `SESSION_SECRET` and `WEBHOOK_SECRET` values.
- Use HTTPS when exposing WatchLog outside a private LAN.
- Set `SECURE_COOKIES=true` behind HTTPS.
- Keep `.env` out of git.
- Rotate Jellyfin/Jellyseerr/TMDb API keys if logs or config files were accidentally shared.
- Back up PostgreSQL before upgrades.
