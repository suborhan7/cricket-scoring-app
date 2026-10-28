// Run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../js/engine.js");

const team = (name, n = 11) => ({ name, short: name.slice(0, 3).toUpperCase(), players: Array.from({ length: n }, (_, i) => `${name} ${i + 1}`) });
const match = (rules = {}) => ({ teams: [team("Tigers"), team("Lions")], battingFirst: 0, rules: Object.assign({ oversPerSide: 2, maxOversPerBowler: 1 }, rules) });
const ball = (runs, extra, wicket) => ({ t: "ball", runs, extra, wicket });
const start = [{ t: "openers", striker: 0, nonStriker: 1, bowler: 0 }];

test("runs, strike rotation and end of over", () => {
  const s = E.replay(match(), [...start, ball(1), ball(4), ball(0), ball(2), ball(6), ball(3)]);
  const inn = s.innings[0];
  assert.equal(inn.runs, 16);
  assert.equal(inn.legalBalls, 6);
  assert.equal(inn.batters[1].runs, 15); // player 2 faced 4, 0, 2, 6, 3
  // 3 off the last ball swaps, then the over ends and swaps back.
  assert.equal(inn.striker, 1);
  assert.equal(inn.bowler, null);
  assert.equal(s.next, "bowler");
});

test("wides and no-balls don't count as balls; byes go to extras", () => {
  const s = E.replay(match(), [...start, ball(0, "wd"), ball(2, "wd"), ball(4, "nb"), ball(1, "lb"), ball(2, "b")]);
  const inn = s.innings[0];
  assert.equal(inn.runs, 1 + 3 + 5 + 1 + 2);
  assert.equal(inn.legalBalls, 2);
  assert.deepEqual(inn.extras, { wd: 4, nb: 1, b: 2, lb: 1 });
  assert.equal(inn.batters[0].runs, 4); // the four off the no-ball
  assert.equal(inn.bowlers[0].runs, 1 + 3 + 5); // byes and leg byes aren't charged to the bowler
  assert.equal(inn.overs[0].map((b) => b.label).join(" "), "wd 3wd 4nb 1lb 2b");
});

test("free hit follows a no-ball", () => {
  let s = E.replay(match(), [...start, ball(0, "nb")]);
  assert.equal(s.innings[0].freeHit, true);
  s = E.replay(match(), [...start, ball(0, "nb"), ball(0, "wd")]);
  assert.equal(s.innings[0].freeHit, true);
  s = E.replay(match(), [...start, ball(0, "nb"), ball(1)]);
  assert.equal(s.innings[0].freeHit, false);
});

test("wickets: bowler credit, run out of the non-striker, new batter fills the gap", () => {
  const ev = [...start, ball(0, null, { kind: "bowled" })];
  let s = E.replay(match(), ev);
  assert.equal(s.next, "batter");
  assert.equal(s.innings[0].bowlers[0].wickets, 1);
  ev.push({ t: "batter", player: 2 }, ball(1, null, { kind: "runout", player: 2, fielder: 5 }));
  s = E.replay(match(), ev);
  const inn = s.innings[0];
  assert.equal(inn.wickets, 2);
  assert.equal(inn.bowlers[0].wickets, 1); // run out isn't the bowler's
  assert.equal(inn.runs, 1);
  assert.deepEqual(E.availableBatters(match(), s), [3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(E.dismissalText(match(), inn, inn.batters[2].out), "run out (Lions 6)");
});

test("undo is just dropping the last event", () => {
  const ev = [...start, ball(4), ball(6)];
  assert.equal(E.replay(match(), ev).innings[0].runs, 10);
  assert.equal(E.replay(match(), ev.slice(0, -1)).innings[0].runs, 4);
});

test("fixing an old ball changes every total", () => {
  const ev = [...start, ball(4), ball(1), ball(0)];
  ev[1] = ball(6); // scorer pressed 4 but it was a six
  const inn = E.replay(match(), ev).innings[0];
  assert.equal(inn.runs, 7);
  assert.equal(inn.batters[0].sixes, 1);
  assert.equal(inn.batters[0].fours, 0);
});

test("chase: target reached ends the match with balls left", () => {
  const m = match();
  const ev = [...start];
  for (const r of [1, 1, 1, 1, 1, 1]) ev.push(ball(r));
  ev.push({ t: "bowler", bowler: 1 });
  for (const r of [0, 0, 0, 0, 0, 0]) ev.push(ball(r));
  let s = E.replay(m, ev);
  assert.equal(s.current, 1);
  assert.equal(s.innings[0].closeReason, "Overs complete");
  assert.equal(E.chase(m, s).target, 7);
  ev.push({ t: "openers", striker: 0, nonStriker: 1, bowler: 0 }, ball(6), ball(1));
  s = E.replay(m, ev);
  assert.equal(s.next, "done");
  assert.equal(s.result.text, "Lions won by 10 wickets (10 balls left)");
});

test("all out with a small squad", () => {
  const m = { teams: [team("Tigers", 3), team("Lions", 3)], battingFirst: 0, rules: { oversPerSide: 5 } };
  const ev = [...start, ball(0, null, { kind: "bowled" }), { t: "batter", player: 2 }, ball(0, null, { kind: "lbw" })];
  const s = E.replay(m, ev);
  assert.equal(s.innings[0].closeReason, "All out");
  assert.equal(s.current, 1);
});

test("milestones: fifty", () => {
  const m = match({ oversPerSide: 20, maxOversPerBowler: 20 });
  const ev = [...start];
  for (let i = 0; i < 6; i++) ev.push(ball(6)); // 36, over ends and strike changes
  ev.push({ t: "bowler", bowler: 1 }, ball(1), ball(6), ball(6), ball(6));
  const s = E.replay(m, ev);
  assert.equal(s.milestones.length, 1);
  assert.equal(s.milestones[0].kind, "fifty");
  assert.equal(s.milestones[0].runs, 54);
});

test("maiden over", () => {
  const s = E.replay(match(), [...start, ball(0), ball(0), ball(1, "lb"), ball(0), ball(0), ball(0)]);
  assert.equal(s.innings[0].bowlers[0].maidens, 1);
});

test("balls are ignored until a bowler is picked", () => {
  const s = E.replay(match(), [...start, ball(0), ball(0), ball(0), ball(0), ball(0), ball(0), ball(4)]);
  assert.equal(s.innings[0].runs, 0);
  assert.equal(s.next, "bowler");
});

test("retired hurt is not a wicket and the batter can come back", () => {
  let ev = [...start, ball(2), { t: "retire", player: 0 }];
  let s = E.replay(match(), ev);
  assert.equal(s.innings[0].wickets, 0);
  assert.equal(s.next, "batter");
  assert.ok(E.availableBatters(match(), s).includes(0));
  ev.push({ t: "batter", player: 0 });
  s = E.replay(match(), ev);
  assert.equal(s.innings[0].batters[0].out, null);
  assert.equal(s.innings[0].batters[0].runs, 2);
});

test("removing or fixing an old ball replays cleanly", () => {
  const out = { kind: "bowled" };
  const ev = [...start, ball(1), ball(0, null, out), { t: "batter", player: 2 }, ball(4)];
  let s = E.replay(match(), ev);
  assert.equal(s.innings[0].wickets, 1);
  // Remove the wicket ball: the original batter stays in and the later "new batter" is skipped.
  const removed = ev.slice(); removed[2] = { t: "void", was: ev[2] };
  s = E.replay(match(), removed);
  const inn = s.innings[0];
  assert.equal(inn.wickets, 0);
  assert.equal(inn.runs, 5);
  assert.deepEqual([inn.striker, inn.nonStriker].sort(), [0, 1]);
  assert.equal(inn.batters.length, 2);
  // Change the single to a two: strike changes and every later total follows.
  const fixed = ev.slice(); fixed[1] = ball(2);
  s = E.replay(match(), fixed);
  assert.equal(s.innings[0].runs, 6);
  // Player 1 keeps strike after the two, so they are the one bowled; player 3 hits the four.
  assert.equal(s.innings[0].batters[0].runs, 2);
  assert.equal(s.innings[0].batters[0].out.kind, "bowled");
  assert.equal(s.innings[0].batters.find((b) => b.player === 2).runs, 4);
});
