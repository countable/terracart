// Real multiplayer client with a fake relay; health uses the shipping damage
// math. Different origin coordinates and frame clocks exercise wire conversion.
(function () {
function withSync(fn, { id = 2, capable = true } = {}) {
  const oldDocument = globalThis.document, oldWebSocket = globalThis.WebSocket, oldNow = performance.now;
  const key = WorldGen.tileKey(100, 100), oldTile = WorldGen.tileCache.get(key);
  let clock = 100000;
  performance.now = () => clock;
  const sent = [], entry = { creatures: [], cellsPerEdge: 200, tileEdgeM: 1000 };
  WorldGen.tileCache.set(key, entry);
  function art() {
    const a = { anims: {}, width: 10, height: 10 };
    for (const k of ['setDepth', 'add', 'clear', 'fillStyle', 'fillCircle', 'setOrigin', 'setDisplaySize',
      'setAlpha', 'setScale', 'setTint', 'setVisible', 'destroy', 'fillRect', 'lineStyle', 'strokeCircle', 'setFlipX']) a[k] = () => a;
    a.setPosition = (x, y) => { a.x = x; a.y = y; return a; };
    a.play = key => { a.anims.currentAnim = { key }; return a; };
    return a;
  }
  class Socket {
    constructor() { this.readyState = 1; Socket.last = this; }
    send(s) { sent.push(JSON.parse(s)); }
    close() {}
  }
  globalThis.WebSocket = Socket;
  globalThis.document = { visibilityState: 'visible', addEventListener() {},
    createElement: () => ({ style: {}, addEventListener() {} }), body: { appendChild() {} } };
  const sc = {
    save: { multiplayer: true, playerName: 'Ada', playerColor: 0x9fd8ff, caught: [], energy: 100 },
    depth: 0, cellM: 5, tileEdgeM: 1000, cellsPerTile: 200, mPerPx: 2,
    originPx: { x: 50000, y: 50000 }, startWorldM: { x: 100000, y: 100000 }, playerM: { x: 1, y: 1 },
    viewSize: 352, viewCenterX: 176, viewCenterY: 176,
    add: { container: art, graphics: art, image: art, sprite: art, text: art },
    worldContainer: art(), shadowContainer: art(),
    cellAt: () => ({ loaded: true, type: WorldGen.T.GRASS }), _cellBlocked: () => false,
    resolveDefeat(c) { if (!this.save.caught.includes(c.id)) this.save.caught.push(c.id); },
    _damageEnemy(c, amount, source, options) {
      if (!Multiplayer.shouldApplyDamage(this, c, source)) return false;
      const dealt = Combat.damageDealt(c, amount, options);
      Multiplayer.reportHit(this, c, dealt, source);
      if (Combat.hp(c) <= 0) { Multiplayer.reportKill(this, c, source); this.resolveDefeat(c); return true; }
      return false;
    },
  };
  const recv = msg => Socket.last.onmessage({ data: JSON.stringify(msg) });
  const peer = { id: id === 2 ? 1 : 2, enemySync: 1, x: 50001, y: 50001, d: 0, name: 'Bob', color: 0xffffff, fx: 0, fy: 1, m: 0 };
  const welcome = () => recv({ t: 'welcome', id, enemySync: capable ? 1 : undefined, peers: [peer] });
  const foe = over => {
    const c = EnemySpawns.markShared({ id: `enemy_state_${entry.creatures.length}`, kind: 'goblin', x: 100005, y: 100005, ...over });
    entry.creatures.push(c); return c;
  };
  const state = (c, over = {}, outer = {}) => ({ t: 'state', id: 1, eid: c.id, d: 0, gen: 0,
    s: { q: 1, h: 1, x: c.x / sc.mPerPx, y: c.y / sc.mPerPx, v: [], m: {}, ...over }, ...outer });
  const hit = (c, u, over = {}) => ({ t: 'hit', id: 1, eid: c.id, d: 0, f: u, left: 1 - u, o: 'remote', u, gen: 0, ...over });
  const tick = (ms = 200) => { clock += ms; Multiplayer.tick(sc); };
  try {
    Multiplayer.start(sc); welcome();
    fn({ sc, sent, recv, foe, state, hit, tick, welcome, entry, disconnect() {
      document.visibilityState = 'hidden'; Socket.last.onclose(); document.visibilityState = 'visible';
    }, reconnect() { Multiplayer.stop(sc); Multiplayer.start(sc); welcome(); } });
  } finally {
    Multiplayer.stop(sc); performance.now = oldNow;
    globalThis.document = oldDocument; globalThis.WebSocket = oldWebSocket;
    if (oldTile) WorldGen.tileCache.set(key, oldTile); else WorldGen.tileCache.delete(key);
  }
}
const near = (actual, expected) => assert.inRange(actual - expected, -1e-8, 1e-8);

test('enemy sync: cumulative hits replay and reorder safely, and distinct senders stack', () => withSync(({ sc, foe, hit, recv }) => {
  const c = foe();
  recv(hit(c, 0.2)); recv(hit(c, 0.2)); recv(hit(c, 0.1));
  near(Combat.hpFraction(c), 0.8);
  recv(hit(c, 0.1, { o: 'second', id: 3 }));
  near(Combat.hpFraction(c), 0.7);
  recv(hit(c, 0.3)); near(Combat.hpFraction(c), 0.6);
}));

test('enemy sync: publisher snapshot repairs missed hits while preserving concurrent local damage', () => withSync(({ sc, foe, state }) => {
  const c = foe();
  sc._damageEnemy(c, Combat.maxHp(c) * 0.2, 'player', { exact: true });
  assert.truthy(Multiplayer.applyState(sc, state(c, { h: 0.7, v: [['remote', 0.3]] })));
  near(Combat.hpFraction(c), 0.5);
  assert.falsy(Multiplayer.applyState(sc, state(c, { h: 0.7, v: [['remote', 0.3]] })));
  near(Combat.hpFraction(c), 0.5);
}));

test('enemy sync: reconnect preserves cumulative evidence and duplicate suppression', () => withSync(({ sc, foe, hit, recv, reconnect, state }) => {
  const c = foe(); recv(hit(c, 0.2));
  sc._damageEnemy(c, Combat.maxHp(c) * 0.1, 'player', { exact: true });
  reconnect(); recv(hit(c, 0.2, { id: 9 }));
  near(Combat.hpFraction(c), 0.7);
  Multiplayer.applyState(sc, state(c, { h: 0.8, v: [['remote', 0.2]] }));
  near(Combat.hpFraction(c), 0.7);
}));

test('enemy sync: gentle correction preserves local movement and translated hop endpoints', () => withSync(({ sc, foe, state }) => {
  const c = foe(), x = c.x;
  Multiplayer.applyState(sc, state(c, { x: (x + 5) / sc.mPerPx,
    m: { _startX: (x + 5) / sc.mPerPx, _startY: c.y / sc.mPerPx,
      _targetX: (x + 10) / sc.mPerPx, _targetY: c.y / sc.mPerPx, _idleTurnT: 700 } }));
  near(c.x, x); near(c._startX, x); near(c._targetX, x + 5);
  c.x += 1; // normal AI continues to move during reconciliation
  Multiplayer.correctEnemies(sc, 0.2); near(c.x, x + 3.5);
  Multiplayer.correctEnemies(sc, 0.2); near(c.x, x + 6);
  near(c._startX, x + 5); near(c._targetX, x + 10);
  near(c._idleTurnT - performance.now(), 700);
}));

test('enemy sync: deadband, large correction and collision/unloaded refusals', () => withSync(({ sc, foe, state }) => {
  const c = foe(), x = c.x;
  Multiplayer.applyState(sc, state(c, { x: (x + 0.2) / 2 }));
  Multiplayer.correctEnemies(sc, 1); near(c.x, x);
  Multiplayer.applyState(sc, state(c, { q: 2, x: (x + 30) / 2 })); near(c.x, x + 30);
  sc.cellAt = () => ({ loaded: false });
  Multiplayer.applyState(sc, state(c, { q: 3, x: (x + 60) / 2 })); near(c.x, x + 30);
  sc.cellAt = () => ({ loaded: true, type: WorldGen.T.GRASS }); sc._cellBlocked = () => true;
  Multiplayer.applyState(sc, state(c, { q: 4, x: (x + 60) / 2 })); near(c.x, x + 30);
}));

test('enemy sync: authority, depth, invalid payload and dead enemies cannot change state', () => withSync(({ sc, foe, state, hit, recv }) => {
  const c = foe();
  for (const msg of [state(c, { h: 0.2 }, { id: 3 }), state(c, { h: 0.2 }, { d: 1 }),
    state(c, { h: 0.2, v: [['a', 0.2], ['a', 0.2]] }), state(c, { h: 0.2, m: { _hp: 0 } }),
    state(c, { h: 0.2 }, { gen: 12 })]) assert.falsy(Multiplayer.applyState(sc, msg));
  near(Combat.hpFraction(c), 1);
  recv(hit(c, 1, { k: 1 }));
  assert.falsy(Multiplayer.applyState(sc, state(c, { q: 2, h: 1 })));
  near(Combat.hpFraction(c), 0);
}));

test('enemy sync: world hits have one publisher; own hits, private foes and legacy server retain behavior', () => {
  withSync(({ sc, foe }) => {
    const c = foe();
    assert.falsy(Multiplayer.shouldApplyDamage(sc, c, 'lava'));
    assert.falsy(Multiplayer.shouldApplyDamage(sc, c, 'enemy'));
    for (const s of ['player', 'pet', 'ally', 'turret', 'peer']) assert.truthy(Multiplayer.shouldApplyDamage(sc, c, s));
    assert.truthy(Multiplayer.shouldApplyDamage(sc, { id: 'private', kind: 'goblin' }, 'lava'));
  });
  withSync(({ sc, foe }) => assert.truthy(Multiplayer.shouldApplyDamage(sc, foe(), 'lava')), { capable: false });
  withSync(({ sc, foe, sent, tick }) => {
    sc._damageEnemy(foe(), 1, 'lava', { exact: true }); tick();
    assert.eq(sent.filter(m => m.t === 'damage').length, 1);
  }, { id: 1 });
});

test('enemy sync: missed nonpublisher hit retries cumulative evidence until publisher acknowledges it', () => withSync(({ sc, foe, tick, sent, state }) => {
  const c = foe(); sc._damageEnemy(c, Combat.maxHp(c) * 0.2, 'player', { exact: true }); tick();
  const h = sent.find(m => m.t === 'hit'); assert.truthy(h?.o); near(h.u, 0.2);
  tick(3100);
  const retries = sent.filter(m => m.t === 'damage'); assert.gt(retries.length, 0); near(retries[0].u, 0.2);
  Multiplayer.applyState(sc, state(c, { h: 0.8, v: [[h.o, h.u]] }));
  const before = sent.filter(m => m.t === 'damage').length;
  tick(3100); assert.eq(sent.filter(m => m.t === 'damage').length, before);
}));

test('enemy sync: seen and received hits trigger publisher snapshots, quiet ticks do not', () => withSync(({ sc, foe, recv, hit, sent, tick }) => {
  const c = foe();
  recv({ t: 'seen', id: 2, ids: [c.id], d: 0 }); tick();
  assert.eq(sent.filter(m => m.t === 'state').length, 1);
  tick(1000); assert.eq(sent.filter(m => m.t === 'state').length, 1);
  recv(hit(c, 0.2, { id: 2 })); tick();
  assert.eq(sent.filter(m => m.t === 'state').length, 2);
  near(sent.filter(m => m.t === 'state')[1].s.h, 0.8);
}, { id: 1 }));
test('enemy sync: tile replacement restores health before its first local hit and binds pending repairs to it', () => withSync(({ sc, foe, entry, hit, recv, tick, sent }) => {
  const old = foe(); recv(hit(old, 0.5));
  sc._damageEnemy(old, Combat.maxHp(old) * 0.1, 'player', { exact: true });
  entry.creatures.length = 0;
  const next = foe({ id: old.id });
  sc._damageEnemy(next, Combat.maxHp(next) * 0.1, 'player', { exact: true });
  near(Combat.hpFraction(next), 0.3);
  tick(3200);
  near(sent.find(m => m.t === 'hit').u, 0.2);
  near(Combat.hpFraction(next), 0.3);
}));

test('enemy sync: authority is within enemy simulation range, not merely nearby the player', () => withSync(({ sc, foe, recv }) => {
  const c = foe();
  recv({ t: 'p', id: 1, x: (c.x + 150) / sc.mPerPx, y: c.y / sc.mPerPx, fx: 0, fy: 1, m: 0, d: 0 });
  assert.truthy(Multiplayer.shouldApplyDamage(sc, c, 'lava'));
  recv({ t: 'p', id: 1, x: c.x / sc.mPerPx, y: c.y / sc.mPerPx, fx: 0, fy: 1, m: 0, d: 1 });
  assert.truthy(Multiplayer.shouldApplyDamage(sc, c, 'lava'));
}));

test('enemy sync: authoritative live healing repairs HP but never revives a dead life', () => withSync(({ sc, foe, hit, recv, state }) => {
  const c = foe(); recv(hit(c, 0.6));
  Multiplayer.applyState(sc, state(c, { h: 1, v: [['remote', 0.6]] }));
  near(Combat.hpFraction(c), 1);
  recv(hit(c, 1, { k: 1 }));
  assert.falsy(Multiplayer.applyState(sc, state(c, { q: 2, h: 1, v: [['remote', 1]] })));
  near(Combat.hpFraction(c), 0);
}));

test('enemy sync: bat path and phase move with a correction, then clear on an idle snapshot', () => withSync(({ sc, foe, state }) => {
  const c = foe({ kind: 'bat' }), x = c.x, y = c.y, now = performance.now();
  c._batFlight = { x: x - 100, y, tx: x + 100, ty: y, start: now - 500, duration: 1000 };
  const m = { _batFlight: { x: (x + 5) / 2, y: y / 2, tx: (x + 10) / 2, ty: y / 2,
    start: -100, duration: 1000 }, _batLeg: 4, _batSwooping: true, _batHit: false };
  assert.truthy(Multiplayer.applyState(sc, state(c, { x: (x + 5) / 2, m })));
  near(c._batFlight.x, x); near(c._batFlight.tx, x + 5);
  Multiplayer.correctEnemies(sc, 0.4);
  near(c.x, x + 5); near(c._batFlight.x, x + 5); near(c._batFlight.tx, x + 10);
  near(c._batFlight.start, now - 100); assert.eq(c._batSwooping, true);
  Multiplayer.applyState(sc, state(c, { q: 2, m: { _batFlight: null } }));
  assert.eq(c._batFlight, null); assert.eq(c._batSwooping, false);
}));

test('enemy sync: queued hits never cross depths and replay sequence restarts after welcome', () => withSync(({ sc, foe, tick, sent, state, welcome }) => {
  const c = foe();
  Multiplayer.applyState(sc, state(c, { q: 50 }));
  assert.falsy(Multiplayer.applyState(sc, state(c, { q: 1 })));
  welcome(); assert.truthy(Multiplayer.applyState(sc, state(c, { q: 1 })));
  sc._damageEnemy(c, Combat.maxHp(c) * 0.1, 'player', { exact: true });
  sc.depth = 1; tick(); assert.eq(sent.filter(m => m.t === 'hit').length, 0);
}));

test('enemy sync: castle snapshots and delayed hits belong to one battle generation', () => withSync(({ sc, foe, recv, hit, state, tick, sent }) => {
  let key;
  for (let i = 0; i < 1000 && !key; i++) if (Houses.isCitadelKey(`b_1_${i}`)) key = `b_1_${i}`;
  assert.truthy(key);
  const start = Date.now() - 1000;
  sc.save.citadelBattles = { [key]: { startedAt: start, guardIds: [] } };
  const c = foe({ castle: key }); sc.save.citadelBattles[key].guardIds.push(c.id);
  recv({ t: 'battle', id: 1, key, d: 0, startedAt: start });
  recv(hit(c, 0.2, { gen: start })); near(Combat.hpFraction(c), 0.8);
  sc._damageEnemy(c, Combat.maxHp(c) * 0.1, 'player', { exact: true });
  sc.save.citadelBattles[key].startedAt = start + 500;
  recv({ t: 'battle', id: 1, key, d: 0, startedAt: start + 500 });
  assert.falsy(Multiplayer.applyHit(sc, hit(c, 0.3, { gen: start })));
  assert.falsy(Multiplayer.applyState(sc, state(c, { h: 0.1 }, { gen: start })));
  tick(); assert.eq(sent.filter(m => m.t === 'hit').length, 0);
}));
test('enemy sync: own hits during a dropped connection survive the resume snapshot and retry', () => withSync(({ sc, foe, sent, disconnect, reconnect, state, tick }) => {
  const c = foe();
  disconnect();
  const before = sent.length;
  const dealt = Combat.damageDealt(c, Combat.maxHp(c) * 0.2, { exact: true });
  assert.falsy(Multiplayer.reportHit(sc, c, dealt, 'player'), 'retained evidence is not a send');
  sc._damageEnemy(c, Combat.maxHp(c) * 0.1, 'lava', { exact: true });
  near(Combat.hpFraction(c), 0.7);
  assert.eq(sent.length, before);
  reconnect();
  assert.truthy(Multiplayer.applyState(sc, state(c)), 'resume reconciles against the publisher');
  near(Combat.hpFraction(c), 0.8); // own .2 retained; disconnected world simulation discarded
  tick(3100);
  const retry = sent.find(m => m.t === 'damage');
  assert.truthy(retry); near(retry.u, 0.2);
}));
})();
