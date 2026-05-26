// Tap dispatch — the priority list from spec INTERACTION, flattened into a
// data array of handlers instead of a 400-line if/else cascade.
//
// Each handler receives a shared `ctx` and returns:
//   true   → consumed the tap, stop iterating
//   'far'  → consumed (a 'too far' flash was shown), stop iterating
//   falsy  → fall through to the next handler
//
// Mutations set ctx.dirty = true; persistSave is called once at the end
// (save.js debounces anyway, so coalescing the 10+ scattered calls into
// one is behaviourally identical).
//
// Depends on:
//   app.js       — MapScene methods (flash, flashLoot, addToInv, shopInteract,
//                  catchCreature, screenToWorldMeters, cellAt, worldMetersToAbsCell,
//                  absCellCenterMeters, buildInventoryDOM, updateMoneyDOM);
//                  module-level helpers (distM2, isTillable);
//                  reach constants (REACH_*).
//   worldgen.js  — WorldGen.tileCache, WorldGen.Z
//   items.js     — ITEM_BY_ID, SEED_TIER, MAX_GROWTH_STAGE
//   loot.js      — pickTreasure, pickLoot, rusticifyName, WILD_TREASURE
//   save.js      — persistSave
//
// Exports as globals:
//   TAP_HANDLERS   — priority-ordered array of { name, try(ctx) }
//   interactTap(scene, sx, sy)  — top-level dispatcher; MapScene.handleWorldTap forwards to this

// Two object-position points within this squared screen-pixel distance are
// treated as the same world object (de-dupes overlapping POI/tree/chest sprites
// when the player taps a busy corner). 40² = ~1.25 cells at CELL_PX=32.
const TAP_DEDUPE_R2 = 40 * 40;

// Decrement the selected inventory stack by `n` (default 1). If it hits zero,
// splice it out and clamp selSlot so it still points at a valid slot. Used by
// every handler that consumes a held item (plant, release-animal, place-rock).
// Caller is responsible for setting ctx.dirty and calling buildInventoryDOM.
function consumeSelected(save, n = 1) {
  const sel = save.inv[save.selSlot];
  if (!sel) return;
  sel.count -= n;
  if (sel.count > 0) return;
  save.inv.splice(save.selSlot, 1);
  if (save.selSlot >= save.inv.length) {
    save.selSlot = Math.max(0, save.inv.length - 1);
  }
}

const TAP_HANDLERS = [
  // -1) Work-progress guard — any tap while a chop/break is in progress cancels it.
  // Ignore taps in the first 150ms after start so the same tap that LAUNCHED
  // the progress wheel can't be re-dispatched a frame later and immediately
  // cancel it (a real risk on double-tap or held-pointer interactions).
  { name: 'work-progress', try: (ctx) => {
    const wp = ctx.scene._workProgress;
    if (!wp) return false;
    if (performance.now() - (wp.startT || 0) < 150) return true;   // swallow, don't cancel
    ctx.scene.cancelWorkProgress();
    return true;
  }},

  // -0.6) Flute / Book — tap your own feet (≤1.5m) with one selected to use it.
  // These run BEFORE eat so the same "tap self with selected item" gesture
  // routes to the right consumable based on the item id.
  { name: 'use-consumable', try: (ctx) => {
    const { scene, save, wm, pWorldX, pWorldY, sx, sy } = ctx;
    const dx = wm.x - pWorldX, dy = wm.y - pWorldY;
    if (dx * dx + dy * dy > 1.5 * 1.5) return false;
    const sel = getSelectedSlot(save);
    if (!sel || (sel.count ?? 0) <= 0) return false;
    if (sel.id === 'flute') {
      scene.showOfferModal({
        title: 'Play the flute?',
        get: '🪈 lure nearby creatures',
        cost: `1× 🪈 Flute`,
        canAfford: true,
        acceptLabel: 'Play',
        onAccept: () => scene.playFlute(),
      });
      return true;
    }
    if (sel.id === 'book') {
      scene.showOfferModal({
        title: 'Read the book?',
        get: '📖 a tip from the elders',
        cost: `1× 📖 Book`,
        canAfford: true,
        acceptLabel: 'Read',
        onAccept: () => scene.readBook(),
      });
      return true;
    }
    return false;
  }},

  // -0.5) Eat — tap the player's own feet (within 1.5m) with a food selected.
  // Eating is a deliberate action so we show a confirmation modal rather than
  // silently consuming the stack on a stray tap.
  { name: 'eat', try: (ctx) => {
    const { scene, save, wm, pWorldX, pWorldY, sx, sy } = ctx;
    const dx = wm.x - pWorldX, dy = wm.y - pWorldY;
    if (dx * dx + dy * dy > 1.5 * 1.5) return false;
    const sel = getSelectedSlot(save);
    if (!sel || (sel.count ?? 0) <= 0) return false;
    const restore = (typeof FOOD_ENERGY !== 'undefined') ? FOOD_ENERGY[sel.id] : null;
    if (restore == null) return false;
    const item = ITEM_BY_ID[sel.id];
    // Items with a more-specific cell action take priority over eat — seeds go
    // to plant, rockfruit to place-rock, etc. Without this gate the player
    // couldn't till/plant the cell directly under their feet while holding
    // food, because eat would intercept the tap.
    if (item && (item.kind === 'seed' || item.id === 'rockfruit')) return false;
    // Don't let a stray tap consume food at full energy for zero gain.
    const curE = save.energy ?? 0;
    const maxE = save.maxEnergy ?? (typeof STARTING_ENERGY !== 'undefined' ? STARTING_ENERGY : 100);
    if (curE >= maxE) { scene.flash('not hungry', sx, sy); return true; }
    scene.showOfferModal({
      title: 'Eat this?',
      get: `⚡ +${restore} energy`,
      cost: `1× ${scene.iconSpanHTML(sel.id)} ${item?.name || sel.id}`,
      canAfford: true,
      acceptLabel: 'Eat',
      onAccept: () => { scene.eatSelected(); },
    });
    return true;
  }},

  // 0) Treasure mark — tap within ~1.5 cells of the X opens it.
  { name: 'treasure', try: (ctx) => {
    const { scene, save, wm, pCellCx, pCellCy, sx, sy } = ctx;
    const found = new Set(save.foundTreasures || []);
    const tryClaim = (tr) => {
      if (!tr || found.has(tr.id)) return false;
      if (distM2(tr.x, tr.y, wm.x, wm.y) >= REACH_TREASURE_M * REACH_TREASURE_M) return false;
      if (distM2(tr.x, tr.y, pCellCx, pCellCy) > REACH_FAR_M * REACH_FAR_M) { scene.flash('too far', sx, sy); return 'far'; }
      save.foundTreasures = [...found, tr.id];
      // Treasure marks go through the unified rarity picker — class biased
      // toward seed/produce/mineral/consumable, boostP low (most marks pay
      // out small), relicCap 0 (mark never hands out a relic — that's what
      // chests are for). Jackpot fanfare fires only on +2 or larger.
      const reward = (typeof pickReward === 'function')
        ? pickReward('treasure:default', save) : null;
      if (!reward) {
        // Shouldn't happen — context exists — but bail safely if rarity.js
        // is missing or the pool is empty.
        addMoney(save, 1);
        scene.flashLoot('✕ → $1', '#ffd96b');
        if (scene.updateMoneyDOM) scene.updateMoneyDOM();
      } else if (reward.kind === 'item') {
        scene.addToInv(reward.id, reward.qty);
        const item = ITEM_BY_ID[reward.id];
        const ti = (typeof tierInfo === 'function') ? tierInfo(reward.id) : null;
        const color = ti?.color || '#ffe066';
        const label = `✕ → ${item?.name || reward.id}${reward.qty > 1 ? ` ×${reward.qty}` : ''}`;
        scene.flashLoot(label, color, 1, reward.id);
        if (reward.jackpot >= 2 && typeof scene.flashJackpot === 'function') {
          scene.flashJackpot(reward.jackpot);
        }
      } else if (reward.kind === 'gold') {
        addMoney(save, reward.amount);
        scene.flashLoot(`✕ → $${reward.amount}`, '#ffd96b');
        if (scene.updateMoneyDOM) scene.updateMoneyDOM();
      }
      ctx.dirty = true;
      return true;
    };
    for (const entry of WorldGen.tileCache.values()) {
      const r1 = tryClaim(entry.treasure);
      if (r1 === true || r1 === 'far') return r1;
      if (entry.parkingTreasures) for (const tr of entry.parkingTreasures) {
        const r = tryClaim(tr);
        if (r === true || r === 'far') return r;
      }
    }
    return false;
  }},

  // 1) Tap a creature within 4m. The outcome depends on what's in the
  // selected inventory slot:
  //
  //   FAVOURITE FOOD                 → catch (consumes 1, spends energy).
  //                                    chicken→rainberry, cow→pairy,
  //                                    cat→milk, dog→egg.
  //   PLANT PRODUCE on chicken/cow   → feed for produce: consume the
  //                                    plant, gain 1 egg (chicken) or
  //                                    1 milk (cow). Any crop produce or
  //                                    wild plant works (longgrass,
  //                                    shrub, nut, rockfruit, flowers,
  //                                    farmed crops…). Animal stays.
  //   ANY OTHER FOOD on this animal  → YUCK: consume the food anyway, no
  //                                    catch, no produce. (Cats/dogs
  //                                    turn up their nose at plants;
  //                                    chickens/cows refuse meat / dairy.)
  //   NOTHING / non-food selected    → flash a hint with the favourite.
  { name: 'creature', try: (ctx) => {
    const { scene, save, wm, sx, sy } = ctx;
    let target = null, bestD2 = REACH_CREATURE_M * REACH_CREATURE_M;
    WorldGen.forEachItem('creatures', (c) => {
      if (save.caught.includes(c.id)) return;
      const d2 = distM2(c.x, c.y, wm.x, wm.y);
      if (d2 < bestD2) { bestD2 = d2; target = c; }
    });
    if (!target) return false;
    // Wilderness creatures: rabbit has no relic gate; deer needs ANY weapon
    // relic equipped (sword / bow / staff — hunting is hunting); crow /
    // butterfly require the Bug Net. Drops are a fixed loot id, not the
    // kind name, so we handle inventory + caught tracking inline instead of
    // routing through scene.catchCreature (which is wired for the
    // favourite-food chicken/cow yield logic). Bug Net tier discounts catch
    // energy: 5 → max(1, 5 - tier).
    //
    // Catching adds the live animal itself to the inventory — not a derived
    // product (the player can decide later whether to process the animal
    // into meat / pelt / feather). The animal id matches target.kind so the
    // catalog needs deer/rabbit/crow/butterfly entries with kind:'animal'.
    const WILDERNESS_KINDS = new Set(['deer', 'rabbit', 'crow', 'butterfly']);
    if (WILDERNESS_KINDS.has(target.kind)) {
      const isFlying = target.kind === 'crow' || target.kind === 'butterfly';
      if (isFlying && !save.relics?.bugnet) {
        scene.flash('need a bug net', sx, sy);
        return true;
      }
      if (target.kind === 'deer') {
        const r = save.relics || {};
        const hasWeapon = !!(r.sword || r.bow || r.staff);
        if (!hasWeapon) { scene.flash('need a weapon', sx, sy); return true; }
      }
      const baseCost = ENERGY_COST?.catch ?? 0;
      const bugnetTier = save.relics?.bugnet?.tier || 0;
      const energyCost = Math.max(1, baseCost - bugnetTier);
      if (!scene.spendEnergy(energyCost, sx, sy)) return true;
      save.caught.push(target.id);
      save.caughtKinds = save.caughtKinds || {};
      save.caughtKinds[target.kind] = (save.caughtKinds[target.kind] || 0) + 1;
      scene.addToInv(target.kind, 1);
      ctx.dirty = true;
      const item = ITEM_BY_ID[target.kind];
      scene.flashLoot(`+1 ${item?.name || target.kind}`, '#ffe066', 1, target.kind);
      return true;
    }
    const sel = getSelectedSlot(save);
    // ANIMAL_FOOD is keyed by creature kind. The catalog now stores either a
    // single string ('rainberry') or an array of accepted ids (e.g. cats take
    // milk OR any fish). Normalise to a Set so the membership check below
    // doesn't need to branch on type.
    const wantRaw = (typeof ANIMAL_FOOD !== 'undefined') ? ANIMAL_FOOD[target.kind] : null;
    const wantSet = wantRaw ? new Set(Array.isArray(wantRaw) ? wantRaw : [wantRaw]) : null;
    const wantPrimary = wantRaw ? (Array.isArray(wantRaw) ? wantRaw[0] : wantRaw) : null;
    const selItem = sel ? ITEM_BY_ID[sel.id] : null;
    const isEdible = sel && (typeof FOOD_ENERGY !== 'undefined') && (sel.id in FOOD_ENERGY);
    // "Plant produce" = anything tagged kind:'produce' that came from a plant
    // — farmed crops carry an `item.crop` ref; longgrass too; the bare
    // 'flowers' pickup is a wild plant with no .crop but still plant-origin.
    // Excludes egg / milk (also kind:'produce' but they're animal-source).
    const isPlantProduce = selItem && selItem.kind === 'produce'
      && (!!selItem.crop || sel.id === 'flowers');
    // 1. Favourite → catch.
    if (sel && wantSet && wantSet.has(sel.id) && (sel.count ?? 0) > 0) {
      if (!scene.spendEnergy(ENERGY_COST?.catch ?? 0, sx, sy)) return true;
      consumeSelected(save);
      scene.buildInventoryDOM();
      scene.catchCreature(target, sx, sy);
      return true;
    }
    // 2. Plant produce → produce (chicken / cow only).
    if (sel && isPlantProduce && (sel.count ?? 0) > 0) {
      const yieldId = target.kind === 'chicken' ? 'egg'
                    : target.kind === 'cow'     ? 'milk'
                    : null;
      if (yieldId) {
        consumeSelected(save);
        scene.addToInv(yieldId, 1);
        scene.buildInventoryDOM();
        scene.flashLoot(`+1 ${ITEM_BY_ID[yieldId]?.name || yieldId}`, '#a7ffb0', 1, yieldId);
        ctx.dirty = true;
        return true;
      }
    }
    // 3. Any other food → yuck. Wasted bite.
    if (sel && isEdible && (sel.count ?? 0) > 0) {
      consumeSelected(save);
      scene.buildInventoryDOM();
      scene.flashLoot(`🤢 yuck`, '#ff8a7a', 1, sel.id);
      ctx.dirty = true;
      return true;
    }
    // 4. Hint — show the primary favourite (first entry of the list) so the
    // flash stays short. Cats list milk first so the existing "needs Milk"
    // copy survives even with new fish bait accepted.
    const wantName = wantPrimary ? (ITEM_BY_ID[wantPrimary]?.name || wantPrimary) : 'food';
    scene.flash(`needs ${wantName}`, sx, sy);
    return true;
  }},

  // 1a) Pick the wild plant CLOSEST to the tap within REACH_WILDPLANT_M.
  { name: 'wildplant', try: (ctx) => {
    const { scene, save, wm, pCellCx, pCellCy, sx, sy } = ctx;
    const pickedSet = new Set(save.picked || []);
    let bestWp = null, bestD2 = REACH_WILDPLANT_M * REACH_WILDPLANT_M;
    WorldGen.forEachItem('wildplants', (wp) => {
      if (pickedSet.has(wp.id)) return;
      const d2 = distM2(wp.x, wp.y, wm.x, wm.y);
      if (d2 < bestD2) { bestD2 = d2; bestWp = wp; }
    });
    if (bestWp) {
      const wp = bestWp;
      if (distM2(wp.x, wp.y, pCellCx, pCellCy) > REACH_FAR_M * REACH_FAR_M) { scene.flash('too far', sx, sy); return 'far'; }
      // Some wild crops require physical work to harvest, mirroring their
      // hard-object cousins:
      //   rockfruit (stone debris) → pick relic speeds up rock-breaking work
      //   shrub     (woody bush)   → axe  relic speeds up chop work
      // Both: 3s with the matching relic, 10s bare-handed. Other wildplants
      // (rainberry, pairy, nut, longgrass …) stay instant.
      const award = () => {
        // Re-check picked at callback time. The work wheel runs async — if a
        // save reload or some other path already marked this wp.id as picked
        // between handler start and callback fire, awarding again would dupe.
        if ((save.picked || []).includes(wp.id)) return;
        save.picked = [...(save.picked || []), wp.id];
        scene.addToInv(wp.crop, 1);
        let bonus = '';
        const treasure = WILD_TREASURE[wp.crop];
        if (treasure && Math.random() < treasure.chance) {
          scene.addToInv(treasure.bonus, 1);
          bonus = ` ✨${treasure.bonus}`;
        }
        persistSave(save);
        if (bonus) scene.flashLoot(`${wp.crop}${bonus}`, '#ff8aff', 1, wp.crop);
        else scene.flashLoot(`+1 ${wp.crop}`, undefined, 1, wp.crop);
      };
      const WORK_RELIC = { rockfruit: 'pick', shrub: 'axe' };
      const reqRelic = WORK_RELIC[wp.crop];
      if (reqRelic) {
        // Duration scales with tool tier (10s bare → 3s wood → 0.5s frost),
        // same curve for both pick and axe slots.
        const durMs = (typeof toolDurationMs === 'function')
          ? toolDurationMs(save.relics, reqRelic)
          : (save.relics?.[reqRelic] ? 3000 : 10000);
        scene.startWorkProgress(wp.x, wp.y, award, durMs);
      } else {
        award();
        ctx.dirty = true;
      }
      return true;
    }
    // 1a') Pick the polygon flower CLOSEST to the tap within REACH_WILDPLANT_M.
    let bestF = null, bestD2F = REACH_WILDPLANT_M * REACH_WILDPLANT_M;
    WorldGen.forEachItem('objects', (o) => {
      if (o.kind !== 'flora' || o.deco !== 'flower') return;
      if (pickedSet.has(o.id)) return;
      const d2 = distM2(o.x, o.y, wm.x, wm.y);
      if (d2 < bestD2F) { bestD2F = d2; bestF = o; }
    });
    if (bestF) {
      const o = bestF;
      if (distM2(o.x, o.y, ctx.pCellCx, ctx.pCellCy) > REACH_FAR_M * REACH_FAR_M) { scene.flash('too far', sx, sy); return 'far'; }
      save.picked = [...pickedSet, o.id];
      scene.addToInv('flowers', 1);
      ctx.dirty = true;
      scene.flashLoot(`+1 🌼 flowers`);
      return true;
    }
    return false;
  }},

  // 1b) World objects: chest open, tree flavor, house shop.
  { name: 'object', try: (ctx) => {
    const { scene, save, wm, pCellCx, pCellCy, sx, sy } = ctx;
    const openedSetTap = new Set(save.opened);
    const allObjs = [];
    // Wrap push in a block so we don't return its truthy result —
    // forEachItem treats any truthy return as "stop iterating".
    WorldGen.forEachItem('objects', (o) => { allObjs.push(o); });
    allObjs.sort((a, b) => {
      const ao = a.kind === 'chest' && openedSetTap.has(a.id) ? 1 : 0;
      const bo = b.kind === 'chest' && openedSetTap.has(b.id) ? 1 : 0;
      return ao - bo;
    });
    const seenTapByIdent = new Map();
    const isDupTapChest = (o) => {
      const ident = o.name || o.poiClass;
      if (!ident) return false;
      let list = seenTapByIdent.get(ident);
      if (list) {
        for (const p of list) {
          if ((p.x - o.x) * (p.x - o.x) + (p.y - o.y) * (p.y - o.y) < TAP_DEDUPE_R2) return true;
        }
      } else {
        list = [];
        seenTapByIdent.set(ident, list);
      }
      list.push({ x: o.x, y: o.y });
      return false;
    };
    for (const o of allObjs) {
      if (o.kind === 'chest' && isDupTapChest(o)) continue;
      const r = (o.kind === 'house' || o.kind === 'tower') ? REACH_HOUSE_M : REACH_OBJECT_M;
      if (distM2(o.x, o.y, wm.x, wm.y) >= r * r) continue;
      if (distM2(o.x, o.y, pCellCx, pCellCy) > REACH_FAR_M * REACH_FAR_M) {
        scene.flash('too far', sx, sy); return 'far';
      }
      if (o.kind === 'chest') {
        if (save.opened.includes(o.id)) { scene.flash('already looted', sx, sy); return true; }
        // 10% chance to roll a relic reward instead of normal loot. The picker
        // is biased by the chest's TIER (lowtier → wood, flora → frost) and
        // gated by player harvests/cow catch. If the rolled slot/tier would be
        // an upgrade → equip it. Otherwise → half its gold value as a
        // consolation (player always gets something useful).
        if (Math.random() < 0.10) {
          const chestT = (typeof chestTier === 'function') ? chestTier(o.poiClass) : 2;
          const reward = (typeof pickChestRelic === 'function')
            ? pickChestRelic(undefined, save, save.relics, chestT)
            : null;
          if (reward?.kind === 'relic') {
            save.relics[reward.slot] = { tier: reward.tier };
            scene.markRelicsDirty?.();
            save.opened.push(o.id);
            ctx.dirty = true;
            const name = (typeof gearName === 'function')
              ? gearName('relic', reward.slot, reward.tier)
              : `${reward.slot} T${reward.tier}`;
            scene.flashLoot(`★ ${name}`, '#ffe066', 1.5);
            return true;
          }
          if (reward?.kind === 'gold') {
            addMoney(save, reward.amount);
            save.opened.push(o.id);
            ctx.dirty = true;
            if (scene.updateMoneyDOM) scene.updateMoneyDOM();
            const name = (typeof gearName === 'function')
              ? gearName('relic', reward.slot, reward.tier)
              : `${reward.slot} T${reward.tier}`;
            scene.flashLoot(`★ ${name} (own) → $${reward.amount}`, '#ffd96b', 1.4);
            return true;
          }
          // reward is null (no allowed tiers — very early game) — fall through.
        }
        const loot = pickLoot(undefined, o.poiClass, save.relics);
        scene.addToInv(loot.id, loot.n);
        save.opened.push(o.id);
        ctx.dirty = true;
        const lootName = (ITEM_BY_ID[loot.id]?.name || loot.id).toString();
        // Sprite shows the loot — drop the icon from the text.
        scene.flashLoot(`${lootName} ×${loot.n}`, tierInfo(loot.id).color, 1.25, loot.id);
        return true;
      }
      if (o.kind === 'tree') {
        // Chopped flag is persisted into save.chopped so a tile re-rasterize
        // (e.g. cache eviction after a long walk) doesn't regrow the stump.
        // We skip chopped trees entirely so they don't block 'till' on their
        // cell — let the next handler claim the tap instead of consuming it
        // with a 'stump' flash that the player can't act on.
        if (o.chopped || (save.chopped && save.chopped.includes(o.id))) continue;
        if (!save.relics?.axe) { scene.flash('need an axe', sx, sy); return true; }
        const durMs = (typeof toolDurationMs === 'function')
          ? toolDurationMs(save.relics, 'axe') : 3000;
        scene.startWorkProgress(o.x, o.y, () => {
          o.chopped = true;
          save.chopped = save.chopped || [];
          if (!save.chopped.includes(o.id)) save.chopped.push(o.id);
          scene.addToInv('tree', 1 + Math.floor(Math.random() * 2));
          persistSave(save);
          scene.flash('🌲 chopped', sx, sy);
        }, durMs);
        return true;
      }
      if (o.kind === 'house' || o.kind === 'tower') {
        scene.shopInteract(sx, sy, o);
        return true;
      }
      if (o.kind === 'fruittree') {
        const pickedSet = new Set(save.picked || []);
        if (pickedSet.has(o.id)) {
          scene.flash('not ripe yet', sx, sy);
          return true;
        }
        save.picked = [...pickedSet, o.id];
        scene.addToInv(o.species, 1 + Math.floor(Math.random() * 2));
        ctx.dirty = true;
        const item = ITEM_BY_ID[o.species];
        scene.flashLoot(`harvested ${item?.name || o.species}`, '#a7ffb0', 1, o.species);
        return true;
      }
      if (o.kind === 'mineralrock') {
        // brokenRockSet is normally keyed by cell-key (numeric "IX_IY") for
        // natural rock cells. Mineral rock ids look like "mr_..." so collisions
        // with cell-keys are essentially impossible — reuse the same set.
        if (scene.brokenRockSet.has(o.id)) { scene.flash('spent', sx, sy); return true; }
        const pickTier = save.relics?.pick?.tier || 0;
        if (pickTier < o.requiredTier) {
          scene.flash(`need T${o.requiredTier} pickaxe`, sx, sy);
          return true;
        }
        const cost = 10 + (o.requiredTier - 1) * 4;
        if (!scene.spendEnergy(cost, sx, sy)) return true;
        const durMs = (3 + (o.requiredTier - 1) * 1) * 1000;
        scene.startWorkProgress(o.x, o.y, () => {
          scene.brokenRockSet.add(o.id);
          save.brokenRocks = [...scene.brokenRockSet];
          scene.addToInv('coal', 1 + Math.floor(Math.random() * 3));
          const gem = o.requiredTier >= 5 ? 'emerald' : (o.requiredTier >= 3 ? 'ruby' : 'sapphire');
          scene.addToInv(gem, 1 + Math.floor(Math.random() * (o.requiredTier > 4 ? 2 : 1)));
          persistSave(save);
          scene.flash(`💎 ${gem}`, sx, sy);
        }, durMs);
        return true;
      }
    }
    return false;
  }},

  // 2) Cell resolution — compute cell + bail early on unloaded / out-of-reach.
  // This handler also resolves and caches the cell info onto ctx for downstream handlers.
  //
  // Reach origin is the PLAYER'S CELL CENTRE (not their feet). Otherwise
  // standing near the edge of your current cell would extend reach in one
  // direction and shorten it the other — players reported sometimes seeing
  // only 2 cells of reach in one direction. Cell-centre origin makes the
  // reachable area depend only on which cell you're in, not where in it you
  // stand, so the 3-cell cardinal reach is consistent everywhere.
  { name: 'cell-resolve', try: (ctx) => {
    const { scene, wm, pWorldX, pWorldY, sx, sy } = ctx;
    const cell = scene.cellAt(wm.x, wm.y);
    if (!cell.loaded) { scene.flash('loading…', sx, sy); return true; }
    const { cellIX, cellIY } = worldMetersToAbsCell(scene, wm.x, wm.y);
    const { x: cwmx, y: cwmy } = absCellCenterMeters(scene, cellIX, cellIY);
    // Use the dispatcher-supplied body-cell centre (ctx.pCellCx / pCellCy),
    // which is computed from the player BODY world position. The visual reach
    // outline in render.js is also body-centred, so the two stay in sync.
    if (Math.hypot(cwmx - ctx.pCellCx, cwmy - ctx.pCellCy) > scene.REACH_CELL_M) {
      scene.flash('too far', sx, sy); return true;
    }
    ctx.cell = cell;
    ctx.cellIX = cellIX;
    ctx.cellIY = cellIY;
    ctx.cwmx = cwmx;
    ctx.cwmy = cwmy;
    ctx.cellKey = cellKeyFromAbsCell(cellIX, cellIY);
    return false;
  }},

  // 2-pre) Release a selected animal onto this cell.
  // Only on passable (tillable) ground — water, roads, paths, buildings, and cement
  // pads all refuse the release so the creature sprite never ends up floating on a
  // roof / inside a wall.
  { name: 'release', try: (ctx) => {
    const { scene, save, sx, sy, cwmx, cwmy, cell } = ctx;
    const sel = getSelectedSlot(save);
    const item = sel ? ITEM_BY_ID[sel.id] : null;
    if (!(item && item.kind === 'animal' && (sel.count ?? 0) > 0)) return false;
    if (!isTillable(cell.type)) {
      scene.flash("can't release here", sx, sy);
      return true;
    }
    // Chickens are flock animals — one "release" drops a clutch of 4 hens, so
    // you need at least 4 in the stack to place any. Cows (and any future
    // non-flock animal) still release one at a time.
    const flockSize = item.id === 'chicken' ? 4 : 1;
    if ((sel.count ?? 0) < flockSize) {
      scene.flash(`need ${flockSize} ${item.id}s`, sx, sy);
      return true;
    }
    const tx = Math.floor(cwmx / scene.tileEdgeM);
    const ty = Math.floor(cwmy / scene.tileEdgeM);
    save.released = save.released || [];
    const entry = WorldGen.tileCache.get(`${WorldGen.Z}/${tx}/${ty}`);
    // Spread the flock around the tap point so they don't all stack on one
    // pixel. Tight ~1.2m cluster keeps them in the same cell visually but
    // still gives wanderCreatures distinct starting positions.
    const SPREAD = 1.2;
    for (let i = 0; i < flockSize; i++) {
      const angle = (i / flockSize) * Math.PI * 2;
      const ox = flockSize === 1 ? 0 : Math.cos(angle) * SPREAD;
      const oy = flockSize === 1 ? 0 : Math.sin(angle) * SPREAD;
      const id = `released_${item.id}_${Date.now()}_${Math.floor(Math.random() * 1e6)}_${i}`;
      save.released.push({ x: cwmx + ox, y: cwmy + oy, kind: item.id, id, tx, ty });
      if (entry && entry.creatures) entry.creatures.push({ x: cwmx + ox, y: cwmy + oy, kind: item.id, id });
    }
    consumeSelected(save, flockSize);
    ctx.dirty = true;
    scene.buildInventoryDOM();
    scene.flash(`released ${flockSize}× ${item.icon || ''} ${item.id}`, sx, sy);
    return true;
  }},

  // 2-placed-rock) Tap a player-placed rockfruit stone → pick it back up (with progress wheel).
  { name: 'pickup-rock', try: (ctx) => {
    const { scene, save, sx, sy, cellKey, cwmx, cwmy } = ctx;
    if (!scene.placedRockSet.has(cellKey)) return false;
    scene.startWorkProgress(cwmx, cwmy, () => {
      scene.placedRockSet.delete(cellKey);
      save.placedRocks = [...scene.placedRockSet];
      scene.addToInv('rockfruit', 1);
      persistSave(save);
      scene.flash('⛏ rockfruit', sx, sy);
    });
    return true;
  }},

  // 2-place-rock) With rockfruit selected, drop a stone on an empty tillable cell.
  { name: 'place-rock', try: (ctx) => {
    const { scene, save, sx, sy, cell, cellKey, cwmx, cwmy } = ctx;
    const sel = getSelectedSlot(save);
    const selItem = sel ? ITEM_BY_ID[sel.id] : null;
    if (!(selItem && selItem.id === 'rockfruit' && (sel.count ?? 0) > 0 &&
          isTillable(cell.type) && !scene.tilledSet.has(cellKey) &&
          !save.planted.some(p => Math.abs(p.x - cwmx) < 0.1 && Math.abs(p.y - cwmy) < 0.1))) return false;
    if (!scene.spendEnergy(ENERGY_COST?.rockPlace ?? 0, sx, sy)) return true;
    scene.placedRockSet.add(cellKey);
    save.placedRocks = [...scene.placedRockSet];
    consumeSelected(save);
    ctx.dirty = true;
    scene.buildInventoryDOM();
    scene.flash('🪨 placed', sx, sy);
    return true;
  }},

  // 2-rock) Tap a natural rock cell → break it. Requires a pickaxe relic;
  // costs energy (mitigated by pick tier).
  { name: 'rock', try: (ctx) => {
    const { scene, save, sx, sy, cell, cellKey, cwmx, cwmy } = ctx;
    if (cell.type !== 10) return false;
    if (scene.brokenRockSet.has(cellKey)) {
      scene.flash('rubble', sx, sy);
      return true;
    }
    // No pickaxe? Bare-handed mining still works — it just takes ~3× longer.
    // Bare hands: 10s · Wood: 3s · Copper: 2.25s · Iron: 1.5s · floor 0.5s.
    // Energy cost is unchanged (pick tier already discounts via
    // effectivePickCost).
    const cost = (typeof effectivePickCost === 'function')
      ? effectivePickCost(save.relics) : (ENERGY_COST?.rockBreak ?? 0);
    if (!scene.spendEnergy(cost, sx, sy)) return true;
    const durMs = (typeof pickDurationMs === 'function')
      ? pickDurationMs(save.relics)
      : (save.relics?.pick ? 3000 : 10000);
    scene.startWorkProgress(cwmx, cwmy, () => {
      scene.brokenRockSet.add(cellKey);
      save.brokenRocks = [...scene.brokenRockSet];
      const r = Math.random();
      let msg = '💥 broken';
      // Cumulative probability table — rarer rewards come first so each
      // bucket adds its own slice. ~30% of rocks now drop coal/gems.
      if (r < 0.002)        { scene.addToInv('emerald', 1);          msg = '💥 → ✨ emerald'; }
      else if (r < 0.008)   { scene.addToInv('ruby', 1);              msg = '💥 → ✨ ruby'; }
      else if (r < 0.025)   { scene.addToInv('sapphire', 1);          msg = '💥 → ✨ sapphire'; }
      else if (r < 0.030)   { scene.addToInv('gemfruit', 1);          msg = '💥 → ✨ gemfruit'; }
      else if (r < 0.040)   { addMoney(save, 25); scene.updateMoneyDOM?.(); msg = '💥 → $25'; }
      else if (r < 0.060)   { scene.addToInv('gemfruit_seed', 1);     msg = '💥 → gemfruit seed'; }
      else if (r < 0.130)   { addMoney(save,  5); scene.updateMoneyDOM?.(); msg = '💥 → $5'; }
      else if (r < 0.430)   { scene.addToInv('coal', 1 + Math.floor(Math.random() * 2)); msg = '💥 → coal'; }
      else if (r < 0.700)   { scene.addToInv('rockfruit_seed', 1);    msg = '💥 → rockfruit seed'; }
      persistSave(save);
      scene.flash(msg, sx, sy);
    }, durMs);
    return true;
  }},

  // 2a) Tap a planted cell → harvest / advance / water / nag.
  { name: 'planted', try: (ctx) => {
    const { scene, save, sx, sy, cellKey, cwmx, cwmy } = ctx;
    const plantedIdx = save.planted.findIndex(p =>
      Math.abs(p.x - cwmx) < 0.1 && Math.abs(p.y - cwmy) < 0.1);
    if (plantedIdx < 0) return false;
    const p = save.planted[plantedIdx];
    const stageHoldMs = 60 * 60 * 1000;
    const sinceWater = p.watered_t ? Date.now() - p.watered_t : Infinity;
    if (p.watered_t && sinceWater >= stageHoldMs && (p.stage ?? 0) < MAX_GROWTH_STAGE) {
      p.stage = (p.stage ?? 0) + 1;
      p.watered_t = 0;
      ctx.dirty = true;
      scene.flash('🌱 grew', sx, sy);
      return true;
    }
    if ((p.stage ?? 0) >= MAX_GROWTH_STAGE) {
      if (!scene.spendEnergy(ENERGY_COST?.harvest ?? 0, sx, sy)) return true;
      save.planted.splice(plantedIdx, 1);
      scene.tilledSet.delete(cellKey);
      save.tilled = [...scene.tilledSet];
      // Watering-can quality bonus stored on the plant when it was watered.
      // Each quality tier raises the extra-seed chance by 10% (base 25%) and
      // adds +floor(qual/3) to the produce yield.
      const qual = p.canBoost || 0;
      const yieldN = 1 + Math.floor(Math.random() * 3) + Math.floor(qual / 3);
      scene.addToInv(p.crop, yieldN);
      const gotSeed = Math.random() < (0.25 + qual * 0.10);
      if (gotSeed) scene.addToInv(`${p.crop}_seed`, 1);
      // Track harvest milestones — gates which relic tiers can drop from chests
      // (sunflower→Gold, fireflower→Crimson, iceflower→Frost). See loot.js
      // pickChestRelic / chestRelicAllowedTiers.
      save.harvested = save.harvested || {};
      save.harvested[p.crop] = (save.harvested[p.crop] || 0) + 1;
      ctx.dirty = true;
      const cropIcon = ITEM_BY_ID[p.crop]?.icon || '';
      // Sprite shows the crop — drop the wheat / cropIcon emojis from the text.
      scene.flashLoot(`harvested ${p.crop} ×${yieldN}${gotSeed ? ' +seed' : ''}`, '#a7ffb0', 1, p.crop);
      return true;
    }
    if (!p.watered_t) {
      p.watered_t = Date.now();
      // Watering Can quality: bonus = can.tier + (charges > 0 ? 2 : 0).
      // Charges from refilling at a water tile (see the 'can-refill' handler).
      const can = save.relics?.can;
      if (can?.tier) {
        const filled = (save.canCharges ?? 0) > 0;
        p.canBoost = can.tier + (filled ? 2 : 0);
        if (filled) save.canCharges -= 1;
      }
      ctx.dirty = true;
      scene.flash(p.canBoost ? `💧 watered +${p.canBoost}` : '💧 watered', sx, sy);
      return true;
    }
    const minsLeft = Math.max(1, Math.ceil((stageHoldMs - sinceWater) / 60000));
    scene.flash(`growing… ${minsLeft}m`, sx, sy);
    return true;
  }},

  // 2a') Refill the watering can from any WATER tile (type 3). Sets a charge
  // bank that gives +2 tiers of quality bonus on the next 50 watering events.
  { name: 'can-refill', try: (ctx) => {
    const { scene, save, sx, sy, cell } = ctx;
    if (cell.type !== 3) return false;          // not water
    if (!save.relics?.can) return false;         // no can equipped
    save.canCharges = 50;
    ctx.dirty = true;
    scene.flash('🪣 can refilled (50 charges)', sx, sy);
    return true;
  }},

  // 2a-fish) Fishing: tap a water cell (type 3) with a Fishing Rod relic equipped.
  // Triggers a 5s work-progress, then drops a random fish weighted by rarity
  // (modified by rod tier — higher tier → more chance of rare fish). Placed
  // BEFORE flavor so the water-tap doesn't get eaten by the 'water' label.
  { name: 'fishing', try: (ctx) => {
    const { scene, save, sx, sy, cell } = ctx;
    if (cell.type !== 3) return false;
    if (!save.relics?.rod) {
      scene.flash('need a fishing rod', sx, sy);
      return true;
    }
    if (!scene.spendEnergy(5, sx, sy)) return true;
    scene.startWorkProgress(ctx.cwmx, ctx.cwmy, () => {
      const tier = save.relics?.rod?.tier || 1;
      const fish = [
        { id: 'minnow',     w: Math.max(0.5, 10 - tier * 1.0) },
        { id: 'bass',       w: 3 + tier * 0.5 },
        { id: 'trout',      w: 1 + tier * 0.5 },
        { id: 'salmon',     w: 0.3 + tier * 0.3 },
        { id: 'goldenfish', w: 0.05 + tier * 0.15 },
      ];
      const total = fish.reduce((a, b) => a + b.w, 0);
      let r = Math.random() * total;
      let pick = fish[0];
      for (const f of fish) { r -= f.w; if (r <= 0) { pick = f; break; } }
      scene.addToInv(pick.id, 1);
      persistSave(save);
      const item = ITEM_BY_ID[pick.id];
      scene.flashLoot(`🐟 ${item?.name || pick.id}`, '#7adcff', 1, pick.id);
    }, 5000);
    return true;
  }},

  // 2b) Tap non-tillable terrain → flavor label.
  { name: 'flavor', try: (ctx) => {
    const { scene, sx, sy, cell } = ctx;
    if (isTillable(cell.type)) return false;
    const t = cell.type;
    const flavor = t === 3  ? 'water'
                 : (t === 9 || t === 11 || t === 12) ? 'building'
                 : t === 13 ? 'highway'
                 : t === 14 ? 'avenue'
                 : t === 7  ? 'road'
                 : t === 8  ? 'path'
                 : '·';
    scene.flash(flavor, sx, sy);
    return true;
  }},

  // 2c) Tilled empty cell: with seed → plant; otherwise → un-till.
  { name: 'plant', try: (ctx) => {
    const { scene, save, sx, sy, cellKey, cwmx, cwmy } = ctx;
    if (!scene.tilledSet.has(cellKey)) return false;
    const sel = getSelectedSlot(save);
    const item = sel ? ITEM_BY_ID[sel.id] : null;
    if (!item || item.kind !== 'seed') {
      scene.tilledSet.delete(cellKey);
      save.tilled = [...scene.tilledSet];
      ctx.dirty = true;
      scene.flash('un-tilled', sx, sy);
      return true;
    }
    if ((sel.count ?? 0) <= 0) {
      scene.flash('out of seeds', sx, sy);
      return true;
    }
    if (!scene.spendEnergy(ENERGY_COST?.plant ?? 0, sx, sy)) return true;
    save.planted.push({ x: cwmx, y: cwmy, crop: item.grows, stage: 0, watered_t: 0 });
    consumeSelected(save);
    ctx.dirty = true;
    scene.buildInventoryDOM();
    scene.flash(`planted ${item.grows}`, sx, sy);
    return true;
  }},

  // 2d) Untilled tillable cell → till it (refuses if occupied by any interactable).
  { name: 'till', try: (ctx) => {
    const { scene, save, sx, sy, cellKey, cwmx, cwmy } = ctx;
    const cellHalfM = scene.cellM / 2;
    const pickedAll = new Set(save.picked || []);
    let blocker = null;
    if (scene.placedRockSet.has(cellKey)) blocker = 'rock';
    if (!blocker) {
      const pp = save.planted.find(p => Math.abs(p.x - cwmx) < cellHalfM && Math.abs(p.y - cwmy) < cellHalfM);
      if (pp) blocker = pp.crop || 'crop';
    }
    if (!blocker) {
      const openedSet = new Set(save.opened || []);
      for (const e of WorldGen.tileCache.values()) {
        const wp = (e.wildplants || []).find(wp => !pickedAll.has(wp.id) && Math.abs(wp.x - cwmx) < cellHalfM && Math.abs(wp.y - cwmy) < cellHalfM);
        if (wp) { blocker = wp.crop || 'plant'; break; }
        const choppedSet = new Set(save.chopped || []);
        const oo = (e.objects || []).find(o =>
          o.kind !== 'flora' &&
          !(o.kind === 'chest' && openedSet.has(o.id)) &&
          !(o.kind === 'tree' && (o.chopped || choppedSet.has(o.id))) &&
          Math.abs(o.x - cwmx) < cellHalfM && Math.abs(o.y - cwmy) < cellHalfM);
        if (oo) {
          blocker = oo.kind === 'house' ? 'house' :
                    oo.kind === 'tree'  ? 'tree'  :
                    oo.kind === 'chest' ? (oo.name ? rusticifyName(oo.name) : 'chest') :
                    oo.kind;
          break;
        }
      }
    }
    if (blocker) { scene.flash(`occupied: ${blocker}`, sx, sy); return true; }
    // Hoe relic discounts (and sometimes zeroes out) the till cost.
    const tillCost = (typeof effectiveTillCost === 'function')
      ? effectiveTillCost(save.relics) : (ENERGY_COST?.till ?? 0);
    if (!scene.spendEnergy(tillCost, sx, sy)) return true;
    scene.tilledSet.add(cellKey);
    save.tilled = [...scene.tilledSet];
    ctx.dirty = true;
    scene.flash('tilled', sx, sy);
    return true;
  }},
];

function interactTap(scene, sx, sy) {
  if (sx < scene.viewLeft || sx > scene.viewLeft + scene.viewSize ||
      sy < scene.viewTop  || sy > scene.viewTop  + scene.viewSize) return;
  const wm = scene.screenToWorldMeters(sx, sy);
  const pWorldX = scene.startWorldM.x + scene.playerM.x;
  // Reach is measured from the character's visible feet, not the sprite center,
  // so the reachable area is symmetric around what the user perceives as "the player".
  const pWorldY = scene.startWorldM.y + scene.playerM.y + scene.feetOffsetM;
  // Player's CELL centre — the basis the visual reach outline in render.js
  // uses, and what every REACH_FAR_M / REACH_CELL_M "too far" gate measures
  // distance from. Uses the FEET position (pWorldY already includes
  // feetOffsetM) so the reach box snaps to a new row exactly when the
  // sprite's feet cross a cell gridline — matches what the player sees on
  // screen. Earlier this used the BODY position, which made the box jump
  // when the feet were still mid-tile (the user reported it as "rangebox
  // moves up when I cross the centre of a tile, not a gridline"). The
  // visual outline in render.js is also feet-based so the two stay synced.
  const pCell = worldMetersToAbsCell(scene, pWorldX, pWorldY);
  const pCellCentre = absCellCenterMeters(scene, pCell.cellIX, pCell.cellIY);
  const ctx = { scene, save: scene.save, wm, pWorldX, pWorldY,
                pCellCx: pCellCentre.x, pCellCy: pCellCentre.y, sx, sy, dirty: false };
  for (const h of TAP_HANDLERS) {
    const consumed = h.try(ctx);
    if (consumed === true || consumed === 'far') break;
  }
  if (ctx.dirty) persistSave(scene.save);
}
