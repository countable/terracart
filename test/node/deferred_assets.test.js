(() => {
  function fixture() {
    const assets = new Function('window', 'EnemyRoster', 'SpriteLayout', ASSETS_SRC + '\nreturn ASSETS;')({}, EnemyRoster, SpriteLayout);
    const handlers = new Map(), requests = [], textures = new Map(), animations = new Map();
    let starts = 0;
    const load = {
      on(event, fn) { const list = handlers.get(event) || []; list.push({ fn }); handlers.set(event, list); },
      once(event, fn) { const list = handlers.get(event) || []; list.push({ fn, once: true }); handlers.set(event, list); },
      spritesheet(key, path, config) { requests.push({ key, path, config }); },
      image(key, path) { requests.push({ key, path }); },
      start() { starts++; },
    };
    const scene = { load, textures: { exists: (key) => textures.has(key), get: (key) => textures.get(key) },
      anims: {
        get: (key) => animations.get(key),
        generateFrameNumbers: (key, { start, end }) => Array.from({ length: end - start + 1 }, (_, i) => ({ key, frame: start + i })),
        create(config) { animations.set(config.key, config); },
      },
      isDragonActive: () => false,
    };
    for (const name of ['preload', '_queueAsset', '_ensureAsset', '_createAnim']) {
      const match = SCENE_SRC.match(new RegExp(`^  ${name}\\(([^)]*)\\) \\{([\\s\\S]*?)^  \\}`, 'm'));
      assert.truthy(match, `extract actual ${name} method`);
      scene[name] = new Function('ASSETS', 'window', `return function(${match[1]}) {${match[2]}}`)(assets, {});
    }
    const emit = (event, value) => {
      const listeners = handlers.get(event) || [];
      handlers.set(event, listeners.filter((listener) => !listener.once));
      for (const listener of listeners) listener.fn(value);
    };
    const complete = (key, texture = {}) => {
      textures.set(key, texture);
      emit(`filecomplete-${assets[key].kind}-${key}`);
    };
    return { scene, assets, textures, animations, requests, complete, emit, starts: () => starts };
  }

  test('deferred assets: preload queues every missing core asset and no optional art', () => {
    const { scene, assets, textures, requests, starts } = fixture();
    textures.set('trees', {});
    scene.preload();
    const expected = Object.keys(assets).filter((key) => !assets[key].deferred && key !== 'trees').sort();
    assert.eq(requests.map((r) => r.key).sort().join(','), expected.join(','));
    assert.eq(new Set(requests.map((r) => r.key)).size, requests.length, 'each catalog key loads once');
    assert.eq(starts(), 0, 'Phaser starts the normal preload lifecycle');
    assert.falsy(scene._ensureAsset('missing-catalog-key'));
    assert.falsy(scene._ensureAsset('house'), 'core assets are not requeued by lazy consumers');
    assert.eq(starts(), 0);
  });

  test('deferred assets: repeated requests queue one sheet and animation becomes ready on completion', () => {
    const { scene, requests, complete, animations, starts } = fixture();
    for (let i = 0; i < 30; i++) assert.falsy(scene._ensureAsset('dragon'));
    assert.eq(requests.length, 1);
    assert.eq(starts(), 1);
    assert.eq(requests[0].config.frameWidth, 96);
    assert.eq(requests[0].config.frameHeight, 96);
    assert.falsy(animations.has('dragon-fly'), 'no frameless animation is created before the sheet arrives');
    complete('dragon');
    assert.truthy(scene._ensureAsset('dragon'));
    assert.eq(animations.get('dragon-fly').frames.length, 8);
    assert.eq(animations.get('dragon-fly').frameRate, 10);
    assert.eq(starts(), 1, 'ready art never restarts the loader');
  });

  test('deferred assets: image requests deduplicate and core postprocessing runs once on completion', () => {
    const { scene, requests, complete } = fixture();
    scene._ensureAsset('pet_story_clearing');
    scene._ensureAsset('pet_story_clearing');
    assert.eq(requests.length, 1);
    assert.eq(requests[0].config, undefined, 'plain images do not get spritesheet framing');
    complete('pet_story_clearing');
    assert.truthy(scene._ensureAsset('pet_story_clearing'));
    scene._queueAsset('house');
    const frames = [], texture = { add(...args) { frames.push(args); } };
    assert.eq(frames.length, 0);
    complete('house', texture); complete('house', texture);
    assert.eq(frames.length, 1, 'completion hook is one-shot');
    assert.eq(frames[0].join(','), 'front,0,148,3,72,95');
    scene._queueAsset('house');
    assert.eq(requests.filter((r) => r.key === 'house').length, 1, 'loaded core art is not requested twice');
  });

  test('deferred assets: late dragon completion transforms only an unexpired buff after animation setup', () => {
    for (const activeOnCompletion of [true, false]) {
      const { scene, complete, animations } = fixture();
      let buffActive = true;
      const applied = [];
      scene.isDragonActive = () => buffActive;
      scene._applyDragonSkin = (on) => {
        assert.eq(animations.get('dragon-fly').frames.length, 8, 'animation exists before visual transform');
        applied.push(on);
      };
      scene._ensureAsset('dragon');
      assert.eq(applied.length, 0);
      buffActive = activeOnCompletion;
      complete('dragon');
      assert.eq(applied.join(','), activeOnCompletion ? 'true' : '', 'expired buff stays human');
      assert.truthy(animations.has('dragon-fly'), 'late completion still prepares the next potion');
    }
  });

  test('deferred assets: optional failures use the existing single retry and retain completion processing', () => {
    const { scene, requests, emit, complete, animations } = fixture();
    scene.preload();
    scene._ensureAsset('dragon');
    emit('loaderror', { key: 'dragon' });
    emit('loaderror', { key: 'dragon' });
    const dragonRequests = requests.filter((r) => r.key === 'dragon');
    assert.eq(dragonRequests.length, 2, 'one bounded retry, no load-error loop');
    assert.truthy(dragonRequests[1].path.endsWith('?retry=1'));
    assert.eq(dragonRequests[1].config.frameWidth, 96);
    assert.falsy(animations.has('dragon-fly'));
    complete('dragon');
    assert.eq(animations.get('dragon-fly').frames.length, 8, 'retry still reaches original completion hook');
  });
})();
