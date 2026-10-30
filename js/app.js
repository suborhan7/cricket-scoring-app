// Screens: home (saved matches), setup (new match), score (the scoring pad), card (scorecard).
// Everything re-renders from the saved events after each tap; see engine.js.
(function () {
  const E = CSA.engine, S = CSA.store;
  const $app = document.getElementById("app");
  const $sheet = document.getElementById("sheet");
  const $toast = document.getElementById("toast");

  let view = { screen: "home", tab: 0 };
  let rec = null;   // { match, events } for the open match
  let sheet = null; // open bottom sheet: { kind, ...form }
  let setup = null; // new-match form

  const SAMPLE = [
    { name: "Shapla Strikers", players: "Tanvir Ahmed\nRakib Hasan\nSajid Rahman\nNayeem Islam\nArif Chowdhury\nMahin Kabir\nFahim Uddin\nRiyad Hossain\nSabbir Alam\nImran Khan\nJubayer Ali" },
    { name: "Padma Warriors", players: "Shakib Mridha\nTamim Sarkar\nMehedi Hasan\nNasir Uddin\nSoumya Paul\nAnamul Haque\nRubel Mia\nTaijul Islam\nNahid Rana\nShoriful Alam\nHasan Mahmud" },
  ];
  const PRESETS = [["T10", 10], ["T20", 20], ["50 overs", 50]];

  const APP = (CSA.config && CSA.config.appName) || "CricPulse";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // The name with its last part in the accent colour, for the top bar.
  const BRAND = esc(APP).replace(/(Pulse)$/, '<span class="brand-accent">$1</span>');
  const shortName = (name) => {
    const w = name.trim().split(/\s+/);
    return (w.length > 1 ? w.map((x) => x[0]).join("") : name.slice(0, 3)).toUpperCase().slice(0, 4);
  };
  const buzz = () => { try { navigator.vibrate && navigator.vibrate(12); } catch (e) {} };
  const sr = (r, b) => (b ? ((r * 100) / b).toFixed(1) : "–");
  const econ = (r, balls, bpo) => (balls ? ((r * bpo) / balls).toFixed(2) : "–");

  function st() { return E.replay(rec.match, rec.events); }
  function rules() { return E.settings(rec.match); }
  function name(team, p) { return p == null ? "" : rec.match.teams[team].players[p]; }

  // A toast can carry an action (e.g. open the milestone card); it then stays a little longer.
  function toast(msg, act) {
    $toast.textContent = msg; $toast.hidden = false;
    for (const k of Object.keys($toast.dataset)) delete $toast.dataset[k];
    if (act) Object.assign($toast.dataset, act);
    $toast.classList.toggle("toast-act", !!act);
    clearTimeout(toast.t); toast.t = setTimeout(() => { $toast.hidden = true; }, act ? 7000 : 3500);
  }

  // ---------- Events ----------

  function push(e) {
    const before = st();
    rec.events.push(e);
    const after = st();
    if (after.innings[before.current] && JSON.stringify(after) === JSON.stringify(before)) { rec.events.pop(); return; }
    S.save(rec); buzz(); CSA.ui.changed(rec);
    const m = after.milestones.find((x) => x.index === rec.events.length - 1);
    if (m) {
      const team = m.team, who = name(team, m.player);
      const what = { fifty: `${m.runs} (${m.balls})`, hundred: `${m.runs} (${m.balls})`, threefor: `${m.wickets}/${m.runs}`, fivefor: `${m.wickets}/${m.runs}` }[m.kind];
      const label = { fifty: "Fifty", hundred: "Hundred", threefor: "Three-for", fivefor: "Five-for" }[m.kind];
      toast(`${label} card ready: ${who} ${what}. Tap to open.`, { act: "milestone-card", i: String(m.index) });
    }
    if (after.current !== before.current && !after.result) {
      // A quick match lives only on this phone, so the break is a good moment for a backup.
      if (!rec.match.cloud) toast(`Innings break. Target ${after.innings[0].runs + 1}. Tap to send a backup link.`, { act: "backup-link" });
      else toast(`Innings break. Target ${after.innings[0].runs + 1}`);
    }
    closeSheet();
    render();
  }

  function undo() {
    if (!rec.events.length) return;
    rec.events.pop(); S.save(rec); buzz(); CSA.ui.changed(rec); closeSheet(); render();
  }

  // ---------- Home ----------

  // Browsers that support it offer "Install app"; the Android app shell never shows it.
  let installPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; if (view.screen === "home") render(); });
  window.addEventListener("appinstalled", () => { installPrompt = null; render(); });

  // Matches scored on this phone (quick matches, and tournament matches this phone scored).
  function localMatches() {
    const list = S.list();
    if (!list.length) return "";
    const rows = list.map((r) => {
      const s = E.replay(r.match, r.events), t = r.match.teams, ru = E.settings(r.match);
      const line = s.innings.filter((i) => i.batters.length).map((i) => `${esc(t[i.batting].short)} ${i.runs}/${i.wickets} (${E.oversText(i.legalBalls, ru.ballsPerOver)})`).join(" · ") || "Not started";
      return `<li class="match-row">
        <button class="match-open" data-act="open" data-id="${r.match.id}">
          <span class="match-teams">${esc(t[0].name)} <em>v</em> ${esc(t[1].name)}</span>
          <span class="match-line">${line}</span>
          <span class="pill ${s.result ? "pill-done" : "pill-live"}">${s.result ? esc(s.result.text) : ru.oversPerSide + " overs · in progress"}</span>
        </button>
        <button class="icon-btn" data-act="delete" data-id="${r.match.id}" aria-label="Delete match">✕</button>
      </li>`;
    }).join("");
    return `<div class="stack-s"><h2 class="eyebrow">Matches on this phone</h2><ul class="match-list">${rows}</ul></div>`;
  }

  function installBanner() {
    return installPrompt ? `<button class="install" data-act="install"><img src="icons/icon-192.png" alt=""><span><b>Install ${esc(APP)}</b><small>Opens full screen from your home screen and scores offline.</small></span></button>` : "";
  }

  // Without the online part (league.js) home is just quick matches on this phone.
  function homeView() {
    if (CSA.ui.screens.home) return CSA.ui.screens.home(view);
    return `<header class="bar"><h1 class="brand">${BRAND}</h1></header>
      <section class="wrap stack">
        ${installBanner()}
        <button class="btn btn-primary" data-act="new">Score a match</button>
        ${localMatches() || `<p class="empty">No matches yet. Start one, and every ball is saved on this phone as you score, even without signal.</p>`}
      </section>`;
  }

  // ---------- Setup ----------

  function newSetup() {
    return { teams: [{ name: "", players: "" }, { name: "", players: "" }], overs: 20, custom: false, maxBowler: 4, maxEdited: false, tossWinner: 0, decision: "bat" };
  }

  function setupView() {
    const f = setup;
    const teamBox = (i) => `
      <fieldset class="card stack-s">
        <legend class="eyebrow">Team ${i + 1}</legend>
        <label class="field"><span>Team name</span><input id="team${i}-name" data-bind="team${i}-name" value="${esc(f.teams[i].name)}" placeholder="e.g. Shapla Strikers" autocomplete="off"></label>
        <label class="field"><span>Players, one per line</span><textarea id="team${i}-players" data-bind="team${i}-players" rows="6" placeholder="Captain first is fine">${esc(f.teams[i].players)}</textarea></label>
        <small class="muted">${countPlayers(f.teams[i].players)} players</small>
      </fieldset>`;
    const chips = PRESETS.map(([l, n]) => `<button class="chip ${!f.custom && f.overs === n ? "on" : ""}" data-act="overs" data-n="${n}">${l}</button>`).join("");
    const tn = (i) => esc(f.teams[i].name || `Team ${i + 1}`);
    return `<header class="bar"><button class="icon-btn" data-act="home" aria-label="Back">←</button><h1>New match</h1></header>
      <section class="wrap stack">
        <button class="btn btn-ghost" data-act="sample">Fill sample teams</button>
        ${teamBox(0)}${teamBox(1)}
        <fieldset class="card stack-s">
          <legend class="eyebrow">Overs</legend>
          <div class="chips">${chips}<button class="chip ${f.custom ? "on" : ""}" data-act="overs-custom">Custom</button></div>
          ${f.custom ? `<label class="field"><span>Overs per side</span><input id="overs" data-bind="overs" type="number" inputmode="numeric" min="1" max="100" value="${f.overs}"></label>` : ""}
          <label class="field"><span>Max overs per bowler</span><input id="maxbowler" data-bind="maxbowler" type="number" inputmode="numeric" min="1" value="${f.maxBowler}"></label>
        </fieldset>
        <fieldset class="card stack-s">
          <legend class="eyebrow">Toss</legend>
          <div class="chips"><button class="chip ${f.tossWinner === 0 ? "on" : ""}" data-act="toss" data-i="0">${tn(0)}</button><button class="chip ${f.tossWinner === 1 ? "on" : ""}" data-act="toss" data-i="1">${tn(1)}</button></div>
          <div class="chips"><button class="chip ${f.decision === "bat" ? "on" : ""}" data-act="decision" data-d="bat">Chose to bat</button><button class="chip ${f.decision === "bowl" ? "on" : ""}" data-act="decision" data-d="bowl">Chose to bowl</button></div>
        </fieldset>
        <p class="error" id="setup-error" hidden></p>
        <button class="btn btn-primary btn-big" data-act="start">Start match</button>
      </section>`;
  }

  function countPlayers(text) { return text.split("\n").map((s) => s.trim()).filter(Boolean).length; }

  function startMatch() {
    const f = setup, err = document.getElementById("setup-error");
    const teams = f.teams.map((t, i) => {
      const nm = t.name.trim() || `Team ${i + 1}`;
      return { name: nm, short: shortName(nm), players: t.players.split("\n").map((s) => s.trim()).filter(Boolean) };
    });
    const bad = teams.find((t) => t.players.length < 2);
    if (bad) { err.textContent = `${bad.name} needs at least 2 players.`; err.hidden = false; return; }
    if (!(f.overs >= 1)) { err.textContent = "Overs per side must be 1 or more."; err.hidden = false; return; }
    const battingFirst = f.decision === "bat" ? f.tossWinner : 1 - f.tossWinner;
    const match = {
      id: S.newId(), createdAt: Date.now(), teams, battingFirst,
      toss: { winner: f.tossWinner, decision: f.decision },
      rules: { oversPerSide: f.overs, ballsPerOver: 6, maxOversPerBowler: Math.max(1, f.maxBowler | 0) },
    };
    rec = { match, events: [] };
    S.save(rec);
    view = { screen: "score", tab: 0 };
    render();
  }

  // ---------- Score ----------

  // Live card in the familiar scorecard layout: team and innings, the score with overs,
  // CRR on the right, a partnership strip, then the batters and bowler as small tables.
  function scoreboard(s) {
    const ru = rules(), inn = s.innings[s.current], t = rec.match.teams;
    const ch = E.chase(rec.match, s);
    const crr = inn.legalBalls ? ((inn.runs * ru.ballsPerOver) / inn.legalBalls).toFixed(2) : "0.00";
    const rate = (k, v) => `<div class="lv-rate"><span>${k}</span><b>${v}</b></div>`;
    const chasing = ch && !s.result && ch.ballsLeft > 0;
    // Partnership: runs and legal balls since the last wicket.
    let pr = 0, pb = 0;
    for (const over of inn.overs) for (const b of over) { pr += b.runs; if (b.legal) pb++; if (b.wicket) { pr = 0; pb = 0; } }
    const strip = [
      inn.batters.length ? `<span><em>P'ship</em> ${pr}(${pb})</span>` : "",
      chasing ? `<span><em>Need</em> ${ch.need} off ${ch.ballsLeft}</span>` : s.current === 1 ? `<span><em>${esc(t[s.innings[0].batting].short)}</em> ${s.innings[0].runs}-${s.innings[0].wickets}</span>` : "",
      inn.freeHit && !s.result ? `<span class="pill pill-free">FREE HIT</span>` : "",
    ].filter(Boolean).join("");
    return `<div class="scoreboard"><div class="live">
      <div class="lv-head">
        <div class="lv-score"><div class="lv-team">${esc(t[inn.batting].short)} <small>${s.current === 0 ? "1st" : "2nd"} inn</small></div>
          <div class="lv-runs">${inn.runs}-${inn.wickets} <small>(${E.oversText(inn.legalBalls, ru.ballsPerOver)})</small></div></div>
        <div class="lv-rates">${rate("CRR", crr)}${chasing ? rate("RRR", ch.rrr.toFixed(2)) : ""}</div>
      </div>
      ${strip ? `<div class="lv-strip">${strip}</div>` : ""}
      ${s.next === "done" ? "" : playersBlock(s)}
    </div></div>`;
  }

  function playersBlock(s) {
    const ru = rules(), inn = s.innings[s.current];
    if (!inn.batters.length) return "";
    const bat = (p, strike) => {
      if (p == null) return `<tr><td class="muted">Waiting for batter</td><td></td><td></td><td></td><td></td><td></td></tr>`;
      const b = inn.batters.find((x) => x.player === p);
      return `<tr class="${strike ? "on-strike" : ""}"><td>${esc(name(inn.batting, p))}${strike ? "*" : ""}</td><td><b>${b.runs}</b></td><td>${b.balls}</td><td>${b.fours}</td><td>${b.sixes}</td><td>${sr(b.runs, b.balls)}</td></tr>`;
    };
    const bw = inn.bowler != null ? inn.bowlers.find((x) => x.player === inn.bowler) : null;
    const bowl = bw ? `<tr><td>${esc(name(inn.bowling, bw.player))}</td><td>${E.oversText(bw.balls, ru.ballsPerOver)}</td><td>${bw.maidens}</td><td>${bw.runs}</td><td><b>${bw.wickets}</b></td><td>${econ(bw.runs, bw.balls, ru.ballsPerOver)}</td></tr>`
      : `<tr><td class="muted">Next bowler?</td><td></td><td></td><td></td><td></td><td></td></tr>`;
    const over = inn.overs[inn.overs.length - 1] || [];
    const lastOver = over.length ? over : (inn.overs[inn.overs.length - 2] || []);
    const balls = lastOver.map((b) => `<span class="ball ${b.wicket ? "b-w" : b.extra ? "b-x" : b.runs === 4 ? "b-4" : b.runs === 6 ? "b-6" : b.runs === 0 ? "b-0" : ""}">${b.label === "0" ? "•" : esc(b.label)}</span>`).join("");
    return `<table class="lv-tbl"><thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead>
        <tbody>${bat(inn.striker, true)}${bat(inn.nonStriker, false)}</tbody>
        <thead><tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>ER</th></tr></thead><tbody>${bowl}</tbody></table>
      <div class="over"><span class="over-label">${over.length ? "This over" : "Last over"}</span><div class="balls">${balls || '<span class="muted">No balls yet</span>'}</div>
        ${s.next === "ball" && !rec.readOnly && !rec.paused ? `<button class="swap-btn" data-act="swap" aria-label="Swap strike">⇄ Swap</button>` : ""}</div>`;
  }

  function pickList(title, team, players, act, extra) {
    return `<div class="pick"><h2 class="pick-title">${title}</h2>${extra || ""}
      <div class="pick-grid">${players.map((p) => `<button class="btn btn-pick" data-act="${act}" data-p="${p}">${esc(name(team, p))}${act === "pick-bowler" ? bowlerFig(p) : ""}</button>`).join("")}</div></div>`;
  }

  function bowlerFig(p) {
    const s = st(), inn = s.innings[s.current], b = inn.bowlers.find((x) => x.player === p);
    return b ? `<small>${E.oversText(b.balls, rules().ballsPerOver)}-${b.runs}-${b.wickets}</small>` : "";
  }

  function openersView(s) {
    const inn = s.innings[s.current], t = rec.match.teams;
    const opts = (team, sel) => t[team].players.map((p, i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${esc(p)}</option>`).join("");
    const banner = s.current === 1 ? `<p class="break">Innings break. ${esc(t[inn.batting].name)} need <b>${s.innings[0].runs + 1}</b> to win.</p>` : "";
    return `<div class="pick">${banner}<h2 class="pick-title">Openers and first bowler</h2>
      <label class="field"><span>Striker</span><select id="op-striker">${opts(inn.batting, 0)}</select></label>
      <label class="field"><span>Non-striker</span><select id="op-non">${opts(inn.batting, 1)}</select></label>
      <label class="field"><span>Bowler (${esc(t[inn.bowling].name)})</span><select id="op-bowler">${opts(inn.bowling, t[inn.bowling].players.length - 1)}</select></label>
      <p class="error" id="op-error" hidden></p>
      <button class="btn btn-primary btn-big" data-act="openers">Start innings</button></div>`;
  }

  // Big separate tiles: runs on top (4 and 6 in green), extras under them, then Undo, OUT and More
  // under the thumb. The run tiles grow to fill a tall screen.
  function keypad() {
    const k = (n) => `<button class="key key-run ${n === 4 || n === 6 ? "key-bnd" : ""}" data-act="run" data-n="${n}">${n}</button>`;
    const x = (kind, label) => `<button class="key key-x" data-act="sheet" data-k="${kind}">${label}</button>`;
    return `<div class="keypad kp">
      <div class="kp-runs">${[0, 1, 2, 3, 4, 6].map(k).join("")}</div>
      <div class="kp-x">${x("wd", "Wide")}${x("nb", "No ball")}${x("b", "Bye")}${x("lb", "Leg bye")}</div>
      <div class="kp-bar">
        <button class="key key-tool" data-act="undo" ${rec.events.length ? "" : "disabled"}><span aria-hidden="true">↶</span> Undo</button>
        <button class="key key-out" data-act="sheet" data-k="out">Out</button>
        <button class="key key-tool" data-act="sheet" data-k="more">More</button>
      </div>
    </div>`;
  }

  function scoreView() {
    const s = st(), inn = s.innings[s.current], t = rec.match.teams;
    let action = "";
    if (s.next === "openers") action = openersView(s);
    else if (s.next === "batter") {
      const slot = inn.striker == null ? "striker's" : "non-striker's";
      action = pickList("New batter", inn.batting, E.availableBatters(rec.match, s), "pick-batter", `<p class="muted">Comes in at the ${slot} end. Use Swap strike after if they crossed.</p>`);
    } else if (s.next === "bowler") {
      const ok = E.availableBowlers(rec.match, s);
      action = pickList(`Over ${Math.floor(inn.legalBalls / rules().ballsPerOver) + 1}: who bowls?`, inn.bowling, ok.length ? ok : t[inn.bowling].players.map((_, i) => i), "pick-bowler");
    } else if (s.next === "ball") action = keypad();
    else action = `<div class="result"><p class="result-text">${esc(s.result.text)}</p>
      <button class="btn btn-primary btn-big" data-act="card">Full scorecard</button><button class="btn btn-ghost" data-act="match-back">All matches</button></div>`;

    // The keypad carries Undo and More itself; picking a player still needs them.
    let tools = s.next === "done" || s.next === "ball" ? "" : `<div class="tools">
        <button class="btn btn-tool" data-act="undo" ${rec.events.length ? "" : "disabled"}>Undo</button>
        <button class="btn btn-tool" data-act="sheet" data-k="more">More</button></div>`;
    // After handing a quick match over, this phone stops scoring until the user takes it back.
    if (rec.paused && s.next !== "done") {
      tools = "";
      action = `<div class="watch watch-col"><p><b>Scoring moved to another phone.</b><br><span class="muted">This copy stops at the ball you handed over.</span></p>
        <button class="btn" data-act="resume-here">Score on this phone again</button></div>`;
    }
    // Someone watching a tournament match (not its scorer) gets the score, then tabs with the
    // ball-by-ball commentary, scorecard, overs, MVP and info, instead of the pad.
    if (rec.readOnly) {
      tools = "";
      action = (rec.handedOver && s.next !== "done"
        ? `<div class="watch watch-col"><p><b>You handed scoring to someone else.</b><br><span class="muted">This phone follows the live score.</span></p>
            <div class="row-2"><button class="btn" data-act="refresh-match">Refresh</button><button class="btn" data-act="resume-cloud">Score here again</button></div></div>`
        : s.result ? `<p class="result-text">${esc(s.result.text)}</p>` : "") + fanTabs(s);
    }
    // The whole pad fits one screen: score on top, keypad and tools at the bottom under the thumb.
    return `<div class="score-screen ${rec.readOnly ? "fan" : ""}"><header class="bar"><button class="icon-btn" data-act="match-back" aria-label="Back">←</button>
        <h1 class="score-title">${esc(t[0].name)} <em>v</em> ${esc(t[1].name)}</h1>${CSA.ui.matchBadge(rec)}${rec.readOnly ? "" : `<button class="btn btn-small btn-card" data-act="card">Scorecard</button>`}</header>
      ${scoreboard(s)}
      <section class="wrap stack-s score-body">${action}${tools}</section></div>`;
  }

  // ---------- Hand over and backup links (quick matches) ----------
  // The whole match (teams, rules and every ball) travels in the link itself, squeezed with
  // deflate, so it needs no account and no server: …/#/score/<data>.

  const b64 = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unb64 = (str) => Uint8Array.from(atob(str.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  async function squeeze(bytes, way) {
    const stream = new Blob([bytes]).stream().pipeThrough(way === "in" ? new CompressionStream("deflate-raw") : new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function matchLink(r) {
    const json = new TextEncoder().encode(JSON.stringify({ v: 1, match: r.match, events: r.events }));
    const data = typeof CompressionStream === "function" ? "z" + b64(await squeeze(json, "in")) : "u" + b64(json);
    return `${location.origin}${location.pathname}#/score/${data}`;
  }
  async function readMatchLink() {
    const hit = /^#\/score\/([uz])([A-Za-z0-9_-]+)$/.exec(location.hash);
    if (!hit) return;
    history.replaceState(null, "", location.pathname + location.search);
    try {
      let bytes = unb64(hit[2]);
      if (hit[1] === "z") bytes = await squeeze(bytes, "out");
      const got = JSON.parse(new TextDecoder().decode(bytes));
      E.replay(got.match, got.events); // throws on a broken link
      const mine = S.get(got.match.id);
      if (mine && mine.events.length > got.events.length && !confirm("This phone already has more balls of this match than the link. Replace them with the link's version?")) return;
      rec = { match: got.match, events: got.events };
      S.save(rec);
      closeSheet(); view = { screen: "score", tab: 0 }; render();
      toast(`You're scoring ${got.match.teams[0].short} v ${got.match.teams[1].short} now, from ball ${got.events.filter((e) => e.t === "ball").length + 1}.`);
    } catch (e) { toast("That scoring link is broken. Ask for a new one."); }
  }
  window.addEventListener("hashchange", readMatchLink);
  setTimeout(readMatchLink, 0);

  async function shareMatchLink(r, handover) {
    const url = await matchLink(r), t = r.match.teams;
    const text = handover ? `Take over scoring ${t[0].name} v ${t[1].name}. Open this link and carry on:` : `Backup of ${t[0].name} v ${t[1].name}. Open it to carry on scoring if my phone dies:`;
    try {
      if (navigator.share) await navigator.share({ title: handover ? "Take over scoring" : "Match backup", text, url });
      else { await navigator.clipboard.writeText(`${text} ${url}`); toast("Link copied. Paste it in WhatsApp."); }
      return true;
    } catch (e) {
      if (e && e.name === "AbortError") return false;
      window.prompt("Copy this link", url);
      return true;
    }
  }

  // ---------- Bottom sheets ----------

  function openSheet(kind) {
    sheet = { kind, delivery: "legal", wk: "bowled", runs: 0, who: null, fielder: "" };
    renderSheet();
  }
  function closeSheet() { sheet = null; $sheet.hidden = true; $sheet.innerHTML = ""; }

  function renderSheet() {
    if (!sheet) return closeSheet();
    const s = st(), inn = s.innings[s.current], t = rec.match.teams;
    const runBtns = (list, act) => list.map((n) => `<button class="key key-run" data-act="${act}" data-n="${n}">${n}</button>`).join("");
    let body = "";
    if (sheet.kind === "wd") body = `<h2>Wide</h2><p class="muted">Extra runs they ran (or a boundary) on top of the wide.</p><div class="keypad keypad-5">${runBtns([0, 1, 2, 3, 4], "extra-run")}</div>`;
    if (sheet.kind === "nb") body = `<h2>No ball</h2><p class="muted">Runs off the bat. The next ball is a free hit.</p><div class="keypad keypad-6">${runBtns([0, 1, 2, 3, 4, 6], "extra-run")}</div>`;
    if (sheet.kind === "b" || sheet.kind === "lb") body = `<h2>${sheet.kind === "b" ? "Byes" : "Leg byes"}</h2><div class="keypad keypad-4">${runBtns([1, 2, 3, 4], "extra-run")}</div>`;
    if (sheet.kind === "more") body = `<h2>More</h2><div class="stack-s">
        ${inn.striker != null ? `<button class="btn btn-ghost" data-act="retire" data-p="${inn.striker}">Retire ${esc(name(inn.batting, inn.striker))} (hurt)</button>` : ""}
        ${inn.nonStriker != null ? `<button class="btn btn-ghost" data-act="retire" data-p="${inn.nonStriker}">Retire ${esc(name(inn.batting, inn.nonStriker))} (hurt)</button>` : ""}
        <button class="btn" data-act="handover">Hand over scoring to someone else</button>
        ${rec.match.cloud ? "" : `<button class="btn btn-ghost" data-act="backup-link">Send a backup link</button>`}
        <button class="btn btn-danger" data-act="end-innings">End this innings now</button></div>`;
    if (sheet.kind === "out") body = outForm(inn, t);
    if (sheet.kind === "fix") body = fixForm();
    $sheet.innerHTML = `<div class="sheet-scrim" data-act="close-sheet"></div><div class="sheet-panel" role="dialog" aria-modal="true">
      <button class="icon-btn sheet-x" data-act="close-sheet" aria-label="Close">✕</button>${body}</div>`;
    $sheet.hidden = false;
  }

  // Which dismissals fit which delivery (e.g. only a run-out on a no-ball).
  const KINDS_FOR = { legal: ["bowled", "caught", "lbw", "runout", "stumped", "hitwicket"], wd: ["stumped", "runout", "hitwicket"], nb: ["runout"] };

  function outForm(inn, t) {
    const f = sheet;
    if (!KINDS_FOR[f.delivery].includes(f.wk)) f.wk = KINDS_FOR[f.delivery][0];
    const chip = (act, val, cur, label) => `<button class="chip ${val === cur ? "on" : ""}" data-act="${act}" data-v="${val}">${label}</button>`;
    const needsFielder = ["caught", "stumped", "runout"].includes(f.wk);
    const who = f.who == null ? inn.striker : f.who;
    return `<h2>Wicket</h2>
      <div class="stack-s">
        <div class="chips">${chip("o-del", "legal", f.delivery, "Fair ball")}${chip("o-del", "wd", f.delivery, "On a wide")}${chip("o-del", "nb", f.delivery, "On a no ball")}</div>
        <div class="chips">${KINDS_FOR[f.delivery].map((k) => chip("o-kind", k, f.wk, E.WICKET_KINDS[k])).join("")}</div>
        ${f.wk === "runout" ? `<span class="eyebrow">Who is out?</span><div class="chips">${chip("o-who", String(inn.striker), String(who), esc(name(inn.batting, inn.striker)))}${chip("o-who", String(inn.nonStriker), String(who), esc(name(inn.batting, inn.nonStriker)))}</div>
          <span class="eyebrow">Runs completed before the run-out</span><div class="chips">${[0, 1, 2, 3].map((n) => chip("o-runs", String(n), String(f.runs), String(n))).join("")}</div>` : ""}
        ${needsFielder ? `<label class="field"><span>${f.wk === "stumped" ? "Keeper" : "Fielder"}</span><select id="o-fielder"><option value="">Not sure</option>${t[inn.bowling].players.map((p, i) => `<option value="${i}" ${String(i) === f.fielder ? "selected" : ""}>${esc(p)}</option>`).join("")}</select></label>` : ""}
        <button class="btn btn-out btn-big" data-act="confirm-out">Confirm ${esc(E.WICKET_KINDS[f.wk].toLowerCase())}</button>
      </div>`;
  }

  // Fixing a ball scored earlier: change what kind of ball it was and the runs, or remove it.
  // The wicket on a ball stays as it was; to take a wicket away, remove the ball.
  const FIX_RUNS = { legal: [0, 1, 2, 3, 4, 5, 6], wd: [0, 1, 2, 3, 4], nb: [0, 1, 2, 3, 4, 6], b: [1, 2, 3, 4], lb: [1, 2, 3, 4] };
  const FIX_LABEL = { legal: "Fair ball", wd: "Wide", nb: "No ball", b: "Byes", lb: "Leg byes" };

  function openFix(i) {
    const e = rec.events[i];
    if (!e || e.t !== "ball") return;
    sheet = { kind: "fix", index: i, delivery: e.extra || "legal", runs: e.runs || 0, error: "" };
    renderSheet();
  }

  function fixForm() {
    const f = sheet, e = rec.events[f.index], w = e.wicket && e.wicket.kind !== "retired" ? e.wicket : null;
    // A ball with a wicket can only become a delivery that wicket can happen on.
    const kinds = Object.keys(FIX_LABEL).filter((k) => !w || (KINDS_FOR[k] || []).includes(w.kind));
    if (!FIX_RUNS[f.delivery].includes(f.runs)) f.runs = FIX_RUNS[f.delivery][0];
    const chip = (act, val, cur, label) => `<button class="chip ${val === cur ? "on" : ""}" data-act="${act}" data-v="${val}">${label}</button>`;
    const s = st(), inn = s.innings.find((x) => x.overs.some((o) => o.some((b) => b.index === f.index)));
    const ball = inn && [].concat(...inn.overs).find((b) => b.index === f.index);
    return `<h2>Fix this ball</h2>
      <p class="muted">Now: <b>${esc(ball ? ball.label : "?")}</b>${w ? ` · ${esc(E.WICKET_KINDS[w.kind])} stays. Remove the ball to take the wicket away.` : ""}</p>
      <div class="stack-s">
        <div class="chips">${kinds.map((k) => chip("fix-del", k, f.delivery, FIX_LABEL[k])).join("")}</div>
        <span class="eyebrow">${f.delivery === "wd" ? "Extra runs on top of the wide" : f.delivery === "nb" ? "Runs off the bat" : "Runs"}</span>
        <div class="chips">${FIX_RUNS[f.delivery].map((n) => chip("fix-runs", String(n), String(f.runs), String(n))).join("")}</div>
        ${f.error ? `<p class="error">${esc(f.error)}</p>` : ""}
        <button class="btn btn-primary btn-big" data-act="fix-save">Save change</button>
        <button class="btn btn-danger" data-act="fix-delete">Remove this ball</button>
      </div>`;
  }

  // Applies a change to the event list, keeping it only if the match still replays cleanly.
  function applyFix(change) {
    const before = rec.events.slice();
    change(rec.events);
    try { E.replay(rec.match, rec.events); } catch (err) {
      rec.events = before; sheet.error = "That change doesn't fit the balls after it. Try removing the ball instead."; return renderSheet();
    }
    S.save(rec); buzz(); CSA.ui.changed(rec); closeSheet(); render();
    toast("Ball fixed. Totals updated.");
  }

  // ---------- Scorecard ----------

  // The match page: tabs so nobody scrolls one long page to find the overs or the MVP.
  const SECTIONS = [["card", "Scorecard"], ["live", "Commentary"], ["overs", "Overs"], ["mvp", "MVP"], ["info", "Info"]];
  const FAN_SECTIONS = [["live", "Live"], ["card", "Scorecard"], ["overs", "Overs"], ["mvp", "MVP"], ["info", "Info"]];

  // A fan's match page under the live score: the same tabs, with ball-by-ball commentary first.
  function fanTabs(s) {
    const t = rec.match.teams, sec = view.fsec || "live";
    const played = s.innings.filter((i) => i.batters.length);
    const nav = `<nav class="sec-tabs fan-tabs" role="tablist">${FAN_SECTIONS.map(([k, label]) => `<button class="sec-tab ${k === sec ? "on" : ""}" role="tab" aria-selected="${k === sec}" data-act="fsec" data-s="${k}">${label}</button>`).join("")}</nav>`;
    let body;
    if (sec === "live") body = commentaryTab(s);
    else if (sec === "mvp") body = mvpTab(s);
    else if (sec === "info") body = infoTab(s);
    else if (!played.length) body = `<p class="empty">No balls bowled yet.</p>`;
    else {
      const tab = Math.min(view.itab == null ? played.length - 1 : view.itab, played.length - 1), inn = played[tab];
      const tabs = played.length > 1 ? `<div class="tabs">${played.map((i, n) => `<button class="tab ${n === tab ? "on" : ""}" data-act="tab" data-n="${n}">${esc(t[i.batting].short)} ${i.runs}/${i.wickets}</button>`).join("")}</div>` : "";
      body = tabs + (sec === "overs" ? oversTab(inn) : scorecardTab(inn));
    }
    return nav + `<div class="stack fan-body">${body}</div>`;
  }

  // Ball-by-ball, newest first, like Cricbuzz: over.ball and the ball, "Bowler to Batter, FOUR",
  // wickets with the dismissal, a summary at the end of every over, fifties and five-fors.
  function commentaryTab(s) {
    const all = [].concat(...CSA.commentary.build(rec.match, s).map((x) => x.items));
    if (!all.length) return `<p class="empty">Commentary starts with the first ball.</p>`;
    const limit = view.more || 120, cls = { w: "b-w", 4: "b-4", 6: "b-6", x: "b-x", 0: "b-0", r: "" };
    const rows = all.slice(0, limit).map((it) => {
      if (it.k === "over") return `<li class="cm-over"><div class="cm-oh"><span>End of over ${it.n}</span><span><b>${it.runs} run${it.runs === 1 ? "" : "s"}</b>${it.wkts ? ` · ${it.wkts} wkt` : ""} · ${esc(it.score)}</span></div>
          ${it.batters.length ? `<div class="cm-ob">${esc(it.batters.join(" · "))}</div>` : ""}<div class="cm-ob muted">${esc(it.bowler)}</div></li>`;
      if (it.k === "milestone") return `<li class="cm-ms">★ ${esc(it.text)}</li>`;
      if (it.k === "end") return `<li class="cm-end">${esc(it.text)}</li>`;
      const [head, ...rest] = it.text.split(", ");
      const hl = it.kind === "w" ? "cm-w" : it.kind === "4" || it.kind === "6" ? "cm-4" : "";
      return `<li class="cm-ball ${it.kind === "w" ? "cm-wk" : ""}"><span class="cm-n">${it.n}<span class="ball ${cls[it.kind]}">${it.tag === "0" ? "•" : esc(it.tag)}</span></span>
        <span class="cm-t"><b>${esc(it.who)},</b> <span class="${hl}">${esc(head)}</span>${rest.length ? ", " + esc(rest.join(", ")) : ""}${it.out ? `<span class="cm-out">${esc(it.out)}</span>` : ""}</span></li>`;
    }).join("");
    return `<ol class="cm">${rows}</ol>${all.length > limit ? `<button class="btn btn-ghost" data-act="cm-more">Show earlier balls</button>` : ""}`;
  }

  function cardView() {
    const s = st(), t = rec.match.teams;
    const played = s.innings.filter((i) => i.batters.length);
    const tab = Math.min(view.tab, Math.max(0, played.length - 1));
    const inn = played[tab], sec = view.sec || "card";
    const head = `<header class="bar"><button class="icon-btn" data-act="back-score" aria-label="Back">←</button><h1>${esc(t[0].short)} <em>v</em> ${esc(t[1].short)}</h1></header>
      <nav class="sec-tabs" role="tablist">${SECTIONS.map(([k, label]) => `<button class="sec-tab ${k === sec ? "on" : ""}" role="tab" aria-selected="${k === sec}" data-act="sec" data-s="${k}">${label}</button>`).join("")}</nav>`;
    const result = s.result ? `<p class="result-text">${esc(s.result.text)}</p>` : "";
    if (sec === "info") return head + `<section class="wrap stack">${result}${infoTab(s)}</section>`;
    if (sec === "live") return head + `<section class="wrap stack">${result}${commentaryTab(s)}</section>`;
    if (sec === "mvp") return head + `<section class="wrap stack">${result}${mvpTab(s)}</section>`;
    if (!inn) return head + `<p class="empty wrap">No balls bowled yet.</p>`;
    const tabs = played.length > 1 ? `<div class="tabs">${played.map((i, n) => `<button class="tab ${n === tab ? "on" : ""}" data-act="tab" data-n="${n}">${esc(t[i.batting].short)} ${i.runs}/${i.wickets}</button>`).join("")}</div>` : "";
    return head + `<section class="wrap stack">${result}${tabs}${sec === "overs" ? oversTab(inn) : scorecardTab(inn)}${sec === "card" ? CSA.ui.cardExtra(rec) : ""}</section>`;
  }

  function scorecardTab(inn) {
    const ru = rules(), t = rec.match.teams;
    const bat = inn.batters.map((b) => `<tr><td><span class="pname">${esc(name(inn.batting, b.player))}</span><small>${esc(E.dismissalText(rec.match, inn, b.out))}</small></td>
      <td><b>${b.runs}</b></td><td>${b.balls}</td><td>${b.fours}</td><td>${b.sixes}</td><td>${sr(b.runs, b.balls)}</td></tr>`).join("");
    const bowl = inn.bowlers.map((b) => `<tr><td><span class="pname">${esc(name(inn.bowling, b.player))}</span></td><td>${E.oversText(b.balls, ru.ballsPerOver)}</td><td>${b.maidens}</td><td>${b.runs}</td><td><b>${b.wickets}</b></td><td>${econ(b.runs, b.balls, ru.ballsPerOver)}</td></tr>`).join("");
    const x = inn.extras, ext = x.wd + x.nb + x.b + x.lb;
    const yet = t[inn.batting].players.map((_, i) => i).filter((i) => !inn.batters.some((b) => b.player === i)).map((i) => esc(name(inn.batting, i)));
    const fow = inn.fow.map((f) => `<li><span>${f.wicket}. ${esc(name(inn.batting, f.player))}</span><span><b>${f.runs}</b> <small>(${f.over} ov)</small></span></li>`).join("");
    return `<div class="table-wrap"><table class="tbl"><thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead><tbody>${bat}</tbody></table></div>
        <p class="line"><span>Extras</span><span><b>${ext}</b> (wd ${x.wd}, nb ${x.nb}, b ${x.b}, lb ${x.lb})</span></p>
        <p class="line line-total"><span>Total</span><span><b>${inn.runs}/${inn.wickets}</b> (${E.oversText(inn.legalBalls, ru.ballsPerOver)} ov) · RR ${econ(inn.runs, inn.legalBalls, ru.ballsPerOver)}</span></p>
        ${yet.length ? `<p class="muted"><b>Yet to bat:</b> ${yet.join(", ")}</p>` : ""}
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th></tr></thead><tbody>${bowl}</tbody></table></div>
        ${fow ? `<h2 class="eyebrow">Fall of wickets</h2><ol class="fow-list">${fow}</ol>` : ""}`;
  }

  // Newest over first, each as a card: who bowled, every ball, the over's runs and the score after it.
  function oversTab(inn) {
    const fixable = !rec.readOnly;
    const ballEl = (b) => {
      const cls = `ball ${b.wicket ? "b-w" : b.extra ? "b-x" : b.runs === 4 ? "b-4" : b.runs === 6 ? "b-6" : b.runs === 0 ? "b-0" : ""}`, label = b.label === "0" ? "•" : esc(b.label);
      return fixable ? `<button class="${cls} ball-fix" data-act="fix-ball" data-i="${b.index}" aria-label="Fix this ball: ${esc(b.label)}">${label}</button>` : `<span class="${cls}">${label}</span>`;
    };
    let runs = 0, wkts = 0;
    const cards = inn.overs.filter((o) => o.length).map((o, n) => {
      const r = o.reduce((a, b) => a + b.runs, 0);
      runs += r; wkts += o.filter((b) => b.wicket).length;
      const bw = o[0].bowler != null ? esc(name(inn.bowling, o[0].bowler)) : "";
      return `<li class="over-card"><div class="oc-n"><b>Ov ${n + 1}</b><small>${runs}-${wkts}</small></div>
        <div class="oc-body">${bw ? `<span class="oc-who">${bw}</span>` : ""}<span class="balls">${o.map(ballEl).join("")}</span></div>
        <div class="oc-runs"><b>${r}</b><small>run${r === 1 ? "" : "s"}</small></div></li>`;
    }).reverse().join("");
    return `${fixable ? `<p class="muted small">Scored a ball wrong? Tap it to fix it. Every total updates by itself.</p>` : ""}<ol class="overs-cards">${cards}</ol>`;
  }

  function mvpTab(s) {
    const list = CSA.stats.mvp(rec.match, s).slice(0, 5), t = rec.match.teams;
    if (!list.length) return `<p class="empty">The MVP list fills in as the match goes on.</p>`;
    return `<ol class="mvp-list">${list.map((x, i) => `<li class="mvp-row ${i === 0 ? "mvp-top" : ""}"><span class="mvp-rank">${i + 1}</span>
        <span class="avatar" aria-hidden="true">${esc(initials(x.name))}</span>
        <span class="mvp-text"><b>${esc(x.name)}</b><small>${esc(t[x.team].name)}${x.line ? " · " + esc(x.line) : ""}</small></span>
        <span class="mvp-pts"><b>${x.pts}</b><small>pts</small></span></li>`).join("")}</ol>
      <p class="muted small">How points work: ${esc(CSA.stats.MVP_RULES)}</p>`;
  }

  function infoTab(s) {
    const m = rec.match, ru = rules(), t = m.teams, info = m.info || {};
    const when = info.startsAt || m.createdAt;
    const row = (k, v) => v ? `<div class="info-row"><span>${k}</span><span>${v}</span></div>` : "";
    const squad = (i) => `<div class="squad-col"><b>${esc(t[i].name)}</b><ol>${t[i].players.map((p) => `<li>${esc(p)}</li>`).join("")}</ol></div>`;
    return `<div class="card info-card">
        ${row("Tournament", info.tournament ? esc(info.tournament) : "")}
        ${row("Match", `${esc(t[0].name)} v ${esc(t[1].name)}`)}
        ${row("Toss", `${esc(t[m.toss.winner].name)}, chose to ${m.toss.decision}`)}
        ${row("Overs", `${ru.oversPerSide} a side, up to ${ru.maxOversPerBowler} per bowler`)}
        ${row("Venue", info.venue ? esc(info.venue) : "")}
        ${row("Date", when ? new Date(when).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "")}
      </div>
      <h2 class="eyebrow">Squads</h2><div class="squads">${squad(0)}${squad(1)}</div>`;
  }

  const initials = (n) => String(n).trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase();

  // ---------- Render and input ----------

  function render() {
    const tabs = CSA.ui.tabbar(view);
    document.body.classList.toggle("has-tabs", !!tabs);
    if (view.screen === "home") $app.innerHTML = homeView() + tabs;
    else if (view.screen === "setup") $app.innerHTML = setupView();
    else if (view.screen === "score") $app.innerHTML = scoreView();
    else if (view.screen === "card") $app.innerHTML = cardView();
    else if (CSA.ui.screens[view.screen]) $app.innerHTML = CSA.ui.screens[view.screen](view) + tabs;
    if (sheet) renderSheet();
  }

  const actions = {
    async install() { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice.catch(() => {}); installPrompt = null; render(); },
    // Back from a page goes to the tab it was opened from.
    home() { rec = null; closeSheet(); view = { screen: CSA.ui.lastTab || "home", tab: 0 }; render(); },
    "match-back"() { actions.home(); },
    new() { setup = newSetup(); view = { screen: "setup" }; render(); },
    open(d) { rec = S.get(d.id); if (!rec) return; view = { screen: "score", tab: 0 }; render(); },
    delete(d) {
      const r = S.get(d.id); if (!r) return;
      if (confirm(`Delete ${r.match.teams[0].name} v ${r.match.teams[1].name}? This can't be undone.`)) { S.remove(d.id); render(); }
    },
    sample() { setup.teams = SAMPLE.map((x) => ({ ...x })); render(); },
    overs(d) { setup.custom = false; setup.overs = +d.n; if (!setup.maxEdited) setup.maxBowler = Math.ceil(setup.overs / 5); render(); },
    "overs-custom"() { setup.custom = true; render(); },
    toss(d) { setup.tossWinner = +d.i; render(); },
    decision(d) { setup.decision = d.d; render(); },
    start: startMatch,
    card() { closeSheet(); view = { screen: "card", tab: st().current, sec: "card" }; render(); },
    sec(d) { view.sec = d.s; render(); window.scrollTo(0, 0); },
    fsec(d) { view.fsec = d.s; view.more = 0; render(); },
    "cm-more"() { view.more = (view.more || 120) + 240; render(); },
    "back-score"() { view = { screen: "score", tab: 0 }; render(); },
    tab(d) { view.tab = view.itab = +d.n; render(); },
    run(d) { push({ t: "ball", runs: +d.n }); },
    undo,
    swap() { push({ t: "swap" }); },
    sheet(d) { openSheet(d.k); },
    "close-sheet": closeSheet,
    "extra-run"(d) { push({ t: "ball", runs: +d.n, extra: sheet.kind }); },
    "pick-batter"(d) { push({ t: "batter", player: +d.p }); },
    "pick-bowler"(d) { push({ t: "bowler", bowler: +d.p }); },
    retire(d) { push({ t: "retire", player: +d.p }); },
    "end-innings"() { if (confirm("End this innings now? You can undo it.")) push({ t: "end", reason: "Innings ended by scorer" }); },
    openers() {
      const g = (id) => +document.getElementById(id).value;
      const a = g("op-striker"), b = g("op-non"), w = g("op-bowler");
      if (a === b) { const e = document.getElementById("op-error"); e.textContent = "Pick two different openers."; e.hidden = false; return; }
      push({ t: "openers", striker: a, nonStriker: b, bowler: w });
    },
    async handover() {
      closeSheet();
      if (rec.match.cloud) return CSA.ui.cloudHandover(rec);
      if (!(await shareMatchLink(rec, true))) return;
      if (!confirm("Sent? Scoring stops on this phone so the two copies don't split. You can take it back later.")) return;
      rec.paused = true; S.save(rec); render();
    },
    async "backup-link"() {
      document.getElementById("toast").hidden = true;
      closeSheet();
      if (rec && !rec.match.cloud) await shareMatchLink(rec, false);
    },
    "resume-here"() {
      if (!confirm("Score on this phone again? Only do this if the other phone has stopped, or the two copies will differ.")) return;
      rec.paused = false; S.save(rec); render();
    },
    "fix-ball"(d) { openFix(+d.i); },
    "fix-del"(d) { sheet.delivery = d.v; sheet.error = ""; renderSheet(); },
    "fix-runs"(d) { sheet.runs = +d.v; renderSheet(); },
    "fix-save"() {
      const f = sheet;
      applyFix((ev) => {
        const e = Object.assign({}, ev[f.index], { runs: f.runs });
        if (f.delivery === "legal") delete e.extra; else e.extra = f.delivery;
        ev[f.index] = e;
      });
    },
    "fix-delete"() {
      if (!confirm("Remove this ball? Everything after it is worked out again.")) return;
      const i = sheet.index;
      // Kept as a blank entry rather than cut out, so every later ball keeps its place
      // (and the change log shows exactly one removal).
      applyFix((ev) => { ev[i] = { t: "void", was: ev[i] }; });
    },
    "o-del"(d) { sheet.delivery = d.v; renderSheet(); },
    "o-kind"(d) { sheet.wk = d.v; renderSheet(); },
    "o-who"(d) { sheet.who = +d.v; renderSheet(); },
    "o-runs"(d) { sheet.runs = +d.v; renderSheet(); },
    "confirm-out"() {
      const s = st(), inn = s.innings[s.current], f = sheet;
      const sel = document.getElementById("o-fielder");
      const fielder = sel && sel.value !== "" ? +sel.value : null;
      const runout = f.wk === "runout";
      const player = runout ? (f.who == null ? inn.striker : f.who) : inn.striker;
      const extra = f.delivery === "legal" ? undefined : f.delivery;
      push({ t: "ball", runs: runout ? f.runs : 0, extra, wicket: { kind: f.wk, player, fielder } });
    },
  };

  document.addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-act]");
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.act];
    if (fn) { ev.preventDefault(); fn(el.dataset, el); }
  });

  // Keep the new-match form in sync without re-rendering on every key press.
  document.addEventListener("input", (ev) => {
    const b = ev.target.dataset.bind;
    if (!b || !setup) return;
    const m = b.match(/^team(\d)-(name|players)$/);
    if (m) {
      setup.teams[+m[1]][m[2]] = ev.target.value;
      if (m[2] === "players") ev.target.parentElement.nextElementSibling.textContent = `${countPlayers(ev.target.value)} players`;
    }
    if (b === "overs") {
      setup.overs = parseInt(ev.target.value, 10) || 0;
      if (!setup.maxEdited) { setup.maxBowler = Math.max(1, Math.ceil(setup.overs / 5)); document.getElementById("maxbowler").value = setup.maxBowler; }
    }
    if (b === "maxbowler") { setup.maxBowler = parseInt(ev.target.value, 10) || 1; setup.maxEdited = true; }
  });
  // Team names show up in the toss chips, so refresh when a name field is left.
  document.addEventListener("change", (ev) => { if (/^team\d-name$/.test(ev.target.dataset.bind || "")) render(); });

  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && sheet) closeSheet(); });

  // Shared with league.js, which adds accounts, tournaments and syncing on top of these screens.
  CSA.ui = {
    esc, toast, shortName, PRESETS, actions, render, APP, BRAND, localMatches, installBanner,
    screens: {},
    tabbar: () => "",
    cloudHandover: () => toast("Sign in to hand over a tournament match."),
    lastTab: "home",
    matchBadge: () => "",
    cardExtra: () => "",
    changed: () => {},
    go(screen, extra) { closeSheet(); view = Object.assign({ screen, tab: 0 }, extra || {}); render(); },
    view: () => view,
    current: () => rec,
    openMatch(r, screen) { rec = r; closeSheet(); view = { screen: screen || "score", tab: 0 }; render(); },
  };

  render();
})();
