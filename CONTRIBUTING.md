# Contributing

Purpose: Explain how maintainers and contributors should change WatchLog safely.
Input/Output: Contributors follow these steps before opening a pull request.
Invariants: Keep changes small, tested, and readable for non-specialists.
Debugging: If CI fails, reproduce locally with the commands below.

## Workflow

1. Create a branch such as `codex/short-description`.
2. Run `npm install`.
3. Make focused changes with clear names and comments where intent is not obvious.
4. Run:

```bash
npm run typecheck
npm run lint
npm test
```

## Style

- TypeScript strict mode stays enabled.
- Use Zod for runtime input validation.
- Do not log secrets, tokens, cookies, or passwords.
- Prefer small service functions over large route handlers.

## Tests

Add tests for:

- webhook parsing changes,
- WatchEvent creation or dedupe rules,
- auth behavior,
- import/export formats,
- external client request construction.
