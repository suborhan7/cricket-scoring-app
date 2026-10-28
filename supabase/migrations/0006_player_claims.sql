-- Players claim their profile from an invite link, so their stats and milestone cards
-- follow their own account. The link carries a secret code kept out of the public tables.
-- Paste into Supabase: SQL Editor → New query → Run. Safe to run more than once.

create table if not exists public.player_invites (
  player_id uuid primary key references public.players (id) on delete cascade,
  code uuid not null unique default gen_random_uuid(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.player_invites enable row level security;
-- No policies: only the two functions below touch this table.

-- Who may manage a player: whoever added them, or an organiser of a tournament the player's team is in.
create or replace function public.can_manage_player(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.players where id = p and created_by = (select auth.uid()))
    or exists (
      select 1 from public.team_players tp
      join public.tournament_teams tt on tt.team_id = tp.team_id
      join public.tournament_members m on m.tournament_id = tt.tournament_id
      where tp.player_id = p and m.user_id = (select auth.uid()) and m.role = 'organiser');
$$;

-- The invite code for a player, made on first use. Only for people who manage the player.
create or replace function public.player_invite_code(p uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  if not public.can_manage_player(p) then
    raise exception 'Only the team''s organiser can invite this player.' using errcode = '42501';
  end if;
  if exists (select 1 from public.players where id = p and claimed_by is not null) then
    raise exception 'This player has already claimed their profile.' using errcode = '23505';
  end if;
  insert into public.player_invites (player_id) values (p) on conflict (player_id) do nothing;
  select code into c from public.player_invites where player_id = p;
  return c;
end $$;

-- The signed-in user becomes the player behind the code.
create or replace function public.claim_player(invite uuid) returns json
language plpgsql security definer set search_path = public as $$
declare p uuid; nm text;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select player_id into p from public.player_invites where code = invite;
  if p is null then
    raise exception 'This invite link is not valid any more.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.players where claimed_by = (select auth.uid()) and id <> p) then
    raise exception 'Your account is already linked to another player.' using errcode = '23505';
  end if;
  update public.players set claimed_by = (select auth.uid()) where id = p and (claimed_by is null or claimed_by = (select auth.uid()))
    returning full_name into nm;
  if nm is null then
    raise exception 'Someone has already claimed this player.' using errcode = '23505';
  end if;
  delete from public.player_invites where player_id = p;
  return json_build_object('player_id', p, 'full_name', nm);
end $$;

-- Organisers can also edit the players in their tournaments' teams, not only whoever added them.
alter policy "creator or player edits" on public.players
  using (claimed_by = (select auth.uid()) or public.can_manage_player(id));

-- Organisers of a tournament can edit the teams in it and their squads.
create or replace function public.can_manage_team(tm uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.teams where id = tm and created_by = (select auth.uid()))
    or exists (
      select 1 from public.tournament_teams tt
      join public.tournament_members m on m.tournament_id = tt.tournament_id
      where tt.team_id = tm and m.user_id = (select auth.uid()) and m.role = 'organiser');
$$;
alter policy "creator edits" on public.teams using (public.can_manage_team(id)) with check (public.can_manage_team(id));
alter policy "team creator adds" on public.team_players with check (public.can_manage_team(team_id));
alter policy "team creator removes" on public.team_players using (public.can_manage_team(team_id));

revoke execute on function public.player_invite_code(uuid) from public, anon;
revoke execute on function public.claim_player(uuid) from public, anon;
grant execute on function public.player_invite_code(uuid) to authenticated;
grant execute on function public.claim_player(uuid) to authenticated;
