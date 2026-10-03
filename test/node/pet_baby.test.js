// Headless tests for BABY PETS and the NEST BUSH.
//
// One shrub in twenty (SHINY_RATE.nest, off the bush's id) is a nest bush: it
// wiggles every 10-30 s (items.js nestBushPhase, drawn by render.js) and,
// chopped, hands over one random baby pet (items.js BABY_KINDS). A carried egg
// hatches a baby too. Released, a baby is a tame pet born that moment — half
// size for seven days and seven favourite meals (SpriteLayout.isBabyPet), then a shiny adult with double
// HP and bite (combat.js raisedMul). Pinned here: the table and its items, the
// nest predicate and beat, the harvest, the release row, the size, the power,
// the reload and the renderer's use of the same predicate.

const DAY_MS = 24 * 60 * 60 * 1000;
const bushIds = (n) => Array.from({ length: n }, (_, i) => `wp_12_34_${i % 64}_${Math.floor(i / 64)}`);
const firstNestBush = (nest) => bushIds(4000).find(id => isNestBush('shrub', id) === nest && (!nest || nestBushContents(id).type === 'baby'));

test('baby pets: one table of domestic kinds, each a real animal item off its base', () => {
  assert.eq(BABY_KINDS.length, 5);
  for (const k of BABY_KINDS) {
    const base = ITEM_BY_ID[k], baby = ITEM_BY_ID[babyItemId(k)];
    assert.truthy(base && base.kind === 'animal', `${k} is an animal item`);
    assert.truthy(baby, `${k} has a baby item`);
    assert.eq(baby.kind, 'animal'); assert.eq(baby.base, k); assert.truthy(baby.baby);
    assert.eq(baby.baseTier, base.baseTier, 'a baby shares its kind\'s tier');
    assert.eq(baby.name, `Baby ${k.charAt(0).toUpperCase() + k.slice(1)}`);
    assert.eq(itemValue(babyItemId(k)), itemValue(k) * 3, 'a baby sells for three of its kind');
    assert.truthy(ITEM_EFFECTS[babyItemId(k)], 'a baby carries a story hint');
    assert.truthy(SpriteLayout.CREATURE_BEHAVIOUR[k], `${k} is a live creature kind`);
  }
  assert.eq(JSON.stringify(babyItems()), JSON.stringify(BABY_KINDS.map(babyItemId)));
  // Never chest loot: the class/tier pool skips babies like it skips shinies.
  for (const byT of Object.values(ITEMS_BY_CLASS_TIER)) for (const ids of Object.values(byT))
    for (const id of ids) assert.falsy(ITEM_BY_ID[id]?.baby, `${id} is not in a loot pool`);
});

test('nest bush: one shrub in twenty, off the id, only nesting crops', () => {
  assert.eq(SHINY_RATE.nest, 1 / 20);
  assert.truthy(wildplantNests('shrub')); assert.falsy(wildplantNests('mushroom')); assert.falsy(wildplantNests('rockfruit'));
  const all = bushIds(20000);
  const n = all.filter(id => isNestBush('shrub', id)).length;
  assert.inRange(n / all.length, 0.045, 0.055, `rate ${n / all.length}`);
  for (const id of all.slice(0, 300)) {
    assert.eq(isNestBush('shrub', id), isShiny(id, SHINY_RATE.nest));
    assert.falsy(isNestBush('mushroom', id), 'a mushroom never nests');
    // Every shiny bush is a nest bush (one hash, a wider gate).
    if (isShiny(id, SHINY_RATE.flora)) assert.truthy(isNestBush('shrub', id));
  }
  assert.falsy(isNestBush('shrub', null)); assert.falsy(isNestBush('shrub', undefined));
});

test('nest bush: wiggles once every 10-30 s on its own beat, off the shared beat helper', () => {
  assert.eq(NEST_BUSH_BEAT.minMs, 10000); assert.eq(NEST_BUSH_BEAT.maxMs, 30000);
  assert.inRange(NEST_BUSH_BEAT.showMs, 300, 1500);
  const periods = new Set();
  for (const id of bushIds(200)) {
    const period = beatPeriodMs(id, NEST_BUSH_BEAT);
    assert.inRange(period, NEST_BUSH_BEAT.minMs, NEST_BUSH_BEAT.maxMs);
    periods.add(Math.round(period / 1000));
    let on = 0;
    for (let t = 0; t < period; t += 10) if (nestBushPhase(id, 1_700_000_000_000 + t) >= 0) on++;
    assert.inRange(on * 10, NEST_BUSH_BEAT.showMs - 20, NEST_BUSH_BEAT.showMs + 20, `${id} shows ${on * 10} ms`);
  }
  assert.gt(periods.size, 15, 'bushes beat at different periods');
  // The rock's glint rides the same helper, unchanged in its numbers.
  assert.eq(glintRockPhase('r1', 5000), beatPhase('r1', 5000, { salt: 'glint', minMs: 10000, maxMs: 60000, showMs: 700 }));
});

test('nest bush: the renderer wiggles off the harvest predicate and resets every plant', () => {
  assert.includes(RENDER_SRC, 'isNestBush(p.crop, p.wildId)');
  assert.includes(RENDER_SRC, 'nestBushPhase(p.wildId, _plantNow, scene._orbReveal?.get(p.wildId))');
  assert.includes(RENDER_SRC, 's.setAngle(wig >= 0 ?');
  assert.includes(INTERACT_SRC, 'isNestBush(wp.crop, wp.id)');
});

// Drive the wildplant tap handler on a shrub the way interact_tap.test.js does.
function chopBush(id, scene, save) {
  const original = globalThis.WorldGen;
  const plant = { kind: 'wildplant', crop: 'shrub', id, x: 2.5, y: 2.5 };
  try {
    globalThis.WorldGen = { ...original, forEachItem: (layer, cb) => { if (layer === 'wildplants') cb(plant); } };
    return TAP_HANDLERS.find(h => h.name === 'wildplant').try({ scene, save, wm: { x: 2.5, y: 2.5 }, sx: 0, sy: 0 });
  } finally { globalThis.WorldGen = original; }
}
const bushScene = (save, over) => Object.assign(makeScene(), {
  save, cellM: 5, cellsPerTile: 32, mPerPx: 5 / (WorldGen.TILE_PX / 32), originPx: { x: 0, y: 0 },
  startWorldM: { x: 0, y: 0 }, playerM: { x: 2.5, y: 2.5 }, feetOffsetM: 0, depth: 0, tileEdgeM: 1000,
  playerToWorldCell: () => ({ tx: 0, ty: 0 }), buildInventoryDOM: () => {}, _toolActionStory: () => {},
}, over);

test('nest bush: chopping one pays the wood AND one baby, with the card; a plain bush pays wood alone', () => {
  const nest = firstNestBush(true), plain = firstNestBush(false);
  const babyIds = new Set(babyItems());
  const cards = [];
  for (let i = 0; i < 40; i++) {
    const save = { picked: [], energy: 100, relics: {}, inv: [] };
    const scene = bushScene(save, { showBabyFound: (id, how) => cards.push([id, how]) });
    assert.eq(chopBush(nest, scene, save), true);
    assert.eq(scene.invCount('wood'), 1);
    const babies = [...babyIds].reduce((n, id) => n + scene.invCount(id), 0);
    assert.eq(babies, 1, 'exactly one baby');
    assert.eq(save.picked.filter(x => x === nest).length, 1, 'the bush is picked once');
  }
  assert.eq(cards.length, 40); assert.truthy(cards.every(([id, how]) => babyIds.has(id) && how === 'bush'));
  assert.eq(new Set(cards.map(c => c[0])).size, 1, 'the same bush always shelters the same baby');
  const save = { picked: [], energy: 100, relics: {}, inv: [] };
  const scene = bushScene(save, { showBabyFound: () => { throw new Error('no card on a plain bush'); } });
  assert.eq(chopBush(plain, scene, save), true);
  assert.eq(scene.invCount('wood'), 1);
  for (const id of babyIds) assert.eq(scene.invCount(id), 0);
});

test('nest bush: nonbaby contents emerge once without awarding an inventory baby', () => {
  const original = globalThis.spawnNestBushCreature;
  try {
    for (const type of ['slime', 'fauna']) {
      const id = bushIds(4000).find(id => isNestBush('shrub', id) && nestBushContents(id).type === type);
      const save = { picked: [], energy: 100, relics: {}, inv: [] };
      let emerged = 0;
      globalThis.spawnNestBushCreature = (scene, bush, occupant) => {
        assert.eq(bush.id, id); assert.eq(occupant, type); emerged++;
      };
      const scene = bushScene(save, { showBabyFound() { throw new Error('nonbaby must not award a baby'); } });
      assert.eq(chopBush(id, scene, save), true);
      assert.eq(emerged, 1); assert.eq(scene.invCount('wood'), 1);
      for (const baby of babyItems()) assert.eq(scene.invCount(baby), 0);
      chopBush(id, scene, save);
      assert.eq(emerged, 1, 'picked ledger prevents another emergence');
    }
  } finally { globalThis.spawnNestBushCreature = original; }
});

test('nest bush: a full bag leaves the bush standing to chop again', () => {
  const nest = firstNestBush(true);
  const save = { picked: [], energy: 100, relics: {}, inv: [] };
  for (const id of babyItems()) Inventory.add(save, id, Inventory.stackCap(save));
  const flashes = [];
  const scene = bushScene(save, { flash: (m) => flashes.push(m), showBabyFound: () => { throw new Error('no card'); } });
  assert.eq(chopBush(nest, scene, save), true);
  assert.eq(scene.invCount('wood'), 0, 'no wood either — nothing was taken');
  assert.eq(save.picked.length, 0, 'unpicked');
  assert.truthy(flashes.some(m => /room/i.test(m)));
});

test('egg: hatches a baby, never an adult', () => {
  const save = { inv: [] };
  Inventory.add(save, 'egg', 1);
  save.eggHatchM = EggHatch.METERS;
  const r = EggHatch.hatch(save, () => 0.5);
  assert.truthy(r.ok); assert.truthy(ITEM_BY_ID[r.petId].baby, `${r.petId} is a baby`);
  assert.includes(SCENE_SRC, "this.showBabyFound(result.petId, 'egg')");
});

test('release: a baby is set down as a raised, shiny, newborn tame pet', () => {
  const entry = { creatures: [] };
  const original = globalThis.WorldGen;
  const save = { inv: [], selSlot: 0, released: [], caught: [] };
  Inventory.add(save, 'baby_dog', 1);
  const scene = bushScene(save);
  const before = Date.now();
  try {
    globalThis.WorldGen = { ...original, tileCache: new Map([[original.tileKey(0, 0), entry]]) };
    const ok = TAP_HANDLERS.find(h => h.name === 'release').try({ scene, save, sx: 0, sy: 0, cwmx: 12, cwmy: 18, cell: TERRAIN.GRASS ?? 0 });
    assert.eq(ok, true);
  } finally { globalThis.WorldGen = original; }
  assert.eq(save.released.length, 1);
  const row = save.released[0], c = entry.creatures[0];
  assert.eq(row.kind, 'dog'); assert.truthy(row.id.startsWith('released_dog_'), 'tame id');
  assert.truthy(row.shiny, 'a raised pet is always shiny'); assert.truthy(row.raised);
  assert.inRange(row.born, before, Date.now());
  assert.eq(row.favouriteFeeds, 0); assert.eq(c.favouriteFeeds, 0);
  assert.truthy(c && c.kind === 'dog' && c.shiny && c.raised && c.born === row.born, 'the live creature carries the same birth');
  assert.eq(Inventory.count(save, 'baby_dog'), 0);
  // A plain dog released the same way is neither raised nor shiny.
  const save2 = { inv: [], selSlot: 0, released: [], caught: [] };
  Inventory.add(save2, 'dog', 1);
  const entry2 = { creatures: [] };
  try {
    globalThis.WorldGen = { ...original, tileCache: new Map([[original.tileKey(0, 0), entry2]]) };
    TAP_HANDLERS.find(h => h.name === 'release').try({ scene: bushScene(save2), save: save2, sx: 0, sy: 0, cwmx: 12, cwmy: 18, cell: TERRAIN.GRASS ?? 0 });
  } finally { globalThis.WorldGen = original; }
  assert.falsy(save2.released[0].shiny); assert.falsy(save2.released[0].raised); assert.eq(save2.released[0].born, undefined);
});

test('baby pet: adulthood requires seven days AND seven favourite meals', () => {
  const born = 1_700_000_000_000;
  const c = { kind: 'cat', id: 'released_cat_1', shiny: true, raised: true, born, favouriteFeeds: 7 };
  assert.eq(SpriteLayout.PET_BABY.scale, 0.5); assert.eq(SpriteLayout.PET_BABY.growMs, 7 * DAY_MS);
  assert.truthy(SpriteLayout.isBabyPet(c, born));
  assert.truthy(SpriteLayout.isBabyPet(c, born + 7 * DAY_MS - 1));
  assert.falsy(SpriteLayout.isBabyPet(c, born + 7 * DAY_MS));
  for (const favouriteFeeds of [undefined, 0, 6]) {
    assert.truthy(SpriteLayout.isBabyPet({ ...c, favouriteFeeds }, born + 30 * DAY_MS), 'age alone never grows a baby');
  }
  assert.eq(SpriteLayout.PET_BABY.feeds, 7);
  assert.eq(SpriteLayout.creatureInstScale(c, born + DAY_MS), 0.5);
  assert.eq(SpriteLayout.creatureInstScale(c, born + 8 * DAY_MS), 1);
  assert.eq(SpriteLayout.creatureScale('cat', SpriteLayout.creatureInstScale(c, born)), SpriteLayout.creatureScale('cat') / 2, 'drawn at half its kind');
  // Not a baby: a plain tame cat, a shiny wild one, a raised one with no birth.
  assert.falsy(SpriteLayout.isBabyPet({ kind: 'cat', id: 'released_cat_2' }));
  assert.falsy(SpriteLayout.isBabyPet({ kind: 'cat', id: 'c', shiny: true }));
  assert.falsy(SpriteLayout.isBabyPet({ kind: 'cat', id: 'c', raised: true }));
  assert.eq(SpriteLayout.creatureInstScale({ kind: 'cat', id: 'c' }), 1);
  // A softened guard's own scale still multiplies through.
  assert.eq(SpriteLayout.creatureInstScale({ ...c, _artScale: 0.8 }, born), 0.4);
});

test('raised pet: shiny babies and grown adults double HP and bite without stacking', () => {
  const born = Date.now() - 8 * DAY_MS;
  const grown = { kind: 'dog', id: 'released_dog_g', shiny: true, raised: true, born, favouriteFeeds: 7 };
  const baby = { kind: 'dog', id: 'released_dog_b', shiny: true, raised: true, born: Date.now() };
  const plain = { kind: 'dog', id: 'released_dog_p' };
  assert.eq(Combat.RAISED_MUL, 2);
  assert.eq(Combat.raisedMul(grown), 2); assert.eq(Combat.raisedMul(baby), 1); assert.eq(Combat.raisedMul(plain), 1);
  assert.eq(Combat.powerMul(grown), 2, 'through powerMul, like an elite');
  assert.eq(Combat.maxHp(grown), Combat.FAUNA_HP.dog * 2);
  assert.eq(Combat.maxHp(baby), Combat.FAUNA_HP.dog * 2);
  assert.eq(Combat.petBlow(grown), Combat.PET_BITE * 2);
  assert.eq(Combat.petBlow(baby), Combat.PET_BITE * 2);
  assert.eq(Combat.petBlow(plain), Combat.petBite('dog'));
  assert.falsy(Combat.isElite(grown), 'a shiny raised dog is no elite — that is a monster\'s word');
  assert.includes(SCENE_CREATURES_SRC, 'Combat.damage(tgt, Combat.petBlow(c))');
});

test('reload: a released row\'s birth rides back onto the live creature', () => {
  assert.includes(SCENE_CREATURES_SRC, "...(r.raised ? { raised: true, born: r.born, favouriteFeeds: r.favouriteFeeds || 0 } : {})");
});


function feedBaby(pet, save, foodId, overrides = {}) {
  save.inv = foodId ? [{ id: foodId, count: 1 }] : [];
  save.selSlot = foodId ? 0 : -1;
  const scene = bushScene(save, { cellPx: 32, flashLoot: () => {}, ...overrides });
  const original = globalThis.WorldGen, originalReach = globalThis.cellInReach;
  try {
    globalThis.cellInReach = () => true;
    globalThis.WorldGen = { ...original, forEachItem: (layer, cb) => { if (layer === 'creatures') cb(pet); } };
    return TAP_HANDLERS.find(h => h.name === 'creature').try({ scene, save, wm: { x: pet.x, y: pet.y }, sx: 0, sy: 0 });
  } finally { globalThis.WorldGen = original; globalThis.cellInReach = originalReach; }
}

test('baby feeding: favourites count per pet, ordinary treats and petting do not', () => {
  const pet = { kind: 'dog', id: 'released_dog_feed', x: 2.5, y: 2.5, raised: true, born: Date.now() - 8 * DAY_MS, favouriteFeeds: 0 };
  const row = { ...pet };
  const other = { ...pet, id: 'released_dog_other' };
  const save = { caught: [], released: [row, other] };
  // (An empty hand no longer pets: it picks the pet up — pet_pickup.test.js.)
  for (const food of ['apple', 'milk']) {
    assert.eq(feedBaby(pet, save, food), true);
    assert.eq(pet.favouriteFeeds, 0);
    assert.falsy(save.caught.includes(pet.id), `${food} offers, never pockets`);
  }
  for (let n = 1; n <= 7; n++) {
    assert.eq(feedBaby(pet, save, 'meat'), true);
    assert.eq(Inventory.count(save, 'meat'), 0);
    assert.eq(pet.favouriteFeeds, n); assert.eq(row.favouriteFeeds, n);
    assert.eq(SpriteLayout.isBabyPet(pet), n < 7);
  }
  assert.eq(other.favouriteFeeds, 0);
  assert.eq(JSON.parse(JSON.stringify(save)).released[0].favouriteFeeds, 7);
  assert.eq(Combat.raisedMul(pet), 2, 'seventh meal unlocks adult power after a week');
});

test('baby feeding: producer favourites count only when consumed, not during cooldown', () => {
  for (const kind of ['cow', 'chicken']) {
    const pet = { kind, id: `released_${kind}_feed`, x: 2.5, y: 2.5, raised: true, born: Date.now(), favouriteFeeds: 0 };
    const save = { caught: [], released: [{ ...pet }] };
    const food = kind === 'cow' ? ANIMAL_FOOD.cow[0] : 'potato_seed';
    assert.truthy(animalLikesFood(kind, food));
    assert.eq(feedBaby(pet, save, food), true);
    assert.eq(pet.favouriteFeeds, 1);
    if (kind === 'cow') {
      assert.eq(feedBaby(pet, save, food), true);
      assert.eq(pet.favouriteFeeds, 1);
      assert.eq(Inventory.count(save, food), 1, 'cooldown refuses the meal');
      save.lastProduce[pet.id] = 0; pet._lastProduceT = 0;
      feedBaby(pet, save, 'apple');
      assert.eq(pet.favouriteFeeds, 1, 'non-favourite produce earns no growth');
    }
  }
});


test('baby discovery: nest and egg stories teach favourite meals and a week to adulthood', () => {
  const start = SCENE_SRC.indexOf('  showBabyFound(babyId, how) {');
  const end = SCENE_SRC.indexOf('  showChestRewardModal(', start);
  const show = new Function('return ({' + SCENE_SRC.slice(start, end) + '}).showBabyFound')();
  for (const how of ['bush', 'egg']) {
    let card;
    show.call({ showChestRewardModal: value => { card = value; } }, 'baby_dog', how);
    assert.includes(card.sub, 'favourite food');
    assert.includes(card.sub, `${SpriteLayout.PET_BABY.feeds} times`);
    assert.includes(card.sub, spokenDuration(SpriteLayout.PET_BABY.growMs));
    assert.includes(card.sub, 'adulthood');
  }
});

test('baby feeding: a cancelled confirmation or missing meal grants no progress', () => {
  const pet = { kind: 'dog', id: 'released_dog_cancel', x: 2.5, y: 2.5, raised: true, born: Date.now(), favouriteFeeds: 0 };
  const save = { caught: [], released: [{ ...pet }] };
  let confirm;
  const testMode = window.__TEST_MODE;
  try {
    window.__TEST_MODE = false;
    feedBaby(pet, save, 'meat', { showFeedConfirm: args => { confirm = args.onConfirm; } });
    assert.eq(typeof confirm, 'function');
    assert.eq(pet.favouriteFeeds, 0, 'opening or cancelling the panel feeds nothing');
    assert.eq(Inventory.count(save, 'meat'), 1);
    save.inv = []; save.selSlot = -1;
    confirm();
    assert.eq(pet.favouriteFeeds, 0, 'a stale confirmation cannot count an absent meal');
  } finally { window.__TEST_MODE = testMode; }
});
