// Exercise the live scene method with a manual Phaser event clock.
(function () {
  const start = SCENE_SRC.indexOf('  _afterWreckGather(fn, house) {');
  const body = SCENE_SRC.slice(start, SCENE_SRC.indexOf('\n  }\n', start) + 4);
  const repair = new Function('playerWorldM', 'Combat', 'WRECK_GATHER_MS',
    `return ({${body}})._afterWreckGather;`)(s => ({ ...s.playerM }),
    { playerDowned: energy => energy <= 0 }, 3000);
  function fixture() {
    const listeners = new Map();
    const shape = () => ({
      x: 0, y: 0, depth: 10, displayHeight: 30, anims: { timeScale: 1 },
      setPosition(x, y) { this.x = x; this.y = y; return this; },
      setRotation() { return this; }, setScale() { return this; },
      setDepth() { return this; }, clear() { return this; },
      fillStyle() { return this; }, fillRect() { return this; },
      destroy() { this.destroyed = true; },
    });
    const tool = shape();
    const scene = {
      depth: 0, cellM: 10, save: { energy: 100 }, playerM: { x: 0, y: 30 },
      player: shape(), playerShadow: shape(), hits: [], modes: [],
      events: {
        on(k, fn) { listeners.set(k, fn); }, once(k, fn) { listeners.set(k, fn); },
        off(k) { listeners.delete(k); },
      },
      add: { graphics: () => tool },
      _houseBlastGeometry: () => ({ x: 0, y: 0, halfW: 10, halfH: 10 }),
      playerScreen: () => ({ x: 0, y: 30 }), playerBodyDy: () => -8,
      playerBodyRotation: () => 0,
      worldMetersToScreen: (x, y) => ({ x, y }),
      _playDirected(p, mode) { this.modes.push(mode); },
      _burstAtWorld(kind, x, y) { this.hits.push({ x, y }); },
    };
    return { scene, tool, listeners, advance: ms => listeners.get('postupdate')?.(0, ms) };
  }
  test('wreck repair: four walls, three seconds, one completion and no GPS movement', () => {
    const f = fixture(); let finished = 0;
    repair.call(f.scene, () => finished++, { id: 'wreck' });
    f.advance(100);
    assert.eq(f.scene.modes.at(-1), 'walk');
    f.advance(400);
    f.advance(750); f.advance(750); f.advance(750);
    assert.eq(finished, 0, 'house remains a wreck while working');
    assert.eq(f.scene.hits.length, 4, 'the sampled hammer phase hits every side');
    assert.truthy(f.scene.hits[0].y > 0 && f.scene.hits[1].x > 0
      && f.scene.hits[2].y < 0 && f.scene.hits[3].x < 0, 'all four sides visited');
    assert.eq(f.scene.playerM.x, 0); assert.eq(f.scene.playerM.y, 30);
    f.advance(250);
    assert.eq(finished, 1);
    assert.eq(f.scene._wreckRepair, null);
    assert.eq(f.scene.player.x, 0); assert.eq(f.scene.player.y, 22);
    assert.eq(f.scene.player.anims.timeScale, 1);
    assert.truthy(f.tool.destroyed);
    assert.eq(f.listeners.size, 0);
    f.advance(3000); assert.eq(finished, 1);
  });
  test('wreck repair: shutdown, depth transition and downed cancel without completion', () => {
    for (const reason of ['shutdown', 'depth', 'downed']) {
      const f = fixture(); let finished = false;
      repair.call(f.scene, () => { finished = true; }, { id: 'wreck' });
      f.advance(500);
      if (reason === 'shutdown') f.listeners.get('shutdown')();
      if (reason === 'depth') { f.scene.depth = 1; f.advance(10); }
      if (reason === 'downed') { f.scene.save.energy = 0; f.advance(10); }
      assert.falsy(finished, reason);
      assert.eq(f.scene._wreckRepair, null, reason);
      assert.truthy(f.tool.destroyed, reason);
      assert.eq(f.listeners.size, 0, reason);
    }
  });
  test('wreck repair: a duplicate request cannot replace active work', () => {
    const f = fixture(); let first = 0, second = 0;
    repair.call(f.scene, () => first++, { id: 'one' });
    repair.call(f.scene, () => second++, { id: 'two' });
    f.advance(3000);
    assert.eq(first, 1); assert.eq(second, 0);
  });
})();
