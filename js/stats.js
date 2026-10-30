// Tournament numbers: the points table and the run and wicket leaders.
// A finished match keeps a small summary (see summarize) so these never need every ball.
// No DOM here: the same file runs in the browser and in Node tests.
(function (root) {
  const E = root.CSA && root.CSA.engine ? root.CSA.engine : typeof require === "function" ? require("./engine.js") : null;

  // What a finished match adds to the tables. playerIds[team][i] is the database id of
  // match.teams[team].players[i]; without it players are matched by team and name.
  function summarize(match, s, playerIds) {
    const rules = E.settings(match);
    const who = (team, p) => ({ id: (playerIds && playerIds[team] && playerIds[team][p]) || null, name: match.teams[team].players[p], team });
    return {
      v: 1,
      maxBalls: rules.oversPerSide * rules.ballsPerOver,
      bpo: rules.ballsPerOver,
      innings: s.innings.map((inn) => ({
        team: inn.batting, runs: inn.runs, wickets: inn.wickets, balls: inn.legalBalls,
        allOut: inn.closeReason === "All out",
      })),
      bat: [].concat(...s.innings.map((inn) => inn.batters.map((b) => Object.assign(who(inn.batting, b.player), {
        runs: b.runs, balls: b.balls, fours: b.fours, sixes: b.sixes, out: !!(b.out && b.out.kind !== "retired"),
      })))),
      bowl: [].concat(...s.innings.map((inn) => inn.bowlers.map((b) => Object.assign(who(inn.bowling, b.player), {
        balls: b.balls, runs: b.runs, wickets: b.wickets,
      })))),
    };
  }

  // Points table rows for the given team ids. Win 2, tie or no result 1.
  // Net run rate counts an all-out side as having faced its full overs, as the ICC does.
  function pointsTable(teamIds, matches) {
    const rows = new Map(teamIds.map((id) => [id, { id, p: 0, w: 0, l: 0, t: 0, nr: 0, pts: 0, rf: 0, bf: 0, ra: 0, bb: 0 }]));
    for (const m of matches) {
      const ids = [m.team1_id, m.team2_id], r = ids.map((id) => rows.get(id));
      if (!r[0] || !r[1]) continue;
      if (m.status === "abandoned") { r.forEach((x) => { x.p++; x.nr++; x.pts += 1; }); continue; }
      if (m.status !== "done") continue;
      r.forEach((x) => x.p++);
      if (!m.winner_team_id) r.forEach((x) => { x.t++; x.pts += 1; });
      else r.forEach((x, i) => { if (ids[i] === m.winner_team_id) { x.w++; x.pts += 2; } else x.l++; });
      const sm = m.summary;
      if (!sm || !sm.innings) continue;
      for (const inn of sm.innings) {
        const bat = r[inn.team], bowl = r[1 - inn.team];
        const balls = inn.allOut ? sm.maxBalls : inn.balls;
        bat.rf += inn.runs; bat.bf += balls;
        bowl.ra += inn.runs; bowl.bb += balls;
      }
    }
    for (const x of rows.values()) {
      x.nrr = x.bf && x.bb ? (x.rf * 6) / x.bf - (x.ra * 6) / x.bb : 0;
    }
    return [...rows.values()].sort((a, b) => b.pts - a.pts || b.nrr - a.nrr || b.w - a.w);
  }

  const keyOf = (p, teamId) => p.id || `${teamId}:${p.name}`;

  // Batting and bowling totals per player across finished matches.
  function leaders(matches) {
    const bat = new Map(), bowl = new Map(), scores = [], figures = [];
    for (const m of matches) {
      const sm = m.summary;
      if (m.status !== "done" || !sm) continue;
      const teamIds = [m.team1_id, m.team2_id];
      const vs = (team) => teamIds[1 - team];
      for (const b of sm.bat) {
        if (b.balls || b.runs || b.out) scores.push({ id: b.id, name: b.name, teamId: teamIds[b.team], vsId: vs(b.team), matchId: m.id, runs: b.runs, balls: b.balls, out: b.out });
        const k = keyOf(b, teamIds[b.team]);
        const x = bat.get(k) || { key: k, id: b.id, name: b.name, teamId: teamIds[b.team], inns: 0, runs: 0, balls: 0, fours: 0, sixes: 0, outs: 0, best: 0, bestOut: true, fifties: 0, hundreds: 0 };
        x.name = b.name; x.inns++; x.runs += b.runs; x.balls += b.balls; x.fours += b.fours; x.sixes += b.sixes;
        if (b.out) x.outs++;
        if (b.runs > x.best || (b.runs === x.best && !b.out)) { x.best = b.runs; x.bestOut = b.out; }
        if (b.runs >= 100) x.hundreds++; else if (b.runs >= 50) x.fifties++;
        bat.set(k, x);
      }
      for (const b of sm.bowl) {
        if (b.balls) figures.push({ id: b.id, name: b.name, teamId: teamIds[b.team], vsId: vs(b.team), matchId: m.id, wickets: b.wickets, runs: b.runs, overs: E.oversText(b.balls, sm.bpo || 6) });
        const k = keyOf(b, teamIds[b.team]);
        const x = bowl.get(k) || { key: k, id: b.id, name: b.name, teamId: teamIds[b.team], inns: 0, balls: 0, runs: 0, wickets: 0, bestW: -1, bestR: 0, bpo: sm.bpo || 6 };
        x.name = b.name; x.inns++; x.balls += b.balls; x.runs += b.runs; x.wickets += b.wickets;
        if (b.wickets > x.bestW || (b.wickets === x.bestW && b.runs < x.bestR)) { x.bestW = b.wickets; x.bestR = b.runs; }
        bowl.set(k, x);
      }
    }
    const runs = [...bat.values()].map((x) => Object.assign(x, {
      avg: x.outs ? x.runs / x.outs : null, sr: x.balls ? (x.runs * 100) / x.balls : 0,
    })).sort((a, b) => b.runs - a.runs || b.sr - a.sr);
    const wickets = [...bowl.values()].filter((x) => x.balls > 0).map((x) => Object.assign(x, {
      econ: (x.runs * x.bpo) / x.balls, overs: E.oversText(x.balls, x.bpo),
    })).sort((a, b) => b.wickets - a.wickets || a.econ - b.econ);
    // Single-innings records: highest scores (not-out first on a tie) and best bowling figures.
    scores.sort((a, b) => b.runs - a.runs || Number(a.out) - Number(b.out) || a.balls - b.balls);
    figures.sort((a, b) => b.wickets - a.wickets || a.runs - b.runs);
    const sixes = runs.filter((x) => x.sixes > 0).slice().sort((a, b) => b.sixes - a.sixes || b.runs - a.runs);
    const fours = runs.filter((x) => x.fours > 0).slice().sort((a, b) => b.fours - a.fours || b.runs - a.runs);
    return { runs, wickets, scores, figures: figures.filter((x) => x.wickets > 0), sixes, fours };
  }

  // Player of the match points, simple enough to explain on one line:
  // a run 1 (+1 for a four, +2 for a six, +8 at 30, +16 at 50), a wicket 20 (+8 at 3),
  // a dot ball bowled 1, a maiden 12, a catch, stumping or run-out 8.
  const MVP_RULES = "1 a run, +1 a four, +2 a six, 20 a wicket, 1 a dot ball, 12 a maiden, 8 a catch, stumping or run-out, plus bonuses at 30 and 50 runs and 3 wickets.";
  function mvp(match, s) {
    const all = new Map();
    const get = (team, player) => {
      const k = team + ":" + player;
      if (!all.has(k)) all.set(k, { team, player, name: match.teams[team].players[player], pts: 0, runs: 0, balls: 0, wickets: 0, conceded: 0, bowled: 0, catches: 0, runouts: 0, stumpings: 0 });
      return all.get(k);
    };
    const bpo = E.settings(match).ballsPerOver;
    for (const inn of s.innings) {
      for (const b of inn.batters) {
        if (!b.balls && !b.out) continue;
        const x = get(inn.batting, b.player);
        x.runs += b.runs; x.balls += b.balls;
        x.pts += b.runs + b.fours + 2 * b.sixes + (b.runs >= 50 ? 16 : b.runs >= 30 ? 8 : 0);
        const o = b.out;
        if (o && o.fielder != null && ["caught", "stumped", "runout"].includes(o.kind)) {
          const f = get(inn.bowling, o.fielder);
          f.pts += 8;
          if (o.kind === "caught") f.catches++; else if (o.kind === "stumped") f.stumpings++; else f.runouts++;
        }
      }
      const dots = new Map();
      for (const over of inn.overs) for (const ball of over) if (ball.legal && ball.runs === 0 && ball.bowler != null) dots.set(ball.bowler, (dots.get(ball.bowler) || 0) + 1);
      for (const b of inn.bowlers) {
        if (!b.balls) continue;
        const x = get(inn.bowling, b.player);
        x.wickets += b.wickets; x.conceded += b.runs; x.bowled += b.balls;
        x.pts += 20 * b.wickets + (b.wickets >= 3 ? 8 : 0) + 12 * b.maidens + (dots.get(b.player) || 0);
      }
    }
    const plural = (n, one) => `${n} ${one}${n === 1 ? "" : one === "catch" ? "es" : "s"}`;
    return [...all.values()].filter((x) => x.pts > 0).map((x) => Object.assign(x, {
      line: [
        x.balls ? `${x.runs} (${x.balls})` : "",
        x.bowled ? `${x.wickets}/${x.conceded} in ${E.oversText(x.bowled, bpo)} ov` : "",
        x.catches ? plural(x.catches, "catch") : "", x.stumpings ? plural(x.stumpings, "stumping") : "", x.runouts ? plural(x.runouts, "run-out") : "",
      ].filter(Boolean).join(" · "),
    })).sort((a, b) => b.pts - a.pts || b.runs - a.runs || b.wickets - a.wickets);
  }

  // Player of the tournament: the match MVP points that a summary can give (batting, and
  // wickets with the three-for bonus; summaries keep no catches, maidens or dots), added up.
  function tournamentMvp(matches) {
    const all = new Map();
    const get = (b, teamId) => {
      const k = keyOf(b, teamId);
      if (!all.has(k)) all.set(k, { key: k, id: b.id, name: b.name, teamId, matches: new Set(), pts: 0, runs: 0, balls: 0, sixes: 0, wickets: 0, conceded: 0, bowled: 0 });
      return all.get(k);
    };
    for (const m of matches) {
      const sm = m.summary;
      if (m.status !== "done" || !sm) continue;
      const teamIds = [m.team1_id, m.team2_id];
      for (const b of sm.bat) {
        if (!b.balls && !b.out) continue;
        const x = get(b, teamIds[b.team]);
        x.matches.add(m.id); x.runs += b.runs; x.balls += b.balls; x.sixes += b.sixes;
        x.pts += b.runs + b.fours + 2 * b.sixes + (b.runs >= 50 ? 16 : b.runs >= 30 ? 8 : 0);
      }
      for (const b of sm.bowl) {
        if (!b.balls) continue;
        const x = get(b, teamIds[b.team]);
        x.matches.add(m.id); x.wickets += b.wickets; x.conceded += b.runs; x.bowled += b.balls;
        x.pts += 20 * b.wickets + (b.wickets >= 3 ? 8 : 0);
      }
    }
    return [...all.values()].filter((x) => x.pts > 0).map((x) => Object.assign(x, { played: x.matches.size }))
      .sort((a, b) => b.pts - a.pts || b.runs - a.runs || b.wickets - a.wickets);
  }

  // One player's career from the summaries of the finished matches they played: totals,
  // a row per tournament, and every innings newest first (for the form chart).
  // Matches carry tournament_id, team ids, starts_at or created_at, winner_team_id and summary.
  function career(matches, id) {
    const blankBat = () => ({ inns: 0, runs: 0, balls: 0, outs: 0, fours: 0, sixes: 0, best: 0, bestOut: true, thirties: 0, fifties: 0, hundreds: 0, ducks: 0 });
    const blankBowl = () => ({ inns: 0, balls: 0, runs: 0, wickets: 0, bestW: -1, bestR: 0, threes: 0, fives: 0, bpo: 6 });
    const addBat = (x, b) => {
      x.inns++; x.runs += b.runs; x.balls += b.balls; x.fours += b.fours; x.sixes += b.sixes;
      if (b.out) x.outs++;
      if (b.out && b.runs === 0) x.ducks++;
      if (b.runs > x.best || (b.runs === x.best && !b.out)) { x.best = b.runs; x.bestOut = b.out; }
      if (b.runs >= 100) x.hundreds++; else if (b.runs >= 50) x.fifties++; else if (b.runs >= 30) x.thirties++;
    };
    const addBowl = (x, b, bpo) => {
      x.inns++; x.balls += b.balls; x.runs += b.runs; x.wickets += b.wickets; x.bpo = bpo;
      if (b.wickets > x.bestW || (b.wickets === x.bestW && b.runs < x.bestR)) { x.bestW = b.wickets; x.bestR = b.runs; }
      if (b.wickets >= 5) x.fives++; else if (b.wickets >= 3) x.threes++;
    };
    const finish = (bat, bowl) => {
      bat.notOuts = bat.inns - bat.outs;
      bat.avg = bat.outs ? bat.runs / bat.outs : null;
      bat.sr = bat.balls ? (bat.runs * 100) / bat.balls : null;
      bowl.overs = E.oversText(bowl.balls, bowl.bpo);
      bowl.econ = bowl.balls ? (bowl.runs * bowl.bpo) / bowl.balls : null;
      bowl.avg = bowl.wickets ? bowl.runs / bowl.wickets : null;
      bowl.sr = bowl.wickets ? bowl.balls / bowl.wickets : null;
      if (bowl.bestW < 0) { bowl.bestW = 0; bowl.bestR = 0; }
    };
    const when = (m) => m.starts_at || m.created_at || "";
    const done = matches.filter((m) => m.status === "done" && m.summary).slice().sort((a, b) => (when(b) > when(a) ? 1 : when(b) < when(a) ? -1 : 0));
    const all = { matches: 0, wins: 0, bat: blankBat(), bowl: blankBowl() }, tours = new Map(), innings = [];
    for (const m of done) {
      const sm = m.summary, teamIds = [m.team1_id, m.team2_id], bpo = sm.bpo || 6;
      const bt = sm.bat.find((x) => x.id === id), bw = sm.bowl.find((x) => x.id === id);
      const team = bt ? bt.team : bw ? bw.team : null;
      if (team == null) continue;
      const tid = m.tournament_id || "", t = m.tournaments || {};
      if (!tours.has(tid)) tours.set(tid, { id: tid, name: t.name || "Matches", short: t.short_name || "", matches: 0, wins: 0, bat: blankBat(), bowl: blankBowl() });
      const T = tours.get(tid), won = !!m.winner_team_id && m.winner_team_id === teamIds[team];
      for (const x of [all, T]) { x.matches++; if (won) x.wins++; }
      const batted = !!(bt && (bt.balls || bt.out)), bowled = !!(bw && bw.balls);
      if (batted) { addBat(all.bat, bt); addBat(T.bat, bt); }
      if (bowled) { addBowl(all.bowl, bw, bpo); addBowl(T.bowl, bw, bpo); }
      innings.push({
        matchId: m.id, tournamentId: tid, date: when(m), teamId: teamIds[team], vsId: teamIds[1 - team], won,
        tie: !m.winner_team_id,
        bat: batted ? { runs: bt.runs, balls: bt.balls, out: bt.out, fours: bt.fours, sixes: bt.sixes } : null,
        bowl: bowled ? { wickets: bw.wickets, runs: bw.runs, balls: bw.balls, overs: E.oversText(bw.balls, bpo) } : null,
      });
    }
    finish(all.bat, all.bowl);
    for (const T of tours.values()) finish(T.bat, T.bowl);
    return Object.assign(all, { tours: [...tours.values()], innings });
  }

  const api = { summarize, pointsTable, leaders, mvp, tournamentMvp, career, MVP_RULES };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CSA = Object.assign(root.CSA || {}, { stats: api });
})(typeof window !== "undefined" ? window : globalThis);
