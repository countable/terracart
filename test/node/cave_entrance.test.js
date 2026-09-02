// A CAVE ENTRANCE'S CELL MUST NOT MOVE WHEN A TILE IS REBUILT UNDER IT.
//
// WHAT COULD BREAK. A tile can be REBUILT under you (see CLAUDE.md): when a
// tile rasterizes before its Overpass bin arrives, rebuildTileWithBin swaps in
// a replacement entry once the bin lands. That replacement runs the SAME
// cross-tile chest/house dedup the first build did (collectDedupIndex), but
// the ANSWER can differ the second time — more neighbour tiles are usually
// cached by the time a rebuild fires than were cached at first load, so a
// chest/house that survived dedup on the first pass can get dropped on the
// second (or vice versa).
//
// maybePlaceCaveEntrance runs after that dedup and used to judge occupancy
// (objCells/nearChest — "don't seat a stair on/beside an existing
// interactable") straight off entry.objects, the POST-dedup survivor list.
// So a dedup outcome that only differs by one chest could steer placeBeside's
// first-fit search to a different neighbour of the same cave-rock cluster —
// moving the descend staircase's cell. That matters because once a player has
// descended, loadCaveTile has already baked the OLD cell's x,y into a cached
// cave level as its 'up' stair (worldgen.js loadCaveTile). Move the surface
// stair and that cached level's exit no longer lines up with anything on the
// surface.
//
// THE FIX. maybePlaceCaveEntrance now takes the tile's PRE-dedup object list
// (loadTile's `objects`, before collectDedupIndex/filteredObjects run) as an
// extra argument and judges occupancy against THAT instead of entry.objects.
// The pre-dedup list is a pure function of this tile's own MVT bytes and
// coordinates — unaffected by which other tiles happen to be cached — and it
// is always a superset of whatever survives dedup (dedup only ever drops a
// chest/house, never relocates one), so nothing that actually ends up on the
// tile can ever be placed on top of. These tests pin the invariant directly:
// same rock cluster, same grid, only the dedup-outcome-shaped `entry.objects`
// changes — the chosen cell must not.
(function () {
const T = WorldGen.T;

const N = 12, CELL_M = 7, EDGE_M = N * CELL_M;
const TX = 5, TY = 9;

// Local cell (lix,liy) -> world metres at that cell's centre, for this tile.
const cellXY = (lix, liy) => ({ x: TX * EDGE_M + (lix + 0.5) * CELL_M, y: TY * EDGE_M + (liy + 0.5) * CELL_M });
// World metres -> this tile's local cell coords, inverse of the above.
const localCell = (wx, wy) => [Math.floor((wx - TX * EDGE_M) / CELL_M), Math.floor((wy - TY * EDGE_M) / CELL_M)];

function rockAt(lix, liy, clusterId) {
  const { x, y } = cellXY(lix, liy);
  return { kind: 'mineralrock', x, y, caveVariant: 0, _clusterId: clusterId };
}
function chestAt(lix, liy, name) {
  const { x, y } = cellXY(lix, liy);
  return { kind: 'chest', x, y, name };
}

// A blank walkable tile with one residential cave-rock cluster anchored at
// (6,6), plus whatever extra objects the caller wants pre-placed (a chest
// standing on the cluster's first candidate neighbour, in these tests).
function makeEntry(extraObjects) {
  const grid = new Uint8Array(N * N).fill(T.GRASS);
  const roadMask = new Uint8Array(N * N);
  const rock = rockAt(6, 6, 'cluster1');
  return { grid, roadMask, rock, extraObjects: extraObjects || [] };
}

function stairCellOf(entry) {
  const s = entry.objects.find(o => o.kind === 'staircase');
  return s ? localCell(s.x, s.y) : null;
}

test('maybePlaceCaveEntrance: a dedup-dropped chest does not move the staircase (fix)', () => {
  const base = makeEntry();
  // The chest sits on cell (7,6) — the FIRST cell placeBeside's dirs list
  // tries next to the rock at (6,6) — so its presence/absence is guaranteed
  // to change which neighbour is picked, exactly like a cross-tile dedup
  // dropping or keeping it would.
  const chest = chestAt(7, 6, 'lockbox');
  const rawObjects = [base.rock, chest];   // this tile's own pre-dedup scatter

  // Build A: cross-tile dedup happened to DROP the chest (a same-named chest
  // was already cached on a neighbour by the time this tile built).
  const entryA = { cellsPerEdge: N, grid: base.grid, roadMask: base.roadMask,
    objects: [base.rock], poiPadCells: null };
  WorldGen.maybePlaceCaveEntrance(entryA, TX, TY, EDGE_M, rawObjects);

  // Build B: cross-tile dedup happened to KEEP the chest (no neighbour was
  // cached yet, or none shared its name). Same tile, same rock, same raw
  // scatter — only the survivor set the earlier build's timing produced.
  const entryB = { cellsPerEdge: N, grid: base.grid, roadMask: base.roadMask,
    objects: [base.rock, chest], poiPadCells: null };
  WorldGen.maybePlaceCaveEntrance(entryB, TX, TY, EDGE_M, rawObjects);

  const cellA = stairCellOf(entryA), cellB = stairCellOf(entryB);
  assert.truthy(cellA, 'build A placed an entrance');
  assert.truthy(cellB, 'build B placed an entrance');
  assert.eq(cellA[0], cellB[0], 'same cell (x) regardless of the dedup outcome');
  assert.eq(cellA[1], cellB[1], 'same cell (y) regardless of the dedup outcome');
  // And it must be a cell that is NEVER on the chest, in either build — the
  // whole point of judging occupancy off the superset.
  assert.falsy(cellA[0] === 7 && cellA[1] === 6, 'never seated on the chest cell');
});

test('maybePlaceCaveEntrance: without the pre-dedup list, the same swing reproduces the bug', () => {
  // Sanity check on the reproduction itself: omit the 5th argument (the old
  // call shape) and the two builds — which really do differ only in whether
  // the chest survived dedup — land on DIFFERENT cells. This is what proves
  // the fix is the `stableObjects` argument and not some coincidence of the
  // fixture.
  const base = makeEntry();
  const chest = chestAt(7, 6, 'lockbox');

  const entryA = { cellsPerEdge: N, grid: base.grid, roadMask: base.roadMask,
    objects: [base.rock], poiPadCells: null };
  WorldGen.maybePlaceCaveEntrance(entryA, TX, TY, EDGE_M);   // no stableObjects

  const entryB = { cellsPerEdge: N, grid: base.grid, roadMask: base.roadMask,
    objects: [base.rock, chest], poiPadCells: null };
  WorldGen.maybePlaceCaveEntrance(entryB, TX, TY, EDGE_M);   // no stableObjects

  const cellA = stairCellOf(entryA), cellB = stairCellOf(entryB);
  assert.truthy(cellA && cellB, 'both builds still place an entrance');
  assert.falsy(cellA[0] === cellB[0] && cellA[1] === cellB[1],
    'reproduction fixture actually swings the cell when judged off entry.objects alone');
});

test('maybePlaceCaveEntrance: with no dedup drop at all, behaviour is unchanged', () => {
  // The common case — nothing gets deduped, so the pre-dedup list and
  // entry.objects are the same array. Passing it explicitly must be a no-op:
  // this is the overwhelming majority of tile builds, and the fix must not
  // perturb them.
  const base = makeEntry();
  const chest = chestAt(7, 6, 'lockbox');
  const objects = [base.rock, chest];

  const withStable = { cellsPerEdge: N, grid: base.grid, roadMask: base.roadMask,
    objects: objects.slice(), poiPadCells: null };
  WorldGen.maybePlaceCaveEntrance(withStable, TX, TY, EDGE_M, objects);

  const withoutStable = { cellsPerEdge: N, grid: base.grid, roadMask: base.roadMask,
    objects: objects.slice(), poiPadCells: null };
  WorldGen.maybePlaceCaveEntrance(withoutStable, TX, TY, EDGE_M);

  const a = stairCellOf(withStable), b = stairCellOf(withoutStable);
  assert.truthy(a && b, 'both place an entrance');
  assert.eq(a[0], b[0]); assert.eq(a[1], b[1]);
});
})();
