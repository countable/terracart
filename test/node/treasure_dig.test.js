// A dug-up X pays ONE find, on the spot — no pick.
//
// For a while in Sep 2026 an X opened the road ladder's "take your pick"
// dialog (two finds, keep one). It went back to a single roll: the ladder's
// pick (app.js _offerTreasurePick) is the only "several finds, keep one".
// app.js can't load headlessly, so the wiring is pinned as source text.

test('treasure dig: the mark is spent, then ONE roll pays from the X pool', () => {
  const src = INTERACT_SRC;
  // A mark may carry its own rollBonus (a hedgerow close's hoard —
  // StreetVariants.dress); discovery adds one tier to every mark.
  assert.truthy(/save\.foundTreasures = \[\.\.\.found, tr\.id\];[\s\S]{0,500}?\n\s*grantTreasureRoll\(scene, save, sx, sy, '✕', 'treasure:default',\s*\{ \.\.\.\(dig \|\| \{\}\), beachTreasure:[^\n]+\n\s*hiddenTreasure: true, rollBonus: 1 \+ Math\.max\(0, tr\.rollBonus \|\| 0\) \+ Math\.max\(0, dig\?\.rollBonus \|\| 0\) \}\);/.test(src),
    'the mark is spent (no reload re-roll), then the single roll pays, cave-skewed underground');
  assert.falsy(/digTreasurePick/.test(src), 'no pick on the dig');
  assert.falsy(/digTreasurePick/.test(SCENE_SRC), 'and no pick method left behind');
});

test('treasure dig: the pick lane is the road ladder\'s alone', () => {
  const n = (SCENE_SRC.match(/this\._offerTreasurePick\(\{/g) || []).length;
  assert.eq(n, 1, 'only _fireTrailPrize opens the pick');
});

test('treasure dig: authored beaches and ambient sand route one paid mark to beach loot', () => {
  const handler = TAP_HANDLERS.find(h => h.name === 'treasure');
  const cache = new Map(WorldGen.tileCache), grant = grantTreasureRoll, far = tooFar;
  try {
    tooFar = () => false;
    for (const [zone, terrain, beach] of [['beach', WorldGen.T.PARK, true],
      [undefined, WorldGen.T.SAND, true], [undefined, WorldGen.T.PARK, false]]) {
      const tr = { id: 'dig-test', x: 4, y: 4, zone };
      const save = { foundTreasures: [], hiddenDiscoveries: { [tr.id]: true } };
      const scene = makeScene({ save, cellM: WorldGen.CELL_M, cellsPerTile: 64,
        tileEdgeM: 64 * WorldGen.CELL_M, startWorldM: { x: 0, y: 0 },
        originPx: { x: 0, y: 0 }, mPerPx: 64 * WorldGen.CELL_M / WorldGen.TILE_PX,
        cellAt: () => ({ type: terrain }), digTreasureOpts: () => ({ depth: 0 }) });
      const ctx = { ...makeCtx(scene, save), wm: { x: tr.x, y: tr.y } };
      let rolls = 0;
      grantTreasureRoll = (s, sv, sx, sy, mark, context, opts) => {
        rolls++; assert.truthy(sv.foundTreasures.includes(tr.id), 'spent before reward');
        assert.eq(context, 'treasure:default'); assert.eq(opts.beachTreasure, beach);
        assert.eq(opts.hiddenTreasure, true); assert.eq(opts.rollBonus, 1);
      };
      WorldGen.tileCache.clear(); WorldGen.tileCache.set('dig-test', { extraTreasures: [tr] });
      assert.eq(handler.try(ctx), true); assert.eq(rolls, 1);
      assert.eq(handler.try(ctx), false); assert.eq(rolls, 1, 'no repeat payout');
    }
  } finally {
    grantTreasureRoll = grant; tooFar = far; WorldGen.tileCache.clear();
    for (const [key, value] of cache) WorldGen.tileCache.set(key, value);
  }
});
