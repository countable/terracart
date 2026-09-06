// A WRECK wears the derelict wash — and ONLY the derelict wash.
//
// The unclaimed house sprite is washed toward dark green with the rest of its
// footprint (drawCells paints the footprint; the roof is a pooled image above
// it, so the same shift is applied as a multiply tint here).
//
// Until Sep 2026 this function ALSO composed the out-of-reach dim onto a
// wreck by hand: the lighting layer sat below the sprites, every sprite was
// exempt from the dim, and a wreck's roof had to follow its darkened
// footprint or it read as a bright sticker on dark ground. The lightmap
// (src/lighting.js) sits ABOVE the sprites now and dims every one of them
// with the ground under it, so the sprite tint must NOT dim for reach any
// more — that would darken a wreck twice. The reach numbers this file still
// checks are the ones the lightmap derives its ambient from (see
// lighting.test.js), so they stay pinned here.
//
// Render.spriteTint is pure (object + scene in, a colour out), so all of it
// drives headlessly even though drawObjects itself needs Phaser.

(function () {

const ch = (c, sh) => (c >> sh) & 255;
const luma = (c) => 0.299 * ch(c, 16) + 0.587 * ch(c, 8) + 0.114 * ch(c, 0);

// cellM 5 m, reach measured from the player's own cell — a house at the origin
// is inside reach, one 50 m away is not. originPx/mPerPx are what coords.js
// projects world metres through.
function scene(over) {
  return Object.assign({
    startWorldM: { x: 0, y: 0 },
    playerM: { x: 0, y: 0 },
    originPx: { x: 0, y: 0 },
    mPerPx: 10,
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

test('wreck dim: the derelict wash lands on a wreck, in the light or out of it', () => {
  const s = scene();
  const wreck = Render.spriteTint(house(NEAR, 0), s);
  assert.truthy(wreck !== 0xffffff, 'a wreck is tinted');
  assert.gt(ch(wreck, 8), ch(wreck, 16), 'toward green, not grey');
  assert.eq(Render.spriteTint(house(FAR, 0), s), wreck,
    'the same tint outside reach — the lightmap does the dimming now, not the sprite');
});

test('wreck dim: a restored house is exempt, lit or not', () => {
  const s = scene({ isClaimedKey: () => true });
  assert.eq(Render.spriteTint(house(NEAR, 0), s), 0xffffff, 'yours, in the light');
  assert.eq(Render.spriteTint(house(FAR, 0), s), 0xffffff, 'yours, out of it');
});

test('wreck dim: reach and energy no longer touch the sprite tint', () => {
  // Every out-of-reach and out-of-energy state used to land here as a second
  // multiply. Now the lightmap owns all of it, and composing it again would
  // darken the roof twice against a footprint darkened once.
  const rested = Render.spriteTint(house(NEAR, 0), scene());
  assert.eq(Render.spriteTint(house(NEAR, 0), scene({ save: { energy: 0 } })), rested, 'out of energy');
  assert.eq(Render.spriteTint(house(FAR, 0), scene({ depth: 2 })), rested, 'underground, out of reach');
});

test('wreck dim: the reach numbers the lightmap derives from are the wash\'s own', () => {
  // Colour and alpha come off the scene as the old drawCells wash read them:
  // the biome's eased `dim` on the surface, black underground, deepening per
  // level. Lighting.profile builds its ambient and plateau from exactly these.
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
    'a cave dims harder than daylight does');
});

test('wreck dim: only houses take it', () => {
  const s = scene();
  const tree = { kind: 'tree', id: 't1', x: FAR, y: 0 };
  assert.eq(Render.spriteTint(tree, s), 0xffffff, 'a distant tree is untinted');
});

})();
