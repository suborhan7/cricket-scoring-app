-- Live viewing for fans: a small live score on each match for the home feed, following a
-- match, team or tournament, and wicket / milestone / result alerts for followers.
-- Phones register here for push notifications (sent by the "push" Edge Function).
-- Paste into Supabase: SQL Editor → New query → Run. Safe to run more than once.

-- ---------- Live score snapshot ----------
-- Written by the scorer's app on every sync: {"inn":[{"team":0,"r":128,"w":3,"b":75}],"bpo":6,"need":"...","last":"..."}
-- so the feed shows the score without downloading every ball.
alter table public.matches add column if not exists live jsonb;
alter table public.matches drop constraint if exists matches_live_size;
alter table public.matches add constraint matches_live_size check (live is null or pg_column_size(live) <= 2000);

-- ---------- Following ----------

create table if not exists public.follows (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('match', 'team', 'tournament')),
  target uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, target)
);
create index if not exists follows_target_idx on public.follows (kind, target);
alter table public.follows enable row level security;
drop policy if exists "own follows" on public.follows;
create policy "own follows" on public.follows for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "follow" on public.follows;
create policy "follow" on public.follows for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "unfollow" on public.follows;
create policy "unfollow" on public.follows for delete to authenticated using (user_id = (select auth.uid()));

-- ---------- Alerts for followers ----------

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('milestone', 'result', 'join_request', 'join_answer', 'team_join', 'team_request', 'team_answer', 'live'));

-- Tells everyone following the match, either team or the tournament. Only someone scoring
-- the match may call it. ev is 'start', 'wicket', 'milestone', 'innings' or 'result';
-- key makes each moment go out once (e.g. 'w:0:37' for the wicket at ball 37 of innings 1).
create or replace function public.notify_followers(m uuid, ev text, title text, body text, key text)
returns int
language plpgsql security definer set search_path = public as $$
declare
  mt public.matches;
  n int;
begin
  select * into mt from public.matches where id = m;
  if not found then raise exception 'Match not found.' using errcode = 'no_data_found'; end if;
  if not public.can_score(m) then
    raise exception 'Only the scorers of this match can send live alerts.' using errcode = 'insufficient_privilege';
  end if;
  if ev not in ('start', 'wicket', 'milestone', 'innings', 'result') then raise exception 'Unknown alert.' using errcode = 'check_violation'; end if;

  insert into public.notifications (user_id, kind, title, body, data, dedupe)
  select distinct f.user_id, 'live', left(title, 120), left(coalesce(body, ''), 300),
    jsonb_build_object('match', m, 'tournament', mt.tournament_id, 'ev', ev),
    'live:' || m || ':' || left(coalesce(key, ev), 60)
  from public.follows f
  where ((f.kind = 'match' and f.target = m)
      or (f.kind = 'team' and f.target in (mt.team1_id, mt.team2_id))
      or (f.kind = 'tournament' and f.target = mt.tournament_id))
    and f.user_id <> (select auth.uid())
  on conflict (user_id, dedupe) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.notify_followers(uuid, text, text, text, text) from public, anon;
grant execute on function public.notify_followers(uuid, text, text, text, text) to authenticated;

-- ---------- Push notification addresses ----------
-- One row per phone or browser: a Web Push subscription (endpoint + keys) or an Android
-- FCM token (endpoint = the token). Only the Edge Function (service role) reads them all.

create table if not exists public.push_subscriptions (
  endpoint text primary key check (char_length(endpoint) between 20 and 1000),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('web', 'fcm')),
  keys jsonb,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own devices" on public.push_subscriptions;
create policy "own devices" on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "remove device" on public.push_subscriptions;
create policy "remove device" on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));

-- Saves this phone for the signed-in user. A phone that changes hands moves to the new user.
create or replace function public.save_push(kind text, endpoint text, keys jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select auth.uid()) is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if kind not in ('web', 'fcm') then raise exception 'Unknown device.' using errcode = 'check_violation'; end if;
  if keys is not null and pg_column_size(keys) > 500 then raise exception 'Keys too large.' using errcode = 'check_violation'; end if;
  insert into public.push_subscriptions (endpoint, user_id, kind, keys)
  values (save_push.endpoint, (select auth.uid()), save_push.kind, save_push.keys)
  on conflict on constraint push_subscriptions_pkey do update set user_id = excluded.user_id, kind = excluded.kind, keys = excluded.keys, created_at = now();
end $$;

revoke execute on function public.save_push(text, text, jsonb) from public, anon;
grant execute on function public.save_push(text, text, jsonb) to authenticated;
