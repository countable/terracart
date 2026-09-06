// Elite (shiny) monsters — src/combat.js › ELITE_MUL / isElite / maxHp, the
// spawn stamp and kill payout in app.js, and the relic-biased
// 'treasure:elite' pool in rarity.js. Plus the first-delivery Discovery badge.

function seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('elite: a shiny cave monster has double HP; nothing else does', () => {
  assert.eq(Combat.ELITE_MUL, 2, 'double, per the rule');
  for (const kind of Object.keys(MONSTERS)) {
    const plain = { kind, id: 'p', shiny: false };
    const elite = { kind, id: 'e', shiny: true };
    assert.eq(Combat.isElite(elite), true, kind + ' shiny is an elite');
    assert.eq(Combat.isElite(plain), false, kind + ' plain is not');
    assert.eq(Combat.eliteMul(elite), 2, kind + ' elite multiplier');
    assert.eq(Combat.eliteMul(plain), 1, kind + ' plain multiplier');
    assert.eq(Combat.maxHp(plain), MONSTERS[kind].hp, kind + ' plain max = table');
    assert.eq(Combat.maxHp(elite), MONSTERS[kind].hp * 2, kind + ' elite max = 2× table');
    assert.eq(Combat.hp(elite), MONSTERS[kind].hp * 2, kind + ' elite seeds its pool at 2×');
    // Half the pool gone reads as half a health bar — the bar is against the
    // instance's max, not the kind's.
    Combat.damage(elite, MONSTERS[kind].hp);
    assert.eq(Combat.hpFraction(elite), 0.5, kind + ' elite bar at half after table-hp damage');
  }
  // The surface slime and game animals never become elites, shiny or not.
  assert.eq(Combat.isElite({ kind: 'slime', shiny: true }), false, 'shiny surface slime is not an elite');
  assert.eq(Combat.maxHp({ kind: 'slime', shiny: true }), 15, 'and keeps its 15 HP');
  assert.eq(Combat.isElite({ kind: 'deer', shiny: true }), false, 'a shiny deer is game, not an elite');
  assert.eq(Combat.maxHp({ kind: 'deer', shiny: true }), Combat.creatureMaxHp('deer'), 'unchanged HP');
});

test('elite: the bounty pays per HP, so an elite pays double the wage', () => {
  for (const kind of Object.keys(MONSTERS)) {
    const plain = enemyBounty(kind, 0);
    const elite = enemyBounty(kind, 0, Combat.ELITE_MUL);
    assert.eq(elite, Math.max(1, Math.round(MONSTERS[kind].hp * 2 * ENEMY_COIN_PER_HP)),
      kind + ' elite bounty is the doubled pool at the per-HP rate');
    assert.gt(elite, plain, kind + ' elite pays more than plain');
  }
  assert.eq(enemyBounty('goblin', 0), enemyBounty('goblin', 0, 1), 'the default multiplier is 1');
});

test('elite: the treasure roll climbs with depth and the kind\'s introduction depth', () => {
  assert.eq(ELITE_TREASURE_CONTEXT, 'treasure:elite');
  assert.truthy(LOOT_CONTEXTS[ELITE_TREASURE_CONTEXT], 'the context exists');
  assert.eq(eliteRollBonus('cave_slime', 1), 0, 'a first-level foe at the first level: no bonus');
  assert.eq(eliteRollBonus('cave_slime', 3), 2, 'two levels further down: +2');
  assert.eq(eliteRollBonus('goblin_archer', 3),
    2 + (MONSTERS.goblin_archer.minDepth - 1), 'a deep kind adds its own introduction depth');
  assert.eq(eliteRollBonus('goblin', 0), MONSTERS.goblin.minDepth - 1, 'depth 0 never goes negative');
});

test('elite: the treasure pool is biased to relics and pays a real reward', () => {
  const ctx = LOOT_CONTEXTS['treasure:elite'];
  const bias = ctx.classBias;
  const top = Object.keys(bias).reduce((a, b) => (bias[a] >= bias[b] ? a : b));
  assert.eq(top, 'relic', 'relic is the heaviest class');
  assert.gt(ctx.relicCap, 0, 'relics are actually reachable (relicCap > 0)');
  assert.gt(bias.relic, (LOOT_CONTEXTS['chest:civic'].classBias.relic || 0),
    'heavier relic share than the richest chest');
  const KINDS = new Set(['item', 'relic', 'armor', 'gold']);
  let gear = 0, n = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const r = pickReward('treasure:elite', { relics: {}, armor: {} }, seeded(seed), { rollBonus: 2 });
    assert.truthy(r && KINDS.has(r.kind), 'seed ' + seed + ' produced a valid reward');
    n++;
    if (r.kind === 'relic' || r.kind === 'armor' || (r.kind === 'gold' && r.slot)) gear++;
    if (r.kind === 'item') {
      assert.lte(r.tier, ctx.maxTier, 'item tier within the context ceiling');
      assert.truthy(ITEM_BY_ID[r.id], r.id + ' is a real item');
    }
    if (r.kind === 'relic') assert.lte(r.tier, ctx.relicCap - 1, 'relic tier under the cap');
  }
  assert.gt(gear / n, 0.3, 'a third or more of elite drops are gear rolls');
  // Commensurate tier: the depth bonus buys tier. Compare mean item tier
  // with and without the bonus over the same seeds.
  const meanTier = (bonus) => {
    let sum = 0, k = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const r = pickReward('treasure:elite', { relics: {}, armor: {} }, seeded(seed), { rollBonus: bonus });
      if (r && r.kind === 'item') { sum += r.tier; k++; }
    }
    return sum / Math.max(1, k);
  };
  assert.gt(meanTier(4), meanTier(0), 'a deeper elite rolls higher tiers');
});

test('elite: the shipping code stamps, scales, heals and pays the elite', () => {
  const app = APP_JS_SRC;
  assert.inRange(SHINY_RATE.monster, 0.001, 0.5, 'monsters have a shiny rate');
  const spawn = app.slice(app.indexOf('spawnCaveCreatures(entry, tx, ty, depth) {'));
  assert.truthy(/creatures\.push\(\{ x: wmx, y: wmy, kind, id, shiny: isShiny\(id, SHINY_RATE\.monster\) \}\)/.test(spawn),
    'spawnCaveCreatures stamps shiny off the stable id at the monster rate');
  assert.truthy(/const dmg = m\.dmg \* Combat\.eliteMul\(c\) \* Difficulty\.get\(\)\.enemyDmgMul;/.test(app),
    'the monster hit is scaled by Combat.eliteMul (and the mode)');
  assert.truthy(/c\._hp = Combat\.maxHp\(c\);/.test(app), 'the heal refills to the instance max');
  assert.falsy(/c\._hp = Combat\.creatureMaxHp\(c\.kind\)/.test(app),
    'nothing refills a creature from the KIND max any more');
  const kill = app.slice(app.indexOf('resolveDefeat(victim) {'), app.indexOf('_busyWheel() {'));
  assert.truthy(/enemyBounty\(victim\.kind, this\.depth, Combat\.eliteMul\(victim\)\)/.test(kill),
    'the bounty is paid at the elite multiplier');
  assert.truthy(/if \(this\._bankDiscovery\(victim\.kind\)\)/.test(kill),
    'an elite kill banks the kind\'s Discovery badge the first time');
  assert.truthy(/grantTreasureRoll\(this, save, [^;]*ELITE_TREASURE_CONTEXT, \{ rollBonus: eliteRollBonus\(victim\.kind, this\.depth\) \}\)/.test(kill),
    'and rolls the elite treasure at the commensurate tier after that');
  // The relic-capable roll has somewhere to land: grantTreasureRoll equips a
  // relic / armor reward and cashes out a beaten one.
  const grant = INTERACT_SRC.slice(INTERACT_SRC.indexOf('function grantTreasureRoll('));
  assert.truthy(/reward\.kind === 'relic' \|\| reward\.kind === 'armor'/.test(grant), 'gear rewards handled');
  assert.truthy(/equipGearReward\(reward, save, scene\)/.test(grant), 'and equipped');
});

test('delivery: the first delivery to a house banks a Discovery badge, once', () => {
  const app = APP_JS_SRC;
  const start = app.indexOf('presentDeliveryOffer(sx, sy, house, recordDeal) {');
  assert.gt(start, 0, 'the delivery handler exists');
  const accept = app.slice(start, app.indexOf('\n  }\n', app.indexOf('onAccept: (q) =>', start)));
  assert.truthy(/const firstHere = this\._bankDiscovery\(`house:\$\{house\.id\}`\);/.test(accept),
    'the accept handler banks house:<id> through the shared ledger');
  assert.truthy(/if \(firstHere\) this\.flash\('🔆 \+1 Discovery/.test(accept), 'and says so');
  // The ledger itself: one badge per key, ever.
  const lStart = app.indexOf('_bankDiscovery(key) {');
  const ledger = app.slice(lStart, app.indexOf('flashShiny(money, isNew = true', lStart));
  assert.truthy(/if \(found\[key\]\) return false;/.test(ledger), 'a banked key is refused');
  assert.truthy(/this\.addToInv\('discovery', 1, true\)/.test(ledger), 'a new key pays the badge');
  assert.eq((app.match(/addToInv\('discovery'/g) || []).length, 1,
    'the ledger is the ONLY place a Discovery badge is handed out');
});
