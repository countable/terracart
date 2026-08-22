// Tests for WorldGen.collectDedupIndex — the cross-tile spawn-dedup index a
// newly-built tile's chests and houses are checked against.
//
// The load-bearing contract is the skipKey: while rebuildTileWithBin replaces
// a tile in place (its Overpass bin landed after it rasterized), the tile's
// own live entry stays in the cache and must be EXCLUDED from the index for
// BOTH kinds. The rebuild spawns its chests and houses at exactly the
// coordinates of the copies it is about to swap out, so an index that still
// sees the old entry dedupes the rebuild against itself and drops them all.
// That happened to houses for real: the skip originally covered only the
// chest index, and every rebuilt tile kept its painted brick footprints but
// lost every house sprite.

const mkCache = () => new Map([
  ['14/5/5', { objects: [
    { kind: 'chest', name: 'Old Mill', x: 100, y: 200 },
    { kind: 'house', x: 350, y: 420 },
    { kind: 'house', x: 357, y: 420 },
    { kind: 'tree', x: 1, y: 2 },              // other kinds are not indexed
  ] }],
  ['14/5/6', { objects: [
    { kind: 'chest', name: 'old mill ', x: 900, y: 900 },   // same name, case/space-insensitive
    { kind: 'house', x: 800, y: 810 },
  ] }],
  ['14/6/5', {}],                              // entry with no objects — skipped
  ['14/6/6', null],                            // dead entry — skipped
]);

test('dedup index: collects chests by normalized name and houses by position', () => {
  const { byName, housePositions } = WorldGen.collectDedupIndex(mkCache(), null);
  assert.eq(byName.size, 1, 'both chests share one normalized name key');
  assert.eq(byName.get('old mill').length, 2, 'both positions recorded under it');
  assert.eq(housePositions.length, 3, 'every cached house position indexed');
});

test('dedup index: skipKey excludes that tile\'s houses AND chests (rebuild-in-place)', () => {
  const { byName, housePositions } = WorldGen.collectDedupIndex(mkCache(), '14/5/5');
  // The regression: houses from the entry being replaced must not be indexed,
  // or the rebuild drops every one of its own house sprites as a "duplicate"
  // and the tile's building footprints render bare.
  assert.eq(housePositions.length, 1, 'skipped tile contributes no house positions');
  assert.eq(housePositions[0].x, 800, 'the remaining house is the other tile\'s');
  assert.eq(byName.get('old mill').length, 1, 'skipped tile contributes no chests');
});

test('dedup index: other tiles still index normally while one is skipped', () => {
  const { byName, housePositions } = WorldGen.collectDedupIndex(mkCache(), '14/5/6');
  assert.eq(housePositions.length, 2, 'houses of non-skipped tiles survive');
  assert.eq(byName.get('old mill').length, 1, 'chest of the non-skipped tile survives');
});
