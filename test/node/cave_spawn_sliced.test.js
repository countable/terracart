(() => {
  const fixture = () => ({ cellsPerEdge: 64, tileEdgeM: 448,
    grid: new Uint8Array(4096).fill(WorldGen.T.CAVE_FLOOR), objects: [] });
  const scene = () => ({ tileEdgeM: 448, save: { caught: [] } });
  const steps = (entry, self = scene()) => SceneCreatures.prototype.spawnCaveCreaturesSteps.call(self, entry, 0, 0, 2);
  test('cave sliced spawning: yields before publishing and matches synchronous population', () => {
    const sync = fixture(), sliced = fixture();
    SceneCreatures.prototype.spawnCaveCreatures.call(scene(), sync, 0, 0, 2);
    const iterator = steps(sliced), phases = [];
    for (let next = iterator.next(); !next.done; next = iterator.next()) {
      phases.push(next.value);
      assert.falsy(sliced._spawned);
      for (const field of ['creatures', 'traps', 'coinDrops', 'cavePopulation']) assert.eq(sliced[field], undefined, field + ' is staged');
    }
    assert.gt(phases.length, 20, 'full floor work is split into bounded pieces');
    assert.truthy(phases.includes('cave population ready'));
    for (const field of ['creatures', 'traps', 'coinDrops', 'cavePopulation']) assert.eq(JSON.stringify(sliced[field]), JSON.stringify(sync[field]), field);
    assert.truthy(sliced._spawned);
  });
  test('cave sliced spawning: cancellation before commit preserves previous fields and restores options', () => {
    const entry = fixture(), oldOpts = { marker: true };
    const previous = { creatures: [{ id: 'carried' }], traps: [{ id: 'old-trap' }], coinDrops: [{ id: 'old-coin' }], cavePopulation: { old: true } };
    Object.assign(entry, previous, { _spawnOpts: oldOpts });
    const iterator = steps(entry);
    let ready = false;
    for (let next = iterator.next(); !next.done; next = iterator.next()) {
      for (const field of Object.keys(previous)) assert.eq(entry[field], previous[field]);
      if (next.value === 'cave population ready') { ready = true; iterator.return(); break; }
    }
    assert.truthy(ready);
    assert.eq(entry._spawnOpts, oldOpts);
    assert.falsy(entry._spawned);
    for (const field of Object.keys(previous)) assert.eq(entry[field], previous[field]);
  });
  test('cave sliced spawning: legacy replay never assigns a defeat alias to two current bodies', () => {
    const entry = fixture(), self = scene();
    self.save.caught = ['enemy_cave_2_0_0_pack_999'];
    WorldGen.runSteps(steps(entry, self));
    const aliases = entry.creatures.flatMap(c => c._legacyDefeatIds || []);
    assert.gt(aliases.length, 0);
    assert.eq(new Set(aliases).size, aliases.length);
  });
})();
