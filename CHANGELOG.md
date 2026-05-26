# Changelog

Purpose: Track user-visible changes for WatchLog.
Input/Output: Maintainers summarize notable changes here before tagged releases.
Invariants: Keep entries short, factual, and grouped by type.
Debugging: If behavior changes unexpectedly, compare the current commit with the latest entry.

## Unreleased

### Added

- Jellyfin webhook receiver with secure shared-secret validation.
- Jellyfin watched-state import.
- TMDb-backed manual add flow.
- Dashboard poster collage with local WebP cache.
- Timeline statistics and compact charts.
- Series catalog view with seasons, episodes, and watched marking.
- Swipe recommendations with TMDb and optional Jellyseerr requests.
- Public Docker Compose install path and broker-specific Compose file.

### Security

- No telemetry or hidden external services.
- Argon2id password hashes and HTTP-only cookie sessions.
- Secret masking for settings responses and logs.
