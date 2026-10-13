test('sandbox lab: distinct enemy behaviour and elite fixtures are reachable', () => {
  const { entry } = Sandbox.buildForTest({ cellsPerEdge: 128 });
  const enemies = entry.creatures.filter(c => c.id.includes('_COMBAT_'));
  for (const kind of ['bat', 'goblin_trapper', 'fiend', 'thief', 'metal_slime',
    'gelatinous_cube', 'split_slime', 'red_dragon', 'bomb_goblin']) {
    assert.truthy(enemies.some(c => c.kind === kind), kind);
  }
  for (const rank of ['elite', 'possessed', 'ascendant']) {
    assert.truthy(enemies.some(c => c.shiny && c.eliteRank === rank), rank);
    assert.eq(SandboxDestinations.find(`combat-${rank}`).scene, 'COMBAT');
  }
});

test('sandbox lab: services are separated from foes and forts have both lock states', () => {
  const { entry } = Sandbox.buildForTest({ cellsPerEdge: 128 });
  const services = entry.objects.filter(o => o.id.includes('_SERVICES_'));
  assert.eq(services.filter(o => o.kind === 'chest').length, 10);
  assert.falsy(entry.creatures.some(c => c.id.includes('_SERVICES_')));
  const save = {};
  Sandbox.seedHouseState(save, entry);
  const forts = entry.objects.filter(o => o.kind === 'house' && o.tier === 11);
  assert.eq(forts.length, 2);
  assert.eq(forts.filter(o => Houses.isFortLocked(save, o)).length, 1);
  assert.truthy(entry.objects.some(o => o._sandboxBuild === 'shop:potion:3'));
  for (const o of forts) save.unlockedForts[o.id] = true;
  Sandbox.seedHouseState(save, entry);
  assert.eq(forts.filter(o => Houses.isFortLocked(save, o)).length, 1, 'reload restores the lock comparison');
});

test('sandbox lab: reloading restores spent fixtures while preserving outside progress', () => {
  const entry = { objects: [{ id: 'rock' }], creatures: [{ id: 'foe' }], wildplants: [{ id: 'plant' }] };
  const save = { picked: ['plant', 'outside'], caught: ['foe', 'outside'],
    brokenRocks: ['rock', 'sandbox-L1-rock', 'outside'], lastProduce: { rock: 1, outside: 2 } };
  const scene = { save, brokenRockSet: bindIdSet(save, 'brokenRocks') };
  Sandbox.resetFixtureProgress(scene, entry);
  assert.falsy(scene.brokenRockSet.has('rock'), 'runtime mining membership resets too');
  assert.falsy(scene.brokenRockSet.has('sandbox-L1-rock'));
  assert.truthy(scene.brokenRockSet.has('outside'));
  scene.brokenRockSet.add('new-rock');
  assert.truthy(save.brokenRocks.includes('new-rock'), 'binding still writes subsequent mining');
  scene.brokenRockSet.delete('new-rock');
  for (const key of ['picked', 'caught', 'brokenRocks']) assert.eq(save[key].join(), 'outside');
  assert.eq(save.lastProduce.outside, 2);
  assert.falsy(save.lastProduce.rock);
});
