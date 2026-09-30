// Saved records win live-stream collisions without changing generated snapshots.
(() => {
  const N = 60, CELL_M = 7, EDGE = N * CELL_M;
  const scene = (save = {}) => Object.assign({
    save, depth: 0, tileEdgeM: EDGE, cellsPerTile: N,
    mPerPx: CELL_M / (WorldGen.TILE_PX / N),
    originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 },
  }, StarterHomeMethods);
  const at = (ix, iy) => ({ x: (ix + 0.5) * CELL_M, y: (iy + 0.5) * CELL_M });

  test('saved spawn: frozen Home record clears rebuilt objects and wildplants by ID', () => {
    const rec = { k: 'tree', id: 'starter_tree_30_30', ...at(30, 30) };
    const save = { starterHome: { placed: [rec], done: true } };
    const s = scene(save);
    const generated = { kind: 'mineralrock', id: 'generated', ...at(30, 30) };
    const plant = { crop: 'mushroom', id: 'wild', ...at(30, 30) };
    const player = { kind: 'fruittree', id: 'player_tree', planted: true, ...at(31, 30) };
    const snapshot = [generated, player];
    const e = { cellsPerEdge: N, grid: new Uint8Array(N * N),
      objects: [generated, player], genObjects: snapshot, wildplants: [plant] };
    s._provisionStarterHome(e, 0, 0, 30, 30, new Set());
    const restored = e.objects.find(o => o.id === rec.id);
    assert.truthy(restored, 'frozen ID restored');
    assert.falsy(SpawnOwnership.overlaps(s, restored, player), 'generated Home record uses a fallback seat');
    assert.falsy(e.objects.some(o => o.id === generated.id), 'lower-priority live object removed');
    assert.falsy(e.wildplants.some(o => o.id === plant.id), 'lower-priority live plant removed');
    assert.truthy(e.objects.includes(player), 'player tree remains');
    assert.eq(e.genObjects, snapshot, 'generated snapshot untouched');
    assert.eq(save.starterHome.placed[0], rec, 'saved record and progress unchanged');
    const fallback = { x: rec.x, y: rec.y };
    s._provisionStarterHome(e, 0, 0, 30, 30, new Set());
    assert.eq(e.objects.filter(o => o.id === rec.id).length, 1, 'reload pass does not duplicate ID');
    assert.eq(rec.x, fallback.x, 'fallback is stable across rebuilds');
    assert.eq(rec.y, fallback.y, 'fallback row is stable across rebuilds');
  });

  test('saved spawn: a declared 3 by 3 footprint clears all nine generated cells', () => {
    const s = scene();
    const ship = { kind: 'shipwreck', id: 'draft_ship', ...at(30, 30),
      _synthetic: true, _footprintCells: { width: 3, height: 3 } };
    const generated = [];
    for (let iy = 29; iy <= 31; iy++) for (let ix = 29; ix <= 31; ix++) {
      generated.push({ kind: 'rock', id: `g_${ix}_${iy}`, ...at(ix, iy) });
    }
    generated.push({ kind: 'rock', id: 'outside', ...at(32, 30) });
    const e = { objects: [ship, ...generated], wildplants: [] };
    SpawnOwnership.reconcileEntry(s, e, [ship]);
    assert.eq(e.objects.length, 2, 'all nine covered cells cleared, outside cell retained');
    assert.truthy(e.objects.includes(ship) && e.objects.some(o => o.id === 'outside'), 'declared claim survives');
  });

  test('saved spawn: footprint follows the neighbouring row grid across a seam', () => {
    const s = scene();
    s.cellsForRow = ty => ty === 1 ? 40 : N;
    const claim = { kind: 'shipwreck', id: 'seam_ship', ...at(30, N - 1),
      _footprintCells: { width: 3, height: 3 } };
    const south = SpawnOwnership.tileCells(s, { cellsPerEdge: 40 }, claim, 0, 1);
    assert.eq(south.length, 3, 'south row receives the full footprint width');
    const c = SpawnOwnership.footprintCells(s, claim).find(p => absCellToTile(s, p.cellIX, p.cellIY).ty === 1);
    const pos = absCellCenterMeters(s, c.cellIX, c.cellIY);
    assert.truthy(SpawnOwnership.overlaps(s, claim, { id: 'south_item', ...pos }),
      'collision resolves on the south row cell frame');
  });

  test('saved spawn: Home trailer moat keeps planted and saved objects', () => {
    const src = APP_JS_SRC;
    const start = src.indexOf('  clearHomeTrailerOverlap() {');
    const body = src.slice(start + '  clearHomeTrailerOverlap() {'.length, src.indexOf('\n  }\n', start));
    const clear = new Function(body);
    const st = { id: 'starter_trailer', ...at(30, 30) };
    const s = scene({ starterTrailer: st, starterShopId: st.id,
      fruittrees: [{ id: 'saved_tree', ...at(31, 30) }] });
    const saved = { kind: 'tree', id: 'saved_tree', ...at(31, 30) };
    const planted = { kind: 'tree', id: 'planted_tree', planted: true, ...at(29, 30) };
    const loose = { kind: 'rock', id: 'generated', ...at(30, 31) };
    const e = { objects: [saved, planted, loose] };
    const key = WorldGen.tileKey(0, 0);
    WorldGen.tileCache.set(key, e);
    try {
      clear.call(s);
      assert.truthy(e.objects.includes(saved) && e.objects.includes(planted), 'owned objects survive moat');
      assert.falsy(e.objects.includes(loose), 'generated clutter removed');
    } finally { WorldGen.tileCache.delete(key); }
  });

  test('saved spawn: generated starter ladder picks another seat around a saved sapling', () => {
    const entry = () => ({ cellsPerEdge: N, grid: new Uint8Array(N * N),
      objects: [], wildplants: [] });
    const baseline = scene(), first = entry();
    baseline._provisionStarterHome(first, 0, 0, 30, 30, new Set());
    const expected = baseline.save.starterHome.placed.find(r => r.k === 'ladder');
    assert.truthy(expected, 'baseline has a generated story ladder');
    const ft = { id: 'saved_sapling', kind: 'tree', x: expected.x, y: expected.y, planted_t: 1 };
    const occupied = scene({ fruittrees: [ft] }), second = entry();
    occupied._provisionStarterHome(second, 0, 0, 30, 30, new Set());
    const moved = occupied.save.starterHome.placed.find(r => r.k === 'ladder');
    assert.truthy(moved, 'a valid fallback was found');
    assert.falsy(sameAbsCell(occupied, moved.x, moved.y, ft.x, ft.y), 'the ladder avoids the saved sapling');
    assert.eq(occupied.save.fruittrees[0], ft, 'the player record remains unchanged');
  });

  test('saved spawn: frozen Home ID moves deterministically around a later planting', () => {
    const rec = { k: 'rock', id: 'starter_rock_saved', ...at(30, 30) };
    const ft = { kind: 'tree', id: 'my_sapling', ...at(30, 30), planted_t: 1 };
    const save = { starterHome: { placed: [rec], done: true, tries: 2 }, fruittrees: [ft] };
    const s = scene(save);
    const e = { cellsPerEdge: N, grid: new Uint8Array(N * N), objects: [], wildplants: [] };
    s._provisionStarterHome(e, 0, 0, 30, 30, new Set());
    const restored = e.objects.find(o => o.id === rec.id);
    assert.truthy(restored, 'same saved story ID is restored');
    assert.falsy(SpawnOwnership.overlaps(s, restored, ft), 'player planting keeps its seat');
    const pos = { x: rec.x, y: rec.y };
    s._provisionStarterHome(e, 0, 0, 30, 30, new Set());
    assert.eq(rec.x, pos.x, 'fallback x stays frozen');
    assert.eq(rec.y, pos.y, 'fallback y stays frozen');
    assert.eq(e.objects.filter(o => o.id === rec.id).length, 1, 'one live story object');
    assert.eq(save.starterHome.tries, 2, 'starter progress retained');
    assert.eq(ft.x, at(30, 30).x, 'player coordinates stay put');
  });

  test('saved spawn: fallback ignores ambient fill and neighbouring tile load order', () => {
    const run = (withNeighbour, clutterAt) => {
      const rec = { k: 'rock', id: 'starter_rock_origin', ...at(30, 30) };
      const ft = { id: 'saved_tree_origin', kind: 'tree', ...at(30, 30) };
      const s = scene({ starterHome: { placed: [rec], done: true }, fruittrees: [ft] });
      const e = { cellsPerEdge: N, grid: new Uint8Array(N * N),
        baseGrid: new Uint8Array(N * N), objects: [], wildplants: [] };
      if (clutterAt) e.objects.push({ kind: 'rock', id: 'ambient_fill', ...clutterAt });
      const neighbourKey = WorldGen.tileKey(1, 0);
      if (withNeighbour) WorldGen.tileCache.set(neighbourKey, {
        cellsPerEdge: N, grid: new Uint8Array(N * N),
        objects: [{ kind: 'rock', id: 'neighbour_fill', x: EDGE + CELL_M / 2, y: at(30, 30).y }],
      });
      try {
        s._provisionStarterHome(e, 0, 0, 30, 30, new Set());
        return { x: rec.x, y: rec.y, id: rec.id };
      } finally { WorldGen.tileCache.delete(neighbourKey); }
    };
    const first = run(false);
    const second = run(true, first);
    assert.eq(second.x, first.x, 'ambient fill and loaded neighbour do not change x');
    assert.eq(second.y, first.y, 'ambient fill and loaded neighbour do not change y');
    assert.eq(second.id, first.id, 'story ID remains stable');
  });

  test('saved spawn: no eligible fallback reports shortfall without deleting saved ID', () => {
    const rec = { k: 'rock', id: 'starter_rock_blocked', ...at(30, 30) };
    const ft = { id: 'saved_tree_blocked', kind: 'tree', ...at(30, 30) };
    const save = { starterHome: { placed: [rec], done: true }, fruittrees: [ft] };
    const s = scene(save);
    const grid = new Uint8Array(N * N).fill(3); // WATER blocks every fallback.
    grid[30 * N + 30] = 0;
    const e = { cellsPerEdge: N, grid, baseGrid: grid.slice(), objects: [], wildplants: [] };
    s._provisionStarterHome(e, 0, 0, 30, 30, new Set());
    assert.eq(rec.id, 'starter_rock_blocked', 'frozen record and ID retained');
    assert.eq(rec.x, ft.x, 'saved source remains until a valid seat exists');
    assert.falsy(e.objects.some(o => o.id === rec.id), 'no overlapping live story object');
    assert.truthy(e.spawnShortfalls.some(x => x.id === rec.id && x.reason === 'no_eligible_cell'),
      'structured shortfall reports the deferred placement');
  });
})();
