// Badged icons: Crops.png has ONE generic seed bag for every crop on it, and
// the three tree saplings share one young-tree frame — so each of those wears
// the icon of what it yields in its corner (items.js › iconBadgeItem, baked
// into ITEM_DATA_URLS in app.js create()). What this defends is "no two items
// look alike".

(function () {
const app = APP_JS_SRC;
const iconKey = (id) => JSON.stringify(inventoryIconSource(id));

test('icon badges: every item sharing its base art is told apart by its badge', () => {
  // Group items by base art; inside any group of 2+, (base, badge) must differ.
  const byBase = new Map();
  for (const it of ITEMS) {
    // No sheet source = the icon is its own bake off a world sprite (the
    // animals, the scarecrow) — one picture per item, nothing shared.
    if (!inventoryIconSource(it.id)) continue;
    const k = iconKey(it.id);
    if (!byBase.has(k)) byBase.set(k, []);
    byBase.get(k).push(it.id);
  }
  // Shiny variants reuse their base animal's art on purpose (renderItemIcon
  // recolours them), so they are not a collision.
  let shared = 0;
  for (const ids of byBase.values()) {
    const plain = ids.filter(id => !ITEM_BY_ID[id].shiny && !ITEM_BY_ID[id].base);
    if (plain.length < 2) continue;
    shared++;
    const badges = plain.map(iconBadgeItem);
    for (let i = 0; i < plain.length; i++) {
      assert.truthy(badges[i], `${plain[i]} shares its art with ${plain.filter((_, j) => j !== i).join(', ')} and has no badge`);
    }
    assert.eq(new Set(badges).size, plain.length, `badges tell ${plain.join(', ')} apart`);
  }
  assert.truthy(shared >= 1, 'the Crops.png seed bag is shared');
});

test('icon badges: the three saplings are told apart', () => {
  // Three sheets, one picture: their young-tree frames are the same pixels,
  // which a sheet-key comparison can't see — so the trio is pinned by name.
  const ids = ['apple_sapling', 'peach_sapling', 'acorn'];
  const badges = ids.map(iconBadgeItem);
  assert.truthy(badges.every(Boolean), 'each sapling wears a badge');
  assert.eq(new Set(badges).size, ids.length, 'and no two wear the same one');
});

test('icon badges: derived from what the item yields', () => {
  assert.eq(iconBadgeItem('rainberry_seed'), 'rainberry', 'a seed badges its crop');
  assert.eq(iconBadgeItem('apple_sapling'), 'apple', 'a fruit sapling badges its fruit');
  assert.eq(iconBadgeItem('acorn'), 'wood', 'a timber tree badges its wood');
  assert.eq(iconBadgeItem('potato_seed'), null, 'Spring Crops seeds have their own art');
  assert.eq(iconBadgeItem('rainberry'), null, 'produce is not badged');
  assert.eq(iconBadgeItem('nope'), null, 'unknown ids are null');
});

test('icon badges: create() bakes each one into ITEM_DATA_URLS', () => {
  assert.truthy(/const badgeId = iconBadgeItem\(it\.id\);/.test(app), 'the bake reads the one rule');
  assert.truthy(/window\.ITEM_DATA_URLS\[it\.id\] = out\.toDataURL\(\);/.test(app), 'into ITEM_DATA_URLS');
});
})();
