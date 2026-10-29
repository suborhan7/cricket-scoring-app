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

-- Player invites: the organiser gets a code, the player claims it once.
select pg_temp.act('00000000-0000-0000-0000-00000000000a');
create temp table invite as select public.player_invite_code('30000000-0000-0000-0000-000000000001') as code;
grant select on invite to anon, authenticated;
update public.players set jersey_no = 7 where id = '30000000-0000-0000-0000-000000000001';
select pg_temp.act('00000000-0000-0000-0000-00000000000c');
do $$ begin
  perform public.player_invite_code('30000000-0000-0000-0000-000000000001');
  raise exception 'a stranger should not get an invite code';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  if exists (select 1 from public.player_invites) then raise exception 'invite codes must stay private'; end if;
end $$;
select public.claim_player((select code from invite));
do $$ begin
  if (select claimed_by from public.players where id = '30000000-0000-0000-0000-000000000001') <> '00000000-0000-0000-0000-00000000000c' then raise exception 'claim did not link the player'; end if;
end $$;
-- Now the player can edit their own profile.
update public.players set batting_style = 'left' where id = '30000000-0000-0000-0000-000000000001';
do $$ begin
  if (select batting_style from public.players where id = '30000000-0000-0000-0000-000000000001') <> 'left' then raise exception 'player cannot edit own profile'; end if;
end $$;
select pg_temp.act('00000000-0000-0000-0000-00000000000b');
do $$ begin
  perform public.claim_player((select code from invite));
  raise exception 'a used invite should not work again';
exception when no_data_found then null;
end $$;
select pg_temp.blocked($q$update public.teams set name = 'Hacked' where id = '20000000-0000-0000-0000-000000000001'$q$);

-- Card-ready alerts: the scorer sends one; the organiser and the player (who claimed
-- their profile above) get it, once, and nobody else can read or send them.
select pg_temp.act('00000000-0000-0000-0000-00000000000b');
do $$ declare n int; begin
  n := public.notify_card('40000000-0000-0000-0000-000000000001', 'milestone', 'Fifty card ready', 'Tanvir Ahmed 52 (30)', '30000000-0000-0000-0000-000000000001', '{"key":"fifty:0:0"}');
  if n <> 2 then raise exception 'alert should reach organiser and player, reached %', n; end if;
  n := public.notify_card('40000000-0000-0000-0000-000000000001', 'milestone', 'Fifty card ready', 'again', '30000000-0000-0000-0000-000000000001', '{"key":"fifty:0:0"}');
  if n <> 0 then raise exception 'the same alert went out twice'; end if;
  if exists (select 1 from public.notifications) then raise exception 'scorer can read other people''s alerts'; end if;
end $$;
select pg_temp.act('00000000-0000-0000-0000-00000000000c');
do $$ begin
  if (select count(*) from public.notifications) <> 1 then raise exception 'player did not get the alert'; end if;
  if (select data ->> 'match' from public.notifications) <> '40000000-0000-0000-0000-000000000001' then raise exception 'alert does not say which match'; end if;
  perform public.notify_card('40000000-0000-0000-0000-000000000001', 'result', 'Spam', '', null, '{}');
  raise exception 'a stranger should not send alerts';
exception when insufficient_privilege then null;
end $$;
select pg_temp.blocked($q$insert into public.notifications (user_id, kind, title, dedupe) values ('00000000-0000-0000-0000-00000000000a', 'result', 'Spam', 'x')$q$);
update public.notifications set read_at = now();
do $$ begin
  if (select count(*) from public.notifications where read_at is null) <> 0 then raise exception 'player cannot mark an alert read'; end if;
end $$;
select pg_temp.act('00000000-0000-0000-0000-00000000000a');
do $$ begin
  if (select count(*) from public.notifications where read_at is null) <> 1 then raise exception 'organiser alert missing or touched by someone else'; end if;
end $$;

-- Deleting an account. A solo organiser's tournament goes with them; a scorer's balls in
-- someone else's tournament stay.
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000d', 'solo@example.com');
select pg_temp.act('00000000-0000-0000-0000-00000000000d');
insert into public.tournaments (id, name, overs_per_side) values ('10000000-0000-0000-0000-000000000009', 'Solo Cup', 6);
insert into public.teams (id, name, short_name) values ('20000000-0000-0000-0000-000000000009', 'Solo XI', 'SX');
insert into public.tournament_teams (tournament_id, team_id) values ('10000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000009'), ('10000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000002');
insert into public.matches (id, tournament_id, team1_id, team2_id) values ('40000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000002');
insert into public.match_events (match_id, seq, event) values ('40000000-0000-0000-0000-000000000009', 0, '{"t":"ball","runs":1}');
select public.delete_my_account();
select pg_temp.act(null);
do $$ begin
  if exists (select 1 from public.tournaments where id = '10000000-0000-0000-0000-000000000009') then raise exception 'solo tournament should be deleted'; end if;
  if (select created_by from public.teams where id = '20000000-0000-0000-0000-000000000009') is not null then raise exception 'team creator should be blank'; end if;
end $$;
select pg_temp.act('00000000-0000-0000-0000-00000000000b');
select public.delete_my_account();
reset role;
do $$ begin
  if exists (select 1 from auth.users where id in ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000d')) then raise exception 'accounts not deleted'; end if;
  if not exists (select 1 from public.tournaments where id = '10000000-0000-0000-0000-000000000001') then raise exception 'shared tournament was deleted'; end if;
  if (select count(*) from public.match_events where match_id = '40000000-0000-0000-0000-000000000001') = 0 then raise exception 'scored balls were lost'; end if;
end $$;
select pg_temp.act(null);
do $$ begin
  perform public.delete_my_account();
  raise exception 'anon should not delete accounts';
exception when insufficient_privilege then null;
end $$;

-- Teams and joining (0010): own player profiles, captains, join requests and invite links.
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000e', 'captain@example.com'), ('00000000-0000-0000-0000-00000000000f', 'player@example.com');
select pg_temp.act('00000000-0000-0000-0000-00000000000e');
insert into public.players (id, full_name, claimed_by) values ('30000000-0000-0000-0000-00000000000e', 'Esha Captain', '00000000-0000-0000-0000-00000000000e');
select pg_temp.blocked($q$insert into public.players (full_name, claimed_by) values ('Fake', '00000000-0000-0000-0000-00000000000f')$q$);
insert into public.teams (id, name, short_name, captain_player_id) values ('20000000-0000-0000-0000-00000000000e', 'Esha XI', 'EXI', '30000000-0000-0000-0000-00000000000e');
insert into public.team_players (team_id, player_id) values ('20000000-0000-0000-0000-00000000000e', '30000000-0000-0000-0000-00000000000e');
select pg_temp.blocked($q$update public.tournaments set handle = 'stolen' where id = '10000000-0000-0000-0000-000000000001'$q$);

select pg_temp.act('00000000-0000-0000-0000-00000000000a');
update public.tournaments set handle = 'wintercup' where id = '10000000-0000-0000-0000-000000000001';
do $$ begin
  update public.tournaments set handle = 'Bad Handle!' where id = '10000000-0000-0000-0000-000000000001';
  raise exception 'bad handle accepted';
exception when check_violation then null;
end $$;
insert into public.tournaments (id, name, overs_per_side, open_to_requests) values ('10000000-0000-0000-0000-000000000002', 'Closed Cup', 10, false);

-- The captain asks to join; asking twice keeps one request; strangers can't ask for their team.
select pg_temp.act('00000000-0000-0000-0000-00000000000e');
do $$ begin
  if public.request_to_join('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000e', 'We play Fridays') <> 'sent' then raise exception 'request not sent'; end if;
  if public.request_to_join('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000e') <> 'pending' then raise exception 'second request should wait'; end if;
  if (select count(*) from public.join_requests) <> 1 then raise exception 'captain should see their request'; end if;
end $$;
do $$ begin
  perform public.request_to_join('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000e');
  raise exception 'closed tournament took a request';
exception when insufficient_privilege then null;
end $$;
select pg_temp.act('00000000-0000-0000-0000-00000000000c');
do $$ begin
  if (select count(*) from public.join_requests) <> 0 then raise exception 'stranger sees join requests'; end if;
  begin
    perform public.request_to_join('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000e');
    raise exception 'stranger asked for someone else''s team';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.answer_join_request((select id from public.join_requests limit 1), true);
  exception when insufficient_privilege or no_data_found then null;
  end;
end $$;

-- The organiser sees the request and an alert, and accepts it.
select pg_temp.act('00000000-0000-0000-0000-00000000000a');
do $$
declare r uuid;
begin
  select id into r from public.join_requests where team_id = '20000000-0000-0000-0000-00000000000e';
  if r is null then raise exception 'organiser cannot see the request'; end if;
  if not exists (select 1 from public.notifications where kind = 'join_request') then raise exception 'organiser got no alert'; end if;
  perform public.answer_join_request(r, true);
  if not exists (select 1 from public.tournament_teams where tournament_id = '10000000-0000-0000-0000-000000000001' and team_id = '20000000-0000-0000-0000-00000000000e') then raise exception 'accepted team not added'; end if;
end $$;
select pg_temp.act('00000000-0000-0000-0000-00000000000e');
do $$ begin
  if not exists (select 1 from public.notifications where kind = 'join_answer') then raise exception 'captain got no answer'; end if;
end $$;

-- Tournament invite link: only organisers get it; any team's own manager can use it.
select pg_temp.act('00000000-0000-0000-0000-00000000000c');
do $$ begin
  perform public.tournament_invite_code('10000000-0000-0000-0000-000000000001');
  raise exception 'stranger got the invite code';
exception when insufficient_privilege then null;
end $$;
insert into public.teams (id, name, short_name) values ('20000000-0000-0000-0000-00000000000c', 'Stranger Things', 'ST');
select pg_temp.act('00000000-0000-0000-0000-00000000000a');
create temp table tinv as select public.tournament_invite_code('10000000-0000-0000-0000-000000000001') as code;
grant select on tinv to authenticated;
select pg_temp.act('00000000-0000-0000-0000-00000000000c');
do $$ begin
  if public.tournament_for_invite((select code from tinv)) <> '10000000-0000-0000-0000-000000000001' then raise exception 'invite lookup failed'; end if;
  if public.join_with_invite((select code from tinv), '20000000-0000-0000-0000-00000000000c') <> '10000000-0000-0000-0000-000000000001' then raise exception 'invite join failed'; end if;
  if not exists (select 1 from public.tournament_teams where team_id = '20000000-0000-0000-0000-00000000000c') then raise exception 'invited team not added'; end if;
  begin
    perform public.join_with_invite((select code from tinv), '20000000-0000-0000-0000-000000000001');
    raise exception 'entered a team that is not theirs';
  exception when insufficient_privilege then null;
  end;
end $$;
select pg_temp.act('00000000-0000-0000-0000-00000000000a');
do $$ begin
  if public.tournament_invite_code('10000000-0000-0000-0000-000000000001', true) = (select code from tinv) then raise exception 'fresh code was not new'; end if;
end $$;

-- Team invite link: a player needs their own profile, then joins the squad.
select pg_temp.act('00000000-0000-0000-0000-00000000000e');
create temp table minv as select public.team_invite_code('20000000-0000-0000-0000-00000000000e') as code;
grant select on minv to authenticated;
select pg_temp.act('00000000-0000-0000-0000-00000000000f');
do $$ begin
  perform public.team_invite_code('20000000-0000-0000-0000-00000000000e');
  raise exception 'player got the team invite code';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.join_team((select code from minv));
  raise exception 'joined without a player profile';
exception when no_data_found then null;
end $$;
insert into public.players (id, full_name, claimed_by) values ('30000000-0000-0000-0000-00000000000f', 'Farhan Player', '00000000-0000-0000-0000-00000000000f');
do $$ begin
  perform public.join_team((select code from minv));
  perform public.join_team((select code from minv));
  if (select count(*) from public.team_players where team_id = '20000000-0000-0000-0000-00000000000e') <> 2 then raise exception 'player did not join the squad once'; end if;
end $$;
select pg_temp.blocked($q$update public.teams set name = 'Not mine' where id = '20000000-0000-0000-0000-00000000000e'$q$);

-- The creator makes the new player captain; now that player manages the team, but nobody
-- can move a profile to another account.
select pg_temp.act('00000000-0000-0000-0000-00000000000e');
update public.teams set captain_player_id = '30000000-0000-0000-0000-00000000000f' where id = '20000000-0000-0000-0000-00000000000e';
select pg_temp.blocked($q$update public.players set claimed_by = '00000000-0000-0000-0000-00000000000e' where id = '30000000-0000-0000-0000-00000000000f'$q$);
select pg_temp.act('00000000-0000-0000-0000-00000000000f');
update public.teams set name = 'Farhan XI' where id = '20000000-0000-0000-0000-00000000000e';
do $$ begin
  if (select name from public.teams where id = '20000000-0000-0000-0000-00000000000e') <> 'Farhan XI' then raise exception 'captain cannot edit the team'; end if;
end $$;
select pg_temp.act(null);
do $$ begin
  perform public.can_manage_team('20000000-0000-0000-0000-00000000000e');
  raise exception 'anon can call can_manage_team';
exception when insufficient_privilege then null;
end $$;

-- Someone who set up their own profile can still claim the player their captain added:
-- the unused self-made profile is folded into the invited one.
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000011', 'gopal@example.com');
select pg_temp.act('00000000-0000-0000-0000-000000000011');
insert into public.players (id, full_name, claimed_by, jersey_no) values ('30000000-0000-0000-0000-000000000011', 'Gopal', '00000000-0000-0000-0000-000000000011', 11);
select pg_temp.act('00000000-0000-0000-0000-00000000000a');
insert into public.players (id, full_name) values ('30000000-0000-0000-0000-000000000012', 'Gopal Das');
insert into public.team_players values ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000012');
create temp table ginv as select public.player_invite_code('30000000-0000-0000-0000-000000000012') as code;
grant select on ginv to anon, authenticated;
select pg_temp.act('00000000-0000-0000-0000-000000000011');
select public.claim_player((select code from ginv));
do $$ begin
  if exists (select 1 from public.players where id = '30000000-0000-0000-0000-000000000011') then raise exception 'unused own profile was not folded in'; end if;
  if (select claimed_by from public.players where id = '30000000-0000-0000-0000-000000000012') <> '00000000-0000-0000-0000-000000000011' then raise exception 'claim with own profile did not link'; end if;
  if (select jersey_no from public.players where id = '30000000-0000-0000-0000-000000000012') <> 11 then raise exception 'own details were not carried over'; end if;
end $$;

-- Team join requests: Gopal asks to join Farhan XI; a stranger can't answer, the captain accepts.
select pg_temp.act('00000000-0000-0000-0000-000000000011');
do $$ begin
  if public.request_team_join('20000000-0000-0000-0000-00000000000e', 'I bowl spin') <> 'sent' then raise exception 'team request not sent'; end if;
  if public.request_team_join('20000000-0000-0000-0000-00000000000e') <> 'pending' then raise exception 'second team request should wait'; end if;
end $$;
select pg_temp.act('00000000-0000-0000-0000-00000000000c');
do $$ begin
  if exists (select 1 from public.team_requests) then raise exception 'strangers must not see team requests'; end if;
end $$;
select pg_temp.act('00000000-0000-0000-0000-00000000000f');
do $$ declare r uuid; begin
  select id into r from public.team_requests where team_id = '20000000-0000-0000-0000-00000000000e';
  if r is null then raise exception 'captain cannot see the team request'; end if;
  if not exists (select 1 from public.notifications where kind = 'team_request') then raise exception 'captain got no team request alert'; end if;
  perform public.answer_team_request(r, true);
  if not exists (select 1 from public.team_players where team_id = '20000000-0000-0000-0000-00000000000e' and player_id = '30000000-0000-0000-0000-000000000012') then raise exception 'accepted player not in squad'; end if;
end $$;
select pg_temp.act('00000000-0000-0000-0000-000000000011');
do $$ begin
  perform public.request_team_join('20000000-0000-0000-0000-00000000000e');
  raise exception 'a squad member could ask again';
exception when unique_violation then null;
end $$;

reset role;
\echo 'All security checks passed'
