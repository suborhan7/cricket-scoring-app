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
