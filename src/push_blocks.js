// Cell-sized pushables share the temple trial's cardinal, one-block-at-a-time
// rule. World movement stays separate: tapping an adjacent block pushes it;
// querying collision must never move an object as a side effect.
(function (root) {
  function destination(block, dx, dy, blocked) {
    if (!Number.isInteger(dx) || !Number.isInteger(dy) || Math.abs(dx) + Math.abs(dy) !== 1) return null;
    const next = { x: block.x + dx, y: block.y + dy };
    return blocked(next) ? null : next;
  }
  function isBlock(o) { return o?.pushable === true; }
  function at(scene, x, y) {
    if (!scene.startWorldM || !scene.originPx || !(scene.cellsPerTile > 0)) return null;
    const cell = worldMetersToTileCell(scene, x, y);
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(cell.tx, cell.ty));
    if (!entry) return null;
    let found = null;
    WorldGen.forEachItemInBox(entry, 'objects', x - scene.cellM, y - scene.cellM,
      x + scene.cellM, y + scene.cellM, o => {
        if (isBlock(o) && sameAbsCell(scene, x, y, o.x, o.y)) found = o;
      });
    return found;
  }
  function tryPush(scene, block, dx, dy) {
    if (!isBlock(block)) return false;
    const current = worldMetersToAbsCell(scene, block.x, block.y);
    const feet = playerWorldM(scene);
    const player = worldMetersToAbsCell(scene, feet.x, feet.y + (scene.feetOffsetM || 0));
    // No remote pushes, diagonal pushes, pulling, or chain reactions.
    if (current.cellIX - player.cellIX !== dx || current.cellIY - player.cellIY !== dy) return false;
    let targetEntry, targetPoint;
    const next = destination({ x: current.cellIX, y: current.cellIY }, dx, dy, cell => {
      const t = absCellToTile(scene, cell.x, cell.y);
      targetEntry = WorldGen.tileCache.get(WorldGen.tileKey(t.tx, t.ty));
      if (!targetEntry?.grid) return true;
      const index = t.iy * targetEntry.cellsPerEdge + t.ix;
      const terrain = targetEntry.grid[index];
      // Blocks remain on dry floor; they cannot fill water or become bridges.
      if (!WorldGen.isWalkable(terrain) || terrain === WorldGen.T.WATER
        || terrain === WorldGen.T.WETLAND || terrain === WorldGen.T.CAVE_LAVA
        || FloorWallMaterials.isSewerChannel(targetEntry, index, terrain)) return true;
      targetPoint = absCellCenterMeters(scene, cell.x, cell.y);
      let occupied = false;
      forEachLoadedTile(t.tx, t.ty, entry => {
        for (const prop of ['objects', 'creatures', 'wildplants']) {
          for (const o of entry[prop] || []) {
            if (o !== block && !o.dead && sameAbsCell(scene, targetPoint.x, targetPoint.y, o.x, o.y)) occupied = true;
          }
        }
      });
      return occupied;
    });
    if (!next) return false;
    const source = WorldGen.forEachItem('objects', (o, entry) => o === block && entry);
    if (!source) return false;
    block.x = targetPoint.x; block.y = targetPoint.y;
    if (source !== targetEntry) {
      source.objects.splice(source.objects.indexOf(block), 1);
      (targetEntry.objects || (targetEntry.objects = [])).push(block);
    }
    // Static object buckets normally invalidate by array identity/length. A
    // push changes coordinates in place, including across a chunk/tile edge.
    if (source._chunkIdx) delete source._chunkIdx.objects;
    if (targetEntry._chunkIdx) delete targetEntry._chunkIdx.objects;
    return true;
  }
  function interact(ctx, block) {
    const { scene, sx, sy } = ctx;
    const feet = playerWorldM(scene);
    const player = worldMetersToAbsCell(scene, feet.x, feet.y + (scene.feetOffsetM || 0));
    const cell = worldMetersToAbsCell(scene, block.x, block.y);
    const dx = cell.cellIX - player.cellIX, dy = cell.cellIY - player.cellIY;
    const moved = tryPush(scene, block, dx, dy);
    scene.flash?.(moved ? 'Pushed block.' : Math.abs(dx) + Math.abs(dy) !== 1
      ? 'Stand beside the block to push it.' : 'The block needs a clear, dry cell ahead.', sx, sy);
    return true;
  }
  root.PushBlocks = { destination, isBlock, at, tryPush, interact };
})(typeof window !== 'undefined' ? window : globalThis);
