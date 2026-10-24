(function () {
  async function fixture(run) {
    const W = WorldGen, originals = new Map(), veto = W.privateVetoAt, rng = W.makeRng;
    const entries = [];
    for (let tx = 0; tx < 2; tx++) {
      const key = W.tileKey(tx, 0); originals.set(key, W.tileCache.get(key));
      const entry = { cellsPerEdge: 8, grid: new Uint8Array(64).fill(W.T.CAVE_FLOOR), objects: [], creatures: [],
        _spawnOpts: { roadMask: new Uint8Array(64), spawnWhy: new Uint32Array(64), occupied: new Set() } };
      W.tileCache.set(key, entry); entries.push(entry);
    }
    W.privateVetoAt = () => false; W.makeRng = () => () => .99;
    const scene = { depth: 3, cellsPerTile: 8, cellM: 8, mPerPx: 64 / W.TILE_PX,
      originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 }, playerM: { x: 44, y: 44 }, gpsM: { x: 40, y: 44 },
      _manualOffsetM: { x: 4, y: 0 }, _targetM: { x: 44, y: 44 },
      save: { energy: 100 },
      cellAt(x, y) { const tx = Math.floor(x / 64), ty = Math.floor(y / 64);
        const ix = Math.floor(x / 8) - tx * 8, iy = Math.floor(y / 8) - ty * 8;
        const e = W.tileCache.get(W.tileKey(tx, ty));
        return { tx, ty, ix, iy, cellIX: tx * 8 + ix, cellIY: ty * 8 + iy,
          loaded: !!e, type: e?.grid[iy * 8 + ix] }; },
      _losePlayerEnergy(n) { this.save.energy -= n; return n; }, _popEnergy() {},
    };
    try { await run(scene, entries); } finally {
      for (const [key, before] of originals) { if (before) W.tileCache.set(key, before); else W.tileCache.delete(key); }
      W.privateVetoAt = veto; W.makeRng = rng;
    }
  }
  test('grove plates: visible, grounded one-shot ghost, saved depression survives recreation', () => fixture((s, entries) => {
    const original = globalThis.raiseGhostAt;
    let raised = 0;
    globalThis.raiseGhostAt = () => { raised++; return { kind: 'ghost' }; };
    try {
      s.depth = 0; s.playerM = { x: 28, y: 28 };
      entries[0].grid.fill(WorldGen.T.PARK);
      const plate = { id: 'grove_plate_3_3', kind: 'pressure_plate', effect: 'ghost', x: 28, y: 28, depth: 0 };
      entries[0].objects.push(plate);
      assert.eq(PressureTraps.lists(s).plates.length, 1);
      assert.eq(plate.frame, 2);
      const originalFlight = Conditions.flying;
      Conditions.flying = () => true;
      try { PressureTraps.tick(s, .1); } finally { Conditions.flying = originalFlight; }
      assert.eq(raised, 0); assert.falsy(plate.pressed);
      PressureTraps.tick(s, .1);
      assert.eq(raised, 1); assert.eq(plate.frame, 3);
      assert.truthy(s.save.pressedPlates[plate.id]);
      PressureTraps.tick(s, .1); assert.eq(raised, 1);
      entries[0].objects = [{ ...plate, pressed: false, frame: 2 }];
      s.save = JSON.parse(JSON.stringify(s.save));
      assert.eq(PressureTraps.lists(s).plates[0].frame, 3, 'saved state owns regenerated plate appearance');
      PressureTraps.tick(s, .1); assert.eq(raised, 1, 'reload never resummons');
      s.depth = 1; assert.eq(PressureTraps.lists(s).plates.length, 0);
    } finally { globalThis.raiseGhostAt = original; }
  }));
  test('grove plates: exclusions and full ghost budget do not spend a plate', () => fixture((s, entries) => {
    s.depth = 0; entries[0].grid.fill(WorldGen.T.PARK);
    const original = globalThis.raiseGhostAt;
    const plate = { id: 'blocked', effect: 'ghost', x: 28, y: 28 };
    let raised = 0;
    globalThis.raiseGhostAt = () => { raised++; return null; };
    try {
      assert.falsy(PressureTraps.pressGrove(s, plate));
      assert.eq(raised, 1); assert.falsy(s.save.pressedPlates);
      entries[0]._spawnOpts.spawnWhy.fill(WorldGen.SPAWN_WHY.RESTRICTED);
      assert.falsy(PressureTraps.pressGrove(s, plate));
      assert.eq(raised, 1, 'shared gate rejects before ghost spawn');
    } finally { globalThis.raiseGhostAt = original; }
  }));

  test('grove plates: membership preserves coarse chunks and live list/save changes', () => fixture((s, entries) => {
    s.depth = 0; s.cellM = 1; s.playerM = { x: 28, y: 28 };
    const plate = (id, x) => ({ id, kind: 'pressure_plate', effect: 'ghost', x, y: 28, depth: 0 });
    const a = plate('outside-radius-same-chunk', 79), b = plate('next-chunk', 80);
    let speciesReads = 0;
    entries[0].objects = Array.from({ length: 10000 }, (_, i) => ({ id: `grass_${i}`, x: 28, y: 28,
      get kind() { speciesReads++; return 'grass'; } }));
    entries[0].objects.push(a, b);
    assert.eq(PressureTraps.grovePlates(s).map(o => o.id).join(','), a.id,
      'preserve the original 80m chunk inclusion, not an exact-radius cull');
    const coldReads = speciesReads;
    PressureTraps.grovePlates(s);
    assert.eq(speciesReads, coldReads, 'warm queries do not inspect unrelated object kinds');
    s.save.pressedPlates = { [a.id]: true };
    assert.eq(PressureTraps.grovePlates(s)[0].frame, 3);
    const c = plate('new', 30);
    entries[0].objects.push(c);
    assert.eq(PressureTraps.grovePlates(s).length, 2);
    entries[0].objects = [c];
    assert.eq(PressureTraps.grovePlates(s)[0], c);
    c.depth = 1;
    assert.eq(PressureTraps.grovePlates(s).length, 0, 'depth remains a live filter');
    c.depth = 0;
    entries[0].objects.length = 0;
    assert.eq(PressureTraps.grovePlates(s).length, 0, 'empty sources cannot reuse an old derived stream');
  }));
  test('pressure traps: only L3 visits seed a gated plate and a launcher two to four cells away', () => fixture((s, entries) => {
    WorldGen.makeRng = () => () => 0;
    for (const depth of [0, 1, 2, 4]) { s.depth = depth; PressureTraps.observe(s); assert.eq(PressureTraps.lists(s).plates.length, 0); }
    s.depth = 3; PressureTraps.observe(s);
    const list = PressureTraps.lists(s);
    assert.eq(list.plates.length, 1); assert.eq(list.traps.length, 1);
    const distance = Math.hypot(list.plates[0].x-list.traps[0].x,list.plates[0].y-list.traps[0].y)/s.cellM;
    assert.inRange(distance, 2, 4); assert.eq(list.traps[0].state, 'parked');
    PressureTraps.observe(s); assert.eq(list.plates.length, 1, 'standing does not reroll');
    s._pressureTraps = null; entries[0]._spawnOpts.spawnWhy.fill(WorldGen.SPAWN_WHY.RESTRICTED);
    PressureTraps.observe(s); assert.eq(PressureTraps.lists(s).plates.length, 0, 'shared exclusion gate remains authoritative');
  }));
  test('pressure traps: relocating the profile moves observation, visibility and ticking', () => fixture(s => {
    const original = WorldGen.floorProfile;
    WorldGen.floorProfile = depth => ({ ...original(depth), pressureTraps: depth === 4 });
    WorldGen.makeRng = () => () => 0;
    try {
      PressureTraps.observe(s);
      assert.eq(PressureTraps.lists(s).plates.length, 0);
      s.depth = 4;
      PressureTraps.observe(s);
      const state = PressureTraps.lists(s);
      assert.eq(state.plates.length, 1, 'profile enables seeding and ground checks');
      s.playerM = { x: state.plates[0].x, y: state.plates[0].y };
      PressureTraps.tick(s, .1);
      assert.truthy(state.plates[0].pressed, 'profile enables ticking');
      s.depth = 1;
      assert.eq(PressureTraps.lists(s).plates.length, 0, 'old floor hides traps');
    } finally { WorldGen.floorProfile = original; }
  }));
  test('pressure traps: stepping onto a plate launches once toward the trigger position', () => fixture(s => {
    const pair = PressureTraps.create(s, {cellIX:3,cellIY:3}, {cellIX:1,cellIY:3}, 'wall', 'wall');
    PressureTraps.lists(s).plates.push(pair.plate); PressureTraps.lists(s).traps.push(pair.trap);
    PressureTraps.tick(s,.1); assert.eq(pair.trap.state,'parked');
    s.playerM={x:28,y:28}; PressureTraps.tick(s,.1);
    assert.eq(pair.plate.frame,3); assert.eq(pair.trap.direction,2); assert.eq(pair.trap.frame,1);
    assert.eq(pair.trap.vx,1); assert.eq(pair.trap.vy,0); assert.gt(pair.trap.x,12);
    s.playerM={x:28,y:44}; PressureTraps.tick(s,.1);
    assert.eq(pair.trap.vx,1); assert.eq(pair.trap.vy,0,'the launcher never homes after triggering');
    pair.trap.state='spent'; s.playerM={x:28,y:28}; PressureTraps.tick(s,.1);
    assert.eq(pair.trap.state,'spent','one activation per encounter');
  }));
  test('pressure traps: procedural spike walls activate and respect suppression', () => fixture((s, entries) => {
    WorldGen.makeRng = () => {
      let draw = 0;
      return () => draw++ === 1 ? .5 : 0;
    };
    PressureTraps.observe(s);
    const list = PressureTraps.lists(s), wall = list.traps[0], plate = list.plates[0];
    assert.eq(list.traps.length, 1);
    assert.eq(wall.kind, 'wall');
    assert.eq(wall.state, 'parked');
    s.playerM = { x: plate.x, y: plate.y };
    PressureTraps.tick(s, .1);
    assert.eq(wall.state, 'moving');
    assert.eq(wall.vx, 0); assert.eq(wall.vy, 1);
    s._pressureTraps = null;
    entries[0]._spawnOpts.spawnWhy.fill(WorldGen.SPAWN_WHY.JUNCTION_SOFT);
    PressureTraps.observe(s);
    assert.eq(PressureTraps.lists(s).traps.length, 0, 'small-road junction suppression reaches spike walls');
  }));
  test('pressure traps: moving spike walls hurt and push only within their lane', () => fixture(s => {
    const pair = PressureTraps.create(s, { cellIX: 5, cellIY: 3 }, { cellIX: 3, cellIY: 3 }, 'wall', 'spikes');
    PressureTraps.trigger(pair.trap, pair.plate);
    s.playerM = { x: 28, y: 28 }; s._targetM = { ...s.playerM };
    for (let i = 0; i < 10; i++) PressureTraps.contact(s, pair.trap, .1);
    assert.lt(s.save.energy, 100);
    assert.gt(s.playerM.x, 28);
    s.playerM = { x: 28, y: 36 };
    const energy = s.save.energy;
    PressureTraps.contact(s, pair.trap, 1);
    assert.eq(s.save.energy, energy, 'walking sideways clears the spikes');
    assert.eq(s.playerM.x, 28);
  }));
  test('pressure traps: cave plates are subtle and visible only within one cell of the player', () => fixture(s => {
    const plate = PressureTraps.create(s, { cellIX: 3, cellIY: 3 }, { cellIX: 1, cellIY: 3 }, 'wall', 'hidden').plate;
    assert.falsy(PressureTraps.plateVisible(s, plate));
    s.playerM = { x: 36, y: 36 };
    assert.truthy(PressureTraps.plateVisible(s, plate), 'diagonally adjacent cell reveals the plate');
    s.playerM = { x: 44, y: 36 };
    assert.falsy(PressureTraps.plateVisible(s, plate));
    plate.pressed = true;
    assert.falsy(PressureTraps.plateVisible(s, plate), 'pressed cave plates still obey discovery distance');
    plate.effect = 'ghost';
    assert.truthy(PressureTraps.plateVisible(s, plate), 'authored surface grove plates retain their visibility');
    assert.inRange(PressureTraps.CONFIG.plateAlpha, .1, .5);
  }));
  test('pressure traps: city passages ignore room reservation but keep objects, protected ground and safety', () => fixture((s, entries) => {
    const e = entries[0], index = 5 * 8 + 5;
    e._spawnOpts.occupied = new Set([index]);
    const area = { city: true, reserved: new Set([index]), passages: new Set([index]), protected: new Set() };
    e.caveAreas = { areas: [area] };
    assert.truthy(PressureTraps.ground(s, 44, 44));
    area.passages.clear(); assert.falsy(PressureTraps.ground(s, 44, 44)); area.passages.add(index);
    area.protected.add(index); assert.falsy(PressureTraps.ground(s, 44, 44)); area.protected.clear();
    e.objects.push({ x: 44, y: 44 }); assert.falsy(PressureTraps.ground(s, 44, 44)); e.objects.length = 0;
    e.wildplants = [{ x: 44, y: 44 }]; assert.falsy(PressureTraps.ground(s, 44, 44)); e.wildplants.length = 0;
    e._spawnOpts.spawnWhy[index] = WorldGen.SPAWN_WHY.KERB;
    assert.falsy(PressureTraps.ground(s, 44, 44));
  }));
  test('pressure traps: gas grate remains dormant until its plate triggers one existing gas burst', () => fixture(s => {
    const original = EnvironmentHazards.erupt, bursts = [];
    EnvironmentHazards.erupt = (scene, vent) => { bursts.push(vent); original(scene, vent); };
    try {
      const pair = PressureTraps.create(s, { cellIX: 3, cellIY: 3 }, { cellIX: 1, cellIY: 3 }, 'gas', 'gas');
      pair.trap.gasKind = 'paralysis';
      const state = PressureTraps.lists(s); state.plates.push(pair.plate); state.traps.push(pair.trap);
      for (let n = 0; n < 40; n++) PressureTraps.tick(s, .1);
      assert.eq(bursts.length, 0); assert.eq(pair.trap.state, 'parked');
      s.playerM = { x: pair.plate.x, y: pair.plate.y };
      PressureTraps.tick(s, .1);
      assert.eq(bursts.length, 1); assert.eq(bursts[0].kind, 'paralysis');
      assert.eq(bursts[0].cellIX, 1); assert.eq(bursts[0].cellIY, 3);
      assert.eq(pair.trap.state, 'active'); assert.eq(s.save.energy, 100, 'the gas owns effects; grate deals no direct hit');
      for (let n = 0; n < 40; n++) PressureTraps.tick(s, .1);
      assert.eq(pair.trap.state, 'spent'); assert.eq(bursts.length, 1, 'standing on plate cannot stack gas');
    } finally { EnvironmentHazards.erupt = original; }
  }));
  test('pressure traps: gas grates are selected procedurally and refuse newly suppressed outlets', () => fixture((s, entries) => {
    WorldGen.makeRng = () => { let draw = 0; return () => draw++ === 1 ? .9 : 0; };
    PressureTraps.observe(s);
    const state = PressureTraps.lists(s), grate = state.traps[0], plate = state.plates[0];
    assert.eq(grate.kind, 'gas'); assert.eq(grate.gasKind, 'poison');
    const at = s.cellAt(grate.x, grate.y);
    entries[0]._spawnOpts.spawnWhy[at.iy * 8 + at.ix] = WorldGen.SPAWN_WHY.JUNCTION_SOFT;
    s.playerM = { x: plate.x, y: plate.y };
    PressureTraps.tick(s, .1);
    assert.falsy(grate.emitted);
  }));
  test('pressure traps: contact is exactly five damage per second at common frame rates and preserves GPS', () => fixture(s => {
    for(const fps of [10,30,60]) {
      s.save.energy=100;s._pressureDamageFraction=0;s.playerM={x:28,y:28};s._targetM={x:28,y:28};s._manualOffsetM={x:0,y:0};
      const gps=JSON.stringify(s.gpsM),anchor=JSON.stringify(s.startWorldM);
      const h={kind:'ball',state:'moving',vx:1,vy:0,x:28,y:28};
      for(let n=0;n<fps;n++){h.x=PressureTraps.feet(s).x;PressureTraps.contact(s,h,1/fps);}
      assert.eq(s.save.energy,95,`five pips at ${fps}fps`);
      assert.truthy(Math.abs(s.playerM.x-31.2)<1e-8,'same push distance');
      assert.eq(JSON.stringify(s.gpsM),gps);assert.eq(JSON.stringify(s.startWorldM),anchor);
      assert.eq(s._targetM.x,s.playerM.x);assert.truthy(Math.abs(s._manualOffsetM.x-3.2)<1e-8);
    }
    s.save.immortalPotionUntil=Date.now()+10000;
    PressureTraps.contact(s,{kind:'ball',state:'moving',vx:1,vy:0,...PressureTraps.feet(s)},.1);
    assert.eq(s.save.energy,95,'immunity prevents direct damage');
  }));
  test('pressure traps: swept movement and pushes stop at walls and excluded cells', () => fixture((s,entries) => {
    entries[0].grid[3*8+4]=WorldGen.T.CAVE_WALL;
    s.playerM={x:31.9,y:28};s._targetM={...s.playerM};
    PressureTraps.contact(s,{kind:'ball',state:'moving',x:29,y:28,vx:1,vy:0},.1);
    assert.eq(s.playerM.x,31.9,'player is never shoved through a wall');
    const end=PressureTraps.clearSegment(s,{x:28,y:28},{x:44,y:28});
    assert.lt(end.x,32,'large displacement cannot tunnel');
    entries[0].grid[3*8+4]=WorldGen.T.CAVE_FLOOR;
    entries[0]._spawnOpts.spawnWhy[3*8+4]=WorldGen.SPAWN_WHY.FARM_INTERIOR;
    assert.lt(PressureTraps.clearSegment(s,{x:28,y:28},{x:44,y:28}).x,32);
  }));
  test('pressure traps: ball rolls by distance with reversed opposite frames; walls remain cardinal', () => fixture(s => {
    const ball={kind:'ball',state:'parked',x:0,y:0,travelled:0};PressureTraps.trigger(ball,{x:3,y:4});
    assert.truthy(Math.abs(ball.vx-.6)<1e-9);assert.truthy(Math.abs(ball.vy-.8)<1e-9);
    const circumference=2*Math.PI*PressureTraps.CONFIG.ballRadiusPixels/24*s.cellM;
    ball.travelled=circumference/8;ball.direction=2;assert.eq(PressureTraps.ballFrame(ball,s.cellM),17);
    ball.direction=6;assert.eq(PressureTraps.ballFrame(ball,s.cellM),23);
    const wall={kind:'wall',state:'parked',x:0,y:0};PressureTraps.trigger(wall,{x:3,y:4});
    assert.eq(wall.vx,0);assert.eq(wall.vy,1);assert.eq(wall.frame,2);
  }));
  test('pressure traps: spent traps retain contact damage without propulsion', () => fixture(s => {
    const before = { ...s.playerM }, h = { kind: 'ball', state: 'spent', ...PressureTraps.feet(s), vx: 1, vy: 0 };
    for (let i = 0; i < 10; i++) PressureTraps.contact(s, h, .1);
    assert.eq(s.save.energy, 95);
    assert.eq(s.playerM.x, before.x); assert.eq(s.playerM.y, before.y);
  }));
  test('pressure traps: environment and launcher placement reserve space against each other', () => fixture(s => {
    WorldGen.makeRng = () => () => 0;
    EnvironmentHazards.lists(s).vents.push(EnvironmentHazards.create(s, 'vent', { cellIX: 5, cellIY: 3 }, 'reserved'));
    PressureTraps.observe(s);
    assert.eq(PressureTraps.lists(s).traps.length, 0, 'launcher refuses the existing vent at its pressure plate');
    s._environmentHazards = new Map();
    PressureTraps.lists(s).plates.push({ x: 28, y: 28, cellIX: 3, cellIY: 3 });
    EnvironmentHazards.observe(s);
    assert.eq(EnvironmentHazards.lists(s).vents.length, 0, 'vent cannot appear underneath the plate');
    assert.eq(EnvironmentHazards.lists(s).sinkholes.length, 0, 'pit cannot remove the pressure plate');
  }));
  test('pressure traps: permanent cave-in seats reserve their ground', () => fixture(s => {
    WorldGen.makeRng = () => () => 0;
    EnvironmentHazards.lists(s).caveins.push(EnvironmentHazards.create(s, 'cavein', { cellIX: 5, cellIY: 3 }, 'permanent'));
    PressureTraps.observe(s);
    assert.eq(PressureTraps.lists(s).plates.length, 0);
  }));
  test('flight: pressure plates remain unpressed and moving traps cannot hurt or push', () => fixture(s => {
    s.save.flightPotionUntil = Date.now() + 60000;
    s.playerM = { x: 28, y: 28 };
    const pair = PressureTraps.create(s, { cellIX: 3, cellIY: 3 }, { cellIX: 1, cellIY: 3 }, 'ball', 'flight');
    const list = PressureTraps.lists(s); list.plates.push(pair.plate); list.traps.push(pair.trap);
    PressureTraps.tick(s, .1);
    assert.falsy(pair.plate.pressed); assert.eq(pair.trap.state, 'parked');
    PressureTraps.contact(s, { kind: 'ball', state: 'moving', x: 28, y: 28, vx: 1, vy: 0 }, 1);
    assert.eq(s.save.energy, 100); assert.eq(s.playerM.x, 28);
    s.save.flightPotionUntil = 0;
    PressureTraps.tick(s, .1);
    assert.truthy(pair.plate.pressed); assert.eq(pair.trap.state, 'moving');
  }));

})();
