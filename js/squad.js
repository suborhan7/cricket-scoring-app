// Team and player pages: squads, player profiles with photos, editing teams, adding players
// (typed or from a spreadsheet) and the invite link a player uses to claim their profile.
(function () {
  if (!CSA.league) return;
  const ui = CSA.ui, esc = ui.esc;
  const { sb, L, form, field, status, bar, badge, publicUrl, errText, shrink, upload, logoPicker, colorPair } = CSA.league;
  const lg = CSA.league;

  const ROLES = [["batter", "Batter"], ["bowler", "Bowler"], ["allrounder", "All-rounder"], ["keeper", "Wicket-keeper"]];
  const ROLE_NAME = Object.fromEntries(ROLES);
  const BOWLING = ["Right-arm fast", "Right-arm medium", "Right-arm off-spin", "Right-arm leg-spin", "Left-arm fast", "Left-arm medium", "Left-arm orthodox", "Left-arm wrist-spin"];

  const S = { team: null, player: null }; // the open team page and player page
  const svg = (d) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    link: svg('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
    plus: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>'),
    trophy: svg('<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.7V17c0 .6-.5 1-1 1.2C7.8 18.8 7 20.2 7 22M14 14.7V17c0 .6.5 1 1 1.2 1.2.6 2 2 2 3.8"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>'),
    edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  };

  const photoUrl = (p) => publicUrl("photos", p.photo_path);
  function avatar(p, size) {
    const initials = esc(p.full_name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase());
    return p.photo_path
      ? `<img class="avatar avatar-${size || "s"}" src="${esc(photoUrl(p))}" alt="" loading="lazy" data-i="${initials}"
          onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:this.className,textContent:this.dataset.i}))">`
      : `<span class="avatar avatar-${size || "s"}">${initials}</span>`;
  }
  const playerLine = (p) => [ROLE_NAME[p.role], p.batting_style ? `${p.batting_style === "left" ? "Left" : "Right"}-hand bat` : "", p.bowling_style].filter(Boolean).join(" · ");
  // The team's creator and captain manage it, and so do organisers of the tournament it was opened from.
  function canManage() {
    const t = S.team && S.team.t;
    if (t && L.user && (t.created_by === L.user.id || (L.me && t.captain_player_id === L.me.id))) return true;
    return !!(S.team && S.team.from === "tour" && lg.isOrganiser());
  }
  const fromTour = () => !!(S.team && S.team.from === "tour" && L.tour);

  // ---------- Team page ----------

  // `from` is "tour" when opened inside a tournament (back goes there), otherwise "tab".
  async function openTeam(id, from) {
    from = from || (S.team && S.team.id === id && S.team.from) || (lg.onScreen("tour") ? "tour" : "tab");
    S.team = { id, from, loading: true };
    ui.go("team", { id });
    const inTour = from === "tour" && L.tour;
    const [team, squad, group, tours, reqs] = await Promise.all([
      sb.from("teams").select("*").eq("id", id).single(),
      sb.from("team_players").select("joined_at, players(*)").eq("team_id", id).order("joined_at"),
      inTour ? sb.from("tournament_teams").select("group_name").eq("tournament_id", L.tour.id).eq("team_id", id).maybeSingle() : Promise.resolve({ data: null }),
      sb.from("tournament_teams").select("tournaments(id, name, short_name, handle, kind, overs_per_side, logo_path, primary_color, secondary_color)").eq("team_id", id),
      L.user ? sb.from("join_requests").select("id, status, tournaments(id, name, short_name)").eq("team_id", id).eq("status", "pending") : Promise.resolve({ data: [] }),
    ]);
    if (!S.team || S.team.id !== id) return;
    const err = team.error || squad.error;
    S.team = { id, from, loading: false, error: err ? errText(err) : "", t: team.data, group: group.data && group.data.group_name,
      players: (squad.data || []).map((r) => r.players).filter(Boolean),
      tours: (tours.data || []).map((r) => r.tournaments).filter(Boolean),
      pending: (reqs.data || []).map((r) => r.tournaments).filter(Boolean) };
    lg.rerender("team");
  }

  ui.screens.team = () => {
    const T = S.team, back = fromTour() ? `data-id="${L.tour.id}"` : "";
    const head = (title) => bar(title, fromTour() ? "team-back" : "home", back);
    if (!T || T.loading) return head("Team") + `<p class="wrap muted">Loading…</p>`;
    if (T.error) return head("Team") + `<p class="wrap error">${esc(T.error)}</p>`;
    const t = T.t, cap = T.players.find((p) => p.id === t.captain_player_id);
    const hero = `<div class="hero" style="--c1:${t.primary_color || "#0F7A45"};--c2:${t.secondary_color || "#0E1A14"}">${badge(t, "l")}
      <div class="hero-text"><h2>${esc(t.name)}</h2><p>${T.players.length} player${T.players.length === 1 ? "" : "s"}${cap ? ` · Captain ${esc(cap.full_name)}` : ""}${T.group ? ` · Group ${esc(T.group)}` : ""}</p></div></div>`;
    const rows = T.players.map((p) => `<li><button class="person person-btn" data-act="p-open" data-id="${p.id}">${avatar(p)}
      <span class="t-text"><b>${esc(p.full_name)}${p.id === t.captain_player_id ? ` <span class="tag">C</span>` : ""}${p.role === "keeper" ? ` <span class="tag">WK</span>` : ""}</b>
      <small>${esc(playerLine(p)) || "Tap to add details"}</small></span>${p.jersey_no != null ? `<span class="jersey">${p.jersey_no}</span>` : ""}</button></li>`).join("");
    const manage = canManage();
    const tools = manage ? `<div class="actions-grid">
        <button class="action" data-act="team-invite">${ICON.link}<span>Invite players</span></button>
        <button class="action" data-act="players-add">${ICON.plus}<span>Add players</span></button>
        <button class="action" data-act="team-join-tour">${ICON.trophy}<span>Join tournament</span></button>
        <button class="action" data-act="team-edit">${ICON.edit}<span>Edit team</span></button></div>` : "";
    const tours = T.tours.length ? `<h2 class="eyebrow">Tournaments</h2><ul class="t-list">${T.tours.map((x) => `<li><button class="t-row" data-act="t-open" data-id="${x.id}">${badge(x)}
        <span class="t-text"><b>${esc(x.name)}</b><small>${x.handle ? `@${esc(x.handle)} · ` : ""}${x.kind === "series" ? "Series" : "Tournament"}</small></span><span class="chev" aria-hidden="true">›</span></button></li>`).join("")}</ul>` : "";
    const pending = manage && T.pending.length ? `<p class="note">Waiting for approval: ${T.pending.map((x) => esc(x.short_name || x.name)).join(", ")}</p>` : "";
    return head(esc(t.short_name)) + hero + `<section class="wrap stack">${tools}${pending}
      <h2 class="eyebrow">Squad</h2>
      ${rows ? `<ul class="people">${rows}</ul>` : `<p class="muted">No players yet.${manage ? " Send the invite link and players add themselves." : ""}</p>`}
      ${tours}</section>`;
  };

  // ---------- Edit team ----------

  ui.screens.teamedit = () => {
    const f = L.forms.teamedit;
    return bar("Edit team", "team-reopen") + `<section class="wrap stack">
      <div class="card stack-s">
        ${field("Team name", `<input data-f="teamedit.name" value="${esc(f.name)}" maxlength="60">`)}
        ${field("Short name", `<input data-f="teamedit.short" value="${esc(f.short)}" maxlength="5">`)}
        ${fromTour() ? field("Group", `<input data-f="teamedit.group" value="${esc(f.group || "")}" maxlength="10" placeholder="e.g. A">`) : ""}
        ${field("Captain", `<select data-f="teamedit.captain"><option value="">None</option>${S.team.players.map((p) => `<option value="${p.id}" ${p.id === f.captain ? "selected" : ""}>${esc(p.full_name)}</option>`).join("")}</select>`)}
      </div>
      <div class="card stack-s"><span class="eyebrow">Logo and colours</span>${logoPicker(f, "teamedit")}${colorPair(f, "teamedit")}</div>
      ${status(f)}
      <button class="btn btn-primary btn-big" data-act="teamedit-save" ${f.busy ? "disabled" : ""}>${f.busy ? "Saving…" : "Save"}</button></section>`;
  };

  async function saveTeamEdit() {
    const f = L.forms.teamedit, T = S.team;
    if ((f.name || "").trim().length < 2) { f.error = "Give the team a name."; return ui.render(); }
    f.busy = true; f.error = ""; ui.render();
    try {
      const upd = { name: f.name.trim(), short_name: (f.short || "").trim().slice(0, 5).toUpperCase() || ui.shortName(f.name), primary_color: f.c1, secondary_color: f.c2, captain_player_id: f.captain || null };
      if (f.logoBlob) upd.logo_path = await upload("logos", f.logoBlob);
      const r = await sb.from("teams").update(upd).eq("id", T.id);
      if (r.error) throw r.error;
      if (fromTour()) {
        const g = await sb.from("tournament_teams").update({ group_name: (f.group || "").trim() || null }).eq("tournament_id", L.tour.id).eq("team_id", T.id);
        if (g.error) throw g.error;
      }
      L.forms.teamedit = null;
      ui.toast("Team saved");
      lg.loadMyTeams();
      if (fromTour()) lg.openTour(L.tour.id, "teams").then(() => openTeam(T.id, "tour")); else openTeam(T.id);
    } catch (e) { f.busy = false; f.error = errText(e); ui.render(); }
  }

  // ---------- Add players ----------

  ui.screens.playersadd = () => {
    const f = form("playersadd", {}), n = lg.parsePlayers(f.players).length;
    return bar("Add players", "team-reopen") + `<section class="wrap stack">
      <div class="card stack-s">
        ${field("Players, one per line", `<textarea data-f="playersadd.players" rows="10" placeholder="Tanvir Ahmed, all-rounder, R, Right-arm medium, 7">${esc(f.players || "")}</textarea>`,
          `<span data-pcount>${n} player${n === 1 ? "" : "s"}</span>. Just names are fine. From a spreadsheet, paste rows in this order: name, role, batting (R or L), bowling, jersey.`)}
        <label class="btn btn-small file-btn">Import a CSV file<input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" data-csv="playersadd" hidden></label>
      </div>
      ${status(f)}
      <button class="btn btn-primary btn-big" data-act="playersadd-save" ${f.busy ? "disabled" : ""}>${f.busy ? "Adding…" : "Add to squad"}</button></section>`;
  };

  async function savePlayersAdd() {
    const f = form("playersadd"), list = lg.parsePlayers(f.players);
    if (!list.length) { f.error = "Add at least one name."; return ui.render(); }
    f.busy = true; f.error = ""; ui.render();
    try {
      await lg.addPlayers(S.team.id, list);
      L.forms.playersadd = null;
      ui.toast(`${list.length} player${list.length === 1 ? "" : "s"} added`);
      openTeam(S.team.id);
    } catch (e) { f.busy = false; f.error = errText(e); ui.render(); }
  }

  // ---------- Player page ----------

  async function openPlayer(id) {
    S.player = { id, loading: true };
    ui.go("player", { id });
    const [p, teams] = await Promise.all([
      sb.from("players").select("*").eq("id", id).single(),
      sb.from("team_players").select("teams(id, name, short_name, logo_path, primary_color, secondary_color, captain_player_id)").eq("player_id", id),
    ]);
    if (!S.player || S.player.id !== id) return;
    const err = p.error || teams.error;
    S.player = { id, loading: false, error: err ? errText(err) : "", p: p.data, teams: (teams.data || []).map((r) => r.teams).filter(Boolean) };
    lg.rerender("player");
  }

  // This tournament's numbers for one player, from the finished-match summaries.
  function tourStats(id) {
    if (!L.tour || !L.tour.matches) return null;
    const all = CSA.stats.leaders(L.tour.matches);
    return { bat: all.runs.find((x) => x.id === id), bowl: all.wickets.find((x) => x.id === id) };
  }

  ui.screens.player = () => {
    const P = S.player;
    const back = S.team ? "team-reopen" : "home";
    if (!P || P.loading) return bar("Player", back) + `<p class="wrap muted">Loading…</p>`;
    if (P.error) return bar("Player", back) + `<p class="wrap error">${esc(P.error)}</p>`;
    const p = P.p, mine = L.user && p.claimed_by === L.user.id, team = P.teams[0];
    const st = tourStats(p.id);
    const tile = (n, label) => `<div class="tile"><b>${n}</b><span>${label}</span></div>`;
    const stats = st && (st.bat || st.bowl) ? `<h2 class="eyebrow">In ${esc(L.tour.t.short_name || L.tour.t.name)}</h2><div class="tiles">
      ${st.bat ? tile(st.bat.runs, "Runs") + tile(st.bat.best + (st.bat.bestOut ? "" : "*"), "Best") + tile(st.bat.sr.toFixed(0), "Strike rate") : ""}
      ${st.bowl && st.bowl.wickets ? tile(st.bowl.wickets, "Wickets") + tile(`${st.bowl.bestW}/${st.bowl.bestR}`, "Best") + tile(st.bowl.econ.toFixed(2), "Economy") : ""}</div>` : "";
    const facts = [["Role", ROLE_NAME[p.role]], ["Batting", p.batting_style && (p.batting_style === "left" ? "Left-hand" : "Right-hand")], ["Bowling", p.bowling_style], ["Jersey", p.jersey_no]]
      .filter(([, v]) => v != null && v !== "").map(([k, v]) => `<div class="fact"><span>${k}</span><b>${esc(String(v))}</b></div>`).join("");
    const manage = canManage(), editable = manage || mine;
    const actions = [
      editable ? `<button class="btn" data-act="player-edit">Edit profile</button>` : "",
      manage && !p.claimed_by ? `<button class="btn" data-act="player-invite">Invite link</button>` : "",
      manage && S.team && S.team.t && S.team.t.captain_player_id !== p.id ? `<button class="btn btn-ghost" data-act="player-captain">Make captain</button>` : "",
      manage && S.team ? `<button class="btn btn-danger" data-act="player-remove">Remove from ${esc(S.team.t.short_name)}</button>` : "",
    ].filter(Boolean).join("");
    const color = team ? `--c1:${team.primary_color || "#0F7A45"};--c2:${team.secondary_color || "#0E1A14"}` : "--c1:#0F7A45;--c2:#0E1A14";
    return bar(esc(p.full_name), back) + `<div class="hero hero-player" style="${color}">${avatar(p, "l")}
      <div class="hero-text"><h2>${esc(p.full_name)}</h2><p>${team ? esc(team.name) : "No team"}${p.claimed_by ? " · Verified player" : ""}</p></div>
      ${p.jersey_no != null ? `<span class="hero-jersey">${p.jersey_no}</span>` : ""}</div>
      <section class="wrap stack">
        ${facts ? `<div class="facts">${facts}</div>` : ""}
        ${stats}
        ${mine ? `<p class="note">This is you. You can change your photo and details.</p>` : ""}
        ${actions ? `<div class="stack-s">${actions}</div>` : ""}
      </section>`;
  };

  // ---------- Edit player ----------

  ui.screens.playeredit = () => {
    const f = L.forms.playeredit;
    const chip = (act, v, cur, label) => `<button class="chip ${v === cur ? "on" : ""}" data-act="${act}" data-v="${v}">${label}</button>`;
    return bar("Edit profile", f.back === "profile" ? "home" : "player-reopen") + `<section class="wrap stack">
      <div class="card stack-s photo-pick">
        ${f.photoUrl ? `<img class="avatar avatar-l" src="${f.photoUrl}" alt="Photo preview">` : avatar(S.player.p, "l")}
        <label class="btn btn-small file-btn">${f.photoUrl || S.player.p.photo_path ? "Change photo" : "Add photo"}<input type="file" accept="image/*" data-photo="1" hidden></label>
        <small class="muted">A clear face photo works best on cards.</small>
      </div>
      <div class="card stack-s">
        ${field("Full name", `<input data-f="playeredit.full_name" value="${esc(f.full_name)}" maxlength="60">`)}
        <span class="eyebrow">Role</span><div class="chips">${ROLES.map(([v, l]) => chip("pe-role", v, f.role, l)).join("")}</div>
        <span class="eyebrow">Batting</span><div class="chips">${chip("pe-bat", "right", f.batting_style, "Right-hand")}${chip("pe-bat", "left", f.batting_style, "Left-hand")}</div>
        ${field("Bowling", `<select data-f="playeredit.bowling_style"><option value="">Doesn't bowl</option>${BOWLING.map((b) => `<option ${b === f.bowling_style ? "selected" : ""}>${b}</option>`).join("")}</select>`)}
        ${field("Jersey number", `<input data-f="playeredit.jersey_no" type="number" inputmode="numeric" min="0" max="999" value="${esc(f.jersey_no == null ? "" : f.jersey_no)}">`)}
      </div>
      ${status(f)}
      <button class="btn btn-primary btn-big" data-act="playeredit-save" ${f.busy ? "disabled" : ""}>${f.busy ? "Saving…" : "Save"}</button></section>`;
  };

  // Square crop from the middle of the photo, so every card frames it the same way.
  async function squarePhoto(file) {
    const { canvas } = await shrink(file, 1200);
    const side = Math.min(canvas.width, canvas.height), out = document.createElement("canvas");
    out.width = out.height = Math.min(600, side);
    out.getContext("2d").drawImage(canvas, (canvas.width - side) / 2, (canvas.height - side) / 2.6, side, side, 0, 0, out.width, out.height);
    const blob = await new Promise((r) => out.toBlob(r, "image/jpeg", 0.88));
    return { blob, url: URL.createObjectURL(blob) };
  }

  async function savePlayerEdit() {
    const f = L.forms.playeredit, id = S.player.id;
    if ((f.full_name || "").trim().length < 2) { f.error = "Enter the player's name."; return ui.render(); }
    const jersey = f.jersey_no === "" || f.jersey_no == null ? null : parseInt(f.jersey_no, 10);
    if (jersey != null && !(jersey >= 0 && jersey <= 999)) { f.error = "Jersey number must be 0 to 999."; return ui.render(); }
    f.busy = true; f.error = ""; ui.render();
    try {
      const upd = { full_name: f.full_name.trim(), role: f.role || null, batting_style: f.batting_style || null, bowling_style: f.bowling_style || null, jersey_no: jersey };
      if (f.photoBlob) upd.photo_path = await upload("photos", f.photoBlob);
      const { error } = await sb.from("players").update(upd).eq("id", id);
      if (error) throw error;
      const toProfile = L.forms.playeredit.back === "profile";
      L.forms.playeredit = null;
      ui.toast("Profile saved");
      if (L.me && L.me.id === id) lg.loadMe();
      if (toProfile) ui.go("profile"); else openPlayer(id);
    } catch (e) { f.busy = false; f.error = errText(e); ui.render(); }
  }

  // ---------- Claiming a profile ----------
  // Links look like …/#/claim/<code>. The code waits on this phone until the person signs in.

  const CLAIM_KEY = "csa.claim";
  function readClaimLink() {
    const hit = /^#\/claim\/([0-9a-f-]{36})$/i.exec(location.hash);
    if (!hit) return;
    history.replaceState(null, "", location.pathname + location.search);
    try { localStorage.setItem(CLAIM_KEY, hit[1]); } catch (e) {}
    tryClaim();
  }
  async function tryClaim() {
    let code = null;
    try { code = localStorage.getItem(CLAIM_KEY); } catch (e) {}
    if (!code) return;
    if (!L.user) {
      const f = form("account", { mode: "up" });
      f.note = "Sign in or create an account to claim your player profile.";
      ui.go("account");
      return;
    }
    const { data, error } = await sb.rpc("claim_player", { invite: code });
    try { localStorage.removeItem(CLAIM_KEY); } catch (e) {}
    if (error) return ui.toast(error.message);
    ui.toast(`Welcome, ${data.full_name}! This profile is now yours.`);
    lg.loadMe();
    openPlayer(data.player_id);
  }
  sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_IN") setTimeout(tryClaim, 300); });
  window.addEventListener("hashchange", readClaimLink);
  setTimeout(readClaimLink, 0);

  // ---------- Actions ----------

  Object.assign(ui.actions, {
    "team-open"(d) { openTeam(d.id); },
    "team-back"() { if (L.tour) lg.openTour(L.tour.id, "teams"); else ui.actions.home(); },
    async "team-invite"() {
      const t = S.team.t;
      const { data, error } = await sb.rpc("team_invite_code", { team: t.id, fresh: false });
      if (error) return ui.toast(/function|schema/.test(error.message) ? "Invite links need a database update first." : errText(error));
      lg.shareLink(`Join ${t.name}`, `Join ${t.name} on ${ui.APP}:`, `${location.origin}${location.pathname}#/tmjoin/${data}`, "Invite link copied. Send it in your team group.");
    },
    "team-join-tour"() {
      L.joinTeam = S.team.id;
      ui.toast("Find the tournament, open it and tap Ask to join. Or open the organiser's invite link.");
      ui.actions.nav({ tab: "tours" });
    },
    "team-reopen"() { if (S.team) openTeam(S.team.id); else ui.actions["team-back"](); },
    "team-edit"() {
      const t = S.team.t;
      L.forms.teamedit = { name: t.name, short: t.short_name, group: S.team.group || "", captain: t.captain_player_id || "", c1: t.primary_color || "#0F7A45", c2: t.secondary_color || "#0E1A14", logoUrl: t.logo_path ? publicUrl("logos", t.logo_path) : "", colorsEdited: true };
      ui.go("teamedit");
    },
    "teamedit-save": saveTeamEdit,
    "players-add"() { L.forms.playersadd = null; ui.go("playersadd"); },
    "playersadd-save": savePlayersAdd,
    "p-open"(d) { openPlayer(d.id); },
    "player-reopen"() { openPlayer(S.player.id); },
    "player-edit"() {
      const p = S.player.p;
      L.forms.playeredit = { full_name: p.full_name, role: p.role || "", batting_style: p.batting_style || "", bowling_style: p.bowling_style || "", jersey_no: p.jersey_no };
      ui.go("playeredit");
    },
    "pe-role"(d) { const f = L.forms.playeredit; f.role = f.role === d.v ? "" : d.v; ui.render(); },
    "pe-bat"(d) { const f = L.forms.playeredit; f.batting_style = f.batting_style === d.v ? "" : d.v; ui.render(); },
    "playeredit-save": savePlayerEdit,
    async "player-invite"() {
      const p = S.player.p;
      const { data, error } = await sb.rpc("player_invite_code", { p: p.id });
      if (error) return ui.toast(error.message);
      const url = `${location.origin}${location.pathname}#/claim/${data}`;
      const text = `${p.full_name}, claim your player profile to get your own stats and milestone cards:`;
      try {
        if (navigator.share) return await navigator.share({ title: "Claim your player profile", text, url });
        await navigator.clipboard.writeText(`${text} ${url}`);
        ui.toast("Invite link copied. Send it to the player.");
      } catch (e) { if (!e || e.name !== "AbortError") window.prompt("Copy this invite link", url); }
    },
    async "player-captain"() {
      const { error } = await sb.from("teams").update({ captain_player_id: S.player.id }).eq("id", S.team.id);
      if (error) return ui.toast(errText(error));
      S.team.t.captain_player_id = S.player.id;
      ui.toast(`${S.player.p.full_name} is now captain`);
      ui.render();
    },
    async "player-remove"() {
      if (!confirm(`Remove ${S.player.p.full_name} from ${S.team.t.name}? Their past scores stay.`)) return;
      const { error } = await sb.from("team_players").delete().eq("team_id", S.team.id).eq("player_id", S.player.id);
      if (error) return ui.toast(errText(error));
      ui.toast("Removed from the squad");
      openTeam(S.team.id);
    },
  });

  document.addEventListener("change", async (ev) => {
    const t = ev.target;
    if (t.dataset.photo && t.files && t.files[0] && L.forms.playeredit) {
      try {
        const out = await squarePhoto(t.files[0]);
        Object.assign(L.forms.playeredit, { photoBlob: out.blob, photoUrl: out.url });
      } catch (e) { L.forms.playeredit.error = "That file couldn't be read as a photo. Try a JPG or PNG."; }
      ui.render();
    }
  });
  document.addEventListener("input", (ev) => {
    if (ev.target.dataset.f !== "playersadd.players") return;
    const c = document.querySelector("[data-pcount]"), n = lg.parsePlayers(ev.target.value).length;
    if (c) c.textContent = `${n} player${n === 1 ? "" : "s"}`;
  });

  // The profile tab edits the user's own player with the same form.
  function editPlayer(p, back) {
    S.player = { id: p.id, loading: false, p, teams: [] };
    L.forms.playeredit = { back, full_name: p.full_name, role: p.role || "", batting_style: p.batting_style || "", bowling_style: p.bowling_style || "", jersey_no: p.jersey_no };
    ui.go("playeredit");
  }

  CSA.squad = { openTeam, openPlayer, editPlayer, avatar, ROLES, ROLE_NAME, BOWLING, playerLine, squarePhoto };
})();
