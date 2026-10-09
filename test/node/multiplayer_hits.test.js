// multiplayer_hits.test.js — shared damage to enemies between nearby players.
//
// What this suite is defending (src/multiplayer.js "shared hits"):
//  1. Only this client's OWN side's damage to an ENEMY is sent
//     (Combat.isSharedHit), summed per enemy, as a fraction of its max HP.
//  2. An own-side kill announces itself with `k: 1`, exactly once.
//  3. A received hit lands on the copy with that id at this depth, by the
//     same fraction of THIS copy's pool; unloaded ids and other depths wait
//     briefly for their tile; `k: 1` kills even a full-HP copy.
//  4. A peer's hit is never sent on, and its kill pays nothing here — no
//     coin, drop, elite roll or quest credit (Macros.slainByPlayer false).
//
// The real _damageEnemy, resolveDefeat and _dropBountyCoin are lifted out of
// the scene source and run on a stub scene; the relay is a fake WebSocket.

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
  ].map(lift).join(',\n')}\n};`);

const EDGE = 1000, N = 200, CELL = EDGE / N;
const TX = 7311, TY = 4119;   // a key no other suite uses

function harness() {
  const paid = { rolls: 0, quests: 0, discoveries: 0, inv: 0, shiny: 0, pops: [], splits: 0 };
  const methods = makeMethods(
    () => { paid.rolls++; },
    { onKill: () => { paid.quests++; return false; } },
    () => {},
    () => false, 1000, 100,
    () => { paid.splits++; return null; },
  );
  const scene = Object.assign(Object.create(methods), {
    save: { money: 0, caught: [], boonUntil: {} },
    depth: 0, tileEdgeM: EDGE, cellsPerTile: N, cellM: CELL,
    viewCenterX: 0, viewCenterY: 0, playerM: { x: 0, y: 0 },
    addToInv: () => { paid.inv++; },
    flash() {}, flashAtPlayer() {}, flashAtWorld() {}, flashLoot() {}, flashShiny: () => { paid.shiny++; },
    awardShinyBonus: () => { paid.shiny++; },
    _bankDiscovery: () => { paid.discoveries++; return true; },
    _popDamageNumber: (c, n) => { paid.pops.push(n); },
  });
  return { scene, paid };
}

// A relay that records what the client sends; `online` drives it to welcome.
function withRelay(scene, fn) {
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
  scene.add = { container() { return { setDepth() { return this; }, add() {} }; }, graphics() { return { clear() {}, fillStyle() { return this; }, fillCircle() { return this; } }; } };
  // One test clock for the client's timers (hit flush, seen scan, dead jitter).
  const realNow = performance.now;
  performance.now = () => clock;
  try {
    Multiplayer.start(scene);
    FakeWebSocket.last.onmessage({ data: JSON.stringify({ t: 'welcome', id: 1, peers: [] }) });
    const recv = (msg) => FakeWebSocket.last.onmessage({ data: JSON.stringify(msg) });
    const hits = () => sent.filter((m) => m.t === 'hit');
    const of = (t) => sent.filter((m) => m.t === t);
    return fn({ sent, hits, recv, of });
  } finally {
    Multiplayer.stop(scene);
    performance.now = realNow;
    globalThis.document = oldDocument;
    globalThis.WebSocket = oldWebSocket;
  }
}
let clock = 1e9;

function withTile(fn) {
  const key = WorldGen.tileKey(TX, TY);
  const had = WorldGen.tileCache.get(key);
  const entry = { cellsPerEdge: N, tileEdgeM: EDGE, creatures: [] };
  WorldGen.tileCache.set(key, entry);
  try { return fn(entry); } finally {
    if (had) WorldGen.tileCache.set(key, had); else WorldGen.tileCache.delete(key);
  }
}
const foe = (entry, over) => {
  // A world-derived foe, marked where the tile spawn pass marks them.
  const c = EnemySpawns.markShared(Object.assign({ kind: 'goblin', id: 'enemy_mp_1',
    x: TX * EDGE + 40 * CELL + 1, y: TY * EDGE + 60 * CELL + 1 }, over));
  entry.creatures.push(c);
  return c;
};
// Advance the test clock past every client timer (hit flush, seen scan, dead
// jitter) and run one frame.
const flush = (scene) => {
  clock += 10 * Multiplayer.HIT_FLUSH_MS;
  scene._peerUprightPieces = [];
  scene.viewSize = 352; scene.viewCenterX = scene.viewCenterY = 176;
  Multiplayer.tick(scene);
};
// tick() reads the scene's own frame for its position frame.
function online(scene) {
  const mPerPx = 1;
  Object.assign(scene, { mPerPx, originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 } });
}

test('multiplayer hits: own-side, peer and world sources — only the own side is shared', () => {
  for (const s of ['player', 'pet', 'ally', 'turret']) assert.truthy(Combat.isSharedHit(s), s);
  for (const s of ['peer', 'enemy', 'lava', 'light', 'burn', 'obstacle', undefined]) assert.falsy(Combat.isSharedHit(s), String(s));
  assert.falsy(Combat.isPlayerKill(Combat.PEER_SOURCE), 'a peer kill is not the player\'s');
  assert.truthy(Combat.isPeerHit(Combat.PEER_SOURCE));
});

test('multiplayer hits: a local player hit sends exactly one frame, as a fraction of max HP', () => {
  withTile((entry) => {
    const { scene } = harness();
    online(scene);
    withRelay(scene, ({ hits }) => {
      const c = foe(entry);
      const max = Combat.maxHp(c);
      // Two blows inside one flush window sum into ONE frame.
      scene._damageEnemy(c, max * 0.1, 'player', { exact: true });
      scene._damageEnemy(c, max * 0.15, 'player', { exact: true });
      assert.eq(hits().length, 0, 'batched until the flush');
      flush(scene);
      assert.eq(hits().length, 1, 'one frame');
      const h = hits()[0];
      assert.eq(h.id, c.id); assert.eq(h.d, 0); assert.eq(h.k, undefined, 'not a kill');
      assert.inRange(h.f - 0.25, -1e-4, 1e-4, 'the fraction dealt');
      assert.inRange(h.left - Combat.hpFraction(c), -1e-4, 1e-4, 'the HP fraction left');
      flush(scene);
      assert.eq(hits().length, 1, 'nothing more to send');
    });
  });
});

test('multiplayer hits: an own-side kill sends exactly one frame with the kill flag', () => {
  withTile((entry) => {
    const { scene } = harness();
    online(scene);
    withRelay(scene, ({ hits }) => {
      const c = foe(entry);
      const max = Combat.maxHp(c);
      scene._damageEnemy(c, max * 0.4, 'player', { exact: true });
      assert.truthy(scene._damageEnemy(c, max, 'player', { exact: true }), 'killed');
      assert.eq(hits().length, 1, 'the kill goes at once, carrying the unsent damage');
      assert.eq(hits()[0].k, 1); assert.eq(hits()[0].left, 0);
      assert.inRange(hits()[0].f - 1, -1e-4, 1e-4, 'all of its pool');
      flush(scene);
      scene.resolveDefeat(c, 'player');
      assert.eq(hits().length, 1, 'still exactly one');
      // A pet's kill announces itself too, even with nothing pending.
      const d = foe(entry, { id: 'enemy_mp_pet' });
      scene.resolveDefeat(d, 'pet');
      assert.eq(hits().length, 2); assert.eq(hits()[1].k, 1); assert.eq(hits()[1].f, 0);
      // The world's kill is not announced: every client runs its own lava.
      scene.resolveDefeat(foe(entry, { id: 'enemy_mp_lava' }), 'lava');
      assert.eq(hits().length, 2);
    });
  });
});

test('multiplayer hits: a received hit damages the right creature by the right fraction, and is never sent on', () => {
  withTile((entry) => {
    const { scene, paid } = harness();
    online(scene);
    withRelay(scene, ({ hits, recv }) => {
      const c = foe(entry, { kind: 'armoured_demon', id: 'enemy_mp_armour' });
      const other = foe(entry, { id: 'enemy_mp_other' });
      assert.gt(Combat.monster(c.kind).armor, 0, 'armour would reduce a fresh blow');
      const max = Combat.maxHp(c);
      recv({ t: 'hit', id: 2, eid: c.id, f: 0.3, left: 0.7, d: 0 });
      assert.inRange(Combat.hp(c) - max * 0.7, -1e-6, 1e-6, 'exactly f of this copy\'s pool, no armour twice');
      assert.eq(Combat.hp(other), Combat.maxHp(other), 'no other creature touched');
      assert.eq(paid.pops.length, 1, 'the hit shows its number');
      assert.eq(paid.splits, 0);
      // Simultaneous hits are deltas: both land.
      recv({ t: 'hit', id: 3, eid: c.id, f: 0.2, left: 0.8, d: 0 });
      assert.inRange(Combat.hp(c) - max * 0.5, -1e-6, 1e-6, 'a second player\'s hit stacks');
      flush(scene);
      assert.eq(hits().length, 0, 'a received hit never triggers a send');
      // Unknown id / another depth: ignored.
      recv({ t: 'hit', id: 2, eid: 'enemy_not_loaded', f: 0.5, left: 0.5, d: 0 });
      recv({ t: 'hit', id: 2, eid: c.id, f: 0.3, left: 0.2, d: 1 });
      assert.inRange(Combat.hp(c) - max * 0.5, -1e-6, 1e-6, 'wrong depth ignored');
      assert.eq(Multiplayer.applyHit(scene, { eid: 'enemy_not_loaded', f: 0.5, left: 0.5, d: 0 }), false);
      // A per-player overlay hides it: the damage still lands, silently.
      other._surfaceInactive = true;
      const pops = paid.pops.length;
      recv({ t: 'hit', id: 2, eid: other.id, f: 0.5, left: 0.5, d: 0 });
      assert.inRange(Combat.hp(other) - Combat.maxHp(other) * 0.5, -1e-6, 1e-6);
      assert.eq(paid.pops.length, pops, 'no number over a foe this player cannot see');
    });
  });
});

test('multiplayer hits: a kill frame kills a full-HP copy, pays nothing, and sends nothing', () => {
  withTile((entry) => {
    const { scene, paid } = harness();
    online(scene);
    withRelay(scene, ({ hits, recv }) => {
      const c = foe(entry, { shiny: true, id: 'enemy_mp_elite' });   // an elite: the richest kill
      assert.eq(Combat.hp(c), Combat.maxHp(c), 'full HP here');
      recv({ t: 'hit', id: 2, eid: c.id, f: 0, left: 0, d: 0, k: 1 });
      assert.eq(Combat.hp(c), 0, 'dead whatever HP it showed');
      assert.includes(scene.save.caught, c.id, 'marked defeated through resolveDefeat');
      assert.eq((entry.coinDrops || []).length, 0, 'no bounty coin — the killer\'s client dropped it');
      assert.eq(paid.inv + paid.rolls + paid.quests + paid.discoveries + paid.shiny, 0, 'no drop, roll, quest or badge');
      assert.falsy(Macros.slainByPlayer(scene.save, c.id, Combat.PEER_SOURCE), 'no story or quest credit');
      // A peer hit that empties a drifted copy kills it the same way, silently.
      const d = foe(entry, { id: 'enemy_mp_drift' });
      d._hp = 1;
      recv({ t: 'hit', id: 2, eid: d.id, f: 0.5, left: 0.4, d: 0 });
      assert.includes(scene.save.caught, d.id);
      assert.eq((entry.coinDrops || []).length, 0);
      flush(scene);
      assert.eq(hits().length, 0, 'a peer-caused death sends nothing');
      // A repeat of the kill is ignored.
      recv({ t: 'hit', id: 3, eid: c.id, f: 1, left: 0, d: 0, k: 1 });
      assert.eq(scene.save.caught.filter((id) => id === c.id).length, 1);
    });
  });
});

test('multiplayer hits: a peer kill of a foe this side hit recently spawns the loot as an assist, never the credit', () => {
  withTile((entry) => {
    const { scene, paid } = harness();
    online(scene);
    withRelay(scene, ({ recv }) => {
      const c = foe(entry, { id: 'enemy_mp_assist' });
      scene._damageEnemy(c, 1, 'player');
      assert.truthy(Multiplayer.assisted(c), 'an own-side blow stamps the assist');
      recv({ t: 'hit', id: 2, eid: c.id, f: 0, left: 0, d: 0, k: 1 });
      assert.includes(scene.save.caught, c.id);
      assert.eq((entry.coinDrops || []).length, 1, 'the assist spawns the bounty coin here too');
      assert.eq(paid.quests, 0, 'no ledger is told of an assist');
      assert.falsy(Macros.slainByPlayer(scene.save, c.id, Combat.PEER_SOURCE), 'no story or quest credit');
      // A blow older than the window is no assist.
      const old = foe(entry, { id: 'enemy_mp_stale' });
      old._ownHitAt = Date.now() - Multiplayer.ASSIST_MS - 1;
      recv({ t: 'hit', id: 2, eid: old.id, f: 0, left: 0, d: 0, k: 1 });
      assert.includes(scene.save.caught, old.id);
      assert.eq((entry.coinDrops || []).length, 1, 'a stale hit pays nothing');
    });
  });
});

test('multiplayer hits: offline, nothing is sent or applied', () => {
  withTile((entry) => {
    const { scene } = harness();
    const c = foe(entry);
    Multiplayer.stop(scene);
    assert.eq(Multiplayer.reportHit(scene, c, 5, 'player'), false);
    assert.eq(Multiplayer.reportKill(scene, c, 'player'), false);
    assert.falsy(scene._damageEnemy(c, 5, 'player'), 'the blow still lands locally');
  });
});

// ── seen / dead ────────────────────────────────────────────────────────────
const nearMe = (scene) => { scene.playerToWorldCell = () => ({ tx: TX, ty: TY }); };

test('multiplayer seen: newly loaded shared enemies are batched, then retried fairly', () => {
  withTile((entry) => {
    const { scene } = harness();
    online(scene); nearMe(scene);
    withRelay(scene, ({ of }) => {
      for (let i = 0; i < 40; i++) foe(entry, { id: `enemy_mp_seen_${i}` });
      // Not announced: a per-device ghost, a dead one, a tame one.
      entry.creatures.push(makeGhost(TX * EDGE + 5, TY * EDGE + 5, 1, TX, TY, 0));
      foe(entry, { id: 'enemy_mp_seen_dead' }); scene.save.caught.push('enemy_mp_seen_dead');
      foe(entry, { id: 'enemy_mp_seen_pet', pet: true });
      flush(scene);
      assert.eq(of('seen').length, 1, 'one frame per scan');
      assert.eq(of('seen')[0].ids.length, Multiplayer.SEEN_MAX_IDS, 'capped');
      assert.eq(of('seen')[0].d, 0);
      flush(scene);
      assert.eq(of('seen').length, 2, 'the rest roll into the next frame');
      assert.eq(of('seen')[1].ids.length, 40 - Multiplayer.SEEN_MAX_IDS);
      const all = of('seen').flatMap((m) => m.ids);
      assert.eq(new Set(all).size, 40, 'every live shared foe, once');
      assert.falsy(all.some((id) => !id.startsWith('enemy_mp_seen_') || id.endsWith('_dead') || id.endsWith('_pet')));
      flush(scene);
      assert.eq(of('seen').length, 2, 'not repeated before the retry interval');
      foe(entry, { id: 'enemy_mp_seen_new' });
      flush(scene);
      assert.eq(of('seen').length, 3); assert.eq(of('seen')[2].ids.join(), 'enemy_mp_seen_new');
      clock += Multiplayer.SEEN_RETRY_MS;
      flush(scene); flush(scene);
      const retried = of('seen').slice(3).flatMap(m => m.ids);
      assert.eq(new Set(retried).size, 41, 'all previously announced foes retry, including the tail');
    });
  });
});

test('multiplayer dead: a knower answers dead for a seen id it has defeated, nothing for live ones', () => {
  withTile((entry) => {
    const { scene } = harness();
    online(scene);
    withRelay(scene, ({ of, recv }) => {
      foe(entry, { id: 'enemy_mp_alive' });
      scene.save.caught.push('enemy_mp_slain');
      recv({ t: 'seen', id: 2, ids: ['enemy_mp_slain', 'enemy_mp_alive', 'enemy_mp_unknown'], d: 0 });
      assert.eq(of('dead').length, 0, 'waits out its jitter');
      flush(scene);
      assert.eq(of('dead').length, 1, 'one answer');
      assert.eq(of('dead')[0].ids.join(), 'enemy_mp_slain');
      assert.eq(of('dead')[0].d, 0);
      flush(scene);
      assert.eq(of('dead').length, 1, 'answered once');
      // Asked again later: answered again (a new arrival must learn it too).
      clock += 2 * Multiplayer.DEAD_HEARD_MS;
      recv({ t: 'seen', id: 3, ids: ['enemy_mp_alive'], d: 0 });
      flush(scene);
      assert.eq(of('dead').length, 1, 'a live foe is never called dead');
    });
  });
});

test('multiplayer dead: receiving dead kills a full-HP copy, pays nothing and sends no kill', () => {
  withTile((entry) => {
    const { scene, paid } = harness();
    online(scene);
    withRelay(scene, ({ hits, of, recv }) => {
      const c = foe(entry, { shiny: true, id: 'enemy_mp_told_dead' });
      const other = foe(entry, { id: 'enemy_mp_told_alive' });
      const ghost = makeGhost(TX * EDGE + 5, TY * EDGE + 5, 1, TX, TY, 0);
      entry.creatures.push(ghost);
      recv({ t: 'dead', id: 2, ids: [c.id, ghost.id], d: 0 });
      assert.eq(Combat.hp(c), 0, 'dead whatever HP it showed');
      assert.includes(scene.save.caught, c.id);
      assert.eq(Combat.hp(other), Combat.maxHp(other), 'only the named one');
      assert.falsy(scene.save.caught.includes(ghost.id), 'a per-device id is never touched');
      assert.eq((entry.coinDrops || []).length, 0, 'no coin');
      assert.eq(paid.inv + paid.rolls + paid.quests + paid.discoveries + paid.shiny, 0, 'no loot or credit');
      flush(scene);
      assert.eq(hits().length, 0, 'no kill frame');
      assert.eq(of('dead').length, 0, 'not re-broadcast');
      // Another depth's list is not ours to apply.
      recv({ t: 'dead', id: 2, ids: [other.id], d: 2 });
      assert.eq(Combat.hp(other), Combat.maxHp(other));
    });
  });
});

test('multiplayer dead: an answer another peer already gave is not repeated', () => {
  withTile((entry) => {
    const { scene } = harness();
    online(scene);
    withRelay(scene, ({ of, recv }) => {
      scene.save.caught.push('enemy_mp_a', 'enemy_mp_b');
      // Asked, then someone else answers for one of them inside our jitter.
      recv({ t: 'seen', id: 2, ids: ['enemy_mp_a', 'enemy_mp_b'], d: 0 });
      recv({ t: 'dead', id: 3, ids: ['enemy_mp_a'], d: 0 });
      flush(scene);
      assert.eq(of('dead').length, 1);
      assert.eq(of('dead')[0].ids.join(), 'enemy_mp_b', 'only the one nobody answered');
      // Answered by someone else before we were even asked: no answer at all.
      clock += 2 * Multiplayer.DEAD_HEARD_MS;
      recv({ t: 'dead', id: 3, ids: ['enemy_mp_a'], d: 0 });
      recv({ t: 'seen', id: 4, ids: ['enemy_mp_a'], d: 0 });
      flush(scene);
      assert.eq(of('dead').length, 1, 'suppressed');
    });
  });
});

test('multiplayer reconciliation: already connected peers meet after their initial scans', () => {
  withTile(entry => {
    const { scene } = harness(); online(scene); nearMe(scene);
    withRelay(scene, ({ of, recv }) => {
      const c = foe(entry, { id: 'enemy_mp_meet' });
      flush(scene);
      assert.eq(of('seen').length, 1);
      // Both clients can be connected outside relay range on their first scan.
      clock += Multiplayer.SEEN_RETRY_MS;
      flush(scene);
      assert.eq(of('seen').length, 2, 'a new encounter can learn the same id without reconnecting');
      recv({ t: 'dead', ids: of('seen')[1].ids, d: 0 });
      assert.includes(scene.save.caught, c.id);
    });
  });
});

test('multiplayer edge groups: unloaded hits and deaths land once when the neighbouring tile arrives', () => {
  withTile(entry => {
    const { scene, paid } = harness(); online(scene); nearMe(scene);
    withRelay(scene, ({ recv, of }) => {
      recv({ t: 'hit', eid: 'enemy_mp_late_hit', f: 0.2, d: 0 });
      recv({ t: 'hit', eid: 'enemy_mp_late_hit', f: 0.3, d: 0 });
      recv({ t: 'hit', eid: 'enemy_mp_late_kill', f: 0, k: 1, d: 0 });
      recv({ t: 'dead', ids: ['enemy_mp_late_dead'], d: 0 });
      const hit = foe(entry, { id: 'enemy_mp_late_hit' });
      const kill = foe(entry, { id: 'enemy_mp_late_kill' });
      const dead = foe(entry, { id: 'enemy_mp_late_dead', _surfaceInactive: true });
      flush(scene);
      assert.inRange(Combat.hpFraction(hit), 0.4999, 0.5001);
      assert.includes(scene.save.caught, kill.id);
      assert.includes(scene.save.caught, dead.id);
      assert.eq((entry.coinDrops || []).length, 0, 'unseen deaths pay no loot');
      assert.falsy(of('seen').some(m => m.ids.includes(kill.id) || m.ids.includes(dead.id)), 'deferred deaths apply before announcing');
      flush(scene);
      assert.inRange(Combat.hpFraction(hit), 0.4999, 0.5001, 'queued delta consumed once');
      // Wrong-depth damage must not touch a surface body with the same id.
      recv({ t: 'hit', eid: hit.id, f: 0.25, d: 2 });
      flush(scene);
      assert.inRange(Combat.hpFraction(hit), 0.4999, 0.5001);
      scene.depth = 2;
      flush(scene);
      assert.inRange(Combat.hpFraction(hit), 0.2499, 0.2501, 'applies after entering its depth');
      assert.eq(paid.quests, 0);
    });
  });
});

test('multiplayer edge groups: stale unseen damage expires and local or tame bodies reject deferred kills', () => {
  withTile(entry => {
    const { scene } = harness(); online(scene);
    withRelay(scene, ({ recv }) => {
      recv({ t: 'hit', eid: 'enemy_mp_expired', f: 0.5, d: 0 });
      clock += 31000;
      const c = foe(entry, { id: 'enemy_mp_expired' });
      recv({ t: 'dead', ids: ['enemy_mp_private', 'enemy_mp_tame'], d: 0 });
      const local = foe(entry, { id: 'enemy_mp_private' });
      delete local._sharedId;
      const tame = foe(entry, { id: 'enemy_mp_tame', pet: true });
      flush(scene);
      for (const body of [c, local, tame]) {
        assert.eq(Combat.hpFraction(body), 1);
        assert.falsy(scene.save.caught.includes(body.id));
      }
    });
  });
});

test('multiplayer edge groups: hidden garrisons reconcile, and leaving and returning to a depth reannounces', () => {
  withTile(entry => {
    const { scene } = harness(); online(scene); nearMe(scene);
    withRelay(scene, ({ of }) => {
      const c = foe(entry, { id: 'enemy_mp_hidden', _surfaceInactive: true });
      flush(scene);
      assert.includes(of('seen')[0].ids, c.id, 'a hidden foe is still a shared world body');
      scene.depth = 2;
      flush(scene);
      scene.depth = 0;
      flush(scene);
      assert.eq(of('seen').filter(m => m.d === 0 && m.ids.includes(c.id)).length, 2);
    });
  });
});

test('multiplayer group kills: an 80-enemy burst stays inside the hit budget and eventually sends every kill', () => {
  withTile(entry => {
    const { scene } = harness(); online(scene);
    withRelay(scene, ({ hits }) => {
      for (let i = 0; i < 80; i++) scene.resolveDefeat(foe(entry, { id: `enemy_mp_burst_${i}` }), 'player');
      assert.eq(hits().length, Multiplayer.HIT_MAX_PER_S, 'overflow kills queue');
      // A frame on the old boundary must not release another entire burst.
      clock += 999;
      Multiplayer.tick(scene);
      assert.eq(hits().length, Multiplayer.HIT_MAX_PER_S);
      for (let i = 0; i < 10; i++) flush(scene);
      assert.eq(hits().length, 80, 'no kill lost to rate limiting');
      assert.eq(new Set(hits().map(h => h.id)).size, 80);
      assert.truthy(hits().every(h => h.k === 1));
    });
  });
});

test('multiplayer split encounters: original and halves stay local before and after splitting', () => {
  withTile(entry => {
    const { scene } = harness(); online(scene); nearMe(scene);
    withRelay(scene, ({ hits, of, recv }) => {
      const original = foe(entry, { kind: 'split_slime', id: 'enemy_mp_split' });
      assert.falsy(EnemySpawns.isSharedId(original), 'even an unsplit root is excluded');
      Multiplayer.reportHit(scene, original, 1, 'player');
      recv({ t: 'hit', eid: original.id, f: 1, k: 1, d: 0 });
      assert.eq(Combat.hpFraction(original), 1, 'a peer cannot kill the private encounter');
      original._splitRoot = original.id; original._splitShare = 0.5; original._hp = 12;
      const twin = foe(entry, { kind: 'split_slime', id: original.id + '_s1', _sharedId: false, _hp: 12 });
      recv({ t: 'dead', ids: [original.id, twin.id], d: 0 });
      assert.eq(Combat.hp(original), 12); assert.eq(Combat.hp(twin), 12);
      scene.resolveDefeat(original, 'player');
      flush(scene);
      assert.eq(hits().length, 0);
      assert.eq(of('seen').length, 0);
      assert.falsy(scene.save.caught.includes(twin.id), 'the twin lives on');
    });
  });
});

// ── which ids are world-shared ─────────────────────────────────────────────
test('shared ids: only creatures marked where the world makes them; every per-device mint is not', () => {
  const world = EnemySpawns.markShared(WorldGen.makeCreature('goblin', 0, 0, EnemySpawns.surfaceId(1, -2, 3, 4)));
  assert.truthy(EnemySpawns.isSharedId(world), 'a surface roster foe');
  assert.falsy(EnemySpawns.isSharedId(WorldGen.makeCreature('goblin', 0, 0, EnemySpawns.surfaceId(1, -2, 3, 4))),
    'positive rule: an unmarked creature is never shared, whatever its id looks like');
  assert.falsy(EnemySpawns.isSharedId(Object.assign({}, world, { castle: 'k' })), 'a citadel guard\'s death can expire');
  assert.falsy(EnemySpawns.isSharedId(Object.assign({}, world, { id: 'bad id' })), 'outside the wire charset');
  assert.falsy(EnemySpawns.isSharedId(makeGhost(0, 0, 123, 1, 2, 0)), 'a risen ghost');
  // Each per-device minting site makes its creature without the mark.
  const site = (file, needle) => {
    const src = ALL_SRC[file];
    const at = src.indexOf(needle);
    if (at < 0) throw new Error(`${file}: minting site ${needle} moved`);
    const stmt = src.slice(src.lastIndexOf(';', at) + 1, src.indexOf(';', at));
    assert.falsy(/markShared|_sharedId/.test(stmt), `${file} ${needle} must stay per-device`);
  };
  site('creature_ai.js', 'ghost_${tx}_${ty}_${Math.floor(now)}');
  site('creature_ai.js', 'fished_slime_${pcW.tx}_${pcW.ty}_${Math.floor(now)}');
  site('creature_ai.js', 'const twin = WorldGen.makeCreature(');
  site('scene_creatures.js', 'pest_deer_${pc.tx}_${pc.ty}_${Math.floor(now)}');
  site('scene_venues.js', 'guildfoe_${tx}_${ty}_${Math.floor(now)}_${i}');
  site('scene_venues.js', 'WorldGen.makeCreature(f.kind, f.x, f.y, f.id, { shiny: false, bounty: gb.id })');
  site('app.js', 'enemy_dev_${Date.now()}');
  site('story_encounters.js', 'WorldGen.makeCreature(kind, p.x, p.y, id, fields)');
  // A split half inherits its parent's garrison fields, never the mark.
  assert.falsy(Lairs.GARRISON_INHERIT.includes('_sharedId'), 'a split half (per-device serial) is not shared');
  // The mark lives only where world-derived creatures are made.
  const marking = Object.keys(ALL_SRC).filter((f) => /markShared\(|_sharedId: true/.test(ALL_SRC[f])).sort();
  // (enemy_habitats.js: a party's extra encounter members, scaleEncounters.)
  assert.eq(marking.join(), ['creature_ai.js', 'enemy_habitats.js', 'enemy_spawns.js', 'lairs.js', 'scene_creatures.js'].join(),
    'a new marking site is a deliberate, reviewed choice');
});
})();
