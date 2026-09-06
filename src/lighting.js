// Lighting — every light in the world, composited as ONE lightmap.
//
// Depends on:
//   Render.reachDimColor / Render.reachDimAlpha (render.js) — the ambient
//   reachRadiusM (coords.js) — the player's plateau radius
//   PlacedFloor (placed_floor.js) — the campfire list, per depth
//   VIEW_CELLS / CELL_PX / FIRE_REST_R — app.js top-level consts, read at
//   call time (app.js loads last), never at parse time
//   Phaser — ONLY inside draw(); everything above it is pure and runs headless
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
// It runs on both renderers. ADD and MULTIPLY map to canvas composite
// operations, and the colour is baked into each cookie rather than tinted
// because the Canvas fallback ignores tint (see the shiny spark in app.js).
//
// What did NOT move: the white reach OUTLINE is still per-cell, on reachGfx,
// because it is the tap affordance and cellInReach is cell-exact. A cookie is
// a circle; the outline is the staircase. The outline marks what you can
// touch; the light is only light.
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

  // ── Drawing (Phaser from here down) ──────────────────────────────────────
  // Stops for a kind's cookie: peak at the centre, (1 - r/R)^2 out to zero.
  const KIND_STOPS = 8;

  function rgba(colour, a) {
    return `rgba(${(colour >> 16) & 255},${(colour >> 8) & 255},${colour & 255},${a.toFixed(4)})`;
  }

  // One texture + one hidden ADD-blended Image per kind, baked once. The image
  // is what gets drawn into the lightmap: DynamicTexture.batchGameObject sets
  // the renderer's blend mode from the object's, on both renderers, whereas
  // a bare texture-frame draw would land source-over.
  function ensureKindCookie(scene, kind) {
    const store = scene._lightCookies || (scene._lightCookies = {});
    if (store[kind]) return store[kind];
    const row = KINDS[kind];
    const cellPx = (typeof CELL_PX !== 'undefined') ? CELL_PX : 32;
    const R = Math.ceil(radiusCells(kind) * cellPx);
    const S = 2 * R;
    const key = `lm_${kind}`;
    const tex = scene.textures.exists(key) ? scene.textures.get(key)
      : scene.textures.createCanvas(key, S, S);
    const ctx = tex.context;
    ctx.clearRect(0, 0, S, S);
    const g = ctx.createRadialGradient(R, R, 0, R, R, R);
    for (let i = 0; i <= KIND_STOPS; i++) {
      const t = i / KIND_STOPS;
      g.addColorStop(t, rgba(row.colour, row.peak * (1 - t) * (1 - t)));
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    tex.refresh();
    const img = scene.make.image({ key, add: false })
      .setOrigin(0.5, 0.5).setBlendMode(Phaser.BlendModes.ADD);
    store[kind] = { img, R };
    return store[kind];
  }

  // The player's cookie: lit plateau out to the reach radius, a short feather,
  // then the falloff ramp to zero at the viewport's half-diagonal (the furthest
  // visible pixel — ramping past it only spends the ramp where nobody sees).
  // Rebaked only when its inputs move: the reach radius (energy / depth /
  // Potion of Reach), the depth's levels, the low-energy tint.
  //
  // Baked at HALF resolution and drawn at scale 2, with LINEAR filtering so
  // the upscale interpolates. It is a smooth gradient, so nothing is lost,
  // the texture is a quarter the bytes — and it keeps the cookie under 256px
  // (249 at the 352px viewport): textures larger than that sampled INSIDE a
  // render texture came back quadrant-scrambled under the headless GL the
  // scratch checks ran on. Real GPUs may not care; the half-res bake costs
  // nothing and never has to find out.
  const PLATEAU_FEATHER_PX = 3;
  const RAMP_STOPS = 16;
  const PLAYER_COOKIE_SCALE = 2;

  function ensurePlayerCookie(scene, prof, r0, rMax) {
    const key = `${Math.round(r0)}|${Math.round(rMax)}|${prof.lit.toFixed(3)}|${prof.edge.toFixed(3)}|${prof.litColour.toString(16)}`;
    const st = scene._lightPlayer || (scene._lightPlayer = { key: null, img: null });
    if (st.key === key && st.img) return st;
    st.key = key;
    const K = PLAYER_COOKIE_SCALE;
    const rMaxT = rMax / K, r0T = r0 / K;            // texture px
    const S = 2 * Math.ceil(rMaxT);
    const c = S / 2;
    const texKey = 'lm_player';
    let tex;
    if (scene.textures.exists(texKey)) {
      tex = scene.textures.get(texKey);
      if (tex.width !== S || tex.height !== S) { scene.textures.remove(texKey); tex = null; }
    }
    if (!tex) {
      tex = scene.textures.createCanvas(texKey, S, S);
      try { tex.setFilter(Phaser.Textures.FilterMode.LINEAR); } catch (e) { /* Canvas: no texture filter */ }
    }
    const ctx = tex.context;
    ctx.clearRect(0, 0, S, S);
    const g = ctx.createRadialGradient(c, c, 0, c, c, rMaxT);
    const fr = (r) => Math.min(1, Math.max(0, r / rMaxT));
    if (r0T > 0) {
      g.addColorStop(0, rgba(prof.litColour, prof.lit));
      g.addColorStop(fr(Math.max(0, r0T - PLATEAU_FEATHER_PX / K)), rgba(prof.litColour, prof.lit));
    }
    // The ramp starts at r0 with `edge` and lands on 0 at rMax. Sample the
    // super-linear curve at RAMP_STOPS points so the gradient's linear
    // segments track it.
    const span = rMaxT - r0T;
    for (let i = 0; i <= RAMP_STOPS; i++) {
      const t = i / RAMP_STOPS;
      const r = r0T + t * span;
      const pos = fr(r);
      const a = playerCookieAlpha(t, prof);
      // Two stops can't share a position with different colours in a way that
      // reads as a step, so nudge the first ramp stop just past the plateau.
      g.addColorStop(i === 0 && r0T > 0 ? Math.min(1, pos + 1e-4) : pos, rgba(0xffffff, a));
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    tex.refresh();
    if (!st.img) {
      st.img = scene.make.image({ key: texKey, add: false })
        .setOrigin(0.5, 0.5).setBlendMode(Phaser.BlendModes.ADD);
    } else {
      st.img.setTexture(texKey);
    }
    return st;
  }

  // How bright a light is THIS frame, as a fraction of its peak.
  //   flicker — a fire's breath: two sines at unrelated rates, phased by where
  //             it stands so neighbouring fires don't flicker in unison.
  //   pulse   — a POI's slow breath: one sine over POI_PULSE_PERIOD_S, phased
  //             by its id (stable across tile reloads — no RNG) so a street of
  //             POIs doesn't throb as one.
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

  // Paint this frame's lightmap: the ambient floor, the player's cookie at the
  // feet-on-the-fix point, then every collected light at its anchored screen
  // position. `ax, ay` are the camera anchor in world metres, `halfM` the
  // sprite cull the collector pads.
  function draw(scene, ax, ay, halfM) {
    const rt = scene.lightMap;
    if (!rt || typeof Phaser === 'undefined') return;
    beginFrameIfNeeded(scene);
    collectFires(scene, ax, ay, halfM);
    const prof = profile(scene);
    const k = CELL_PX / scene.cellM;                 // metres → screen px
    const rMax = Math.hypot(scene.viewSize, scene.viewSize) / 2;
    const reachM = (typeof reachRadiusM === 'function') ? reachRadiusM(scene) : 0;
    const r0 = Math.max(0, reachM * k);
    // Every cookie is baked BEFORE the batch opens. A bake uploads a texture,
    // and uploading one while the render texture's batch is mid-flight
    // rebinds a unit the queued quads still point at.
    const player = ensurePlayerCookie(scene, prof, r0, rMax);
    for (const L of scene._lights) ensureKindCookie(scene, L.kind);
    const ps = scene.playerScreen ? scene.playerScreen() : { x: scene.viewCenterX, y: scene.viewCenterY };
    const ox = scene.viewLeft, oy = scene.viewTop;   // lightmap-local origin
    const now = Date.now();

    rt.fill(prof.ambient, 1);
    // The player's cookie gets a draw call of its OWN, then the small cookies
    // share one batch. Batched together with them, the big quad came back
    // split into four mismatched quadrants with a dark cross through the
    // player under the headless GL the scratch checks ran on; alone it is
    // clean on both renderers. One extra flush a frame is nothing.
    player.img.setAlpha(1).setScale(PLAYER_COOKIE_SCALE);
    rt.draw(player.img, ps.x - ox, ps.y - oy);
    rt.beginDraw();
    for (const L of scene._lights) {
      const row = KINDS[L.kind];
      const ck = ensureKindCookie(scene, L.kind);
      const a = flickerAlpha(row, L.dx, L.dy, now, L.id);
      ck.img.setAlpha(a).setScale(row.flicker ? 1 + (a - (1 - row.flicker / 2)) * 0.15 : 1);
      rt.batchDraw(ck.img,
        scene.viewCenterX + L.dx * k - ox,
        scene.viewCenterY + L.dy * k - oy);
    }
    rt.endDraw();
  }

  function beginFrameIfNeeded(scene) {
    if (!scene._lights) scene._lights = [];
  }

  window.Lighting = {
    KINDS, radiusCells, FALLOFF_A, FALLOFF_P, litDim, POI_PULSE_PERIOD_S,
    LOW_ENERGY_TINT, LOW_ENERGY_A, LOW_ENERGY_FRAC, mixToWhite,
    profile, playerCookieAlpha, sourceKind, beginFrame, consider, collectFires,
    flickerAlpha, draw,
  };
})(window);
