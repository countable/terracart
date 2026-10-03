// The shop:* tuning tables are not called by the game's shop generators.
const chestContexts = () => Object.keys(ChestThemes.themes).map(theme => 'chest:' + theme);
const rewardContexts = () => [...chestContexts(), ...Object.keys(LOOT_CONTEXTS).filter(c => c.startsWith('treasure:')), 'fishing'];

// A save of a player who owns every relic and armour slot at `tier` — what
// the rolls read (ring luck, gear upgrades, relic caps).
function saveAt(tier) {
  const relics = {}, armor = {};
  if (tier > 0) {
    for (const s of Object.keys(RELIC_DEFS)) relics[s] = { tier };
    for (const s of Object.keys(ARMOR_DEFS)) armor[s] = { tier };
  }
  return { relics, armor, inv: [], money: 0, qtyUpgrades: +$('qty').value };
}

// What a roll is worth, and what to call it. The shapes pickReward returns:
// coins { kind:'gold', amount }, items { kind:'item', id, qty }, gear
// { kind:'relic'|'armor', slot, tier } (or a relic offer { slot, tier }).
// Exercise the shipping handler, including its branch order and actual payouts.
// The loader disables persistence. Gear changes belong to this cast only.
function sampleFishing(start, opts) {
  const save = structuredClone(start);
  if (opts.rodTier) save.relics.fishing_rod = { tier: opts.rodTier };
  else delete save.relics.fishing_rod;
  let result = { ...describe(null), cls: 'no payout', key: 'No payout' };
  const scene = {
    spendEnergy() { return true; },
    startWorkProgress(x, y, complete) { complete(); },
    addToInv(id, qty) { result = describe({ kind: 'item', id, qty,
      cls: id === 'old_boot' ? 'junk' : 'fish' }); },
    flashLoot(text) {
      result.text = text;
      if (result.cls === 'no payout') result.key = text;
    },
    spawnFishedSlime() {
      if (!opts.slimeSpace) return false;
      result = { ...describe(null), cls: 'slime encounter', key: 'Slime encounter' };
      return true;
    },
    markRelicsDirty() {
      for (const [kind, slots] of [['relic', save.relics], ['armor', save.armor]]) {
        for (const [slot, gear] of Object.entries(slots)) {
          const before = kind === 'relic' && slot === 'fishing_rod' ? opts.rodTier
            : start[kind === 'relic' ? 'relics' : 'armor'][slot]?.tier || 0;
          if (gear.tier > before) result = describe({ kind, slot, tier: gear.tier });
        }
      }
    },
  };
  TAP_HANDLERS.find((h) => h.name === 'fishing').try({
    scene, save, cell: { type: TERRAIN.WATER }, sx: 0, sy: 0, cwmx: 0, cwmy: 0,
  });
  // Count coins actually credited, including duplicate-gear cash-outs.
  const coins = save.money - start.money;
  if (coins > 0 && result.cls === 'no payout') {
    result.cls = 'cash';
    result.key = 'coins';
  }
  result.value += coins;
  return result;
}

function sample(ctx, opts, owned, n) {
  const save = saveAt(owned);
  const rows = [];
  const roll = () => pickReward(ctx, save, Math.random, opts);
  for (let i = 0; i < n; i++) {
    if (ctx === Trail.PRIZE_CONTEXT) {
      const prize = +$('bonus').value;
      const fixed = Trail.firstPrize(prize);
      const rollFor = (group) => {
        const classes = Trail.prizeCardClasses(group, prize, save.playerClass, save.armor.boots?.tier || 0);
        if (!classes.length) return null;
        return pickReward(ctx, save, Math.random, { ...opts, classes,
          classMaxTier: { boots: Trail.bootsTierCap(prize, save.playerClass) } });
      };
      rows.push(...Trail.rollCardRow(rollFor, fixed ? [fixed] : []).map(describe));
    } else if (ctx === 'fishing') rows.push(sampleFishing(save, opts));
    else {
      const reward = roll();
      // grantTreasureRoll applies this after pickReward, to digs and elite kills.
      if ((ctx === 'treasure:default' || ctx === Combat.ELITE_TREASURE_CONTEXT || ctx === Zones.SHRINE_CONTEXT)
          && reward?.kind === 'item' && isLowTierSeed(reward.id)) {
        reward.qty += LOW_TIER_SEED_QTY_BONUS;
      }
      rows.push(describe(reward));
    }
  }
  return rows;
}
function optsFor(ctx) {
  const o = {};
  if (ctx === 'fishing') return { rodTier: +$('fishing_rod').value, slimeSpace: $('slime').value === 'yes' };
  if (ctx.startsWith('chest:')) o.tier = +$('tier').value;
  if (ctx.startsWith('chest:')) o.depth = +$('depth').value;
  if (ctx === 'treasure:default' && +$('depth').value > 0) {
    o.depth = +$('depth').value;
    o.tier = 2 + chestTierDepthBonus(o.depth);
  }
  if (ctx === Trail.PRIZE_CONTEXT) o.rollBonus = Trail.rollBonusFor(+$('bonus').value - 1);
  if (ctx === Combat.ELITE_TREASURE_CONTEXT) o.rollBonus = Combat.eliteRollBonus($('monster').value, +$('depth').value);
  return o;
}

function rollOne() {
  const ctx = $('ctx').value, trials = +$('n').value, opts = optsFor(ctx);
  const rows = sample(ctx, opts, +$('owned').value, trials), n = rows.length;
  const ev = rows.reduce((a, r) => a + r.value, 0) / n;
  const group = (keyOf) => {
    const m = new Map();
    for (const r of rows) {
      const k = keyOf(r), g = m.get(k) || { n: 0, v: 0, q: 0 };
      g.n++; g.v += r.value; g.q += r.qty || 0; m.set(k, g);
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  };
  $('summary').innerHTML = `<p><b style="color:#ffd866">${ctx}</b> ${JSON.stringify(opts)} — `
    + `average list value per ${ctx === Trail.PRIZE_CONTEXT ? 'offered card' : ctx === 'fishing' ? 'cast' : 'reward'} <b style="color:#ffd866">${fmt$(ev)}</b> over ${trials.toLocaleString()} samples (${n.toLocaleString()} rewards)</p>`;
  table($('byClass'), ['class', 'share', 'avg value when rolled'],
    group((r) => r.cls).map(([k, g]) => `<tr><td>${k}</td>${barCell(g.n / n)}<td>${fmt$(g.v / g.n)}</td></tr>`));
  table($('byTier'), ['tier', 'share'],
    group((r) => 'T' + (r.tier || 0)).sort((a, b) => a[0].localeCompare(b[0])).map(([k, g]) => `<tr><td>${k}</td>${barCell(g.n / n)}</tr>`));
  table($('byItem'), ['item', 'share', 'avg qty', 'share of value'],
    group((r) => r.key).slice(0, 40).map(([k, g]) =>
      `<tr><td>${k}</td>${barCell(g.n / n)}<td>${g.q ? (g.q / g.n).toFixed(1) : '—'}</td><td>${pct(g.v / (ev * n || 1))}</td></tr>`));
  table($('samples'), ['#', 'reward', 'tier', 'list value'],
    rows.slice(0, 10).map((r, i) => `<tr><td>${i + 1}</td><td style="text-align:left">${r.text}</td><td>T${r.tier || 0}</td><td>${fmt$(r.value)}</td></tr>`));
}

function matrix() {
  const ctxs = rewardContexts();
  const N = 2000, owned = +$('owned').value;
  const data = ctxs.map((ctx) => {
    const rows = sample(ctx, optsFor(ctx), owned, N);
    const by = {};
    for (const r of rows) by[r.cls] = (by[r.cls] || 0) + 1;
    return { ctx, by, n: rows.length, ev: rows.reduce((a, r) => a + r.value, 0) / rows.length };
  });
  const classes = [...new Set(data.flatMap((d) => Object.keys(d.by)))].sort();
  const heat = (s) => s ? `<td class="heat" style="background:hsla(45,80%,${Math.round(85 - s * 45)}%,${Math.min(1, 0.15 + s)})">${Math.round(s * 100)}%</td>` : '<td style="color:#444">·</td>';
  table($('matrix'), ['context', 'avg value', ...classes],
    data.map((d) => `<tr><td>${d.ctx}</td><td>${fmt$(d.ev)}</td>${classes.map((c) => heat((d.by[c] || 0) / d.n)).join('')}</tr>`));
}

function chestGrid() {
  const cats = chestContexts();
  const tiers = [1, 2, 3, 4, 5, 6, 7], N = 1500, owned = +$('owned').value;
  table($('chestGrid'), ['category', ...tiers.map((t) => 'T' + t)], cats.map((ctx) =>
    `<tr><td>${ctx.slice(6)}</td>${tiers.map((t) => {
      const rows = sample(ctx, { tier: t, depth: 0 }, owned, N);
      return `<td>${fmt$(rows.reduce((a, r) => a + r.value, 0) / N)}</td>`;
    }).join('')}</tr>`));
}

function defaultTiers() {
  const rows = Object.keys(ChestThemes.themes).sort();
  table($('defaultTiers'), ['theme', 'locations', 'surface interaction', 'mirrors underground'], rows.map((category) => {
    const places = Object.keys(POI_CATEGORY).filter((p) => chestThemeForPoi(p) === category);
    const stalls = places.filter((poiClass) => produceStandFor({ kind: 'chest', poiClass }));
    const macros = places.map((poiClass) => macroFor({ kind: 'chest', poiClass }))
      .filter(Boolean).map((macro) => macro.kind);
    const chestOnly = places.filter((p) => STAND_NEVER_CLASSES.has(p));
    const surface = !places.length ? 'One-time grail chests'
      : macros.length ? `Macro: ${[...new Set(macros)].join(', ')}`
      : stalls.length === places.length ? 'Market stalls'
      : stalls.length ? `Market stalls: ${stalls.map((p) => p.replaceAll('_', ' ')).join(', ')}. `
        + (chestOnly.length ? `Chests: ${chestOnly.join(', ')}.` : 'Other locations: chests or name-based stalls.')
      : category === 'roadside' ? 'Chests; bins and recycling are barrels, ATMs pots of gold, bike racks a speed boost' : 'Chests';
    return `<tr><td>${category}</td><td style="text-align:left;white-space:normal">${places.map((p) => p.replaceAll('_', ' ')).join(', ') || 'vista only'}</td>`
      + `<td style="text-align:left;white-space:normal">${surface}</td><td>${places.length ? (chestMirrorsUnderground(places[0]) ? 'yes' : 'no') : 'no'}</td></tr>`;
  }).concat(`<tr><td>unlisted</td><td style="text-align:left">Other chest locations</td><td>Chests</td><td>yes</td></tr>`));
  $('tierRules').textContent = 'A chest\'s tier is its tile\'s QUOTA SEAT: each tile seeds ~1 T5, 7 T4, '
    + '15 T3 and 25 T2 (x1..x2 over 100..1000 budgeted POIs) onto its best-ranked POIs '
    + '(the MVT rank tag), round-robin across chest categories - every other chest is T1. '
    + `Vistas are fixed T5; a zone nexus wins a seat without spending one (+${ZONE_NEXUS_TIER_BONUS}). `
    + `Each cave level re-seats its own pyramid; the cap CLIMBS underground `
    + `(T6 from level 3, T7 from 6) with +1 tier per ${CHEST_TIER_DEPTH_STEP} levels. `
    + `A T1 chest is a crate: it restocks after floor(count / ${CRATE_RESTORE_PER}) days (1–${CRATE_RESTORE_MAX_DAYS}). `
    + 'Set Reward roll tier below to the resulting tier; Depth applies the cave loot mix.';
}

function syncControls() {
  const ctx = $('ctx').value;
  $('tierL').style.display = ctx.startsWith('chest:') ? '' : 'none';
  $('depthL').style.display = ctx !== Trail.PRIZE_CONTEXT && ctx !== 'fishing' ? '' : 'none';
  $('rodL').style.display = $('slimeL').style.display = ctx === 'fishing' ? '' : 'none';
  $('bonusL').style.display = ctx === Trail.PRIZE_CONTEXT ? '' : 'none';
  $('monsterL').style.display = ctx === Combat.ELITE_TREASURE_CONTEXT ? '' : 'none';
  $('contextNote').textContent = ctx === 'fishing'
    ? 'One completed cast, including misses, boots, slime encounters and gear jackpots. Blocked slime landing space falls through to a fish. Values are gross rewards before energy costs; no value is assigned to fighting a caught slime. Coin values reflect the payout actually credited by the game.'
    : ctx === Trail.PRIZE_CONTEXT
    ? `Each sample offers up to ${Trail.PRIZE_CHOICES} distinct cards: cash, seed or supply, and boots or magic. Boots follow the distance cap for the default player class; the player keeps one. Prize #1 includes ${Trail.FIRST_PRIZE_QTY} onion seeds. Tables measure offered cards, not total payout.`
    : ctx === Combat.ELITE_TREASURE_CONTEXT
      ? 'Repeat elite kills pay this reward. The first discovery gives a memory instead. The normal kill wage is separate. Includes the extra low-tier seeds paid by the game.'
      : ctx.startsWith('chest:') ? 'Themed chest rewards at the chosen tier. Cave loot mixes 60% location theme with 40% cave supplies; the cave component increasingly favors magic. Seed odds decrease at high rolled quality. Surface food POIs are market stalls; their underground copies use chest:food. Florists and garden centres are also stalls; gardens stay chests. Fixed starter contents are not included.'
      : ctx === Zones.SHRINE_CONTEXT ? 'One daily grove shrine gift, including the extra low-tier seeds paid by the game.'
      : 'One buried-treasure reward. Underground finds use the game’s depth-based cave supply weighting. Includes the extra low-tier seeds paid by the game.';
}

(async () => {
  try {
    await loadGame();
    defaultTiers();
    const opt = (el, vals, sel) => { el.innerHTML = vals.map(([v, t]) => `<option value="${v}"${v == sel ? ' selected' : ''}>${t}</option>`).join(''); };
    opt($('ctx'), rewardContexts().map((c) => [c, c.startsWith('chest:') ? c.slice(6).replaceAll('_', ' ') + ' chest' : c.replaceAll(':', ' · ').replaceAll('_', ' ')]), 'chest:park');
    opt($('tier'), [1, 2, 3, 4, 5, 6, 7].map((t) => [t, 'T' + t]), 2);
    opt($('depth'), [0, 1, 2, 3, 4, 5, 6, 7, 8, 10].map((d) => [d, d ? 'level ' + d : 'surface']), 0);
    opt($('bonus'), Array.from({ length: Trail.PRIZE_ROLL_BONUS_MAX }, (_, i) => i + 1).map((b) => [b, '#' + b]), 1);
    opt($('monster'), Object.keys(Combat.MONSTERS).filter((k) => Combat.spawnsUnderground(k)).map((k) => [k, k]), 'cave_slime');
    opt($('owned'), [0, 1, 2, 3, 4, 5, 6, 7].map((t) => [t, t ? 'T' + t : 'nothing']), 0);
    opt($('fishing_rod'), [0, 1, 2, 3, 4, 5, 6, 7].map((t) => [t, t ? 'T' + t : 'bare hands']), 0);
    opt($('qty'), Array.from({ length: RARITY_TUNING.qtyLuckLevels + 1 }, (_, i) => [i, i]), 0);
    $('ctx').onchange = () => { syncControls(); rollOne(); };
    for (const id of ['tier', 'depth', 'bonus', 'monster', 'owned', 'qty', 'fishing_rod', 'slime', 'n']) $(id).onchange = () => { rollOne(); matrix(); if (id === 'owned' || id === 'qty') chestGrid(); };
    $('go').onclick = rollOne;
    syncControls();
    $('status').textContent = 'rolling…';
    setTimeout(() => {
      rollOne(); matrix(); chestGrid(); $('status').textContent = '';
      document.documentElement.dataset.balanceReady = 'true';
    }, 20);
  } catch (e) {
    $('status').textContent = 'failed: ' + e.message;
    console.error(e);
  }
})();
