// Elite (shiny) monsters — src/combat.js › ELITE_MUL / isElite / maxHp, the
// spawn stamp and kill payout in app.js, and the relic-biased
// 'treasure:elite' pool in rarity.js. Plus the first-delivery memory.

function seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('elite: every shiny row doubles HP and damage; armour remains the same', () => {
  assert.eq(Combat.ELITE_MUL, 2);
  for (const row of EnemyRoster.ROWS) {
    const plain = { kind: row.id, shiny: false };
    const elite = { kind: row.id, shiny: true, _disguiseRevealed: true };
    const multiplier = 2;
    assert.eq(Combat.isElite(elite), row.eliteEligible);
    assert.eq(Combat.maxHp(plain), row.hp);
    assert.eq(Combat.maxHp(elite), row.hp * multiplier);
    assert.eq(Combat.powerMul(elite), multiplier);
    // The serpent's head and tail tip are never struck (Combat.isConcealed).
    if (row.untargetable) { assert.eq(Combat.damageDealt(elite, row.hp), 0, `${row.id} takes no blow`); continue; }
    const removed = Combat.damageDealt(elite, row.hp);
    assert.eq(removed, Math.min(row.hp * multiplier, Combat.mitigate(row.hp, row.armor)));
    assert.eq(Combat.hpFraction(elite), (row.hp * multiplier - removed) / (row.hp * multiplier));
  }
  assert.falsy(Combat.isElite({ kind: 'deer', shiny: true }));
});

test('elite: the bounty pays per HP, so an elite pays double the wage', () => {
  for (const kind of Object.keys(MONSTERS)) {
    const plain = enemyBounty(kind, 0);
    const elite = enemyBounty(kind, 0, Combat.ELITE_MUL);
    if (MONSTERS[kind].bountyCoins != null) {
      assert.eq(elite,plain,kind+' keeps its authored fixed payout');
      continue;
    }
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
    2 + (MONSTERS.goblin_archer.cave.minDepth - 1), 'a deep kind adds its own introduction depth');
  assert.eq(eliteRollBonus('goblin', 0), MONSTERS.goblin.cave.minDepth - 1, 'depth 0 never goes negative');
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
  let gear = 0, relics = 0, n = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const r = pickReward('treasure:elite', { relics: {}, armor: {} }, seeded(seed), { rollBonus: 2 });
    assert.truthy(r && KINDS.has(r.kind), 'seed ' + seed + ' produced a valid reward');
    n++;
    if (r.kind === 'relic' || r.kind === 'armor' || (r.kind === 'gold' && r.slot)) gear++;
    if (r.kind === 'item') {
      assert.lte(r.tier, ctx.maxTier, 'item tier within the context ceiling');
      assert.truthy(ITEM_BY_ID[r.id], r.id + ' is a real item');
    }
    if (r.kind === 'relic') {
      relics++;
      assert.lte(r.tier, ctx.relicCap - 1, 'relic tier under the cap');
      assert.falsy(r.slot === 'ring', 'elite drops contain no retired ring gear');
    }
  }
  assert.gt(relics, 0, 'the sample reaches the relic branch');
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
  // The spawn and the monster's hit are the SceneCreatures mixin's
  // (scene_creatures.js); the kill and the heal are app.js's.
  const app = SCENE_SRC;
  assert.inRange(SHINY_RATE.monster, 0.001, 0.5, 'monsters have a shiny rate');
  const spawn = app.slice(app.indexOf('spawnCaveCreatures(entry, tx, ty, depth) {'));
  assert.truthy(/creatures\.push\(WorldGen\.makeCreature\(kind, wmx, wmy, id,\s*\{ shiny: EnemySpawns\.rollsElite\(entry, kind, id, wmx, wmy, cellSizeM\), habitat: habitat\.theme,/.test(spawn),
    'spawnCaveCreatures stamps shiny off the stable id at the monster rate (EnemySpawns.rollsElite)');
  // The melee formula is typed ONCE (Combat.meleeBlow: the row's dmg × powerMul
  // — elite × lair — plus the Giant bonus, times the Shrinking multiplier).
  assert.truthy(/\? Combat\.meleeBlow\(c, row\.dmg\)\s*: row\.dmg \* Combat\.powerMul\(c\);/.test(CREATURE_AI_SRC),
    'the monster hit is scaled by Combat.powerMul — elite × lair (and the mode)');
  assert.eq(Combat.meleeBlow({ kind: 'goblin', shiny: true }, 9), 18, 'an elite goblin swings double');
  assert.eq(Combat.petBlow({ kind: 'dog', id: 'released_dog' }), Combat.meleeBlow({ kind: 'dog' }, Combat.PET_BITE), 'a pet bites by the same formula');
  assert.falsy(/\* Combat\.powerMul\(c\) \+ PotionEffects\.meleeBonus\(c\)\) \* PotionEffects\.meleeMul\(c\)/.test(SCENE_CREATURES_SRC + CREATURE_AI_SRC),
    'no second copy of the formula in the sim');
  // The rested heal is ONE rule (Combat.healIfRested), asked by both movers.
  assert.eq((app + CREATURE_AI_SRC).match(/Combat\.healIfRested\(c\);/g).length, 2, 'both movers ask the one heal');
  const rested = { kind: 'goblin', shiny: true, _hp: 3, _lastDamagedT: 1 };
  assert.truthy(Combat.healIfRested(rested, 1 + Combat.REST_HEAL_MS));
  assert.eq(rested._hp, Combat.maxHp(rested), 'the heal refills to the instance max');
  assert.eq(rested._lastDamagedT, null);
  assert.falsy(Combat.healIfRested({ kind: 'goblin', _hp: 3, _lastDamagedT: 1000 }, 1000 + Combat.REST_HEAL_MS - 1), 'not before');
  assert.falsy(/c\._hp = Combat\.creatureMaxHp\(c\.kind\)/.test(app),
    'nothing refills a creature from the KIND max any more');
  const kill = app.slice(app.indexOf("resolveDefeat(victim, source = 'player') {"), app.indexOf('_busyWheel() {'));
  assert.truthy(/Combat\.enemyBounty\(victim\.kind, this\.depth, Combat\.powerMul\(victim\) \* \(victim\._splitShare \?\? 1\)\)/.test(kill),
    'the bounty is paid at the power multiplier (elite × lair), by a split slime\'s share');
  assert.truthy(/if \(this\._bankDiscovery\(victim\.kind, /.test(kill),
    'an elite kill banks the kind\'s memory the first time');
  assert.truthy(/grantTreasureRoll\(this, save, [^;]*Combat\.ELITE_TREASURE_CONTEXT,\s*\{ rollBonus: Combat\.eliteRollBonus\(victim\.kind, this\.depth\),\s*ceremony: \{ kind: 'treasure', header: `\$\{Combat\.eliteRank\(victim\)\.label\} slain`,/.test(kill),
    'and rolls the elite treasure at the commensurate tier after that, shown as a card');
  // The relic-capable roll has somewhere to land: grantTreasureRoll equips a
  // relic / armor reward and cashes out a beaten one.
  const grant = INTERACT_SRC.slice(INTERACT_SRC.indexOf('function grantTreasureRoll('));
  assert.truthy(/reward\.kind === 'relic' \|\| reward\.kind === 'armor'/.test(Rewards.present.toString()), 'gear rewards handled by the one presenter');
  assert.truthy(/Rewards\.apply\(save, reward, scene\)/.test(grant), 'and equipped');
});

test('delivery: the first delivery to a house banks a memory, once', () => {
  const app = SCENE_SRC;
  const start = app.indexOf('presentDeliveryOffer(sx, sy, house, recordDeal) {');
  assert.gt(start, 0, 'the delivery handler exists');
  const accept = app.slice(start, app.indexOf('\n  }\n', app.indexOf('onAccept: () =>', start)));
  assert.truthy(/const firstHere = this\._bankDiscovery\(`house:\$\{house\.id\}`,/.test(accept),
    'the accept handler banks house:<id> through the shared ledger');
  assert.truthy(/if \(firstHere\) this\.flashShiny\(gain, true, '🏠 NEW DOOR 🏠'\);/.test(accept),
    'and gets the same fanfare as any other memory');
  // The ledger itself: one memory per key, ever.
  const lStart = app.indexOf('_bankDiscovery(key, label) {');
  const ledger = app.slice(lStart, app.indexOf('flashShiny(money, isNew = true', lStart));
  assert.truthy(/if \(found\[key\]\) return false;/.test(ledger), 'a banked key is refused');
  assert.truthy(/this\.save\.memories = this\.memoriesUnspent\(\) \+ 1;/.test(ledger), 'a new key pays a memory');
  assert.eq((app.match(/this\.save\.memories = this\.memoriesUnspent\(\) \+ 1/g) || []).length, 1,
    'the ledger is the ONLY place a memory is handed out');
  assert.falsy(/addToInv\('discovery'/.test(app), 'and no bag stack is');
});
