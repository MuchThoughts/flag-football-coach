-- Youth Flag Football Coach App MVP schema
-- Apply this in Supabase after creating a project and enabling Supabase Auth.

create extension if not exists "pgcrypto";

create type team_role as enum ('head_coach', 'assistant_coach');
create type game_status as enum ('scheduled', 'in_progress', 'completed');
create type drive_unit as enum ('offense', 'defense');
create type drive_status as enum ('planned', 'current', 'completed');
create type drive_result as enum (
  'TD',
  'Stop',
  'Turnover',
  'Extra Point',
  'Punt',
  'End Half',
  'End Game',
  'TD Allowed'
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  season text not null,
  age_group text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role team_role not null default 'assistant_coach',
  can_add_notes boolean not null default true,
  can_advance_drive boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  first_name text not null,
  last_name text not null default '',
  jersey_number text not null default '',
  active boolean not null default true,
  offense_ratings jsonb not null default '{}'::jsonb,
  defense_ratings jsonb not null default '{}'::jsonb,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table games (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  opponent text not null,
  date date,
  location text not null default '',
  status game_status not null default 'scheduled',
  pattern_length integer not null default 3 check (pattern_length between 1 and 12),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table game_player_availability (
  game_id uuid not null references games(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  is_available boolean not null default true,
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (game_id, player_id)
);

create table drives (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  unit drive_unit not null,
  drive_number integer not null check (drive_number > 0),
  source_drive_id uuid references drives(id) on delete set null,
  is_repeated boolean not null default false,
  is_customized boolean not null default false,
  assignments jsonb not null default '{}'::jsonb,
  bench jsonb not null default '[]'::jsonb,
  result drive_result,
  started_at timestamptz,
  ended_at timestamptz,
  status drive_status not null default 'planned',
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id, unit, drive_number)
);

create table drive_notes (
  drive_id uuid primary key references drives(id) on delete cascade,
  what_worked text not null default '',
  what_failed text not null default '',
  player_notes text not null default '',
  play_calls text not null default '',
  result drive_result,
  freeform text not null default '',
  updated_at timestamptz not null default now()
);

create table practices (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  title text not null,
  date date,
  warmup text not null default '',
  skills text not null default '',
  offense text not null default '',
  defense text not null default '',
  scrimmage text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table practice_templates (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  title text not null,
  warmup text not null default '',
  skills text not null default '',
  offense text not null default '',
  defense text not null default '',
  scrimmage text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table plays (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null,
  formation text not null default '',
  positions text not null default '',
  notes text not null default '',
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table lineup_templates (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null,
  unit drive_unit not null,
  assignments jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, unit, name)
);

create table app_state_snapshots (
  team_id uuid primary key references teams(id) on delete cascade,
  state jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table game_actions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index players_team_id_idx on players(team_id);
create index games_team_id_idx on games(team_id);
create index drives_game_id_idx on drives(game_id);
create index practices_team_id_idx on practices(team_id);
create index plays_team_id_idx on plays(team_id);
create index lineup_templates_team_id_idx on lineup_templates(team_id);
create index app_state_snapshots_updated_at_idx on app_state_snapshots(updated_at);

alter table teams enable row level security;
alter table team_members enable row level security;
alter table players enable row level security;
alter table games enable row level security;
alter table game_player_availability enable row level security;
alter table drives enable row level security;
alter table drive_notes enable row level security;
alter table practices enable row level security;
alter table practice_templates enable row level security;
alter table plays enable row level security;
alter table lineup_templates enable row level security;
alter table app_state_snapshots enable row level security;
alter table game_actions enable row level security;

create or replace function is_team_member(target_team_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from team_members
    where team_members.team_id = target_team_id
      and team_members.user_id = auth.uid()
  );
$$;

create or replace function is_head_coach(target_team_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from team_members
    where team_members.team_id = target_team_id
      and team_members.user_id = auth.uid()
      and team_members.role = 'head_coach'
  );
$$;

create or replace function create_team_with_member(
  team_name text,
  team_season text,
  team_age_group text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_team_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  insert into teams (name, season, age_group, created_by)
  values (team_name, team_season, team_age_group, auth.uid())
  returning id into new_team_id;

  insert into team_members (team_id, user_id, role, can_add_notes, can_advance_drive)
  values (new_team_id, auth.uid(), 'head_coach', true, true);

  return new_team_id;
end;
$$;

grant execute on function create_team_with_member(text, text, text) to authenticated;

create policy "teams select for members" on teams
for select using (is_team_member(id));

create policy "teams insert for owner" on teams
for insert with check (created_by = auth.uid());

create policy "teams update for head coach" on teams
for update using (is_head_coach(id));

create policy "team members select for team" on team_members
for select using (is_team_member(team_id));

create policy "team members insert for head coach" on team_members
for insert with check (is_head_coach(team_id) or user_id = auth.uid());

create policy "team members update for head coach" on team_members
for update using (is_head_coach(team_id));

create policy "players all for members" on players
for all using (is_team_member(team_id))
with check (is_team_member(team_id));

create policy "games all for members" on games
for all using (is_team_member(team_id))
with check (is_team_member(team_id));

create policy "availability all for members" on game_player_availability
for all using (
  exists (
    select 1
    from games
    where games.id = game_player_availability.game_id
      and is_team_member(games.team_id)
  )
)
with check (
  exists (
    select 1
    from games
    where games.id = game_player_availability.game_id
      and is_team_member(games.team_id)
  )
);

create policy "drives all for members" on drives
for all using (
  exists (
    select 1
    from games
    where games.id = drives.game_id
      and is_team_member(games.team_id)
  )
)
with check (
  exists (
    select 1
    from games
    where games.id = drives.game_id
      and is_team_member(games.team_id)
  )
);

create policy "drive notes all for members" on drive_notes
for all using (
  exists (
    select 1
    from drives
    join games on games.id = drives.game_id
    where drives.id = drive_notes.drive_id
      and is_team_member(games.team_id)
  )
)
with check (
  exists (
    select 1
    from drives
    join games on games.id = drives.game_id
    where drives.id = drive_notes.drive_id
      and is_team_member(games.team_id)
  )
);

create policy "practices all for members" on practices
for all using (is_team_member(team_id))
with check (is_team_member(team_id));

create policy "practice templates all for members" on practice_templates
for all using (is_team_member(team_id))
with check (is_team_member(team_id));

create policy "plays all for members" on plays
for all using (is_team_member(team_id))
with check (is_team_member(team_id));

create policy "lineup templates all for members" on lineup_templates
for all using (is_team_member(team_id))
with check (is_team_member(team_id));

create policy "app state snapshots all for members" on app_state_snapshots
for all using (is_team_member(team_id))
with check (is_team_member(team_id));

create policy "game actions all for members" on game_actions
for all using (
  exists (
    select 1
    from games
    where games.id = game_actions.game_id
      and is_team_member(games.team_id)
  )
)
with check (
  exists (
    select 1
    from games
    where games.id = game_actions.game_id
      and is_team_member(games.team_id)
  )
);

do $$
begin
  alter publication supabase_realtime add table app_state_snapshots;
exception
  when duplicate_object then null;
end $$;
