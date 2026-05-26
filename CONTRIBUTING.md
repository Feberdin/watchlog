# Contributing

Purpose: Explain how maintainers and contributors should change WatchLog safely.
Input/Output: Contributors can set up the project, run checks, and open focused pull requests.
Invariants: Keep changes self-hosted, readable, tested, and free of secrets.
Debugging: If CI or local checks fail, reproduce with the commands below before requesting review.

## Project Principles

- Self-hosted first.
- No telemetry.
- No hidden external services.
- Secrets are never logged, committed, or returned in API responses.
- Prefer clear code over clever code.
- Keep UI flows obvious for non-specialist operators.

## Local Setup

```bash
git clone https://github.com/Feberdin/watchlog.git
cd watchlog
cp .env.example .env
npm install
docker compose up -d db
npm run prisma:generate
npm run db:push -w @watchlog/api
npm run dev
```

## Required Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Coding Style

- TypeScript strict mode stays enabled.
- Use Zod for runtime input validation.
- Keep route handlers small; move reusable logic to services.
- Write comments for intent, security boundaries, and non-obvious behavior.
- Do not add proprietary or cloud-only dependencies unless the feature is explicitly optional.

## Tests

Add or update tests when changing:

- webhook parsing
- WatchEvent creation or dedupe rules
- auth behavior
- import/export formats
- external client request construction
- security-sensitive URL or secret handling

## Security

Never commit `.env`, real API keys, webhook secrets, session secrets, cookies, database dumps, or private media library metadata in fixtures.

Use sanitized examples such as `api-key`, `test-token`, or `change-me`.

## Pull Requests

Good pull requests explain:

- what changed
- why it changed
- how it was tested
- any migration or deployment impact
