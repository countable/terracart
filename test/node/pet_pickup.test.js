// Individual pet interaction: favourite feeding prepares capture; owned taps open the pet panel.
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

test('pets: tapping an owned individual opens its menu without converting it to inventory', () => {
  const pet = { id: 'pet_dog', kind: 'dog', pet: true, x: 2.5, y: 2.5 };
  const save = { inv: [], caught: [], released: [{ ...pet }], selSlot: -1 };
  let opened;
  tapPet(pet, save, null, { presentPetMenu: id => { opened = id; } });
  assert.eq(opened, pet.id);
  assert.eq(Inventory.count(save, 'dog'), 0);
  assert.eq(save.released.length, 1);
});

test('pets: unfed animal cannot start a catch or spend energy', () => {
  const pet = { id: 'wild_dog', kind: 'dog', x: 2.5, y: 2.5 };
  const save = { inv: [], caught: [], released: [], selSlot: -1 };
  let starts = 0, spends = 0;
  tapPet(pet, save, null, { startCatchProgress: () => starts++, spendEnergy: () => { spends++; return true; } });
  assert.eq(starts, 0); assert.eq(spends, 0);
});

test('pets: favourite food prepares only that individual and never immediately bonds it', () => {
  const pet = { id: 'wild_dog', kind: 'dog', x: 2.5, y: 2.5 };
  const save = { inv: [], caught: [], released: [], selSlot: -1 };
  tapPet(pet, save, 'meat');
  assert.truthy(Pets.fed(save, pet));
  assert.falsy(Pets.fed(save, { ...pet, id: 'other_dog' }));
  assert.falsy(Combat.isTame(pet));
  assert.eq(Pets.list(save).length, 0);
  assert.eq(Inventory.count(save, 'meat'), 0);
});

test('pets: sapphire-fed slime catches by tap while unfed slime does not', () => {
  const pet = { id: 'wild_slime', kind: 'slime', x: 2.5, y: 2.5 };
  const save = { inv: [], caught: [], released: [], selSlot: -1 };
  let caught = 0;
  const actions = { catchCreature: () => caught++ };
  tapPet(pet, save, null, actions);
  assert.eq(caught, 0);
  tapPet(pet, save, 'sapphire', actions);
  assert.eq(caught, 0);
  tapPet(pet, save, null, actions);
  assert.eq(caught, 1);
});

test('pets: stale catch completion cannot bypass the species limit', () => {
  const pet = { id: 'wild_dog', kind: 'dog', x: 2.5, y: 2.5 };
  const save = { inv: [], caught: [], released: [], selSlot: -1 };
  Pets.feedWild(save, pet, 'meat');
  let finish, caught = 0;
  tapPet(pet, save, null, { spendEnergy: () => true,
    startCatchProgress: (_c, _ms, done) => { finish = done; }, catchCreature: () => caught++ });
  assert.eq(typeof finish, 'function');
  const other = { ...pet, id: 'other' };
  Pets.feedWild(save, other, 'meat'); Pets.bond(save, other, { carried: true });
  finish(); assert.eq(caught, 0);
});

test('pets: owning a species blocks another meal and another catch before energy is spent', () => {
  const pet = { id: 'wild_dog', kind: 'dog', x: 2.5, y: 2.5 };
  const save = { inv: [], caught: [], released: [{ id: 'pet_owned', kind: 'dog', pet: true, carried: true }], selSlot: -1 };
  let spends = 0;
  tapPet(pet, save, 'meat', { spendEnergy: () => { spends++; return true; } });
  assert.eq(Inventory.count(save, 'meat'), 1);
  assert.falsy(Pets.fed(save, pet));
  tapPet(pet, save, null, { spendEnergy: () => { spends++; return true; } });
  assert.eq(spends, 0);
});

test('pets: mango no longer bypasses a species favourite food requirement', () => {
  const pet = { id: 'wild_dog', kind: 'dog', x: 2.5, y: 2.5 };
  const save = { inv: [], caught: [], released: [], selSlot: -1 };
  tapPet(pet, save, 'mango');
  assert.falsy(Pets.fed(save, pet));
  assert.falsy(Combat.isTame(pet));
  assert.eq(Pets.list(save).length, 0);
});
