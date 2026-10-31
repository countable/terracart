// A night's rest (src/rest.js): the one routine behind the Quilted Cot and
// the Inn — full energy, four hours of the world's clocks, then no bed for
// four hours. The workshop builds the cot from seven wood.

const H = 60 * 60 * 1000;

test('rest: the cot is a T1 workshop recipe of seven wood, offered without finding one first', () => {
  const r = HOME_RECIPES.find(x => x.id === 'bed_quilted');
  assert.truthy(r, 'the cot is a recipe');
  assert.eq(r.station, 'workshop');
  assert.eq(JSON.stringify(r.cost), JSON.stringify([{ id: 'wood', qty: 7 }]), 'seven wood');
  assert.eq(ITEM_BY_ID.bed_quilted.kind, 'furniture');
  assert.eq(itemTierOf('bed_quilted'), 1, 'T1');
  assert.falsy(homeRecipeLocked({}, 'bed_quilted'), 'nothing in the field drops a cot: the recipe is known');
  assert.falsy(homeRecipeLocked({}, 'throwing_spear'), 'the spear rides the same `known` flag');
  assert.truthy(homeRecipeLocked({}, 'scarecrow'), 'other recipes still wait on a find');
  assert.falsy(homeRecipeLocked({ foundWild: { scarecrow: 1 } }, 'scarecrow'));
});

test('rest: four hours pass on crops, planted trees, picked fruit, grass and the bite gate — nothing else', () => {
  const t0 = Date.UTC(2026, 9, 30, 12, 0, 0);
  const hold = Crops.stageHoldMs('berry');
  const save = {
    energy: 30, money: 5,
    planted: [
      { x: 0, y: 0, crop: 'berry', stage: 1, watered_t: t0 - 1000 },          // hold runs during the night
      { x: 1, y: 0, crop: 'berry', stage: 1, watered_t: 0 },                  // unwatered: left alone
      { x: 2, y: 0, crop: 'berry', stage: MAX_GROWTH_STAGE, watered_t: t0 },  // ripe: left alone
    ],
    fruittrees: [{ id: 'pft_1', x: 3, y: 0, species: 'apple', planted_t: t0 - 1000 }],
    fruitPicked: { wild_tree: t0 - 1000 },
    grassRegrowth: { tuft: t0 + 10 * H },
    eatReadyAt: t0 + 5000, tomeReadyAt: t0 + 10 * H,
    boonUntil: t0 + 2 * H,
  };
  const moved = [];
  assert.eq(Rest.PASS_MS, 4 * H); assert.eq(Rest.COOLDOWN_MS, 4 * H); assert.eq(Rest.HOURS, 4);
  assert.eq(Rest.sleep(save, 100, t0, moved), 70, 'the gain');
  assert.eq(save.energy, 100, 'to full');
  assert.eq(save.money, 5, 'the routine itself costs nothing (the inn charges before it)');
  assert.eq(save.planted[0].stage, 2, 'the berry\'s hold elapsed: one stage, as the tick would give');
  assert.eq(save.planted[0].watered_t, 0, 'and it wants watering again');
  assert.eq(save.planted[1].stage, 1); assert.eq(save.planted[1].watered_t, 0, 'unwatered stays unwatered');
  assert.eq(save.planted[2].stage, MAX_GROWTH_STAGE, 'ripe stays ripe');
  assert.eq(save.fruittrees[0].planted_t, t0 - 1000 - 4 * H, 'a planted tree is four hours older');
  assert.eq(save.fruitPicked.wild_tree, t0 - 1000 - 4 * H, 'a pick is four hours older');
  assert.eq(save.grassRegrowth.tuft, t0 + 6 * H, 'grass is four hours nearer regrowth');
  assert.eq(save.eatReadyAt, t0, 'the bite gate is open on waking');
  assert.eq(save.tomeReadyAt, t0 + 6 * H, 'the tome gate moved four hours');
  assert.eq(save.boonUntil, t0 + 2 * H, 'a buff keeps its own clock');
  assert.eq(moved.map(p => p.x).join(), '0,3', 'the grown crop and the tree are reported for the scene');
  assert.eq(save.restedAt, t0, 'the gate is armed');
  assert.eq(Rest.waitMs(save, t0), 4 * H);
  assert.eq(Rest.waitMs(save, t0 + 4 * H - 1), 1);
  assert.eq(Rest.waitMs(save, t0 + 4 * H), 0, 'open again four hours on');
  assert.eq(Rest.waitMs(save, t0 - 10 * H), 4 * H, 'a wound-back clock waits one cooldown, not days');
  assert.eq(Rest.waitMs({}, t0), 0, 'never slept: open');
  // The slow crop whose hold outlasts the night only moves closer.
  const slow = { planted: [{ x: 0, y: 0, crop: 'berry', stage: 0, watered_t: t0 }] };
  Rest.passTime(slow, hold / 2, t0);
  assert.eq(slow.planted[0].stage, 0); assert.eq(slow.planted[0].watered_t, t0 - hold / 2);
  Rest.passTime(slow, hold / 2, t0);
  assert.eq(slow.planted[0].stage, 1, 'two half-holds of rest add up');
});

test('rest: the Potion of Time clears the bed gate like the other action gates', () => {
  const scene = { save: { restedAt: Date.now(), energy: 10 } };
  PlayerTime.reset(scene);
  assert.falsy('restedAt' in scene.save);
  assert.eq(Rest.waitMs(scene.save), 0);
});

test('rest: the cot and the inn refuse each other inside four hours, and the scene re-seats what grew', () => {
  const t0 = Date.now();
  const inn = { id: 'inn-1' };
  const save = { energy: 30, money: 1000, fruittrees: [{ id: 'pft_9', x: 5, y: 5, species: 'apple', planted_t: t0 }] };
  // The inn first.
  const moved = [];
  assert.truthy(Macros.innRest(save, inn, 100, t0, moved).ok);
  // Then the cot, through the scene (sleep_presentation.test.js owns the
  // placed-record checks; here the gate alone must refuse).
  const flashes = [];
  const scene = Object.assign(Object.create(SceneFurniture.prototype), {
    save, getMaxEnergy: () => 100, _zeroEnergyLocked: () => false,
    flashAtPlayer(t) { flashes.push(t); },
    _furnitureAbilityAllowed: () => true,
    _presentSleep() { throw new Error('a gated cot must not start the fade'); },
  });
  save.energy = 10;
  assert.falsy(scene._bedSleepAllowed({ id: 'bed' }), 'the cot refuses within the inn\'s four hours');
  assert.truthy(/Rested\. Back in \d+[smh]\./.test(flashes[0]), flashes[0]);
  save.restedAt = t0 - Rest.COOLDOWN_MS;
  assert.truthy(scene._bedSleepAllowed({ id: 'bed' }), 'and takes the player once it has run');
  // The scene's half: the live tree copies the aged planted_t and the pop lands.
  const key = WorldGen.tileKey(0, 0), previous = WorldGen.tileCache.get(key);
  const live = { id: 'pft_9', kind: 'fruittree', planted: true, planted_t: t0, x: 5, y: 5 };
  WorldGen.tileCache.set(key, { objects: [live] });
  try {
    const pops = [], bursts = [];
    scene._popEnergy = n => pops.push(n);
    scene._burstAtWorld = (kind, x, y) => bursts.push(`${kind}@${x},${y}`);
    scene._afterRest(70, moved);
    assert.eq(pops.join(), '70');
    assert.eq(live.planted_t, t0 - Rest.PASS_MS, 'the live tree is four hours older too');
    assert.eq(bursts.join(), 'sprout@5,5');
  } finally {
    if (previous) WorldGen.tileCache.set(key, previous); else WorldGen.tileCache.delete(key);
  }
});
