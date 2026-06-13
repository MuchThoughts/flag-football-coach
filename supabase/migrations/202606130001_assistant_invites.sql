-- Assistant coach invite support.
-- Run this after the initial schema has already been applied.

create table if not exists team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  email text not null default '',
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  role team_role not null default 'assistant_coach',
  can_add_notes boolean not null default true,
  can_advance_drive boolean not null default false,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists team_invites_team_id_idx on team_invites(team_id);
create index if not exists team_invites_token_idx on team_invites(token);

alter table team_invites enable row level security;

create or replace function create_team_invite(
  target_team_id uuid,
  invite_email text,
  invite_can_add_notes boolean default true,
  invite_can_advance_drive boolean default false
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_token text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not is_head_coach(target_team_id) then
    raise exception 'Only head coaches can invite assistants';
  end if;

  insert into team_invites (
    team_id,
    email,
    role,
    can_add_notes,
    can_advance_drive,
    created_by
  )
  values (
    target_team_id,
    lower(trim(coalesce(invite_email, ''))),
    'assistant_coach',
    invite_can_add_notes,
    invite_can_advance_drive,
    auth.uid()
  )
  returning token into invite_token;

  return invite_token;
end;
$$;

create or replace function accept_team_invite(invite_token text)
returns table (
  team_id uuid,
  role team_role,
  can_add_notes boolean,
  can_advance_drive boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  invite team_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into invite
  from team_invites
  where token = trim(invite_token)
    and accepted_at is null
    and expires_at > now();

  if invite.id is null then
    raise exception 'Invite not found or expired';
  end if;

  insert into team_members (
    team_id,
    user_id,
    role,
    can_add_notes,
    can_advance_drive
  )
  values (
    invite.team_id,
    auth.uid(),
    invite.role,
    invite.can_add_notes,
    invite.can_advance_drive
  )
  on conflict (team_id, user_id) do update
  set
    role = excluded.role,
    can_add_notes = excluded.can_add_notes,
    can_advance_drive = excluded.can_advance_drive;

  update team_invites
  set
    accepted_by = auth.uid(),
    accepted_at = now()
  where id = invite.id;

  return query
  select
    invite.team_id,
    invite.role,
    invite.can_add_notes,
    invite.can_advance_drive;
end;
$$;

grant execute on function create_team_invite(uuid, text, boolean, boolean) to authenticated;
grant execute on function accept_team_invite(text) to authenticated;

drop policy if exists "team invites select for head coach" on team_invites;
create policy "team invites select for head coach" on team_invites
for select using (is_head_coach(team_id));

drop policy if exists "team invites insert for head coach" on team_invites;
create policy "team invites insert for head coach" on team_invites
for insert with check (is_head_coach(team_id));

drop policy if exists "team invites update for head coach" on team_invites;
create policy "team invites update for head coach" on team_invites
for update using (is_head_coach(team_id))
with check (is_head_coach(team_id));
