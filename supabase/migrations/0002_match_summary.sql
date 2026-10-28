-- Adds a small summary to each finished match: innings totals and every player's figures.
-- The points table and the run and wicket leaders are worked out from it (js/stats.js),
-- so nobody has to download every ball of every match.
-- Paste into Supabase: SQL Editor → New query → Run. Safe to run more than once.

alter table public.matches add column if not exists summary jsonb;
