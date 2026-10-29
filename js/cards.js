// Social cards drawn on a canvas, in three looks the card maker picks from:
//   A "Broadcast" (TV graphics: skewed bars, white plates), B "Poster" (editorial: giant type,
//   hairlines, film grain) and C "Modern" (dark glass panels, colour glows, lime accent).
// Cards: match day fixtures, groups, playing XIs, versus, result, points table, squad, leaders,
// innings-break target, champions and runners-up, and the player cards: tournament awards in A
// and B, milestones in Spotlight and Split, player of the match in Halo, Spotlight and Split. Each card is a feed post
// (1080 × 1350) or a story (1080 × 1920), with the tournament's logo and a sponsor slot.
// Missing logos become a crest in the team's colours; a missing photo becomes a silhouette in
// the team's kit. No DOM besides canvases, so the drawing can be reused anywhere.
(function (root) {
  const SIZES = { post: [1080, 1350], story: [1080, 1920] };
  const DISPLAY = '"Oswald", "Arial Narrow", sans-serif';
  const BODY = '"DM Sans", system-ui, sans-serif';
  const STYLES = [["A", "Broadcast"], ["B", "Poster"], ["C", "Modern"]];
  // Player cards have no Modern look.
  const HERO = new Set(["milestone", "potm", "award"]);
  // Milestone cards have their own two looks; other player cards have no Modern look.
  const MILESTONE_STYLES = [["S", "Spotlight"], ["P", "Split"]];
  // Player of the match: Halo first, then the milestone looks.
  const POTM_STYLES = [["H", "Halo"], ["S", "Spotlight"], ["P", "Split"]];
  // Result: Face-off first, then Scoreline and Hero (the player of the match on the winners' stage).
  const RESULT_STYLES = [["F", "Face-off"], ["L", "Scoreline"], ["R", "Hero"]];
  // Any player's performance in a match: batting and bowling take the milestone looks, all-round the POTM looks.
  const PERF = new Set(["batperf", "bowlperf"]);
  const stylesFor = (kind) => kind === "milestone" || PERF.has(kind) ? MILESTONE_STYLES : kind === "potm" || kind === "allround" ? POTM_STYLES
    : kind === "result" ? RESULT_STYLES : STYLES.filter(([k]) => !(HERO.has(kind) && k === "C"));

  // ---------- Colour helpers ----------

  const hexRgb = (h) => { const n = parseInt((h || "#0F7A45").slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const rgbHex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  const mix = (a, b, t) => { const x = hexRgb(a), y = hexRgb(b); return rgbHex(x.map((v, i) => v + (y[i] - v) * t)); };
  const lum = (h) => { const [r, g, b] = hexRgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const rgba = (h, a) => { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  function hsl(h, s, l) {
    h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    return rgbHex([0, 8, 4].map((n) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))))));
  }

  // A theme from the tournament's two colours: a deep background, and a bright accent that reads on it.
  function theme(c1, c2) {
    c1 = c1 || "#0F7A45"; c2 = c2 || "#0E1A14";
    let base = c1;
    while (lum(base) > 0.18) base = mix(base, "#000000", 0.2);
    const deep = mix(base, "#000000", 0.45);
    const candidates = [c2, c1, mix(c1, "#FFFFFF", 0.55), mix(c2, "#FFFFFF", 0.55), "#F5C542"];
    const accent = candidates.find((c) => contrast(c, base) >= 4.5) || "#FFFFFF";
    return { c1, c2, base, deep, accent, band: c2 && lum(c2) < 0.6 ? c2 : mix(c1, "#000000", 0.25) };
  }

  // ---------- Drawing helpers ----------

  function loadImg(url) {
    return new Promise((res) => {
      if (!url) return res(null);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = url;
    });
  }

  const canvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
  function font(ctx, size, weight, family) { ctx.font = `${weight || 700} ${Math.round(size)}px ${family || DISPLAY}`; }
  // Largest font size (down to min) at which the text fits the width.
  function fit(ctx, text, maxW, size, weight, family, min) {
    let s = size;
    for (; s > (min || 16); s -= 2) { font(ctx, s, weight, family); if (ctx.measureText(text).width <= maxW) return s; }
    font(ctx, s, weight, family);
    return s;
  }
  // Letter-spaced small caps; leaves the alignment at left.
  function spaced(ctx, text, x, y, spacing, align) {
    ctx.textAlign = align || "left";
    if ("letterSpacing" in ctx) { ctx.letterSpacing = `${spacing}px`; ctx.fillText(text, x, y); ctx.letterSpacing = "0px"; }
    else ctx.fillText(text.split("").join(" "), x, y);
    ctx.textAlign = "left";
  }
  function text(ctx, t, x, y, align) { ctx.textAlign = align || "left"; ctx.fillText(t, x, y); ctx.textAlign = "left"; }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  // A parallelogram leaning right by k pixels.
  function skew(ctx, x, y, w, h, k) { ctx.beginPath(); ctx.moveTo(x + k, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - k, y + h); ctx.lineTo(x, y + h); ctx.closePath(); }

  // ---------- Stand-ins: a crest for a team without a logo, a silhouette for a player without a photo ----------

  const cache = new Map();
  function crest(t) {
    const key = `crest:${t.short}:${t.c1}:${t.c2}`;
    if (cache.has(key)) return cache.get(key);
    const c1 = t.c1 || "#0F7A45", c2 = t.c2 || "#F5C542", c = canvas(400, 400), x = c.getContext("2d");
    x.beginPath(); x.moveTo(200, 20); x.lineTo(360, 70); x.lineTo(350, 230); x.quadraticCurveTo(320, 330, 200, 385); x.quadraticCurveTo(80, 330, 50, 230); x.lineTo(40, 70); x.closePath();
    const g = x.createLinearGradient(0, 0, 400, 400); g.addColorStop(0, mix(c1, "#FFFFFF", 0.15)); g.addColorStop(1, mix(c1, "#000000", 0.35));
    x.fillStyle = g; x.fill(); x.lineWidth = 16; x.strokeStyle = c2; x.stroke(); x.lineWidth = 5; x.strokeStyle = "rgba(255,255,255,0.8)"; x.stroke();
    // A ball with its seam.
    x.fillStyle = c2; x.beginPath(); x.arc(200, 150, 62, 0, Math.PI * 2); x.fill();
    x.strokeStyle = c1; x.lineWidth = 6; x.beginPath(); x.arc(150, 150, 62, -0.9, 0.9); x.stroke(); x.beginPath(); x.arc(250, 150, 62, Math.PI - 0.9, Math.PI + 0.9); x.stroke();
    x.fillStyle = "#FFFFFF"; x.textAlign = "center"; fit(x, (t.short || "?").toUpperCase(), 250, 96, 700); x.fillText((t.short || "?").toUpperCase(), 200, 310);
    cache.set(key, c);
    return c;
  }

  function silhouette(c1, c2, no) {
    const key = `sil:${c1}:${c2}:${no}`;
    if (cache.has(key)) return cache.get(key);
    c1 = c1 || "#0F7A45"; c2 = c2 || "#F5C542";
    const c = canvas(700, 900), x = c.getContext("2d");
    const body = new Path2D();
    // Sloping shoulders, a neck and a head a little larger than life, so it reads at a glance.
    body.moveTo(40, 900); body.bezierCurveTo(50, 640, 90, 530, 200, 500); body.bezierCurveTo(250, 486, 290, 470, 305, 440);
    body.lineTo(395, 440); body.bezierCurveTo(410, 470, 450, 486, 500, 500); body.bezierCurveTo(610, 530, 650, 640, 660, 900); body.closePath();
    body.moveTo(296, 330); body.lineTo(404, 330); body.lineTo(400, 456); body.lineTo(300, 456); body.closePath();
    body.moveTo(472, 255); body.ellipse(350, 255, 122, 146, 0, 0, Math.PI * 2);
    const dark = x.createLinearGradient(0, 140, 0, 900); dark.addColorStop(0, "#1d2027"); dark.addColorStop(1, "#08090c");
    x.fillStyle = dark; x.fill(body);
    x.save(); x.clip(body);
    const jersey = new Path2D(); jersey.moveTo(0, 900); jersey.lineTo(0, 470); jersey.lineTo(300, 452); jersey.lineTo(350, 540); jersey.lineTo(400, 452); jersey.lineTo(700, 470); jersey.lineTo(700, 900); jersey.closePath();
    const g = x.createLinearGradient(40, 520, 660, 900); g.addColorStop(0, mix(c1, "#FFFFFF", 0.18)); g.addColorStop(0.55, c1); g.addColorStop(1, mix(c1, "#000000", 0.55));
    x.fillStyle = g; x.fill(jersey);
    x.fillStyle = rgba(lum(c2) < 0.05 ? "#FFFFFF" : c2, 0.8); x.beginPath(); x.moveTo(0, 760); x.lineTo(700, 680); x.lineTo(700, 712); x.lineTo(0, 792); x.fill();
    if (no != null) { x.fillStyle = "rgba(255,255,255,0.85)"; x.textAlign = "center"; font(x, 120, 700); x.fillText(String(no), 350, 690); }
    const sh = x.createLinearGradient(0, 0, 700, 0); sh.addColorStop(0, "rgba(0,0,0,0.35)"); sh.addColorStop(0.45, "rgba(0,0,0,0)"); sh.addColorStop(0.9, "rgba(255,255,255,0)"); sh.addColorStop(1, "rgba(255,255,255,0.28)");
    x.fillStyle = sh; x.fillRect(0, 0, 700, 900);
    x.restore();
    cache.set(key, c);
    return c;
  }

  // True when the image has see-through corners: a cut-out photo or a logo on no background.
  function cutout(img) {
    if (!img) return false;
    if (img.__cut != null) return img.__cut;
    let cut = false;
    try {
      const c = canvas(32, 32), x = c.getContext("2d");
      x.drawImage(img, 0, 0, 32, 32);
      const d = x.getImageData(0, 0, 32, 32).data, a = (px, py) => d[(py * 32 + px) * 4 + 3];
      cut = [a(0, 0), a(31, 0), a(0, 31), a(31, 31), a(16, 0)].filter((v) => v < 40).length >= 3;
    } catch (e) { cut = false; }
    img.__cut = cut;
    return cut;
  }

  // The jersey's colour: the average of the bright, saturated pixels in the middle of the photo.
  function jerseyColour(img) {
    try {
      const c = canvas(60, 80), x = c.getContext("2d");
      x.drawImage(img, 0, 0, 60, 80);
      const d = x.getImageData(15, 40, 30, 28).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 200) continue;
        const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
        if (mx < 50 || mx - mn < 40) continue;
        r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
      }
      return n > 40 ? rgbHex([r / n, g / n, b / n]) : null;
    } catch (e) { return null; }
  }
  function hueOf(hex) {
    const [r, g, b] = hexRgb(hex).map((v) => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (!d) return 0;
    const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return h * 60;
  }

  // A team logo with its middle at (cx, cy) and `size` across. A logo with a background sits on a white tile.
  function logo(ctx, img, team, cx, cy, size) {
    if (!img) img = crest(team || {});
    if (img.width && cutout(img) || img instanceof (root.HTMLCanvasElement || Object)) {
      const k = size / Math.max(img.width, img.height);
      ctx.drawImage(img, cx - (img.width * k) / 2, cy - (img.height * k) / 2, img.width * k, img.height * k);
      return;
    }
    ctx.save();
    ctx.fillStyle = "#FFFFFF"; roundRect(ctx, cx - size / 2, cy - size / 2, size, size, size * 0.22); ctx.fill(); ctx.clip();
    const k = (size * 0.84) / Math.max(img.width, img.height);
    ctx.drawImage(img, cx - (img.width * k) / 2, cy - (img.height * k) / 2, img.width * k, img.height * k);
    ctx.restore();
  }

  // A player: a cut-out stands on `bottom`, `h` tall; a plain photo is cropped into the box and fades out at the edges.
  function player(ctx, img, box, team, no) {
    const { cx, bottom, h, w } = box;
    if (!img) img = silhouette(team && team.c1, team && team.c2, no);
    if (img instanceof (root.HTMLCanvasElement || Object) || cutout(img)) {
      const k = Math.min(h / img.height, (w * 1.15) / img.width);
      ctx.drawImage(img, cx - (img.width * k) / 2, bottom - img.height * k, img.width * k, img.height * k);
      return;
    }
    const bw = Math.round(w), bh = Math.round(h), layer = canvas(bw, bh), lc = layer.getContext("2d");
    const k = Math.max(bw / img.width, bh / img.height);
    lc.drawImage(img, (bw - img.width * k) / 2, (bh - img.height * k) * 0.15, img.width * k, img.height * k);
    lc.globalCompositeOperation = "destination-in";
    const gx = lc.createLinearGradient(0, 0, bw, 0);
    gx.addColorStop(0, "rgba(0,0,0,0)"); gx.addColorStop(0.18, "rgba(0,0,0,1)"); gx.addColorStop(0.82, "rgba(0,0,0,1)"); gx.addColorStop(1, "rgba(0,0,0,0)");
    lc.fillStyle = gx; lc.fillRect(0, 0, bw, bh);
    const gy = lc.createLinearGradient(0, 0, 0, bh);
    gy.addColorStop(0, "rgba(0,0,0,0)"); gy.addColorStop(0.1, "rgba(0,0,0,1)"); gy.addColorStop(0.8, "rgba(0,0,0,1)"); gy.addColorStop(1, "rgba(0,0,0,0)");
    lc.fillStyle = gy; lc.fillRect(0, 0, bw, bh);
    ctx.drawImage(layer, cx - bw / 2, bottom - bh);
  }

  function grain(ctx, W, H, a) {
    let n = cache.get("grain");
    if (!n) {
      n = canvas(200, 200); const x = n.getContext("2d"), d = x.createImageData(200, 200);
      let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < d.data.length; i += 4) { const v = rnd() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
      x.putImageData(d, 0, 0); cache.set("grain", n);
    }
    ctx.save(); ctx.globalAlpha = a; ctx.globalCompositeOperation = "overlay"; ctx.fillStyle = ctx.createPattern(n, "repeat"); ctx.fillRect(0, 0, W, H); ctx.restore();
  }

  // Sponsor slot and the app mark along the bottom.
  // Sponsors along the foot: "Presented by" and one logo (with its name), or "Sponsors" and a row of
  // logos. With no sponsor the section is left out and only the app mark shows.
  function sponsor(ctx, W, y, d, light, mark) {
    const ink = light ? "#0A1024" : "#FFFFFF";
    const list = d.sponsor && d.sponsor.show === false ? [] : (d.sponsors || []).map((s, i) => ({ name: s.name || "", img: d.images.sponsors[i] })).filter((s) => s.img || s.name);
    if (list.length) {
      ctx.fillStyle = light ? "rgba(10,16,36,0.6)" : "rgba(255,255,255,0.6)"; font(ctx, 18, 700, BODY); spaced(ctx, list.length > 1 ? "SPONSORS" : "PRESENTED BY", 60, y, 3);
      const maxX = W - 260, gap = 26, lw = list.length > 1 ? Math.min(160, (maxX - 60 - gap * (list.length - 1)) / list.length) : 200;
      let x = 60;
      for (const sp of list) {
        if (sp.img) {
          const k = Math.min(lw / sp.img.width, 48 / sp.img.height);
          ctx.drawImage(sp.img, x, y + 12 + (48 - sp.img.height * k) / 2, sp.img.width * k, sp.img.height * k);
          x += sp.img.width * k + 14;
        }
        if (sp.name && (list.length === 1 || !sp.img)) { ctx.fillStyle = ink; fit(ctx, sp.name.toUpperCase(), Math.max(80, maxX - x), 28, 700, DISPLAY, 14); text(ctx, sp.name.toUpperCase(), x, y + 46); x += ctx.measureText(sp.name.toUpperCase()).width + 14; }
        x += gap - 14;
      }
    }
    ctx.fillStyle = mark; font(ctx, 20, 700, BODY); spaced(ctx, d.appName || "CRICPULSE", W - 60, y + 44, 3, "right");
  }


  // ---------- The three looks ----------
  // Each kit draws the background, header, footer, titles, rows, tags, panels and stat tiles;
  // the cards below lay out their content with these.

  const NAVY = "#0A1024", INK = "#F3EDE2", LIME = "#C6FF3D";

  function kitA(th, W, H, d) {
    const acc = th.accent, k = {
      style: "A", ink: "#FFFFFF", sub: "rgba(255,255,255,0.7)", acc, plateInk: NAVY, plateSub: "rgba(10,16,36,0.58)",
      bg(c1, c2) {
        c1 = c1 || th.c1; c2 = c2 || acc;
        ctx.fillStyle = NAVY; ctx.fillRect(0, 0, W, H);
        const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, rgba(c1, 0.8)); g.addColorStop(1, rgba(c1, 0.05));
        ctx.fillStyle = g; skew(ctx, -200, 0, 900, H, H * 0.19); ctx.fill();
        ctx.fillStyle = rgba(c2, 0.9); skew(ctx, 640, 0, 70, H, H * 0.19); ctx.fill();
        ctx.fillStyle = rgba(c2, 0.35); skew(ctx, 730, 0, 22, H, H * 0.19); ctx.fill();
        ctx.save(); ctx.strokeStyle = "rgba(255,255,255,0.04)"; ctx.lineWidth = 2;
        for (let i = -H; i < W; i += 26) { ctx.beginPath(); ctx.moveTo(i, H); ctx.lineTo(i + H * 0.6, 0); ctx.stroke(); }
        ctx.restore();
      },
      head(label) {
        logo(ctx, d.images.tournament, d.tournament, 104, 96, 112);
        ctx.fillStyle = "#FFFFFF"; skew(ctx, 170, 56, 640, 54, 18); ctx.fill();
        ctx.fillStyle = NAVY; fit(ctx, d.tournament.name.toUpperCase(), 580, 32, 700); text(ctx, d.tournament.name.toUpperCase(), 196, 95);
        if (label) {
          font(ctx, 22, 700, BODY); const w = Math.min(ctx.measureText(label.toUpperCase()).width + 3 * label.length + 60, 620);
          ctx.fillStyle = acc; skew(ctx, 160, 116, w, 40, 14); ctx.fill();
          ctx.fillStyle = NAVY; spaced(ctx, label.toUpperCase(), 184, 144, 3);
        }
        return 196;
      },
      foot() {
        ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, H - 110, W, 110); ctx.fillStyle = acc; ctx.fillRect(0, H - 116, W, 6);
        sponsor(ctx, W, H - 92, d, true, rgba(NAVY, 0.6));
        return H - 136;
      },
      title(y, kicker, title, size) {
        size = size || (H > 1500 ? 140 : 124);
        if (kicker) { font(ctx, 24, 700, BODY); const w = ctx.measureText(kicker.toUpperCase()).width + 3 * kicker.length + 56; ctx.fillStyle = acc; skew(ctx, 40, y, w, 42, 14); ctx.fill(); ctx.fillStyle = NAVY; spaced(ctx, kicker.toUpperCase(), 62, y + 30, 3); y += 42; }
        ctx.fillStyle = "#FFFFFF"; fit(ctx, title.toUpperCase(), W - 100, size, 700); text(ctx, title.toUpperCase(), 46, y + size * 0.92);
        return y + size + 14;
      },
      row(x, y, w, h, o) {
        o = o || {};
        const kk = Math.min(18, h * 0.22);
        ctx.fillStyle = o.dim ? "rgba(255,255,255,0.86)" : "#FFFFFF"; skew(ctx, x, y, w, h, kk); ctx.fill();
        if (o.c1) { ctx.fillStyle = o.c1; skew(ctx, x, y, o.win ? 22 : 12, h, kk); ctx.fill(); }
        if (o.c2) { ctx.fillStyle = o.c2; skew(ctx, x + w - 12, y, 12, h, kk); ctx.fill(); }
        if (o.hi) { ctx.strokeStyle = acc; ctx.lineWidth = 5; skew(ctx, x, y, w, h, kk); ctx.stroke(); }
        return { ink: NAVY, sub: "rgba(10,16,36,0.58)", strong: o.win ? NAVY : NAVY };
      },
      chip(t, x, y, w, h, o) {
        o = o || {};
        ctx.fillStyle = o.live ? "#E5484D" : o.muted ? "rgba(255,255,255,0.16)" : acc; skew(ctx, x, y, w, h, Math.min(18, h * 0.22)); ctx.fill();
        ctx.fillStyle = o.live || o.muted ? "#FFFFFF" : NAVY; fit(ctx, t, w - 30, o.size || h * 0.36, 700); text(ctx, t, x + w / 2, y + h / 2 + (o.size || h * 0.36) * 0.36, "center");
      },
      panelHead(x, y, w, h, label, c) {
        ctx.fillStyle = c || acc; skew(ctx, x, y, w, h, 16); ctx.fill();
        ctx.fillStyle = c ? "#FFFFFF" : NAVY; fit(ctx, label.toUpperCase(), w - 50, h * 0.62, 700); text(ctx, label.toUpperCase(), x + 26, y + h * 0.74);
      },
      tile(x, y, w, h, i) {
        ctx.fillStyle = NAVY; ctx.fillRect(x, y, w, h); ctx.fillStyle = i === 0 ? acc : rgba(th.c1, 1); ctx.fillRect(x, y, w, 8);
        return { ink: "#FFFFFF", sub: acc, val: "#FFFFFF" };
      },
      finish() {},
    };
    let ctx; k.use = (c) => { ctx = c; return k; };
    return k;
  }

  function kitB(th, W, H, d) {
    const acc = th.accent, k = {
      style: "B", ink: INK, sub: rgba(INK, 0.62), acc, plateInk: INK, plateSub: rgba(INK, 0.6),
      bg(c1) {
        c1 = c1 || th.c1;
        ctx.fillStyle = mix(c1, "#000000", 0.72); ctx.fillRect(0, 0, W, H);
        const g = ctx.createRadialGradient(W * 0.75, H * 0.25, 50, W * 0.75, H * 0.25, W);
        g.addColorStop(0, rgba(c1, 0.55)); g.addColorStop(1, rgba(c1, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      },
      head(label) {
        ctx.strokeStyle = rgba(INK, 0.5); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(50, 124); ctx.lineTo(W - 50, 124); ctx.stroke();
        logo(ctx, d.images.tournament, d.tournament, 84, 76, 68);
        ctx.fillStyle = INK; font(ctx, 20, 700, BODY); spaced(ctx, d.tournament.name.toUpperCase(), 130, 84, 4);
        if (label) spaced(ctx, label.toUpperCase(), W - 50, 84, 4, "right");
        return 170;
      },
      foot() {
        grain(ctx, W, H, 0.16);
        ctx.strokeStyle = rgba(INK, 0.5); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(50, H - 122); ctx.lineTo(W - 50, H - 122); ctx.stroke();
        sponsor(ctx, W, H - 98, d, false, acc);
        return H - 146;
      },
      title(y, kicker, title, size) {
        size = size || (H > 1500 ? 250 : 220);
        ctx.fillStyle = INK; const s = fit(ctx, title.toUpperCase(), W - 90, size, 700, DISPLAY, 60); text(ctx, title.toUpperCase(), 40, y + s * 0.86);
        y += s * 0.86;
        if (kicker) { ctx.fillStyle = acc; font(ctx, 28, 700, BODY); spaced(ctx, kicker.toUpperCase(), 50, y + 52, 6); y += 52; }
        return y + 36;
      },
      row(x, y, w, h, o) {
        o = o || {};
        if (o.hi || o.win) { ctx.fillStyle = rgba(INK, 0.07); ctx.fillRect(x, y, w, h); }
        ctx.strokeStyle = rgba(INK, 0.22); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.stroke();
        if (o.win) { ctx.fillStyle = acc; ctx.fillRect(x, y, 6, h); }
        return { ink: INK, sub: rgba(INK, 0.6), strong: o.win ? acc : INK };
      },
      chip(t, x, y, w, h, o) {
        o = o || {};
        ctx.fillStyle = o.live ? "#FF5A4E" : o.muted ? rgba(INK, 0.55) : acc;
        fit(ctx, t, w - 10, o.size || h * 0.42, 600); text(ctx, t, x, y + h / 2 + (o.size || h * 0.42) * 0.36);
      },
      panelHead(x, y, w, h, label) {
        ctx.fillStyle = acc; font(ctx, Math.min(26, h * 0.5), 700, BODY); spaced(ctx, label.toUpperCase(), x, y + h * 0.66, 6);
        ctx.strokeStyle = rgba(INK, 0.4); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.stroke();
      },
      tile(x, y, w, h, i) {
        ctx.strokeStyle = rgba(INK, 0.35); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + h); ctx.stroke();
        return { ink: INK, sub: rgba(INK, 0.6), val: i === 0 ? acc : INK, pad: 18 };
      },
      finish() {},
    };
    let ctx; k.use = (c) => { ctx = c; return k; };
    return k;
  }

  function kitC(th, W, H, d) {
    const acc = LIME, k = {
      style: "C", ink: "#FFFFFF", sub: "rgba(255,255,255,0.6)", acc, plateInk: "#FFFFFF", plateSub: "rgba(255,255,255,0.55)",
      bg(c1, c2) {
        c1 = c1 || th.c1; c2 = c2 || "#7C3AED";
        ctx.fillStyle = "#07090F"; ctx.fillRect(0, 0, W, H);
        for (const [x, y, r, c, a] of [[150, H * 0.18, 650, c1, 0.5], [W - 100, H * 0.78, 700, c2, 0.45], [W * 0.8, 120, 380, LIME, 0.14]]) {
          const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, rgba(c, a)); g.addColorStop(1, rgba(c, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        }
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        for (let x = 30; x < W; x += 36) for (let y = 30; y < H; y += 36) ctx.fillRect(x, y, 3, 3);
      },
      head(label) {
        logo(ctx, d.images.tournament, d.tournament, 96, 92, 96);
        ctx.fillStyle = "#FFFFFF"; fit(ctx, d.tournament.name.toUpperCase(), W - 220, 36, 700); text(ctx, d.tournament.name.toUpperCase(), 160, 92);
        if (label) { ctx.fillStyle = "rgba(255,255,255,0.6)"; font(ctx, 20, 600, BODY); spaced(ctx, label.toUpperCase(), 162, 126, 3); }
        return 176;
      },
      foot() {
        ctx.strokeStyle = "rgba(255,255,255,0.1)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(50, H - 122); ctx.lineTo(W - 50, H - 122); ctx.stroke();
        sponsor(ctx, W, H - 98, d, false, LIME);
        return H - 146;
      },
      pill(t, x, y, size, fill, ink) {
        font(ctx, size, 700, BODY); const w = ctx.measureText(t).width + size * 1.4, h = size * 1.7;
        ctx.fillStyle = fill || LIME; roundRect(ctx, x, y, w, h, h / 2); ctx.fill(); ctx.fillStyle = ink || "#07090F"; text(ctx, t, x + size * 0.7, y + h * 0.68);
        return w;
      },
      title(y, kicker, title, size) {
        size = size || (H > 1500 ? 140 : 124);
        if (kicker) { k.pill(kicker.toUpperCase(), 50, y, 22); y += 50; }
        ctx.fillStyle = "#FFFFFF"; fit(ctx, title.toUpperCase(), W - 100, size, 700); text(ctx, title.toUpperCase(), 46, y + size * 0.9);
        return y + size + 14;
      },
      glass(x, y, w, h, r, strong) {
        ctx.fillStyle = strong ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)"; roundRect(ctx, x, y, w, h, r); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.14)"; ctx.lineWidth = 2; ctx.stroke();
      },
      row(x, y, w, h, o) {
        o = o || {};
        k.glass(x, y, w, h, Math.min(26, h * 0.3), o.win || o.hi);
        if (o.live || o.win) { ctx.strokeStyle = LIME; ctx.lineWidth = 3; roundRect(ctx, x, y, w, h, Math.min(26, h * 0.3)); ctx.stroke(); }
        return { ink: "#FFFFFF", sub: "rgba(255,255,255,0.55)", strong: o.win ? LIME : "#FFFFFF" };
      },
      chip(t, x, y, w, h, o) {
        o = o || {};
        const size = o.size || Math.min(22, h * 0.32), ph = size * 1.7;
        font(ctx, size, 700, BODY); const tw = Math.min(ctx.measureText(t).width + size * 1.4, w);
        ctx.fillStyle = o.live ? LIME : o.muted ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.14)"; roundRect(ctx, x, y + (h - ph) / 2, tw, ph, ph / 2); ctx.fill();
        ctx.fillStyle = o.live ? "#07090F" : "#FFFFFF"; fit(ctx, t, tw - size, size, 700, BODY, 12); text(ctx, t, x + tw / 2, y + h / 2 + size * 0.36, "center");
      },
      panelHead(x, y, w, h, label) {
        ctx.fillStyle = LIME; font(ctx, h * 0.62, 700); text(ctx, label.toUpperCase(), x + 24, y + h * 0.78);
      },
      tile(x, y, w, h, i) {
        k.glass(x, y, w, h, 24, i === 0);
        return { ink: "#FFFFFF", sub: "rgba(255,255,255,0.55)", val: i === 0 ? LIME : "#FFFFFF" };
      },
      finish() {},
    };
    let ctx; k.use = (c) => { ctx = c; return k; };
    return k;
  }

  const KITS = { A: kitA, B: kitB, C: kitC };

  // Two teams with a vs line between them, in any row.
  function fixtureRow(ctx, K, x, y, w, h, r, imgs, o) {
    const ink = K.row(x, y, w, h, Object.assign({ c1: K.style === "A" ? r.teams[0].c1 : null, c2: K.style === "A" ? r.teams[1].c1 : null }, o));
    const ls = Math.min(h * 0.7, 140), cy = y + h / 2, mid = x + w / 2;
    const centre = r.score || r.mid || "VS";
    if (h >= 170) {
      // Tall rows (a day with few matches): logos large, names under them, score or VS in the middle.
      const ls = Math.min(h * 0.5, 230), ly = y + h * 0.42, nw = w * 0.3, nf = Math.min(54, Math.max(h * 0.15, 30) * (h > 300 ? 0.75 : 1));
      r.teams.forEach((t, k) => {
        const lx = k ? x + w * 0.8 : x + w * 0.2;
        logo(ctx, imgs[k], t, lx, ly, ls);
        ctx.fillStyle = r.winner != null && r.winner !== k ? ink.sub : ink.ink;
        fit(ctx, t.name.toUpperCase(), nw, nf, 700, DISPLAY, 16); text(ctx, t.name.toUpperCase(), lx, ly + ls / 2 + nf + 6, "center");
      });
      ctx.fillStyle = r.score ? ink.strong : K.style === "A" ? NAVY : K.acc;
      fit(ctx, centre, w * 0.3, r.score ? Math.min(60, h * 0.2) : Math.min(110, h * 0.3), 700, DISPLAY, 20); text(ctx, centre, mid, ly + 14, "center");
      if (r.sub) { ctx.fillStyle = ink.sub; fit(ctx, r.sub, w * 0.3, Math.min(20, h * 0.1), 700, BODY, 11); text(ctx, r.sub, mid, ly + 56, "center"); }
      return;
    }
    font(ctx, Math.min(40, h * 0.26), 700); const half = Math.max(46, ctx.measureText(centre).width / 2 + 18);
    r.teams.forEach((t, k) => {
      const lx = k ? x + w - 26 - ls / 2 : x + 26 + ls / 2;
      logo(ctx, imgs[k], t, lx, cy, ls);
      const nx = k ? lx - ls / 2 - 14 : lx + ls / 2 + 14, maxW = k ? nx - mid - half : mid - half - nx;
      ctx.fillStyle = r.winner != null && r.winner !== k ? ink.sub : ink.ink;
      font(ctx, 20, 600); const full = t.name.toUpperCase();
      const label = ctx.measureText(full).width > maxW * 1.6 ? (t.short || full) : full;
      fit(ctx, label, maxW, Math.min(46, h * 0.3), 700, DISPLAY, 18); text(ctx, label, nx, cy + (r.sub ? 4 : 11), k ? "right" : "left");
    });
    ctx.fillStyle = r.score ? ink.strong : K.style === "A" ? NAVY : K.acc; font(ctx, Math.min(40, h * 0.26), 700); text(ctx, centre, mid, cy + (r.sub ? 0 : 10), "center");
    if (r.sub) { ctx.fillStyle = ink.sub; fit(ctx, r.sub, Math.max(160, half * 2 + 60), Math.min(17, h * 0.17), 700, BODY, 11); text(ctx, r.sub, mid, cy + h * 0.28, "center"); }
  }

  // ---------- Cards ----------

  function drawSchedule(ctx, W, H, th, d, K) {
    const sc = d.schedule, rows = sc.rows;
    K.bg();
    const top = K.head(sc.sub || ""), bottom = K.foot();
    const y0 = K.title(top + 6, sc.kicker || "", sc.title || "Match day", H > 1500 ? 150 : 124);
    const n = Math.max(rows.length, 1);
    if (K.style === "C" && rows.length > 3) {
      // Glass cards in two columns.
      const gap = 16, perCol = Math.ceil(n / 2), rowH = Math.min((bottom - y0) / perCol, H > 1500 ? 300 : 260), w = (W - 100 - gap) / 2;
      rows.forEach((r, i) => {
        const x = 50 + (i % 2) * (w + gap), y = y0 + Math.floor(i / 2) * rowH, h = rowH - gap;
        K.row(x, y, w, h, { live: r.live });
        K.chip(r.live ? "● LIVE" : r.result ? "RESULT" : r.time || "TBA", x + 18, y + 14, w * 0.5, 40, { live: r.live, size: 18 });
        ctx.fillStyle = "rgba(255,255,255,0.5)"; fit(ctx, r.tag || "", w * 0.42, 16, 700, BODY, 11); text(ctx, r.tag || "", x + w - 20, y + 40, "right");
        const cy = y + h * 0.56, ls = Math.min(96, h * 0.42);
        logo(ctx, d.images.teams[i * 2], r.teams[0], x + w * 0.2, cy, ls); logo(ctx, d.images.teams[i * 2 + 1], r.teams[1], x + w * 0.8, cy, ls);
        ctx.fillStyle = r.result ? "#FFFFFF" : LIME; font(ctx, 28, 700); text(ctx, r.score || "VS", x + w / 2, cy - 4, "center");
        ctx.fillStyle = "#FFFFFF"; fit(ctx, `${r.teams[0].short}  v  ${r.teams[1].short}`, w * 0.4, 26, 600); text(ctx, `${r.teams[0].short}  v  ${r.teams[1].short}`, x + w / 2, cy + 30, "center");
        if (r.result) { ctx.fillStyle = LIME; fit(ctx, r.result, w - 40, 18, 600, BODY, 11); text(ctx, r.result, x + w / 2, y + h - 18, "center"); }
      });
      return;
    }
    const gap = K.style === "B" ? 0 : 12, rowH = Math.min((bottom - y0) / n, n === 1 ? 520 : n === 2 ? 400 : n === 3 ? (H > 1500 ? 260 : 210) : H > 1500 ? 170 : 130), h = rowH - gap;
    const start = y0 + Math.max(0, (bottom - y0 - rowH * n) * 0.4);
    rows.forEach((r, i) => {
      const y = start + i * rowH, cw = K.style === "B" ? 190 : 176;
      K.chip(r.live ? "LIVE" : r.result ? "FT" : r.time || "TBA", 40, y, cw, h, { live: r.live, muted: !!r.result, size: K.style === "B" ? Math.min(40, h * 0.4) : Math.min(32, h * 0.34) });
      fixtureRow(ctx, K, 40 + cw + (K.style === "B" ? 10 : -12), y, W - 80 - cw - (K.style === "B" ? 10 : -12), h, Object.assign({}, r, { sub: r.result || r.tag }), [d.images.teams[i * 2], d.images.teams[i * 2 + 1]], { dim: i % 2 === 1 });
    });
  }

  function drawGroups(ctx, W, H, th, d, K) {
    const gs = d.groups.groups;
    K.bg();
    const top = K.head(d.groups.sub || ""), bottom = K.foot();
    const y0 = K.title(top + 6, d.groups.kicker || `${gs.length} groups`, "The groups", H > 1500 ? 150 : 124);
    const cols = gs.length > 1 ? 2 : 1, gridRows = Math.ceil(gs.length / cols), gap = 20;
    const gw = (W - 80 - gap * (cols - 1)) / cols, gh = (bottom - y0) / gridRows;
    // Rows grow to fill the space, up to a limit; what is left over is split above and below.
    const most = Math.max(1, ...gs.map((g) => g.teams.length)), hh = Math.min(64, (gh - gap) * 0.2);
    const rh = Math.min((gh - gap - hh - 14) / most, H > 1500 ? 200 : 150), used = hh + 14 + most * rh + 8;
    const off = Math.max(0, (bottom - y0 - gridRows * (used + gap)) / 2);
    let img = 0;
    gs.forEach((g, i) => {
      const x = 40 + (i % cols) * (gw + gap), y = y0 + off * 0.6 + Math.floor(i / cols) * (used + gap), h = used;
      if (K.style === "C") K.glass(x, y, gw, h, 26);
      K.panelHead(x, y, gw, hh, /^group/i.test(g.name) ? g.name : `Group ${g.name}`);
      g.teams.forEach((t, k) => {
        const ry = y + hh + 12 + k * rh, rhh = rh - 8;
        const ink = K.style === "C" ? { ink: "#FFFFFF" } : K.row(x, ry, gw, rhh, { c1: K.style === "A" ? t.c1 : null, dim: k % 2 === 1 });
        logo(ctx, d.images.teams[img++], t, x + 30 + rhh * 0.42, ry + rhh / 2, rhh * 0.8);
        ctx.fillStyle = ink.ink; fit(ctx, t.name.toUpperCase(), gw - rhh - 70, Math.min(34, rhh * 0.42), 700); text(ctx, t.name.toUpperCase(), x + 50 + rhh * 0.84, ry + rhh / 2 + Math.min(34, rhh * 0.42) * 0.36);
      });
    });
  }

  function drawLineup(ctx, W, H, th, d, K) {
    const lu = d.lineup, story = H > 1500;
    K.bg(lu.teams[0].c1, lu.teams[1].c1);
    const top = K.head(lu.stage || ""), bottom = K.foot() - (lu.toss ? 64 : 0);
    const y0 = K.title(top + 6, "", "Playing XI", story ? 140 : 110);
    const gap = 20, colW = (W - 80 - gap) / 2, headH = story ? 150 : 120;
    lu.teams.forEach((t, k) => {
      const x = 40 + k * (colW + gap);
      if (K.style === "A") { ctx.fillStyle = t.c1 || th.c1; skew(ctx, x, y0, colW, headH, 20); ctx.fill(); ctx.fillStyle = t.c2 || K.acc; skew(ctx, x, y0 + headH, colW, 10, 2); ctx.fill(); }
      if (K.style === "C") K.glass(x, y0, colW, bottom - y0, 30);
      logo(ctx, d.images.teams[k], t, x + 72, y0 + headH / 2, headH * 0.84);
      ctx.fillStyle = K.ink; fit(ctx, t.name.toUpperCase(), colW - 170, story ? 46 : 40, 700); text(ctx, t.name.toUpperCase(), x + 140, y0 + headH / 2 + 14);
      if (K.style === "B") { ctx.fillStyle = K.acc; ctx.fillRect(x + 140, y0 + headH / 2 + 30, 70, 4); }
      const n = Math.max(1, ...lu.teams.map((tt) => tt.players.length)), rs = y0 + headH + 22;
      const rowH = Math.min((bottom - rs) / n, story ? 130 : 74), h = rowH - (K.style === "B" ? 0 : 8);
      t.players.forEach((p, i) => {
        const y = rs + i * rowH;
        const ink = K.style === "C" ? { ink: "#FFFFFF" } : K.row(x, y, colW, h, { dim: i % 2 === 1 });
        if (K.style === "C" && i % 2 === 0) { ctx.fillStyle = "rgba(255,255,255,0.04)"; roundRect(ctx, x + 12, y, colW - 24, h, 12); ctx.fill(); }
        if (K.style === "A") { ctx.fillStyle = t.c1 || th.c1; skew(ctx, x, y, 62, h, Math.min(10, h * 0.2)); ctx.fill(); ctx.fillStyle = "#FFFFFF"; }
        else ctx.fillStyle = K.style === "C" ? LIME : rgba(INK, 0.5);
        font(ctx, Math.min(30, h * 0.48), 700); text(ctx, K.style === "B" ? String(i + 1).padStart(2, "0") : String(i + 1), x + 33, y + h / 2 + Math.min(30, h * 0.48) * 0.36, "center");
        const tags = [p.cap ? "C" : "", p.wk ? "WK" : ""].filter(Boolean);
        ctx.fillStyle = ink.ink; const fs = Math.min(30, h * 0.46);
        fit(ctx, K.style === "C" ? p.name : p.name.toUpperCase(), colW - 100 - tags.length * 56, fs, K.style === "C" ? 500 : 600, K.style === "C" ? BODY : DISPLAY, 14);
        text(ctx, K.style === "C" ? p.name : p.name.toUpperCase(), x + 76, y + h / 2 + fs * 0.36);
        let tx = x + colW - 18;
        for (const tg of tags.reverse()) {
          font(ctx, Math.min(20, h * 0.34), 700, BODY); const tw = ctx.measureText(tg).width + 22, th2 = Math.min(32, h * 0.6);
          tx -= tw;
          ctx.fillStyle = K.style === "C" ? rgba(LIME, 0.18) : K.acc; roundRect(ctx, tx, y + (h - th2) / 2, tw, th2, K.style === "A" ? 6 : th2 / 2); ctx.fill();
          ctx.fillStyle = K.style === "C" ? LIME : NAVY; text(ctx, tg, tx + tw / 2, y + h / 2 + Math.min(20, h * 0.34) * 0.36, "center");
          tx -= 8;
        }
      });
    });
    if (lu.toss) {
      const y = bottom + 10;
      if (K.style === "A") { ctx.fillStyle = K.acc; skew(ctx, 40, y, W - 80, 52, 16); ctx.fill(); ctx.fillStyle = NAVY; }
      else ctx.fillStyle = K.sub;
      fit(ctx, lu.toss.toUpperCase(), W - 140, 24, 700, BODY, 14); text(ctx, K.style === "A" ? lu.toss.toUpperCase() : lu.toss, W / 2, y + 34, "center");
    }
  }

  function drawVersus(ctx, W, H, th, d, K) {
    const v = d.versus, story = H > 1500, [a, b] = v.teams;
    K.bg(a.c1, b.c1);
    if (K.style === "A") { ctx.fillStyle = rgba(a.c1 || th.c1, 0.75); skew(ctx, -300, H * 0.22, W * 0.62 + 300, H * 0.5, 160); ctx.fill(); ctx.fillStyle = rgba(b.c1 || th.c2, 0.75); skew(ctx, W * 0.5, H * 0.22, W * 0.62, H * 0.5, 160); ctx.fill(); }
    if (K.style === "B") { ctx.fillStyle = rgba(mix(a.c1 || th.c1, "#000", 0.35), 0.7); ctx.fillRect(0, 0, W / 2, H); ctx.fillStyle = rgba(mix(b.c1 || th.c2, "#000", 0.35), 0.7); ctx.fillRect(W / 2, 0, W / 2, H); }
    const top = K.head(v.stage || ""), bottom = K.foot();
    const y0 = K.title(top + 6, "", "Match day", story ? 150 : 120);
    // The logos, names and match details sit in the middle of the space under the title.
    const ls = story ? 400 : 300, nInfo = [v.when, v.venue, v.rules].filter(Boolean).length;
    const block = ls + (story ? 80 : 64) + (story ? 120 : 70) + 70 + nInfo * 56;
    const cy = y0 + Math.max(story ? 40 : 20, (bottom - y0 - block) / 2) + ls / 2;
    v.teams.forEach((t, k) => {
      const cx = k ? W - 60 - ls / 2 : 60 + ls / 2;
      logo(ctx, d.images.teams[k], t, cx, cy, ls);
      ctx.fillStyle = K.ink; fit(ctx, t.name.toUpperCase(), ls + 120, story ? 56 : 48, 700); text(ctx, t.name.toUpperCase(), cx, cy + ls / 2 + (story ? 80 : 64), "center");
    });
    ctx.fillStyle = K.style === "C" ? LIME : K.style === "B" ? INK : "#FFFFFF"; font(ctx, story ? 170 : 140, 700); text(ctx, "VS", W / 2, cy + (story ? 60 : 50), "center");
    const lines = [v.when, v.venue, v.rules].filter(Boolean), bh = 70 + lines.length * 56, by = Math.min(bottom - bh - 10, cy + ls / 2 + (story ? 200 : 134));
    const ink = K.row(40, by, W - 80, bh, { hi: true });
    lines.forEach((l, i) => {
      ctx.fillStyle = i === 0 ? ink.ink : i === 2 ? (K.style === "A" ? NAVY : K.acc) : ink.sub;
      fit(ctx, i === 0 ? l.toUpperCase() : l, W - 180, i === 0 ? 52 : 30, i === 0 ? 700 : 600, i === 0 ? DISPLAY : BODY, 16);
      text(ctx, i === 0 ? l.toUpperCase() : l, W / 2, by + 62 + i * 56, "center");
    });
  }

  function wrap(ctx, t, maxW, maxLines) {
    const words = t.split(" "), lines = [""];
    for (const w of words) { const n = (lines[lines.length - 1] + " " + w).trim(); if (ctx.measureText(n).width > maxW && lines[lines.length - 1]) lines.push(w); else lines[lines.length - 1] = n; }
    return lines.slice(0, maxLines);
  }

  function drawResult(ctx, W, H, th, d, K) {
    const r = d.result, story = H > 1500;
    K.bg(r.teams[0].c1, r.teams[1] && r.teams[1].c1);
    const top = K.head(d.matchLabel || ""), bottom = K.foot();
    let y = top + 10;
    if (K.style === "C") { K.pill("RESULT", 50, y, 22); y += 54; }
    else { ctx.fillStyle = K.acc; font(ctx, 28, 700, BODY); spaced(ctx, "RESULT", 50, y + 24, 6); y += 40; }
    const size = K.style === "B" ? (story ? 130 : 112) : (story ? 104 : 92);
    ctx.fillStyle = K.ink; font(ctx, size, 700);
    for (const l of wrap(ctx, r.text.toUpperCase(), W - 100, 3)) { y += size * 0.98; fit(ctx, l, W - 100, size, 700); text(ctx, l, 46, y); }
    const rowH = story ? 250 : 180, perfH = r.topBat || r.topBowl ? (story ? 190 : 150) + 20 : 0;
    // Split what is left between the gaps above and below the scores.
    y += Math.max(story ? 80 : 44, (bottom - y - rowH * r.teams.length - perfH - 10) / 2);
    r.teams.forEach((t, i) => {
      const h = rowH - 18, cy = y + h / 2;
      const ink = K.row(40, y, W - 80, h, { c1: K.style === "A" ? t.c1 : null, win: t.won });
      logo(ctx, d.images.teams[i], t, 40 + 30 + h * 0.4, cy, h * 0.78);
      ctx.fillStyle = ink.ink; fit(ctx, t.name.toUpperCase(), W * 0.4, story ? 56 : 46, 700); text(ctx, t.name.toUpperCase(), 80 + h * 0.86, cy + 2);
      ctx.fillStyle = ink.sub; font(ctx, 24, 600, BODY); text(ctx, t.overs ? `${t.overs} overs` : "", 82 + h * 0.86, cy + 38);
      ctx.fillStyle = t.won ? ink.strong : ink.ink; font(ctx, story ? 110 : 92, 700); text(ctx, t.score, W - 80, cy + 34, "right");
      y += rowH;
    });
    const perf = [r.topBat && ["Top scorer", r.topBat], r.topBowl && ["Best bowling", r.topBowl]].filter(Boolean);
    if (!perf.length) return;
    const th2 = story ? 190 : 150, ty = Math.max(y + 20, bottom - th2 - 10), tw = (W - 80 - 16 * (perf.length - 1)) / perf.length;
    perf.forEach(([label, p], i) => {
      const x = 40 + i * (tw + 16), ink = K.tile(x, ty, tw, th2, i), pad = ink.pad || 24;
      ctx.fillStyle = ink.sub; font(ctx, 20, 700, BODY); spaced(ctx, label.toUpperCase(), x + pad, ty + 40, 3);
      ctx.fillStyle = ink.ink; fit(ctx, p.name.toUpperCase(), tw - pad * 2, 40, 700, DISPLAY, 18); text(ctx, p.name.toUpperCase(), x + pad, ty + 86);
      ctx.fillStyle = ink.val; font(ctx, 46, 700); text(ctx, p.figures, x + pad, ty + th2 - 22);
    });
  }

  function drawTable(ctx, W, H, th, d, K) {
    const tb = d.table, story = H > 1500, rows = tb.rows.slice(0, story ? 12 : 10);
    K.bg();
    const top = K.head(tb.group ? `Group ${tb.group}` : "Standings"), bottom = K.foot();
    const y0 = K.title(top + 6, tb.group ? `Group ${tb.group}` : "Standings", "Points table", story ? 140 : 110);
    const cols = [["P", 620], ["W", 690], ["L", 760], ["PTS", 860], ["NRR", W - 70]];
    // Rows grow up to a limit; a third of what is left goes above them, under the title.
    const legend = 70, rs0 = y0 + 34, rowH = Math.min((bottom - legend - rs0) / Math.max(rows.length, 1), story ? 210 : 165);
    const rs = rs0 + Math.max(0, (bottom - legend - rs0 - rowH * rows.length) / 3), h = rowH - (K.style === "B" ? 0 : 10);
    ctx.fillStyle = K.sub; font(ctx, 22, 700, BODY);
    for (const [l, x] of cols) text(ctx, l, x, rs - 18, "right");
    rows.forEach((r, i) => {
      const y = rs + i * rowH, cy = y + h / 2, q = i < (tb.qualify || 2);
      const ink = K.row(40, y, W - 80, h, { c1: K.style === "A" ? r.c1 : null, win: q, dim: i % 2 === 1 });
      ctx.fillStyle = ink.sub; font(ctx, Math.min(34, h * 0.4), 700); text(ctx, String(i + 1), 92, cy + 12, "center");
      const ls = Math.min(h * 0.74, 92);
      logo(ctx, d.images.teams[i], r, 128 + ls / 2, cy, ls);
      ctx.fillStyle = ink.ink; fit(ctx, r.name.toUpperCase(), 570 - 140 - ls, Math.min(46, h * 0.36), 700, DISPLAY, 16); text(ctx, r.name.toUpperCase(), 144 + ls, cy + 13);
      font(ctx, Math.min(40, h * 0.32), 600);
      text(ctx, String(r.p), 620, cy + 13, "right"); text(ctx, String(r.w), 690, cy + 13, "right"); text(ctx, String(r.l), 760, cy + 13, "right");
      ctx.fillStyle = q ? ink.strong : ink.ink; font(ctx, Math.min(56, h * 0.42), 700); text(ctx, String(r.pts), 860, cy + 15, "right");
      ctx.fillStyle = ink.sub; font(ctx, Math.min(28, h * 0.32), 600, BODY); text(ctx, r.nrr, W - 70, cy + 10, "right");
    });
    const q = Math.min(tb.qualify || 2, rows.length), ly = rs + rows.length * rowH + 44;
    if (q && rows.length > q) { ctx.fillStyle = K.style === "C" ? LIME : K.acc; ctx.fillRect(44, ly - 18, 28, 8); ctx.fillStyle = K.sub; font(ctx, 22, 600, BODY); text(ctx, `Top ${q} go through`, 86, ly - 6); }
  }

  const ROLE_SHORT = { batter: "BATTER", bowler: "BOWLER", allrounder: "ALL-ROUNDER", keeper: "KEEPER" };

  function drawSquad(ctx, W, H, th, d, K) {
    const sq = d.squad, story = H > 1500, max = story ? 24 : 20, ps = sq.players.slice(0, max);
    K.bg(sq.team.c1, sq.team.c2);
    const top = K.head(sq.sub || "Squad announcement"), bottom = K.foot() - (sq.players.length > max ? 36 : 0);
    const ls = story ? 230 : 190;
    logo(ctx, d.images.teams[0], sq.team, W - 50 - ls / 2, top + 20 + ls / 2, ls);
    ctx.fillStyle = K.acc; font(ctx, 26, 700, BODY); spaced(ctx, "SQUAD ANNOUNCEMENT", 52, top + 44, 6);
    ctx.fillStyle = K.ink; const ts = fit(ctx, sq.team.name.toUpperCase(), W - 140 - ls, story ? 120 : 104, 700, DISPLAY, 40); text(ctx, sq.team.name.toUpperCase(), 46, top + 60 + ts * 0.88);
    ctx.fillStyle = K.sub; font(ctx, 26, 500, BODY);
    text(ctx, [`${sq.players.length} players`, sq.captain ? `Captain ${sq.captain}` : ""].filter(Boolean).join(" · "), 52, top + 100 + ts * 0.88);
    const y0 = top + 40 + ls + 10, cols = 2, gap = 16, rows = Math.ceil(ps.length / cols), colW = (W - 80 - gap) / cols;
    const rowH = Math.min((bottom - y0) / Math.max(rows, 1), story ? 130 : 104), h = rowH - (K.style === "B" ? 0 : 10);
    const start = y0 + Math.max(0, bottom - y0 - rows * rowH) * 0.35;
    ps.forEach((p, i) => {
      const x = 40 + (i % cols) * (colW + gap), y = start + Math.floor(i / cols) * rowH;
      const ink = K.row(x, y, colW, h, { hi: p.cap, dim: Math.floor(i / cols) % 2 === 1 });
      const nw = Math.min(h * 1.05, 86);
      K.chip(p.no != null ? String(p.no) : "–", x, y, nw, h, { size: Math.min(36, h * 0.46) });
      const role = ROLE_SHORT[p.role] || "", tags = [p.cap ? "C" : "", p.wk ? "WK" : ""].filter(Boolean);
      ctx.fillStyle = ink.ink; fit(ctx, p.name.toUpperCase(), colW - nw - 40 - tags.length * 50, Math.min(32, h * (role ? 0.38 : 0.44)), 700, DISPLAY, 14);
      text(ctx, p.name.toUpperCase(), x + nw + 16, y + (role ? h * 0.5 : h * 0.64));
      if (role) { ctx.fillStyle = ink.sub; font(ctx, Math.min(17, h * 0.2), 700, BODY); spaced(ctx, role, x + nw + 17, y + h * 0.8, 2); }
      let tx = x + colW - 14;
      for (const tg of tags.reverse()) {
        font(ctx, Math.min(20, h * 0.3), 700, BODY); const tw = ctx.measureText(tg).width + 22, hh = Math.min(32, h * 0.5);
        tx -= tw; ctx.fillStyle = K.style === "C" ? LIME : K.acc; roundRect(ctx, tx, y + (h - hh) / 2, tw, hh, hh / 2); ctx.fill();
        ctx.fillStyle = K.style === "B" ? "#1A1410" : NAVY; text(ctx, tg, tx + tw / 2, y + h / 2 + Math.min(20, h * 0.3) * 0.36, "center"); tx -= 8;
      }
    });
    if (sq.players.length > max) { ctx.fillStyle = K.sub; font(ctx, 24, 600, BODY); text(ctx, `+ ${sq.players.length - max} more`, 52, bottom + 26); }
  }

  function drawLeaders(ctx, W, H, th, d, K) {
    const ld = d.leaders, story = H > 1500, rows = ld.rows.slice(0, story ? 8 : 5);
    K.bg(rows[0] && rows[0].team.c1);
    const top = K.head(ld.sub || ""), bottom = K.foot();
    const y0 = K.title(top + 6, "Tournament leaders", ld.title, story ? 140 : 110);
    if (!rows.length) return;
    const first = rows[0], hh = story ? 420 : 330;
    const ink = K.row(40, y0, W - 80, hh, { c1: K.style === "A" ? first.team.c1 : null, hi: true });
    ctx.save(); roundRect(ctx, 40, y0, W - 80, hh, K.style === "C" ? 26 : 0); ctx.clip();
    player(ctx, d.images.player, { cx: 230, bottom: y0 + hh, h: hh * 0.98, w: 360 }, first.team, first.no);
    ctx.restore();
    logo(ctx, d.images.teams[0], first.team, 400, y0 + 70, 84);
    const tx = 460;
    ctx.fillStyle = K.style === "A" ? NAVY : K.acc; font(ctx, 26, 700, BODY); spaced(ctx, "#1", tx, y0 + 80, 4);
    ctx.fillStyle = K.style === "A" ? NAVY : K.acc; font(ctx, Math.round(hh * 0.42), 700); text(ctx, String(first.value), W - 76, y0 + hh * 0.56, "right");
    ctx.fillStyle = ink.sub; font(ctx, 22, 700, BODY); spaced(ctx, ld.unit.toUpperCase(), W - 76, y0 + hh * 0.56 + 36, 4, "right");
    ctx.fillStyle = ink.ink; fit(ctx, first.name.toUpperCase(), W - 116 - tx, story ? 64 : 54, 700, DISPLAY, 22); text(ctx, first.name.toUpperCase(), tx, y0 + hh - 82);
    ctx.fillStyle = ink.sub; fit(ctx, `${first.team.name}${first.sub ? " · " + first.sub : ""}`, W - 116 - tx, 24, 600, BODY, 14); text(ctx, `${first.team.name}${first.sub ? " · " + first.sub : ""}`, tx, y0 + hh - 42);
    const rest = rows.slice(1), rs = y0 + hh + 18, rowH = Math.min((bottom - rs) / Math.max(rest.length, 1), story ? 190 : 110), h = rowH - (K.style === "B" ? 0 : 10);
    rest.forEach((r, i) => {
      const y = rs + i * rowH, cy = y + h / 2;
      const ik = K.row(40, y, W - 80, h, { c1: K.style === "A" ? r.team.c1 : null, dim: i % 2 === 1 });
      ctx.fillStyle = ik.sub; font(ctx, Math.min(40, h * 0.44), 700); text(ctx, String(i + 2), 92, cy + 14, "center");
      logo(ctx, d.images.teams[i + 1], r.team, 168, cy, h * 0.72);
      ctx.fillStyle = ik.ink; fit(ctx, r.name.toUpperCase(), W - 470, Math.min(36, h * 0.4), 700, DISPLAY, 16); text(ctx, r.name.toUpperCase(), 222, cy + (r.sub ? 0 : 12));
      if (r.sub) { ctx.fillStyle = ik.sub; fit(ctx, `${r.team.short} · ${r.sub}`, W - 470, Math.min(20, h * 0.22), 500, BODY, 12); text(ctx, `${r.team.short} · ${r.sub}`, 223, cy + h * 0.3); }
      ctx.fillStyle = K.style === "A" ? NAVY : K.acc; font(ctx, Math.min(52, h * 0.56), 700); text(ctx, String(r.value), W - 76, cy + 18, "right");
    });
  }

  function drawTarget(ctx, W, H, th, d, K) {
    const t = d.target, story = H > 1500;
    K.bg(t.batting.c1, t.chasing.c1);
    const top = K.head(d.matchLabel || ""), bottom = K.foot();
    let y = top + 10;
    if (K.style === "C") { K.pill("INNINGS BREAK", 50, y, 22); y += 60; } else { ctx.fillStyle = K.acc; font(ctx, 28, 700, BODY); spaced(ctx, "INNINGS BREAK", 50, y + 24, 6); y += 50; }
    const rh = story ? 140 : 116, ink = K.row(40, y, W - 80, rh, { c1: K.style === "A" ? t.batting.c1 : null });
    logo(ctx, d.images.teams[0], t.batting, 120, y + rh / 2, rh * 0.8);
    ctx.fillStyle = ink.ink; fit(ctx, t.batting.name.toUpperCase(), 420, story ? 48 : 42, 700); text(ctx, t.batting.name.toUpperCase(), 186, y + rh / 2 + 14);
    font(ctx, story ? 76 : 64, 700); text(ctx, `${t.runs}/${t.wickets}`, W - 190, y + rh / 2 + 24, "right");
    ctx.fillStyle = ink.sub; font(ctx, 24, 600, BODY); text(ctx, `(${t.overs})`, W - 72, y + rh / 2 + 20, "right");
    // The chasing side sits just above the performers; the target goes in the middle of the gap.
    const perf = [t.topBat, t.topBowl].filter(Boolean), th2 = story ? 190 : 150, ty = bottom - th2 - 10;
    const cyRow = (perf.length ? ty : bottom) - rh - 26, bs = story ? 400 : 330, block = bs * 0.86 + 100;
    const ck = K.row(40, cyRow, W - 80, rh, { c1: K.style === "A" ? t.chasing.c1 : null, dim: true });
    logo(ctx, d.images.teams[1], t.chasing, 120, cyRow + rh / 2, rh * 0.8);
    ctx.fillStyle = ck.ink; fit(ctx, t.chasing.name.toUpperCase(), 420, story ? 48 : 42, 700); text(ctx, t.chasing.name.toUpperCase(), 186, cyRow + rh / 2 + 14);
    ctx.fillStyle = ck.sub; font(ctx, 22, 700, BODY); spaced(ctx, "TO BAT", W - 72, cyRow + rh / 2 - 8, 4, "right");
    ctx.fillStyle = K.style === "A" ? NAVY : K.acc; font(ctx, 26, 700, BODY); text(ctx, `RRR ${t.rrr}`, W - 72, cyRow + rh / 2 + 28, "right");
    y += rh + Math.max(story ? 60 : 40, (cyRow - y - rh - block) / 2);
    ctx.fillStyle = K.ink; font(ctx, 34, 700, BODY); spaced(ctx, `${t.chasing.short || t.chasing.name} NEED`.toUpperCase(), 52, y, 6);
    ctx.fillStyle = K.style === "C" ? LIME : K.acc; font(ctx, bs, 700); text(ctx, String(t.target), 40, y + bs * 0.86);
    const bw = ctx.measureText(String(t.target)).width;
    ctx.fillStyle = K.ink; font(ctx, story ? 72 : 60, 700); text(ctx, "RUNS", 40 + bw + 26, y + bs * 0.5);
    ctx.fillStyle = K.sub; font(ctx, story ? 42 : 36, 600); text(ctx, `FROM ${t.balls} BALLS`, 42 + bw + 26, y + bs * 0.5 + (story ? 60 : 52));
    ctx.fillStyle = K.ink; font(ctx, 30, 600, BODY); text(ctx, `Required rate ${t.rrr} an over`, 52, y + bs * 0.86 + 60);
    const tw = (W - 80 - 16 * (perf.length - 1)) / Math.max(perf.length, 1);
    perf.forEach((p, i) => {
      const x = 40 + i * (tw + 16), ik = K.tile(x, ty, tw, th2, i), pad = ik.pad || 24;
      ctx.fillStyle = ik.sub; font(ctx, 20, 700, BODY); spaced(ctx, p.label.toUpperCase(), x + pad, ty + 40, 3);
      ctx.fillStyle = ik.ink; fit(ctx, p.name.toUpperCase(), tw - pad * 2, 40, 700, DISPLAY, 18); text(ctx, p.name.toUpperCase(), x + pad, ty + 86);
      ctx.fillStyle = ik.val; font(ctx, 46, 700); text(ctx, p.figures, x + pad, ty + th2 - 22);
    });
  }

  // Champions and runners-up: the team's badge in a laurel, light rays and confetti.
  function drawChampions(ctx, W, H, th, d, K) {
    const c = d.champions, story = H > 1500, silver = !!c.silver;
    const gold = silver ? "#D9DEE5" : K.style === "C" ? LIME : K.style === "A" ? "#F5C542" : K.acc;
    K.bg(c.team.c1, c.team.c2);
    const cx = W / 2, cy = story ? H * 0.5 : H * 0.52, r = story ? 230 : 190;
    ctx.save(); ctx.translate(cx, cy);
    for (let i = 0; i < 28; i++) {
      ctx.rotate((Math.PI * 2) / 28);
      ctx.fillStyle = i % 2 ? "rgba(255,255,255,0.03)" : rgba(gold, 0.09);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-70, -H); ctx.lineTo(70, -H); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    const glow = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 2.4);
    glow.addColorStop(0, rgba(gold, 0.3)); glow.addColorStop(1, rgba(gold, 0)); ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    const top = K.head(c.season ? `Season ${c.season}` : c.stage || ""), bottom = K.foot();
    const R = r + 50, titleY = cy - R - (story ? 70 : 46);
    if (!silver) {
      let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const colours = [gold, "#FFFFFF", c.team.c1 || th.c1];
      for (let i = 0; i < 90; i++) {
        const x = rnd() * W, y = top + rnd() * (bottom - top), rot = rnd() * Math.PI, al = 0.35 + rnd() * 0.5;
        if (Math.hypot(x - cx, y - cy) < R * 1.25 || Math.abs(y - titleY + 60) < 110 || y > cy + R + 20) continue;
        ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.globalAlpha = al; ctx.fillStyle = colours[i % 3]; ctx.fillRect(-6, -14, 12, 28); ctx.restore();
      }
    }
    if (K.style === "C") {
      ctx.strokeStyle = gold; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(cx, cy, R - 10, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = rgba(gold, 0.25); ctx.lineWidth = 28; ctx.beginPath(); ctx.arc(cx, cy, R - 10, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.fillStyle = gold;
      for (const side of [-1, 1]) {
        ctx.save(); ctx.strokeStyle = gold; ctx.lineWidth = 5; ctx.beginPath();
        if (side > 0) ctx.arc(cx, cy, R - 8, Math.PI / 2 - 0.3 - 11 * 0.21, Math.PI / 2 - 0.3); else ctx.arc(cx, cy, R - 8, Math.PI / 2 + 0.3, Math.PI / 2 + 0.3 + 11 * 0.21);
        ctx.stroke(); ctx.restore();
        for (let j = 0; j < 12; j++) {
          const a = Math.PI / 2 + side * (0.3 + j * 0.21);
          ctx.save(); ctx.translate(cx + R * Math.cos(a), cy + R * Math.sin(a)); ctx.rotate(a + (side > 0 ? 0.5 : -0.5));
          ctx.beginPath(); ctx.ellipse(0, 0, 11, 28, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        }
      }
    }
    logo(ctx, d.images.teams[0], c.team, cx, cy, r * 1.7);
    const word = (c.title || (silver ? "Runners-up" : "Champions")).toUpperCase();
    ctx.fillStyle = gold; const ws = fit(ctx, word, W - 90, story ? 200 : 170, 700, DISPLAY, 60);
    if (K.style === "B") { ctx.save(); ctx.strokeStyle = gold; ctx.lineWidth = 4; ctx.textAlign = "center"; ctx.strokeText(word, cx, titleY); ctx.restore(); ctx.fillStyle = rgba(gold, 0.25); }
    text(ctx, word, cx, titleY, "center");
    const ny = cy + R + (story ? 120 : 92);
    if (K.style === "A") { ctx.fillStyle = "#FFFFFF"; skew(ctx, 80, ny - 82, W - 160, 104, 26); ctx.fill(); ctx.fillStyle = NAVY; } else ctx.fillStyle = K.ink;
    fit(ctx, c.team.name.toUpperCase(), W - 220, story ? 96 : 80, 700, DISPLAY, 30); text(ctx, c.team.name.toUpperCase(), cx, ny, "center");
    if (c.result && K.style === "A") { font(ctx, 30, 500, BODY); const rw = Math.min(W - 120, ctx.measureText(c.result).width + 80), ry = ny + (story ? 70 : 58); ctx.fillStyle = NAVY; skew(ctx, cx - rw / 2, ry - 36, rw, 52, 14); ctx.fill(); ctx.fillStyle = "#FFFFFF"; fit(ctx, c.result, rw - 60, 30, 500, BODY, 18); text(ctx, c.result, cx, ry, "center"); }
    else if (c.result) { ctx.fillStyle = K.sub; fit(ctx, c.result, W - 140, 30, 500, BODY, 18); text(ctx, c.result, cx, ny + (story ? 70 : 58), "center"); }
    void ws;
  }

  // ---------- Player cards: milestones, player of the match, awards (A and B) ----------

  const MILESTONE = {
    fifty: { word: "FIFTY", mark: "50" }, hundred: { word: "HUNDRED", mark: "100" },
    threefor: { word: "THREE-FOR", mark: "3W" }, fivefor: { word: "FIVE-FOR", mark: "5W" },
    batting: { word: "BATTING", k2: "FIGURES" }, bowling: { word: "BOWLING", k2: "FIGURES" },
  };

  // One shape for every player card.
  function heroOf(kind, d) {
    if (kind === "milestone") {
      const m = d.milestone, M = MILESTONE[m.kind], last = d.player.name.split(" ").slice(-1)[0];
      return {
        k1: M.word, k2: m.batting ? "UP!" : "TAKEN!", kicker: M.word, big: [M.word, last.toUpperCase()],
        badge: m.batting ? `${m.runs}${m.notOut ? "*" : ""}` : `${m.wickets}/${m.runs}`, badgeLabel: m.batting ? `OFF ${m.balls} BALLS` : `IN ${m.overs} OVERS`,
        line: `${d.player.team} v ${d.opponent}`,
        stats: m.batting ? [[String(m.fours), "", m.fours === 1 ? "Four" : "Fours"], [String(m.sixes), "", m.sixes === 1 ? "Six" : "Sixes"], [String(m.sr), "", "Strike rate"]]
          : [[String(m.overs), "", "Overs"], [String(m.maidens), "", m.maidens === 1 ? "Maiden" : "Maidens"], [String(m.econ), "", "Economy"]],
      };
    }
    if (kind === "potm") {
      const p = d.potm, parts = d.player.name.split(" ");
      return { k1: "PLAYER OF", k2: "THE MATCH", kicker: "PLAYER OF THE MATCH", big: [parts[0].toUpperCase(), (parts.slice(-1)[0] || "").toUpperCase()],
        badge: String(p.pts || ""), badgeLabel: "MVP PTS", line: p.line, stats: p.tiles.map((t) => [t.v, t.s || "", t.k]) };
    }
    const a = d.award, parts = d.player.name.split(" ");
    return { k1: a.k1, k2: a.k2, kicker: a.title, big: [a.big || parts[0].toUpperCase(), (parts.slice(-1)[0] || "").toUpperCase()],
      badge: a.badge, badgeLabel: a.badgeLabel, line: a.line, stats: a.stats };
  }

  // Background colours from the jersey: the opposite hue, dark, so the kit stands out.
  function heroColours(d, th) {
    const img = d.images.player, tc = d.player.c1 || th.c1;
    const j = img ? jerseyColour(img) : null;
    const jersey = j || tc, hue = hueOf(jersey);
    const sat = (() => { const [r, g, b] = hexRgb(jersey); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx ? (mx - mn) / mx : 0; })();
    if (sat < 0.25) return { base: mix(th.c1, "#000000", 0.55), panel: th.c1, accent: th.accent };
    const comp = hue + 180;
    const accent = [hsl(hue, 90, 62), hsl(comp + 30, 90, 62), "#F5C542"].find((c) => contrast(c, hsl(comp, 55, 18)) >= 4.5) || "#FFFFFF";
    return { base: hsl(comp, 55, 14), panel: hsl(comp, 62, 34), accent };
  }

  function drawHeroA(ctx, W, H, th, d, K) {
    const h = heroOf(d.kind, d), hc = heroColours(d, th), story = H > 1500;
    const k = Object.assign({}, K, { acc: hc.accent });
    ctx.fillStyle = hc.base; ctx.fillRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, rgba(hc.panel, 0.9)); g.addColorStop(1, rgba(hc.panel, 0.1));
    ctx.fillStyle = g; skew(ctx, -200, 0, 900, H, H * 0.19); ctx.fill();
    ctx.fillStyle = rgba(hc.accent, 0.9); skew(ctx, 640, 0, 70, H, H * 0.19); ctx.fill();
    ctx.fillStyle = rgba(hc.accent, 0.35); skew(ctx, 730, 0, 22, H, H * 0.19); ctx.fill();
    ctx.save(); ctx.strokeStyle = "rgba(255,255,255,0.04)"; ctx.lineWidth = 2;
    for (let i = -H; i < W; i += 26) { ctx.beginPath(); ctx.moveTo(i, H); ctx.lineTo(i + H * 0.6, 0); ctx.stroke(); }
    ctx.restore();
    const ltY = H - 490 - (story ? 40 : 0), tilesY = H - 294;
    ctx.fillStyle = rgba(hc.panel, 0.95); skew(ctx, 430, 180, 700, ltY - 120, 160); ctx.fill();
    if (d.images.teams && d.images.teams[0] !== undefined) { ctx.save(); ctx.globalAlpha = 0.16; logo(ctx, d.images.teams[0], { short: d.player.teamShort, c1: d.player.c1, c2: d.player.c2 }, 860, 420, 420); ctx.restore(); }
    player(ctx, d.images.player, { cx: 760, bottom: ltY + 40, h: ltY + 40 - 170, w: 640 }, { c1: d.player.c1, c2: d.player.c2 }, d.player.no);
    kitA({ c1: hc.panel, accent: hc.accent }, W, H, d).use(ctx).head(d.matchLabel || "");
    // Stacked kicker tags
    ctx.fillStyle = hc.accent; skew(ctx, 40, 250, 400, 72, 18); ctx.fill();
    ctx.fillStyle = NAVY; fit(ctx, h.k1, 330, 48, 700); text(ctx, h.k1, 64, 303);
    ctx.fillStyle = "#FFFFFF"; skew(ctx, 40, 332, 360, 72, 18); ctx.fill();
    ctx.fillStyle = NAVY; fit(ctx, h.k2, 290, 48, 700); text(ctx, h.k2, 64, 385);
    if (h.badge) {
      ctx.fillStyle = "rgba(255,255,255,0.12)"; skew(ctx, 40, 436, 280, 140, 18); ctx.fill();
      ctx.fillStyle = hc.accent; fit(ctx, h.badge, 230, 88, 700); text(ctx, h.badge, 66, 530);
      ctx.fillStyle = "#FFFFFF"; font(ctx, 18, 700, BODY); spaced(ctx, h.badgeLabel, 68, 560, 2);
    }
    ctx.fillStyle = "#FFFFFF"; skew(ctx, 0, ltY, 920, 120, 30); ctx.fill();
    ctx.fillStyle = d.player.c1 || hc.accent; skew(ctx, 0, ltY, 22, 120, 4); ctx.fill();
    ctx.fillStyle = NAVY; fit(ctx, d.player.name.toUpperCase(), 840, 84, 700); text(ctx, d.player.name.toUpperCase(), 50, ltY + 90);
    ctx.fillStyle = NAVY; skew(ctx, 0, ltY + 120, 820, 50, 14); ctx.fill();
    ctx.fillStyle = "#FFFFFF"; fit(ctx, h.line.toUpperCase(), 740, 24, 600, BODY, 14); text(ctx, h.line.toUpperCase(), 50, ltY + 154);
    const n = h.stats.length, bw = (W - 80 - 16 * (n - 1)) / n;
    h.stats.forEach(([v, s, lab], i) => {
      const x = 40 + i * (bw + 16);
      ctx.fillStyle = NAVY; ctx.fillRect(x, tilesY, bw, 140); ctx.fillStyle = i === 0 ? hc.accent : hc.panel; ctx.fillRect(x, tilesY, bw, 8);
      ctx.fillStyle = "#FFFFFF"; fit(ctx, v, bw - 60, 64, 700); text(ctx, v, x + 22, tilesY + 86);
      if (s) { const vw = ctx.measureText(v).width; ctx.fillStyle = "rgba(255,255,255,0.6)"; font(ctx, 30, 600); text(ctx, s, x + 30 + vw, tilesY + 86); }
      ctx.fillStyle = hc.accent; font(ctx, 18, 700, BODY); spaced(ctx, lab.toUpperCase(), x + 24, tilesY + 118, 3);
    });
    k.foot();
  }

  function drawHeroB(ctx, W, H, th, d, K) {
    const h = heroOf(d.kind, d), hc = heroColours(d, th), story = H > 1500;
    ctx.fillStyle = hc.base; ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W * 0.6, H * 0.35, 50, W * 0.6, H * 0.35, W);
    g.addColorStop(0, rgba(hc.panel, 0.8)); g.addColorStop(1, rgba(hc.panel, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const b1 = story ? H * 0.34 : 560, b2 = story ? H * 0.52 : 860;
    ctx.fillStyle = rgba(INK, 0.95); fit(ctx, h.big[0], W - 40, story ? 380 : 330, 700, DISPLAY, 80); text(ctx, h.big[0], W / 2, b1, "center");
    ctx.save(); ctx.strokeStyle = rgba(INK, 0.5); ctx.lineWidth = 3; fit(ctx, h.big[1], W - 40, story ? 380 : 330, 700, DISPLAY, 80); ctx.textAlign = "center"; ctx.strokeText(h.big[1], W / 2, b2); ctx.restore();
    const nameY = H - (story ? 380 : 300);
    player(ctx, d.images.player, { cx: W / 2 + 30, bottom: nameY + 40, h: nameY + 40 - (story ? 260 : 210), w: 760 }, { c1: d.player.c1, c2: d.player.c2 }, d.player.no);
    const kb = kitB({ c1: hc.panel, accent: hc.accent }, W, H, d).use(ctx);
    kb.head(d.matchLabel || "");
    ctx.fillStyle = hc.accent; font(ctx, 28, 700, BODY); spaced(ctx, h.kicker.toUpperCase(), W / 2, 210, 10, "center");
    const sh = ctx.createLinearGradient(0, nameY - 200, 0, H); sh.addColorStop(0, "rgba(0,0,0,0)"); sh.addColorStop(0.35, "rgba(0,0,0,0.75)"); ctx.fillStyle = sh; ctx.fillRect(0, nameY - 200, W, H - nameY + 200);
    ctx.fillStyle = INK; fit(ctx, d.player.name.toUpperCase(), W - 100, 60, 700); text(ctx, d.player.name.toUpperCase(), 50, nameY);
    ctx.fillStyle = rgba(INK, 0.72); fit(ctx, h.line, W - 100, 24, 500, BODY, 14); text(ctx, h.line, 52, nameY + 38);
    const cols = h.badge ? h.stats.concat([[h.badge, "", h.badgeLabel]]) : h.stats, cw = (W - 100) / cols.length, ty = nameY + 64;
    cols.forEach(([v, s, lab], i) => {
      const x = 50 + i * cw;
      ctx.strokeStyle = rgba(INK, 0.35); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, ty); ctx.lineTo(x, ty + 100); ctx.stroke();
      ctx.fillStyle = i === cols.length - 1 && h.badge ? hc.accent : i === 0 ? hc.accent : INK; fit(ctx, v, cw - 40, 62, 700); text(ctx, v, x + 18, ty + 68);
      if (s) { const vw = ctx.measureText(v).width; ctx.fillStyle = rgba(INK, 0.6); font(ctx, 24, 500); text(ctx, s, x + 26 + vw, ty + 68); }
      ctx.fillStyle = rgba(INK, 0.62); fit(ctx, lab.toUpperCase(), cw - 30, 16, 700, BODY, 11); spaced(ctx, lab.toUpperCase(), x + 20, ty + 96, 2);
    });
    kb.foot();
  }

  // ---------- Milestone cards: Spotlight and Split ----------

  // Colours from the jersey in the photo (or the team colours), the way the studio projects do it.
  function jerseyPalette(d) {
    const J = root.CSA && root.CSA.jersey, img = d.images.player;
    let c = null;
    if (J && img) try { c = J.pickJerseyColors(img); } catch (e) { c = null; }
    if (!c) c = { primary: d.player.c1 || d.tournament.c1 || "#0F7A45", secondary: d.player.c2 || d.tournament.c2 || "#111111" };
    return paletteOf(c.primary, c.secondary);
  }
  function paletteOf(primary, secondary) {
    const J = root.CSA && root.CSA.jersey;
    if (!J) return { base: primary, deep: mix(primary, "#000000", 0.85), mid: mix(primary, "#000000", 0.55), glow: mix(primary, "#FFFFFF", 0.5), accent: "#F5C542", mvp: "#F5C542" };
    return J.vividPalette(primary, secondary);
  }

  // What a milestone card says, for batting and bowling alike.
  function milestoneText(d) {
    const m = d.milestone, M = MILESTONE[m.kind], words = d.player.name.trim().split(/\s+/);
    return m.batting
      ? { word: M.word, k2: M.k2 || "UP!", mark: M.mark || String(m.runs), big: String(m.runs), star: !!m.notOut, sub: `OFF ${m.balls} BALLS`, subShort: `${m.balls} BALLS`,
        stats: [[m.fours, m.fours === 1 ? "Four" : "Fours"], [m.sixes, m.sixes === 1 ? "Six" : "Sixes"], [m.sr, "Strike rate"]],
        first: words.length > 1 ? words.slice(0, -1).join(" ") : "", last: words[words.length - 1] }
      : { word: M.word, k2: M.k2 || "TAKEN!", mark: M.mark || `${m.wickets}W`, big: `${m.wickets}/${m.runs}`, star: false, sub: `IN ${m.overs} OVERS`, subShort: `${m.overs} OVERS`,
        stats: [[m.overs, "Overs"], [m.maidens, m.maidens === 1 ? "Maiden" : "Maidens"], [m.econ, "Economy"]],
        first: words.length > 1 ? words.slice(0, -1).join(" ") : "", last: words[words.length - 1] };
  }

  // Sponsor logos in a row, right-aligned at (x, y): used where the foot is taken by the card itself.
  function sponsorRow(ctx, d, x, y, align, dim) {
    const list = d.sponsor && d.sponsor.show === false ? [] : (d.sponsors || []).map((s, i) => ({ name: s.name || "", img: d.images.sponsors[i] })).filter((s) => s.img || s.name);
    if (!list.length) return;
    ctx.fillStyle = dim; font(ctx, 15, 700, BODY);
    const items = list.map((sp) => sp.img ? { img: sp.img, w: Math.min(140 / sp.img.width, 40 / sp.img.height) * sp.img.width } : { name: sp.name.toUpperCase(), w: (font(ctx, 24, 700), ctx.measureText(sp.name.toUpperCase()).width) });
    const total = items.reduce((a, it) => a + it.w, 0) + 20 * (items.length - 1);
    let cx = align === "right" ? x - total : x;
    ctx.fillStyle = dim; font(ctx, 15, 700, BODY); spaced(ctx, list.length > 1 ? "SPONSORS" : "PRESENTED BY", align === "right" ? x : x, y, 3, align === "right" ? "right" : "left");
    for (const it of items) {
      if (it.img) { const k = it.w / it.img.width; ctx.drawImage(it.img, cx, y + 12 + (40 - it.img.height * k) / 2, it.w, it.img.height * k); }
      else { ctx.fillStyle = "#FFFFFF"; font(ctx, 24, 700); text(ctx, it.name, cx, y + 42); }
      cx += it.w + 20;
    }
  }

  function tournamentMark(ctx, d, x, y, size) {
    logo(ctx, d.images.tournament, { short: d.tournament.short || d.tournament.initials || "", c1: d.tournament.c1, c2: d.tournament.c2 }, x + size / 2, y + size / 2, size);
  }

  // Spotlight: a dark stage lit in the jersey colour, a ghost "50" behind the player, the score as the hero number.
  function drawSpotlight(ctx, W, H, th, d) {
    const P = jerseyPalette(d), t = milestoneText(d), dy = H - 1350, acc = P.mvp || P.accent;
    const BG = mix(P.deep, "#000000", 0.35);
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
    let g = ctx.createRadialGradient(720, 520 + dy * 0.4, 40, 720, 520 + dy * 0.4, 900 + dy * 0.3);
    g.addColorStop(0, rgba(mix(P.base, "#FFFFFF", 0.08), 0.95)); g.addColorStop(0.55, rgba(P.deep, 0.7)); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (const [x0, w, a] of [[520, 160, 0.07], [760, 90, 0.05], [380, 60, 0.04]]) {
      const l = ctx.createLinearGradient(0, 0, 0, H); l.addColorStop(0, `rgba(255,255,255,${a})`); l.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = l; ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0 + w, 0); ctx.lineTo(x0 + w + 260, H); ctx.lineTo(x0 + 120, H); ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = rgba(P.glow, 0.1); fit(ctx, t.mark, W - 100, 1020, 700); text(ctx, t.mark, 700, 1080 + dy * 0.7, "center");
    // A silhouette stands in smaller than a real photo, so it reads as a placeholder, not a giant.
    const ph = d.images.player ? 1120 + dy * 0.85 : 760 + dy * 0.4;
    player(ctx, d.images.player, { cx: 720, bottom: H, h: ph, w: d.images.player ? 760 : 520 }, { c1: d.player.c1, c2: d.player.c2 }, d.player.no);
    g = ctx.createLinearGradient(0, 0, W, 0); g.addColorStop(0, rgba(BG, 0.92)); g.addColorStop(0.42, rgba(BG, 0.55)); g.addColorStop(0.62, rgba(BG, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    g = ctx.createLinearGradient(0, H - 420, 0, H); g.addColorStop(0, rgba(BG, 0)); g.addColorStop(0.6, rgba(BG, 0.9)); g.addColorStop(1, BG);
    ctx.fillStyle = g; ctx.fillRect(0, H - 420, W, 420);
    g = ctx.createLinearGradient(0, 0, 0, 220); g.addColorStop(0, rgba(BG, 0.7)); g.addColorStop(1, rgba(BG, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 220);
    // Header: tournament, match; sponsors on the right.
    tournamentMark(ctx, d, 60, 62, 84);
    ctx.fillStyle = "#FFFFFF"; fit(ctx, d.tournament.name.toUpperCase(), 440, 26, 700); text(ctx, d.tournament.name.toUpperCase(), 162, 98);
    ctx.fillStyle = "rgba(255,255,255,0.6)"; font(ctx, 18, 600, BODY); spaced(ctx, (d.matchLabel || "").toUpperCase(), 163, 128, 2);
    sponsorRow(ctx, d, W - 60, 76, "right", "rgba(255,255,255,0.55)");
    // The figures.
    const y = dy;
    ctx.fillStyle = acc; font(ctx, 30, 700, BODY); spaced(ctx, t.word, 64, 560 + y, 14); ctx.fillRect(64, 578 + y, 90, 6);
    ctx.fillStyle = "#FFFFFF"; fit(ctx, t.big, 560, 330, 700); text(ctx, t.big, 50, 880 + y);
    if (t.star) { const bw = ctx.measureText(t.big).width, size = parseInt(ctx.font.match(/(\d+)px/)[1], 10); ctx.fillStyle = acc; font(ctx, size * 0.55, 700); text(ctx, "*", 54 + bw, 880 + y - size * 0.27); }
    ctx.fillStyle = "rgba(255,255,255,0.75)"; font(ctx, 30, 600, BODY); spaced(ctx, t.sub, 66, 935 + y, 5);
    if (t.first) { ctx.fillStyle = "rgba(255,255,255,0.8)"; fit(ctx, t.first.toUpperCase(), 600, 46, 500); text(ctx, t.first.toUpperCase(), 62, 1090 + y); }
    ctx.fillStyle = "#FFFFFF"; fit(ctx, t.last.toUpperCase(), 620, 120, 700); text(ctx, t.last.toUpperCase(), 58, 1200 + y);
    t.stats.forEach(([v, l], i) => {
      const X = 64 + i * 200;
      ctx.fillStyle = acc; font(ctx, 44, 700); text(ctx, String(v), X, 1262 + y);
      ctx.fillStyle = "rgba(255,255,255,0.55)"; font(ctx, 15, 700, BODY); spaced(ctx, l.toUpperCase(), X, 1286 + y, 2);
    });
    ctx.fillStyle = "rgba(255,255,255,0.55)"; font(ctx, 20, 600, BODY); spaced(ctx, `${d.player.teamShort || ""} V ${d.opponentShort || ""}`, W - 60, 1262 + y, 4, "right");
    ctx.fillStyle = "rgba(255,255,255,0.35)"; font(ctx, 16, 700, BODY); spaced(ctx, d.appName || "CRICPULSE", W - 60, 1290 + y, 4, "right");
    grain(ctx, W, H, 0.06);
  }

  // Split: a jersey-colour panel with the type stacked on it, the photo beside it on an angled cut.
  function drawSplit(ctx, W, H, th, d) {
    const P = jerseyPalette(d), t = milestoneText(d), dy = H - 1350, acc = P.mvp || P.accent;
    const BG = mix(P.deep, "#000000", 0.4);
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
    let g = ctx.createLinearGradient(W, 0, 400, H); g.addColorStop(0, P.mid); g.addColorStop(1, BG); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = 2;
    for (let i = 0; i < 16; i++) { ctx.beginPath(); ctx.arc(860, 560 + dy * 0.4, 120 + i * 44, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
    player(ctx, d.images.player, { cx: 760, bottom: H - 150, h: d.images.player ? 1080 + dy * 0.8 : 720 + dy * 0.4, w: d.images.player ? 700 : 480 }, { c1: d.player.c1, c2: d.player.c2 }, d.player.no);
    const edge = (yy) => 470 - (90 * yy) / H;
    ctx.save(); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(470, 0); ctx.lineTo(380, H); ctx.lineTo(0, H); ctx.closePath();
    g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, P.base); g.addColorStop(1, P.deep); ctx.fillStyle = g; ctx.fill(); ctx.clip();
    ctx.fillStyle = "rgba(0,0,0,0.12)"; font(ctx, 560, 700); ctx.save(); ctx.translate(330, H - 50); ctx.rotate(-Math.PI / 2); fit(ctx, t.word, H - 100, 560, 700); ctx.fillText(t.word, 0, 0); ctx.restore();
    ctx.restore();
    ctx.fillStyle = acc; ctx.beginPath(); ctx.moveTo(470, 0); ctx.lineTo(486, 0); ctx.lineTo(396, H); ctx.lineTo(380, H); ctx.fill();
    tournamentMark(ctx, d, 60, 60, 80);
    ctx.fillStyle = "#FFFFFF"; font(ctx, 20, 700, BODY); fit(ctx, d.tournament.name.toUpperCase(), edge(186) - 90, 20, 700, BODY, 12); spaced(ctx, d.tournament.name.toUpperCase(), 60, 186, 2);
    ctx.fillStyle = "rgba(255,255,255,0.75)"; font(ctx, 18, 600, BODY); spaced(ctx, (d.matchLabel || "").toUpperCase(), 60, 214, 2);
    const y = dy * 0.5, colW = edge(800 + y) - 90;
    ctx.fillStyle = "#FFFFFF"; fit(ctx, t.word, colW, 92, 700); text(ctx, t.word, 56, 420 + y);
    ctx.fillStyle = acc; fit(ctx, t.k2, colW, 92, 700); text(ctx, t.k2, 56, 510 + y);
    ctx.fillStyle = "#FFFFFF"; const big = t.big + (t.star ? "*" : ""); fit(ctx, big, colW + 20, 250, 700); text(ctx, big, 46, 790 + y);
    ctx.fillStyle = "rgba(255,255,255,0.85)"; font(ctx, 28, 600, BODY); spaced(ctx, t.subShort, 60, 840 + y, 5);
    t.stats.forEach(([v, l], i) => {
      const Y = 950 + y + i * 74;
      ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fillRect(60, Y - 46, 300, 2);
      ctx.fillStyle = "#FFFFFF"; font(ctx, 44, 700); text(ctx, String(v), 60, Y + 10);
      ctx.fillStyle = "rgba(255,255,255,0.8)"; font(ctx, 22, 600, BODY); text(ctx, l, 190, Y + 4);
    });
    sponsorRow(ctx, d, 60, H - 110, "left", "rgba(255,255,255,0.6)");
    g = ctx.createLinearGradient(0, H - 230, 0, H); g.addColorStop(0, rgba(BG, 0)); g.addColorStop(0.35, rgba(BG, 0.95)); ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(edge(H - 230) + 16, H - 230); ctx.lineTo(W, H - 230); ctx.lineTo(W, H); ctx.lineTo(396, H); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#FFFFFF"; fit(ctx, d.player.name.toUpperCase(), 600, 66, 700); text(ctx, d.player.name.toUpperCase(), W - 50, H - 92, "right");
    ctx.fillStyle = "rgba(255,255,255,0.65)"; fit(ctx, `${d.player.team} v ${d.opponent}`, 580, 24, 500, BODY, 14); text(ctx, `${d.player.team} v ${d.opponent}`, W - 52, H - 54, "right");
    ctx.fillStyle = "rgba(255,255,255,0.4)"; font(ctx, 16, 700, BODY); spaced(ctx, d.appName || "CRICPULSE", W - 50, H - 22, 4, "right");
    grain(ctx, W, H, 0.05);
  }

  // Halo: the player in the middle of a ring in the jersey colour, light rays behind, a ribbon,
  // the name and one row of figures (batting, bowling or fielding, then MVP points).
  // The title on a player-of-the-match style card; an all-round performance card brings its own.
  const POTM_HEADING = { text: "PLAYER OF THE MATCH", lines: ["PLAYER", "OF THE", "MATCH"], ghost: "POTM" };
  const headingOf = (d) => d.heading || POTM_HEADING;

  function drawHalo(ctx, W, H, th, d) {
    const P = jerseyPalette(d), dy = H - 1350, acc = P.mvp || P.accent, BG = mix(P.deep, "#000000", 0.3), p = d.potm;
    const cy = 560 + dy * 0.45, r = 330 + dy * 0.12, foot = 980 + dy * 0.75;
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
    let g = ctx.createRadialGradient(W / 2, cy, 60, W / 2, cy, 760 + dy * 0.2);
    g.addColorStop(0, rgba(P.base, 0.95)); g.addColorStop(0.6, rgba(P.deep, 0.6)); g.addColorStop(1, rgba(BG, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(W / 2, cy);
    for (let i = 0; i < 36; i++) { ctx.rotate(Math.PI / 18); ctx.fillStyle = i % 2 ? "rgba(255,255,255,0.025)" : rgba(P.glow, 0.05); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-60, -1400); ctx.lineTo(60, -1400); ctx.fill(); }
    ctx.restore();
    ctx.strokeStyle = rgba(acc, 0.25); ctx.lineWidth = 34; ctx.beginPath(); ctx.arc(W / 2, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = acc; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(W / 2, cy, r, 0, Math.PI * 2); ctx.stroke();
    // A cut-out stands in the ring with its head over the top; a plain photo is framed inside it.
    const img = d.images.player, team = { c1: d.player.c1, c2: d.player.c2 };
    if (img && !cutout(img)) {
      ctx.save(); ctx.beginPath(); ctx.arc(W / 2, cy, r - 4, 0, Math.PI * 2); ctx.clip();
      const k = Math.max((2 * r) / img.width, (2 * r) / img.height);
      ctx.drawImage(img, W / 2 - (img.width * k) / 2, cy - r - (img.height * k - 2 * r) * 0.2, img.width * k, img.height * k);
      ctx.restore();
    } else player(ctx, img, { cx: W / 2, bottom: foot, h: img ? 760 + dy * 0.6 : 560 + dy * 0.4, w: img ? 560 : 420 }, team, d.player.no);
    g = ctx.createLinearGradient(0, foot - 160, 0, foot + 10); g.addColorStop(0, rgba(BG, 0)); g.addColorStop(1, BG);
    ctx.fillStyle = g; ctx.fillRect(0, foot - 160, W, H - foot + 160);
    // Header: tournament and match on the left, sponsors on the right.
    tournamentMark(ctx, d, 60, 60, 80);
    ctx.fillStyle = "#FFFFFF"; fit(ctx, d.tournament.name.toUpperCase(), 420, 24, 700); text(ctx, d.tournament.name.toUpperCase(), 160, 96);
    ctx.fillStyle = "rgba(255,255,255,0.6)"; font(ctx, 17, 600, BODY); spaced(ctx, (d.matchLabel || "").toUpperCase(), 161, 124, 2);
    sponsorRow(ctx, d, W - 60, 76, "right", "rgba(255,255,255,0.55)");
    // Ribbon, name, result.
    const y = H - 400;
    ctx.fillStyle = acc; ctx.beginPath(); ctx.moveTo(W / 2 - 250, y); ctx.lineTo(W / 2 + 250, y); ctx.lineTo(W / 2 + 228, y + 54); ctx.lineTo(W / 2 - 228, y + 54); ctx.fill();
    ctx.fillStyle = contrast("#0B0D12", acc) >= 4.5 ? "#0B0D12" : "#FFFFFF"; font(ctx, 26, 700, BODY); fit(ctx, headingOf(d).text, 440, 26, 700, BODY, 16); spaced(ctx, headingOf(d).text, W / 2, y + 37, 7, "center");
    ctx.fillStyle = "#FFFFFF"; fit(ctx, d.player.name.toUpperCase(), W - 120, 96, 700); text(ctx, d.player.name.toUpperCase(), W / 2, y + 154, "center");
    ctx.fillStyle = "rgba(255,255,255,0.7)"; fit(ctx, p.result || p.line || "", W - 140, 24, 500, BODY, 14); text(ctx, p.result || p.line || "", W / 2, y + 194, "center");
    // Figures: the main tiles (runs, wickets, catches), a rate if there is only one, then MVP points.
    const rate = new Set(["Strike rate", "Economy", "MVP points"]), tiles = p.tiles || [];
    const main = tiles.filter((t) => !rate.has(t.k)).slice(0, p.pts != null ? 2 : 3);
    if (main.length < 2) main.push(...tiles.filter((t) => t.k === "Strike rate" || t.k === "Economy").slice(0, 2 - main.length));
    const cols = main.map((t) => [t.v + (t.s ? " " + t.s : ""), t.k.toUpperCase()]).concat(p.pts != null ? [[String(p.pts), "MVP POINTS"]] : []);
    const cw = 300, x0 = W / 2 - (cols.length * cw) / 2;
    cols.forEach(([v, lab], i) => {
      const cx = x0 + cw * (i + 0.5);
      if (i) { ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fillRect(x0 + cw * i, y + 246, 2, 96); }
      ctx.fillStyle = i === cols.length - 1 && p.pts != null ? acc : "#FFFFFF"; fit(ctx, v, cw - 40, 64, 700); text(ctx, v, cx, y + 306, "center");
      ctx.fillStyle = "rgba(255,255,255,0.6)"; font(ctx, 16, 700, BODY); spaced(ctx, lab, cx, y + 336, 3, "center");
    });
    ctx.fillStyle = "rgba(255,255,255,0.3)"; font(ctx, 14, 700, BODY); spaced(ctx, d.appName || "CRICPULSE", W - 40, H - 16, 4, "right");
    grain(ctx, W, H, 0.05);
  }

  // A player-of-the-match's figures as lines: runs, wickets or catches, each with the rate that goes with it.
  function potmLines(p) {
    const tiles = p.tiles || [], rateOf = (k) => (tiles.find((t) => t.k === k) || {}).v;
    return tiles.filter((t) => !["Strike rate", "Economy", "MVP points"].includes(t.k)).slice(0, 2).map((t) => ({
      big: t.v, small: t.s || "", label: t.k.toUpperCase(),
      sub: t.k === "Runs" && rateOf("Strike rate") ? `Strike rate ${rateOf("Strike rate")}` : /^Wicket/.test(t.k) && rateOf("Economy") ? `Economy ${rateOf("Economy")}` : "",
    }));
  }

  // Spotlight for the player of the match: the milestone stage, the name, then the figures stacked.
  function drawPotmSpotlight(ctx, W, H, th, d) {
    const P = jerseyPalette(d), p = d.potm, dy = H - 1350, acc = P.mvp || P.accent, BG = mix(P.deep, "#000000", 0.35);
    const words = d.player.name.trim().split(/\s+/), first = words.length > 1 ? words.slice(0, -1).join(" ") : "", last = words[words.length - 1];
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
    let g = ctx.createRadialGradient(720, 520 + dy * 0.4, 40, 720, 520 + dy * 0.4, 900 + dy * 0.3);
    g.addColorStop(0, rgba(mix(P.base, "#FFFFFF", 0.08), 0.95)); g.addColorStop(0.55, rgba(P.deep, 0.7)); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (const [x0, w, a] of [[520, 160, 0.07], [760, 90, 0.05], [380, 60, 0.04]]) {
      const l = ctx.createLinearGradient(0, 0, 0, H); l.addColorStop(0, `rgba(255,255,255,${a})`); l.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = l; ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0 + w, 0); ctx.lineTo(x0 + w + 260, H); ctx.lineTo(x0 + 120, H); ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = rgba(P.glow, 0.09); font(ctx, 760, 700); text(ctx, headingOf(d).ghost === "POTM" ? "MVP" : headingOf(d).ghost, 720, 1000 + dy * 0.7, "center");
    player(ctx, d.images.player, { cx: 770, bottom: H, h: d.images.player ? 1120 + dy * 0.85 : 760 + dy * 0.4, w: d.images.player ? 640 : 520 }, { c1: d.player.c1, c2: d.player.c2 }, d.player.no);
    g = ctx.createLinearGradient(0, 0, W, 0); g.addColorStop(0, rgba(BG, 0.94)); g.addColorStop(0.45, rgba(BG, 0.6)); g.addColorStop(0.65, rgba(BG, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    g = ctx.createLinearGradient(0, H - 420, 0, H); g.addColorStop(0, rgba(BG, 0)); g.addColorStop(0.6, rgba(BG, 0.9)); g.addColorStop(1, BG);
    ctx.fillStyle = g; ctx.fillRect(0, H - 420, W, 420);
    tournamentMark(ctx, d, 60, 62, 84);
    ctx.fillStyle = "#FFFFFF"; fit(ctx, d.tournament.name.toUpperCase(), 440, 26, 700); text(ctx, d.tournament.name.toUpperCase(), 162, 98);
    ctx.fillStyle = "rgba(255,255,255,0.6)"; font(ctx, 18, 600, BODY); spaced(ctx, (d.matchLabel || "").toUpperCase(), 163, 128, 2);
    sponsorRow(ctx, d, W - 60, 76, "right", "rgba(255,255,255,0.55)");
    const y = dy * 0.5;
    ctx.fillStyle = acc; font(ctx, 26, 700, BODY); spaced(ctx, headingOf(d).text, 64, 310 + y, 8);
    if (first) { ctx.fillStyle = "rgba(255,255,255,0.85)"; fit(ctx, first.toUpperCase(), 560, 46, 500); text(ctx, first.toUpperCase(), 62, 410 + y); }
    ctx.fillStyle = "#FFFFFF"; fit(ctx, last.toUpperCase(), 600, 140, 700); text(ctx, last.toUpperCase(), 56, 540 + y);
    let ly = 700 + y;
    for (const l of potmLines(p)) {
      ctx.fillStyle = "#FFFFFF"; font(ctx, 150, 700); text(ctx, l.big, 56, ly);
      if (l.small) { const bw = ctx.measureText(l.big).width; ctx.fillStyle = "rgba(255,255,255,0.6)"; font(ctx, 54, 500); text(ctx, l.small, 70 + bw, ly); }
      ctx.fillStyle = acc; font(ctx, 20, 700, BODY); spaced(ctx, l.label, 62, ly + 38, 4);
      if (l.sub) { ctx.fillStyle = "rgba(255,255,255,0.6)"; font(ctx, 22, 500, BODY); text(ctx, l.sub, 62, ly + 70); }
      ly += 220;
    }
    ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(60, H - 154, 520, 2);
    ctx.fillStyle = "rgba(255,255,255,0.8)"; fit(ctx, p.result || "", 600, 24, 500, BODY, 14); text(ctx, p.result || "", 62, H - 110);
    if (p.pts != null) {
      ctx.fillStyle = acc; font(ctx, 44, 700); text(ctx, String(p.pts), 62, H - 54); const pw = ctx.measureText(String(p.pts)).width;
      ctx.fillStyle = "rgba(255,255,255,0.55)"; font(ctx, 16, 700, BODY); spaced(ctx, "MVP POINTS", 76 + pw, H - 58, 3);
    }
    ctx.fillStyle = "rgba(255,255,255,0.35)"; font(ctx, 16, 700, BODY); spaced(ctx, d.appName || "CRICPULSE", W - 60, H - 54, 4, "right");
    grain(ctx, W, H, 0.06);
  }

  // Split for the player of the match: "Player of the match" stacked on the jersey panel, figures in rows.
  function drawPotmSplit(ctx, W, H, th, d) {
    const P = jerseyPalette(d), p = d.potm, dy = H - 1350, acc = P.mvp || P.accent, BG = mix(P.deep, "#000000", 0.4);
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
    let g = ctx.createLinearGradient(W, 0, 400, H); g.addColorStop(0, P.mid); g.addColorStop(1, BG); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = 2;
    for (let i = 0; i < 16; i++) { ctx.beginPath(); ctx.arc(860, 560 + dy * 0.4, 120 + i * 44, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
    player(ctx, d.images.player, { cx: 780, bottom: H - 150, h: d.images.player ? 1080 + dy * 0.8 : 720 + dy * 0.4, w: d.images.player ? 600 : 480 }, { c1: d.player.c1, c2: d.player.c2 }, d.player.no);
    ctx.save(); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(490, 0); ctx.lineTo(400, H); ctx.lineTo(0, H); ctx.closePath();
    g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, P.base); g.addColorStop(1, P.deep); ctx.fillStyle = g; ctx.fill(); ctx.clip();
    ctx.fillStyle = "rgba(0,0,0,0.12)"; ctx.save(); ctx.translate(350, H - 50); ctx.rotate(-Math.PI / 2); fit(ctx, headingOf(d).ghost, H - 100, 520, 700); ctx.fillText(headingOf(d).ghost, 0, 0); ctx.restore();
    ctx.restore();
    ctx.fillStyle = acc; ctx.beginPath(); ctx.moveTo(490, 0); ctx.lineTo(506, 0); ctx.lineTo(416, H); ctx.lineTo(400, H); ctx.fill();
    tournamentMark(ctx, d, 60, 60, 80);
    ctx.fillStyle = "#FFFFFF"; fit(ctx, d.tournament.name.toUpperCase(), 380, 20, 700, BODY, 12); spaced(ctx, d.tournament.name.toUpperCase(), 60, 186, 2);
    ctx.fillStyle = "rgba(255,255,255,0.75)"; font(ctx, 18, 600, BODY); spaced(ctx, (d.matchLabel || "").toUpperCase(), 60, 214, 2);
    const y = dy * 0.5;
    const hl = headingOf(d).lines;
    ctx.fillStyle = "#FFFFFF"; fit(ctx, hl[0], 380, 86, 700); text(ctx, hl[0], 56, 360 + y); fit(ctx, hl[1], 380, 86, 700); text(ctx, hl[1], 56, 446 + y);
    ctx.fillStyle = acc; fit(ctx, hl[2], 380, 86, 700); text(ctx, hl[2], 56, 532 + y);
    let ly = 660 + y;
    const rule = (yy) => { ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fillRect(60, yy, 320, 2); };
    for (const l of potmLines(p)) {
      rule(ly - 96);
      ctx.fillStyle = "#FFFFFF"; fit(ctx, l.big, 300, 96, 700); text(ctx, l.big, 56, ly + 6);
      if (l.small) { const bw = ctx.measureText(l.big).width; ctx.fillStyle = "rgba(255,255,255,0.7)"; font(ctx, 38, 500); text(ctx, l.small, 66 + bw, ly + 6); }
      ctx.fillStyle = "rgba(255,255,255,0.85)"; font(ctx, 20, 700, BODY); spaced(ctx, l.label, 60, ly + 40, 3);
      ly += 170;
    }
    if (p.pts != null) {
      rule(ly - 96);
      ctx.fillStyle = acc; font(ctx, 64, 700); text(ctx, String(p.pts), 56, ly - 10);
      ctx.fillStyle = "rgba(255,255,255,0.85)"; font(ctx, 20, 700, BODY); spaced(ctx, "MVP POINTS", 60, ly + 24, 3);
    }
    sponsorRow(ctx, d, 60, H - 110, "left", "rgba(255,255,255,0.6)");
    g = ctx.createLinearGradient(0, H - 230, 0, H); g.addColorStop(0, rgba(BG, 0)); g.addColorStop(0.35, rgba(BG, 0.95)); ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(445, H - 230); ctx.lineTo(W, H - 230); ctx.lineTo(W, H); ctx.lineTo(416, H); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#FFFFFF"; fit(ctx, d.player.name.toUpperCase(), 580, 66, 700); text(ctx, d.player.name.toUpperCase(), W - 50, H - 92, "right");
    ctx.fillStyle = "rgba(255,255,255,0.65)"; fit(ctx, p.result || "", 560, 22, 500, BODY, 14); text(ctx, p.result || "", W - 52, H - 54, "right");
    ctx.fillStyle = "rgba(255,255,255,0.4)"; font(ctx, 16, 700, BODY); spaced(ctx, d.appName || "CRICPULSE", W - 50, H - 22, 4, "right");
    grain(ctx, W, H, 0.05);
  }

  // ---------- Result cards: Face-off, Scoreline and Hero ----------

  // Who won and by how much, from the result line ("Dhaka Tigers won by 24 runs").
  function resultText(d) {
    const r = d.result, win = r.teams.find((t) => t.won) || null, m = /won by (.+)$/i.exec(r.text || "");
    const P = win ? paletteOf(win.c1 || "#0F7A45", win.c2 || "#111111") : paletteOf(d.tournament.c1 || "#0F4C81", d.tournament.c2 || "#F5C542");
    return { r, win, margin: win && m ? m[1].replace(/\s*\(.*\)$/, "") : "", P, acc: P.mvp || P.accent };
  }
  // Tournament logo, name and match on the left; sponsors on the right.
  function stageHead(ctx, W, d) {
    tournamentMark(ctx, d, 50, 50, 80);
    ctx.fillStyle = "#FFFFFF"; fit(ctx, d.tournament.name.toUpperCase(), 420, 24, 700); text(ctx, d.tournament.name.toUpperCase(), 150, 86);
    ctx.fillStyle = "rgba(255,255,255,0.6)"; font(ctx, 17, 600, BODY); spaced(ctx, (d.matchLabel || "").toUpperCase(), 151, 114, 2);
    sponsorRow(ctx, d, W - 50, 66, "right", "rgba(255,255,255,0.55)");
  }
  // Top scorer and best bowling in a row at y.
  function performers(ctx, d, y, acc) {
    const r = d.result;
    [["TOP SCORER", r.topBat], ["BEST BOWLING", r.topBowl]].filter(([, x]) => x).forEach(([l, x], i) => {
      const X = 56 + i * 500;
      ctx.fillStyle = "rgba(255,255,255,0.6)"; font(ctx, 16, 700, BODY); spaced(ctx, l, X, y, 3);
      ctx.fillStyle = "#FFFFFF"; fit(ctx, x.name.toUpperCase(), 300, 34, 600); text(ctx, x.name.toUpperCase(), X, y + 46);
      const nw = ctx.measureText(x.name.toUpperCase()).width;
      ctx.fillStyle = acc; font(ctx, 34, 700); text(ctx, x.figures, X + nw + 14, y + 46);
    });
  }
  const appMark = (ctx, W, y) => { ctx.fillStyle = "rgba(255,255,255,0.35)"; font(ctx, 15, 700, BODY); spaced(ctx, "CRICPULSE", W - 50, y, 4, "right"); };
  const teamLogo = (ctx, d, i, cx, cy, size) => logo(ctx, d.images.teams[i], d.result.teams[i], cx, cy, size);

  // Face-off: each team owns half the card in its own colours, cut on a diagonal; the losing half is dimmed.
  function drawFaceoff(ctx, W, H, th, d) {
    const { r, win, margin, acc } = resultText(d), [a, b] = r.teams, dy = H - 1350;
    const yl = 760 + dy * 0.45, yr = 560 + dy * 0.45, seam = (x) => yl + ((yr - yl) * x) / W;
    const halves = [[a, [[0, 0], [W, 0], [W, yr], [0, yl]]], [b, [[0, yl], [W, yr], [W, H], [0, H]]]];
    halves.forEach(([t, pts], i) => {
      if (!t) return;
      const P = paletteOf(t.c1 || "#0F7A45", t.c2 || "#111111");
      ctx.save(); ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.clip();
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, P.base); g.addColorStop(1, mix(P.deep, "#000000", 0.4)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      if (win && !t.won) { ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fillRect(0, 0, W, H); }
      ctx.fillStyle = "rgba(255,255,255,0.06)"; fit(ctx, t.short || "", W - 200, 420, 700); text(ctx, t.short || "", i ? 40 : W - 40, i ? H - 260 : yr, i ? "left" : "right");
      ctx.restore();
    });
    ctx.strokeStyle = acc; ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(0, yl); ctx.lineTo(W, yr); ctx.stroke();
    stageHead(ctx, W, d);
    const row = (t, i, lx, y, align) => {
      teamLogo(ctx, d, i, lx, y, 230);
      const x0 = align === "left" ? lx + 150 : lx - 150, dim = win && !t.won;
      ctx.fillStyle = dim ? "rgba(255,255,255,0.75)" : "#FFFFFF"; fit(ctx, t.name.toUpperCase(), 520, 50, 700); text(ctx, t.name.toUpperCase(), x0, y - 40, align);
      fit(ctx, t.score, 560, 140, 700); text(ctx, t.score, x0, y + 100, align);
      ctx.fillStyle = "rgba(255,255,255,0.65)"; font(ctx, 22, 600, BODY); spaced(ctx, t.overs ? `${t.overs} OVERS` : "", x0, y + 140, 3, align);
    };
    if (a) row(a, 0, 190, 360 + dy * 0.15, "left");
    if (b) row(b, 1, W - 190, 950 + dy * 0.7, "right");
    // The result on the seam.
    ctx.save(); ctx.translate(W / 2, seam(W / 2)); ctx.rotate(Math.atan2(yr - yl, W));
    const label = (win && margin ? `${win.short || win.name} won by ${margin}` : r.text).toUpperCase();
    fit(ctx, label, W - 260, 40, 700); const lw = ctx.measureText(label).width + 100;
    ctx.fillStyle = acc; ctx.beginPath(); ctx.moveTo(-lw / 2 + 20, -36); ctx.lineTo(lw / 2 + 20, -36); ctx.lineTo(lw / 2 - 20, 36); ctx.lineTo(-lw / 2 - 20, 36); ctx.fill();
    ctx.fillStyle = contrast("#0B0D12", acc) >= 4.5 ? "#0B0D12" : "#FFFFFF"; text(ctx, label, 0, 14, "center");
    ctx.restore();
    const g = ctx.createLinearGradient(0, H - 200, 0, H); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.7)"); ctx.fillStyle = g; ctx.fillRect(0, H - 200, W, 200);
    performers(ctx, d, H - 100, acc);
    appMark(ctx, W, H - 20);
    grain(ctx, W, H, 0.05);
  }

  // Scoreline: the winners' colours; the margin as the headline; both logos big with the scores under them.
  function drawScoreline(ctx, W, H, th, d) {
    const { r, win, margin, P, acc } = resultText(d), BG = mix(P.deep, "#000000", 0.35), dy = H - 1350;
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
    let g = ctx.createRadialGradient(W / 2, 760 + dy * 0.5, 50, W / 2, 760 + dy * 0.5, 820); g.addColorStop(0, rgba(P.base, 0.85)); g.addColorStop(1, rgba(BG, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = 2; for (let i = -H; i < W; i += 30) { ctx.beginPath(); ctx.moveTo(i, H); ctx.lineTo(i + H * 0.5, 0); ctx.stroke(); } ctx.restore();
    stageHead(ctx, W, d);
    const y0 = dy * 0.3;
    ctx.fillStyle = acc; font(ctx, 26, 700, BODY); spaced(ctx, "RESULT", 56, 250 + y0, 12); ctx.fillRect(56, 268 + y0, 70, 6);
    if (win && margin) {
      ctx.fillStyle = "#FFFFFF"; fit(ctx, win.name.toUpperCase(), W - 110, 96, 700); text(ctx, win.name.toUpperCase(), 52, 380 + y0);
      ctx.fillStyle = acc; fit(ctx, `WON BY ${margin}`.toUpperCase(), W - 110, 120, 700); text(ctx, `WON BY ${margin}`.toUpperCase(), 52, 500 + y0);
    } else { ctx.fillStyle = "#FFFFFF"; fit(ctx, r.text.toUpperCase(), W - 110, 120, 700); text(ctx, r.text.toUpperCase(), 52, 460 + y0); }
    const cy = 740 + dy * 0.6;
    r.teams.forEach((t, i) => {
      const cx = i ? W - 270 : 270, dim = win && !t.won;
      ctx.save(); ctx.globalAlpha = dim ? 0.55 : 1;
      ctx.fillStyle = t.won ? rgba(acc, 0.18) : "rgba(255,255,255,0.06)"; ctx.beginPath(); ctx.arc(cx, cy, 170, 0, Math.PI * 2); ctx.fill();
      teamLogo(ctx, d, i, cx, cy, 250); ctx.restore();
      ctx.fillStyle = dim ? "rgba(255,255,255,0.7)" : "#FFFFFF"; fit(ctx, t.score, 420, 110, 700); text(ctx, t.score, cx, cy + 270, "center");
      ctx.fillStyle = "rgba(255,255,255,0.6)"; font(ctx, 20, 600, BODY); spaced(ctx, `${t.short || ""}${t.overs ? ` · ${t.overs} OV` : ""}`, cx, cy + 308, 3, "center");
      if (t.won) { ctx.fillStyle = acc; ctx.beginPath(); roundRect(ctx, cx - 50, cy + 328, 100, 34, 17); ctx.fill(); ctx.fillStyle = contrast("#0B0D12", acc) >= 4.5 ? "#0B0D12" : "#FFFFFF"; font(ctx, 18, 700, BODY); spaced(ctx, "WON", cx, cy + 352, 4, "center"); }
    });
    ctx.fillStyle = "rgba(255,255,255,0.35)"; font(ctx, 40, 500); text(ctx, "V", W / 2, cy + 20, "center");
    ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(50, H - 200, W - 100, 2);
    performers(ctx, d, H - 154, acc);
    appMark(ctx, W, H - 40);
    grain(ctx, W, H, 0.05);
  }

  // Hero: the player of the match on the winners' stage; the margin on the left; the scoreboard below.
  function drawResultHero(ctx, W, H, th, d) {
    const { r, win, margin, P, acc } = resultText(d), BG = mix(P.deep, "#000000", 0.35), dy = H - 1350, foot = 880 + dy * 0.75;
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
    let g = ctx.createRadialGradient(760, 560 + dy * 0.4, 40, 760, 560 + dy * 0.4, 900); g.addColorStop(0, rgba(mix(P.base, "#FFFFFF", 0.08), 0.95)); g.addColorStop(0.55, rgba(P.deep, 0.7)); g.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const wi = r.teams.indexOf(win);
    if (wi >= 0) { ctx.save(); ctx.globalAlpha = 0.1; teamLogo(ctx, d, wi, 760, 520 + dy * 0.4, 700); ctx.restore(); }
    const pl = d.player || {};
    if (d.player || d.images.player) player(ctx, d.images.player, { cx: 830, bottom: foot, h: d.images.player ? 780 + dy * 0.6 : 560, w: d.images.player ? 540 : 420 }, { c1: pl.c1, c2: pl.c2 }, pl.no);
    g = ctx.createLinearGradient(0, 0, W, 0); g.addColorStop(0, rgba(BG, 0.95)); g.addColorStop(0.45, rgba(BG, 0.6)); g.addColorStop(0.65, rgba(BG, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    g = ctx.createLinearGradient(0, foot - 240, 0, foot - 40); g.addColorStop(0, rgba(BG, 0)); g.addColorStop(1, BG); ctx.fillStyle = g; ctx.fillRect(0, foot - 240, W, 200);
    ctx.fillStyle = BG; ctx.fillRect(0, foot - 40, W, H - foot + 40);
    stageHead(ctx, W, d);
    const y0 = dy * 0.3;
    ctx.fillStyle = acc; font(ctx, 26, 700, BODY); spaced(ctx, "FULL TIME", 56, 250 + y0, 12);
    if (win && margin) {
      ctx.fillStyle = "#FFFFFF"; fit(ctx, win.name.toUpperCase(), 600, 80, 700); text(ctx, win.name.toUpperCase(), 52, 350 + y0);
      font(ctx, 80, 500); text(ctx, "WON BY", 52, 440 + y0);
      ctx.fillStyle = acc; fit(ctx, margin.toUpperCase(), 540, 150, 700); text(ctx, margin.toUpperCase(), 48, 590 + y0);
    } else { ctx.fillStyle = "#FFFFFF"; for (const [k, l] of wrap(ctx, r.text.toUpperCase(), 560, 3).entries()) { fit(ctx, l, 560, 110, 700); text(ctx, l, 52, 380 + y0 + k * 120); } }
    r.teams.forEach((t, i) => {
      const y = foot + 20 + i * 150;
      ctx.fillStyle = t.won ? mix(BG, acc, 0.16) : mix(BG, "#FFFFFF", 0.06); ctx.beginPath(); roundRect(ctx, 40, y - 70, W - 80, 128, 20); ctx.fill();
      if (t.won) { ctx.fillStyle = acc; ctx.fillRect(40, y - 70, 8, 128); }
      teamLogo(ctx, d, i, 120, y - 6, 96);
      ctx.fillStyle = "#FFFFFF"; fit(ctx, t.name.toUpperCase(), 440, 40, 700); text(ctx, t.name.toUpperCase(), 196, y + 4);
      ctx.fillStyle = "rgba(255,255,255,0.6)"; font(ctx, 19, 600, BODY); spaced(ctx, t.overs ? `${t.overs} OVERS` : "", 198, y + 36, 2);
      ctx.fillStyle = t.won ? acc : "#FFFFFF"; fit(ctx, t.score, 300, 76, 700); text(ctx, t.score, W - 90, y + 22, "right");
    });
    if (r.captain) {
      ctx.fillStyle = acc; font(ctx, 16, 700, BODY); spaced(ctx, "CAPTAIN", W - 60, foot - 112, 4, "right");
      ctx.fillStyle = "#FFFFFF"; fit(ctx, r.captain.toUpperCase(), 420, 34, 600); text(ctx, r.captain.toUpperCase(), W - 60, foot - 72, "right");
    }
    const pm = r.potm;
    if (pm) {
      const y = H - 144;
      ctx.fillStyle = "rgba(255,255,255,0.55)"; font(ctx, 16, 700, BODY); spaced(ctx, "PLAYER OF THE MATCH", 56, y, 3);
      ctx.fillStyle = "#FFFFFF"; fit(ctx, pm.name.toUpperCase(), 520, 36, 600); text(ctx, pm.name.toUpperCase(), 56, y + 46);
      const nw = ctx.measureText(pm.name.toUpperCase()).width;
      ctx.fillStyle = acc; font(ctx, 36, 700); text(ctx, pm.figures || "", 56 + nw + 16, y + 46);
    } else performers(ctx, d, H - 144, acc);
    appMark(ctx, W, H - 40);
    grain(ctx, W, H, 0.05);
  }

  const DRAW = {
    schedule: drawSchedule, groups: drawGroups, lineup: drawLineup, versus: drawVersus, result: drawResult, table: drawTable,
    squad: drawSquad, leaders: drawLeaders, target: drawTarget, champions: drawChampions,
  };

  // Draws a card and resolves with the canvas. `d.urls` lists the images to load first.
  async function render(kind, d, size, style) {
    const [W, H] = SIZES[size] || SIZES.post;
    if (!stylesFor(kind).some(([k]) => k === style)) style = stylesFor(kind)[0][0];
    if (root.document && document.fonts) {
      await Promise.all(["700 100px Oswald", "600 100px Oswald", "500 100px Oswald", '500 30px "DM Sans"', '600 30px "DM Sans"', '700 30px "DM Sans"'].map((f) => document.fonts.load(f))).catch(() => {});
    }
    const u = d.urls || {};
    // Sponsors: d.sponsors [{name, url}], or the older single d.sponsor with urls.sponsor.
    if (!d.sponsors) d.sponsors = d.sponsor && (u.sponsor || d.sponsor.name) ? [{ name: d.sponsor.name || "", url: u.sponsor || "" }] : [];
    const [tournament, playerImg, sponsors, teams] = await Promise.all([loadImg(u.tournament), loadImg(u.player), Promise.all(d.sponsors.map((s) => loadImg(s.url))), Promise.all((u.teams || []).map(loadImg))]);
    d.images = { tournament, player: playerImg, sponsors, teams };
    const cv = canvas(W, H), ctx = cv.getContext("2d");
    const th = d.colors ? theme(d.colors[0], d.colors[1]) : theme(d.tournament.c1, d.tournament.c2);
    if (kind === "milestone" || PERF.has(kind)) { (style === "P" ? drawSplit : drawSpotlight)(ctx, W, H, th, d); return cv; }
    if (kind === "result") { ({ F: drawFaceoff, L: drawScoreline, R: drawResultHero })[style](ctx, W, H, th, d); return cv; }
    if (kind === "potm" || kind === "allround") { ({ H: drawHalo, S: drawPotmSpotlight, P: drawPotmSplit })[style](ctx, W, H, th, d); return cv; }
    const K = KITS[style](th, W, H, d).use(ctx);
    if (HERO.has(kind)) (style === "B" ? drawHeroB : drawHeroA)(ctx, W, H, th, Object.assign(d, { kind }), K);
    else DRAW[kind](ctx, W, H, th, d, K);
    return cv;
  }


  // ---------- Captions ----------

  const tag = (s) => "#" + String(s || "").replace(/[^A-Za-z0-9]/g, "");
  function caption(kind, d) {
    const tags = [tag(d.tournament.short || d.tournament.name), "#cricket"];
    if (kind === "milestone") {
      const m = d.milestone, M = MILESTONE[m.kind];
      tags.splice(1, 0, tag(`${d.player.teamShort}v${d.opponentShort}`));
      const what = m.batting
        ? `${M.word}! ${d.player.name} brings up ${m.kind === "hundred" ? "a hundred" : "fifty"} for ${d.player.team} against ${d.opponent}: ${m.runs}${m.notOut ? "*" : ""} off ${m.balls} balls with ${m.fours} fours and ${m.sixes} sixes.`
        : `${M.word}! ${d.player.name} takes ${m.wickets} for ${m.runs} for ${d.player.team} against ${d.opponent}.`;
      return `${what}\n\n${tags.join(" ")}`;
    }
    if (PERF.has(kind) || kind === "allround") {
      const opp = d.opponent ? ` against ${d.opponent}` : "";
      tags.splice(1, 0, tag(`${d.player.teamShort}v${d.opponentShort}`));
      const what = kind === "batperf" ? `${d.player.name} made ${d.milestone.runs}${d.milestone.notOut ? "*" : ""} off ${d.milestone.balls} balls for ${d.player.team}${opp}, with ${d.milestone.fours} fours and ${d.milestone.sixes} sixes.`
        : kind === "bowlperf" ? `${d.player.name} took ${d.milestone.wickets} for ${d.milestone.runs} in ${d.milestone.overs} overs for ${d.player.team}${opp}.`
        : `All-round show from ${d.player.name} for ${d.player.team}${opp}: ${d.potm.figures}.`;
      return `${what}\n\n${tags.join(" ")}`;
    }
    if (kind === "result") {
      const r = d.result, [a, b] = r.teams;
      tags.splice(1, 0, tag(`${a.short}v${b.short}`));
      const perf = [r.topBat && `Top scorer: ${r.topBat.name} ${r.topBat.figures}`, r.topBowl && `Best bowling: ${r.topBowl.name} ${r.topBowl.figures}`].filter(Boolean).join("\n");
      return `${r.text}\n\n${a.name} ${a.score}${a.overs ? ` (${a.overs} ov)` : ""}\n${b.name} ${b.score}${b.overs ? ` (${b.overs} ov)` : ""}${perf ? `\n\n${perf}` : ""}\n\n${tags.join(" ")}`;
    }
    if (kind === "versus") {
      const v = d.versus, [a, b] = v.teams;
      tags.splice(1, 0, tag(`${a.short}v${b.short}`));
      return `Match day! ${a.name} take on ${b.name}${v.stage ? ` (${v.stage})` : ""}.\n${v.when}${v.venue ? ` at ${v.venue}` : ""}.\n\n${tags.join(" ")}`;
    }
    if (kind === "table") {
      const rows = d.table.rows.map((r, i) => `${i + 1}. ${r.name} ${r.pts} pts (NRR ${r.nrr})`).join("\n");
      return `${d.tournament.name} points table${d.table.group ? `, Group ${d.table.group}` : ""}:\n${rows}\n\n${tags.join(" ")}`;
    }
    if (kind === "schedule") {
      const rows = d.schedule.rows.map((r) => `${r.date ? r.date + ": " : ""}${r.teams[0].name} v ${r.teams[1].name}${r.result ? ` (${r.result})` : r.time ? `, ${r.time}` : ""}${!r.result && r.venue ? ` at ${r.venue}` : ""}`).join("\n");
      return `${d.tournament.name} ${(d.schedule.title || "Fixtures").toLowerCase()}:\n${rows}\n\n${tags.join(" ")}`;
    }
    if (kind === "lineup") {
      const [a, b] = d.lineup.teams;
      tags.splice(1, 0, tag(`${a.short}v${b.short}`));
      const xi = (t) => `${t.name}: ${t.players.map((p) => p.name + (p.cap ? " (c)" : "") + (p.wk ? " (wk)" : "")).join(", ")}`;
      return `Playing XIs${d.lineup.toss ? `\n${d.lineup.toss}` : ""}\n\n${xi(a)}\n\n${xi(b)}\n\n${tags.join(" ")}`;
    }
    if (kind === "squad") {
      const sq = d.squad;
      tags.splice(1, 0, tag(sq.team.short || sq.team.name));
      return `${sq.team.name} squad for ${d.tournament.name}:\n${sq.players.map((p) => p.name + (p.cap ? " (c)" : "") + (p.wk ? " (wk)" : "")).join(", ")}\n\n${tags.join(" ")}`;
    }
    if (kind === "potm") {
      const p = d.potm;
      return `Player of the match: ${d.player.name}${d.player.team ? ` (${d.player.team})` : ""}!${p.figures ? ` ${p.figures}.` : ""}${p.result ? `\n${p.result}` : ""}\n\n${tags.join(" ")}`;
    }
    if (kind === "leaders") {
      const ld = d.leaders;
      return `${d.tournament.name}, ${ld.title.toLowerCase()}:\n${ld.rows.map((r, i) => `${i + 1}. ${r.name} (${r.team.short}) ${r.value} ${ld.unit.toLowerCase()}`).join("\n")}\n\n${tags.join(" ")}`;
    }
    if (kind === "champions") {
      const c = d.champions;
      tags.splice(1, 0, tag(c.team.short || c.team.name), c.silver ? "#runnersup" : "#champions");
      const what = c.silver ? `${c.team.name} finish as runners-up in ${d.tournament.name}. Well played!` : `${c.team.name} are the ${d.tournament.name} champions!`;
      return `${what}${c.result ? ` ${c.result}.` : ""}\n\n${tags.join(" ")}`;
    }
    if (kind === "groups") {
      const gs = d.groups.groups.map((g) => `${g.name}: ${g.teams.map((t) => t.name).join(", ")}`).join("\n");
      return `${d.tournament.name} groups:\n${gs}\n\n${tags.join(" ")}`;
    }
    if (kind === "award") {
      const a = d.award;
      const stats = (a.stats || []).map(([v, s, lab]) => `${v}${s ? " " + s : ""} ${lab.toLowerCase()}`).join(", ");
      return `${a.title}, ${d.tournament.name}: ${d.player.name}${d.player.team ? ` (${d.player.team})` : ""}!${stats ? `\n${stats}` : ""}\n\n${tags.join(" ")}`;
    }
    if (kind === "target") {
      const t = d.target;
      tags.splice(1, 0, tag(`${t.batting.short}v${t.chasing.short}`));
      return `Innings break. ${t.batting.name} ${t.runs}/${t.wickets} (${t.overs}).\n${t.chasing.name} need ${t.target} runs from ${t.balls} balls.\n\n${tags.join(" ")}`;
    }
    return tags.join(" ");
  }

  const api = { SIZES, STYLES, stylesFor, theme, render, caption, MILESTONE };
  root.CSA = Object.assign(root.CSA || {}, { cards: api });
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
