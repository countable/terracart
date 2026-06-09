// Entity-driven interactable registry.
//
// World objects the player taps (trees, ore rocks, fruit trees, …) used to be
// handled by a long if/else chain on `o.kind` inside interact.js' 'object'
// tap-handler. That chain mixed three orthogonal concerns for every kind:
//   1. GATE   — is this object spent / does the player have the right tool tier?
//   2. TIMER  — how long is the work wheel (driven by the equipped tool tier)?
//   3. PAYOUT — what loot drops when the work completes?
//
// This module pulls those concerns into a declarative table so adding a new
// interactable is a matter of describing it as data, not threading another
// branch through the dispatcher. Each entry declares:
//
//   tool          relic slot that drives the work-wheel duration + speed
//                 (toolDurationMs). null/absent ⇒ not a tool interaction.
//   spent(o,ctx)  optional: object already consumed this session?
//   spentAction   what a spent object does: 'skip' (let the tap fall through to
//                 the next object / handler — used for chopped tree stumps so
//                 they don't block tilling) or 'consume' (default — eat the tap).
//   gate(o,save)  optional: return a flash string to BLOCK + consume the tap
//                 (e.g. "Need a Wood pick…"), or null/undefined to allow.
//   energy(save,o) optional: energy spent up-front; if unaffordable the tap is
//                 consumed without starting work (mirrors spendEnergy guard).
//   complete(ctx,o) loot/side-effects fired when the work wheel finishes.
//   custom(ctx,o) escape hatch for interactables that aren't the tool pipeline
//                 (e.g. fruit harvest: instant, no tool, respawn-timer gated).
//                 Returns the handler result directly (true = consumed).
//
// All gate/energy callbacks are PURE over (object, save), so the driver can
// recompute derived values (tier requirements, isPlain, …) independently in
// `complete` without smuggling state through closures.
//
// Helpers referenced here (treeAxeReqTier, effectiveChopCost, effectivePickCost,
// TIER_BY_NUM, isShiny, SHINY_RATE, randInt, pickFromArray, ITEM_BY_ID,
// persistSave, toolDurationMs) are globals from util.js / items.js / save.js,
// all loaded before this module.

// ---- Gather luck -----------------------------------------------------------
// Chest / treasure loot has always been luck-aware: pickReward() reads the
// ring (ringLuck → rarer pulls) and amulet (amuletBracketChance → bigger
// stacks) straight off `save`. GATHER drops (tree wood, rock ore/gems, fruit)
// historically ignored luck entirely.
//
// Each registry entry now DECLARES which relic slots modify its rolls via a
// `luck` field, and the gather completes consult ctx.luck so the ring/amulet
// improve those yields too. This is gated behind GATHER_LUCK_DEFAULT (OFF):
// when disabled, gatherLuck() returns zeroed multipliers, every luck branch
// short-circuits before its Math.random(), and the RNG stream + outcomes are
// byte-for-byte identical to the pre-luck behaviour. Flip the flag (or set
// window.GATHER_LUCK_ENABLED at runtime, e.g. from tests) to enable it.
const GATHER_LUCK_DEFAULT = false;

function gatherLuckEnabled() {
  if (typeof window !== 'undefined' && window.GATHER_LUCK_ENABLED != null) {
    return !!window.GATHER_LUCK_ENABLED;
  }
  return GATHER_LUCK_DEFAULT;
}

// Resolve an entry's declared luck slots into multipliers for its rolls:
//   tierP  — ring contribution; scales a drop's rarity probability (×(1+tierP))
//   bonusP — amulet contribution; chance at one bonus unit of yield
// Returns zeroed multipliers when the flag is off or the entry declares no luck,
// so callers can apply them unconditionally without changing the off-path.
function gatherLuck(save, slots) {
  const out = { tierP: 0, bonusP: 0 };
  if (!gatherLuckEnabled() || !slots) return out;
  if (slots.includes('ring') && typeof ringLuck === 'function') {
    out.tierP = ringLuck(save);
  }
  if (slots.includes('amulet') && typeof amuletBracketChance === 'function') {
    out.bonusP = amuletBracketChance(save);
  }
  return out;
}

const INTERACTABLES = {
  // ---- Tree: chop with an axe for wood -------------------------------------
  // Bigger / harder trees demand a sturdier axe and pay out proportionally more
  // wood (treeWoodMul); softwood fells a tier easier, hardwood a tier harder
  // (treeAxeReqTier). A chopped stump is skipped so its cell stays tillable.
  tree: {
    tool: 'axe',
    luck: ['amulet'],   // amulet → chance at a bonus bundle of wood
    spent: (o, ctx) => o.chopped || (ctx.save.chopped && ctx.save.chopped.includes(o.id)),
    spentAction: 'skip',
    gate: (o, save) => {
      const reqTier = treeAxeReqTier(o);
      const axeTier = save.relics?.axe?.tier || 0;
      if (axeTier < reqTier) {
        const need = TIER_BY_NUM[reqTier]?.name || 'better';
        return `Need a ${need} axe to fell this ${treeSpeciesName(o)} tree.`;
      }
      return null;
    },
    energy: (save, o) => (typeof effectiveChopCost === 'function')
      ? effectiveChopCost(save.relics, o) : 0,
    complete: (ctx, o) => {
      const { scene, save, sx, sy, luck } = ctx;
      const woodMul = treeWoodMul(o);
      let wood = randInt(2, 3) * woodMul;
      // Amulet luck: a chance at one extra bundle of wood. bonusP is 0 when
      // gather-luck is off, so the && short-circuits before Math.random() and
      // the yield is identical to the un-luck path.
      if (luck && luck.bonusP && Math.random() < luck.bonusP) wood += woodMul;
      o.chopped = true;
      save.chopped = save.chopped || [];
      if (!save.chopped.includes(o.id)) save.chopped.push(o.id);
      scene.addToInv('wood', wood);
      persistSave(save);
      scene.flash(o.size === 'bush' ? `🌿 Cleared a bush.` : `🌲 Felled ${treeSpeciesName(o)} tree.`, sx, sy);
      // Rare shiny tree — 10× wood value in cash + a discovery point.
      if (isShiny(o.id, SHINY_RATE.tree)) scene.awardShinyBonus('wood', sx, sy);
    },
  },

  // ---- Mineral rock: mine with a pick for stone / ore / gems ---------------
  // "Plain rock" (a cave variant or a T1 deposit) is bare-hand-breakable and
  // drops stone + a small chance of a sliver of ore. Ore rock (T2+) is pick-tier
  // gated and drops exactly one namesake bar + coal + tier-rolled gems.
  mineralrock: {
    tool: 'pick',
    luck: ['ring', 'amulet'],   // ring → rarer bars/gems; amulet → bonus stone/coal
    spent: (o, ctx) => ctx.scene.brokenRockSet.has(o.id),
    spentAction: 'consume',
    gate: (o, save) => {
      const isCave = o.caveVariant != null;
      const isPlain = isCave || (o.yieldTier || 1) <= 1;
      if (isPlain) return null;   // plain rock is ungated
      const pickTier = save.relics?.pick?.tier || 0;
      const reqTier = o.requiredTier || Math.max(1, (o.yieldTier || 1) - 1);
      if (pickTier < reqTier) {
        const need = TIER_BY_NUM[reqTier]?.name || 'better';
        return `Need a ${need} pick to mine this ore.`;
      }
      return null;
    },
    // Shared tool-tier baseline (9 bare → 1 Frost via effectivePickCost) OR a
    // +9-per-tier surcharge when the rock out-tiers the pick, whichever is more.
    energy: (save, o) => {
      const pickTier = save.relics?.pick?.tier || 0;
      const rockTier = o.yieldTier || 1;
      return Math.max(effectivePickCost(save.relics), 9 * (rockTier - pickTier));
    },
    complete: (ctx, o) => {
      const { scene, save, luck } = ctx;
      // Ring luck scales a drop's rarity probability; amulet luck grants a
      // chance at one bonus unit. Both default to 0 (flag off), so every roll
      // below threshold + Math.random() call is unchanged from the un-luck path.
      const tierP = (luck && luck.tierP) || 0;
      const bonusP = (luck && luck.bonusP) || 0;
      scene.brokenRockSet.add(o.id);
      save.brokenRocks = [...scene.brokenRockSet];
      // Slot 0/1 unused for the primary drop (ore starts at copper = T2); each
      // tier T2+ yields its OWN namesake bar.
      const BARS = ['', 'copper_bar', 'copper_bar', 'iron_bar', 'gold_bar', 'platinum_bar', 'crimson_bar', 'frost_bar'];
      const isCave = o.caveVariant != null;
      const isPlain = isCave || (o.yieldTier || 1) <= 1;
      if (isPlain) {
        // Plain rock — stone (1-3 rockfruit), coal on ~20%, plus a small
        // per-tier chance (1/(2·t²) from copper) of cracking open a bar.
        const qty = randInt(1, 3);
        scene.addToInv('rockfruit', qty);
        if (Math.random() < 0.20) scene.addToInv('coal', 1);
        let flashId = 'rockfruit';
        for (let t = 2; t <= 7; t++) {
          // Ring nudges the bar chance up (×(1+tierP)); ×1 when luck is off.
          if (Math.random() < (1 / (2 * t * t)) * (1 + tierP)) {
            const bar = BARS[t];
            if (bar) { scene.addToInv(bar, 1); flashId = bar; }
          }
        }
        // Amulet luck: a chance at a bonus stone. Short-circuits before
        // Math.random() when bonusP is 0, so the off-path RNG stream is intact.
        if (bonusP && Math.random() < bonusP) scene.addToInv('rockfruit', 1);
        persistSave(save);
        const item = ITEM_BY_ID[flashId];
        scene.flashLoot(`+1 ${item?.name || flashId}`, '#a7ffb0', 1, flashId);
        return;
      }
      // Ore-bearing rock — exactly ONE bar of the indicated type, plus a coal
      // nugget and a tier-rolled gem on T4+.
      scene.addToInv('coal', randInt(1, 2));
      const t = o.yieldTier || 1;
      const primaryBar = BARS[t] || 'copper_bar';
      scene.addToInv(primaryBar, 1);
      let flashId = primaryBar;
      let gemsFound = 0;
      const GEM_BY_TIER = { 4: ['sapphire'], 5: ['ruby'], 6: ['emerald'], 7: ['emerald', 'ruby'] };
      const GEM_P_BY_TIER = { 4: 0.25, 5: 0.35, 6: 0.40, 7: 0.50 };
      const gems = GEM_BY_TIER[t];
      // Ring nudges the gem chance up (×(1+tierP)); ×1 when luck is off. The
      // Math.random() fires whenever gems exist regardless of the threshold, so
      // the off-path call count is unchanged.
      if (gems && Math.random() < (GEM_P_BY_TIER[t] || 0) * (1 + tierP)) {
        const gemId = pickFromArray(gems);
        scene.addToInv(gemId, 1);
        flashId = gemId;
        gemsFound++;
      }
      // T7 rocks have a bonus 25% chance for a second ruby on top (ring-scaled).
      if (t === 7 && Math.random() < 0.25 * (1 + tierP)) {
        scene.addToInv('ruby', 1);
        flashId = 'ruby';
        gemsFound++;
      }
      // Amulet luck: a chance at a bonus coal nugget (off-path short-circuits).
      if (bonusP && Math.random() < bonusP) scene.addToInv('coal', 1);
      persistSave(save);
      // Finding a gem fires the jackpot fanfare on top of the loot flash.
      if (gemsFound >= 1 && typeof scene.flashJackpot === 'function') {
        scene.flashJackpot(gemsFound);
      }
      const item = ITEM_BY_ID[flashId];
      scene.flashLoot(`+1 ${item?.name || flashId}`, '#a7ffb0', 1, flashId);
    },
  },

  // ---- Fruit tree: instant harvest, respawn-timer gated --------------------
  // Not a tool interaction (no axe/pick, no work wheel, no energy) — handled
  // via `custom`. A planted sapling must mature (~4 days) before its first pick,
  // and each tree fruits once per 24h.
  fruittree: {
    luck: ['amulet'],   // amulet → chance at a bonus fruit
    custom: (ctx, o) => {
      const { scene, save, sx, sy, luck } = ctx;
      const FRUIT_RESPAWN_MS = 24 * 60 * 60 * 1000;   // one harvest per 24h
      // A planted sapling can't be harvested until it has matured (reached its
      // fruiting stage). 4 days sprout→fruit (4 × 1-day stages).
      if (o.planted) {
        const FRUIT_STAGE_MS = 24 * 60 * 60 * 1000;
        const elapsed = Date.now() - (o.planted_t || 0);
        if (elapsed < 4 * FRUIT_STAGE_MS) {
          const msLeft = 4 * FRUIT_STAGE_MS - elapsed;
          const daysLeft = Math.ceil(msLeft / FRUIT_STAGE_MS);
          const left = daysLeft > 1 ? `${daysLeft}d` : `${Math.max(1, Math.ceil(msLeft / 3600000))}h`;
          scene.flash(`Still growing — ${left}`, sx, sy);
          return true;
        }
      }
      save.fruitPicked = save.fruitPicked || {};
      const pickedAt = save.fruitPicked[o.id];
      if (pickedAt && Date.now() - pickedAt < FRUIT_RESPAWN_MS) {
        const msLeft = FRUIT_RESPAWN_MS - (Date.now() - pickedAt);
        const hrsLeft = Math.ceil(msLeft / 3600000);
        const left = hrsLeft > 1 ? `${hrsLeft}h` : `${Math.max(1, Math.ceil(msLeft / 60000))}m`;
        scene.flash(`Picked — ripe again in ${left}`, sx, sy);
        return true;
      }
      save.fruitPicked[o.id] = Date.now();
      let n = randInt(1, 2);
      // Amulet luck: a chance at one bonus fruit (short-circuits before
      // Math.random() when luck is off, keeping the off-path identical).
      if (luck && luck.bonusP && Math.random() < luck.bonusP) n += 1;
      scene.addToInv(o.species, n);
      ctx.dirty = true;
      const item = ITEM_BY_ID[o.species];
      scene.flashLoot(`harvested ${item?.name || o.species}`, '#a7ffb0', 1, o.species);
      // Rare shiny fruit tree — 10× fruit value in cash + a discovery point.
      if (isShiny(o.id, SHINY_RATE.tree)) scene.awardShinyBonus(o.species, sx, sy);
      return true;
    },
  },

  // ---- Ground stack: a loose pile of items, tap to pick up -----------------
  // Already-picked stacks are filtered at render time, but the tap loop walks
  // all objects regardless of save state, so guard again (returns 'skip' so the
  // tap falls through to the next object in case a tap races a re-render).
  groundstack: {
    custom: (ctx, o) => {
      const { scene, save } = ctx;
      if (save.picked && save.picked.includes(o.id)) return 'skip';
      save.picked = [...(save.picked || []), o.id];
      const qty = Math.max(1, o.qty || 1);
      scene.addToInv(o.itemId, qty);
      ctx.dirty = true;
      const item = ITEM_BY_ID[o.itemId];
      scene.flashLoot(`+${qty} ${item?.name || o.itemId}`, undefined, 1, o.itemId);
      return true;
    },
  },

  // ---- Chest: the full open-and-loot ceremony ------------------------------
  // Handles coin-burst POIs (ATM / bicycle parking), left-for-later held loot,
  // fixed starter payloads, produce-stand items, and the rarity-rolled item /
  // relic / armor / gold results, with a bag-full TAKE/LEAVE modal.
  chest: {
    // Declarative only: pickReward() reads the ring + amulet off `save` itself,
    // so chest loot is luck-aware regardless of the GATHER_LUCK flag (which
    // gates the gather drops). The field documents that linkage in one place.
    luck: ['ring', 'amulet'],
    custom: (ctx, o) => {
      const { scene, save, sx, sy } = ctx;
      // Coin-burst POIs (ATM + bicycle parking) hijack the chest tap before the
      // standard open-and-loot path. They never go into save.opened — they're
      // gated by save.coinBurstClaimed[id+YYYYMMDD] so they refresh daily, and
      // produce world-scattered coin pickups instead of inventory loot.
      if (o.poiClass === 'atm' || o.poiClass === 'bicycle_parking') {
        if (typeof scene._coinBurstInteract === 'function') {
          scene._coinBurstInteract(sx, sy, o);
          return true;
        }
        // Fall through to default chest behaviour if the method isn't wired
        // (defensive — keeps these POIs usable if app.js is out of sync).
      }
      if (save.opened.includes(o.id)) { scene.flash('Picked clean already.', sx, sy); return true; }
      // A chest previously left-for-later has its exact loot saved in chestHold;
      // reopening replays that same roll. Fresh opens go through pickReward
      // which handles items AND relics (biome-specific weights).
      const held = save.chestHold && save.chestHold[o.id];
      const chestT = (typeof chestTier === 'function') ? chestTier(o.poiClass) : 2;
      const category = (typeof POI_CATEGORY !== 'undefined' && POI_CATEGORY[o.poiClass]) || 'lowtier';
      // Produce/food stands sell ONE item themed off the POI name (loot.js). It
      // overrides the random rarity roll so the stall always hands over a small
      // stack of exactly what its awning advertises.
      const stand = (typeof produceStandFor === 'function') ? produceStandFor(o) : null;
      const result = held
        ? { kind: 'item', id: held.id, qty: held.n, consolation: 0 }
        // Starter chests carry a fixed payload (5 wood / 5 rockfruit / 9 potato
        // seeds) so the first restoration loop is deterministic — skip the
        // rarity picker and synthesize the same item shape it returns, then fall
        // through to the normal item/modal path below.
        : (o.fixedLoot
            ? { kind: 'item', id: o.fixedLoot.id, qty: o.fixedLoot.qty, consolation: 0 }
            : (stand
                ? { kind: 'item', id: stand.item, qty: 2 + Math.floor(Math.random() * 3), consolation: 0 }
                : ((typeof pickReward === 'function')
                    ? pickReward('chest:' + category, save, undefined, { tier: chestT })
                    : null)));
      if (!result) {
        addMoney(save, 1);
        save.opened.push(o.id);
        ctx.dirty = true;
        scene.flash('Chest had nothing useful.', sx, sy);
        return true;
      }
      if (result.consolation > 0) addMoney(save, result.consolation);
      if (result.kind === 'relic' || result.kind === 'armor') {
        // A chest gear roll can yield a relic OR armor (armor is just another
        // gear slot). equipGearReward handles both — armor also bumps max/cur
        // energy by the delta.
        equipGearReward(result, save, scene);
        save.opened.push(o.id);
        ctx.dirty = true;
        const name = (typeof gearName === 'function')
          ? gearName(result.kind, result.slot, result.tier)
          : `${result.slot} T${result.tier}`;
        const iconHTML = scene.gearIconHTML
          ? scene.gearIconHTML(result.kind, result.slot, result.tier, 64) : '★';
        scene.showChestRewardModal({ iconHTML, name, sub: 'equipped', color: '#ffe066' });
        return true;
      }
      if (result.kind === 'gold') {
        // Non-upgrade relic consolation (reconcileRelicOffer walked up and cashed out).
        save.opened.push(o.id);
        ctx.dirty = true;
        addMoney(save, result.amount || 0);
        const gearKind = result.gearKind || 'relic';
        const name = (typeof gearName === 'function')
          ? gearName(gearKind, result.slot, result.tier)
          : `${result.slot} T${result.tier}`;
        const iconHTML = scene.gearIconHTML
          ? scene.gearIconHTML(gearKind, result.slot, result.tier, 64) : '★';
        scene.showChestRewardModal({ iconHTML, name, sub: 'already own better — discarded', color: '#aaa' });
        return true;
      }
      // kind === 'item'
      const lootId  = result.id;
      const lootQty = result.qty;
      const lootName = (ITEM_BY_ID[lootId]?.name || lootId).toString();
      const lootColor = (typeof tierInfo === 'function') ? tierInfo(lootId).color : '#ffe066';
      // Chest loot gets the full ceremony modal — quick-feedback flashLoot is
      // reserved for X-marks / harvest / mining (cheap repeating rewards).
      const iconHTML = scene.iconSpanHTML ? scene.iconSpanHTML(lootId, 64) : '';
      const qtyLabel = lootQty > 1 ? `× ${lootQty}` : null;
      // If the loot won't fully fit, don't silently drop the overflow — let the
      // player TAKE what fits (chest emptied, rest lost) or LEAVE it for later
      // (chest kept, its exact contents remembered in save.chestHold). Modal
      // buttons fire after this handler returns, so they persist themselves.
      const room = (typeof scene.invRoomFor === 'function') ? scene.invRoomFor(lootId) : Infinity;
      if (lootQty > room) {
        scene.showChestRewardModal({
          iconHTML, name: lootName, qty: qtyLabel, color: lootColor,
          sub: room > 0
            ? `Bag full — room for only ${room} of ${lootQty}.`
            : 'Your bag is full.',
          actions: [
            { label: 'Leave for later', primary: true, onClick: () => {
              save.chestHold = save.chestHold || {};
              save.chestHold[o.id] = { id: lootId, n: lootQty };
              persistSave(save);
              scene.flash?.('Left it in the chest.', sx, sy);
            } },
            { label: room > 0 ? `Take ${room}` : 'Discard', onClick: () => {
              if (room > 0) scene.addToInv(lootId, lootQty);
              save.opened.push(o.id);
              if (save.chestHold) delete save.chestHold[o.id];
              persistSave(save);
            } },
          ],
        });
        return true;
      }
      // Fits fully — take it and empty the chest.
      scene.addToInv(lootId, lootQty);
      save.opened.push(o.id);
      if (save.chestHold) delete save.chestHold[o.id];
      ctx.dirty = true;
      scene.showChestRewardModal({ iconHTML, name: lootName, qty: qtyLabel, color: lootColor });
      return true;
    },
  },

  // ---- Well / fountain: refills the watering can ---------------------------
  // OSM amenity=fountain — a water source on dry land. Tops the can to full,
  // exactly like tapping a WATER tile via the 'can-refill' handler.
  well: {
    custom: (ctx, o) => {
      const { scene, save, sx, sy } = ctx;
      if (typeof Quests !== 'undefined') {
        const done = Quests.onPoiVisit(save, 'well');
        if (done) {
          if (save.relics?.can) { save.canCharges = 50; }
          ctx.dirty = true;
          scene.flash('Quest done! Return to the castle.', scene.viewCenterX, scene.viewCenterY - 60);
          return true;
        }
      }
      if (!save.relics?.can) {
        scene.flash('Cool, clear water. (need a watering can)', sx, sy);
        return true;
      }
      save.canCharges = 50;
      ctx.dirty = true;
      scene.flash('🪣 Watering can full — 50 charges.', sx, sy);
      return true;
    },
  },

  // ---- Buildings: open their UIs ------------------------------------------
  // House / tower (castle turret) route to the shop. Tall sprites — their
  // wider reach is handled by the tap loop before dispatch.
  house: {
    custom: (ctx, o) => { ctx.scene.shopInteract(ctx.sx, ctx.sy, o); return true; },
  },
  tower: {
    custom: (ctx, o) => { ctx.scene.shopInteract(ctx.sx, ctx.sy, o); return true; },
  },
};

// Generic driver for a registered interactable. Returns:
//   'skip'  — caller should `continue` to the next object (spent + spentAction
//             'skip', e.g. a chopped tree stump that shouldn't block the cell)
//   true    — the tap was consumed (gate blocked, work started, or custom done)
//   false   — `o.kind` is not registered (caller falls through to other blocks)
function runInteractable(ctx, o) {
  const def = INTERACTABLES[o.kind];
  if (!def) return false;
  const { scene, save, sx, sy } = ctx;

  // Resolve the entry's declared luck slots into roll multipliers for the
  // complete/custom callbacks. Zeroed when gather-luck is off or none declared,
  // so the off-path is unchanged (see gatherLuck).
  ctx.luck = gatherLuck(save, def.luck);

  if (def.spent && def.spent(o, ctx)) {
    return def.spentAction === 'skip' ? 'skip' : true;
  }
  // Non-tool interactables (fruit harvest, …) own their whole flow.
  if (def.custom) return def.custom(ctx, o);

  // Tool pipeline: gate → spend energy → start the tier-driven work wheel.
  const blockMsg = def.gate ? def.gate(o, save) : null;
  if (blockMsg) { scene.flash(blockMsg, sx, sy); return true; }

  const cost = def.energy ? def.energy(save, o) : 0;
  const durMs = (typeof toolDurationMs === 'function')
    ? toolDurationMs(save.relics, def.tool)
    : (save.relics?.[def.tool] ? 3000 : 9000);
  if (cost && !scene.spendEnergy(cost, sx, sy)) return true;   // can't afford — tap consumed
  // cost is passed through as the refund amount if the player cancels mid-work.
  scene.startWorkProgress(o.x, o.y, () => def.complete(ctx, o), durMs, cost || 0, def.tool);
  return true;
}
