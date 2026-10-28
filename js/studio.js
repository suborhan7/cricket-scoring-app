// The studio: turns match and tournament data into cards (js/cards.js), with a caption,
// in post or story size, ready to share. Reached from a match's scorecard, the milestone
// toast while scoring, and the Cards tab of a tournament.
(function () {
  const ui = CSA.ui, esc = ui.esc, E = CSA.engine, C = CSA.cards, St = CSA.stats;
  const lg = CSA.league || null;
  const sb = lg && lg.sb, L = lg ? lg.L : {};
  const url = (bucket, path) => (lg && path ? lg.publicUrl(bucket, path) : "");

  const V = { card: null, list: null }; // the card being previewed, and the open list of cards

  // ---------- Building card data ----------

  const initialsOf = (name) => String(name || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 3).toUpperCase();

  function tournamentInfo(t) {
    if (!t) return { info: { name: "Friendly match", short: "", initials: "CS", c1: "#0F7A45", c2: "#0E1A14" }, logo: "", sponsor: { show: true } };
    return {
      info: { name: t.name, short: t.short_name || "", initials: t.short_name || initialsOf(t.name), c1: t.primary_color, c2: t.secondary_color },
      logo: url("logos", t.logo_path),
      sponsor: { show: t.show_sponsor !== false, name: t.sponsor_name || "" , logo: url("logos", t.sponsor_logo_path) },
    };
  }

  const STAGE = { group: "Group stage", quarter: "Quarter-final", semi: "Semi-final", final: "Final", series: "Series", other: "" };
  function matchLabel(m) {
    if (!m) return "";
    return [m.match_no ? `Match ${m.match_no}` : "", m.stage && m.stage !== "group" ? STAGE[m.stage] : ""].filter(Boolean).join(" · ");
  }

  // Everything about a match the cards need: the tournament, both teams and their logos.
  function matchContext(rec) {
    const cloud = rec.match.cloud, T = L.tour && cloud && L.tour.id === cloud.tournamentId ? L.tour : null;
    const m = T && T.matches.find((x) => x.id === cloud.matchId);
    const teams = rec.match.teams.map((tm, i) => {
      const full = T && cloud ? lg.teamById(cloud.teamIds[i]) : null;
      return { name: tm.name, short: tm.short, c1: full && full.primary_color, c2: full && full.secondary_color, logo: full ? url("logos", full.logo_path) : "" };
    });
    const ti = tournamentInfo(T && T.t);
    return { T, m, teams, ti };
  }

  function base(ctx, extra) {
    return Object.assign({ tournament: ctx.ti.info, sponsor: ctx.ti.sponsor, urls: { tournament: ctx.ti.logo, sponsor: ctx.ti.sponsor.logo } }, extra);
  }

  async function playerPhoto(rec, team, p) {
    const ids = rec.match.cloud && rec.match.cloud.playerIds;
    const id = ids && ids[team] && ids[team][p];
    if (!id || !sb) return "";
    const { data } = await sb.from("players").select("photo_path").eq("id", id).maybeSingle();
    return data && data.photo_path ? url("photos", data.photo_path) : "";
  }

  // A milestone card, with the figures exactly as they stood on the ball it came up.
  async function milestoneCard(rec, ms) {
    const ctx = matchContext(rec), match = rec.match, ru = E.settings(match);
    const s = E.replay(match, rec.events.slice(0, ms.index + 1));
    const batting = ms.kind === "fifty" || ms.kind === "hundred";
    const inn = s.innings.find((i) => (batting ? i.batting : i.bowling) === ms.team);
    const name = match.teams[ms.team].players[ms.player];
    let m;
    if (batting) {
      const b = inn.batters.find((x) => x.player === ms.player);
      m = { kind: ms.kind, batting: true, runs: b.runs, balls: b.balls, fours: b.fours, sixes: b.sixes, notOut: !b.out, sr: b.balls ? ((b.runs * 100) / b.balls).toFixed(1) : "0" };
    } else {
      const b = inn.bowlers.find((x) => x.player === ms.player);
      m = { kind: ms.kind, batting: false, wickets: b.wickets, runs: b.runs, overs: E.oversText(b.balls, ru.ballsPerOver), maidens: b.maidens, econ: b.balls ? ((b.runs * ru.ballsPerOver) / b.balls).toFixed(2) : "0.00" };
    }
    const other = 1 - ms.team;
    const d = base(ctx, {
      milestone: m,
      player: { name, initials: initialsOf(name), team: match.teams[ms.team].name, teamShort: match.teams[ms.team].short },
      opponent: match.teams[other].name, opponentShort: match.teams[other].short,
      matchLabel: [matchLabel(ctx.m), `${match.teams[ms.team].short} v ${match.teams[other].short}`].filter(Boolean).join(" · "),
    });
    d.urls.player = await playerPhoto(rec, ms.team, ms.player);
    return { kind: "milestone", data: d, title: `${C.MILESTONE[ms.kind].word[0] + C.MILESTONE[ms.kind].word.slice(1).toLowerCase()}: ${name}` };
  }

  function resultCard(rec) {
    const ctx = matchContext(rec), match = rec.match, ru = E.settings(match), s = E.replay(match, rec.events);
    if (!s.result) return null;
    const winner = s.result.winner;
    const teams = s.innings.map((inn) => {
      const tm = ctx.teams[inn.batting];
      return Object.assign({}, tm, { score: `${inn.runs}/${inn.wickets}`, overs: E.oversText(inn.legalBalls, ru.ballsPerOver), won: winner === inn.batting });
    });
    let topBat = null, topBowl = null;
    for (const inn of s.innings) {
      for (const b of inn.batters) if (!topBat || b.runs > topBat.runs || (b.runs === topBat.runs && b.balls < topBat.balls)) topBat = { runs: b.runs, balls: b.balls, out: b.out, name: match.teams[inn.batting].players[b.player] };
      for (const b of inn.bowlers) if (b.balls && (!topBowl || b.wickets > topBowl.w || (b.wickets === topBowl.w && b.runs < topBowl.r))) topBowl = { w: b.wickets, r: b.runs, name: match.teams[inn.bowling].players[b.player] };
    }
    const d = base(ctx, {
      matchLabel: matchLabel(ctx.m) || "Full time",
      result: {
        text: s.result.text, teams,
        topBat: topBat && { name: topBat.name, figures: `${topBat.runs}${topBat.out && topBat.out.kind !== "retired" ? "" : "*"} (${topBat.balls})` },
        topBowl: topBowl && { name: topBowl.name, figures: `${topBowl.w}/${topBowl.r}` },
      },
    });
    d.urls.teams = teams.map((t) => t.logo);
    return { kind: "result", data: d, title: "Result card" };
  }

  function whenText(iso) {
    if (!iso) return "Date to be announced";
    const dt = new Date(iso);
    const day = dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    const time = dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return `${day} · ${time}`;
  }

  function versusCard(T, m) {
    const ti = tournamentInfo(T.t), tms = [lg.teamById(m.team1_id), lg.teamById(m.team2_id)];
    const teams = tms.map((t) => ({ name: t.name, short: t.short_name, c1: t.primary_color, c2: t.secondary_color }));
    const d = base({ ti }, {
      versus: { teams, when: whenText(m.starts_at), venue: m.venue || "", stage: matchLabel(m) || (T.t.kind === "series" ? "Series" : ""), rules: `${T.t.overs_per_side} overs a side` },
    });
    d.urls.teams = tms.map((t) => url("logos", t.logo_path));
    return { kind: "versus", data: d, title: `${tms[0].short_name} v ${tms[1].short_name}` };
  }

  function tableCard(T, group) {
    const ti = tournamentInfo(T.t);
    const ids = T.teams.filter((t) => (t.group || "") === group).map((t) => t.id);
    const ms = T.matches.filter((m) => T.t.kind === "series" || m.stage === "group");
    const rows = St.pointsTable(ids, ms).map((r) => {
      const t = lg.teamById(r.id);
      return { name: t.name, short: t.short_name, c1: t.primary_color, c2: t.secondary_color, logo: url("logos", t.logo_path), p: r.p, w: r.w, l: r.l, pts: r.pts, nrr: (r.nrr > 0 ? "+" : r.nrr < 0 ? "−" : "") + Math.abs(r.nrr).toFixed(3) };
    });
    const d = base({ ti }, { table: { group, rows, qualify: 2 } });
    d.urls.teams = rows.map((r) => r.logo);
    return { kind: "table", data: d, title: group ? `Points table, group ${group}` : "Points table" };
  }

  // ---------- Card lists ----------

  // Cards for one match: its milestones, then the result.
  function matchCards(rec) {
    const s = E.replay(rec.match, rec.events);
    const items = s.milestones.map((ms) => ({ label: `${C.MILESTONE[ms.kind].word}: ${rec.match.teams[ms.team].players[ms.player]}`, sub: ms.runs != null && ms.wickets == null ? `${ms.runs} (${ms.balls})` : `${ms.wickets}/${ms.runs}`, make: () => milestoneCard(rec, ms) }));
    if (s.result) items.push({ label: "Result", sub: s.result.text, make: async () => resultCard(rec) });
    return items;
  }

  ui.screens.cards = () => {
    const list = V.list || { title: "Cards", items: [] };
    return `<header class="bar"><button class="icon-btn" data-act="cards-back" aria-label="Back">←</button><h1>${esc(list.title)}</h1></header>
      <section class="wrap stack">${list.items.length ? `<ul class="t-list">${list.items.map((it, i) => `<li><button class="t-row" data-act="card-make" data-i="${i}">
        <span class="card-kind">${esc(it.icon || "★")}</span><span class="t-text"><b>${esc(it.label)}</b><small>${esc(it.sub || "")}</small></span><span class="chev" aria-hidden="true">›</span></button></li>`).join("")}</ul>`
        : `<p class="muted">No cards yet. Fifties, hundreds, three-fors and five-fors show up here as they happen, and the result card when the match ends.</p>`}</section>`;
  };

  function openList(title, items, back) {
    V.list = { title, items, back };
    ui.go("cards");
  }

  // Tournament Cards tab: match-day cards for coming fixtures, points tables, and results.
  function tab(T) {
    const upcoming = T.matches.filter((m) => m.status === "scheduled" || m.status === "live");
    const done = T.matches.filter((m) => m.status === "done");
    const groups = [...new Set(T.teams.map((t) => t.group || ""))].sort();
    const row = (act, attrs, icon, label, sub) => `<li><button class="t-row" data-act="${act}" ${attrs}><span class="card-kind">${icon}</span><span class="t-text"><b>${esc(label)}</b><small>${esc(sub)}</small></span><span class="chev" aria-hidden="true">›</span></button></li>`;
    const vs = upcoming.map((m) => { const a = lg.teamById(m.team1_id), b = lg.teamById(m.team2_id); return row("card-vs", `data-id="${m.id}"`, "VS", `${a.short_name} v ${b.short_name}`, whenText(m.starts_at)); }).join("");
    const tables = T.teams.length >= 2 ? groups.map((g) => row("card-table", `data-g="${esc(g)}"`, "▤", g ? `Points table, group ${g}` : "Points table", "Current standings")).join("") : "";
    const results = done.map((m) => { const a = lg.teamById(m.team1_id), b = lg.teamById(m.team2_id); return row("card-match", `data-id="${m.id}"`, "★", `${a.short_name} v ${b.short_name}`, m.result_text || "Result and milestones"); }).join("");
    const section = (title, body, empty) => `<h2 class="eyebrow">${title}</h2>${body ? `<ul class="t-list">${body}</ul>` : `<p class="muted">${empty}</p>`}`;
    return section("Match day", vs, "Add fixtures to make match-day cards.")
      + section("Standings", tables, "Add teams to make a points table card.")
      + section("Results and milestones", results, "Finished matches show up here.");
  }

  // ---------- Preview and share ----------

  async function show(card, back) {
    V.card = Object.assign({ size: "post", back, loading: true, caption: C.caption(card.kind, card.data) }, card);
    ui.go("cardview");
    await draw();
  }

  async function draw() {
    const c = V.card;
    c.loading = true; ui.render();
    try {
      c.canvas = await C.render(c.kind, c.data, c.size);
      c.preview = c.canvas.toDataURL("image/jpeg", 0.85);
      c.error = "";
    } catch (e) { c.error = "The card couldn't be drawn. " + ((e && e.message) || ""); }
    c.loading = false;
    if (ui.view().screen === "cardview") ui.render();
  }

  ui.screens.cardview = () => {
    const c = V.card;
    const chip = (v, label) => `<button class="chip ${c.size === v ? "on" : ""}" data-act="card-size" data-v="${v}">${label}</button>`;
    return `<header class="bar"><button class="icon-btn" data-act="cardview-back" aria-label="Back">←</button><h1>${esc(c.title || "Card")}</h1></header>
      <section class="wrap stack">
        <div class="chips">${chip("post", "Post 4:5")}${chip("story", "Story 9:16")}</div>
        <div class="card-preview ${c.size}">${c.loading ? `<p class="muted">Drawing…</p>` : c.error ? `<p class="error">${esc(c.error)}</p>` : `<img src="${c.preview}" alt="${esc(c.title || "Card")} preview">`}</div>
        <div class="row-2"><button class="btn btn-primary btn-big" data-act="card-share" ${c.loading ? "disabled" : ""}>Share</button><button class="btn btn-big" data-act="card-save" ${c.loading ? "disabled" : ""}>Save image</button></div>
        <label class="field"><span>Caption</span><textarea id="card-caption" rows="6">${esc(c.caption)}</textarea></label>
        <button class="btn" data-act="card-copy">Copy caption</button>
      </section>`;
  };

  const blobOf = (canvas) => new Promise((r) => canvas.toBlob(r, "image/png"));
  const fileName = () => `${(V.card.title || "card").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}-${V.card.size}.png`;
  const currentCaption = () => { const el = document.getElementById("card-caption"); return el ? el.value : V.card.caption; };

  async function copyCaption(quiet) {
    try { await navigator.clipboard.writeText(currentCaption()); if (!quiet) ui.toast("Caption copied"); return true; } catch (e) { return false; }
  }

  function saveImage(blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = fileName();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  Object.assign(ui.actions, {
    "cards-match"() { const rec = ui.current(); if (rec) openList(`${rec.match.teams[0].short} v ${rec.match.teams[1].short} cards`, matchCards(rec), "card"); },
    "cards-back"() {
      const back = V.list && V.list.back;
      if (back === "card") ui.actions.card();
      else if (back === "tour" && L.tour) lg.openTour(L.tour.id, "cards");
      else ui.actions.home();
    },
    async "card-make"(d) {
      const it = V.list.items[+d.i];
      ui.toast("Making the card…");
      const card = await it.make();
      if (card) show(card, "cards");
    },
    async "milestone-card"(d) {
      document.getElementById("toast").hidden = true;
      const rec = ui.current();
      if (!rec) return;
      const ms = E.replay(rec.match, rec.events).milestones.find((m) => m.index === +d.i);
      if (ms) show(await milestoneCard(rec, ms), "score");
    },
    "card-vs"(d) { const m = L.tour.matches.find((x) => x.id === d.id); if (m) show(versusCard(L.tour, m), "tour"); },
    "card-table"(d) { show(tableCard(L.tour, d.g || ""), "tour"); },
    async "card-match"(d) {
      // A finished tournament match: load its balls, then list its milestones and result.
      const m = L.tour.matches.find((x) => x.id === d.id);
      if (!m || !m.lineups) return;
      ui.toast("Loading match…");
      const [players, events] = await Promise.all([
        sb.from("players").select("id, full_name").in("id", [].concat(...m.lineups.teams.map((x) => x.players))),
        sb.from("match_events").select("seq, event").eq("match_id", m.id).order("seq"),
      ]);
      if (players.error || events.error) return ui.toast(lg.errText(players.error || events.error));
      const names = new Map(players.data.map((p) => [p.id, p.full_name]));
      const team = (id, i) => { const t = lg.teamById(id); return { name: t.name, short: t.short_name, players: m.lineups.teams[i].players.map((pid) => names.get(pid) || "Player") }; };
      const rec = {
        match: { id: m.id, teams: [team(m.team1_id, 0), team(m.team2_id, 1)], battingFirst: m.batting_first || 0, toss: m.toss, rules: m.rules,
          cloud: { matchId: m.id, tournamentId: m.tournament_id, teamIds: [m.team1_id, m.team2_id], playerIds: m.lineups.teams.map((x) => x.players) } },
        events: events.data.map((r) => r.event),
      };
      openList(`${rec.match.teams[0].short} v ${rec.match.teams[1].short} cards`, matchCards(rec), "tour");
    },
    "card-size"(d) { if (V.card.size !== d.v) { V.card.caption = currentCaption(); V.card.size = d.v; draw(); } },
    "cardview-back"() {
      V.card.caption = currentCaption();
      const b = V.card.back;
      if (b === "cards") ui.go("cards");
      else if (b === "tour" && L.tour) lg.openTour(L.tour.id, "cards");
      else if (b === "score" && ui.current()) ui.actions["back-score"]();
      else ui.actions.home();
    },
    async "card-share"() {
      const blob = await blobOf(V.card.canvas), text = currentCaption();
      const file = new File([blob], fileName(), { type: "image/png" });
      // Many apps drop the text when an image is shared, so the caption is copied too.
      const copied = await copyCaption(true);
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], text }); if (copied) ui.toast("Caption copied too. Paste it in your post."); return; }
        catch (e) { if (e && e.name === "AbortError") return; }
      }
      saveImage(blob);
      ui.toast(copied ? "Image saved and caption copied" : "Image saved");
    },
    async "card-save"() { saveImage(await blobOf(V.card.canvas)); ui.toast("Image saved"); },
    "card-copy"() { copyCaption(false); },
  });

  // A "Cards" button under every scorecard, before the change log.
  const prevExtra = ui.cardExtra;
  ui.cardExtra = (rec) => `<button class="btn btn-primary" data-act="cards-match">Cards for this match</button>` + prevExtra(rec);

  CSA.studio = { tab, show, matchCards };
})();
