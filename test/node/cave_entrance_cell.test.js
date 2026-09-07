// A surface cave entrance is added after rasterization, so its occupancy check
// must include the rasterizer's separate wildplant list.
(function () {
const T = WorldGen.T;

const N = 12;
const CELL_M = 7;
const EDGE_M = N * CELL_M;
const TX = 3;
const TY = 4;

const cellXY = (lix, liy) => ({
  x: TX * EDGE_M + (lix + 0.5) * CELL_M,
  y: TY * EDGE_M + (liy + 0.5) * CELL_M,
});
const localCell = (o) => [
  Math.floor((o.x - TX * EDGE_M) / CELL_M),
  Math.floor((o.y - TY * EDGE_M) / CELL_M),
];

test('maybePlaceCaveEntrance: staircase skips wildplant cells', () => {
  const rock = {
    kind: 'mineralrock', ...cellXY(6, 6), caveVariant: 0, _clusterId: 'cluster1',
  };
  // placeBeside tries east first, so this plant occupies the first cell that
  // would otherwise accept the staircase.
  const wildplants = [
    { crop: 'shrub', ...cellXY(7, 6), id: 'wp_first_candidate' },
    { crop: 'longgrass', ...cellXY(1, 1), id: 'wp_elsewhere' },
  ];
  const objects = [rock];
  const entry = {
    cellsPerEdge: N,
    grid: new Uint8Array(N * N).fill(T.GRASS),
    roadMask: new Uint8Array(N * N),
    objects: objects.slice(),
    poiPadCells: null,
  };

  WorldGen.maybePlaceCaveEntrance(entry, TX, TY, EDGE_M, objects, wildplants);

  const stairs = entry.objects.filter(o => o.kind === 'staircase');
  assert.eq(stairs.length, 1, 'the tile still gets its guaranteed entrance');
  const [sx, sy] = localCell(stairs[0]);
  assert.eq(sx, 5, 'stair moves to the next candidate column');
  assert.eq(sy, 6, 'stair moves to the next candidate row');

  const plantCells = new Set(wildplants.map(wp => localCell(wp).join('_')));
  for (const stair of stairs) {
    assert.falsy(plantCells.has(localCell(stair).join('_')),
      'no staircase shares a cell with a wildplant');
  }
});
})();
