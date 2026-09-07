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
//   Lighting.playerKind(scene)    — which row the PLAYER lights as: 'player',
//                                   or 'handtorch' while a Torch burns
//   Lighting.beginFrame(scene)    — empty the frame's light list
//   Lighting.consider(scene, o, dx, dy, halfM) — offer a scanned object
//   Lighting.blast(scene, wmx, wmy, opts) — fire a transient restoration flash
//   Lighting.collectBlasts(scene, ax, ay, halfM, now) — the live ones, pruned
//   Lighting.collectFires(scene, ax, ay, halfM) — add the placed campfires
//   Lighting.collectPlayer(scene, ax, ay, halfM) — add the player's torch, if lit
//   Lighting.TORCH_RADIUS_MUL     — the torch's radius, in player radii
//   Lighting.profile(scene, daylight) — ambient / lit / edge levels at this depth
//   Lighting.daylight(scene, now) — 0..1 from the real sun at the player
//   Lighting.playerCookieAlpha(t, prof) — the player ramp, sampled
//   Lighting.plateauLevel(prof, t)  — the plateau's light at t of the way to the rim
//   Lighting.plateauCellPath(ctx, sx, sy, …) — one reach cell's rounded plateau path
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
// maths, so the sharp edge of the lit area IS the staircase the tap gate
// accepts. Only the falloff outside it is a circle. That edge is the WHOLE
// affordance: a white outline was stroked over the same staircase on reachGfx
// (render.js) until Sep 2026, back when the plateau under it was dim enough
// to need underlining — PLATEAU_OUTPUT_K lit it back up and the line went, so
// this pass is now the only thing that says where you can reach. Do not stroke
// one back: if the boundary stops reading, the step at its edge is what to
// widen. Inside the staircase the plateau is not flat: it is
// the player's own lamp, full at the feet and easing down PLATEAU_FALL of
// the way by the reach rim (plateauLevel), so the lit area reads as light
// thrown from the body rather than a cut-out — the step down at its edge
// is still the biggest thing in the picture.
//
// ── The numbers are DERIVED, not tuned ────────────────────────────────────
// profile() reproduces the old wash for the white channel from the same two
// sources the ground pass painted with — Render.reachDimAlpha / reachDimColor
// — plus the falloff pair (FALLOFF_A, FALLOFF_P) that lived beside the rings.
// Three deliberate departures sit on top: AMBIENT_K (and its daytime partner
// AMBIENT_DAY_LUM), which darken/brighten the floor alone for contrast — a
// flat night value blended up to a sunlit one by `night`, surface only — and
// the two OUTPUT knobs, which scale how much of the reproduced wash the
// player's body gives back without touching the RADIUS it reaches:
// PLAYER_OUTPUT_K for the ramp OUTSIDE the reach area (`edge`, and the
// falloff hung off it) and PLATEAU_OUTPUT_K for the reach area itself
// (`lit`). They are two numbers rather than one because the picture wants
// opposite things of them: the mid-field is dim so the placed lights tell
// against it, and the reach area is bright because it is what the player is
// working in. Retune a look by changing those three; a fourth factor in here
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
  // warmth" are one rule. HOME's radius is HOME_R by the same rule, and it
  // carries a third effect on the same ring: nothing hostile stays inside it.
  // Both are resolved at call time because app.js defines them after this file
  // loads; lighting.test.js pins each against its constant.
  //
  // The player's own light is the RAMP (ensurePlayerCookie + the plateau in
  // draw()), not a cookie — but it has a row too, so the one thing derived
  // from it (the torch) has a number to derive from, and draw() reads the
  // ramp's extent off the row rather than a second copy of the maths.
  //
  // The Torch (a T1 consumable, useTorch in app.js) doesn't change the reach
  // plateau — that is the Inner Light, and the tap gate's — it widens the
  // FALLOFF: while it burns the collector stamps the `handtorch` cookie at the
  // player's feet ON TOP of the ramp (light adds), white like the player's
  // own light, out to TORCH_RADIUS_MUL player radii. Nothing here asks the
  // depth: a torch by night on the surface is fine, and free.
  const TORCH_RADIUS_MUL = 2;
  const KINDS = {
    // The player: white, out to the furthest visible pixel (the viewport's
    // half-diagonal) plus PLAYER_RAMP_PAST_CORNER_CELLS, so the corners stay
    // just lit under a peek (see draw()). `peak` is DERIVED per depth (profile().edge at the plateau's
    // edge, the old falloff, scaled by PLAYER_OUTPUT_K), so the row carries
    // none: it is never baked as a kind cookie, the ramp is its picture.
    player:   { radiusCells: () => Math.hypot(viewCells(), viewCells()) / 2 + PLAYER_RAMP_PAST_CORNER_CELLS,
                colour: 0xffffff, peak: null, flicker: 0 },
    // The player with a Torch ITEM lit (`handtorch` — `torch` below is the
    // cave torch stake): the same white, TORCH_RADIUS_MUL times as far,
    // breathing like the fire it is. Stamped at the feet in ADDITION to
    // the ramp, so the plateau is untouched and only the dark around it lifts.
    handtorch: { radiusCells: () => radiusCells('player') * TORCH_RADIUS_MUL, colour: 0xffffff, peak: 0.95, flicker: 0.12 },
    // Home: the starter trailer, or the house adopted as Home in its place
    // (both are save.starterShopId). Wider and warmer than a plain restored
    // house — it is the one light the player always comes back to, and the lit
    // circle is literally the safe circle: HOME_R is also the ring that rests
    // the player (HOME_FULL_REST_S) and turns enemies around.
    trailer:  { radiusCells: () => (typeof HOME_R !== 'undefined' ? HOME_R : 4),
                colour: 0xffd28a, peak: 1.00, flicker: 0 },
    // A building the player has taken back: a restored wreck, an unsealed
    // fort, the turrets of a claimed castle. Keyed on the SAME test the
    // derelict wash uses (scene.isClaimedKey), so a house lights the frame its
    // wash lifts.
    building: { radiusCells: 3.0, colour: 0xffc46a, peak: 0.95, flicker: 0 },
    // A placed campfire (burned from a coal). Breathes.
    fire:     { radiusCells: () => (typeof FIRE_REST_R !== 'undefined' ? FIRE_REST_R : 3),
                colour: 0xff9a3c, peak: 1.00, flicker: 0.18 },
    // A live POI — a chest with something still in it (loose supply crates
    // are excluded for the reason they get no pad: a transient pickup is not
    // a place). This is what the old halo "ping" was for: places read as
    // places from across the map without shouting. It was a ring expanding
    // under the pad; now it is a small treasure blue-white light that breathes
    // SLOWLY (POI_PULSE_PERIOD_S — anything brisk turns a street of POIs into
    // a strobe), each on its own phase hashed from its id so a street doesn't
    // throb in lockstep. Small, so it marks the place rather than lighting
    // the block.
    poi:      { radiusCells: 2.0, colour: 0xcfe2ff, peak: 0.88, flicker: 0, pulse: 0.5 },
    // A cave torch (worldgen.js caveTorchesFrom — planted where a lowtier
    // street-furniture POI stands overhead, the one chest class that does not
    // mirror underground). A real flame: warm, a little smaller than a
    // campfire, and it breathes like one. Bright enough to read a cave
    // junction by from across the level.
    torch:    { radiusCells: 2.5, colour: 0xffa54a, peak: 1.00, flicker: 0.22 },
    // A wild mushroom — the faint one. Every `mushroom` wildplant glows, on
    // the surface as well as in the caves (where spawnCaveMushrooms scatters
    // the blue luminous kind): a cool, small, slow-breathing light that marks
    // a forage spot in the dark without lighting anything around it. The
    // torch/mushroom pair is deliberately far apart in both radius and peak
    // — lighting.test.js pins the order — so a lit cave reads as "a torch
    // there, some fungus here", never two of the same lamp.
    mushroom: { radiusCells: 1.25, colour: 0x9fdcff, peak: 0.50, flicker: 0, pulse: 0.35 },
    // A BLAST — the one-shot near-white flash of a RESTORATION moment: a
    // stretch of street rebuilt, a wreck pulled back into a house. Unlike
    // every row above it this one is TRANSIENT and SCALABLE: `Lighting.blast`
    // puts an entry on scene._blasts with its own radius, colour and
    // duration, and the row's radiusCells is only the default (a street
    // stretch's — the length and width of the old per-cobble flash exactly,
    // which is why BLAST_MS is 900). It is the one light that
    // shows INSIDE the reach plateau by day: the plateau sits a few percent
    // under white, and a peak this high tips a cell to full white for the
    // first frames, which is the flash.
    blast:    { radiusCells: 2.5, colour: 0xe4defc, peak: 1.0, flicker: 0 },
  };

  // Seconds per POI breath. Slow on purpose (see the row above).
  const POI_PULSE_PERIOD_S = 4.5;

  // app.js's VIEW_CELLS, read at call time like FIRE_REST_R (app.js loads
  // after this file); 11 is its shipping value, for a context without it.
  function viewCells() {
    return (typeof VIEW_CELLS !== 'undefined') ? VIEW_CELLS : 11;
  }

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

  // The CONTRAST knob: how much of the derived floor survives. The derivation
  // below lands the far field where the old wash + rings did (~15-19% on the
  // surface, biome-tinted), and that read as too bright once real lights were
  // in the world — "totally unlit areas should be darker" (Sep 2026). This
  // scales the AMBIENT only: the ramp and the plateau are untouched, so the
  // reach edge and the mid-field keep their step and only the dark gets dark.
  // 1.0 is the old picture exactly; lower is more contrast. AMBIENT_K is the
  // NIGHT value — profile() lifts the floor toward AMBIENT_DAY_LUM as the sun
  // comes up (surface only; a cave has no sun and stays on AMBIENT_K always,
  // see the `night` derivation below), so a peek into the distance at noon
  // reads as sunlit ground rather than the same near-black the small hours
  // get.
  //
  // NOON IS STATED AS A LEVEL, NOT A SCALE. AMBIENT_DAY_LUM is what the
  // unlit far field is WORTH at midday — 40% of the art's own brightness,
  // read straight off the screen — because a multiplier on a derived floor
  // says nothing about where it lands: the floor is the biome's dim colour,
  // so the same number came out at a different brightness in every biome, and
  // pushing it up meant scaling channels that can overflow their byte. A
  // target luminance can't clip and can't drift per biome (atLuminance mixes
  // the floor toward white to reach it, which also drains the hue — right for
  // noon: the far field should read as sunlit ground, not as tinted dark).
  // The NIGHT end is unchanged by construction: its target is AMBIENT_K ×
  // the floor's own luminance, which atLuminance reaches by scaling — the
  // exact expression this used to be.
  const AMBIENT_K = 0.45;
  const AMBIENT_DAY_LUM = 0.40;

  // The PLAYER'S OWN OUTPUT knobs: how much of the reproduced-wash levels the
  // player's light actually throws. Neither touches the RADIUS it reaches
  // (radiusCells('player') and TORCH_RADIUS_MUL off it are unaffected, so a
  // dimmer player still lights exactly as far); 1.0 is the old picture
  // exactly, and lower is a dimmer light at the same reach.
  //
  // PLAYER_OUTPUT_K scales `edge` — the ramp OUTSIDE the reach area, and the
  // whole falloff hung off it. Halved from 0.8 to 0.4 in Sep 2026: the body
  // was throwing enough light that the placed lights — a campfire, Home, a
  // POI — barely told against it, and the reach step reads better against a
  // darker mid-field. That is still what this number is for, so it stays.
  const PLAYER_OUTPUT_K = 0.4;

  // PLATEAU_OUTPUT_K scales `lit` — the reach area itself, the plateau the
  // per-cell mask ADDS over the ramp. It used to BE PLAYER_OUTPUT_K: one knob
  // scaled both, and dimming the mid-field to let the placed lights tell took
  // the ground the player actually works on down with it, to a bit over half
  // its old light. The two wants are opposite, so they are two numbers now —
  // and splitting them costs none of the relations the shared knob was
  // keeping, because raising `lit` alone only widens them: the falloff's
  // shape is `edge`'s alone, PLATEAU_FALL is a fraction of `lit` so the
  // plateau's easing scales with it, `lit > edge` holds by a bigger margin,
  // and the step off the plateau grows faster than the fall across it
  // (0.82 of a rise against 0.18 of it). lighting.test.js pins all four.
  //
  // 0.60 IS THE CEILING, not a taste: the plateau adds onto the ambient
  // FLOOR, which at noon is already AMBIENT_DAY_LUM bright, so past this the
  // reach area clips to white and PLATEAU_FALL's shading flattens out with
  // it. Measured, not guessed — over every COLORS × DUST_OF pairing the
  // biome palette can actually produce, the tightest headroom is 0.602 (the
  // brick-house base under industrial dust, dim 0x35261e: the most saturated
  // dim colour in the world, so the one whose floor puts the most into a
  // single channel at a given luminance). Underground and after dark the
  // floor is near-black and the headroom is 1.0+, so noon on the surface is
  // what binds. If the far field is ever brightened again — AMBIENT_DAY_LUM
  // up, or the dim palette out — re-measure this before raising it.
  const PLATEAU_OUTPUT_K = 0.6;

  // ── Time of day ───────────────────────────────────────────────────────────
  // The surface picture above is HIGH NOON. As the real sun goes down where
  // the player actually is, the out-of-reach world darkens toward the first
  // cave level's dark: the out-of-reach wash deepens from the biome's day
  // value to NIGHT_DIM_A, and its colour drains toward black keeping
  // NIGHT_TINT_KEEP of the biome hue. The reach PLATEAU is not touched — it
  // is the Inner Light, the player's own lamp, and a dark bubble at night
  // would take the affordance with it. Caves ignore the sun entirely.
  //
  // `daylight` is 0..1 from the sun's elevation at the player's lon/lat
  // (sunElevationDeg — the NOAA low-precision algorithm, good to a fraction
  // of a degree): 1 above DAY_ELEV_DEG, 0 below NIGHT_ELEV_DEG (civil
  // twilight's end), smoothstep between. Sunset is exactly halfway.
  // window.__DAYLIGHT = 0..1 forces it for eyeballing.
  const NIGHT_DIM_A = 0.74;
  const NIGHT_TINT_KEEP = 0.15;
  const DAY_ELEV_DEG = 6;
  const NIGHT_ELEV_DEG = -6;

  function sunElevationDeg(ms, lat, lon) {
    const rad = Math.PI / 180;
    const d = ms / 86400000 - 10957.5;                       // days since J2000.0
    const g = ((357.529 + 0.98560028 * d) % 360) * rad;      // mean anomaly
    const q = (280.459 + 0.98564736 * d) % 360;              // mean longitude
    const L = ((q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) % 360) * rad;
    const e = (23.439 - 0.00000036 * d) * rad;               // obliquity
    const RA = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
    const dec = Math.asin(Math.sin(e) * Math.sin(L));
    const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
    const H = ((gmst + lon / 15) * 15) * rad - RA;           // hour angle
    const la = lat * rad;
    const sinAlt = Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(H);
    return Math.asin(Math.max(-1, Math.min(1, sinAlt))) / rad;
  }

  function daylightFromElevation(elevDeg) {
    const t = (elevDeg - NIGHT_ELEV_DEG) / (DAY_ELEV_DEG - NIGHT_ELEV_DEG);
    const u = Math.max(0, Math.min(1, t));
    return u * u * (3 - 2 * u);
  }

  // The frame's daylight, 0..1. Recomputed once a minute (the sun moves a
  // quarter degree in that time); the player's position is read through the
  // projection coords.js owns. Noon when there is no fix to place the sun by.
  function daylight(scene, now) {
    if (typeof window !== 'undefined' && window.__DAYLIGHT != null) {
      return Math.max(0, Math.min(1, +window.__DAYLIGHT));
    }
    const st = scene._daylight || (scene._daylight = { minute: -1, value: 1 });
    const minute = Math.floor(now / 60000);
    if (st.minute === minute) return st.value;
    st.minute = minute;
    let value = 1;
    try {
      if (typeof localMToLonLat === 'function' && scene.playerM && scene.startWorldM && scene.mPerPx) {
        const ll = localMToLonLat(scene, scene.playerM.x, scene.playerM.y);
        if (Number.isFinite(ll.lat) && Number.isFinite(ll.lon)) {
          value = daylightFromElevation(sunElevationDeg(now, ll.lat, ll.lon));
        }
      }
    } catch (e) { value = 1; }
    st.value = value;
    return value;
  }

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
  function scaleColour(colour, k) {
    const ch = (sh) => Math.round(((colour >> sh) & 255) * k);
    return (ch(16) << 16) | (ch(8) << 8) | ch(0);
  }
  // Rec. 601 luminance of a colour, 0..1 — "how bright is this, to an eye".
  function lum(colour) {
    return (0.299 * ((colour >> 16) & 255) + 0.587 * ((colour >> 8) & 255)
      + 0.114 * (colour & 255)) / 255;
  }
  // The same colour, put AT a luminance. Brightening mixes toward white (which
  // desaturates, and cannot overflow a channel); darkening scales, which keeps
  // the hue exactly — so a target below the colour's own luminance reproduces
  // scaleColour(colour, target / lum(colour)) precisely.
  function atLuminance(colour, target) {
    const t = Math.max(0, Math.min(1, target));
    const l = lum(colour);
    if (l <= 0) return mixToWhite(0x000000, 1 - t);      // black floor → grey
    if (l >= t) return scaleColour(colour, t / l);
    return mixToWhite(colour, (1 - t) / (1 - l));
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
  //   ambient    the lightmap's floor — mixToWhite(dimColour, farA), put at a
  //              LUMINANCE (the ramp is not touched): AMBIENT_K × its own at
  //              night, lifted to AMBIENT_DAY_LUM at noon, by `night` —
  //              surface only; a cave has no sun, so it stays on the flat
  //              AMBIENT_K exactly as before, whatever daylight is passed in
  //   edge       the player cookie just OUTSIDE the plateau — the old wash,
  //              exactly, scaled by the ramp's own knob:
  //              ambient + edge/PLAYER_OUTPUT_K == 1 - dimA
  //   lit        the cookie INSIDE the plateau — scaled by the plateau's own
  //              knob: ambient + lit/PLATEAU_OUTPUT_K == 1 - litDim(depth)
  //              (1 on the surface)
  //   litColour  white, or the low-energy pink
  //   night      1 - daylight on the surface, always 0 underground; moves
  //              dimA toward NIGHT_DIM_A and drains dimColour (see above)
  //
  // `daylight` defaults to noon so the derivation is pinned without a clock;
  // draw() passes the frame's real value.
  function profile(scene, daylightIn) {
    const depth = scene.depth ?? 0;
    // render.js declares Render as a top-level const, so it is reachable by
    // bare name in every scope loaded after it (the browser and the node
    // bundle alike), never as a window property.
    const R = (typeof Render !== 'undefined') ? Render : null;
    let dimA = R ? R.reachDimAlpha(scene) : 0.38;
    let dimColour = R ? R.reachDimColor(scene) : 0x000000;
    const night = depth > 0 ? 0 : 1 - Math.max(0, Math.min(1, daylightIn == null ? 1 : daylightIn));
    if (night > 0) {
      dimA = dimA + (NIGHT_DIM_A - dimA) * night;
      dimColour = scaleColour(dimColour, 1 - (1 - NIGHT_TINT_KEEP) * night);
    }
    const farA = 1 - (1 - dimA) * (1 - FALLOFF_A);
    const floor0 = mixToWhite(dimColour, farA);
    // The night floor's luminance is the old expression exactly (atLuminance
    // reaches a target under the colour's own by scaling); noon lifts it to
    // AMBIENT_DAY_LUM, and the sun blends between the two.
    const nightLum = AMBIENT_K * lum(floor0);
    const targetLum = depth > 0 ? nightLum
      : nightLum + (AMBIENT_DAY_LUM - nightLum) * (1 - night);
    const ambient = atLuminance(floor0, targetLum);
    const edge = (1 - dimA) * FALLOFF_A * PLAYER_OUTPUT_K;
    const lit = Math.max(0, (1 - litDim(depth)) - (1 - farA)) * PLATEAU_OUTPUT_K;
    const litColour = lowEnergy(scene) ? mixToWhite(LOW_ENERGY_TINT, LOW_ENERGY_A) : 0xffffff;
    return { depth, dimA, dimColour, farA, ambient, edge, lit, litColour, night };
  }

  // The player cookie's alpha at ramp position t (0 at the plateau edge, 1 at
  // the viewport corner): the old falloff, re-expressed as light.
  function playerCookieAlpha(t, prof) {
    if (t <= 0) return prof.edge;
    if (t >= 1) return 0;
    return prof.edge * (1 - Math.pow(t, FALLOFF_P));
  }

  // The plateau's own falloff: how much of the lit level the player's lamp
  // has given up by the reach rim. A little — the rim of the reach area is
  // a touch darker than the feet, so the lit area reads as light thrown from
  // the body — and quadratic in the distance, so the middle stays flat and
  // the easing gathers at the edge. It is a fraction of `lit` (the derived
  // level), not a fixed alpha, so it scales with the depth's bubble; the
  // step down to `edge` at the staircase stays larger than this fall at
  // every depth and hour (lighting.test.js pins it), because that step is
  // the affordance and this is only shading.
  const PLATEAU_FALL = 0.18;
  const PLATEAU_STOPS = 6;

  // The plateau's total light (ramp + cell fill) at t = distance / rim,
  // 0 at the feet, 1 at the reach rim; clamped flat past it.
  function plateauLevel(prof, t) {
    const u = Math.max(0, Math.min(1, t));
    return prof.lit * (1 - PLATEAU_FALL * u * u);
  }

  // ── Collecting the frame's lights ────────────────────────────────────────
  // Positions are metres from the CAMERA ANCHOR, exactly as drawObjects
  // measures its sprites (dx, dy) — a light is a world-drawn thing, so it
  // goes through the anchor and slides with a peek (see the camera rule in
  // CLAUDE.md). The cull is halfM + the light's own radius, NOT the sprite
  // cull: a fire whose anchor is a cell off-screen still lights the edge.
  function sourceKind(scene, o) {
    if (!o) return null;
    if (o.kind === 'player') return playerKind(scene);
    if (o.kind === 'house') {
      if (scene.save && scene.save.starterShopId && scene.save.starterShopId === o.id) return 'trailer';
      return (scene.isClaimedKey && scene.isClaimedKey(o.id)) ? 'building' : null;
    }
    if (o.kind === 'tower') {
      return (scene.isClaimedKey && scene.isClaimedKey(o.castle)) ? 'building' : null;
    }
    if (o.kind === '_fire') return 'fire';
    if (o.kind === 'torch') return 'torch';
    // A wildplant has no `kind` — it is offered as itself from drawObjects'
    // wildplant scan, and only the mushroom is a light.
    if (o.kind === undefined && o.crop) return o.crop === 'mushroom' ? 'mushroom' : null;
    // Opened chests are the CALLER's to drop (drawObjects already builds the
    // per-frame Set of save.opened it culls the sprite with).
    if (o.kind === 'chest') return o.crate ? null : 'poi';
    return null;
  }

  // Which row the player lights as this frame. The ramp is always drawn
  // (the player's own light); 'handtorch' is the row the collector ADDS on top
  // of it while app.js's Torch timer runs (scene.isTorchActive — in memory,
  // never on the save, like the dragon's minute).
  function playerKind(scene) {
    return (scene && typeof scene.isTorchActive === 'function' && scene.isTorchActive()) ? 'handtorch' : 'player';
  }

  function beginFrame(scene) {
    if (!scene._lights) scene._lights = [];
    scene._lights.length = 0;
  }

  // THERE ARE NO CELL LIGHTS. A second list used to run beside the object one,
  // carrying a small violet pool per lit cobble offered by drawCells. The
  // cobbles are gone (a street is restored as arclength along the way now, not
  // as a lit pebble per cell) and so is that list: a restored street is DRAWN
  // clean by road_overlay.js and needs no light of its own. If a cell ever
  // wants a light again, note why the list was separate — drawCells runs
  // BEFORE drawObjects, and beginFrame empties the object list at the top of
  // the latter.

  // ── BLASTS: transient lights on their own clock ──────────────────────────
  // A restoration moment — a street stretch rebuilt, a wreck restored — throws a
  // wide near-white flash that swells as it fades. It is fired ONCE, at the
  // instant the thing happens, and then lives on scene._blasts until it
  // burns out; every frame collectBlasts converts it against that frame's
  // camera anchor, so a peek drag keeps the flash on the ground it went off
  // on (the camera rule in CLAUDE.md), and drops it when its time is up.
  //
  // Its curve is the old per-cobble flash's, unchanged: alpha (1-t)², scale
  // from FLASH_SCALE_FROM to 1 across the duration — and its defaults are that
  // flash's numbers exactly (2.5 cells, 900 ms), so a restored stretch flashes
  // as a lighting stone always did while a building can ask for six. The
  // 900 ms is also the window app.js runs its white SHINE down a stretch for,
  // so the flash and the shine end together.
  const FLASH_SCALE_FROM = 0.45;
  const BLAST_RADIUS_CELLS = 2.5;
  const BLAST_MS = 900;
  // A hard ceiling on the live list. Blasts are one-shot and short, so this
  // is only a guard against a bug firing them in a loop.
  const BLAST_MAX = 24;

  // Fire a blast at ABSOLUTE world metres (wmx, wmy). `opts`: radiusCells,
  // colour, durationMs, and `t0` for a test's own clock. Returns the entry.
  function blast(scene, wmx, wmy, opts) {
    if (!scene || !Number.isFinite(wmx) || !Number.isFinite(wmy)) return null;
    const o = opts || {};
    const list = scene._blasts || (scene._blasts = []);
    const e = {
      wmx, wmy,
      t0: (o.t0 == null ? Date.now() : o.t0),
      radiusCells: (o.radiusCells > 0) ? o.radiusCells : BLAST_RADIUS_CELLS,
      colour: (o.colour == null) ? KINDS.blast.colour : o.colour,
      durationMs: (o.durationMs > 0) ? o.durationMs : BLAST_MS,
    };
    list.push(e);
    if (list.length > BLAST_MAX) list.splice(0, list.length - BLAST_MAX);
    return e;
  }

  // The live blasts, as lights on this frame's list — and the pruning pass
  // for the dead ones. Compacted in place (never a splice per rejection): a
  // blast that has burned out is dropped, one still burning but off-screen is
  // KEPT on the list and merely not stamped, so walking back does not resume
  // a flash that should have ended. Cull is halfM + the entry's OWN radius,
  // like every other source.
  function collectBlasts(scene, ax, ay, halfM, now) {
    const list = scene._blasts;
    if (!list || !list.length) return 0;
    if (!scene._lights) scene._lights = [];
    const t0 = (now == null) ? Date.now() : now;
    let kept = 0, w = 0;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const t = (t0 - b.t0) / b.durationMs;
      if (!(t < 1)) continue;                       // burned out — pruned
      list[w++] = b;
      const dx = b.wmx - ax, dy = b.wmy - ay;
      const pad = b.radiusCells * scene.cellM;
      if (Math.abs(dx) > halfM + pad || Math.abs(dy) > halfM + pad) continue;
      const u = Math.max(0, t);
      scene._lights.push({
        kind: 'blast', dx, dy, id: `blast_${b.t0}_${i}`,
        r: b.radiusCells, colour: b.colour,
        a: (1 - u) * (1 - u), s: FLASH_SCALE_FROM + (1 - FLASH_SCALE_FROM) * u,
      });
      kept++;
    }
    list.length = w;
    return kept;
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

  // The player's light beyond the ramp: the torch cookie, at the feet (metres
  // from the camera anchor, like every light — it slides with a peek), while
  // one burns. Returns the row the player lit as. The plain 'player' row
  // pushes nothing: the ramp IS that light, and a cookie on top of it would
  // brighten the surface picture the profile derivation pins.
  const PLAYER_OBJ = { kind: 'player', id: 'player' };
  function collectPlayer(scene, ax, ay, halfM) {
    const kind = sourceKind(scene, PLAYER_OBJ);
    if (kind === 'player') return kind;
    const dx = scene.startWorldM.x + scene.playerM.x - ax;
    const dy = scene.startWorldM.y + scene.playerM.y - ay;
    if (inRange(scene, dx, dy, kind, halfM)) scene._lights.push({ kind, dx, dy, id: PLAYER_OBJ.id });
    return kind;
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
  //
  // A BLAST overrides both per entry (its own radius and colour), so those
  // bake their own cookie under their own key. The radius is quantised to a
  // quarter-cell first — a building's half-diagonal is a continuous number
  // and one cookie per distinct float would grow the store forever, while a
  // quarter cell is a few px on a light hundreds across.
  const COOKIE_R_STEP = 4;
  function ensureKindCookie(scene, kind, rCells, colour) {
    const store = scene._lightCookies || (scene._lightCookies = {});
    const row = KINDS[kind];
    const custom = (rCells != null) || (colour != null);
    const r = (rCells == null) ? radiusCells(kind)
                               : Math.max(0.25, Math.round(rCells * COOKIE_R_STEP) / COOKIE_R_STEP);
    const col = (colour == null) ? row.colour : colour;
    const key = custom ? `${kind}@${r}@${col}` : kind;
    if (store[key]) return store[key];
    const cellPx = (typeof CELL_PX !== 'undefined') ? CELL_PX : 32;
    const R = Math.ceil(r * cellPx);
    const S = 2 * R;
    const canvas = makeCanvas(S);
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(R, R, 0, R, R, R);
    for (let i = 0; i <= KIND_STOPS; i++) {
      const t = i / KIND_STOPS;
      g.addColorStop(t, rgba(col, row.peak * (1 - t) * (1 - t)));
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    store[key] = { canvas, R };
    return store[key];
  }

  // The player's RAMP: flat at `edge` out to the reach radius, then the
  // falloff to zero PLAYER_RAMP_PAST_CORNER_CELLS beyond the viewport's
  // half-diagonal. It used to land on zero exactly at the corner, which put
  // the far field of the frame at the ambient floor with nothing of the
  // player's light left in it; one cell past keeps the corners just lit,
  // and the ramp still ends on zero so a peek finds no edge past it (the
  // ambient beyond is the value it lands on). The PLATEAU is not in here: it
  // is painted per reach cell in draw(), so the sharp edge of the lit area is
  // the same staircase the tap gate accepts (cellInReach), not a circle
  // near it.
  // Rebaked only when its inputs move: the reach radius (energy / depth /
  // Potion of Reach) and the depth's levels.
  //
  // Baked at HALF resolution and drawn at scale 2: it is a smooth gradient,
  // so nothing is lost and the canvas is a quarter the bytes.
  const RAMP_STOPS = 16;
  const PLAYER_COOKIE_SCALE = 2;
  const PLAYER_RAMP_PAST_CORNER_CELLS = 1;

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
    const white = KINDS.player.colour;
    g.addColorStop(0, rgba(white, prof.edge));
    // The ramp starts at r0 with `edge` and lands on 0 at rMax. Sample the
    // super-linear curve at RAMP_STOPS points so the gradient's linear
    // segments track it.
    const span = rMaxT - r0T;
    for (let i = 0; i <= RAMP_STOPS; i++) {
      const t = i / RAMP_STOPS;
      g.addColorStop(fr(r0T + t * span), rgba(white, playerCookieAlpha(t, prof)));
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return st;
  }

  // The colour the reach cells are filled with, at alpha (level - edge), so
  // that on top of the ramp's flat `edge` of white they land on exactly
  // level × litColour per channel — the plateau level, pink when tired.
  // `level` defaults to the full lit level (the feet); the gradient in draw()
  // asks for each stop's plateauLevel.
  function plateauCellColour(prof, level) {
    const L = level == null ? prof.lit : level;
    const f = L - prof.edge;
    if (f <= 0) return 0xffffff;
    const ch = (sh) => {
      const target = L * (((prof.litColour >> sh) & 255) / 255);
      return Math.round(255 * Math.max(0, Math.min(1, (target - prof.edge) / f)));
    };
    return (ch(16) << 16) | (ch(8) << 8) | ch(0);
  }

  // The plateau's fill: a radial gradient about the feet, each stop the
  // cell colour at that stop's level. The rim is the furthest a reach cell's
  // corner can sit from the reach radius (half a cell's diagonal), so the
  // darkest of the plateau is its true extremity; past it the last stop
  // continues flat. Clipped by the per-cell path, so the staircase is exact.
  function plateauFill(ctx, prof, cx, cy, r0) {
    const rim = r0 + CELL_PX * Math.SQRT1_2;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rim);
    for (let i = 0; i <= PLATEAU_STOPS; i++) {
      const t = i / PLATEAU_STOPS;
      const level = plateauLevel(prof, t);
      g.addColorStop(t, rgba(plateauCellColour(prof, level), level - prof.edge));
    }
    return g;
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

  // One reach cell's contribution to the plateau path, at screen px (sx, sy)
  // with the cell's edge exposure (top/bot/lft/rgt: that neighbour is out of
  // reach) and its diagonals' reach (dTL..dBR). The cell's outline is walked
  // clockwise from the top edge's midpoint; an OUTER corner (ReachCorner.convex)
  // is rounded with arcTo — the arc tangent to both edges R in from the
  // corner — and an INNER corner (ReachCorner.fillet) gets the sliver between
  // the corner point and that same arc, drawn in the empty cell above/below,
  // as its own subpath. Corner geometry comes from coords.js' ReachCorner, the
  // rule the white outline (render.js) rounded by until it was removed; with
  // no rule loaded the cell is a plain square.
  function plateauCellPath(ctx, sx, sy, top, bot, lft, rgt, dTL, dTR, dBL, dBR) {
    const RC = (typeof ReachCorner !== 'undefined') ? ReachCorner : null;
    if (!RC) { ctx.rect(sx, sy, CELL_PX, CELL_PX); return; }
    const R = RC.R;
    const x1 = sx + CELL_PX, y1 = sy + CELL_PX;
    ctx.moveTo(sx + CELL_PX / 2, sy);
    if (RC.convex(rgt, top)) ctx.arcTo(x1, sy, x1, y1, R); else ctx.lineTo(x1, sy);
    if (RC.convex(rgt, bot)) ctx.arcTo(x1, y1, sx, y1, R); else ctx.lineTo(x1, y1);
    if (RC.convex(lft, bot)) ctx.arcTo(sx, y1, sx, sy, R); else ctx.lineTo(sx, y1);
    if (RC.convex(lft, top)) ctx.arcTo(sx, sy, x1, sy, R); else ctx.lineTo(sx, sy);
    ctx.closePath();
    if (RC.fillet(lft, top, dTL)) filletPath(ctx, sx, sy, +1, -1, R);
    if (RC.fillet(rgt, top, dTR)) filletPath(ctx, x1, sy, -1, -1, R);
    if (RC.fillet(lft, bot, dBL)) filletPath(ctx, sx, y1, +1, +1, R);
    if (RC.fillet(rgt, bot, dBR)) filletPath(ctx, x1, y1, -1, +1, R);
  }
  // The fillet at corner point (px, py): ix runs along the owning cell's
  // horizontal edge, iy into the empty cell. The arc is tangent to that edge
  // R along it and to the diagonal cell's vertical edge R up/down it, so the
  // sliver between the corner and the arc is exactly the notch the bare
  // staircase would otherwise cut out of the lit area.
  function filletPath(ctx, px, py, ix, iy, R) {
    ctx.moveTo(px, py);
    ctx.lineTo(px + ix * R, py);
    ctx.arcTo(px, py, px, py + iy * R, R);
    ctx.closePath();
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
    collectPlayer(scene, ax, ay, halfM);
    const now = Date.now();
    // The live blasts, converted against THIS frame's anchor (they are stored
    // in world metres) and pruned as they burn out.
    collectBlasts(scene, ax, ay, halfM, now);
    const prof = profile(scene, daylight(scene, now));
    const k = CELL_PX / scene.cellM;                 // metres → screen px
    // The ramp's extent: the player row's radius — the viewport's half-
    // diagonal plus PLAYER_RAMP_PAST_CORNER_CELLS, so the corners stay lit.
    const rMax = radiusCells('player') * CELL_PX;
    const reachM = (typeof reachRadiusM === 'function') ? reachRadiusM(scene) : 0;
    const r0 = Math.max(0, reachM * k);
    const player = ensurePlayerCookie(scene, prof, r0, rMax);
    const ps = scene.playerScreen ? scene.playerScreen() : { x: scene.viewCenterX, y: scene.viewCenterY };
    const ox = scene.viewLeft, oy = scene.viewTop;   // lightmap-local origin
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

    // The plateau: every cell in reach, by the SAME test the tap gate uses —
    // cellInReach's expressions, hoisted once per frame the way drawCells
    // hoists its own (reachRadiusM and playerReachCell are constant for the
    // frame; 169 calls of the allocating helper is churn for nothing). This
    // edge is the affordance now, so it has to be exactly that test.
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
      // The neighbour probe for the corner rounding — the same test again, so
      // a corner is rounded by exactly the cells the loop below lights.
      const inReach = (c, r) => {
        const ddx = (baseCellIX + (c - half) - rp.cellIX) * scene.cellM;
        const ddy = (baseCellIY + (r - half) - rp.cellIY) * scene.cellM;
        return ddx * ddx + ddy * ddy <= reachM2;
      };
      ctx.fillStyle = plateauFill(ctx, prof, ps.x - ox, ps.y - oy, r0);
      // ONE path, ONE fill: the cells abut on integer px so the union fills
      // seamlessly, and under 'lighter' a single fill adds the plateau once
      // (a fillet a second cell repeated would not double up either).
      ctx.beginPath();
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
          plateauCellPath(ctx, sx, sy,
            !inReach(col, row - 1), !inReach(col, row + 1), !inReach(col - 1, row), !inReach(col + 1, row),
            inReach(col - 1, row - 1), inReach(col + 1, row - 1), inReach(col - 1, row + 1), inReach(col + 1, row + 1));
        }
      }
      ctx.fill();
    }

    // The lights: the objects' — drawObjects' scan, plus the fires and the
    // blasts. A light may carry its own alpha / scale multipliers (`a`, `s` — a blast drives both off its own
    // clock) on top of the row's flicker, and its own radius / colour (`r`,
    // `colour` — a blast is sized to the thing it went off on).
    const stamp = (L) => {
      const row = KINDS[L.kind];
      const ck = ensureKindCookie(scene, L.kind, L.r, L.colour);
      const a = flickerAlpha(row, L.dx, L.dy, now, L.id) * (L.a == null ? 1 : L.a);
      const sc = (row.flicker ? 1 + (a - (1 - row.flicker / 2)) * 0.15 : 1) * (L.s == null ? 1 : L.s);
      const d = 2 * ck.R * sc;
      ctx.globalAlpha = Math.max(0, Math.min(1, a));
      ctx.drawImage(ck.canvas,
        scene.viewCenterX + L.dx * k - ox - d / 2,
        scene.viewCenterY + L.dy * k - oy - d / 2, d, d);
    };
    for (const L of scene._lights) stamp(L);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    tex.refresh();
  }

  window.Lighting = {
    KINDS, radiusCells, TORCH_RADIUS_MUL, FALLOFF_A, FALLOFF_P, AMBIENT_K, AMBIENT_DAY_LUM, PLAYER_OUTPUT_K, PLATEAU_OUTPUT_K, litDim, POI_PULSE_PERIOD_S,
    NIGHT_DIM_A, NIGHT_TINT_KEEP, DAY_ELEV_DEG, NIGHT_ELEV_DEG,
    sunElevationDeg, daylightFromElevation, daylight,
    LOW_ENERGY_TINT, LOW_ENERGY_A, LOW_ENERGY_FRAC, mixToWhite, scaleColour, lum, atLuminance,
    PLATEAU_FALL, plateauLevel, PLAYER_RAMP_PAST_CORNER_CELLS,
    profile, playerCookieAlpha, plateauCellColour, sourceKind, playerKind, beginFrame, consider, collectFires,
    collectPlayer,
    blast, collectBlasts, BLAST_RADIUS_CELLS, BLAST_MS, BLAST_MAX, FLASH_SCALE_FROM,
    flickerAlpha, plateauCellPath, draw,
  };
})(window);
