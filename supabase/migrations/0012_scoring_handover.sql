-- Handing scoring to a teammate mid-match, without giving them your phone.
-- The scorer makes a one-time link; whoever opens it (signed in) becomes a scorer for that
-- one match only, and carries on from the last synced ball.
-- Paste into Supabase: SQL Editor → New query → Run. Safe to run more than once.

create table if not exists public.match_scorers (
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  added_by uuid references auth.users (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (match_id, user_id)
);
create index if not exists match_scorers_user_idx on public.match_scorers (user_id);
alter table public.match_scorers enable row level security;
drop policy if exists "see own" on public.match_scorers;
create policy "see own" on public.match_scorers for select to authenticated using (user_id = (select auth.uid()));
-- No write policies: take_handover adds rows.

-- Tournament organisers and scorers, plus anyone handed this one match.
create or replace function public.can_score(m uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role(public.match_tournament(m), '{organiser,scorer}')
    or exists (select 1 from public.match_scorers s where s.match_id = m and s.user_id = (select auth.uid()));
$$;
revoke execute on function public.can_score(uuid) from public, anon;
grant execute on function public.can_score(uuid) to authenticated;

alter policy "scorer adds" on public.match_events with check (public.can_score(match_id));
alter policy "scorer fixes" on public.match_events using (public.can_score(match_id));
alter policy "scorer undoes" on public.match_events using (public.can_score(match_id));
alter policy "organiser or scorer edits" on public.matches using (public.can_score(id)) with check (public.can_score(id));

create table if not exists public.match_handovers (
  code uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.match_handovers enable row level security;
-- No policies: only the functions below read or write it.

-- A one-time hand-over code for a match. Only someone scoring it can make one.
create or replace function public.make_handover(m uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  if not public.can_score(m) then
    raise exception 'Only the scorers of this match can hand it over.' using errcode = '42501';
  end if;
  delete from public.match_handovers where match_id = m and created_at < now() - interval '1 day';
  insert into public.match_handovers (match_id) values (m) returning code into c;
  return c;
end $$;

-- The signed-in user becomes a scorer for the match behind the code (used once, valid a day).
create or replace function public.take_handover(code uuid) returns json
language plpgsql security definer set search_path = public as $$
declare h public.match_handovers; t uuid;
begin
  if (select auth.uid()) is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into h from public.match_handovers where match_handovers.code = take_handover.code and created_at > now() - interval '1 day';
  if h.code is null then raise exception 'This hand-over link has been used or is too old. Ask for a new one.' using errcode = 'P0002'; end if;
  delete from public.match_handovers where match_handovers.code = h.code;
  insert into public.match_scorers (match_id, user_id, added_by) values (h.match_id, (select auth.uid()), h.created_by) on conflict do nothing;
  select tournament_id into t from public.matches where id = h.match_id;
  return json_build_object('match', h.match_id, 'tournament', t);
end $$;

revoke execute on function public.make_handover(uuid) from public, anon;
revoke execute on function public.take_handover(uuid) from public, anon;
grant execute on function public.make_handover(uuid) to authenticated;
grant execute on function public.take_handover(uuid) to authenticated;

-- Card alerts can come from a handed-over scorer too.
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
      where tm.tournament_id = mt.tournament_id and tm.role in ('organiser', 'scorer')
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
