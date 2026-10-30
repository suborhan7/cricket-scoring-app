-- Push notifications: every new alert row calls the "push" Edge Function, which sends it to
-- the user's phones (supabase/functions/push). Needs the pg_net extension and two Vault
-- secrets, "push_url" (…/functions/v1/push) and "push_secret" (same as the function's
-- PUSH_SECRET). Without them the trigger does nothing and alerts still show behind the bell.
-- Paste into Supabase: SQL Editor → New query → Run. Safe to run more than once.

do $$ begin
  create extension if not exists pg_net;
exception when others then raise notice 'pg_net not available here; push stays off.';
end $$;

create or replace function public.push_alert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  url text;
  secret text;
begin
  begin
    select decrypted_secret into url from vault.decrypted_secrets where name = 'push_url';
    select decrypted_secret into secret from vault.decrypted_secrets where name = 'push_secret';
    if url is not null and secret is not null then
      perform net.http_post(url := url, body := jsonb_build_object('id', new.id),
        headers := jsonb_build_object('content-type', 'application/json', 'x-push-secret', secret), timeout_milliseconds := 5000);
    end if;
  exception when others then
    -- A push problem must never stop the alert itself from being saved.
    raise warning 'push not sent: %', sqlerrm;
  end;
  return new;
end $$;

revoke execute on function public.push_alert() from public, anon, authenticated;

drop trigger if exists on_alert_push on public.notifications;
create trigger on_alert_push after insert on public.notifications
  for each row execute function public.push_alert();
