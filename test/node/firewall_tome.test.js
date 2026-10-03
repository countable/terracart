(function () {
  function scene(overrides = {}) {
    const s = Object.assign(new SceneFire(), {
      save: { energy: 100, inv: [{ id: 'tome_fire_wall', count: 1 }], selSlot: 0 },
      startWorldM: { x: 0, y: 0 }, playerM: { x: 252, y: 252 },
      originPx: { x: 0, y: 0 }, mPerPx: 1, cellsPerTile: 32, cellM: 8,
      depth: 2, facing: { x: 0, y: -1 }, flashes: [],
      _groundFireFuel() { return []; },
      isRestingAtHome() { return false; },
      flash(message) { this.flashes.push(message); },
      flashAtCell(message) { this.flashes.push(message); },
    }, overrides);
    // Exercise the shared activation lock and own cooldown of the other tomes.
    for (const name of ['_tomeReady', '_tomeSpent']) {
      const match = SCENE_SRC.match(new RegExp(`\\n  ${name}\\(id\\) \\{\\n([\\s\\S]*?)\\n  \\}\\n`));
      const cooldown = SCENE_SRC.match(/const TOME_COOLDOWN_MS = ([^;]+);/)[1];
      s[name] = new Function('TOME_COOLDOWN_MS', 'shortDuration',
        'return function(id) {' + match[1] + '}')(new Function('return ' + cooldown)(), ms => String(ms));
    }
    s.playerScreen = () => ({ x: 0, y: 0 });
    s.playerBodyDy = () => 0;
    return s;
  }

  test('wall of fire tome: five perpendicular cells ahead for all eight compass directions', () => {
    for (const [dx, dy] of [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]]) {
      const s = scene({ facing: { x: dx, y: dy } });
      assert.truthy(s.readTomeFirewall());
      assert.eq(Object.keys(s.save.groundFire).length, 5);
      for (let offset = -2; offset <= 2; offset++) {
        assert.truthy(s.save.groundFire[GroundFire.key(2, 31 + dx - dy * offset, 31 + dy + dx * offset)],
          `compass ${dx},${dy}, wall cell ${offset}`);
      }
      assert.falsy(s.save.groundFire[GroundFire.key(2, 31, 31)], 'player cell stays clear');
      assert.eq(s.save.inv[0].count, 1, 'the tome is reusable');
      assert.inRange(s.save.tomeReadyAt - Date.now(), 3600e3 - 1000, 3600e3);
      assert.inRange(s.save.tomeMagicCd.tome_fire_wall - Date.now(), 8 * 3600e3 - 1000, 8 * 3600e3);
      assert.falsy(s.readTomeFirewall(), 'second reading waits for cooldown');
    }
  });

  test('wall of fire tome: compass quantizes and unusable burned ground preserves both cooldowns', () => {
    const s = scene({ facing: { x: 0.12, y: -0.9 } });
    for (let x = 29; x <= 33; x++) {
      s._igniteGroundCell({ cellIX: x, cellIY: 30 }, Date.now() - 60000);
      s.save.groundFire[GroundFire.key(2, x, 30)].extinguished = true;
    }
    assert.falsy(s.readTomeFirewall());
    assert.falsy(s.save.tomeMagicCd?.tome_fire_wall);
    assert.falsy(s.save.tomeReadyAt);
    assert.eq(s.flashes[0], 'No fresh ground — tome kept');
    s.facing = { x: 1, y: 0 };
    assert.truthy(s.readTomeFirewall(), 'a partly scorched wall can light the fresh cells');
    assert.eq(Object.keys(s.save.groundFire).length, 9, 'the overlapping burned cell stays burned');
    assert.truthy(s.save.groundFire[GroundFire.key(2, 32, 30)].extinguished);
  });

  test('wall of fire tome: invalid heading, wrong selection and downed player cannot cast', () => {
    for (const overrides of [{ facing: { x: 0, y: 0 } }, { facing: { x: NaN, y: 0 } },
      { save: { energy: 0, inv: [{ id: 'tome_fire_wall', count: 1 }], selSlot: 0 } },
      { save: { energy: 100, inv: [{ id: 'book', count: 1 }], selSlot: 0 } }]) {
      const s = scene(overrides);
      assert.falsy(s.readTomeFirewall());
      assert.falsy(s.save.tomeMagicCd?.tome_fire_wall);
      assert.falsy(s.save.tomeReadyAt);
      assert.falsy(s.save.groundFire);
    }
  });
  test('wall of fire tome: caster cell stays clear at fractional positions and tile edges', () => {
    for (const position of [248.01, 255.99, 256, 256.01]) {
      for (const [dx, dy] of [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]]) {
        const s = scene({ playerM: { x: position, y: position }, facing: { x: dx, y: dy } });
        const player = worldMetersToAbsCell(s, position, position);
        assert.truthy(s.readTomeFirewall());
        assert.eq(Object.keys(s.save.groundFire).length, 5);
        assert.falsy(s.save.groundFire[GroundFire.key(2, player.cellIX, player.cellIY)]);
      }
    }
  });
})();
