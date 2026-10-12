// Signature selection, monster-relative strength, and duplicate cash-outs.
(function () {
  const fresh = () => ({ relics: {}, armor: {} });
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
        if (drop.kind === 'item') assert.truthy(ITEM_BY_ID[drop.id], `${row.id}: ${drop.id}`);
        else {
          assert.truthy(['relic', 'armor'].includes(drop.kind), row.id);
          assert.truthy((drop.kind === 'relic' ? RELIC_DEFS : ARMOR_DEFS)[drop.slot], `${row.id}: ${drop.slot}`);
        }
      }
    }
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

  test('elite drops: monster tier plus one controls gear and item budget, independent of depth bonuses', () => {
    for (const row of rows()) {
      const target = Math.min(7, row.tier + 1);
      for (let index = 0; index < 3; index++) {
        const reward = pick(row, index);
        const boosted = pick(row, index, fresh(), { rollBonus: 100, depth: 100 });
        assert.eq(JSON.stringify(boosted), JSON.stringify(reward), row.id);
        if (reward.kind === 'item') {
          assert.eq(reward.tier, ITEM_BY_ID[reward.id].baseTier, row.id);
          assert.eq(reward.qty, ChestThemes.quantity(reward.id, target, 0), row.id);
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
    for (const first of [true, false]) {
      let memories = 0, drops = 0;
      const scene = { depth: 1, viewCenterX: 0, viewCenterY: 0,
        _bankDiscovery() { memories++; return first; }, flashShiny() {} };
      const victim = { kind: 'cave_slime', shiny: true, eliteRank: 'elite' };
      grant.call(scene, Combat, (s, save, x, y, icon, context, opts) => {
        drops++;
        assert.eq(context, 'treasure:elite');
        assert.eq(opts.monsterKind, victim.kind);
      }, victim, fresh(), 'Slime');
      assert.eq(memories, 1);
      assert.eq(drops, 1, first ? 'first kill pays loot alongside memory' : 'repeat kill pays loot');
    }
  });
})();
