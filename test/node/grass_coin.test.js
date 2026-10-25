(function () {
test('grass: coin finds and a hidden egg are banked and saved once alongside the grass', () => {
  const original = { world: globalThis.WorldGen, random: Math.random,
    persist: globalThis.persistSave };
  const handler = TAP_HANDLERS.find(h => h.name === 'wildplant');
  const plant = { kind: 'wildplant', crop: 'longgrass', id: 'grass_coin_test', x: 2.5, y: 2.5 };
  for (let i = 0; !wildplantHiddenItem(plant.crop, plant.id); i++) plant.id = `egg-grass-${i}`;
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
      assert.eq(scene.invCount('egg'), 1, 'the stable hidden egg drops too');
      assert.eq(save.money, 7 + expected, 'exactly one coin below the 1% boundary');
      assert.eq(rolls, 2, 'one regrowth deadline and one treasure roll per plant');
      assert.eq(snapshots.length, 1, 'the harvest persists its result');
      assert.eq(snapshots[0].money, 7 + expected, 'coin balance persists with the harvest');
      assert.includes(snapshots[0].picked, plant.id, 'the picked plant persists');
      assert.truthy(Number.isFinite(snapshots[0].grassRegrowth[plant.id]), 'regrowth persists with the harvest');
      if (expected) assert.includes(messages[0], 'coin', 'the find is visible');
      assert.eq(handler.try(context), false, 'a picked plant cannot be harvested again');
      assert.eq(save.money, 7 + expected, 'a repeat tap cannot duplicate the coin');
      assert.eq(scene.invCount('longgrass'), 1, 'or the grass');
      assert.eq(scene.invCount('egg'), 1, 'or the egg');
      assert.eq(rolls, 2, 'or reroll the treasure or regrowth deadline');
      assert.eq(snapshots.length, 1, 'no second award is saved');
    }
  } finally {
    globalThis.WorldGen = original.world;
    Math.random = original.random;
    globalThis.persistSave = original.persist;
  }
});
test('grass: hidden eggs occupy one percent deterministically and never cause nest wiggles', () => {
  assert.eq(wildplantRule('longgrass').hiddenItem.chance, 0.01);
  let eggs=0;
  for (let i=0;i<10000;i++) {
    const id=`grass-find-${i}`, find=wildplantHiddenItem('longgrass',id);
    assert.eq(find,wildplantHiddenItem('longgrass',id));
    assert.falsy(isNestBush('longgrass',id));
    if (find) { assert.eq(find,'egg'); eggs++; }
  }
  assert.inRange(eggs,50,150);
  assert.eq(wildplantHiddenItem('longgrass',null),null);
  assert.eq(wildplantHiddenItem('shrub','ordinary-bush'),null);
});
test('grass cover: clear the square before a co-located flower or chest can receive a tap', () => {
  const original=globalThis.WorldGen;
  const grass={kind:'wildplant',crop:'longgrass',id:'cover-grass',x:2.5,y:2.5};
  const flower={...grass,crop:'flowers',id:'hidden-flower'};
  const chest={kind:'chest',id:'hidden-chest',x:2.5,y:2.5};
  try {
    globalThis.WorldGen={...original,forEachItem:(layer,cb)=>{for(const o of layer==='wildplants'?[flower,grass]:layer==='objects'?[chest]:[])cb(o);}};
    const save={picked:[],money:0,energy:100,inv:[],relics:{}};
    const scene=Object.assign(makeScene(),{save,cellM:5,cellsPerTile:32,mPerPx:5/(original.TILE_PX/32),originPx:{x:0,y:0},startWorldM:{x:0,y:0},playerM:{x:2.5,y:2.5},depth:0,tileEdgeM:1000,playerToWorldCell:()=>({tx:0,ty:0}),flashLoot(){},awardShinyBonus(){}});
    const ctx={scene,save,wm:{x:2.5,y:2.5},sx:0,sy:0};
    const handler=TAP_HANDLERS.find(h=>h.name==='grass-cover');
    assert.truthy(TAP_HANDLERS.indexOf(handler)<TAP_HANDLERS.findIndex(h=>h.name==='treasure'));
    assert.eq(handler.try(ctx),true);
    assert.truthy(ctx.dirty,'the dispatcher retains the harvest mutation');
    assert.falsy(Object.hasOwn(ctx,'grassOnly'),'the selection filter does not leak to later handlers');
    assert.eq(scene.invCount('longgrass'),1); assert.eq(scene.invCount('flowers'),0);
    assert.includes(save.picked,grass.id); assert.falsy(save.picked.includes(chest.id));
    assert.eq(handler.try(ctx),false,'once cleared the next handler may act on its contents');
    assert.eq(TAP_HANDLERS.find(h=>h.name==='wildplant').try(ctx),true);
    assert.eq(scene.invCount('flowers'),1,'the flower survives clearing');
  } finally {globalThis.WorldGen=original;}
});
})();
