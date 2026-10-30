// Run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../js/engine.js");
const C = require("../js/commentary.js");

const team = (name, n = 11) => ({ name, short: name.slice(0, 3).toUpperCase(), players: Array.from({ length: n }, (_, i) => `${name} ${i + 1}`) });
const match = () => ({ teams: [team("Tigers"), team("Lions")], battingFirst: 0, rules: { oversPerSide: 2, maxOversPerBowler: 1 } });
const ball = (runs, extra, wicket) => ({ t: "ball", runs, extra, wicket });
const start = [{ t: "openers", striker: 0, nonStriker: 1, bowler: 0 }];

test("each ball reads bowler to batter with what happened, newest first", () => {
  const m = match();
  const s = E.replay(m, [...start, ball(0), ball(4), ball(1, "lb"), ball(0, "wd"), ball(6)]);
  const items = C.build(m, s)[0].items;
  assert.equal(items.length, 5);
  assert.equal(items[0].n, "0.4");
  assert.equal(items[0].who, "Lions 1 to Tigers 2");
  assert.match(items[0].text, /^SIX/);
  assert.equal(items[1].text, "wide");
  assert.equal(items[1].n, "0.4"); // a wide keeps the next ball's number
  assert.equal(items[2].text, "1 leg bye");
  assert.match(items[3].text, /^FOUR/);
  assert.equal(items[3].who, "Lions 1 to Tigers 1");
  assert.equal(items[3].kind, "4");
});

test("wickets carry the dismissal and the batter's score", () => {
  const m = match();
  const s = E.replay(m, [...start, ball(2), ball(0, null, { kind: "caught", fielder: 3 })]);
  const w = C.build(m, s)[0].items[0];
  assert.equal(w.tag, "W");
  assert.equal(w.text, "OUT! Caught!");
  assert.equal(w.out, "Tigers 1 c Lions 4 b Lions 1 2 (2)");
});

test("end of over summary with the bowler's figures and the batters", () => {
  const m = match();
  const s = E.replay(m, [...start, ball(1), ball(0), ball(0), ball(4), ball(0), ball(0)]);
  const over = C.build(m, s)[0].items[0];
  assert.equal(over.k, "over");
  assert.equal(over.runs, 5);
  assert.equal(over.score, "5-0");
  assert.equal(over.bowler, "Lions 1 1-0-5-0");
  assert.deepEqual(over.batters.sort(), ["Tigers 1 1 (1)", "Tigers 2 4 (5)"]);
});

test("innings break shows as its own line and the second innings comes first", () => {
  const m = match();
  m.rules.oversPerSide = 1;
  const s = E.replay(m, [...start, ...Array(6).fill(ball(1)), { t: "openers", striker: 0, nonStriker: 1, bowler: 0 }, ball(2)]);
  const inns = C.build(m, s);
  assert.equal(inns.length, 2);
  assert.equal(inns[0].batting, 1);
  assert.equal(inns[1].items[0].k, "end");
  assert.match(inns[1].items[0].text, /Tigers 6-0 \(1.0 ov\) · Overs complete/);
});

test("live snapshot: score, chase line, and a hash that changes when a ball is fixed", () => {
  const m = match();
  m.rules.oversPerSide = 1;
  const ev = [...start, ...Array(6).fill(ball(1)), { t: "openers", striker: 0, nonStriker: 1, bowler: 0 }, ball(2)];
  const a = C.snapshot(m, E.replay(m, ev), ev);
  assert.deepEqual(a.inn, [{ team: 0, r: 6, w: 0, b: 6 }, { team: 1, r: 2, w: 0, b: 1 }]);
  assert.equal(a.line, "LIO need 5 off 5");
  assert.equal(a.last, "2");
  const ev2 = ev.slice(); ev2[1] = ball(2);
  assert.notEqual(C.snapshot(m, E.replay(m, ev2), ev2).h, a.h);
});

test("follower alerts: fresh wickets and milestones, innings break and the result", () => {
  const m = match();
  m.rules.oversPerSide = 1;
  const ev = [...start, ball(0, null, { kind: "bowled" }), { t: "batter", player: 2 }, ...Array(5).fill(ball(0)),
    { t: "openers", striker: 0, nonStriker: 1, bowler: 0 }, ball(4)];
  const list = C.moments(m, E.replay(m, ev), ev);
  assert.deepEqual(list.map((x) => x.key), ["start", "w:0:1", "result"]);
  assert.equal(list[1].title, "WICKET! Tigers 1 0 (1)");
  assert.match(list[1].body, /Tigers 1 b Lions 1 · TIG 0-1 \(0.1\)/);
  assert.equal(list[2].title, "Lions won by 10 wickets (5 balls left)");
  // Old wickets aren't sent again from a late sync.
  assert.deepEqual(C.moments(m, E.replay(m, ev), ev, 3).map((x) => x.key), ["result"]);
});
