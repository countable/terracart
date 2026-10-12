// Building walls belong to the background, regardless of actor position.
(() => {
  test('building background: walls sit above footprints and below interaction layers', () => {
    const layers = ['buildingGeomContainer', 'buildingWallContainer', 'padContainer',
      'trapContainer', 'shadowContainer', 'worldContainer'];
    const positions = layers.map(name => SCENE_SRC.indexOf(`this.${name} = this.add.container`));
    positions.forEach((position, i) => {
      assert.gte(position, 0, `${layers[i]} exists`);
      if (i) assert.gt(position, positions[i - 1], `${layers[i]} draws over ${layers[i - 1]}`);
    });
    assert.truthy(SCENE_SRC.includes('this.buildingWallContainer.setMask(mask)'), 'walls share the viewport mask');
  });

  test('building background: walls no longer change actor seating or enter the world sort', () => {
    assert.eq(Render.seatAgainstWalls, undefined, 'wall seating helper is removed');
    assert.falsy(RENDER_SRC.includes('wallSeat'), 'actors have no wall-specific seating');
    const start = RENDER_SRC.indexOf('const zList =');
    const end = RENDER_SRC.indexOf('Render.sortWorldDepth(zList)', start);
    assert.gte(start, 0, 'world sort input exists');
    assert.gt(end, start, 'world sort follows input collection');
    const input = RENDER_SRC.slice(start, end);
    assert.falsy(input.includes('_buildingUprightPieces'), 'polygon walls stay in the background');
    assert.falsy(input.includes('_uprightPieces'), 'tiled walls stay in the background');
  });

  test('building background: ordinary scenery and actors still sort at their own feet', () => {
    const tree = { groundY: 10, rank: 1 }, player = { groundY: 9.9, rank: 3 };
    for (const y of [9.9, 10, 10.1]) {
      player.groundY = y;
      const rows = [player, tree];
      Render.sortWorldDepth(rows);
      assert.eq(rows.indexOf(player) > rows.indexOf(tree), y >= 10, `player feet at ${y}`);
      assert.eq(player.groundY, y, 'sorting never moves player feet');
    }
  });
})();
