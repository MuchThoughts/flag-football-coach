-- Optional: copy an old per-team snapshot into the shared dataset.
--
-- Only needed if you were syncing before accounts were removed AND you want to
-- seed the cloud from the database rather than from a phone. Skipping this file
-- is the simpler path: leave the shared row empty and the first device to open
-- the app publishes whatever it has, which is usually the copy you can see is
-- correct.
--
-- Do NOT seed by "most recently updated". Every device that ever signed up got
-- its own team, so the newest snapshot may belong to an assistant whose team
-- was never used, and copying that in would replace the real data with an
-- untouched default.

-- STEP 1 — look at what is there and decide which team is the real one.
-- Run this on its own first:
--
--   select team_id,
--          updated_at,
--          state->'team'->>'name'                     as team_name,
--          jsonb_array_length(state->'players')       as players,
--          jsonb_array_length(state->'games')         as games,
--          jsonb_array_length(state->'plays')         as plays,
--          jsonb_array_length(state->'formations')    as formations,
--          (select count(*)
--             from jsonb_array_elements(state->'lineups') lineup,
--                  jsonb_each(lineup->'assignments') spot
--            where spot.value <> 'null'::jsonb)       as filled_spots,
--          length(state::text)                        as size_bytes
--     from app_state_snapshots
--    order by size_bytes desc;
--
-- The real dataset is the one whose numbers match the app you have been using:
-- the games you have played, the plays you have written, the most filled spots.

-- STEP 2 — put that team_id below and run this block.
do $$
declare
  -- ▼▼▼ REPLACE with the team_id from step 1 ▼▼▼
  source_team_id uuid := '00000000-0000-0000-0000-000000000000';
begin
  if to_regclass('public.app_state_snapshots') is null then
    raise notice 'No app_state_snapshots table — nothing to copy.';
    return;
  end if;

  insert into shared_app_state (id, state, updated_by, updated_at)
  select 'franklin-dolphins', state, 'migration', updated_at
    from app_state_snapshots
   where team_id = source_team_id
  -- Re-running replaces the shared row, so a wrong pick can be corrected by
  -- fixing the id above and running this block again.
  on conflict (id) do update
    set state = excluded.state,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  if not found then
    raise exception 'No snapshot found for team_id %. Check step 1.', source_team_id;
  end if;
end
$$;
