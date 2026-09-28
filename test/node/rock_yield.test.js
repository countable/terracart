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
// the variant (a hash of the id for a surface rock, caveVariant for a cave one).
function mineOnce(o) {
  const scene = makeScene();
  const save = { relics: { pick: { tier: 7 } } };
  const res = runInteractable(makeCtx(scene, save), o);
  assert.eq(res, true, 'tap consumed');
  return scene.invCount('rockfruit');
}

// A surface plain rock whose ID hashes to variant `v`: walk candidate ids
// (the tile+cell shape worldgen mints) until the shipping hash lands on it.
const surfaceRock = (v, i) => {
  for (let k = 0; ; k++) {
    const id = `mineralrock_12_34_${i}_${k}`;
    const o = { kind: 'mineralrock', id, x: 0, y: 0, yieldTier: 1 };
    if (SpriteLayout.plainRockFrame(o) === 15 * 11 + PRV[v].col) return o;
  }
};
// A cave plain rock wearing variant `v`.
const caveRock = (v, i) => ({ kind: 'mineralrock', id: `mr-c${v}-${i}`, x: 0, y: 0, caveVariant: v });

// --- The payout follows the art --------------------------------------------
PRV.forEach((variant, v) => {
  test(`plain rock: variant ${v} (col ${variant.col}, ${variant.stones} stone${variant.stones > 1 ? 's' : ''}) drops exactly ${variant.stones}`, () => {
    for (let i = 0; i < 400; i++) {
      assert.eq(mineOnce(surfaceRock(v, i)), variant.stones,
        `variant ${v} pays exactly its ${variant.stones} drawn stone(s)`);
    }
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
      assert.eq(mineOnce(caveRock(v, i)), variant.stones, 'cave rock pays what its art shows');
    }
  });
});

// --- The variant is the world's, not the save frame's ----------------------
test('plain rock: a surface rock\'s variant is keyed on its id, never its metres', () => {
  // x/y are in each save's own frame; the id (tile + tile-grid cell) is not.
  // The same rock moved to any metres keeps its look and its yield.
  for (let i = 0; i < 50; i++) {
    const id = `mineralrock_7_-3_${i}_${(i * 7) % 40}`;
    const a = { kind: 'mineralrock', id, x: 12.5, y: 3 };
    const b = { kind: 'mineralrock', id, x: 90731.2, y: -4410.9 };
    assert.eq(SpriteLayout.plainRockFrame(a), SpriteLayout.plainRockFrame(b), id + ': the frame moved with the frame');
    assert.eq(SpriteLayout.plainRockStones(a), SpriteLayout.plainRockStones(b), id + ': the yield moved with the frame');
  }
  // …and the ids spread across the whole table, so no variant is dead.
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(SpriteLayout.plainRockFrame({ id: `mineralrock_1_1_${i}_0` }));
  assert.eq(seen.size, PRV.length, 'every variant is reachable from an id');
  // A cave rock's caveVariant still wins over its id.
  assert.eq(SpriteLayout.plainRockStones({ id: 'x', caveVariant: 0 }), PRV[0].stones, 'caveVariant first');
});

// --- The pair genuinely out-yields a single --------------------------------
test('plain rock: the pair variant beats every single variant, always', () => {
  const pair = PRV.find((p) => p.stones === 2);
  const singles = PRV.filter((p) => p.stones === 1);
  assert.truthy(pair, 'the table still has a pair-of-stones variant');
  assert.truthy(singles.length > 0, 'the table still has single-stone variants');
  // A pair must pay more than any single — otherwise the art lies.
  assert.gt(pair.stones, Math.max(...singles.map((s) => s.stones)), 'the pair out-pays every single');
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

// --- The cave WALL pays its own table ---------------------------------------
// One stone every dig, flint on CAVE_WALL_FLINT_P (30 %) — a tapped dig and
// the auto-mine both through caveWallDrop.
test('cave wall dig: always one stone, flint on 30%', () => {
  let flint = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const scene = makeScene();
    assert.eq(caveWallDrop(scene), 1, 'one stone');
    assert.eq(scene.invCount('rockfruit'), 1, 'and one in the bag');
    flint += scene.invCount('coal');
  }
  assert.inRange(flint / N, 0.26, 0.34, 'flint on about 30% of digs');
  assert.truthy(/const qty = caveWallDrop\(scene\);/.test(INTERACT_SRC), 'the tapped dig pays it');
  assert.truthy(/const qty = caveWallDrop\(this\);/.test(APP_JS_SRC), 'and so does the auto-mine');
});

test('plain rock: flint on 10% of breaks', () => {
  let flint = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const scene = makeScene();
    plainRockBaseDrop(scene, 1);
    flint += scene.invCount('coal');
  }
  assert.inRange(flint / N, 0.075, 0.125, 'flint on about 10% of rocks');
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

// --- An explicit look: `rockVariant` wins over the cave variant and the id --
// The churchyard's rocks (src/zones.js) all wear ONE look; the generator
// says so on the rock, and both sides — the frame and the drop — follow it.
test('plain rock: an explicit rockVariant decides the frame AND the drop, over caveVariant and the id', () => {
  const v = SpriteLayout.CHURCHYARD_ROCK_VARIANT;
  assert.eq(PRV[v].stones, 1, 'the churchyard look is a single stone');
  for (let i = 0; i < 60; i++) {
    const o = { kind: 'mineralrock', id: `mrz_1_2_${i}_${i * 3}`, x: 0, y: 0, yieldTier: 1, rockVariant: v,
      caveVariant: (v + 1 + i) % PRV.length };
    assert.eq(SpriteLayout.plainRockFrame(o), PLAIN_ROCK_ROW * MINERALROCK_COLS + PRV[v].col, `${o.id}: its frame`);
    assert.eq(SpriteLayout.plainRockStones(o), PRV[v].stones, `${o.id}: its count`);
    if (i < 20) assert.eq(mineOnce(o), PRV[v].stones, `${o.id}: pays what it shows`);
  }
});
