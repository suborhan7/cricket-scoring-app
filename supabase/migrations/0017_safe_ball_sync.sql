-- Safe ball syncing. The scoring app sends a whole sync (balls, undo, result, summary, live
-- score) through sync_match, which saves it in one go and only if nobody else has saved balls
-- for that match since this phone last synced. So two phones can't overwrite each other's
-- balls, and a dropped connection can't leave half a sync behind.
-- Fans download only the balls that changed since their last look (match_events.v).
-- Paste into Supabase: SQL Editor → New query → Run. Safe to run more than once.

-- Goes up by one with every sync of a match.
alter table public.matches add column if not exists events_version int not null default 0;
-- How many entries the match has after the last sync, so fans can drop removed balls.
alter table public.matches add column if not exists events_count int;
-- The sync that last wrote this ball.
alter table public.match_events add column if not exists v int not null default 0;

-- m: the match. expected: the version this phone last synced (null for a phone that synced
-- before this update; it skips the check once). keep: entries from this number on are removed
-- (undo). balls: [{seq, event}] to add or change. upd: match columns to set (status,
-- result_text, winner_team_id, summary, live); a key left out keeps its value.
-- Returns {"ok": true, "version": n}, or {"ok": false, "version": n} when another phone got
-- there first; that phone's balls are then loaded instead.
create or replace function public.sync_match(m uuid, expected int, keep int, balls jsonb, upd jsonb)
returns json language plpgsql set search_path = public as $$
declare cur int; nv int;
begin
  if not public.can_score(m) then
    raise exception 'Only the scorers of this match can save balls.' using errcode = '42501';
  end if;
  select events_version into cur from public.matches where id = m for update;
  if not found then
    raise exception 'Match not found.' using errcode = 'P0002';
  end if;
  if expected is not null and expected <> cur then
    return json_build_object('ok', false, 'version', cur);
  end if;
  nv := cur + 1;

  delete from public.match_events where match_id = m and seq >= keep;
  insert into public.match_events (match_id, seq, event, v)
    select m, (r->>'seq')::int, r->'event', nv from jsonb_array_elements(coalesce(balls, '[]'::jsonb)) r
  on conflict (match_id, seq) do update set event = excluded.event, v = excluded.v
    where match_events.event is distinct from excluded.event;

  update public.matches set
    events_version = nv,
    events_count = keep,
    status = case when upd ? 'status' then upd->>'status' else status end,
    result_text = case when upd ? 'result_text' then upd->>'result_text' else result_text end,
    winner_team_id = case when upd ? 'winner_team_id' then (upd->>'winner_team_id')::uuid else winner_team_id end,
    summary = case when upd ? 'summary' then upd->'summary' else summary end,
    live = case when upd ? 'live' then upd->'live' else live end
  where id = m;
  return json_build_object('ok', true, 'version', nv);
end $$;
revoke execute on function public.sync_match(uuid, int, int, jsonb, jsonb) from public, anon;
grant execute on function public.sync_match(uuid, int, int, jsonb, jsonb) to authenticated;
