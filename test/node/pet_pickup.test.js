// Individual pet interaction: GIVING a wild one its favourite starts the catch
// at once (one favourite spent, the net wheel at Pets.catchMs); a wrong item or
// an owned species is refused and the item KEPT; owned taps open the pet panel.
const DAY = 24 * 60 * 60 * 1000;

const petScene = (save, over = {}) => Object.assign(makeScene(), {
  save, cellM: 5, cellPx: 32, cellsPerTile: 32, mPerPx: 5 / (WorldGen.TILE_PX / 32), originPx: { x: 0, y: 0 },
  startWorldM: { x: 0, y: 0 }, playerM: { x: 2.5, y: 2.5 }, feetOffsetM: 0, depth: 0, tileEdgeM: 1000,
  // Wild capture is tested outside Home's wildlife circle.
  _starterTrailAnchor: () => ({ x: 10000, y: 10000 }),
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

test('pets: tapping an owned individual opens its menu without converting it to inventory', () => {
  const pet = { id: 'pet_dog', kind: 'dog', pet: true, x: 2.5, y: 2.5 };
  const save = { inv: [], caught: [], released: [{ ...pet }], selSlot: -1 };
  let opened;
  tapPet(pet, save, null, { presentPetMenu: id => { opened = id; } });
  assert.eq(opened, pet.id);
  assert.eq(Inventory.count(save, 'dog'), 0);
  assert.eq(save.released.length, 1);
});

// A catch recorder: the wheel's arguments, with completion and failure handles.
const catchRecorder = () => {
  const rec = { starts: [], spends: 0, caught: [], flashes: [] };
  rec.over = {
    spendEnergy: () => { rec.spends++; return true; },
    startCatchProgress: (c, ms, done, fail, tool, cost) => rec.starts.push({ c, ms, done, fail, tool, cost }),
    catchCreature: (c) => { rec.caught.push(c.id); Pets.bond(rec.save, c); },
    flash: (text) => rec.flashes.push(text),
  };
  return rec;
};

test('pets: an empty hand cannot start a catch or spend energy, and says what it wants', () => {
  const pet = { id: 'wild_dog', kind: 'dog', x: 2.5, y: 2.5 };
  const save = { inv: [], caught: [], released: [], selSlot: -1 };
  const rec = catchRecorder(); rec.save = save;
  tapPet(pet, save, null, rec.over);
  assert.eq(rec.starts.length, 0); assert.eq(rec.spends, 0);
  assert.eq(rec.flashes[0], `Offer ${itemName('meat')} to catch it`);
});

test('pets: the favourite starts the catch at once — one spent, the net wheel at Pets.catchMs, completion bonds', () => {
  const pet = { id: 'wild_dog', kind: 'dog', x: 2.5, y: 2.5 };
  const save = { inv: [], caught: [], released: [], selSlot: -1, relics: {} };
  Inventory.add(save, 'meat', 1);   // two in the bag: only one is given
  const rec = catchRecorder(); rec.save = save;
  tapPet(pet, save, 'meat', rec.over);
  assert.eq(Inventory.count(save, 'meat'), 1, 'exactly one favourite given');
  assert.eq(rec.starts.length, 1, 'the wheel starts with no confirm');
  assert.eq(rec.spends, 1, 'the catch energy is spent');
  const w = rec.starts[0];
  assert.eq(w.c, pet); assert.eq(w.tool, 'net');
  assert.eq(w.ms, Pets.catchMs(save, pet));
  assert.eq(w.cost, effectiveCatchCost(save.relics));
  assert.falsy(Combat.isTame(pet), 'giving alone never bonds');
  assert.eq(Pets.list(save).length, 0);
  w.done();
  assert.eq(rec.caught.join(), 'wild_dog'); assert.eq(Pets.list(save).length, 1);
  assert.truthy(Pets.ownedKind(save, 'dog'));
});

test('pets: the slime takes the same wheel as any catch — no instant pickup', () => {
  const pet = { id: 'wild_slime', kind: 'slime', x: 2.5, y: 2.5 };
  const save = { inv: [], caught: [], released: [], selSlot: -1, relics: {} };
  const rec = catchRecorder(); rec.save = save;
  tapPet(pet, save, null, rec.over);
  assert.eq(rec.starts.length, 0); assert.eq(rec.caught.length, 0);
  tapPet(pet, save, 'sapphire', rec.over);
  assert.eq(rec.caught.length, 0, 'never picked up by the tap itself');
  assert.eq(rec.starts.length, 1); assert.eq(rec.starts[0].ms, Pets.catchMs(save, pet));
  assert.eq(Inventory.count(save, 'sapphire'), 0, 'the sapphire is given');
  rec.starts[0].done(); assert.eq(rec.caught.join(), 'wild_slime');
});

test('pets: stale catch completion cannot bypass the species limit', () => {
  const pet = { id: 'wild_dog', kind: 'dog', x: 2.5, y: 2.5 };
  const save = { inv: [], caught: [], released: [], selSlot: -1 };
  const rec = catchRecorder(); rec.save = save;
  tapPet(pet, save, 'meat', rec.over);
  assert.eq(rec.starts.length, 1);
  const other = { ...pet, id: 'other' };
  Pets.bond(save, other, { carried: true });
  rec.starts[0].done(); assert.eq(rec.caught.length, 0);
});

test('pets: owning a species refuses the catch before energy is spent, and keeps the favourite', () => {
  const pet = { id: 'wild_dog', kind: 'dog', x: 2.5, y: 2.5 };
  const save = { inv: [], caught: [], released: [{ id: 'pet_owned', kind: 'dog', pet: true, carried: true }], selSlot: -1 };
  const rec = catchRecorder(); rec.save = save;
  tapPet(pet, save, 'meat', rec.over);
  assert.eq(Inventory.count(save, 'meat'), 1, 'kept');
  assert.eq(rec.flashes[0], 'Release this species first');
  tapPet(pet, save, null, rec.over);
  assert.eq(rec.spends, 0); assert.eq(rec.starts.length, 0);
});

test('pets: a food that is not its favourite is refused and kept (mango included)', () => {
  const pet = { id: 'wild_dog', kind: 'dog', x: 2.5, y: 2.5 };
  for (const food of ['mango', 'apple']) {
    const save = { inv: [], caught: [], released: [], selSlot: -1 };
    const rec = catchRecorder(); rec.save = save;
    tapPet(pet, save, food, rec.over);
    assert.eq(Inventory.count(save, food), 1, `${food} kept`);
    assert.eq(rec.flashes[0], '🤢 Not its favourite');
    assert.eq(rec.starts.length, 0); assert.eq(rec.spends, 0);
    assert.falsy(Combat.isTame(pet));
    assert.eq(Pets.list(save).length, 0);
  }
});
