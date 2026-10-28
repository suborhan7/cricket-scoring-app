// Saves matches on this phone (localStorage). Every ball is saved as soon as it's tapped,
// so closing the app or losing signal never loses a ball. Supabase sync comes later.
(function (root) {
  const KEY = "csa.matches.v1";

  function all() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  function write(data) {
    try { localStorage.setItem(KEY, JSON.stringify(data)); return true; } catch (e) { return false; }
  }

  const store = {
    list() { return Object.values(all()).sort((a, b) => b.match.createdAt - a.match.createdAt); },
    get(id) { return all()[id] || null; },
    save(rec) { const d = all(); d[rec.match.id] = rec; return write(d); },
    remove(id) { const d = all(); delete d[id]; write(d); },
    newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); },
  };

  root.CSA = Object.assign(root.CSA || {}, { store });
})(window);
