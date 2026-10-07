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
    const scene = { depth: 1, cellsPerTile: 8, cellM: 8, mPerPx: 64 / W.TILE_PX,
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
  test('pressure traps: only L1 visits seed a gated plate and a launcher two to four cells away', () => fixture((s, entries) => {
    WorldGen.makeRng = () => () => 0;
    for (const depth of [0, 2, 3]) { s.depth = depth; PressureTraps.observe(s); assert.eq(PressureTraps.lists(s).plates.length, 0); }
    s.depth = 1; PressureTraps.observe(s);
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
