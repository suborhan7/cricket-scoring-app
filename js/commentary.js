// Ball-by-ball commentary for fans, written from the scored balls alone: who bowled to whom,
// what happened, an end-of-over summary, wickets with the dismissal, and fifties and five-fors.
// Lines are picked by the ball's position, so the same ball always reads the same way.
// No DOM here: the same file runs in the browser and in Node tests.
(function (root) {
  const E = root.CSA && root.CSA.engine ? root.CSA.engine : typeof require === "function" ? require("./engine.js") : null;

  const FOUR = ["FOUR", "FOUR, races away to the rope", "FOUR, finds the gap", "FOUR, cracking shot"];
  const SIX = ["SIX", "SIX, into the crowd", "SIX, huge hit", "SIX, clears the rope with ease"];
  const DOT = ["no run", "no run", "dot ball"];
  const OUT = { bowled: "Bowled!", caught: "Caught!", lbw: "LBW!", stumped: "Stumped!", runout: "Run out!", hitwicket: "Hit wicket!" };
  const MS = { fifty: "brings up a fifty", hundred: "brings up a HUNDRED", threefor: "takes a three-for", fivefor: "takes a FIVE-FOR" };
  const pick = (list, i) => list[i % list.length];
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

  // What happened off one ball, as Cricbuzz writes it after "Bowler to Batter,".
  function ballText(b, rules, i) {
    const hit = b.hit || 0;
    let t;
    if (b.extra === "wd") t = b.runs > rules.wideRuns ? `${plural(b.runs, "wide")}` : "wide";
    else if (b.extra === "nb") t = hit === 4 ? "no ball, and FOUR" : hit === 6 ? "no ball, and SIX" : hit ? `no ball, ${plural(hit, "run")}` : "no ball";
    else if (b.extra === "b") t = plural(b.runs, "bye");
    else if (b.extra === "lb") t = plural(b.runs, "leg bye");
    else if (hit === 4) t = pick(FOUR, i);
    else if (hit === 6) t = pick(SIX, i);
    else if (hit === 0) t = b.wicket ? "" : pick(DOT, i);
    else t = plural(hit, "run");
    if (b.wicket) t = `OUT! ${OUT[b.out.kind] || ""}${t && t !== "no run" ? ` ${t[0].toUpperCase()}${t.slice(1)}` : ""}`.trim();
    return t;
  }

  // Tag shown in the ball's circle: W, 4, 6, wd, nb or the runs.
  function tagOf(b) {
    if (b.wicket) return "W";
    if (b.extra === "wd" || b.extra === "nb") return b.extra;
    if (b.extra) return String(b.runs);
    return String(b.runs);
  }
  function kindOf(b) {
    if (b.wicket) return "w";
    if (b.extra === "wd" || b.extra === "nb") return "x";
    if (!b.extra && b.hit === 4) return "4";
    if (!b.extra && b.hit === 6) return "6";
    return b.runs ? "r" : "0";
  }

  // Every innings played, newest first, each with its items newest first:
  //   { k: "ball", n: "12.3", tag, kind, text, out?: "Rakib c Sami b Hasan 34 (22)" }
  //   { k: "over", n: 12, runs, wkts, score, bowler: "Hasan Mahmud 3-0-24-1", batters: ["Rakib 34 (22)", ...] }
  //   { k: "milestone", text, kind }
  //   { k: "end", text }      innings over
  function build(match, s) {
    const rules = E.settings(match), bpo = rules.ballsPerOver, t = match.teams;
    const milestones = new Map();
    for (const m of s.milestones || []) {
      if (!milestones.has(m.index)) milestones.set(m.index, []);
      milestones.get(m.index).push(m);
    }
    return s.innings.map((inn, n) => {
      const name = (team, p) => (p == null ? "" : t[team].players[p]);
      const items = [];
      const bowl = new Map(), crease = new Map();
      let legal = 0;
      inn.overs.forEach((over, o) => {
        let overRuns = 0, overWkts = 0, inOver = 0;
        over.forEach((b) => {
          const num = `${Math.floor(legal / bpo)}.${Math.min(bpo, inOver + 1)}`;
          if (b.legal) { legal++; inOver++; }
          const charged = b.extra === "b" || b.extra === "lb" ? 0 : b.runs;
          const fig = bowl.get(b.bowler) || { balls: 0, runs: 0, wkts: 0, maidens: 0 };
          if (b.legal) fig.balls++;
          fig.runs += charged;
          if (b.wicket && !["runout", "retired"].includes(b.out.kind)) fig.wkts++;
          bowl.set(b.bowler, fig);
          overRuns += charged; if (b.wicket) overWkts++;
          crease.set(b.batter, `${b.batRuns} (${b.batBalls})`);
          const item = { k: "ball", n: num, tag: tagOf(b), kind: kindOf(b), index: b.index, score: b.score,
            who: `${name(inn.bowling, b.bowler)} to ${name(inn.batting, b.batter)}`, text: ballText(b, rules, b.index) };
          if (b.out) {
            const who = name(inn.batting, b.out.player);
            if (b.wicket) item.out = `${who} ${b.out.text} ${b.out.runs} (${b.out.balls})`;
            else item.text += `${item.text ? ". " : ""}${who} retires hurt`;
            crease.delete(b.out.player);
          }
          items.push(item);
          for (const m of milestones.get(b.index) || []) {
            const who = name(m.team, m.player);
            items.push({ k: "milestone", kind: m.kind, index: b.index,
              text: `${who} ${MS[m.kind]}, ${m.wickets != null ? `${m.wickets}/${m.runs}` : `${m.runs} (${m.balls})`}` });
          }
        });
        const complete = over.length && inOver === bpo;
        if (complete) {
          const bw = over[over.length - 1].bowler, fig = bowl.get(bw);
          if (overRuns === 0) fig.maidens++;
          items.push({ k: "over", n: o + 1, runs: overRuns, wkts: overWkts, score: over[over.length - 1].score,
            bowler: `${name(inn.bowling, bw)} ${Math.floor(fig.balls / bpo)}${fig.balls % bpo ? "." + (fig.balls % bpo) : ""}-${fig.maidens}-${fig.runs}-${fig.wkts}`,
            batters: [...crease].map(([p, f]) => `${name(inn.batting, p)} ${f}`) });
        }
      });
      if (inn.closed) {
        const reason = inn.closeReason === "Target reached" && s.result ? s.result.text : inn.closeReason;
        items.push({ k: "end", text: `${t[inn.batting].name} ${inn.runs}-${inn.wickets} (${E.oversText(inn.legalBalls, bpo)} ov) · ${reason}` });
      }
      return { n, batting: inn.batting, items: items.reverse() };
    }).reverse();
  }

  // The newest moment worth an alert or a headline: a wicket, a milestone or the result.
  const KEY = (it) => it.k === "milestone" || (it.k === "ball" && (it.kind === "w" || it.kind === "4" || it.kind === "6"));

  // Small live score for the home feed and for fans' cheap polling (matches.live).
  // h changes whenever any ball changes, so fans only download the balls when it does.
  function snapshot(match, s, events) {
    const rules = E.settings(match), bpo = rules.ballsPerOver, t = match.teams;
    const inn = s.innings[s.current], ch = E.chase(match, s), json = JSON.stringify(events);
    let h = 5381;
    for (let i = 0; i < json.length; i++) h = ((h * 33) ^ json.charCodeAt(i)) >>> 0;
    const out = { v: 1, n: events.length, h: h.toString(36), bpo,
      inn: s.innings.filter((x) => x.batters.length || x === s.innings[0]).map((x) => ({ team: x.batting, r: x.runs, w: x.wickets, b: x.legalBalls })) };
    if (s.result) out.line = s.result.text;
    else if (ch && inn.batters.length) out.line = `${t[inn.batting].short} need ${ch.need} off ${ch.ballsLeft}`;
    else if (s.current === 1) out.line = `Innings break · ${t[inn.batting].short} need ${s.innings[0].runs + 1}`;
    else if (match.toss) out.line = `${t[match.toss.winner].short} chose to ${match.toss.decision}`;
    const over = inn.overs[inn.overs.length - 1] || [];
    if (!s.result && over.length) out.last = over.map((b) => b.label).join(" ");
    return out;
  }

  // Moments that fans following the match get an alert for. Wickets and milestones only
  // while they're fresh (the last few balls), so a phone syncing late doesn't flood anyone.
  function moments(match, s, events, fresh = 18) {
    const t = match.teams, label = `${t[0].short} v ${t[1].short}`, rules = E.settings(match);
    const recent = (i) => i >= events.length - fresh, list = [];
    const score = (inn) => `${t[inn.batting].short} ${inn.runs}-${inn.wickets} (${E.oversText(inn.legalBalls, rules.ballsPerOver)})`;
    if (s.innings[0].batters.length && events.length <= fresh) list.push({ ev: "start", key: "start", title: `${t[0].name} v ${t[1].name} is live`, body: match.toss ? `${t[match.toss.winner].name} won the toss and chose to ${match.toss.decision}` : "" });
    s.innings.forEach((inn, n) => {
      for (const over of inn.overs) for (const b of over) if (b.wicket && recent(b.index)) {
        const who = t[inn.batting].players[b.out.player];
        list.push({ ev: "wicket", key: `w:${n}:${b.index}`, title: `WICKET! ${who} ${b.out.runs} (${b.out.balls})`, body: `${who} ${b.out.text} · ${t[inn.batting].short} ${b.score} (${b.ov}) · ${label}` });
      }
    });
    for (const m of s.milestones || []) if (recent(m.index)) {
      const who = t[m.team].players[m.player];
      list.push({ ev: "milestone", key: `m:${m.kind}:${m.team}:${m.player}`, title: `${who} ${MS[m.kind]}`,
        body: `${m.wickets != null ? `${m.wickets}/${m.runs}` : `${m.runs} (${m.balls})`} · ${label}` });
    }
    if (s.innings[0].closed && !s.result) {
      list.push({ ev: "innings", key: "inn", title: `Innings break: ${score(s.innings[0])}`, body: `${t[s.innings[1].batting].name} need ${s.innings[0].runs + 1} to win · ${label}` });
    }
    if (s.result) list.push({ ev: "result", key: "result", title: s.result.text, body: s.innings.map(score).join(" · ") });
    return list;
  }

  const api = { build, ballText, KEY, snapshot, moments };
  root.CSA = Object.assign(root.CSA || {}, { commentary: api });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
