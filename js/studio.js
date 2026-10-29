// The studio: turns match and tournament data into cards (js/cards.js), with a caption,
// in post or story size, ready to share. Reached from a match's scorecard, the milestone
// toast while scoring, and the Cards tab of a tournament (organisers, scorers and media managers).
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

  // ---------- Engagement cards ----------

  const logoOf = (t) => url("logos", t.logo_path);
  const teamInfo = (t) => ({ name: t.name, short: t.short_name, c1: t.primary_color, c2: t.secondary_color });

  // Fixture rows: a calendar date, the teams, and the time and venue or the result.
  function scheduleRow(m) {
    const a = lg.teamById(m.team1_id), b = lg.teamById(m.team2_id), dt = m.starts_at ? new Date(m.starts_at) : null;
    const played = m.status === "done" || m.status === "abandoned";
    return {
      day: dt ? String(dt.getDate()).padStart(2, "0") : "", mon: dt ? dt.toLocaleDateString("en-GB", { month: "short" }).toUpperCase() : "",
      wd: dt ? dt.toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase() : "",
      date: dt ? dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "",
      time: dt ? dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "",
      venue: m.venue || "", label: matchLabel(m), live: m.status === "live",
      result: played ? m.result_text || (m.status === "abandoned" ? "Abandoned" : "Result") : "",
      winner: played && m.winner_team_id ? (m.winner_team_id === m.team1_id ? 0 : 1) : null,
      teams: [teamInfo(a), teamInfo(b)], logos: [logoOf(a), logoOf(b)],
    };
  }

  const PAGE = 6;
  // Fixture lists come in pages of six, so each card stays readable.
  function schedulePages(T, upcoming) {
    const ms = T.matches.filter((m) => !upcoming || m.status === "scheduled" || m.status === "live");
    const pages = [];
    for (let i = 0; i < ms.length; i += PAGE) pages.push(ms.slice(i, i + PAGE));
    return pages.map((page, n) => ({ page, n, of: pages.length, upcoming }));
  }

  function scheduleCard(T, p) {
    const ti = tournamentInfo(T.t), rows = p.page.map(scheduleRow);
    const title = p.upcoming ? "Fixtures" : "Fixtures & results";
    const d = base({ ti }, { schedule: { title, label: p.upcoming ? "Match schedule" : "Full schedule", sub: p.of > 1 ? `Page ${p.n + 1} of ${p.of}` : T.t.kind === "series" ? "Series" : "", rows } });
    d.urls.teams = [].concat(...rows.map((r) => r.logos));
    return { kind: "schedule", data: d, title: p.of > 1 ? `${title} ${p.n + 1}/${p.of}` : title };
  }

  // Playing XIs of a match that has started: captain and keeper marked, toss on top.
  async function lineupCard(rec) {
    const ctx = matchContext(rec), match = rec.match, ids = match.cloud && match.cloud.playerIds;
    const roles = new Map(), caps = [null, null];
    if (ids && sb) {
      const [pl, tm] = await Promise.all([
        sb.from("players").select("id, role").in("id", [].concat(...ids)),
        sb.from("teams").select("id, captain_player_id").in("id", match.cloud.teamIds),
      ]);
      for (const p of pl.data || []) roles.set(p.id, p.role);
      for (const t of tm.data || []) caps[match.cloud.teamIds.indexOf(t.id)] = t.captain_player_id;
    }
    const teams = match.teams.map((tm, k) => {
      let keeper = false;
      const players = tm.players.map((name, i) => {
        const id = ids && ids[k] && ids[k][i];
        const wk = !keeper && roles.get(id) === "keeper";
        if (wk) keeper = true;
        return { name, cap: !!id && id === caps[k], wk };
      });
      return Object.assign({}, ctx.teams[k], { players });
    });
    const toss = match.toss && match.teams[match.toss.winner]
      ? `${match.teams[match.toss.winner].name} won the toss and chose to ${match.toss.decision === "bowl" ? "bowl" : "bat"}` : "";
    const d = base(ctx, { lineup: { teams, toss, stage: [matchLabel(ctx.m), `${match.teams[0].short} v ${match.teams[1].short}`].filter(Boolean).join(" · ") } });
    d.urls.teams = ctx.teams.map((t) => t.logo);
    return { kind: "lineup", data: d, title: `Playing XIs, ${match.teams[0].short} v ${match.teams[1].short}` };
  }

  // A team's squad, captain first, in the team's own colours.
  async function squadCard(T, teamId) {
    const t = lg.teamById(teamId), ti = tournamentInfo(T.t);
    const { data, error } = await sb.from("teams").select("captain_player_id, team_players(joined_at, players(id, full_name, role, jersey_no))").eq("id", teamId).single();
    if (error) { ui.toast(lg.errText(error)); return null; }
    const list = (data.team_players || []).filter((r) => r.players).sort((a, b) => String(a.joined_at).localeCompare(String(b.joined_at)));
    const players = list.map((r) => ({ id: r.players.id, name: r.players.full_name, role: r.players.role, no: r.players.jersey_no, cap: r.players.id === data.captain_player_id }));
    players.sort((a, b) => Number(b.cap) - Number(a.cap));
    if (!players.length) { ui.toast("This team has no players yet."); return null; }
    const cap = players.find((p) => p.cap);
    const d = base({ ti }, { colors: [t.primary_color || ti.info.c1, t.secondary_color || ti.info.c2], squad: { team: teamInfo(t), captain: cap ? cap.name : "", sub: T.t.kind === "series" ? "Series squad" : "", players } });
    d.urls.teams = [logoOf(t)];
    return { kind: "squad", data: d, title: `${t.short_name} squad` };
  }

  // Player of the match: the top of the MVP list, once the match has a result.
  async function potmCard(rec) {
    const ctx = matchContext(rec), match = rec.match, s = E.replay(match, rec.events);
    const x = s.result && St.mvp(match, s)[0];
    if (!x) return null;
    const tiles = [];
    if (x.balls) tiles.push({ v: String(x.runs), s: `(${x.balls})`, k: "Runs" });
    if (x.bowled) tiles.push({ v: `${x.wickets}/${x.conceded}`, k: x.wickets === 1 ? "Wicket" : "Wickets" });
    const field = x.catches + x.stumpings + x.runouts;
    if (field) tiles.push({ v: String(field), k: x.catches === field ? (field === 1 ? "Catch" : "Catches") : "Dismissals" });
    // Fill a short row with the rate that goes with the main figures.
    if (tiles.length < 3 && x.balls >= 6) tiles.push({ v: ((x.runs * 100) / x.balls).toFixed(0), k: "Strike rate" });
    if (tiles.length < 3 && x.bowled >= 6) tiles.push({ v: ((x.conceded * E.settings(match).ballsPerOver) / x.bowled).toFixed(1), k: "Economy" });
    if (tiles.length < 2) tiles.push({ v: String(x.pts), k: "MVP points" });
    const team = match.teams[x.team], opp = match.teams[1 - x.team];
    const d = base(ctx, {
      matchLabel: [matchLabel(ctx.m), `${team.short} v ${opp.short}`].filter(Boolean).join(" · "),
      player: { name: x.name, initials: initialsOf(x.name), team: team.name },
      potm: { pts: x.pts, line: `${team.name} · ${s.result.text}`, figures: x.line, result: s.result.text, tiles },
    });
    d.urls.player = await playerPhoto(rec, x.team, x.player);
    return { kind: "potm", data: d, title: `Player of the match: ${x.name}` };
  }

  // Innings break: the first innings total and what the chase needs.
  function targetCard(rec) {
    const ctx = matchContext(rec), match = rec.match, ru = E.settings(match), s = E.replay(match, rec.events);
    const a = s.innings[0];
    if (!a || !a.closed) return null;
    const balls = ru.oversPerSide * ru.ballsPerOver, target = a.runs + 1;
    let topBat = null, topBowl = null;
    for (const b of a.batters) if (!topBat || b.runs > topBat.runs) topBat = b;
    for (const b of a.bowlers) if (b.balls && (!topBowl || b.wickets > topBowl.wickets || (b.wickets === topBowl.wickets && b.runs < topBowl.runs))) topBowl = b;
    const d = base(ctx, {
      matchLabel: [matchLabel(ctx.m), `${match.teams[0].short} v ${match.teams[1].short}`].filter(Boolean).join(" · "),
      target: {
        batting: ctx.teams[a.batting], chasing: ctx.teams[a.bowling], runs: a.runs, wickets: a.wickets,
        overs: `${E.oversText(a.legalBalls, ru.ballsPerOver)} ov`, target, balls, rrr: ((target * ru.ballsPerOver) / balls).toFixed(2),
        topBat: topBat && topBat.balls ? { label: "Top scorer", name: match.teams[a.batting].players[topBat.player], figures: `${topBat.runs}${topBat.out && topBat.out.kind !== "retired" ? "" : "*"} (${topBat.balls})` } : null,
        topBowl: topBowl ? { label: "Best bowling", name: match.teams[a.bowling].players[topBowl.player], figures: `${topBowl.wickets}/${topBowl.runs}` } : null,
      },
    });
    d.urls.teams = [ctx.teams[a.batting].logo, ctx.teams[a.bowling].logo];
    return { kind: "target", data: d, title: "Innings break" };
  }

  const LEADERS = {
    runs: { title: "Most runs", unit: "Runs", list: (x) => x.runs, value: (r) => r.runs, sub: (r) => `${r.inns} inn · SR ${r.sr.toFixed(1)} · Best ${r.best}${r.bestOut ? "" : "*"}` },
    wickets: { title: "Most wickets", unit: "Wickets", list: (x) => x.wickets.filter((r) => r.wickets > 0), value: (r) => r.wickets, sub: (r) => `${r.overs} ov · Econ ${r.econ.toFixed(2)} · Best ${r.bestW}/${r.bestR}` },
    sixes: { title: "Most sixes", unit: "Sixes", list: (x) => x.sixes, value: (r) => r.sixes, sub: (r) => `${r.runs} runs · ${r.inns} inn` },
  };

  // A leaderboard from finished matches, with the leader's photo when they have one.
  async function leadersCard(T, kind) {
    const K = LEADERS[kind], ti = tournamentInfo(T.t), done = T.matches.filter((m) => m.status === "done").length;
    const list = K.list(St.leaders(T.matches)).slice(0, 8);
    if (!list.length) { ui.toast("No numbers yet for this list."); return null; }
    const rows = list.map((r) => { const t = lg.teamById(r.teamId); return { name: r.name, initials: initialsOf(r.name), team: teamInfo(t), logo: logoOf(t), value: K.value(r), sub: K.sub(r) }; });
    const d = base({ ti }, { leaders: { title: K.title, unit: K.unit, sub: `After ${done} match${done === 1 ? "" : "es"}`, rows } });
    d.urls.teams = rows.map((r) => r.logo);
    if (list[0].id && sb) {
      const { data } = await sb.from("players").select("photo_path").eq("id", list[0].id).maybeSingle();
      d.urls.player = data && data.photo_path ? url("photos", data.photo_path) : "";
    }
    return { kind: "leaders", data: d, title: K.title };
  }

  // The winner: of the final, or of a finished series with more wins.
  function champion(T) {
    const final = T.matches.find((m) => m.stage === "final" && m.status === "done" && m.winner_team_id);
    if (final) {
      const loser = lg.teamById(final.winner_team_id === final.team1_id ? final.team2_id : final.team1_id);
      return { id: final.winner_team_id, result: `Beat ${loser.name} in the final`, at: final.starts_at };
    }
    if (T.t.kind !== "series" || !T.matches.length || T.matches.some((m) => m.status === "scheduled" || m.status === "live")) return null;
    const wins = new Map();
    for (const m of T.matches) if (m.winner_team_id) wins.set(m.winner_team_id, (wins.get(m.winner_team_id) || 0) + 1);
    const [top, second] = [...wins.entries()].sort((a, b) => b[1] - a[1]);
    if (!top || (second && second[1] === top[1])) return null;
    return { id: top[0], result: `Won the series ${top[1]}-${second ? second[1] : 0}`, at: T.matches[T.matches.length - 1].starts_at, series: true };
  }

  function championsCard(T) {
    const c = champion(T);
    if (!c) return null;
    const t = lg.teamById(c.id), ti = tournamentInfo(T.t);
    const year = String(new Date(c.at || T.t.starts_on || Date.now()).getFullYear());
    const d = base({ ti }, { champions: { team: teamInfo(t), title: c.series ? "Series winners" : "Champions", result: c.result, season: T.t.name.includes(year) ? "" : year } });
    d.urls.teams = [logoOf(t)];
    return { kind: "champions", data: d, title: `${t.short_name}, champions` };
  }

  // ---------- Card lists ----------

  // Cards for one match: the playing XIs, the innings-break target, milestones, player of the match and the result.
  function matchCards(rec) {
    const s = E.replay(rec.match, rec.events), t = rec.match.teams;
    const items = [{ icon: "XI", label: "Playing XIs", sub: `${t[0].name} v ${t[1].name}`, make: () => lineupCard(rec) }];
    if (s.innings[0] && s.innings[0].closed) items.push({ icon: "◎", label: "Innings break", sub: `Target ${s.innings[0].runs + 1}`, make: async () => targetCard(rec) });
    for (const ms of s.milestones) items.push({ label: `${C.MILESTONE[ms.kind].word}: ${t[ms.team].players[ms.player]}`, sub: ms.runs != null && ms.wickets == null ? `${ms.runs} (${ms.balls})` : `${ms.wickets}/${ms.runs}`, make: () => milestoneCard(rec, ms) });
    if (s.result) {
      const top = St.mvp(rec.match, s)[0];
      if (top) items.push({ icon: "MVP", label: "Player of the match", sub: `${top.name} · ${top.pts} pts`, make: () => potmCard(rec) });
      items.push({ label: "Result", sub: s.result.text, make: async () => resultCard(rec) });
    }
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

  // Tournament Cards tab: fixtures, match day, standings, leaders, squads, champions, then each match's cards.
  function tab(T) {
    const upcoming = T.matches.filter((m) => m.status === "scheduled" || m.status === "live");
    const played = T.matches.filter((m) => m.status === "done" || m.status === "live").reverse();
    const groups = [...new Set(T.teams.map((t) => t.group || ""))].sort();
    const row = (act, attrs, icon, label, sub) => `<li><button class="t-row" data-act="${act}" ${attrs}><span class="card-kind">${icon}</span><span class="t-text"><b>${esc(label)}</b><small>${esc(sub)}</small></span><span class="chev" aria-hidden="true">›</span></button></li>`;
    const vsName = (m) => { const a = lg.teamById(m.team1_id), b = lg.teamById(m.team2_id); return `${a.short_name} v ${b.short_name}`; };
    const pages = (up) => schedulePages(T, up).map((p) => row("card-schedule", `data-up="${up ? 1 : 0}" data-n="${p.n}"`, "▦",
      `${up ? "Upcoming fixtures" : "Fixtures and results"}${p.of > 1 ? ` (${p.n + 1}/${p.of})` : ""}`, `${p.page.length} match${p.page.length === 1 ? "" : "es"} from ${whenText(p.page[0].starts_at)}`)).join("");
    const schedule = pages(true) + (T.matches.some((m) => m.status === "done") ? pages(false) : "");
    const vs = upcoming.map((m) => row("card-vs", `data-id="${m.id}"`, "VS", vsName(m), whenText(m.starts_at))).join("")
      + upcoming.filter((m) => m.lineups).map((m) => row("card-lineup", `data-id="${m.id}"`, "XI", `Playing XIs, ${vsName(m)}`, "Line-ups and toss")).join("");
    const tables = T.teams.length >= 2 ? groups.map((g) => row("card-table", `data-g="${esc(g)}"`, "▤", g ? `Points table, group ${g}` : "Points table", "Current standings")).join("") : "";
    const hasDone = T.matches.some((m) => m.status === "done");
    const leaders = hasDone ? Object.entries(LEADERS).map(([k, K]) => row("card-leaders", `data-k="${k}"`, "№1", K.title, "Top five, with the leader's photo")).join("") : "";
    const squads = T.teams.map((t) => row("card-squad", `data-id="${t.id}"`, "👥", `${t.name} squad`, `${t.count || 0} player${t.count === 1 ? "" : "s"}`)).join("");
    const champ = champion(T);
    const champs = champ ? row("card-champions", "", "🏆", champ.series ? "Series winners" : "Champions", lg.teamById(champ.id).name) : "";
    const results = played.map((m) => row("card-match", `data-id="${m.id}"`, m.status === "live" ? "●" : "★", vsName(m), m.status === "live" ? "Live: line-ups, milestones, innings break" : m.result_text || "Result and milestones")).join("");
    const section = (title, body, empty) => `<h2 class="eyebrow">${title}</h2>${body ? `<ul class="t-list">${body}</ul>` : `<p class="muted">${empty}</p>`}`;
    return (champs ? section("Champions", champs, "") : "")
      + section("Schedule", schedule, "Add fixtures to make a schedule card.")
      + section("Match day", vs, "Coming fixtures show up here.")
      + section("Standings", tables, "Add teams to make a points table card.")
      + section("Leaders", leaders, "Run, wicket and six leaders show up after the first finished match.")
      + section("Squads", squads, "Add teams to make squad cards.")
      + section("Matches", results, "Live and finished matches show up here.");
  }

  // A finished tournament match (L.tour must be open): load its balls and players into a record.
  async function loadMatch(m) {
    if (!m || !m.lineups) return null;
    ui.toast("Loading match…");
    const [players, events] = await Promise.all([
      sb.from("players").select("id, full_name").in("id", [].concat(...m.lineups.teams.map((x) => x.players))),
      sb.from("match_events").select("seq, event").eq("match_id", m.id).order("seq"),
    ]);
    if (players.error || events.error) { ui.toast(lg.errText(players.error || events.error)); return null; }
    const names = new Map(players.data.map((p) => [p.id, p.full_name]));
    const team = (id, i) => { const t = lg.teamById(id); return { name: t.name, short: t.short_name, players: m.lineups.teams[i].players.map((pid) => names.get(pid) || "Player") }; };
    return {
      match: { id: m.id, teams: [team(m.team1_id, 0), team(m.team2_id, 1)], battingFirst: m.batting_first || 0, toss: m.toss, rules: m.rules,
        cloud: { matchId: m.id, tournamentId: m.tournament_id, teamIds: [m.team1_id, m.team2_id], playerIds: m.lineups.teams.map((x) => x.players) } },
      events: events.data.map((r) => r.event),
    };
  }

  // Opens the card an alert points to: a milestone {mk, team, player} or the result of a match.
  async function openAlert(a) {
    await lg.openTour(a.tournament, "cards");
    const rec = await loadMatch(L.tour.matches && L.tour.matches.find((x) => x.id === a.match));
    if (!rec) return ui.toast("This match can't be opened any more.");
    if (a.mk) {
      const ms = E.replay(rec.match, rec.events).milestones.find((x) => x.kind === a.mk && x.team === a.team && x.player === a.player);
      if (!ms) return ui.toast("That milestone was changed after a score correction.");
      return show(await milestoneCard(rec, ms), "tour");
    }
    const card = resultCard(rec);
    if (card) show(card, "tour"); else openList("Cards", matchCards(rec), "tour");
  }

  // ---------- Preview and share ----------

  async function show(card, back) {
    document.getElementById("toast").hidden = true;
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
    "card-schedule"(d) { const p = schedulePages(L.tour, d.up === "1")[+d.n]; if (p) show(scheduleCard(L.tour, p), "tour"); },
    async "card-lineup"(d) { const rec = await loadMatch(L.tour.matches.find((x) => x.id === d.id)); if (rec) show(await lineupCard(rec), "tour"); },
    async "card-squad"(d) { ui.toast("Loading squad…"); const card = await squadCard(L.tour, d.id); if (card) show(card, "tour"); },
    async "card-leaders"(d) { const card = await leadersCard(L.tour, d.k); if (card) show(card, "tour"); },
    "card-champions"() { const card = championsCard(L.tour); if (card) show(card, "tour"); },
    async "card-match"(d) {
      const m = L.tour.matches.find((x) => x.id === d.id);
      const rec = m && await loadMatch(m);
      if (rec) openList(`${rec.match.teams[0].short} v ${rec.match.teams[1].short} cards`, matchCards(rec), "tour");
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

  CSA.studio = { tab, show, matchCards, openAlert };
})();
