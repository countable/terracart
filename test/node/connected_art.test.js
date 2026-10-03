// Connected art follows the current save while generated sections stay intact.
(function () {
  const N = 12, edge = 120, tx = -2, ty = 3;
  function piece(type, ix, iy) {
    const common = { id: `${type}:${ix}:${iy}`, x: tx * edge + (ix + .5) * 10,
      y: ty * edge + (iy + .5) * 10 };
    return type === 'wall'
      ? { ...common, kind: 'stronghold_wall', variant: 0,
          zoneVariant: 'quarry-stronghold', zoneLayer: 'background' }
      : WorldGen.makeWildplant('shrub', common.x, common.y, common.id,
          { zoneVariant: 'hedge_garden', _plantArt: 'zone_hedge', _hedgeFrame: 0 });
  }
  function tile(pieces) {
    return { cellsPerEdge: N, objects: pieces.filter(o => o.kind !== 'wildplant'),
      wildplants: pieces.filter(o => o.kind === 'wildplant') };
  }
  function spent(type, removed = [], burned = []) {
    return spentSets({ brokenRockSet: new Set(type === 'wall' ? removed : []) },
      { picked: type === 'hedge' ? removed : [], burnedObjects: burned });
  }
  function art(entry, sets, focus = { x: tx * edge + edge / 2, y: ty * edge + edge / 2 }, halfM = edge) {
    return Render.connectedArtForTile(entry, tx, ty, edge, sets, focus.x, focus.y, halfM);
  }
  function frame(map, o) { return o.kind === 'wildplant' ? map.get(o)._hedgeFrame : map.get(o).variant; }

  for (const type of ['wall', 'hedge']) {
    test(`connected art: extracting the middle of a ${type} run gives both surviving sides end caps`, () => {
      const pieces = [2, 3, 4, 5, 6].map(ix => piece(type, ix, 5));
      const entry = tile(pieces), before = JSON.stringify(pieces);
      assert.eq(frame(art(entry, spent(type)), pieces[1]), 0);
      const cut = art(entry, spent(type, [pieces[2].id]));
      assert.falsy(cut.has(pieces[2]), 'extracted section is absent');
      assert.eq(frame(cut, pieces[1]), 12, 'west arm closes at its east tip');
      assert.eq(frame(cut, pieces[3]), 14, 'east arm closes at its west tip');
      assert.eq(JSON.stringify(pieces), before, 'generated identities and art remain unchanged');
      assert.eq(frame(art(entry, spent(type)), pieces[1]), 0, 'a different save sees the intact run');
      assert.eq(WorldGen.chunkIndex(entry, type === 'wall' ? 'objects' : 'wildplants').builds, 1,
        'save changes reuse the generated spatial index');
    });

    test(`connected art: removing a ${type} junction branch selects a straight or corner`, () => {
      const center = piece(type, 5, 5), north = piece(type, 5, 4),
        east = piece(type, 6, 5), west = piece(type, 4, 5);
      const entry = tile([center, north, east, west]);
      assert.eq(frame(art(entry, spent(type)), center), 6, 'north T');
      assert.eq(frame(art(entry, spent(type, [north.id])), center), 0, 'east-west straight');
      assert.eq(frame(art(entry, spent(type, [west.id])), center), 4, 'north-east corner');
    });

    test(`connected art: a burned ${type} section no longer joins its neighbor`, () => {
      const a = piece(type, 4, 5), b = piece(type, 5, 5), entry = tile([a, b]);
      const result = art(entry, spent(type, [], [b.id]));
      assert.falsy(result.has(b));
      if (type === 'wall') assert.eq(result.get(a).kind, 'mineralrock');
      else {
        assert.eq(result.get(a)._plantArt, 'zone_hedge_single');
        assert.eq(result.get(a)._hedgeFrame, undefined);
      }
    });
  }

  test('connected art: a neighbor just beyond the viewport keeps the visible section connected', () => {
    const focus = piece('wall', 4, 5), visible = piece('wall', 5, 5), outside = piece('wall', 6, 5);
    const entry = tile([focus, visible, outside]);
    const result = art(entry, spent('wall'), focus, 10);
    assert.eq(frame(result, visible), 0, 'the offscreen east neighbor completes the straight');
    assert.eq(frame(art(entry, spent('wall', [outside.id]), focus, 10), visible), 12,
      'extracting that offscreen neighbor exposes an end');
  });

  test('connected art: world coordinates without local cell fields never wrap a row edge', () => {
    const end = piece('hedge', N - 1, 5), west = piece('hedge', N - 2, 5), nextRow = piece('hedge', 0, 6);
    assert.eq(end._ix, undefined); assert.eq(end._iy, undefined);
    const result = art(tile([end, west, nextRow]), spent('hedge'));
    assert.eq(frame(result, end), 12, 'last column only connects west');
    assert.eq(result.get(nextRow)._plantArt, 'zone_hedge_single', 'first column of next row stays isolated');
  });

  test('connected art: unrelated garden shrubs and quarry finds do not create joins', () => {
    const hedge = piece('hedge', 4, 4), otherGarden = { ...piece('hedge', 5, 4), zoneVariant: 'formal_garden' };
    const wall = piece('wall', 4, 7), find = { ...piece('wall', 5, 7), kind: 'mineralrock', zoneLayer: 'find' };
    const result = art(tile([hedge, otherGarden, wall, find]), spent('wall'));
    assert.eq(result.get(hedge)._plantArt, 'zone_hedge_single');
    assert.eq(result.get(wall).kind, 'mineralrock');
    assert.falsy(result.has(find), 'find artwork remains independent');
  });
})();
