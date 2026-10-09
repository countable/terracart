// multiplayer_shared.test.js — shared castle battles, shared enemy targeting
// and published player health (src/multiplayer.js).
//
// What this suite is defending:
//  BATTLES
//  1. A peer's battle is adopted with the SAME start (one deadline for
//     everyone, so every save expires — and undoes its guards' deaths — at
//     the same instant); two starts merge to the earlier; the key must be a
//     real citadel's (Houses.isCitadelKey), the castle unclaimed here.
//  2. A citadel guard is shared only while this save's battle is live, and a
//     hit, kill or "dead" answer about one moves only between players whose
//     battle frames name the same start.
//  3. Each participant claims the castle in its own save when every guard
//     is down — a peer's kill counts toward clearing, never toward a ledger.
//  TARGETING
//  4. The pick is the nearest eligible player, a tie band broken by lowest
//     relay id — the same on every device whatever order it meets them in —
//     sticky under small jitter.
//  5. An `aggro` frame is adopted; a conflict inside AGGRO_TIE_MS goes to
//     the lower pid, a later one to the newer.
//  6. A foe whose target is a peer does nothing to this player (peerFeint).
//  7. Offline, or with nobody near, the rule is silent (today's behaviour).
//  HEALTH
//  8. Presence frames carry e (energy fraction), g (TARGET_FLAGS), v; a hurt
//     peer gets the enemy health bar over their head.

(function () {
const lift = (sig) => {
  const start = SCENE_SRC.indexOf('\n  ' + sig);
  const end = start < 0 ? -1 : SCENE_SRC.indexOf('\n  }\n', start);
  if (start < 0 || end < 0) throw new Error(`could not lift ${sig}`);
  return SCENE_SRC.slice(start + 1, end + 4);
};
const KILL = SCENE_SRC.match(/\nconst KILL_LEDGERS = \[[\s\S]*?\n\];/)[0];
const makeMethods = new Function('grantTreasureRoll', 'Quests', 'persistSave',
  'slimeCharging', 'ENEMY_HEALTH_RING_MS', 'DMG_POPUP_BEAT_MS', 'enemySplit',
  KILL + `\nreturn {\n${[
    "_damageEnemy(c, amount, source = 'player', options = {}) {",
    "resolveDefeat(victim, source = 'player') {",
    '_dropBountyCoin(victim, amount) {',
    '_checkCitadelClaims() {',
    '_claimCitadel(key) {',
    '_expireCitadelBattles(now = Date.now()) {',
  ].map(lift).join(',\n')}\n};`);

const EDGE = 1000, N = 200, CELL = EDGE / N;
const TX = 7313, TY = 4121;   // a key no other suite uses
// A real-shaped castle key (worldgen.js ownerKeys `b_<x>_<y>`) whose style
// holds a garrison, and one whose style does not.
const keyOf = (guards) => {
  for (let i = 1; i < 500; i++) {
    const key = `b_${1462600 + i}_823800`;
    if (CastleStyles.get(key).guards === guards) return key;
  }
  throw new Error('no castle key');
};
const KEY = keyOf(true), QUEST_KEY = keyOf(false);

function harness() {
  const paid = { rolls: 0, quests: 0, discoveries: 0, inv: 0, shiny: 0, pops: [], splits: 0, toasts: [], flashes: [] };
  const methods = makeMethods(
    () => { paid.rolls++; },
    { onKill: () => { paid.quests++; return false; } },
    () => {},
    () => false, 1000, 100,
    () => { paid.splits++; return null; },
  );
  const scene = Object.assign(Object.create(methods), {
    save: { money: 0, caught: [], boonUntil: {}, energy: 100 },
    depth: 0, tileEdgeM: EDGE, cellsPerTile: N, cellM: CELL,
    viewCenterX: 176, viewCenterY: 176, viewSize: 352, playerFeetNudgeY: 0,
    playerM: { x: 0, y: 0 },
    addToInv: () => { paid.inv++; },
    flash() {}, flashAtWorld() {}, flashLoot() {}, flashShiny: () => { paid.shiny++; },
    flashAtPlayer: (m) => { paid.flashes.push(m); },
    awardShinyBonus: () => { paid.shiny++; },
    _bankDiscovery: () => { paid.discoveries++; return true; },
    _popDamageNumber: (c, n) => { paid.pops.push(n); },
    _toast: (m) => { paid.toasts.push(m); },
    playerToWorldCell: () => ({ tx: TX, ty: TY }),
  });
  return { scene, paid };
}

// Any Phaser object: every method chains, so the drawing code runs headless.
function phaserStub() {
  const p = new Proxy(function () {}, {
    get(_, prop) {
      if (prop === 'anims') return { currentAnim: null };
      if (prop === 'width' || prop === 'height') return 10;
      return () => p;
    },
  });
  return p;
}

// Ahead of any clock an earlier suite left in the client's timers (lastSend, the windows —
// module state that lives on between suites; one runs on wall-clock ms).
let clock = 1e13;
// A relay that records what the client sends, welcomed as `myId` with `peers`.
function withRelay(scene, fn, { myId = 1, peers = [] } = {}) {
  const oldDocument = globalThis.document, oldWebSocket = globalThis.WebSocket;
  const sent = [];
  class FakeWebSocket {
    constructor() { this.readyState = 1; FakeWebSocket.last = this; }
    send(s) { sent.push(JSON.parse(s)); }
    close() {}
  }
  globalThis.WebSocket = FakeWebSocket;
  globalThis.document = {
    visibilityState: 'visible', addEventListener() {},
    createElement() { return { style: {}, addEventListener() {} }; },
    body: { appendChild() {} },
  };
  Object.assign(scene.save, { multiplayer: true, playerName: 'Ada', playerColor: 0x9fd8ff });
  const bars = [];
  scene.add = {
    container() { return { setDepth() { return this; }, add() {}, setMask() { return this; } }; },
    graphics() { return { clear() {} }; },
    image: phaserStub, sprite: phaserStub, text: phaserStub,
  };
  scene.shadowContainer = { add() {} }; scene.worldContainer = { add() {} };
  scene._drawEnemyHealthBar = (g, cx, top, frac, alpha) => bars.push({ cx, top, frac, alpha });
  const realNow = performance.now;
  performance.now = () => clock;
  try {
    Multiplayer.start(scene);
    FakeWebSocket.last.onopen();   // the hello
    FakeWebSocket.last.onmessage({ data: JSON.stringify({ t: 'welcome', id: myId, peers }) });
    const recv = (msg) => FakeWebSocket.last.onmessage({ data: JSON.stringify(msg) });
    const of = (t) => sent.filter((m) => m.t === t);
    return fn({ sent, recv, of, bars });
  } finally {
    Multiplayer.stop(scene);
    performance.now = realNow;
    globalThis.document = oldDocument;
    globalThis.WebSocket = oldWebSocket;
  }
}
// Advance the test clock past every client timer and run one frame.
const flush = (scene, ms = 2500) => {
  clock += ms;
  scene._peerUprightPieces = [];
  Multiplayer.tick(scene);
};
const online = (scene, at = { x: 0, y: 0 }) => {
  Object.assign(scene, { mPerPx: 1, originPx: { x: 0, y: 0 }, startWorldM: { x: at.x, y: at.y } });
};
function withTile(fn) {
  const key = WorldGen.tileKey(TX, TY);
  const had = WorldGen.tileCache.get(key);
  const entry = { cellsPerEdge: N, tileEdgeM: EDGE, creatures: [] };
  WorldGen.tileCache.set(key, entry);
  try { return fn(entry); } finally {
    if (had) WorldGen.tileCache.set(key, had); else WorldGen.tileCache.delete(key);
  }
}
const SPOT = { x: TX * EDGE + 500, y: TY * EDGE + 500 };
const foe = (entry, over) => {
  const c = EnemySpawns.markShared(Object.assign({ kind: 'goblin', id: 'enemy_mps_1', x: SPOT.x, y: SPOT.y }, over));
  entry.creatures.push(c);
  return c;
};
// A citadel garrison of `n`, as lairs.js seats one (castle key, lair, the
// generation manifest the claim reads).
const garrison = (entry, n = 2) => {
  const ids = [];
  for (let i = 0; i < n; i++) {
    ids.push(foe(entry, { id: `lair_${TX}_${TY}_40_40_${i}`, castle: KEY, lair: `${TX}_${TY}_40_40`,
      x: SPOT.x + i * CELL, y: SPOT.y }).id);
  }
  entry._citadelGuards = new Map([[KEY, ids]]);
  return entry.creatures.filter((c) => c.castle === KEY);
};
const peer = (id, x, y, over = {}) => ({ id, name: `P${id}`, color: 0xffd28a, x, y, fx: 0, fy: 1, m: 0, d: 0, e: 1, g: 0, v: 0, ...over });

// ── battles ────────────────────────────────────────────────────────────────
test('shared battles: castle keys — only a real citadel footprint key is a battle on the wire', () => {
  assert.truthy(Houses.isCitadelKey(KEY));
  assert.falsy(Houses.isCitadelKey(QUEST_KEY), 'a quest castle holds no garrison');
  assert.falsy(Houses.isCitadelKey('citadel'), 'a variant id is not a footprint key');
  assert.falsy(Houses.isCitadelKey('b_1_2_3'));
  assert.falsy(Houses.isCitadelKey(42));
  // The relay's regexes are the client's.
  assert.truthy(RELAY_SRC.includes(`const CASTLE_KEY_RE = /${Houses.CASTLE_KEY_RE.source}/;`), 'server/index.js CASTLE_KEY_RE mirrors Houses');
  assert.truthy(RELAY_SRC.includes(`const ENEMY_ID_RE = /${EnemySpawns.SHARED_ID_RE.source}/;`), 'and ENEMY_ID_RE mirrors SHARED_ID_RE');
});

test('shared battles: adopt with the same start, merge to the earlier, expire together', () => {
  const T = Date.now() - 60000;
  const a = {}, b = {}, c = {};
  assert.truthy(Houses.startCitadelBattle(a, KEY, T));
  assert.eq(Houses.adoptCitadelBattle(b, KEY, T), 'adopted');
  assert.eq(b.citadelBattles[KEY].startedAt, T, 'the same start, never a fresh one');
  assert.eq(Houses.adoptCitadelBattle(b, KEY, T), false, 'the same start again changes nothing');
  // A later start is kept out; an earlier one wins.
  assert.eq(Houses.adoptCitadelBattle(c, KEY, T + 30000), 'adopted');
  assert.eq(Houses.adoptCitadelBattle(c, KEY, T + 40000), false);
  assert.eq(c.citadelBattles[KEY].startedAt, T + 30000);
  assert.eq(Houses.adoptCitadelBattle(c, KEY, T), 'earlier');
  assert.eq(c.citadelBattles[KEY].startedAt, T, 'merged to the earlier — whichever arrived first');
  // One deadline: all three are live a millisecond before it and over at it.
  const end = T + Houses.CITADEL_BATTLE_MS;
  for (const s of [a, b, c]) {
    s.citadelBattles[KEY].guardIds = ['g'];
    assert.truthy(Houses.citadelBattleActive(s, KEY, end - 1));
    assert.falsy(Houses.citadelBattleActive(s, KEY, end));
  }
  for (const s of [a, b, c]) {
    assert.eq(Houses.expireCitadelBattles(s, end - 1).length, 0);
    assert.eq(Houses.expireCitadelBattles(s, end).map((x) => x.key).join(), KEY, 'every save undoes it at the same instant');
  }
});

test('shared battles: refused — a claimed castle, a quest castle, a spent battle, a start from the future', () => {
  const now = Date.now();
  const claimed = { claimedCastles: { [KEY]: 0 } };
  assert.eq(Houses.adoptCitadelBattle(claimed, KEY, now - 1000, now), false, 'claimed here: no battle');
  assert.eq(Houses.adoptCitadelBattle({}, QUEST_KEY, now - 1000, now), false);
  assert.eq(Houses.adoptCitadelBattle({}, 'citadel', now - 1000, now), false);
  assert.eq(Houses.adoptCitadelBattle({}, KEY, now - Houses.CITADEL_BATTLE_MS, now), false, 'already over');
  assert.eq(Houses.adoptCitadelBattle({}, KEY, now + Houses.CITADEL_BATTLE_SKEW_MS + 1, now), false, 'past any clock drift');
  assert.eq(Houses.adoptCitadelBattle({}, KEY, now + 1000, now), 'adopted', 'a little drift is fine');
  assert.eq(Houses.adoptCitadelBattle({}, KEY, 1.5, now), false);
});

test('shared battles: a received battle is adopted, re-announced with the same start, and toasted', () => {
  withTile(() => {
    const { scene, paid } = harness();
    online(scene);
    withRelay(scene, ({ recv, of }) => {
      const T = Date.now() - 5000;
      recv({ t: 'battle', id: 2, key: KEY, startedAt: T, d: 0 });
      assert.eq(scene.save.citadelBattles[KEY].startedAt, T);
      assert.eq(scene._lastLairT, -Infinity, 'the garrison wakes on the next pass');
      assert.eq(paid.toasts.length, 1);
      assert.includes(paid.toasts[0], 'P2');
      assert.includes(paid.toasts[0], CastleStyles.get(KEY).name);
      flush(scene);
      assert.eq(of('battle').length, 1, 'joining says which start this save holds');
      assert.eq(of('battle')[0].startedAt, T); assert.eq(of('battle')[0].key, KEY); assert.eq(of('battle')[0].d, 0);
      flush(scene, 1000);
      assert.eq(of('battle').length, 1, 'quiet between beats');
      flush(scene, Multiplayer.BATTLE_MS);
      assert.eq(of('battle').length, 2, 'every BATTLE_MS while it runs, so a late arrival joins');
      // A later start heard is answered with ours (once a reply slot opens).
      recv({ t: 'battle', id: 3, key: KEY, startedAt: T + 2000, d: 0 });
      assert.eq(scene.save.citadelBattles[KEY].startedAt, T, 'ours is earlier: kept');
      flush(scene, Multiplayer.BATTLE_REPLY_MS);
      assert.eq(of('battle').length, 3, 'answered');
      assert.eq(of('battle')[2].startedAt, T);
      // Malformed or foreign: ignored.
      recv({ t: 'battle', id: 3, key: 'citadel', startedAt: T, d: 0 });
      recv({ t: 'battle', id: 3, key: QUEST_KEY, startedAt: T, d: 0 });
      recv({ t: 'battle', id: 3, key: KEY, startedAt: T, d: 2 });
      assert.eq(Object.keys(scene.save.citadelBattles).join(), KEY);
      // A claimed castle stops announcing.
      Houses.claimCastle(scene.save, { castle: KEY });
      flush(scene, Multiplayer.BATTLE_MS);
      assert.eq(of('battle').length, 3);
    }, { peers: [peer(2, 0, 0)] });
  });
});

test('shared battles: our own battle goes out at once, with its start', () => {
  withTile(() => {
    const { scene } = harness();
    online(scene);
    withRelay(scene, ({ of }) => {
      flush(scene);
      assert.eq(of('battle').length, 0, 'no battle, nothing sent');
      assert.truthy(Houses.startCitadelBattle(scene.save, KEY));
      flush(scene, 16);
      assert.eq(of('battle').length, 1);
      assert.eq(of('battle')[0].startedAt, scene.save.citadelBattles[KEY].startedAt);
      // Not from a cave: citadels stand on the surface.
      scene.depth = 1;
      flush(scene, Multiplayer.BATTLE_MS);
      assert.eq(of('battle').length, 1);
    });
  });
});

test('shared battles: a citadel guard is shared only while this save\'s battle is live', () => {
  withTile((entry) => {
    const [g] = garrison(entry, 1);
    const save = {};
    assert.falsy(EnemySpawns.isSharedId(g), 'no save: never');
    assert.falsy(EnemySpawns.isSharedId(g, save), 'no battle: never');
    Houses.startCitadelBattle(save, KEY);
    assert.truthy(EnemySpawns.isSharedId(g, save), 'live battle: shared');
    save.citadelBattles[KEY].startedAt = Date.now() - Houses.CITADEL_BATTLE_MS;
    assert.falsy(EnemySpawns.isSharedId(g, save), 'spent battle: never');
    const plain = foe(entry, { id: 'enemy_mps_plain' });
    assert.truthy(EnemySpawns.isSharedId(plain, save), 'an ordinary foe is unaffected');
  });
});

test('shared battles: guard hits land only from a peer in the same battle', () => {
  withTile((entry) => {
    const { scene } = harness();
    online(scene);
    withRelay(scene, ({ recv, of }) => {
      const [g] = garrison(entry, 1);
      const max = Combat.maxHp(g);
      recv({ t: 'hit', id: 2, eid: g.id, f: 0.3, left: 0.7, d: 0 });
      assert.eq(Combat.hp(g), max, 'no battle here: not shared');
      const T = Date.now() - 1000;
      recv({ t: 'battle', id: 2, key: KEY, startedAt: T, d: 0 });
      recv({ t: 'hit', id: 2, eid: g.id, f: 0.3, left: 0.7, d: 0 });
      assert.inRange(Combat.hp(g) - max * 0.7, -1e-6, 1e-6, 'same battle: lands');
      recv({ t: 'hit', id: 3, eid: g.id, f: 0.3, left: 0.4, d: 0 });
      assert.inRange(Combat.hp(g) - max * 0.7, -1e-6, 1e-6, 'a peer we have no battle frame from: dropped');
      recv({ t: 'battle', id: 3, key: KEY, startedAt: T + 1000, d: 0 });
      recv({ t: 'hit', id: 3, eid: g.id, f: 0.3, left: 0.4, d: 0 });
      assert.inRange(Combat.hp(g) - max * 0.7, -1e-6, 1e-6, 'a different start: dropped until it merges');
      recv({ t: 'battle', id: 3, key: KEY, startedAt: T, d: 0 });
      recv({ t: 'hit', id: 3, eid: g.id, f: 0.3, left: 0.4, d: 0 });
      assert.inRange(Combat.hp(g) - max * 0.4, -1e-6, 1e-6, 'merged: lands');
      // Our own blows on a guard are sent while the battle runs …
      scene._damageEnemy(g, max * 0.1, 'player', { exact: true });
      flush(scene, Multiplayer.HIT_FLUSH_MS * 2);
      assert.eq(of('hit').length, 1);
      // … and after it, not.
      scene.save.citadelBattles[KEY].startedAt = Date.now() - Houses.CITADEL_BATTLE_MS - 1;
      scene._damageEnemy(g, 1, 'player', { exact: true });
      flush(scene, Multiplayer.HIT_FLUSH_MS * 2);
      assert.eq(of('hit').length, 1, 'a spent battle\'s guard is not shared');
      recv({ t: 'hit', id: 2, eid: g.id, f: 0.1, left: 0.2, d: 0, k: 1 });
      assert.falsy(scene.save.caught.includes(g.id), 'nor killed by a peer after it');
    });
  });
});

test('shared battles: "dead" for a guard is answered and taken only within the same battle', () => {
  withTile((entry) => {
    const { scene } = harness();
    online(scene);
    withRelay(scene, ({ recv, of }) => {
      const [g, h] = garrison(entry, 2);
      const T = Date.now() - 1000;
      Houses.startCitadelBattle(scene.save, KEY, T);
      scene.save.citadelBattles[KEY].guardIds = [g.id, h.id];
      scene.save.caught.push(g.id);
      recv({ t: 'battle', id: 2, key: KEY, startedAt: T, d: 0 });
      recv({ t: 'battle', id: 3, key: KEY, startedAt: T + 500, d: 0 });
      recv({ t: 'seen', id: 3, ids: [g.id], d: 0 });
      flush(scene);
      assert.eq(of('dead').length, 0, 'an asker in another battle is not told');
      recv({ t: 'seen', id: 2, ids: [g.id], d: 0 });
      flush(scene);
      assert.eq(of('dead').length, 1, 'an asker in the same battle is');
      assert.eq(of('dead')[0].ids.join(), g.id);
      // The asking end: a dead guard is taken only from the same battle.
      recv({ t: 'dead', id: 3, ids: [h.id], d: 0 });
      assert.falsy(scene.save.caught.includes(h.id), 'from another battle (or a claimed castle): refused');
      recv({ t: 'dead', id: 2, ids: [h.id], d: 0 });
      assert.includes(scene.save.caught, h.id);
    });
  });
});

test('shared battles: each participant claims in its own save when every guard is down — a peer kill clears, pays no ledger', () => {
  withTile((entry) => {
    const { scene, paid } = harness();
    online(scene);
    withRelay(scene, ({ recv }) => {
      const [g, h] = garrison(entry, 2);
      const T = Date.now() - 1000;
      recv({ t: 'battle', id: 2, key: KEY, startedAt: T, d: 0 });
      scene.save.citadelBattles[KEY].guardIds = [g.id, h.id];
      // Our own kill of the first …
      scene._damageEnemy(g, Combat.maxHp(g) * 2, 'player', { exact: true });
      assert.includes(scene.save.caught, g.id);
      assert.falsy(Houses.isCastleClaimed(scene.save, { castle: KEY }), 'one still stands');
      const quests = paid.quests;
      // … and the peer's kill of the last.
      recv({ t: 'hit', id: 2, eid: h.id, f: 0, left: 0, d: 0, k: 1 });
      assert.includes(scene.save.caught, h.id);
      assert.truthy(Houses.isCastleClaimed(scene.save, { castle: KEY }), 'claimed here too');
      assert.includes(paid.flashes, 'The citadel is yours.');
      assert.eq(paid.quests, quests, 'no ledger hears of the peer\'s kill');
      assert.falsy(Macros.slainByPlayer(scene.save, h.id, Combat.PEER_SOURCE));
      // Claimed: the battle ends without undoing the deaths, as for a solo claim.
      scene._expireCitadelBattles(T + Houses.CITADEL_BATTLE_MS + 1);
      assert.falsy(scene.save.citadelBattles[KEY]);
      assert.includes(scene.save.caught, h.id);
    });
  });
});

test('shared battles: expiry undoes peer-killed guards with the rest, at the shared deadline', () => {
  withTile((entry) => {
    const { scene } = harness();
    online(scene);
    withRelay(scene, ({ recv }) => {
      const [g, h] = garrison(entry, 2);
      const T = Date.now() - 1000;
      recv({ t: 'battle', id: 2, key: KEY, startedAt: T, d: 0 });
      scene.save.citadelBattles[KEY].guardIds = [g.id, h.id];
      recv({ t: 'hit', id: 2, eid: g.id, f: 0, left: 0, d: 0, k: 1 });
      assert.includes(scene.save.caught, g.id);
      scene._expireCitadelBattles(T + Houses.CITADEL_BATTLE_MS - 1);
      assert.includes(scene.save.caught, g.id, 'still live');
      scene._expireCitadelBattles(T + Houses.CITADEL_BATTLE_MS);
      assert.falsy(scene.save.caught.includes(g.id), 'undone at the deadline every participant shares');
      assert.falsy(scene.save.citadelBattles[KEY]);
    });
  });
});

// ── targeting ──────────────────────────────────────────────────────────────
const cand = (id, cells) => ({ id, d: cells * CELL });
const permutations = (xs) => xs.length <= 1 ? [xs]
  : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));

test('targeting: the pick is the nearest, a tie band broken by lowest id — whatever order a device meets them', () => {
  const sets = [
    [[cand(4, 3), cand(2, 1), cand(9, 6)], 2],
    [[cand(7, 1), cand(5, 1.2), cand(3, 4)], 5],                 // 7 and 5 tie: lowest id
    [[cand(7, 1), cand(5, 1 + Multiplayer.TARGET_TIE_CELLS + 0.01)], 7],   // just outside the band
    [[cand(8, 2), cand(6, 2), cand(1, 2.4)], 1],                 // three-way tie
  ];
  for (const [cands, want] of sets) {
    for (const order of permutations(cands)) assert.eq(Multiplayer.pickTarget(order, null, CELL), want, JSON.stringify(order));
  }
  assert.eq(Multiplayer.pickTarget([], null, CELL), null);
  // "Which device evaluates it" is only which id is the local one: the
  // inputs are the same numbers, so the same answer.
  const world = [cand(11, 2), cand(3, 2.3), cand(20, 5)];
  assert.eq(Multiplayer.pickTarget(world, null, CELL), 3);
  assert.eq(Multiplayer.pickTarget([...world].reverse(), null, CELL), 3);
});

test('targeting: a held target is sticky under jitter, and gives way only past the margin', () => {
  const S = Multiplayer.TARGET_STICKY_CELLS;
  assert.eq(Multiplayer.pickTarget([cand(9, 3), cand(2, 2.2)], 9, CELL), 9, 'nearer by a little: kept');
  assert.eq(Multiplayer.pickTarget([cand(9, 3), cand(2, 3 - S + 0.01)], 9, CELL), 9, 'right at the margin: kept');
  assert.eq(Multiplayer.pickTarget([cand(9, 3), cand(2, 3 - S - 0.01)], 9, CELL), 2, 'past it: switched');
  // Jitter both ways around a tie never flips a held pick.
  for (const j of [-0.4, -0.1, 0, 0.1, 0.4]) {
    assert.eq(Multiplayer.pickTarget([cand(9, 2 + j), cand(2, 2 - j)], 9, CELL), 9);
  }
  assert.eq(Multiplayer.pickTarget([cand(2, 2)], 9, CELL), 2, 'the held one is gone: re-picked');
});

// Online as relay id `myId`, the local player `localCells` east of the foe;
// `peers` placed relative to the foe in cells.
function targeting(fn, { myId = 5, localCells = 2, peers = [] } = {}) {
  withTile((entry) => {
    const { scene } = harness();
    const c = foe(entry, { id: 'enemy_mps_tgt' });
    online(scene, { x: SPOT.x + localCells * CELL, y: SPOT.y });
    const roster = peers.map(([id, cells, over]) => peer(id, SPOT.x + cells * CELL, SPOT.y, over));
    withRelay(scene, (relay) => {
      const local = () => ({ x: scene.startWorldM.x + scene.playerM.x, y: scene.startWorldM.y + scene.playerM.y });
      const pick = () => { const p = local(); return Multiplayer.enemyTarget(scene, c, p.x, p.y); };
      fn({ scene, c, pick, ...relay });
    }, { myId, peers: roster });
  });
}

test('targeting: a nearer eligible peer is the target here — the same pick its own device makes', () => {
  targeting(({ c, pick, of, scene }) => {
    const t = pick();
    assert.truthy(t && t.peer, 'a peer body for the npcTarget lane');
    assert.eq(t.pid, 2);
    assert.inRange(t.x - (SPOT.x + CELL), -1e-6, 1e-6); assert.eq(t.y, SPOT.y);
    assert.eq(c._mpTgt, 2);
    flush(scene, 16);
    assert.eq(of('aggro').length, 1, 'the pick is announced');
    assert.eq(JSON.stringify(of('aggro')[0]), JSON.stringify({ t: 'aggro', eid: c.id, pid: 2, d: 0 }));
    pick(); flush(scene, 16);
    assert.eq(of('aggro').length, 1, 'once — not every frame');
  }, { peers: [[2, 1]] });
  // On peer 2's own device the same foe, the same two players: 2 is local.
  targeting(({ pick, c }) => {
    assert.eq(pick(), null, 'its own player: today\'s logic runs');
    assert.eq(c._mpTgt, 2);
  }, { myId: 2, localCells: 1, peers: [[5, 2]] });
});

test('targeting: a tie goes to the lowest id on every device', () => {
  targeting(({ pick, c }) => { assert.eq(pick(), null); assert.eq(c._mpTgt, 5); },
    { myId: 5, localCells: 1.2, peers: [[7, 1]] });
  targeting(({ pick }) => { assert.eq(pick().pid, 5); },
    { myId: 7, localCells: 1, peers: [[5, 1.2]] });
});

test('targeting: ineligible players are skipped — every published flag, and sight cut by gear', () => {
  for (const flag of Object.values(Multiplayer.TARGET_FLAGS)) {
    targeting(({ pick, c }) => { assert.eq(pick(), null); assert.eq(c._mpTgt, 5, `flag ${flag}`); },
      { peers: [[2, 1, { g: flag }]] });
  }
  // Out of the goblin's sight (visionCells 9), or inside it but cut by gear.
  targeting(({ pick, c }) => { assert.eq(pick(), null); assert.eq(c._mpTgt, 5); },
    { peers: [[2, 1, { v: 9 }]] });
  targeting(({ pick, c }) => { assert.eq(pick(), null); assert.eq(c._mpTgt, null, 'nobody in sight'); },
    { localCells: 12, peers: [[2, 11]] });
  // Another depth is not on this map.
  targeting(({ pick, c }) => { assert.eq(pick(), null); assert.eq(c._mpTgt, null, 'no peer here: the rule is silent'); },
    { peers: [[2, 1, { d: 3 }]] });
  // The local player is judged by the same flags (downed: energy 0).
  targeting(({ pick, scene }) => {
    scene.save.energy = 0;
    flush(scene, 16);
    assert.eq(pick().pid, 7, 'a downed local player is passed over for the eligible peer');
  }, { localCells: 1, peers: [[7, 3]] });
});

test('targeting: sticky against small moves, switched past the margin, and re-announced', () => {
  targeting(({ pick, scene, of }) => {
    assert.eq(pick().pid, 2);
    scene.playerM = { x: -1.1 * CELL, y: 0 };      // local now 0.9 cells off, peer 1: nearer, inside the margin
    assert.eq(pick().pid, 2, 'held');
    scene.playerM = { x: 0, y: 0 };
    scene.startWorldM = { x: SPOT.x, y: SPOT.y };  // local on the foe; peer held at 1 cell — inside the margin still
    assert.eq(pick().pid, 2, 'held at the margin');
    flush(scene, 16);
    assert.eq(of('aggro').length, 1, 'holding is not re-announced');
  }, { localCells: 2, peers: [[2, 1]] });
  targeting(({ pick, scene, of, recv }) => {
    assert.eq(pick().pid, 2);
    // The peer walks off to 6 cells; we stand on the foe: 6 > 0 + margin.
    recv({ t: 'p', id: 2, x: SPOT.x + 6 * CELL, y: SPOT.y, fx: 0, fy: 1, m: 1, d: 0, e: 1, g: 0, v: 0 });
    scene.startWorldM = { x: SPOT.x, y: SPOT.y };
    assert.eq(pick(), null, 'switched to the local player');
    flush(scene, 16);
    const a = of('aggro');
    assert.eq(a[a.length - 1].pid, 5, 'the switch is announced');
  }, { localCells: 2, peers: [[2, 1]] });
});

test('targeting: an aggro frame is adopted and held; a conflict inside the window goes to the lower pid', () => {
  targeting(({ pick, recv, c, scene, of }) => {
    assert.eq(pick().pid, 2);
    flush(scene, 16);
    const sent = of('aggro').length;
    // Peer 7's device says the foe is after 7 (farther here — its copy stands elsewhere).
    clock += Multiplayer.AGGRO_TIE_MS + 1;
    recv({ t: 'aggro', id: 7, eid: c.id, pid: 7, d: 0 });
    assert.eq(pick().pid, 7, 'adopted');
    assert.eq(pick().pid, 7, 'and held, though 2 is nearer here');
    flush(scene, 16);
    assert.eq(of('aggro').length, sent, 'an adoption is not re-announced');
    // Inside the tie window a higher pid loses to the one held.
    recv({ t: 'aggro', id: 9, eid: c.id, pid: 9, d: 0 });
    assert.eq(pick().pid, 7, 'pid 9 > 7 inside the window: ignored');
    recv({ t: 'aggro', id: 2, eid: c.id, pid: 2, d: 0 });
    assert.eq(pick().pid, 2, 'pid 2 < 7 inside the window: wins');
    // Past the window, the newer announcement stands whatever its pid.
    clock += Multiplayer.AGGRO_TIE_MS + 1;
    recv({ t: 'aggro', id: 7, eid: c.id, pid: 7, d: 0 });
    assert.eq(pick().pid, 7);
    // An announcement naming a player who is no candidate here is not adopted.
    clock += Multiplayer.AGGRO_TIE_MS + 1;
    recv({ t: 'aggro', id: 3, eid: c.id, pid: 99, d: 0 });
    assert.eq(pick().pid, 7, 'unknown pid: the held target stands');
    // One naming THIS player: adopted, so the local logic runs.
    clock += Multiplayer.AGGRO_TIE_MS + 1;
    recv({ t: 'aggro', id: 7, eid: c.id, pid: 5, d: 0 });
    assert.eq(pick(), null);
    assert.eq(c._mpTgt, 5);
  }, { localCells: 3, peers: [[2, 1], [7, 2], [9, 1.5]] });
  // Our own pick against a lower pid heard inside the window: theirs wins, ours is not sent.
  targeting(({ pick, recv, c, of, scene }) => {
    assert.eq(pick(), null);                      // we pick ourselves (5) and queue it
    recv({ t: 'aggro', id: 3, eid: c.id, pid: 3, d: 0 });
    flush(scene, 16);
    assert.eq(of('aggro').length, 0, 'the overruled pick is dropped');
    assert.eq(pick().pid, 3);
  }, { localCells: 1, peers: [[3, 4]] });
  // A pure check of the rule on the module's own entry point.
  assert.eq(typeof Multiplayer.onAggro, 'function');
});

test('targeting: aggro sends are capped per second', () => {
  targeting(({ scene, of, recv }) => {
    for (let i = 0; i < 10; i++) {
      const c = foe(WorldGen.tileCache.get(WorldGen.tileKey(TX, TY)), { id: `enemy_mps_cap_${i}` });
      const p = { x: scene.startWorldM.x, y: scene.startWorldM.y };
      Multiplayer.enemyTarget(scene, c, p.x, p.y);
    }
    flush(scene, 16);
    assert.eq(of('aggro').length, Multiplayer.AGGRO_MAX_PER_S);
    flush(scene, 1000);
    assert.eq(of('aggro').length, 2 * Multiplayer.AGGRO_MAX_PER_S, 'the rest wait their turn');
  }, { peers: [[2, 1]] });
});

test('targeting: offline, not connected, alone or for a foe that is not shared — silent, today\'s behaviour', () => {
  withTile((entry) => {
    const { scene } = harness();
    const c = foe(entry, { id: 'enemy_mps_off' });
    Multiplayer.stop(scene);
    assert.eq(Multiplayer.enemyTarget(scene, c, SPOT.x, SPOT.y), null, 'offline');
    assert.eq(c._mpTgt, undefined, 'and untouched');
  });
  targeting(({ pick, c, of, scene }) => {
    assert.eq(pick(), null, 'alone');
    flush(scene, 16);
    assert.eq(of('aggro').length, 0, 'nothing announced');
  }, { peers: [] });
  targeting(({ scene, of }) => {
    const ghost = makeGhost(SPOT.x, SPOT.y, 1, TX, TY, 0);
    assert.eq(Multiplayer.enemyTarget(scene, ghost, SPOT.x, SPOT.y), null, 'a per-device foe');
    flush(scene, 16);
    assert.eq(of('aggro').length, 0);
  }, { peers: [[2, 1]] });
});

test('targeting: a foe attacking a peer does nothing here — no damage, condition, shot, web or blast', () => {
  const scene = { save: { energy: 50, caught: [], armor: 0 }, cellM: CELL, depth: 0, _shots: [] };
  const body = { peer: true, kind: 'peer', pid: 2, id: 'peer:2', x: SPOT.x + 0.3 * CELL, y: SPOT.y };
  const now = 1e6;
  for (const row of EnemyRoster.ROWS) {
    const kind = row.id;
    if (row.retired) continue;
    const c = { kind, id: `peer_feint_${kind}`, x: SPOT.x, y: SPOT.y, _sharedId: true };
    for (let t = 0; t < 10; t++) rosterEnemyAttack(scene, c, row, now + t * 5000, body.x, body.y, false, 0.1, body);
    assert.eq(scene.save.energy, 50, `${kind}: no energy lost`);
    assert.eq(scene._shots.length, 0, `${kind}: no shot loosed`);
    assert.eq(scene.save.caught.length, 0, `${kind}: no blast spent`);
    assert.falsy(Conditions.hasDebuffs(scene.save), `${kind}: no condition`);
  }
  // A melee kind in reach swings (a feint), at its row's beat.
  const g = { kind: 'goblin', id: 'feinter', x: SPOT.x, y: SPOT.y };
  rosterEnemyAttack(scene, g, EnemyRoster.get('goblin'), now, body.x, body.y, false, 0.1, body);
  assert.truthy(g._meleeSwing, 'swings at the peer');
  assert.eq(g._peerFeintT, now + EnemyRoster.get('goblin').damageIntervalSeconds * 1000);
});

test('targeting: wired through the npcTarget lane of wanderCreatures (source pins)', () => {
  const w = SCENE_SRC.slice(SCENE_SRC.indexOf('  wanderCreatures() {'));
  const body = w.slice(0, w.indexOf('\n  }\n'));
  assert.truthy(/const peerTarget = enemy && !isTame && !haunts && typeof Multiplayer !== 'undefined'\s*\? Multiplayer\.enemyTarget\(this, c, px, py\) : null;/.test(body),
    'asked once per foe per tick');
  assert.truthy(/const kerbTurn = kerbLeash && !peerTarget/.test(body), 'your kerb does not turn a foe after someone else');
  assert.truthy(/NPC\.enemyTarget\(this, c, rosterRow, peerTarget\.x, peerTarget\.y, false\) \|\| peerTarget/.test(body),
    'a nearer neighbour still wins');
  assert.lt(body.indexOf('const peerTarget'), body.indexOf('const lairState'), 'resolved before the guard state');
  const attack = CREATURE_AI_SRC.slice(CREATURE_AI_SRC.indexOf('function rosterEnemyAttack('));
  assert.truthy(/^function rosterEnemyAttack\([^)]*\) \{\n  if \(npcTarget\?\.peer\) \{ if \(!inactive\) peerFeint\(/.test(attack),
    'the very first thing the attack asks — nothing below can land on a peer body');
});

// ── published health ───────────────────────────────────────────────────────
test('health: presence frames carry the energy fraction, flags and sight cut, and resend on change', () => {
  withTile(() => {
    const { scene } = harness();
    online(scene);
    withRelay(scene, ({ of }) => {
      const max = Energy.maxEnergy(scene.save);
      scene.save.energy = max;
      flush(scene, 6000);   // past the heartbeat: a frame goes out whatever the last one was
      const p = of('p');
      assert.eq(p[p.length - 1].e, 1); assert.eq(p[p.length - 1].g, 0); assert.eq(p[p.length - 1].v, 0);
      const before = of('p').length;
      scene.save.energy = Math.round(max * 0.37);
      flush(scene, 200);
      assert.eq(of('p').length, before + 1, 'a change in health is a change in the frame');
      assert.inRange(of('p')[before].e - Math.round(max * 0.37) / max, -0.006, 0.006);
      scene.save.energy = 0;
      flush(scene, 200);
      const last = of('p')[of('p').length - 1];
      assert.eq(last.e, 0);
      assert.truthy(last.g & Multiplayer.TARGET_FLAGS.downed, 'downed is published');
      // The hello carries them too (a reconnect re-sends the whole state).
      assert.eq(typeof of('hello')[0].e, 'number');
    });
  });
});

test('health: a hurt peer wears the enemy health bar over the head; a whole one shows none', () => {
  withTile(() => {
    const { scene } = harness();
    online(scene);
    withRelay(scene, ({ bars, recv }) => {
      flush(scene, 16);
      assert.eq(bars.length, 0, 'full health: no bar');
      recv({ t: 'p', id: 2, x: 30, y: 0, fx: 0, fy: 1, m: 0, d: 0, e: 0.4, g: 0, v: 0 });
      flush(scene, 16);
      assert.eq(bars.length, 1, 'hurt: one bar');
      assert.inRange(bars[0].frac - 0.4, -1e-9, 1e-9);
      // Centred on the peer, just under the name tag (23 px over the feet).
      const s = worldMetersToScreen(scene, 30, 0);
      assert.inRange(bars[0].cx - Math.round(s.x), -2, 2);
      assert.lt(bars[0].top, s.y, 'above the feet');
      recv({ t: 'p', id: 2, x: 30, y: 0, fx: 0, fy: 1, m: 0, d: 0, e: 1, g: 0, v: 0 });
      flush(scene, 16);
      assert.eq(bars.length, 1, 'healed: gone');
      // An old client's frame (no e) reads as full health.
      recv({ t: 'p', id: 2, x: 30, y: 0, fx: 0, fy: 1, m: 0, d: 0 });
      flush(scene, 16);
      assert.eq(bars.length, 1);
    }, { peers: [peer(2, 30, 0)] });
  });
});
})();
