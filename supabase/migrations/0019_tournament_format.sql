-- Tournament format, chosen when the tournament is made (and editable later):
-- {"type": "groups" | "leagueko" | "league" | "knockout", "go": <teams that go through>}
-- groups:   groups, then knockouts; go = teams from each group
-- leagueko: everyone plays everyone in one table, then knockouts; go = teams in all
-- league:   everyone plays everyone, top of the table wins
-- knockout: knockouts only
alter table public.tournaments add column if not exists format jsonb not null default '{}'::jsonb;
