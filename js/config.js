// Supabase project the app talks to. Both values are public by design: the database's
// security rules (supabase/migrations) decide what each user may read or change.
// Never put the service_role / secret key here.
window.CSA = Object.assign(window.CSA || {}, {
  config: {
    // The app's name everywhere in the app. (Also in index.html, manifest.webmanifest,
    // capacitor.config.json and privacy.html.)
    appName: "CricPulse",
    supabaseUrl: "https://hlditboaogmrkxmwmyqu.supabase.co",
    // The web address password-reset emails link back to. Add it under Supabase →
    // Authentication → URL Configuration → Redirect URLs.
    siteUrl: "https://cricket-scoring-app-two.vercel.app/",
    supabaseKey: "sb_publishable_lrQQ49m6cessvzu1yqaXoA_SBv44JEh",
    // Turn on after enabling the Google provider in Supabase (Authentication → Sign In / Providers).
    googleLogin: false,
    // Web Push public key (VAPID). Public by design; its private half is a secret of the
    // "push" Edge Function (supabase/functions/push).
    pushKey: "BDm74Zs38RpPKEMz5fXk85VfKzBRj1-3CVCy3ngvVsuP_2i5sewJxwCXfWljXmmo5mg_sNpwymr8VAgEe2YM9uI",
  },
});
