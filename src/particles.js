// src/particles.js — particle BURSTS: the one-shot puff of stars, chips or
// leaves that marks a moment the player should feel.
//
// One preset table, one call: `Particles.burst(scene, kind, x, y)` explodes
// the preset's particles at a SCREEN point. The Phaser emitter behind each
// kind is created lazily on first use and reused for every burst after
// (explode() recycles its pool), so a session holds at most one emitter per
// preset, and none until the first burst.
//
// Before this module the "fanfare" burst was eight tweened `✦` Text objects
// (app.js _starburst — a Text object, a tween and a destroy per star, twice
// over per jackpot), and the cobble activation and the crop stage flip had
// no burst at all. The particle emitter is the built-in for exactly this
// shape — Phaser 3.60+ ships it in the vendored build — so the presets here
// replace the hand-rolled text burst rather than sit beside it.
//
// The rules this obeys (CLAUDE.md QC rules):
//   • WHERE. A burst at a WORLD position is projected through the scene's
//     worldMetersToScreen at fire time (app.js _burstAtWorld / _burstAtCell),
//     never placed off the player or viewCenterX/Y — a peek drag moves the
//     camera, and the puff has to come off the cobble it marks. A burst on a
//     TOAST (jackpot / shiny) takes the toast's own screen position.
//   • WHICH LAYER. The emitters live in `scene.fxContainer`, inserted ABOVE
//     the lightmap and BELOW the labels + fog (tools/layer_audit.js pins it).
//     Above the lightmap because these are bright by definition — a gold
//     star multiplied by the night dim reads as a grey smudge — and below
//     the fog because nothing bursts on land the player has not stood on.
//   • COLOUR IS BAKED. The Phaser Canvas fallback ignores setTint(), so every
//     preset bakes its own coloured texture (a star, a chip, a leaf) from the
//     shared UI constants, and the emitter draws that. One texture per
//     preset, generated once.
//   • REDUCED MOTION. `burstCount(kind, reduced)` is 0 under
//     prefers-reduced-motion (scene._reducedMotion): particles flying
//     outward are motion for its own sake, and every burst here decorates a
//     cue that stands on its own (the toast, the lit stone's scale pop, the
//     crop's new stage frame).
//   • OFF-SCREEN IS FREE. `onScreen()` gates the world bursts: the crop timer
//     advances plants the player is nowhere near, and an explode() nobody
//     sees still costs the pool.
//
// Pure parts (PRESETS, burstCount, emitterConfig, onScreen) run headlessly —
// test/node/particles.test.js pins them. Only burst() touches Phaser.

(function (root) {
  'use strict';

  // The UI colour language (util.js). Read at load with literal fallbacks so
  // the module also loads standalone; the test pins the two agree.
  const C = {
    gold:      (typeof UI_GOLD       === 'string') ? UI_GOLD       : '#ffe066',
    goldPale:  (typeof UI_GOLD_PALE  === 'string') ? UI_GOLD_PALE  : '#fff3b0',
    green:     (typeof UI_GREEN      === 'string') ? UI_GREEN      : '#a7ffb0',
    trailLit:  (typeof UI_TRAIL_LIT  === 'string') ? UI_TRAIL_LIT  : '#9a8cff',
    // Water is not in the UI palette on purpose: blue-white there means
    // TREASURE (util.js UI_TREASURE_*), and a watering is not a gift from the
    // world. This is the water tile's own murky teal (render.js terrain colour
    // 3, 0x3f6b7a) lifted toward white so a drop reads against dark soil.
    water:     '#8ed3e6',
    // Being HURT is the one thing in this palette that is the UI's danger red
    // rather than a world colour: a trap's bite has to read as damage the
    // instant it lands, and the ink shade is the one that survives being
    // multiplied by the night dim (UI_DANGER itself goes to mud).
    hurt:      (typeof UI_DANGER_INK === 'string') ? UI_DANGER_INK : '#ff8a7a',
  };

  // Phaser angles: 0 = right, 90 = DOWN (screen y grows downward), 270 = up.
  // Each preset: what it bakes (`tex`), how many it throws (`count`), and the
  // emitter numbers. `angle` is the launch cone in degrees, `speed` px/s,
  // `lifespan` ms, `gravityY` px/s² (positive = falls), `scale` / `alpha`
  // run start → end over the particle's life, `rotate` is its spin range.
  const PRESETS = {
    // ✨ JACKPOT — the rarity boost-chain reward. Gold stars off the banner,
    // thrown every way and settling under a light gravity. Replaces the six
    // tweened ✦ glyphs.
    jackpot: {
      tex: { shape: 'star', color: C.gold, core: '#ffffff', size: 16 },
      count: 14, angle: [0, 360], speed: [70, 160], lifespan: [600, 950],
      gravityY: 60, scale: [1, 0.15], alpha: [1, 0], rotate: [0, 360],
    },
    // ✨ SHINY FIND / ELITE SLAIN — the richer cousin, in the pale gold the
    // headline is set in, a few more of them and thrown a little further.
    shiny: {
      tex: { shape: 'star', color: C.goldPale, core: '#ffffff', size: 16 },
      count: 18, angle: [0, 360], speed: [80, 190], lifespan: [700, 1100],
      gravityY: 60, scale: [1, 0.15], alpha: [1, 0], rotate: [0, 360],
    },
    // A cobble LIGHTING (the trail). Stone chips in the lit-cobble violet kick
    // up off the stone and drop back — short, small, an upward cone so the
    // puff stays on its own cell rather than sprinkling the neighbours.
    stone: {
      tex: { shape: 'chip', color: C.trailLit, edge: '#5a4fb0', size: 8 },
      count: 12, angle: [225, 315], speed: [50, 120], lifespan: [350, 600],
      gravityY: 320, scale: [1, 0.4], alpha: [1, 0.2], rotate: [0, 180],
    },
    // …and the BLAST that goes with it: violet sparks with a white-hot core,
    // thrown in a full ring off the stone with no gravity, fading and
    // shrinking to nothing. The chips alone were a small dull puff on a
    // stone that had only changed colour; the ring is what makes lighting a
    // cobble read as a flash. Reaches about a cell and a half — further than
    // the chips, which stay home, but still on the stone's own patch.
    trailspark: {
      tex: { shape: 'star', color: C.trailLit, core: '#ffffff', size: 12 },
      count: 10, angle: [0, 360], speed: [70, 150], lifespan: [300, 550],
      gravityY: 0, scale: [0.9, 0], alpha: [1, 0], rotate: [0, 360],
    },
    // A crop REACHING ITS NEXT STAGE — by the 15-minute hold, by a tap that
    // beats the tick to it, or by a watering can's jump. Leaf flecks drift UP
    // off the plant (negative gravity) and fade: growth, not impact.
    sprout: {
      tex: { shape: 'leaf', color: C.green, vein: '#e6ffe8', size: 8 },
      count: 8, angle: [240, 300], speed: [25, 60], lifespan: [550, 900],
      gravityY: -50, scale: [0.9, 0.2], alpha: [1, 0], rotate: [-40, 40],
    },
    // A crop being WATERED — the tap on a dry plant, can or cupped hands. Until
    // Sep 2026 watering was the one farm action with no visual at all: the tap
    // flashed the stage readout and the cell looked exactly as it had. Drops
    // are tossed up in a narrow cone and fall straight back onto the plant
    // under a firm gravity — a sprinkle onto the cell, not a spray over the
    // neighbours (reach at the fastest, longest drop is well under a cell).
    water: {
      tex: { shape: 'drop', color: C.water, core: '#ffffff', size: 8 },
      count: 10, angle: [245, 295], speed: [40, 90], lifespan: [350, 600],
      gravityY: 260, scale: [0.9, 0.35], alpha: [1, 0.1], rotate: [0, 0],
    },
    // BEING HURT — a trap's jaws closing. Red chips thrown hard in a full ring
    // and gone fast: the shortest, fastest preset here, because a hit is an
    // impact and anything that lingers reads as a reward. No gravity — the
    // sting comes off the body in every direction at once, it isn't debris
    // falling back to the ground.
    pain: {
      tex: { shape: 'chip', color: C.hurt, edge: '#7a1a12', size: 8 },
      count: 14, angle: [0, 360], speed: [90, 200], lifespan: [250, 450],
      gravityY: 0, scale: [1.1, 0.2], alpha: [1, 0], rotate: [0, 360],
    },
  };

  // How many particles a burst throws. Zero under reduced motion — the burst
  // is decoration on a cue that already stands on its own.
  function burstCount(kind, reducedMotion) {
    const p = PRESETS[kind];
    if (!p) return 0;
    return reducedMotion ? 0 : p.count;
  }

  // The Phaser ParticleEmitterConfig for a preset. `emitting: false` — the
  // emitter never streams; it only explode()s. Pure so the test can read it.
  function emitterConfig(kind) {
    const p = PRESETS[kind];
    if (!p) return null;
    const range = (a) => ({ min: a[0], max: a[1] });
    return {
      emitting: false,
      angle: range(p.angle),
      speed: range(p.speed),
      lifespan: range(p.lifespan),
      gravityY: p.gravityY,
      scale: { start: p.scale[0], end: p.scale[1] },
      alpha: { start: p.alpha[0], end: p.alpha[1] },
      rotate: range(p.rotate),
    };
  }

  // Is a screen point inside the viewport square (plus `marginPx`)? The
  // scene's view is the VIEW_CELLS square at viewLeft/viewTop, not the whole
  // canvas. A scene without a view (headless) says no.
  function onScreen(scene, x, y, marginPx = 0) {
    if (!scene || !isFinite(x) || !isFinite(y)) return false;
    const l = scene.viewLeft, t = scene.viewTop, s = scene.viewSize;
    if (!isFinite(l) || !isFinite(t) || !(s > 0)) return false;
    return x >= l - marginPx && x <= l + s + marginPx
        && y >= t - marginPx && y <= t + s + marginPx;
  }

  const texKey = (kind) => `fx_${kind}`;
  const hex = (s) => parseInt(String(s).replace('#', ''), 16);

  // Bake the preset's coloured texture with a throwaway Graphics. Baked, not
  // tinted: setTint() is a no-op under the Canvas renderer.
  function ensureTexture(scene, kind) {
    const key = texKey(kind);
    if (scene.textures.exists(key)) return key;
    const t = PRESETS[kind].tex;
    const S = t.size, c = S / 2;
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    if (t.shape === 'star') {
      // Soft glow, two crossed slim diamonds (the 4-point glint), white-hot
      // core — the same construction as the shiny marker in app.js.
      g.fillStyle(hex(t.color), 0.35); g.fillCircle(c, c, c * 0.5);
      g.fillStyle(hex(t.color), 1);
      const r = c - 1, w = Math.max(1, S * 0.11);
      g.fillPoints([{ x: c, y: c - r }, { x: c + w, y: c }, { x: c, y: c + r }, { x: c - w, y: c }], true);
      g.fillPoints([{ x: c - r, y: c }, { x: c, y: c - w }, { x: c + r, y: c }, { x: c, y: c + w }], true);
      g.fillStyle(hex(t.core), 1); g.fillCircle(c, c, Math.max(1, S * 0.09));
    } else if (t.shape === 'chip') {
      // A stone chip: a slightly irregular quad, darker rim under the fill.
      const pts = [{ x: 1, y: 3 }, { x: 5, y: 1 }, { x: S - 1, y: 4 }, { x: 4, y: S - 1 }]
        .map((p) => ({ x: p.x * S / 8, y: p.y * S / 8 }));
      g.fillStyle(hex(t.edge), 1); g.fillPoints(pts, true);
      g.fillStyle(hex(t.color), 1);
      g.fillPoints(pts.map((p) => ({ x: c + (p.x - c) * 0.6, y: c + (p.y - c) * 0.6 })), true);
    } else if (t.shape === 'drop') {
      // A water drop: a round bead, taller than wide, with a white glint
      // off-centre so it reads as wet rather than as a blue dot.
      g.fillStyle(hex(t.color), 1); g.fillEllipse(c, c, S * 0.6, S * 0.85);
      g.fillStyle(hex(t.core), 0.9); g.fillCircle(c - S * 0.12, c - S * 0.18, Math.max(1, S * 0.12));
    } else {
      // A leaf: a small ellipse with a lighter vein down its length.
      g.fillStyle(hex(t.color), 1); g.fillEllipse(c, c, S * 0.9, S * 0.5);
      g.fillStyle(hex(t.vein), 0.9); g.fillRect(c * 0.45, c - 0.5, S * 0.55, 1);
    }
    g.generateTexture(key, S, S);
    g.destroy();
    return key;
  }

  // The emitter for a kind, created on first use and parked in the scene's
  // fx layer. Explode() positions are emitter-local; the emitter and its
  // container both sit at (0,0), so screen coordinates pass straight through.
  function ensureEmitter(scene, kind) {
    scene._fxEmitters = scene._fxEmitters || {};
    let em = scene._fxEmitters[kind];
    if (em && em.active !== false) return em;
    const key = ensureTexture(scene, kind);
    em = scene.add.particles(0, 0, key, emitterConfig(kind));
    if (scene.fxContainer) scene.fxContainer.add(em);
    scene._fxEmitters[kind] = em;
    return em;
  }

  // Fire a burst of `kind` at SCREEN point (x, y). Returns the particle count
  // thrown — 0 when the scene can't draw (headless, no fx layer yet), under
  // reduced motion, or for an unknown kind.
  function burst(scene, kind, x, y) {
    if (!scene || !scene.add || !scene.textures || !scene.fxContainer) return 0;
    if (!PRESETS[kind] || !isFinite(x) || !isFinite(y)) return 0;
    const n = burstCount(kind, !!scene._reducedMotion);
    if (!n) return 0;
    try {
      ensureEmitter(scene, kind).explode(n, x, y);
    } catch (e) {
      return 0;
    }
    return n;
  }

  root.Particles = { PRESETS, burstCount, emitterConfig, onScreen, burst, texKey };
})(typeof globalThis !== 'undefined' ? globalThis : this);
