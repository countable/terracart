// THE DIAMOND IS THE FROST JEWEL.
//
// The gem ladder was sapphire 4 / ruby 5 / emerald 6 with nothing at the top:
// the Frost (T7) mineralrock rolled a T6 emerald or a T5 ruby, and a T7 ring
// was cut around 32 rubies like a bigger T6. The diamond fills the rung —
// mined from the T7 rock as its headline gem, and what every T7 piece of
// jewelry (ring / staff / amulet) is cut around instead of the slot's own gem.
//
(function () {
const app = SCENE_SRC;
const inter = INTERACTABLES_SRC;

// ── Registry ────────────────────────────────────────────────────────────────
test('diamond: is the T7 mineral at the top of the gem ladder, with a price and an effect line', () => {
  const it = ITEM_BY_ID.diamond;
  assert.truthy(it, 'diamond is registered');
  assert.eq(it.name, 'Diamond', 'display name');
  assert.eq(it.kind, 'ores', 'kind — the rarity class the rocks and chests draw from');
  assert.eq(it.baseTier, 7, 'baseTier — Frost');
  assert.eq(BASE_TIER.diamond, 7, 'BASE_TIER row');
  assert.eq(BASE_TIER.sapphire, 4, 'the ladder below it: sapphire 4');
  assert.eq(BASE_TIER.ruby, 5, 'ruby 5');
  assert.eq(BASE_TIER.emerald, 6, 'emerald 6');
  assert.truthy(PRICES.diamond > PRICES.emerald, 'worth more than the emerald below it');
  assert.truthy(PRICES.diamond > PRICES.platinum_bar, 'worth more than a platinum bar');
  assert.truthy(PRICES.diamond < PRICES.crimson_bar, 'but a smelted crimson bar still out-prices it');
  assert.truthy(ITEM_EFFECTS.diamond, 'diamond has narrative copy');
  assert.truthy(!('icon' in it), 'no emoji icon field — it renders as its sprite everywhere');

});

test('diamond: selected art reaches the shared inventory resolver', () => {
  const src = MINERAL_ICON_SHEET.diamond;
  assert.eq(src.sheet, SelectedItemArt.icons.diamond.sheet);
  assert.eq(src.frame, SelectedItemArt.icons.diamond.frame);
  const via = inventoryIconSource('diamond');
  assert.eq(via.sheet, src.sheet);
  assert.eq(via.frame, src.frame);
});

test('diamond: gems retain distinct artwork after selected replacements', () => {
  const seen = new Set();
  for (const id of ['diamond', 'ruby', 'sapphire', 'emerald']) {
    const src = inventoryIconSource(id);
    const key = `${src.sheet}:${src.frame}`;
    assert.falsy(seen.has(key), `${id} does not share another gem's art`);
    seen.add(key);
  }
});

// ── Drop source ─────────────────────────────────────────────────────────────
test('diamond: the T7 mineralrock lists the diamond FIRST — it is the Frost rock\'s headline gem', () => {
  const m = inter.match(/const GEM_BY_TIER = \{([^}]*)\};/);
  assert.truthy(m, 'GEM_BY_TIER exists in the mineralrock handler');
  const table = m[1];
  const t7 = table.match(/7:\s*\[([^\]]*)\]/);
  assert.truthy(t7, 'a tier-7 row');
  const gems = t7[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  assert.eq(gems[0], 'diamond', 'diamond is the primary (first) entry');
  assert.truthy(gems.includes('emerald'), 'the emerald stays as its secondary');
  for (const g of gems) assert.truthy(ITEM_BY_ID[g] && ITEM_BY_ID[g].kind === 'ores', `${g} is a real mineral`);
  // The rungs below are untouched — one gem each, in ladder order.
  assert.truthy(/4:\s*\['sapphire'\]/.test(table), 'T4 → sapphire');
  assert.truthy(/5:\s*\['ruby'\]/.test(table), 'T5 → ruby');
  assert.truthy(/6:\s*\['emerald'\]/.test(table), 'T6 → emerald');
  // …and the roll really reads the list (pickFromArray), so "first" is a
  // real primary only because the list is what gets rolled.
  assert.truthy(/const gemId = quarryItem \|\| pickFromArray\(gems\);/.test(inter), 'outside quarries the drop rolls GEM_BY_TIER[t]');
});

// ── Gear ────────────────────────────────────────────────────────────────────
test('diamond: the T7 staff recipe is cut around seven diamonds and a frost bar', () => {
  for (const slot of ['staff']) {
    const r = Gear.blacksmithRecipe('relic', slot, 7);
    assert.truthy(Array.isArray(r) && r.length === 2, `${slot} T7 has a gem line and a bar line`);
    assert.eq(r[0].id, 'diamond', `${slot} T7 wants diamonds`);
    assert.eq(r[0].qty, 7, `${slot} T7 takes one gem per tier`);
    assert.eq(r[1].id, 'frost_bar', `${slot} T7 plus one frost bar`);
    assert.eq(r[1].qty, 1, 'one bar');
    // Every ingredient resolves in the catalogue — the smithy modal names
    // them through ITEM_BY_ID and renders them through the icon tables.
    for (const line of r) {
      assert.truthy(ITEM_BY_ID[line.id], `${line.id} is a real item`);
      assert.truthy(inventoryIconSource(line.id), `${line.id} has an icon source`);
    }
  }
  // Below T7 the staff is set with its own tier's gem — the diamond is the Frost rung only.
  for (let t = 2; t <= 6; t++) {
    const r = Gear.blacksmithRecipe('relic', 'staff', t);
    assert.eq(r[0].id, gemForTier(t), `staff T${t} wants its tier's gem`);
    assert.truthy(r[0].id !== 'diamond', `staff T${t} is not cut around diamonds`);
    assert.eq(r[0].qty, t, `staff T${t} takes ${t} gems`);
  }
  // Tools never ask for a gem.
  const pick = Gear.blacksmithRecipe('relic', 'pickaxe', 7);
  assert.eq(JSON.stringify(pick), JSON.stringify([{ id: 'frost_bar', qty: 7 }]), 'a T7 pick is bars only');
});

// ── Deliveries ──────────────────────────────────────────────────────────────
test('diamond: sits in the mining wishlist pool, in ladder order beside the frost bar', () => {
  const pool = Delivery.BUNDLE_THEMES.mining;
  const i = pool.indexOf('diamond');
  assert.truthy(i > 0, 'diamond is in the mining pool');
  assert.truthy(i > pool.indexOf('emerald'), 'after the emerald');
  assert.truthy(i > pool.indexOf('crimson_bar'), 'after the T6 bar');
  assert.eq(pool[i + 1], 'frost_bar', 'immediately before the frost bar — gem then bar, per tier');
  assert.eq(Delivery.produceTier('diamond'), 7, 'the pool reads its tier from the catalogue');
});

// ── Rarity ──────────────────────────────────────────────────────────────────
test('diamond: the rarity picker can hand one out of a mineral-heavy cave chest', () => {
  function seeded(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // T5 is the cave chest (chestTierMod's top row): its chain reaches T5 on
  // its own and its maxTier is 7, so only a jackpot climbs the last two
  // rungs — rare by design, which is why the seed count is generous.
  let seen = 0;
  for (let s = 1; s <= 6000; s++) {
    const r = pickReward('chest:culture', { relics: {}, armor: {} }, seeded(s), { tier: 5 });
    if (r && r.kind === 'item' && r.id === 'diamond') {
      seen++;
      assert.eq(r.tier, 7, 'rolled as a T7 item');
      assert.eq(r.cls, 'ores', 'from the mineral class');
      assert.truthy(r.qty >= 1, 'at least one');
    }
  }
  assert.truthy(seen > 0, 'diamond rolled at least once in 6000 T5 cultural chests');
});
})();
