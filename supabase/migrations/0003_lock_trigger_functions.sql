-- Trigger functions run on their own when rows change; nobody needs to call them through the API.
-- Postgres only checks EXECUTE when a trigger is created, so the triggers keep working.
-- has_role and match_tournament stay callable: the security rules call them for every request.
-- Paste into Supabase: SQL Editor → New query → Run. Safe to run more than once.

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.add_creator_as_organiser() from public, anon, authenticated;
revoke execute on function public.log_event_edit() from public, anon, authenticated;
