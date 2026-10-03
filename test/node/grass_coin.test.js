(function () {
test('grass: a 1% coin find is banked and saved once alongside the grass', () => {
  const original = { world: globalThis.WorldGen, random: Math.random,
    persist: globalThis.persistSave };
  const handler = TAP_HANDLERS.find(h => h.name === 'wildplant');
  const plant = { kind: 'wildplant', crop: 'longgrass', id: 'grass_coin_test', x: 2.5, y: 2.5 };
  try {
    globalThis.WorldGen = { ...original.world,
      forEachItem: (layer, visit) => { if (layer === 'wildplants') visit(plant); } };
    for (const [roll, expected] of [[0, 1], [0.009999, 1], [0.01, 0], [0.999999, 0]]) {
      let rolls = 0;
      Math.random = () => { rolls++; return roll; };
      const snapshots = [], messages = [];
      globalThis.persistSave = save => snapshots.push(JSON.parse(JSON.stringify(save)));
      const save = { picked: [], money: 7, energy: 100, inv: [], relics: {} };
      const scene = Object.assign(makeScene(), {
        save, cellM: 5, cellsPerTile: 32, mPerPx: 5 / (original.world.TILE_PX / 32),
        originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 },
        playerM: { x: 2.5, y: 2.5 }, feetOffsetM: 0, depth: 0, tileEdgeM: 1000,
        playerToWorldCell: () => ({ tx: 0, ty: 0 }),
        flashLoot: text => messages.push(text),
        awardShinyBonus: () => {},
        startWorkProgress: () => { throw new Error('Grass must remain instant to pick'); },
      });
      const context = { scene, save, wm: { x: 2.5, y: 2.5 }, sx: 0, sy: 0 };
      assert.eq(handler.try(context), true, `grass is picked at roll ${roll}`);
      assert.eq(scene.invCount('longgrass'), 1, 'the grass still drops');
      assert.eq(save.money, 7 + expected, 'exactly one coin below the 1% boundary');
      assert.eq(rolls, 1, 'one treasure roll per plant');
      assert.eq(snapshots.length, 1, 'the harvest persists its result');
      assert.eq(snapshots[0].money, 7 + expected, 'coin balance persists with the harvest');
      assert.includes(snapshots[0].picked, plant.id, 'the picked plant persists');
      if (expected) assert.includes(messages[0], 'coin', 'the find is visible');
      assert.eq(handler.try(context), false, 'a picked plant cannot be harvested again');
      assert.eq(save.money, 7 + expected, 'a repeat tap cannot duplicate the coin');
      assert.eq(scene.invCount('longgrass'), 1, 'or the grass');
      assert.eq(rolls, 1, 'or reroll the treasure');
      assert.eq(snapshots.length, 1, 'no second award is saved');
    }
  } finally {
    globalThis.WorldGen = original.world;
    Math.random = original.random;
    globalThis.persistSave = original.persist;
  }
});
})();
