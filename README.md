# CricPulse

Ball-by-ball cricket scoring that works on a phone at the ground, even with no signal. This is the first piece of a bigger app for running tournaments and making match cards (fifty cards, results, points tables).

## Try it

- **On your phone:** turn on GitHub Pages (Settings → Pages → Deploy from a branch → `main`, folder `/ (root)`), then open `https://suborhan7.github.io/cricket-scoring-app/`. Use "Add to Home screen" so it opens like an app and works offline.
- **On a computer:** run `python3 -m http.server` in this folder and open `http://localhost:8000`. Opening `index.html` directly also works, but without offline mode.

Tap **New match → Fill sample teams → Start match** to try it in under a minute.

## What it does now

- Match setup: two teams, players one per line, overs from T10 / T20 / 50 or a custom number, max overs per bowler, toss.
- Scoring: 0–6, wide (+ runs), no ball (+ runs off the bat, then a free hit), byes, leg byes, every dismissal type including run-outs on wides and no-balls, retired hurt, swap strike, end innings.
- **Undo** is always one tap away.
- Strike changes on odd runs and at the end of each over; the same bowler can't bowl two overs in a row or go past the over limit.
- Second innings shows the target, runs needed, balls left and required rate, and the match ends itself when the chase is done.
- Scorecard: batting and bowling tables, extras, fall of wickets, yet to bat, and an over-by-over view.
- A note pops up when someone reaches 50 or 100, or takes 3 or 5 wickets. That's where the fifty card alert will hook in.
- Every ball is saved on the phone as soon as it's tapped.

**Tournaments (needs an account):**

- Sign up or sign in with email and password.
- Create a tournament or a two-team series: name, short name, logo, overs. The card colours are picked from the logo, and you can change them.
- Add teams with a logo, an optional group and players one per line (the first is captain).
- Add matches (teams, stage, number, date, ground), then pick the playing players and the toss and start scoring.
- Every ball is sent to the database in the background. With no signal it waits and sends when the phone is back online; the badge in the top bar says Synced, Saving or Offline.
- Anyone who opens a live match without scoring rights sees the score with a Refresh button instead of the pad.
- Quick matches still work with no account.
- **Share** (the arrow icon) sends a link to a tournament or a match. Anyone who opens it lands straight on it, and a live match refreshes itself every 15 seconds.
- **Table** tab: points table for each group (P, W, L, T, NR, points, net run rate). Win 2, tie or no result 1.
- **Stats** tab: most runs and most wickets, with strike rate, average, economy and best figures.

## How it works

`js/engine.js` holds the cricket rules. A match is a list of events (`openers`, `ball`, `bowler`, `batter`, `swap`, `retire`, `end`), and every score, stat and scorecard is worked out by replaying them from the start. That keeps three things simple:

- **Undo** drops the last event.
- **Fixing a mistake later** means changing one old event and replaying, so every total updates by itself.
- **Syncing to the server** later only has to send events.

| File | What it is |
| --- | --- |
| `js/engine.js` | Cricket rules and scoring maths. No screen code, so it runs in tests too |
| `js/app.js` | The screens: matches, new match, scoring pad, scorecard |
| `js/store.js` | Saves matches on the phone |
| `js/stats.js` | Points table, net run rate and leaders, from a short summary saved with each finished match |
| `js/league.js` | Accounts, tournaments, teams, fixtures and syncing balls to Supabase |
| `js/config.js` | Supabase project URL and publishable key (public by design; never put the secret key here) |
| `vendor/supabase.js` | supabase-js 2.117.3, MIT licence |
| `supabase/` | Database tables and security rules, with setup steps |
| `css/app.css` | The look |
| `sw.js`, `manifest.webmanifest` | Make it installable and work offline |
| `tests/engine.test.js` | Rule tests |

## Tests

```
npm test
```

Needs Node 18 or newer. No packages to install.

## Next

1. A screen for fixing old balls.
2. Scorer invites, so an organiser can let a friend score.
3. Milestone cards and alerts.
4. Wrap as an Android APK with Capacitor.
