// North-up canvas projection of the same full-cell prisms used in the game.
// The viewer deliberately shares the runtime atlas and deterministic cell roll.
(function (root) {
  'use strict';
  function cells(entry, width, height, depth) {
    const N = entry.cellsPerEdge, wall = root.WorldGen.T.CAVE_WALL;
    const solid = (x, y) => x >= 0 && y >= 0 && x < N && y < N
      && entry.grid[y * N + x] === wall;
    const result = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (!solid(x, y)) continue;
      const mask = (!solid(x, y - 1) ? 1 : 0) | (!solid(x + 1, y) ? 2 : 0)
        | (!solid(x, y + 1) ? 4 : 0) | (!solid(x - 1, y) ? 8 : 0);
      result.push({ x, y, mask, variant: root.FloorWallMaterials.variant(depth,
        (entry.tx || 0) * N + x, (entry.ty || 0) * N + y) });
    }
    return result;
  }
  function draw(ctx, atlas, cell, x, y, size) {
    const lift = root.FloorWallMaterials.height * size / 32;
    ctx.drawImage(atlas, cell.mask * 32, cell.variant * 32, 32, 32,
      x, y - lift, size, size);
    if (cell.mask & 4) ctx.drawImage(atlas, cell.variant * 32, 128, 32, 19,
      x, y + size - lift, size, lift);
  }
  root.FloorViewerWalls = { cells, draw };
})(globalThis);
