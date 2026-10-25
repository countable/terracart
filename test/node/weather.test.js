// Relay weather stays runtime-only: one effects table, bounded polling and surface effects.
(() => {
  test('weather: published condition codes map to display kinds only while precipitation falls', () => {
    assert.eq(Weather.conditionKind(1153, 0.2), 'drizzle');
    assert.eq(Weather.conditionKind(1189, 1), 'rain');
    assert.eq(Weather.conditionKind(1204, 1), 'sleet');
    assert.eq(Weather.conditionKind(1225, 1), 'snow');
    assert.eq(Weather.conditionKind(1189, 0), 'none');
    assert.eq(Weather.conditionKind(1000, 2), 'none');
  });

  test('weather: precipitation art stays on the surface', () => {
    assert.eq(Weather.effectiveKind('rain', 0), 'rain');
    assert.eq(Weather.effectiveKind('drizzle', 1), 'none');
    assert.eq(Weather.effectiveKind('snow', 3), 'none');
    assert.eq(Weather.effectiveKind('unknown', 0), 'none');
  });

  test('weather: time or one kilometre of movement earns one relay refresh', () => {
    const kelowna = { lat: 49.888, lon: -119.496 };
    assert.truthy(Weather.pollNeeded(0, null, 1, kelowna));
    assert.falsy(Weather.pollNeeded(1000, kelowna, 1000 + Weather.POLL_MS - 1,
      { lat: 49.889, lon: -119.496 }));
    assert.truthy(Weather.pollNeeded(1000, kelowna, 1000 + Weather.POLL_MS, kelowna));
    assert.truthy(Weather.pollNeeded(1000, kelowna, 2000,
      { lat: 49.898, lon: -119.496 }), 'about 1.1 km north refreshes before the timer');
  });

  test('weather: rounded relay temperature and wind survive the compact client state', () => {
    Weather.accept({ temp: -0.4, windKph: 18.26, kind: 'none', precip: false, cachedAt: 7 });
    assert.eq(Weather.state().temp, 0); assert.eq(Weather.state().windKph, 18.3); assert.eq(Weather.band(), 'cold');
    assert.eq(Weather.coldGrassTint({ depth: 0 }, 'longgrass'), Weather.EFFECTS.cold.grassTint);
    assert.eq(Weather.coldGrassTint({ depth: 1 }, 'longgrass'), null);
    assert.eq(Weather.coldGrassTint({ depth: 0 }, 'flowers'), null);
    Weather.accept({ temp: 28, kind: 'none', precip: false }); assert.eq(Weather.band(), 'mild');
    Weather.accept({ temp: 29, kind: 'none', precip: false }); assert.eq(Weather.band(), 'hot');
  });

  test('weather: deterministic hot/cold slime births use stable ids and leave other kinds alone', () => {
    for (const [temp, themed] of [[-2, 'split_slime'], [32, 'fire_slime']]) {
      Weather.accept({ temp, kind: 'none', precip: false });
      const scene = { depth: 0 }, values = [];
      for (let i = 0; i < 100; i++) values.push(Weather.enemyBirthKind('slime', 'spawn-' + i, scene));
      assert.gt(values.filter(kind => kind === themed).length, 50);
      assert.eq(Weather.enemyBirthKind('slime', 'spawn-4', scene), Weather.enemyBirthKind('slime', 'spawn-4', scene));
      assert.eq(Weather.enemyBirthKind('goblin', 'spawn-4', scene), 'goblin');
    }
  });

  test('weather: rain waters a stable crop without a growth-stage jump', () => {
    Weather.accept({ temp: 12, precip: true, kind: 'rain' });
    const a = { crop: 'potato', x: 2, y: 1, stage: 1, watered_t: 0 };
    const b = { crop: 'potato', x: 1, y: 1, stage: 1, watered_t: 0 };
    const scene = { depth: 0, save: { planted: [a, b] }, drawObjects() { this.drawn = (this.drawn || 0) + 1; } };
    assert.falsy(Weather.waterRainCrop(scene, 1000));
    assert.truthy(Weather.waterRainCrop(scene, 1000 + Weather.EFFECTS.rain.cropCadenceMs));
    assert.eq(b.stage, 1); assert.eq(b.watered_t, 1000 + Weather.EFFECTS.rain.cropCadenceMs);
    assert.eq(b.hold_ms, Crops.stageHoldMs('potato')); assert.eq(a.watered_t, 0);
  });

  test('weather: heat affects work only until Hardworking and feedback is rate-limited', () => {
    const now = 100000, scene = { depth: 0, save: {}, flash(text) { (this.messages ||= []).push(text); } };
    Weather.accept({ temp: 31, kind: 'none', precip: false });
    assert.eq(Weather.workCost(scene, 3, now), 6);
    assert.truthy(Weather.showHeatFeedback(scene, 1, 2, now));
    assert.falsy(Weather.showHeatFeedback(scene, 1, 2, now + 10));
    assert.eq(scene.messages.join(','), Weather.EFFECTS.hot.feedback);
    assert.truthy(Buffs.extend(scene.save, scene, 'work', Weather.EFFECTS.hot.hardworkingMs, now));
    assert.eq(Weather.workCost(scene, 3, now + 1), 3);
  });

  test('weather: cold and hot water entry use shared Frozen and Hardworking rows once per entry', () => {
    const now = 200000, scene = { depth: 0, save: {} };
    Conditions.normalize(scene.save);
    Weather.accept({ temp: -3, kind: 'none', precip: false });
    assert.truthy(Weather.waterContact(scene, true, now));
    assert.eq(scene.save.conditions.frozen.remainingMs, Weather.EFFECTS.cold.frozenMs);
    assert.falsy(Weather.waterContact(scene, true, now + 1), 'standing in water is not a new entry');
    Weather.waterContact(scene, false, now + 2);
    Weather.accept({ temp: 35, kind: 'none', precip: false });
    assert.truthy(Weather.waterContact(scene, true, now + 3));
    assert.eq(Buffs.until('work', scene.save, scene), now + 3 + Weather.EFFECTS.hot.hardworkingMs);
  });

  test('weather: cold grass clock advances only from foreground ticks and never resets between bands', () => {
    const scene = { depth: 0 };
    Weather.accept({ temp: -2, kind: 'none', precip: false });
    Weather.advanceGameplayClock(scene, 1000, 100);
    Weather.advanceGameplayClock(scene, 999999, 150);
    assert.eq(Weather.coldGrassPauseMs(scene), 250, 'wall-clock jump is ignored when foreground delta is supplied');
    Weather.accept({ temp: 10, kind: 'none', precip: false });
    Weather.advanceGameplayClock(scene, 1000000, 50);
    Weather.advanceGameplayClock(scene, 1000050, 50);
    assert.eq(Weather.coldGrassPauseMs(scene), 300, 'transition preserves prior pause; mild frames stop adding');
  });

  test('weather: scene and sole-render-pass integrations call the shared helpers', () => {
    assert.truthy(SCENE_SRC.includes('Weather.waterContact(this, weatherWater)'));
    assert.truthy(SCENE_SRC.includes('Weather.workCost(this, cost)'));
    assert.truthy(SCENE_SRC.includes('Weather.tick(this, Date.now(), dt * 1000)'));
    assert.truthy(RENDER_SRC.includes('Weather.coldGrassTint(scene, p.crop)'));
    assert.truthy(LIGHTING_SRC.includes('Weather.lightEffect(scene)'));
  });
})();
