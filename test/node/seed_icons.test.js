// Seed icons: Crops.png has ONE generic seed bag for every crop on it, so the
// inventory icon is that bag badged with the crop's own produce
// (items.js › seedBadgeFrame, baked into ITEM_DATA_URLS in app.js create()).
// What this defends is "no two seeds look alike".

(function () {
const app = APP_JS_SRC;

test('seed icons: every Crops.png seed is badged with its OWN produce frame', () => {
  const seen = new Map();
  for (const it of ITEMS.filter(i => i.kind === 'seed')) {
    const f = seedBadgeFrame(it.id);
    if (CROP_SPRITE[it.grows]) {
      assert.eq(f, null, `${it.id} has seed art of its own — no badge`);
      continue;
    }
    assert.eq(f, inventoryIconSource(it.grows).frame, `${it.id} badges the ${it.grows} produce icon`);
    assert.falsy(seen.has(f), `${it.id} shares its badge with ${seen.get(f)}`);
    seen.set(f, it.id);
  }
  assert.truthy(seen.size >= 2, 'there are Crops.png seeds to badge');
  assert.eq(seedBadgeFrame('rainberry'), null, 'produce is not a seed');
  assert.eq(seedBadgeFrame('nope'), null, 'unknown ids are null');
});

test('seed icons: create() bakes the badged bag for each one', () => {
  assert.truthy(/const badge = seedBadgeFrame\(it\.id\);/.test(app), 'the bake reads the one table');
  assert.truthy(/window\.ITEM_DATA_URLS\[it\.id\] = c\.toDataURL\(\);/.test(app), 'into ITEM_DATA_URLS');
});
})();
