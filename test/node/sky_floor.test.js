// The sky floor (WorldGen.SKY_DEPTH): its tiles copy a grove from the surface,
// and the hidden-way trial is walked there through the shipped SceneSky methods.
test('sky floor: tiles copy grove coverage as white floor over blocked air', async () => {
  const N = 6, x = 9301, y = 9302, key = WorldGen.tileKey(x, y);
  const grove = { kind: 'grove', key: 'g1' }, other = { kind: 'stones', key: 's1' };
  const coverage = new Uint16Array(N * N);
  coverage[7] = 1; coverage[8] = 1; coverage[20] = 2;
  const surface = WorldGen.tileCacheFor(0), sky = WorldGen.tileCacheFor(WorldGen.SKY_DEPTH);
  surface.set(key, { status: 'ready', cellsPerEdge: N, tileEdgeM: 60, grid: new Uint8Array(N * N).fill(WorldGen.T.PARK),
    zone: { anchors: [grove, other], coverage } });
  try {
    const e = await WorldGen.loadTile.atDepth(WorldGen.SKY_DEPTH, x, y, 49);
    assert.eq(e.undergroundBiome, 'sky'); assert.eq(e.depth, WorldGen.SKY_DEPTH); assert.truthy(e._spawned);
    assert.eq(e.creatures.length, 0); assert.eq(e.objects.length, 0);
    for (let i = 0; i < N * N; i++) {
      assert.eq(e.grid[i], i === 7 || i === 8 ? WorldGen.T.CAVE_FLOOR : WorldGen.T.CAVE_WALL, `cell ${i}`);
    }
    assert.falsy(WorldGen.isWalkable(e.grid[0]), 'open air blocks movement');
    assert.eq(Render.undergroundGroundColor(e, 1, 1, e.grid[7]), Render.UNDERGROUND_GROUND.sky_floor);
    assert.eq(Render.undergroundGroundColor(e, 0, 0, e.grid[0]), Render.UNDERGROUND_GROUND.sky_air);
  } finally { surface.delete(key); sky.delete(key); }
});

(function () {
  const source = SCENE_SRC.match(/class SceneSky \{[\s\S]*?\n\}/)[0];
  function fixture() {
    const writes = [], completed = [];
    const temples = { complete(_scene, o, condition) { completed.push({ o, condition }); return true; } };
    const Scene = new Function('WorldGen', 'persistSave', 'playerWorldM', 'sameAbsCell', 'document', 'Temples', 'TemplePuzzles', 'Combat',
      `return (${source});`)(WorldGen, save => writes.push(JSON.parse(JSON.stringify(save))),
      s => ({ x: s.startWorldM.x + s.playerM.x, y: s.startWorldM.y + s.playerM.y }),
      (_s, ax, ay, bx, by) => Math.floor(ax / 10) === Math.floor(bx / 10) && Math.floor(ay / 10) === Math.floor(by / 10),
      { hidden: false }, temples, TemplePuzzles, Combat);
    const scene = Object.assign(new Scene(), {
      depth: 0, save: { energy: 100 }, startWorldM: { x: 1000, y: 2000 }, playerM: { x: 3, y: 4 }, feetOffsetM: 0,
      flashes: [], flashAtPlayer(text) { this.flashes.push(text); }, syncMoveTarget() {}, _dialogOpen: () => false,
      isTooFast: () => false,
      _realmSwitchDepth(depth, p) {
        this.depth = this.save.depth = depth;
        this.playerM.x = p.x - this.startWorldM.x; this.playerM.y = p.y - this.startWorldM.y;
      },
      screenToWorldMeters: (sx, sy) => ({ x: sx, y: sy }),
    });
    const plan = { kind: 'path', size: 7, seed: 3, cellM: 10, x: 900, y: 1900, zoneKey: 'g1' };
    const temple = { id: 'temple', templeZone: 'g1' };
    const at = c => ({ x: plan.x + (c.x + .5) * plan.cellM, y: plan.y + (c.y + .5) * plan.cellM });
    const walk = c => { const p = at(c); scene.playerM.x = p.x - scene.startWorldM.x; scene.playerM.y = p.y - scene.startWorldM.y; scene._tickSky(.1); };
    const feet = () => ({ x: scene.startWorldM.x + scene.playerM.x, y: scene.startWorldM.y + scene.playerM.y });
    return { scene, plan, temple, at, walk, feet, writes, completed };
  }
  const reveal = s => { for (let i = 0; i < TemplePuzzles.PATH_REVEAL_SECONDS * 10 + 1; i++) s._tickSky(.1); };

  test('sky trial: the route shows for five seconds while the player waits on A, then walking it wins once', () => {
    const f = fixture(), s = f.scene;
    assert.eq(TemplePuzzles.PATH_REVEAL_SECONDS, 5);
    assert.eq(s.enterSkyTrial(f.temple, f.plan), true);
    assert.eq(s.depth, WorldGen.SKY_DEPTH);
    assert.eq(JSON.stringify(s.save.skyRun.return), JSON.stringify({ x: 1003, y: 2004 }), 'the temple door is the way back');
    const path = s._skyTrial.state.path;
    assert.eq(JSON.stringify(f.feet()), JSON.stringify(f.at(path[0])), 'arrives on A');
    s._tickSky(.1); f.walk(path[1]);
    assert.eq(JSON.stringify(f.feet()), JSON.stringify(f.at(path[0])), 'held on A while memorizing');
    for (let i = 0; i < 45; i++) s._tickSky(.1);
    assert.gt(s._skyTrial.state.revealRemaining, 0, 'still showing before five seconds');
    reveal(s);
    assert.eq(s._skyTrial.state.revealRemaining, 0);
    for (const c of path.slice(1)) f.walk(c);
    assert.eq(s._skyTrial.state.status, 'won');
    assert.eq(f.completed.length, 1);
    assert.eq(f.completed[0].condition, TemplePuzzles.WIN_CONDITIONS.path, 'the win names its condition');
    s._tickSky(.1);
    assert.eq(f.completed.length, 1, 'a finished trial does not pay again');
    assert.eq(s._tapSkyExit(f.at(path.at(-1)).x, f.at(path.at(-1)).y), true, 'B leads down once won');
    assert.eq(s.depth, 0); assert.falsy(s.save.skyRun); assert.falsy(s._skyTrial);
    assert.eq(JSON.stringify(f.feet()), JSON.stringify({ x: 1003, y: 2004 }));
  });
  test('sky trial: a wrong step or a step out of the square replays the route from A', () => {
    const f = fixture(), s = f.scene;
    s.enterSkyTrial(f.temple, f.plan); reveal(s);
    const path = s._skyTrial.state.path;
    f.walk(path[1]); f.walk(path[2]);
    assert.eq(s._skyTrial.state.pathIndex, 2);
    const off = [{ x: path[2].x + 1, y: path[2].y }, { x: path[2].x - 1, y: path[2].y }, { x: path[2].x, y: path[2].y + 1 }, { x: path[2].x, y: path[2].y - 1 }]
      .find(c => !path.some(p => p.x === c.x && p.y === c.y));
    f.walk(off);
    assert.eq(s._skyTrial.state.pathIndex, 0); assert.eq(s._skyTrial.state.phase, 'reveal');
    assert.eq(s._skyTrial.state.revealRemaining, TemplePuzzles.PATH_REVEAL_SECONDS);
    assert.eq(JSON.stringify(f.feet()), JSON.stringify(f.at(path[0])), 'back on A');
    reveal(s);
    f.walk({ x: -3, y: path[0].y });
    assert.eq(s._skyTrial.state.phase, 'reveal', 'leaving the square resets too');
    assert.eq(f.completed.length, 0); assert.eq(s.depth, WorldGen.SKY_DEPTH);
  });
  test('sky trial: only A leads down before the win, from near it; a reload returns to the door', () => {
    const f = fixture(), s = f.scene;
    s.enterSkyTrial(f.temple, f.plan); reveal(s);
    const path = s._skyTrial.state.path, b = f.at(path.at(-1)), a = f.at(path[0]);
    assert.eq(s._tapSkyExit(b.x, b.y), false, 'B is not an exit yet');
    for (const c of path.slice(1, 3)) f.walk(c);
    s._skyPlace({ x: a.x + 30, y: a.y });
    assert.eq(s._tapSkyExit(a.x, a.y), true); assert.eq(s.depth, WorldGen.SKY_DEPTH, 'too far to leave');
    s._skyPlace(a);
    s.save = JSON.parse(JSON.stringify(s.save));
    s.depth = 0; s.playerM = { x: 77, y: 88 };
    s._recoverSkyRun();
    assert.eq(s.save.depth, 0); assert.falsy(s.save.skyRun);
    assert.eq(JSON.stringify(f.feet()), JSON.stringify({ x: 1003, y: 2004 }));
    assert.eq(f.completed.length, 0);
    assert.eq(s.enterSkyTrial(f.temple, { ...f.plan, kind: 'duel' }), false, 'only the hidden way climbs to the sky');
  });
})();

test('sky trial: grove temples route only the hidden way to the sky floor', () => {
  const src = Temples.interact.toString();
  assert.truthy(/plan\.kind === 'path'\) scene\.enterSkyTrial\(o, plan\)/.test(src));
  assert.falsy(/path|pointA/.test(ALL_SRC['temple_scene.js']), 'the overlay scene no longer draws the hidden way');
});

test('temple conditions: every awakening and every trial win names the condition it met', () => {
  const oldGrant = grantTreasureRoll, cards = [];
  grantTreasureRoll = (...args) => { cards.push(args[6].ceremony); };
  try {
    const modals = [], scene = { save: {}, showMessageModal(m) { modals.push(m); }, playerScreen: () => ({ x: 0, y: 0 }) };
    const o = { templeZone: 'cond-park' };
    assert.eq(Temples.discoverSpirit(scene, o), true);
    assert.truthy(modals[0].body.includes(`Condition met: ${Temples.SPIRIT_CONDITION}`));
    assert.truthy(Temples.enemiesCondition(4).includes('All 4'));
    assert.truthy(Temples.enemiesCondition(1).includes('only enemy'));
    assert.truthy(/activate\(scene, o, false, enemiesCondition\(state\.authored\)\)/.test(TEMPLES_SRC), 'the enemy census names its count');
    const condition = TemplePuzzles.winCondition({ kind: 'duel', enemyKind: 'giant_reaper' });
    assert.eq(condition, TemplePuzzles.WIN_CONDITIONS.giant_reaper);
    for (const kind of TemplePuzzles.KINDS) assert.truthy(TemplePuzzles.WIN_CONDITIONS[kind], kind);
    assert.eq(Temples.complete(scene, o, condition), true);
    assert.eq(cards[0].sub, `Condition met: ${condition}`);
    assert.eq(Temples.complete(scene, o, condition), false);
    assert.eq(cards.length, 1, 'paid once');
    assert.truthy(modals.at(-1).body.includes(`Condition met: ${condition}`), 'a repeat win still names it');
  } finally { grantTreasureRoll = oldGrant; }
});
