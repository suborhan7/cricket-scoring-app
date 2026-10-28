-- Lets an organiser add a scorer (or another organiser, or media) by the email they signed up with.
-- Emails live in auth.users, which the app can't read, so this function looks the person up
-- and only answers organisers of that tournament.
-- Paste into Supabase: SQL Editor → New query → Run. Safe to run more than once.

-- So the app can show members' names next to their role.
do $$ begin
  alter table public.tournament_members
    add constraint tournament_members_profile_fk foreign key (user_id) references public.profiles (id) on delete cascade;
exception when duplicate_object then null; end $$;

create or replace function public.add_member_by_email(t uuid, member_email text, member_role text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
  who text;
begin
  if not public.has_role(t, '{organiser}') then
    raise exception 'Only an organiser of this tournament can add people.' using errcode = '42501';
  end if;
  if member_role not in ('organiser', 'scorer', 'media') then
    raise exception 'Unknown role %', member_role using errcode = '22023';
  end if;
  select u.id into uid from auth.users u where lower(u.email) = lower(trim(member_email));
  if uid is null then
    raise exception 'No account uses that email yet. Ask them to sign up in the app first.' using errcode = 'P0002';
  end if;
  insert into public.tournament_members (tournament_id, user_id, role) values (t, uid, member_role)
    on conflict do nothing;
  select display_name into who from public.profiles where id = uid;
  return json_build_object('user_id', uid, 'display_name', coalesce(who, ''));
end $$;

revoke execute on function public.add_member_by_email(uuid, text, text) from public, anon;
grant execute on function public.add_member_by_email(uuid, text, text) to authenticated;
