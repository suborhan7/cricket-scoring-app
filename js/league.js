// Accounts, tournaments, teams, fixtures and syncing scored balls to Supabase.
// Builds on the screens in app.js through CSA.ui. Quick matches keep working with no account.
(function () {
  const ui = CSA.ui, E = CSA.engine, S = CSA.store, cfg = CSA.config || {};
  const esc = ui.esc;
  const sb = window.supabase && cfg.supabaseUrl ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey) : null;
  if (!sb) return;

  const L = {
    user: null,
    mine: null, mineLoading: false, mineError: "",
    tour: null,      // the open tournament: { id, t, teams, matches, roles, loading, error }
    forms: {},       // form state by screen, kept as people type (see the input listener)
    badge: {},       // sync state per match id
  };

  const publicUrl = (bucket, path) => (path ? `${cfg.supabaseUrl}/storage/v1/object/public/${bucket}/${path}` : "");
  const errText = (e) => (e && e.message) || "Something went wrong. Check your connection and try again.";
  const onScreen = (...names) => names.includes(ui.view().screen);
  const rerender = (...names) => { if (onScreen(...names)) ui.render(); };
  const displayName = () => (L.user && ((L.user.user_metadata && L.user.user_metadata.full_name) || L.user.email)) || "";

  function bar(title, back, extra) {
    return `<header class="bar"><button class="icon-btn" data-act="${back || "home"}" ${extra || ""} aria-label="Back">←</button><h1>${title}</h1></header>`;
  }

  function badge(t, size) {
    const style = `--c1:${t.primary_color || "#0F7A45"};--c2:${t.secondary_color || "#0E1A14"}`;
    const initials = esc((t.short_name || ui.shortName(t.name || "?")).slice(0, 4));
    // With no signal the logo can't load, so it falls back to the coloured initials.
    return t.logo_path
      ? `<img class="logo logo-${size || "s"}" src="${esc(publicUrl("logos", t.logo_path))}" alt="" loading="lazy" data-i="${initials}" data-s="${style}"
          onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:this.className+' logo-initials',textContent:this.dataset.i,style:this.dataset.s}))">`
      : `<span class="logo logo-${size || "s"} logo-initials" style="${style}">${initials}</span>`;
  }

  // ---------- Accounts ----------

  function setUser(u) {
    const changed = (u && u.id) !== (L.user && L.user.id);
    L.user = u || null;
    if (!changed) return;
    L.mine = null;
    if (L.user) { loadMine(); syncPending(); } else ui.render();
  }
  sb.auth.getSession().then(({ data }) => setUser(data.session && data.session.user));
  sb.auth.onAuthStateChange((_e, session) => setUser(session && session.user));

  async function loadMine() {
    L.mineLoading = true; rerender("home");
    const { data, error } = await sb.from("tournament_members").select("role, tournaments(*)").eq("user_id", L.user.id);
    L.mineLoading = false;
    if (error) L.mineError = errText(error);
    else {
      const byId = new Map();
      for (const row of data) {
        if (!row.tournaments) continue;
        const t = byId.get(row.tournaments.id) || Object.assign({ roles: [] }, row.tournaments);
        t.roles.push(row.role); byId.set(t.id, t);
      }
      L.mine = [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
      L.mineError = "";
    }
    rerender("home");
  }

  ui.homeTop = () => {
    if (!L.user) {
      return `<div class="card promo stack-s">
        <h2 class="promo-title">Run a tournament</h2>
        <p class="muted">Create a tournament or series, add teams with logos, and score matches everyone can follow live.</p>
        <button class="btn btn-primary btn-big" data-act="account">Sign in or create account</button></div>`;
    }
    const roleText = (r) => (r.includes("organiser") ? "Organiser" : r.includes("scorer") ? "Scorer" : "Media");
    const rows = (L.mine || []).map((t) => `<li><button class="t-row" data-act="t-open" data-id="${t.id}">${badge(t)}
        <span class="t-text"><b>${esc(t.name)}</b><small>${t.kind === "series" ? "Series" : "Tournament"} · ${t.overs_per_side} overs · ${roleText(t.roles)}</small></span></button></li>`).join("");
    const body = L.mine == null ? `<p class="muted">${L.mineLoading ? "Loading your tournaments…" : esc(L.mineError)}</p>`
      : rows ? `<ul class="t-list">${rows}</ul>` : `<p class="muted">No tournaments yet. Create one, or ask an organiser to add you as a scorer.</p>`;
    return `<div class="stack-s">
      <div class="row-between"><h2 class="eyebrow">Your tournaments</h2><button class="link-btn" data-act="account">${esc(displayName())}</button></div>
      ${body}
      <button class="btn btn-primary btn-big" data-act="t-new">New tournament or series</button></div>`;
  };

  ui.screens.account = () => {
    if (L.user) {
      return bar("Account") + `<section class="wrap stack">
        <p>Signed in as <b>${esc(L.user.email)}</b>.</p>
        <button class="btn" data-act="sign-out">Sign out</button></section>`;
    }
    const f = form("account", { mode: "in" }), up = f.mode === "up";
    return bar(up ? "Create account" : "Sign in") + `<section class="wrap stack">
      <div class="chips"><button class="chip ${up ? "" : "on"}" data-act="auth-mode" data-m="in">Sign in</button><button class="chip ${up ? "on" : ""}" data-act="auth-mode" data-m="up">Create account</button></div>
      <form class="card stack-s" data-form="auth">
        ${up ? field("Your name", `<input id="auth-name" data-f="account.name" value="${esc(f.name || "")}" autocomplete="name">`) : ""}
        ${field("Email", `<input id="auth-email" data-f="account.email" type="email" value="${esc(f.email || "")}" autocomplete="email" required>`)}
        ${field("Password", `<input id="auth-pass" data-f="account.pass" type="password" minlength="6" autocomplete="${up ? "new-password" : "current-password"}" required>`)}
        ${f.note ? `<p class="note">${esc(f.note)}</p>` : ""}${f.error ? `<p class="error">${esc(f.error)}</p>` : ""}
        <button class="btn btn-primary btn-big" type="submit" ${f.busy ? "disabled" : ""}>${f.busy ? "Please wait…" : up ? "Create account" : "Sign in"}</button>
      </form></section>`;
  };

  async function submitAuth() {
    const f = form("account"), up = f.mode === "up";
    f.email = (document.getElementById("auth-email") || {}).value || f.email;
    f.pass = (document.getElementById("auth-pass") || {}).value || f.pass;
    if (!f.email || !f.pass) { f.error = "Enter your email and a password."; return ui.render(); }
    f.busy = true; f.error = ""; f.note = ""; ui.render();
    const res = up
      ? await sb.auth.signUp({ email: f.email.trim(), password: f.pass, options: { data: { full_name: (f.name || "").trim() } } })
      : await sb.auth.signInWithPassword({ email: f.email.trim(), password: f.pass });
    f.busy = false; f.pass = "";
    if (res.error) { f.error = res.error.message; return ui.render(); }
    if (!res.data.session) { f.note = "Account created. Check your email for a confirmation link, then sign in."; f.mode = "in"; return ui.render(); }
    L.forms.account = null;
    ui.toast(up ? "Welcome! Your account is ready." : "Signed in");
    ui.go("home");
  }

  // ---------- Small form helpers ----------

  function form(key, defaults) { return L.forms[key] || (L.forms[key] = Object.assign({}, defaults || {})); }
  function field(label, control, hint) { return `<label class="field"><span>${label}</span>${control}${hint ? `<small class="muted">${hint}</small>` : ""}</label>`; }
  function status(f) { return `${f.error ? `<p class="error">${esc(f.error)}</p>` : ""}`; }
  function needUser() { if (L.user) return true; ui.go("account"); return false; }

  // Shrinks a picked image to at most `max` pixels on its longest side and returns a PNG.
  async function shrink(file, max) {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    return { blob, canvas: c, url: URL.createObjectURL(blob) };
  }

  // Two card colours from a logo: its most common strong colour, then one far from it on the colour wheel.
  function logoColors(canvas) {
    const { width: w, height: h } = canvas, d = canvas.getContext("2d").getImageData(0, 0, w, h).data;
    const bins = Array.from({ length: 12 }, () => ({ n: 0, r: 0, g: 0, b: 0 }));
    for (let i = 0; i < d.length; i += 16) {
      if (d[i + 3] < 200) continue;
      const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const l = (mx + mn) / 510, s = mx === mn ? 0 : (mx - mn) / (255 - Math.abs(mx + mn - 255));
      if (s < 0.3 || l < 0.12 || l > 0.9) continue;
      let hue = mx === r ? ((g - b) / (mx - mn)) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4;
      hue = (hue * 60 + 360) % 360;
      const bin = bins[Math.floor(hue / 30) % 12]; bin.n++; bin.r += r; bin.g += g; bin.b += b;
    }
    const hex = (x) => "#" + [x.r, x.g, x.b].map((v) => Math.round(v / x.n).toString(16).padStart(2, "0")).join("");
    const order = bins.map((x, i) => ({ x, i })).filter((o) => o.x.n > 0).sort((a, b) => b.x.n - a.x.n);
    if (!order.length) return null;
    const far = order.find((o) => Math.min(Math.abs(o.i - order[0].i), 12 - Math.abs(o.i - order[0].i)) >= 3);
    return [hex(order[0].x), far ? hex(far.x) : "#111111"];
  }

  async function uploadLogo(blob) {
    const path = `${L.user.id}/${crypto.randomUUID()}.png`;
    const { error } = await sb.storage.from("logos").upload(path, blob, { contentType: "image/png", upsert: false });
    if (error) throw error;
    return path;
  }

  async function pickLogo(input, f, formKey) {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const out = await shrink(file, 512);
      f.logoBlob = out.blob; f.logoUrl = out.url;
      const cols = logoColors(out.canvas);
      if (cols && !f.colorsEdited) { f.c1 = cols[0]; f.c2 = cols[1]; }
    } catch (e) { f.error = "That file couldn't be read as an image. Try a PNG or JPG."; }
    rerender(formKey);
  }

  function logoPicker(f, key) {
    return `<div class="logo-pick">
      ${f.logoUrl ? `<img class="logo logo-l" src="${f.logoUrl}" alt="Logo preview">` : `<span class="logo logo-l logo-empty">Logo</span>`}
      <label class="btn btn-small file-btn">${f.logoUrl ? "Change logo" : "Upload logo"}<input type="file" accept="image/*" data-logo="${key}" hidden></label>
    </div>`;
  }

  function colorPair(f, key) {
    return `<div class="colors">
      <label class="field"><span>Main colour</span><input type="color" data-f="${key}.c1" data-color="${key}" value="${f.c1}"></label>
      <label class="field"><span>Second colour</span><input type="color" data-f="${key}.c2" data-color="${key}" value="${f.c2}"></label>
    </div><small class="muted">Picked from the logo automatically. Change them if you like.</small>`;
  }

  // ---------- New tournament ----------

  ui.screens.tnew = () => {
    const f = form("tnew", { kind: "tournament", overs: 20, custom: false, maxBowler: 4, c1: "#0F7A45", c2: "#0E1A14" });
    const chips = ui.PRESETS.map(([l, n]) => `<button class="chip ${!f.custom && +f.overs === n ? "on" : ""}" data-act="tnew-overs" data-n="${n}">${l}</button>`).join("");
    return bar("New tournament") + `<section class="wrap stack">
      <div class="card stack-s">
        <div class="chips"><button class="chip ${f.kind === "tournament" ? "on" : ""}" data-act="tnew-kind" data-k="tournament">Tournament</button><button class="chip ${f.kind === "series" ? "on" : ""}" data-act="tnew-kind" data-k="series">Series (two teams)</button></div>
        ${field("Name", `<input id="tnew-name" data-f="tnew.name" value="${esc(f.name || "")}" placeholder="e.g. Winter Cup 2026" maxlength="80">`)}
        ${field("Short name", `<input id="tnew-short" data-f="tnew.short" value="${esc(f.short || "")}" placeholder="e.g. WC26" maxlength="12">`, "Shown on cards and score bars.")}
      </div>
      <div class="card stack-s"><span class="eyebrow">Logo and colours</span>${logoPicker(f, "tnew")}${colorPair(f, "tnew")}</div>
      <div class="card stack-s"><span class="eyebrow">Overs</span>
        <div class="chips">${chips}<button class="chip ${f.custom ? "on" : ""}" data-act="tnew-custom">Custom</button></div>
        ${f.custom ? field("Overs per side", `<input id="tnew-overs" data-f="tnew.overs" type="number" inputmode="numeric" min="1" max="100" value="${esc(f.overs)}">`) : ""}
        ${field("Max overs per bowler", `<input id="tnew-max" data-f="tnew.maxBowler" type="number" inputmode="numeric" min="1" value="${esc(f.maxBowler)}">`)}
      </div>
      ${status(f)}
      <button class="btn btn-primary btn-big" data-act="tnew-save" ${f.busy ? "disabled" : ""}>${f.busy ? "Creating…" : "Create"}</button>
    </section>`;
  };

  async function saveTournament() {
    const f = form("tnew");
    const name = (f.name || "").trim();
    if (name.length < 2) { f.error = "Give the tournament a name."; return ui.render(); }
    const overs = parseInt(f.overs, 10);
    if (!(overs >= 1 && overs <= 100)) { f.error = "Overs per side must be between 1 and 100."; return ui.render(); }
    f.busy = true; f.error = ""; ui.render();
    try {
      const logo_path = f.logoBlob ? await uploadLogo(f.logoBlob) : null;
      const { data, error } = await sb.from("tournaments").insert({
        name, short_name: (f.short || "").trim() || null, kind: f.kind, logo_path,
        primary_color: f.c1, secondary_color: f.c2, overs_per_side: overs,
        max_overs_per_bowler: Math.max(1, parseInt(f.maxBowler, 10) || Math.ceil(overs / 5)),
      }).select().single();
      if (error) throw error;
      L.forms.tnew = null;
      loadMine();
      ui.toast(`${data.name} created`);
      openTour(data.id);
    } catch (e) { f.busy = false; f.error = errText(e); ui.render(); }
  }

  // ---------- Tournament page ----------

  async function openTour(id, tab) {
    if (!L.tour || L.tour.id !== id) L.tour = { id, loading: true };
    ui.go("tour", { id, tab: tab || (L.tour.tab) || "matches" });
    L.tour.tab = ui.view().tab;
    const [t, teams, matches, roles] = await Promise.all([
      sb.from("tournaments").select("*").eq("id", id).single(),
      sb.from("tournament_teams").select("group_name, teams(id, name, short_name, logo_path, primary_color, secondary_color, team_players(count))").eq("tournament_id", id),
      sb.from("matches").select("*").eq("tournament_id", id).order("starts_at", { ascending: true, nullsFirst: false }).order("created_at"),
      L.user ? sb.from("tournament_members").select("role").eq("tournament_id", id).eq("user_id", L.user.id) : Promise.resolve({ data: [] }),
    ]);
    const err = t.error || teams.error || matches.error || roles.error;
    L.tour = {
      id, tab: L.tour.tab, loading: false, error: err ? errText(err) : "",
      t: t.data, matches: matches.data || [], roles: (roles.data || []).map((r) => r.role),
      teams: (teams.data || []).filter((r) => r.teams).map((r) => Object.assign({ group: r.group_name, count: (r.teams.team_players[0] || {}).count || 0 }, r.teams)),
    };
    rerender("tour");
  }

  const isOrganiser = () => L.tour && L.tour.roles.includes("organiser");
  const canScore = () => L.tour && (L.tour.roles.includes("organiser") || L.tour.roles.includes("scorer"));
  const teamById = (id) => (L.tour.teams || []).find((x) => x.id === id) || { name: "Team", short_name: "?" };

  ui.screens.tour = (view) => {
    const T = L.tour;
    if (!T || T.loading) return bar("Tournament") + `<p class="wrap muted">Loading…</p>`;
    if (T.error || !T.t) return bar("Tournament") + `<section class="wrap stack"><p class="error">${esc(T.error || "Tournament not found.")}</p><button class="btn" data-act="t-open" data-id="${T.id}">Try again</button></section>`;
    const t = T.t, tab = view.tab || "matches";
    const hero = `<div class="hero" style="--c1:${t.primary_color || "#0F7A45"};--c2:${t.secondary_color || "#0E1A14"}">
      ${badge(t, "l")}<div class="hero-text"><h2>${esc(t.name)}</h2><p>${t.kind === "series" ? "Series" : "Tournament"} · ${t.overs_per_side} overs a side · ${T.teams.length} team${T.teams.length === 1 ? "" : "s"}</p></div></div>`;
    const tabs = `<div class="tabs"><button class="tab ${tab === "matches" ? "on" : ""}" data-act="tour-tab" data-t="matches">Matches</button><button class="tab ${tab === "teams" ? "on" : ""}" data-act="tour-tab" data-t="teams">Teams</button></div>`;
    let body;
    if (tab === "teams") {
      const groups = {};
      for (const tm of T.teams) (groups[tm.group || ""] = groups[tm.group || ""] || []).push(tm);
      const names = Object.keys(groups).sort();
      body = (T.teams.length ? names.map((g) => `${g ? `<h3 class="eyebrow">Group ${esc(g)}</h3>` : ""}<ul class="t-list">${groups[g].map((tm) => `<li><div class="t-row">${badge(tm)}<span class="t-text"><b>${esc(tm.name)}</b><small>${tm.count} players</small></span></div></li>`).join("")}</ul>`).join("")
        : `<p class="muted">No teams yet.${isOrganiser() ? " Add the first one." : ""}</p>`)
        + (isOrganiser() ? `<button class="btn btn-primary" data-act="team-new">Add team</button>` : "");
    } else {
      const rows = T.matches.map((m) => {
        const a = teamById(m.team1_id), b = teamById(m.team2_id);
        const when = m.starts_at ? new Date(m.starts_at).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "Date not set";
        const pill = m.status === "live" ? `<span class="pill pill-live">LIVE</span>` : m.status === "done" ? `<span class="pill pill-done">${esc(m.result_text || "Result")}</span>` : `<span class="pill">${esc(when)}</span>`;
        return `<li><button class="t-row" data-act="m-open" data-id="${m.id}"><span class="vs">${badge(a)}<b>v</b>${badge(b)}</span>
          <span class="t-text"><b>${esc(a.short_name)} v ${esc(b.short_name)}</b><small>${esc([m.stage !== "group" ? m.stage : "", m.venue].filter(Boolean).join(" · ") || (m.match_no ? "Match " + m.match_no : ""))}</small>${pill}</span></button></li>`;
      }).join("");
      body = (rows ? `<ul class="t-list">${rows}</ul>` : `<p class="muted">No matches yet.${isOrganiser() ? (T.teams.length < 2 ? " Add at least two teams first." : " Add the first fixture.") : ""}</p>`)
        + (isOrganiser() && T.teams.length >= 2 ? `<button class="btn btn-primary" data-act="match-new">New match</button>` : "");
    }
    return bar(esc(t.short_name || t.name)) + hero + `<section class="wrap stack">${tabs}${body}</section>`;
  };

  // ---------- New team ----------

  ui.screens.teamnew = () => {
    const f = form("teamnew", { c1: "#0F7A45", c2: "#0E1A14" });
    const count = (f.players || "").split("\n").filter((x) => x.trim()).length;
    return bar("Add team", "t-open", `data-id="${L.tour.id}"`) + `<section class="wrap stack">
      <div class="card stack-s">
        ${field("Team name", `<input id="team-name" data-f="teamnew.name" value="${esc(f.name || "")}" maxlength="60">`)}
        ${field("Short name", `<input id="team-short" data-f="teamnew.short" value="${esc(f.short || "")}" maxlength="5" placeholder="${esc(ui.shortName(f.name || "Team"))}">`)}
        ${field("Group (optional)", `<input id="team-group" data-f="teamnew.group" value="${esc(f.group || "")}" maxlength="10" placeholder="e.g. A">`)}
      </div>
      <div class="card stack-s"><span class="eyebrow">Logo and colours</span>${logoPicker(f, "teamnew")}${colorPair(f, "teamnew")}</div>
      <div class="card stack-s">${field("Players, one per line", `<textarea id="team-players" data-f="teamnew.players" rows="8" placeholder="Captain first">${esc(f.players || "")}</textarea>`, `<span data-count>${count} players</span>. The first name is the captain.`)}</div>
      ${status(f)}
      <button class="btn btn-primary btn-big" data-act="team-save" ${f.busy ? "disabled" : ""}>${f.busy ? "Saving…" : "Add team"}</button>
    </section>`;
  };

  async function saveTeam() {
    const f = form("teamnew");
    const name = (f.name || "").trim();
    const players = (f.players || "").split("\n").map((x) => x.trim()).filter(Boolean);
    if (name.length < 2) { f.error = "Give the team a name."; return ui.render(); }
    if (players.length < 2) { f.error = "Add at least 2 players, one per line."; return ui.render(); }
    f.busy = true; f.error = ""; ui.render();
    try {
      const logo_path = f.logoBlob ? await uploadLogo(f.logoBlob) : null;
      const team = await sb.from("teams").insert({
        name, short_name: ((f.short || "").trim() || ui.shortName(name)).slice(0, 5).toUpperCase(), logo_path,
        primary_color: f.c1, secondary_color: f.c2,
      }).select().single();
      if (team.error) throw team.error;
      const made = await sb.from("players").insert(players.map((full_name) => ({ full_name }))).select("id, full_name");
      if (made.error) throw made.error;
      // Keep the typed order: it becomes the batting order offered when a match starts.
      const ids = players.map((p) => { const i = made.data.findIndex((x) => x.full_name === p); return made.data.splice(i, 1)[0].id; });
      const links = await sb.from("team_players").insert(ids.map((player_id) => ({ team_id: team.data.id, player_id })));
      if (links.error) throw links.error;
      await sb.from("teams").update({ captain_player_id: ids[0] }).eq("id", team.data.id);
      const joined = await sb.from("tournament_teams").insert({ tournament_id: L.tour.id, team_id: team.data.id, group_name: (f.group || "").trim() || null });
      if (joined.error) throw joined.error;
      L.forms.teamnew = null;
      ui.toast(`${name} added`);
      openTour(L.tour.id, "teams");
    } catch (e) { f.busy = false; f.error = errText(e); ui.render(); }
  }

  // ---------- New match ----------

  ui.screens.matchnew = () => {
    const T = L.tour, f = form("matchnew", { team1: T.teams[0].id, team2: T.teams[1].id, stage: T.t.kind === "series" ? "series" : "group" });
    const opts = (sel) => T.teams.map((tm) => `<option value="${tm.id}" ${tm.id === sel ? "selected" : ""}>${esc(tm.name)}</option>`).join("");
    const stages = [["group", "Group"], ["quarter", "Quarter-final"], ["semi", "Semi-final"], ["final", "Final"], ["series", "Series match"], ["other", "Other"]];
    return bar("New match", "t-open", `data-id="${T.id}"`) + `<section class="wrap stack"><div class="card stack-s">
      ${field("Team 1", `<select id="m-team1" data-f="matchnew.team1">${opts(f.team1)}</select>`)}
      ${field("Team 2", `<select id="m-team2" data-f="matchnew.team2">${opts(f.team2)}</select>`)}
      ${field("Stage", `<select id="m-stage" data-f="matchnew.stage">${stages.map(([v, l]) => `<option value="${v}" ${v === f.stage ? "selected" : ""}>${l}</option>`).join("")}</select>`)}
      ${field("Match number (optional)", `<input id="m-no" data-f="matchnew.no" type="number" inputmode="numeric" min="1" value="${esc(f.no || "")}">`)}
      ${field("Date and time (optional)", `<input id="m-when" data-f="matchnew.when" type="datetime-local" value="${esc(f.when || "")}">`)}
      ${field("Ground (optional)", `<input id="m-venue" data-f="matchnew.venue" value="${esc(f.venue || "")}" maxlength="80">`)}
      </div>${status(f)}
      <button class="btn btn-primary btn-big" data-act="match-save" ${f.busy ? "disabled" : ""}>${f.busy ? "Saving…" : "Add match"}</button></section>`;
  };

  async function saveMatch() {
    const f = form("matchnew");
    if (f.team1 === f.team2) { f.error = "Pick two different teams."; return ui.render(); }
    f.busy = true; f.error = ""; ui.render();
    const { error } = await sb.from("matches").insert({
      tournament_id: L.tour.id, team1_id: f.team1, team2_id: f.team2, stage: f.stage,
      match_no: parseInt(f.no, 10) || null, venue: (f.venue || "").trim() || null,
      starts_at: f.when ? new Date(f.when).toISOString() : null,
    });
    if (error) { f.busy = false; f.error = errText(error); return ui.render(); }
    L.forms.matchnew = null;
    ui.toast("Match added");
    openTour(L.tour.id, "matches");
  }

  // ---------- Start, score and watch a tournament match ----------

  function rulesOf(t) {
    return { oversPerSide: t.overs_per_side, ballsPerOver: t.balls_per_over || 6, maxOversPerBowler: t.max_overs_per_bowler || Math.ceil(t.overs_per_side / 5) };
  }

  async function openMatch(id) {
    const m = L.tour.matches.find((x) => x.id === id);
    if (!m) return;
    const local = S.get(m.id);
    if (local && canScore() && !local.readOnly) return ui.openMatch(local);
    if (m.status === "scheduled") {
      if (!canScore()) return ui.toast("This match hasn't started yet.");
      return startForm(m);
    }
    await watchMatch(m);
  }

  // Loads a match from the server: for fans to follow, or for a scorer picking it up on another phone.
  async function watchMatch(m, quiet) {
    if (!quiet) ui.toast("Loading match…");
    const ids = [].concat(...((m.lineups && m.lineups.teams) || []).map((x) => x.players));
    const [players, events] = await Promise.all([
      sb.from("players").select("id, full_name").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
      sb.from("match_events").select("seq, event").eq("match_id", m.id).order("seq"),
    ]);
    if (players.error || events.error) return ui.toast(errText(players.error || events.error));
    const names = new Map(players.data.map((p) => [p.id, p.full_name]));
    const rec = buildRec(m, m.lineups.teams.map((x) => x.players.map((pid) => names.get(pid) || "Player")));
    rec.events = events.data.map((r) => r.event);
    rec.synced = rec.events.map((e) => JSON.stringify(e));
    rec.cloudStatus = m.status;
    rec.readOnly = !canScore();
    if (!rec.readOnly) S.save(rec);
    ui.openMatch(rec);
  }

  function buildRec(m, playerNames) {
    const team = (id, i) => { const t = teamById(id); return { name: t.name, short: t.short_name, players: playerNames[i] }; };
    return {
      match: {
        id: m.id, createdAt: Date.now(), teams: [team(m.team1_id, 0), team(m.team2_id, 1)],
        battingFirst: m.batting_first || 0, toss: m.toss || { winner: 0, decision: "bat" }, rules: m.rules && m.rules.oversPerSide ? m.rules : rulesOf(L.tour.t),
        cloud: { matchId: m.id, tournamentId: m.tournament_id, teamIds: [m.team1_id, m.team2_id] },
      },
      events: [],
    };
  }

  async function startForm(m) {
    L.forms.mstart = { match: m, loading: true, toss: 0, decision: "bat" };
    ui.go("mstart");
    const { data, error } = await sb.from("team_players").select("team_id, joined_at, players(id, full_name)").in("team_id", [m.team1_id, m.team2_id]).order("joined_at");
    const f = L.forms.mstart;
    f.loading = false;
    if (error) f.error = errText(error);
    else {
      f.squads = [m.team1_id, m.team2_id].map((tid) => data.filter((r) => r.team_id === tid && r.players).map((r) => r.players));
      f.picked = f.squads.map((sq) => sq.map(() => true));
    }
    rerender("mstart");
  }

  ui.screens.mstart = () => {
    const f = L.forms.mstart, m = f.match, teams = [teamById(m.team1_id), teamById(m.team2_id)];
    const head = bar("Start match", "t-open", `data-id="${L.tour.id}"`);
    if (f.loading) return head + `<p class="wrap muted">Loading squads…</p>`;
    const squad = (i) => `<fieldset class="card stack-s"><legend class="eyebrow">${esc(teams[i].name)} playing</legend>
      ${f.squads[i].map((p, j) => `<label class="check"><input type="checkbox" data-pick="${i}-${j}" ${f.picked[i][j] ? "checked" : ""}> ${esc(p.full_name)}</label>`).join("") || `<p class="muted">No players in this team.</p>`}
      <small class="muted">${f.picked[i].filter(Boolean).length} picked</small></fieldset>`;
    return head + `<section class="wrap stack">
      ${squad(0)}${squad(1)}
      <fieldset class="card stack-s"><legend class="eyebrow">Toss</legend>
        <div class="chips">${teams.map((t, i) => `<button class="chip ${f.toss === i ? "on" : ""}" data-act="ms-toss" data-i="${i}">${esc(t.name)}</button>`).join("")}</div>
        <div class="chips"><button class="chip ${f.decision === "bat" ? "on" : ""}" data-act="ms-dec" data-d="bat">Chose to bat</button><button class="chip ${f.decision === "bowl" ? "on" : ""}" data-act="ms-dec" data-d="bowl">Chose to bowl</button></div>
      </fieldset>
      ${status(f)}
      <button class="btn btn-primary btn-big" data-act="ms-start" ${f.busy ? "disabled" : ""}>${f.busy ? "Starting…" : "Start scoring"}</button></section>`;
  };

  async function startMatch() {
    const f = L.forms.mstart, m = f.match;
    const lineups = f.squads.map((sq, i) => sq.filter((_, j) => f.picked[i][j]));
    if (lineups.some((x) => x.length < 2)) { f.error = "Each team needs at least 2 players."; return ui.render(); }
    const rules = rulesOf(L.tour.t);
    const battingFirst = f.decision === "bat" ? f.toss : 1 - f.toss;
    const toss = { winner: f.toss, decision: f.decision };
    f.busy = true; f.error = ""; ui.render();
    const upd = {
      status: "live", rules, toss, batting_first: battingFirst,
      lineups: { teams: [m.team1_id, m.team2_id].map((team_id, i) => ({ team_id, players: lineups[i].map((p) => p.id) })) },
    };
    const { error } = await sb.from("matches").update(upd).eq("id", m.id);
    if (error) { f.busy = false; f.error = errText(error); return ui.render(); }
    Object.assign(m, upd);
    const rec = buildRec(m, lineups.map((x) => x.map((p) => p.full_name)));
    rec.synced = []; rec.cloudStatus = "live";
    S.save(rec);
    L.forms.mstart = null;
    ui.openMatch(rec);
  }

  // ---------- Syncing balls ----------
  // Every ball is saved on the phone first (store.js). Here the changed events are sent to
  // Supabase in the background; with no signal they wait and go when the phone is back online.

  const timers = {};
  const BADGES = { saving: "Saving…", saved: "Synced", offline: "Offline · will sync", signin: "Sign in to sync" };

  ui.matchBadge = (rec) => {
    if (!rec.match.cloud) return "";
    if (rec.readOnly) return `<span class="sync sync-saved">${rec.cloudStatus === "done" ? "Final" : "Live"}</span>`;
    const state = L.badge[rec.match.id] || (pending(rec) ? "saving" : "saved");
    return `<span class="sync sync-${state}" id="sync-badge">${BADGES[state]}</span>`;
  };

  function setBadge(rec, state) {
    L.badge[rec.match.id] = state;
    const el = document.getElementById("sync-badge");
    if (el && ui.current() && ui.current().match.id === rec.match.id) { el.className = `sync sync-${state}`; el.textContent = BADGES[state]; }
  }

  const pending = (rec) => {
    const s = rec.synced || [];
    return s.length !== rec.events.length || rec.events.some((e, i) => s[i] !== JSON.stringify(e));
  };

  ui.changed = (rec) => {
    if (!rec.match.cloud || rec.readOnly) return;
    setBadge(rec, "saving");
    clearTimeout(timers[rec.match.id]);
    timers[rec.match.id] = setTimeout(() => syncRec(rec), 400);
  };

  async function syncRec(rec) {
    if (!L.user) return setBadge(rec, "signin");
    if (syncRec.busy) { clearTimeout(timers[rec.match.id]); timers[rec.match.id] = setTimeout(() => syncRec(rec), 600); return; }
    syncRec.busy = true;
    const id = rec.match.cloud.matchId, ev = rec.events.slice(), prev = rec.synced || [];
    try {
      if (prev.length > ev.length) {
        const { error } = await sb.from("match_events").delete().eq("match_id", id).gte("seq", ev.length);
        if (error) throw error;
      }
      const rows = [];
      ev.forEach((e, seq) => { if (prev[seq] !== JSON.stringify(e)) rows.push({ match_id: id, seq, event: e }); });
      if (rows.length) {
        const { error } = await sb.from("match_events").upsert(rows, { onConflict: "match_id,seq" });
        if (error) throw error;
      }
      const s = E.replay(rec.match, ev), status = s.result ? "done" : "live";
      if (status !== rec.cloudStatus) {
        const upd = { status, result_text: s.result ? s.result.text : null, winner_team_id: s.result && s.result.winner != null ? rec.match.cloud.teamIds[s.result.winner] : null };
        const { error } = await sb.from("matches").update(upd).eq("id", id);
        if (error) throw error;
        rec.cloudStatus = status;
        const m = L.tour && L.tour.matches && L.tour.matches.find((x) => x.id === id);
        if (m) Object.assign(m, upd);
      }
      rec.synced = ev.map((e) => JSON.stringify(e));
      const cur = S.get(rec.match.id);
      if (cur) { cur.synced = rec.synced; cur.cloudStatus = rec.cloudStatus; S.save(cur); }
      syncRec.busy = false;
      if (pending(rec)) ui.changed(rec); else setBadge(rec, "saved");
    } catch (e) {
      syncRec.busy = false;
      setBadge(rec, "offline");
    }
  }

  function syncPending() {
    for (const r of S.list()) if (r.match.cloud && !r.readOnly && pending(r)) syncRec(r);
  }
  window.addEventListener("online", syncPending);

  // ---------- Actions and inputs ----------

  Object.assign(ui.actions, {
    account() { ui.go("account"); },
    "auth-mode"(d) { const f = form("account"); f.mode = d.m; f.error = ""; f.note = ""; ui.render(); },
    async "sign-out"() { await sb.auth.signOut(); ui.toast("Signed out"); ui.go("home"); },
    "t-new"() { if (needUser()) ui.go("tnew"); },
    "tnew-kind"(d) { form("tnew").kind = d.k; ui.render(); },
    "tnew-overs"(d) { const f = form("tnew"); f.custom = false; f.overs = +d.n; f.maxBowler = Math.ceil(f.overs / 5); ui.render(); },
    "tnew-custom"() { form("tnew").custom = true; ui.render(); },
    "tnew-save": saveTournament,
    "t-open"(d) { openTour(d.id); },
    "tour-tab"(d) { L.tour.tab = d.t; ui.go("tour", { id: L.tour.id, tab: d.t }); },
    "team-new"() { L.forms.teamnew = null; ui.go("teamnew"); },
    "team-save": saveTeam,
    "match-new"() { L.forms.matchnew = null; ui.go("matchnew"); },
    "match-save": saveMatch,
    "m-open"(d) { openMatch(d.id); },
    "ms-toss"(d) { L.forms.mstart.toss = +d.i; ui.render(); },
    "ms-dec"(d) { L.forms.mstart.decision = d.d; ui.render(); },
    "ms-start": startMatch,
    "match-back"() {
      const rec = ui.current();
      if (rec && rec.match.cloud) openTour(rec.match.cloud.tournamentId, "matches");
      else ui.actions.home();
    },
    async "refresh-match"() {
      const rec = ui.current();
      if (!rec || !rec.match.cloud) return;
      const { data, error } = await sb.from("matches").select("*").eq("id", rec.match.cloud.matchId).single();
      if (error) return ui.toast(errText(error));
      await watchMatch(data, true);
    },
  });

  // Form fields write straight into their form's state, so re-rendering never loses typing.
  document.addEventListener("input", (ev) => {
    const key = ev.target.dataset.f;
    if (!key) return;
    const [name, prop] = key.split(".");
    form(name)[prop] = ev.target.value;
    if (ev.target.dataset.color) form(name).colorsEdited = true;
    if (prop === "players") {
      const c = document.querySelector("[data-count]");
      if (c) c.textContent = `${ev.target.value.split("\n").filter((x) => x.trim()).length} players`;
    }
  });
  document.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t.dataset.logo) pickLogo(t, form(t.dataset.logo), t.dataset.logo);
    if (t.dataset.pick && L.forms.mstart) {
      const [i, j] = t.dataset.pick.split("-").map(Number);
      L.forms.mstart.picked[i][j] = t.checked;
      ui.render();
    }
  });
  document.addEventListener("submit", (ev) => {
    if (ev.target.dataset.form === "auth") { ev.preventDefault(); submitAuth(); }
  });

  ui.render();
})();
