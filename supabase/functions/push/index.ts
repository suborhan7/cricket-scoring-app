// Sends a push notification for each new alert (notifications row): wickets and results for
// followers, card-ready alerts, join requests. The database calls this function from a trigger
// (migration 0015) with the alert's id; the alert is read back here with the service role, so
// the caller can't make up the text.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   PUSH_SECRET           shared with the database trigger (vault secret "push_secret")
//   VAPID_PUBLIC_KEY      Web Push key pair; the public one also goes in js/config.js (pushKey)
//   VAPID_PRIVATE_KEY
//   FCM_SERVICE_ACCOUNT   optional: the Firebase service account JSON, for the Android app
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const env = (k: string) => Deno.env.get(k) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

if (env("VAPID_PUBLIC_KEY")) webpush.setVapidDetails("mailto:alerts@cricpulse.app", env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));

// ---------- Firebase Cloud Messaging (HTTP v1) ----------

let fcmToken: { value: string; until: number } | null = null;
const b64url = (b: ArrayBuffer | string) =>
  btoa(typeof b === "string" ? b : String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function fcmAccess(sa: { client_email: string; private_key: string }) {
  if (fcmToken && fcmToken.until > Date.now() + 60_000) return fcmToken.value;
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${claim}`));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${b64url(sig)}` }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error("FCM sign-in failed");
  fcmToken = { value: j.access_token, until: Date.now() + j.expires_in * 1000 };
  return fcmToken.value;
}

// Returns false when the phone's token is dead and should be forgotten.
async function sendFcm(token: string, msg: { title: string; body: string; data: Record<string, string> }) {
  const raw = env("FCM_SERVICE_ACCOUNT");
  if (!raw) return true;
  const sa = JSON.parse(raw);
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${await fcmAccess(sa)}`, "content-type": "application/json" },
    body: JSON.stringify({ message: { token, notification: { title: msg.title, body: msg.body }, data: msg.data, android: { priority: "high", notification: { channel_id: "alerts" } } } }),
  });
  if (res.ok) return true;
  const err = await res.text();
  return !/UNREGISTERED|INVALID_ARGUMENT|NOT_FOUND/.test(err);
}

async function sendWeb(endpoint: string, keys: { p256dh: string; auth: string }, payload: string) {
  if (!env("VAPID_PUBLIC_KEY")) return true;
  try {
    await webpush.sendNotification({ endpoint, keys }, payload, { TTL: 3600, urgency: "high" });
    return true;
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    return !(code === 404 || code === 410);
  }
}

Deno.serve(async (req) => {
  if (!env("PUSH_SECRET") || req.headers.get("x-push-secret") !== env("PUSH_SECRET")) return new Response("no", { status: 401 });
  const { id } = await req.json().catch(() => ({}));
  if (!id) return new Response("no id", { status: 400 });

  const { data: n } = await db.from("notifications").select("id, user_id, kind, title, body, data, dedupe").eq("id", id).maybeSingle();
  if (!n) return new Response("gone", { status: 200 });
  const { data: subs } = await db.from("push_subscriptions").select("endpoint, kind, keys").eq("user_id", n.user_id);
  if (!subs || !subs.length) return new Response("no devices", { status: 200 });

  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(n.data || {})) if (v != null && typeof v !== "object") data[k] = String(v);
  data.kind = n.kind;
  // Alerts about the same match replace each other, so a follower sees the latest, not a pile.
  const tag = data.match ? `m-${data.match}` : `a-${n.id}`;
  const payload = JSON.stringify({ title: n.title, body: n.body, tag, data });

  const dead: string[] = [];
  await Promise.all(subs.map(async (s) => {
    const ok = s.kind === "fcm" ? await sendFcm(s.endpoint, { title: n.title, body: n.body, data }) : await sendWeb(s.endpoint, s.keys, payload);
    if (!ok) dead.push(s.endpoint);
  }));
  if (dead.length) await db.from("push_subscriptions").delete().in("endpoint", dead);
  return new Response(JSON.stringify({ sent: subs.length - dead.length }), { headers: { "content-type": "application/json" } });
});
