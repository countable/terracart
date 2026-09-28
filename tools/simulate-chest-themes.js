#!/usr/bin/env node
// Reproducible economic review. No simulation-specific copy of reward rules.
// node tools/simulate-chest-themes.js --baseline /path/to/baseline --out /tmp/chest-balance
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const samples = Number(option('--samples', 50000));
if (!Number.isInteger(samples) || samples < 1) throw new Error('--samples must be a positive integer');
const out = path.resolve(option('--out', '/tmp/chest-balance'));
const baselinePath = option('--baseline', null);
function load(dir) {
  const ctx = vm.createContext({ console, addEventListener() {} });
  ctx.window = ctx;
  for (const file of ['util', 'difficulty', 'conditions', 'items', 'crops', 'chest_themes', 'rarity']) {
    const source = path.join(dir, 'src', file + '.js');
    if (fs.existsSync(source)) vm.runInContext(fs.readFileSync(source, 'utf8'), ctx, { filename: source });
  }
  vm.runInContext(`
    globalThis.simulate = function(theme, chestTier, depth, samples, seed, rolledTier) {
      const rng = makeRng32(seed);
      const save = { relics: {}, armor: {} };
      const classes = {}, items = {}, quantities = {}, values = {}, groups = {};
      let sum = 0, fallbackCount = 0, gearCount = 0, cashOutCount = 0, equippedValue = 0, emptyCount = 0;
      for (let i = 0; i < samples; i++) {
        let reward = rolledTier ? resolveChestReward(theme, { tier: rolledTier, bracket: 0, jackpotApplied: 0 }, save, rng, { tier: chestTier, depth })
          : pickReward('chest:' + theme, save, rng, { tier: chestTier, depth });
        if (!reward) {
          if (typeof ChestThemes !== 'undefined') throw new Error('Empty reward: ' + theme);
          emptyCount++;
          reward = { kind: 'gold', amount: 1 }; // legacy chest interaction pays1g on a null picker
        }
        const id = reward.kind === 'item' ? reward.id : reward.slot ? (reward.gearKind || reward.kind) + ':' + reward.slot + ':' + reward.tier : 'cash';
        const cls = reward.kind === 'item' ? ITEM_BY_ID[reward.id].kind : reward.kind;
        classes[cls] = (classes[cls] || 0) + 1;
        items[id] = (items[id] || 0) + 1;
        groups[reward.group || cls] = (groups[reward.group || cls] || 0) + 1;
        const qty = reward.qty || 1;
        quantities[qty] = (quantities[qty] || 0) + 1;
        let value = reward.kind === 'gold' ? reward.amount : reward.kind === 'item' ? itemValue(reward.id) * qty : gearPrice(reward.kind, reward.slot, reward.tier);
        value += reward.consolation || 0;
        sum += value;
        values[value] = (values[value] || 0) + 1;
        if (reward.fallback) fallbackCount++;
        if (reward.kind === 'gold' && reward.slot) cashOutCount++;
        if (reward.kind === 'relic' || reward.kind === 'armor') {
          gearCount++;
          equippedValue += Math.max(1, Math.floor(gearPrice(reward.kind, reward.slot, reward.tier) / 2));
        } else equippedValue += value;
      }
      let cumulative = 0, p95 = 0;
      for (const value of Object.keys(values).map(Number).sort((a,b) => a-b)) {
        cumulative += values[value];
        if (cumulative >= samples * .95) { p95 = value; break; }
      }
      const shares = table => Object.fromEntries(Object.entries(table).sort((a,b) => b[1]-a[1]).map(([key, n]) => [key, n / samples]));
      return { theme, chestTier, depth, rolledTier: rolledTier || null, samples,
        mean: sum / samples, p95, emptyShare: emptyCount / samples, fallbackShare: fallbackCount / samples,
        gearShare: gearCount / samples, actualGearCashOutShare: cashOutCount / samples,
        fullyEquippedMean: equippedValue / samples, fullyEquippedGearCashOutShare: gearCount / samples,
        classes: shares(classes), items: shares(items), groups: shares(groups), quantities: shares(quantities) };
    };
    globalThis.themeNames = typeof ChestThemes === 'undefined' ? [] : Object.keys(ChestThemes.themes);
    globalThis.growthReview = typeof Crops === 'undefined' ? null : ['sunflower','fireflower','iceflower'].map(crop => ({
      crop, seedValue: itemValue(crop + '_seed'), flowerValue: itemValue(crop),
      stageHoldMs: Crops.stageHoldMs ? Crops.stageHoldMs(crop) : Crops.STAGE_HOLD_MS,
      baseStages: 4, powdersToBypass: 4, growthPowderValue: itemValue('growth_powder')
    }));
  `, ctx);
  return ctx;
}
const current = load(root);
const baseline = baselinePath ? load(path.resolve(baselinePath)) : null;
const oldThemes = { roadside: 'lowtier', culture: 'civic', worship: 'civic', memorial: 'civic', authority: 'civic', pets: 'civic' };
const actual = [], conditional = [];
for (const [index, theme] of current.themeNames.entries()) {
  for (const depth of [0, 1]) {
    for (let tier = 1; tier <= 5; tier++) {
      const seed = 137 + index * 997 + tier * 1337 + depth * 701;
      const row = current.simulate(theme, tier, depth, samples, seed, 0);
      if (baseline) {
        row.baseline = baseline.simulate(oldThemes[theme] || theme, tier, depth, samples, seed, 0);
        row.meanChange = row.mean / row.baseline.mean - 1;
        row.needsBalanceReview = row.meanChange > .20;
      }
      actual.push(row);
    }
    for (let tier = 1; tier <= 7; tier++) conditional.push(current.simulate(theme, Math.min(tier, 5), depth, samples, 419 + index * 1999 + tier * 313 + depth * 109, tier));
  }
  process.stderr.write(theme + ' complete\n');
}
fs.mkdirSync(out, { recursive: true });
const flags = actual.filter(row => row.needsBalanceReview);
const report = { samplesPerCell: samples, seedPolicy: 'fixed arithmetic seeds in script',
  notes: ['Values are catalog gold values (not discounted resale). Fresh inventory owns no gear.',
    'fullyEquippedMean substitutes existing half-price chest duplicate payouts for sampled gear; no reward probabilities change.',
    'Actual cells include chain, luck=0, quantity upgrades=0 and jackpots. Displayed chest tiers stop at5.',
    'Conditional cells isolate rolled quality1–7 with quantityBracket0; gear retains the corresponding chest ceiling (max displayed5).',
    'Cave roadside cells are stress tests: roadside chests normally have no cave mirrors.',
    'Fallback share counts explicit missing-group transfers, not ordinary nearest-lower-tier item selection.',
    'Legacy null baseline rewards pay1 gold, matching the existing chest interaction; emptyShare reports their frequency.',
    'Baseline old consumable class stays named consumable in baseline stats; new class names are magic and supply.'],
  actual, conditional, growth: current.growthReview, reviewFlags: flags.map(({theme,chestTier,depth,meanChange}) => ({theme,chestTier,depth,meanChange})) };
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2) + '\n');
const pct = v => (100 * v).toFixed(1) + '%';
const lines = ['# Chest balance simulation', '', samples.toLocaleString() + ' seeded rolls per cell. ' + actual.length + ' actual chest cells and ' + conditional.length + ' conditional quality cells.', '',
  ...report.notes.map(n => '- ' + n), '',
  '**Review gate:** ' + flags.length + ' actual cells increase mean catalog value by more than20%. Reviewed thematic weights have not been adjusted.', '',
  '| Theme | Chest | Mode | Old mean | New mean | Change | New p95 | Fallback | Maxed-gear mean |',
  '|---|---:|---|---:|---:|---:|---:|---:|---:|'];
for (const row of actual) lines.push('| ' + [row.theme, row.chestTier, row.depth ? 'cave' : 'surface', row.baseline?.mean.toFixed(2) || '—', row.mean.toFixed(2), row.meanChange == null ? '—' : pct(row.meanChange) + (row.needsBalanceReview ? ' **review**' : ''), row.p95, pct(row.fallbackShare), row.fullyEquippedMean.toFixed(2)].join(' | ') + ' |');
lines.push('', '## Flowers and seed returns', '',
  'The JSON includes every item/class share and stack-size distribution, including direct magical flowers and single magical seeds. A flower draw does not require growing that flower.', '',
  '| Crop | Stage wait | Four waits | Four Growth Powders |', '|---|---:|---:|---:|');
for (const row of report.growth || []) lines.push('| ' + [row.crop, row.stageHoldMs / 3600000 + 'h', row.stageHoldMs * 4 / 3600000 + 'h', row.growthPowderValue * 4 + ' gold catalog value'].join(' | ') + ' |');
lines.push('', 'Growth Powder bypasses one stage and remains unchanged. Four powders bypass all waits; top-tier watering cans can reduce the number of waits. Harvested seed return rules are unchanged and should be read with the crop-yield review in the implementation notes.', '', 'Machine-readable per-item shares, conditional T1–T7 coverage and quantities: results.json.', '');
fs.writeFileSync(path.join(out, 'report.md'), lines.join('\n'));
console.log(JSON.stringify({ out, cells: actual.length + conditional.length, samples, reviewFlags: flags.length }));
