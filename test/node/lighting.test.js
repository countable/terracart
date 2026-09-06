// The lightmap: one light table, DERIVED levels, and the per-frame collector.
//
// src/lighting.js replaced five darkness passes (the per-cell reach dim, the
// underground lit-dim, the low-energy pink, the falloff rings, most of the
// vignette) with one additive lightmap multiplied over the world. Three
// things have to stay true for that swap to be invisible where it should be
// and legible where it shouldn't:
//
//   1. The player's light reproduces the old picture — its levels come off
//      the same Render.reachDimColor / reachDimAlpha the wash painted with.
//   2. What lights is what the game says is yours: a restored building via the
//      same isClaimedKey test the derelict wash reads, Home, a placed fire —
//      and a fire's light IS its warmth ring (FIRE_REST_R), one number.
//   3. The old passes are actually gone, and the compositing is the model
//      described at the top of lighting.js (ADD into the map, MULTIPLY out).
//
// Everything above draw() is pure, so it runs here; draw() needs Phaser and
// is pinned as source text.

(function () {

const ch = (c, sh) => (c >> sh) & 255;
const near = (a, b, eps, m) => { if (Math.abs(a - b) > eps) throw new Error(`${m || 'near'}: ${a} vs ${b}`); };

function scene(over) {
  return Object.assign({
    depth: 0,
    cellM: 5,
    startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 }, originPx: { x: 0, y: 0 },
    mPerPx: 10, feetOffsetM: 0, cellsPerTile: 512,
    save: { energy: 100, maxEnergy: 100, fires: [] },
    _atmos: { dim: 0x1a2a1e },
    isClaimedKey: () => false,
  }, over);
}
const HALF_M = (11 / 2 + 1) * 5;   // drawObjects' halfM at cellM 5

test('lighting: a fire and a Home light exactly the ring they warm you in', () => {
  assert.eq(Lighting.radiusCells('fire'), FIRE_REST_R,
    'the fire light radius is FIRE_REST_R — stand in the light, stand in the warmth');
  assert.eq(Lighting.radiusCells('trailer'), HOME_R,
    "Home's light radius is HOME_R — the ring that lights you is the ring that "
    + 'rests you and the ring nothing hostile will stand in');
  assert.gt(Lighting.radiusCells('trailer'), Lighting.radiusCells('building'),
    'Home throws more light than a plain restored house');
});

test('lighting: the levels reproduce the old wash, on the surface and below', () => {
  for (const depth of [0, 1, 3]) {
    const s = scene({ depth });
    const p = Lighting.profile(s);
    const dimA = Render.reachDimAlpha(s);
    // The floor is where the old wash + falloff landed at the corner…
    near(p.farA, 1 - (1 - dimA) * (1 - Lighting.FALLOFF_A), 1e-12, `farA @${depth}`);
    // …scaled by the contrast knob, and by nothing else…
    assert.eq(p.ambient, Lighting.scaleColour(Lighting.mixToWhite(Render.reachDimColor(s), p.farA), Lighting.AMBIENT_K),
      `ambient @${depth}`);
    // …the cookie just outside the plateau lifts it back to the flat wash,
    // scaled down by the player's own output knob…
    near((1 - p.farA) + p.edge / Lighting.PLAYER_OUTPUT_K, 1 - dimA, 1e-12, `edge restores the wash @${depth}`);
    // …and inside the plateau to the lit level (full daylight on the surface), likewise scaled.
    near((1 - p.farA) + p.lit / Lighting.PLAYER_OUTPUT_K, 1 - Lighting.litDim(depth), 1e-12, `lit level @${depth}`);
  }
  // The contrast knob darkens the FLOOR only: the ramp's edge level is the
  // old wash's (times PLAYER_OUTPUT_K), so the reach step is untouched and
  // only the dark got darker.
  assert.inRange(Lighting.AMBIENT_K, 0.3, 0.6, 'a real darkening, not black and not the old floor');
  assert.inRange(Lighting.PLAYER_OUTPUT_K, 0.5, 1.0, 'a real dimming of the body light, not a blackout');
  const lum = (c) => (0.299 * ch(c, 16) + 0.587 * ch(c, 8) + 0.114 * ch(c, 0)) / 255;
  assert.lt(lum(Lighting.profile(scene()).ambient), 0.10, 'a totally unlit surface cell is under 10% luminance');
  assert.eq(Lighting.litDim(0), 0, 'the surface bubble is full daylight');
  assert.gt(Lighting.litDim(2), Lighting.litDim(1), 'the bubble dims with every level down');
  const surf = Lighting.profile(scene()), cave = Lighting.profile(scene({ depth: 1 }));
  assert.lt(ch(cave.ambient, 8), ch(surf.ambient, 8), 'a cave is darker than the surface');
  assert.eq(Render.reachDimColor(scene({ depth: 1 })), 0x000000, 'and its dark is pure black');
});

test('lighting: the player ramp is the falloff, expressed as light', () => {
  const p = Lighting.profile(scene());
  near(Lighting.playerCookieAlpha(0, p), p.edge, 1e-12, 'starts at the edge level');
  assert.eq(Lighting.playerCookieAlpha(1, p), 0, 'lands on nothing at the corner');
  near(Lighting.playerCookieAlpha(0.5, p), p.edge * (1 - Math.pow(0.5, Lighting.FALLOFF_P)), 1e-12,
    'super-linear between them');
  let prev = Infinity;
  for (let t = 0; t <= 1; t += 0.05) {
    const a = Lighting.playerCookieAlpha(t, p);
    assert.lte(a, prev, 'never brightens with distance');
    prev = a;
  }
});

test('lighting: low energy tints the bubble pink, nothing else does', () => {
  assert.eq(Lighting.profile(scene()).litColour, 0xffffff, 'rested: white');
  const tired = Lighting.profile(scene({ save: { energy: 20, maxEnergy: 100 } })).litColour;
  assert.eq(tired, Lighting.mixToWhite(Lighting.LOW_ENERGY_TINT, Lighting.LOW_ENERGY_A), 'the old pink at the old alpha');
  assert.eq(ch(tired, 16), 255, 'red stays full');
  assert.lt(ch(tired, 8), 255, 'green drops — pink, not white');
  assert.eq(Lighting.profile(scene({ save: { energy: 0, maxEnergy: 100 } })).litColour, 0xffffff,
    'at 0 there is no reach to tint');
  assert.eq(Lighting.profile(scene({ save: { energy: 20, maxEnergy: 100, reachPotionUntil: Date.now() + 60000 } })).litColour,
    0xffffff, 'a Potion of Reach pins the view lit');
});

test('lighting: what lights is what is yours', () => {
  const s = scene({ save: { starterShopId: 'h_home' }, isClaimedKey: (k) => k === 'h_done' || k === 'castle_1' });
  assert.eq(Lighting.sourceKind(s, { kind: 'house', id: 'h_wreck' }), null, 'a wreck is dark');
  assert.eq(Lighting.sourceKind(s, { kind: 'house', id: 'h_done' }), 'building', 'a restored house lights');
  assert.eq(Lighting.sourceKind(s, { kind: 'house', id: 'h_home', _synthetic: true }), 'trailer',
    'the starter trailer is Home\'s light');
  assert.eq(Lighting.sourceKind(scene({ save: { starterShopId: 'h_real' } }), { kind: 'house', id: 'h_real' }), 'trailer',
    'so is a real house adopted as Home, whatever isClaimedKey says');
  assert.eq(Lighting.sourceKind(s, { kind: 'tower', castle: 'castle_1' }), 'building', 'a claimed castle\'s turret lights');
  assert.eq(Lighting.sourceKind(s, { kind: 'tower', castle: 'castle_2' }), null, 'an unclaimed one does not');
  assert.eq(Lighting.sourceKind(s, { kind: '_fire', id: 'f' }), 'fire', 'a placed fire lights');
  assert.eq(Lighting.sourceKind(s, { kind: 'tree', id: 't' }), null, 'a tree is not a lamp');
  assert.eq(Lighting.sourceKind(s, { kind: 'chest', id: 'c', poiClass: 'shop' }), 'poi', 'a POI is a place, and glows');
  assert.eq(Lighting.sourceKind(s, { kind: 'chest', id: 'c', crate: true }), null,
    'a loose supply crate is a pickup, not a place — no pad, no light');
  assert.eq(Lighting.sourceKind(s, { kind: 'torch', id: 'torch_bus_1_d1' }), 'torch', 'a cave torch burns');
  assert.eq(Lighting.sourceKind(s, { crop: 'mushroom', id: 'cwp_1_0_0_3_3', _cave: true }), 'mushroom',
    'a cave mushroom glows — offered as the wildplant itself, no kind');
  assert.eq(Lighting.sourceKind(s, { crop: 'mushroom', id: 'wp_0_0_3_3' }), 'mushroom',
    'and so does a surface one: the crop is the light, not the depth');
  assert.eq(Lighting.sourceKind(s, { crop: 'longgrass', id: 'wp_0_0_4_4' }), null, 'grass is not a lamp');
  assert.eq(Lighting.sourceKind(s, { kind: 'mineralrock', crop: 'mushroom', id: 'r' }), null,
    'a kind that is not a light stays dark whatever else is on it');
});

test('lighting: a torch and a mushroom glow to different degrees', () => {
  // The user's brief: torches AND mushrooms, each lit, "to different degrees".
  // A torch is a flame — warm, a campfire's little sibling, breathing; a
  // mushroom is a faint cool spot that marks a forage in the dark. The two
  // must stay far apart on BOTH axes or a lit cave reads as one lamp twice.
  const torch = Lighting.KINDS.torch, mush = Lighting.KINDS.mushroom;
  assert.gt(Lighting.radiusCells('torch'), Lighting.radiusCells('mushroom') * 1.5, 'a torch reaches well past a mushroom');
  assert.gt(torch.peak, mush.peak * 1.5, 'and burns far brighter at the centre');
  assert.lt(Lighting.radiusCells('torch'), Lighting.radiusCells('fire'), 'but a torch is smaller than a campfire');
  assert.lt(Lighting.radiusCells('mushroom'), Lighting.radiusCells('poi'), 'a mushroom is smaller than a POI\'s marker light');
  assert.gt(torch.flicker, 0, 'a flame flickers');
  assert.eq(mush.flicker, 0, 'a mushroom does not — it breathes slowly, like a POI');
  assert.gt(mush.pulse, 0, 'a mushroom breathes');
  // Warm vs cool: the torch leads on red, the mushroom on blue.
  assert.gt(ch(torch.colour, 16), ch(torch.colour, 0), 'torch: red over blue');
  assert.gt(ch(mush.colour, 0), ch(mush.colour, 16), 'mushroom: blue over red');
});

test('lighting: a POI breathes slowly, on its own phase', () => {
  const poi = Lighting.KINDS.poi;
  assert.lt(Lighting.radiusCells('poi'), Lighting.radiusCells('building'), 'small: it marks the place, it does not light the block');
  assert.eq(Lighting.POI_PULSE_PERIOD_S, 4.5, 'the old halo ping\'s period — anything brisk is a strobe');
  const P = Lighting.POI_PULSE_PERIOD_S * 1000;
  let lo = 1, hi = 0;
  for (let t = 0; t < P; t += 50) {
    const a = Lighting.flickerAlpha(poi, 0, 0, t, 'c_1_1');
    lo = Math.min(lo, a); hi = Math.max(hi, a);
    assert.inRange(a, 1 - poi.pulse, 1, 'within the pulse band');
  }
  assert.gt(hi - lo, poi.pulse * 0.9, 'a full breath over one period');
  // One period later it is where it was — and two POIs are not in step.
  const a0 = Lighting.flickerAlpha(poi, 0, 0, 1234, 'c_1_1');
  assert.lt(Math.abs(Lighting.flickerAlpha(poi, 0, 0, 1234 + P, 'c_1_1') - a0), 1e-9, 'periodic');
  assert.gt(Math.abs(Lighting.flickerAlpha(poi, 0, 0, 1234, 'c_2_9') - a0), 0.02, 'phased by id, not in lockstep');
});

test('lighting: a lit cobble glows, small and in the trail violet, and breathes', () => {
  // The stone's art sits UNDER the lightmap, so after dark a lit trail went
  // as black as the road it ran along. This row is the walked trail glowing
  // behind the player at night: one small pool per stone, in the same
  // constant the stone and its counter are drawn in, breathing like a POI.
  const c = Lighting.KINDS.cobble;
  assert.truthy(c, 'the cobble row exists');
  assert.eq(c.colour, parseInt(UI_TRAIL_LIT.slice(1), 16), 'the glow is UI_TRAIL_LIT — the stone\'s own colour');
  assert.eq(Lighting.TRAIL_LIT, c.colour);
  assert.lt(Lighting.radiusCells('cobble'), Lighting.radiusCells('mushroom'),
    'smaller than a mushroom — a road can carry dozens in view');
  assert.lt(c.peak, Lighting.KINDS.poi.peak, 'and dimmer than a place marker');
  assert.gt(c.peak, 0, 'but it is a light');
  assert.eq(c.flicker, 0, 'no flame flicker');
  assert.gt(c.pulse, 0, 'it breathes');
  assert.lt(c.pulse, 0.5, 'gently — never off');
});

test('lighting: a stone coming on is a BLAST, on the pop\'s own clock', () => {
  // considerCobble offers the steady glow always, and while the stone is
  // through its scale-pop (flashT 0..1) a second, wide, near-white light
  // over it that fades out as it swells — driven by the pop's clock, so the
  // light and the art can never fall out of step.
  const f = Lighting.KINDS.cobbleFlash;
  assert.truthy(f, 'the flash row exists');
  assert.gt(Lighting.radiusCells('cobbleFlash'), Lighting.radiusCells('cobble') * 2, 'the blast is wide');
  assert.gt(f.peak, Lighting.KINDS.poi.peak, 'and bright');
  // Near-white: every channel high, and blue over red (still a cool light).
  for (const sh of [16, 8, 0]) assert.gt(ch(f.colour, sh), 200, 'near-white');
  assert.gte(ch(f.colour, 0), ch(f.colour, 16), 'cool, not warm');

  const s = scene();
  Lighting.beginCells(s);
  assert.eq(s._cellLights.length, 0);
  assert.eq(Lighting.considerCobble(s, 5, -10, 'k1', null), 1, 'at rest: the glow only');
  assert.eq(s._cellLights[0].kind, 'cobble');
  assert.eq(s._cellLights[0].dx, 5); assert.eq(s._cellLights[0].dy, -10);
  assert.eq(Lighting.considerCobble(s, 0, 0, 'k2', 0), 2, 'just lit: the glow and the blast');
  const atStart = s._cellLights[2];
  assert.eq(atStart.kind, 'cobbleFlash');
  near(atStart.a, 1, 1e-9, 'full alpha the instant it lights');
  assert.lt(atStart.s, 1, 'and smaller than its full radius');
  Lighting.considerCobble(s, 0, 0, 'k3', 0.5);
  const mid = s._cellLights[4];
  assert.lt(mid.a, atStart.a, 'fading');
  assert.gt(mid.s, atStart.s, 'while swelling');
  assert.eq(Lighting.considerCobble(s, 0, 0, 'k4', 1), 1, 'the pop is over: no blast');
  assert.eq(Lighting.considerCobble(s, 0, 0, 'k5', 1.5), 1);
  Lighting.beginCells(s);
  assert.eq(s._cellLights.length, 0, 'beginCells resets the cell list');
  // A rebuilt list is a separate list from the object lights: beginFrame
  // (which drawObjects calls AFTER drawCells) must not wipe the cobbles.
  Lighting.considerCobble(s, 1, 1, 'k6', null);
  Lighting.beginFrame(s);
  assert.eq(s._cellLights.length, 1, 'beginFrame leaves the cell lights alone');
});

test('lighting: drawCells offers every lit stone, and draw() stamps the cell lights with their own alpha and scale', () => {
  // The cobble is a CELL, so it never crosses drawObjects' scan — drawCells
  // offers it, from the cobble draw (where `active` is known), anchored like
  // every light (metres from the camera anchor: the cell's centre is
  // ox + 0.5 - fracX cells from it), with the pop's clock for the blast.
  const R = RENDER_SRC;
  assert.truthy(/if \(LIGHTS\) LIGHTS\.beginCells\(scene\);/.test(R), 'drawCells begins the cell lights');
  assert.truthy(/if \(active && LIGHTS\) \{\n\s+LIGHTS\.considerCobble\(scene, \(ox \+ 0\.5 - fracX\) \* scene\.cellM,\n\s+\(oy \+ 0\.5 - fracY\) \* scene\.cellM, tilledKey, flashT\);/.test(R),
    'every ACTIVE stone is offered at its cell centre, with its flash clock');
  assert.truthy(/flashT = ft;/.test(R), 'the flash clock is the pop\'s own ft');
  // draw() honours the multipliers and reads both lists.
  const L = LIGHTING_SRC;
  const d = L.slice(L.indexOf('  function draw(scene, ax, ay, halfM) {'));
  assert.truthy(/\* \(L\.a == null \? 1 : L\.a\)/.test(d), 'a light\'s own alpha multiplies in');
  assert.truthy(/\* \(L\.s == null \? 1 : L\.s\)/.test(d), 'and its own scale');
  assert.truthy(/for \(const L of scene\._lights\) stamp\(L\);\n\s+if \(scene\._cellLights\) for \(const L of scene\._cellLights\) stamp\(L\);/.test(d),
    'the object lights and then the cell lights are stamped');
});

test('lighting: the halo ping is gone — the POI light replaced it', () => {
  assert.falsy(/poiHaloContainer|halo_poi|POI_HALO_PERIOD_S/.test(APP_JS_SRC + RENDER_SRC),
    'the ring layer, its texture and its period are gone from app.js / render.js');
  const body = RENDER_SRC.slice(RENDER_SRC.indexOf('Render.drawObjects = function drawObjects(scene)'));
  assert.truthy(/if \(LIGHTS && o\.kind === 'chest' && !o\.crate && !openedSet\.has\(o\.id\)\) LIGHTS\.consider\(scene, o, dx, dy, halfM\);/.test(body),
    'live POIs are offered to the lightmap from the tile scan, opened ones never');
  const offer = body.indexOf("if (LIGHTS && o.kind === 'chest'");
  const dedup = body.indexOf("if (o.kind === 'chest' && isDupChest(o)) continue;");
  assert.truthy(dedup > 0 && offer > dedup, 'offered AFTER the per-frame chest dedup, so the surviving copy is the one that glows');
});

test('lighting: the cull pads by the light\'s own radius, not the sprite\'s', () => {
  const s = scene({ isClaimedKey: () => true });
  Lighting.beginFrame(s);
  const R = Lighting.radiusCells('building') * s.cellM;
  assert.truthy(Lighting.consider(s, { kind: 'house', id: 'a' }, HALF_M + R - 1, 0, HALF_M),
    'a house a light-radius off-screen still lights the edge');
  assert.falsy(Lighting.consider(s, { kind: 'house', id: 'b' }, HALF_M + R + 1, 0, HALF_M),
    'past its own radius it is dropped');
  assert.falsy(Lighting.consider(s, { kind: 'tree', id: 't' }, 0, 0, HALF_M), 'a non-light is refused');
  assert.eq(s._lights.length, 1, 'one light kept');
  assert.eq(s._lights[0].kind, 'building');
  assert.eq(s._lights[0].dx, HALF_M + R - 1, 'kept in anchor metres, as drawObjects measures');
  Lighting.beginFrame(s);
  assert.eq(s._lights.length, 0, 'a new frame starts empty — a re-wrecked house cannot linger');
});

test('lighting: campfires come off the placed list, this depth only', () => {
  const fires = [
    PlacedFloor.stampDepth({ x: 10, y: 0 }, 0),
    PlacedFloor.stampDepth({ x: -10, y: 0 }, 1),      // a cave fire
    PlacedFloor.stampDepth({ x: 1000, y: 0 }, 0),     // far off-screen
    { x: 0, y: 12 },                                  // an old save: no stamp = surface
  ];
  const surf = scene({ save: { fires } });
  Lighting.beginFrame(surf);
  assert.eq(Lighting.collectFires(surf, 0, 0, HALF_M), 2, 'two surface fires in range');
  assert.truthy(surf._lights.every((L) => L.kind === 'fire'));
  const cave = scene({ depth: 1, save: { fires } });
  Lighting.beginFrame(cave);
  assert.eq(Lighting.collectFires(cave, 0, 0, HALF_M), 1, 'only the cave fire underground');
  assert.eq(cave._lights[0].dx, -10);
  assert.eq(Lighting.collectFires(scene({ save: {} }), 0, 0, HALF_M), 0, 'no list, no fires');
});

test('lighting: a fire breathes, a house does not', () => {
  const fire = Lighting.KINDS.fire, house = Lighting.KINDS.building;
  assert.eq(Lighting.flickerAlpha(house, 0, 0, 0), 1, 'steady');
  let lo = 1, hi = 0;
  for (let t = 0; t < 3000; t += 16) {
    const a = Lighting.flickerAlpha(fire, 3, 7, t);
    lo = Math.min(lo, a); hi = Math.max(hi, a);
    assert.inRange(a, 1 - fire.flicker, 1, 'within the flicker band');
  }
  assert.gt(hi - lo, fire.flicker * 0.5, 'and actually moves');
});

test('lighting: the sun is where the almanac says', () => {
  const T = (iso) => Date.parse(iso);
  // Equinox noon on the equator at Greenwich: the sun is overhead.
  assert.gt(Lighting.sunElevationDeg(T('2024-03-20T12:07:00Z'), 0, 0), 88, 'overhead at equinox noon');
  assert.lt(Lighting.sunElevationDeg(T('2024-03-20T00:07:00Z'), 0, 0), -85, 'and underfoot at midnight');
  // Midwinter noon at 60°N: 90 - 60 - 23.4 ≈ 6.6°.
  const w = Lighting.sunElevationDeg(T('2024-12-21T12:00:00Z'), 60, 0);
  assert.inRange(w, 5.5, 7.5, `midwinter noon at 60N is a hand above the horizon (${w.toFixed(2)})`);
  // Longitude shifts the clock: noon at 90°W is 18:00 UTC.
  assert.gt(Lighting.sunElevationDeg(T('2024-06-21T18:00:00Z'), 40, -90), 70, 'summer noon at 40N, 90W');
  assert.lt(Lighting.sunElevationDeg(T('2024-06-21T06:00:00Z'), 40, -90), -20, 'is midnight there at 06:00 UTC');
});

test('lighting: daylight is a twilight ramp around the horizon', () => {
  assert.eq(Lighting.daylightFromElevation(30), 1, 'high sun is full day');
  assert.eq(Lighting.daylightFromElevation(Lighting.DAY_ELEV_DEG), 1, 'full from DAY_ELEV_DEG up');
  assert.eq(Lighting.daylightFromElevation(Lighting.NIGHT_ELEV_DEG), 0, 'night from civil twilight\'s end down');
  assert.eq(Lighting.daylightFromElevation(-40), 0);
  near(Lighting.daylightFromElevation(0), 0.5, 1e-9, 'sunset is halfway');
  let prev = 0;
  for (let e = -10; e <= 10; e += 0.5) { const d = Lighting.daylightFromElevation(e); assert.gte(d, prev); prev = d; }
});

test('lighting: night darkens the world but not the Inner Light, and never a cave', () => {
  const noon = Lighting.profile(scene(), 1), night = Lighting.profile(scene(), 0), dusk = Lighting.profile(scene(), 0.5);
  assert.eq(noon.night, 0); assert.eq(night.night, 1);
  assert.eq(Lighting.profile(scene()).night, 0, 'no daylight given means noon — the derivation tests above are clock-free');
  assert.eq(night.dimA, Lighting.NIGHT_DIM_A, 'full night: the out-of-reach wash is the first cave level\'s');
  assert.gt(dusk.dimA, noon.dimA); assert.lt(dusk.dimA, night.dimA);
  const lum = (c) => (0.299 * ch(c, 16) + 0.587 * ch(c, 8) + 0.114 * ch(c, 0)) / 255;
  assert.lt(lum(night.ambient), lum(noon.ambient) * 0.5, 'the floor goes much darker');
  assert.lt(night.edge, noon.edge, 'so does the ground just outside reach');
  // The plateau: lit + floor still sums to full daylight on the surface.
  // …fully lit at night, before PLAYER_OUTPUT_K takes its own bit off the top
  // (the Inner Light still fully compensates for the night; it's just dimmer
  // than daylight by the same knob that dims it by day).
  near((1 - night.farA) + night.lit / Lighting.PLAYER_OUTPUT_K, 1, 1e-12, 'the reach bubble stays fully lit at night');
  assert.eq(night.litColour, 0xffffff);
  // A cave has no sun.
  const caveDay = Lighting.profile(scene({ depth: 1 }), 1), caveNight = Lighting.profile(scene({ depth: 1 }), 0);
  assert.eq(caveNight.night, 0);
  assert.eq(caveNight.ambient, caveDay.ambient); assert.eq(caveNight.edge, caveDay.edge);
});

test('lighting: the frame reads the real sun at the player, once a minute', () => {
  const s = scene();
  // The test scene's projection puts the player at lon -180, lat ~85 — the
  // sun there is whatever it is; what matters is that it is a number, cached
  // by the minute, and that the override wins.
  const a = Lighting.daylight(s, Date.parse('2024-06-21T12:00:00Z'));
  assert.inRange(a, 0, 1);
  s._daylight.value = 0.123;
  assert.eq(Lighting.daylight(s, Date.parse('2024-06-21T12:00:30Z')), 0.123, 'same minute: cached');
  assert.truthy(Lighting.daylight(s, Date.parse('2024-06-21T12:01:00Z')) !== 0.123, 'next minute: recomputed');
  assert.eq(Lighting.daylight({ depth: 0 }, Date.now()), 1, 'no fix to place the sun by: noon');
  assert.truthy(/const prof = profile\(scene, daylight\(scene, now\)\);/.test(LIGHTING_SRC), 'draw() passes the frame\'s daylight');
});

// ── Source pins: the old passes are gone, the new path is wired ───────────
test('lighting: the darkness passes are gone from drawCells', () => {
  const r = RENDER_SRC;
  assert.falsy(/if \(isReach\(col, row\)\) continue;/.test(r),
    'the per-cell out-of-reach fillRect wash has grown back');
  assert.falsy(/strokeCircle\(scene\.viewCenterX/.test(r), 'the falloff rings have grown back');
  assert.falsy(/const FALLOFF_A = /.test(r), 'the falloff pair lives in lighting.js now');
  assert.falsy(/0xff5fa2/.test(r), 'the low-energy pink is the player cookie\'s colour now');
  assert.truthy(/if \(!isReach\(col, row\)\) continue;/.test(r), 'the per-cell reach OUTLINE stays');
  assert.falsy(/mulTint\(tint, Render\.reachDimTint/.test(r),
    'spriteTint composing the reach dim onto a wreck would dim it twice under the lightmap');
});

test('lighting: drawObjects offers buildings to the map and draws it last', () => {
  const r = RENDER_SRC;
  const start = r.indexOf('Render.drawObjects = function drawObjects(scene)');
  const body = r.slice(start, r.indexOf('\n};', start));
  assert.truthy(/LIGHTS\.beginFrame\(scene\)/.test(body), 'the frame list is reset before the scan');
  const offer = body.indexOf("if (LIGHTS && (o.kind === 'house' || o.kind === 'tower' || o.kind === 'torch')) LIGHTS.consider(scene, o, dx, dy, halfM);");
  const cull = body.indexOf('if (Math.abs(dx) > lim || Math.abs(dy) > lim) continue;');
  assert.truthy(offer > 0 && cull > offer, 'buildings (and torches) are offered BEFORE the sprite cull drops them');
  // The mushroom is a wildplant, scanned in its own loop: offered as itself,
  // before that loop's cull, so its little glow can still show from a cell
  // off-screen.
  const wpOffer = body.indexOf("if (LIGHTS && wp.crop === 'mushroom') LIGHTS.consider(scene, wp, dx, dy, halfM);");
  const wpCull = body.indexOf('if (Math.abs(dx) > halfM || Math.abs(dy) > halfM) continue;', wpOffer);
  assert.truthy(wpOffer > 0 && wpCull > wpOffer, 'mushrooms are offered BEFORE the wildplant cull');
  assert.truthy(/LIGHTS\.draw\(scene, pWorldX, pWorldY, halfM\);\s*$/.test(body),
    'the map is drawn last, from the camera anchor drawObjects measures with');
});

test('lighting: the map multiplies, the cookies add, and the plateau is per cell', () => {
  const a = APP_JS_SRC;
  assert.truthy(/this\.lightTex = this\.textures\.exists\('lightmap'\)/.test(a), 'the lightmap is a canvas texture');
  assert.truthy(/this\.lightMap = this\.add\.image\(this\.viewLeft, this\.viewTop, 'lightmap'\)\s*\n\s*\.setOrigin\(0, 0\)\.setBlendMode\(Phaser\.BlendModes\.MULTIPLY\)/.test(a),
    'shown as a viewport-sized image multiplied over the world');
  assert.falsy(/atmosFalloffGfx|renderTexture\(/.test(a), 'the ring layer and the render texture are gone');
  const L = LIGHTING_SRC;
  assert.truthy(/globalCompositeOperation = 'lighter'/.test(L), 'the cookies ADD');
  assert.falsy(/\brt\.|batchDraw\(|BlendModes\.ADD/.test(L), 'nothing goes through the render-texture batch');
  assert.truthy(/ctx\.fillStyle = hex\(prof\.ambient\)/.test(L), 'the floor is the derived ambient');
  assert.truthy(/scene\.playerScreen\(\)/.test(L), 'the ramp is centred on the feet-on-the-fix point');
  assert.truthy(/tex\.refresh\(\)/.test(L), 'and the texture is refreshed each frame');
  // The plateau uses cellInReach's own expressions, hoisted the way drawCells does.
  assert.truthy(/const dx = \(absIX - rp\.cellIX\) \* scene\.cellM;/.test(L) && /if \(dx \* dx \+ dy \* dy > reachM2\) continue;/.test(L),
    'the plateau cells are picked by the reach test, not a circle');
});

test('lighting: the plateau cells land on the lit level, pink when tired', () => {
  const ch = (c, sh) => (c >> sh) & 255;
  for (const sv of [{ energy: 100, maxEnergy: 100 }, { energy: 20, maxEnergy: 100 }]) {
    for (const depth of [0, 2]) {
      const prof = Lighting.profile(scene({ depth, save: sv }));
      const cell = Lighting.plateauCellColour(prof);
      for (const sh of [16, 8, 0]) {
        const got = prof.edge + (prof.lit - prof.edge) * (ch(cell, sh) / 255);
        const want = prof.lit * (ch(prof.litColour, sh) / 255);
        near(got, Math.min(want, prof.edge + (prof.lit - prof.edge)), 0.004, `channel ${sh} energy ${sv.energy} depth ${depth}`);
      }
    }
  }
  const tired = Lighting.plateauCellColour(Lighting.profile(scene({ save: { energy: 20, maxEnergy: 100 } })));
  assert.lt(ch(tired, 8), ch(tired, 16), 'the cell fill carries the pink');
});

test('lighting: the plateau eases down toward the reach rim, and the step at the rim still wins', () => {
  assert.inRange(Lighting.PLATEAU_FALL, 0.08, 0.30, 'a little — shading, not a second falloff');
  for (const [depth, day] of [[0, 1], [0, 0.5], [0, 0], [1, 1], [3, 1]]) {
    for (const sv of [{ energy: 100, maxEnergy: 100 }, { energy: 20, maxEnergy: 100 }]) {
      const p = Lighting.profile(scene({ depth, save: sv }), day);
      const tag = `depth ${depth} daylight ${day} energy ${sv.energy}`;
      near(Lighting.plateauLevel(p, 0), p.lit, 1e-12, `full at the feet (${tag})`);
      near(Lighting.plateauLevel(p, 1), p.lit * (1 - Lighting.PLATEAU_FALL), 1e-12, `PLATEAU_FALL down at the rim (${tag})`);
      assert.eq(Lighting.plateauLevel(p, 1.7), Lighting.plateauLevel(p, 1), `flat past the rim (${tag})`);
      assert.gt(Lighting.plateauLevel(p, 0.5), (Lighting.plateauLevel(p, 0) + Lighting.plateauLevel(p, 1)) / 2,
        `quadratic: the middle stays near full, the easing gathers at the edge (${tag})`);
      let prev = Infinity;
      for (let t = 0; t <= 1; t += 0.05) {
        const L = Lighting.plateauLevel(p, t);
        assert.lte(L, prev, `never brightens with distance (${tag})`);
        prev = L;
      }
      // The affordance: the darkest of the plateau (its rim) is still further
      // above the ramp's edge level than the rim is below the feet.
      const rim = Lighting.plateauLevel(p, 1);
      assert.gt(rim - p.edge, p.lit - rim, `the step off the plateau outweighs the fall across it (${tag})`);
      // And each stop's fill lands on its own level × litColour, per channel.
      for (const t of [0, 0.5, 1]) {
        const level = Lighting.plateauLevel(p, t);
        const cell = Lighting.plateauCellColour(p, level);
        for (const sh of [16, 8, 0]) {
          const got = p.edge + (level - p.edge) * (ch(cell, sh) / 255);
          const want = level * (ch(p.litColour, sh) / 255);
          near(got, Math.min(want, level), 0.004, `stop ${t} channel ${sh} (${tag})`);
        }
      }
    }
  }
  // draw() fills the reach-cell path with the gradient about the feet, out
  // to the furthest corner a reach cell can put on the plateau.
  const L = LIGHTING_SRC;
  assert.truthy(/ctx\.fillStyle = plateauFill\(ctx, prof, ps\.x - ox, ps\.y - oy, r0\);/.test(L),
    'the plateau fill is the gradient, centred on the feet-on-the-fix point');
  assert.truthy(/const rim = r0 \+ CELL_PX \* Math\.SQRT1_2;/.test(L), 'the rim is the reach radius plus half a cell diagonal');
  assert.truthy(/g\.addColorStop\(t, rgba\(plateauCellColour\(prof, level\), level - prof\.edge\)\);/.test(L),
    'each stop is the cell colour at its level, over the ramp\'s edge');
  assert.falsy(/rgba\(plateauCellColour\(prof\), prof\.lit - prof\.edge\)/.test(L), 'the flat plateau fill is gone');
});

})();
