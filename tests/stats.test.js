const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../js/engine.js");
const St = require("../js/stats.js");

const team = (name, n = 4) => ({ name, short: name.slice(0, 3).toUpperCase(), players: Array.from({ length: n }, (_, i) => `${name} ${i + 1}`) });
const ball = (runs, extra, wicket) => ({ t: "ball", runs, extra, wicket });

// Tigers make 10 in 1 over; Lions are all out for 4 (3 wickets with 4 players).
function played() {
  const match = { teams: [team("Tigers"), team("Lions")], battingFirst: 0, rules: { oversPerSide: 2, maxOversPerBowler: 1 } };
  const out = { kind: "bowled" };
  const ev = [
    { t: "openers", striker: 0, nonStriker: 1, bowler: 0 },
    ball(4), ball(6), ball(0), ball(0), ball(0), ball(0),
    { t: "bowler", bowler: 1 }, ball(0), ball(0), ball(0), ball(0), ball(0), ball(0),
    { t: "openers", striker: 0, nonStriker: 1, bowler: 0 },
    ball(4), ball(0, null, out), { t: "batter", player: 2 }, ball(0, null, out), { t: "batter", player: 3 }, ball(0, null, out),
  ];
  const s = E.replay(match, ev);
  return { match, s };
}

test("summary keeps innings totals and player figures", () => {
  const { match, s } = played();
  assert.ok(s.result, "match should be finished");
  const sm = St.summarize(match, s, [["t1", "t2", "t3", "t4"], ["l1", "l2", "l3", "l4"]]);
  assert.deepEqual(sm.innings.map((i) => [i.team, i.runs, i.wickets, i.balls, i.allOut]), [[0, 10, 0, 12, false], [1, 4, 3, 4, true]]);
  const top = sm.bat.find((b) => b.id === "t1");
  assert.equal(top.runs, 10);
  assert.equal(sm.bowl.find((b) => b.id === "t1").wickets, 3);
});

test("points table: win gives 2 points, all-out counts the full overs for NRR", () => {
  const { match, s } = played();
  const summary = St.summarize(match, s, null);
  const m = { team1_id: "A", team2_id: "B", status: "done", winner_team_id: "A", summary };
  const tie = { team1_id: "A", team2_id: "C", status: "done", winner_team_id: null, summary: null };
  const wash = { team1_id: "B", team2_id: "C", status: "abandoned" };
  const live = { team1_id: "B", team2_id: "C", status: "live" };
  const rows = St.pointsTable(["A", "B", "C"], [m, tie, wash, live]);
  assert.deepEqual(rows.map((r) => [r.id, r.p, r.w, r.l, r.t, r.nr, r.pts]), [["A", 2, 1, 0, 1, 0, 3], ["C", 2, 0, 0, 1, 1, 2], ["B", 2, 0, 1, 0, 1, 1]]);
  // A: 10 off 12 balls (5.00) minus 4 off 12 balls, all out over a 2-over quota (2.00).
  assert.equal(rows[0].nrr.toFixed(3), "3.000");
  assert.equal(rows[2].nrr.toFixed(3), "-3.000");
});

test("leaders add up across matches", () => {
  const { match, s } = played();
  const summary = St.summarize(match, s, [["t1", "t2", "t3", "t4"], ["l1", "l2", "l3", "l4"]]);
  const ms = [1, 2].map(() => ({ team1_id: "A", team2_id: "B", status: "done", winner_team_id: "A", summary }));
  const L = St.leaders(ms);
  assert.equal(L.runs[0].id, "t1");
  assert.equal(L.runs[0].runs, 20);
  assert.equal(L.runs[0].avg, null); // never out
  assert.equal(L.wickets[0].id, "t1");
  assert.equal(L.wickets[0].wickets, 6);
  assert.equal(L.wickets[0].bestW, 3);
});

test("records list single innings: highest scores, best figures, sixes", () => {
  const sm = (bat, bowl) => ({ v: 1, maxBalls: 60, bpo: 6, innings: [], bat, bowl });
  const ms = [
    { id: "m1", team1_id: "A", team2_id: "B", status: "done", summary: sm(
      [{ id: "p1", name: "One", team: 0, runs: 70, balls: 40, fours: 5, sixes: 4, out: true }, { id: "p2", name: "Two", team: 1, runs: 70, balls: 50, fours: 8, sixes: 0, out: false }],
      [{ id: "p3", name: "Three", team: 1, balls: 24, runs: 20, wickets: 3 }, { id: "p4", name: "Four", team: 0, balls: 12, runs: 30, wickets: 0 }]) },
    { id: "m2", team1_id: "A", team2_id: "B", status: "done", summary: sm(
      [{ id: "p1", name: "One", team: 0, runs: 12, balls: 6, fours: 0, sixes: 2, out: true }],
      [{ id: "p3", name: "Three", team: 1, balls: 24, runs: 15, wickets: 3 }]) },
    { id: "m3", team1_id: "A", team2_id: "B", status: "live", summary: sm([{ id: "p9", name: "Live", team: 0, runs: 200, balls: 50, fours: 0, sixes: 30, out: false }], []) },
  ];
  const L = St.leaders(ms);
  assert.deepEqual(L.scores.map((x) => [x.id, x.runs, x.out]), [["p2", 70, false], ["p1", 70, true], ["p1", 12, true]]);
  assert.equal(L.scores[0].vsId, "A");
  assert.deepEqual(L.figures.map((x) => [x.id, `${x.wickets}/${x.runs}`, x.overs, x.matchId]), [["p3", "3/15", "4.0", "m2"], ["p3", "3/20", "4.0", "m1"]]);
  assert.deepEqual(L.sixes.map((x) => [x.id, x.sixes]), [["p1", 6]]);
  assert.deepEqual(L.fours.map((x) => [x.id, x.fours]), [["p2", 8], ["p1", 5]]);
});

test("player of the match points", () => {
  const team = (name) => ({ name, short: name.slice(0, 3), players: ["A", "B", "C", "D"] });
  const match = { teams: [team("Tigers"), team("Lions")], battingFirst: 0, rules: { oversPerSide: 1, maxOversPerBowler: 1 } };
  const s = E.replay(match, [
    { t: "openers", striker: 0, nonStriker: 1, bowler: 3 },
    { t: "ball", runs: 6 }, { t: "ball", runs: 4 }, { t: "ball", runs: 0 },
    { t: "ball", runs: 0, wicket: { kind: "caught", fielder: 2 } }, { t: "batter", player: 2 },
    { t: "ball", runs: 0 }, { t: "ball", runs: 1 },
  ]);
  const list = St.mvp(match, s);
  const bat = list.find((x) => x.team === 0 && x.player === 0);
  assert.equal(bat.pts, 10 + 1 + 2); // 10 runs, a four, a six
  const bowl = list.find((x) => x.team === 1 && x.player === 3);
  assert.equal(bowl.pts, 20 + 3); // a wicket and three dot balls
  assert.equal(list[0], bowl);
  const catcher = list.find((x) => x.team === 1 && x.player === 2);
  assert.equal(catcher.pts, 8);
  assert.equal(catcher.line, "1 catch");
});
