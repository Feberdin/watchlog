# Jellyfin Setup

Purpose: Guide operators through Jellyfin Webhook Plugin configuration.
Input/Output: Jellyfin sends playback events to WatchLog.
Invariants: The webhook endpoint must be protected with `WEBHOOK_SECRET`.
Debugging: Use WatchLog logs with `LOG_LEVEL=debug` and Jellyfin plugin delivery history.

## Steps

1. Install and enable a Jellyfin webhook plugin, then restart Jellyfin if the plugin page shows `Restart`.
2. Create a webhook destination.
3. Set the destination to the WatchLog Jellyfin webhook path and enter the broker-managed webhook secret as the query parameter value. Example with non-secret placeholders: `http://<watchlog-host>:8111/api/webhooks/jellyfin?<secret-parameter-name>=<broker-managed-value>`.
4. If the plugin supports custom headers, using `X-WatchLog-Webhook-Secret` instead of the query secret is also supported.
5. For the plugin that only offers `Default`, `Get`, and `Plex`, choose `Default`. WatchLog understands its native JSON payload.
6. Enable playback-related events: `Play`, `Progress`, `Stop`, `Scrobble`, and `MarkPlayed`.
7. In WatchLog, make sure the local user has the matching Jellyfin UserId.

## Plugin Variants

Some Jellyfin installations use the official template-based Webhook Plugin. In that plugin, create a generic JSON webhook and paste the JSON template from [webhook-template.md](webhook-template.md).

Other installations use the lightweight `Webhooks` plugin that offers only these payload formats:

- `Default`: Use this for WatchLog. It sends native Jellyfin JSON with item, user, session, and playback state.
- `Get`: Do not use for WatchLog. It sends too little playback detail.
- `Plex`: Do not use for WatchLog unless a future compatibility mode is added.

## Variable Availability

Jellyfin Webhook Plugin variables can differ by plugin version and event type. WatchLog does not require provider IDs or every playback field. Empty strings are treated as missing values, and unknown fields are ignored.

## Local Test

Create the first WatchLog admin in the UI and set `Jellyfin UserId` to `jf-user-1`. Then send the sample PlaybackStop payload:

```bash
curl -i \
  -X POST "http://localhost:8111/api/webhooks/jellyfin?secret=$WEBHOOK_SECRET" \
  -H "content-type: application/json" \
  --data-binary @docs/example-playbackstop-webhook.json
```

Expected result: HTTP `201` with a `watchEventId`. Sending the same payload again within 30 minutes returns `202` and does not create a duplicate WatchEvent.
