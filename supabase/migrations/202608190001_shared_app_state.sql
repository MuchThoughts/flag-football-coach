-- One shared dataset for the whole coaching staff: no accounts, no sign-in.
-- Every device reads, writes and listens to a single row.

create table if not exists shared_app_state (
  id text primary key,
  state jsonb not null,
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);

alter table shared_app_state enable row level security;

-- The app ships its publishable key to every device on purpose: opening the
-- app is joining the team, so anonymous reads and writes are the product.
create policy "shared state is readable by anyone"
  on shared_app_state for select
  using (true);

create policy "shared state is writable by anyone"
  on shared_app_state for insert
  with check (true);

create policy "shared state is updatable by anyone"
  on shared_app_state for update
  using (true);

-- Live updates reach every open device.
alter publication supabase_realtime add table shared_app_state;

-- Seed the shared row from the newest of the old per-team snapshots, so the
-- data the coach has been syncing carries straight over.
insert into shared_app_state (id, state, updated_by, updated_at)
select 'franklin-dolphins', state, 'migration', updated_at
from app_state_snapshots
order by updated_at desc
limit 1
on conflict (id) do nothing;
