# Jellyfin Webhook Template

Purpose: Provide a JSON template for the Jellyfin Webhook Plugin.
Input/Output: Jellyfin replaces template variables and sends JSON to WatchLog.
Invariants: Missing or empty fields are allowed; `item.id`, `item.name`, and `user.id` are required for WatchLog processing.
Debugging: If parsing fails, compare the delivered JSON body with the fields below.

> Note: Jellyfin Webhook Plugin variable names can vary by version and notification type. The parser is intentionally tolerant. Confirm exact variable availability in your installed plugin before relying on optional fields.

```json
{
  "notification_type": "{{NotificationType}}",
  "timestamp": "{{Timestamp}}",
  "utc_timestamp": "{{UtcTimestamp}}",
  "server": {
    "id": "{{ServerId}}",
    "name": "{{ServerName}}",
    "version": "{{ServerVersion}}",
    "url": "{{ServerUrl}}"
  },
  "user": {
    "id": "{{UserId}}",
    "name": "{{Username}}"
  },
  "client": {
    "name": "{{ClientName}}",
    "device_name": "{{DeviceName}}",
    "device_id": "{{DeviceId}}",
    "remote_endpoint": "{{RemoteEndPoint}}"
  },
  "item": {
    "id": "{{ItemId}}",
    "type": "{{ItemType}}",
    "name": "{{Name}}",
    "overview": "{{json_encode Overview}}",
    "year": "{{Year}}",
    "runtime_ticks": "{{RunTimeTicks}}",
    "runtime": "{{RunTime}}",
    "media_source_id": "{{MediaSourceId}}",
    "tmdb_id": "{{Provider_tmdb}}",
    "imdb_id": "{{Provider_imdb}}",
    "tvdb_id": "{{Provider_tvdb}}",
    "series_name": "{{SeriesName}}",
    "series_id": "{{SeriesId}}",
    "season_number": "{{SeasonNumber}}",
    "episode_number": "{{EpisodeNumber}}"
  },
  "playback": {
    "position_ticks": "{{PlaybackPositionTicks}}",
    "position": "{{PlaybackPosition}}",
    "play_method": "{{PlayMethod}}",
    "played_to_completion": "{{PlayedToCompletion}}",
    "is_paused": "{{IsPaused}}",
    "played": "{{Played}}",
    "play_count": "{{PlayCount}}",
    "last_played_date": "{{LastPlayedDate}}"
  }
}
```
