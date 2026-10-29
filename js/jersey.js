// Jersey colours from a player photo, and a card palette built from them.
// Ported from the studio projects (efcob-studio, sports-timeline-studio colors.js), so cards here
// colour themselves the same way: the background comes from the jersey's own colour, deepened,
// with a bright accent; a plain black/white kit borrows its trim colour, or a set theme.
// pickJerseyColors(img) takes a loaded image or canvas. No other DOM, so Node tests can load it.
(function (root) {
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgbToHex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }
  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    if (s === 0) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  }
  const hsl = (h, s, l) => rgbToHex(...hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1)));
  function luminance(hex) {
    const c = hexToRgb(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function mix(a, b, t) {
    const x = hexToRgb(a), y = hexToRgb(b);
    return rgbToHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
  }


  function pickJerseyColors(img) {
    const W = 140, H = Math.round(img.height * W / img.width);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);
    const px = ctx.getImageData(0, 0, W, H).data;

    // bounding box of the visible subject
    let top = H, bottom = 0, left = W, right = 0, hasAlpha = false;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const a = px[(y * W + x) * 4 + 3];
      if (a < 250) hasAlpha = true;
      if (a > 200) { top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x); }
    }
    const bh = bottom - top, bw = right - left;
    // torso = lower part of the subject, middle of the width
    const y0 = top + Math.round(bh * (hasAlpha ? 0.5 : 0.55)), x0 = left + Math.round(bw * 0.15), x1 = right - Math.round(bw * 0.15);

    const buckets = {};
    let total = 0;
    for (let y = y0; y <= bottom; y++) for (let x = x0; x <= x1; x++) {
      const i = (y * W + x) * 4;
      if (px[i + 3] < 200) continue;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const [h, s, l] = rgbToHsl(r, g, b);
      // skip skin tones (arms / hands in front of the shirt)
      if (h > 4 && h < 36 && s > 0.12 && s < 0.72 && l > 0.18 && l < 0.85) continue;
      let key, w = 1;
      if (l < 0.14) key = 'dark';
      else if (l > 0.86 || (s < 0.14 && l > 0.6)) key = 'light';
      else if (s < 0.18) key = 'grey';
      else { key = 'h' + Math.floor(((h + 7.5) % 360) / 15); w = 0.6 + s; }
      const bk = buckets[key] || (buckets[key] = { n: 0, w: 0, r: 0, g: 0, b: 0 });
      bk.n++; bk.w += w; bk.r += r; bk.g += g; bk.b += b; total++;
    }
    // merge neighbouring hue buckets so one jersey colour is not split in two
    const keys = Object.keys(buckets).filter(k => k[0] === 'h').sort((a, b) => buckets[b].w - buckets[a].w);
    for (const k of keys) {
      if (!buckets[k]) continue;
      const n = +k.slice(1);
      for (const nb of ['h' + ((n + 1) % 24), 'h' + ((n + 23) % 24)]) {
        const o = buckets[nb];
        if (o && buckets[k].w >= o.w) { for (const f of ['n', 'w', 'r', 'g', 'b']) buckets[k][f] += o[f]; delete buckets[nb]; }
      }
    }
    const avg = bk => rgbToHex(bk.r / bk.n, bk.g / bk.n, bk.b / bk.n);
    const ranked = Object.entries(buckets).filter(([, b]) => b.n > total * 0.02).sort((a, b) => b[1].w - a[1].w);
    if (!ranked.length) return { primary: '#1f6f4a', secondary: '#0b0f14' };

    // a coloured bucket wins as primary when it covers a decent share of the shirt
    const chroma = ranked.filter(([k]) => k[0] === 'h');
    // ...but on a mostly black/white shirt a small print or trim stays the accent, not the main colour
    const neutralTop = ranked.find(([k]) => k[0] !== 'h');
    const chromaWins = chroma.length && chroma[0][1].n > total * 0.12 && (!neutralTop || chroma[0][1].n >= neutralTop[1].n * 0.45);
    const primaryEntry = chromaWins ? chroma[0] : ranked[0];
    // black/white/grey shirt: use its trim or print colour (if any) as the second colour, so the accent picks it up
    const trim = !chromaWins && chroma.find(e => e[1].n > total * 0.025);
    const secondaryEntry = trim || ranked.find(e => e !== primaryEntry) || ['dark', null];
    let primary = avg(primaryEntry[1]);
    let secondary = secondaryEntry[1] ? avg(secondaryEntry[1]) : '#0b0f14';
    // vivid-ify the primary a bit so the background pops
    if (primaryEntry[0][0] === 'h') {
      const [h, s, l] = rgbToHsl(...hexToRgb(primary));
      primary = hsl(h, Math.max(s, 0.7), clamp(l, 0.38, 0.58));
    }
    return { primary, secondary };
  }

  /* Builds the colour tokens for one side of the poster from the two jersey colours. */
  function paletteFor(primary, secondary) {
    const [h, s, l] = rgbToHsl(...hexToRgb(primary));
    const neutral = s < 0.25 || l < 0.12 || l > 0.92; // black / white / grey kit
    const base = neutral ? (l < 0.5 ? '#2a2f3a' : '#9aa3b2') : primary;
    const [bh, bs] = rgbToHsl(...hexToRgb(base));
    const deep = neutral ? '#07090d' : hsl(bh, Math.min(bs, 0.85), 0.11);
    const glow = neutral ? '#ffffff' : hsl(bh, 1, 0.72);
    const [sh2, ss2, sl2] = rgbToHsl(...hexToRgb(secondary));
    // stripe colour: secondary if it differs enough from the base, else a darker base
    const stripe = Math.abs(luminance(secondary) - luminance(base)) > 0.08 || Math.abs(sh2 - bh) > 30 ? secondary : hsl(bh, bs, 0.2);
    const accent = neutral ? (ss2 > 0.2 ? hsl(sh2, Math.max(ss2, 0.7), clamp(sl2, 0.45, 0.6)) : '#ffffff') : hsl(bh, Math.max(bs, 0.75), clamp(l, 0.45, 0.6));
    const onAccent = luminance(accent) > 0.4 ? '#0b0d12' : '#ffffff';
    return { base, deep, glow, stripe, accent, onAccent, mid: mix(base, deep, 0.55) };
  }

  /* Crops away empty transparent space around a cut-out so every photo starts at the top of the head. */
  function popColors(accent) {
    const [h, s] = rgbToHsl(...hexToRgb(accent));
    const [, , l] = rgbToHsl(...hexToRgb(accent));
    if (s < 0.25) return { pop: '#22d3ee', pop2: '#ff2e88', ana: l > 0.5 ? '#9aa3b2' : '#2a2f3a' };
    // ana: a neighbouring, slightly deeper shade of the kit colour (yellow -> amber/orange) for gradients
    return { pop: hsl(h + 180, 0.95, 0.62), pop2: hsl(h + 300, 0.95, 0.6), ana: hsl(h - 26, Math.min(1, s + 0.05), Math.max(0.38, l - 0.08)) };
  }
  // palette for the colourful (vivid) theme: richer bases for black/white kits, and a gradient partner (ana)
  // colour themes for plain black/white kits (no coloured trim to borrow from)
  const NEUTRAL_THEMES = {
    indigo:  { base: '#2d33a8', deep: '#0a0b26', accent: '#22d3ee', ana: '#7c3aed', pop: '#ff2e88', pop2: '#a3e635', mvp: '#22d3ee', mvpShadow: '#7c3aed' },
    gold:    { base: '#4a3a12', deep: '#0b0906', accent: '#f5c542', ana: '#c07a1c', pop: '#fff1c1', pop2: '#f59e0b', mvp: '#f5c542', mvpShadow: '#7a5410' },
    crimson: { base: '#6b0f1f', deep: '#100306', accent: '#ff3b4e', ana: '#a3122e', pop: '#ffd166', pop2: '#ff8a3d', mvp: '#ff4d5e', mvpShadow: '#5c0a17' },
    neon:    { base: '#0d4a33', deep: '#03110b', accent: '#39ff88', ana: '#0fb374', pop: '#00e0ff', pop2: '#c6ff00', mvp: '#39ff88', mvpShadow: '#0b5236' },
    bd:      { base: '#006a4e', deep: '#02160f', accent: '#19e28a', ana: '#00936b', pop: '#f42a41', pop2: '#ffd166', mvp: '#19e28a', mvpShadow: '#b3112a' },
    orange:  { base: '#3b4252', deep: '#0b0d12', accent: '#ff6a1a', ana: '#e8430a', pop: '#ffb347', pop2: '#38bdf8', mvp: '#ff7a2e', mvpShadow: '#7a2a05' },
  };
  function vividPalette(primary, secondary, theme) {
    const p = paletteFor(primary, secondary);
    const [h, s, l] = rgbToHsl(...hexToRgb(primary));
    const [sh, ss, sl] = rgbToHsl(...hexToRgb(secondary));
    const neutral = s < 0.25 || l < 0.12 || l > 0.92;
    const trim = ss > 0.25 && sl > 0.12 && sl < 0.9;
    if (neutral) {
      if (trim) { // white/black kit with a coloured trim: build the background from the trim colour
        p.base = hsl(sh, Math.max(ss, 0.6), 0.32); p.deep = hsl(sh, 0.6, 0.09);
        p.accent = hsl(sh, Math.max(ss, 0.7), clamp(sl, 0.45, 0.58));
      } else { // plain black/white kit: use the chosen theme
        const t = NEUTRAL_THEMES[theme] || NEUTRAL_THEMES.indigo;
        Object.assign(p, { base: t.base, deep: t.deep, accent: t.accent });
      }
      const [bh] = rgbToHsl(...hexToRgb(p.base));
      p.glow = hsl(bh, 1, 0.66); p.mid = mix(p.base, p.deep, 0.55); p.stripe = p.accent;
      p.onAccent = luminance(p.accent) > 0.4 ? '#0b0d12' : '#ffffff';
    }
    const [ah, as] = rgbToHsl(...hexToRgb(p.accent));
    const pc = popColors(p.accent);
    // gradient partner: yellow/orange/gold kits fade into purple; other kits into a deeper neighbouring shade
    const warm = as > 0.25 && ah >= 25 && ah <= 80;
    p.ana = warm ? '#7b3fe4' : pc.ana;
    p.pop = pc.pop; p.pop2 = pc.pop2;
    // colours for the big MVP lettering (white fading into mvp, offset shadow in mvpShadow)
    const cool = as > 0.25 && ah > 80 && ah < 330;
    if (cool) { p.mvp = hsl(ah + (ah < 240 ? -35 : 45), 0.9, 0.64); p.mvpShadow = hsl(ah, 0.8, 0.34); }
    else { p.mvp = pc.pop; p.mvpShadow = p.ana; } // warm kits: yellow -> blue/purple, red -> cyan
    if (neutral && !trim) {
      const t = NEUTRAL_THEMES[theme] || NEUTRAL_THEMES.indigo;
      Object.assign(p, { ana: t.ana, pop: t.pop, pop2: t.pop2, mvp: t.mvp, mvpShadow: t.mvpShadow });
      p.onAccent = luminance(p.accent) > 0.4 ? '#0b0d12' : '#ffffff';
    }
    return p;
  }
  // true for a black/white/grey kit with no coloured trim
  function isPlainNeutral(primary, secondary) {
    const [, s, l] = rgbToHsl(...hexToRgb(primary));
    const [, ss, sl] = rgbToHsl(...hexToRgb(secondary));
    return (s < 0.25 || l < 0.12 || l > 0.92) && !(ss > 0.25 && sl > 0.12 && sl < 0.9);
  }
  root.CSA = Object.assign(root.CSA || {}, { jersey: { pickJerseyColors, paletteFor, vividPalette, popColors, isPlainNeutral, luminance } });
  if (typeof module === "object" && module.exports) module.exports = root.CSA.jersey;
})(typeof window !== "undefined" ? window : globalThis);
