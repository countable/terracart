// home_greeter.test.js — the ONE creature guaranteed beside the starting
// trailer: a chicken on easy, a slime on hard.
//
// What this suite is defending:
//
//  1. "ALWAYS" MEANS ALWAYS. The tile's biome roll is a lottery — a new save
//     can open onto a street with no fauna within three screens — so the first
//     living thing a player sees was luck. It is the mode's statement of what
//     kind of game this is, and it has to be there.
//
//  2. AND IT MEANS THE MODE'S OWN. A save reads as EASY until the how-to card
//     is answered, so a starter tile built before the answer stands a chicken
//     in a hard-mode yard. The placer swaps it rather than seating a second
//     one beside it.
//
//  3. IT STILL OBEYS THE ROAD RULE. "Guaranteed" is not a licence to stand an
//     animal on the carriageway. Both passes consult entry.roadMask — the
//     shared no-spawn footprint, which the terrain codes under-report — and a
//     greeter with nowhere legal to stand is simply not seated.
//
//  4. IT NEVER RE-SEATS WHAT THE PLAYER DEALT WITH. Kill the slime, catch the
//     chicken, and a tile rebuild must not put it back.
//
// The placer lives on the Phaser scene class and is lifted out of src/app.js
// as text by run.js, so these tests drive the real shipping code.

// Wrapped in an IIFE: every *.test.js shares one global scope in the runner.
(() => {
  const T = WorldGen.T;
  const N = 44;                 // cells per tile edge in these fixtures
  const CELL_M = 7;
  const TILE_EDGE_M = N * CELL_M;
  const ANCHOR = 21;            // the trailer's cell, with room for the ring

  // Scene stub carrying only what the placer touches.
  function hgScene(over = {}) {
    return Object.assign({
      save: { starterCratesAt: { x: (ANCHOR + 0.5) * CELL_M, y: (ANCHOR + 0.5) * CELL_M } },
      cellM: CELL_M,
      tileEdgeM: TILE_EDGE_M,
      _starterTrailAnchor() { return this.save.starterCratesAt; },
    }, over);
  }

  // A SPAWNED tile of uniform `fill` — _spawned is the gate the placer checks,
  // and seating onto an unspawned entry would hand spawnInTile a non-empty
  // creatures array whose `|| creatures` then drops the whole biome roll.
  function hgEntry(fill = T.GRASS, opts = {}) {
    return {
      cellsPerEdge: N,
      grid: new Uint8Array(N * N).fill(fill),
      objects: opts.objects || [],
      wildplants: opts.wildplants || [],
      roadMask: opts.roadMask || null,
      creatures: opts.creatures || [],
      _spawned: opts._spawned !== false,
    };
  }

  // Run the placer under a given mode, restoring the runner's mode after.
  const hgMode = (mode, fn) => {
    const was = Difficulty.mode();
    Difficulty.setMode(mode);
    try { return fn(); } finally { Difficulty.setMode(was); }
  };
  const hgPlace = (scene, entry, mode = 'easy') =>
    hgMode(mode, () => { placeHomeGreeter.call(scene, entry, 0, 0); return entry.creatures; });
  // The greeter among a tile's creatures — the one whose id carries the tag.
  const hgOf = (entry) => entry.creatures.filter(c => /_greeter_0_0$/.test(c.id));
  const hgCell = (c) => ({
    cx: Math.floor(c.x / CELL_M),
    cy: Math.floor(c.y / CELL_M),
  });
  const hgDist = (c) => {
    const p = hgCell(c);
    return Math.max(Math.abs(p.cx - ANCHOR), Math.abs(p.cy - ANCHOR));
  };

  // ── The guarantee ─────────────────────────────────────────────────────────

  test('home greeter: easy seats a chicken, hard seats a slime', () => {
    for (const [mode, kind] of [['easy', 'chicken'], ['hard', 'slime']]) {
      const entry = hgEntry();
      hgPlace(hgScene(), entry, mode);
      const got = hgOf(entry);
      assert.eq(got.length, 1, `${mode}: exactly one greeter`);
      assert.eq(got[0].kind, kind, `${mode} greets you with a ${kind}`);
      // And it is the table that said so — not a literal in the placer.
      assert.eq(Difficulty.PROFILES[mode].homeGreeter, kind,
        `${mode}'s greeter is declared in the difficulty table`);
    }
  });

  test('home greeter: it lands in the ring — off your feet, inside the view', () => {
    // The floor keeps a hard-mode slime from leeching before the first frame
    // draws; the ceiling keeps it inside the 11-cell viewport, so it is on
    // screen when the map paints.
    for (const mode of ['easy', 'hard']) {
      const entry = hgEntry();
      hgPlace(hgScene(), entry, mode);
      const d = hgDist(hgOf(entry)[0]);
      assert.gte(d, HOME_GREETER_MIN_CELLS, `${mode}: never underfoot`);
      assert.lte(d, HOME_GREETER_MAX_CELLS, `${mode}: never off screen`);
    }
    assert.lt(HOME_GREETER_MAX_CELLS, VIEW_CELLS / 2 + 1,
      'the ring stays inside the drawn viewport');
  });

  test('home greeter: the same anchor always seats it in the same cell', () => {
    // No rng at all — a placer that wandered between builds would move the
    // greeter every time the tile rebuilt under the player.
    const a = hgEntry(), b = hgEntry();
    hgPlace(hgScene(), a);
    hgPlace(hgScene(), b);
    assert.eq(JSON.stringify(hgCell(hgOf(a)[0])), JSON.stringify(hgCell(hgOf(b)[0])),
      'deterministic seating');
  });

  test('home greeter: a chicken can be shiny, a slime never is', () => {
    // Straight through faunaShiny — the one place the slime exception lives,
    // shared with the tile's own fauna roll.
    const entry = hgEntry();
    hgPlace(hgScene(), entry, 'hard');
    const slime = hgOf(entry)[0];
    assert.eq(slime.shiny, false, 'a shiny slime would promise a payout it has none of');
    assert.eq(faunaShiny('slime', slime.id), false, 'and the helper is what says so');
    assert.eq(faunaShiny('chicken', 'chicken_greeter_0_0'),
      isShiny('chicken_greeter_0_0', SHINY_RATE.animal), 'a chicken rolls like any animal');
  });

  // ── Idempotence, the mode race, and the player's own doing ────────────────

  test('home greeter: running the placer again seats no second one', () => {
    // It runs from three sites — spawnInTile, _setStarterCratesAt and
    // chooseMode — and any of them can fire after another already has.
    const entry = hgEntry();
    hgPlace(hgScene(), entry);
    hgPlace(hgScene(), entry);
    hgPlace(hgScene(), entry);
    assert.eq(hgOf(entry).length, 1, 'still exactly one');
  });

  test('home greeter: answering the card swaps the wrong mode\'s greeter', () => {
    // A fresh save reads as easy until the how-to card is answered, so a
    // starter tile built first is standing a chicken. Choosing hard must not
    // leave it there beside the slime.
    const entry = hgEntry();
    hgPlace(hgScene(), entry, 'easy');
    assert.eq(hgOf(entry)[0].kind, 'chicken', 'the default-easy greeter');
    hgPlace(hgScene(), entry, 'hard');
    const got = hgOf(entry);
    assert.eq(got.length, 1, 'the chicken is removed, not joined');
    assert.eq(got[0].kind, 'slime', 'and the mode\'s own is standing there');
  });

  test('home greeter: dealt with, it stays gone', () => {
    const scene = hgScene(), entry = hgEntry();
    hgPlace(scene, entry);
    const id = hgOf(entry)[0].id;
    // The player kills/catches it: resolveDefeat / the catch path bank the id.
    scene.save.caught = [id];
    entry.creatures = [];
    hgPlace(scene, entry);
    assert.eq(hgOf(entry).length, 0, 'a rebuild must not hand it back');
  });

  test('home greeter: taming it keeps the pet and seats no replacement', () => {
    // A sapphire on the hard-mode slime banks the wild id in save.caught and
    // re-mints the creature as a `released_` pet in place (interact.js
    // tameInPlace). The next rebuild must leave the pet alone and not stand a
    // fresh hostile slime next to it.
    const scene = hgScene(), entry = hgEntry();
    hgPlace(scene, entry, 'hard');
    const pet = hgOf(entry)[0];
    scene.save.caught = [pet.id];
    pet.id = 'released_slime_1757000000000_424242';   // what tameInPlace mints
    hgPlace(scene, entry, 'hard');
    assert.eq(entry.creatures.length, 1, 'no second slime beside the pet');
    assert.eq(entry.creatures[0].id, 'released_slime_1757000000000_424242',
      'and the pet is still standing there');
  });

  test('home greeter: it keeps the tile\'s own creatures', () => {
    const entry = hgEntry(T.GRASS, {
      creatures: [{ x: 0, y: 0, kind: 'cow', id: 'cow_0_0_1' }],
    });
    hgPlace(hgScene(), entry);
    assert.eq(entry.creatures.length, 2, 'the cow is untouched');
    assert.truthy(entry.creatures.some(c => c.id === 'cow_0_0_1'), 'by id');
  });

  test('home greeter: an unspawned tile is left alone', () => {
    // Seating onto an entry spawnInTile has not rolled yet would give its
    // `entry.creatures || creatures` a non-empty array to keep — and the whole
    // tile's fauna would be dropped for one bird.
    const entry = hgEntry(T.GRASS, { _spawned: false });
    hgPlace(hgScene(), entry);
    assert.eq(entry.creatures.length, 0, 'nothing seated before the roll');
  });

  test('home greeter: no anchor yet, no greeter', () => {
    // A fresh save still waiting on its first GPS fix has no frozen home.
    const scene = hgScene({ save: {} });
    scene._starterTrailAnchor = () => null;
    const entry = hgEntry();
    hgPlace(scene, entry);
    assert.eq(entry.creatures.length, 0, 'it waits for the anchor to freeze');
  });

  // ── The road rule ─────────────────────────────────────────────────────────

  test('home greeter: never on the road BAND, not just the road terrain', () => {
    // The terrain grid under-reports the road every time (CLAUDE.md): a way
    // rasterizes one cell wide however wide it is, and a parking aisle
    // rasterizes to none at all. entry.roadMask is the ground the player SEES
    // as road, and both of the placer's passes consult it.
    const mask = new Uint8Array(N * N);          // the whole ring is road band
    for (let cy = 0; cy < N; cy++) {
      for (let cx = 0; cx < N; cx++) {
        const d = Math.max(Math.abs(cx - ANCHOR), Math.abs(cy - ANCHOR));
        if (d >= HOME_GREETER_MIN_CELLS && d <= HOME_GREETER_MAX_CELLS) mask[cy * N + cx] = 1;
      }
    }
    const entry = hgEntry(T.GRASS, { roadMask: mask });   // grass terrain, road band
    hgPlace(hgScene(), entry);
    assert.eq(hgOf(entry).length, 0,
      'a greeter with nowhere legal to stand is not seated on the asphalt');
  });

  test('home greeter: it steps around the road band rather than onto it', () => {
    // Only the north half of the ring is band — it must take the south half.
    const mask = new Uint8Array(N * N);
    for (let cy = 0; cy < ANCHOR; cy++) for (let cx = 0; cx < N; cx++) mask[cy * N + cx] = 1;
    const entry = hgEntry(T.GRASS, { roadMask: mask });
    hgPlace(hgScene(), entry);
    const seat = hgCell(hgOf(entry)[0]);
    assert.eq(mask[seat.cy * N + seat.cx], 0, 'off the band');
    assert.gte(seat.cy, ANCHOR, 'on the clear side');
  });

  test('home greeter: it stands on nothing else drawn', () => {
    // A chicken inside a starter crate reads as a bug whichever the renderer
    // draws second. Fill the whole ring with objects but one cell.
    const objects = [];
    const free = { cx: ANCHOR + HOME_GREETER_MIN_CELLS, cy: ANCHOR };
    for (let cy = ANCHOR - HOME_GREETER_MAX_CELLS; cy <= ANCHOR + HOME_GREETER_MAX_CELLS; cy++) {
      for (let cx = ANCHOR - HOME_GREETER_MAX_CELLS; cx <= ANCHOR + HOME_GREETER_MAX_CELLS; cx++) {
        if (cx === free.cx && cy === free.cy) continue;
        objects.push({ kind: 'chest', x: (cx + 0.5) * CELL_M, y: (cy + 0.5) * CELL_M });
      }
    }
    const entry = hgEntry(T.GRASS, { objects });
    hgPlace(hgScene(), entry);
    assert.eq(JSON.stringify(hgCell(hgOf(entry)[0])), JSON.stringify(free),
      'the one cell with nothing on it');
  });

  test('home greeter: never on water or inside a building', () => {
    const entry = hgEntry(T.WATER);
    entry.grid.fill(T.WATER);
    hgPlace(hgScene(), entry);
    assert.eq(hgOf(entry).length, 0, 'a chicken does not stand on the lake');
  });

  // ── The call sites ────────────────────────────────────────────────────────

  test('home greeter: the shipping call sites cover all three races', () => {
    const app = APP_JS_SRC;
    // The starter tile's own build.
    assert.truthy(/this\._placeHomeGreeter\(entry, tx, ty\);/.test(SPAWN_IN_TILE_SRC),
      'spawnInTile seats it on the starter tile');
    // The anchor freezing after that tile already spawned, and the how-to card
    // being answered after the tile was built as default-easy. Both resolve
    // the starter tile through the one shared lookup.
    const setAt = app.slice(app.indexOf('  _setStarterCratesAt(x, y) {'));
    assert.truthy(/this\._starterTileEntry\(\)[\s\S]{0,300}_placeHomeGreeter/.test(setAt),
      '_setStarterCratesAt retro-places it');
    const choose = app.slice(app.indexOf('  chooseMode(mode) {'), app.indexOf('  _stripStarterCrates(entry) {'));
    assert.truthy(/this\._starterTileEntry\(\)[\s\S]{0,200}_placeHomeGreeter/.test(choose),
      'chooseMode corrects the greeter the default-easy read seated');
    // The kind is never spelled in app.js — it comes from the mode table.
    assert.truthy(/Difficulty\.get\(\)\.homeGreeter/.test(app),
      'the kind is read from the difficulty table');
    for (const lit of ["'chicken'", "'slime'"]) {
      assert.falsy(new RegExp(`homeGreeter[^\\n]*${lit}`).test(app),
        `app.js must not hard-code ${lit} as the greeter`);
    }
  });
})();
