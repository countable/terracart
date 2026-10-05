// PICKING UP A TAME PET (interact.js pickUpPet / carriedRaisedRow). A bare
// hand or a tool on a 'released_' animal pockets it at once; food still pets
// it; a raised pet's growth survives the trip through the bag.
const DAY = 24 * 60 * 60 * 1000;

const petScene = (save, over = {}) => Object.assign(makeScene(), {
  save, cellM: 5, cellPx: 32, cellsPerTile: 32, mPerPx: 5 / (WorldGen.TILE_PX / 32), originPx: { x: 0, y: 0 },
  startWorldM: { x: 0, y: 0 }, playerM: { x: 2.5, y: 2.5 }, feetOffsetM: 0, depth: 0, tileEdgeM: 1000,
  playerToWorldCell: () => ({ tx: 0, ty: 0 }), buildInventoryDOM: () => {}, _toolActionStory: () => {},
  // addToInv writes the REAL bag so Inventory.roomFor sees it.
  addToInv: (id, n = 1) => Inventory.add(save, id, n).accepted,
}, over);

// Tap `pet` holding `heldId` (null = empty hand). Returns the handler's verdict.
function tapPet(pet, save, heldId, over = {}) {
  save.inv = save.inv || [];
  if (heldId) { Inventory.add(save, heldId, 1); save.selSlot = save.inv.findIndex(s => s && s.id === heldId); }
  else save.selSlot = -1;
  const scene = petScene(save, over);
  const original = globalThis.WorldGen, originalReach = globalThis.cellInReach;
  try {
    globalThis.cellInReach = () => true;
    globalThis.WorldGen = { ...original, forEachItem: (layer, cb) => { if (layer === 'creatures') cb(pet); } };
    const r = TAP_HANDLERS.find(h => h.name === 'creature').try({ scene, save, wm: { x: pet.x, y: pet.y }, sx: 0, sy: 0 });
    return { r, scene };
  } finally { globalThis.WorldGen = original; globalThis.cellInReach = originalReach; }
}

function releaseAt(save, cwmx, cwmy) {
  const entry = { creatures: [] };
  const original = globalThis.WorldGen;
  try {
    globalThis.WorldGen = { ...original, tileCache: new Map([[original.tileKey(0, 0), entry]]) };
    const ok = TAP_HANDLERS.find(h => h.name === 'release').try({ scene: petScene(save), save, sx: 0, sy: 0, cwmx, cwmy, cell: TERRAIN.GRASS ?? 0 });
    assert.eq(ok, true);
  } finally { globalThis.WorldGen = original; }
  return entry.creatures[0];
}

const tame = (kind, extra = {}) => ({ kind, id: `released_${kind}_${Math.random().toString(36).slice(2)}`, x: 2.5, y: 2.5, ...extra });
const saveWith = (...pets) => ({ inv: [], selSlot: -1, caught: [], released: pets.map(p => ({ ...p, tx: 0, ty: 0 })), petBoost: {} });

test('pickup: an empty hand pockets a tame pet at once — no wheel, no energy, no petting', () => {
  const pet = tame('dog');
  const save = saveWith(pet);
  let wheel = 0, spent = 0;
  const { r } = tapPet(pet, save, null, { startCatchProgress: () => { wheel++; }, startWorkProgress: () => { wheel++; }, spendEnergy: () => { spent++; return true; } });
  assert.eq(r, true);
  assert.eq(Inventory.count(save, 'dog'), 1);
  assert.truthy(save.caught.includes(pet.id), 'in the bag = caught');
  assert.eq(save.released.length, 0, 'a plain pet drops its row like catchCreature');
  assert.eq(wheel, 0); assert.eq(spent, 0);
  assert.falsy(save.petBoost[pet.id], 'picking up is not petting');
});

test('pickup: a tool in hand still pockets; food in hand pets instead', () => {
  const held = tame('cat');
  const save = saveWith(held);
  assert.eq(tapPet(held, save, 'field_scope').r, true);
  assert.eq(Inventory.count(save, 'cat'), 1, 'a non-food item is a hand');
  // meat is the dog's favourite and apple plant produce: both treats, eaten.
  // Milk and a seed are food it won't want: a free pet, never a pickup.
  for (const [food, treat] of [['meat', true], ['apple', true], ['milk', false], ['potato_seed', false]]) {
    const pet = tame('dog');
    const s2 = saveWith(pet);
    assert.eq(tapPet(pet, s2, food).r, true);
    assert.eq(Inventory.count(s2, 'dog'), 0, `${food} is offered, not a pickup`);
    assert.falsy(s2.caught.includes(pet.id));
    assert.truthy((s2.petBoost[pet.id] || 0) > Date.now(), `${food} pets`);
    assert.eq(Inventory.count(s2, food), treat ? 0 : 1, treat ? 'a treat is eaten' : 'other food is a free pet');
  }
});

test('pickup: a shiny pet returns to its shiny stack with no shiny windfall', () => {
  const pet = tame('chicken', { shiny: true });
  const save = saveWith(pet);
  let bonus = 0;
  tapPet(pet, save, null, { awardShinyBonus: () => { bonus++; } });
  assert.eq(Inventory.count(save, 'shiny_chicken'), 1);
  assert.eq(Inventory.count(save, 'chicken'), 0);
  assert.eq(bonus, 0, 'already yours: no 10× payout to farm');
});

test('pickup: a full stack leaves the pet standing', () => {
  const pet = tame('rabbit');
  const save = saveWith(pet);
  Inventory.add(save, 'rabbit', Inventory.stackCapFor(save, 'rabbit'));
  const flashes = [];
  const { r } = tapPet(pet, save, null, { flash: (m) => flashes.push(m) });
  assert.eq(r, true);
  assert.falsy(save.caught.includes(pet.id), 'not taken');
  assert.eq(save.released.length, 1, 'row kept');
  assert.truthy(flashes.some(m => /room/i.test(m)), 'says why');
});

test('pickup: a kind with no bag item (the tame slime) is petted, not pocketed', () => {
  const pet = tame('slime');
  const save = saveWith(pet);
  const { r } = tapPet(pet, save, null);
  assert.eq(r, true);
  assert.eq(save.inv.length, 0);
  assert.falsy(save.caught.includes(pet.id));
  assert.truthy((save.petBoost[pet.id] || 0) > Date.now(), 'falls through to petting');
});

test('pickup: a raised baby keeps its row, pockets as a Baby and comes back the same pet', () => {
  const born = Date.now() - 2 * DAY;
  const pet = tame('dog', { shiny: true, raised: true, born, favouriteFeeds: 3 });
  const save = saveWith(pet);
  tapPet(pet, save, null);
  assert.eq(Inventory.count(save, 'baby_dog'), 1);
  assert.eq(Inventory.count(save, 'shiny_dog'), 0);
  assert.truthy(save.caught.includes(pet.id));
  assert.eq(save.released.length, 1, 'the raised row stays while carried');
  assert.eq(save.released[0].favouriteFeeds, 3);
  // The spawner skips it meanwhile (its id is caught) — the one flag it reads.
  assert.includes(SCENE_CREATURES_SRC, 'if (caughtSet.has(r.id)) continue;');
  // Set it down elsewhere: same id, birth and meals, new spot, mark removed.
  save.selSlot = save.inv.findIndex(s => s && s.id === 'baby_dog');
  const c = releaseAt(save, 112, 218);
  assert.eq(save.released.length, 1, 'no second row');
  const row = save.released[0];
  assert.eq(row.id, pet.id); assert.eq(row.born, born); assert.eq(row.favouriteFeeds, 3);
  assert.eq(row.x, 112); assert.eq(row.y, 218); assert.truthy(row.shiny && row.raised);
  assert.falsy(save.caught.includes(pet.id), 'back in the world');
  assert.truthy(c && c.id === pet.id && c.raised && c.born === born && c.favouriteFeeds === 3, 'the live creature is the same pet');
  assert.eq(Inventory.count(save, 'baby_dog'), 0);
});

test('pickup: a grown raised pet pockets as a Shiny and keeps its double strength; a wild shiny stays plain', () => {
  const born = Date.now() - 8 * DAY;
  const pet = tame('dog', { shiny: true, raised: true, born, favouriteFeeds: 7 });
  const save = saveWith(pet);
  tapPet(pet, save, null);
  assert.eq(Inventory.count(save, 'shiny_dog'), 1);
  Inventory.add(save, 'shiny_dog', 1);              // plus one netted in the wild
  save.selSlot = save.inv.findIndex(s => s && s.id === 'shiny_dog');
  const first = releaseAt(save, 12, 18);
  assert.eq(first.id, pet.id); assert.eq(Combat.raisedMul(first), 2, 'the raised one comes back raised');
  const second = releaseAt(save, 22, 18);
  assert.falsy(second.raised, 'the wild shiny is a plain shiny');
  assert.truthy(second.shiny);
  assert.eq(save.released.length, 2);
  assert.eq(save.caught.length, 0);
});

test('pickup: a baby item set down takes a row that grew up in the bag; a shiny item never takes a baby\'s row', () => {
  const kind = 'cat';
  const grown = { kind, id: 'released_cat_grown', raised: true, born: Date.now() - 8 * DAY, favouriteFeeds: 7 };
  const baby = { kind, id: 'released_cat_baby', raised: true, born: Date.now(), favouriteFeeds: 1 };
  const save = { caught: [grown.id, baby.id], released: [grown, baby] };
  assert.eq(carriedRaisedRow(save, kind, true), baby);
  assert.eq(carriedRaisedRow(save, kind, false), grown);
  save.released = [grown];
  assert.eq(carriedRaisedRow(save, kind, true), grown, 'it grew while carried');
  save.released = [baby];
  assert.eq(carriedRaisedRow(save, kind, false), null);
  assert.eq(carriedRaisedRow(save, 'dog', true), null);
  assert.eq(carriedRaisedRow({ caught: [], released: [grown] }, kind, false), null, 'a row in the world is not carried');
});


test('pickup: releasing near Home saves the stay assignment; releasing away saves following', () => {
  const original=globalThis.WorldGen;
  try {
    for (const x of [10,10.1]) {
      const save={inv:[{id:'dog',count:1}],selSlot:0,caught:[],released:[]};
      const entry={creatures:[]};
      globalThis.WorldGen={...original,tileCache:new Map([[original.tileKey(0,0),entry]])};
      const scene=petScene(save,{homeWorldPos:()=>({x:0,y:0})});
      assert.truthy(TAP_HANDLERS.find(h=>h.name==='release').try({scene,save,sx:0,sy:0,cwmx:x,cwmy:0,cell:TERRAIN.GRASS??0}));
      assert.eq(save.released[0].stayHome,x<=10);
      assert.eq(entry.creatures[0].stayHome,x<=10);
      assert.eq(Companions.follows(entry.creatures[0]),x>10);
    }
  } finally {globalThis.WorldGen=original;}
});


test('pickup: taming a surface slime clears hostile spawn and garrison gates', () => {
  const save={inv:[{id:'sapphire',count:1}],selSlot:0,caught:[],released:[]};
  const scene=petScene(save,{homeWorldPos:()=>({x:0,y:0})});
  const slime={kind:'slime',id:'wild_surface_slime',x:20,y:0,
    _surfaceSpawn:{},_surfaceInactive:true,lair:'guard',immobile:true,_wardFrom:{x:0,y:0}};
  tameInPlace(scene,save,slime,'Tamed','slime',1);
  assert.falsy(slime._surfaceSpawn);
  assert.falsy(slime._surfaceInactive);
  assert.falsy(slime.lair);
  assert.falsy(slime.immobile);
  assert.truthy(Companions.follows(slime));
  slime.x=0;
  assert.truthy(EnemySpawns.surfaceActive(scene,slime),'tame slime stays visible at Home');
});

test('pickup: a carried raised pet drops its tracked body before re-release at Home', () => {
  const pet=tame('dog',{raised:true,born:Date.now(),favouriteFeeds:0,stayHome:false,_hp:2,_lastDamagedT:Date.now()-60000});
  const save=saveWith(pet), entry={creatures:[pet]};
  const scene=petScene(save,{homeWorldPos:()=>({x:0,y:0}),
    _travellingPets:new Map([[pet.id,{creature:pet,entry}]])});
  assert.truthy(pickUpPet(scene,save,pet,0,0));
  assert.eq(entry.creatures.length,0);
  assert.eq(save.released[0].hp,2,'pickup snapshots the current wound');
  assert.eq(save.released[0].lastDamagedAt,pet._lastDamagedT);
  assert.falsy(scene._travellingPets.has(pet.id));
  save.selSlot=save.inv.findIndex(s=>s?.id==='baby_dog');
  const original=globalThis.WorldGen;
  try {
    globalThis.WorldGen={...original,tileCache:new Map([[original.tileKey(0,0),entry]])};
    TAP_HANDLERS.find(h=>h.name==='release').try({scene,save,sx:0,sy:0,cwmx:5,cwmy:0,cell:TERRAIN.GRASS??0});
    assert.eq(entry.creatures.length,1);
    assert.eq(entry.creatures[0].id,pet.id);
    assert.eq(Combat.hp(entry.creatures[0]),2,'re-release keeps the wound');
    assert.eq(entry.creatures[0]._lastDamagedT,pet._lastDamagedT,'carrying does not restart healing');
    assert.truthy(entry.creatures[0].stayHome);
    assert.falsy(Companions.follows(entry.creatures[0]));
  } finally {globalThis.WorldGen=original;}
});


test('butterfly colors keep separate plain and shiny stacks through release and pickup', () => {
  const save = { inv: [], selSlot: -1, caught: [], released: [] };
  for (const row of SpriteLayout.BUTTERFLY_VARIANTS) {
    for (const shiny of [false, true]) {
      const id = shiny ? `shiny_${row.id}` : row.id;
      Inventory.add(save, id, 1);
      save.selSlot = save.inv.findIndex(slot => slot && slot.id === id);
      const pet = releaseAt(save, 12, 18);
      assert.eq(pet.kind, row.id);
      assert.eq(pet.shiny, shiny);
      assert.truthy(SpriteLayout.creatureBehaviour(pet.kind).pollinates);
      assert.eq(petPickupItemId(pet), id);
      assert.truthy(pickUpPet(petScene(save), save, pet, 0, 0));
      assert.eq(save.inv.find(slot => slot && slot.id === id).count, 1);
    }
  }
  assert.eq(save.inv.filter(Boolean).length, 8);
});

test('butterfly colors inherit flight and pollination and match habitat', () => {
  for (const row of SpriteLayout.BUTTERFLY_VARIANTS) {
    assert.eq(SpriteLayout.baseKind(row.id), 'butterfly');
    assert.eq(SpriteLayout.creatureBehaviour(row.id), SpriteLayout.creatureBehaviour('butterfly'));
    assert.eq(SpriteLayout.creatureArt(row.id).frames, 7);
    assert.eq(ITEM_BY_ID[row.id].baseTier, ITEM_BY_ID.butterfly.baseTier);
    assert.eq(itemValue(row.id), itemValue('butterfly'));
    for (const zone of row.zones) assert.eq(SpriteLayout.butterflyKindForTerrain(WorldGen.T[zone], WorldGen.T), row.id);
  }
});


test('deer need no food and cannot be diverted into taming', () => {
  const kind = 'deer';
  for (const food of [null, 'apple', 'mango']) {
    const animal = { kind, id: 'wild_' + kind, x: 2.5, y: 2.5 };
    const save = saveWith();
    let hunted, wheel;
    assert.eq(tapPet(animal, save, food, {
      startWorkProgress: (x, y, done, ms, cost, tool, target) => {
        wheel = { ms, cost, tool, target };
        done();
      },
      resolveDefeat: target => { hunted = target; },
    }).r, true);
    assert.eq(hunted, animal, `${kind}: ${food || 'empty hand'} hunts`);
    assert.eq(wheel.target, animal);
    assert.eq(wheel.tool, 'net');
    assert.eq(wheel.ms, toolDurationMs({}, 'net'));
    assert.eq(wheel.cost, 0);
    assert.eq(animal.id, 'wild_' + kind, 'never tamed');
    if (food) assert.eq(Inventory.count(save, food), 1, 'food is not consumed');
  }
});

test('hostile shore crab still accepts its favourite food and mango', () => {
  for (const food of ['minnow', 'mango']) {
    const crab = {kind:'crab', id:'wild_crab_'+food, x:2.5, y:2.5};
    const save = saveWith();
    assert.truthy(Combat.isEnemy(crab));
    assert.eq(tapPet(crab, save, food).r, true);
    assert.truthy(crab.id.startsWith('released_'), food+' tames the crab');
    assert.falsy(Combat.isEnemy(crab));
    assert.eq(Inventory.count(save, food), 0);
  }
});

test('hostile shore crab can still be caught with an empty hand', () => {
  const crab = {kind:'crab', id:'wild_crab_net', x:2.5, y:2.5};
  const save = saveWith();
  let caught;
  assert.eq(tapPet(crab, save, null, {
    startCatchProgress: (target, ms, done) => done(),
    catchCreature: target => { caught = target; },
  }).r, true);
  assert.eq(caught, crab);
});
