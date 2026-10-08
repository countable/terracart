(() => {
  test('focus guards: shared member expansion preserves every authored composition and RNG draw', () => {
    for (const [name, group] of Object.entries(Lairs.GROUPS)) for (const tier of group.tiers) {
      for (const seed of [1, 17, 98123]) {
        const expectedRng = WorldGen.makeRng(seed), actualRng = WorldGen.makeRng(seed), expected = [];
        for (const member of group.members) {
          const n = member.nRange ? member.nRange[0] + Math.floor(expectedRng() * (member.nRange[1] - member.nRange[0] + 1))
            : member.n && typeof member.n === 'object' ? member.n[tier] || 0 : member.n || 0;
          for (let idx = 0; idx < n; idx++) expected.push({ ...member, n, group: name, idx, of: n });
        }
        assert.eq(JSON.stringify(Lairs.expandGroup(name, tier, actualRng)), JSON.stringify(expected), `${name}: unchanged formation specs`);
        assert.eq(actualRng(), expectedRng(), `${name}: unchanged next world draw`);
      }
    }
  });

  test('focus guards: rules retain the existing group references and source lifecycle', () => {
    for (const tier of Object.keys(Lairs.TIER_GUARDS)) {
      const rule = Lairs.FOCUS_RULES[tier];
      assert.eq(rule.scope, 'focus');
      assert.eq(rule.frequency.chance, Lairs.OCCUPANCY[tier]?.rate || 0);
      assert.eq(rule.frequency.baseCount, Lairs.TIER_GUARDS[tier]);
      assert.eq(rule.lifecycle.daily, Lairs.DAILY_TIERS.has(tier));
      for (const [name, group] of Object.entries(rule.groups)) {
        assert.eq(group, Lairs.GROUPS[name], 'one authored group definition');
        assert.truthy(group.tiers.some(t => String(t) === tier));
      }
    }
    assert.eq(Lairs.FOCUS_RULES[9].groups.grunt_gang, Lairs.GROUPS.grunt_gang);
    assert.eq(Lairs.FOCUS_RULES[9].groups.grunt_gang.modeCap, false);
  });

  test('focus guards: Nexus finite garrisons pass through the common generator with stable ordinal IDs', () => {
    const N = 64, unit = 4096 / N, original = CreatureSpawns.generateSteps, observed = [];
    CreatureSpawns.generateSteps = function* (rule, context) {
      observed.push({ rule, count: context.count });
      return yield* original(rule, context);
    };
    try {
      const variants = ZoneVariants.forKind('grove').filter(v => v.guards?.count > 0
        && ['guard_poi', 'guard_find'].includes(v.guards.mode));
      assert.gt(variants.length, 0);
      for (const variant of variants) {
        const point = 32.5 * unit;
        const a = { kind: 'grove', variant: variant.id, gx: point, gy: point, lx: point, ly: point,
          owned: true, key: 123, upm: N * WorldGen.CELL_M / 4096, R: 140, rotation: 0 };
        const ctx = { N, tx: 0, ty: 0, tileEdgeM: N * WorldGen.CELL_M,
          grid: new Uint8Array(N * N).fill(WorldGen.T.GROVE), chests: [],
          field: { anchors: [a], coverage: new Uint16Array(N * N).fill(1) },
          spawnOpts: { occupied: new Set(), spawnWhy: new Uint16Array(N * N) } };
        const out = ZoneDressing.dress(ctx), finite = out.guards.filter(g => g.id.startsWith('zg_'));
        assert.eq(observed[observed.length - 1].count, variant.guards.count);
        assert.eq(observed[observed.length - 1].rule.groups[variant.id], variant.guards);
        assert.eq(finite.length, variant.guards.count, 'open feature seats its full authored group');
        finite.forEach((guard, i) => {
          assert.eq(guard.id, `zg_grove_${point}_${point}_${i}`);
          assert.eq(guard.zoneVariant, variant.id);
          assert.truthy(CreatureSpawns.isSpawnCell(ctx.grid, N, N, guard._ix, guard._iy,
            { spawnWhy: ctx.spawnOpts.spawnWhy }, guard.kind), 'member uses its own common creature class');
        });
      }
    } finally { CreatureSpawns.generateSteps = original; }
  });
})();
