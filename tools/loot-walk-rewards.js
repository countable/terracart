// Offline companion to the walking model. Execute shipping reward functions
// in the generator's game VM; the dashboard reads only the compact result.
'use strict';
const vm = require('vm');

function sampleWalkRewards(model, trials) {
  function seeded(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const sources = model.rewardSources;
  const save = { relics: {}, armor: {}, inv: [], money: 0, qtyUpgrades: 0, luckUpgrades: 0 };
  const draw = (source, rng, discoveries) => {
    if (source.kind === 'enemy') {
      const rewards = [];
      if (source.amount > 0) rewards.push({ kind: 'gold', amount: source.amount });
      if (source.dropId) rewards.push({ kind: 'item', id: source.dropId, qty: 1 });
      let context = null;
      if (source.elite) {
        context = Combat.ELITE_TREASURE_CONTEXT;
        discoveries.add(source.enemyKind);
      } else if (rng() < (source.treasureChance || 0)) context = 'treasure:default';
      if (context) rewards.push(draw({ context, options: source.elite
        ? { monsterKind: source.enemyKind, eliteRank: source.eliteRank } : {} }, rng, discoveries));
      // resolveDefeat also grants the shiny cash bonus when the species has
      // its own item drop, independently of the enemy bounty/elite branch.
      if (source.shinyBonusAmount) {
        rewards.push({ kind: 'gold', amount: source.shinyBonusAmount });
        discoveries.add(source.enemyKind);
      }
      return rewards;
    }
    if (source.kind === 'coins') return { kind: 'gold', amount: source.amount };
    if (source.kind === 'barrel') return rollBarrel(source.object, rng);
    if (source.kind === 'fixed') return { ...source.reward };
    if (source.kind === 'trail') {
      const n = source.prizeNumber;
      const fixed = Trail.firstPrize(n);
      const cards = Trail.rollCardRow(group => {
        const classes = Trail.prizeCardClasses(group, n, undefined, 0);
        return classes.length ? pickReward(Trail.PRIZE_CONTEXT, save, rng, {
          classes, rollBonus: Trail.rollBonusFor(n - 1),
          classMaxTier: { boots: Trail.bootsTierCap(n) },
        }) : null;
      }, fixed ? [fixed] : []);
      return cards[Math.floor(rng() * cards.length)] || null;
    }
    const reward = pickReward(source.context, save, rng, source.options || source.opts || {});
    // The treasure grant handler adds this after the rarity engine, for all
    // treasure contexts (including headstones and shrine gifts).
    if ((source.treasureGrant || source.context.startsWith('treasure:')) && reward?.kind === 'item' && isLowTierSeed(reward.id)) {
      reward.qty += LOW_TIER_SEED_QTY_BONUS;
    }
    return reward;
  };
  const describe = reward => {
    if (!reward || reward.kind === 'empty') return null;
    const consolation = reward.consolation || 0;
    if (reward.kind === 'gold') return { id: 'coins', label: 'Coins', category: 'Coins', qty: reward.amount || 0,
      coins: (reward.amount || 0) + consolation, value: (reward.amount || 0) + consolation };
    if (reward.slot && reward.tier) {
      const category = reward.kind === 'armor' ? 'Armour' : 'Equipment';
      return { id: `${reward.kind || 'relic'}:${reward.slot}:${reward.tier}`,
        label: `${reward.slot.replaceAll('_', ' ')} · T${reward.tier}`, category, qty: 1,
        coins: consolation, value: (gearPrice(reward.kind, reward.slot, reward.tier) || 0) + consolation };
    }
    const item = ITEM_BY_ID[reward.id];
    if (!item) throw new Error('Unrecognized reward item: ' + reward.id);
    const categoryName = ({ seed: 'Seeds', produce: 'Food', unique_relic: 'Unique relics',
      consumable: 'Consumables', bundle: 'Materials' })[reward.cls || item.kind]
      || (item.kind || reward.cls || 'Other').replaceAll('_', ' ');
    const category = categoryName[0].toUpperCase() + categoryName.slice(1);
    return { id: reward.id, label: item.name, category, qty: reward.qty || 1,
      coins: consolation, value: itemValue(reward.id) * (reward.qty || 1) + consolation };
  };
  // Exact finite-population Bernoulli count via geometric gaps. No route can
  // collect more instances of a source than exist in the sampled tiles.
  const encounters = (count, mean, rng) => {
    const n = Math.max(0, Math.round(count));
    const p = Math.min(1, Math.max(0, mean / n));
    if (!n || !p) return 0;
    if (p === 1) return n;
    let next = -1, hits = 0;
    while ((next += 1 + Math.floor(Math.log(1 - rng()) / Math.log(1 - p))) < n) hits++;
    return hits;
  };
  const results = model.distancesM.map((distanceM, distanceIndex) => {
    const items = new Map(), classes = new Map(), values = [], coinValues = [], examples = [];
    let totalAwards = 0, totalUnits = 0, totalMemories = 0;
    for (let trial = 0; trial < trials; trial++) {
      const seed = 104729 + distanceIndex * 100003 + trial;
      const rng = seeded(seed), bag = new Map(), discoveries = new Set();
      let coins = 0, value = 0;
      for (const source of sources) {
        const expected = (source.expected || source.counts)[distanceIndex];
        const n = encounters(source.count, expected, rng);
        for (let i = 0; i < n; i++) {
          const result = draw(source, rng, discoveries);
          for (const raw of Array.isArray(result) ? result : [result]) {
            const reward = describe(raw);
            if (!reward) continue;
            coins += reward.coins;
            value += reward.value;
            totalAwards++;
            classes.set(reward.category, (classes.get(reward.category) || 0) + 1);
            const item = bag.get(reward.id) || { ...reward, qty: 0, value: 0 };
            item.qty += reward.qty; item.value += reward.value;
            bag.set(reward.id, item);
            if (reward.id !== 'coins') totalUnits += reward.qty;
          }
        }
      }
      values.push(value); coinValues.push(coins); totalMemories += discoveries.size;
      for (const item of bag.values()) {
        const total = items.get(item.id) || { id: item.id, label: item.label, category: item.category, qty: 0, runs: 0 };
        total.qty += item.qty; total.runs++;
        items.set(item.id, total);
      }
      if (trial < 3) examples.push({ seed, coins, value, memories: discoveries.size,
        rewards: [...bag.values()].filter(item => item.id !== 'coins')
          .sort((a, b) => b.value - a.value).map(({ id, label, qty, category }) => ({ id, label, qty, category })) });
    }
    const mean = a => a.reduce((sum, n) => sum + n, 0) / a.length;
    const quantiles = a => {
      a.sort((x, y) => x - y);
      return { p10: a[Math.floor((a.length - 1) * .1)], p50: a[Math.floor((a.length - 1) * .5)], p90: a[Math.floor((a.length - 1) * .9)] };
    };
    return { distanceM, trials, meanCoins: mean(coinValues), meanValue: mean(values),
      meanItemCount: totalUnits / trials, meanAwards: totalAwards / trials, meanMemories: totalMemories / trials,
      valueDistribution: quantiles(values), coinDistribution: quantiles(coinValues),
      classes: [...classes].map(([label, awards]) => ({ label, awards: awards / trials, share: awards / (totalAwards || 1) })).sort((a, b) => b.awards - a.awards),
      topItems: [...items.values()].filter(item => item.id !== 'coins').map(item => ({
        id: item.id, label: item.label, category: item.category, expectedQty: item.qty / trials, probability: item.runs / trials,
      })).sort((a, b) => b.expectedQty - a.expectedQty).slice(0, 18), examples };
  });
  return { trials, seed: 104729, source: model.source,
    assumptions: [
      'Shipping reward tables; fixed fresh-player equipment and zero luck upgrades for every roll, not a progression simulation.',
      'Independent finite-tile encounter draws around the walking model expectations. Percentiles illustrate this model, not measured player routes.',
      'All rewards accepted; no bag limits, purchases, energy costs, gear replacement, repeat visits or selling. Value is catalog list value, not spendable coins.',
      'Street prizes keep one uniformly chosen offered card, including the first-prize seed option; offered cards are not all awarded.',
      'Every encountered enemy is defeated by the player and its bounty collected. Kind-specific drops and eligible monster treasure rolls accompany that same encounter. Every elite grants a signature drop; the first of each species also grants a memory. No previous discoveries are assumed.',
    ], distances: results };
}

function buildRewards(context, model, trials = 256) {
  context.__lootWalkModel = model;
  context.__lootWalkTrials = trials;
  try {
    return vm.runInContext(`(${sampleWalkRewards.toString()})(__lootWalkModel, __lootWalkTrials)`, context);
  } finally {
    delete context.__lootWalkModel;
    delete context.__lootWalkTrials;
  }
}

module.exports = { buildRewards };
