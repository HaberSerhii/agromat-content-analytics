# CPO saved-result recovery

The dashboard API is read-only with respect to BigQuery. `build` and `estimate`
are rejected. No query is submitted when a snapshot is absent.

Recovery uses `scripts/cpo-recover.mjs` with `CPO_ANALYTICS_DIR` and
`CPO_RECOVERY_JOB_ID`. It calls getMetadata/getQueryResults on an existing,
completed Ukraine job; it never calls createQueryJob. Run it as a separate
process using server credentials. Results must still be available at Google.
If the result has expired, stop; a fresh query requires an explicit decision.

Pages of up to 5,000 rows are converted and written to period-specific gzip
chunks. A checkpoint is atomically replaced after all files for a page are
written. An interrupted page overwrites its deterministic filenames on resume;
it does not append duplicates. A lock prevents concurrent writers. After a
forced termination, verify the worker is absent before removing its stale lock.

Only after downloaded row count matches the job total does the worker publish
`partition-manifest.json`. The dashboard reads chunks for exactly the selected,
previous, and prior-year periods. Existing calendar and calculation rules stay
unchanged. These recovered results contain week/month aggregates, not daily
facts; adding daily drill-down will require a separately planned data migration.

`recovery-progress.json` provides the saved row count for the missing-data UI.
Back up the entire CPO directory, including manifest and chunks. Do not remove
chunks referenced by a published manifest. This recovery is intended for one
frozen generation; it rejects checkpoints from a different job.

Storage is split gzip files rather than SQLite: indexed filenames already match
the diagnostic engine's period access pattern and avoid a new native dependency.
The legacy monolithic snapshot reader remains as compatibility fallback.
