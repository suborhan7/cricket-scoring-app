-- Cricket Scorer database.
-- Paste into Supabase: SQL Editor → New query → Run. Safe to run once on a new project.
--
-- Who can do what:
--   anyone (even logged out)      reads tournaments, teams, players, matches and every ball
--   any logged-in user            creates a tournament, a team or a player
--   tournament organiser          edits their tournament, adds teams, fixtures and scorers
--   tournament scorer             scores and fixes balls in that tournament's matches
--   team creator                  edits the team and its squad
--   player creator / claimed user edits the player profile

-- ---------- Profiles ----------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  avatar_path text,
  created_at timestamptz not null default now()
);

-- Every new sign-up gets a profile row.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1), ''));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Tournaments ----------

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 80),
  short_name text check (length(short_name) <= 12),
  kind text not null default 'tournament' check (kind in ('tournament', 'series')),
  logo_path text,                         -- file in the "logos" storage bucket
  primary_color text check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color text check (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  overs_per_side int not null default 20 check (overs_per_side between 1 and 100),
  balls_per_over int not null default 6 check (balls_per_over between 4 and 8),
  max_overs_per_bowler int check (max_overs_per_bowler >= 1),
  starts_on date,
  ends_on date,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.tournament_members (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('organiser', 'scorer', 'media')),
  added_at timestamptz not null default now(),
  primary key (tournament_id, user_id, role)
);

-- The creator becomes the first organiser.
create function public.add_creator_as_organiser() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.tournament_members (tournament_id, user_id, role) values (new.id, new.created_by, 'organiser');
  return new;
end $$;

create trigger on_tournament_created after insert on public.tournaments
  for each row execute function public.add_creator_as_organiser();

-- True when the logged-in user holds one of the roles in the tournament.
-- security definer so the policies below can call it without looping through their own rules.
create function public.has_role(t uuid, roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tournament_members m
    where m.tournament_id = t and m.user_id = auth.uid() and m.role = any (roles)
  );
$$;

-- ---------- Teams and players ----------
-- A team is created once and can join many tournaments.

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 60),
  short_name text not null check (length(short_name) between 1 and 5),
  logo_path text,
  primary_color text check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color text check (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  captain_player_id uuid,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) between 2 and 60),
  photo_path text,                        -- file in the "photos" storage bucket
  role text check (role in ('batter', 'bowler', 'allrounder', 'keeper')),
  batting_style text check (batting_style in ('right', 'left')),
  bowling_style text,
  jersey_no int check (jersey_no between 0 and 999),
  claimed_by uuid unique references auth.users (id) on delete set null, -- the player's own account
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);

alter table public.teams add constraint teams_captain_fk foreign key (captain_player_id) references public.players (id) on delete set null;

create table public.team_players (
  team_id uuid not null references public.teams (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (team_id, player_id)
);

create table public.tournament_teams (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  group_name text,                        -- e.g. 'A'; the organiser sets this by hand
  primary key (tournament_id, team_id)
);

-- ---------- Matches ----------

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  team1_id uuid not null references public.teams (id),
  team2_id uuid not null references public.teams (id),
  stage text not null default 'group' check (stage in ('group', 'quarter', 'semi', 'final', 'series', 'other')),
  match_no int,
  starts_at timestamptz,
  venue text,
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'done', 'abandoned')),
  -- Match rules copied from the tournament when the match starts, so a later change
  -- to the tournament never rewrites an old scorecard.
  rules jsonb not null default '{}'::jsonb,
  -- Who played: {"teams": [{"team_id": "...", "players": ["player uuid", ...]}, {...}]}.
  -- Ball events name players by their position in these lists, as js/engine.js does.
  lineups jsonb,
  toss jsonb,                             -- {"winner": 0|1, "decision": "bat"|"bowl"}
  batting_first smallint check (batting_first in (0, 1)),
  winner_team_id uuid references public.teams (id),
  result_text text,
  created_at timestamptz not null default now(),
  check (team1_id <> team2_id)
);

create index matches_tournament_idx on public.matches (tournament_id, starts_at);

-- Every tap the scorer makes, in order. All scores and stats are worked out from these.
create table public.match_events (
  match_id uuid not null references public.matches (id) on delete cascade,
  seq int not null check (seq >= 0),
  event jsonb not null check (event ? 't'),
  created_by uuid default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  primary key (match_id, seq)
);

-- History of corrections: every change or removal of a saved ball is kept here.
create table public.event_edits (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches (id) on delete cascade,
  seq int not null,
  old_event jsonb not null,
  new_event jsonb,                        -- null when the event was removed (undo)
  edited_by uuid default auth.uid(),
  edited_at timestamptz not null default now()
);

create function public.log_event_edit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.event is distinct from old.event then
    insert into public.event_edits (match_id, seq, old_event, new_event) values (old.match_id, old.seq, old.event, new.event);
  elsif tg_op = 'DELETE' then
    insert into public.event_edits (match_id, seq, old_event, new_event) values (old.match_id, old.seq, old.event, null);
  end if;
  return coalesce(new, old);
end $$;

create trigger on_event_changed after update or delete on public.match_events
  for each row execute function public.log_event_edit();

-- The tournament a match belongs to (used by the rules below).
create function public.match_tournament(m uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select tournament_id from public.matches where id = m;
$$;

-- ---------- Row level security ----------

alter table public.profiles enable row level security;
alter table public.tournaments enable row level security;
alter table public.tournament_members enable row level security;
alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.team_players enable row level security;
alter table public.tournament_teams enable row level security;
alter table public.matches enable row level security;
alter table public.match_events enable row level security;
alter table public.event_edits enable row level security;

-- Everything is public to read: fans follow scores without an account.
create policy "read" on public.profiles for select using (true);
create policy "read" on public.tournaments for select using (true);
create policy "read" on public.tournament_members for select using (true);
create policy "read" on public.teams for select using (true);
create policy "read" on public.players for select using (true);
create policy "read" on public.team_players for select using (true);
create policy "read" on public.tournament_teams for select using (true);
create policy "read" on public.matches for select using (true);
create policy "read" on public.match_events for select using (true);
create policy "read" on public.event_edits for select using (true);

create policy "own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy "create" on public.tournaments for insert to authenticated with check (created_by = auth.uid());
create policy "organiser edits" on public.tournaments for update using (public.has_role(id, '{organiser}')) with check (public.has_role(id, '{organiser}'));
create policy "organiser deletes" on public.tournaments for delete using (public.has_role(id, '{organiser}'));

create policy "organiser adds" on public.tournament_members for insert to authenticated with check (public.has_role(tournament_id, '{organiser}'));
create policy "organiser removes" on public.tournament_members for delete using (public.has_role(tournament_id, '{organiser}') or user_id = auth.uid());

create policy "create" on public.teams for insert to authenticated with check (created_by = auth.uid());
create policy "creator edits" on public.teams for update using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy "creator deletes" on public.teams for delete using (created_by = auth.uid());

create policy "create" on public.players for insert to authenticated with check (created_by = auth.uid());
create policy "creator or player edits" on public.players for update using (created_by = auth.uid() or claimed_by = auth.uid());

create policy "team creator adds" on public.team_players for insert to authenticated
  with check (exists (select 1 from public.teams t where t.id = team_id and t.created_by = auth.uid()));
create policy "team creator removes" on public.team_players for delete
  using (exists (select 1 from public.teams t where t.id = team_id and t.created_by = auth.uid()));

create policy "organiser adds" on public.tournament_teams for insert to authenticated with check (public.has_role(tournament_id, '{organiser}'));
create policy "organiser edits" on public.tournament_teams for update using (public.has_role(tournament_id, '{organiser}'));
create policy "organiser removes" on public.tournament_teams for delete using (public.has_role(tournament_id, '{organiser}'));

create policy "organiser creates" on public.matches for insert to authenticated with check (public.has_role(tournament_id, '{organiser}'));
create policy "organiser or scorer edits" on public.matches for update
  using (public.has_role(tournament_id, '{organiser,scorer}')) with check (public.has_role(tournament_id, '{organiser,scorer}'));
create policy "organiser deletes" on public.matches for delete using (public.has_role(tournament_id, '{organiser}'));

create policy "scorer adds" on public.match_events for insert to authenticated
  with check (public.has_role(public.match_tournament(match_id), '{organiser,scorer}'));
create policy "scorer fixes" on public.match_events for update
  using (public.has_role(public.match_tournament(match_id), '{organiser,scorer}'));
create policy "scorer undoes" on public.match_events for delete
  using (public.has_role(public.match_tournament(match_id), '{organiser,scorer}'));

-- ---------- Storage: logos and player photos ----------
-- Public to view. Each user uploads into a folder named after their user id.

insert into storage.buckets (id, name, public) values ('logos', 'logos', true), ('photos', 'photos', true)
  on conflict (id) do nothing;

create policy "upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id in ('logos', 'photos') and (storage.foldername(name))[1] = auth.uid()::text);
create policy "replace own files" on storage.objects for update to authenticated
  using (bucket_id in ('logos', 'photos') and owner = auth.uid());
create policy "delete own files" on storage.objects for delete to authenticated
  using (bucket_id in ('logos', 'photos') and owner = auth.uid());
