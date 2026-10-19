// THE GOLDEN BERRY — a rare gold-berried bush (GOLDEN_BUSH_SHARE: one in
// fifty of a Berry Lane's bushes, one in a hundred and fifty of every other
// bush the world seats). Its berry, offered to a foe, lands the `charm`
// status (Combat.applyCharm — the thrown Potion of Taming's) for a minute
// less the foe's tier squared in seconds; a wild animal takes the calm of
// the same length. A charmed body does not flee the net (Combat.isCalm).
(function () {
const ID = 'goldenberry';
const handler = () => TAP_HANDLERS.find(h => h.name === 'creature');
function tapCreature(c, save, heldId) {
  save.inv = save.inv || [];
  Inventory.add(save, heldId, 1); save.selSlot = save.inv.findIndex(s => s && s.id === heldId);
  const rec = { catches: [], flashes: [] };
  const scene = Object.assign(makeScene(), {
    save, cellM: 5, cellPx: 32, cellsPerTile: 32, mPerPx: 5 / (WorldGen.TILE_PX / 32), originPx: { x: 0, y: 0 },
    startWorldM: { x: 0, y: 0 }, playerM: { x: 2.5, y: 2.5 }, feetOffsetM: 0, depth: 0, tileEdgeM: 1000,
    _starterTrailAnchor: () => ({ x: 10000, y: 10000 }),
    playerToWorldCell: () => ({ tx: 0, ty: 0 }), buildInventoryDOM: () => {}, _toolActionStory: () => {},
    spendEnergy: () => true, flash: (text) => rec.flashes.push(text),
    startCatchProgress: (victim, ms, done) => rec.catches.push({ victim, ms, done }),
    startWorkProgress: () => {}, catchCreature: () => {}, resolveDefeat: () => {}, presentPetMenu: () => {},
  });
  const original = globalThis.WorldGen, originalReach = globalThis.cellInReach;
  try {
    globalThis.cellInReach = () => true;
    globalThis.WorldGen = { ...original, forEachItem: (layer, cb) => { if (layer === 'creatures') cb(c); } };
    rec.result = handler().try({ scene, save, wm: { x: c.x, y: c.y }, sx: 0, sy: 0 });
    return rec;
  } finally { globalThis.WorldGen = original; globalThis.cellInReach = originalReach; }
}
const newSave = () => ({ inv: [], caught: [], released: [], selSlot: -1, relics: {} });
const foe = (kind, extra = {}) => ({ id: `wild_${kind}`, kind, x: 2.5, y: 2.5, _disguiseRevealed: true, ...extra });

test('golden berry: a rare produce item on the shared bush frame, gold berries and a gold icon', () => {
  const it = ITEM_BY_ID[ID];
  assert.truthy(it, 'registered'); assert.eq(it.kind, 'produce'); assert.eq(it.crop, ID);
  assert.gt(BASE_TIER[ID], BASE_TIER.poisonberry, 'rarer than the poisonberry');
  assert.gt(PRICES[ID], PRICES.poisonberry);
  assert.truthy(ID in FOOD_ENERGY, 'the Eat button offers it');
  assert.eq(CONSUMABLE_SPEC[ID].condition, undefined, 'eaten, no condition of its own');
  assert.eq(CROP_SPRITE[ID].sheet, 'bushes'); assert.eq(CROP_SPRITE[ID].texture, 'bushes_goldenberry');
  assert.eq(wildplantSprite({ crop: ID, kind: 'wildplant' }).texture, 'bushes_goldenberry');
  assert.truthy(/bushes_goldenberry/.test(TEXTURES_SRC), 'baked with the other berry bushes (BERRY_BUSH_INKS)');
  assert.eq(inventoryIconSource(ID).sheet, SelectedItemArt.icons[ID].sheet);
  assert.eq(inventoryIconSource(ID).frame, SelectedItemArt.icons[ID].frame);
  assert.falsy(inventoryIconSource(ID).filter, 'approved golden berry keeps its authored colours');
  assert.truthy(ObstacleStep.profile({ kind: 'wildplant', crop: ID }) === ObstacleStep.PROFILES.bush, 'a bush underfoot');
  assert.eq(WILDPLANT_RULES[ID].pickedCrop, 'shrub', 'picked, the bush stays');
});

test('golden berry: one ambient bush in a hundred and fifty is golden — never an authored piece', () => {
  assert.eq(GOLDEN_BUSH_SHARE.wild, 1 / 150);
  let gold = 0;
  const N = 30000;
  for (let i = 0; i < N; i++) {
    const crop = ['shrub', 'berry', 'poisonberry'][i % 3];
    if (WorldGen.ambientBush(crop, `wp_${i}_bush`) === ID) gold++;
    assert.eq(WorldGen.ambientBush('longgrass', `wp_${i}_grass`), 'longgrass', 'only bushes');
  }
  assert.inRange(gold / N, (1 / 150) * 0.7, (1 / 150) * 1.3);
  // The ambient sites roll it; makeWildplant itself (every authored piece's) does not.
  assert.eq(WorldGen.makeWildplant('shrub', 0, 0, 'x').crop, 'shrub');
  assert.gte((WORLDGEN_SRC.match(/makeWildplant\(ambientBush\(/g) || []).length, 4, 'the scatter, the yards, the park pads, the tree rows');
  assert.truthy(/crop = goldenBushCrop\(crop, id\)/.test(STREET_VARIANTS_SRC), 'and the plain verges');
  // The lane's larger roll shares the salt: every wild-golden id is lane-golden too.
  for (let i = 0; i < 3000; i++) {
    const id = `wp_${i}_bush`;
    if (goldenBushCrop('shrub', id) === ID) assert.eq(goldenBushCrop('shrub', id, GOLDEN_BUSH_SHARE.street), ID);
  }
  assert.eq(goldenBushCrop('shrub', `x`, 0), 'shrub');
});

test('golden berry: the charm lasts a minute less the tier squared, and a charmed body does not flee', () => {
  assert.eq(charmFeedMs('goblin_runt'), 59000, 'a T1 runt: 59 s');
  assert.eq(charmFeedMs('goblin'), (60 - 9) * 1000, 'a T3 goblin: 51 s');
  assert.eq(charmFeedMs('deer'), 60000, 'an animal has no tier: the whole minute');
  assert.eq(charmFeedMs('x', { minuteMs: 60000, tierSquaredMs: 1000 }), 60000);
  const highest = Math.max(...EnemyRoster.ROWS.map(r => r.tier || 0));
  assert.truthy(charmFeedMs('goblin') > 0 && Math.max(0, 60 - highest * highest) * 1000 === charmFeedMs(EnemyRoster.ROWS.find(r => r.tier === highest).id), 'never below zero');
  const now = Date.now(), g = foe('goblin', { _hp: 30 });
  assert.truthy(Combat.applyCharm(g, now, 5000));
  assert.truthy(Combat.isCharmed(g, now + 4000)); assert.falsy(Combat.isCharmed(g, now + 6000), 'the length the caller names');
  assert.truthy(Combat.isCalm(g, now + 4000), 'charmed, it is as calm: no bolt, no flight, no run from the net');
  assert.falsy(Combat.isCalm(g, now + 6000));
  assert.truthy(Combat.applyCharm(foe('goblin'), now), 'the flower\'s minute by default');
});

test('golden berry: offered, a foe is charmed and a wild animal calmed; a pet or a too-high kind keeps it', () => {
  const save = newSave(), g = foe('goblin');
  const rec = tapCreature(g, save, ID);
  assert.eq(rec.catches.length, 0, 'not its favourite: no catch');
  assert.eq(Inventory.count(save, ID), 0, 'the berry is eaten');
  assert.truthy(Combat.isCharmed(g), 'and the goblin is charmed');
  assert.truthy(Combat.isCharmed(g, Date.now() + 50000) && !Combat.isCharmed(g, Date.now() + 52000), 'for 51 s');
  assert.truthy(rec.flashes.some(t => /Charmed/.test(t)));
  const deer = { kind: 'deer', id: 'gold_deer', x: 2.5, y: 2.5 };
  tapCreature(deer, newSave(), ID);
  assert.truthy(Combat.isCalm(deer) && !Combat.isCharmed(deer), 'an animal is calmed, not charmed');
  const save2 = newSave(), pet = foe('goblin', { id: 'pet_goblin', pet: true });
  Pets.bond(save2, pet);
  tapCreature(pet, save2, ID);
  assert.eq(Inventory.count(save2, ID), 1, 'a pet keeps the berry');
  const at = INTERACT_SRC.indexOf('A GOLDEN BERRY, offered');
  assert.lt(at, INTERACT_SRC.indexOf('A POISONBERRY, offered'), 'ahead of the poisonberry and the pet menu');
});
})();
