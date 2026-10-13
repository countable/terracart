// Signature selection, monster-relative strength, and duplicate cash-outs.
(function () {
  const fresh = () => ({ inv: [], relics: {}, armor: {} });
  const rolls = [0.35, 0.8, 0.95];
  const rows = () => EnemyRoster.ROWS.filter(row => row.eliteEligible);
  const pick = (row, index, save = fresh(), opts = {}) =>
    pickReward('treasure:elite', save, () => rolls[index], { monsterKind: row.id, ...opts });

  test('elite drops: every eligible monster has three valid, distinct signatures', () => {
    assert.gt(rows().length, 0);
    for (const row of rows()) {
      const drops = Combat.monster(row.id).eliteDrops;
      assert.eq(drops?.length, 3, row.id);
      assert.eq(new Set(drops.map(d => `${d.kind}:${d.id || d.slot}`)).size, 3, row.id);
      for (const drop of drops) {
        if (drop.kind === 'item') {
          const item = ITEM_BY_ID[drop.id];
          assert.truthy(item, `${row.id}: ${drop.id}`);
          assert.falsy(item.progressionOnly, `${row.id}: progression items stay out of elite loot`);
          if (drop.qtyBonus !== undefined) {
            assert.eq(drop.qtyBonus, 1, `${row.id}: consumable bonus`);
            assert.falsy(item.kind === 'unique_relic', 'unique relics never get quantity bonuses');
          }
        }
        else {
          assert.truthy(['relic', 'armor'].includes(drop.kind), row.id);
          assert.truthy((drop.kind === 'relic' ? RELIC_DEFS : ARMOR_DEFS)[drop.slot], `${row.id}: ${drop.slot}`);
        }
      }
    }
  });

  test('elite drops: half the signatures diversify beyond magic and tiered equipment, with mostly unique rare finds', () => {
    const drops = rows().flatMap(row => Combat.monster(row.id).eliteDrops);
    const diverse = drops.filter(drop => drop.kind === 'item' && ITEM_BY_ID[drop.id].kind !== 'magic');
    assert.truthy(diverse.length >= drops.length / 2, 'at least half the entries use other item categories');
    const rares = rows().map(row => Combat.monster(row.id).eliteDrops[2]);
    const uniqueRares = rares.filter(drop => drop.kind === 'item' && ITEM_BY_ID[drop.id].kind === 'unique_relic');
    assert.gt(uniqueRares.length, rares.length / 2, 'most 10% rewards are unique relics');
    assert.truthy(drops.some(drop => drop.qtyBonus === 1), 'consumables receive an authored quantity boost');
  });

  test('elite drops: exact 70/20/10 boundaries select the authored signature', () => {
    for (const row of rows()) {
      for (const [roll, index] of [[0, 0], [0.699999, 0], [0.7, 1], [0.899999, 1], [0.9, 2], [0.999999, 2]]) {
        let first = true;
        const reward = pickReward('treasure:elite', fresh(), () => {
          if (first) { first = false; return roll; }
          return 0.99;
        }, { monsterKind: row.id });
        const drop = Combat.monster(row.id).eliteDrops[index];
        assert.eq(reward.signatureIndex, index, `${row.id} at ${roll}`);
        assert.eq(reward.kind, drop.kind, row.id);
        assert.eq(reward.id || reward.slot, drop.id || drop.slot, row.id);
      }
    }
  });

  test('elite drops: possessed always select the second signature and ascendant the third without a random draw', () => {
    for (const [eliteRank, index] of [['possessed', 1], ['ascendant', 2]]) {
      assert.eq(Combat.ELITE_RANKS[eliteRank].dropIndex, index);
      for (const row of rows()) {
        const rng = () => { throw new Error('guaranteed rank must not draw RNG'); };
        const opts = { monsterKind: row.id, eliteRank };
        const reward = pickReward('treasure:elite', fresh(), rng, opts);
        assert.eq(JSON.stringify(reward), JSON.stringify(pick(row, index)), `${row.id}: ${eliteRank}`);
        const save = fresh();
        let amount;
        if (reward.kind === 'item') {
          if (ITEM_BY_ID[reward.id].kind !== 'unique_relic') continue;
          save.inv.push({ id: reward.id, count: 1 });
          amount = itemValue(reward.id);
        } else {
          save[reward.kind === 'armor' ? 'armor' : 'relics'][reward.slot] = { tier: reward.tier };
          amount = gearPrice(reward.kind, reward.slot, reward.tier);
        }
        const duplicate = pickReward('treasure:elite', save, rng, opts);
        assert.eq(duplicate.kind, 'gold', `${row.id}: ${eliteRank} duplicate`);
        assert.eq(duplicate.signatureIndex, index);
        assert.eq(duplicate.amount, Math.max(1, Math.floor(amount / 2)));
      }
    }
  });

  test('elite drops: monster tier plus one controls gear and item budget, independent of depth bonuses', () => {
    for (const row of rows()) {
      const target = Math.min(7, row.tier + 1);
      for (let index = 0; index < 3; index++) {
        const reward = pick(row, index);
        const boosted = pick(row, index, fresh(), { rollBonus: 100, depth: 100 });
        assert.eq(JSON.stringify(boosted), JSON.stringify(reward), row.id);
        if (reward.kind === 'item') {
          assert.eq(reward.tier, ITEM_BY_ID[reward.id].baseTier, row.id);
          const drop = Combat.monster(row.id).eliteDrops[index];
          const qty = ITEM_BY_ID[reward.id].kind === 'unique_relic' ? 1
            : ChestThemes.quantity(reward.id, target, 0) + (drop.qtyBonus || 0);
          assert.eq(reward.qty, qty, `${row.id}: ${reward.id}`);
        } else {
          const tiers = (reward.kind === 'relic' && RELIC_DEFS[reward.slot].tiers) || [1, 2, 3, 4, 5, 6, 7];
          const tier = tiers.filter(t => t <= target).pop() || tiers[0];
          assert.eq(reward.tier, tier, `${row.id}: ${reward.slot}`);
        }
      }
    }
  });

  test('elite drops: equal or better owned gear pays half the rolled value without walking up', () => {
    const seen = new Set();
    for (const row of rows()) for (let index = 0; index < 3; index++) {
      const reward = pick(row, index);
      if (reward.kind === 'item') continue;
      seen.add(reward.kind);
      const table = reward.kind === 'armor' ? 'armor' : 'relics';
      for (const owned of [reward.tier, 7]) {
        const save = fresh();
        save[table][reward.slot] = { tier: owned };
        const before = JSON.stringify(save);
        const duplicate = pick(row, index, save);
        assert.eq(duplicate.kind, 'gold', `${row.id}: owned ${owned}`);
        assert.eq(duplicate.tier, reward.tier, 'cash values the rolled tier, not the owned tier');
        assert.eq(duplicate.amount, Math.max(1, Math.floor(gearPrice(reward.kind, reward.slot, reward.tier) / 2)));
        assert.eq(duplicate.signatureIndex, index);
        assert.eq(JSON.stringify(save), before, 'selection never mutates equipment');
      }
      if (reward.tier > 1) {
        const save = fresh();
        save[table][reward.slot] = { tier: reward.tier - 1 };
        assert.eq(pick(row, index, save).kind, reward.kind, 'a genuine upgrade remains gear');
      }
    }
    assert.truthy(seen.has('armor') && seen.has('relic'), 'both equipment categories exercised');
  });

  test('elite drops: held unique relics become half-value cash without changing inventory or signatures', () => {
    let checked = 0;
    for (const row of rows()) for (let index = 0; index < 3; index++) {
      const reward = pick(row, index);
      if (reward.kind !== 'item' || ITEM_BY_ID[reward.id].kind !== 'unique_relic') continue;
      checked++;
      const save = fresh();
      save.inv.push({ id: reward.id, count: 1 });
      const before = JSON.stringify(save);
      const duplicate = pick(row, index, save);
      assert.eq(duplicate.kind, 'gold', `${row.id}: ${reward.id}`);
      assert.eq(duplicate.amount, Math.max(1, Math.floor(itemValue(reward.id) / 2)));
      assert.eq(duplicate.signatureIndex, index);
      assert.eq(duplicate.tier, reward.tier);
      assert.eq(JSON.stringify(save), before, 'selection never mutates carried inventory');
      save.inv[0].count = 0;
      assert.eq(pick(row, index, save).kind, 'item', 'only currently held copies trigger cash');
    }
    assert.gt(checked, 0);
  });

  test('elite drops: granting a delayed unique signature twice pays half value; ordinary uniques retain full value', () => {
    const row = rows().find(row => Combat.monster(row.id).eliteDrops.some(drop =>
      drop.kind === 'item' && ITEM_BY_ID[drop.id].kind === 'unique_relic'));
    assert.truthy(row);
    const index = Combat.monster(row.id).eliteDrops.findIndex(drop =>
      drop.kind === 'item' && ITEM_BY_ID[drop.id].kind === 'unique_relic');
    const reward = pick(row, index);
    const before = JSON.stringify(reward);
    const save = { ...fresh(), money: 0 };
    const scene = { addToInv: (id, qty) => Inventory.add(save, id, qty).accepted };
    assert.eq(Rewards.apply(save, reward, scene).accepted, 1);
    const reconciled = Rewards.reconcileUnique(save, reward);
    assert.eq(reconciled.kind, 'gold');
    assert.eq(reconciled.signatureIndex, index);
    const half = Math.max(1, Math.floor(itemValue(reward.id) / 2));
    assert.eq(reconciled.amount, half);
    const duplicate = Rewards.apply(save, reward, scene);
    assert.eq(duplicate.accepted, 0);
    assert.eq(duplicate.money, half);
    assert.eq(Inventory.count(save, reward.id), 1);
    const ordinary = Rewards.apply(save, { kind: 'item', id: reward.id, qty: 1 }, scene);
    assert.eq(ordinary.money, itemValue(reward.id));
    assert.eq(save.money, half + itemValue(reward.id));
    assert.eq(JSON.stringify(reward), before, 'reconciliation never mutates the pending reward');
  });

  test('elite drops: a renamed context retains its signature picker', () => {
    const key = 'test:renamed-signatures';
    LOOT_CONTEXTS[key] = { picker: 'elite' };
    try {
      for (const roll of rolls) {
        const opts = { monsterKind: 'cave_slime' };
        const renamed = pickReward(key, fresh(), () => roll, opts);
        const original = pickReward('treasure:elite', fresh(), () => roll, opts);
        assert.eq(JSON.stringify(renamed), JSON.stringify(original));
      }
    } finally { delete LOOT_CONTEXTS[key]; }
  });

  test('elite drops: callers without a monster retain the cave slime default', () => {
    for (const roll of rolls) {
      const legacy = pickReward('treasure:elite', fresh(), () => roll);
      const explicit = pickReward('treasure:elite', fresh(), () => roll, { monsterKind: 'cave_slime' });
      assert.eq(JSON.stringify(legacy), JSON.stringify(explicit));
    }
  });

  test('elite drops: the first memory and repeat kills both grant a signature', () => {
    const start = SCENE_SRC.indexOf('} else if (elite) {');
    const end = SCENE_SRC.indexOf('} else if (Combat.isMonster(victim.kind)', start);
    assert.gt(start, 0);
    assert.gt(end, start);
    const body = SCENE_SRC.slice(start + '} else if (elite) {'.length, end);
    const grant = new Function('Combat', 'grantTreasureRoll', 'victim', 'save', 'name', body);
    for (const first of [true, false]) for (const eliteRank of ['elite', 'possessed', 'ascendant']) {
      let memories = 0, drops = 0;
      const scene = { depth: 1, viewCenterX: 0, viewCenterY: 0,
        _bankDiscovery() { memories++; return first; }, flashShiny() {} };
      const victim = { kind: 'cave_slime', shiny: true, eliteRank };
      grant.call(scene, Combat, (s, save, x, y, icon, context, opts) => {
        drops++;
        assert.eq(context, 'treasure:elite');
        assert.eq(opts.monsterKind, victim.kind);
        assert.eq(opts.eliteRank, victim.eliteRank);
      }, victim, fresh(), 'Slime');
      assert.eq(memories, 1);
      assert.eq(drops, 1, first ? 'first kill pays loot alongside memory' : 'repeat kill pays loot');
    }
  });
})();
