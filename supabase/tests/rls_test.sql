-- Security rule checks. Run with: supabase/tests/run.sh (needs a local Postgres).
-- Each block acts as one user and expects the rules to allow or block it.
\set ON_ERROR_STOP on
set client_min_messages = warning;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'org@example.com', '{"full_name":"Organiser"}'),
  ('00000000-0000-0000-0000-00000000000b', 'scorer@example.com', '{}'),
  ('00000000-0000-0000-0000-00000000000c', 'stranger@example.com', '{}');

create function pg_temp.act(u text) returns void language plpgsql as $$
begin
  if u is null then perform set_config('role', 'anon', false); perform set_config('request.jwt.claim.sub', '', false);
  else perform set_config('role', 'authenticated', false); perform set_config('request.jwt.claim.sub', u, false); end if;
end $$;

-- A blocked write must fail; this runs it and raises if it went through.
create function pg_temp.blocked(q text) returns void language plpgsql as $$
declare n int;
begin
  begin
    execute q; get diagnostics n = row_count;
  exception when insufficient_privilege or check_violation then return; -- blocked as expected
  end;
  if n > 0 then raise exception 'should have been blocked: %', q; end if;
end $$;

-- Organiser creates a tournament, two teams, players, and a match.
select pg_temp.act('00000000-0000-0000-0000-00000000000a');
insert into public.tournaments (id, name, overs_per_side) values ('10000000-0000-0000-0000-000000000001', 'Winter Cup', 10);
do $$ begin
  if not public.has_role('10000000-0000-0000-0000-000000000001', '{organiser}') then raise exception 'creator is not organiser'; end if;
end $$;
insert into public.teams (id, name, short_name) values ('20000000-0000-0000-0000-000000000001', 'Shapla Strikers', 'SS'), ('20000000-0000-0000-0000-000000000002', 'Padma Warriors', 'PW');
insert into public.players (id, full_name) values ('30000000-0000-0000-0000-000000000001', 'Tanvir Ahmed');
insert into public.team_players values ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001');
insert into public.tournament_teams (tournament_id, team_id, group_name) values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'A'), ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'A');
insert into public.matches (id, tournament_id, team1_id, team2_id) values ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002');
insert into public.tournament_members (tournament_id, user_id, role) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'scorer');

-- Scorer scores, fixes a ball, and undoes one; the history keeps both changes.
select pg_temp.act('00000000-0000-0000-0000-00000000000b');
insert into public.match_events (match_id, seq, event) values
  ('40000000-0000-0000-0000-000000000001', 0, '{"t":"openers","striker":0,"nonStriker":1,"bowler":10}'),
  ('40000000-0000-0000-0000-000000000001', 1, '{"t":"ball","runs":4}'),
  ('40000000-0000-0000-0000-000000000001', 2, '{"t":"ball","runs":1}');
update public.match_events set event = '{"t":"ball","runs":6}' where match_id = '40000000-0000-0000-0000-000000000001' and seq = 1;
delete from public.match_events where match_id = '40000000-0000-0000-0000-000000000001' and seq = 2;
do $$ begin
  if (select count(*) from public.event_edits) <> 2 then raise exception 'corrections were not logged'; end if;
end $$;
select pg_temp.blocked($q$update public.tournaments set name = 'Hacked' where id = '10000000-0000-0000-0000-000000000001'$q$);
select pg_temp.blocked($q$insert into public.tournament_members values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'organiser')$q$);

-- A stranger can read everything but change nothing.
select pg_temp.act('00000000-0000-0000-0000-00000000000c');
do $$ begin
  if (select count(*) from public.match_events) <> 2 then raise exception 'stranger cannot read the balls'; end if;
end $$;
select pg_temp.blocked($q$insert into public.match_events (match_id, seq, event) values ('40000000-0000-0000-0000-000000000001', 9, '{"t":"ball","runs":6}')$q$);
select pg_temp.blocked($q$update public.match_events set event = '{"t":"ball","runs":0}' where seq = 1$q$);
select pg_temp.blocked($q$delete from public.match_events where seq = 1$q$);
select pg_temp.blocked($q$update public.teams set name = 'Mine now'$q$);
select pg_temp.blocked($q$update public.matches set result_text = 'I won'$q$);
select pg_temp.blocked($q$insert into public.tournament_members values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 'scorer')$q$);
select pg_temp.blocked($q$insert into public.team_players values ('20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001')$q$);
select pg_temp.blocked($q$insert into public.tournaments (name, created_by) values ('Fake', '00000000-0000-0000-0000-00000000000a')$q$);
-- But they can start their own tournament.
insert into public.tournaments (name) values ('Stranger League');
-- Uploads only go into their own folder.
insert into storage.objects (bucket_id, name) values ('logos', '00000000-0000-0000-0000-00000000000c/logo.png');
select pg_temp.blocked($q$insert into storage.objects (bucket_id, name) values ('logos', '00000000-0000-0000-0000-00000000000a/logo.png')$q$);

-- Logged-out fans can read scores but not write.
select pg_temp.act(null);
do $$ begin
  if (select count(*) from public.matches) <> 1 then raise exception 'fans cannot read matches'; end if;
end $$;
select pg_temp.blocked($q$insert into public.tournaments (name) values ('Anon Cup')$q$);

-- Organisers add people by email; nobody else can.
select pg_temp.act('00000000-0000-0000-0000-00000000000a');
select public.add_member_by_email('10000000-0000-0000-0000-000000000001', '  Stranger@Example.com ', 'media');
do $$ begin
  if not exists (select 1 from public.tournament_members where user_id = '00000000-0000-0000-0000-00000000000c' and role = 'media') then raise exception 'organiser could not add by email'; end if;
  if (select count(*) from public.tournament_members m join public.profiles p on p.id = m.user_id) < 3 then raise exception 'members are not linked to profiles'; end if;
end $$;
do $$ begin
  perform public.add_member_by_email('10000000-0000-0000-0000-000000000001', 'nobody@example.com', 'scorer');
  raise exception 'unknown email should fail';
exception when no_data_found then null;
end $$;
select pg_temp.act('00000000-0000-0000-0000-00000000000b');
do $$ begin
  perform public.add_member_by_email('10000000-0000-0000-0000-000000000001', 'org@example.com', 'organiser');
  raise exception 'a scorer should not be able to add people';
exception when insufficient_privilege then null;
end $$;
select pg_temp.act(null);
select pg_temp.blocked($q$select public.add_member_by_email('10000000-0000-0000-0000-000000000001', 'org@example.com', 'scorer')$q$);

reset role;
\echo 'All security checks passed'
