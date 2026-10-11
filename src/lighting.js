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
//   Lighting.collectMagicTraps(scene, ax, ay, halfM) — add the set magic traps
//   Lighting.collectLamps(scene, ax, ay, halfM) — add the restored streets' lamps
//   Lighting.collectPlayer(scene, ax, ay, halfM, now?) — add the player's torch, if lit
//   Lighting.TORCH_RADIUS_MUL     — the torch's radius, in player radii
//   Lighting.profile(scene, daylight) — ambient / lit / edge levels at this depth
//   Lighting.lowEnergyFrac(scene) — 0..1, how far into the low-energy warning
//                                   the player is; also read by app.js's
//                                   _playDirected to pace the tired walk cycle
//   Lighting.daylight(scene, now) — 0..1 from the real sun at the player
//   Lighting.playerCookieAlpha(t, prof) — the player ramp, sampled
//   Lighting.plateauLevel(prof, t)  — the plateau's light at t of the way to the rim
//   Lighting.plateauCellPath(ctx, sx, sy, …) — one reach cell's rounded plateau path
//   Lighting.draw(scene)          — paint the lightmap (Phaser)
//
// ── The model ─────────────────────────────────────────────────────────────
// Lighting paints LIGHT, not darkness: darkness only ever composes one way
// (two overlapping dims make the ground between them darker), so a second
// light source cannot be built from it. (The screen-edge vignette in app.js
// create() is not lighting: it frames the window.)
//
// So the lightmap is LIGHT, added up, then multiplied over the world:
//
//   lightmap = ambient + Σ cookie_i          (ADD, clamped to white)
//   world'   = world × lightmap              (MULTIPLY)
//
// The ambient is the far-field darkness. Every source draws one baked radial-gradient
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
// accepts once its brief cell-change crossfade settles. Only the falloff
// outside it is a circle. That edge is the WHOLE
// affordance (no outline is stroked over it; if the boundary stops reading,
// widen the step at its edge). Inside the staircase the plateau is the
// player's own lamp, full at the feet and easing down PLATEAU_FALL of the way
// by the reach rim (plateauLevel), so the lit area reads as light thrown
// from the body, with the step down at its edge still the biggest thing in
// the picture.
//
// ── The numbers are DERIVED, not tuned ────────────────────────────────────
// profile() derives the white channel from Render.reachDimAlpha /
// reachDimColor plus the falloff pair (FALLOFF_A, FALLOFF_P).
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
  // own light, out to TORCH_RADIUS_MUL player radii.
  //
  // THE SUN OUTSHINES IT. On the surface the cookie's strength follows the
  // daylight (torchStrength): full by night, down to TORCH_DAY_FLOOR at full
  // day. At full strength under a noon ambient the white add lifted the
  // out-of-reach ground up to the plateau's level, and the edge step that
  // IS the reach affordance vanished. Underground there is no sun, so a
  // torch always burns at full strength.
  const TORCH_RADIUS_MUL = CONSUMABLE_SPEC.torch.radiusMul;
  const TORCH_DAY_FLOOR = 0.15;
  function torchStrength(depth, day) {
    if ((depth ?? 0) > 0) return 1;
    const d = clamp01(day == null ? 1 : day);
    return TORCH_DAY_FLOOR + (1 - TORCH_DAY_FLOOR) * (1 - d);
  }

  // The street lamp's own ink (util.js UI_LAMP_GLOW) as a number, with the
  // same literal fallback the other reader (road_overlay.js's baked stone)
  // carries so this module still loads standalone. Deliberately NOT the
  // street's own UI_STREET_INK: the carriageway restores in pale warm stone,
  // but a lamp reads as ACTIVATED — the old lit-pebble violet, kept for the
  // lamp specifically so the stone and the light it throws can't drift apart.
  const LAMP_GLOW = (typeof UI_LAMP_GLOW === 'string')
    ? parseInt(UI_LAMP_GLOW.replace('#', ''), 16) : 0x9a8cff;

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
    temple:   { radiusCells: 4, colour: 0x65dfff, peak: 0.95, flicker: 0.035 },
    // A placed campfire (burned from a coal). Breathes.
    ground_fire: { radiusCells: 1.5, colour: 0xff852b, peak: 0.75, flicker: 0.12 },
    fire:     { radiusCells: () => (typeof FIRE_REST_R !== 'undefined' ? FIRE_REST_R : 3),
                colour: 0xff9a3c, peak: 1.00, flicker: 0.18 },
    // A live POI — a chest with something still in it (loose supply crates
    // are excluded for the reason they get no pad: a transient pickup is not
    // a place). Places read as places from across the map without shouting: a
    // small treasure blue-white light that breathes
    // SLOWLY (POI_PULSE_PERIOD_S — anything brisk turns a street of POIs into
    // a strobe), each on its own phase hashed from its id so a street doesn't
    // throb in lockstep. Small, so it marks the place rather than lighting
    // the block.
    poi:      { radiusCells: 2.0, colour: 0xcfe2ff, peak: 0.88, flicker: 0, pulse: 0.5 },
    // A MAGIC TRAP the player has set (save.magicTraps, traps.js MAGIC TRAP):
    // a magenta glowing region on its cell, breathing on the POI's slow beat
    // (`pulse`, POI_PULSE_PERIOD_S, phased by its id) because it is the same
    // kind of mark — a place the player should be able to find again from
    // across the screen. Smaller than the POI's 2 cells: it marks ONE cell
    // and the ring of cells a foe crosses to reach it, not a building.
    magic_trap: { radiusCells: 1.5, colour: 0xff3cdc, peak: 0.90, flicker: 0, pulse: 0.5 },
    // A cave torch (worldgen.js caveTorchesFrom — planted where a lowtier
    // street-furniture POI stands overhead, the one chest class that does not
    // mirror underground). A real flame: warm, a little smaller than a
    // campfire, and it breathes like one. Bright enough to read a cave
    // junction by from across the level.
    // The terrain supplies the lava art; its marker supplies a local ember glow.
    lava_vent: { radiusCells: 1.5, colour: 0xff702a, peak: 0.7, flicker: 0.18 },
    torch:    { radiusCells: 2.5, colour: 0xffa54a, peak: 1.00, flicker: 0.22 },
    // A wild mushroom — the faint one. Every `mushroom` wildplant glows, on
    // the surface as well as in the caves (where spawnCaveMushrooms scatters
    // the blue luminous kind): a cool, small, slow-breathing light that marks
    // a forage spot in the dark without lighting anything around it. The
    // torch/mushroom pair is deliberately far apart in both radius and peak
    // — lighting.test.js pins the order — so a lit cave reads as "a torch
    // there, some fungus here", never two of the same lamp.
    mushroom: { radiusCells: 1.25, colour: 0x9fdcff, peak: 0.50, flicker: 0, pulse: 0.35 },
    // A GROVE SHRINE (src/zones.js — the one standing prop at a park's heart):
    // a pale green light breathing on the POI's slow beat, far wider than a
    // POI's. It is a COLLECTED light, so it burns ghosts through the same
    // brightnessAt every lamp and fire does — a refuge at night with no ward
    // code of its own. It is NOT a rest ring and turns no foe away. Six
    // cells (owner's call, Sep 2026): the grove's heart lights the park round
    // it, not just the stone — twice a restored house's reach.
    shrine:   { radiusCells: 6.0, colour: 0xc8f5a0, peak: 0.90, flicker: 0, pulse: 0.4 },
    // A VIEWPOINT's scope (src/scenic.js — the one standing piece at a
    // vista): a warm, steady lamp out to FIRE_REST_R — the ring its bench
    // rests the player on (app.js update(), the campfire's rest with a new
    // reason), so "stand in the light" is "sit and rest" here too. Unlike the
    // fire it wards nothing: it is a place to sit, not a hearth. Its daily
    // gift wears the POI light on top while it is there (poiLit).
    vista:    { radiusCells: () => (typeof FIRE_REST_R !== 'undefined' ? FIRE_REST_R : 3),
                colour: 0xffe2a8, peak: 0.80, flicker: 0 },
    // A STREET LAMP — the gilded lamp a RESTORED street stands, one every
    // Streets.lampSpacingM() metres of rebuilt carriageway (streets.js places
    // them, road_overlay.js paints the lamp, app.js hands this collector the
    // live list). The lamp's point is its FOOT (see LAMP_GROUND_FRAC) and the
    // cookie is LIFTED off it to the lantern, where the burning is (see
    // collectLamps). It is the whole point of rebuilding a street after dark: a
    // road you have brought back is a road you can walk at night, and the
    // string of lamps behind you is the map of everything you have restored.
    //
    // In UI_LAMP_GLOW, the violet of the lit pebbles (see its note in util.js). The
    // carriageway itself still restores in its own
    // pale warm stone (UI_STREET_INK — the chips, the sparks, the counter,
    // the dwell preview); the lamp is the one thing on a restored street that
    // reads as ACTIVATED rather than as repaired, so it keeps the old
    // activated-cobble colour instead.
    //
    // STEADY — no flicker, no pulse. A fire breathes because it is burning
    // and a POI breathes because it is asking to be noticed; a lamp is
    // infrastructure, and a street of them breathing would be a strobe.
    // Sized between the POI and the campfire: bigger than a marker, smaller
    // than a hearth, so a lamp lights the carriageway it stands on and a
    // couple of cells either side of it rather than the whole block.
    cobble:   { radiusCells: 2.5, colour: LAMP_GLOW, peak: 0.85, flicker: 0 },
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
    // A SHINY — a rare gold tree, wild plant or animal (util.js SHINY_RATE;
    // an elite monster wears the same flag). A gold multiply tint is a no-op under
    // the Canvas fallback and reads as olive over green art, so the shiny
    // GLOWS: a small pale-gold pool on its cell, breathing on the POI's slow
    // beat (`pulse`, phased by its id) because it is the same kind of mark —
    // a thing worth walking over to, findable from across the screen. What it
    // is NOT: a POI (blue-white, a place with loot in it) or a fire (orange,
    // warmth). Pale gold keeps it apart from both, and from Home's amber.
    // Offered by drawObjects off the same shiny test its sprite reads, so a
    // chopped shiny tree (no sprite) throws no light either.
    shiny:    { radiusCells: 1.5, colour: 0xfff0a0, peak: 0.85, flicker: 0, pulse: 0.45 },
    // A STAFF BOLT in flight (Combat.SHOT.staff — the seeking, piercing magic
    // shot). The bolt is a light: it lights the ground it crosses and the foe
    // it passes through, which is most of what makes it read as magic rather
    // than as a thrown dot. In the bolt's own colour; a quick crackle
    // (`flicker`) because it is live energy, not a lamp. Collected from
    // scene._shots (collectBolts) — a list, like the lamps — and lifted to
    // the height the bolt is DRAWN at (SHOT_DRAW_LIFT_PX) as a draw-space
    // `dyPx`, so the glow sits on the orb, not on the ground under it.
    bolt:     { radiusCells: 1.5, colour: 0x9ad6ff, peak: 0.95, flicker: 0.14 },
  };
  // Treasure trunks from T3 upward cast the same colour as their rarity badge.
  // The ordinary POI row owns their radius, strength and breathing cadence;
  // ABOVE T3 the glow DOUBLES (Oct 2026) - the high tiers read at a glance
  // through the light alone - and the underground tiers (T6 from cave level
  // 3, T7 from 6) keep the same doubling off their own badge colours.
  for (let tier = 3; tier <= chestTierMaxFor(9); tier++) {
    const bright = tier > 3 ? { radiusCells: KINDS.poi.radiusCells * 2, peak: Math.min(1, (KINDS.poi.peak ?? 0.5) * 2) } : {};
    KINDS['chest_' + tier] = { ...KINDS.poi, colour: CHEST_TIER_COLOR[tier], ...bright };
  }
  // The shrine kinds (src/shrines.js): the grove shrine's own light in each
  // kind's colour — one row per kind, `shrine_<id>` (sourceKind).
  if (window.Shrines) {
    for (const id of window.Shrines.KIND_IDS) {
      KINDS['shrine_' + id] = { ...KINDS.shrine, colour: window.Shrines.SHRINE_KINDS[id].light };
    }
  }
  // Daily visit sites keep their own light after today's reward is claimed.
  // Their separate POI pulse still means "available today".
  const VISIT_LIGHT_KINDS = new Map();
  for (const [id, row] of Object.entries(window.Shrines?.REWARD_KINDS || {})) {
    const key = id === 'grove' ? 'shrine' : 'shrine_' + id;
    KINDS[key] = { ...KINDS.shrine, colour: row.light };
    VISIT_LIGHT_KINDS.set(row, key);
  }
  for (const [id, row] of Object.entries(window.Macros?.DAILY_VISIT_KINDS || {})) {
    const key = 'visit_' + id;
    KINDS[key] = { ...KINDS.shrine, colour: row.light };
    VISIT_LIGHT_KINDS.set(row, key);
  }

  // Seconds per POI breath. Slow on purpose (see the row above).
  const POI_PULSE_PERIOD_S = 4.5;
  // The breath's OWN clock: PULSE_STEPS stills per breath (150 ms), where a
  // flicker needs the light clock's 100 ms. A breath is a slow sine, so its
  // steepest still-to-still change is pulse · π / PULSE_STEPS of the row's
  // peak (~5% for a POI) — under what a glow seconds long reads as stepping
  // — and a view whose only moving lights breathe (a live POI, a shiny, a
  // mushroom, a shrine: the common still view in a town) repaints a third
  // less often than on the flicker's clock. It divides the period exactly, so
  // one breath later a light is where it was. Its own grid on the WALL clock
  // (draw() reads both), not a multiple of the light clock's — 150 on a
  // 100 ms grid would step at uneven 100 / 200 ms gaps.
  const PULSE_STEPS = 30;
  const PULSE_TICK_MS = POI_PULSE_PERIOD_S * 1000 / PULSE_STEPS;
  function pulseClock(t) { return Math.floor(t / PULSE_TICK_MS) * PULSE_TICK_MS; }

  // app.js's VIEW_CELLS, read at call time like FIRE_REST_R (app.js loads
  // after this file); 11 is its shipping value, for a context without it.
  function viewCells() {
    return (typeof VIEW_CELLS !== 'undefined') ? VIEW_CELLS : 11;
  }

  function radiusCells(kind) {
    const r = KINDS[kind].radiusCells;
    return typeof r === 'function' ? r() : r;
  }

  // The falloff pair. 0.90 at
  // the viewport corner on a p=1.5 ramp — picked by measuring mean luminance
  // per radius band against the effect switched off, not by eye:
  //
  //   0-120px (reach bubble)  -0.2   i.e. noise — the affordance is untouched
  //   150-180px (mid-field)   -7.7
  //   210-240px (corners)    -17.2
  //
  // The super-linear ramp is what buys that spread: it holds the mid-field
  // near full readability while still gathering real depth at the rim. Retune the pair
  // together, never the alpha alone.
  const FALLOFF_A = 0.90;
  const FALLOFF_P = 1.5;

  // The CONTRAST knob: how much of the derived floor survives. The derivation
  // below lands the far field where the old wash + rings did (~15-19% on the
  // surface, biome-tinted), which read as too bright once real lights were
  // in the world. This
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
  // The NIGHT end's target is AMBIENT_K × the floor's own luminance, which
  // atLuminance reaches by scaling.
  const AMBIENT_K = 0.45;
  const AMBIENT_DAY_LUM = 0.40;

  // The PLAYER'S OWN OUTPUT knobs: how much of the reproduced-wash levels the
  // player's light actually throws. Neither touches the RADIUS it reaches
  // (radiusCells('player') and TORCH_RADIUS_MUL off it are unaffected, so a
  // dimmer player still lights exactly as far); 1.0 is the old picture
  // exactly, and lower is a dimmer light at the same reach.
  //
  // PLAYER_OUTPUT_K scales `edge` — the ramp OUTSIDE the reach area, and the
  // whole falloff hung off it. Kept low (0.4) so the placed lights (a
  // campfire, Home, a POI) tell against it and the reach step reads against a
  // darker mid-field.
  const PLAYER_OUTPUT_K = 0.4;

  // PLATEAU_OUTPUT_K scales `lit` — the reach area itself, the plateau the
  // per-cell mask ADDS over the ramp. It is a separate knob from
  // PLAYER_OUTPUT_K: dimming the mid-field to let the placed lights tell would
  // otherwise take the ground the player works on down with it. The two wants
  // are opposite, so they are two numbers —
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
    const d = ms / 86400000 - 10957.5;                       // days since J2000.0
    const g = deg2rad((357.529 + 0.98560028 * d) % 360);     // mean anomaly
    const q = (280.459 + 0.98564736 * d) % 360;              // mean longitude
    const L = deg2rad((q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) % 360);
    const e = deg2rad(23.439 - 0.00000036 * d);              // obliquity
    const RA = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
    const dec = Math.asin(Math.sin(e) * Math.sin(L));
    const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
    const H = deg2rad((gmst + lon / 15) * 15) - RA;          // hour angle
    const la = deg2rad(lat);
    const sinAlt = Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(H);
    return rad2deg(Math.asin(clamp(sinAlt, -1, 1)));
  }

  function daylightFromElevation(elevDeg) {
    const t = (elevDeg - NIGHT_ELEV_DEG) / (DAY_ELEV_DEG - NIGHT_ELEV_DEG);
    const u = clamp01(t);
    return u * u * (3 - 2 * u);
  }

  // The frame's daylight, 0..1. Recomputed once a minute (the sun moves a
  // quarter degree in that time); the player's position is read through the
  // projection coords.js owns. Noon when there is no fix to place the sun by.
  function daylight(scene, now) {
    if (typeof window !== 'undefined' && window.__DAYLIGHT != null) {
      return clamp01(+window.__DAYLIGHT);
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

  // Low energy tints the lit range red — the Inner Light guttering as the
  // player tires. Energy doesn't shrink reach (coords.js reachRadiusM — only
  // depth does), but this red is the cue to rest before energy hits 0, where
  // there is no reach at all. Skipped while a Potion of Reach pins the view
  // lit. A clean red, a warning colour,
  // not a mood. PROGRESSIVE now (lowEnergyFrac, below): at the LOW_ENERGY_FRAC
  // threshold it is not yet visible, and it deepens toward LOW_ENERGY_A only
  // as energy keeps draining past it, so the cue arrives as a gradual flush
  // rather than a switch flipped the instant the bar crosses 30%.
  const LOW_ENERGY_TINT = 0xff4d4d;
  const LOW_ENERGY_A = 0.30;
  const LOW_ENERGY_FRAC = 0.30;

  // Below this energy fraction the tint stops being a flat wash and starts
  // THROBBING — and every OTHER light joins in (criticalLights, below): the
  // whole map turns red and stutters on the heartbeat. A static red at 5%
  // energy reads no more urgent than the same static red at 18%, so the
  // second stage is an escalation of the SAME cue, not a separate one: it
  // only ever engages once lowEnergyFrac has already crossed a third of the
  // way to its own ceiling (frac 0.30 → 0.20 of the 0.30 → 0 band).
  const CRITICAL_ENERGY_FRAC = 0.20;
  const CRITICAL_W = 1 - CRITICAL_ENERGY_FRAC / LOW_ENERGY_FRAC; // 1/3

  // A hurried heartbeat: quicker than POI_PULSE_PERIOD_S's calm 4.5s
  // breathing, because this is an alarm, not ambience. Two decaying spikes a
  // period (lub, then a smaller dub) rather than a sine, so it reads as a
  // pulse — an EKG blip — instead of a wobble.
  const HEARTBEAT_PERIOD_MS = 850;
  const HEARTBEAT_AMPLITUDE = 0.6;

  // The heartbeat's shape at phase 0..1 of one period: a sharp near-instant
  // rise and an exponential fall, twice a period at two different
  // strengths — lub at phase 0, a smaller dub 30% of the way through.
  function heartbeatShape(phase) {
    const p = phase - Math.floor(phase);
    const lub = Math.exp(-p * 22);
    const dubPhase = p - 0.30;
    const dub = dubPhase >= 0 ? 0.55 * Math.exp(-dubPhase * 22) : 0;
    return Math.max(lub, dub);
  }

  // 1 at rest; rises toward 1 + HEARTBEAT_AMPLITUDE on each beat, once the
  // player is critically low (past CRITICAL_W) and `now` is a real clock
  // reading. `now == null` — profile() called with none, as every existing
  // derivation test does — means "don't animate": the ceiling alone, exactly
  // as before, so the pulse never disturbs a clock-free assertion.
  function heartbeatMul(w, now) {
    if (now == null || w < CRITICAL_W) return 1;
    const phase = (now % HEARTBEAT_PERIOD_MS) / HEARTBEAT_PERIOD_MS;
    return 1 + HEARTBEAT_AMPLITUDE * heartbeatShape(phase);
  }

  // Past CRITICAL_W every light source — fires, Home, lamps, POIs, bolts,
  // blasts — is pulled CRITICAL_LIGHT_MIX of the way to LOW_ENERGY_TINT and
  // STUTTERS: its strength dips by up to CRITICAL_LIGHT_DIP on each lub and
  // dub of the same heartbeat the player's own plateau throbs on, so the
  // world's light and the player's pulse beat together. One cue, one clock:
  // it reads lowEnergyFrac (so a Potion of Reach silences it too) and
  // heartbeatShape, never a second threshold. The tint is a FIXED mix, not
  // pulsed, because a light's colour keys a baked cookie
  // (ensureKindCookie) — a per-frame colour would bake one every tick;
  // the beat lives in the alpha instead. null when not critical.
  // `now == null` means "don't animate", as heartbeatMul.
  //
  // The lights also burn LOWER, not just redder: CRITICAL_LIGHT_DIM is a
  // steady cut the stutter dips further from. And the player's OWN light —
  // most of what there is to see in a cave — is pushed to at least
  // CRITICAL_PLAYER_TINT_A of the red (critPaintProfile), throbbing on the
  // beat: lowEnergyFrac's ramp alone puts only a tenth of the red on it at
  // 20%, which read as nothing underground.
  // PAINT ONLY, all of it: brightnessAt keeps the plain profile, so what a
  // ghost counts as light does not change when the player is hurt.
  const CRITICAL_LIGHT_MIX = 0.95;
  const CRITICAL_LIGHT_DIM = 0.6;
  const CRITICAL_LIGHT_DIP = 0.55;
  const CRITICAL_PLAYER_TINT_A = 0.6;
  function criticalLights(scene, now) {
    if (lowEnergyFrac(scene) < CRITICAL_W) return null;
    const beat = now == null ? 0
      : heartbeatShape((now % HEARTBEAT_PERIOD_MS) / HEARTBEAT_PERIOD_MS);
    return { mix: CRITICAL_LIGHT_MIX, a: CRITICAL_LIGHT_DIM * (1 - CRITICAL_LIGHT_DIP * beat) };
  }
  // The profile draw() paints with: `prof` itself, or — critically low — the
  // same with the plateau's red raised to CRITICAL_PLAYER_TINT_A at least, on
  // the heartbeat. Never handed to brightnessAt (see above).
  function critPaintProfile(scene, prof, crit, now) {
    if (!crit) return prof;
    const w = lowEnergyFrac(scene);
    const a = Math.max(LOW_ENERGY_A * w, CRITICAL_PLAYER_TINT_A) * heartbeatMul(w, now);
    return Object.assign({}, prof, { litColour: mixToWhite(LOW_ENERGY_TINT, Math.min(1, a)) });
  }
  // Colour maths is BiomeProfiles.mixHex, the one channel lerp every module
  // shares. `a` lerped `t` of the way to `b`, per channel:
  const mixColour = (a, b, t) => BiomeProfiles.mixHex(a, b, t);
  // White lerped `alpha` of the way to `colour` — the multiply tint that
  // stands in for painting `colour` at `alpha` over the ground.
  const mixToWhite = (colour, alpha) => BiomeProfiles.mixHex(0xffffff, colour, alpha);
  // `colour` scaled by `k`: the lerp from black.
  const scaleColour = (colour, k) => BiomeProfiles.mixHex(0x000000, colour, k);
  // Rec. 601 luminance of a colour, 0..1 — "how bright is this, to an eye".
  // (the util.js copy — `lum` stays the local/exported name, both here and on
  // window.Lighting, which lighting.test.js reads directly).
  const lum = luminance;
  // The same colour, put AT a luminance. Brightening mixes toward white (which
  // desaturates, and cannot overflow a channel); darkening scales, which keeps
  // the hue exactly — so a target below the colour's own luminance reproduces
  // scaleColour(colour, target / lum(colour)) precisely.
  function atLuminance(colour, target) {
    const t = clamp01(target);
    const l = lum(colour);
    if (l <= 0) return mixToWhite(0x000000, 1 - t);      // black floor → grey
    if (l >= t) return scaleColour(colour, t / l);
    return mixToWhite(colour, (1 - t) / (1 - l));
  }

  // How far into the low-energy warning the player is, 0..1: 0 at or above
  // LOW_ENERGY_FRAC of maxEnergy, ramping LINEARLY to 1 as the tank empties
  // out from there. The one number both readers of "how tired does this
  // look/feel" share — the reach tint's alpha here, and the walk cycle's
  // pace in app.js's _playDirected — so the two can't drift into disagreeing
  // about how far gone the player is. A Potion of Reach silences the whole
  // cue at once, tint and pace alike: pinning the view lit is the potion's
  // entire point.
  function lowEnergyFrac(scene) {
    const sv = (scene && scene.save) || {};
    const maxEnergy = sv.maxEnergy ?? 100;
    if (!(maxEnergy > 0)) return 0;
    if (Energy.fullViewReachActive(sv)) return 0;
    const frac = clamp01((sv.energy ?? 0) / maxEnergy);
    if (frac >= LOW_ENERGY_FRAC) return 0;
    return 1 - frac / LOW_ENERGY_FRAC;
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
  //   litColour  white, or the low-energy red — throbbing past CRITICAL_W
  //              when `nowIn` is a real clock reading
  //   night      1 - daylight on the surface, always 0 underground; moves
  //              dimA toward NIGHT_DIM_A and drains dimColour (see above)
  //
  // `daylight` defaults to noon so the derivation is pinned without a clock;
  // draw() passes the frame's real value.
  function profile(scene, daylightIn, nowIn) {
    const depth = scene.depth ?? 0;
    // This realm has no sun or cave darkness. Its violet sky lights the entire
    // square, while a small player glow still marks interaction reach. Keep
    // the arena sentinel out of the ordinary depth-based cave darkening.
    if (depth === WorldGen.ARENA_DEPTH) {
      return { depth, dimA: 0.18, dimColour: 0x8e75c0, farA: 0.18,
        ambient: 0xc3b6e6, edge: 0.02, lit: 0.08, litColour: 0xffffff, night: 0 };
    }
    // The sky floor is above the clouds: open daylight at every hour.
    if (depth === WorldGen.SKY_DEPTH) {
      return { depth, dimA: 0.12, dimColour: 0x9fc4e0, farA: 0.12,
        ambient: 0xf2f6fa, edge: 0.02, lit: 0.06, litColour: 0xffffff, night: 0 };
    }
    // render.js declares Render as a top-level const, so it is reachable by
    // bare name in every scope loaded after it (the browser and the node
    // bundle alike), never as a window property.
    const R = (typeof Render !== 'undefined') ? Render : null;
    let dimA = R ? R.reachDimAlpha(scene) : 0.38;
    let dimColour = R ? R.reachDimColor(scene) : 0x000000;
    const night = depth > 0 ? 0 : 1 - clamp01(daylightIn == null ? 1 : daylightIn);
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
    const lowEnergyW = lowEnergyFrac(scene);
    const pulse = heartbeatMul(lowEnergyW, nowIn == null ? null : nowIn);
    const litColour = lowEnergyW > 0
      ? mixToWhite(LOW_ENERGY_TINT, Math.min(1, LOW_ENERGY_A * lowEnergyW * pulse)) : 0xffffff;
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
    const u = clamp01(t);
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
    if (o.kind === 'temple') return window.Temples?.isActive(scene.save, o) ? 'temple' : null;
    if (o.kind === '_fire') return 'fire';
    if (o.kind === '_magic_trap') return 'magic_trap';
    if (o.kind === 'torch') return 'torch';
    const visit = window.Macros?.visitKindForObject(o);
    if (visit && VISIT_LIGHT_KINDS.has(visit)) return VISIT_LIGHT_KINDS.get(visit);
    if (o.kind === 'lava_vent') return 'lava_vent';
    // A grove's shrine (src/zones.js) — its own soft green row.
    if (o.kind === 'grove_shrine') return (o.shrineKind && KINDS['shrine_' + o.shrineKind]) ? 'shrine_' + o.shrineKind : 'shrine';
    // A viewpoint's scope (src/scenic.js) — its rest ring's steady light.
    if (o.kind === 'vista_scope') return 'vista';
    // A wild plant is offered as ITSELF from drawObjects' wildplant scan, and
    // which of them glows is items.js' WILDPLANT_RULES to say — the same table
    // the render-side gate asks, so a second glowing plant is one row and not
    // a second literal here.
    if (o.kind === 'wildplant') return wildplantLight(o.crop);
    // Opened chests (and a daily crate / chapel taken today) are the CALLER's
    // to drop: drawObjects asks interactables.js poiLit off the frame's sets.
    if (o.kind === 'chest') {
      if (o.crate) return null;
      const tier = chestTier(o);
      return chestLook(o).texKey === 'chest' && tier >= 3 ? 'chest_' + tier : 'poi';
    }
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

  // THERE ARE NO CELL LIGHTS: drawCells runs BEFORE drawObjects and beginFrame
  // empties the object list at the top of the latter, so a light pushed onto
  // scene._lights from the cell pass would be gone before draw() read it.
  // Street lamps are lit from a LIST instead
  // (collectLamps, below), collected inside draw() like the fires and the
  // blasts, so the ordering problem never arises: a lamp is a point in world
  // metres, not a cell being painted.

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
      if (!inViewBox(dx, dy, halfM + b.radiusCells * scene.cellM)) continue;
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

  // The widest light any SCANNED object can throw, in cells — the margin
  // drawObjects' chunk query pads the sprite cull by, so a lantern a chunk
  // past the viewport still reaches the edge it stands beyond. Every row but
  // the player's own two (viewport-sized, never scanned), so a new row widens
  // the query by itself rather than by a number retyped in render.js.
  function objectLightPadCells() {
    let m = 0;
    for (const k in KINDS) {
      if (k === 'player' || k === 'handtorch') continue;
      m = Math.max(m, radiusCells(k));
    }
    return m;
  }

  // The widest light a WILD PLANT throws, in cells — the pad drawObjects'
  // wildplant query adds to the sprite cull. Which plants glow, and as which
  // row, is items.js' WILDPLANT_RULES (`light`), so a new glowing plant widens
  // it by itself; without the table, the object pad (never too narrow).
  function wildplantLightPadCells() {
    if (typeof WILDPLANT_RULES === 'undefined') return objectLightPadCells();
    let m = 0;
    for (const k in WILDPLANT_RULES) {
      const kind = WILDPLANT_RULES[k] && WILDPLANT_RULES[k].light;
      if (kind && KINDS[kind]) m = Math.max(m, radiusCells(kind));
    }
    return m;
  }

  // The cull every source shares (coords.js inViewBox): the view box widened
  // by the row's own radius, so a light just past the rim still reaches it.
  function inRange(scene, dx, dy, kind, halfM) {
    return inViewBox(dx, dy, halfM + radiusCells(kind) * scene.cellM);
  }
  // The shape every placed-point collector shares: each item's world point
  // (`at(item)`, or the item itself) against the anchor, culled by inRange
  // for `kind`, and `make(item, dx, dy)` pushed as the frame's entry. Returns
  // how many were kept.
  function collectPoints(scene, items, ax, ay, halfM, kind, make, at) {
    let n = 0;
    for (const it of items) {
      const p = at ? at(it) : it;
      const dx = p.x - ax, dy = p.y - ay;
      if (!inRange(scene, dx, dy, kind, halfM)) continue;
      scene._lights.push(make(it, dx, dy));
      n++;
    }
    return n;
  }

  // Offer one scanned object. Returns true if it was kept as a light.
  function consider(scene, o, dx, dy, halfM) {
    const kind = sourceKind(scene, o);
    if (!kind || !inRange(scene, dx, dy, kind, halfM)) return false;
    scene._lights.push({ kind, dx, dy, id: o.id });
    return true;
  }

  // Offer a SHINY (the `shiny` row). Not through sourceKind: shiny is not a
  // kind of object but a flag any tree, wild plant or creature can carry, and
  // drawObjects already resolves it for each (the list its sprite pass builds)
  // — so the caller hands over the id it hashed and this only culls and keeps.
  function offerShiny(scene, id, dx, dy, halfM) {
    if (!inRange(scene, dx, dy, 'shiny', halfM)) return false;
    scene._lights.push({ kind: 'shiny', dx, dy, id: `shiny_${id}` });
    return true;
  }

  // Offer the POI light at a thing that is not a chest — a grove shrine whose
  // daily gift is still there (interactables.js poiLit, the one "something to
  // take here" reason). The same `poi` row every live chest wears, under its
  // own id so it sits beside the thing's own light (the shrine's green one).
  function offerPoi(scene, id, dx, dy, halfM) {
    if (!inRange(scene, dx, dy, 'poi', halfM)) return false;
    scene._lights.push({ kind: 'poi', dx, dy, id: `poi_${id}` });
    return true;
  }

  // The placed campfires on this depth, within light range of the view.
  function collectFires(scene, ax, ay, halfM) {
    const PF = window.PlacedFloor;
    const fires = scene.save && scene.save.fires;
    const now = Date.now(), depth = scene.depth ?? 0;
    const ground = [];
    for (const fire of scene._groundFireIndex?.().values() || []) {
      if (fire.depth === depth && GroundFire.active(fire, now)) ground.push(fire);
    }
    const n = collectPoints(scene, ground, ax, ay, halfM, 'ground_fire',
      (fire, dx, dy) => ({ kind: 'ground_fire', dx, dy, id: GroundFire.key(fire.depth, fire.cellIX, fire.cellIY) }),
      (fire) => absCellCenterMeters(scene, fire.cellIX, fire.cellIY));
    if (!PF || !fires || !fires.length) return n;
    return n + collectPoints(scene, PF.forDepth(fires, depth), ax, ay, halfM, 'fire',
      (fr, dx, dy) => ({ kind: 'fire', dx, dy, id: `fire_${fr.x.toFixed(2)}_${fr.y.toFixed(2)}` }));
  }

  // The MAGIC TRAPS set on this depth, within light range of the view — the
  // campfire collector's shape exactly (a PLACED list on the save, filtered
  // to the level, culled at halfM + the row's radius). Each is a light only
  // while it is armed: a sprung trap is removed from the save, which is what
  // moves frameKey (its entry leaves the list) and repaints the frame.
  function collectMagicTraps(scene, ax, ay, halfM) {
    const PF = window.PlacedFloor;
    const list = scene.save && scene.save.magicTraps;
    if (!PF || !list || !list.length) return 0;
    return collectPoints(scene, PF.forDepth(list, scene.depth ?? 0), ax, ay, halfM, 'magic_trap',
      (t, dx, dy) => ({ kind: 'magic_trap', dx, dy, id: t.id }));
  }

  // The STREET LAMPS in range. app.js keeps the live list on
  // scene._streetLamps — every lamp near the camera anchor, in ABSOLUTE
  // world metres, each flagged `lit`, rebuilt when the anchor crosses a cell
  // or a stretch is restored — and this converts the LIT ones against THIS
  // frame's anchor, like the blasts, so a peek drag leaves every lamp on the
  // street it stands in. A dark lamp (its stretch not yet restored) is on
  // the list so app.js can draw it as the plain cobble; it throws no light.
  //
  // A LIST, NOT A SCAN: a lamp is not an object in a tile's object list and
  // has no sprite for drawObjects to offer, so nothing would reach `consider`
  // (the reason the lit cobbles needed a second list of their own until they
  // were removed). Handing over a plain array of points instead keeps the
  // finding of them — nine tiles of transportation lines, their arclengths
  // and the save's restored intervals — in app.js, where the tile cache is.
  //
  // AND IT BURNS AT THE LANTERN, not on the tarmac. A lamp's point is its FOOT
  // — one point, which the art stands on and this culls by — but what is
  // alight is the glass up the post, so the cookie is LIFTED off that point by
  // the art's own rise (RoadOverlay.LAMP_LANTERN_RISE_CELLS, the ground line
  // to the lit glass's midline, in cells). It rides as `dyPx`, a DRAW-space
  // lift in screen pixels — the shape RENDER_SPEC's own dyPx has for the
  // sprite — rather than as metres folded into dy, so the light's world
  // position stays exactly the lamp's, and one number lifts the glow and the
  // glass together whatever a cell is worth in metres.
  function lampRiseCells() {
    return (typeof RoadOverlay !== 'undefined' && RoadOverlay.LAMP_LANTERN_RISE_CELLS) || 0;
  }
  // A lamp entry's `glow` ('#rrggbb', app.js _streetLampsForTile off
  // StreetVariants.lampGlowFor) as a light colour: null for the default
  // UI_LAMP_GLOW (the `cobble` row's own colour) or anything unreadable.
  function lampColour(glow) {
    if (typeof glow !== 'string' || !/^#[0-9a-f]{6}$/i.test(glow)) return null;
    const n = parseInt(glow.slice(1), 16);
    return n === LAMP_GLOW ? null : n;
  }
  function collectLamps(scene, ax, ay, halfM) {
    const list = scene && scene._streetLamps;
    if (!list || !list.length) return 0;
    if (!scene._lights) scene._lights = [];
    const dyPx = -lampRiseCells() * ((typeof CELL_PX !== 'undefined') ? CELL_PX : 32);
    let n = 0;
    for (const L of list) {
      if (!L.lit) continue;                        // a dark stone is not a light
      const dx = L.x - ax, dy = L.y - ay;
      if (!inRange(scene, dx, dy, 'cobble', halfM)) continue;
      // The lamp's own GLOW (its street's colour, the same `glow` the baked
      // art is keyed by) as the entry's colour — which frameKey already names
      // per light, so a lamp changing colour repaints. The default glow is
      // left off (undefined), so a plain street's lamp keeps the row's own
      // `cobble` cookie exactly as before. A hue, never a brightness factor.
      const colour = lampColour(L.glow);
      const e = colour == null
        ? { kind: 'cobble', dx, dy, dyPx, id: L.id }
        : { kind: 'cobble', dx, dy, dyPx, id: L.id, colour };
      // THE LIVING LAMP's brightness (app.js, Streets.lampBrightness —
      // already quantised to LAMP_BRIGHT_STEPS) as the entry's GAIN `g`: a
      // STEADY multiplier, not the animated `a` (which would put the clock in
      // frameKey and repaint every tick). frameKey names it, so a step moves
      // the key; 1 (or none) leaves the row's cookie exactly as it was.
      if (Number.isFinite(L.bright) && L.bright !== 1) e.g = L.bright;
      scene._lights.push(e);
      n++;
    }
    return n;
  }

  // The STAFF BOLTS in flight. app.js keeps its shots on scene._shots, in
  // ABSOLUTE world metres (the feet line they fly along); a bolt is the one
  // with a drawn dot (`dotPx` — spawnShot stamps it for the staff, 0 for an
  // arrow). Converted against THIS frame's anchor, like the blasts, and
  // lifted to the drawn orb by SHOT_DRAW_LIFT_PX (app.js, read at call time)
  // as `dyPx`. The id is the shot's own spawn stamp, so a bolt keeps its
  // flicker phase across frames. The light follows the staff's tier the way
  // the orb does: its radius by Combat.boltScale (the row's radius at Wood),
  // its strength by Combat.boltGlow (as the entry's `a`), its colour the
  // shot's own (the staff's metal, stamped by app.js) — and the cull pads by
  // that radius, not the row's, so a Frost bolt's wider light isn't dropped
  // at the edge of the view.
  //
  // A SHINY TURRET'S ARROW (Combat.turretShot, `shiny` — no dot, it is a
  // streak) rides the same lane: the bolt row at the shiny row's radius and
  // peak, in the arrow's own gold, so the light the tower was raised with
  // crosses the ground with its shot.
  //
  // Paint only: brightnessAt does not call this. A bolt is a fleeting thing
  // crossing the view, and what "stands in the light" (the ghost) must not
  // start answering to the player's own gunfire as a side-effect of a look.
  function collectBolts(scene, ax, ay, halfM) {
    const list = scene && scene._shots;
    if (!list || !list.length) return 0;
    if (!scene._lights) scene._lights = [];
    const liftPx = (typeof SHOT_DRAW_LIFT_PX !== 'undefined') ? SHOT_DRAW_LIFT_PX : 0;
    let n = 0;
    for (const s of list) {
      if (!s || s.hostile || !(s.dotPx || s.shiny)) continue;
      const dx = s.x - ax, dy = s.y - ay;
      const C = (typeof Combat !== 'undefined') ? Combat : null;
      const shinyArrow = !s.dotPx && !!s.shiny;
      const r = shinyArrow ? radiusCells('shiny')
        : radiusCells('bolt') * (C ? C.boltScale(s.slot, s.tier) : 1);
      if (!inViewBox(dx, dy, halfM + r * scene.cellM)) continue;
      if (s._lightId == null) s._lightId = `bolt_${++boltSeq}`;
      scene._lights.push({ kind: 'bolt', dx, dy, dyPx: -liftPx, id: s._lightId,
        r, colour: s.color != null ? s.color : undefined,
        a: shinyArrow ? KINDS.shiny.peak : (C ? C.boltGlow(s.slot, s.tier) : undefined) });
      n++;
    }
    return n;
  }
  let boltSeq = 0;

  // The player's light beyond the ramp: the torch cookie, at the feet (metres
  // from the camera anchor, like every light — it slides with a peek), while
  // one burns. Returns the row the player lit as. The plain 'player' row
  // pushes nothing: the ramp IS that light, and a cookie on top of it would
  // brighten the surface picture the profile derivation pins.
  const PLAYER_OBJ = { kind: 'player', id: 'player' };
  function collectPlayer(scene, ax, ay, halfM, now) {
    const kind = sourceKind(scene, PLAYER_OBJ);
    if (kind === 'player') return kind;
    const w = playerWorldM(scene);
    const dx = w.x - ax, dy = w.y - ay;
    if (!inRange(scene, dx, dy, kind, halfM)) return kind;
    // The entry's own alpha (the blast's lane): the torch dimmed by the sun.
    // The row flickers, so it repaints on the light clock anyway, and the
    // alpha is in frameKey — no new input to key. draw() hands in its own
    // `now`, so the torch reads the SAME clock as the rest of the frame; a
    // direct call with none reads the clock itself.
    const t = now ?? lightClock(Date.now());
    const a = torchStrength(scene.depth, daylight(scene, t));
    scene._lights.push(a < 1 ? { kind, dx, dy, a, id: PLAYER_OBJ.id } : { kind, dx, dy, id: PLAYER_OBJ.id });
    return kind;
  }

  // ── BRIGHTNESS AT A POINT ─────────────────────────────────────────────────
  // How much light the lightmap ADDS at world point (wx, wy) — 0 in the dark
  // (the ambient floor alone), clamped at 1 — for anything in the game that
  // has to know whether it is standing in the light (creature_ai.js: the
  // ghost, which burns in it — minus the player's own glow — and is only ever
  // seated where this reads dark). It is the
  // paint's own model, never a second guess at it:
  //   · the player's light — the plateau over the reach cells (cellInReach,
  //     the tap gate's test, and plateauLevel's shading) and the ramp outside
  //     them (playerCookieAlpha), in the profile's litColour;
  //   · every collected source — magic traps, campfires, lit street lamps
  //     (lifted to the lantern), the hand torch, live blasts — collected by
  //     the SAME collectors draw() calls, around the query point instead of
  //     the camera;
  //   · every source drawObjects' scan offered on the last frame (Home, a
  //     restored building, a live POI, a cave torch, a glowing mushroom),
  //     read back off scene._lights against the anchor that frame was drawn
  //     about (scene._lightAnchor, stamped by draw()). Those are the lights
  //     within reach of the VIEW; one further off than that is not on the
  //     list — the scan has not looked there.
  // Each cookie is its baked shape: peak · (1 - r/R)² times the row's flicker
  // or pulse and the entry's own alpha / scale, at the colour's luminance.
  const COLLECTED_KINDS = new Set(['player', 'handtorch', 'fire', 'ground_fire', 'magic_trap', 'cobble', 'blast', 'bolt']);
  function cookieLevel(L, qx, qy, cellM, now, pulseNow) {
    const row = KINDS[L.kind];
    if (!row || !(row.peak > 0)) return 0;
    const a = flickerAlpha(row, L.dx, L.dy, now, L.id, pulseNow) * (L.a == null ? 1 : L.a);
    const sc = (row.flicker ? 1 + (a - (1 - row.flicker / 2)) * 0.15 : 1) * (L.s == null ? 1 : L.s);
    const R = (L.r != null ? L.r : radiusCells(L.kind)) * cellM * sc;
    const d = Math.hypot(qx, qy);
    if (!(R > 0) || d >= R) return 0;
    const t = 1 - d / R;
    return clamp01(a) * (L.g == null ? 1 : L.g) * row.peak * t * t * lum(L.colour == null ? row.colour : L.colour);
  }
  // A light's draw-space lift (a lamp's lantern), back in metres.
  function liftM(L, cellM) {
    if (!L.dyPx) return 0;
    return L.dyPx / ((typeof CELL_PX !== 'undefined') ? CELL_PX : 32) * cellM;
  }
  function playerLightAt(scene, wx, wy, prof) {
    if (!scene.playerM || !scene.startWorldM) return 0;
    const cellM = scene.cellM;
    const pw = playerWorldM(scene);
    const d = Math.hypot(wx - pw.x,
                         wy - pw.y);
    const reachM = (typeof reachRadiusM === 'function') ? reachRadiusM(scene) : 0;
    let inReach = false;
    if (reachM > 0 && prof.lit > prof.edge) {
      if (typeof cellInReach === 'function' && typeof worldMetersToAbsCell === 'function') {
        const c = worldMetersToAbsCell(scene, wx, wy);
        inReach = cellInReach(scene, c.cellIX, c.cellIY);
      } else {
        inReach = d <= reachM;
      }
    }
    if (inReach) {
      const rim = reachM + cellM * Math.SQRT1_2;
      return plateauLevel(prof, d / rim) * lum(prof.litColour);
    }
    const rMaxM = radiusCells('player') * cellM;
    if (d >= rMaxM) return 0;
    const t = rMaxM > reachM ? Math.max(0, (d - reachM) / (rMaxM - reachM)) : 1;
    return playerCookieAlpha(t, prof);
  }
  // `opts.playerGlow: false` leaves out the player's OWN light (the plateau
  // and the ramp, playerLightAt) and keeps everything else — the hand torch
  // included, which is a collected source, not the glow. The ghost's burn asks
  // it that way: a ghost is not hurt by the player's glow, only by a torch.
  function brightnessAt(scene, wx, wy, nowIn, opts) {
    if (!scene || !Number.isFinite(wx) || !Number.isFinite(wy)) return 0;
    const cellM = scene.cellM;
    const wall = nowIn == null ? Date.now() : nowIn;
    const now = lightClock(wall), pnow = pulseClock(wall);
    const prof = profile(scene, daylight(scene, now), now);
    let b = (opts && opts.playerGlow === false) ? 0 : playerLightAt(scene, wx, wy, prof);
    // The collectors push onto scene._lights; point them at a scratch list for
    // the one call and put the frame's list back whatever happens.
    const frame = scene._lights;
    const own = [];
    scene._lights = own;
    try {
      collectMagicTraps(scene, wx, wy, 0);
      collectFires(scene, wx, wy, 0);
      collectLamps(scene, wx, wy, 0);
      if (scene.playerM && scene.startWorldM) collectPlayer(scene, wx, wy, 0);
      collectBlasts(scene, wx, wy, 0, now);
    } finally {
      scene._lights = frame;
    }
    for (const L of own) b += cookieLevel(L, -L.dx, -(L.dy + liftM(L, cellM)), cellM, now, pnow);
    const A = scene._lightAnchor;
    if (frame && A) {
      for (const L of frame) {
        if (COLLECTED_KINDS.has(L.kind)) continue;
        b += cookieLevel(L, wx - (A.x + L.dx), wy - (A.y + L.dy + liftM(L, cellM)), cellM, now, pnow);
      }
    }
    return clamp01(b);
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
  // The expensive reach-cell path lives on a transparent canvas wider than
  // the viewport. Walking
  // crops that cache by the camera's whole-pixel displacement; the player's
  // ramp stays in the viewport canvas, centred on the body. Two cells of
  // paint with a 1.5-cell validity limit leaves half a cell for filtering and
  // cookie edges, matching the road overlay's padded-cache margin.
  const LIGHT_CACHE_PAD_CELLS = 2;
  const LIGHT_CACHE_LIMIT_CELLS = 1.5;

  // ── The lightmap's own clock, and the still-frame gate ─────────────────
  // draw() keys each step on every input the paint depends
  // on (the feet point, the anchor cell and its fraction, the reach, the whole
  // profile, and each light's own fields — frameKey) and paints only when the
  // key moves. What ANIMATES — a fire's flicker, a POI's breath, a blast, the
  // low-energy heartbeat in the profile — reads the clock through lightClock,
  // which steps LIGHT_TICK_MS at a time, so an animated view repaints at
  // 1000 / LIGHT_TICK_MS Hz rather than the display's rate, and a still one
  // not at all. Ten steps a second is past what a flicker can be told apart
  // at; a BREATH (the `pulse` rows) is seconds long and steps on its own,
  // slower clock (pulseClock, above), so a view whose only moving lights
  // breathe repaints at 1000 / PULSE_TICK_MS Hz. The ramp and the plateau
  // never animate. The gate is the same shape as the fog's and the road canvas's
  // (rebuild on a key, else reuse), pointed at the one layer that lacked it.
  const LIGHT_TICK_MS = 100;
  function lightClock(t) { return Math.floor(t / LIGHT_TICK_MS) * LIGHT_TICK_MS; }
  // Does anything in this step's list move on its own clock, and on which?
  // ANIM_FAST: a row's flicker, or an entry-level alpha / scale (a blast
  // drives both) — the light clock. ANIM_PULSE: a row's breath — the pulse
  // clock. 0 when nothing moves. A bit mask, so a list holding both keys on
  // both clocks.
  const ANIM_FAST = 1, ANIM_PULSE = 2;
  function animates(scene) {
    let m = 0;
    for (const L of scene._lights) {
      const row = KINDS[L.kind];
      if ((row && row.flicker) || L.a != null || L.s != null) m |= ANIM_FAST;
      if (row && row.pulse) m |= ANIM_PULSE;
      if (m === (ANIM_FAST | ANIM_PULSE)) break;
    }
    return m;
  }
  // ── WHOLE PIXELS ──────────────────────────────────────────────────────
  // Everything else on the map lands on whole logical pixels (pixelArt, and
  // every sprite and ground cell is placed at Math.round of its projection),
  // so the world only visibly moves when a projection crosses a pixel. The
  // lightmap keyed on the raw sub-pixel inputs instead, and a body easing a
  // few metres after a GPS jitter — a third of a pixel a step — repainted and
  // re-uploaded it on every step while the picture under it held still. So
  // the key names what the paint actually PLACES: each light's centre and the
  // plateau's cells in whole px (the plateau was already drawn on Math.round
  // cells), and the paint stamps each light at that same whole-px centre,
  // which also keeps a glow locked to the sprite it belongs to.
  //
  // A light's centre on the lightmap canvas (before the origin comes off),
  // in whole px: the sprite's own rounding of the same projection. Without a
  // view centre to place it by (a bare scene), the raw offsets.
  function lightCentrePx(scene, L) {
    const c = deltaMToScreen(scene, L.dx, L.dy);   // coords.js — the sprites' own projection
    return { x: Math.round(c.x), y: Math.round(c.y + (L.dyPx || 0)) };
  }
  function placesInPx(scene) {
    return Number.isFinite(scene.viewCenterX) && Number.isFinite(scene.viewCenterY) && scene.cellM > 0;
  }
  // The plateau's placement in whole px: the anchor's cell, the rounded
  // origin of the drawn grid, and — for a row whose tile row has a different
  // grid (coords.js viewBand) — that row's column shift and its own rounded
  // origin. Exactly what the per-cell path in reachCellsPath rounds to, so
  // the plateau is a function of this string (and the reach cell).
  function plateauPlacement(scene, pc) {
    const half = (VIEW_CELLS - 1) / 2;
    const fracX = pc.cx - Math.floor(pc.cx);
    const fracY = pc.cy - Math.floor(pc.cy);
    const x0 = (ph) => cellScreenXY(scene, -1 - half, 0, fracX, 0, ph).x;   // coords.js — drawCells' own slot
    const y = cellScreenXY(scene, 0, -1 - half, 0, fracY).y;
    let bands = '';
    const base = viewAnchorAbsCell(scene, pc);
    for (let r = -2; r <= VIEW_CELLS + 1; r++) {
      const b = viewBand(scene, pc, base.cellIY + (r - half));
      if (b.dX || b.phaseX) bands += `|${r}:${b.dX}:${x0(b.phaseX) - x0(0)}`;
    }
    const off = -1 - half;
    const screenX = x0(0);
    return {
      screenX, screenY: y,
      // The screen coordinate of a fixed absolute grid origin. Unlike a slot
      // coordinate this stays continuous when the anchor crosses a cell, so
      // the prior reach mask can crop through the crossing and fade out.
      x: screenX - (base.cellIX + off) * CELL_PX,
      y: y - (base.cellIY + off) * CELL_PX,
      // Absolute anchor-cell identity is deliberately absent. A row-grid
      // shape change rebuilds; an ordinary cell crossing only crops.
      structure: bands,
      bands,
    };
  }
  function plateauPxKey(scene, pc) {
    const p = plateauPlacement(scene, pc);
    return `${Math.floor(pc.cx)},${Math.floor(pc.cy)},${p.screenX},${p.screenY}${p.bands}`;
  }
  // The non-light prefix of the full-frame key: every number the ambient
  // floor, player ramp and reach plateau read. frameKey builds on it, so the
  // still gate cannot omit a paint input. The base bake below uses the narrower
  // baseFrameKey because the plateau lives in its padded cache. `pcPx` is the plateau's
  // whole-px placement (plateauPxKey); left out, the anchor's raw fraction.
  function baseFrameKey(ps, ox, oy, prof, r0, rMax) {
    return `${ps.x},${ps.y},${ox},${oy},${r0},${rMax}`
      + `|${prof.depth},${prof.dimA},${prof.dimColour},${prof.farA},${prof.ambient},${prof.edge},${prof.lit},${prof.litColour},${prof.night}`;
  }
  function staticFrameKey(ps, ox, oy, prof, r0, rMax, reachM, rp, pc, pcPx) {
    let k = baseFrameKey(ps, ox, oy, prof, r0, rMax) + `|${reachM}`;
    if (rp) k += `|${rp.cellIX},${rp.cellIY},${pc.tx},${pc.ty},${pcPx != null ? pcPx : `${pc.cx},${pc.cy}`}`;
    return k;
  }
  // Every number the paint reads, in one string. `rp` / `pc` are null when no
  // plateau is drawn (they only exist to place it); each clock is folded in
  // only when something moves on it, so a still fire-less view has no time
  // term and a view that only breathes has only the breath's. `pulseNow` is
  // draw()'s breath clock; left out, it is derived from `now`.
  function frameKey(scene, ps, ox, oy, prof, r0, rMax, reachM, rp, pc, now, pulseNow, pcPx) {
    let k = staticFrameKey(ps, ox, oy, prof, r0, rMax, reachM, rp, pc, pcPx);
    const anim = animates(scene);
    if (anim & ANIM_FAST) k += `|t${now}`;
    if (anim & ANIM_PULSE) k += `|p${pulseNow == null ? pulseClock(now) : pulseNow}`;
    const crit = criticalLights(scene, now);           // every light's tint + stutter
    if (crit) k += `|crit${crit.mix},${crit.a.toFixed(4)}`;
    // Each light where the paint puts it: its whole-px centre (the offsets
    // themselves only for a scene with no view centre to place by).
    const inPx = placesInPx(scene);
    for (const L of scene._lights) {
      let at;
      if (inPx) { const c = lightCentrePx(scene, L); at = `${c.x},${c.y}`; }
      else at = `${L.dx},${L.dy}`;
      k += `|${L.kind},${L.id},${at},${L.dyPx},${L.r},${L.colour},${L.a},${L.s},${L.g}`;
    }
    return k;
  }

  function rgba(colour, a) {
    return rgbaOf(colour, clamp01(a).toFixed(4));
  }
  function makeCanvas(S) {
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    return c;
  }
  // Paint a radial cookie onto `canvas` (square, cleared first): a gradient
  // from its centre out to `radius` px through `stops` — [offset 0..1,
  // colour, alpha] — filled edge to edge. Both cookies below are this.
  function bakeRadialCookie(canvas, radius, stops) {
    const S = canvas.width, c = S / 2;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, S, S);
    const g = ctx.createRadialGradient(c, c, 0, c, c, radius);
    for (const [t, colour, a] of stops) g.addColorStop(t, rgba(colour, a));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
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
    const canvas = makeCanvas(2 * R);
    const stops = [];
    for (let i = 0; i <= KIND_STOPS; i++) {
      const t = i / KIND_STOPS;
      stops.push([t, col, row.peak * (1 - t) * (1 - t)]);
    }
    bakeRadialCookie(canvas, R, stops);
    store[key] = { canvas, R };
    return store[key];
  }

  // The player's RAMP: flat at `edge` out to the reach radius, then the
  // falloff to zero PLAYER_RAMP_PAST_CORNER_CELLS beyond the viewport's
  // half-diagonal: one cell past keeps the corners just lit,
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
    const fr = (r) => clamp01(r / rMaxT);
    const white = KINDS.player.colour;
    const stops = [[0, white, prof.edge]];
    // The ramp starts at r0 with `edge` and lands on 0 at rMax. Sample the
    // super-linear curve at RAMP_STOPS points so the gradient's linear
    // segments track it.
    const span = rMaxT - r0T;
    for (let i = 0; i <= RAMP_STOPS; i++) {
      const t = i / RAMP_STOPS;
      stops.push([fr(r0T + t * span), white, playerCookieAlpha(t, prof)]);
    }
    bakeRadialCookie(st.canvas, rMaxT, stops);
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
      return Math.round(255 * clamp01((target - prof.edge) / f));
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
  // `pulseNow` is the breath's clock (pulseClock of the wall time); left out,
  // it is derived from `now`, so a direct call steps on the same grid.
  function flickerAlpha(row, dx, dy, now, id, pulseNow) {
    let a = 1;
    if (row.flicker) {
      const phase = ((dx * 7.13 + dy * 3.71) % 6.283);
      const w = 0.5 + 0.25 * Math.sin(now / 90 + phase) + 0.25 * Math.sin(now / 233 + phase * 1.7);
      a *= 1 - row.flicker * w;
    }
    if (row.pulse) {
      const h = strHash31(id || '');
      const pt = pulseNow == null ? pulseClock(now) : pulseNow;
      const t = (pt / 1000) / POI_PULSE_PERIOD_S + (h % 1000) / 1000;
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
  // shared rule; with no rule loaded the cell is a plain square.
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

  // Reach remains discrete for taps. Its picture eases between the old and new
  // cell masks, so cells entering/leaving the light do not flash on a crossing.
  // Keep the current mixture when interrupted (including turning back), rather
  // than restarting from a fully lit old mask. Weights always sum to one, so
  // overlapping cells retain their brightness under additive blending.
  const REACH_FADE_MS = 240;
  function reachFrames(scene, rp, reachM, now) {
    if (!rp) { scene._lightReachFade = null; return []; }
    const key = `${rp.cellIX}|${rp.cellIY}|${reachM}`;
    const space = `${scene.depth ?? 0}|${scene.cellM}`;
    const target = { key, rp: { cellIX: rp.cellIX, cellIY: rp.cellIY }, reachM, weight: 1 };
    let st = scene._lightReachFade;
    if (!st || st.space !== space) {
      scene._lightReachFade = { space, target, from: [], at: now };
      return [target];
    }
    const t = clamp01((now - st.at) / REACH_FADE_MS);
    const ease = t * t * (3 - 2 * t);
    const frames = st.from.length && t < 1
      ? st.from.map(f => ({ ...f, weight: f.weight * (1 - ease) })) : [];
    const existing = frames.find(f => f.key === st.target.key);
    const weight = frames.length ? ease : 1;
    if (existing) existing.weight += weight;
    else frames.push({ ...st.target, weight });
    if (st.target.key !== key) {
      st = scene._lightReachFade = { space, target, from: frames.filter(f => f.weight > 0), at: now };
    } else if (t >= 1) st.from = [];
    return frames;
  }
  function reachFramesKey(frames) {
    return frames.map(f => `${f.key}:${f.weight}`).join(';');
  }

  // The screen-attached base layer: ambient plus the player's ramp. The ramp
  // follows the body, so it cannot move with a world-anchored cache. It is
  // cheap (one fill + one baked-cookie draw) and its own bake survives a walk
  // because the player's feet remain at the camera centre.
  function paintStaticLayer(ctx, W, H, scene, prof, player, ps, ox, oy) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = cssOf(prof.ambient);
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    const D = player.S * PLAYER_COOKIE_SCALE;
    ctx.drawImage(player.canvas, ps.x - ox - D / 2, ps.y - oy - D / 2, D, D);
  }

  function reachCellsPath(ctx, scene, ox, oy, rp, pc, reachM) {
      const reachM2 = reachM * reachM;
      const fracX = pc.cx - Math.floor(pc.cx);
      const fracY = pc.cy - Math.floor(pc.cy);
      const { cellIX: baseCellIX, cellIY: baseCellIY } = viewAnchorAbsCell(scene, pc);
      const half = (VIEW_CELLS - 1) / 2;
      // Each slot row's band (coords.js viewBand): the column shift and screen
      // phase of a row whose tile row has a different grid to the anchor's —
      // the same slots render.js drawCells paints, so the plateau lights
      // exactly the cells drawn under it. Rows -2..VIEW_CELLS+1 (the probe
      // reaches one past the drawn range).
      const bandDX = new Int32Array(VIEW_CELLS + 4), bandPh = new Float32Array(VIEW_CELLS + 4);
      for (let r = -2; r <= VIEW_CELLS + 1; r++) {
        const b = viewBand(scene, pc, baseCellIY + (r - half));
        bandDX[r + 2] = b.dX; bandPh[r + 2] = b.phaseX;
      }
      // The neighbour probe for the corner rounding — the same test again, so
      // a corner is rounded by exactly the cells the loop below lights. It is
      // cellInReach's expression; across a row whose grid differs the
      // distance is measured by position (coords.js absCellDelta), which on a
      // shared grid is the plain subtraction.
      const inReach = (c, r) => {
        const d = absCellDelta(scene, rp.cellIX, rp.cellIY,
          baseCellIX + (c - half) + bandDX[r + 2], baseCellIY + (r - half));
        const ddx = d.dx * scene.cellM;
        const ddy = d.dy * scene.cellM;
        return ddx * ddx + ddy * ddy <= reachM2;
      };
      // ONE path, ONE fill: the cells abut on integer px so the union fills
      // seamlessly, and under 'lighter' a single fill adds the plateau once
      // (a fillet a second cell repeated would not double up either).
      ctx.beginPath();
      for (let row = -1; row <= VIEW_CELLS; row++) {
        for (let col = -1; col <= VIEW_CELLS; col++) {
          if (!inReach(col, row)) continue;
          // drawCells' own slot (coords.js cellScreenXY), in lightmap-local px.
          const c = cellScreenXY(scene, col - half, row - half, fracX, fracY, bandPh[row + 2]);
          const sx = c.x - ox, sy = c.y - oy;
          plateauCellPath(ctx, sx, sy,
            !inReach(col, row - 1), !inReach(col, row + 1), !inReach(col - 1, row), !inReach(col + 1, row),
            inReach(col - 1, row - 1), inReach(col + 1, row - 1), inReach(col - 1, row + 1), inReach(col + 1, row + 1));
        }
      }
  }
  function paintReachMask(ctx, scene, ox, oy, rp, pc, reachM) {
    ctx.fillStyle = '#fff';
    reachCellsPath(ctx, scene, ox, oy, rp, pc, reachM);
    ctx.fill();
  }

  function paintLight(ctx, scene, L, crit, now, pnow, ox, oy) {
    const row = KINDS[L.kind];
    const colour = crit ? mixColour(L.colour == null ? row.colour : L.colour, LOW_ENERGY_TINT, crit.mix)
                        : L.colour;
    const ck = ensureKindCookie(scene, L.kind, L.r, colour);
    const a = flickerAlpha(row, L.dx, L.dy, now, L.id, pnow) * (L.a == null ? 1 : L.a)
      * (crit ? crit.a : 1);
    const sc = (row.flicker ? 1 + (a - (1 - row.flicker / 2)) * 0.15 : 1) * (L.s == null ? 1 : L.s);
    const d = 2 * ck.R * sc;
    const c = lightCentrePx(scene, L);
    let left = clamp01(a) * (L.g == null ? 1 : L.g);
    while (left > 0.001) {
      ctx.globalAlpha = clamp01(left);
      ctx.drawImage(ck.canvas, c.x - ox - d / 2, c.y - oy - d / 2, d, d);
      left -= 1;
    }
  }

  // Stable world cookies share the padded-cache lane. Flickering, breathing,
  // transient and player-attached lights stay as individual stamps because
  // their shape/point changes independently of the camera.
  function cacheableWorldLight(L) {
    const row = KINDS[L.kind];
    return L.kind !== 'handtorch' && L.kind !== 'bolt' && L.kind !== 'blast'
      && row && !row.flicker && !row.pulse && L.a == null && L.s == null;
  }
  function cookiePhase(scene, L, ax, ay) {
    const k = CELL_PX / scene.cellM;
    const frac = (v) => Math.round(((v - Math.floor(v)) + 1) % 1 * 1e6);
    return `${frac((ax + L.dx) * k)},${frac((ay + L.dy) * k + (L.dyPx || 0))}`;
  }
  function cookieGroupKey(scene, lights, ax, ay, crit) {
    const k = CELL_PX / scene.cellM;
    let out = `${scene.cellM}|${crit ? `${crit.mix},${crit.a}` : '-'}`;
    for (const L of lights) {
      const x = Math.round((ax + L.dx) * k * 1e6);
      const y = Math.round(((ay + L.dy) * k + (L.dyPx || 0)) * 1e6);
      out += `|${L.kind},${L.id},${x},${y},${L.dyPx},${L.r},${L.colour},${L.g}`;
    }
    return out;
  }

  // Cache up to three exact whole-pixel phase groups. Lights in one group
  // cross every rounding boundary together, so one integer crop keeps each
  // glow locked to its sprite. Smaller extra groups remain in `excluded` and
  // take the old one-cookie stamp path instead of consuming an unbounded set
  // of mobile canvases.
  function worldCookieFrames(scene, W, H, ax, ay, ox, oy, crit, now, pnow) {
    const pad = LIGHT_CACHE_PAD_CELLS * CELL_PX;
    const limit = LIGHT_CACHE_LIMIT_CELLS * CELL_PX;
    const groups = new Map(), excluded = [];
    for (const L of scene._lights) {
      if (!cacheableWorldLight(L)) { excluded.push(L); continue; }
      const phase = cookiePhase(scene, L, ax, ay);
      let g = groups.get(phase);
      if (!g) groups.set(phase, g = { phase, lights: [] });
      g.lights.push(L);
    }
    const selected = [...groups.values()].sort((a, b) => b.lights.length - a.lights.length).slice(0, 3);
    const kept = new Set(selected.map(g => g.phase));
    for (const g of groups.values()) if (!kept.has(g.phase)) excluded.push(...g.lights);
    const st = scene._lightCookieContribution
      || (scene._lightCookieContribution = { entries: [], rebuilds: 0, serial: 0 });
    const items = [];
    let rebuilt = false, cached = 0;
    for (const g of selected) {
      const key = cookieGroupKey(scene, g.lights, ax, ay, crit);
      let entry = st.entries.find(e => e.key === key);
      const centres = g.lights.map(L => lightCentrePx(scene, L));
      let qx = 0, qy = 0, reusable = !!entry && entry.centres.length === centres.length
        && entry.canvas.width === W + 2 * pad && entry.canvas.height === H + 2 * pad;
      if (reusable && centres.length) {
        qx = entry.centres[0].x - centres[0].x + ox - entry.ox;
        qy = entry.centres[0].y - centres[0].y + oy - entry.oy;
        if (Math.abs(qx) >= limit || Math.abs(qy) >= limit) reusable = false;
        for (let i = 1; reusable && i < centres.length; i++) {
          if (entry.centres[i].x - centres[i].x + ox - entry.ox !== qx
              || entry.centres[i].y - centres[i].y + oy - entry.oy !== qy) reusable = false;
        }
      }
      if (!reusable) {
        if (!entry) {
          if (st.entries.length < 3) {
            entry = { canvas: document.createElement('canvas') };
            st.entries.push(entry);
          } else entry = st.entries.reduce((a, b) => a.used < b.used ? a : b);
        }
        if (entry.canvas.width !== W + 2 * pad) entry.canvas.width = W + 2 * pad;
        if (entry.canvas.height !== H + 2 * pad) entry.canvas.height = H + 2 * pad;
        const ctx = entry.canvas.getContext('2d');
        ctx.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
        ctx.globalCompositeOperation = 'lighter';
        ctx.imageSmoothingEnabled = true;
        for (const L of g.lights) paintLight(ctx, scene, L, crit, now, pnow, ox - pad, oy - pad);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        entry.key = key;
        entry.centres = centres;
        entry.ox = ox; entry.oy = oy;
        qx = qy = 0;
        st.rebuilds++;
        rebuilt = true;
      }
      entry.used = ++st.serial;
      items.push({ canvas: entry.canvas, sx: pad + qx, sy: pad + qy });
      cached += g.lights.length;
    }
    return { items, excluded, rebuilt, cached };
  }

  // Everything that changes one reach mask except its blend weight and common
  // screen translation. Fade weights change every step for 240 ms; keeping a
  // canvas per old/new mask lets the main lightmap blend two cached crops
  // instead of walking 169 cells again on each fade step.
  function contributionKey(scene, frame, placement) {
    return `${scene.cellM}|${frame.key}|${placement.structure}`;
  }

  // Build or crop each padded reach mask. These canvases never become Phaser
  // textures: viewport crops are added to the existing lightmap before its
  // sole refresh, preserving one-pass MULTIPLY and the Canvas fallback.
  function contributionFrames(scene, W, H, ox, oy, plateau, pc, frames) {
    const items = [];
    if (!plateau) {
      for (const e of scene._lightContribution?.entries || []) e.pending = false;
      return { items, rebuilt: false, deferred: false };
    }
    const pad = LIGHT_CACHE_PAD_CELLS * CELL_PX;
    const limit = LIGHT_CACHE_LIMIT_CELLS * CELL_PX;
    const placement = plateauPlacement(scene, pc);
    const st = scene._lightContribution || (scene._lightContribution = { entries: [], rebuilds: 0, serial: 0 });
    let rebuilt = false, deferred = false;
    for (const frame of frames) {
      if (frame.weight <= 0) continue;
      const key = contributionKey(scene, frame, placement);
      let entry = st.entries.find(e => e.key === key);
      let qx = entry ? entry.placement.x - placement.x + ox - entry.ox : 0;
      let qy = entry ? entry.placement.y - placement.y + oy - entry.oy : 0;
      const sized = !!entry && entry.canvas.width === W + 2 * pad && entry.canvas.height === H + 2 * pad;
      const insideLimit = sized && Math.abs(qx) < limit && Math.abs(qy) < limit;
      const insidePaint = sized && Math.abs(qx) < pad && Math.abs(qy) < pad;
      let reusable = insideLimit && !entry.pending;
      // drawCells owns crossing detection. When the ordinary 1.5-cell rebuild
      // threshold lands on that already-heavy frame, use the remaining half-
      // cell of painted pad once and rebuild on the next ordinary frame. The
      // physical 2-cell edge is absolute: never crop outside it.
      if (sized && scene._boot_crossing && insidePaint && (!insideLimit || entry.pending)) {
        entry.pending = true;
        reusable = true;
        deferred = true;
      }
      if (entry && entry.pending && !scene._boot_crossing) reusable = false;
      if (!reusable) {
        if (!entry) {
          if (st.entries.length < 4) {
            entry = { canvas: document.createElement('canvas') };
            st.entries.push(entry);
          } else {
            entry = st.entries.reduce((a, b) => a.used < b.used ? a : b);
          }
        }
        if (entry.canvas.width !== W + 2 * pad) entry.canvas.width = W + 2 * pad;
        if (entry.canvas.height !== H + 2 * pad) entry.canvas.height = H + 2 * pad;
        const ctx = entry.canvas.getContext('2d');
        ctx.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1;
        ctx.imageSmoothingEnabled = true;
        paintReachMask(ctx, scene, ox - pad, oy - pad, frame.rp, pc, frame.reachM);
        ctx.globalCompositeOperation = 'source-over';
        entry.key = key;
        entry.placement = placement;
        entry.ox = ox; entry.oy = oy;
        entry.pending = false;
        qx = qy = 0;
        st.rebuilds++;
        rebuilt = true;
      }
      entry.used = ++st.serial;
      items.push({ canvas: entry.canvas, sx: pad + qx, sy: pad + qy, weight: frame.weight });
    }
    // A mask that left the fade before repayment needs no rebuild; do not let
    // its stale pending bit bypass the still gate forever.
    if (!scene._boot_crossing) for (const e of st.entries) e.pending = false;
    return { items, rebuilt, deferred };
  }
  function contributionPending(scene) {
    return !!scene._lightContribution?.entries?.some(e => e.pending);
  }

  // Combine the cached CELL SHAPES at their live fade weights, then colour
  // that mask with a fresh radial gradient centred on the player's current
  // feet. Geometry follows the world; brightness follows the body. This small
  // viewport scratch replaces the 169-cell path walk on ordinary steps.
  function paintReachContribution(ctx, scene, contribution, prof, ps, ox, oy, r0, W, H) {
    if (!contribution.items.length) return;
    let c = scene._lightReachComposite;
    if (!c) c = scene._lightReachComposite = document.createElement('canvas');
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    const m = c.getContext('2d');
    m.clearRect(0, 0, W, H);
    m.globalCompositeOperation = 'lighter';
    m.imageSmoothingEnabled = false;
    for (const item of contribution.items) {
      m.globalAlpha = item.weight;
      m.drawImage(item.canvas, item.sx, item.sy, W, H, 0, 0, W, H);
    }
    m.globalAlpha = 1;
    m.globalCompositeOperation = 'source-in';
    m.fillStyle = plateauFill(m, prof, ps.x - ox, ps.y - oy, r0);
    m.fillRect(0, 0, W, H);
    m.globalCompositeOperation = 'source-over';
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(c, 0, 0);
  }

  // One exact copy of the baked static layer onto the lightmap. The layer is
  // opaque (its floor is), so source-over replaces every pixel outright.
  function blitStatic(ctx, canvas) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(canvas, 0, 0);
  }

  // Paint this frame's lightmap: the ambient floor, the player's ramp at the
  // feet-on-the-fix point, the plateau over every reach cell, then every
  // collected light at its anchored screen position. `ax, ay` are the camera
  // anchor in world metres, `halfM` the sprite cull the collector pads.
  //
  // Returns true when it painted, false when the still-frame gate reused the
  // last upload. Times itself for the load profile: scene._boot_lightMs is
  // what drawObjects' own tick subtracts, since this runs inside that pass.
  function draw(scene, ax, ay, halfM) {
    // The anchor this frame's scanned lights are measured from — brightnessAt
    // reads them back against it.
    const anchor = scene._lightAnchor || (scene._lightAnchor = { x: 0, y: 0 });
    anchor.x = ax; anchor.y = ay;
    const tex = scene.lightTex;
    if (!tex || typeof document === 'undefined') return false;
    if (!scene._lights) scene._lights = [];
    const wall = Date.now();
    const now = lightClock(wall);
    const pnow = pulseClock(wall);                   // the breath's own clock
    collectMagicTraps(scene, ax, ay, halfM);
    collectFires(scene, ax, ay, halfM);
    collectLamps(scene, ax, ay, halfM);
    collectPlayer(scene, ax, ay, halfM, now);
    collectBolts(scene, ax, ay, halfM);
    // The live blasts, converted against THIS frame's anchor (they are stored
    // in world metres) and pruned as they burn out.
    collectBlasts(scene, ax, ay, halfM, now);
    // Critically low: every light red, dimmed and stuttering, and the
    // player's own red raised (criticalLights / critPaintProfile).
    const crit = criticalLights(scene, now);
    const prof = critPaintProfile(scene, profile(scene, daylight(scene, now), now), crit, now);
    const k = CELL_PX / scene.cellM;                 // metres → screen px
    // The ramp's extent: the player row's radius — the viewport's half-
    // diagonal plus PLAYER_RAMP_PAST_CORNER_CELLS, so the corners stay lit.
    const rMax = radiusCells('player') * CELL_PX;
    const reachM = (typeof reachRadiusM === 'function') ? reachRadiusM(scene) : 0;
    const r0 = Math.max(0, reachM * k);
    const player = ensurePlayerCookie(scene, prof, r0, rMax);
    // The feet in whole px, like everything else on the map (WHOLE PIXELS,
    // above): the ramp and the plateau's gradient are centred there.
    const ps0 = scene.playerScreen ? scene.playerScreen() : { x: scene.viewCenterX, y: scene.viewCenterY };
    const ps = { x: Math.round(ps0.x), y: Math.round(ps0.y) };
    const ox = scene.viewLeft, oy = scene.viewTop;   // lightmap-local origin
    // The plateau's placement, hoisted out of its branch below so the gate
    // can key on it: the reach cell and the anchor cell + fraction.
    const plateau = reachM > 0 && prof.lit > prof.edge && typeof playerReachCell === 'function'
      && typeof viewAnchorCell === 'function';
    const rp = plateau ? playerReachCell(scene) : null;
    const pc = plateau ? viewAnchorCell(scene) : null;
    const pcPx = plateau ? plateauPxKey(scene, pc) : null;
    const frames = reachFrames(scene, rp, reachM, wall);
    const fadeKey = reachFramesKey(frames);
    const B = (typeof window !== 'undefined') ? window.__boot : null;
    const key = frameKey(scene, ps, ox, oy, prof, r0, rMax, reachM, rp, pc, now, pnow, pcPx) + '|' + fadeKey;
    // A crossing may have borrowed the cache's last half-cell of physical
    // pad. Even if every visual key holds, the next ordinary frame must pay
    // back that deferred rebuild before the still gate can return.
    if (key === tex.__lightKey && !contributionPending(scene)) {
      scene._boot_lightMs = 0;
      if (B) B.count('lightmap painted', 0);
      return false;
    }
    tex.__lightKey = key;
    const t0 = B ? performance.now() : 0;
    const ctx = tex.context;
    const W = tex.width, H = tex.height;

    // THE SCREEN-ATTACHED BASE — ambient plus player ramp. It remains still
    // while the camera follows the walking body, so its bake survives the
    // walk. The more expensive world contribution below crops independently.
    const sk = baseFrameKey(ps, ox, oy, prof, r0, rMax);
    const args = [scene, prof, player, ps, ox, oy];
    let st = scene._lightStatic;
    if (st && st.key === sk && st.canvas.width === W && st.canvas.height === H) {
      blitStatic(ctx, st.canvas);
    } else if (tex.__lightStaticKey === sk) {
      if (!st || st.canvas.width !== W || st.canvas.height !== H) {
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        st = scene._lightStatic = { canvas: c, key: null };
      }
      paintStaticLayer(st.canvas.getContext('2d'), W, H, ...args);
      st.key = sk;
      blitStatic(ctx, st.canvas);
    } else {
      paintStaticLayer(ctx, W, H, ...args);
    }
    tex.__lightStaticKey = sk;

    // THE WORLD-ATTACHED CONTRIBUTION — plateau plus every non-player light.
    // Rebuild at state/pad/rounding changes; otherwise copy one viewport crop.
    const contribution = contributionFrames(scene, W, H, ox, oy, plateau, pc, frames);
    paintReachContribution(ctx, scene, contribution, prof, ps, ox, oy, r0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
    const cookies = worldCookieFrames(scene, W, H, ax, ay, ox, oy, crit, now, pnow);
    for (const item of cookies.items) ctx.drawImage(item.canvas, item.sx, item.sy, W, H, 0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    // Only independently flickering/transient/player lights and small overflow
    // phase groups take the per-step stamp path. Stable world cookies move as
    // exact whole-pixel crops above.
    for (const L of cookies.excluded) paintLight(ctx, scene, L, crit, now, pnow, ox, oy);
    scene._boot_lightExcludedStamps = cookies.excluded.length;
    scene._boot_lightWorldStamps = cookies.excluded.reduce((n, L) => n + (L.kind === 'handtorch' ? 0 : 1), 0);
    scene._boot_lightCachedCookies = cookies.cached;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const uploadT0 = B ? performance.now() : 0;
    tex.refresh();
    if (B) B.tick('lighting upload', performance.now() - uploadT0);
    if (B) {
      const dt = performance.now() - t0;
      scene._boot_lightMs = dt;
      B.tick('lighting', dt);
      B.count('lightmap painted', 1);
      B.count('light contribution painted', contribution.rebuilt ? 1 : 0);
      B.count('light contribution deferred', contribution.deferred ? 1 : 0);
      B.count('light contribution rebuilt @crossing',
        scene._boot_crossing && contribution.rebuilt ? 1 : 0);
      B.count('light cookie cache painted', cookies.rebuilt ? 1 : 0);
      B.count('light cookies stamped', cookies.excluded.length);
      B.count('light cookies cached', cookies.cached);
    }
    return true;
  }

  window.Lighting = {
    KINDS, radiusCells, TORCH_RADIUS_MUL, TORCH_DAY_FLOOR, torchStrength, FALLOFF_A, FALLOFF_P, AMBIENT_K, AMBIENT_DAY_LUM, PLAYER_OUTPUT_K, PLATEAU_OUTPUT_K, litDim, POI_PULSE_PERIOD_S,
    NIGHT_DIM_A, NIGHT_TINT_KEEP, DAY_ELEV_DEG, NIGHT_ELEV_DEG,
    sunElevationDeg, daylightFromElevation, daylight,
    LOW_ENERGY_TINT, LOW_ENERGY_A, LOW_ENERGY_FRAC, lowEnergyFrac, CRITICAL_LIGHT_MIX, CRITICAL_LIGHT_DIM, CRITICAL_LIGHT_DIP, CRITICAL_PLAYER_TINT_A, criticalLights, critPaintProfile, mixColour, mixToWhite, scaleColour, lum, atLuminance,
    CRITICAL_ENERGY_FRAC, CRITICAL_W, HEARTBEAT_PERIOD_MS, HEARTBEAT_AMPLITUDE, heartbeatShape, heartbeatMul,
    PLATEAU_FALL, plateauLevel, PLAYER_RAMP_PAST_CORNER_CELLS,
    profile, playerCookieAlpha, plateauCellColour, sourceKind, playerKind, beginFrame, consider, offerShiny, offerPoi, collectFires, collectBolts, objectLightPadCells, wildplantLightPadCells,
    collectPlayer, collectLamps, lampColour, collectMagicTraps, lampRiseCells, brightnessAt,
    blast, collectBlasts, BLAST_RADIUS_CELLS, BLAST_MS, FLASH_SCALE_FROM,
    flickerAlpha, plateauCellPath, REACH_FADE_MS, reachFrames, reachFramesKey, draw,
    LIGHT_TICK_MS, lightClock, baseFrameKey, staticFrameKey, lightCentrePx, plateauPxKey, LIGHT_CACHE_PAD_CELLS, LIGHT_CACHE_LIMIT_CELLS, PULSE_STEPS, PULSE_TICK_MS, pulseClock, ANIM_FAST, ANIM_PULSE, animates, frameKey,
  };
})(window);
