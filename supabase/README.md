# Database (Supabase)

## Set it up (once)

1. Create a free project at [supabase.com](https://supabase.com). Pick the Singapore region; it's the closest to Bangladesh.
2. Open **SQL Editor → New query**, paste all of `migrations/0001_init.sql`, and press **Run**.
   Then do the same with each later file in `migrations/` in number order (`0002_match_summary.sql`, …). Each one is safe to run again.
3. Under **Authentication → Sign In / Providers**, keep Email on. Add Google later if you want it.
4. From **Project Settings → API**, copy the **Project URL** and the **anon / publishable key** into the app config (next PR). These two are public by design. Never put the **service_role** key in the app or share it.

## What's in it

| Table | Holds |
| --- | --- |
| `profiles` | One row per signed-up user (made automatically) |
| `tournaments` | Name, logo, colours, overs, dates. A tournament or a two-team series |
| `tournament_members` | Who runs a tournament: organiser, scorer or media manager |
| `teams`, `players`, `team_players` | Teams and squads. A team is made once and can join many tournaments |
| `tournament_teams` | Which teams are in a tournament, and their group |
| `matches` | Fixtures, the line-ups that played, toss and result |
| `match_events` | Every tap the scorer made, in order. All scores and stats are worked out from these |
| `event_edits` | History of every corrected or undone ball: who changed it and when |

Storage buckets `logos` and `photos` are public to view. Each user uploads into a folder named after their user id.

## Who can do what

- **Anyone, even logged out:** reads everything, so fans can follow scores without an account.
- **Any logged-in user:** creates a tournament (and becomes its organiser), a team or a player.
- **Organiser:** edits the tournament, adds teams, groups, fixtures and scorers.
- **Scorer:** adds, fixes and undoes balls in that tournament's matches.
- **Media manager:** makes and shares the tournament's cards and gets card-ready alerts, but can't score or change the tournament.
- **Team creator:** edits the team and its squad. **Player creator or the player themself:** edits the profile.

## Test the rules locally

`tests/run.sh` loads the migration into a local Postgres (with small stand-ins for Supabase's auth and storage) and checks that each kind of user is allowed or blocked as above.

```
PGHOST=/tmp PGPORT=5432 PGUSER=postgres supabase/tests/run.sh
```

## Push notifications (wickets, results, card alerts)

Every new alert row (`notifications`) calls the `push` Edge Function (`functions/push`), which sends it to the user's phones saved in `push_subscriptions`.

1. Run `0014_live_follow.sql` and `0015_push_trigger.sql`.
2. Deploy the function with JWT checking off (it checks its own secret): `supabase functions deploy push --no-verify-jwt`.
3. Function secrets: `PUSH_SECRET` (any long random text), `VAPID_PUBLIC_KEY` (same as `pushKey` in `js/config.js`), `VAPID_PRIVATE_KEY`, and later `FCM_SERVICE_ACCOUNT` for the Android app.
4. In the SQL Editor, tell the database where to send them:
   `select vault.create_secret('https://<project>.supabase.co/functions/v1/push', 'push_url');`
   `select vault.create_secret('<same PUSH_SECRET>', 'push_secret');`

Browsers and the installed web app use Web Push. The Android app needs Firebase: add the repository secret `GOOGLE_SERVICES_JSON` (the app's `google-services.json`) so the APK build includes the push plugin, and set `FCM_SERVICE_ACCOUNT` on the function.
