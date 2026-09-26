// Campfire work (interact.js 'fire-held', items.js CAMPFIRE_MAKES): a held
// item tapped onto a lit campfire is MADE into something (meat → grilled
// meat, wood → torch) or, for anything else, offered to the fire behind a
// "Burn <name>?" confirm. Empty-handed, the tap still puts the fire out.

const fireHeld = TAP_HANDLERS.find(h => h.name === 'fire-held');

function fireScene(over = {}) {
  const calls = { burn: [], loot: [] };
  const scene = makeScene(Object.assign({
    cellM: 2, depth: 0,
    buildInventoryDOM: () => {},
    presentBurnConfirm: (id) => calls.burn.push(id),
    flashLoot: (text, _c, _d, id) => calls.loot.push([text, id]),
  }, over));
  // The shared stub's addToInv returns nothing; the handler reads the
  // accepted count, as the real one returns it.
  const add = scene.addToInv;
  if (!over.addToInv) scene.addToInv = (id, n = 1) => { add(id, n); return n; };
  return { scene, calls };
}
function fireCtx(scene, inv, fires = [{ x: 0, y: 0 }]) {
  const save = { inv, selSlot: inv.length ? 0 : -1, fires, planted: [] };
  return Object.assign(makeCtx(scene, save), { cwmx: 0, cwmy: 0 });
}

test('campfire: the table both sides read — meat grills, wood makes a torch', () => {
  assert.eq(CAMPFIRE_MAKES.meat, 'grilled_meat');
  assert.eq(CAMPFIRE_MAKES.wood, 'torch');
  for (const out of Object.values(CAMPFIRE_MAKES)) assert.truthy(ITEM_BY_ID[out], `${out} is a real item`);
  assert.truthy(ITEM_EFFECTS.meat.includes(`${GRILL_ENERGY_MUL}×`), 'the meat ✦ line quotes the live multiplier');
  assert.truthy(/torch/i.test(ITEM_EFFECTS.wood), 'the wood ✦ line says it makes a torch');
});

test('campfire: grilled meat is 1.5× the raw energy and price, and is never loot', () => {
  assert.eq(GRILL_ENERGY_MUL, 1.5);
  assert.eq(FOOD_ENERGY.grilled_meat, Math.round(FOOD_ENERGY.meat * 1.5));
  assert.eq(PRICES.grilled_meat, Math.round(PRICES.meat * 1.5));
  assert.eq(ITEM_BY_ID.grilled_meat.kind, 'produce');
  assert.truthy(ITEM_BY_ID.grilled_meat.cooked, 'flagged cooked');
  assert.eq(MINERAL_ICON_SHEET.grilled_meat.sheet, 'icon_meat', 'drawn from Beef.png');
  assert.eq(MINERAL_ICON_SHEET.grilled_meat.frame, 2, 'the cooked steak, not the raw cut');
});

test('campfire: meat on the fire becomes grilled meat, one per tap', () => {
  const { scene, calls } = fireScene();
  const ctx = fireCtx(scene, [{ id: 'meat', count: 3 }]);
  assert.eq(fireHeld.try(ctx), true, 'the tap is the fire\'s');
  assert.eq(ctx.save.inv[0].count, 2, 'one meat spent');
  assert.eq(scene.invCount('grilled_meat'), 1, 'one grilled meat made');
  assert.eq(calls.burn.length, 0, 'no burn question for a recipe');
  assert.eq(calls.loot[0][1], 'grilled_meat', 'the flash shows the product');
  assert.truthy(ctx.dirty, 'saved');
});

test('campfire: wood on the fire becomes a torch; the last one frees its slot', () => {
  const { scene } = fireScene();
  const ctx = fireCtx(scene, [{ id: 'wood', count: 1 }]);
  assert.eq(fireHeld.try(ctx), true);
  assert.eq(ctx.save.inv.length, 0, 'the last wood is gone');
  assert.eq(scene.invCount('torch'), 1, 'a torch made');
});

test('campfire: a full bag keeps the input when the product has no room', () => {
  const { scene } = fireScene({ addToInv: () => 0 });
  const ctx = fireCtx(scene, [{ id: 'meat', count: 3 }]);
  assert.eq(fireHeld.try(ctx), true);
  assert.eq(ctx.save.inv[0].count, 3, 'nothing spent when nothing fits');
});

test('campfire: anything else asks to BURN it and spends nothing yet', () => {
  const { scene, calls } = fireScene();
  const ctx = fireCtx(scene, [{ id: 'potato', count: 2 }]);
  assert.eq(fireHeld.try(ctx), true);
  assert.eq(calls.burn[0], 'potato', 'the burn confirm is asked about the held item');
  assert.eq(ctx.save.inv[0].count, 2, 'the confirm spends, not the tap');
});

test('campfire: empty-handed or off the fire, the handler stands aside', () => {
  const { scene } = fireScene();
  assert.eq(fireHeld.try(fireCtx(scene, [])), false, 'empty hand falls through to extinguish-fire');
  assert.eq(fireHeld.try(fireCtx(scene, [{ id: 'meat', count: 1 }], [])), false, 'no fire here');
  assert.eq(fireHeld.try(fireCtx(scene, [{ id: 'meat', count: 1 }], [{ x: 0, y: 0, depth: 1 }])), false,
    'a fire on another level is not this one');
});

test('campfire: fire-held runs before release and extinguish-fire', () => {
  const names = TAP_HANDLERS.map(h => h.name);
  assert.truthy(names.indexOf('fire-held') < names.indexOf('release'), 'a held animal over a fire is a burn question');
  assert.truthy(names.indexOf('fire-held') < names.indexOf('extinguish-fire'), 'holding something never just puts it out');
});
