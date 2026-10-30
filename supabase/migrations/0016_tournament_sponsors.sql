-- Sponsors for a tournament: up to 4, each a name and/or a logo, shown on every studio card.
-- Asked for when the tournament is created and editable later in its settings.
-- Paste into Supabase: SQL Editor → New query → Run. Safe to run more than once.

alter table public.tournaments add column if not exists sponsors jsonb not null default '[]'::jsonb;

do $$ begin
  alter table public.tournaments add constraint tournaments_sponsors_list
    check (jsonb_typeof(sponsors) = 'array' and jsonb_array_length(sponsors) <= 4);
exception when duplicate_object then null; end $$;

-- The single sponsor from 0007 becomes the first entry of the list.
update public.tournaments
   set sponsors = jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('name', sponsor_name, 'logo_path', sponsor_logo_path)))
 where sponsors = '[]'::jsonb and (sponsor_name is not null or sponsor_logo_path is not null);
