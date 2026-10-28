// Social cards drawn on a canvas: milestones (fifty, hundred, three-for, five-for), match result,
// match-day versus and points table. Each comes as a feed post (1080 × 1350) or a story
// (1080 × 1920), in the tournament's colours with its logo and a sponsor slot.
// No DOM besides the canvas, so the drawing can be reused anywhere.
(function (root) {
  const SIZES = { post: [1080, 1350], story: [1080, 1920] };
  const DISPLAY = '"Oswald", "Arial Narrow", sans-serif';
  const BODY = '"DM Sans", system-ui, sans-serif';

  // ---------- Colour helpers ----------

  const hexRgb = (h) => { const n = parseInt((h || "#0F7A45").slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const rgbHex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  const mix = (a, b, t) => { const x = hexRgb(a), y = hexRgb(b); return rgbHex(x.map((v, i) => v + (y[i] - v) * t)); };
  const lum = (h) => { const [r, g, b] = hexRgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

  // A theme from the tournament's two colours: a deep background, and a bright accent that reads on it.
  function theme(c1, c2) {
    c1 = c1 || "#0F7A45"; c2 = c2 || "#0E1A14";
    // Dark enough for white text (contrast at least 4.5).
    let base = c1;
    while (lum(base) > 0.18) base = mix(base, "#000000", 0.2);
    const deep = mix(base, "#000000", 0.45);
    const candidates = [c2, c1, mix(c1, "#FFFFFF", 0.55), mix(c2, "#FFFFFF", 0.55), "#F5C542"];
    const accent = candidates.find((c) => (lum(c) + 0.05) / (lum(base) + 0.05) >= 4.5) || "#FFFFFF";
    return { base, deep, accent, band: c2 && lum(c2) < 0.6 ? c2 : mix(c1, "#000000", 0.25) };
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

  function font(ctx, size, weight, family) { ctx.font = `${weight || 700} ${size}px ${family || DISPLAY}`; }

  // Largest font size (down to min) at which the text fits the width.
  function fit(ctx, text, maxW, size, weight, family, min) {
    let s = size;
    for (; s > (min || 20); s -= 2) { font(ctx, s, weight, family); if (ctx.measureText(text).width <= maxW) break; }
    return s;
  }

  function spaced(ctx, text, x, y, spacing, align) {
    // Letter spacing for small caps labels.
    if ("letterSpacing" in ctx) { ctx.letterSpacing = `${spacing}px`; ctx.textAlign = align || "left"; ctx.fillText(text, x, y); ctx.letterSpacing = "0px"; return; }
    ctx.textAlign = align || "left"; ctx.fillText(text.split("").join(" "), x, y);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // A logo in a white disc, or initials on the team colours when there is no logo.
  function logo(ctx, img, initials, cx, cy, r, c1, c2) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath();
    if (img) {
      ctx.fillStyle = "#FFFFFF"; ctx.fill(); ctx.clip();
      const k = Math.min((r * 1.5) / img.width, (r * 1.5) / img.height);
      ctx.drawImage(img, cx - (img.width * k) / 2, cy - (img.height * k) / 2, img.width * k, img.height * k);
    } else {
      const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      g.addColorStop(0, c1 || "#0F7A45"); g.addColorStop(1, c2 || "#0E1A14");
      ctx.fillStyle = g; ctx.fill();
      ctx.fillStyle = "#FFFFFF"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      fit(ctx, initials || "?", r * 1.5, r * 0.8, 700, DISPLAY, 10);
      ctx.fillText(initials || "?", cx, cy + r * 0.04);
      ctx.textBaseline = "alphabetic";
    }
    ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.lineWidth = Math.max(3, r * 0.06); ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.stroke(); ctx.restore();
  }

  // Background: deep colour, a mown-pitch stripe texture and a diagonal band in the second colour.
  function background(ctx, W, H, th, band = true) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, th.base); g.addColorStop(1, th.deep);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 120) { ctx.fillStyle = "rgba(255,255,255,0.025)"; ctx.fillRect(x, 0, 60, H); }
    if (!band) return;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = th.band;
    ctx.beginPath(); ctx.moveTo(0, H * 0.78); ctx.lineTo(W, H * 0.6); ctx.lineTo(W, H * 0.66); ctx.lineTo(0, H * 0.84); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = th.accent;
    ctx.beginPath(); ctx.moveTo(0, H * 0.845); ctx.lineTo(W, H * 0.665); ctx.lineTo(W, H * 0.672); ctx.lineTo(0, H * 0.852); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // Tournament logo and name on top; sponsor slot and app mark at the bottom.
  function frame(ctx, W, H, th, d, sub) {
    const t = d.tournament;
    logo(ctx, d.images.tournament, t.initials, 104, 104, 50, t.c1, t.c2);
    ctx.fillStyle = "#FFFFFF"; ctx.textAlign = "left";
    fit(ctx, t.name.toUpperCase(), W - 260, 40, 600, DISPLAY, 24);
    ctx.fillText(t.name.toUpperCase(), 176, 100);
    if (sub) { ctx.fillStyle = "rgba(255,255,255,0.72)"; font(ctx, 26, 600, BODY); spaced(ctx, sub.toUpperCase(), 176, 138, 3); }

    const fy = H - 96;
    ctx.fillStyle = "rgba(0,0,0,0.28)"; ctx.fillRect(0, fy - 34, W, 130);
    if (d.sponsor && d.sponsor.show !== false) {
      ctx.fillStyle = "rgba(255,255,255,0.6)"; font(ctx, 20, 600, BODY); spaced(ctx, "PRESENTED BY", 60, fy + 4, 3);
      if (d.images.sponsor) {
        const img = d.images.sponsor, k = Math.min(200 / img.width, 54 / img.height);
        ctx.drawImage(img, 60, fy + 16, img.width * k, img.height * k);
        if (d.sponsor.name) { ctx.fillStyle = "#FFFFFF"; font(ctx, 30, 700, DISPLAY); ctx.textAlign = "left"; ctx.fillText(d.sponsor.name.toUpperCase(), 60 + img.width * k + 16, fy + 52); }
      } else {
        // Sample sponsor mark until the organiser adds a real one.
        ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 3; roundRect(ctx, 60, fy + 16, 46, 46, 10); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.beginPath(); ctx.arc(83, fy + 39, 9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#FFFFFF"; font(ctx, 30, 700, DISPLAY); ctx.textAlign = "left";
        ctx.fillText((d.sponsor.name || "YOUR BRAND").toUpperCase(), 120, fy + 52);
      }
    }
    ctx.fillStyle = "rgba(255,255,255,0.55)"; font(ctx, 22, 600, BODY); spaced(ctx, d.appName || "CRICKET SCORER", W - 60, fy + 52, 3, "right");
    ctx.textAlign = "left";
  }

  // Player photo filling the right side and fading into the background; initials if there is none.
  function portrait(ctx, W, H, th, img, initials, top, bottom, photoBottom) {
    if (img) {
      // Draw the photo on its own layer and fade its edges to transparent, so it
      // blends into any background without a visible box.
      const x0 = Math.round(W * 0.28), w = W - x0, h = Math.round((photoBottom || bottom) - top);
      const layer = document.createElement("canvas"); layer.width = w; layer.height = h;
      const lc = layer.getContext("2d");
      const k = Math.max(w / img.width, h / img.height), dw = img.width * k, dh = img.height * k;
      lc.drawImage(img, (w - dw) / 2, (h - dh) * 0.2, dw, dh);
      lc.globalCompositeOperation = "destination-in";
      const gx = lc.createLinearGradient(0, 0, w * 0.6, 0);
      gx.addColorStop(0, "rgba(0,0,0,0)"); gx.addColorStop(1, "rgba(0,0,0,1)");
      lc.fillStyle = gx; lc.fillRect(0, 0, w, h);
      const gy = lc.createLinearGradient(0, 0, 0, h);
      gy.addColorStop(0, "rgba(0,0,0,0)"); gy.addColorStop(0.12, "rgba(0,0,0,1)"); gy.addColorStop(0.62, "rgba(0,0,0,1)"); gy.addColorStop(1, "rgba(0,0,0,0)");
      lc.fillStyle = gy; lc.fillRect(0, 0, w, h);
      ctx.drawImage(layer, x0, top);
    } else {
      const h = bottom - top;
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath(); ctx.arc(W * 0.72, top + h * 0.42, h * 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      font(ctx, h * 0.26, 700); ctx.fillText(initials, W * 0.72, top + h * 0.43);
      ctx.restore();
    }
  }

  // ---------- Cards ----------

  const MILESTONE = {
    fifty: { word: "FIFTY", mark: "50" }, hundred: { word: "HUNDRED", mark: "100" },
    threefor: { word: "THREE-FOR", mark: "3W" }, fivefor: { word: "FIVE-FOR", mark: "5W" },
  };

  function drawMilestone(ctx, W, H, th, d) {
    const m = d.milestone, M = MILESTONE[m.kind], story = H > 1500;
    background(ctx, W, H, th, false);
    // Layout is anchored to the footer so figures never collide with it.
    const chipY = H - 196, bigY = chipY - 84, teamsY = bigY - (story ? 250 : 220);
    const nameY = teamsY - 54, wordY = nameY - (story ? 100 : 88);
    // Huge faded number behind the portrait.
    ctx.save(); ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.textAlign = "right"; font(ctx, story ? 820 : 640, 700);
    ctx.fillText(M.mark, W + 30, wordY - 40); ctx.restore();
    portrait(ctx, W, H, th, d.images.player, d.player.initials, 170, wordY - (story ? 150 : 130), bigY + 20);
    // Darken the lower half so the figures read on any photo or colour.
    const shade = ctx.createLinearGradient(0, wordY - 220, 0, H);
    shade.addColorStop(0, "rgba(0,0,0,0)"); shade.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = shade; ctx.fillRect(0, wordY - 220, W, H - wordY + 220);
    frame(ctx, W, H, th, d, d.matchLabel);

    ctx.textAlign = "left";
    ctx.fillStyle = th.accent; font(ctx, story ? 150 : 132, 700); ctx.fillText(M.word, 54, wordY);
    ctx.fillStyle = "#FFFFFF";
    fit(ctx, d.player.name.toUpperCase(), W - 116, story ? 92 : 80, 600); ctx.fillText(d.player.name.toUpperCase(), 58, nameY);
    ctx.fillStyle = "rgba(255,255,255,0.78)"; font(ctx, 32, 500, BODY);
    ctx.fillText(`${d.player.team}  v  ${d.opponent}`, 60, teamsY);

    const big = m.batting ? `${m.runs}${m.notOut ? "*" : ""}` : `${m.wickets}/${m.runs}`;
    const small = m.batting ? `(${m.balls})` : "";
    ctx.fillStyle = "#FFFFFF"; font(ctx, story ? 230 : 200, 700); ctx.fillText(big, 52, bigY);
    if (small) {
      const bw = ctx.measureText(big).width;
      ctx.fillStyle = "rgba(255,255,255,0.7)"; font(ctx, story ? 84 : 72, 600); ctx.fillText(small, 52 + bw + 18, bigY);
    }

    const chips = m.batting
      ? [`${m.fours} FOURS`, `${m.sixes} SIXES`, `SR ${m.sr}`]
      : [`${m.overs} OVERS`, `${m.maidens} MAIDEN${m.maidens === 1 ? "" : "S"}`, `ECON ${m.econ}`];
    let x = 56;
    font(ctx, 28, 700, BODY);
    for (const c of chips) {
      const w = ctx.measureText(c).width + 40;
      ctx.fillStyle = "rgba(255,255,255,0.14)"; roundRect(ctx, x, chipY - 38, w, 54, 27); ctx.fill();
      ctx.fillStyle = "#FFFFFF"; ctx.fillText(c, x + 20, chipY - 1);
      x += w + 12;
    }
  }

  function drawResult(ctx, W, H, th, d) {
    const story = H > 1500, r = d.result;
    background(ctx, W, H, th);
    frame(ctx, W, H, th, d, d.matchLabel);
    let y = story ? 330 : 250;
    ctx.fillStyle = th.accent; font(ctx, 30, 700, BODY); spaced(ctx, "RESULT", 60, y, 6);
    y += 24;
    // Result text over up to two lines.
    ctx.fillStyle = "#FFFFFF"; const words = r.text.toUpperCase().split(" "); const lines = [""];
    font(ctx, story ? 104 : 92, 700);
    for (const w of words) { const t = (lines[lines.length - 1] + " " + w).trim(); if (ctx.measureText(t).width > W - 120 && lines[lines.length - 1]) lines.push(w); else lines[lines.length - 1] = t; }
    for (const l of lines.slice(0, 3)) { y += story ? 110 : 98; ctx.fillText(l, 58, y); }

    y += story ? 110 : 70;
    for (const [i, tm] of r.teams.entries()) {
      const rowH = story ? 200 : 170, cy = y + rowH / 2;
      ctx.fillStyle = tm.won ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.22)"; roundRect(ctx, 40, y, W - 80, rowH - 20, 24); ctx.fill();
      if (tm.won) { ctx.fillStyle = th.accent; roundRect(ctx, 40, y, 12, rowH - 20, 6); ctx.fill(); }
      logo(ctx, d.images.teams[i], tm.short, 130, cy - 10, story ? 62 : 54, tm.c1, tm.c2);
      ctx.fillStyle = "#FFFFFF"; ctx.textAlign = "left";
      fit(ctx, tm.name.toUpperCase(), W * 0.4, 46, 600); ctx.fillText(tm.name.toUpperCase(), 215, cy - 6);
      ctx.fillStyle = "rgba(255,255,255,0.65)"; font(ctx, 26, 500, BODY); ctx.fillText(tm.overs ? `${tm.overs} overs` : "", 216, cy + 30);
      ctx.fillStyle = "#FFFFFF"; ctx.textAlign = "right"; font(ctx, story ? 110 : 96, 700); ctx.fillText(tm.score, W - 80, cy + 30);
      ctx.textAlign = "left";
      y += rowH;
    }
    // Top performers.
    y += story ? 60 : 30;
    const colW = (W - 120) / 2;
    for (const [i, p] of [r.topBat, r.topBowl].entries()) {
      if (!p) continue;
      const x = 60 + i * (colW + 0);
      ctx.fillStyle = th.accent; font(ctx, 24, 700, BODY); spaced(ctx, i ? "BEST BOWLING" : "TOP SCORER", x, y, 4);
      ctx.fillStyle = "#FFFFFF"; fit(ctx, p.name.toUpperCase(), colW - 30, 48, 600); ctx.fillText(p.name.toUpperCase(), x, y + 56);
      ctx.fillStyle = "rgba(255,255,255,0.8)"; font(ctx, 54, 700); ctx.fillText(p.figures, x, y + 120);
    }
  }

  function drawVersus(ctx, W, H, th, d) {
    const story = H > 1500, v = d.versus;
    background(ctx, W, H, th, false);
    frame(ctx, W, H, th, d, v.stage);
    const cy = H * 0.4, r = story ? 170 : 150;
    ctx.fillStyle = th.accent; font(ctx, 30, 700, BODY); spaced(ctx, "MATCH DAY", W / 2, cy - r - 80, 8, "center");
    for (const [i, tm] of v.teams.entries()) {
      const cx = i ? W - 60 - r : 60 + r;
      logo(ctx, d.images.teams[i], tm.short, cx, cy, r, tm.c1, tm.c2);
      ctx.fillStyle = "#FFFFFF"; ctx.textAlign = "center";
      fit(ctx, tm.name.toUpperCase(), r * 2.4, 56, 600); ctx.fillText(tm.name.toUpperCase(), cx, cy + r + 80);
    }
    ctx.fillStyle = "#FFFFFF"; ctx.textAlign = "center"; font(ctx, story ? 150 : 130, 700); ctx.fillText("VS", W / 2, cy + 48);
    let y = cy + r + (story ? 290 : 220);
    const boxH = 150 + (v.venue ? 60 : 0) + (v.rules ? 56 : 0);
    ctx.fillStyle = "rgba(0,0,0,0.25)"; roundRect(ctx, 60, y - 100, W - 120, boxH, 28); ctx.fill();
    ctx.fillStyle = "#FFFFFF"; ctx.textAlign = "center";
    fit(ctx, v.when.toUpperCase(), W - 200, 68, 700); ctx.fillText(v.when.toUpperCase(), W / 2, y);
    if (v.venue) { y += 60; ctx.fillStyle = "rgba(255,255,255,0.78)"; fit(ctx, v.venue, W - 200, 36, 500, BODY); ctx.fillText(v.venue, W / 2, y); }
    if (v.rules) { y += 60; ctx.fillStyle = th.accent; font(ctx, 26, 700, BODY); spaced(ctx, v.rules.toUpperCase(), W / 2, y, 4, "center"); }
    ctx.textAlign = "left";
  }

  function drawTable(ctx, W, H, th, d) {
    const story = H > 1500, tb = d.table;
    background(ctx, W, H, th, false);
    frame(ctx, W, H, th, d, tb.group ? `Group ${tb.group}` : "Standings");
    const rows = tb.rows.slice(0, story ? 10 : 8), head = story ? 100 : 80;
    // Few teams: taller rows, and the whole block sits in the middle of the card.
    const rowH = Math.min(story ? 150 : 120, (H - 260 - 250 - head) / Math.max(rows.length, 1));
    let y = Math.max(story ? 330 : 250, (H - 60 - (head + rows.length * rowH)) / 2 + 40);
    ctx.fillStyle = "#FFFFFF"; font(ctx, story ? 120 : 104, 700); ctx.textAlign = "left"; ctx.fillText("POINTS TABLE", 56, y);
    y += story ? 80 : 60;
    const cols = [["P", 600], ["W", 680], ["L", 760], ["PTS", 860], ["NRR", W - 70]];
    ctx.fillStyle = "rgba(255,255,255,0.6)"; font(ctx, 24, 700, BODY);
    for (const [l, x] of cols) { ctx.textAlign = "right"; ctx.fillText(l, x, y); }
    y += 20;
    for (const [i, r] of rows.entries()) {
      const top = y + i * rowH;
      ctx.fillStyle = i < (tb.qualify || 2) ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.2)"; roundRect(ctx, 40, top + 6, W - 80, rowH - 12, 18); ctx.fill();
      if (i < (tb.qualify || 2)) { ctx.fillStyle = th.accent; roundRect(ctx, 40, top + 6, 10, rowH - 12, 5); ctx.fill(); }
      const cy = top + rowH / 2;
      ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.textAlign = "center"; font(ctx, 36, 700); ctx.fillText(String(i + 1), 92, cy + 13);
      logo(ctx, d.images.teams[i], r.short, 168, cy, rowH * 0.32, r.c1, r.c2);
      ctx.fillStyle = "#FFFFFF"; ctx.textAlign = "left"; fit(ctx, r.name.toUpperCase(), 330, 40, 600); ctx.fillText(r.name.toUpperCase(), 222, cy + 14);
      font(ctx, 38, 600); ctx.textAlign = "right";
      ctx.fillText(String(r.p), 600, cy + 14); ctx.fillText(String(r.w), 680, cy + 14); ctx.fillText(String(r.l), 760, cy + 14);
      ctx.fillStyle = th.accent; font(ctx, 46, 700); ctx.fillText(String(r.pts), 860, cy + 16);
      ctx.fillStyle = "rgba(255,255,255,0.85)"; font(ctx, 32, 600, BODY); ctx.fillText(r.nrr, W - 70, cy + 12);
    }
    ctx.textAlign = "left";
  }

  const DRAW = { milestone: drawMilestone, result: drawResult, versus: drawVersus, table: drawTable };

  // Draws a card and resolves with the canvas. `d.urls` lists the images to load first.
  async function render(kind, d, size) {
    const [W, H] = SIZES[size] || SIZES.post;
    if (root.document && document.fonts) {
      await Promise.all([document.fonts.load(`700 100px "Oswald"`), document.fonts.load(`600 100px "Oswald"`), document.fonts.load(`500 30px "DM Sans"`), document.fonts.load(`700 30px "DM Sans"`)]).catch(() => {});
    }
    const u = d.urls || {};
    const [tournament, sponsor, player, ...teams] = await Promise.all([loadImg(u.tournament), loadImg(u.sponsor), loadImg(u.player), ...(u.teams || []).map(loadImg)]);
    d.images = { tournament, sponsor, player, teams };
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    DRAW[kind](ctx, W, H, theme(d.tournament.c1, d.tournament.c2), d);
    return canvas;
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
    return tags.join(" ");
  }

  const api = { SIZES, theme, render, caption, MILESTONE };
  root.CSA = Object.assign(root.CSA || {}, { cards: api });
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
