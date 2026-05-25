# API

Purpose: Summarize implemented API endpoints.
Input/Output: Developers and operators use this as a quick route map.
Invariants: Authenticated endpoints use HTTP-only session cookies.
Debugging: Open `/api/docs` for generated Swagger UI.

## Implemented

- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/dashboard`
- `GET /api/media`
- `GET /api/media/:id`
- `POST /api/media/manual`
- `GET /api/watch-events`
- `POST /api/watch-events/manual`
- `DELETE /api/watch-events/:id`
- `GET /api/settings/jellyfin`
- `PUT /api/settings/jellyfin`
- `POST /api/settings/jellyfin/test`
- `GET /api/settings/tmdb`
- `PUT /api/settings/tmdb`
- `POST /api/settings/tmdb/test`
- `POST /api/webhooks/jellyfin`
- `GET /api/export/csv`
- `GET /api/export/json`
