// Chest tier vs distance from Home (loot.js chestTier / chestTierHomeDrop).
//
// A chest's BASE tier is a fixed lookup from its POI class. Near Home it is
// demoted one tier per ring of CHEST_TIER_HOME_RINGS_M it stands inside —
// within 700 m is one down, within 350 m is two — and never below T1, so the
// lowtier boxes are untouched. Home is HomeArea.worldM, the spawn origin in
// the same world-metre frame every object's x/y lives in; when it isn't set
// (headless, or before the scene publishes it) nothing is demoted.
//
// Every reader resolves through chestTier(poiClass, x, y): the sprite/gem in
// render.js and the loot roll in interactables.js — so a chest can't draw as
// one tier and pay as another. The source sweep at the bottom pins that no
// caller has fallen back to the position-less lookup.
(() => {
  const HX = 100000, HY = 200000;
  const withHome = (fn) => {
    const prev = HomeArea.worldM;
    HomeArea.setOrigin(HX, HY);
    try { fn(); } finally { HomeArea.worldM = prev; }
  };
  // A point `d` metres due east of Home.
  const east = (d) => [HX + d, HY];

  test('chest tier: the rings are 700 m then 350 m', () => {
    assert.eq(JSON.stringify(CHEST_TIER_HOME_RINGS_M), '[700,350]', 'rings');
  });

  test('chest tier: no origin → no demotion', () => {
    const prev = HomeArea.worldM;
    HomeArea.worldM = null;
    try {
      assert.eq(chestTierHomeDrop(0, 0), 0, 'drop without an origin');
      assert.eq(chestTier('florist', 0, 0), 4, 'flora keeps T4');
      assert.eq(chestTier('florist'), 4, 'position-less lookup is the base tier');
    } finally { HomeArea.worldM = prev; }
  });

  test('chest tier: one tier down inside 700 m, two inside 350 m', () => withHome(() => {
    assert.eq(chestTierHomeDrop(...east(1000)), 0, 'beyond 700 m');
    assert.eq(chestTierHomeDrop(...east(700)),  1, 'on the 700 m ring counts as inside');
    assert.eq(chestTierHomeDrop(...east(701)),  0, 'just outside 700 m');
    assert.eq(chestTierHomeDrop(...east(500)),  1, 'between the rings');
    assert.eq(chestTierHomeDrop(...east(350)),  2, 'on the 350 m ring');
    assert.eq(chestTierHomeDrop(...east(100)),  2, 'deep inside');
    assert.eq(chestTierHomeDrop(HX, HY),        2, 'at Home itself');
  }));

  test('chest tier: the drop is radial, not axis-aligned', () => withHome(() => {
    // 300 m at 45°: hypot ≈ 424 m — inside 700, outside 350.
    assert.eq(chestTierHomeDrop(HX + 300, HY + 300), 1, 'diagonal 424 m');
    // 500 m at 45°: hypot ≈ 707 m — outside both.
    assert.eq(chestTierHomeDrop(HX + 500, HY - 500), 0, 'diagonal 707 m');
  }));

  test('chest tier: every class demotes by ring, floored at T1', () => withHome(() => {
    const bands = [[1000, 0], [500, 1], [100, 2]];
    for (const cls of Object.keys(POI_CATEGORY)) {
      const base = CHEST_TIER_BY_CATEGORY[POI_CATEGORY[cls]] || 2;
      for (const [d, drop] of bands) {
        const t = chestTier(cls, ...east(d));
        assert.eq(t, Math.max(1, base - drop), cls + ' at ' + d + ' m');
        assert.gte(t, 1, cls + ' never below T1');
        assert.lte(t, base, cls + ' never above its base');
      }
    }
  }));

  test('chest tier: worked examples — flora, civic, park, lowtier', () => withHome(() => {
    assert.eq(chestTier('florist', ...east(1000)), 4, 'flora far out is T4');
    assert.eq(chestTier('florist', ...east(500)),  3, 'flora inside 700 m is T3');
    assert.eq(chestTier('florist', ...east(100)),  2, 'flora inside 350 m is T2');
    assert.eq(chestTier('school',  ...east(500)),  2, 'civic inside 700 m is T2');
    assert.eq(chestTier('school',  ...east(100)),  1, 'civic inside 350 m is T1');
    assert.eq(chestTier('park',    ...east(500)),  1, 'park inside 700 m is already the floor');
    assert.eq(chestTier('park',    ...east(100)),  1, 'park inside 350 m stays T1');
    assert.eq(chestTier('bus',     ...east(100)),  1, 'lowtier is as it was');
    assert.eq(chestTier('bus',     ...east(1000)), 1, 'lowtier is as it was, far out too');
  }));

  test('chest tier: an unknown class falls back to T2 and still demotes', () => withHome(() => {
    assert.eq(chestTier('no_such_class', ...east(1000)), 2, 'fallback base');
    assert.eq(chestTier('no_such_class', ...east(500)),  1, 'fallback demoted');
    assert.eq(chestTier(undefined, ...east(100)),        1, 'no class at all');
  }));

  test('chest tier: every shipping reader passes the chest position', () => {
    const sources = { 'render.js': RENDER_SRC, 'interactables.js': INTERACTABLES_SRC };
    for (const [f, src] of Object.entries(sources)) {
      const calls = src.match(/chestTier\(o\.poiClass[^)]*\)/g) || [];
      assert.gt(calls.length, 0, f + ' resolves chest tiers through chestTier');
      for (const c of calls) {
        assert.eq(c, 'chestTier(o.poiClass, o.x, o.y)', f + ': ' + c + ' must pass o.x, o.y');
      }
    }
  });
})();
