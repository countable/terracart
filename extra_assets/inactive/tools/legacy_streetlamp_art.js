// Retired street-lamp painters, preserved for historical reference.
(function(root) {
  const LAMP_TEX_PX = 128;         // baked square — drawn at ~77px, so it supersamples
  const LAMP_DRAW_CELLS = 2.4;     // …drawn this many cells across, glow and post included
  // WHERE THE GROUND IS in the square, as a fraction of its height (app.js
  // seats the sprite's origin there). It is BELOW the middle because a lamp is
  // mostly post; the pool and shadow need only the room a flattened pool takes
  // (LAMP_HALO_FRAC x LAMP_HALO_SQUASH).
  const LAMP_GROUND_FRAC = 0.62;
  const LAMP_FOOT_FRAC = 0.085;    // the plinth's half-width, as a fraction of the square
  // …so the lamp's FOOTPRINT covers this much ground, in CELLS.
  const LAMP_FOOT_R_CELLS = LAMP_DRAW_CELLS * LAMP_FOOT_FRAC;
  const LAMP_HALO_FRAC = 0.30;     // the pool of glow on the ground, as a fraction of the square
  const LAMP_HALO_A = 0.36;        // …its alpha at the foot
  // THE VIEW. The lamp is drawn as the map is looked at: from LAMP_VIEW_DEG
  // above the ground, an orthographic view. Everything that lies FLAT (the
  // pool, the shadow, the top face and underside of every section of the
  // turn) is a circle squashed by LAMP_VIEW_K = sin(view); everything that
  // STANDS is shortened by cos(view). The profile below was authored as seen
  // from LAMP_AUTHORED_DEG (a lamp seen nearly side-on — a street of masts),
  // so its heights go through LAMP_TILT, one linear map about the ground line.
  // Change the look of the angle HERE, never by retyping the table.
  const LAMP_VIEW_DEG = 45;
  const LAMP_AUTHORED_DEG = 15;
  const LAMP_VIEW_K = Math.sin(LAMP_VIEW_DEG * Math.PI / 180);
  const LAMP_TILT = Math.cos(LAMP_VIEW_DEG * Math.PI / 180) / Math.cos(LAMP_AUTHORED_DEG * Math.PI / 180);
  const LAMP_HALO_SQUASH = LAMP_VIEW_K; // …and how flat it lies: light on a road, not a ball of it
  const LAMP_BLOOM_FRAC = 0.18;    // the bloom around the lit glass
  const LAMP_BLOOM_A = 0.46;
  const LAMP_GLASS_A = 0.96;       // the glass at its hot core
  const LAMP_SHADOW_A = 0.34;      // the ground shadow's alpha
  const LAMP_EDGE_MIX = 0.68;      // how far the outline bronze is mixed toward the ink
  // Every section's rim bulge — a quadratic's control point, so twice the
  // depth it reaches: the rim of a circle seen from LAMP_VIEW_DEG above.
  const LAMP_UNDER = 2 * LAMP_VIEW_K;
  const LAMP_DARK_CELLS = { road: 0.64, path: 0.584 };
  const LAMP_SITE_R_CELLS = Math.max(LAMP_FOOT_R_CELLS,
    LAMP_DARK_CELLS.road / 2, LAMP_DARK_CELLS.path / 2);

  const LAMP_INK = (typeof UI_LAMP_GLOW === 'string') ? UI_LAMP_GLOW : '#9a8cff';
  const LAMP_GOLD = (typeof UI_LAMP_GOLD === 'string') ? UI_LAMP_GOLD : '#d9a441';
  const LAMP_DARK = [28, 24, 20];  // the outline ink every sprite in here is drawn with

  // THE PROFILE — the lamp as a lathe turns it, listed top to bottom (as
  // authored, from LAMP_AUTHORED_DEG; lampTilt stands it at LAMP_VIEW_DEG). Each
  // row is one section: its top and bottom edge and its half-width at each, all
  // as fractions of the baked square, with the ground at LAMP_GROUND_FRAC.
  // `tone` lightens (+) or darkens (−) the gild; `curve` bows its sides out (a
  // torus) or in (the flare of the base); `cap` strokes the visible top ring
  // of a piece wider than the one above it.
  //
  // The rows are drawn BOTTOM UP (paintLamp walks the table backwards): each
  // piece STANDS ON the top face of the one below it and is nearer the eye, so
  // it covers that face's middle and leaves its rim showing. The moulding band
  // and the cross-arm are drawn after the column they wrap. The lit glass is
  // not here (it is not metal); it is painted between the skirt and the eaves.
  //
  // HOW TALL. Every row was pulled toward the ground line by one linear map
  // about LAMP_GROUND_FRAC (×0.85), which preserves every overlap and the
  // rhythm of the mouldings; widths are untouched. A lamp near tree height
  // (1.5 cells; the square is LAMP_DRAW_CELLS across) made a restored street a
  // row of masts. The table rises 0.529 (the lantern was lengthened for the
  // 45° view so the eaves leave the glass showing), and LAMP_TILT stands it
  // about 0.39. Retune the HEIGHT by re-mapping the table the same way, never by moving
  // LAMP_GROUND_FRAC — that line is where the lamp STANDS (app.js seats the
  // sprite on it), not how tall it is.
  const lampTilt = (y) => LAMP_GROUND_FRAC - (LAMP_GROUND_FRAC - y) * LAMP_TILT;
  const LAMP_PROFILE = [
    { y0: 0.119, y1: 0.182, w0: 0.015, w1: 0.058, tone: -0.18, curve: -0.30 }, // the crown
    { y0: 0.180, y1: 0.199, w0: 0.068, w1: 0.060, tone: 0.30, cap: true },     // its eaves
    { y0: 0.304, y1: 0.339, w0: 0.058, w1: 0.030, tone: -0.10, curve: -0.28 }, // the lantern's skirt
    { y0: 0.338, y1: 0.353, w0: 0.036, w1: 0.030, tone: 0.28, curve: 0.35 },   // the collar under it
    { y0: 0.350, y1: 0.528, w0: 0.013, w1: 0.019, tone: 0 },                   // the column
    { y0: 0.426, y1: 0.440, w0: 0.023, w1: 0.023, tone: 0.25, curve: 0.35 },   // a moulding band on it
    { y0: 0.518, y1: 0.562, w0: 0.020, w1: 0.054, tone: -0.05, curve: -0.45 }, // the base's flare
    { y0: 0.560, y1: 0.588, w0: 0.060, w1: 0.068, tone: 0.22, curve: 0.15, cap: true }, // its step
    { y0: 0.586, y1: 0.620, w0: 0.074, w1: 0.085, tone: -0.12, curve: 0.10, cap: true }, // the plinth
  ].map((s) => ({ ...s, y0: lampTilt(s.y0), y1: lampTilt(s.y1) }));
  // The lit glass, in the same units — wider at its foot, like every lantern.
  const LAMP_GLASS = { y0: lampTilt(0.196), y1: lampTilt(0.305), w0: 0.038, w1: 0.056 };
  // The finial over the crown, and the cross-arm under the lantern: the two
  // pieces that are not sections of the turn.
  const LAMP_FINIAL = { cy: lampTilt(0.107), r: 0.016 };
  const LAMP_ARM = { y0: lampTilt(0.363), y1: lampTilt(0.375), w: 0.066, ball: 0.014 };
  const LAMP_BAND_ROW = 5, LAMP_COLUMN_ROW = 4, LAMP_SKIRT_ROW = 2;
  // THE BODY: the ironwork's box in the square (fractions, max exclusive), the
  // finial down to the plinth's near rim, the widest section or the arm with
  // its balls, plus the outline. The bake is mostly glow padding, so this is
  // what the player-over fade tests (RENDER_SPEC _streetlamp.artBounds); the
  // rift and broken posts stand inside it.
  const LAMP_BODY_HALF_W = Math.max(LAMP_FOOT_FRAC, LAMP_ARM.w + LAMP_ARM.ball,
    ...LAMP_PROFILE.map((s) => Math.max(s.w0, s.w1) * (1 + Math.max(0, s.curve || 0) / 2))) + 0.012;
  const LAMP_PLINTH = LAMP_PROFILE[LAMP_PROFILE.length - 1];
  const LAMP_BODY_FRAC = {
    minX: 0.5 - LAMP_BODY_HALF_W, maxX: 0.5 + LAMP_BODY_HALF_W,
    minY: LAMP_FINIAL.cy - LAMP_FINIAL.r - 0.012,
    maxY: LAMP_PLINTH.y1 + LAMP_PLINTH.w1 * LAMP_UNDER + 0.012,
  };
  // WHERE THE LIGHT COMES OUT: the lit glass's midline, and how far that is
  // ABOVE the lamp's point, in CELLS. Derived from the profile above, so a
  // re-mapped table takes the light with it: one number, two readers
  // (paintLamp's bloom and Lighting.collectLamps).
  const LAMP_LANTERN_FRAC = (LAMP_GLASS.y0 + LAMP_GLASS.y1) / 2;
  const LAMP_LANTERN_RISE_CELLS = (LAMP_GROUND_FRAC - LAMP_LANTERN_FRAC) * LAMP_DRAW_CELLS;

  const lampRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lampMix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

  // `glowHex` ('#rrggbb') is the colour the lamp SHEDS (the lamp entry's
  // `glow`, the same value Lighting.collectLamps throws); absent or malformed,
  // LAMP_INK. Themed ironwork follows the same hue as its glass and light.
  const lampGlowHex = (g) => ((typeof g === 'string' && /^#[0-9a-f]{6}$/i.test(g)) ? g : LAMP_INK);
  // L01: full native FD wooden lamp; second source frame is the authored
  // snapped shaft. Ground stays at the historic origin and all radiance stays
  // in Lighting. Half-size source placement gives a 1.2-cell standing post.
  const SELECTED_LAMP_SCALE = .5;
  const SELECTED_LAMP_BODY_FRAC = { minX: .453, maxX: .782, minY: .135, maxY: .62 };
  const SELECTED_LAMP_RISE_CELLS = (31 - 15) / 32 * SELECTED_LAMP_SCALE * LAMP_DRAW_CELLS;
  const SELECTED_LAMP_OFFSET_CELLS = (20 - 8) / 32 * SELECTED_LAMP_SCALE * LAMP_DRAW_CELLS;
  function paintSelectedLamp(cx, size, source, broken, glowHex) {
    if (!source || !cx.drawImage) return false;
    const span = size * SELECTED_LAMP_SCALE;
    cx.save(); cx.imageSmoothingEnabled = false;
    cx.drawImage(source, broken ? 32 : 0, 0, 32, 32,
      size / 2 - span * 8 / 32, size * LAMP_GROUND_FRAC - span * 31 / 32, span, span);
    // L01's seven amber glass pixels are separate from its violet metal
    // cage. Repaint only those pixels; the source wood, frame and alpha stay
    // intact. The caller caches this entire texture by emitted-light colour.
    if (!broken && glowHex) {
      const glow = lampRgb(lampGlowHex(glowHex));
      const tones = [lampMix(glow, [24, 20, 30], .32), glow,
        lampMix(glow, [255, 255, 238], .35), lampMix(glow, [255, 255, 238], .65)];
      const pixels = [[18,16,0],[20,16,1],[22,16,0],[18,17,1],[20,17,2],[22,17,1],[20,18,3]];
      const unit = span / 32, left = size / 2 - unit * 8, top = size * LAMP_GROUND_FRAC - unit * 31;
      for (const [x,y,tone] of pixels) {
        cx.fillStyle = `rgb(${tones[tone].join(',')})`;
        cx.fillRect(left + x * unit, top + y * unit, unit, unit);
      }
    }
    cx.restore(); return true;
  }
  function paintLamp(cx, size, glowHex, broken = false) {
    const S = size || LAMP_TEX_PX;
    const c = S / 2;
    const gy = S * LAMP_GROUND_FRAC;          // the ground: where the lamp stands
    const r = S * LAMP_FOOT_FRAC;             // the plinth's half-width
    const lw = Math.max(1, S * 0.012);
    const resolvedGlow = lampGlowHex(glowHex), glow = lampRgb(resolvedGlow);
    const suppressed = typeof StreetVariants !== 'undefined' && resolvedGlow === StreetVariants.SUPPRESSED_STYLE?.lampGlow;
    if (suppressed) { paintRiftLamp(cx, S, glow, broken); return; }
    const gold = resolvedGlow === LAMP_INK ? lampRgb(LAMP_GOLD) : lampMix(glow, LAMP_DARK, .2);
    const edge = lampMix(gold, LAMP_DARK, LAMP_EDGE_MIX);
    const rgba = (c3, al) => {
      // Weathered broken metal retains the standing lamp's hue and shading.
      if (broken) {
        const grey = c3[0] * .2126 + c3[1] * .7152 + c3[2] * .0722;
        c3 = c3.map(v => Math.round(grey + (v - grey) * .35));
      }
      return `rgba(${c3[0]},${c3[1]},${c3[2]},${al})`;
    };
    // Crisp ochre/gold bands for the metal only; glass, bloom and light stay continuous.
    const metalRamp = resolvedGlow === LAMP_INK
      ? [[76,48,24],[108,67,29],[155,101,38],gold,[230,215,163]]
      : [.75,.55,.3,0].map(t => lampMix(gold,LAMP_DARK,t)).concat([lampMix(gold,[255,255,255],.55)]);
    const shade = (t) => {
      const target = t >= 0 ? lampMix(gold, [255,244,214], Math.min(1,t))
        : lampMix(gold,LAMP_DARK,Math.min(1,-t));
      const distance = a => a.reduce((sum,v,k) => sum + (v-target[k]) ** 2,0);
      return metalRamp.reduce((best,ink) => distance(ink) < distance(best) ? ink : best);
    };
    // A hard stop on either side of each band keeps small faces readable at map scale.
    const metal = (x0, x1, t) => {
      const g = cx.createLinearGradient(x0, 0, x1, 0);
      const bands = [[0,.18,t-.30],[.18,.42,t+.42],[.42,.77,t],[.77,1,t-.45]];
      for (const [from,to,tone] of bands) {
        const ink = rgba(shade(tone),1);
        g.addColorStop(from,ink); g.addColorStop(to,ink);
      }
      return g;
    };
    // One section of the turn: bowed sides, the far rim of its top face
    // arching away from the viewer and the near rim of its underside bulging
    // toward them — both circles seen from LAMP_VIEW_DEG above.
    const sectionPath = (y0, y1, w0, w1, curve) => {
      const k = (curve || 0) * (w0 + w1) / 2;
      const ym = (y0 + y1) / 2, wm = (w0 + w1) / 2 + k;
      cx.beginPath();
      cx.moveTo(c - w0, y0);
      cx.quadraticCurveTo(c - wm, ym, c - w1, y1);
      cx.quadraticCurveTo(c, y1 + w1 * LAMP_UNDER, c + w1, y1);
      cx.quadraticCurveTo(c + wm, ym, c + w0, y0);
      cx.quadraticCurveTo(c, y0 - w0 * LAMP_UNDER, c - w0, y0);
      cx.closePath();
    };
    // The TOP FACE of a piece wider than the one it carries: the whole
    // circle, seen from above — what makes a stack of castings read as looked
    // DOWN on rather than across.
    const topFace = (y0, w0, tone) => {
      cx.beginPath();
      cx.moveTo(c - w0, y0);
      cx.quadraticCurveTo(c, y0 - w0 * LAMP_UNDER, c + w0, y0);
      cx.quadraticCurveTo(c, y0 + w0 * LAMP_UNDER, c - w0, y0);
      cx.closePath();
      cx.fillStyle = metal(c - w0, c + w0, tone);
      cx.fill();
      strokeEdge();
    };
    const strokeEdge = () => { cx.lineWidth = lw; cx.strokeStyle = rgba(edge, 1); cx.stroke(); };
    // THE LIT GLASS: white-hot up-left of its middle (the corner every sprite
    // is lit from), falling to the lamp's glow at the frame, with two mullions
    // so it reads as glazing rather than a hole in the post.
    const glass = () => {
      const y0 = S * LAMP_GLASS.y0, y1 = S * LAMP_GLASS.y1;
      const w0 = S * LAMP_GLASS.w0, w1 = S * LAMP_GLASS.w1;
      const my = (y0 + y1) / 2;
      sectionPath(y0, y1, w0, w1, 0.06);
      const g = cx.createRadialGradient(c - w1 * 0.38, my - (y1 - y0) * 0.22, 0,
                                        c, my, Math.max(w1, (y1 - y0) / 2));
      g.addColorStop(0, `rgba(255,253,247,${LAMP_GLASS_A})`);
      g.addColorStop(0.5, rgba(glow, 0.95));
      g.addColorStop(1, rgba(glow, 0.82));
      cx.fillStyle = g;
      cx.fill();
      strokeEdge();
      cx.lineWidth = lw * 0.8;
      cx.strokeStyle = rgba(edge, 1);
      for (const t of [-0.34, 0.34]) {
        cx.beginPath();
        cx.moveTo(c + w0 * t, y0 + lw * 0.5);
        cx.lineTo(c + w1 * t, y1 - lw * 0.5);
        cx.stroke();
      }
    };

    if (!broken) {
    // 1. THE POOL: a flat ellipse of glow on the ground, falling to nothing;
    //    it says "lit" at noon when the lightmap has nothing to multiply.
    cx.save();
    cx.translate(c, gy);
    cx.scale(1, LAMP_HALO_SQUASH);
    const hr = S * LAMP_HALO_FRAC;
    const pool = cx.createRadialGradient(0, 0, 0, 0, 0, hr);
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pool.addColorStop(t, rgba(glow, (LAMP_HALO_A * (1 - t) * (1 - t)).toFixed(4)));
    }
    cx.fillStyle = pool;
    cx.fillRect(-hr, -hr, hr * 2, hr * 2);
    cx.restore();
    // 2. THE BLOOM around the glass, laid BEFORE the ironwork so the metal stays metal.
    const gcy = S * LAMP_LANTERN_FRAC;
    const br = S * LAMP_BLOOM_FRAC;
    const bloom = cx.createRadialGradient(c, gcy, 0, c, gcy, br);
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      bloom.addColorStop(t, rgba(glow, (LAMP_BLOOM_A * (1 - t) * (1 - t)).toFixed(4)));
    }
    cx.fillStyle = bloom;
    cx.fillRect(c - br, gcy - br, br * 2, br * 2);
    }
    // 3. THE GROUND SHADOW, thrown down-right of the plinth and squashed flat.
    cx.fillStyle = `rgba(${LAMP_DARK[0]},${LAMP_DARK[1]},${LAMP_DARK[2]},${LAMP_SHADOW_A})`;
    cx.beginPath();
    cx.ellipse(c + r * 0.40, gy + r * 0.26, r * 1.25, r * 1.25 * LAMP_VIEW_K, 0, 0, Math.PI * 2);
    cx.fill();
    // 4. THE TURN, BOTTOM UP (see LAMP_PROFILE), with the glass painted between
    //    the skirt and the eaves and the band held back until the column is up.
    const order = [];
    for (let i = LAMP_PROFILE.length - 1; i >= 0; i--) {
      if (i === LAMP_BAND_ROW) continue;
      order.push(i);
      if (i === LAMP_COLUMN_ROW) order.push(LAMP_BAND_ROW);
    }
    for (const i of order) {
      if (broken && i < LAMP_COLUMN_ROW) continue;
      const s = LAMP_PROFILE[i];
      const y0 = s.y0 * S, y1 = s.y1 * S, w0 = s.w0 * S, w1 = s.w1 * S;
      if (broken && i === LAMP_COLUMN_ROW) {
        const cut = lampTilt(.402) * S;
        cx.beginPath();
        cx.moveTo(c - w0, cut - lw);
        cx.lineTo(c - w0 * .2, cut + lw * 1.4);
        cx.lineTo(c + w0 * .4, cut + lw * .4);
        cx.lineTo(c + w0, cut + lw * 2);
        cx.lineTo(c + w1, y1);
        cx.quadraticCurveTo(c, y1 + w1 * LAMP_VIEW_K, c - w1, y1);
        cx.closePath();
      } else sectionPath(y0, y1, w0, w1, s.curve);
      cx.fillStyle = metal(c - Math.max(w0, w1), c + Math.max(w0, w1), s.tone || 0);
      cx.fill();
      strokeEdge();
      // The top face of a piece wider than the one it carries, catching the light.
      if (s.cap) topFace(y0, w0 - lw * 0.5, (s.tone || 0) + 0.35);
      if (i === LAMP_SKIRT_ROW) glass();
      // The CROSS-ARM goes on once the column is up: a bar with a ball at each
      // end, under the lantern.
      if (!broken && i === LAMP_BAND_ROW) {
        const ay0 = S * LAMP_ARM.y0, ay1 = S * LAMP_ARM.y1, aw = S * LAMP_ARM.w;
        const ah = ay1 - ay0, amy = (ay0 + ay1) / 2, ab = S * LAMP_ARM.ball;
        cx.beginPath();
        cx.moveTo(c - aw, ay0); cx.lineTo(c + aw, ay0);
        cx.quadraticCurveTo(c + aw + ah * 0.7, amy, c + aw, ay1);
        cx.lineTo(c - aw, ay1);
        cx.quadraticCurveTo(c - aw - ah * 0.7, amy, c - aw, ay0);
        cx.closePath();
        cx.fillStyle = metal(c - aw, c + aw, 0.10); cx.fill(); strokeEdge();
        for (const sx of [-1, 1]) {
          cx.beginPath(); cx.arc(c + sx * aw, amy, ab, 0, Math.PI * 2);
          cx.fillStyle = metal(c + sx * aw - ab, c + sx * aw + ab, 0.20); cx.fill(); strokeEdge();
        }
      }
    }
    if (broken) return;
    // 5. THE FINIAL: the ball on the crown, the top of the whole lamp.
    const fr = S * LAMP_FINIAL.r, fy = S * LAMP_FINIAL.cy;
    cx.beginPath(); cx.arc(c, fy, fr, 0, Math.PI * 2);
    cx.fillStyle = metal(c - fr, c + fr, 0.15); cx.fill(); strokeEdge();
  }

  // A worn wayside stone with a sheltered votive light. Broad chipped faces
  // and an unlit carved fracture keep the rift ancient, not technological.
  function paintRiftLamp(cx, S, glow, broken) {
    const c = S / 2, ground = S * LAMP_GROUND_FRAC;
    const top = S * (broken ? lampTilt(.42) : lampTilt(.12));
    const w = S * .047, foot = S * LAMP_FOOT_FRAC;
    cx.fillStyle = 'rgba(30,25,30,.25)';
    cx.beginPath(); cx.ellipse(c, ground, foot * 1.2, foot * LAMP_VIEW_K, 0, 0, Math.PI * 2); cx.fill();
    cx.fillStyle = '#667570';
    cx.beginPath();
    cx.moveTo(c - foot, ground - S * .01); cx.lineTo(c - w, ground - S * .055);
    cx.lineTo(c - w * .8, top + S * .025); cx.lineTo(c - w * .3, top);
    cx.lineTo(c + w * .65, top + S * .012); cx.lineTo(c + w, ground - S * .045);
    cx.lineTo(c + foot, ground - S * .01); cx.closePath(); cx.fill();
    cx.fillStyle = '#485550';
    cx.beginPath(); cx.moveTo(c + w * .3, top + S * .018);
    cx.lineTo(c + w * .65, top + S * .012); cx.lineTo(c + w, ground - S * .045);
    cx.lineTo(c + foot, ground - S * .01); cx.lineTo(c + w * .15, ground - S * .02); cx.closePath(); cx.fill();
    cx.strokeStyle = 'rgba(49,43,48,.6)'; cx.lineWidth = Math.max(1, S * .008);
    cx.beginPath(); cx.moveTo(c-w*.5, ground-S*.05);
    cx.lineTo(c+w*.15, ground-S*.10); cx.lineTo(c-w*.25, ground-S*.14); cx.stroke();
    cx.fillStyle = '#7e8b83'; cx.fillRect(c-foot*.75, ground-S*.025, foot*1.2, S*.012);
    if (broken) return;
    const y = S * LAMP_LANTERN_FRAC, r = S * .065;
    cx.fillStyle = '#34443f'; cx.fillRect(c-w*.55, y-S*.035, w*1.1, S*.074);
    const bloom = cx.createRadialGradient(c,y,0,c,y,r);
    bloom.addColorStop(0, `rgba(${glow.join(',')},.22)`);
    bloom.addColorStop(1, `rgba(${glow.join(',')},0)`);
    cx.fillStyle = bloom; cx.fillRect(c-r,y-r,r*2,r*2);
    cx.fillStyle = `rgb(${glow.join(',')})`; cx.fillRect(c-S*.01,y-S*.015,S*.02,S*.03);
    cx.fillStyle = '#7e8b83'; cx.fillRect(c-w*.8,y-S*.043,w*1.6,S*.014);
  }

  // Baked into the existing cobble sheet's dark-lamp frames by the art tool.
  // Uses the same 45-degree profile, plinth and moulding as the restored lamp.
  function paintBrokenLamp(cx, size) { paintLamp(cx, size, undefined, true); }


root.LegacyStreetLampArt={paintSelectedLamp,paintLamp,paintBrokenLamp,lampGlowHex};
})(globalThis);
