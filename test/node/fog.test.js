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
  // The sweep arms are pinned to EXACTLY one past the half-width: the view
  // scrolls by sub-cell fractions, so up to VIEW_CELLS + 1 columns intersect
  // it and the outermost, partially-visible one sits a cell past the
  // half-width. Anything shorter re-grows the near-black band parked on the
  // phone's screen edge that read as the app being letterboxed (at the
  // half-width exactly, a half-cell sliver of it); anything longer reveals
  // only wholly off-screen ground. The disc staying under the half-width is
  // what keeps the fog visible at all; the arms clearing the walked rank to
  // the screen edge is what keeps it off the screen edges.
  assert.eq(Fog.REVEAL_ARM_CELLS, (VIEW_CELLS + 1) / 2,
    'the sweep arms cover every column that can intersect the walked rank');
});

test('fog: nothing is revealed before the player walks', () => {
  fresh();
  assert.eq(Fog.seen(0, 0, 10, 10), false, 'a fresh save starts fully fogged');
  assert.eq(Fog.maskFor(0, 0), null, 'an untouched tile allocates no mask at all');
});

test('fog: standing somewhere reveals a disc plus the sweep arms', () => {
  fresh();
  const R = Fog.REVEAL_CELLS, ARM = Fog.REVEAL_ARM_CELLS;
  Fog.reveal(30, 30);
  assert.eq(Fog.seen(0, 0, 30, 30), true, 'the cell underfoot is revealed');
  assert.eq(Fog.seen(0, 0, 30 + R, 30), true, 'the cell at the disc radius, on-axis');
  // On-axis the arm carries past the disc to the viewport edge — the walked
  // row opens edge to edge (the phone letterbox fix), both axes.
  assert.eq(Fog.seen(0, 0, 30 + ARM, 30), true, 'the arm reaches the viewport half-width');
  assert.eq(Fog.seen(0, 0, 30, 30 + ARM), true, 'on the vertical axis too');
  assert.eq(Fog.seen(0, 0, 30 + ARM + 1, 30), false, 'but not past the screen edge');
  // The arms are one cell thick: a step off the axis is disc rules again.
  assert.eq(Fog.seen(0, 0, 30 + R + 1, 30 + 1), false, 'off-axis, past the disc, stays fogged');
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

// ── The onboarding trail ──────────────────────────────────────────────────
// Shipping fog of war hid the starter crates. The trail is a SIGHTLINE CHAIN
// — walk to the crate you can see, and the next one is in view, and the last
// puts the relic chest in view — and _placeStarterTrail seats it on the
// nearest road, BFS'ing up to 15 cells from the player's home anchor. The
// walk's own reveal is 3 cells, so on a brand-new save every crate sat under
// the 80% wash and the quest pointed at a road nobody could see.
//
// app.js._revealStarterTrail lifts the fog off it at seating time. These pin
// the geometry so a later retune of either number can't quietly re-hide it.

test('fog: the home reveal covers the tutorial pocket', () => {
  // _placeStarterTrail strips and curates a CLEAR_R (= HomeArea.POCKET_CELLS)
  // Chebyshev pocket around the anchor. That is the ground the player starts
  // standing on and is explicitly not discovering, so the reveal covers all
  // of it.
  assert.gte(HOME_REVEAL_CELLS, HomeArea.POCKET_CELLS,
    'the home reveal must cover the pocket the seater clears');
});

test('fog: the home reveal covers the starter ring that is on screen', () => {
  // The pocket is only the bald part. The ring of trees and rocks seated
  // immediately outside it is what the opening screen actually shows, and a
  // reveal that stopped at the pocket would hand the player a lit clearing
  // rimmed by a wash — the ring drawn at 20% under fog, which is how it went
  // missing before. Everything inside the rendered frame must come out lit.
  assert.gte(HOME_REVEAL_CELLS, (VIEW_CELLS + 1) / 2,
    'the ring in frame at spawn must not be seated under the fog wash');
});

test('fog: the home reveal reaches past the opening screen', () => {
  // If home reveals less than the viewport half-width, the player spawns
  // looking at a ring of fog around their own house.
  assert.gt(HOME_REVEAL_CELLS, (VIEW_CELLS - 1) / 2,
    'the opening screen should not be rimmed with fog around the spawn');
});

test('fog: a crate anywhere the seater can reach comes out unfogged', () => {
  // The BFS bound is 15 cells CHEBYSHEV from the anchor, so the furthest a
  // crate can land is the corner of that square. Reveal a home disc and a
  // trail disc at that corner, exactly as _revealStarterTrail does, and the
  // crate's own cell plus its immediate surroundings must read as explored.
  fresh();
  // Kept inside tile 0/0 so seen()'s LOCAL cell indices are the absolute ones.
  const HOME = 20;
  Fog.revealDisc(HOME, HOME, HOME_REVEAL_CELLS);
  const far = HOME + 15;                       // the far corner of the BFS square
  Fog.revealDisc(far, far, TRAIL_REVEAL_CELLS);
  assert.eq(Fog.seen(0, 0, far, far), true, 'the crate cell itself');
  assert.eq(Fog.seen(0, 0, far + 1, far), true, 'and the ground beside it');
  assert.eq(Fog.seen(0, 0, HOME, HOME), true, 'home is still revealed too');
});

test('fog: the trail reveal is a margin, not a map', () => {
  // The counterpart bound. Revealing the trail must not hand over the whole
  // neighbourhood — walking the crates is what opens the map up.
  assert.lt(TRAIL_REVEAL_CELLS, VIEW_CELLS,
    'a trail disc wider than the screen reveals map the player has not earned');
  fresh();
  Fog.revealDisc(20, 20, TRAIL_REVEAL_CELLS);
  assert.eq(Fog.seen(0, 0, 20 + TRAIL_REVEAL_CELLS + 1, 20), false,
    'ground past the margin stays fogged');
});

test('fog: revealDisc is the same primitive the walk uses', () => {
  // reveal() is revealDisc at REVEAL_CELLS, plus the two sweep arms, plus the
  // changed-cell debounce. Rebuild that exact shape out of revealDisc alone
  // (a radius-0 disc is one cell) — if the two ever diverge, the trail and
  // the walk would disagree about what "revealed" means.
  const a = fresh();
  Fog.reveal(50, 50);
  Fog.flush(a);
  const b = fresh();
  Fog.revealDisc(50, 50, Fog.REVEAL_CELLS);
  for (let d = -Fog.REVEAL_ARM_CELLS; d <= Fog.REVEAL_ARM_CELLS; d++) {
    Fog.revealDisc(50 + d, 50, 0);
    Fog.revealDisc(50, 50 + d, 0);
  }
  Fog.flush(b);
  assert.eq(a.fog.tiles['0/0'], b.fog.tiles['0/0'],
    'a walk step reveals exactly its disc plus its two arms');
});
