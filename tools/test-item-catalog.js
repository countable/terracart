// Standalone data regression: node tools/test-item-catalog.js
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const context = vm.createContext({ assert, console, addEventListener() {} });
context.window = context;
for (const file of ['src/util.js', 'src/difficulty.js', 'src/conditions.js', 'src/items.js', 'src/crops.js', 'src/loot.js', 'src/chest_themes.js', 'src/rarity.js', 'src/starter.js', 'tools/item-catalog-data.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
}
vm.runInContext(`
  const STARTER_STASH = [{ id: 'book', qty: 1 }];
  const STARTER_RELIC_SLOTS = ['pick'];
  const STARTER_RELIC_TIER = 1;
  const rows = ItemCatalog.build();
  const byId = new Map(rows.map(row => [row.id, row]));
  assert.equal(rows.length, ITEMS.length + (Object.keys(RELIC_DEFS).length + Object.keys(ARMOR_DEFS).length) * MATERIAL_TIERS.length);
  assert.equal(byId.size, rows.length);
  for (const row of rows) for (const source of row.chests) {
    if (!source.context.startsWith('chest:')) continue;
    const biome = source.context.slice(6);
    if (!source.depth) assert(source.tier <= ChestThemes.themes[biome].tier);
    else assert(biome !== 'roadside');
  }
  assert.equal(byId.get('armor:helmet:3').description, '−' + armorSlotReduction(3) + ' damage soaked');
  assert.equal(byId.get('armor:boots:7').description, '−' + armorSlotReduction(7) + ' damage soaked; ' + ARMOR_DEFS.boots.blurb);
  assert(byId.get('wood').chests.some(source => source.context === 'fixed:starter-supplies'));
  assert(byId.get('book').chests.some(source => source.context === 'fixed:starter-stash'));
  assert(byId.get('relic:pick:7').chests.some(source => source.context === 'fixed:starter-relic'));
  for (const it of ITEMS) {
    const row = byId.get(it.id);
    assert.equal(row.value, itemValue(it.id));
    assert.equal(row.description, (ITEM_EFFECTS[it.id] || '') + (it.kind === 'seed' && it.grows ? ' Watered stage: ' + shortDuration(Crops.stageHoldMs(it.grows)) + '.' : ''));
    if (it.kind === 'seed' && it.grows) assert.equal(row.growthStageMs, Crops.stageHoldMs(it.grows));
    if (it.shiny || it.cooked) assert.equal(row.chests.length, 0, it.id);
  }
  assert(byId.get('magic_trap').chests.length > 0);
  assert(byId.get('magic_trap').chests.every(source => source.depth > 0));
  assert(byId.get('diamond').chests.length > 0, 'rare jackpots are not lost');
  assert(byId.get('book').chests.some(source => source.context === 'chest:school' && source.tier === 1));
  for (const tier of MATERIAL_TIERS) {
    assert.equal(byId.get('relic:ring:' + tier.tier).chests.length, 0);
  }
  assert(!ItemCatalog.chestContents('chest:civic', 1).some(id => id.startsWith('armor:')));
  assert(!ItemCatalog.chestContents('chest:civic', 2).some(id => id.startsWith('armor:')), 'civic gear is noncombat equipment');
  assert(ItemCatalog.chestContents('chest:authority', 2).includes('armor:boots:3'));
  assert(!ItemCatalog.chestContents('chest:authority', 2).includes('armor:boots:4'));
  assert(byId.get('antidote').chests.some(source => source.context === 'chest:health'));
  assert(byId.get('elixir').chests.some(source => source.context === 'chest:health'));
  assert.equal(byId.get('antidote').category, 'magic');
  assert.equal(byId.get('magic_trap').category, 'supply');
  assert.equal(Object.keys(ChestThemes.themes).length, 14);
  // Every real sampled outcome must be inside the exhaustive set. Sampling
  // validates the table derivation; it never defines catalogue membership.
  let state = 12345;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (const key of Object.keys(ChestThemes.themes).map(theme => 'chest:' + theme)) {
    for (const depth of [0, 1]) for (let tier = 1; tier <= 5; tier++) {
      const eligible = new Set(ItemCatalog.chestContents(key, tier, depth));
      for (let n = 0; n < 200; n++) {
        const reward = pickReward(key, { relics: {}, armor: {} }, random, { tier, depth });
        if (!reward || reward.kind === 'gold') continue;
        const id = reward.kind === 'item' ? reward.id : reward.kind + ':' + reward.slot + ':' + reward.tier;
        assert(eligible.has(id), key + ' T' + tier + ' depth ' + depth + ': ' + id);
      }
    }
  }
  console.log('Item catalogue: ' + rows.length + ' rows; exhaustive eligibility and sampled outcomes pass.');
`, context);
