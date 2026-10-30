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
    me: undefined,   // the signed-in user's own player profile: undefined while loading, null if none yet
    myTeams: null,   // teams they created, captain or play for
  };

  const publicUrl = (bucket, path) => (path ? `${cfg.supabaseUrl}/storage/v1/object/public/${bucket}/${path}` : "");
  const errText = (e) => (e && e.message) || "Something went wrong. Check your connection and try again.";
  const onScreen = (...names) => names.includes(ui.view().screen);
  const rerender = (...names) => { if (onScreen(...names)) ui.render(); };
  const displayName = () => (L.user && ((L.user.user_metadata && L.user.user_metadata.full_name) || L.user.email)) || "";

  const SHARE_ICON = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>`;
  // Links like …/#/t/<id> and …/#/m/<id> open a tournament or a match straight away.
  const EDIT_ICON = `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
  const shareUrl = (kind, id) => `${location.origin}${location.pathname}#/${kind}/${id}`;

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

  // Opens the phone's share sheet, or copies the link where there is none.
  async function shareLink(title, text, url, copied) {
    try {
      if (navigator.share) return await navigator.share({ title, text, url });
      await navigator.clipboard.writeText(`${text} ${url}`);
      ui.toast(copied || "Link copied");
    } catch (e) { if (!e || e.name !== "AbortError") window.prompt("Copy this link", url); }
  }

  // ---------- Accounts ----------

  function setUser(u) {
    const changed = (u && u.id) !== (L.user && L.user.id);
    L.user = u || null;
    if (!changed) return;
    L.mine = null; L.me = undefined; L.myTeams = null;
    if (L.user) { loadMine(); loadMe(); syncPending(); } else ui.render();
  }
  sb.auth.getSession().then(({ data }) => { L.ready = true; setUser(data.session && data.session.user); openLink(); if (CSA.hub) CSA.hub.runPending(); });
  window.addEventListener("hashchange", openLink);
  sb.auth.onAuthStateChange((_e, session) => setUser(session && session.user));

  async function loadMine() {
    L.mineLoading = true; rerender("home", "tours");
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
    rerender("home", "tours");
  }

  // ---------- My player profile and my teams ----------

  const TEAM_COLS = "id, name, short_name, logo_path, primary_color, secondary_color, captain_player_id, created_by, team_players(count)";

  async function loadMe() {
    const uid = L.user && L.user.id;
    if (!uid) return;
    const { data, error } = await sb.from("players").select("*").eq("claimed_by", uid).maybeSingle();
    if (!L.user || L.user.id !== uid) return;
    L.me = error ? L.me || null : data;
    await loadMyTeams();
    if (CSA.hub) CSA.hub.meLoaded();
  }

  // Teams the user created, captains, or plays in. `manage` marks the ones they can run.
  async function loadMyTeams() {
    const uid = L.user && L.user.id, me = L.me;
    if (!uid) return;
    const none = Promise.resolve({ data: [] });
    const [own, cap, squad] = await Promise.all([
      sb.from("teams").select(TEAM_COLS).eq("created_by", uid),
      me ? sb.from("teams").select(TEAM_COLS).eq("captain_player_id", me.id) : none,
      me ? sb.from("team_players").select(`teams(${TEAM_COLS})`).eq("player_id", me.id) : none,
    ]);
    if (!L.user || L.user.id !== uid) return;
    const byId = new Map();
    for (const t of [].concat(own.data || [], cap.data || [], (squad.data || []).map((r) => r.teams).filter(Boolean))) {
      byId.set(t.id, Object.assign(t, {
        count: (t.team_players && t.team_players[0] ? t.team_players[0].count : 0),
        manage: t.created_by === uid || (!!me && t.captain_player_id === me.id),
        captain: !!me && t.captain_player_id === me.id,
      }));
    }
    L.myTeams = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
    rerender("home", "teams", "profile", "tour");
  }

  // ---------- Live and recent matches (everyone, signed in or not) ----------

  L.feed = null;
  async function loadFeed() {
    const cols = "id, tournament_id, team1_id, team2_id, status, result_text, winner_team_id, summary, stage, created_at, tournaments(name, short_name)";
    const q = (c) => sb.from("matches").select(c).in("status", ["live", "done"]).order("created_at", { ascending: false }).limit(12);
    // The live score column comes with migration 0014; without it the feed still loads.
    let { data, error } = await q(L.noLive ? cols : cols + ", live");
    if (error && /live/.test(error.message || "")) { L.noLive = true; ({ data, error } = await q(cols)); }
    if (error) return;
    const ids = [...new Set([].concat(...data.map((m) => [m.team1_id, m.team2_id])))];
    const teams = ids.length ? (await sb.from("teams").select("id, name, short_name, logo_path, primary_color, secondary_color").in("id", ids)).data || [] : [];
    const byId = new Map(teams.map((t) => [t.id, t]));
    L.feed = data.map((m) => Object.assign(m, { a: byId.get(m.team1_id) || { short_name: "?" }, b: byId.get(m.team2_id) || { short_name: "?" } }))
      .sort((x, y) => (y.status === "live") - (x.status === "live") || String(y.created_at).localeCompare(String(x.created_at)));
    rerender("home");
  }
  loadFeed();
  setInterval(() => { if (onScreen("home") && document.visibilityState === "visible") loadFeed(); }, 20 * 1000);

  function feedHtml() {
    if (!L.feed || !L.feed.length) return "";
    // A live match shows its live score (runs-wickets and overs); a finished one its summary.
    const score = (m, i) => {
      const lv = m.live && m.live.inn && m.live.inn.find((x) => x.team === i);
      if (lv && (m.status === "live" || !m.summary)) return `${lv.r}/${lv.w}${m.status === "live" ? ` <small>(${E.oversText(lv.b, m.live.bpo || 6)})</small>` : ""}`;
      const inn = m.summary && m.summary.innings && m.summary.innings.find((x) => x.team === i);
      return inn ? `${inn.runs}/${inn.wickets}` : "";
    };
    const rows = L.feed.slice(0, 8).map((m) => `<li><button class="feed-row" data-act="feed-open" data-id="${m.id}" data-t="${m.tournament_id}">
        <span class="feed-top"><small>${esc((m.tournaments && (m.tournaments.short_name || m.tournaments.name)) || "")}</small>${m.status === "live" ? `<span class="pill pill-live">LIVE</span>` : ""}</span>
        <span class="feed-team ${m.winner_team_id && m.winner_team_id === m.team1_id ? "won" : ""}">${badge(m.a)}<b>${esc(m.a.short_name)}</b><span>${score(m, 0)}</span></span>
        <span class="feed-team ${m.winner_team_id && m.winner_team_id === m.team2_id ? "won" : ""}">${badge(m.b)}<b>${esc(m.b.short_name)}</b><span>${score(m, 1)}</span></span>
        <small class="feed-result">${esc(m.status === "live" ? (m.live && m.live.line) || "In progress" : m.result_text || "")}</small></button></li>`).join("");
    return `<div class="stack-s"><h2 class="eyebrow">Live and recent</h2><ul class="feed">${rows}</ul></div>`;
  }

  ui.screens.account = () => {
    if (L.user) {
      return bar("Account") + `<section class="wrap stack">
        <p>Signed in as <b>${esc(L.user.email)}</b>.</p>
        <button class="btn" data-act="sign-out">Sign out</button>
        <a class="link-btn" href="privacy.html" target="_blank" rel="noopener">Privacy policy</a>
        ${deleteBox()}</section>`;
    }
    const f = form("account", { mode: "in" }), up = f.mode === "up";
    return bar(up ? "Create account" : "Sign in") + `<section class="wrap stack">
      <div class="chips"><button class="chip ${up ? "" : "on"}" data-act="auth-mode" data-m="in">Sign in</button><button class="chip ${up ? "on" : ""}" data-act="auth-mode" data-m="up">Create account</button></div>
      ${googleOk() ? `<button class="btn btn-big btn-google" data-act="auth-google"><svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>Continue with Google</button>
      <p class="or"><span>or with email</span></p>` : ""}
      <form class="card stack-s" data-form="auth">
        ${up ? field("Your name", `<input id="auth-name" data-f="account.name" value="${esc(f.name || "")}" autocomplete="name">`) : ""}
        ${field("Email", `<input id="auth-email" data-f="account.email" type="email" value="${esc(f.email || "")}" autocomplete="email" required>`)}
        ${field("Password", `<input id="auth-pass" data-f="account.pass" type="password" minlength="6" autocomplete="${up ? "new-password" : "current-password"}" required>`)}
        ${f.note ? `<p class="note">${esc(f.note)}</p>` : ""}${f.error ? `<p class="error">${esc(f.error)}</p>` : ""}
        <button class="btn btn-primary btn-big" type="submit" ${f.busy ? "disabled" : ""}>${f.busy ? "Please wait…" : up ? "Create account" : "Sign in"}</button>
      </form></section>`;
  };

  function deleteBox() {
    const f = form("delacct", {});
    if (!f.open) return `<button class="link-btn danger-link" data-act="acct-del-open">Delete my account</button>`;
    return `<div class="card stack-s danger-card">
      <b>Delete your account?</b>
      <p class="muted">This removes your login, your roles and your alerts. Tournaments where you are the only organiser are deleted with all their matches. Tournaments shared with other organisers stay. This can't be undone.</p>
      ${field("Type DELETE to confirm", `<input id="del-confirm" data-f="delacct.text" value="${esc(f.text || "")}" autocomplete="off" autocapitalize="characters">`)}
      ${f.error ? `<p class="error">${esc(f.error)}</p>` : ""}
      <div class="row-between"><button class="btn" data-act="acct-del-cancel">Cancel</button>
      <button class="btn btn-danger" data-act="acct-del" ${f.busy ? "disabled" : ""}>${f.busy ? "Deleting…" : "Delete account"}</button></div></div>`;
  }

  // Google sign-in runs in the browser only: Google blocks it inside app web views.
  const googleOk = () => cfg.googleLogin && !(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

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
    ui.toast(up ? "Welcome! Set up your player profile." : "Signed in");
    // A new account goes straight to setting up the player profile.
    ui.lastTab = up ? "profile" : "home";
    ui.go(ui.lastTab);
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

  // Files go in a folder named after the uploader (the storage rules require it).
  async function upload(bucket, blob) {
    const path = `${L.user.id}/${crypto.randomUUID()}.png`;
    const { error } = await sb.storage.from(bucket).upload(path, blob, { contentType: "image/png", upsert: false });
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

  // Players typed or pasted from a spreadsheet, one per line: name, then optionally
  // role, batting, bowling and jersey number, split by commas or tabs.
  const ROLE_WORDS = [[/keep|wk/i, "keeper"], [/all/i, "allrounder"], [/bowl/i, "bowler"], [/bat/i, "batter"]];
  function parsePlayers(text) {
    const out = [];
    for (const line of String(text || "").split(/\r?\n/)) {
      const cells = line.split(/\t|,|;/).map((c) => c.trim().replace(/^"|"$/g, ""));
      const name = cells[0];
      if (!name || name.length < 2 || /^(name|player|full name)$/i.test(name)) continue; // skips a header row
      const p = { full_name: name.slice(0, 60) };
      const roleCell = cells[1] || "";
      const role = ROLE_WORDS.find(([re]) => re.test(roleCell));
      if (role) p.role = role[1];
      if (/^l/i.test(cells[2] || "")) p.batting_style = "left"; else if (/^r/i.test(cells[2] || "")) p.batting_style = "right";
      if (cells[3]) p.bowling_style = cells[3].slice(0, 40);
      const j = parseInt(cells[4], 10);
      if (j >= 0 && j <= 999) p.jersey_no = j;
      out.push(p);
    }
    return out;
  }

  // ---------- New tournament ----------

  ui.screens.tnew = () => {
    const f = form("tnew", { kind: "tournament", overs: 20, custom: false, maxBowler: 4, c1: "#0F7A45", c2: "#0E1A14" });
    const chips = ui.PRESETS.map(([l, n]) => `<button class="chip ${!f.custom && +f.overs === n ? "on" : ""}" data-act="tnew-overs" data-n="${n}">${l}</button>`).join("");
    const editing = !!f.editId;
    // Asked on every new tournament: sponsors added here go on every card the studio makes for it.
    const sps = f.sponsors || [];
    const spRow = (sp, i) => `<div class="sponsor-row">
        ${sp.url ? `<img src="${esc(sp.url)}" alt="Sponsor logo">` : `<span class="logo logo-empty">Logo</span>`}
        <input data-sponsor-name="${i}" value="${esc(sp.name || "")}" maxlength="40" placeholder="Sponsor name (optional)" aria-label="Sponsor ${i + 1} name">
        <button class="chip-x" data-act="tnew-sponsor-remove" data-i="${i}" aria-label="Remove sponsor">✕</button></div>`;
    const sponsor = `<div class="card stack-s"><span class="eyebrow">Sponsors</span>
        <p class="small">Does this ${f.kind === "series" ? "series" : "tournament"} have sponsors?</p>
        <div class="chips"><button class="chip ${f.hasSponsors === true ? "on" : ""}" data-act="tnew-sponsor" data-v="1">Yes, add logos</button><button class="chip ${f.hasSponsors === false ? "on" : ""}" data-act="tnew-sponsor" data-v="0">No sponsors</button></div>
        ${f.hasSponsors ? `<small class="muted">Their logos go on every poster made for this ${f.kind === "series" ? "series" : "tournament"}: fifty cards, squads, VS, points table, leaders and the rest. Up to 4.</small>
        ${sps.map(spRow).join("")}
        ${sps.length < 4 ? `<label class="btn btn-small file-btn">+ Add sponsor logo<input type="file" accept="image/*" data-sponsor="1" hidden></label>` : ""}` : ""}
      </div>`;
    return bar(editing ? "Edit tournament" : "New tournament", editing ? "t-open" : "home", editing ? `data-id="${f.editId}"` : "") + `<section class="wrap stack">
      <div class="card stack-s">
        ${editing ? "" : `<div class="chips"><button class="chip ${f.kind === "tournament" ? "on" : ""}" data-act="tnew-kind" data-k="tournament">Tournament</button><button class="chip ${f.kind === "series" ? "on" : ""}" data-act="tnew-kind" data-k="series">Series (two teams)</button></div>`}
        ${field("Name", `<input id="tnew-name" data-f="tnew.name" value="${esc(f.name || "")}" placeholder="e.g. Winter Cup 2026" maxlength="80">`)}
        ${field("Short name", `<input id="tnew-short" data-f="tnew.short" value="${esc(f.short || "")}" placeholder="e.g. WC26" maxlength="12">`, "Shown on cards and score bars.")}
        ${field("Username", `<span class="handle-input"><span>@</span><input id="tnew-handle" data-f="tnew.handle" value="${esc(f.handle || "")}" placeholder="e.g. wintercup26" maxlength="25" autocapitalize="none" autocomplete="off" spellcheck="false"></span>`, "Teams search this to find the tournament and ask to join. Small letters, numbers and _ only.")}
      </div>
      ${editing ? `<div class="card stack-s"><span class="eyebrow">Join requests</span>
        <div class="chips"><button class="chip ${f.open !== false ? "on" : ""}" data-act="tnew-open" data-v="1">Teams can ask to join</button><button class="chip ${f.open === false ? "on" : ""}" data-act="tnew-open" data-v="0">Invite link only</button></div></div>` : ""}
      <div class="card stack-s"><span class="eyebrow">Logo and colours</span>${logoPicker(f, "tnew")}${colorPair(f, "tnew")}</div>
      <div class="card stack-s"><span class="eyebrow">Overs</span>
        <div class="chips">${chips}<button class="chip ${f.custom ? "on" : ""}" data-act="tnew-custom">Custom</button></div>
        ${f.custom ? field("Overs per side", `<input id="tnew-overs" data-f="tnew.overs" type="number" inputmode="numeric" min="1" max="100" value="${esc(f.overs)}">`) : ""}
        ${field("Max overs per bowler", `<input id="tnew-max" data-f="tnew.maxBowler" type="number" inputmode="numeric" min="1" value="${esc(f.maxBowler)}">`)}
        ${editing ? `<small class="muted">Changes apply to matches that haven't started.</small>` : ""}
      </div>
      ${sponsor}
      ${status(f)}
      <button class="btn btn-primary btn-big" data-act="tnew-save" ${f.busy ? "disabled" : ""}>${f.busy ? (editing ? "Saving…" : "Creating…") : editing ? "Save" : "Create"}</button>
    </section>`;
  };

  const cleanHandle = (h) => String(h || "").trim().replace(/^@+/, "").toLowerCase();

  // A tournament's sponsors as [{name, logo_path}]: the list from migration 0016, or the single sponsor from 0007.
  function sponsorsOf(t) {
    if (!t || t.show_sponsor === false) return [];
    if (Array.isArray(t.sponsors) && t.sponsors.length) return t.sponsors;
    return t.sponsor_name || t.sponsor_logo_path ? [{ name: t.sponsor_name || "", logo_path: t.sponsor_logo_path || "" }] : [];
  }

  // Sponsors save on their own so the rest of the tournament saves without migration 0016.
  // Returns "" or a note for the toast.
  async function saveSponsors(id, f) {
    const list = [];
    if (f.hasSponsors) {
      for (const sp of f.sponsors || []) {
        const logo_path = sp.blob ? await upload("logos", sp.blob) : sp.path || "";
        const name = (sp.name || "").trim().slice(0, 40);
        if (logo_path || name) list.push(Object.assign(name ? { name } : {}, logo_path ? { logo_path } : {}));
      }
    }
    const on = list.length > 0, first = list[0] || {};
    // The 0007 columns are kept in step with the first sponsor, so older copies of the app still show one.
    const legacy = { show_sponsor: on, sponsor_name: first.name || null, sponsor_logo_path: first.logo_path || null };
    const r = await sb.from("tournaments").update(Object.assign({ sponsors: list }, legacy)).eq("id", id);
    if (!r.error) return "";
    const r2 = await sb.from("tournaments").update(legacy).eq("id", id);
    if (r2.error) return "Sponsors need a database update first.";
    return list.length > 1 ? "Only the first sponsor was saved: more need a database update first." : "";
  }

  async function saveTournament() {
    const f = form("tnew");
    const name = (f.name || "").trim();
    if (name.length < 2) { f.error = "Give the tournament a name."; return ui.render(); }
    const overs = parseInt(f.overs, 10);
    if (!(overs >= 1 && overs <= 100)) { f.error = "Overs per side must be between 1 and 100."; return ui.render(); }
    const handle = cleanHandle(f.handle);
    if (handle && !/^[a-z0-9_]{3,24}$/.test(handle)) { f.error = "The username needs 3 to 24 small letters, numbers or _."; return ui.render(); }
    f.busy = true; f.error = ""; ui.render();
    // The username and join setting need migration 0010; they save on their own so the rest works without it.
    const saveHandle = async (id) => {
      const upd = { handle: handle || null };
      if (f.editId) upd.open_to_requests = f.open !== false;
      const { error } = await sb.from("tournaments").update(upd).eq("id", id);
      if (!error) return "";
      return error.code === "23505" ? `@${handle} is already taken. Pick another username.` : "The username needs a database update first.";
    };
    try {
      const row = {
        name, short_name: (f.short || "").trim() || null, primary_color: f.c1, secondary_color: f.c2, overs_per_side: overs,
        max_overs_per_bowler: Math.max(1, parseInt(f.maxBowler, 10) || Math.ceil(overs / 5)),
      };
      if (f.logoBlob) row.logo_path = await upload("logos", f.logoBlob);
      if (f.editId) {
        const { error } = await sb.from("tournaments").update(row).eq("id", f.editId);
        if (error) throw error;
        const spErr = await saveSponsors(f.editId, f);
        const hErr = await saveHandle(f.editId);
        if (hErr && handle) { f.busy = false; f.error = hErr; return ui.render(); }
        ui.toast(spErr ? `Saved. ${spErr}` : "Tournament saved");
        const id = f.editId;
        L.forms.tnew = null;
        loadMine();
        return openTour(id);
      }
      row.kind = f.kind;
      const { data, error } = await sb.from("tournaments").insert(row).select().single();
      if (error) throw error;
      const hErr = handle ? await saveHandle(data.id) : "";
      const spErr = f.hasSponsors && (f.sponsors || []).length ? await saveSponsors(data.id, f) : "";
      L.forms.tnew = null;
      loadMine();
      ui.toast(hErr || spErr ? `${data.name} created. ${hErr || spErr}` : `${data.name} created`);
      openTour(data.id);
    } catch (e) { f.busy = false; f.error = errText(e); ui.render(); }
  }

  // ---------- Tournament page ----------

  async function openTour(id, tab) {
    if (!L.tour || L.tour.id !== id) L.tour = { id, loading: true };
    ui.go("tour", { id, tab: tab || (L.tour.tab) || "matches" });
    L.tour.tab = ui.view().tab;
    const [t, teams, matches, roles, handed] = await Promise.all([
      sb.from("tournaments").select("*").eq("id", id).single(),
      sb.from("tournament_teams").select("group_name, teams(id, name, short_name, logo_path, primary_color, secondary_color, team_players(count))").eq("tournament_id", id),
      sb.from("matches").select("*").eq("tournament_id", id).order("starts_at", { ascending: true, nullsFirst: false }).order("created_at"),
      L.user ? sb.from("tournament_members").select("role").eq("tournament_id", id).eq("user_id", L.user.id) : Promise.resolve({ data: [] }),
      // Matches handed over to this user (migration 0012); none before that.
      L.user ? sb.from("match_scorers").select("match_id").eq("user_id", L.user.id) : Promise.resolve({ data: [] }),
    ]);
    const err = t.error || teams.error || matches.error || roles.error;
    L.tour = {
      id, tab: L.tour.tab, loading: false, error: err ? errText(err) : "",
      t: t.data, matches: matches.data || [], roles: (roles.data || []).map((r) => r.role),
      scoreMatches: handed.error ? [] : (handed.data || []).map((r) => r.match_id),
      teams: (teams.data || []).filter((r) => r.teams).map((r) => Object.assign({ group: r.group_name, count: (r.teams.team_players[0] || {}).count || 0 }, r.teams)),
    };
    rerender("tour");
  }

  const isOrganiser = () => L.tour && L.tour.roles.includes("organiser");
  // Organisers and scorers score every match; someone handed a match scores just that one.
  const canScore = () => L.tour && (L.tour.roles.includes("organiser") || L.tour.roles.includes("scorer") || (L.tour.scoreMatches || []).includes(L.tour.curMatch));
  const teamById = (id) => (L.tour.teams || []).find((x) => x.id === id) || { name: "Team", short_name: "?" };

  ui.screens.tour = (view) => {
    const T = L.tour;
    if (!T || T.loading) return bar("Tournament") + `<p class="wrap muted">Loading…</p>`;
    if (T.error || !T.t) return bar("Tournament") + `<section class="wrap stack"><p class="error">${esc(T.error || "Tournament not found.")}</p><button class="btn" data-act="t-open" data-id="${T.id}">Try again</button></section>`;
    const t = T.t, tab = view.tab || "matches";
    const hero = `<div class="hero" style="--c1:${t.primary_color || "#0F7A45"};--c2:${t.secondary_color || "#0E1A14"}">
      ${badge(t, "l")}<div class="hero-text"><h2>${esc(t.name)}</h2>${t.handle ? `<p class="hero-handle">@${esc(t.handle)}</p>` : ""}<p>${t.kind === "series" ? "Series" : "Tournament"} · ${t.overs_per_side} over${t.overs_per_side === 1 ? "" : "s"} a side · ${T.teams.length} team${T.teams.length === 1 ? "" : "s"}</p></div></div>`;
    const tabList = [["matches", "Matches"], ["table", "Table"], ["stats", "Stats"], ["teams", "Teams"]]
      .concat(T.roles.length && CSA.studio ? [["cards", "Cards"]] : [], isOrganiser() ? [["people", "People"]] : []);
    const tabs = `<div class="tabs">${tabList
      .map(([k, l]) => `<button class="tab ${tab === k ? "on" : ""}" data-act="tour-tab" data-t="${k}">${l}</button>`).join("")}</div>`;
    let body;
    if (tab === "table") body = tableTab(T);
    else if (tab === "people") body = peopleTab(T);
    else if (tab === "cards" && CSA.studio) body = CSA.studio.tab(T);
    else if (tab === "stats") body = statsTab(T);
    else if (tab === "teams") {
      const groups = {};
      for (const tm of T.teams) (groups[tm.group || ""] = groups[tm.group || ""] || []).push(tm);
      const names = Object.keys(groups).sort();
      body = (T.teams.length ? names.map((g) => `${g ? `<h3 class="eyebrow">Group ${esc(g)}</h3>` : ""}<ul class="t-list">${groups[g].map((tm) => `<li><button class="t-row" data-act="team-open" data-id="${tm.id}">${badge(tm)}<span class="t-text"><b>${esc(tm.name)}</b><small>${tm.count} player${tm.count === 1 ? "" : "s"}</small></span><span class="chev" aria-hidden="true">›</span></button></li>`).join("")}</ul>`).join("")
        : `<p class="muted">No teams yet.${isOrganiser() ? " Add one, or share the invite link so captains add their own team." : ""}</p>`)
        + (isOrganiser() ? joinRequests(T) + `<div class="row-2"><button class="btn btn-primary" data-act="team-new">Add team</button><button class="btn" data-act="t-invite">Invite teams</button></div>` : askToJoin(T));
    } else {
      const rows = T.matches.map((m) => {
        const a = teamById(m.team1_id), b = teamById(m.team2_id);
        const when = m.starts_at ? new Date(m.starts_at).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "Date not set";
        const pill = m.status === "live" ? `<span class="pill pill-live">LIVE</span>` : m.status === "done" ? `<span class="pill pill-done">${esc(m.result_text || "Result")}</span>` : `<span class="pill">${esc(when)}</span>`;
        return `<li><button class="t-row" data-act="m-open" data-id="${m.id}"><span class="vs">${badge(a)}<b>v</b>${badge(b)}</span>
          <span class="t-text"><b>${esc(a.short_name)} v ${esc(b.short_name)}</b><small>${esc([m.stage !== "group" ? STAGE_LABEL[m.stage] || "" : "", m.venue].filter(Boolean).join(" · ") || (m.match_no ? "Match " + m.match_no : ""))}</small>${pill}</span></button></li>`;
      }).join("");
      body = (rows ? `<ul class="t-list">${rows}</ul>` : `<p class="muted">No matches yet.${isOrganiser() ? (T.teams.length < 2 ? " Add at least two teams first." : " Add the first fixture.") : ""}</p>`)
        + (isOrganiser() && T.teams.length >= 2 ? `<button class="btn btn-primary" data-act="match-new">New match</button>` : "");
    }
    const edit = isOrganiser() ? `<button class="icon-btn" data-act="t-edit" aria-label="Edit tournament">${EDIT_ICON}</button>` : "";
    const share = `<button class="icon-btn" data-act="share" data-kind="t" data-id="${t.id}" data-title="${esc(t.name)}" aria-label="Share">${SHARE_ICON}</button>`;
    return `<header class="bar"><button class="icon-btn" data-act="home" aria-label="Back">←</button><h1>${esc(t.short_name || t.name)}</h1>${edit}${ui.followBtn ? ui.followBtn("tournament", t.id) : ""}${share}</header>`
      + hero + `<section class="wrap stack">${tabs}${body}</section>`;
  };

  // ---------- Teams joining: requests and invite links ----------

  async function loadRequests() {
    const T = L.tour;
    T.requests = null;
    const { data, error } = await sb.from("join_requests").select("id, note, created_at, teams(id, name, short_name, logo_path, primary_color, secondary_color, team_players(count))")
      .eq("tournament_id", T.id).eq("status", "pending").order("created_at");
    if (L.tour !== T) return;
    T.requests = error ? [] : data.filter((r) => r.teams); // no table yet (migration 0010) shows no requests
    rerender("tour");
  }

  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

  // Organisers see the teams waiting to join, with accept and decline.
  function joinRequests(T) {
    if (T.requests === undefined) { loadRequests(); T.requests = null; }
    if (!T.requests || !T.requests.length) return "";
    return `<h3 class="eyebrow">Asking to join</h3><ul class="t-list">${T.requests.map((r) => `<li class="t-row req-row">${badge(r.teams)}
        <span class="t-text"><b>${esc(r.teams.name)}</b><small>${plural((r.teams.team_players[0] || {}).count || 0, "player")}${r.note ? ` · “${esc(r.note)}”` : ""}</small></span>
        <span class="req-btns"><button class="btn btn-small" data-act="req-answer" data-id="${r.id}" data-ok="0">Decline</button><button class="btn btn-small btn-primary" data-act="req-answer" data-id="${r.id}" data-ok="1">Accept</button></span></li>`).join("")}</ul>`;
  }

  // Everyone else: a captain asks to put their team in. Teams of theirs already in, or
  // waiting, show their status; the card only shows while they have a team left to enter.
  function askToJoin(T) {
    if (L.user && T.requests === undefined) { loadRequests(); T.requests = null; }
    if (L.user && (L.myTeams == null || T.requests == null)) return ""; // still loading
    const name = esc(T.t.short_name || T.t.name);
    const inTour = new Set(T.teams.map((tm) => tm.id));
    // The rules only return requests this user sent or whose team they run.
    const waitIds = new Set((T.requests || []).map((r) => r.teams.id));
    const mine = L.myTeams || [];
    const playing = mine.filter((tm) => inTour.has(tm.id)).map((tm) => tm.name);
    const waiting = (T.requests || []).filter((r) => !inTour.has(r.teams.id)).map((r) => r.teams.name);
    const free = mine.filter((tm) => tm.manage && !inTour.has(tm.id) && !waitIds.has(tm.id));
    const runsAny = mine.some((tm) => tm.manage);
    let out = "";
    if (playing.length) out += `<p class="note">${esc(playing.join(", ").replace(/, ([^,]*)$/, " and $1"))} ${playing.length === 1 ? "is" : "are"} playing in ${name}.</p>`;
    if (waiting.length) out += `<p class="note">Waiting for the organiser to accept ${esc(waiting.join(", "))}.</p>`;
    // Every team they run is already in or waiting, or they play for a team that's in.
    if (L.user && (runsAny ? !free.length : playing.length)) return out;
    if (T.t.open_to_requests === false) return out + `<p class="muted small">Teams join this tournament by the organiser's invite link.</p>`;
    const another = playing.length || waiting.length;
    return out + `<div class="card stack-s join-card"><b>${another ? `Put another team in ${name}?` : `Want your team in ${name}?`}</b>
      <p class="muted small">Captains send a request, and the organiser accepts it.</p>
      <button class="btn btn-primary" data-act="tj-request">Ask to join</button></div>`;
  }

  // ---------- People: organisers, scorers and media ----------

  const ROLE_TEXT = { organiser: "Organiser", scorer: "Scorer", media: "Media manager" };
  const ROLE_HELP = { organiser: "can change everything", scorer: "can score and fix balls", media: "makes and shares cards, gets card alerts, can't score or edit" };

  async function loadPeople() {
    const T = L.tour;
    T.people = null; T.peopleError = "";
    const { data, error } = await sb.from("tournament_members").select("role, user_id, profiles(display_name)").eq("tournament_id", T.id).order("added_at");
    if (L.tour !== T) return;
    if (error) T.peopleError = errText(error); else T.people = data;
    rerender("tour");
  }

  function peopleTab(T) {
    if (T.people === undefined) { loadPeople(); T.people = null; }
    const f = form("people", { role: "scorer" });
    const list = T.people == null ? `<p class="muted">${T.peopleError ? esc(T.peopleError) : "Loading…"}</p>`
      : `<ul class="people">${T.people.map((m) => {
        const nm = (m.profiles && m.profiles.display_name) || "Member", me = L.user && m.user_id === L.user.id;
        return `<li class="person"><span class="avatar">${esc(nm.slice(0, 1).toUpperCase())}</span>
          <span class="t-text"><b>${esc(nm)}${me ? " (you)" : ""}</b><small>${ROLE_TEXT[m.role]} · ${ROLE_HELP[m.role]}</small></span>
          ${me ? "" : `<button class="icon-btn" data-act="person-remove" data-u="${m.user_id}" data-r="${m.role}" aria-label="Remove ${esc(nm)}">✕</button>`}</li>`;
      }).join("")}</ul>`;
    return list + `<div class="card stack-s">
      <span class="eyebrow">Add someone</span>
      <p class="muted small">They sign up in the app first, then you add them with the email they used.</p>
      ${field("Their email", `<input id="person-email" data-f="people.email" type="email" inputmode="email" autocomplete="off" value="${esc(f.email || "")}">`)}
      <div class="chips">${Object.keys(ROLE_TEXT).map((r) => `<button class="chip ${f.role === r ? "on" : ""}" data-act="person-role" data-r="${r}">${ROLE_TEXT[r]}</button>`).join("")}</div>
      <p class="muted small">${ROLE_TEXT[f.role]}: ${ROLE_HELP[f.role]}.</p>
      ${status(f)}
      <button class="btn btn-primary" data-act="person-add" ${f.busy ? "disabled" : ""}>${f.busy ? "Adding…" : `Add as ${ROLE_TEXT[f.role].toLowerCase()}`}</button></div>`;
  }

  async function addPerson() {
    const f = form("people");
    f.email = ((document.getElementById("person-email") || {}).value || f.email || "").trim();
    if (!/^\S+@\S+\.\S+$/.test(f.email)) { f.error = "Enter the email they signed up with."; return ui.render(); }
    f.busy = true; f.error = ""; ui.render();
    const { data, error } = await sb.rpc("add_member_by_email", { t: L.tour.id, member_email: f.email, member_role: f.role });
    f.busy = false;
    if (error) { f.error = error.message; return ui.render(); }
    ui.toast(`${data.display_name || f.email} added as ${ROLE_TEXT[f.role].toLowerCase()}`);
    L.forms.people = { role: f.role };
    loadPeople();
  }

  // ---------- Points table and leaders ----------

  const nrrText = (x) => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toFixed(3);
  // Group matches decide the table; in a series every match counts.
  const tableMatches = (T) => T.matches.filter((m) => T.t.kind === "series" || m.stage === "group");

  const STAGE_LABEL = { quarter: "Quarter-final", semi: "Semi-final", final: "Final", series: "Series", other: "" };

  // Knockout rounds side by side: quarter-finals, semi-finals, final. The winner of each tie is bold.
  function knockouts(T) {
    const rounds = [["quarter", "Quarter-finals"], ["semi", "Semi-finals"], ["final", "Final"]]
      .map(([k, l]) => [l, T.matches.filter((m) => m.stage === k)]).filter(([, ms]) => ms.length);
    if (!rounds.length) return "";
    const side = (m, i) => {
      const id = i ? m.team2_id : m.team1_id, tm = teamById(id);
      const inn = m.summary && m.summary.innings ? m.summary.innings.find((x) => x.team === i) : null;
      const won = m.winner_team_id === id, lost = m.status === "done" && m.winner_team_id && !won;
      return `<span class="ko-side ${won ? "won" : ""} ${lost ? "lost" : ""}">${badge(tm)}<b>${esc(tm.short_name)}</b><span class="ko-score">${inn ? `${inn.runs}/${inn.wickets}` : ""}</span></span>`;
    };
    const col = ([label, ms]) => `<div class="ko-round"><h3 class="eyebrow">${label}</h3>${ms.map((m) => `<button class="ko-match" data-act="m-open" data-id="${m.id}">
        ${side(m, 0)}${side(m, 1)}<small>${m.status === "live" ? `<span class="pill pill-live">LIVE</span>` : m.status === "done" ? esc(m.result_text || "") : m.starts_at ? esc(new Date(m.starts_at).toLocaleDateString([], { day: "numeric", month: "short" })) : "Date not set"}</small></button>`).join("")}</div>`;
    return `<h2 class="eyebrow">Knockouts</h2><div class="ko">${rounds.map(col).join("")}</div>`;
  }

  function tableTab(T) {
    if (T.teams.length < 2) return `<p class="muted">The table shows up once there are teams and results.</p>`;
    if (T.t.kind !== "series" && !T.matches.some((m) => m.stage === "group") && T.matches.some((m) => STAGE_LABEL[m.stage])) return knockouts(T);
    const groups = {};
    for (const tm of T.teams) (groups[tm.group || ""] = groups[tm.group || ""] || []).push(tm.id);
    const ms = tableMatches(T);
    // A team's last five results, oldest first.
    const formOf = (id) => ms.filter((m) => (m.team1_id === id || m.team2_id === id) && (m.status === "done" || m.status === "abandoned"))
      .sort((x, y) => String(x.starts_at || "").localeCompare(String(y.starts_at || ""))).slice(-5)
      .map((m) => m.status === "abandoned" ? "N" : !m.winner_team_id ? "T" : m.winner_team_id === id ? "W" : "L");
    const tables = Object.keys(groups).sort().map((g) => {
      const rows = CSA.stats.pointsTable(groups[g], ms), q = rows.length > 2 ? 2 : 0;
      const showT = rows.some((r) => r.t), showNr = rows.some((r) => r.nr), n = 3 + (showT ? 1 : 0) + (showNr ? 1 : 0);
      const cols = `--n:${n}`;
      const head = `<div class="pt-cols" style="${cols}"><span>Team</span><span>P</span><span>W</span><span>L</span>${showT ? "<span>T</span>" : ""}${showNr ? "<span>NR</span>" : ""}<span>NRR</span><span>Pts</span></div>`;
      const body = rows.map((r, i) => {
        const tm = teamById(r.id), f = formOf(r.id);
        const form = f.length ? `<span class="pt-form">${f.map((c) => `<i class="f-${c}">${c}</i>`).join("")}</span>` : "";
        return `<div class="pt-row${i < q ? " q" : ""}${i === q - 1 ? " cut" : ""}" style="${cols};--c1:${tm.primary_color || "#0F7A45"}">
          <span class="pt-team"><span class="pos">${i + 1}</span>${badge(tm)}<span class="pt-name"><b>${esc(tm.short_name)}</b><small>${esc(tm.name)}</small>${form}</span></span>
          <span>${r.p}</span><span>${r.w}</span><span>${r.l}</span>${showT ? `<span>${r.t}</span>` : ""}${showNr ? `<span>${r.nr}</span>` : ""}<span class="pt-nrr">${nrrText(r.nrr)}</span><span class="pt-pts">${r.pts}</span></div>`;
      }).join("");
      return `<section class="ptable"><header class="ptable-head"><h3>${g ? `Group ${esc(g)}` : "Standings"}</h3>${q ? `<span>Top ${q} go through</span>` : ""}</header>${head}${body}</section>`;
    }).join("");
    const done = ms.filter((m) => m.status === "done" || m.status === "abandoned").length;
    return tables + `<p class="muted small">${done ? `From ${done} finished match${done === 1 ? "" : "es"}.` : "No results yet."} Win 2 points, tie or no result 1. NRR counts an all-out side as facing its full overs.</p>` + knockouts(T);
  }

  const STAT_KINDS = [["runs", "Most runs"], ["wickets", "Most wickets"], ["scores", "Highest score"], ["figures", "Best bowling"], ["sixes", "Most sixes"], ["fours", "Most fours"]];

  function statsTab(T) {
    const L2 = CSA.stats.leaders(T.matches);
    if (!L2.runs.length) return `<p class="muted">Run and wicket leaders show up after the first finished match.</p>`;
    const kind = T.statKind || "runs";
    const row = (x, i, big, small) => {
      const tm = teamById(x.teamId);
      const inner = `<span class="pos">${i + 1}</span>${badge(tm)}
        <span class="t-text"><b>${esc(x.name)}</b><small>${esc(tm.short_name)} · ${small}</small></span><span class="leader-n">${big}</span>`;
      return `<li class="leader${i === 0 ? " leader-top" : ""}">${x.id ? `<button class="leader-btn" data-act="p-open" data-id="${x.id}">${inner}</button>` : inner}</li>`;
    };
    const vs = (x) => `v ${esc(teamById(x.vsId).short_name)}`;
    const lists = {
      runs: () => L2.runs.map((x, i) => row(x, i, x.runs,
        `${x.inns} inn · SR ${x.sr.toFixed(1)}${x.avg != null ? ` · Avg ${x.avg.toFixed(1)}` : ""} · Best ${x.best}${x.bestOut ? "" : "*"}`)),
      wickets: () => L2.wickets.filter((x) => x.wickets > 0).map((x, i) => row(x, i, x.wickets,
        `${x.overs} ov · Econ ${x.econ.toFixed(2)} · Best ${x.bestW}/${x.bestR}`)),
      scores: () => L2.scores.map((x, i) => row(x, i, `${x.runs}${x.out ? "" : "*"}`, `${vs(x)} · ${x.balls} ball${x.balls === 1 ? "" : "s"}`)),
      figures: () => L2.figures.map((x, i) => row(x, i, `${x.wickets}/${x.runs}`, `${vs(x)} · ${x.overs} ov`)),
      sixes: () => L2.sixes.map((x, i) => row(x, i, x.sixes, `${x.runs} runs · ${x.inns} inn`)),
      fours: () => L2.fours.map((x, i) => row(x, i, x.fours, `${x.runs} runs · ${x.inns} inn`)),
    };
    const items = lists[kind]().slice(0, 10).join("");
    const chips = STAT_KINDS.map(([k, l]) => `<button class="chip ${k === kind ? "on" : ""}" data-act="stat-kind" data-k="${k}">${l}</button>`).join("");
    return `<div class="chips chips-scroll">${chips}</div>
      ${items ? `<ol class="leaders">${items}</ol>` : `<p class="muted">Nothing here yet.</p>`}`;
  }

  // ---------- New team ----------

  // A team made by anyone from the Teams tab, or added to a tournament by its organiser (f.tourId).
  ui.screens.teamnew = () => {
    const f = form("teamnew", {}), inTour = !!f.tourId;
    if (!f.c1) Object.assign(f, { c1: "#0F7A45", c2: "#0E1A14", withMe: !inTour });
    const count = parsePlayers(f.players).length;
    const back = inTour ? bar("Add team", "t-open", `data-id="${f.tourId}"`) : bar("Create team", "home");
    const me = !inTour ? `<label class="check check-card"><input type="checkbox" data-withme="1" ${f.withMe && L.me ? "checked" : ""} ${L.me ? "" : "disabled"}>
        <span><b>I play for this team</b><small class="muted">${L.me ? `${esc(L.me.full_name)} joins the squad as captain.` : "Set up your player profile first to add yourself."}</small></span></label>` : "";
    return back + `<section class="wrap stack">
      <div class="card stack-s">
        ${field("Team name", `<input id="team-name" data-f="teamnew.name" value="${esc(f.name || "")}" maxlength="60" placeholder="e.g. Shapla Strikers">`)}
        ${field("Short name", `<input id="team-short" data-f="teamnew.short" value="${esc(f.short || "")}" maxlength="5" placeholder="${esc(ui.shortName(f.name || "Team"))}">`)}
        ${inTour ? field("Group (optional)", `<input id="team-group" data-f="teamnew.group" value="${esc(f.group || "")}" maxlength="10" placeholder="e.g. A">`) : ""}
      </div>
      <div class="card stack-s"><span class="eyebrow">Logo and colours</span>${logoPicker(f, "teamnew")}${colorPair(f, "teamnew")}</div>
      ${me}
      <div class="card stack-s">${field(inTour ? "Players, one per line" : "Other players (optional)", `<textarea id="team-players" data-f="teamnew.players" rows="7" placeholder="${inTour ? "Captain first" : "One name per line"}">${esc(f.players || "")}</textarea>`, `<span data-count>${count} players</span>. ${inTour ? "The first name is the captain. " : "You can also send players an invite link after, and they add themselves. "}Rows from a spreadsheet work too: name, role, batting (R/L), bowling, jersey.`)}
        <label class="btn btn-small file-btn">Import a CSV file<input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" data-csv="teamnew" hidden></label></div>
      ${status(f)}
      <button class="btn btn-primary btn-big" data-act="team-save" ${f.busy ? "disabled" : ""}>${f.busy ? "Saving…" : inTour ? "Add team" : "Create team"}</button>
    </section>`;
  };

  // Creates the players and puts them in the team, keeping the typed order: it becomes the
  // batting order offered when a match starts.
  async function addPlayers(teamId, players) {
    const made = await sb.from("players").insert(players).select("id, full_name");
    if (made.error) throw made.error;
    const ids = players.map((p) => { const i = made.data.findIndex((x) => x.full_name === p.full_name); return made.data.splice(i, 1)[0].id; });
    for (const [i, player_id] of ids.entries()) {
      // One at a time so joined_at keeps the order.
      const link = await sb.from("team_players").insert({ team_id: teamId, player_id, joined_at: new Date(Date.now() + i).toISOString() });
      if (link.error) throw link.error;
    }
    return ids;
  }

  async function saveTeam() {
    const f = form("teamnew"), inTour = !!f.tourId;
    const name = (f.name || "").trim();
    const players = parsePlayers(f.players);
    const withMe = !inTour && f.withMe && L.me;
    if (name.length < 2) { f.error = "Give the team a name."; return ui.render(); }
    if (inTour && players.length < 2) { f.error = "Add at least 2 players, one per line."; return ui.render(); }
    f.busy = true; f.error = ""; ui.render();
    try {
      const logo_path = f.logoBlob ? await upload("logos", f.logoBlob) : null;
      const team = await sb.from("teams").insert({
        name, short_name: ((f.short || "").trim() || ui.shortName(name)).slice(0, 5).toUpperCase(), logo_path,
        primary_color: f.c1, secondary_color: f.c2,
      }).select().single();
      if (team.error) throw team.error;
      if (withMe) {
        const r = await sb.from("team_players").insert({ team_id: team.data.id, player_id: L.me.id });
        if (r.error) throw r.error;
      }
      const ids = players.length ? await addPlayers(team.data.id, players) : [];
      const captain = withMe ? L.me.id : ids[0];
      if (captain) await sb.from("teams").update({ captain_player_id: captain }).eq("id", team.data.id);
      if (inTour) {
        const joined = await sb.from("tournament_teams").insert({ tournament_id: f.tourId, team_id: team.data.id, group_name: (f.group || "").trim() || null });
        if (joined.error) throw joined.error;
      }
      L.forms.teamnew = null;
      ui.toast(`${name} ${inTour ? "added" : "created"}`);
      await loadMyTeams();
      if (inTour) return openTour(f.tourId, "teams");
      if (CSA.hub && CSA.hub.afterTeamCreated(team.data.id)) return;
      CSA.squad.openTeam(team.data.id, "tab");
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
    L.tour.curMatch = m.id;
    const local = S.get(m.id);
    if (local && canScore() && !local.readOnly && !local.handedOver) return ui.openMatch(local);
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
    rec.cloudResult = m.result_text || null;
    // After handing the match over, this phone only watches until the user takes it back.
    const before = S.get(m.id);
    rec.handedOver = !!(before && before.handedOver);
    rec.readOnly = !canScore() || rec.handedOver;
    if (canScore()) S.save(rec);
    ui.openMatch(rec);
  }

  function buildRec(m, playerNames) {
    const team = (id, i) => { const t = teamById(id); return { name: t.name, short: t.short_name, players: playerNames[i] }; };
    return {
      match: {
        id: m.id, createdAt: Date.now(), teams: [team(m.team1_id, 0), team(m.team2_id, 1)],
        battingFirst: m.batting_first || 0, toss: m.toss || { winner: 0, decision: "bat" }, rules: m.rules && m.rules.oversPerSide ? m.rules : rulesOf(L.tour.t),
        info: { tournament: L.tour && L.tour.t ? L.tour.t.name : null, venue: m.venue || null, startsAt: m.starts_at || null },
        cloud: { matchId: m.id, tournamentId: m.tournament_id, teamIds: [m.team1_id, m.team2_id], playerIds: m.lineups ? m.lineups.teams.map((x) => x.players) : null },
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
    const t = rec.match.teams;
    const share = `<button class="icon-btn" data-act="share" data-kind="m" data-id="${rec.match.cloud.matchId}" data-title="${esc(`${t[0].name} v ${t[1].name}`)}" aria-label="Share live score">${SHARE_ICON}</button>`;
    if (rec.readOnly) return `${ui.followBtn ? ui.followBtn("match", rec.match.cloud.matchId) : ""}${share}`;
    const state = L.badge[rec.match.id] || (pending(rec) ? "saving" : "saved");
    return `<span class="sync sync-${state}" id="sync-badge">${BADGES[state]}</span>${share}`;
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
      const statusChanged = status !== rec.cloudStatus;
      const resultText = s.result ? s.result.text : null;
      // A ball fixed after the match ended can change the margin or even the winner, so the
      // result is sent again whenever it differs from the one the server has.
      if (statusChanged || (s.result && resultText !== rec.cloudResult)) {
        const upd = { status, result_text: resultText, winner_team_id: s.result && s.result.winner != null ? rec.match.cloud.teamIds[s.result.winner] : null };
        const { error } = await sb.from("matches").update(upd).eq("id", id);
        if (error) throw error;
        rec.cloudStatus = status; rec.cloudResult = resultText;
        const m = L.tour && L.tour.matches && L.tour.matches.find((x) => x.id === id);
        if (m) Object.assign(m, upd);
      }
      // The points table and leaders read this summary. It goes separately so that a database
      // without the summary column (migration 0002 not run yet) still syncs every ball.
      if (s.result && (statusChanged || rows.length || prev.length > ev.length)) {
        const summary = CSA.stats.summarize(rec.match, s, rec.match.cloud.playerIds);
        const { error } = await sb.from("matches").update({ summary }).eq("id", id);
        if (error) console.warn("Match summary not saved:", error.message);
        const m = L.tour && L.tour.matches && L.tour.matches.find((x) => x.id === id);
        if (m && !error) m.summary = summary;
      }
      if (CSA.alerts) CSA.alerts.afterSync(rec, s);
      if (CSA.live) CSA.live.afterSync(rec, s);
      rec.synced = ev.map((e) => JSON.stringify(e));
      const cur = S.get(rec.match.id);
      if (cur) { cur.synced = rec.synced; cur.cloudStatus = rec.cloudStatus; cur.cloudResult = rec.cloudResult; S.save(cur); }
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

  // A fan watching a live match checks for new balls every 10 seconds while the screen is open
  // (live.js only downloads the balls when the match's live score has changed).
  async function refreshWatched(quiet) {
    const rec = ui.current();
    if (!rec || !rec.match.cloud || !rec.readOnly) return;
    let changed;
    try { changed = await CSA.live.refresh(rec); } catch (e) { if (!quiet) ui.toast(errText(e)); return; }
    if (ui.current() !== rec) return;
    if (changed && onScreen("score", "card")) ui.render();
    else if (!quiet) ui.toast("Up to date");
  }
  setInterval(() => {
    const rec = ui.current();
    if (document.visibilityState === "visible" && rec && rec.readOnly && rec.cloudStatus === "live" && onScreen("score", "card")) refreshWatched(true);
  }, 10000);

  // Opens a shared link once the sign-in state is known (so scorers get the pad, fans the score).
  async function openLink() {
    if (location.hash === "#/alerts") { history.replaceState(null, "", location.pathname + location.search); return ui.actions.alerts && ui.actions.alerts(); }
    const at = /^#\/@([a-z0-9_]{3,24})$/i.exec(location.hash);
    if (at) {
      history.replaceState(null, "", location.pathname + location.search);
      const { data } = await sb.from("tournaments").select("id").eq("handle", at[1].toLowerCase()).maybeSingle();
      return data ? openTour(data.id) : ui.toast(`No tournament called @${at[1]}`);
    }
    const hit = /^#\/(t|m)\/([0-9a-f-]{36})$/i.exec(location.hash);
    if (!hit) return;
    history.replaceState(null, "", location.pathname + location.search);
    if (hit[1] === "t") return openTour(hit[2]);
    const { data, error } = await sb.from("matches").select("tournament_id").eq("id", hit[2]).single();
    if (error) return ui.toast("That match link doesn't work any more.");
    await openTour(data.tournament_id, "matches");
    await openMatch(hit[2]);
  }

  // ---------- Handing scoring to a teammate ----------
  // The scorer shares a one-time link (…/#/takeover/<code>). Whoever opens it, signed in,
  // becomes a scorer for this match only and carries on from the last synced ball.

  ui.cloudHandover = async (rec) => {
    if (!L.user) return ui.toast("Sign in to hand over this match.");
    if (pending(rec)) { ui.toast("Saving the last balls first…"); await syncRec(rec); if (pending(rec)) return ui.toast("No signal yet. Hand over once the balls are synced."); }
    const { data, error } = await sb.rpc("make_handover", { m: rec.match.cloud.matchId });
    if (error) return ui.toast(/function|schema/.test(error.message) ? "Handing over needs a database update first." : error.message);
    const t = rec.match.teams, url = `${location.origin}${location.pathname}#/takeover/${data}`;
    let sent = true;
    try {
      if (navigator.share) await navigator.share({ title: "Take over scoring", text: `Take over scoring ${t[0].name} v ${t[1].name}. Open this link (works once):`, url });
      else { await navigator.clipboard.writeText(url); ui.toast("Link copied. Paste it in WhatsApp."); }
    } catch (e) { if (e && e.name === "AbortError") sent = false; else window.prompt("Copy this link", url); }
    if (!sent || !confirm("Sent? This phone stops scoring and just follows the match. You can take it back later.")) return;
    rec.handedOver = true; rec.readOnly = true;
    S.save(rec);
    ui.render();
  };

  // ---------- Change log ----------
  // The database keeps every change to a saved ball (event_edits). Shown under the scorecard.

  const changeLogs = {};
  function describeEvent(e) {
    if (!e || e.t === "void") return "removed";
    if (e.t !== "ball") return { openers: "openers chosen", bowler: "bowler change", batter: "new batter", swap: "strike swapped", retire: "retired hurt", end: "innings ended" }[e.t] || e.t;
    const r = e.runs || 0, x = { wd: "wide", nb: "no ball", b: "byes", lb: "leg byes" }[e.extra];
    let t = x ? `${x}${r ? ` +${r}` : ""}` : `${r} run${r === 1 ? "" : "s"}`;
    if (e.wicket && e.wicket.kind !== "retired") t += `, ${E.WICKET_KINDS[e.wicket.kind].toLowerCase()}`;
    return t;
  }

  ui.cardExtra = (rec) => {
    if (!rec.match.cloud || rec.readOnly) return "";
    const log = changeLogs[rec.match.id];
    if (!log) return `<button class="btn btn-ghost" data-act="show-log">Show change log</button>`;
    if (log.loading) return `<p class="muted">Loading changes…</p>`;
    if (log.error) return `<p class="error">${esc(log.error)}</p>`;
    if (!log.rows.length) return `<h2 class="eyebrow">Change log</h2><p class="muted">No saved ball has been changed.</p>`;
    return `<h2 class="eyebrow">Change log</h2><ol class="people">${log.rows.map((r) => `<li class="person"><span class="t-text">
      <b>Entry ${r.seq + 1}: ${esc(describeEvent(r.old_event))} → ${esc(describeEvent(r.new_event))}</b>
      <small>${esc(log.names[r.edited_by] || "Someone")} · ${new Date(r.edited_at).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</small></span></li>`).join("")}</ol>`;
  };

  async function loadLog(rec) {
    const id = rec.match.id, log = changeLogs[id] = { loading: true };
    ui.render();
    const { data, error } = await sb.from("event_edits").select("*").eq("match_id", rec.match.cloud.matchId).order("edited_at", { ascending: false }).limit(100);
    if (error) { log.loading = false; log.error = errText(error); return ui.render(); }
    const ids = [...new Set(data.map((r) => r.edited_by).filter(Boolean))];
    const people = ids.length ? await sb.from("profiles").select("id, display_name").in("id", ids) : { data: [] };
    log.names = Object.fromEntries((people.data || []).map((p) => [p.id, p.display_name]));
    // Undo while scoring also shows up as a removal; keep only changes to balls, which is what people look for.
    log.rows = data.filter((r) => (r.old_event && r.old_event.t === "ball") || (r.new_event && r.new_event.t === "ball"));
    log.loading = false;
    ui.render();
  }

  // ---------- Actions and inputs ----------

  Object.assign(ui.actions, {
    account() { ui.go("account"); },
    "auth-mode"(d) { const f = form("account"); f.mode = d.m; f.error = ""; f.note = ""; ui.render(); },
    async "sign-out"() { await sb.auth.signOut(); ui.toast("Signed out"); ui.go("home"); },
    "tnew-kind"(d) { form("tnew").kind = d.k; ui.render(); },
    "tnew-overs"(d) { const f = form("tnew"); f.custom = false; f.overs = +d.n; f.maxBowler = Math.ceil(f.overs / 5); ui.render(); },
    "tnew-custom"() { form("tnew").custom = true; ui.render(); },
    "tnew-save": saveTournament,
    "t-new"() { L.forms.tnew = null; if (needUser()) ui.go("tnew"); },
    "t-edit"() {
      const t = L.tour.t, preset = ui.PRESETS.some(([, n]) => n === t.overs_per_side);
      L.forms.tnew = { editId: t.id, kind: t.kind, name: t.name, short: t.short_name || "", c1: t.primary_color || "#0F7A45", c2: t.secondary_color || "#0E1A14", colorsEdited: true,
        logoUrl: t.logo_path ? publicUrl("logos", t.logo_path) : "", overs: t.overs_per_side, custom: !preset, maxBowler: t.max_overs_per_bowler || Math.ceil(t.overs_per_side / 5),
        handle: t.handle || "", open: t.open_to_requests !== false,
        sponsors: sponsorsOf(t).map((sp) => ({ name: sp.name || "", path: sp.logo_path || "", url: sp.logo_path ? publicUrl("logos", sp.logo_path) : "" })) };
      L.forms.tnew.hasSponsors = L.forms.tnew.sponsors.length > 0;
      ui.go("tnew");
    },
    async "feed-open"(d) { await openTour(d.t, "matches"); await openMatch(d.id); },
    "acct-del-open"() { form("delacct").open = true; ui.render(); },
    "acct-del-cancel"() { L.forms.delacct = {}; ui.render(); },
    async "acct-del"() {
      const f = form("delacct");
      if ((f.text || "").trim().toUpperCase() !== "DELETE") { f.error = "Type DELETE to confirm."; return ui.render(); }
      f.busy = true; f.error = ""; ui.render();
      const { error } = await sb.rpc("delete_my_account");
      f.busy = false;
      if (error) { f.error = errText(error); return ui.render(); }
      L.forms.delacct = {};
      await sb.auth.signOut();
      ui.toast("Your account was deleted.");
      ui.actions.home();
    },
    async "auth-google"() {
      const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
      if (error) ui.toast(errText(error));
    },
    "stat-kind"(d) { L.tour.statKind = d.k; ui.render(); },
    "tnew-sponsor"(d) { form("tnew").hasSponsors = d.v === "1"; ui.render(); },
    "tnew-sponsor-remove"(d) { form("tnew").sponsors.splice(+d.i, 1); ui.render(); },
    "tnew-open"(d) { form("tnew").open = d.v === "1"; ui.render(); },
    "t-open"(d) { openTour(d.id); },
    async "req-answer"(d) {
      const { error } = await sb.rpc("answer_join_request", { req: d.id, accept: d.ok === "1" });
      if (error) return ui.toast(errText(error));
      ui.toast(d.ok === "1" ? "Team added to the tournament" : "Request declined");
      L.tour.requests = undefined;
      openTour(L.tour.id, "teams");
    },
    async "t-invite"() {
      const { data, error } = await sb.rpc("tournament_invite_code", { t: L.tour.id, fresh: false });
      if (error) return ui.toast(/function|schema/.test(error.message) ? "Invite links need a database update first." : errText(error));
      const t = L.tour.t, url = `${location.origin}${location.pathname}#/tjoin/${data}`;
      shareLink(`Join ${t.name}`, `Add your team to ${t.name}:`, url, "Invite link copied. Send it to the captains.");
    },
    "show-log"() { const rec = ui.current(); if (rec) loadLog(rec); },
    "person-role"(d) { form("people").role = d.r; ui.render(); },
    "person-add": addPerson,
    async "person-remove"(d) {
      if (!confirm(`Remove this ${ROLE_TEXT[d.r].toLowerCase()} from the tournament?`)) return;
      const { error } = await sb.from("tournament_members").delete().eq("tournament_id", L.tour.id).eq("user_id", d.u).eq("role", d.r);
      if (error) return ui.toast(errText(error));
      loadPeople();
    },
    "tour-tab"(d) { L.tour.tab = d.t; ui.go("tour", { id: L.tour.id, tab: d.t }); },
    "team-new"() { L.forms.teamnew = { tourId: L.tour.id }; ui.go("teamnew"); },
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
    "refresh-match"() { refreshWatched(false); },
    async "resume-cloud"() {
      const rec = ui.current();
      if (!rec || !confirm("Score on this phone again? Only do this if the other phone has stopped.")) return;
      rec.handedOver = false;
      L.tour = null;
      await openTour(rec.match.cloud.tournamentId, "matches");
      const m = L.tour.matches.find((x) => x.id === rec.match.cloud.matchId);
      const cur = S.get(rec.match.id);
      if (cur) { cur.handedOver = false; S.save(cur); }
      if (m) watchMatch(m, true);
    },
    async share(d) {
      const url = shareUrl(d.kind, d.id), title = d.title || "Live score";
      try {
        if (navigator.share) return await navigator.share({ title, text: d.kind === "m" ? `${title}: live score` : title, url });
        await navigator.clipboard.writeText(url);
        ui.toast("Link copied. Paste it in WhatsApp or Messenger.");
      } catch (e) {
        if (e && e.name === "AbortError") return;
        window.prompt("Copy this link", url);
      }
    },
  });

  // Form fields write straight into their form's state, so re-rendering never loses typing.
  document.addEventListener("input", (ev) => {
    if (ev.target.dataset.sponsorName) { const sp = (form("tnew").sponsors || [])[+ev.target.dataset.sponsorName]; if (sp) sp.name = ev.target.value; return; }
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
    if (t.dataset.sponsor && t.files && t.files[0]) {
      shrink(t.files[0], 512).then((out) => { const f = form("tnew"); f.sponsors = (f.sponsors || []).concat({ name: "", blob: out.blob, url: out.url }).slice(0, 4); ui.render(); })
        .catch(() => ui.toast("That file couldn't be read as an image."));
    }
    if (t.dataset.csv && t.files && t.files[0]) {
      t.files[0].text().then((txt) => {
        const f = form(t.dataset.csv), n = parsePlayers(txt).length;
        f.players = ((f.players || "").trim() ? f.players.trim() + "\n" : "") + txt.trim();
        ui.toast(`${n} player${n === 1 ? "" : "s"} read from the file`);
        ui.render();
      });
    }
    if (t.dataset.withme) form("teamnew").withMe = t.checked;
    if (t.dataset.pick && L.forms.mstart) {
      const [i, j] = t.dataset.pick.split("-").map(Number);
      L.forms.mstart.picked[i][j] = t.checked;
      ui.render();
    }
  });
  document.addEventListener("submit", (ev) => {
    if (ev.target.dataset.form === "auth") { ev.preventDefault(); submitAuth(); }
  });

  // Shared with squad.js (team and player pages).
  CSA.league = { sb, L, form, field, status, bar, badge, publicUrl, sponsorsOf, errText, shrink, upload, logoPicker, colorPair,
    openTour, isOrganiser, teamById, rerender, onScreen, needUser, parsePlayers, addPlayers, shareUrl, SHARE_ICON, EDIT_ICON,
    openMatch, feedHtml, loadFeed, loadMine, loadMe, loadMyTeams, deleteBox, shareLink, TEAM_COLS };

  ui.render();
})();
