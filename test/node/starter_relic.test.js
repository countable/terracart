// _placeStarterRelicChest — the treasure chest one screen out from spawn, with
// a random WOODEN relic in it, plus the fixed-payload reward path that hands
// the relic over (src/interactables.js › fixedChestReward).
//
// Why it exists: the four supply crates give a new player materials, but
// nothing gives them a TOOL. Bare-handed work is 9 s a swing and a wooden tool
// is 3 s, so the first relic is the difference between the opening hour being
// playable and being a chore — and every other relic in the game has to be
// bought or forged first.
//
// The placer lives on the Phaser scene class and is lifted out of src/app.js as
// text by run.js, so these tests drive the real shipping code.

// Wrapped in an IIFE: every *.test.js shares one global scope in the runner,
// so bare top-level consts here would collide with another file's.
(() => {
  const T = WorldGen.T;
  const N = 44;                 // cells per tile edge in these fixtures
  const CELL_M = 7;
  const TILE_EDGE_M = N * CELL_M;
  const SPAWN = 21;             // spawn cell, with room for the whole ring band

  // Scene stub carrying only what the placer touches. The coords helpers
  // (worldMetersToAbsCell / absCellCenterMeters) read originPx / mPerPx /
  // cellsPerTile, so those have to be self-consistent: mPerPx is chosen so one
  // cell of TILE_PX/cellsPerTile pixels measures exactly CELL_M metres.
  function srScene(over = {}) {
    const cellsPerTile = N;
    const cellPx = WorldGen.TILE_PX / cellsPerTile;
    return Object.assign({
      save: {},
      cellM: CELL_M,
      tileEdgeM: TILE_EDGE_M,
      cellsPerTile,
      mPerPx: CELL_M / cellPx,
      originPx: { x: 0, y: 0 },
      startWorldM: { x: 0, y: 0 },
    }, over);
  }

  // A tile of uniform `fill`, with an optional road mask.
  function srEntry(fill = T.GRASS, opts = {}) {
    return {
      cellsPerEdge: N,
      grid: new Uint8Array(N * N).fill(fill),
      objects: opts.objects || [],
      wildplants: opts.wildplants || [],
      roadMask: opts.roadMask || null,
    };
  }
  const srPlace = (scene, entry, seats, sx = SPAWN, sy = SPAWN) =>
    placeStarterRelicChest.call(scene, entry, 0, 0, sx, sy, seats || new Set());
  // Tile-local cell of a placed object.
  const srCell = (o) => ({ cx: Math.floor(o.x / CELL_M), cy: Math.floor(o.y / CELL_M) });
  const srDist = (o, sx = SPAWN, sy = SPAWN) => {
    const c = srCell(o);
    return Math.max(Math.abs(c.cx - sx), Math.abs(c.cy - sy));
  };

  // ── Where it lands ──────────────────────────────────────────────────────

  test('spawn relic chest: an open field gets exactly one chest, a screen out', () => {
    const scene = srScene(), entry = srEntry();
    const chest = srPlace(scene, entry);
    assert.truthy(chest, 'a chest was seated');
    assert.eq(entry.objects.filter(o => o.kind === 'chest').length, 1, 'exactly one');
    // One screen: the view is VIEW_CELLS across with the player in the middle,
    // so anything closer than VIEW_CELLS is already on screen at spawn.
    assert.gte(srDist(chest), VIEW_CELLS, 'at least one screen out');
    assert.falsy(srDist(chest) > HomeArea.RING_MAX_CELLS, 'and no further than the home ring');
  });

  test('spawn relic chest: it is a treasure chest, not another supply crate', () => {
    const scene = srScene(), entry = srEntry();
    const chest = srPlace(scene, entry);
    assert.falsy(chest.crate, 'no crate flag — it renders as the trunk, not a box');
    // The gold onboarding arrow finds its targets by this id stamp.
    assert.truthy(String(chest.id).startsWith('chest_start_'), `arrow-targetable id: ${chest.id}`);
    assert.truthy(chest.name, 'named, so it draws a label worth walking toward');
  });

  test('spawn relic chest: the payload is one random WOODEN relic', () => {
    const scene = srScene(), entry = srEntry();
    const chest = srPlace(scene, entry);
    assert.eq(chest.fixedLoot.kind, 'relic', 'a relic, not an item stack');
    assert.eq(chest.fixedLoot.tier, STARTER_RELIC_TIER, 'wooden tier');
    assert.eq(STARTER_RELIC_TIER, 1, 'wood is tier 1');
    assert.includes(STARTER_RELIC_SLOTS, chest.fixedLoot.slot, 'slot drawn from the wooden pool');
    assert.truthy(RELIC_DEFS[chest.fixedLoot.slot], 'and it is a real relic slot');
  });

  test('spawn relic chest: the pool never offers jewelry (there is no wooden ring)', () => {
    // Gear.blacksmithRecipe refuses jewelry below T2 and the ring is the wizard
    // tower's exclusive gift — a wooden one of either cannot exist.
    assert.falsy(STARTER_RELIC_SLOTS.includes('ring'), 'no ring');
    assert.falsy(STARTER_RELIC_SLOTS.includes('amulet'), 'no amulet');
    for (const slot of STARTER_RELIC_SLOTS) {
      assert.truthy(RELIC_DEFS[slot], `${slot} is a declared relic slot`);
    }
  });

  // ── Determinism ─────────────────────────────────────────────────────────

  test('spawn relic chest: a rebuild reproduces the same chest, cell and relic', () => {
    // A tile rebuild re-runs the whole trail pass. If any of this were rolled
    // off Math.random, a player who walked away and came back would find the
    // reward re-rolled and the chest somewhere else.
    const a = srPlace(srScene(), srEntry());
    const b = srPlace(srScene(), srEntry());
    assert.eq(a.id, b.id, 'same id');
    assert.eq(a.x, b.x, 'same x');
    assert.eq(a.y, b.y, 'same y');
    assert.eq(a.fixedLoot.slot, b.fixedLoot.slot, 'same relic');
  });

  test('spawn relic chest: different spawns get different relics and bearings', () => {
    // Deterministic must not mean constant — every player in the game getting
    // the same tool in the same direction is the failure mode on the other side.
    const slots = new Set(), bearings = new Set();
    for (let i = 0; i < 12; i++) {
      const sx = SPAWN + i, sy = SPAWN - i;
      const chest = srPlace(srScene(), srEntry(), new Set(), sx, sy);
      slots.add(chest.fixedLoot.slot);
      const c = srCell(chest);
      bearings.add(Math.sign(c.cx - sx) + ',' + Math.sign(c.cy - sy));
    }
    assert.gt(slots.size, 1, `slots vary across spawns (saw ${[...slots].join(',')})`);
    assert.gt(bearings.size, 1, 'and so does the direction it sits in');
  });

  test('spawn relic chest: seating it twice does not stack a second one', () => {
    const scene = srScene(), entry = srEntry(), seats = new Set();
    srPlace(scene, entry, seats);
    assert.falsy(srPlace(scene, entry, seats), 'second pass declines');
    assert.eq(entry.objects.filter(o => o.kind === 'chest').length, 1, 'still one chest');
  });

  // ── Where it must NOT land ──────────────────────────────────────────────

  test('spawn relic chest: never on a road, nor under a drawn road band', () => {
    // The QC rule: the terrain grid under-reports the road (one cell per way,
    // nothing at all for parking aisles), so a chest that only dodges road
    // TERRAIN still lands in the middle of the carriageway. entry.roadMask is
    // the ground the player actually sees painted as road.
    const roadMask = new Uint8Array(N * N);
    const entry = srEntry(T.GRASS, { roadMask });
    // A band four cells deep across the whole ring band north of spawn, with
    // only its spine painted as road terrain — exactly the under-report.
    for (let cy = SPAWN - 14; cy <= SPAWN - 11; cy++) {
      for (let cx = 0; cx < N; cx++) roadMask[cy * N + cx] = 1;
    }
    for (let cx = 0; cx < N; cx++) entry.grid[(SPAWN - 12) * N + cx] = T.ROAD;
    const chest = srPlace(srScene(), entry);
    assert.truthy(chest, 'still seated somewhere');
    const c = srCell(chest);
    assert.falsy(roadMask[c.cy * N + c.cx], 'not under the road band');
    assert.falsy(entry.grid[c.cy * N + c.cx] === T.ROAD, 'not on road terrain');
    assert.truthy(WorldGen.isSpawnCell(entry.grid, N, N, c.cx, c.cy, { roadMask }),
      'and passes the shared spawn rule');
  });

  test('spawn relic chest: it does not sit on a crate seat or on anything standing', () => {
    const scene = srScene();
    // Fill the whole first ring except two cells: one already holding an
    // object, one reserved as a crate seat. Neither may be chosen, so the
    // chest has to widen to the next ring.
    const objects = [];
    const seats = new Set();
    const ring = [];
    for (let dy = -VIEW_CELLS; dy <= VIEW_CELLS; dy++) {
      for (let dx = -VIEW_CELLS; dx <= VIEW_CELLS; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== VIEW_CELLS) continue;
        ring.push({ cx: SPAWN + dx, cy: SPAWN + dy });
      }
    }
    const entry = srEntry(T.GRASS, { objects });
    for (let i = 2; i < ring.length; i++) {
      entry.grid[ring[i].cy * N + ring[i].cx] = T.WATER;
    }
    objects.push({ kind: 'tree', id: 'tree-x',
      x: (ring[0].cx + 0.5) * CELL_M, y: (ring[0].cy + 0.5) * CELL_M });
    seats.add(ring[1].cx + ',' + ring[1].cy);
    const chest = srPlace(scene, entry, seats);
    assert.truthy(chest, 'seated');
    const c = srCell(chest);
    assert.falsy(c.cx === ring[0].cx && c.cy === ring[0].cy, 'not on the tree');
    assert.falsy(c.cx === ring[1].cx && c.cy === ring[1].cy, 'not on the crate seat');
    assert.gt(srDist(chest), VIEW_CELLS, 'widened past the blocked ring');
    assert.truthy(seats.has(c.cx + ',' + c.cy), 'and claims its own seat for later passes');
  });

  test('spawn relic chest: a spawn with nowhere to put it gets none, not a chest in the sea', () => {
    const entry = srEntry(T.WATER);
    assert.falsy(srPlace(srScene(), entry), 'declined');
    assert.eq(entry.objects.length, 0, 'and nothing pushed');
  });

  // ── Opening it ──────────────────────────────────────────────────────────

  const srChest = (slot, tier) => ({
    kind: 'chest', id: 'chest_start_relic_0_0', x: 0, y: 0,
    fixedLoot: { kind: 'relic', slot, tier: tier || STARTER_RELIC_TIER },
  });

  test('spawn relic chest: opening it equips the wooden relic and spends the chest', () => {
    const scene = makeScene();
    const save = { opened: [], relics: {}, money: 0 };
    const o = srChest('axe');
    assert.eq(runInteractable(makeCtx(scene, save), o), true, 'tap consumed');
    assert.eq(save.relics.axe?.tier, 1, 'a Wood axe is equipped');
    assert.includes(save.opened, o.id, 'chest marked opened');
  });

  test('spawn relic chest: it can only ever be an upgrade, never a downgrade', () => {
    // A player who forged a Copper axe first must not have it replaced by the
    // chest's wooden one. reconcileRelicOffer walks the slot up from what is
    // owned, cashing out to gold — the payload names the floor, not the result.
    const scene = makeScene();
    const save = { opened: [], relics: { axe: { tier: 4 } }, money: 0 };
    runInteractable(makeCtx(scene, save), srChest('axe'));
    assert.gte(save.relics.axe.tier, 4, 'never demoted below what was owned');
  });

  test('spawn relic chest: an item payload still opens as an item (the supply crates)', () => {
    const scene = makeScene();
    const save = { opened: [], relics: {}, money: 0 };
    const o = { kind: 'chest', id: 'chest_start_0_0_1', x: 0, y: 0,
      fixedLoot: { id: 'wood', qty: 9 } };
    assert.eq(runInteractable(makeCtx(scene, save), o), true, 'tap consumed');
    assert.eq(scene.invCount('wood'), 9, 'nine wood, as the crate promises');
  });
})();
