// The app's four tabs (Home, Tournaments, Teams, Profile), the user's own player profile,
// and joining: finding a tournament by name or @username, asking to join, and invite links
// that add a team to a tournament (#/tjoin/<code>) or a player to a team (#/tmjoin/<code>).
(function () {
  const lg = CSA.league;
  if (!lg) return;
  const ui = CSA.ui, esc = ui.esc;
  const { sb, L, form, field, status, badge, errText } = lg;
  const H = { results: null, query: "", recent: null, career: null, pick: null };

  const svg = (d, w) => `<svg width="${w || 24}" height="${w || 24}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1Z"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.7V17c0 .6-.5 1-1 1.2C7.8 18.8 7 20.2 7 22M14 14.7V17c0 .6.5 1 1 1.2 1.2.6 2 2 2 3.8"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    team: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6Z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    ball: '<circle cx="12" cy="12" r="9"/><path d="M7.5 4.2c2 2.2 2 13.4 0 15.6M16.5 4.2c-2 2.2-2 13.4 0 15.6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    join: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5M15 12H3"/>',
  };
  const TABS = [["home", "Home", ICON.home], ["tours", "Tournaments", ICON.trophy], ["teams", "Teams", ICON.team], ["profile", "Profile", ICON.user]];

  ui.tabbar = (view) => (TABS.some(([k]) => k === view.screen)
    ? `<nav class="tabbar" aria-label="Main">${TABS.map(([k, l, i]) => `<button class="tabbar-btn ${view.screen === k ? "on" : ""}" data-act="nav" data-tab="${k}" ${view.screen === k ? 'aria-current="page"' : ""}>${svg(i)}<span>${l}</span></button>`).join("")}</nav>`
    : "");

  const firstName = () => ((L.me && L.me.full_name) || (L.user && L.user.user_metadata && L.user.user_metadata.full_name) || "").trim().split(/\s+/)[0];
  const meAvatar = (size) => (L.me ? CSA.squad.avatar(L.me, size) : `<span class="avatar avatar-${size || "s"}">${esc((firstName() || (L.user && L.user.email) || "?").slice(0, 1).toUpperCase())}</span>`);

  function top(title, right) {
    return `<header class="bar topbar"><h1>${title}</h1><span class="row-end">${right || ""}</span></header>`;
  }
  function homeTop() {
    const right = L.user
      ? `${CSA.alerts ? CSA.alerts.bell() : ""}<button class="me-btn" data-act="nav" data-tab="profile" aria-label="Your profile">${meAvatar()}</button>`
      : `<button class="btn btn-small" data-act="account">Sign in</button>`;
    return `<header class="bar topbar"><img class="brand-mark" src="icons/icon-192.png" alt=""><h1 class="brand-name">${esc(ui.APP)}</h1><span class="row-end">${right}</span></header>`;
  }

  const tourRow = (t) => `<li><button class="t-row" data-act="t-open" data-id="${t.id}">${badge(t)}
    <span class="t-text"><b>${esc(t.name)}</b><small>${t.handle ? `@${esc(t.handle)} · ` : ""}${t.kind === "series" ? "Series" : "Tournament"} · ${t.overs_per_side} overs${t.roles ? ` · ${t.roles.includes("organiser") ? "Organiser" : t.roles.includes("scorer") ? "Scorer" : "Media"}` : ""}</small></span><span class="chev" aria-hidden="true">›</span></button></li>`;
  const teamRole = (t) => (t.captain ? "Captain" : t.created_by === (L.user && L.user.id) ? "Your team" : "Player");
  const teamRow = (t) => `<li><button class="t-row" data-act="my-team" data-id="${t.id}">${badge(t)}
    <span class="t-text"><b>${esc(t.name)}</b><small>${t.count} player${t.count === 1 ? "" : "s"} · ${teamRole(t)}</small></span><span class="chev" aria-hidden="true">›</span></button></li>`;
  const section = (title, body, more) => `<div class="stack-s"><div class="row-between"><h2 class="eyebrow">${title}</h2>${more || ""}</div>${body}</div>`;
  const seeAll = (tab) => `<button class="link-btn" data-act="nav" data-tab="${tab}">See all</button>`;

  // ---------- Home ----------

  function greeting() {
    const h = new Date().getHours();
    return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  }

  ui.screens.home = () => {
    const quick = (act, icon, label, extra) => `<button class="quick" data-act="${act}" ${extra || ""}><span class="quick-icon">${svg(icon)}</span><span>${label}</span></button>`;
    const feed = lg.feedHtml();
    if (!L.user) {
      return homeTop() + `<section class="wrap stack">
        ${ui.installBanner()}
        <div class="welcome">
          <h2>Score it. Follow it. Share it.</h2>
          <p>Ball-by-ball scoring, live links for fans, points tables, player stats and match cards, all in one app.</p>
          <div class="row-2"><button class="btn btn-primary" data-act="account-up">Create account</button><button class="btn btn-on-dark" data-act="account">Sign in</button></div>
        </div>
        <div class="quick-row quick-2">${quick("new", ICON.ball, "Score a match")}${quick("nav", ICON.search, "Find a tournament", 'data-tab="tours"')}</div>
        ${feed}${ui.localMatches()}
      </section>`;
    }
    const mine = (L.mine || []).slice(0, 3), teams = (L.myTeams || []).slice(0, 3);
    const nudge = L.me === null ? `<button class="nudge" data-act="nav" data-tab="profile">${meAvatar()}<span><b>Set up your player profile</b><small>Add your photo and role. Your runs and wickets from every match collect here.</small></span><span class="chev" aria-hidden="true">›</span></button>` : "";
    return homeTop() + `<section class="wrap stack">
      ${ui.installBanner()}
      <div class="greet"><small>${greeting()}</small><b>${esc(firstName() || "Welcome")}</b></div>
      <div class="quick-row">${quick("new", ICON.ball, "Score match")}${quick("t-new", ICON.trophy, "New tournament")}${quick("tm-create", ICON.team, "Create team")}${quick("find-tour", ICON.join, "Join tournament")}</div>
      ${nudge}
      ${feed}
      ${mine.length ? section("Your tournaments", `<ul class="t-list">${mine.map(tourRow).join("")}</ul>`, (L.mine || []).length > 3 ? seeAll("tours") : "") : ""}
      ${teams.length ? section("Your teams", `<ul class="t-list">${teams.map(teamRow).join("")}</ul>`, (L.myTeams || []).length > 3 ? seeAll("teams") : "") : ""}
      ${ui.localMatches()}
    </section>`;
  };

  // ---------- Tournaments: search and yours ----------

  async function loadRecent() {
    H.recent = [];
    const { data } = await sb.from("tournaments").select("*").order("created_at", { ascending: false }).limit(10);
    H.recent = data || [];
    lg.rerender("tours");
  }

  function resultsHtml() {
    if (H.query.length < 2) {
      if (H.recent === null) loadRecent();
      const mine = L.user && L.mine && L.mine.length ? section("Your tournaments", `<ul class="t-list">${L.mine.map(tourRow).join("")}</ul>`) : "";
      const recent = (H.recent || []).filter((t) => !(L.mine || []).some((m) => m.id === t.id));
      return mine + (recent.length ? section("New on " + esc(ui.APP), `<ul class="t-list">${recent.map(tourRow).join("")}</ul>`) : "");
    }
    if (H.results === null) return `<p class="muted">Searching…</p>`;
    if (!H.results.length) return `<p class="muted">No tournament matches “${esc(H.query)}”. Check the spelling, or ask the organiser for the username or invite link.</p>`;
    return `<ul class="t-list">${H.results.map(tourRow).join("")}</ul>`;
  }

  ui.screens.tours = () => {
    const plus = L.user ? `<button class="btn btn-small" data-act="t-new">${svg(ICON.plus, 18)} New</button>` : "";
    const joining = L.joinTeam && (L.myTeams || []).find((t) => t.id === L.joinTeam);
    return top("Tournaments", plus) + `<section class="wrap stack">
      <label class="search">${svg(ICON.search, 20)}<input id="t-search" type="search" data-search="1" value="${esc(H.query)}" placeholder="Search by name or @username" autocapitalize="none" autocomplete="off" spellcheck="false" enterkeyhint="search"></label>
      ${joining ? `<p class="note">Joining with ${esc(joining.name)}. Open the tournament and tap Ask to join.</p>` : ""}
      <div id="t-results" class="stack">${resultsHtml()}</div>
    </section>`;
  };

  let searchTimer = null;
  async function search(raw) {
    const q = raw.trim().replace(/^@+/, "").replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 40);
    H.query = q;
    clearTimeout(searchTimer);
    if (q.length < 2) { H.results = null; return paintResults(); }
    H.results = null; paintResults();
    searchTimer = setTimeout(async () => {
      let res = await sb.from("tournaments").select("*").or(`name.ilike.%${q}%,short_name.ilike.%${q}%,handle.ilike.${q.toLowerCase()}%`).order("created_at", { ascending: false }).limit(20);
      // Before migration 0010 there is no handle column: search names only.
      if (res.error) res = await sb.from("tournaments").select("*").or(`name.ilike.%${q}%,short_name.ilike.%${q}%`).order("created_at", { ascending: false }).limit(20);
      if (H.query !== q) return;
      H.results = res.data || [];
      paintResults();
    }, 300);
  }
  // Only the results redraw, so the search box keeps focus while typing.
  function paintResults() {
    const el = document.getElementById("t-results");
    if (el) el.innerHTML = resultsHtml();
  }
  document.addEventListener("input", (ev) => { if (ev.target.dataset.search) search(ev.target.value); });

  // ---------- Teams ----------

  ui.screens.teams = () => {
    const plus = L.user ? `<button class="btn btn-small" data-act="tm-create">${svg(ICON.plus, 18)} Create</button>` : "";
    if (!L.user) return top("Teams") + `<section class="wrap stack">${signInCard("Make your own team", "Create your team, add your squad and enter tournaments.")}</section>`;
    const list = L.myTeams == null ? `<p class="muted">Loading your teams…</p>`
      : L.myTeams.length ? `<ul class="t-list">${L.myTeams.map(teamRow).join("")}</ul>`
      : `<div class="empty-card"><span class="quick-icon">${svg(ICON.team)}</span><b>No teams yet</b><p class="muted">Create your team, add your squad, then ask to join a tournament.</p></div>`;
    return top("Teams", plus) + `<section class="wrap stack">
      ${list}
      <button class="btn btn-primary" data-act="tm-create">Create a team</button>
      <p class="muted small">Your captain can send you the team's invite link. Open it and you join the squad yourself.</p>
    </section>`;
  };

  function signInCard(title, text) {
    return `<div class="empty-card"><span class="quick-icon">${svg(ICON.user)}</span><b>${title}</b><p class="muted">${text}</p>
      <div class="row-2"><button class="btn btn-primary" data-act="account-up">Create account</button><button class="btn" data-act="account">Sign in</button></div></div>`;
  }

  // ---------- Profile ----------

  async function loadCareer() {
    const id = L.me.id;
    H.career = { id, loading: true };
    const { data, error } = await sb.from("matches").select("id, team1_id, team2_id, status, summary, winner_team_id")
      .eq("status", "done").contains("lineups", { teams: [{ players: [id] }] }).limit(500);
    if (!H.career || H.career.id !== id) return;
    const all = CSA.stats.leaders(data || []);
    H.career = { id, error: error ? errText(error) : "", played: (data || []).length,
      bat: all.runs.find((x) => x.id === id), bowl: all.wickets.find((x) => x.id === id) };
    lg.rerender("profile");
  }

  function careerHtml() {
    if (!H.career || H.career.id !== L.me.id) { loadCareer(); return `<p class="muted">Loading your stats…</p>`; }
    const C = H.career;
    if (C.loading) return `<p class="muted">Loading your stats…</p>`;
    if (C.error) return `<p class="error">${esc(C.error)}</p>`;
    const tile = (n, label) => `<div class="tile"><b>${n}</b><span>${label}</span></div>`;
    const b = C.bat, w = C.bowl;
    return `<h2 class="eyebrow">Career</h2>
      <div class="tiles">${tile(C.played, "Matches")}${tile(b ? b.runs : 0, "Runs")}${tile(w ? w.wickets : 0, "Wickets")}</div>
      ${b ? `<h3 class="eyebrow">Batting</h3><div class="tiles">${tile(`${b.best}${b.bestOut ? "" : "*"}`, "Highest")}${tile(b.avg != null ? b.avg.toFixed(1) : "–", "Average")}${tile(b.sr.toFixed(1), "Strike rate")}${tile(b.fifties, "50s")}${tile(b.hundreds, "100s")}${tile(b.sixes, "Sixes")}</div>` : ""}
      ${w && w.balls ? `<h3 class="eyebrow">Bowling</h3><div class="tiles">${tile(`${w.bestW}/${w.bestR}`, "Best")}${tile(w.econ.toFixed(2), "Economy")}${tile(w.overs, "Overs")}</div>` : ""}
      ${C.played ? "" : `<p class="muted small">Your numbers fill in after your first finished match.</p>`}`;
  }

  function accountHtml() {
    return `<h2 class="eyebrow">Account</h2>
      <div class="card stack-s"><p class="muted">Signed in as <b>${esc(L.user.email)}</b></p>
        <div class="row-2"><button class="btn" data-act="sign-out">Sign out</button><a class="btn link-as-btn" href="privacy.html" target="_blank" rel="noopener">Privacy policy</a></div>
        ${lg.deleteBox()}</div>`;
  }

  ui.screens.profile = () => {
    if (!L.user) return top("Profile") + `<section class="wrap stack">${signInCard("Your player profile", "Sign up to get your own profile with your photo, role and career stats from every match.")}</section>`;
    if (L.me === undefined) return top("Profile") + `<p class="wrap muted">Loading…</p>`;
    if (!L.me) return top("Set up your profile") + setupForm();
    const p = L.me, sq = CSA.squad, teams = L.myTeams || [];
    const team = teams.find((t) => t.captain) || teams[0];
    const color = team ? `--c1:${team.primary_color || "#0F7A45"};--c2:${team.secondary_color || "#0E1A14"}` : "--c1:#0F7A45;--c2:#0E1A14";
    return top("Profile", `<button class="btn btn-small" data-act="me-edit">Edit</button>`)
      + `<div class="hero hero-player" style="${color}">${sq.avatar(p, "l")}
        <div class="hero-text"><h2>${esc(p.full_name)}</h2><p>${esc(sq.playerLine(p) || "Add your role and style")}</p></div>
        ${p.jersey_no != null ? `<span class="hero-jersey">${p.jersey_no}</span>` : ""}</div>
      <section class="wrap stack">
        ${careerHtml()}
        ${section("Teams", teams.length ? `<ul class="t-list">${teams.map(teamRow).join("")}</ul>` : `<p class="muted">You're not in a team yet. Create one, or open your captain's invite link.</p>`)}
        <button class="btn btn-ghost" data-act="p-open" data-id="${p.id}">See my public profile</button>
        ${accountHtml()}
      </section>`;
  };

  function setupForm() {
    const sq = CSA.squad;
    const f = form("mesetup", {});
    if (f.full_name == null) f.full_name = (L.user.user_metadata && L.user.user_metadata.full_name) || "";
    const chip = (act, v, cur, label) => `<button class="chip ${v === cur ? "on" : ""}" data-act="${act}" data-v="${v}">${label}</button>`;
    return `<section class="wrap stack">
      ${H.note ? `<p class="note">${esc(H.note)}</p>` : `<p class="muted">Everyone on ${esc(ui.APP)} is a player. Your stats from every match you play collect on this profile, and teams can add you to their squad.</p>`}
      <div class="card stack-s photo-pick">
        ${f.photoUrl ? `<img class="avatar avatar-l" src="${f.photoUrl}" alt="Photo preview">` : `<span class="avatar avatar-l">${esc((f.full_name || "?").slice(0, 1).toUpperCase())}</span>`}
        <label class="btn btn-small file-btn">${f.photoUrl ? "Change photo" : "Add photo"}<input type="file" accept="image/*" data-mephoto="1" hidden></label>
        <small class="muted">A clear face photo works best on cards.</small>
      </div>
      <div class="card stack-s">
        ${field("Full name", `<input data-f="mesetup.full_name" value="${esc(f.full_name)}" maxlength="60" autocomplete="name">`)}
        <span class="eyebrow">Role</span><div class="chips">${sq.ROLES.map(([v, l]) => chip("ms-role", v, f.role, l)).join("")}</div>
        <span class="eyebrow">Batting</span><div class="chips">${chip("ms-bat", "right", f.batting_style, "Right-hand")}${chip("ms-bat", "left", f.batting_style, "Left-hand")}</div>
        ${field("Bowling", `<select data-f="mesetup.bowling_style"><option value="">Doesn't bowl</option>${sq.BOWLING.map((b) => `<option ${b === f.bowling_style ? "selected" : ""}>${b}</option>`).join("")}</select>`)}
        ${field("Jersey number (optional)", `<input data-f="mesetup.jersey_no" type="number" inputmode="numeric" min="0" max="999" value="${esc(f.jersey_no == null ? "" : f.jersey_no)}">`)}
      </div>
      ${status(f)}
      <button class="btn btn-primary btn-big" data-act="me-create" ${f.busy ? "disabled" : ""}>${f.busy ? "Saving…" : "Create my profile"}</button>
      <p class="muted small">Already added to a team by your captain? Ask them for your player invite link, and your stats so far come with it.</p>
      ${accountHtml()}
    </section>`;
  }

  async function createMe() {
    const f = form("mesetup");
    const name = (f.full_name || "").trim();
    if (name.length < 2) { f.error = "Enter your name."; return ui.render(); }
    const jersey = f.jersey_no === "" || f.jersey_no == null ? null : parseInt(f.jersey_no, 10);
    if (jersey != null && !(jersey >= 0 && jersey <= 999)) { f.error = "Jersey number must be 0 to 999."; return ui.render(); }
    f.busy = true; f.error = ""; ui.render();
    try {
      const row = { full_name: name, role: f.role || null, batting_style: f.batting_style || null, bowling_style: f.bowling_style || null, jersey_no: jersey, claimed_by: L.user.id };
      if (f.photoBlob) row.photo_path = await lg.upload("photos", f.photoBlob);
      const { data, error } = await sb.from("players").insert(row).select().single();
      if (error) throw error;
      L.me = data; L.forms.mesetup = null; H.note = "";
      ui.toast("Your player profile is ready");
      await lg.loadMyTeams();
      ui.render();
      runPending();
    } catch (e) { f.busy = false; f.error = /claimed_by/.test(e.message || "") ? "Your account already has a player profile." : errText(e); ui.render(); }
  }

  document.addEventListener("change", async (ev) => {
    const t = ev.target;
    if (!t.dataset.mephoto || !t.files || !t.files[0]) return;
    const f = form("mesetup");
    try { const out = await CSA.squad.squarePhoto(t.files[0]); f.photoBlob = out.blob; f.photoUrl = out.url; }
    catch (e) { f.error = "That file couldn't be read as a photo. Try a JPG or PNG."; }
    ui.render();
  });

  // ---------- Picking a team to enter a tournament ----------

  ui.screens.tjpick = () => {
    const P = H.pick;
    if (!P) return lg.bar("Pick your team") + `<p class="wrap muted">Nothing to join.</p>`;
    const inTour = new Set(L.tour && L.tour.id === P.tour.id ? (L.tour.teams || []).map((t) => t.id) : []);
    const mine = (L.myTeams || []).filter((t) => t.manage);
    const rows = mine.map((t) => {
      const already = inTour.has(t.id);
      return `<li><button class="t-row ${P.team === t.id ? "picked" : ""}" data-act="tj-pick" data-id="${t.id}" ${already ? "disabled" : ""}>${badge(t)}
        <span class="t-text"><b>${esc(t.name)}</b><small>${already ? "Already in this tournament" : `${t.count} player${t.count === 1 ? "" : "s"} · ${teamRole(t)}`}</small></span>
        <span class="radio" aria-hidden="true"></span></button></li>`;
    }).join("");
    const head = P.mode === "invite"
      ? `<div class="invite-head">${badge(P.tour, "l")}<div><small class="eyebrow">You're invited to</small><h2>${esc(P.tour.name)}</h2></div></div>`
      : `<div class="invite-head">${badge(P.tour, "l")}<div><small class="eyebrow">Ask to join</small><h2>${esc(P.tour.name)}</h2></div></div>`;
    return lg.bar(P.mode === "invite" ? "Join tournament" : "Ask to join", "tj-cancel") + `<section class="wrap stack">
      ${head}
      ${mine.length ? `<h2 class="eyebrow">Which team?</h2><ul class="t-list">${rows}</ul>`
        : `<p class="muted">You don't run a team yet. Create one first; you can add the squad later.</p>`}
      <button class="btn" data-act="tj-newteam">${svg(ICON.plus, 18)} Create a new team</button>
      ${P.mode === "request" && mine.length ? field("Message to the organiser (optional)", `<input data-f="tjpick.note" value="${esc(form("tjpick").note || "")}" maxlength="200" placeholder="e.g. We can play weekends">`) : ""}
      ${status(form("tjpick"))}
      ${mine.length ? `<button class="btn btn-primary btn-big" data-act="tj-send" ${P.team && !P.busy ? "" : "disabled"}>${P.busy ? "Please wait…" : P.mode === "invite" ? "Join tournament" : "Send request"}</button>` : ""}
    </section>`;
  };

  async function sendPick() {
    const P = H.pick, f = form("tjpick");
    if (!P || !P.team) return;
    P.busy = true; f.error = ""; ui.render();
    const res = P.mode === "invite"
      ? await sb.rpc("join_with_invite", { invite: P.code, team: P.team })
      : await sb.rpc("request_to_join", { t: P.tour.id, team: P.team, note: (f.note || "").trim() || null });
    P.busy = false;
    if (res.error) { f.error = /function|schema/.test(res.error.message) ? "Joining needs a database update first. Ask the app admin." : res.error.message; return ui.render(); }
    const team = (L.myTeams || []).find((t) => t.id === P.team);
    ui.toast(P.mode === "invite" ? `${team ? team.name : "Your team"} is in ${P.tour.name}` : res.data === "pending" ? "Your request is already waiting for the organiser." : "Request sent. The organiser gets an alert.");
    H.pick = null; L.forms.tjpick = null; L.joinTeam = null;
    L.tour = null;
    lg.openTour(P.tour.id, "teams");
  }

  function startPick(mode, tour, code) {
    form("tjpick").error = "";
    H.pick = { mode, tour, code, team: null };
    const usable = (L.myTeams || []).filter((t) => t.manage);
    const pre = usable.find((t) => t.id === L.joinTeam) || (usable.length === 1 ? usable[0] : null);
    if (pre) H.pick.team = pre.id;
    ui.go("tjpick");
  }

  // ---------- Invite links ----------
  // Like player claim links: the code waits on this phone until the person has signed in
  // (and, for a team, set up their player profile).

  const PEND = "csa.pending";
  const getPending = () => { try { return JSON.parse(localStorage.getItem(PEND)); } catch (e) { return null; } };
  const setPending = (v) => { try { v ? localStorage.setItem(PEND, JSON.stringify(v)) : localStorage.removeItem(PEND); } catch (e) {} };

  function readLinks() {
    const hit = /^#\/(tjoin|tmjoin)\/([0-9a-f-]{36})$/i.exec(location.hash);
    if (!hit) return;
    history.replaceState(null, "", location.pathname + location.search);
    setPending({ kind: hit[1], code: hit[2] });
    runPending();
  }

  async function runPending() {
    const p = getPending();
    if (!p) return;
    if (!L.user) {
      const f = form("account", { mode: "up" });
      f.note = p.kind === "tjoin" ? "Sign in or create an account to put your team in the tournament." : "Sign in or create an account to join the team.";
      return ui.go("account");
    }
    if (L.me === undefined || L.myTeams == null) return; // meLoaded runs this again
    if (p.kind === "tmjoin") {
      if (!L.me) {
        H.note = "Set up your player profile, and you join the team straight after.";
        ui.lastTab = "profile";
        return ui.go("profile");
      }
      setPending(null);
      const { data, error } = await sb.rpc("join_team", { invite: p.code });
      if (error) return ui.toast(error.message);
      ui.toast("You're in the squad!");
      await lg.loadMyTeams();
      return CSA.squad.openTeam(data, "tab");
    }
    setPending(null);
    const { data, error } = await sb.rpc("tournament_for_invite", { invite: p.code });
    if (error || !data) return ui.toast(error ? error.message : "This invite link is not valid any more.");
    const t = await sb.from("tournaments").select("*").eq("id", data).single();
    if (t.error) return ui.toast(errText(t.error));
    await lg.openTour(data, "teams");
    if (L.tour && L.tour.roles.includes("organiser")) return ui.toast("This is your own tournament's invite link.");
    startPick("invite", t.data, p.code);
  }

  window.addEventListener("hashchange", readLinks);
  setTimeout(readLinks, 0);

  // ---------- Actions ----------

  Object.assign(ui.actions, {
    nav(d) {
      ui.lastTab = d.tab;
      if (d.tab === "tours" && L.user && !L.mine) lg.loadMine();
      if (d.tab === "home") lg.loadFeed();
      ui.go(d.tab);
      window.scrollTo(0, 0);
    },
    "find-tour"() {
      ui.actions.nav({ tab: "tours" });
      const el = document.getElementById("t-search");
      if (el) el.focus();
    },
    account() { if (L.user) ui.actions.nav({ tab: "profile" }); else ui.go("account"); },
    "account-up"() { const f = form("account"); f.mode = "up"; f.error = ""; ui.go("account"); },
    "tm-create"() { if (!lg.needUser()) return; L.forms.teamnew = null; ui.go("teamnew"); },
    "my-team"(d) { CSA.squad.openTeam(d.id, "tab"); },
    "me-edit"() { CSA.squad.editPlayer(L.me, "profile"); },
    "me-create": createMe,
    "ms-role"(d) { const f = form("mesetup"); f.role = f.role === d.v ? "" : d.v; ui.render(); },
    "ms-bat"(d) { const f = form("mesetup"); f.batting_style = f.batting_style === d.v ? "" : d.v; ui.render(); },
    "tj-request"() {
      if (!L.user) { form("account", { mode: "in" }).note = "Sign in to ask to join with your team."; return ui.go("account"); }
      startPick("request", L.tour.t);
    },
    "tj-pick"(d) { H.pick.team = d.id; ui.render(); },
    "tj-send": sendPick,
    "tj-cancel"() { const P = H.pick; H.pick = null; if (P) lg.openTour(P.tour.id); else ui.actions.home(); },
    "tj-newteam"() { L.forms.teamnew = null; H.pick.creating = true; ui.go("teamnew"); },
  });

  CSA.hub = {
    // After loading the user's profile and teams: finish any invite link that was waiting.
    meLoaded() { lg.rerender("home", "tours", "teams", "profile"); runPending(); },
    // A team made while picking one for a tournament goes back to the picker, already chosen.
    afterTeamCreated(id) {
      if (!H.pick || !H.pick.creating) return false;
      H.pick.creating = false; H.pick.team = id;
      ui.go("tjpick");
      return true;
    },
  };

  ui.render();
})();
