-- The sponsor slot on every card. Until an organiser fills it in, cards show a sample mark.
-- Paste into Supabase: SQL Editor → New query → Run. Safe to run more than once.

alter table public.tournaments add column if not exists sponsor_name text check (length(sponsor_name) <= 40);
alter table public.tournaments add column if not exists sponsor_logo_path text;
alter table public.tournaments add column if not exists show_sponsor boolean not null default true;
