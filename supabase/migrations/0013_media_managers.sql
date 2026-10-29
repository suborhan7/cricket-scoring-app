-- Media managers: people an organiser adds with the "media" role make and share cards for the
-- tournament but can't score, fix balls or change the tournament (the rules in 0001 already
-- keep them out). This makes card-ready alerts (fifties, five-fors, results) reach them too,
-- so the person running the page hears about a card as soon as the scorer does.
-- Paste into Supabase: SQL Editor → New query → Run. Safe to run more than once.

create or replace function public.notify_card(m uuid, card_kind text, title text, body text, player uuid, card jsonb)
returns int
language plpgsql security definer set search_path = public as $$
declare
  mt public.matches;
  n int;
  key text;
begin
  select * into mt from public.matches where id = m;
  if not found then raise exception 'Match not found.' using errcode = 'no_data_found'; end if;
  if not public.can_score(m) then
    raise exception 'Only the organisers and scorers of this match can send alerts.' using errcode = 'insufficient_privilege';
  end if;
  if card_kind not in ('milestone', 'result') then raise exception 'Unknown card.' using errcode = 'check_violation'; end if;
  if pg_column_size(card) > 1000 then raise exception 'Card details too large.' using errcode = 'check_violation'; end if;
  if player is not null and not exists (
    select 1 from public.team_players where player_id = player and team_id in (mt.team1_id, mt.team2_id)) then
    raise exception 'That player is not in this match.' using errcode = 'check_violation';
  end if;
  key := card_kind || ':' || m || ':' || coalesce(card ->> 'key', '');

  insert into public.notifications (user_id, kind, title, body, data, dedupe)
  select distinct r.uid, card_kind, left(title, 120), left(coalesce(body, ''), 300),
    coalesce(card, '{}'::jsonb) || jsonb_build_object('match', m, 'tournament', mt.tournament_id), key
  from (
    select tm.user_id as uid from public.tournament_members tm
      where tm.tournament_id = mt.tournament_id and tm.role in ('organiser', 'scorer', 'media')
    union
    -- Captains: of the player's team for a milestone, of both teams for a result.
    select p.claimed_by from public.teams t join public.players p on p.id = t.captain_player_id
      where t.id in (mt.team1_id, mt.team2_id)
        and (player is null or exists (select 1 from public.team_players tp where tp.team_id = t.id and tp.player_id = player))
    union
    select p.claimed_by from public.players p where p.id = player
  ) r
  where r.uid is not null and r.uid <> (select auth.uid())
  on conflict (user_id, dedupe) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.notify_card(uuid, text, text, text, uuid, jsonb) from public, anon;
grant execute on function public.notify_card(uuid, text, text, text, uuid, jsonb) to authenticated;
