// home_greeter.test.js — the creatures guaranteed around the starting
// trailer: a chicken in the yard on easy, a slime on each side on hard.
//
// What this suite is defending:
//
//  1. "ALWAYS" MEANS ALWAYS. The tile's biome roll is a lottery — a new save
//     can open onto a street with no fauna within three screens — so the first
//     living thing a player sees was luck. It is the mode's statement of what
//     kind of game this is, and it has to be there.
//
//  2. AND IT MEANS THE MODE'S OWN — its kind, its distance, its directions,
//     all off the one difficulty row. A save reads as EASY until the how-to
//     card is answered, so a starter tile built before the answer stands a
//     chicken in a hard-mode yard. The placer swaps it rather than seating the
//     slimes beside it.
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
  // The greeters among a tile's creatures — the ones whose ids carry the tag.
  const hgOf = (entry) => entry.creatures.filter(c => /_greeter_0_0$/.test(c.id));
  // How many seats a mode asks for, and which way each lies.
  const hgDirs = (mode) => Difficulty.PROFILES[mode].homeGreeterDirs || [null];
  const hgCell = (c) => ({
    cx: Math.floor(c.x / CELL_M),
    cy: Math.floor(c.y / CELL_M),
  });
  const hgDist = (c) => {
    const p = hgCell(c);
    return Math.max(Math.abs(p.cx - ANCHOR), Math.abs(p.cy - ANCHOR));
  };

  // ── The guarantee ─────────────────────────────────────────────────────────

  test('home greeter: easy seats a chicken, hard seats a slime on each side', () => {
    for (const [mode, kind] of [['easy', 'chicken'], ['hard', 'slime']]) {
      const entry = hgEntry();
      hgPlace(hgScene(), entry, mode);
      const got = hgOf(entry);
      assert.eq(got.length, hgDirs(mode).length, `${mode}: one greeter per declared seat`);
      for (const c of got) assert.eq(c.kind, kind, `${mode} greets you with a ${kind}`);
      // And it is the table that said so — not a literal in the placer.
      assert.eq(Difficulty.PROFILES[mode].homeGreeter, kind,
        `${mode}'s greeter is declared in the difficulty table`);
    }
    assert.eq(hgDirs('easy').length, 1, 'easy is one chicken, not a cordon of them');
    assert.eq(hgDirs('hard').join(','), 'n,e,s,w',
      'hard leaves no free direction to stroll off in');
  });

  test('home greeter: it lands in the ring — off your feet, inside the bubble', () => {
    // The floor keeps a greeter from standing on the player; the ceiling is
    // the creature sim bubble, past which a creature is frozen at its seat —
    // a statue on the horizon is not a greeting.
    for (const mode of ['easy', 'hard']) {
      const entry = hgEntry();
      hgPlace(hgScene(), entry, mode);
      for (const c of hgOf(entry)) {
        const d = hgDist(c);
        assert.gte(d, HOME_GREETER_MIN_CELLS, `${mode}: never underfoot`);
        assert.lte(d, HOME_GREETER_MAX_CELLS, `${mode}: never past the sim bubble`);
      }
    }
    assert.eq(HOME_GREETER_MAX_CELLS, CREATURE_SIM_CELLS,
      'the ceiling IS the sim bubble — derived, not retyped');
    // Easy's chicken is the one that has to be on screen when the map paints:
    // it is the welcome. Hard's slimes are deliberately further out than that.
    assert.lt(Difficulty.PROFILES.easy.homeGreeterCells, VIEW_CELLS / 2,
      'the chicken is in shot from the first frame');
    assert.gt(Difficulty.PROFILES.hard.homeGreeterCells, VIEW_CELLS / 2,
      'the slimes are heard of before they are seen');
  });

  test('home greeter: how far out they stand is the MODE\'s number', () => {
    // A slime leeches on contact and hard doubles the bite, so they are seated
    // far further out than easy's chicken — the opening seconds are a sighting,
    // not a bite. The distance is declared beside the kind, in the difficulty
    // row, and on open ground the placer seats exactly there.
    for (const mode of ['easy', 'hard']) {
      const want = Difficulty.PROFILES[mode].homeGreeterCells;
      assert.gte(want, HOME_GREETER_MIN_CELLS, `${mode}: never under the placer's floor`);
      assert.lte(want + HOME_GREETER_SLACK_CELLS, HOME_GREETER_MAX_CELLS,
        `${mode}: the slack still fits inside the ring`);
      const entry = hgEntry();
      hgPlace(hgScene(), entry, mode);
      for (const c of hgOf(entry)) {
        assert.eq(hgDist(c), want, `${mode} seats it at its declared distance`);
      }
    }
    assert.gt(Difficulty.PROFILES.hard.homeGreeterCells,
      Difficulty.PROFILES.easy.homeGreeterCells,
      'the hard-mode slimes stand further off than the easy chicken');
  });

  test('home greeter: one on each side — the seats are the row\'s compass points', () => {
    // Whichever way the player walks off the hard-mode doorstep, there is one.
    const entry = hgEntry();
    hgPlace(hgScene(), entry, 'hard');
    const want = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
    const d = Difficulty.PROFILES.hard.homeGreeterCells;
    for (const dir of hgDirs('hard')) {
      const got = hgOf(entry).filter(c => c.id === `slime_${dir}_greeter_0_0`);
      assert.eq(got.length, 1, `exactly one slime to the ${dir}`);
      // Open ground: it sits on its ideal point, so the id names where it is.
      assert.eq(JSON.stringify(hgCell(got[0])),
        JSON.stringify({ cx: ANCHOR + want[dir][0] * d, cy: ANCHOR + want[dir][1] * d }),
        `the ${dir} slime lies to the ${dir}`);
    }
  });

  test('home greeter: a seat with no legal ground is left empty, not moved', () => {
    // The slack is a nudge around a road band or a pond, not a licence to
    // wander into another direction's arc — a whole side of the ring blocked
    // means that side has none, and the other three are unaffected.
    const entry = hgEntry();
    const d = Difficulty.PROFILES.hard.homeGreeterCells;
    const mask = new Uint8Array(N * N);           // the north seat's whole reach
    for (let cy = 0; cy <= ANCHOR - d + HOME_GREETER_SLACK_CELLS; cy++) {
      for (let cx = 0; cx < N; cx++) mask[cy * N + cx] = 1;
    }
    entry.roadMask = mask;
    hgPlace(hgScene(), entry, 'hard');
    const ids = hgOf(entry).map(c => c.id).sort();
    assert.eq(ids.join(' '),
      ['slime_e_greeter_0_0', 'slime_s_greeter_0_0', 'slime_w_greeter_0_0'].join(' '),
      'the north seat stays empty; the other three stand');
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
    // shared with the tile's own fauna roll. Each seat has its own id, so each
    // rolls for itself and every one of them must come back plain.
    const entry = hgEntry();
    hgPlace(hgScene(), entry, 'hard');
    const slime = hgOf(entry)[0];
    for (const c of hgOf(entry)) {
      assert.eq(c.shiny, false, 'a shiny slime would promise a payout it has none of');
    }
    assert.eq(faunaShiny('slime', slime.id), false, 'and the helper is what says so');
    assert.eq(faunaShiny('chicken', 'chicken_greeter_0_0'),
      isShiny('chicken_greeter_0_0', SHINY_RATE.animal), 'a chicken rolls like any animal');
  });

  // ── Idempotence, the mode race, and the player's own doing ────────────────

  test('home greeter: running the placer again seats no second one', () => {
    // It runs from three sites — spawnInTile, _setStarterCratesAt and
    // chooseMode — and any of them can fire after another already has.
    for (const mode of ['easy', 'hard']) {
      const entry = hgEntry();
      hgPlace(hgScene(), entry, mode);
      hgPlace(hgScene(), entry, mode);
      hgPlace(hgScene(), entry, mode);
      assert.eq(hgOf(entry).length, hgDirs(mode).length, `${mode}: still one per seat`);
    }
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
    assert.eq(got.length, hgDirs('hard').length, 'the chicken is removed, not joined');
    for (const c of got) assert.eq(c.kind, 'slime', 'and the mode\'s own are standing there');
    // And back again: the four slimes go when easy's one chicken returns.
    hgPlace(hgScene(), entry, 'easy');
    assert.eq(hgOf(entry).length, 1, 'a seat this mode does not ask for is swept too');
    assert.eq(hgOf(entry)[0].kind, 'chicken', 'the yard is a yard again');
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
    const pet = hgOf(entry).find(c => c.id === 'slime_n_greeter_0_0');
    scene.save.caught = [pet.id];
    pet.id = 'released_slime_1757000000000_424242';   // what tameInPlace mints
    hgPlace(scene, entry, 'hard');
    assert.eq(entry.creatures.filter(c => c.id === 'released_slime_1757000000000_424242').length, 1,
      'the pet is still standing there');
    // The seat it was tamed on stays empty; its three siblings are untouched.
    assert.eq(hgOf(entry).map(c => c.id).sort().join(' '),
      ['slime_e_greeter_0_0', 'slime_s_greeter_0_0', 'slime_w_greeter_0_0'].join(' '),
      'no second slime on the pet\'s side, and the rest are left alone');
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
    // The kind is never spelled in app.js — it comes from the mode table, and
    // so do how far out they stand and which ways they lie.
    assert.truthy(/const prof = Difficulty\.get\(\);[\s\S]{0,200}prof\.homeGreeter\b/.test(app),
      'the kind is read from the difficulty table');
    assert.truthy(/Math\.max\(HOME_GREETER_MIN_CELLS, prof\.homeGreeterCells/.test(app),
      "the mode's distance is read from the table, clamped by the placer's floor");
    assert.truthy(/prof\.homeGreeterDirs/.test(app),
      'and so are the seats it asks for');
    for (const lit of ["'n'", "'e'", "'s'", "'w'"]) {
      assert.falsy(new RegExp(`homeGreeterDirs[^\\n]*${lit}`).test(app),
        `app.js must not hard-code ${lit} as a greeter seat`);
    }
    for (const lit of ["'chicken'", "'slime'"]) {
      assert.falsy(new RegExp(`homeGreeter[^\\n]*${lit}`).test(app),
        `app.js must not hard-code ${lit} as the greeter`);
    }
  });
})();
