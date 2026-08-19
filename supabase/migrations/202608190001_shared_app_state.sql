-- One shared dataset for the whole coaching staff: no accounts, no sign-in.
-- Every device reads, writes and listens to a single row.
--
-- Safe to run more than once. It creates the table but deliberately does NOT
-- copy any old data in: see 202608190002_seed_shared_state.sql for that, which
-- asks you to name the team to copy rather than guessing.

create table if not exists shared_app_state (
  id text primary key,
  state jsonb not null,
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);

alter table shared_app_state enable row level security;

-- The app ships its publishable key to every device on purpose: opening the
-- app is joining the team, so anonymous reads and writes are the product.
drop policy if exists "shared state is readable by anyone" on shared_app_state;
create policy "shared state is readable by anyone"
  on shared_app_state for select
  using (true);

drop policy if exists "shared state is writable by anyone" on shared_app_state;
create policy "shared state is writable by anyone"
  on shared_app_state for insert
  with check (true);

drop policy if exists "shared state is updatable by anyone" on shared_app_state;
create policy "shared state is updatable by anyone"
  on shared_app_state for update
  using (true);

-- Live updates reach every open device. Adding a table that is already in the
-- publication is an error, so only add it when it is missing.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shared_app_state'
  ) then
    alter publication supabase_realtime add table shared_app_state;
  end if;
end
$$;
