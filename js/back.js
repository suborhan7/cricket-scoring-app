// The phone's back button (and the back swipe) goes back one page inside the app.
// It does what the ← button at the top of the page does, closes an open sheet first,
// takes a main tab back to Home, and only leaves the app from Home.
(function () {
  const ui = CSA.ui;
  const $app = document.getElementById("app");
  const $sheet = document.getElementById("sheet");

  const atHome = () => $sheet.hidden && ui.view().screen === "home";

  // One step back. Returns false on Home, where back should leave the app.
  function back() {
    if (!$sheet.hidden) {
      const x = $sheet.querySelector('[data-act="close-sheet"]');
      if (x) x.click(); // a sheet without a close button is a choice the scorer has to make
      return true;
    }
    const btn = $app.querySelector('header.bar [aria-label="Back"]');
    if (btn && !btn.disabled) { btn.click(); return true; }
    if (ui.view().screen !== "home") { ui.actions.nav({ tab: "home" }); return true; }
    return false;
  }

  // Browser and installed web app: keep one extra history entry while we are away from Home,
  // so the back gesture lands here instead of leaving the app.
  let guard = false, skip = 0;
  function sync() {
    if (!atHome() && !guard) { history.pushState({ csaBack: 1 }, "", location.href); guard = true; }
    else if (atHome() && guard) { guard = false; skip++; history.back(); }
  }
  window.addEventListener("popstate", () => {
    // Links like #/t/... were read when they were opened; going back must not open them again.
    if (location.hash) history.replaceState(history.state, "", location.pathname + location.search);
    if (skip) { skip--; sync(); return; }
    guard = false;
    back();
    sync();
  });
  new MutationObserver(sync).observe($app, { childList: true });
  new MutationObserver(sync).observe($sheet, { attributes: true, attributeFilter: ["hidden"] });
  sync();

  // Android app: the Capacitor App plugin hands us the hardware back button.
  const cap = window.Capacitor;
  const App = cap && cap.isNativePlatform && cap.isNativePlatform() && cap.Plugins && cap.Plugins.App;
  if (App && App.addListener) {
    App.addListener("backButton", () => { if (!back()) App.exitApp(); });
  }

  CSA.back = back;
})();
