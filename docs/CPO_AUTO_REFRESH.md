# Automatic CPO snapshots

CPO has a separate background importer. Dashboard GET/POST requests only read
published files and run local diagnostics; they never submit BigQuery scans.

## Schedule and freshness

`install-cpo-refresh-cron.sh` installs a readiness check every hour at minute 20.
It is invoked by both `deploy.sh` and `setup-vps-storage.sh`; it can also be run
alone with `APP_DIR=/opt/agromat-content-analytics bash scripts/install-cpo-refresh-cron.sh`.
The runner uses `Europe/Kyiv` for week boundaries regardless of the server's
cron timezone. The target is the most recent completed Sunday (Monday–Sunday).

All daily `events_YYYYMMDD` tables in the scanned range must exist. Intraday
tables do not qualify. If a day is absent, the old snapshot stays active and the
next hourly invocation checks again without submitting an event query.
Google does not guarantee Sunday's export by Monday morning. A new week becomes
available after all its daily tables have appeared and the import succeeds.

GA4 can update daily exports for three days after an event's date. Therefore,
a published week is corrected once each Kyiv calendar day through Thursday.
The first successful run on/after Thursday makes the final correction. Same-day
runs are no-ops after success. If the final run was missed, it is recovered later.
See https://support.google.com/analytics/answer/7029846 and
https://support.google.com/analytics/answer/9358801?hl=en .

Only completed weeks are exposed. Completed months are rebuilt in the first
weekly snapshot covering month end; monthly distinct-user counts are computed
from the whole month, never from a sum of weeks. Partial legacy month partitions
stay hidden until they are replaced by a complete monthly result.

## Incremental query and bounded cost

Each generation advances at most one week, recomputing that week and the
preceding week to capture late events and session boundary corrections. It also
recomputes full months ending within those weeks. Queries include one preceding
day of context to avoid treating an overnight session as a new period's session.
All other period partitions, including prior-year comparisons, are retained.
The shared `scripts/lib/cpo-query.mjs` keeps the aggregate formulas aligned with
the original CPO cube. No raw user identifiers are persisted.

At most eight catch-up generations are handled per invocation. Running jobs are
polled for up to 15 minutes, then resumed on the next hourly invocation. All
queries have `maximumBytesBilled` (default 100,000,000,000 bytes per query,
configurable as `CPO_MAXIMUM_BYTES_BILLED`). No full-history scan is performed.

Dry-run on the server:

```sh
APP_DIR=/opt/agromat-content-analytics bash scripts/run-cpo-refresh.sh --dry-run
```

This lists source tables and estimates bytes but does not submit an event scan
or modify the active manifest, checkpoint, or status. The importer uses the
project/dataset/location recorded in the existing manifest and the server's
existing Google credentials. An initial imported partition manifest is required;
legacy recovery remains in `CPO_RECOVERY.md`.

## Publication, retries, and recovery

- The runner holds an OS `flock` in the persistent CPO directory. Crashes and
  reboots release it automatically; overlapping cron invocations exit.
- A deterministic job ID is checkpointed before submission. An interrupted or
  uncertain request resumes that same BigQuery job instead of paying for a new
  scan. Terminal failures are retried with a new ID the next Kyiv day.
- Results are downloaded in pages of 5,000 rows. Each page uses generation-specific
  filenames; checkpointing happens after the page's files have been written.
  Repeating an interrupted page overwrites its unpublished files, not live ones.
- Required period totals, finite metrics, nonzero sessions, total result count,
  job completion, and unchanged source manifest are checked before publication.
- Only an atomic rename of `partition-manifest.json` makes the new generation
  visible. Errors retain the last successful generation.
- `manifest-before-cpo_refresh_*.json` and the previous chunks are retained for
  rollback and in-flight readers. Do not delete files referenced by any retained
  manifest or by `refresh-pending.json`. Back up the entire CPO directory.

Operational files in `CPO_ANALYTICS_DIR` (default: sibling of
`PRODUCT_SNAPSHOTS_DIR`):

- `refresh-status.json`: last attempt, target coverage and success/wait/error;
  the dashboard exposes only safe status fields.
- `refresh-pending.json`: resumable job and downloaded-page checkpoint.
- `refresh-failed.json`: most recent terminal job failure.
- `/var/log/agromat-cpo-refresh.log`: cron output; provider errors are logged as
  messages only, never as SDK objects containing request credentials.

Run now with `APP_DIR=/opt/agromat-content-analytics bash scripts/run-cpo-refresh.sh`.
Never remove the pending checkpoint just to retry a slow query. If the manifest
was changed externally, reconcile it with the saved checkpoint before retrying.
