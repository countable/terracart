// Headless tests for the plain-rock promise: WHAT THE ART SHOWS IS WHAT IT
// DROPS. The mineralrock sheet's four plain-rock looks are not interchangeable
// — row 15 col 3 draws a PAIR of stones, cols 4..6 draw one — and until Sep
// 2026 the variant was a cosmetic hash while every rock dropped the same
// randInt(1,3), so a pair could pay one rock and a lone pebble could pay three.
//
// The fix is one table (SpriteLayout.PLAIN_ROCK_VARIANTS): render.js picks the
// frame from `col`, interactables.js rolls the yield off `stones`. These tests
// pin BOTH sides against that table, so the frame and the payout can't drift
// apart the way they did.

const PRV = SpriteLayout.PLAIN_ROCK_VARIANTS;
const PLAIN_ROCK_ROW = 15, MINERALROCK_COLS = 11;

// Mine one plain rock and return how many rockfruit it dropped. `o` decides
// the variant (x+y for a surface rock, caveVariant for a cave one).
function mineOnce(o) {
  const scene = makeScene();
  const save = { relics: { pick: { tier: 7 } } };
  const res = runInteractable(makeCtx(scene, save), o);
  assert.eq(res, true, 'tap consumed');
  return scene.invCount('rockfruit');
}

// A surface plain rock whose cell hashes to variant `v`.
const surfaceRock = (v, i) => ({ kind: 'mineralrock', id: `mr-s${v}-${i}`, x: v, y: 0, yieldTier: 1 });
// A cave plain rock wearing variant `v`.
const caveRock = (v, i) => ({ kind: 'mineralrock', id: `mr-c${v}-${i}`, x: 0, y: 0, caveVariant: v });

// --- The payout follows the art --------------------------------------------
PRV.forEach((variant, v) => {
  test(`plain rock: variant ${v} (col ${variant.col}, ${variant.stones} stone${variant.stones > 1 ? 's' : ''}) drops ${variant.stones}-${variant.stones + 1}`, () => {
    const seen = new Set();
    for (let i = 0; i < 400; i++) {
      const qty = mineOnce(surfaceRock(v, i));
      assert.inRange(qty, variant.stones, variant.stones + 1,
        `variant ${v} yield tracks its ${variant.stones} drawn stone(s)`);
      seen.add(qty);
    }
    // Both ends of the range must actually occur, or the roll has collapsed to
    // a constant and the range above is vacuously true.
    assert.eq(seen.size, 2, `variant ${v} rolls both ${variant.stones} and ${variant.stones + 1}`);
  });

  test(`plain rock: variant ${v} draws the frame it pays for`, () => {
    const o = surfaceRock(v, 0);
    // The SAME object must resolve to the same row of the table on both sides:
    // the frame the renderer draws and the stone count the loot pays.
    assert.eq(SpriteLayout.plainRockFrame(o), PLAIN_ROCK_ROW * MINERALROCK_COLS + variant.col,
      'frame is row 15 of the variant it was assigned');
    assert.eq(SpriteLayout.plainRockStones(o), variant.stones,
      'stone count comes from that same variant');
  });

  test(`plain rock: cave variant ${v} reads the same table as a surface rock`, () => {
    const o = caveRock(v, 0);
    assert.eq(SpriteLayout.plainRockFrame(o), PLAIN_ROCK_ROW * MINERALROCK_COLS + variant.col,
      'cave rock picks its frame from the shared table');
    for (let i = 0; i < 100; i++) {
      assert.inRange(mineOnce(caveRock(v, i)), variant.stones, variant.stones + 1,
        'cave rock pays what its art shows');
    }
  });
});

// --- The pair genuinely out-yields a single --------------------------------
test('plain rock: the pair variant beats every single variant, always', () => {
  const pair = PRV.find((p) => p.stones === 2);
  const singles = PRV.filter((p) => p.stones === 1);
  assert.truthy(pair, 'the table still has a pair-of-stones variant');
  assert.truthy(singles.length > 0, 'the table still has single-stone variants');
  // A pair's WORST roll must be at least a single's BEST roll — otherwise the
  // art still lies some of the time, which is the whole bug.
  assert.gte(pair.stones, Math.max(...singles.map((s) => s.stones + 1)),
    'the pair floor is at or above the single ceiling');
});

// --- Drift guard on the "2 stones" claim ------------------------------------
// The pair is a SINGLE connected blob (its two stones touch), so no pixel pass
// can count them — `stones: 2` is authored. What CAN be checked is that the
// frame it names is still the visibly widest of the four: tools/sprite_audit.js
// re-decodes the real PNGs into ART_BOUNDS, so if the sheet is ever re-cut and
// col 3 stops being the wide double rock, this fails.
test('plain rock: the pair frame is still the widest art of the four', () => {
  const widthOf = (variant) => {
    const bb = SpriteLayout.ART_BOUNDS[`mineralrock:${PLAIN_ROCK_ROW * MINERALROCK_COLS + variant.col}`];
    assert.truthy(bb, `ART_BOUNDS has an entry for plain rock col ${variant.col}`);
    return bb.maxX - bb.minX;
  };
  const pair = PRV.find((p) => p.stones === 2);
  const pairW = widthOf(pair);
  for (const s of PRV.filter((p) => p.stones === 1)) {
    assert.gt(pairW, widthOf(s),
      `the pair (col ${pair.col}) is wider than single col ${s.col} — art matches the table`);
  }
});

// --- The cave WALL keeps its flat roll --------------------------------------
test('cave wall dig: no sprite, no promise — still a flat 1-3', () => {
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    const scene = makeScene();
    // stones = null is the "this face draws no rock" case (src/interact.js).
    const qty = plainRockBaseDrop(scene, null);
    assert.inRange(qty, 1, 3, 'wall rubble keeps the pre-2026 flat range');
    assert.eq(scene.invCount('rockfruit'), qty, 'returned qty is what went in the bag');
    seen.add(qty);
  }
  assert.eq(seen.size, 3, 'all of 1/2/3 occur');
});

// --- The toast tells the truth ----------------------------------------------
// The plain-rock branch used to flash "+1 Rock" while handing over up to three
// — the one loot path that under-reported itself. The flash must carry the
// count that actually landed in the bag.
test('plain rock: the loot toast reports the real stone count', () => {
  for (let i = 0; i < 200; i++) {
    let flashed = null;
    const scene = makeScene({ flashLoot: (msg, _c, _n, id) => { flashed = { msg, id }; } });
    const save = { relics: { pick: { tier: 7 } } };
    runInteractable(makeCtx(scene, save), surfaceRock(0, `toast${i}`));
    assert.truthy(flashed, 'a loot toast fired');
    if (flashed.id !== 'rockfruit') continue;   // a cracked-open bar upstages the stones
    const m = /^\+(\d+)/.exec(flashed.msg);
    assert.truthy(m, `toast leads with a count: ${flashed.msg}`);
    assert.eq(Number(m[1]), scene.invCount('rockfruit'),
      `toast "${flashed.msg}" matches the rockfruit actually awarded`);
  }
});
