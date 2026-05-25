# Import and Export

Purpose: Document WatchLog history exchange formats.
Input/Output: CSV or JSON files move watch history in and out of WatchLog.
Invariants: Imports must validate every row before creating WatchEvents.
Debugging: Invalid rows should show field-specific errors before data is written.

## CSV Format

```csv
type,title,year,watched_at,date_precision,tmdb_id,imdb_id,jellyfin_item_id,note,rating
movie,Heat,1995,2018-11-01,date,,tt0113277,,ungefähres Datum,
movie,Alien,1979,2010,year,,tt0078748,,nur Jahr bekannt,
```

## MVP Status

CSV and JSON export are implemented. CSV import is documented and planned for the next iteration with row preview and negative tests.
