// Home capture — whether a late first GPS fix may still become this save's
// permanent origin (app.js _worldPlaced + PROVISIONAL_ORIGIN_KEYS).
//
// A brand-new save has no origin until the player's first fix arrives. The
// world can't wait forever, so a 2-minute safety net in startGps unblocks
// PLACEMENT at the default origin — but the ADOPTION deliberately stays armed,
// so a fix that finally lands at three minutes (a cold start indoors, a new
// install, a permission dialog left sitting) still anchors the save where the
// player actually is. _worldPlaced() is the gate on that: once the save has
// committed something to the current origin, the origin is load bearing and a
// later fix must be ignored.
//
// THE BUG THIS PINS: the net's own side effects made _worldPlaced() true. It
// calls _setStarterCratesAt, which places the crate trail, which carves the
// soil plot and provisions the starter home — and starterPlotAt / starterHome
// were both counted as "placed". So within one frame of the net firing, the
// capture it had stayed armed for was disarmed, and the next fix was thrown
// away. Measured in a real browser: the fix landed at t+193 s, the save stayed
// at the default origin, and the player stood 13.7 km from their starter
// crates, Home and objective arrow — under ORIGIN_STRANDED_M, so not even a
// warning. "Newly joined players don't get starting crates."
//
// The starter kit is DERIVED from the origin and rebuilt from scratch at a new
// one, so none of it commits the save. What commits the save is what the
// PLAYER did: adopted a Home, tilled ground, planted a crop.
(() => {
  const hcScene = (save) => Object.assign({ save }, StarterHomeMethods);
  const placed = (save) => hcScene(save)._worldPlaced();

  test('home capture: a save that has done nothing is still open to a late fix', () => {
    assert.falsy(placed({}), 'an empty save commits nothing');
    assert.falsy(placed({ tilled: [], planted: [] }), 'nor do empty lists');
  });

  test('home capture: the provisional starter kit does not disarm the capture', () => {
    // Every one of these is written by a pass that runs BEFORE a home exists —
    // the safety net's own work. None may close the capture window.
    for (const k of PROVISIONAL_ORIGIN_KEYS) {
      const save = {};
      save[k] = (k === 'starterCratesAt' || k === 'starterPlotAt' || k === 'starterPondAt')
        ? { x: 1, y: 2 } : { v: 1, placed: [], tamed: [], done: true, tries: 1 };
      assert.falsy(placed(save), `${k} is provisional and must not disarm home capture`);
    }
  });

  test('home capture: the whole kit together still leaves the window open', () => {
    // The realistic shape: the net fired, froze the anchor, and the trail pass
    // carved the plot and provisioned the home in the same call.
    assert.falsy(placed({
      starterCratesAt: { x: 10, y: 20 },
      starterPlotAt: { x: 30, y: 40 },
      starterHome: { v: 1, placed: [{ k: 'tree', x: 1, y: 2, id: 'starter_tree_1_2' }], tamed: [], done: true, tries: 1 },
      starterPondAt: { x: 200, y: 180 },
    }), 'the safety net alone can never disarm the capture it stayed armed for');
  });

  test('home capture: what the PLAYER committed does close the window', () => {
    assert.truthy(placed({ starterShopId: 'house_42' }), 'an adopted Home');
    assert.truthy(placed({ starterTrailer: { id: 'trailer_1', x: 1, y: 2 } }), 'a dropped trailer');
    assert.truthy(placed({ tilled: ['3_4'] }), 'tilled ground');
    assert.truthy(placed({ planted: [{ x: 1, y: 2, id: 'potato' }] }), 'a planted crop');
  });

  test('home capture: the capture path clears exactly what _worldPlaced skips', () => {
    // Both read PROVISIONAL_ORIGIN_KEYS, so the two can't drift into the
    // disagreement that caused the bug: a field cleared on re-anchor but still
    // counted as commitment (or, worse, counted and never cleared).
    // run.js fails the whole suite if the clearing line is gone.
    assert.gt(PROVISIONAL_ORIGIN_KEYS.length, 0, 'the provisional list is not empty');
    const all = {};
    for (const k of PROVISIONAL_ORIGIN_KEYS) all[k] = { x: 1, y: 1 };
    assert.falsy(placed(all), 'nothing on the cleared list counts as placed');
  });
})();
