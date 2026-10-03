// Guild badges: a carried badge takes its row's guildDiscount (items.js
// CARRIED_ITEM_SPEC) off every deal with its guild — the themed shop's price,
// the smith's forge and smelt materials, the trader's ask. One helper
// (guildDiscounted) applies it; Houses.guildRole names the guild of a place.

(function () {

const BADGES = { blacksmith: 'guild_blacksmith', market: 'guild_market', trader: 'guild_trader' };
const carrying = (id) => ({ inv: id ? [{ id, count: 1 }] : [], relics: {} });

test('guild badges: each guild has one carried treasure with shipped art and a description', () => {
  for (const [role, id] of Object.entries(BADGES)) {
    const item = ITEM_BY_ID[id];
    assert.truthy(item, `${id}: catalog entry`);
    assert.eq(item.kind, 'unique_relic', `${id}: a unique carried treasure`);
    assert.eq(CARRIED_ITEM_SPEC[id].guildRole, role, `${id}: discounts the ${role}`);
    assert.eq(CARRIED_ITEM_SPEC[id].guildDiscount, 0.1, `${id}: ten percent`);
    assert.truthy(PRICES[id] > 0, `${id}: priced`);
    assert.truthy(ITEM_EFFECTS[id], `${id}: description`);
    const src = inventoryIconSource(id);
    assert.truthy(APP_JS_SRC.includes(`  ${src.sheet}: { url: 'assets/Icons/Items/${id}.png', cols: 1, srcW: 16, srcH: 16 }`),
      `${id}: DOM icon sheet points at its art`);
    assert.truthy(pngDims(`assets/Icons/Items/${id}.png`), `${id}: PNG shipped`);
  }
});

test('guild badges: found in treasure like every other unique relic', () => {
  const relics = ChestThemes.eligible('uniqueRelics', 7);
  for (const id of Object.values(BADGES)) assert.includes(relics, id);
});

test('guildDiscounted: ten percent off its own guild only, half a unit to the player, never below one', () => {
  const smith = carrying('guild_blacksmith');
  assert.eq(guildDiscounted(carrying(null), 'blacksmith', 50), 50, 'no badge, no discount');
  assert.eq(guildDiscounted(smith, 'market', 50), 50, 'another guild pays full');
  assert.eq(guildDiscounted(smith, null, 50), 50, 'no guild at all');
  assert.eq(guildDiscounted(smith, 'blacksmith', 50), 45);
  assert.eq(guildDiscounted(smith, 'blacksmith', 5), 4, 'five bars become four');
  assert.eq(guildDiscounted(smith, 'blacksmith', 3), 3, 'a sub-half saving rounds away');
  assert.eq(guildDiscounted(smith, 'blacksmith', 1), 1, 'never below one');
  assert.eq(guildDiscount(carrying('guild_trader'), 'trader'), 0.1);
  assert.eq(guildDiscount(carrying('guild_market'), 'market'), 0.1);
});

test('Houses.guildRole: a house by its role, a peddler by its trade', () => {
  const save = { restoredHouses: { s: 'blacksmith', m: 'market', t: 'trader', p: 'plain' } };
  const h = (id) => ({ id, kind: 'house', tier: 9 });
  assert.eq(Houses.guildRole(save, h('s')), 'blacksmith');
  assert.eq(Houses.guildRole(save, h('m')), 'market');
  assert.eq(Houses.guildRole(save, h('t')), 'trader');
  assert.eq(Houses.guildRole(save, h('p')), null);
  assert.eq(Houses.guildRole(save, { kind: 'npc', role: 'merchant' }), 'market', 'a merchant keeps a themed shop');
  assert.eq(Houses.guildRole(save, { kind: 'npc', role: 'trader' }), 'trader');
  assert.eq(Houses.guildRole(save, { kind: 'npc', role: 'farmer' }), null);
  assert.eq(Houses.guildRole(save, null), null);
});

// The scene's deal builders, lifted out of SCENE_SRC (app.js can't load
// headlessly) and run on a stub scene.
const lift = (name) => {
  const start = SCENE_SRC.indexOf('\n  ' + name + '(');
  assert.truthy(start > 0, `found ${name}`);
  return SCENE_SRC.slice(start, SCENE_SRC.indexOf('\n  }\n', start) + 4);
};
const lifted = (...names) => {
  const one = (name) => {
    const start = SCENE_SRC.indexOf('\n  ' + name + '(');
    const line = SCENE_SRC.slice(start, SCENE_SRC.indexOf('\n', start + 1));
    // A one-line method ends on its own line.
    return line.trim().endsWith('}') ? line : lift(name);
  };
  return (0, eval)('({' + names.map(one).join(',') + '})');
};
const PROTO = lifted('guildPrice', 'buildShopOffer', 'peekOrBuildTraderOffer', 'presentBlacksmithOffer', 'presentSmeltOffer');

function scene(role, badge) {
  const save = carrying(badge);
  save.money = 1000;
  save.restoredHouses = { h: role };
  return Object.assign(Object.create(PROTO), {
    save,
    shopRng: () => () => 0,
    shopCharmMul: () => 1,
    moneyHTML: n => String(n),
    iconSpanHTML: () => '',
    gearIconHTML: () => '',
    _trailRewardBlurb: () => '',
    _makeRerollSecondary: () => undefined,
    traderGivePick: () => ({ rng: () => 0, giveId: 'potato_seed' }),
    showOfferModal(offer) { this.offer = offer; },
  });
}
const HOUSE = { id: 'h', kind: 'house', tier: 9 };

test('guild badge: the market badge cuts a themed shop’s cash price', () => {
  const plain = scene('market', null).buildShopOffer('potato_seed', 100, { house: HOUSE });
  const badged = scene('market', 'guild_market').buildShopOffer('potato_seed', 100, { house: HOUSE });
  const wrong = scene('market', 'guild_trader').buildShopOffer('potato_seed', 100, { house: HOUSE });
  const full = Number(plain.label);
  assert.eq(Number(badged.label), full - Math.round(full * 0.1));
  assert.eq(Number(wrong.label), full, 'the wrong guild’s badge buys nothing');
});

test('guild badge: the trader badge trims the ask', () => {
  const ask = (badge) => {
    const s = scene('trader', badge);
    s.save.inv.push({ id: 'wood', count: 500 });
    return s.peekOrBuildTraderOffer(HOUSE);
  };
  const plain = ask(null), badged = ask('guild_trader');
  assert.eq(badged.askId, plain.askId, 'the same deal');
  assert.eq(badged.askQty, guildDiscounted(carrying('guild_trader'), 'trader', plain.askQty));
});

test('guild badge: the smiths’ badge trims every forge ingredient', () => {
  const offer = { kind: 'relic', slot: 'axe', tier: 3 };
  const listed = Gear.blacksmithRecipe('relic', 'axe', 3);
  const s = scene('blacksmith', 'guild_blacksmith');
  s.presentBlacksmithOffer(0, 0, offer, () => {}, HOUSE);
  for (const r of listed) {
    assert.includes(s.offer.cost, `${guildDiscounted(s.save, 'blacksmith', r.qty)}× `);
  }
  assert.truthy(listed.some(r => guildDiscounted(s.save, 'blacksmith', r.qty) < r.qty), 'something is saved');
});

test('guild badge: the smiths’ badge trims a smelting batch as a whole', () => {
  const s = scene('blacksmith', 'guild_blacksmith');
  s.save.inv.push({ id: 'sunflower', count: 9 }, { id: 'gold_bar', count: 9 });
  s.presentSmeltOffer(0, 0, HOUSE, () => {}, () => {}, 'platinum_bar');
  assert.eq(s.offer.quantity.max, 10, 'ten bars for nine of each');
  assert.includes(s.offer.quantity.format(10).cost, '9× ');
});

})();
