// bounty_coin.test.js — a kill's bounty lies ON THE GROUND as one coin, and
// only the PLAYER's kills pay anything past it.
//
// What this suite is defending:
//
//  1. THE WAGE IS A COIN, NOT A CREDIT. resolveDefeat drops one coin on the
//     centre of the foe's cell (app.js _dropBountyCoin) carrying the whole
//     Combat.enemyBounty — into entry.coinDrops, the lane every coin already
//     rides — and never touches save.money.
//  2. THE COIN PAYS WHAT IT CARRIES. The 'coindrop' tap credits the coin's
//     `amount` (coinAmount, 1 for an ordinary coin) and pops that number.
//  3. WHO FELLED IT DECIDES THE REST. Combat.isPlayerKill(source) is the one
//     predicate: the player and their pet get the drop, the elite badge and
//     roll, the quest tick; a castle turret (shot.source 'turret') or any
//     other non-player source leaves the coin alone.
//
// resolveDefeat and _dropBountyCoin are lifted out of app.js and RUN on a stub
// scene; grantTreasureRoll / Quests / persistSave are shadowed by parameters so
// the test can count what was paid without touching the real globals.

(function () {
const APP = APP_JS_SRC;
const liftMethod = (sig) => {
  const start = APP.indexOf('\n  ' + sig);
  const end = start < 0 ? -1 : APP.indexOf('\n  }\n', start);
  if (start < 0 || end < 0) throw new Error(`could not lift ${sig}`);
  return APP.slice(start + 1, end + 4);
};
const METHODS = [
  "resolveDefeat(victim, source = 'player') {",
  '_dropBountyCoin(victim, amount) {',
].map(liftMethod).join(',\n');
const makeKill = new Function('grantTreasureRoll', 'Quests', 'persistSave',
  `return {\n${METHODS}\n};`);

const EDGE = 1000, N = 200, CELL = EDGE / N;
const TX = 7301, TY = 4102;   // a key no other suite uses

function withTile(fn) {
  const key = WorldGen.tileKey(TX, TY);
  const had = WorldGen.tileCache.get(key);
  const entry = { cellsPerEdge: N, tileEdgeM: EDGE, creatures: [] };
  WorldGen.tileCache.set(key, entry);
  try { return fn(entry); } finally {
    if (had) WorldGen.tileCache.set(key, had); else WorldGen.tileCache.delete(key);
  }
}

function harness() {
  const paid = { rolls: [], quests: [], discoveries: [], flashes: [], inv: [], shiny: 0 };
  const methods = makeKill(
    (...args) => { paid.rolls.push(args[5] || 'treasure:default'); },
    { onKill: (save, kind) => { paid.quests.push(kind); return false; } },
    () => {},
  );
  const scene = Object.assign(Object.create(methods), {
    save: { money: 0, caught: [] },
    depth: 0, tileEdgeM: EDGE, cellsPerTile: N,
    viewCenterX: 0, viewCenterY: 0,
    addToInv: (id, n) => paid.inv.push(id),
    flash: (t) => paid.flashes.push(t),
    flashLoot: (t) => paid.flashes.push(t),
    flashShiny: () => { paid.shiny++; },
    awardShinyBonus: () => { paid.shiny++; },
    _bankDiscovery: (k) => { paid.discoveries.push(k); return false; },
  });
  return { scene, paid };
}

// A foe standing off-centre in local cell (40, 60) of the test tile.
const foe = (over) => Object.assign({
  kind: 'goblin', id: 'mon_test_1',
  x: TX * EDGE + 40 * CELL + 1.3, y: TY * EDGE + 60 * CELL + 3.9,
}, over);

test('bounty coin: a death drops ONE coin with the whole bounty on the foe\'s cell — no direct credit', () => {
  withTile((entry) => {
    const { scene } = harness();
    const v = foe();
    scene.resolveDefeat(v);
    assert.eq(scene.save.money, 0, 'nothing credited directly');
    assert.includes(scene.save.caught, v.id, 'the foe is dead for good');
    assert.eq(entry.coinDrops.length, 1, 'one coin, not a scatter');
    const c = entry.coinDrops[0];
    assert.eq(c.kind, 'coindrop', 'the one coin lane');
    assert.eq(c.amount, Combat.enemyBounty('goblin', 0, Combat.powerMul(v)), 'carrying the whole bounty');
    assert.gt(c.amount, 1, 'a goblin pays more than a single coin');
    assert.eq(c.x, TX * EDGE + 40.5 * CELL, 'centred in the foe\'s cell (x)');
    assert.eq(c.y, TY * EDGE + 60.5 * CELL, 'centred in the foe\'s cell (y)');
    assert.eq(c.id, 'bounty_' + v.id, 'the id is the dead foe\'s own');
    assert.eq(c.expiresAt, undefined, 'it waits for you');
    assert.falsy(c.seeded, 'session state, never written to the save');
    // Dying twice pays once.
    scene.resolveDefeat(v);
    assert.eq(entry.coinDrops.length, 1, 'a second resolve drops nothing');
  });
});

test('bounty coin: the depth climb and the elite multiplier ride the coin', () => {
  withTile((entry) => {
    const { scene } = harness();
    scene.depth = 6;
    const v = foe({ shiny: true, id: 'mon_test_elite' });
    scene.resolveDefeat(v);
    assert.eq(entry.coinDrops[0].amount, Combat.enemyBounty('goblin', 6, Combat.ELITE_MUL),
      'the coin is the wage at depth, at the elite multiplier');
  });
});

test('bounty coin: picking it up credits exactly its amount and pops that number', () => {
  const handler = TAP_HANDLERS.find(h => h.name === 'coindrop');
  const origWMC = globalThis.worldMetersToAbsCell;
  const origFar = globalThis.tooFar;
  globalThis.worldMetersToAbsCell = (s, x, y) => ({ cellIX: Math.floor(x / CELL), cellIY: Math.floor(y / CELL) });
  globalThis.tooFar = () => false;
  try {
    withTile((entry) => {
      const { scene } = harness();
      const v = foe();
      scene.resolveDefeat(v);
      const amount = entry.coinDrops[0].amount;
      const pops = [];
      const tapScene = { playerToWorldCell: () => ({ tx: TX, ty: TY }),
        _popCellNumber: (t) => pops.push(t) };
      const save = { money: 3 };
      const ctx = Object.assign(makeCtx(tapScene, save), { wm: { x: v.x, y: v.y } });
      assert.eq(handler.try(ctx), true, 'the tap takes the coin');
      assert.eq(save.money, 3 + amount, 'credited the coin\'s whole amount');
      assert.eq(pops[0], `+${amount}`, 'and says the real number');
      assert.eq(entry.coinDrops.length, 0, 'the coin is gone');
      // An ordinary coin is still a single.
      entry.coinDrops.push({ kind: 'coindrop', x: v.x, y: v.y, id: 'plain' });
      assert.eq(handler.try(ctx), true, 'a plain coin is taken too');
      assert.eq(save.money, 3 + amount + 1, 'worth one');
      assert.eq(pops[1], '+1', 'popped as +1');
    });
  } finally {
    globalThis.worldMetersToAbsCell = origWMC;
    globalThis.tooFar = origFar;
  }
});

test('bounty coin: a TURRET kill leaves the coin and nothing else', () => {
  withTile((entry) => {
    const { scene, paid } = harness();
    const v = foe({ shiny: true, id: 'mon_turret_elite' });   // an elite, the richest kill
    // The turret's own shot names its source; resolveDefeat reads it back.
    const shot = Combat.turretShot(v.x, v.y + 2 * CELL, [v], CELL);
    assert.eq(Combat.shotSource(shot), 'turret', 'the turret arrow carries its source');
    scene.resolveDefeat(v, Combat.shotSource(shot));
    assert.eq(entry.coinDrops.length, 1, 'the coin drops');
    assert.eq(entry.coinDrops[0].amount, Combat.enemyBounty('goblin', 0, Combat.ELITE_MUL), 'the full wage');
    assert.eq(paid.discoveries.length, 0, 'no elite badge');
    assert.eq(paid.rolls.length, 0, 'no treasure roll');
    assert.eq(paid.quests.length, 0, 'no quest credit');
    assert.eq(paid.shiny, 0, 'no fanfare');
    assert.eq(paid.inv.length, 0, 'no item');
    assert.eq(scene.save.money, 0, 'and still no direct credit');
    assert.includes(scene.save.caught, v.id, 'but it is dead');
  });
});

test('bounty coin: an unknown source is not the player either', () => {
  assert.falsy(Combat.isPlayerKill('light'), 'a future environmental killer pays no treasure');
  assert.falsy(Combat.isPlayerKill(undefined), 'nor an unnamed one');
  assert.truthy(Combat.isPlayerKill('player') && Combat.isPlayerKill('pet'), 'the player and their pet are');
  assert.eq(Combat.shotSource({ slot: 'bow' }), 'player', 'a shot with no source is the player\'s');
});

test('bounty coin: a PLAYER (or pet) kill still pays everything past the wage', () => {
  for (const source of ['player', 'pet']) {
    withTile((entry) => {
      const { scene, paid } = harness();
      const v = foe({ shiny: true, id: 'mon_elite_' + source });
      scene.resolveDefeat(v, source);
      assert.eq(entry.coinDrops.length, 1, `${source}: the coin drops`);
      assert.eq(paid.discoveries[0], 'goblin', `${source}: the elite asks for its memory`);
      assert.eq(paid.rolls[0], Combat.ELITE_TREASURE_CONTEXT, `${source}: and, already known, rolls the elite treasure`);
      assert.eq(paid.quests[0], 'goblin', `${source}: the quest board is told`);
      assert.eq(scene.save.money, 0, `${source}: the wage still lies on the ground`);
    });
  }
  // Game drops its body part for the player, as before.
  withTile(() => {
    const { scene, paid } = harness();
    scene.resolveDefeat({ kind: 'crow', id: 'crow_x', x: TX * EDGE + 5, y: TY * EDGE + 5 });
    assert.eq(paid.inv[0], SpriteLayout.creatureDrop('crow'), 'a crow still drops its feather');
  });
});

test('bounty coin: every kill route names its killer', () => {
  // A pet's kill lands in wanderCreatures (scene_creatures.js); the rest in app.js.
  const SCENE = APP + '\n' + SCENE_CREATURES_SRC;
  assert.truthy(/this\.resolveDefeat\(c, source\);/.test(SCENE), '_damageEnemy passes its source on');
  assert.truthy(/this\.resolveDefeat\(tgt, 'pet'\);/.test(SCENE), 'a pet\'s kill is the pet\'s');
  assert.truthy(/this\._damageEnemy\(target, shot\.damage, Combat\.shotSource\(shot\)\)/.test(SCENE),
    'a shot\'s hit carries the shot\'s source');
  assert.falsy(/addMoney\(save, coins\)/.test(SCENE), 'no kill credits its bounty directly');
});

test('bounty coin: the Book says the kill pays per HP, re-derived', () => {
  const tip = PLAY_TIPS.find(t => typeof t === 'string' && /hostile you put down/.test(t));
  assert.truthy(tip, 'the bounty tip exists');
  assert.truthy(/one coin where it fell/.test(tip), 'it says the pay lies on the ground');
  const per = Math.round(1 / Combat.ENEMY_COIN_PER_HP);
  assert.truthy(tip.includes(`a coin per ${per} hit points`), 'the per-HP rate matches Combat.ENEMY_COIN_PER_HP');
});
})();
