// Following matches from far away. Fans follow a match, a team or a tournament; the scorer's
// app keeps a small live score on the match (matches.live) and tells followers about wickets,
// milestones, the innings break and the result (notify_followers). Those alerts land behind
// the bell, and as push notifications on phones that allowed them.
(function () {
  const ui = CSA.ui, S = CSA.store, lg = CSA.league, C = CSA.commentary, E = CSA.engine;
  if (!lg) return;
  const sb = lg.sb, L = lg.L, cfg = CSA.config || {};
  const F = { set: null, busy: false };
  const BELL = (on) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`;
  const NOUN = { match: "this match", team: "this team", tournament: "this tournament" };

  // ---------- Following ----------

  async function loadFollows() {
    F.set = null;
    if (!L.user) return;
    const { data, error } = await sb.from("follows").select("kind, target");
    // A database without the follows table yet: following just stays off.
    F.set = new Set(error ? [] : data.map((r) => `${r.kind}:${r.target}`));
    F.missing = !!error;
    ui.render();
  }
  let last = null;
  setInterval(() => { const id = L.user && L.user.id; if (id !== last) { last = id; loadFollows(); if (id) registerPush(false); } }, 1000);

  const following = (kind, id) => !!(F.set && F.set.has(`${kind}:${id}`));

  // The bell button in a match, team or tournament header.
  ui.followBtn = (kind, id) => {
    if (!id || F.missing) return "";
    const on = following(kind, id);
    return `<button class="follow-btn ${on ? "on" : ""}" data-act="follow" data-k="${kind}" data-id="${id}" aria-pressed="${on}" aria-label="${on ? "Following" : "Follow"} ${NOUN[kind]}">${BELL(on)}<span>${on ? "Following" : "Follow"}</span></button>`;
  };

  async function toggle(kind, id) {
    if (!L.user) {
      lg.form("account", { mode: "up" }).note = "Create a free account to follow matches and get wicket and result alerts.";
      return ui.go("account");
    }
    if (F.busy || !F.set) return;
    F.busy = true;
    const key = `${kind}:${id}`, on = F.set.has(key);
    if (on) F.set.delete(key); else F.set.add(key);
    ui.render();
    const { error } = on
      ? await sb.from("follows").delete().eq("kind", kind).eq("target", id).eq("user_id", L.user.id)
      : await sb.from("follows").insert({ kind, target: id });
    F.busy = false;
    if (error) { if (on) F.set.add(key); else F.set.delete(key); ui.render(); return ui.toast(lg.errText(error)); }
    if (on) return ui.toast("Unfollowed");
    const pushed = await registerPush(true);
    ui.toast(pushed ? `You'll get alerts for wickets and the result.` : `Following. Alerts show behind the bell.`);
  }

  // ---------- Scorer side: live score and follower alerts ----------

  // Called after each successful sync of a tournament match. liveSaved: the sync already saved
  // the live score along with the balls (migration 0017).
  async function afterSync(rec, s, liveSaved) {
    if (!L.user || !rec.match.cloud || rec.readOnly) return;
    const id = rec.match.cloud.matchId;
    if (!rec.noLive && !liveSaved) {
      const { error } = await sb.from("matches").update({ live: C.snapshot(rec.match, s, rec.events) }).eq("id", id);
      // Migration 0014 not run yet: stop trying for this match.
      if (error && /live/.test(error.message || "")) rec.noLive = true;
    }
    const done = new Set(rec.liveSent || []);
    for (const m of C.moments(rec.match, s, rec.events)) {
      if (done.has(m.key)) continue;
      const { error } = await sb.rpc("notify_followers", { m: id, ev: m.ev, title: m.title, body: m.body, key: m.key });
      if (error && !error.code) return; // no signal: try on the next sync
      done.add(m.key);
      const cur = S.get(rec.match.id) || rec;
      cur.liveSent = rec.liveSent = [...done];
      S.save(cur);
    }
  }

  // ---------- Fan side: cheap refresh ----------
  // Every few seconds a fan asks only for the match's status, live score and sync version (a few
  // hundred bytes). When something changed, only the balls saved since the fan's last look are
  // downloaded (match_events.v, migration 0017), not the whole match again.
  async function refresh(rec) {
    const id = rec.match.cloud.matchId, versioned = rec.syncVersion != null;
    let head = null;
    if (!rec.noLive) {
      const { data, error } = await sb.from("matches").select(versioned ? "status, live, events_version, events_count" : "status, live").eq("id", id).single();
      if (error && /live/.test(error.message || "")) rec.noLive = true;
      else if (error) throw error;
      else {
        const moved = versioned && data.events_version !== rec.syncVersion;
        if (!moved && data.live && data.live.h === rec.liveH && data.status === rec.cloudStatus) return false;
        rec.liveH = data.live && data.live.h;
        head = data;
        if (moved && data.events_count != null) {
          const got = await sb.from("match_events").select("seq, event").eq("match_id", id).gt("v", rec.syncVersion);
          if (got.error) throw got.error;
          const events = rec.events.slice(0, data.events_count);
          for (const r of got.data) events[r.seq] = r.event;
          // A gap means a sync landed between the two requests: the full download below sorts it out.
          if (events.length === data.events_count && Array.from(events).every(Boolean)) return apply(rec, events, data.status, data.events_version);
        }
      }
    }
    const [m, events] = await Promise.all([
      head ? { data: head } : sb.from("matches").select("status").eq("id", id).single(),
      sb.from("match_events").select("seq, event").eq("match_id", id).order("seq"),
    ]);
    if (m.error || events.error) throw (m.error || events.error);
    return apply(rec, events.data.map((r) => r.event), m.data.status, versioned ? head && head.events_version : null);
  }

  function apply(rec, events, status, version) {
    const changed = events.length !== rec.events.length || status !== rec.cloudStatus
      || events.some((e, i) => JSON.stringify(e) !== JSON.stringify(rec.events[i]));
    rec.events = events;
    rec.cloudStatus = status;
    if (version != null) rec.syncVersion = version;
    return changed;
  }

  // ---------- Push notifications ----------
  // Android app: Firebase Cloud Messaging through the Capacitor plugin (when the app was built
  // with it). Browser / installed web app: Web Push with the key in config.js.

  const b64key = (s) => Uint8Array.from(atob((s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

  async function registerPush(ask) {
    if (!L.user) return false;
    try {
      const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications;
      if (P) {
        let perm = await P.checkPermissions();
        if (perm.receive !== "granted" && ask) perm = await P.requestPermissions();
        if (perm.receive !== "granted") return false;
        if (!registerPush.listening) {
          registerPush.listening = true;
          P.addListener("registration", (t) => sb.rpc("save_push", { kind: "fcm", endpoint: t.value, keys: null }).then(() => {}));
          P.addListener("pushNotificationActionPerformed", (a) => openFromPush(a.notification && a.notification.data));
        }
        if (P.createChannel) await P.createChannel({ id: "alerts", name: "Match alerts", importance: 4 }).catch(() => {});
        await P.register();
        return true;
      }
      if (!cfg.pushKey || !("serviceWorker" in navigator) || !("PushManager" in window)) return false;
      if (Notification.permission === "default" && ask) await Notification.requestPermission();
      if (Notification.permission !== "granted") return false;
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64key(cfg.pushKey) });
      const j = sub.toJSON();
      const { error } = await sb.rpc("save_push", { kind: "web", endpoint: j.endpoint, keys: j.keys });
      return !error;
    } catch (e) {
      console.warn("Push not set up:", e && e.message);
      return false;
    }
  }

  // Tapping a notification opens the match (or the alert's card).
  async function openFromPush(d) {
    if (!d) return;
    if (d.match && d.tournament) { await lg.openTour(d.tournament, "matches"); return lg.openMatch(d.match); }
    if (CSA.alerts) ui.actions.alerts();
  }

  Object.assign(ui.actions, {
    follow(d) { toggle(d.k, d.id); },
  });

  CSA.live = { afterSync, refresh, following, registerPush, openFromPush };
})();
