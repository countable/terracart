// Fog of war (src/fog.js) — the per-tile explored-cell bitsets.
//
// The feature is "land you have never walked is 80% black until you go there".
// Almost all of it is storage: a bit per 7 m cell, packed per tile, run-length
// coded and base64'd into the save. These pin the parts that are easy to get
// quietly wrong — the reveal radius (which has a hard ceiling nobody would
// guess from reading fog.js alone), tile-boundary indexing, and the codec's
// round trip.

const W = 64;   // a small stand-in for cellsPerTile (~228 in the real world)

// Each test starts from a clean, empty save at the same width.
function fresh() {
  const save = {};
  Fog.init(save, W);
  return save;
}

test('fog: the reveal radius stays INSIDE the viewport', () => {
  // The one that would silently kill the feature. The viewport is VIEW_CELLS
  // (11) wide, so the player sees 5 cells in every direction. Reveal 5 or more
  // and every cell is revealed the instant it becomes visible: the fog would
  // still be computed, still be stored, and never once be seen.
  assert.lt(Fog.REVEAL_CELLS, (VIEW_CELLS - 1) / 2,
    'a reveal radius at or past the viewport half-width makes the fog invisible');
  assert.gt(Fog.REVEAL_CELLS, 0, 'a zero radius reveals only the cell underfoot');
});

test('fog: nothing is revealed before the player walks', () => {
  fresh();
  assert.eq(Fog.seen(0, 0, 10, 10), false, 'a fresh save starts fully fogged');
  assert.eq(Fog.maskFor(0, 0), null, 'an untouched tile allocates no mask at all');
});

test('fog: standing somewhere reveals a disc around it', () => {
  fresh();
  const R = Fog.REVEAL_CELLS;
  Fog.reveal(30, 30);
  assert.eq(Fog.seen(0, 0, 30, 30), true, 'the cell underfoot is revealed');
  assert.eq(Fog.seen(0, 0, 30 + R, 30), true, 'and the cell at the radius, on-axis');
  assert.eq(Fog.seen(0, 0, 30 + R + 1, 30), false, 'but not one past it');
  // A disc, not a square: the far corner is R*sqrt(2) away, outside the radius.
  assert.eq(Fog.seen(0, 0, 30 + R, 30 + R), false, 'the corners of the box stay fogged');
});

test('fog: re-walking known ground is a no-op', () => {
  fresh();
  assert.eq(Fog.reveal(30, 30), true, 'the first step reveals');
  assert.eq(Fog.reveal(30, 30), false, 'standing still changes nothing');
  const rev = Fog.revision;
  Fog.reveal(31, 30);
  Fog.reveal(30, 30);      // step back onto ground already revealed
  assert.eq(Fog.revision, rev + 1,
    'the revision only moves when a cell is genuinely newly revealed');
});

test('fog: a reveal that straddles a tile edge marks BOTH tiles', () => {
  fresh();
  // Stand on the last cell of tile 0 so the disc spills into tile 1.
  Fog.reveal(W - 1, 40);
  assert.eq(Fog.seen(0, 0, W - 1, 40), true, 'the near side, in tile 0');
  assert.eq(Fog.seen(1, 0, 0, 40), true, 'the far side, in tile 1');
  assert.eq(Fog.maskFor(1, 0) !== null, true, 'tile 1 got its own mask');
});

test('fog: cells west and north of the origin land in the right tile', () => {
  // Floor-division, not truncation. Absolute cell -1 belongs to tile -1 (its
  // last cell), not to tile 0 — truncating toward zero would fold the whole
  // western hemisphere onto the origin tile and reveal fog on the wrong side
  // of the player.
  fresh();
  Fog.reveal(-1, -1);
  assert.eq(Fog.seen(-1, -1, W - 1, W - 1), true,
    'absolute cell (-1,-1) is the LAST cell of tile (-1,-1)');
  assert.eq(Fog.seen(0, 0, 0, 0), true,
    'and the disc still reaches the origin tile');
});

test('fog: what was revealed survives a save round trip', () => {
  const save = fresh();
  Fog.reveal(30, 30);
  Fog.reveal(W + 5, 30);          // a second tile, so the map has two entries
  Fog.flush(save);
  assert.eq(typeof save.fog.tiles['0/0'], 'string', 'tile 0 persisted');
  assert.eq(save.fog.w, W, 'the width it was built at is recorded');

  Fog.init({}, W);                              // wipe
  assert.eq(Fog.seen(0, 0, 30, 30), false, 'wiped');
  Fog.init(save, W);                            // reload
  assert.eq(Fog.seen(0, 0, 30, 30), true, 'reloaded from the save');
  assert.eq(Fog.seen(1, 0, 5, 30), true, 'both tiles reloaded');
  assert.eq(Fog.seen(0, 0, 0, 0), false, 'and the unexplored cells stayed unexplored');
});

test('fog: a save written at a different tile width is dropped, not mis-indexed', () => {
  const save = fresh();
  Fog.reveal(30, 30);
  Fog.flush(save);
  // Same blobs, different cells-per-tile: every bit now means a different cell.
  // Re-revealing as the player walks is right; drawing someone else's fog is not.
  Fog.init(save, W * 2);
  assert.eq(Fog.seen(0, 0, 30, 30), false, 'the stale-width masks are discarded');
});

test('fog: an all-zero mask never reaches the save', () => {
  const save = fresh();
  Fog.flush(save);
  assert.eq(Object.keys(save.fog.tiles).length, 0,
    'a session that revealed nothing writes no tile blobs');
});

// ── The codec ─────────────────────────────────────────────────────────────
// A bitset is 6.5 KB at the real tile width and mostly zeros — a player walks
// corridors through a tile, they don't fill it. The zero-run coder is what
// keeps a barely-visited tile at a few hundred bytes instead of 8.7 KB of
// base64 padding, so its round trip has to be exact.

test('fog: the run-length codec round-trips', () => {
  const cases = [
    new Uint8Array(0),
    new Uint8Array(300),                                  // all zeros, past one run
    Uint8Array.from([1, 2, 3]),                           // no zeros at all
    Uint8Array.from([0, 0, 7, 0, 9, 0, 0, 0]),            // mixed
    Uint8Array.from(Array.from({ length: 600 }, (_, i) => (i % 97 === 0 ? i & 0xff : 0))),
  ];
  for (const c of cases) {
    const back = Fog._rle.decode(Fog._rle.encode(c), c.length);
    assert.eq(back.length, c.length, 'length preserved');
    for (let i = 0; i < c.length; i++) {
      assert.eq(back[i], c[i], `byte ${i} of a ${c.length}-byte case`);
    }
  }
});

test('fog: a zero run longer than one byte can count is split, not truncated', () => {
  // 255 is the largest run the coder can name. A 600-zero block therefore has
  // to emit three runs; getting this wrong silently shortens the mask, which
  // reads as previously-explored land going dark again after a reload.
  const c = new Uint8Array(600);
  const back = Fog._rle.decode(Fog._rle.encode(c), 600);
  assert.eq(back.length, 600, 'all 600 bytes come back');
  assert.eq(back.every((b) => b === 0), true, 'and every one of them is zero');
});

test('fog: sparse exploration costs far less than the raw bitset', () => {
  // The whole reason the coder exists. One walked disc in a tile should not
  // cost anything like the tile's full 6.5 KB.
  const save = fresh();
  Fog.reveal(30, 30);
  Fog.flush(save);
  const raw = Math.ceil((W * W) / 8);
  assert.lt(save.fog.tiles['0/0'].length, raw,
    'a single revealed disc packs smaller than the uncompressed mask');
});

test('fog: flushing again reuses the blob of every tile that did not change', () => {
  // The reveal fires once per 7 m walked and flushes the whole save each time.
  // Without a per-tile blob cache that is a full re-code of every loaded tile
  // (64 of them, 6.5 KB each at the real width) for the sake of the few bytes
  // that actually moved.
  const save = fresh();
  Fog.reveal(30, 30);
  Fog.reveal(W + 5, W + 5);          // a second, far-away tile
  Fog.flush(save);
  const stale = save.fog.tiles['1/1'];

  Fog.reveal(31, 30);                // walk on, inside tile 0/0 only
  Fog.flush(save);
  assert.eq(save.fog.tiles['1/1'] === stale, true,
    'the untouched tile keeps the exact blob string from the previous flush');
  assert.eq(save.fog.tiles['0/0'] !== undefined, true, 'the walked tile is still written');
});

test('fog: a reloaded save does not re-code every tile on its first flush', () => {
  const save = fresh();
  Fog.reveal(30, 30);
  Fog.flush(save);
  const before = save.fog.tiles['0/0'];
  Fog.init(save, W);                 // fresh session, same save
  const after = {};
  Fog.flush(after);
  assert.eq(after.fog.tiles['0/0'] === before, true,
    'the blob read at load is handed straight back, not re-encoded');
});
