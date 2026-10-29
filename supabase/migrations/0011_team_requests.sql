-- Players ask to join a team; the team's captain or creator accepts or declines.
-- (Needs 0010 first: it makes captains team managers and adds the joining alerts.)
-- Paste into Supabase: SQL Editor → New query → Run. Safe to run more than once.

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('milestone', 'result', 'join_request', 'join_answer', 'team_join', 'team_request', 'team_answer'));

create table if not exists public.team_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  requested_by uuid default auth.uid() references auth.users (id) on delete set null,
  note text check (char_length(note) <= 200),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  unique (team_id, player_id)
);
create index if not exists team_requests_player_idx on public.team_requests (player_id);

alter table public.team_requests enable row level security;
drop policy if exists "see own or managed" on public.team_requests;
create policy "see own or managed" on public.team_requests for select to authenticated
  using (requested_by = (select auth.uid()) or public.can_manage_team(team_id));
-- No write policies: the two functions below do the writing.

-- The signed-in user's own player profile asks to join the team.
create or replace function public.request_team_join(team uuid, note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare tm public.teams; me public.players; req uuid;
begin
  if (select auth.uid()) is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into tm from public.teams where id = team;
  if tm.id is null then raise exception 'Team not found.' using errcode = 'P0002'; end if;
  select * into me from public.players where claimed_by = (select auth.uid());
  if me.id is null then raise exception 'Set up your player profile first.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.team_players where team_id = team and player_id = me.id) then
    raise exception 'You are already in %.', tm.name using errcode = '23505';
  end if;
  insert into public.team_requests (team_id, player_id, requested_by, note)
    values (team, me.id, (select auth.uid()), left(nullif(trim(note), ''), 200))
    on conflict (team_id, player_id) do update
      set status = 'pending', requested_by = excluded.requested_by, note = excluded.note, created_at = now(), answered_at = null
      where public.team_requests.status <> 'pending'
    returning id into req;
  if req is null then return 'pending'; end if;
  insert into public.notifications (user_id, kind, title, body, data, dedupe)
  select distinct r.uid, 'team_request', left(me.full_name || ' wants to join ' || tm.name, 120), coalesce(left(nullif(trim(note), ''), 300), 'Accept or decline on the team page.'),
    jsonb_build_object('team', team, 'request', req), 'teamreq:' || req || ':' || extract(epoch from now())::bigint
  from (
    select tm.created_by as uid
    union select p.claimed_by from public.players p where p.id = tm.captain_player_id
  ) r
  where r.uid is not null and r.uid <> (select auth.uid())
  on conflict (user_id, dedupe) do nothing;
  return 'sent';
end $$;

create or replace function public.answer_team_request(req uuid, accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r public.team_requests; tm public.teams;
begin
  select * into r from public.team_requests where id = req;
  if r.id is null then raise exception 'That request is gone.' using errcode = 'P0002'; end if;
  if not public.can_manage_team(r.team_id) then
    raise exception 'Only the team''s captain or creator can answer.' using errcode = '42501';
  end if;
  update public.team_requests set status = case when accept then 'accepted' else 'declined' end, answered_at = now() where id = req;
  if accept then
    insert into public.team_players (team_id, player_id) values (r.team_id, r.player_id) on conflict do nothing;
  end if;
  select * into tm from public.teams where id = r.team_id;
  if r.requested_by is not null and r.requested_by <> (select auth.uid()) then
    insert into public.notifications (user_id, kind, title, body, data, dedupe)
    values (r.requested_by, 'team_answer',
      left(case when accept then 'You''re in ' || tm.name else tm.name || ' declined your request' end, 120),
      case when accept then 'You can now be picked for their matches.' else 'Ask the captain directly, or try another team.' end,
      jsonb_build_object('team', r.team_id), 'teamans:' || req || ':' || extract(epoch from now())::bigint)
    on conflict (user_id, dedupe) do nothing;
  end if;
end $$;

revoke execute on function public.request_team_join(uuid, text) from public, anon;
revoke execute on function public.answer_team_request(uuid, boolean) from public, anon;
grant execute on function public.request_team_join(uuid, text) to authenticated;
grant execute on function public.answer_team_request(uuid, boolean) to authenticated;
