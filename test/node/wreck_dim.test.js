// A WRECK stands in the same light as the ground it stands on.
//
// The unclaimed house sprite is not an ordinary world sprite. Every other one
// is deliberately exempt from the out-of-reach wash — the lighting layer sits
// BELOW the sprites so reach dims the ground and distance dims the objects
// (see the note at reachGfx in app.js create(), pinned by tools/layer_audit).
// A wreck's roof can't take that exemption: its whole job is to carry the
// colour its footprint is painted in, so when the footprint went dark and the
// roof didn't, the building read as a bright sticker lying on dark ground.
//
// So the tint composes THREE things, in order: whatever the sprite already
// wore, the derelict wash, and — outside the lit bubble — the same reach dim
// the ground pass paints, read from the same place so the two can't drift.
//
// Render.spriteTint is pure (object + scene in, a colour out), so all of it
// drives headlessly even though drawObjects itself needs Phaser.

(function () {

const ch = (c, sh) => (c >> sh) & 255;
const luma = (c) => 0.299 * ch(c, 16) + 0.587 * ch(c, 8) + 0.114 * ch(c, 0);

// cellM 5 m, reach measured from the player's own cell — a house at the origin
// is lit, one 50 m away is not. originPx/mPerPx are what coords.js projects
// world metres through.
function scene(over) {
  return Object.assign({
    startWorldM: { x: 0, y: 0 },
    playerM: { x: 0, y: 0 },
    originPx: { x: 0, y: 0 },
    mPerPx: 10,
    // playerReachCell measures from the FEET row; 0 is what the game seats
    // them at (app.js create()), and leaving it undefined makes the cell index
    // NaN — which reads as "nothing is in reach", not as an error.
    feetOffsetM: 0,
    cellM: 5,
    cellsPerTile: 512,
    depth: 0,
    save: { energy: 100 },
    _atmos: { dim: 0x1a2a1e },
    isClaimedKey: () => false,
  }, over);
}
const house = (x, y, id) => ({ kind: 'house', id: id ?? 'h_1_1', x, y });
const NEAR = 0, FAR = 60;      // metres east of the player: inside / outside reach

test('wreck dim: an unclaimed house outside the lit bubble darkens further', () => {
  const s = scene();
  const lit = Render.spriteTint(house(NEAR, 0), s);
  const unlit = Render.spriteTint(house(FAR, 0), s);
  assert.lt(luma(unlit), luma(lit), 'the wreck outside reach is darker than the one inside it');
  // …and it is the reach dim exactly, composed ON TOP of the derelict wash
  // rather than replacing it — a wreck out there is BOTH derelict and unlit.
  const dim = Render.reachDimTint(s);
  const composed = (sh) => Math.round((ch(lit, sh) * ch(dim, sh)) / 255);
  for (const sh of [16, 8, 0]) assert.eq(ch(unlit, sh), composed(sh), `channel ${sh}`);
});

test('wreck dim: a restored house is exempt, lit or not', () => {
  const s = scene({ isClaimedKey: () => true });
  assert.eq(Render.spriteTint(house(NEAR, 0), s), 0xffffff, 'yours, in the light');
  assert.eq(Render.spriteTint(house(FAR, 0), s), 0xffffff, 'yours, out of it');
});

test('wreck dim: the dim is the ground pass\'s own, not a number of its own', () => {
  // Colour and alpha both come off the scene the drawCells wash reads: the
  // biome's eased `dim` on the surface, black underground, deepening per level.
  const surf = scene();
  assert.eq(Render.reachDimColor(surf), 0x1a2a1e, 'the surface takes the biome\'s dim');
  assert.eq(Render.reachDimAlpha(surf), 0.38, 'at the wash\'s own alpha');
  const cave = scene({ depth: 2 });
  assert.eq(Render.reachDimColor(cave), 0x000000, 'underground is pure black');
  assert.gt(Render.reachDimAlpha(cave), Render.reachDimAlpha(scene({ depth: 1 })),
    'and deepens with every level down');
  // The tint is that wash expressed as a multiply — white when there is no
  // wash at all, and never brighter than the wash it stands for.
  assert.eq(Render.reachDimTint(scene({ _atmos: { dim: 0xffffff } })), 0xffffff,
    'a white dim is no dim');
  assert.lt(luma(Render.reachDimTint(cave)), luma(Render.reachDimTint(surf)),
    'a cave dims a wreck harder than daylight does');
});

test('wreck dim: no reach at all (out of energy) is not a dark map of wrecks', () => {
  // reachRadiusM returns 0 on empty energy — every cell is unlit, including
  // the one the player stands in. That is the ground's behaviour, and the
  // wreck follows it rather than special-casing itself out of it.
  const flat = scene({ save: { energy: 0 } });
  const tired = Render.spriteTint(house(NEAR, 0), flat);
  const rested = Render.spriteTint(house(NEAR, 0), scene());
  assert.lt(luma(tired), luma(rested), 'an exhausted player sees the wreck under the same wash');
});

test('wreck dim: the derelict wash still lands on a lit wreck', () => {
  // The dim is ADDED to the existing rule, it does not become it: a wreck in
  // the light is still washed toward the derelict green.
  const s = scene();
  const wreck = Render.spriteTint(house(NEAR, 0), s);
  assert.truthy(wreck !== 0xffffff, 'a lit wreck is still tinted');
  assert.gt(ch(wreck, 8), ch(wreck, 16), 'toward green, not grey');
});

test('wreck dim: only houses take it', () => {
  // Every other sprite keeps the exemption — reach dims their ground, distance
  // dims them. A tree outside the bubble is still an untinted tree.
  const s = scene();
  const tree = { kind: 'tree', id: 't1', x: FAR, y: 0 };
  assert.eq(Render.spriteTint(tree, s), 0xffffff, 'a distant tree is untinted');
});

})();
