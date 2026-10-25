test('step support rises and falls symmetrically from any direction without movement history', () => {
  const rock = { kind: 'mineralrock', x: 30, y: -20 };
  const at = (dx, dy) => ObstacleStep.sample(30 + dx * 10, -20 + dy * 10, [rock], 10).liftPx;
  assert.eq(at(0, 0), 4);
  assert.eq(at(0.25, 0), 0, 'outer edge is a quarter-cell radius');
  assert.eq(at(0.3, 0), 0, 'outside the middle half-cell stays grounded');
  assert.gt(at(0.2, 0), 0);
  assert.eq(at(0.2, 0), at(0, -0.2));
  assert.eq(at(0.2, 0), at(-0.2, 0));
  const paused = at(0.2, 0);
  at(0, 0); // Walking forward and reversing returns exactly to the same height.
  assert.eq(at(0.2, 0), paused);
  assert.inRange(Math.abs(at(0.2, 0) - at(Math.sqrt(0.02), Math.sqrt(0.02))), 0, 1e-12);
});

test('step bands follow horizontal/vertical wall atlas connections, not full tiles', () => {
  const horizontal = { kind: 'stronghold_wall', variant: 0, x: 0, y: 0 };
  const vertical = { ...horizontal, variant: 1 };
  const at = (o, x, y) => ObstacleStep.sample(x, y, [o], 1).liftPx;
  assert.eq(at(horizontal, 0.45, 0), 5.5);
  assert.eq(at(horizontal, 0, 0.45), 0);
  assert.eq(at(vertical, 0.45, 0), 0);
  assert.eq(at(vertical, 0, 0.45), 5.5);
  assert.gt(at(horizontal, 0, 0.25), 0);
  assert.lt(at(horizontal, 0, 0.25), 5.5);
});

test('connected walls keep a flat support across cell seams and list both supports', () => {
  const walls = [0, 1, 2].map(x => ({ kind: 'stronghold_wall', variant: 0, x, y: 0 }));
  for (let x = 0; x <= 2; x += 0.025) assert.eq(ObstacleStep.sample(x, 0, walls, 1).liftPx, 5.5);
  assert.eq(ObstacleStep.sample(0.5, 0, walls, 1).supports.length, 2);
  assert.eq(ObstacleStep.sample(0.5, 0, [...walls, ...walls], 1).liftPx, 5.5);
});

test('corner and junction support respects arms and leaves unused corners on ground', () => {
  const corner = { kind: 'stronghold_wall', variant: 2, x: 0, y: 0 }; // E+S
  const at = (o, x, y) => ObstacleStep.sample(x, y, [o], 1).liftPx;
  assert.eq(at(corner, 0.5, 0), 5.5);
  assert.eq(at(corner, 0, 0.5), 5.5);
  assert.eq(at(corner, -0.5, 0), 0);
  assert.eq(at(corner, 0.5, 0.5), 0);
  const cross = { ...corner, variant: 10 };
  for (const [x, y] of [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) assert.eq(at(cross, x, y), 5.5);
});

test('bushes are centred, joined hedges give cover without lift, standing plants do not lift the player', () => {
  const bush = { kind: 'wildplant', crop: 'shrub', x: 0, y: 0 };
  const hedge = { ...bush, _plantArt: 'zone_hedge', _hedgeFrame: 1 };
  assert.eq(ObstacleStep.sample(0, 0, [bush], 1).liftPx, 3);
  assert.eq(ObstacleStep.sample(0.45, 0, [hedge], 1).liftPx, 0);
  assert.eq(ObstacleStep.sample(0, 0.45, [hedge], 1).liftPx, 0);
  assert.truthy(ObstacleStep.sample(0, 0.45, [hedge], 1).covered);
  assert.falsy(ObstacleStep.sample(0.45, 0, [hedge], 1).covered);
  assert.eq(ObstacleStep.sample(0, 0.45, [hedge], 1).supports.length, 0);
  assert.eq(WorldLayers.forObject(hedge), WorldLayers.STANDING_PROP);
  for (const crop of ['longgrass', 'mushroom', 'flint']) assert.eq(ObstacleStep.profile({ ...bush, crop }), null);
  assert.eq(ObstacleStep.profile({ kind: 'tree', size: 'large' }), null);
  assert.eq(ObstacleStep.profile({ kind: 'tar' }), null);
  assert.eq(ObstacleStep.profile({ kind: 'zone_prop', variant: 40 }), null);
  assert.eq(ObstacleStep.speedMul({liftPx: 3}), 0.7);
  assert.eq(ObstacleStep.speedMul({liftPx: 0}), 1);
  assert.eq(ObstacleStep.sample(0, 0, [], 1).liftPx, 0);
  assert.eq(ObstacleStep.sample(0, 0, [bush], 0).liftPx, 0);
});

test('support stays continuous at top and approach boundaries; balance vanishes while stopped', () => {
  const rock = { kind: 'mineralrock', x: 0, y: 0 };
  const p = ObstacleStep.profile(rock);
  const at = x => ObstacleStep.sample(x, 0, [rock], 1).liftPx;
  assert.lt(Math.abs(at(p.top - 1e-6) - at(p.top + 1e-6)), 1e-8);
  assert.lt(Math.abs(at(p.radius - 1e-6) - at(p.radius + 1e-6)), 1e-8);
  assert.eq(ObstacleStep.balance(0.3, 0), 0);
  assert.inRange(ObstacleStep.balance(0.3, 1), -0.035, 0.035);
  assert.eq(ObstacleStep.balance(0.3, 2), ObstacleStep.balance(0.3, 1));
});


test('step support follows player feet while the camera peeks away', () => {
  const start = RENDER_SRC.indexOf('  const stepObjects = [];');
  const end = RENDER_SRC.indexOf('  const supports = new Set', start);
  const collect = new Function('scene', 'filteredObj', 'plantedList', 'connectedArt', 'grassHidden', RENDER_SRC.slice(start, end));
  const x = 110, y = 220, cellM = 8;
  for (const peek of [{x:0,y:0}, {x:16,y:0}, {x:-16,y:16}]) {
    const rock = {kind:'mineralrock', x, y};
    const bush = {crop:'shrub', wildId:'support-bush', x, y};
    const distant = {kind:'mineralrock', x:x+24, y};
    const item = o => ({o, dx:o.x-x-peek.x, dy:o.y-y-peek.y});
    let objects;
    const scene = {cellM, startWorldM:{x:100,y:200}, playerM:{x:10,y:20},
      _updateObstacleStep(list) { objects=list; }};
    collect(scene, [item(rock),item(distant)], [{p:bush,dx:-peek.x,dy:-peek.y}], new Map(), new Set());
    assert.eq(objects.length, 2, 'only supports near the body survive the prefilter');
    const support = ObstacleStep.sample(x,y,objects,cellM);
    assert.eq(support.liftPx, 4, 'camera movement cannot drop the body off its rock');
    assert.eq(support.supports.length, 2, 'the bush underfoot remains a support too');
    assert.eq(ObstacleStep.speedMul(support),0.7,'the same balancing slowdown remains active');
  }
});

test('step support updates the ground shadow with the moving feet, never the raised body', () => {
  const method = name => {
    const start = SCENE_SRC.indexOf('\n  ' + name + '(');
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    return new Function('return ({' + SCENE_SRC.slice(start, end + 4) + '})[' + JSON.stringify(name) + ']')();
  };
  const sprite = () => ({
    x: -999, y: -999, visible: true,
    setPosition(x, y) { this.x = x; this.y = y; return this; },
    setRotation(rotation) { this.rotation = rotation; return this; },
  });
  const rock = { kind: 'mineralrock', x: 110, y: 220 };
  const scene = {
    save: { energy: 100 }, cellM: 10, startWorldM: { x: 100, y: 200 },
    playerM: { x: 10, y: 20 }, playerFeetNudgeY: -9,
    player: sprite(), playerShadow: sprite(), playerHalo: sprite(),
    _updatePlayerSubmersion() {},
    playerScreen() { return { x: 150 + this.playerM.x, y: 250 + this.playerM.y }; },
    playerBodyDy: method('playerBodyDy'), playerBodyRotation: method('playerBodyRotation'),
  };
  const update = method('_updateObstacleStep');
  for (const flying of [false, true]) {
    scene.save.flightPotionUntil = flying ? Date.now() + 60000 : 0;
    for (const dx of [-3, -2, 0, 0, 2, 3]) {
      scene.playerM.x = 10 + dx;
      update.call(scene, [rock]);
      const feet = scene.playerScreen();
      assert.eq(scene.playerShadow.x, feet.x, 'shadow follows the new feet in the same support update');
      assert.eq(scene.playerShadow.y, feet.y - 1, 'shadow stays on ground across entry, pause and exit');
      assert.eq(scene.player.y, feet.y + scene.playerBodyDy(), 'body retains its independent lift');
      assert.eq(scene.playerHalo.y, scene.player.y, 'body effects follow the raised body');
      if (dx === 0) assert.eq(scene._obstacleStep.liftPx, 4);
    }
  }
});

test('world layers: step-over category uses the same support profiles as walking', () => {
  for (const kind of ['_firepit','_fire','mineralrock','stronghold_wall']) {
    const o={kind,x:0,y:0};
    assert.eq(WorldLayers.forObject(o),WorldLayers.STEP_OVER_PROP);
    assert.gt(ObstacleStep.sample(0,0,[o],1).liftPx,0);
  }
  for (const o of [{kind:'tree',size:'small'},{kind:'_streetlamp'},{kind:'house'}]) {
    assert.eq(WorldLayers.forObject(o),WorldLayers.STANDING_PROP);
    assert.eq(ObstacleStep.sample(0,0,[{...o,x:0,y:0}],1).liftPx,0);
  }
});

test('furniture support: only mid pieces keep continuous support on pause and reversal', () => {
  for (const item of ITEMS.filter(item => item.kind === 'furniture')) {
    const object={kind:'furniture',itemId:item.id,x:0,y:0};
    const profile=ObstacleStep.profile(object);
    if (furnitureSpec(item.id).height !== 'mid') {
      assert.eq(profile,null);
      assert.eq(ObstacleStep.sample(0,0,[object],1).liftPx,0);
      continue;
    }
    assert.eq(profile,ObstacleStep.PROFILES.furniture);
    const at=x=>ObstacleStep.sample(x,0,[object],1).liftPx;
    assert.eq(at(0),profile.liftPx);
    const edge=(profile.top+profile.radius)/2;
    assert.gt(at(edge),0);
    assert.eq(at(edge),at(-edge));
    const pause=at(edge);
    at(0);
    assert.eq(at(edge),pause);
    assert.eq(at(profile.radius),0);
  }
});


test('foliage cover: grass fills its cell and clipped hedges never lift or slow walking', () => {
  const grass = {kind:'wildplant',crop:'longgrass',x:10,y:20};
  for (const [dx,dy] of [[0,0],[-.5,-.5],[.49,.49]]) {
    const sample = ObstacleStep.sample(10+dx*8,20+dy*8,[grass],8);
    assert.truthy(sample.covered); assert.eq(sample.liftPx,0); assert.eq(sample.supports.length,0);
    assert.eq(ObstacleStep.speedMul(sample),1);
  }
  for (const [dx,dy] of [[.5,0],[0,.5],[-.51,0]])
    assert.falsy(ObstacleStep.sample(10+dx*8,20+dy*8,[grass],8).covered);
  assert.falsy(ObstacleStep.sample(10,20,[],8).covered, 'harvested grass stops covering');
  assert.falsy(ObstacleStep.sample(10,20,[{...grass,_plantArt:'reeds'}],8).covered, 'wetland reeds retain their ordinary presentation');
  for (const art of ['zone_hedge','zone_hedge_single','clipped','trimmed']) {
    const hedge={...grass,crop:'shrub',_plantArt:art};
    const sample=ObstacleStep.sample(10,20,[hedge],8);
    assert.truthy(sample.covered); assert.eq(sample.liftPx,0); assert.eq(ObstacleStep.speedMul(sample),1);
  }
});
