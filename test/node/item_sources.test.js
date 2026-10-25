// Every item a loot roll, a chest or the trader can hand over must be one the
// bag accepts, and every item that opts out of rolls (dropWeight 0) must stay
// out of them. Found by the Oct 2026 obtainability audit: chests rolled live
// animals (the bag refuses kind 'animal', so the ceremony said "bag full"),
// the trader offered them and took the ask for nothing, and the hive's syrup
// (dropWeight 0) fell out of shrine and vista rolls anyway.
function seededRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('item sources: no chest group lists a live animal, and none keeps a dropWeight-0 item', () => {
  let groups = 0;
  for (const group of Object.keys(ChestThemes.groups)) {
    for (const id of Object.keys(ChestThemes.members(group))) {
      const item = ITEM_BY_ID[id];
      assert.truthy(item, `${group}: ${id} is a catalog item`);
      assert.truthy(item.kind !== 'animal', `${group}: ${id} is not a live animal — the bag refuses one`);
      assert.truthy(item.dropWeight !== 0, `${group}: ${id} opted out of rolls`);
    }
    groups++;
  }
  assert.gt(groups, 20, 'the groups were walked');
  assert.falsy(ChestThemes.groups.farmAnimals, 'the farm-animal lane is gone');
});

test('item sources: the trader never offers a live animal', () => {
  const prices = Shops.traderPrices();
  for (const item of ITEMS) {
    if (item.kind === 'animal') assert.falsy(Object.hasOwn(prices, item.id), `${item.id} is not priced`);
  }
  for (let tier = 1; tier <= Shops.SHOP_TIER_MAX; tier++) {
    for (const id of Shops.traderStock(tier)) assert.truthy(ITEM_BY_ID[id]?.kind !== 'animal', `${id} at tier ${tier}`);
  }
  // And the barter pays only once the bag can hold the offer: the add's
  // refusal is silent, so paying first would take the ask for nothing.
  const accept = ALL_SRC['scene_shops.js'].slice(ALL_SRC['scene_shops.js'].indexOf('presentTraderOffer('));
  assert.lt(accept.indexOf('Inventory.roomFor(this.save, offer.giveId) < giveQty'), accept.indexOf('Inventory.remove(this.save, offer.askId, offer.askQty)'),
    'room is checked before the ask is removed');
});

test('item sources: a dropWeight of 0 keeps an item out of every roll', () => {
  const optedOut = ITEMS.filter(i => i.dropWeight === 0).map(i => i.id);
  assert.includes(optedOut, 'syrup', 'the hive\'s syrup opts out');
  const seen = new Set();
  for (const ctx of ['treasure:shrine', 'treasure:vista', 'chest:food', 'chest:farm', 'chest:culture']) {
    for (let i = 0; i < 1500; i++) {
      const r = pickReward(ctx, { relics: {}, armor: {} }, seededRng(i + 7), { tier: 1 + (i % 7) });
      if (!r || r.kind !== 'item') continue;
      seen.add(r.id);
      assert.falsy(optedOut.includes(r.id), `${ctx} rolled ${r.id}`);
      assert.truthy(ITEM_BY_ID[r.id]?.kind !== 'animal', `${ctx} rolled a live ${r.id}`);
    }
  }
  assert.gt(seen.size, 30, 'the rolls covered real variety');
  // The fort's slot machine keeps the same gates as the rolls.
  const slots = ALL_SRC['scene_venues.js'].slice(ALL_SRC['scene_venues.js'].indexOf('fortSlotMachine('));
  assert.truthy(/&& !it\.progressionOnly && !it\.caveOnly && !it\.shiny\s*&& it\.dropWeight !== 0\)/.test(slots),
    'no progression ware, nothing cave-only, no shiny, no opted-out item on the reels');
});
