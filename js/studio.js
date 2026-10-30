// The studio: turns match and tournament data into cards (js/cards.js), with a caption,
// in post or story size, ready to share. Reached from a match's scorecard, the milestone
// toast while scoring, and the Cards tab of a tournament (organisers, scorers and media managers).
(function () {
  const ui = CSA.ui, esc = ui.esc, E = CSA.engine, C = CSA.cards, St = CSA.stats;
  const lg = CSA.league || null;
  const sb = lg && lg.sb, L = lg ? lg.L : {};
  const url = (bucket, path) => (lg && path ? lg.publicUrl(bucket, path) : "");

  // The card being previewed, the open list of cards, and the look last picked (A, B or C).
  const V = { card: null, list: null, style: "A" };

  // ---------- Building card data ----------

  const initialsOf = (name) => String(name || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 3).toUpperCase();

  function tournamentInfo(t) {
    if (!t) return { id: "", info: { name: "Friendly match", short: "", initials: "CS", c1: "#0F7A45", c2: "#0E1A14" }, logo: "", sponsor: { show: false } };
    return {
      id: t.id,
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

  // Sponsor logos added on the card page are kept on this device, per tournament, as small data URLs.
  const sponsorKey = (tid) => `csa.cardSponsors.${tid || "friendly"}`;
  function savedSponsors(tid) { try { return JSON.parse(localStorage.getItem(sponsorKey(tid)) || "[]"); } catch (e) { return []; } }
  function saveSponsors(tid, list) { try { localStorage.setItem(sponsorKey(tid), JSON.stringify(list)); return true; } catch (e) { return false; } }

  // The tournament's own sponsor (from its settings, when shown and set) and then this device's.
  function sponsorsFor(ti) {
    const sp = ti.sponsor, own = sp.show && (sp.logo || sp.name) ? [{ name: sp.name || "", url: sp.logo || "", from: "tour" }] : [];
    return own.concat(savedSponsors(ti.id).map((x) => ({ name: "", url: x.url, from: "device", id: x.id })));
  }

  function base(ctx, extra) {
    return Object.assign({ tournament: ctx.ti.info, tournamentId: ctx.ti.id, sponsors: sponsorsFor(ctx.ti), urls: { tournament: ctx.ti.logo } }, extra);
  }

  // A player's photo and shirt number, by database id.
  async function playerExtras(id) {
    if (!id || !sb) return { photo: "", no: null };
    const { data } = await sb.from("players").select("photo_path, jersey_no").eq("id", id).maybeSingle();
    return { photo: data && data.photo_path ? url("photos", data.photo_path) : "", no: data ? data.jersey_no : null };
  }

  // The player on a player card, in their team's colours, with photo and shirt number.
  async function heroPlayer(rec, ctx, team, p, d) {
    const ids = rec.match.cloud && rec.match.cloud.playerIds, tm = ctx.teams[team];
    const x = await playerExtras(ids && ids[team] && ids[team][p]);
    const name = rec.match.teams[team].players[p];
    d.player = { name, initials: initialsOf(name), team: tm.name, teamShort: tm.short, c1: tm.c1, c2: tm.c2, no: x.no };
    d.urls.player = x.photo;
    d.urls.teams = [tm.logo];
    return d;
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
      opponent: match.teams[other].name, opponentShort: match.teams[other].short,
      matchLabel: [matchLabel(ctx.m), `${match.teams[ms.team].short} v ${match.teams[other].short}`].filter(Boolean).join(" · "),
    });
    await heroPlayer(rec, ctx, ms.team, ms.player, d);
    return { kind: "milestone", data: d, title: `${C.MILESTONE[ms.kind].word[0] + C.MILESTONE[ms.kind].word.slice(1).toLowerCase()}: ${name}` };
  }

  // One player's figures in a match: "bat", "bowl", or "all" for both on one card.
  function performanceOf(rec, team, p) {
    const match = rec.match, ru = E.settings(match), s = E.replay(match, rec.events);
    const bi = s.innings.find((i) => i.batting === team), wi = s.innings.find((i) => i.bowling === team);
    const b = bi && bi.batters.find((x) => x.player === p && (x.balls || x.out));
    const w = wi && wi.bowlers.find((x) => x.player === p && x.balls);
    return {
      bat: b && { kind: "batting", batting: true, runs: b.runs, balls: b.balls, fours: b.fours, sixes: b.sixes, notOut: !b.out || b.out.kind === "retired", sr: b.balls ? ((b.runs * 100) / b.balls).toFixed(1) : "0" },
      bowl: w && { kind: "bowling", batting: false, wickets: w.wickets, runs: w.runs, overs: E.oversText(w.balls, ru.ballsPerOver), maidens: w.maidens, econ: ((w.runs * ru.ballsPerOver) / w.balls).toFixed(2) },
    };
  }

  // A performance card for any player in the match, milestone or not.
  async function performanceCard(rec, team, p, mode) {
    const ctx = matchContext(rec), match = rec.match, f = performanceOf(rec, team, p), other = 1 - team;
    const name = match.teams[team].players[p];
    const d = base(ctx, {
      opponent: match.teams[other].name, opponentShort: match.teams[other].short,
      matchLabel: [matchLabel(ctx.m), `${match.teams[team].short} v ${match.teams[other].short}`].filter(Boolean).join(" · "),
    });
    let kind, title;
    if (mode === "all") {
      const tiles = [{ v: `${f.bat.runs}${f.bat.notOut ? "*" : ""}`, s: `(${f.bat.balls})`, k: "Runs" }, { v: `${f.bat.sr}`, k: "Strike rate" },
        { v: `${f.bowl.wickets}/${f.bowl.runs}`, k: f.bowl.wickets === 1 ? "Wicket" : "Wickets" }, { v: f.bowl.econ, k: "Economy" }];
      d.potm = { result: `${match.teams[team].name} v ${match.teams[other].name}`, tiles, figures: `${tiles[0].v} ${tiles[0].s} & ${tiles[2].v}` };
      d.heading = { text: "ALL-ROUND SHOW", lines: ["ALL", "ROUND", "SHOW"], ghost: "ALL" };
      kind = "allround"; title = `All-round: ${name}`;
    } else {
      d.milestone = mode === "bat" ? f.bat : f.bowl;
      kind = mode === "bat" ? "batperf" : "bowlperf"; title = `${mode === "bat" ? "Batting" : "Bowling"}: ${name}`;
    }
    await heroPlayer(rec, ctx, team, p, d);
    return { kind, data: d, title };
  }

  // Every player's batting, bowling and all-round cards for a match. The signed-in player's own come first.
  function performanceItems(rec) {
    const match = rec.match, ids = match.cloud && match.cloud.playerIds, me = L.me && L.me.id;
    const items = [];
    match.teams.forEach((tm, team) => tm.players.forEach((name, p) => {
      const f = performanceOf(rec, team, p), mine = !!me && ids && ids[team] && ids[team][p] === me;
      const who = mine ? `You (${name})` : name, sort = (mine ? 1e6 : 0);
      if (f.bat) items.push({ icon: "BAT", label: `${who}: batting`, sub: `${f.bat.runs}${f.bat.notOut ? "*" : ""} (${f.bat.balls}) · ${tm.short}`, w: sort + f.bat.runs, make: () => performanceCard(rec, team, p, "bat") });
      if (f.bowl) items.push({ icon: "BWL", label: `${who}: bowling`, sub: `${f.bowl.wickets}/${f.bowl.runs} (${f.bowl.overs}) · ${tm.short}`, w: sort + f.bowl.wickets * 20 - f.bowl.runs / 10, make: () => performanceCard(rec, team, p, "bowl") });
      if (f.bat && f.bowl) items.push({ icon: "AR", label: `${who}: all-round`, sub: `${f.bat.runs} & ${f.bowl.wickets}/${f.bowl.runs} · ${tm.short}`, w: sort + f.bat.runs + f.bowl.wickets * 20, make: () => performanceCard(rec, team, p, "all") });
    }));
    return items.sort((a, b) => b.w - a.w);
  }

  // The result, with the winning captain's photo for the Hero look.
  async function resultCard(rec) {
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
    const top = St.mvp(match, s)[0];
    if (top) d.result.potm = { name: top.name, figures: [top.balls ? `${top.runs} (${top.balls})` : "", top.bowled ? `${top.wickets}/${top.conceded}` : ""].filter(Boolean).join(" & ") || top.line };
    const wt = winner != null ? ctx.teams[winner] : null;
    if (wt) {
      d.player = { name: "", team: wt.name, teamShort: wt.short, c1: wt.c1, c2: wt.c2 };
      const tid = match.cloud && match.cloud.teamIds && match.cloud.teamIds[winner];
      if (tid && sb) {
        const { data } = await sb.from("teams").select("captain_player_id").eq("id", tid).maybeSingle();
        const cap = data && data.captain_player_id;
        if (cap) {
          const [x, pl] = await Promise.all([playerExtras(cap), sb.from("players").select("full_name").eq("id", cap).maybeSingle()]);
          d.urls.player = x.photo; d.player.no = x.no;
          d.result.captain = pl.data ? pl.data.full_name : "";
        }
      }
    }
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

  async function versusCard(T, m) {
    const ti = tournamentInfo(T.t), tms = [lg.teamById(m.team1_id), lg.teamById(m.team2_id)];
    const teams = tms.map((t) => ({ name: t.name, short: t.short_name, c1: t.primary_color, c2: t.secondary_color }));
    const d = base({ ti }, {
      versus: { teams, when: whenText(m.starts_at), venue: m.venue || "", stage: matchLabel(m) || (T.t.kind === "series" ? "Series" : ""), rules: `${T.t.overs_per_side} overs a side` },
    });
    d.urls.teams = tms.map((t) => url("logos", t.logo_path));
    const caps = await captainPhotos(tms.map((t) => t.id)).catch(() => new Map());
    d.urls.caps = tms.map((t) => caps.get(t.id) || "");
    return { kind: "versus", data: d, title: `${tms[0].short_name} v ${tms[1].short_name}` };
  }

  // A team's last results, oldest first: W, L, T (tie) or N (no result).
  function formOf(id, ms) {
    return ms.filter((m) => (m.team1_id === id || m.team2_id === id) && (m.status === "done" || m.status === "abandoned"))
      .sort((a, b) => String(a.starts_at || "").localeCompare(String(b.starts_at || ""))).slice(-5)
      .map((m) => m.status === "abandoned" ? "N" : !m.winner_team_id ? "T" : m.winner_team_id === id ? "W" : "L");
  }

  async function tableCard(T, group) {
    const ti = tournamentInfo(T.t);
    const ids = T.teams.filter((t) => (t.group || "") === group).map((t) => t.id);
    const ms = T.matches.filter((m) => T.t.kind === "series" || m.stage === "group");
    const table = St.pointsTable(ids, ms);
    const rows = table.map((r) => {
      const t = lg.teamById(r.id);
      return { name: t.name, short: t.short_name, c1: t.primary_color, c2: t.secondary_color, logo: url("logos", t.logo_path), p: r.p, w: r.w, l: r.l, pts: r.pts, nrr: (r.nrr > 0 ? "+" : r.nrr < 0 ? "−" : "") + Math.abs(r.nrr).toFixed(3), form: formOf(r.id, ms) };
    });
    const d = base({ ti }, { table: { group, rows, qualify: 2 } });
    d.urls.teams = rows.map((r) => r.logo);
    // The leader's captain, for the Leader look.
    const caps = table.length ? await captainPhotos([table[0].id]).catch(() => new Map()) : new Map();
    d.urls.caps = table.length ? [caps.get(table[0].id) || ""] : [];
    return { kind: "table", data: d, title: group ? `Points table, group ${group}` : "Points table" };
  }

  // ---------- Engagement cards ----------

  const logoOf = (t) => url("logos", t.logo_path);
  const teamInfo = (t) => ({ name: t.name, short: t.short_name, c1: t.primary_color, c2: t.secondary_color });

  const groupOf = (T, id) => { const t = T.teams.find((x) => x.id === id); return (t && t.group) || ""; };

  // A fixture row: the teams, the time or the result and score, and the group and ground.
  function scheduleRow(T, m) {
    const a = lg.teamById(m.team1_id), b = lg.teamById(m.team2_id), dt = m.starts_at ? new Date(m.starts_at) : null;
    const played = m.status === "done" || m.status === "abandoned";
    const g = m.stage === "group" && T.t.kind !== "series" ? groupOf(T, m.team1_id) : "";
    const inn = played && m.summary && m.summary.innings;
    const score = inn && inn.length ? [0, 1].map((k) => { const x = inn.find((i) => i.team === k); return x ? `${x.runs}/${x.wickets}` : "–"; }).join(" · ") : "";
    return {
      time: dt ? dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "",
      tag: [g ? `Grp ${g}` : m.stage && m.stage !== "group" ? STAGE[m.stage] : m.match_no ? `Match ${m.match_no}` : "", m.venue || ""].filter(Boolean).join(" · ").toUpperCase(),
      live: m.status === "live", score,
      result: played ? m.result_text || (m.status === "abandoned" ? "Abandoned" : "Result") : "",
      winner: played && m.winner_team_id ? (m.winner_team_id === m.team1_id ? 0 : 1) : null,
      teams: [teamInfo(a), teamInfo(b)], logos: [logoOf(a), logoOf(b)],
    };
  }

  const PAGE = 8;
  const dayKey = (iso) => { if (!iso) return ""; const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const dayText = (iso) => iso ? new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "Date to be announced";

  // One card per match day, up to eight matches; a busier day goes on to a second card.
  function matchDays(T) {
    const ms = T.matches.slice().sort((x, y) => String(x.starts_at || "9").localeCompare(String(y.starts_at || "9")));
    const days = new Map();
    for (const m of ms) { const k = dayKey(m.starts_at); if (!days.has(k)) days.set(k, []); days.get(k).push(m); }
    const out = [];
    for (const [key, list] of days) {
      const of = Math.ceil(list.length / PAGE);
      for (let n = 0; n < of; n++) out.push({ key, page: list.slice(n * PAGE, (n + 1) * PAGE), n, of, when: list[0].starts_at, done: list.every((m) => m.status === "done" || m.status === "abandoned") });
    }
    return out;
  }

  // Each team's captain photo, by team id.
  async function captainPhotos(ids) {
    const out = new Map();
    if (!sb || !ids.length) return out;
    const { data: tm } = await sb.from("teams").select("id, captain_player_id").in("id", ids);
    const caps = (tm || []).filter((t) => t.captain_player_id);
    if (!caps.length) return out;
    const { data: pl } = await sb.from("players").select("id, photo_path").in("id", caps.map((t) => t.captain_player_id));
    const photo = new Map((pl || []).filter((x) => x.photo_path).map((x) => [x.id, url("photos", x.photo_path)]));
    for (const t of caps) if (photo.has(t.captain_player_id)) out.set(t.id, photo.get(t.captain_player_id));
    return out;
  }

  async function scheduleCard(T, p) {
    const ti = tournamentInfo(T.t), rows = p.page.map((m) => scheduleRow(T, m));
    const stages = [...new Set(p.page.map((m) => STAGE[m.stage] || ""))].filter(Boolean);
    const sub = [stages.length === 1 ? stages[0] : "", p.of > 1 ? `Part ${p.n + 1} of ${p.of}` : ""].filter(Boolean).join(" · ");
    const kicker = dayText(p.when).replace(",", " ·").toUpperCase();
    const d = base({ ti }, { schedule: { title: p.done ? "Results" : "Match day", kicker, sub, rows } });
    d.urls.teams = [].concat(...rows.map((r) => r.logos));
    const ids = [].concat(...p.page.map((m) => [m.team1_id, m.team2_id]));
    const caps = await captainPhotos([...new Set(ids)]).catch(() => new Map());
    d.urls.caps = ids.map((id) => caps.get(id) || "");
    return { kind: "schedule", data: d, title: `${p.done ? "Results" : "Match day"}, ${dayText(p.when)}${p.of > 1 ? ` (${p.n + 1}/${p.of})` : ""}` };
  }

  // The groups, each with its teams.
  function groupNames(T) { return [...new Set(T.teams.map((t) => t.group || ""))].filter(Boolean).sort(); }
  // Up to four groups on a card; more go on to further cards. One group can also have a card of its own, with captains.
  const GROUP_PAGE = 4;
  function groupPages(T) { const names = groupNames(T), out = []; for (let i = 0; i < names.length; i += GROUP_PAGE) out.push(names.slice(i, i + GROUP_PAGE)); return out; }
  async function groupsCard(T, page, only) {
    const ti = tournamentInfo(T.t), all = groupNames(T), pages = groupPages(T), names = only ? [only] : pages[page] || [];
    const groups = names.map((g) => ({ name: `Group ${g}`, teams: T.teams.filter((t) => t.group === g).map((t) => lg.teamById(t.id)) }));
    const part = !only && pages.length > 1 ? `Part ${page + 1} of ${pages.length}` : "";
    const d = base({ ti }, { groups: { kicker: "Group stage", sub: `${T.teams.length} teams · ${all.length} groups`, part, groups: groups.map((g) => ({ name: g.name, teams: g.teams.map(teamInfo) })) } });
    d.urls.teams = [].concat(...groups.map((g) => g.teams.map(logoOf)));
    if (only) {
      const ids = groups[0].teams.map((t) => t.id), caps = await captainPhotos(ids).catch(() => new Map());
      d.urls.caps = ids.map((id) => caps.get(id) || "");
    }
    return { kind: "groups", data: d, title: only ? `Group ${only}` : `Groups${part ? ` (${page + 1}/${pages.length})` : ""}` };
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
    d.urls.caps = (await Promise.all(caps.map((id) => (id ? playerExtras(id) : null)))).map((x) => (x && x.photo) || "");
    return { kind: "lineup", data: d, title: `Playing XIs, ${match.teams[0].short} v ${match.teams[1].short}` };
  }

  // A team's squad, captain first, in the team's own colours.
  async function squadCard(T, teamId) {
    const t = lg.teamById(teamId), ti = tournamentInfo(T.t);
    const { data, error } = await sb.from("teams").select("captain_player_id, team_players(joined_at, players(id, full_name, role, jersey_no, photo_path))").eq("id", teamId).single();
    if (error) { ui.toast(lg.errText(error)); return null; }
    const list = (data.team_players || []).filter((r) => r.players).sort((a, b) => String(a.joined_at).localeCompare(String(b.joined_at)));
    const players = list.map((r) => ({ id: r.players.id, name: r.players.full_name, role: r.players.role, no: r.players.jersey_no, wk: r.players.role === "keeper", cap: r.players.id === data.captain_player_id, photo: r.players.photo_path ? url("photos", r.players.photo_path) : "" }));
    players.sort((a, b) => Number(b.cap) - Number(a.cap));
    if (!players.length) { ui.toast("This team has no players yet."); return null; }
    const cap = players.find((p) => p.cap);
    const d = base({ ti }, { colors: [t.primary_color || ti.info.c1, t.secondary_color || ti.info.c2], squad: { team: teamInfo(t), captain: cap ? cap.name : "", sub: T.t.kind === "series" ? "Series squad" : "", players } });
    d.urls.teams = [logoOf(t)];
    d.urls.players = players.map((p) => p.photo);
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
    if (tiles.length < 4 && x.balls >= 6) tiles.push({ v: ((x.runs * 100) / x.balls).toFixed(0), k: "Strike rate" });
    if (tiles.length < 4 && x.bowled >= 6) tiles.push({ v: ((x.conceded * E.settings(match).ballsPerOver) / x.bowled).toFixed(1), k: "Economy" });
    if (tiles.length < 2) tiles.push({ v: String(x.pts), k: "MVP points" });
    const team = match.teams[x.team], opp = match.teams[1 - x.team];
    const d = base(ctx, {
      matchLabel: [matchLabel(ctx.m), `${team.short} v ${opp.short}`].filter(Boolean).join(" · "),
      potm: { pts: x.pts, line: s.result.text, figures: x.line, result: s.result.text, tiles },
    });
    await heroPlayer(rec, ctx, x.team, x.player, d);
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
    // Everyone's photo, for the faces on each row.
    const ids = list.map((r) => r.id).filter(Boolean);
    if (ids.length && sb) {
      const { data } = await sb.from("players").select("id, photo_path").in("id", ids);
      const photo = new Map((data || []).filter((x) => x.photo_path).map((x) => [x.id, url("photos", x.photo_path)]));
      d.urls.players = list.map((r) => photo.get(r.id) || "");
      d.urls.player = d.urls.players[0];
    }
    return { kind: "leaders", data: d, title: K.title };
  }

  // The winner: of the final, or of a finished series with more wins.
  function champion(T) {
    const final = T.matches.find((m) => m.stage === "final" && m.status === "done" && m.winner_team_id);
    if (final) {
      const loser = lg.teamById(final.winner_team_id === final.team1_id ? final.team2_id : final.team1_id);
      const winner = lg.teamById(final.winner_team_id);
      return { id: final.winner_team_id, result: `Beat ${loser.name} in the final`, at: final.starts_at, second: loser.id, secondResult: `Lost to ${winner.name} in the final` };
    }
    if (T.t.kind !== "series" || !T.matches.length || T.matches.some((m) => m.status === "scheduled" || m.status === "live")) return null;
    const wins = new Map();
    for (const m of T.matches) if (m.winner_team_id) wins.set(m.winner_team_id, (wins.get(m.winner_team_id) || 0) + 1);
    const [top, second] = [...wins.entries()].sort((a, b) => b[1] - a[1]);
    if (!top || (second && second[1] === top[1])) return null;
    return { id: top[0], result: `Won the series ${top[1]}-${second ? second[1] : 0}`, at: T.matches[T.matches.length - 1].starts_at, series: true };
  }

  // Champions, or with `silver` the runners-up of the final.
  async function championsCard(T, silver) {
    const c = champion(T);
    if (!c || (silver && !c.second)) return null;
    const t = lg.teamById(silver ? c.second : c.id), ti = tournamentInfo(T.t);
    const year = String(new Date(c.at || T.t.starts_on || Date.now()).getFullYear());
    const title = silver ? "Runners-up" : c.series ? "Series winners" : "Champions";
    const d = base({ ti }, { champions: { team: teamInfo(t), title, silver: !!silver, result: silver ? c.secondResult : c.result, season: T.t.name.includes(year) ? "" : year } });
    d.urls.teams = [logoOf(t)];
    // The captain lifts the trophy in the Captain look.
    const caps = await captainPhotos([t.id]).catch(() => new Map());
    d.urls.caps = [caps.get(t.id) || ""];
    return { kind: "champions", data: d, title: `${t.short_name}, ${title.toLowerCase()}` };
  }

  // Tournament awards: player of the tournament (MVP points), best batter (runs), best bowler (wickets).
  const AWARDS = {
    mvp: { title: "Player of the tournament", k1: "PLAYER OF THE", k2: "TOURNAMENT", pick: (T) => St.tournamentMvp(T.matches)[0],
      // The headline is their runs, their wickets, or both; the MVP points move to the stats.
      card: (x) => {
        const badges = [x.runs || !x.wickets ? [String(x.runs), "RUNS"] : null, x.wickets ? [String(x.wickets), x.wickets === 1 ? "WICKET" : "WICKETS"] : null].filter(Boolean);
        return { badge: badges[0][0], badgeLabel: badges[0][1], badges, line: `${x.played} match${x.played === 1 ? "" : "es"}`,
          stats: [[String(x.pts), "", "MVP pts"], [String(x.played), "", x.played === 1 ? "Match" : "Matches"], [x.balls ? ((x.runs * 100) / x.balls).toFixed(0) : "–", "", "Strike rate"]] };
      } },
    bat: { title: "Best batter", k1: "BEST", k2: "BATTER", big: "MOST RUNS", pick: (T) => St.leaders(T.matches).runs[0],
      card: (x) => ({ badge: String(x.runs), badgeLabel: "RUNS", line: `${x.inns} innings`,
        stats: [[x.sr.toFixed(1), "", "Strike rate"], [`${x.best}${x.bestOut ? "" : "*"}`, "", "Best"], [String(x.sixes), "", x.sixes === 1 ? "Six" : "Sixes"]] }) },
    bowl: { title: "Best bowler", k1: "BEST", k2: "BOWLER", big: "WICKETS", pick: (T) => St.leaders(T.matches).wickets[0],
      card: (x) => ({ badge: String(x.wickets), badgeLabel: x.wickets === 1 ? "WICKET" : "WICKETS", line: `${x.inns} match${x.inns === 1 ? "" : "es"}`,
        stats: [[x.econ.toFixed(2), "", "Economy"], [`${x.bestW}/${x.bestR}`, "", "Best"], [x.overs, "", "Overs"]] }) },
  };

  async function awardCard(T, k) {
    const A = AWARDS[k], x = A.pick(T);
    if (!x || (k === "bowl" && !x.wickets)) { ui.toast("No numbers yet for this award."); return null; }
    const t = lg.teamById(x.teamId), ti = tournamentInfo(T.t), more = await playerExtras(x.id);
    const c = A.card(x);
    const d = base({ ti }, {
      matchLabel: "Tournament awards",
      player: { name: x.name, initials: initialsOf(x.name), team: t.name, teamShort: t.short_name, c1: t.primary_color, c2: t.secondary_color, no: more.no },
      award: Object.assign({ title: A.title, k1: A.k1, k2: A.k2, big: A.big }, c, { line: `${t.name} · ${c.line}` }),
    });
    d.urls.player = more.photo; d.urls.teams = [logoOf(t)];
    return { kind: "award", data: d, title: `${A.title}: ${x.name}` };
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
      items.push({ label: "Result", sub: s.result.text, make: () => resultCard(rec) });
    }
    return items.concat(performanceItems(rec));
  }

  ui.screens.cards = () => {
    const list = V.list || { title: "Cards", items: [] };
    return `<header class="bar"><button class="icon-btn" data-act="cards-back" aria-label="Back">←</button><h1>${esc(list.title)}</h1></header>
      <section class="wrap stack">${list.items.length ? `<ul class="t-list">${list.items.map((it, i) => `<li><button class="t-row" data-act="card-make" data-i="${i}">
        <span class="card-kind">${esc(it.icon || "★")}</span><span class="t-text"><b>${esc(it.label)}</b><small>${esc(it.sub || "")}</small></span><span class="chev" aria-hidden="true">›</span></button></li>`).join("")}</ul>`
        : `<p class="muted">No cards yet. Every player gets batting and bowling cards once they bat or bowl, milestones show up as they happen, and the result card when the match ends.</p>`}</section>`;
  };

  function openList(title, items, back) {
    V.list = { title, items, back };
    ui.go("cards");
  }

  // Tournament Cards tab: tournament-end cards, match days and groups, versus cards, standings, leaders, squads, then each match's cards.
  function tab(T) {
    const upcoming = T.matches.filter((m) => m.status === "scheduled" || m.status === "live");
    const played = T.matches.filter((m) => m.status === "done" || m.status === "live").reverse();
    const groups = [...new Set(T.teams.map((t) => t.group || ""))].sort();
    const row = (act, attrs, icon, label, sub) => `<li><button class="t-row" data-act="${act}" ${attrs}><span class="card-kind">${icon}</span><span class="t-text"><b>${esc(label)}</b><small>${esc(sub)}</small></span><span class="chev" aria-hidden="true">›</span></button></li>`;
    const vsName = (m) => { const a = lg.teamById(m.team1_id), b = lg.teamById(m.team2_id); return `${a.short_name} v ${b.short_name}`; };
    // Match days still to come first, then finished days, latest first.
    const days = matchDays(T).map((p, i) => Object.assign(p, { i }));
    const schedule = days.filter((p) => !p.done).concat(days.filter((p) => p.done).reverse()).map((p) => row("card-schedule", `data-i="${p.i}"`, "▦",
      `${p.done ? "Results" : "Match day"}, ${dayText(p.when)}${p.of > 1 ? ` (${p.n + 1}/${p.of})` : ""}`, `${p.page.length} match${p.page.length === 1 ? "" : "es"}`)).join("")
      + (groupNames(T).length > 1 ? groupPages(T).map((names, i, all) => row("card-groups", `data-p="${i}"`, "▥", `Groups${all.length > 1 ? ` (${i + 1}/${all.length})` : ""}`, `Groups ${names[0]}${names.length > 1 ? `–${names[names.length - 1]}` : ""}, ${T.teams.length} teams`)).join("")
        + groupNames(T).map((g) => row("card-groups", `data-g="${esc(g)}"`, "▥", `Group ${g}`, `${T.teams.filter((t) => t.group === g).length} teams, with captains`)).join("") : "");
    const vs = upcoming.map((m) => row("card-vs", `data-id="${m.id}"`, "VS", vsName(m), whenText(m.starts_at))).join("")
      + upcoming.filter((m) => m.lineups).map((m) => row("card-lineup", `data-id="${m.id}"`, "XI", `Playing XIs, ${vsName(m)}`, "Line-ups and toss")).join("");
    const tables = T.teams.length >= 2 ? groups.map((g) => row("card-table", `data-g="${esc(g)}"`, "▤", g ? `Points table, group ${g}` : "Points table", "Current standings")).join("") : "";
    const hasDone = T.matches.some((m) => m.status === "done");
    const leaders = hasDone ? Object.entries(LEADERS).map(([k, K]) => row("card-leaders", `data-k="${k}"`, "№1", K.title, "Top five, with the leader's photo")).join("") : "";
    const squads = T.teams.map((t) => row("card-squad", `data-id="${t.id}"`, "👥", `${t.name} squad`, `${t.count || 0} player${t.count === 1 ? "" : "s"}`)).join("");
    const champ = champion(T);
    const champs = champ ? row("card-champions", "", "🏆", champ.series ? "Series winners" : "Champions", lg.teamById(champ.id).name)
      + (champ.second ? row("card-champions", `data-silver="1"`, "🥈", "Runners-up", lg.teamById(champ.second).name) : "")
      + Object.entries(AWARDS).map(([k, A]) => row("card-award", `data-k="${k}"`, "★", A.title, "With the player's photo")).join("") : "";
    const results = played.map((m) => row("card-match", `data-id="${m.id}"`, m.status === "live" ? "●" : "★", vsName(m), m.status === "live" ? "Live: line-ups, milestones, innings break" : m.result_text || "Result and milestones")).join("");
    const section = (title, body, empty) => `<h2 class="eyebrow">${title}</h2>${body ? `<ul class="t-list">${body}</ul>` : `<p class="muted">${empty}</p>`}`;
    return (champs ? section("Tournament end", champs, "") : "")
      + section("Match days", schedule, "Add fixtures to make match day cards.")
      + section("Versus and playing XIs", vs, "Coming fixtures show up here.")
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
    const card = await resultCard(rec);
    if (card) show(card, "tour"); else openList("Cards", matchCards(rec), "tour");
  }

  // ---------- Preview and share ----------

  async function show(card, back) {
    document.getElementById("toast").hidden = true;
    V.card = Object.assign({ size: "post", back, loading: true, caption: C.caption(card.kind, card.data), style: styleFor(card.kind) }, card);
    ui.go("cardview");
    await draw();
  }

  const styleFor = (kind) => (C.stylesFor(kind).some(([k]) => k === V.style) ? V.style : C.stylesFor(kind)[0][0]);

  async function draw() {
    const c = V.card;
    c.loading = true; ui.render();
    try {
      c.canvas = await C.render(c.kind, c.data, c.size, c.style);
      c.preview = c.canvas.toDataURL("image/jpeg", 0.85);
      c.error = "";
    } catch (e) { c.error = "The card couldn't be drawn. " + ((e && e.message) || ""); }
    c.loading = false;
    if (ui.view().screen === "cardview") ui.render();
  }

  // Cards with a player photo: upload another one for this card, or go back to the profile photo.
  const HAS_PHOTO = new Set(["milestone", "potm", "award", "leaders", "champions"]);
  function photoBox(c) {
    if (!HAS_PHOTO.has(c.kind)) return "";
    const custom = c.profilePhoto !== undefined;
    // Champions and runners-up take a photo of the whole team, shown in the Team photo look.
    if (c.kind === "champions") return `<div class="card stack-s"><span class="eyebrow">Team photo</span>
      <p class="muted small">${custom ? "Using your team photo in the Team photo look." : "Add a photo of the whole team. It fills the top of the card in the Team photo look."} A wide photo works best.</p>
      <div class="chips"><label class="chip file-btn">${custom ? "Upload another" : "Upload team photo"}<input type="file" accept="image/*" data-card-photo="1" hidden></label>
      ${custom ? `<button class="chip" data-act="card-photo-reset">Remove photo</button>` : ""}</div></div>`;
    return `<div class="card stack-s"><span class="eyebrow">Player photo</span>
      <p class="muted small">${custom ? "Using the photo you uploaded, for this card only." : c.data.urls.player ? "From the player's profile." : "No profile photo yet, so the card shows a silhouette."} A PNG with no background looks best.</p>
      <div class="chips"><label class="chip file-btn">${custom ? "Upload another" : "Upload photo"}<input type="file" accept="image/*" data-card-photo="1" hidden></label>
      ${custom ? `<button class="chip" data-act="card-photo-reset">Use profile photo</button>` : ""}</div></div>`;
  }

  // Sponsors on the card: the tournament's own, plus logos added here (kept on this phone). None means no sponsor section.
  function sponsorBox(c) {
    const list = c.data.sponsors || [];
    const item = (sp, i) => `<span class="chip sponsor-chip">${sp.url ? `<img src="${esc(sp.url)}" alt="">` : ""}${esc(sp.name || (sp.from === "tour" ? "Tournament sponsor" : `Sponsor ${i + 1}`))}
      <button class="chip-x" data-act="card-sponsor-remove" data-i="${i}" aria-label="Remove sponsor">✕</button></span>`;
    return `<div class="card stack-s"><span class="eyebrow">Sponsors</span>
      <p class="muted small">${list.length ? "Shown along the bottom of the card." : "No sponsors, so the card has no sponsor section."} Logos added here stay on this phone for this tournament's cards.</p>
      <div class="chips">${list.map(item).join("")}${list.length < 4 ? `<label class="chip file-btn">+ Add sponsor logo<input type="file" accept="image/*" data-card-sponsor="1" hidden></label>` : ""}</div></div>`;
  }

  ui.screens.cardview = () => {
    const c = V.card;
    const chip = (v, label) => `<button class="chip ${c.size === v ? "on" : ""}" data-act="card-size" data-v="${v}">${label}</button>`;
    const look = ([v, label]) => `<button class="chip ${c.style === v ? "on" : ""}" data-act="card-style" data-v="${v}">${label}</button>`;
    return `<header class="bar"><button class="icon-btn" data-act="cardview-back" aria-label="Back">←</button><h1>${esc(c.title || "Card")}</h1></header>
      <section class="wrap stack">
        <div class="chips" role="group" aria-label="Look">${C.stylesFor(c.kind).map(look).join("")}</div>
        <div class="chips" role="group" aria-label="Size">${chip("post", "Post 4:5")}${chip("story", "Story 9:16")}</div>
        <div class="card-preview ${c.size}">${c.loading ? `<p class="muted">Drawing…</p>` : c.error ? `<p class="error">${esc(c.error)}</p>` : `<img src="${c.preview}" alt="${esc(c.title || "Card")} preview">`}</div>
        ${photoBox(c)}${sponsorBox(c)}
        <div class="row-2"><button class="btn btn-primary btn-big" data-act="card-share" ${c.loading ? "disabled" : ""}>Share</button><button class="btn btn-big" data-act="card-save" ${c.loading ? "disabled" : ""}>Save image</button></div>
        <label class="field"><span>Caption</span><textarea id="card-caption" rows="6">${esc(c.caption)}</textarea></label>
        <button class="btn" data-act="card-copy">Copy caption</button>
      </section>`;
  };

  const blobOf = (canvas) => new Promise((r) => canvas.toBlob(r, "image/png"));
  const fileName = () => `${(V.card.title || "card").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}-${V.card.style.toLowerCase()}-${V.card.size}.png`;
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
    "card-vs"(d) { const m = L.tour.matches.find((x) => x.id === d.id); if (m) versusCard(L.tour, m).then((c) => show(c, "tour")); },
    "card-table"(d) { tableCard(L.tour, d.g || "").then((c) => show(c, "tour")); },
    "card-schedule"(d) { const p = matchDays(L.tour)[+d.i]; if (p) scheduleCard(L.tour, p).then((c) => show(c, "tour")); },
    "card-groups"(d) { groupsCard(L.tour, +d.p || 0, d.g || "").then((c) => show(c, "tour")); },
    async "card-award"(d) { ui.toast("Making the card…"); const card = await awardCard(L.tour, d.k); if (card) show(card, "tour"); },
    async "card-lineup"(d) { const rec = await loadMatch(L.tour.matches.find((x) => x.id === d.id)); if (rec) show(await lineupCard(rec), "tour"); },
    async "card-squad"(d) { ui.toast("Loading squad…"); const card = await squadCard(L.tour, d.id); if (card) show(card, "tour"); },
    async "card-leaders"(d) { const card = await leadersCard(L.tour, d.k); if (card) show(card, "tour"); },
    async "card-champions"(d) { const card = await championsCard(L.tour, d.silver === "1"); if (card) show(card, "tour"); },
    async "card-match"(d) {
      const m = L.tour.matches.find((x) => x.id === d.id);
      const rec = m && await loadMatch(m);
      if (rec) openList(`${rec.match.teams[0].short} v ${rec.match.teams[1].short} cards`, matchCards(rec), "tour");
    },
    "card-style"(d) { if (V.card.style !== d.v) { V.card.caption = currentCaption(); V.card.style = V.style = d.v; draw(); } },
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
    "card-photo-reset"() { const c = V.card; c.caption = currentCaption(); c.data.urls.player = c.profilePhoto; delete c.profilePhoto; draw(); },
    "card-sponsor-remove"(d) {
      const c = V.card, sp = c.data.sponsors[+d.i];
      if (!sp) return;
      c.caption = currentCaption();
      c.data.sponsors.splice(+d.i, 1);
      // A logo added on this phone is forgotten; the tournament's own sponsor only leaves this card.
      if (sp.from === "device") saveSponsors(c.data.tournamentId, savedSponsors(c.data.tournamentId).filter((x) => x.id !== sp.id));
      draw();
    },
  });

  document.addEventListener("change", async (ev) => {
    const t = ev.target, c = V.card, file = t.files && t.files[0];
    if (!c || !file || !(t.dataset.cardPhoto || t.dataset.cardSponsor)) return;
    c.caption = currentCaption();
    try {
      if (t.dataset.cardPhoto) {
        const out = await lg.shrink(file, c.kind === "champions" ? 2000 : 1400);
        if (c.profilePhoto === undefined) c.profilePhoto = c.data.urls.player || "";
        c.data.urls.player = out.url;
        if (c.kind === "champions") c.style = "P";
      } else {
        const out = await lg.shrink(file, 400), sp = { id: String(Date.now()), url: out.canvas.toDataURL("image/png") };
        if (!saveSponsors(c.data.tournamentId, savedSponsors(c.data.tournamentId).concat(sp))) ui.toast("Added to this card only: this phone has no room to keep it.");
        c.data.sponsors.push(Object.assign({ name: "", from: "device" }, sp));
      }
    } catch (e) { ui.toast("That image couldn't be opened."); return; }
    draw();
  });

  // A "Cards" button under every scorecard, before the change log.
  const prevExtra = ui.cardExtra;
  ui.cardExtra = (rec) => `<button class="btn btn-primary" data-act="cards-match">Cards for this match</button>` + prevExtra(rec);

  CSA.studio = { tab, show, matchCards, openAlert };
})();
