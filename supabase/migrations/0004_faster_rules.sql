-- Speed-ups suggested by the Supabase advisor, for when many people use the app at once.
-- 1. Rules read auth.uid() once per request instead of once per row: (select auth.uid()).
-- 2. Indexes for lookups the app makes: "my tournaments", a player's teams, a team's tournaments.
-- Paste into Supabase: SQL Editor → New query → Run. Safe to run more than once.

alter policy "own profile" on public.profiles using (id = (select auth.uid())) with check (id = (select auth.uid()));
alter policy "create" on public.tournaments with check (created_by = (select auth.uid()));
alter policy "organiser removes" on public.tournament_members using (public.has_role(tournament_id, '{organiser}') or user_id = (select auth.uid()));
alter policy "create" on public.teams with check (created_by = (select auth.uid()));
alter policy "creator edits" on public.teams using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));
alter policy "creator deletes" on public.teams using (created_by = (select auth.uid()));
alter policy "create" on public.players with check (created_by = (select auth.uid()));
alter policy "creator or player edits" on public.players using (created_by = (select auth.uid()) or claimed_by = (select auth.uid()));
alter policy "team creator adds" on public.team_players
  with check (exists (select 1 from public.teams t where t.id = team_id and t.created_by = (select auth.uid())));
alter policy "team creator removes" on public.team_players
  using (exists (select 1 from public.teams t where t.id = team_id and t.created_by = (select auth.uid())));

create index if not exists tournament_members_user_idx on public.tournament_members (user_id);
create index if not exists team_players_player_idx on public.team_players (player_id);
create index if not exists tournament_teams_team_idx on public.tournament_teams (team_id);
create index if not exists matches_team1_idx on public.matches (team1_id);
create index if not exists matches_team2_idx on public.matches (team2_id);
create index if not exists event_edits_match_idx on public.event_edits (match_id, seq);
