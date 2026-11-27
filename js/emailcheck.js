// Quick checks on an email before an account is created: catches typos in common
// domains (gmial.com, gmail.con) and throwaway inbox services. The real proof that an
// email exists is the confirmation link Supabase sends; this only stops obvious mistakes
// before that. No DOM, so Node tests can load it.
(function (root) {
  const COMMON = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "live.com", "ymail.com", "protonmail.com", "proton.me", "aol.com", "msn.com", "mail.com", "email.com", "gmx.com", "gmx.net", "zoho.com", "yandex.com", "rediffmail.com", "googlemail.com"];
  // Known typos, then anything one or two letters away from a common domain.
  const TYPOS = {
    "gmial.com": "gmail.com", "gmal.com": "gmail.com", "gmaill.com": "gmail.com", "gamil.com": "gmail.com", "gnail.com": "gmail.com",
    "gmail.co": "gmail.com", "gmail.con": "gmail.com", "gmail.cm": "gmail.com", "gmail.om": "gmail.com", "gmail.in": "gmail.com",
    "gmail.comm": "gmail.com", "gmai.com": "gmail.com", "gmail.c": "gmail.com", "googlemail.co": "googlemail.com",
    "yahoo.co": "yahoo.com", "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "hotmial.com": "hotmail.com", "hotmai.com": "hotmail.com",
    "hotmail.co": "hotmail.com", "outlok.com": "outlook.com", "outlook.co": "outlook.com", "iclod.com": "icloud.com",
  };
  // Throwaway inbox services people use to dodge sign-up checks.
  const THROWAWAY = new Set([
    "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "10minutemail.com", "10minutemail.net", "tempmail.com",
    "temp-mail.org", "temp-mail.io", "tempmail.net", "tempmailo.com", "yopmail.com", "yopmail.net", "trashmail.com", "getnada.com", "nada.email",
    "dispostable.com", "maildrop.cc", "mailnesia.com", "throwawaymail.com", "fakeinbox.com", "mintemail.com", "emailondeck.com", "mohmal.com",
    "mail.tm", "mail.gw", "moakt.com", "tmail.ws", "tmpmail.org", "tmpmail.net", "burnermail.io", "spamgourmet.com", "mailcatch.com",
    "inboxkitten.com", "1secmail.com", "1secmail.net", "1secmail.org", "dropmail.me", "emailfake.com", "fakemail.net", "luxusmail.org",
    "discard.email", "mytemp.email", "minuteinbox.com", "trash-mail.com", "spambox.us", "33mail.com", "grr.la", "pokemail.net",
  ]);

  function distance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }

  // Returns { ok, error?, suggest? }. suggest is the corrected full address.
  function check(raw) {
    const email = String(raw || "").trim().toLowerCase();
    const m = /^([^\s@]+)@([^\s@]+\.[a-z]{2,})$/.exec(email);
    if (!m) return { ok: false, error: "That doesn't look like an email address." };
    const [, user, domain] = m;
    if (THROWAWAY.has(domain)) return { ok: false, error: "Throwaway email addresses can't be used. Sign up with your own email." };
    if (domain === "gmail.com" || domain === "googlemail.com") {
      // Gmail names are 6 to 30 letters, numbers and dots.
      const name = user.split("+")[0];
      if (!/^[a-z0-9.]+$/.test(name) || name.replace(/\./g, "").length < 6 || name.length > 30 || /^\.|\.\.|\.$/.test(name))
        return { ok: false, error: "That isn't a real Gmail address. Check the part before @gmail.com." };
      return { ok: true };
    }
    if (COMMON.includes(domain)) return { ok: true };
    const fix = TYPOS[domain] || COMMON.find((c) => Math.abs(c.length - domain.length) <= 2 && distance(c, domain) <= (c.length > 8 ? 2 : 1));
    if (fix) return { ok: false, error: `Did you mean ${user}@${fix}?`, suggest: `${user}@${fix}` };
    return { ok: true };
  }

  root.CSA = Object.assign(root.CSA || {}, { emailCheck: { check } });
  if (typeof module === "object" && module.exports) module.exports = root.CSA.emailCheck;
})(typeof window !== "undefined" ? window : globalThis);
