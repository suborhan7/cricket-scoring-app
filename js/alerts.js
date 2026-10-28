// Card-ready alerts. When a synced match has a new milestone or a result, the scorer's
// app asks the database (notify_card) to tell the organisers, scorers, the captain and
// the player. Everyone sees theirs behind the bell on the home screen.
(function () {
  const ui = CSA.ui, esc = ui.esc, S = CSA.store, lg = CSA.league;
  if (!lg) return;
  const sb = lg.sb, L = lg.L;
  const A = { list: null, loading: false, error: "" };
  const WORD = { fifty: "Fifty", hundred: "Hundred", threefor: "Three-for", fivefor: "Five-for" };
  const BELL = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`;

  // ---------- Sending ----------

  // Called after each successful sync of a tournament match. Each card is sent once per match.
  async function afterSync(rec, s) {
    if (!L.user || !rec.match.cloud || rec.readOnly) return;
    const c = rec.match.cloud, done = new Set(rec.alerted || []), label = `${rec.match.teams[0].short} v ${rec.match.teams[1].short}`;
    const todo = s.milestones.map((ms) => {
      const who = rec.match.teams[ms.team].players[ms.player];
      const fig = ms.wickets != null ? `${ms.wickets}/${ms.runs}` : `${ms.runs} (${ms.balls})`;
      return { key: `${ms.kind}:${ms.team}:${ms.player}`, kind: "milestone", title: `${WORD[ms.kind]} card ready`, body: `${who} ${fig}, ${label}`,
        player: (c.playerIds[ms.team] || [])[ms.player] || null, card: { mk: ms.kind, team: ms.team, player: ms.player } };
    });
    if (s.result) todo.push({ key: "result", kind: "result", title: "Result card ready", body: `${label}: ${s.result.text}`, player: null, card: {} });
    for (const a of todo) {
      if (done.has(a.key)) continue;
      const { error } = await sb.rpc("notify_card", { m: c.matchId, card_kind: a.kind, title: a.title, body: a.body, player: a.player, card: Object.assign({ key: a.key }, a.card) });
      // No signal: try again on the next sync. Any answer from the server (sent, refused, or the
      // database not updated yet) counts as done, so a match never sends the same card twice.
      if (error && !error.code) return;
      done.add(a.key);
      const cur = S.get(rec.match.id) || rec;
      cur.alerted = rec.alerted = [...done];
      S.save(cur);
    }
  }

  // ---------- Reading ----------

  async function load() {
    if (!L.user) { A.list = null; return; }
    A.loading = true;
    const { data, error } = await sb.from("notifications").select("*").eq("user_id", L.user.id).order("created_at", { ascending: false }).limit(50);
    A.loading = false;
    // A database without the alerts table yet just shows no alerts.
    A.error = error && !/notifications/.test(error.message || "") ? lg.errText(error) : "";
    A.list = (data || []).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    if (ui.view().screen === "home" || ui.view().screen === "alerts") ui.render();
  }
  const unread = () => (A.list || []).filter((n) => !n.read_at).length;

  // Check for new alerts when the app opens, on sign-in, and every minute while it is open.
  let last = null;
  setInterval(() => {
    const id = L.user && L.user.id;
    if (id !== last) { last = id; A.list = null; load(); }
  }, 1000);
  setInterval(() => { if (L.user && document.visibilityState === "visible") load(); }, 60 * 1000);

  function bell() {
    if (!L.user) return "";
    const n = unread();
    return `<button class="icon-btn bell" data-act="alerts" aria-label="Alerts${n ? `, ${n} new` : ""}">${BELL}${n ? `<span class="bell-dot">${n > 9 ? "9+" : n}</span>` : ""}</button>`;
  }

  function ago(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }

  ui.screens.alerts = () => {
    const list = A.list || [];
    const rows = list.map((n) => `<li><button class="t-row alert-row ${n.read_at ? "" : "unread"}" data-act="alert-open" data-id="${n.id}">
        <span class="alert-icon">${n.kind === "result" ? "★" : "▲"}</span>
        <span class="t-text"><b>${esc(n.title)}</b><small>${esc(n.body)}</small><small class="alert-when">${ago(n.created_at)}</small></span>
        ${n.read_at ? "" : `<span class="dot-new" aria-label="New"></span>`}</button></li>`).join("");
    const body = A.list == null ? `<p class="muted">Loading…</p>`
      : A.error ? `<p class="error">${esc(A.error)}</p>`
      : rows ? `<ul class="t-list">${rows}</ul>`
      : `<div class="card stack-s"><b>No alerts yet</b><p class="muted">When a player in your tournament scores a fifty or takes three wickets, or a match ends, the card shows up here ready to share.</p></div>`;
    return `<header class="bar"><button class="icon-btn" data-act="home" aria-label="Back">←</button><h1>Alerts</h1>
        ${unread() ? `<button class="btn btn-small bar-btn" data-act="alerts-read">Mark all read</button>` : ""}</header>
      <section class="wrap stack">${body}</section>`;
  };

  Object.assign(ui.actions, {
    alerts() { ui.go("alerts"); load(); },
    async "alerts-read"() {
      const now = new Date().toISOString();
      (A.list || []).forEach((n) => { n.read_at = n.read_at || now; });
      ui.render();
      await sb.from("notifications").update({ read_at: now }).eq("user_id", L.user.id);
    },
    async "alert-open"(d) {
      const n = (A.list || []).find((x) => String(x.id) === d.id);
      if (!n) return;
      if (!n.read_at) { n.read_at = new Date().toISOString(); sb.from("notifications").update({ read_at: n.read_at }).eq("id", n.id).then(() => {}); }
      if (CSA.studio) CSA.studio.openAlert(n.data || {});
    },
  });

  CSA.alerts = { afterSync, bell, load };
})();
