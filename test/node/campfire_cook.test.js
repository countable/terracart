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

test('campfire: every COOKED_FOODS raw cooks through the same lane as meat', () => {
  for (const [raw, c] of Object.entries(COOKED_FOODS)) {
    assert.eq(CAMPFIRE_MAKES[raw], c.id, `${raw} cooks into ${c.id}`);
    const it = ITEM_BY_ID[c.id];
    assert.truthy(it && it.kind === 'produce' && it.cooked, `${c.id} is cooked produce`);
    assert.eq(FOOD_ENERGY[c.id], Math.round(FOOD_ENERGY[raw] * GRILL_ENERGY_MUL), `${c.id} energy`);
    assert.eq(PRICES[c.id], Math.round(PRICES[raw] * GRILL_ENERGY_MUL), `${c.id} price`);
    assert.truthy(ITEM_EFFECTS[raw].includes('campfire'), `${raw}'s ✦ line says a fire cooks it`);
  }
  const rare = ITEMS.filter((i) => i.cooked).map((i) => i.id);
  assert.eq(rare.length, Object.keys(COOKED_FOODS).length + 1, 'every dish is flagged cooked, meat included');
});

test('campfire: the cooked icons are one baked sheet, a frame per dish, all art', () => {
  const ids = Object.values(COOKED_FOODS).map((c) => c.id);
  ids.forEach((id, i) => {
    assert.eq(MINERAL_ICON_SHEET[id].sheet, 'icon_cooked');
    assert.eq(MINERAL_ICON_SHEET[id].frame, i, `${id} sits at frame ${i}`);
  });
  const dims = pngDims('assets/Icons/Food Icons/Cooked.png');
  assert.truthy(dims, 'Cooked.png exists');
  assert.eq(dims.w, 16 * ids.length, 'one 16px frame per dish');
  assert.eq(dims.h, 16);
  assert.truthy(/icon_cooked:\s*\{ url: 'assets\/Icons\/Food Icons\/Cooked\.png',\s*cols: Object\.keys\(COOKED_FOODS\)\.length/.test(APP_JS_SRC),
    'ICON_SHEETS loads the sheet');
});

test('campfire: a held potato becomes a baked potato', () => {
  const { scene, calls } = fireScene();
  const ctx = fireCtx(scene, [{ id: 'potato', count: 2 }]);
  assert.eq(fireHeld.try(ctx), true);
  assert.eq(scene.invCount('baked_potato'), 1);
  assert.eq(calls.burn.length, 0, 'no burn question');
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
  const ctx = fireCtx(scene, [{ id: 'berry', count: 2 }]);
  assert.eq(fireHeld.try(ctx), true);
  assert.eq(calls.burn[0], 'berry', 'the burn confirm is asked about the held item');
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

test('campfire: two potions TRANSMUTE, same tier only; the rest EXPLODE', () => {
  for (const [from, to] of Object.entries(POTION_FIRE_TRANSMUTE)) {
    assert.truthy(isPotion(from) && isPotion(to), `${from} → ${to} are both potions`);
    assert.eq(ITEM_BY_ID[to].baseTier, ITEM_BY_ID[from].baseTier, `${from} → ${to} never climbs the ladder`);
    assert.eq(fireBurnOutcome(from).transmute, to);
  }
  assert.eq(Object.keys(POTION_FIRE_TRANSMUTE).length, 2, 'a couple, not all');
  const potions = ITEMS.filter(i => isPotion(i.id)).map(i => i.id);
  assert.gt(potions.length, 4, 'the potion predicate finds the potions');
  for (const id of potions) {
    if (POTION_FIRE_TRANSMUTE[id]) continue;
    assert.eq(fireBurnOutcome(id).blastDmg, POTION_BLAST_DMG_PER_TIER * ITEM_BY_ID[id].baseTier,
      `${id} explodes for its tier's blast`);
  }
  assert.eq(JSON.stringify(fireBurnOutcome('potato')), '{}', 'not a potion: plain ash');
  assert.falsy(isPotion('honey'), 'honey is not a potion');
});

test('campfire: a potion blast is a blow on the body — armour soaks it', () => {
  // Mirrors app.js _potionBlast: through Combat.playerDamage, never raw.
  const src = APP_JS_SRC.match(/_potionBlast\(rawDmg, fire\) \{[\s\S]*?\n  \}/)[0];
  assert.truthy(/Combat\.playerDamage\(rawDmg, this\.save\.armor\)/.test(src), 'armour soaks the blast');
  assert.truthy(/Combat\.playerDowned\(before\)/.test(src), 'nothing off an empty bar');
  assert.truthy(/_flashPlayerHit\(/.test(src) && /_popEnergy\(-lost\)/.test(src), 'flinch + −N⚡ pop');
  const worn = { chest: { tier: 7 }, helmet: { tier: 7 } };
  const raw = fireBurnOutcome('resurrection_potion').blastDmg;
  assert.truthy(Combat.playerDamage(raw, worn) < raw, 'heavy armour takes the edge off');
});

test('flint: the coal item is called Flint everywhere the player reads it', () => {
  assert.eq(ITEM_BY_ID.coal.name, 'Flint', 'id kept (saves carry it), name changed');
  assert.truthy(/campfire/i.test(ITEM_EFFECTS.coal), 'still says it makes a campfire');
  assert.falsy(/\bcoal\b/i.test(ITEM_EFFECTS.coal), 'no "coal" in its ✦ line');
  const quoted = APP_JS_SRC.match(/(['`])[^'`\n]*\bcoal\b[^'`\n]*\1/gi) || [];
  const shown = quoted.filter(q => !/^['`](coal|coal_icon)['`]$/.test(q) && !/assets\//.test(q));
  assert.eq(shown.length, 0, 'no player-facing "coal" string in app.js: ' + shown.join(' | '));
});

test('every src/*.js module PARSES (a stray brace once shipped app.js dead)', () => {
  // Compiled in run.js (vm.Script, never executed) — see SRC_PARSE_ERRORS.
  assert.eq(JSON.stringify(SRC_PARSE_ERRORS), '{}', 'modules that fail to parse');
});

test('campfire: the first fire lit tells its story, through the story ledger', () => {
  const src = INTERACT_SRC;
  const place = src.slice(src.indexOf("{ name: 'light-fire'"), src.indexOf("{ name: 'place-magic-trap'"));
  assert.truthy(/scene\._storySplashOnce\?\.\('fire', \{\s*art: 'fire_first'/.test(place),
    'light-fire opens the fire story once per save');
  assert.truthy(/who knows what could happen when you cook things\?/.test(place), 'it teases cooking');
  assert.truthy(pngDims('assets/art/fire_first.png'), 'the banner exists');
});
