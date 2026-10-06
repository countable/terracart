(function () {
  const NOW = 1800000000000;
  function scene() {
    return {
      depth: 0, cellsPerTile: 8, cellM: 8, mPerPx: 64 / WorldGen.TILE_PX,
      originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 },
      playerM: { x: 44, y: 44 }, save: { energy: 100 }, _characterBodies: [],
      cellAt(x, y) {
        return { loaded: true, type: WorldGen.T.CAVE_FLOOR,
          cellIX: Math.floor(x / 8), cellIY: Math.floor(y / 8) };
      },
    };
  }
  function web(s, x = 28, y = 28, now = NOW) {
    SpiderWebs.launch(s, { x: 12, y: 28, kind: 'spider' }, x, y);
    const shot = SpiderWebs.lists(s, now).shots[0];
    SpiderWebs.land(s, shot, now);
    s._spiderWebRuntime.shots.length = 0;
    return SpiderWebs.lists(s, now).webs[0];
  }

  test('spider webs: shot targets a fixed cell and makes no ground web before arrival', () => {
    const s = scene(), spider = { x: 12, y: 28, kind: 'spider' };
    assert.truthy(SpiderWebs.launch(s, spider, 31, 25));
    const shot = SpiderWebs.lists(s, NOW).shots[0];
    assert.eq(shot.targetX, 28); assert.eq(shot.targetY, 28);
    s.playerM = { x: 52, y: 52 }; spider.x = 4;
    SpiderWebs.tick(s, 0.1, NOW);
    assert.eq(SpiderWebs.lists(s, NOW).webs.length, 0);
    assert.eq(shot.fromX, 12); assert.eq(shot.targetX, 28);
    assert.gt(shot.x, 12); assert.lt(shot.x, 28);
    SpiderWebs.tick(s, 1, NOW + 1000);
    const landed = SpiderWebs.lists(s, NOW + 1000);
    assert.eq(landed.shots.length, 0); assert.eq(landed.webs.length, 1);
    assert.eq(landed.webs[0].cellIX, 3); assert.eq(landed.webs[0].cellIY, 3);
  });

  test('spider webs: saved cell expires after one wall-clock day across reloads', () => {
    const s = scene(), patch = web(s);
    assert.eq(patch.expiresAt, NOW + 86400000);
    const restored = scene(); restored.save = JSON.parse(JSON.stringify(s.save));
    assert.eq(SpiderWebs.lists(restored, NOW + 86400000 - 1).webs.length, 1);
    SpiderWebs.tick(restored, 0.01, NOW + 86400000);
    assert.eq(SpiderWebs.lists(restored, NOW + 86400000).webs.length, 0);
  });

  test('spider webs: repeated landing refreshes one cell and depth isolates webs', () => {
    const s = scene(); web(s); web(s, 29, 30, NOW + 1000);
    assert.eq(SpiderWebs.lists(s, NOW + 1000).webs.length, 1);
    assert.eq(SpiderWebs.lists(s, NOW + 1000).webs[0].expiresAt, NOW + 1000 + 86400000);
    s.depth = 1;
    assert.eq(SpiderWebs.lists(s, NOW + 1000).webs.length, 0);
    s.playerM = { x: 28, y: 28 }; SpiderWebs.tick(s, 0.01, NOW + 1000);
    assert.falsy(s.save.conditions?.paralysis);
    s.depth = 0;
    assert.eq(SpiderWebs.lists(s, NOW + 1000).webs.length, 1);
  });

  test('spider webs: a depth transition discards travelling shots without landing elsewhere', () => {
    const s = scene();
    SpiderWebs.launch(s, { x: 12, y: 28, kind: 'spider' }, 28, 28);
    s.depth = 1; SpiderWebs.tick(s, 1, NOW);
    assert.eq(SpiderWebs.lists(s, NOW).shots.length, 0);
    assert.eq(SpiderWebs.lists(s, NOW).webs.length, 0);
    s.depth = 0;
    assert.eq(SpiderWebs.lists(s, NOW).webs.length, 0);
  });

  test('spider webs: unloaded and solid ground reject a landing', () => {
    for (const ground of [{ loaded: false }, { loaded: true, type: WorldGen.T.CAVE_WALL }]) {
      const s = scene();
      SpiderWebs.launch(s, { x: 12, y: 28, kind: 'spider' }, 28, 28);
      s.cellAt = () => ground;
      SpiderWebs.tick(s, 1, NOW);
      assert.eq(SpiderWebs.lists(s, NOW).webs.length, 0);
    }
  });

  test('spider webs: touching paralyzes for six seconds once per entry', () => {
    const s = scene(); web(s); s.playerM = { x: 28, y: 28 };
    SpiderWebs.tick(s, 0.01, NOW);
    assert.eq(s.save.conditions.paralysis.remainingMs, 6000);
    s.save.conditions.paralysis.remainingMs = 1000;
    SpiderWebs.tick(s, 0.01, NOW + 5000);
    assert.eq(s.save.conditions.paralysis.remainingMs, 1000, 'stationary contact does not reset the timer');
    delete s.save.conditions.paralysis;
    SpiderWebs.tick(s, 0.01, NOW + 6000);
    assert.falsy(s.save.conditions.paralysis, 'remaining on the cell does not trap forever');
    s.playerM = { x: 44, y: 28 }; SpiderWebs.tick(s, 0.01, NOW + 7000);
    s.playerM = { x: 28, y: 28 }; SpiderWebs.tick(s, 0.01, NOW + 8000);
    assert.eq(s.save.conditions.paralysis.remainingMs, 6000);
  });

  test('spider webs: swept movement catches a crossed web and living creatures are caught too', () => {
    const s = scene(); web(s);
    s.playerM = { x: 12, y: 28 }; SpiderWebs.tick(s, 0.01, NOW);
    s.playerM = { x: 44, y: 28 }; SpiderWebs.tick(s, 0.01, NOW + 100);
    assert.eq(s.save.conditions.paralysis.remainingMs, 6000);
    const creature = { id: 'web-walker', kind: 'goblin', x: 28, y: 28, _hp: 10 };
    s._characterBodies = [creature]; SpiderWebs.tick(s, 0.01, NOW + 200);
    assert.eq(creature._paralysisUntil, NOW + 6200);
    SpiderWebs.tick(s, 0.01, NOW + 1000);
    assert.eq(creature._paralysisUntil, NOW + 6200, 'creature timer is not refreshed while stationary');
    creature.x = 44; SpiderWebs.tick(s, 0.01, NOW + 7000);
    creature.x = 28; SpiderWebs.tick(s, 0.01, NOW + 8000);
    assert.eq(creature._paralysisUntil, NOW + 14000, 'creature re-entry applies a fresh six seconds');
  });

  test('spider webs: rendering uses the offset viewport and reuses layers cleared on depth changes', () => {
    const s = scene(), graphics = [], ground = [], airborne = [];
    Object.assign(s, {
      playerM: { x: 28, y: 28 }, viewCenterX: 176, viewCenterY: 500,
      viewLeft: 0, viewTop: 324, viewSize: 352,
      cobbleContainer: { add(g) { ground.push(g); } },
      boltContainer: { add(g) { airborne.push(g); } },
      add: { graphics() {
        const g = {
          rectangles: [], lines: [], clears: 0,
          clear() { this.rectangles.length = 0; this.lines.length = 0; this.clears++; },
          fillRect(...args) { this.rectangles.push(args); },
          lineBetween(...args) { this.lines.push(args); },
          fillStyle() {}, lineStyle() {}, beginPath() {}, moveTo() {},
          lineTo() {}, strokePath() {}, fillCircle() {},
        };
        graphics.push(g); return g;
      } },
    });
    const now = Date.now();
    web(s, 28, 28, now);
    SpiderWebs.launch(s, { x: 12, y: 28, kind: 'spider' }, 36, 28);
    SpiderWebs.tick(s, 0.1, now);
    Render.drawSpiderWebs(s);
    assert.eq(graphics.length, 2, 'web and shot remain visible below screen y=352');
    assert.eq(ground.length, 1); assert.eq(airborne.length, 1);
    assert.eq(JSON.stringify(ground[0].rectangles),
      JSON.stringify([[176 - CELL_PX / 2, 500 - CELL_PX / 2, CELL_PX, CELL_PX]]),
      'the ground web fills exactly the targeted cell at its projected position');
    assert.eq(airborne[0].lines.length, 2, 'travelling silk has its dark edge and light strand');
    assert.eq(JSON.stringify(airborne[0].lines[0]),
      JSON.stringify([176 - 2 * CELL_PX, 500, 176 - 1.5 * CELL_PX, 500]),
      'strand extends from its fixed launch point to the travelling tip');
    Render.drawSpiderWebs(s);
    assert.eq(graphics.length, 2, 'subsequent frames reuse both graphics layers');
    assert.eq(ground[0].rectangles.length, 1, 'redraw clears the previous frame');
    assert.eq(airborne[0].lines.length, 2);
    s.depth = 1;
    Render.drawSpiderWebs(s);
    assert.eq(graphics.length, 2);
    assert.eq(ground[0].rectangles.length, 0, 'old-depth ground silk is erased');
    assert.eq(airborne[0].lines.length, 0, 'old-depth travelling silk is erased');
    assert.eq(ground[0].clears, 2); assert.eq(airborne[0].clears, 2);
  });
  test('flight: ground webs do not paralyze until landing on them', () => {
    const s = scene(); web(s); s.playerM = { x: 28, y: 28 };
    s.save.flightPotionUntil = NOW + 60000;
    assert.falsy(SpiderWebs.contact(s, 'player', NOW)); assert.falsy(s.save.conditions?.paralysis);
    assert.truthy(SpiderWebs.contact(s, 'player', NOW + 60000));
    assert.truthy(s.save.conditions.paralysis);
  });

})();
