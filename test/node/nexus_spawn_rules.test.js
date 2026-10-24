// Consolidating generation must preserve defeated identities, member kinds,
// owned seats, concealed states and clustered placement for existing seeds.
// Reef water births are removed by Excluded; the remaining dry-shore records
// retain a deterministic signature.
(function () {
  const expected = {
    orchard: [38,3262347237], mushroom_grove: [76,1987794954],
    ordered_graves: [38,1026512128], mystic_reef: [18,3495088911],
  };
  test('Nexus rules: use their existing family and frequency owners without duplicate tuning', () => {
    for (const [variant,rule] of Object.entries(EnemyHabitats.NEXUS_RULES)) {
      assert.eq(rule.category,'nexus');
      assert.eq(rule.allowed.kinds,EnemyHabitats.SURFACE_FAMILIES[variant]);
      assert.eq(rule.frequency,EnemyHabitats.SURFACE_ENCOUNTER_PROFILES[variant] || EnemyHabitats.SURFACE_ENCOUNTERS);
    }
  });
  test('Nexus engine: existing seeded encounters retain complete creature records across consolidation', () => {
    for (const [variant,[count,hash]] of Object.entries(expected)) {
      const N = 64, grid = Array.from({length:N*N},(_,i) => variant === 'mystic_reef'
        ? (i%N%4 === 0 ? WorldGen.T.WATER : WorldGen.T.SAND) : WorldGen.T.PARK);
      const entry = {cellsPerEdge:N,tileEdgeM:N*7,grid,
        spawnWhy:Uint32Array.from(grid,(t,i) => (t === WorldGen.T.WATER ? WorldGen.SPAWN_WHY.TERRAIN : 0)
          | (variant === 'orchard' && i%N < 48 ? WorldGen.SPAWN_WHY.RESTRICTED : 0)),
        zone:{coverage:new Uint8Array(N*N).fill(1),anchors:[{variant}]}};
      const occupied = new Set();
      const creatures = EnemyHabitats.surfaceEncounters(entry,3,5,occupied);
      assert.eq(creatures.length,count,variant);
      assert.eq(EnemySpawns.hash(JSON.stringify(creatures)),hash,variant + ' identity, kind, seat and state');
      assert.eq(occupied.size,count,variant + ' distinct claimed seats');
      for(const creature of creatures) {
        const x=Math.floor((creature.x-3*N*7)/7),y=Math.floor((creature.y-5*N*7)/7);
        assert.truthy(grid[y*N+x]!==WorldGen.T.WATER,variant+' never seats a birth in Excluded water');
      }
    }
  });
})();
