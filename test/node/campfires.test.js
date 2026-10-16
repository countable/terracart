// One real day of heat, then a persistent, harmless smoking pit.
(() => {
  function method(name) {
    const match = SCENE_SRC.match(new RegExp('^  ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?^  \\}', 'm'));
    if (!match) throw new Error('Missing scene method: ' + name);
    return new Function('return ({' + match[0] + '})')()[name];
  }
  function withClock(now, fn) {
    const original = Date.now;
    Date.now = () => now;
    try { fn(); } finally { Date.now = original; }
  }
  const day = 24 * 60 * 60 * 1000;

  test('campfires: heat ends exactly 24 real hours after lighting', () => {
    assert.eq(Campfires.LIFETIME_MS, day);
    const fire = Campfires.light({ x: 2, y: 3, depth: 1 }, 100);
    assert.truthy(Campfires.active(fire, 100));
    assert.truthy(Campfires.active(fire, 100 + day - 1));
    assert.falsy(Campfires.active(fire, 100 + day));
    assert.falsy(Campfires.active(null, 100));
    assert.truthy(Campfires.active({}, 100), 'legacy row stays lit until migration');
  });

  test('campfires: offline reload preserves expiry and relighting preserves the pit', () => {
    const saved = { fires: [Campfires.light({ x: 2, y: 3, depth: 1 }, 100)] };
    const loaded = JSON.parse(JSON.stringify(saved));
    assert.falsy(Campfires.migrate(loaded, day * 2));
    const fire = loaded.fires[0];
    assert.falsy(Campfires.active(fire, day * 2));
    assert.eq(Campfires.light(fire, day * 2), fire);
    assert.eq(fire.x, 2);
    assert.eq(fire.y, 3);
    assert.eq(fire.depth, 1);
    assert.truthy(Campfires.active(fire, day * 3 - 1));
    assert.falsy(Campfires.active(fire, day * 3));
  });

  test('campfires: legacy timestamp migration runs once and asks to persist', () => {
    const save = { fires: [{ x: 0 }, { litAt: NaN }, { litAt: 0 }] };
    assert.truthy(Campfires.migrate(save, 123));
    assert.eq(save.fires[0].litAt, 123);
    assert.eq(save.fires[1].litAt, 123);
    assert.eq(save.fires[2].litAt, 0);
    assert.falsy(Campfires.migrate(save, 456));
    const normalized = { startedAt: 10, hasHarvested: true, fires: [{ x: 0, y: 0 }] };
    withClock(123, () => assert.truthy(SaveState.normalize(normalized)));
    assert.eq(normalized.fires[0].litAt, 123);
    withClock(456, () => assert.falsy(SaveState.normalize(normalized)));
    assert.eq(normalized.fires[0].litAt, 123);
  });

  test('campfires: shared rest, ward and hearth proximity stops at expiry on its own depth', () => {
    const fire = Campfires.light({ x: 0, y: 0, depth: 1 }, 100);
    const scene = { save: { fires: [fire], scarecrows: [{ x: 0, y: 0, depth: 1 }] }, cellM: 5, depth: 1 };
    const near = method('_nearAny').bind(scene);
    withClock(100 + day - 1, () => {
      assert.truthy(near('fires', 0, 0, 2));
      scene.depth = 0;
      assert.falsy(near('fires', 0, 0, 2));
      scene.depth = 1;
    });
    withClock(100 + day, () => {
      assert.falsy(near('fires', 0, 0, 2));
      assert.truthy(near('scarecrows', 0, 0, 2), 'other wards do not expire');
    });
  });

  test('campfires: a smoking pit neither lights the cave nor routs ghosts', () => {
    const fire = Campfires.light({ x: 0, y: 0, depth: 1 }, 100);
    const scene = { save: { fires: [fire] }, depth: 1, cellM: 5, _lights: [] };
    const source = CREATURE_AI_SRC.match(/^function fireWardTrip\(scene, c\) \{[\s\S]*?^\}/m)[0];
    const ward = new Function('FIRE_REST_R', source + '; return fireWardTrip;')(2);
    withClock(100 + day - 1, () => {
      assert.eq(Lighting.collectFires(scene, 0, 0, 30), 1);
      assert.eq(ward(scene, { x: 0, y: 0 }), fire);
    });
    scene._lights = [];
    withClock(100 + day, () => {
      assert.eq(Lighting.collectFires(scene, 0, 0, 30), 0);
      assert.eq(scene._lights.length, 0);
      assert.eq(ward(scene, { x: 0, y: 0 }), null);
    });
  });

  test('campfires: cold pits cannot cook and flint relights the same saved row', () => {
    withClock(day * 2, () => {
      const fire = Campfires.light({ x: 0, y: 0, depth: 1 }, 0);
      const scene = makeScene({ depth: 1, cellM: 2, buildInventoryDOM() {}, flash() {} });
      const save = { fires: [fire], planted: [], inv: [{ id: 'meat', count: 2 }], selSlot: 0 };
      const ctx = Object.assign(makeCtx(scene, save), { cwmx: 0, cwmy: 0 });
      assert.falsy(TAP_HANDLERS.find(h => h.name === 'fire-held').try(ctx));
      assert.eq(save.inv[0].count, 2, 'raw food remains untouched');
      save.inv = [{ id: 'flint_shard', count: 2 }];
      assert.truthy(TAP_HANDLERS.find(h => h.name === 'extinguish-fire').try(ctx));
      assert.eq(save.fires.length, 1);
      assert.eq(save.fires[0], fire);
      assert.eq(fire.depth, 1);
      assert.eq(fire.litAt, day * 2);
      assert.eq(save.inv[0].count, 1);
      assert.truthy(ctx.dirty);
    });
  });

  test('campfires: stationary rendering switches to one smoking pit at expiry', () => {
    const start = RENDER_SRC.indexOf('  const fireNow = Date.now();', RENDER_SRC.indexOf('Render.drawObjects ='));
    const end = RENDER_SRC.indexOf('  // STREET LAMPS', start);
    assert.truthy(start > 0 && end > start);
    const lists = new Function('scene', '_curDepth', 'placedAs', 'sameAbsCell',
      RENDER_SRC.slice(start, end) + '; return { fireList, firepitList };');
    const fire = Campfires.light({ x: 0, y: 0, depth: 0 }, 100);
    const scene = { save: { fires: [fire], homeFirepit: { x: 0, y: 0 } } };
    const render = () => lists(scene, 0, (rows, kind) => rows.map(row => ({ ...row, kind })),
      (_s, x, y, px, py) => x === px && y === py);
    withClock(100 + day - 1, () => {
      assert.eq(render().fireList.length, 1);
      assert.eq(render().firepitList.length, 0);
    });
    withClock(100 + day, () => {
      const out = render();
      assert.eq(out.fireList.length, 0);
      assert.eq(out.firepitList.length, 1, 'home pit and expired fire share one smoke source');
      assert.eq(out.firepitList[0].kind, '_firepit');
    });
  });

  test('campfires: a burn confirmation cannot consume an item after the fire expires', () => {
    const original = document.getElementById;
    document.getElementById = () => null;
    try {
      let modal;
      const fire = Campfires.light({ x: 0, y: 0 }, 100);
      const scene = {
        save: { fires: [fire], inv: [{ id: 'wood', count: 2 }], selSlot: 0 },
        worldIconHTML: () => '', iconSpanHTML: () => '',
        showOfferModal(m) { modal = m; },
      };
      withClock(100 + day - 1, () => method('presentBurnConfirm').call(scene, 'wood', fire));
      assert.truthy(modal);
      withClock(100 + day, () => modal.onAccept());
      assert.eq(scene.save.inv[0].count, 2);
    } finally {
      document.getElementById = original;
    }
  });
})();
