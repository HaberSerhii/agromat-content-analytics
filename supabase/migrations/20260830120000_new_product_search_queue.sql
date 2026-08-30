-- Durable review queue for products that need competitor URL discovery.
-- Rows stay open until the result modal is explicitly dismissed.

create table if not exists public.new_product_search_queue (
  product_id bigint primary key references public.products(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'searching', 'ready', 'failed', 'completed')),
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  search_job_id text,
  results jsonb,
  last_error text,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_new_product_search_queue_open
  on public.new_product_search_queue (queued_at, product_id)
  where completed_at is null;

create or replace function public.enqueue_new_product_search()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.action = 'sync_added' and new.product_id is not null then
    insert into public.new_product_search_queue (product_id, queued_at)
    values (new.product_id, coalesce(new.created_at, now()))
    on conflict (product_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enqueue_new_product_search on public.audit_log;
create trigger trg_enqueue_new_product_search
after insert on public.audit_log
for each row execute function public.enqueue_new_product_search();

-- Preserve currently visible new products when this migration is deployed.
insert into public.new_product_search_queue (product_id, queued_at)
select distinct on (audit.product_id)
  audit.product_id,
  audit.created_at
from public.audit_log as audit
join public.products as product on product.id = audit.product_id
where audit.action = 'sync_added'
  and audit.product_id is not null
  and product.is_active is distinct from false
order by audit.product_id, audit.created_at asc
on conflict (product_id) do nothing;
