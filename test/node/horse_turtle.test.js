// The horse (a rare mount kept in the bag) and the sea turtle (the rabbit of
// the beach). Riding reads one row, items.js CONSUMABLE_SPEC.horse.
test('horse: riding counts only while a horse is in the bag', () => {
  const bag = id => [{ id, count: 1 }];
  assert.falsy(isRiding({ inv: bag('horse') }), 'carried, not ridden');
  assert.falsy(isRiding({ riding: true, inv: bag('cow') }), 'no horse, no ride');
  assert.falsy(isRiding({ riding: true, inv: [{ id: 'horse', count: 0 }] }), 'an empty stack is no horse');
  assert.truthy(isRiding({ riding: true, inv: bag('horse') }));
  assert.truthy(isRiding({ riding: true, inv: bag('shiny_horse') }), 'a shiny horse rides the same');
  assert.eq(CONSUMABLE_SPEC.shiny_horse, CONSUMABLE_SPEC.horse, 'one row for both stacks');
  assert.truthy(CONSUMABLE_SPEC.horse.immediate, 'riding spends nothing');
});

test('horse: the rider wears the knight skin the bike rack lends', () => {
  const save = { playerClass: 'farmer', riding: true, inv: [{ id: 'horse', count: 1 }] };
  assert.eq(SpriteLayout.playerArt(save), SpriteLayout.PLAYER_ART.mounted);
  save.inv = [];
  assert.eq(SpriteLayout.playerArt(save), SpriteLayout.PLAYER_ART.farmer, 'sold or released: back on foot');
});

test('horse: the stick walk goes speedMul as fast and costs energyMul as much', () => {
  const { speedMul, energyMul } = HORSE_RIDE;
  assert.eq(speedMul, 2); assert.eq(energyMul, 2);
  for (const tier of [0, 3, 7]) {
    assert.inRange(steerSpeedMul({ boots: { tier, boost: speedMul } }) / steerSpeedMul({ boots: { tier } }),
      speedMul - 1e-9, speedMul + 1e-9, `boots T${tier}: speed`);
    assert.inRange(steerEnergyCost({ boots: { tier, costTier: tier, costMul: energyMul } }) / steerEnergyCost({ boots: { tier, costTier: tier } }),
      energyMul - 1e-9, energyMul + 1e-9, `boots T${tier}: cost`);
  }
  assert.truthy(/const costMul = riding \? HORSE_RIDE\.energyMul : 1;/.test(SCENE_SRC), '_walkRelics charges the ride');
  assert.truthy(/return \{ boots: \{ tier: speedTier, costTier, boost, costMul \} \};/.test(SCENE_SRC),
    'on the boots (the amulet slot retired), to steerEnergyCost');
  assert.truthy(/\n  toggleHorseRide\(\) \{/.test(SCENE_SRC), 'MapScene implements the toggle');
});

test('horse: a T4 mount with a premium sale value and no milk', () => {
  assert.eq(ITEM_BY_ID.horse.kind, 'animal');
  assert.eq(ITEM_BY_ID.horse.baseTier, 4);
  assert.eq(itemValue('horse'), 200);
  assert.eq(BIOME_FAUNA.horse.base + BIOME_FAUNA.horse.range, 5, 'five a tile');
  assert.eq(FAUNA_ORDER[FAUNA_ORDER.length - 1], 'horse', 'appended last: no older seat moves');
  assert.eq(SpriteLayout.creatureProduce('horse'), null, 'no produce');
  assert.eq(SpriteLayout.creatureCatchMul('horse'), SpriteLayout.creatureCatchMul('cow'));
  assert.eq(ANIMAL_FOOD.horse.join(), ANIMAL_FOOD.cow.join(), 'the cow\'s favourite');
});

test('turtle: the rabbit\'s habits, seated on the shore', () => {
  assert.eq(SpriteLayout.CREATURE_BEHAVIOUR.sea_turtle, SpriteLayout.CREATURE_BEHAVIOUR.rabbit, 'one gait row');
  assert.eq(ITEM_BY_ID.sea_turtle.kind, 'animal');
  assert.eq(ITEM_BY_ID.sea_turtle.baseTier, 3);
  assert.truthy(SHORE_FAUNA.sea_turtle, 'a shore species');
  assert.eq(SHORE_FAUNA_ORDER[SHORE_FAUNA_ORDER.length - 1], 'sea_turtle', 'appended last: no older seat moves');
  assert.falsy(Object.values(BIOME_FAUNA).some((r, i) => Object.keys(BIOME_FAUNA)[i] === 'sea_turtle'), 'never inland');
});
