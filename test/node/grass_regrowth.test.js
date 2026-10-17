// Real-time, per-save grass recovery must not revive other picked objects.
test('grass regrowth: persisted exponential deadlines average two days', () => {
  const save = {}, now = 1000, count = 10000;
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const plant = { id: `grass-${i}`, crop: 'longgrass' };
    SaveState.rememberClearedGrass(save, plant, now, () => (i + 0.5) / count);
    sum += save.grassRegrowth[plant.id] - now;
  }
  assert.inRange(sum / count / SaveState.GRASS_REGROWTH_MEAN_MS, 0.999, 1.001);
  assert.eq(SaveState.GRASS_REGROWTH_MEAN_MS, 48 * 60 * 60 * 1000);
});

test('grass regrowth: reload retains the roll, expiry removes only grass memories', () => {
  const save = { picked: ['grass', 'crop', 'stack'], burnedObjects: ['grass', 'tree'] };
  const plant = { id: 'grass', crop: 'longgrass' };
  assert.truthy(SaveState.rememberClearedGrass(save, plant, 1000, () => 0.5));
  const deadline = save.grassRegrowth.grass;
  const restored = JSON.parse(JSON.stringify(save));
  assert.falsy(SaveState.rememberClearedGrass(restored, plant, deadline - 100, () => 0.99));
  assert.eq(restored.grassRegrowth.grass, deadline);
  assert.falsy(SaveState.regrowGrass(restored, deadline - 1));
  const before = restored.picked;
  assert.truthy(SaveState.regrowGrass(restored, deadline));
  assert.eq(JSON.stringify(restored.picked), JSON.stringify(['crop', 'stack']));
  assert.eq(JSON.stringify(restored.burnedObjects), JSON.stringify(['tree']));
  assert.truthy(restored.picked !== before, 'refreshes memoised membership');
  assert.eq(Object.keys(restored.grassRegrowth).length, 0);
  assert.falsy(SaveState.regrowGrass(restored, deadline + 100));
});

test('grass regrowth: revisited old grass qualifies, other flora and player planting do not', () => {
  const save = { picked: ['old-grass', 'shrub', 'herb'] };
  assert.truthy(SaveState.rememberClearedGrass(save, { id: 'old-grass', crop: 'longgrass' }, 1000, () => 0.5));
  for (const crop of ['shrub', 'berry', 'poisonberry', 'potato', 'barricade', 'mushroom', 'rubble']) {
    assert.falsy(SaveState.rememberClearedGrass(save, { id: crop, crop }, 1000));
    assert.falsy(SaveState.regrows(crop));
  }
  assert.falsy(SaveState.rememberClearedGrass(save, { id: 'owned', crop: 'longgrass', playerOwned: true }, 1000));
});

test('herb regrowth: the wild flowers, PetNip and the nettle grow back through the one grass table', () => {
  // One mechanism (WILD_REGROWTH): the same exponential wait, the same save
  // field, the same expiry sweep — a crop grows back by having a row.
  const herbs = ['flowers', 'forgetmenot', 'marigold', 'wildrose', 'starflower', 'petnip', 'nettle'];
  for (const crop of ['longgrass', ...herbs]) {
    assert.truthy(SaveState.regrows(crop), crop + ' regrows');
    assert.eq(SaveState.WILD_REGROWTH[crop], SaveState.GRASS_REGROWTH_MEAN_MS, crop + ' shares the grass mean');
  }
  const save = { picked: herbs.map(c => 'wp-' + c) };
  for (const crop of herbs) assert.truthy(SaveState.rememberClearedGrass(save, { id: 'wp-' + crop, crop }, 1000, () => 0.5));
  const deadline = save.grassRegrowth['wp-petnip'];
  assert.falsy(SaveState.rememberClearedGrass(save, { id: 'wp-petnip', crop: 'petnip' }, 1500, () => 0.9), 'no reroll');
  assert.falsy(SaveState.regrowGrass(save, deadline - 1));
  assert.truthy(SaveState.regrowGrass(save, deadline + 1));
  assert.eq(save.picked.length, 0, 'every herb is back once its wait has passed');
  assert.falsy(SaveState.rememberClearedGrass(save, { id: 'owned-herb', crop: 'petnip', playerOwned: true }, 1000), 'a planted herb keeps its rules');
});

test('grass regrowth: offline boot expires grass and prunes orphan deadlines', () => {
  const save = { picked: ['grass', 'shrub'], grassRegrowth: { grass: 1, orphan: 9999999999999, bad: 'bad' } };
  assert.truthy(SaveState.normalize(save));
  assert.eq(JSON.stringify(save.picked), JSON.stringify(['shrub']));
  assert.eq(Object.keys(save.grassRegrowth).length, 0);
  // Cutting the same generated tuft again starts a new independent wait.
  assert.truthy(SaveState.rememberClearedGrass(save, { id: 'grass', crop: 'longgrass' }, 2000, () => 0.5));
  assert.gt(save.grassRegrowth.grass, 2000);
});

test('grass regrowth: runtime heartbeat and harvest use the shared save mechanism', () => {
  assert.truthy(SCENE_SRC.includes('if (SaveSession.touch()) this._tickGrassRegrowth();'));
  assert.truthy(SCENE_SRC.includes('SaveState.regrowGrass(this.save, now)'));
});
