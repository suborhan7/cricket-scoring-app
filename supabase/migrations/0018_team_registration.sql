-- Team registration can be closed: by the organiser with a switch, or by a deadline.
-- Once it is closed, captains can't ask to join and invite links stop adding teams.
-- Organisers can still add a team themselves or accept a request that was already waiting.
-- Paste into Supabase: SQL Editor → New query → Run. Safe to run more than once.

alter table public.tournaments add column if not exists registration_closed boolean not null default false;
alter table public.tournaments add column if not exists registration_deadline timestamptz;

create or replace function public.registration_open(tr public.tournaments) returns boolean
language sql stable set search_path = public as $$
  select not coalesce(tr.registration_closed, false)
     and (tr.registration_deadline is null or now() < tr.registration_deadline);
$$;

create or replace function public.request_to_join(t uuid, team uuid, note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare tr public.tournaments; tm public.teams; req uuid;
begin
  if (select auth.uid()) is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into tr from public.tournaments where id = t;
  select * into tm from public.teams where id = team;
  if tr.id is null or tm.id is null then raise exception 'Tournament or team not found.' using errcode = 'P0002'; end if;
  if not public.can_manage_team(team) then
    raise exception 'Only the team''s captain or creator can ask to join.' using errcode = '42501';
  end if;
  if exists (select 1 from public.tournament_teams where tournament_id = t and team_id = team) then
    raise exception '% is already in this tournament.', tm.name using errcode = '23505';
  end if;
  if not public.registration_open(tr) then
    raise exception 'Team registration for % is closed.', coalesce(tr.short_name, tr.name) using errcode = '42501';
  end if;
  if not tr.open_to_requests then
    raise exception 'This tournament isn''t taking join requests. Ask the organiser for an invite link.' using errcode = '42501';
  end if;
  insert into public.join_requests (tournament_id, team_id, requested_by, note)
    values (t, team, (select auth.uid()), left(nullif(trim(note), ''), 200))
    on conflict (tournament_id, team_id) do update
      set status = 'pending', requested_by = excluded.requested_by, note = excluded.note, created_at = now(), answered_at = null
      where public.join_requests.status <> 'pending'
    returning id into req;
  if req is null then return 'pending'; end if; -- already waiting
  insert into public.notifications (user_id, kind, title, body, data, dedupe)
  select m.user_id, 'join_request', left(tm.name || ' wants to join', 120), left(coalesce(tr.short_name, tr.name), 300),
    jsonb_build_object('tournament', t, 'team', team, 'request', req), 'join:' || req || ':' || extract(epoch from now())::bigint
  from public.tournament_members m
  where m.tournament_id = t and m.role = 'organiser' and m.user_id <> (select auth.uid())
  on conflict (user_id, dedupe) do nothing;
  return 'sent';
end $$;

create or replace function public.join_with_invite(invite uuid, team uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid; tm public.teams; tr public.tournaments;
begin
  if (select auth.uid()) is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select tournament_id into t from public.tournament_invites where code = invite;
  if t is null then raise exception 'This invite link is not valid any more.' using errcode = 'P0002'; end if;
  select * into tr from public.tournaments where id = t;
  if not public.registration_open(tr) then
    raise exception 'Team registration for % is closed.', coalesce(tr.short_name, tr.name) using errcode = '42501';
  end if;
  select * into tm from public.teams where id = team;
  if tm.id is null then raise exception 'Team not found.' using errcode = 'P0002'; end if;
  if not public.can_manage_team(team) then
    raise exception 'Only the team''s captain or creator can enter it.' using errcode = '42501';
  end if;
  insert into public.tournament_teams (tournament_id, team_id) values (t, team) on conflict do nothing;
  update public.join_requests set status = 'accepted', answered_at = now() where tournament_id = t and team_id = team and status = 'pending';
  insert into public.notifications (user_id, kind, title, body, data, dedupe)
  select m.user_id, 'join_request', left(tm.name || ' joined', 120), 'They used your invite link.',
    jsonb_build_object('tournament', t, 'team', team), 'joined:' || t || ':' || team
  from public.tournament_members m
  where m.tournament_id = t and m.role = 'organiser' and m.user_id <> (select auth.uid())
  on conflict (user_id, dedupe) do nothing;
  return t;
end $$;

revoke execute on function public.request_to_join(uuid, uuid, text) from public, anon;
revoke execute on function public.join_with_invite(uuid, uuid) from public, anon;
grant execute on function public.request_to_join(uuid, uuid, text) to authenticated;
grant execute on function public.join_with_invite(uuid, uuid) to authenticated;
