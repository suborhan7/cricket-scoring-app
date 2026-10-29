const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../js/cards.js");

const lum = (h) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0); };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("card themes keep white text and the accent readable for any colours", () => {
  for (const [c1, c2] of [["#FFFFFF", "#FFFFFF"], ["#F5C542", "#000000"], ["#0F7A45", "#0E1A14"], ["#87CEEB", "#FF69B4"], ["#B3261E", ""], [null, null]]) {
    const th = C.theme(c1, c2);
    assert.ok(contrast("#FFFFFF", th.base) >= 4.5, `white on ${th.base} for ${c1}`);
    assert.ok(contrast(th.accent, th.base) >= 4.5, `accent ${th.accent} on ${th.base} for ${c1}`);
  }
});

const tour = { name: "Winter Cup 2026", short: "WC26" };
test("milestone caption names the player, figures and hashtags", () => {
  const cap = C.caption("milestone", {
    tournament: tour, player: { name: "Rakib", team: "Dhaka Tigers", teamShort: "DT" }, opponent: "Chattogram Kings", opponentShort: "CK",
    milestone: { kind: "fifty", batting: true, runs: 54, balls: 31, notOut: true, fours: 4, sixes: 3 },
  });
  assert.match(cap, /FIFTY! Rakib brings up fifty for Dhaka Tigers against Chattogram Kings: 54\* off 31 balls/);
  assert.match(cap, /#WC26 #DTvCK #cricket$/);
  const bowl = C.caption("milestone", {
    tournament: tour, player: { name: "Shanto", team: "Dhaka Tigers", teamShort: "DT" }, opponent: "Chattogram Kings", opponentShort: "CK",
    milestone: { kind: "fivefor", batting: false, wickets: 5, runs: 18 },
  });
  assert.match(bowl, /FIVE-FOR! Shanto takes 5 for 18/);
});

test("table caption lists teams in order", () => {
  const cap = C.caption("table", { tournament: tour, table: { group: "A", rows: [{ name: "DT", pts: 4, nrr: "+1.000" }, { name: "CK", pts: 2, nrr: "−1.000" }] } });
  assert.equal(cap, "Winter Cup 2026 points table, Group A:\n1. DT 4 pts (NRR +1.000)\n2. CK 2 pts (NRR −1.000)\n\n#WC26 #cricket");
});

const DT = { name: "Dhaka Tigers", short: "DT" }, CK = { name: "Chattogram Kings", short: "CK" };
test("engagement card captions", () => {
  const sched = C.caption("schedule", { tournament: tour, schedule: { title: "Fixtures", rows: [
    { date: "Fri 30 Oct", teams: [DT, CK], time: "3:30 PM", venue: "Mirpur" },
    { date: "Tue 27 Oct", teams: [CK, DT], result: "Dhaka Tigers won by 5 wickets", venue: "Mirpur" },
  ] } });
  assert.match(sched, /Fri 30 Oct: Dhaka Tigers v Chattogram Kings, 3:30 PM at Mirpur\nTue 27 Oct: Chattogram Kings v Dhaka Tigers \(Dhaka Tigers won by 5 wickets\)\n/);
  const xi = C.caption("lineup", { tournament: tour, lineup: { toss: "DT won the toss", teams: [
    Object.assign({ players: [{ name: "Rakib", cap: true }, { name: "Jaker", wk: true }] }, DT), Object.assign({ players: [{ name: "Soumya" }] }, CK)] } });
  assert.match(xi, /Dhaka Tigers: Rakib \(c\), Jaker \(wk\)\n\nChattogram Kings: Soumya\n\n#WC26 #DTvCK #cricket$/);
  const lead = C.caption("leaders", { tournament: tour, leaders: { title: "Most runs", unit: "Runs", rows: [{ name: "Rakib", team: DT, value: 312 }] } });
  assert.match(lead, /most runs:\n1\. Rakib \(DT\) 312 runs/);
  assert.match(C.caption("champions", { tournament: tour, champions: { team: DT, result: "Beat Chattogram Kings in the final" } }), /^Dhaka Tigers are the Winter Cup 2026 champions! Beat Chattogram Kings in the final\.\n\n#WC26 #DT #champions #cricket$/);
  assert.match(C.caption("target", { tournament: tour, target: { batting: DT, chasing: CK, runs: 164, wickets: 7, overs: "20 ov", target: 165, balls: 120 } }), /Chattogram Kings need 165 runs from 120 balls/);
  assert.match(C.caption("potm", { tournament: tour, player: { name: "Rakib", team: "Dhaka Tigers" }, potm: { figures: "54 (31) · 2/18 in 4 ov", result: "Dhaka Tigers won by 5 wickets" } }), /^Player of the match: Rakib \(Dhaka Tigers\)! 54 \(31\) · 2\/18 in 4 ov\.\nDhaka Tigers won by 5 wickets/);
});

test("milestone cards have Spotlight and Split; other player cards Broadcast and Poster; the rest all three looks", () => {
  assert.deepEqual(C.stylesFor("potm"), [["H", "Halo"], ["S", "Spotlight"], ["P", "Split"]]);
  assert.deepEqual(C.stylesFor("award").map(([k]) => k), ["A", "B"]);
  assert.deepEqual(C.stylesFor("schedule"), [["T", "Timeline"], ["W", "Showdown"]]);
  assert.deepEqual(C.stylesFor("groups"), [["B", "Bands"], ["D", "Draw"], ["S", "Showcase"]]);
  assert.deepEqual(C.stylesFor("lineup"), [["D", "Duel"], ["P", "Split"], ["S", "Sheet"]]);
  assert.deepEqual(C.stylesFor("squad"), [["R", "Roster"], ["C", "Captain"], ["N", "Numbers"]]);
  assert.deepEqual(C.stylesFor("versus"), [["C", "Clash"], ["F", "Frames"], ["S", "Stack"]]);
  assert.deepEqual(C.stylesFor("table").map(([k]) => k), ["A", "B", "C"]);
  assert.deepEqual(C.stylesFor("milestone"), [["S", "Spotlight"], ["P", "Split"]]);
  assert.deepEqual(C.stylesFor("result"), [["F", "Face-off"], ["L", "Scoreline"], ["R", "Hero"]]);
  assert.deepEqual(C.stylesFor("batperf"), C.stylesFor("milestone"));
  assert.deepEqual(C.stylesFor("bowlperf"), C.stylesFor("milestone"));
  assert.deepEqual(C.stylesFor("allround"), C.stylesFor("potm"));
});

test("captions for performance cards", () => {
  const tour = { name: "Winter Cup 2026", short: "WC26" }, player = { name: "Rakib", team: "Dhaka Tigers", teamShort: "DT" };
  const base = { tournament: tour, player, opponent: "Chattogram Kings", opponentShort: "CK" };
  assert.match(C.caption("batperf", Object.assign({ milestone: { runs: 34, notOut: true, balls: 21, fours: 3, sixes: 2 } }, base)), /^Rakib made 34\* off 21 balls for Dhaka Tigers against Chattogram Kings, with 3 fours and 2 sixes\.\n\n#WC26 #DTvCK #cricket$/);
  assert.match(C.caption("bowlperf", Object.assign({ milestone: { wickets: 2, runs: 18, overs: "4" } }, base)), /^Rakib took 2 for 18 in 4 overs/);
  assert.match(C.caption("allround", Object.assign({ potm: { figures: "34* (21) & 2/18" } }, base)), /^All-round show from Rakib for Dhaka Tigers against Chattogram Kings: 34\* \(21\) & 2\/18\./);
});

test("captions for groups, runners-up and tournament awards", () => {
  const DT = { name: "Dhaka Tigers", short: "DT" }, CK = { name: "Chattogram Kings", short: "CK" };
  assert.match(C.caption("groups", { tournament: tour, groups: { groups: [{ name: "Group A", teams: [DT] }, { name: "Group B", teams: [CK] }] } }), /Group A: Dhaka Tigers\nGroup B: Chattogram Kings/);
  const ru = C.caption("champions", { tournament: tour, champions: { team: CK, silver: true, result: "Lost to Dhaka Tigers in the final" } });
  assert.match(ru, /Chattogram Kings finish as runners-up/);
  assert.match(ru, /#runnersup/);
  const aw = C.caption("award", { tournament: tour, player: { name: "Rakib", team: "Dhaka Tigers" }, award: { title: "Best batter", stats: [["148.6", "", "Strike rate"]] } });
  assert.match(aw, /^Best batter, Winter Cup 2026: Rakib \(Dhaka Tigers\)!\n148.6 strike rate/);
});
