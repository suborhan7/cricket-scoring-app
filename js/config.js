// Supabase project the app talks to. Both values are public by design: the database's
// security rules (supabase/migrations) decide what each user may read or change.
// Never put the service_role / secret key here.
window.CSA = Object.assign(window.CSA || {}, {
  config: {
    // The app's name everywhere in the app. (Also in index.html, manifest.webmanifest,
    // capacitor.config.json and privacy.html.)
    appName: "Cricket Scorer",
    supabaseUrl: "https://hlditboaogmrkxmwmyqu.supabase.co",
    supabaseKey: "sb_publishable_lrQQ49m6cessvzu1yqaXoA_SBv44JEh",
    // Turn on after enabling the Google provider in Supabase (Authentication → Sign In / Providers).
    googleLogin: false,
  },
});
