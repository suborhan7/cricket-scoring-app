// Scoring engine. A match is a list of events (balls, openers, bowler changes...).
// Every number on screen is worked out by replaying those events from the start,
// so undo is "drop the last event" and fixing an old ball is "change that event and replay".
// No DOM here: the same file runs in the browser and in Node tests.
(function (root) {
  const DEFAULTS = { oversPerSide: 20, ballsPerOver: 6, maxOversPerBowler: 4, wideRuns: 1, noBallRuns: 1, freeHit: true };

  // Dismissals the bowler gets credit for.
  const BOWLER_WICKETS = new Set(["bowled", "caught", "lbw", "stumped", "hitwicket"]);
  const WICKET_KINDS = {
    bowled: "Bowled", caught: "Caught", lbw: "LBW", stumped: "Stumped",
    hitwicket: "Hit wicket", runout: "Run out", retired: "Retired hurt",
  };

  function settings(match) { return Object.assign({}, DEFAULTS, match.rules || {}); }

  function newInnings(batting) {
    return {
      batting, bowling: 1 - batting,
      runs: 0, wickets: 0, legalBalls: 0,
      extras: { wd: 0, nb: 0, b: 0, lb: 0 },
      batters: [], bowlers: [], overs: [[]], fow: [],
      striker: null, nonStriker: null, bowler: null, lastBowler: null,
      overRuns: 0, freeHit: false, closed: false, closeReason: null,
    };
  }

  function batterOf(inn, p) {
    let b = inn.batters.find((x) => x.player === p);
    if (!b) { b = { player: p, runs: 0, balls: 0, fours: 0, sixes: 0, out: null }; inn.batters.push(b); }
    return b;
  }

  function bowlerOf(inn, p) {
    let b = inn.bowlers.find((x) => x.player === p);
    if (!b) { b = { player: p, balls: 0, runs: 0, wickets: 0, maidens: 0, wd: 0, nb: 0 }; inn.bowlers.push(b); }
    return b;
  }

  function oversText(balls, bpo) { return Math.floor(balls / bpo) + "." + (balls % bpo); }

  // Most wickets an innings can lose: one fewer than the batting side's players, capped at 10.
  function maxWickets(match, team) { return Math.max(1, Math.min(10, match.teams[team].players.length - 1)); }

  function ballLabel(e, total) {
    const r = e.runs || 0;
    let l;
    if (e.extra === "wd") l = total > 1 ? total + "wd" : "wd";
    else if (e.extra === "nb") l = r ? r + "nb" : "nb";
    else if (e.extra === "b" || e.extra === "lb") l = r + e.extra;
    else l = String(r);
    if (e.wicket && e.wicket.kind !== "retired") l = l === "0" ? "W" : l + "+W";
    return l;
  }

  function closeInnings(match, s, reason) {
    const inn = s.innings[s.current];
    inn.closed = true; inn.closeReason = reason;
    if (inn.overs.length > 1 && inn.overs[inn.overs.length - 1].length === 0) inn.overs.pop();
    if (s.current === 0) { s.current = 1; s.innings.push(newInnings(1 - inn.batting)); }
    else s.result = resultOf(match, s);
  }

  function resultOf(match, s) {
    const [a, b] = s.innings, rules = settings(match);
    if (b.runs > a.runs) {
      const left = maxWickets(match, b.batting) - b.wickets;
      const balls = rules.oversPerSide * rules.ballsPerOver - b.legalBalls;
      return { winner: b.batting, text: `${match.teams[b.batting].name} won by ${left} wicket${left === 1 ? "" : "s"}` + (balls > 0 ? ` (${balls} ball${balls === 1 ? "" : "s"} left)` : "") };
    }
    if (a.runs > b.runs) {
      const by = a.runs - b.runs;
      return { winner: a.batting, text: `${match.teams[a.batting].name} won by ${by} run${by === 1 ? "" : "s"}` };
    }
    return { winner: null, text: "Match tied" };
  }

  function applyBall(match, s, e, index) {
    const rules = settings(match), inn = s.innings[s.current];
    const ex = e.extra || null, runs = e.runs || 0;
    const legal = ex !== "wd" && ex !== "nb";
    const bat = batterOf(inn, inn.striker), bowl = bowlerOf(inn, inn.bowler);
    const before = { bat: bat.runs, wkts: bowl.wickets };
    let total = runs, charged = runs;

    if (ex === "wd") {
      total = rules.wideRuns + runs; charged = total;
      inn.extras.wd += total; bowl.wd += total;
    } else if (ex === "nb") {
      total = rules.noBallRuns + runs; charged = total;
      inn.extras.nb += rules.noBallRuns; bowl.nb += 1;
      bat.runs += runs; bat.balls += 1;
      if (runs === 4) bat.fours++; if (runs === 6) bat.sixes++;
    } else if (ex === "b" || ex === "lb") {
      inn.extras[ex] += runs; bat.balls += 1; charged = 0;
    } else {
      bat.runs += runs; bat.balls += 1;
      if (runs === 4) bat.fours++; if (runs === 6) bat.sixes++;
    }

    inn.runs += total; bowl.runs += charged; inn.overRuns += charged;
    if (legal) { inn.legalBalls++; bowl.balls++; }
    inn.overs[inn.overs.length - 1].push({ label: ballLabel(e, total), legal, wicket: !!(e.wicket && e.wicket.kind !== "retired"), runs: total, extra: ex, index });

    if (ex === "nb") inn.freeHit = rules.freeHit; else if (legal) inn.freeHit = false;

    // Completed runs swap the batters first; a run-out then removes whichever player was named.
    if (runs % 2 === 1) [inn.striker, inn.nonStriker] = [inn.nonStriker, inn.striker];

    const w = e.wicket;
    if (w) {
      const outPlayer = w.player != null ? w.player : bat.player;
      const outBat = batterOf(inn, outPlayer);
      outBat.out = { kind: w.kind, bowler: inn.bowler, fielder: w.fielder != null ? w.fielder : null };
      if (BOWLER_WICKETS.has(w.kind)) bowl.wickets++;
      if (w.kind !== "retired") {
        inn.wickets++;
        inn.fow.push({ wicket: inn.wickets, runs: inn.runs, player: outPlayer, over: oversText(inn.legalBalls, rules.ballsPerOver) });
      }
      if (inn.striker === outPlayer) inn.striker = null;
      else if (inn.nonStriker === outPlayer) inn.nonStriker = null;
    }

    // Milestones for the card alerts: 50 and 100 for batters, 3 and 5 wickets for bowlers.
    for (const m of [50, 100]) if (before.bat < m && bat.runs >= m) s.milestones.push({ kind: m === 50 ? "fifty" : "hundred", player: bat.player, team: inn.batting, runs: bat.runs, balls: bat.balls, index });
    for (const m of [3, 5]) if (before.wkts < m && bowl.wickets >= m) s.milestones.push({ kind: m === 3 ? "threefor" : "fivefor", player: bowl.player, team: inn.bowling, wickets: bowl.wickets, runs: bowl.runs, index });

    const overDone = legal && inn.legalBalls % rules.ballsPerOver === 0;
    if (overDone) {
      if (inn.overRuns === 0) bowl.maidens++;
      [inn.striker, inn.nonStriker] = [inn.nonStriker, inn.striker];
      inn.lastBowler = inn.bowler; inn.bowler = null; inn.overRuns = 0;
      inn.overs.push([]);
    }

    if (inn.wickets >= maxWickets(match, inn.batting)) closeInnings(match, s, "All out");
    else if (s.current === 1 && inn.runs > s.innings[0].runs) closeInnings(match, s, "Target reached");
    else if (inn.legalBalls >= rules.oversPerSide * rules.ballsPerOver) closeInnings(match, s, "Overs complete");
  }

  function apply(match, s, e, index) {
    if (s.result) return;
    const inn = s.innings[s.current];
    switch (e.t) {
      case "openers":
        inn.striker = e.striker; inn.nonStriker = e.nonStriker;
        batterOf(inn, e.striker); batterOf(inn, e.nonStriker);
        if (e.bowler != null) { inn.bowler = e.bowler; bowlerOf(inn, e.bowler); }
        break;
      case "batter":
        if (inn.striker == null) inn.striker = e.player; else inn.nonStriker = e.player;
        batterOf(inn, e.player).out = null;
        break;
      case "bowler":
        inn.bowler = e.bowler; bowlerOf(inn, e.bowler);
        break;
      case "retire": {
        // Retired hurt: leaves without a wicket and can bat again later.
        batterOf(inn, e.player).out = { kind: "retired", bowler: null, fielder: null };
        if (inn.striker === e.player) inn.striker = null; else if (inn.nonStriker === e.player) inn.nonStriker = null;
        break;
      }
      case "swap":
        [inn.striker, inn.nonStriker] = [inn.nonStriker, inn.striker];
        break;
      case "end":
        closeInnings(match, s, e.reason || "Innings ended");
        break;
      case "ball":
        if (nextStep(s) === "ball") applyBall(match, s, e, index);
        break;
    }
  }

  // What the scorer has to do next.
  function nextStep(s) {
    if (s.result) return "done";
    const inn = s.innings[s.current];
    if (inn.batters.length === 0) return "openers";
    if (inn.striker == null || inn.nonStriker == null) return "batter";
    if (inn.bowler == null) return "bowler";
    return "ball";
  }

  function replay(match, events) {
    const s = { innings: [newInnings(match.battingFirst || 0)], current: 0, result: null, milestones: [] };
    events.forEach((e, i) => apply(match, s, e, i));
    s.next = nextStep(s);
    return s;
  }

  // Players who can still come in to bat.
  function availableBatters(match, s) {
    const inn = s.innings[s.current];
    const used = new Set(inn.batters.filter((b) => b.out && b.out.kind !== "retired" || b.player === inn.striker || b.player === inn.nonStriker).map((b) => b.player));
    return match.teams[inn.batting].players.map((_, i) => i).filter((i) => !used.has(i));
  }

  // Bowlers allowed to bowl the next over: not the last over's bowler, and under the over limit.
  function availableBowlers(match, s) {
    const rules = settings(match), inn = s.innings[s.current];
    return match.teams[inn.bowling].players.map((_, i) => i).filter((i) => {
      if (i === inn.lastBowler) return false;
      const b = inn.bowlers.find((x) => x.player === i);
      return !b || b.balls < rules.maxOversPerBowler * rules.ballsPerOver;
    });
  }

  function chase(match, s) {
    if (s.current !== 1) return null;
    const rules = settings(match), [a, b] = s.innings;
    const target = a.runs + 1, ballsLeft = rules.oversPerSide * rules.ballsPerOver - b.legalBalls;
    return { target, need: Math.max(0, target - b.runs), ballsLeft, rrr: ballsLeft > 0 ? ((target - b.runs) * rules.ballsPerOver) / ballsLeft : 0 };
  }

  function dismissalText(match, inn, out) {
    if (!out) return "not out";
    const bowlTeam = match.teams[inn.bowling].players;
    const bw = out.bowler != null ? bowlTeam[out.bowler] : "";
    const f = out.fielder != null ? bowlTeam[out.fielder] : "";
    switch (out.kind) {
      case "bowled": return "b " + bw;
      case "lbw": return "lbw b " + bw;
      case "caught": return out.fielder === out.bowler ? "c & b " + bw : f ? `c ${f} b ${bw}` : "caught b " + bw;
      case "stumped": return f ? `st ${f} b ${bw}` : "stumped b " + bw;
      case "hitwicket": return "hit wicket b " + bw;
      case "runout": return f ? `run out (${f})` : "run out";
      case "retired": return "retired hurt";
    }
    return out.kind;
  }

  const api = { DEFAULTS, WICKET_KINDS, settings, replay, oversText, maxWickets, availableBatters, availableBowlers, chase, dismissalText };
  root.CSA = Object.assign(root.CSA || {}, { engine: api });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
