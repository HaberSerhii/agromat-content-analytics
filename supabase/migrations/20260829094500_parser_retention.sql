-- Keep the live competitor parser dataset intentionally small:
--   * price_snapshots and parse_errors: today + yesterday in Europe/Kyiv;
--   * audit_log: 30 rolling days;
--   * sync_price_change audit rows: removed because agromat_price_history is
--     the canonical copy of the same price-change history.
--
-- The hourly job makes the policy insensitive to daylight-saving changes and
-- also cleans up a duplicate audit row shortly after a catalog sync completes.

create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.cleanup_analytics_retention()
returns table (
  price_snapshots_deleted bigint,
  parse_errors_deleted bigint,
  audit_log_deleted bigint,
  parser_cutoff_date date,
  audit_cutoff_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parser_cutoff date := (now() at time zone 'Europe/Kyiv')::date - 1;
  v_audit_cutoff timestamptz := now() - interval '30 days';
  v_price_deleted bigint := 0;
  v_errors_deleted bigint := 0;
  v_audit_deleted bigint := 0;
begin
  delete from public.price_snapshots
  where snapshot_date < v_parser_cutoff;
  get diagnostics v_price_deleted = row_count;

  delete from public.parse_errors
  where snapshot_date < v_parser_cutoff;
  get diagnostics v_errors_deleted = row_count;

  delete from public.audit_log
  where created_at < v_audit_cutoff
     or action = 'sync_price_change';
  get diagnostics v_audit_deleted = row_count;

  return query select
    v_price_deleted,
    v_errors_deleted,
    v_audit_deleted,
    v_parser_cutoff,
    v_audit_cutoff;
end;
$$;

comment on function public.cleanup_analytics_retention() is
  'Keeps parser snapshots/errors for Kyiv today+yesterday, audit for 30 days, and removes duplicated sync_price_change audit rows.';

revoke all on function public.cleanup_analytics_retention() from public, anon, authenticated;

select cron.unschedule(jobid)
from cron.job
where jobname = 'agromat-analytics-retention';

select cron.schedule(
  'agromat-analytics-retention',
  '17 * * * *',
  $job$select public.cleanup_analytics_retention();$job$
);

