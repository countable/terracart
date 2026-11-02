(function () {
  function renderer(entries, trailIds = [], covered = new Set()) {
    const start = RENDER_SRC.indexOf('Render.drawTreasureMarks = function');
    const end = RENDER_SRC.indexOf('\nRender.drawCells =', start);
    return new Function('viewAnchorWorldM', 'VIEW_CELLS', 'setOf', 'Starter',
      'treasureExposed', 'inViewBox', 'HiddenObjects', 'deltaMToScreen',
      'isGreatX', 'GREAT_X', 'forEachLoadedTile', 'covered',
      'const Render = { coverHidden: (scene, tr) => covered.has(tr.id) };\n'
        + RENDER_SRC.slice(start, end) + '\nreturn Render;')(
      () => ({ x: 88, y: 88 }), 11, values => new Set(values),
      { trailPaths: () => trailIds.map(id => ({ id })) }, treasureExposed,
      (dx, dy, half) => Math.abs(dx) < half && Math.abs(dy) < half,
      HiddenObjects, (scene, dx, dy) => ({ x: dx, y: dy }),
      () => false, {}, (tx, ty, fn) => entries.forEach(fn), covered);
  }
  test('treasure marks render above terrain, persist beside trails, and clear spent marks', () => {
    const tr = { id: 'trail-x', x: 104, y: 88 };
    const entry = { treasure: tr };
    const render = renderer([entry], [tr.id]);
    const layers = ['opaque terrain'], lines = [];
    let allocations = 0, clears = 0;
    const graphics = {
      clear() { clears++; lines.length = 0; },
      lineStyle() {},
      lineBetween(...args) { lines.push(args); },
    };
    const scene = { save: {}, cellM: 16, depth: 0,
      add: { graphics() { allocations++; return graphics; } },
      cobbleContainer: { add(g) { layers.push(g); } },
      playerToWorldCell: () => ({ tx: 0, ty: 0 }),
    };
    render.drawTreasureMarks(scene);
    assert.eq(layers[1], graphics, 'ink is placed above terrain in the ground overlay');
    assert.eq(lines.length, 2, 'a trail endpoint shows even before passive discovery');
    render.drawTreasureMarks(scene);
    assert.eq(allocations, 1, 'reuse the graphics layer');
    assert.eq(lines.length, 2, 'redraw without accumulating old ink');
    scene.save.foundTreasures = [tr.id];
    render.drawTreasureMarks(scene);
    assert.eq(lines.length, 0, 'digging clears the old X');
    assert.eq(clears, 3);
  });
  test('treasure marks overlay respects discovery, cover, and viewport', () => {
    const nearby = { id: 'nearby-x', x: 104, y: 88 };
    const underRock = { id: 'rock-x', x: 88, y: 88, coverRockId: 'rock' };
    const behindWall = { id: 'wall-x', x: 88, y: 88 };
    const far = { id: 'far-x', x: 10000, y: 88 };
    const entry = { extraTreasures: [nearby, underRock, behindWall, far] };
    const render = renderer([entry], [], new Set([behindWall.id]));
    let lines = 0;
    const scene = { save: {}, cellM: 16, depth: 0,
      add: { graphics: () => ({ clear() { lines = 0; }, lineStyle() {}, lineBetween() { lines++; } }) },
      cobbleContainer: { add() {} }, playerToWorldCell: () => ({ tx: 0, ty: 0 }),
    };
    render.drawTreasureMarks(scene);
    assert.eq(lines, 0, 'undiscovered marks remain hidden');
    scene.save.hiddenDiscoveries = Object.fromEntries(entry.extraTreasures.map(tr => [tr.id, true]));
    render.drawTreasureMarks(scene);
    assert.eq(lines, 2, 'only the discovered, exposed, visible mark draws');
    scene.save.brokenRocks = ['rock'];
    render.drawTreasureMarks(scene);
    assert.eq(lines, 4, 'removing the cover exposes the second X');
    entry.extraTreasures = [];
    scene.depth = 1;
    render.drawTreasureMarks(scene);
    assert.eq(lines, 0, 'switching tiles or depths clears previous marks');
  });
})();
