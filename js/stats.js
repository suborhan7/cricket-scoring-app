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
    const bat = new Map(), bowl = new Map();
    for (const m of matches) {
      const sm = m.summary;
      if (m.status !== "done" || !sm) continue;
      const teamIds = [m.team1_id, m.team2_id];
      for (const b of sm.bat) {
        const k = keyOf(b, teamIds[b.team]);
        const x = bat.get(k) || { key: k, id: b.id, name: b.name, teamId: teamIds[b.team], inns: 0, runs: 0, balls: 0, fours: 0, sixes: 0, outs: 0, best: 0, bestOut: true, fifties: 0, hundreds: 0 };
        x.name = b.name; x.inns++; x.runs += b.runs; x.balls += b.balls; x.fours += b.fours; x.sixes += b.sixes;
        if (b.out) x.outs++;
        if (b.runs > x.best || (b.runs === x.best && !b.out)) { x.best = b.runs; x.bestOut = b.out; }
        if (b.runs >= 100) x.hundreds++; else if (b.runs >= 50) x.fifties++;
        bat.set(k, x);
      }
      for (const b of sm.bowl) {
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
    return { runs, wickets };
  }

  const api = { summarize, pointsTable, leaders };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CSA = Object.assign(root.CSA || {}, { stats: api });
})(typeof window !== "undefined" ? window : globalThis);
