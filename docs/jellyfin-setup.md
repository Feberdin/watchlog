# Jellyfin Setup

Purpose: Guide operators through Jellyfin Webhook Plugin configuration.
Input/Output: Jellyfin sends playback events to WatchLog.
Invariants: The webhook endpoint must be protected with `WEBHOOK_SECRET`.
Debugging: Use WatchLog logs with `LOG_LEVEL=debug` and Jellyfin plugin delivery history.

## Steps

1. Install the Jellyfin Webhook Plugin from the Jellyfin plugin catalog.
2. Create a webhook destination with method `POST`.
3. Set URL to `http://WATCHLOG_HOST:8111/api/webhooks/jellyfin`.
4. Add header `X-WatchLog-Webhook-Secret` with the same value as `WEBHOOK_SECRET`.
5. Enable playback-related notifications, especially `PlaybackStop`, `PlaybackProgress`, and `UserDataSaved` if available.
6. Paste the JSON template from [webhook-template.md](webhook-template.md).
7. In WatchLog, make sure the local user has the matching Jellyfin UserId.

## Variable Availability

Jellyfin Webhook Plugin variables can differ by plugin version and event type. WatchLog does not require provider IDs or every playback field. Empty strings are treated as missing values, and unknown fields are ignored.

## Local Test

Create the first WatchLog admin in the UI and set `Jellyfin UserId` to `jf-user-1`. Then send the sample PlaybackStop payload:

```bash
curl -i \
  -X POST "http://localhost:8111/api/webhooks/jellyfin" \
  -H "content-type: application/json" \
  -H "X-WatchLog-Webhook-Secret: $WEBHOOK_SECRET" \
  --data-binary @docs/example-playbackstop-webhook.json
```

Expected result: HTTP `201` with a `watchEventId`. Sending the same payload again within 30 minutes returns `202` and does not create a duplicate WatchEvent.
