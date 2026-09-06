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

test('lighting: a campfire lights exactly the ring that warms you', () => {
  assert.eq(Lighting.radiusCells('fire'), FIRE_REST_R,
    'the fire light radius is FIRE_REST_R — stand in the light, stand in the warmth');
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
    assert.eq(p.ambient, Lighting.mixToWhite(Render.reachDimColor(s), p.farA), `ambient @${depth}`);
    // …the cookie just outside the plateau lifts it back to the flat wash…
    near((1 - p.farA) + p.edge, 1 - dimA, 1e-12, `edge restores the wash @${depth}`);
    // …and inside the plateau to the lit level (full daylight on the surface).
    near((1 - p.farA) + p.lit, 1 - Lighting.litDim(depth), 1e-12, `lit level @${depth}`);
  }
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
  assert.eq(Lighting.sourceKind(s, { kind: 'chest', id: 'c' }), null, 'nor is a chest');
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
  const offer = body.indexOf("if (LIGHTS && (o.kind === 'house' || o.kind === 'tower')) LIGHTS.consider(scene, o, dx, dy, halfM);");
  const cull = body.indexOf('if (Math.abs(dx) > lim || Math.abs(dy) > lim) continue;');
  assert.truthy(offer > 0 && cull > offer, 'buildings are offered BEFORE the sprite cull drops them');
  assert.truthy(/LIGHTS\.draw\(scene, pWorldX, pWorldY, halfM\);\s*$/.test(body),
    'the map is drawn last, from the camera anchor drawObjects measures with');
});

test('lighting: the map multiplies, the cookies add, and it sits over the sprites', () => {
  const a = APP_JS_SRC;
  assert.truthy(/this\.lightMap = this\.add\.renderTexture\(this\.viewLeft, this\.viewTop, this\.viewSize, this\.viewSize\)\s*\n\s*\.setOrigin\(0, 0\)\.setBlendMode\(Phaser\.BlendModes\.MULTIPLY\)/.test(a),
    'the lightmap is a viewport-sized RenderTexture multiplied over the world');
  assert.falsy(/atmosFalloffGfx/.test(a), 'the ring layer is gone');
  const L = LIGHTING_SRC;
  assert.eq((L.match(/setBlendMode\(Phaser\.BlendModes\.ADD\)/g) || []).length, 2,
    'both cookie images (kind + player) are ADD-blended into the map');
  assert.truthy(/rt\.fill\(prof\.ambient, 1\)/.test(L), 'the floor is the derived ambient');
  assert.truthy(/scene\.playerScreen\(\)/.test(L), 'the player\'s light is at the feet-on-the-fix point');
});

})();
