// Density migration keeps canonical owner, species, state and save identity
// guarantees; it intentionally replaces the former per-block count/hash.
(function () {
  test('Nexus rules: explicit species rates are the sole active density owner', () => {
    for (const [variant, rule] of Object.entries(EnemyHabitats.NEXUS_RULES)) {
      assert.eq(rule.category, 'nexus');
      assert.eq(rule.allowed.kinds, EnemyHabitats.SURFACE_FAMILIES[variant]);
      assert.eq(JSON.stringify(rule.rows), JSON.stringify(HabitatSpawns.densityRows('Nexus:' + variant).filter(row => row.category === 'enemy')));
      for (const row of rule.rows) assert.gt(row.per1000, 0);
      assert.eq(rule.frequency, undefined, 'retired block frequency cannot allocate live encounters');
    }
  });
  test('Nexus engine: seeded cell encounters retain complete records and forbidden-area exclusions', () => {
    for (const variant of ['orchard', 'mushroom_grove', 'ordered_graves', 'mystic_reef']) {
      const N = 64, grid = Array.from({ length: N*N }, (_, i) => variant === 'mystic_reef'
        ? (i%N%4 === 0 ? WorldGen.T.WATER : WorldGen.T.SAND) : WorldGen.T.PARK);
      const make = () => ({ cellsPerEdge: N, tileEdgeM: N*7, grid,
        spawnWhy: Uint32Array.from(grid, (t, i) => (t === WorldGen.T.WATER ? WorldGen.SPAWN_WHY.TERRAIN : 0)
          | (variant === 'orchard' && i%N < 48 ? WorldGen.SPAWN_WHY.RESTRICTED : 0)),
        zone: { coverage: new Uint8Array(N*N).fill(1), anchors: [{ variant }] } });
      const occupied = new Set(), entry = make();
      const creatures = EnemyHabitats.surfaceEncounters(entry, 3, 5, occupied);
      assert.gt(creatures.length, 0, variant + ' has declared inhabitants');
      assert.eq(JSON.stringify(creatures), JSON.stringify(EnemyHabitats.surfaceEncounters(make(), 3, 5, new Set())), variant + ' complete deterministic records');
      assert.eq(occupied.size, creatures.length, variant + ' distinct claimed seats');
      for (const c of creatures) {
        const index = c._surfaceSpawn.cy * N + c._surfaceSpawn.cx;
        assert.truthy(WorldGen.isSpawnCell(grid, N, N, c._surfaceSpawn.cx, c._surfaceSpawn.cy,
          { spawnWhy: entry.spawnWhy }, creatureSpawnClass(c.kind)));
        assert.eq(c._spawnOwner, 'Nexus:' + variant);
        assert.eq(c.zoneVariant, variant);
        assert.truthy(grid[index] !== WorldGen.T.WATER);
      }
    }
  });
})();
