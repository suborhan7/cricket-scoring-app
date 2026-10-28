-- People can delete their own account from the app (a Play Store requirement).
-- Their profile, roles, alerts and player-profile link go with it. Tournaments where they
-- were the only organiser are deleted too; anything shared (teams, players, balls they
-- scored in someone else's tournament) stays, with the creator left blank.
-- Paste into Supabase: SQL Editor → New query → Run. Safe to run more than once.

alter table public.tournaments alter column created_by drop not null;
alter table public.tournaments drop constraint if exists tournaments_created_by_fkey;
alter table public.tournaments add constraint tournaments_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;

alter table public.teams alter column created_by drop not null;
alter table public.teams drop constraint if exists teams_created_by_fkey;
alter table public.teams add constraint teams_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;

alter table public.players alter column created_by drop not null;
alter table public.players drop constraint if exists players_created_by_fkey;
alter table public.players add constraint players_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;

alter table public.match_events drop constraint if exists match_events_created_by_fkey;
alter table public.match_events add constraint match_events_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;

-- Deleting a whole match (or its tournament) also deletes its balls. Those deletions are
-- not corrections, and logging them failed because the match was already gone.
create or replace function public.log_event_edit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.event is distinct from old.event then
    insert into public.event_edits (match_id, seq, old_event, new_event) values (old.match_id, old.seq, old.event, new.event);
  elsif tg_op = 'DELETE' and exists (select 1 from public.matches where id = old.match_id) then
    insert into public.event_edits (match_id, seq, old_event, new_event) values (old.match_id, old.seq, old.event, null);
  end if;
  return coalesce(new, old);
end $$;
revoke execute on function public.log_event_edit() from public, anon, authenticated;

create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  delete from public.tournaments t
  where exists (select 1 from public.tournament_members m where m.tournament_id = t.id and m.user_id = me and m.role = 'organiser')
    and not exists (select 1 from public.tournament_members m where m.tournament_id = t.id and m.user_id <> me and m.role = 'organiser');
  delete from auth.users where id = me;
end $$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
