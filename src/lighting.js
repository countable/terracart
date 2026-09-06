// Lighting — every light in the world, composited as ONE lightmap.
//
// Depends on:
//   Render.reachDimColor / Render.reachDimAlpha (render.js) — the ambient
//   reachRadiusM (coords.js) — the player's plateau radius
//   PlacedFloor (placed_floor.js) — the campfire list, per depth
//   VIEW_CELLS / CELL_PX / FIRE_REST_R — app.js top-level consts, read at
//   call time (app.js loads last), never at parse time
//   document (a 2D canvas) — ONLY inside draw(); everything above it is pure
//
// Exports as globals (window.Lighting):
//   Lighting.KINDS                — the light table: one row per source kind
//   Lighting.radiusCells(kind)    — a row's radius, resolving the fire's
//   Lighting.sourceKind(scene, o) — which row a world object lights as, or null
//   Lighting.beginFrame(scene)    — empty the frame's light list
//   Lighting.consider(scene, o, dx, dy, halfM) — offer a scanned object
//   Lighting.collectFires(scene, ax, ay, halfM) — add the placed campfires
//   Lighting.profile(scene)       — ambient / lit / edge levels at this depth
//   Lighting.playerCookieAlpha(t, prof) — the player ramp, sampled
//   Lighting.draw(scene)          — paint the lightmap (Phaser)
//
// ── The model ─────────────────────────────────────────────────────────────
// Until Sep 2026 the lighting was five Graphics workarounds for "Phaser has no
// gradient primitive": a per-cell fillRect wash outside the reach bubble, a
// second wash over the lit cells underground, a pink wash over them at low
// energy, and ~100 cached strokeCircle rings for the distance falloff. All
// of it painted DARKNESS, which only ever composes one way: two overlapping
// dims make the ground between them darker. A second light source cannot be
// built out of darkness. (The screen-edge vignette in app.js create() is not
// lighting and stays: it frames the window, it doesn't light the world.)
//
// So the lightmap is LIGHT, added up, then multiplied over the world:
//
//   lightmap = ambient + Σ cookie_i          (ADD, clamped to white)
//   world'   = world × lightmap              (MULTIPLY)
//
// The ambient is the far-field darkness (what the old wash + falloff landed
// on at the viewport corner). Every source draws one baked radial-gradient
// COOKIE into the map with additive blending, so lights overlap by adding and
// a pixel any cookie pushes to white is untouched world. The player's cookie
// is the biggest and carries the reach PLATEAU (full light inside the reach
// radius, then the measured falloff) so the surface with only the player lit
// looks as it did. The others are small, coloured and cheap: a campfire, a
// building the player has restored, Home, and every live POI (which is what
// the old halo ping under a POI became).
//
// The map is composed on a plain 2D canvas ('lighter' for the adding) and
// shown as a MULTIPLY-blended image, so it is the same picture on WebGL, on
// the Canvas fallback and on every GPU — see the note at draw().
//
// The player's PLATEAU is painted per reach cell with cellInReach's own
// maths, so the sharp edge of the lit area IS the staircase the white outline
// traces and the tap gate accepts. Only the falloff outside it is a circle.
// The outline itself stays on reachGfx: it marks what you can touch; the
// light is only light.
//
// ── The numbers are DERIVED, not tuned ────────────────────────────────────
// profile() reproduces the old wash exactly for the white channel from the
// same two sources the ground pass painted with — Render.reachDimAlpha /
// reachDimColor — plus the falloff pair (FALLOFF_A, FALLOFF_P) that lived
// beside the rings. Retune a look by changing those; adding a factor here
// breaks the correspondence test/node/lighting.test.js pins.
(function (window) {
  'use strict';

  // ── The light table ───────────────────────────────────────────────────────
  // One row per source kind. `radiusCells` is the cookie's outer edge (the
  // light is zero there); `colour` is baked into the cookie; `peak` is the
  // intensity at the centre, as a fraction of the colour ADDed onto the
  // ambient; `flicker` is the fraction of peak a fire breathes by.
  //
  // The campfire's radius is FIRE_REST_R — the same ring that warms the player
  // and repels slimes (app.js) — so "stand in the light" and "stand in the
  // warmth" are one rule. It is resolved at call time because app.js defines
  // it after this file loads; lighting.test.js pins the two are equal.
  const KINDS = {
    // Home: the starter trailer, or the house adopted as Home in its place
    // (both are save.starterShopId). Wider and warmer than a plain restored
    // house — it is the one light the player always comes back to.
    trailer:  { radiusCells: 4.0, colour: 0xffd28a, peak: 0.85, flicker: 0 },
    // A building the player has taken back: a restored wreck, an unsealed
    // fort, the turrets of a claimed castle. Keyed on the SAME test the
    // derelict wash uses (scene.isClaimedKey), so a house lights the frame its
    // wash lifts.
    building: { radiusCells: 3.0, colour: 0xffc46a, peak: 0.70, flicker: 0 },
    // A placed campfire (burned from a coal). Breathes.
    fire:     { radiusCells: () => (typeof FIRE_REST_R !== 'undefined' ? FIRE_REST_R : 3),
                colour: 0xff9a3c, peak: 0.95, flicker: 0.18 },
    // A live POI — a chest with something still in it (loose supply crates
    // are excluded for the reason they get no pad: a transient pickup is not
    // a place). This is what the old halo "ping" was for: places read as
    // places from across the map without shouting. It was a ring expanding
    // under the pad; now it is a small treasure blue-white light that breathes
    // SLOWLY (POI_PULSE_PERIOD_S — anything brisk turns a street of POIs into
    // a strobe), each on its own phase hashed from its id so a street doesn't
    // throb in lockstep. Small, so it marks the place rather than lighting
    // the block.
    poi:      { radiusCells: 2.0, colour: 0xcfe2ff, peak: 0.75, flicker: 0, pulse: 0.5 },
  };

  // Seconds per POI breath. Slow on purpose (see the row above).
  const POI_PULSE_PERIOD_S = 4.5;

  function radiusCells(kind) {
    const r = KINDS[kind].radiusCells;
    return typeof r === 'function' ? r() : r;
  }

  // The falloff pair, moved here from the ring code it used to drive. 0.90 at
  // the viewport corner on a p=1.5 ramp — picked by measuring mean luminance
  // per radius band against the effect switched off, not by eye:
  //
  //   0-120px (reach bubble)  -0.2   i.e. noise — the affordance is untouched
  //   150-180px (mid-field)   -7.7
  //   210-240px (corners)    -17.2
  //
  // The super-linear ramp is what buys that spread: it holds the mid-field
  // near full readability while still gathering real depth at the rim, where
  // the flat wash used to give distance no weight at all. Retune the pair
  // together, never the alpha alone.
  const FALLOFF_A = 0.90;
  const FALLOFF_P = 1.5;

  // Underground the lit bubble itself is dimmer than daylight, deepening
  // slightly per level so descents feel progressively gloomier. (The
  // surrounding rock is far darker still, so the bubble stays readable.)
  function litDim(depth) {
    return depth > 0 ? Math.min(0.40, 0.26 + 0.03 * (depth - 1)) : 0;
  }

  // Low energy tints the lit range pink — the Inner Light guttering as the
  // player tires. Energy doesn't shrink reach (coords.js reachRadiusM — only
  // depth does), but this pink is the cue to rest before energy hits 0, where
  // there is no reach at all. Skipped while a Potion of Reach pins the view lit.
  const LOW_ENERGY_TINT = 0xff5fa2;
  const LOW_ENERGY_A = 0.16;
  const LOW_ENERGY_FRAC = 0.30;

  // White lerped `alpha` of the way to `colour` — the multiply tint that
  // stands in for painting `colour` at `alpha` over the ground.
  function mixToWhite(colour, alpha) {
    const ch = (sh) => Math.round(255 * (1 - alpha) + ((colour >> sh) & 255) * alpha);
    return (ch(16) << 16) | (ch(8) << 8) | ch(0);
  }

  function lowEnergy(scene) {
    const sv = scene.save || {};
    const energy = sv.energy ?? 0;
    const maxEnergy = sv.maxEnergy ?? 100;
    const potionLit = (sv.reachPotionUntil ?? 0) > Date.now();
    return !potionLit && energy > 0 && (energy / maxEnergy) < LOW_ENERGY_FRAC;
  }

  // ── The profile: what the player's light and the ambient are worth here ──
  // Every level is a fraction of white, derived so the OLD picture comes back:
  //
  //   dimA       the flat out-of-reach wash (0.38 surface; 0.74+ underground)
  //   farA       what the corner landed on once the falloff rings stacked on
  //              that wash: 1 - (1-dimA)(1-FALLOFF_A)
  //   ambient    the lightmap's floor — mixToWhite(dimColour, farA)
  //   edge       the player cookie just OUTSIDE the plateau, so that
  //              ambient + edge == 1 - dimA (the old wash, exactly)
  //   lit        the cookie INSIDE the plateau, so that
  //              ambient + lit == 1 - litDim(depth) (1 on the surface)
  //   litColour  white, or the low-energy pink
  function profile(scene) {
    const depth = scene.depth ?? 0;
    // render.js declares Render as a top-level const, so it is reachable by
    // bare name in every scope loaded after it (the browser and the node
    // bundle alike), never as a window property.
    const R = (typeof Render !== 'undefined') ? Render : null;
    const dimA = R ? R.reachDimAlpha(scene) : 0.38;
    const dimColour = R ? R.reachDimColor(scene) : 0x000000;
    const farA = 1 - (1 - dimA) * (1 - FALLOFF_A);
    const ambient = mixToWhite(dimColour, farA);
    const edge = (1 - dimA) * FALLOFF_A;
    const lit = Math.max(0, (1 - litDim(depth)) - (1 - farA));
    const litColour = lowEnergy(scene) ? mixToWhite(LOW_ENERGY_TINT, LOW_ENERGY_A) : 0xffffff;
    return { depth, dimA, dimColour, farA, ambient, edge, lit, litColour };
  }

  // The player cookie's alpha at ramp position t (0 at the plateau edge, 1 at
  // the viewport corner): the old falloff, re-expressed as light.
  function playerCookieAlpha(t, prof) {
    if (t <= 0) return prof.edge;
    if (t >= 1) return 0;
    return prof.edge * (1 - Math.pow(t, FALLOFF_P));
  }

  // ── Collecting the frame's lights ────────────────────────────────────────
  // Positions are metres from the CAMERA ANCHOR, exactly as drawObjects
  // measures its sprites (dx, dy) — a light is a world-drawn thing, so it
  // goes through the anchor and slides with a peek (see the camera rule in
  // CLAUDE.md). The cull is halfM + the light's own radius, NOT the sprite
  // cull: a fire whose anchor is a cell off-screen still lights the edge.
  function sourceKind(scene, o) {
    if (!o) return null;
    if (o.kind === 'house') {
      if (scene.save && scene.save.starterShopId && scene.save.starterShopId === o.id) return 'trailer';
      return (scene.isClaimedKey && scene.isClaimedKey(o.id)) ? 'building' : null;
    }
    if (o.kind === 'tower') {
      return (scene.isClaimedKey && scene.isClaimedKey(o.castle)) ? 'building' : null;
    }
    if (o.kind === '_fire') return 'fire';
    // Opened chests are the CALLER's to drop (drawObjects already builds the
    // per-frame Set of save.opened it culls the sprite with).
    if (o.kind === 'chest') return o.crate ? null : 'poi';
    return null;
  }

  function beginFrame(scene) {
    if (!scene._lights) scene._lights = [];
    scene._lights.length = 0;
  }

  function inRange(scene, dx, dy, kind, halfM) {
    const pad = radiusCells(kind) * scene.cellM;
    return Math.abs(dx) <= halfM + pad && Math.abs(dy) <= halfM + pad;
  }

  // Offer one scanned object. Returns true if it was kept as a light.
  function consider(scene, o, dx, dy, halfM) {
    const kind = sourceKind(scene, o);
    if (!kind || !inRange(scene, dx, dy, kind, halfM)) return false;
    scene._lights.push({ kind, dx, dy, id: o.id });
    return true;
  }

  // The placed campfires on this depth, within light range of the view.
  function collectFires(scene, ax, ay, halfM) {
    const PF = window.PlacedFloor;
    const fires = scene.save && scene.save.fires;
    if (!PF || !fires || !fires.length) return 0;
    let n = 0;
    for (const fr of PF.forDepth(fires, scene.depth ?? 0)) {
      const dx = fr.x - ax, dy = fr.y - ay;
      if (!inRange(scene, dx, dy, 'fire', halfM)) continue;
      scene._lights.push({ kind: 'fire', dx, dy, id: `fire_${fr.x.toFixed(2)}_${fr.y.toFixed(2)}` });
      n++;
    }
    return n;
  }

  // ── Drawing (the browser from here down) ──────────────────────────────────
  // The lightmap is a plain 2D canvas — scene.lightTex, a Phaser canvas
  // texture shown by the scene.lightMap image with MULTIPLY blend. Each frame:
  // fill it with the ambient, switch to 'lighter' (additive) and stamp every
  // cookie, then refresh(). No render-texture batching anywhere: drawn through
  // Phaser's RenderTexture the cookies came back cut and quadrant-scrambled
  // (the player's under the headless GL the scratch checks ran on, a house's
  // on a real phone), and a 2D canvas composites the same way on every GPU
  // and on the Canvas fallback. The per-frame upload is one 352px RGBA
  // texture — the same shape the fog pays per cell crossing.
  const KIND_STOPS = 8;

  function rgba(colour, a) {
    return `rgba(${(colour >> 16) & 255},${(colour >> 8) & 255},${colour & 255},${Math.max(0, Math.min(1, a)).toFixed(4)})`;
  }
  function hex(colour) {
    return '#' + (colour & 0xffffff).toString(16).padStart(6, '0');
  }
  function makeCanvas(S) {
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    return c;
  }

  // One cookie canvas per kind, baked once: peak at the centre, (1 - r/R)^2
  // out to zero, the kind's colour baked in.
  function ensureKindCookie(scene, kind) {
    const store = scene._lightCookies || (scene._lightCookies = {});
    if (store[kind]) return store[kind];
    const row = KINDS[kind];
    const cellPx = (typeof CELL_PX !== 'undefined') ? CELL_PX : 32;
    const R = Math.ceil(radiusCells(kind) * cellPx);
    const S = 2 * R;
    const canvas = makeCanvas(S);
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(R, R, 0, R, R, R);
    for (let i = 0; i <= KIND_STOPS; i++) {
      const t = i / KIND_STOPS;
      g.addColorStop(t, rgba(row.colour, row.peak * (1 - t) * (1 - t)));
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    store[kind] = { canvas, R };
    return store[kind];
  }

  // The player's RAMP: flat at `edge` out to the reach radius, then the
  // falloff to zero at the viewport's half-diagonal (the furthest visible
  // pixel — ramping past it only spends the ramp where nobody sees). The
  // PLATEAU is not in here: it is painted per reach cell in draw(), so the
  // sharp edge of the lit area is the same staircase the reach outline
  // traces and the tap gate accepts (cellInReach), not a circle near it.
  // Rebaked only when its inputs move: the reach radius (energy / depth /
  // Potion of Reach) and the depth's levels.
  //
  // Baked at HALF resolution and drawn at scale 2: it is a smooth gradient,
  // so nothing is lost and the canvas is a quarter the bytes.
  const RAMP_STOPS = 16;
  const PLAYER_COOKIE_SCALE = 2;

  function ensurePlayerCookie(scene, prof, r0, rMax) {
    const key = `${Math.round(r0)}|${Math.round(rMax)}|${prof.edge.toFixed(3)}`;
    const st = scene._lightPlayer || (scene._lightPlayer = { key: null, canvas: null, S: 0 });
    if (st.key === key && st.canvas) return st;
    st.key = key;
    const K = PLAYER_COOKIE_SCALE;
    const rMaxT = rMax / K;
    const r0T = Math.min(r0, rMax) / K;
    const S = 2 * Math.ceil(rMaxT);
    if (!st.canvas || st.S !== S) { st.canvas = makeCanvas(S); st.S = S; }
    const c = S / 2;
    const ctx = st.canvas.getContext('2d');
    ctx.clearRect(0, 0, S, S);
    const g = ctx.createRadialGradient(c, c, 0, c, c, rMaxT);
    const fr = (r) => Math.min(1, Math.max(0, r / rMaxT));
    g.addColorStop(0, rgba(0xffffff, prof.edge));
    // The ramp starts at r0 with `edge` and lands on 0 at rMax. Sample the
    // super-linear curve at RAMP_STOPS points so the gradient's linear
    // segments track it.
    const span = rMaxT - r0T;
    for (let i = 0; i <= RAMP_STOPS; i++) {
      const t = i / RAMP_STOPS;
      g.addColorStop(fr(r0T + t * span), rgba(0xffffff, playerCookieAlpha(t, prof)));
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return st;
  }

  // The colour the reach cells are filled with, at alpha (lit - edge), so that
  // on top of the ramp's flat `edge` of white they land on exactly
  // lit × litColour per channel — the plateau level, pink when tired.
  function plateauCellColour(prof) {
    const f = prof.lit - prof.edge;
    if (f <= 0) return 0xffffff;
    const ch = (sh) => {
      const target = prof.lit * (((prof.litColour >> sh) & 255) / 255);
      return Math.round(255 * Math.max(0, Math.min(1, (target - prof.edge) / f)));
    };
    return (ch(16) << 16) | (ch(8) << 8) | ch(0);
  }

  // A fire's breath: two sines at unrelated rates, phased by where it stands
  // so neighbouring fires don't flicker in unison; a POI's slow breath: one
  // sine over POI_PULSE_PERIOD_S, phased by its id (stable across tile
  // reloads — no RNG) so a street of POIs doesn't throb as one.
  function flickerAlpha(row, dx, dy, now, id) {
    let a = 1;
    if (row.flicker) {
      const phase = ((dx * 7.13 + dy * 3.71) % 6.283);
      const w = 0.5 + 0.25 * Math.sin(now / 90 + phase) + 0.25 * Math.sin(now / 233 + phase * 1.7);
      a *= 1 - row.flicker * w;
    }
    if (row.pulse) {
      let h = 0;
      const str = String(id || '');
      for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
      const t = (now / 1000) / POI_PULSE_PERIOD_S + (h % 1000) / 1000;
      const w = 0.5 + 0.5 * Math.sin(t * Math.PI * 2);           // 0..1
      a *= 1 - row.pulse * w;
    }
    return a;
  }

  // Paint this frame's lightmap: the ambient floor, the player's ramp at the
  // feet-on-the-fix point, the plateau over every reach cell, then every
  // collected light at its anchored screen position. `ax, ay` are the camera
  // anchor in world metres, `halfM` the sprite cull the collector pads.
  function draw(scene, ax, ay, halfM) {
    const tex = scene.lightTex;
    if (!tex || typeof document === 'undefined') return;
    if (!scene._lights) scene._lights = [];
    collectFires(scene, ax, ay, halfM);
    const prof = profile(scene);
    const k = CELL_PX / scene.cellM;                 // metres → screen px
    const rMax = Math.hypot(scene.viewSize, scene.viewSize) / 2;
    const reachM = (typeof reachRadiusM === 'function') ? reachRadiusM(scene) : 0;
    const r0 = Math.max(0, reachM * k);
    const player = ensurePlayerCookie(scene, prof, r0, rMax);
    const ps = scene.playerScreen ? scene.playerScreen() : { x: scene.viewCenterX, y: scene.viewCenterY };
    const ox = scene.viewLeft, oy = scene.viewTop;   // lightmap-local origin
    const now = Date.now();
    const ctx = tex.context;
    const W = tex.width, H = tex.height;

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = hex(prof.ambient);
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;

    // The ramp, centred on the player's feet.
    const D = player.S * PLAYER_COOKIE_SCALE;
    ctx.drawImage(player.canvas, ps.x - ox - D / 2, ps.y - oy - D / 2, D, D);

    // The plateau: every cell in reach, by the SAME test the outline and the
    // tap gate use — cellInReach's expressions, hoisted once per frame the way
    // drawCells hoists them (reachRadiusM and playerReachCell are constant for
    // the frame; 169 calls of the allocating helper is churn for nothing).
    if (reachM > 0 && prof.lit > prof.edge && typeof playerReachCell === 'function'
        && typeof viewAnchorCell === 'function') {
      const reachM2 = reachM * reachM;
      const rp = playerReachCell(scene);
      const pc = viewAnchorCell(scene);
      const fracX = pc.cx - Math.floor(pc.cx);
      const fracY = pc.cy - Math.floor(pc.cy);
      const baseCellIX = pc.tx * scene.cellsPerTile + Math.floor(pc.cx);
      const baseCellIY = pc.ty * scene.cellsPerTile + Math.floor(pc.cy);
      const half = (VIEW_CELLS - 1) / 2;
      ctx.fillStyle = rgba(plateauCellColour(prof), prof.lit - prof.edge);
      for (let row = -1; row <= VIEW_CELLS; row++) {
        for (let col = -1; col <= VIEW_CELLS; col++) {
          const absIX = baseCellIX + (col - half);
          const absIY = baseCellIY + (row - half);
          const dx = (absIX - rp.cellIX) * scene.cellM;
          const dy = (absIY - rp.cellIY) * scene.cellM;
          if (dx * dx + dy * dy > reachM2) continue;
          // cellScreenXY's expression (render.js), in lightmap-local px.
          const sx = Math.round(scene.viewCenterX + (col - half - fracX + 0.5) * CELL_PX - CELL_PX / 2) - ox;
          const sy = Math.round(scene.viewCenterY + (row - half - fracY + 0.5) * CELL_PX - CELL_PX / 2) - oy;
          ctx.fillRect(sx, sy, CELL_PX, CELL_PX);
        }
      }
    }

    // The lights.
    for (const L of scene._lights) {
      const row = KINDS[L.kind];
      const ck = ensureKindCookie(scene, L.kind);
      const a = flickerAlpha(row, L.dx, L.dy, now, L.id);
      const sc = row.flicker ? 1 + (a - (1 - row.flicker / 2)) * 0.15 : 1;
      const d = 2 * ck.R * sc;
      ctx.globalAlpha = a;
      ctx.drawImage(ck.canvas,
        scene.viewCenterX + L.dx * k - ox - d / 2,
        scene.viewCenterY + L.dy * k - oy - d / 2, d, d);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    tex.refresh();
  }

  window.Lighting = {
    KINDS, radiusCells, FALLOFF_A, FALLOFF_P, litDim, POI_PULSE_PERIOD_S,
    LOW_ENERGY_TINT, LOW_ENERGY_A, LOW_ENERGY_FRAC, mixToWhite,
    profile, playerCookieAlpha, plateauCellColour, sourceKind, beginFrame, consider, collectFires,
    flickerAlpha, draw,
  };
})(window);
