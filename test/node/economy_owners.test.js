// The economy's owning tables and the readers that must go through them
// (footprint review, Oct 2026): one price lane (itemValue), one tier lookup
// (itemTierOf), one bar ladder (MINERAL_TIERS → barForTier / BAR_IDS), one
// re-roll ladder family (ShopsMath), one recipe counter and one deal tail in
// the shop presenters, and the consumable table's buff / tome / throwable
// columns.
(function () {
const SHOPS_SRC = ENERGY_WRITE_SOURCES['scene_shops.js'];

test('economy: every item a shop line or the supply shelf can stock has a real value, never the $1 fallback', () => {
  const ids = new Set();
  for (const [theme, pool] of Object.entries(Shops.THEME_POOL)) {
    if (theme === 'relic') continue;
    for (const id of pool()) ids.add(id);
  }
  for (const id of Shops.THEME_POOL.supply()) ids.add(id);
  assert.gt(ids.size, 20, 'the lines are populated');
  for (const id of ids) {
    const v = itemValue(id);
    assert.truthy(Number.isFinite(v) && v >= 1, `${id}: a value`);
    if (PRICES[id] == null) assert.gt(v, 1, `${id}: an unpriced item is worth its tier, not $1`);
  }
  // The seven that fell through to $1 at the trader and the delivery door.
  for (const id of ['deer', 'rabbit', 'crow', 'sea_turtle', 'apple_sapling', 'peach_sapling', 'wood']) {
    assert.gt(itemValue(id), 1, `${id}: worth more than a coin`);
  }
});

test('economy: no shop presenter reads PRICES directly — every worth is itemValue', () => {
  assert.falsy(/PRICES\[/.test(SHOPS_SRC), 'scene_shops.js has no PRICES[ reader');
  assert.truthy(/prices: itemValues\(\)/.test(SHOPS_SRC), 'the trader asks over every item\'s value');
  const vals = itemValues();
  for (const it of ITEMS) assert.eq(vals[it.id], itemValue(it.id), `${it.id} in the ask map`);
});

test('economy: the smithy prices its offer off the shared markup range', () => {
  assert.truthy(/const \{ lo, hi \} = buyMarkupRange\(save\.relics\);/.test(GEAR_JS_SRC), 'gear.js reads buyMarkupRange');
  assert.falsy(/1\.2 \+ rng\(\) \* 1\.8/.test(GEAR_JS_SRC), 'and no longer its own 1.2..3.0');
  const save = { relics: {}, armor: {} };
  const { lo, hi } = buyMarkupRange();
  for (const r of [0, 0.5, 0.999]) {
    const o = Gear.buildRelicOffer(save, () => r);
    const base = gearPrice(o.kind, o.slot, o.tier);
    assert.eq(o.price, Math.max(1, Math.ceil(base * (lo + r * (hi - lo)))), `markup at ${r}`);
  }
});

test('economy: one tier lookup, one bar ladder', () => {
  assert.eq(itemTierOf('no_such_item'), 0);
  assert.eq(itemTierOf('no_such_item', 1), 1, 'a fallback for the stock readers');
  assert.eq(fishTier('minnow'), itemTierOf('minnow', 1));
  assert.eq(Shops.itemTier('rainberry'), itemTierOf('rainberry', 1));
  assert.eq(JSON.stringify(BAR_IDS), JSON.stringify(['wood', 'copper_bar', 'iron_bar', 'gold_bar', 'platinum_bar', 'crimson_bar', 'frost_bar']));
  for (let t = 1; t <= 7; t++) assert.eq(barForTier(t), BAR_IDS[t - 1]);
  assert.eq(barForTier(0), null); assert.eq(barForTier(8), null);
  assert.eq(JSON.stringify(Gear.smeltUnlockedBars()), JSON.stringify(['platinum_bar', 'crimson_bar', 'frost_bar']));
  assert.eq(JSON.stringify(Gear.smeltingRecipe('platinum_bar')), JSON.stringify([{ id: 'sunflower', qty: 1 }, { id: 'gold_bar', qty: 1 }]));
  assert.eq(JSON.stringify(Gear.smeltingRecipe('crimson_bar')), JSON.stringify([{ id: 'fireflower', qty: 1 }, { id: 'platinum_bar', qty: 1 }]));
  assert.eq(JSON.stringify(Gear.smeltingRecipe('frost_bar')), JSON.stringify([{ id: 'iceflower', qty: 1 }, { id: 'crimson_bar', qty: 1 }]));
  assert.eq(Gear.smeltingRecipe('gold_bar'), null);
  assert.eq(Gear.blacksmithRecipe('relic', 'pickaxe', 4)[0].id, 'gold_bar');
  assert.falsy(/BAR_BY_TIER/.test(GEAR_JS_SRC), 'gear.js keeps no ladder of its own');
});

test('economy: Gear.gearTier / canUpgrade are the one downgrade guard', () => {
  const save = { relics: { pickaxe: { tier: 3 } }, armor: {} };
  assert.eq(Gear.gearTier(save, 'relic', 'pickaxe'), 3);
  assert.eq(Gear.gearTier(save, 'armor', 'helmet'), 0);
  assert.falsy(Gear.canUpgrade(save, 'relic', 'pickaxe', 3), 'the same tier is no upgrade');
  assert.truthy(Gear.canUpgrade(save, 'relic', 'pickaxe', 4));
  assert.falsy(Gear.canUpgrade(save, 'relic', 'pickaxe', 9), 'no such tier');
  assert.falsy(Gear.canUpgrade(save, 'relic', 'no_such_slot', 2));
  Gear.equip(save, 'relic', 'pickaxe', 2);
  assert.eq(save.relics.pickaxe.tier, 3, 'equip refuses a downgrade through the same guard');
  assert.truthy(/Gear\.canUpgrade\(this\.save, offer\.kind, offer\.slot, offer\.tier\)/.test(SHOPS_SRC), 'the shops ask it');
  assert.falsy(/this\.save\.relics\?\.\[offer\.slot\]\?\.tier/.test(SHOPS_SRC), 'and keep no ternary of their own');
});

test('economy: one re-roll ladder family — the trader re-rolls at the smith\'s price', () => {
  for (let n = 0; n < 8; n++) assert.eq(ShopsMath.traderRerollCost(n), ShopsMath.smithyRerollCost(n), `rung ${n}`);
  assert.eq([0, 1, 2, 3].map(ShopsMath.traderRerollCost).join(), '5,7,10,15');
  assert.falsy(/5 \* Math\.pow\(2/.test(SHOPS_SRC), 'the doubling ladder is gone');
  assert.falsy(/_traderRerollSecondary\(sx, sy, house, recordDeal, offer\) \{[\s\S]{0,400}?label:/.test(SHOPS_SRC),
    'the trader builds no button of its own');
});

test('economy: one shortfall, one purse denial, one bag-full line across the counters', () => {
  const purse = SHOPS_SRC.match(/Purse too light/g) || [];
  assert.eq(purse.length, 1, 'the purse denial is worded once (purseShort)');
  const bag = SHOPS_SRC.match(/Bag full/g) || [];
  assert.eq(bag.length, 1, 'the bag-full line is worded once (bagFullFor)');
  assert.falsy(/BAG_FULL_MSG/.test(SHOPS_SRC), 'no counter falls back to the generic pickup line');
  assert.falsy(/flash\(`need |flash\('need /.test(SHOPS_SRC), 'no bare "need N" totals');
  const settles = SHOPS_SRC.match(/this\._settleDeal\(/g) || [];
  assert.gte(settles.length, 8, 'every closed deal settles through the one tail');
  assert.falsy(/\n\s*recordDeal\(\);\s*\n\s*this\._finishInventoryChange\(\);/.test(SHOPS_SRC), 'none types the tail by hand');
  // Both refusals fit a map line at their widest (MAP_MSG_MAX per line): the
  // purse up to a six-figure price, the bag for the longest catalogue name.
  const lift = (name) => new Function(`return ${SHOPS_SRC.match(new RegExp(`const ${name} = (.*);`))[1]};`)();
  const purseLine = lift('purseShort'), bagLine = lift('bagFullFor');
  assert.lte([...purseLine(999999)].length, MAP_MSG_MAX, purseLine(999999));
  for (const it of ITEMS) {
    for (const line of bagLine(it.id).split('\n')) assert.lte([...line].length, MAP_MSG_MAX, `${it.id}: ${line}`);
  }
  assert.truthy(/^Bag full for\n/.test(bagLine('potato')) && /Potato\.$/.test(bagLine('potato')), 'the bag line names the stack');
});

test('economy: the recipe counter colours every ingredient and names the shortfall', () => {
  const lift = (name) => {
    const start = SCENE_SRC.indexOf(`\n  ${name}(`);
    return SCENE_SRC.slice(start + 1, SCENE_SRC.indexOf('\n  }\n', start) + 4);
  };
  const proto = (0, eval)('({' + ['_presentRecipeOffer', '_settleDeal'].map(lift).join(',') + '})');
  const flashes = [], made = [];
  const s = Object.assign(Object.create(proto), {
    save: { inv: [{ id: 'iron_bar', count: 2 }, { id: 'coal', count: 9 }] },
    iconSpanHTML: () => '', showOfferModal(o) { this.offer = o; },
    flash: (t) => flashes.push(t), _clampSelSlot() {}, _finishInventoryChange() {}, flashLoot() {},
  });
  s._presentRecipeOffer(0, 0, { recipe: [{ id: 'iron_bar', qty: 5 }, { id: 'coal', qty: 1 }],
    get: 'x', acceptLabel: 'Forge', produce: () => made.push(1) });
  assert.falsy(s.offer.canAfford);
  assert.truthy(s.offer.cost.includes(`color:${UI_DANGER_INK}`) && s.offer.cost.includes(`color:${UI_GREEN}`), 'short in red, covered in green');
  assert.eq(s.offer.costLabel, 'You give');
  s.offer.onAccept();
  assert.eq(flashes[0], `Need 3 more ${itemName('iron_bar')}`);
  assert.eq(made.length, 0);
  Inventory.add(s.save, 'iron_bar', 3);
  s.offer.onAccept();
  assert.eq(made.length, 1, 'produced once the bag covers it');
  assert.eq(Inventory.count(s.save, 'iron_bar'), 0);
  assert.eq(Inventory.count(s.save, 'coal'), 8);
  // The caller's own refusal runs first and consumes nothing.
  s._presentRecipeOffer(0, 0, { recipe: [{ id: 'coal', qty: 1 }], get: 'x', refuse: () => true, produce: () => made.push(2) });
  s.offer.onAccept();
  assert.eq(Inventory.count(s.save, 'coal'), 8);
  assert.eq(made.length, 1);
});

test('economy: CONSUMABLE_SPEC names each timed buff\'s Buffs row, each tome\'s potion, each throwable\'s button', () => {
  const buffed = Object.entries(CONSUMABLE_SPEC).filter(([, row]) => row.buff);
  assert.gte(buffed.length, 19, 'the timed rows carry a buff column');
  for (const [id, row] of buffed) {
    assert.truthy(Buffs.KINDS[row.buff], `${id}: '${row.buff}' is a Buffs.KINDS row`);
    assert.gt(row.durationMs, 0, `${id}: a duration to extend by`);
  }
  for (const id of ['speed_potion', 'protection_potion', 'shielding_potion', 'immortal_potion', 'fire_resistance_potion',
    'shrinking_potion', 'giant_potion', 'blight_potion', 'reach_potion', 'shadow_powder', 'dragon_powder', 'torch',
    'hardworking_potion', 'raven_scroll', 'bones_scroll', 'wraith_scroll']) {
    const row = CONSUMABLE_SPEC[id];
    assert.truthy(row.buff && row.used && row.used.title && row.used.body, `${id}: buff and the dialog it closes on`);
    const body = typeof row.used.body === 'function' ? row.used.body({ isTorchActive: () => false }, row) : row.used.body;
    const title = typeof row.used.title === 'function' ? row.used.title({ isTorchActive: () => true }) : row.used.title;
    assert.truthy(title.length > 4 && body.length > 10, `${id}: copy`);
    if (/\d/.test(body)) assert.truthy(body.includes(shortDuration(row.durationMs)), `${id}: a numeric wait is the row's`);
  }
  assert.eq(CONSUMABLE_SPEC.hardworking_potion.buff, 'work', 'the idol\'s lever row');
  for (const id of ['coffee', 'dawnfruit', 'miracle_lettuce', 'pairy']) assert.truthy(CONSUMABLE_SPEC[id].buff, `${id}: the eat lane\'s buffs too`);
  const tomes = Object.entries(CONSUMABLE_SPEC).filter(([, row]) => row.tome);
  assert.eq(tomes.length, 7, 'every tome but the firewall mirrors a potion');
  for (const [id, { tome }] of tomes) {
    assert.eq(tome.mul, 0.5, `${id}: half the potion`);
    assert.truthy(CONSUMABLE_SPEC[tome.of], `${id}: of a real row`);
    assert.truthy(tome.flash, `${id}: says something`);
  }
  assert.eq(CONSUMABLE_SPEC.tome_healing.tome.of, 'healing_potion');
  assert.eq(CONSUMABLE_SPEC.tome_thunder.tome.of, 'thunder_scroll');
  const throwables = Object.entries(CONSUMABLE_SPEC).filter(([, row]) => row.throwable);
  assert.eq(throwables.map(([id]) => id).join(), 'throwing_spear,javelin,rubble,forgetmenot,wildrose');
  const scene = { canThrowItem: (id) => id === 'throwing_spear', throwActionLabel: () => 'Throw' };
  assert.truthy(CONSUMABLE_SPEC.throwing_spear.usable(scene) && !CONSUMABLE_SPEC.throwing_spear.disabled(scene));
  assert.falsy(CONSUMABLE_SPEC.javelin.usable(scene)); assert.truthy(CONSUMABLE_SPEC.javelin.disabled(scene));
  assert.eq(CONSUMABLE_SPEC.rubble.label(scene), 'Throw');
  assert.eq((ITEMS_JS_SRC.match(/scene\.canThrowItem\(/g) || []).length, 2, 'the throw gate is typed once, not per row');
});

test('economy: the house-sign label rows live beside Shops.roleLabel', () => {
  assert.eq(Shops.BUILDING_LABEL.trailer, 'Home');
  assert.eq(Shops.BUILDING_LABEL[12], 'Castle'); assert.eq(Shops.BUILDING_LABEL[11], 'Fort'); assert.eq(Shops.BUILDING_LABEL[9], 'House');
  assert.eq(Object.keys(Shops.TOWER_LABEL).join(), 'locked,abandoned,empty,open');
  assert.eq(Shops.TOWER_LABEL.open, 'Wizard Tower');
});

test('economy: the colour literals in the economy modules read util\'s roles', () => {
  for (const [name, src] of [['items.js', ITEMS_JS_SRC], ['gear.js', GEAR_JS_SRC], ['shops_math.js', SHOPS_MATH_SRC], ['scene_shops.js', SHOPS_SRC]]) {
    assert.falsy(/#ffe066|#a7ffb0|#ff8a7a/i.test(src), `${name}: no raw gold / green / danger literal`);
  }
});
})();
