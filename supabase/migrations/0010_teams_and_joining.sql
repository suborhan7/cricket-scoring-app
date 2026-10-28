-- Teams run themselves and join tournaments.
--   * Everyone can have their own player profile (a player row they own through claimed_by).
--   * A team's creator or its captain manages the team, and can invite players with a link.
--   * Tournaments get a username (@handle). A team can ask to join, and an organiser accepts
--     or declines. Organisers can also share an invite link that adds a team straight away.
-- Paste into Supabase: SQL Editor → New query → Run. Safe to run more than once.

-- ---------- Tournament username ----------

alter table public.tournaments add column if not exists handle text;
alter table public.tournaments add column if not exists open_to_requests boolean not null default true;
alter table public.tournaments drop constraint if exists tournaments_handle_check;
alter table public.tournaments add constraint tournaments_handle_check check (handle ~ '^[a-z0-9_]{3,24}$');
create unique index if not exists tournaments_handle_key on public.tournaments (handle);

-- ---------- Who links a player to an account ----------
-- A new player row may be linked only to the person creating it (their own profile).
-- After that only claim_player (an invite) links it, and only the player can unlink themselves.

-- Runs as the caller (not security definer), so current_user tells app requests apart.
create or replace function public.guard_player_claim() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user::text not in ('anon', 'authenticated') then return new; end if; -- functions like claim_player
  if tg_op = 'INSERT' then
    if new.claimed_by is not null and new.claimed_by is distinct from (select auth.uid()) then
      raise exception 'You can only link a player profile to your own account.' using errcode = '42501';
    end if;
  elsif new.claimed_by is distinct from old.claimed_by
    and not (new.claimed_by is null and old.claimed_by = (select auth.uid())) then
    raise exception 'Players link their own profile with an invite link.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.guard_player_claim() from public, anon, authenticated;
drop trigger if exists guard_player_claim on public.players;
create trigger guard_player_claim before insert or update on public.players
  for each row execute function public.guard_player_claim();

-- ---------- Who manages a team: its creator, its captain, or an organiser it plays for ----------

create or replace function public.can_manage_team(tm uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.teams where id = tm and created_by = (select auth.uid()))
    or exists (
      select 1 from public.teams t join public.players p on p.id = t.captain_player_id
      where t.id = tm and p.claimed_by = (select auth.uid()))
    or exists (
      select 1 from public.tournament_teams tt
      join public.tournament_members m on m.tournament_id = tt.tournament_id
      where tt.team_id = tm and m.user_id = (select auth.uid()) and m.role = 'organiser');
$$;

-- The captain can also edit the players in their squad.
create or replace function public.can_manage_player(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.players where id = p and created_by = (select auth.uid()))
    or exists (select 1 from public.team_players tp where tp.player_id = p and public.can_manage_team(tp.team_id));
$$;

-- Only the policies for signed-in writes use these two.
revoke execute on function public.can_manage_team(uuid) from public, anon;
revoke execute on function public.can_manage_player(uuid) from public, anon;
grant execute on function public.can_manage_team(uuid) to authenticated;
grant execute on function public.can_manage_player(uuid) to authenticated;

-- ---------- Alerts for joining ----------

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('milestone', 'result', 'join_request', 'join_answer', 'team_join'));

-- ---------- Join requests ----------

create table if not exists public.join_requests (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  requested_by uuid default auth.uid() references auth.users (id) on delete set null,
  note text check (char_length(note) <= 200),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  unique (tournament_id, team_id)
);
create index if not exists join_requests_team_idx on public.join_requests (team_id);

alter table public.join_requests enable row level security;
drop policy if exists "see own or organised" on public.join_requests;
create policy "see own or organised" on public.join_requests for select to authenticated
  using (requested_by = (select auth.uid()) or public.has_role(tournament_id, '{organiser}') or public.can_manage_team(team_id));
-- No write policies: request_to_join and answer_join_request below do the writing.

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

create or replace function public.answer_join_request(req uuid, accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r public.join_requests; tr public.tournaments; tm public.teams;
begin
  select * into r from public.join_requests where id = req;
  if r.id is null then raise exception 'That request is gone.' using errcode = 'P0002'; end if;
  if not public.has_role(r.tournament_id, '{organiser}') then
    raise exception 'Only organisers can answer join requests.' using errcode = '42501';
  end if;
  update public.join_requests set status = case when accept then 'accepted' else 'declined' end, answered_at = now() where id = req;
  if accept then
    insert into public.tournament_teams (tournament_id, team_id) values (r.tournament_id, r.team_id) on conflict do nothing;
  end if;
  select * into tr from public.tournaments where id = r.tournament_id;
  select * into tm from public.teams where id = r.team_id;
  if r.requested_by is not null and r.requested_by <> (select auth.uid()) then
    insert into public.notifications (user_id, kind, title, body, data, dedupe)
    values (r.requested_by, 'join_answer',
      left(case when accept then tm.name || ' is in ' || coalesce(tr.short_name, tr.name) else coalesce(tr.short_name, tr.name) || ' declined ' || tm.name end, 120),
      case when accept then 'Your team can now be picked for fixtures.' else 'You can ask the organiser directly or try again later.' end,
      jsonb_build_object('tournament', r.tournament_id, 'team', r.team_id), 'answer:' || req || ':' || extract(epoch from now())::bigint)
    on conflict (user_id, dedupe) do nothing;
  end if;
end $$;

-- ---------- Tournament invite links ----------
-- The code lives outside the public tournaments table, like player invites.

create table if not exists public.tournament_invites (
  tournament_id uuid primary key references public.tournaments (id) on delete cascade,
  code uuid not null unique default gen_random_uuid(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.tournament_invites enable row level security;

-- The invite code for a tournament. `fresh` makes a new one, so old links stop working.
create or replace function public.tournament_invite_code(t uuid, fresh boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  if not public.has_role(t, '{organiser}') then
    raise exception 'Only organisers can invite teams.' using errcode = '42501';
  end if;
  if fresh then delete from public.tournament_invites where tournament_id = t; end if;
  insert into public.tournament_invites (tournament_id) values (t) on conflict (tournament_id) do nothing;
  select code into c from public.tournament_invites where tournament_id = t;
  return c;
end $$;

-- Which tournament an invite is for, so the app can show it before a team is picked.
create or replace function public.tournament_for_invite(invite uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select tournament_id from public.tournament_invites where code = invite;
$$;

create or replace function public.join_with_invite(invite uuid, team uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid; tm public.teams;
begin
  if (select auth.uid()) is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select tournament_id into t from public.tournament_invites where code = invite;
  if t is null then raise exception 'This invite link is not valid any more.' using errcode = 'P0002'; end if;
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

-- ---------- Team invite links: players add themselves to a squad ----------

create table if not exists public.team_invites (
  team_id uuid primary key references public.teams (id) on delete cascade,
  code uuid not null unique default gen_random_uuid(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.team_invites enable row level security;

create or replace function public.team_invite_code(team uuid, fresh boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  if not public.can_manage_team(team) then
    raise exception 'Only the team''s captain or creator can invite players.' using errcode = '42501';
  end if;
  if fresh then delete from public.team_invites where team_id = team; end if;
  insert into public.team_invites (team_id) values (team) on conflict (team_id) do nothing;
  select code into c from public.team_invites where team_id = team;
  return c;
end $$;

-- The signed-in user's own player profile joins the squad behind the code.
create or replace function public.join_team(invite uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare tm public.teams; me public.players;
begin
  if (select auth.uid()) is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select t.* into tm from public.team_invites i join public.teams t on t.id = i.team_id where i.code = invite;
  if tm.id is null then raise exception 'This invite link is not valid any more.' using errcode = 'P0002'; end if;
  select * into me from public.players where claimed_by = (select auth.uid());
  if me.id is null then raise exception 'Set up your player profile first.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.team_players where team_id = tm.id and player_id = me.id) then return tm.id; end if;
  insert into public.team_players (team_id, player_id) values (tm.id, me.id);
  if tm.created_by is not null and tm.created_by <> (select auth.uid()) then
    insert into public.notifications (user_id, kind, title, body, data, dedupe)
    values (tm.created_by, 'team_join', left(me.full_name || ' joined ' || tm.name, 120), 'They used your team invite link.',
      jsonb_build_object('team', tm.id, 'player', me.id), 'teamjoin:' || tm.id || ':' || me.id)
    on conflict (user_id, dedupe) do nothing;
  end if;
  return tm.id;
end $$;

revoke execute on function public.request_to_join(uuid, uuid, text) from public, anon;
revoke execute on function public.answer_join_request(uuid, boolean) from public, anon;
revoke execute on function public.tournament_invite_code(uuid, boolean) from public, anon;
revoke execute on function public.tournament_for_invite(uuid) from public, anon;
revoke execute on function public.join_with_invite(uuid, uuid) from public, anon;
revoke execute on function public.team_invite_code(uuid, boolean) from public, anon;
revoke execute on function public.join_team(uuid) from public, anon;
grant execute on function public.request_to_join(uuid, uuid, text) to authenticated;
grant execute on function public.answer_join_request(uuid, boolean) to authenticated;
grant execute on function public.tournament_invite_code(uuid, boolean) to authenticated;
grant execute on function public.tournament_for_invite(uuid) to authenticated;
grant execute on function public.join_with_invite(uuid, uuid) to authenticated;
grant execute on function public.team_invite_code(uuid, boolean) to authenticated;
grant execute on function public.join_team(uuid) to authenticated;

-- ---------- Claiming when you already made your own profile ----------
-- Someone signs up and sets up their profile, then their captain sends the invite link for the
-- player they had already added by name. If the self-made profile hasn't played or joined a
-- squad yet, it is folded into the invited one (photo and details carried over) instead of
-- refusing the claim.

create or replace function public.claim_player(invite uuid) returns json
language plpgsql security definer set search_path = public as $$
declare p uuid; nm text; mine public.players;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select player_id into p from public.player_invites where code = invite;
  if p is null then
    raise exception 'This invite link is not valid any more.' using errcode = 'P0002';
  end if;
  select * into mine from public.players where claimed_by = (select auth.uid()) and id <> p;
  if mine.id is not null then
    if exists (select 1 from public.team_players where player_id = mine.id)
      or exists (select 1 from public.matches where jsonb_path_exists(lineups, '$.teams[*].players[*] ? (@ == $id)', jsonb_build_object('id', mine.id::text))) then
      raise exception 'Your account is already linked to another player.' using errcode = '23505';
    end if;
    update public.players set
      photo_path = coalesce(photo_path, mine.photo_path), role = coalesce(role, mine.role),
      batting_style = coalesce(batting_style, mine.batting_style), bowling_style = coalesce(bowling_style, mine.bowling_style),
      jersey_no = coalesce(jersey_no, mine.jersey_no)
    where id = p and claimed_by is null;
    delete from public.players where id = mine.id;
  end if;
  update public.players set claimed_by = (select auth.uid()) where id = p and (claimed_by is null or claimed_by = (select auth.uid()))
    returning full_name into nm;
  if nm is null then
    raise exception 'Someone has already claimed this player.' using errcode = '23505';
  end if;
  delete from public.player_invites where player_id = p;
  return json_build_object('player_id', p, 'full_name', nm);
end $$;
revoke execute on function public.claim_player(uuid) from public, anon;
grant execute on function public.claim_player(uuid) to authenticated;
