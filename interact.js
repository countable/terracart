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
  { name: 'work-progress', try: (ctx) => {
    if (!ctx.scene._workProgress) return false;
    ctx.scene.cancelWorkProgress();
    return true;
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
    // Don't let a stray tap consume food at full energy for zero gain.
    const curE = save.energy ?? 0;
    const maxE = save.maxEnergy ?? (typeof STARTING_ENERGY !== 'undefined' ? STARTING_ENERGY : 100);
    if (curE >= maxE) { scene.flash('not hungry', sx, sy); return true; }
    const item = ITEM_BY_ID[sel.id];
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
    const { scene, save, wm, pWorldX, pWorldY, sx, sy } = ctx;
    const found = new Set(save.foundTreasures || []);
    const tryClaim = (tr) => {
      if (!tr || found.has(tr.id)) return false;
      if (distM2(tr.x, tr.y, wm.x, wm.y) >= REACH_TREASURE_M * REACH_TREASURE_M) return false;
      if (distM2(tr.x, tr.y, pWorldX, pWorldY) > REACH_FAR_M * REACH_FAR_M) { scene.flash('too far', sx, sy); return 'far'; }
      save.foundTreasures = [...found, tr.id];
      const t = pickTreasure();
      if (t.kind === 'money') {
        addMoney(save, t.amount);
        scene.flashLoot(`✕ → $${t.amount}`, '#ffd96b');
        if (scene.updateMoneyDOM) scene.updateMoneyDOM();
      } else {
        scene.addToInv(t.id, t.n);
        const ti = tierInfo(t.id);
        // flashLoot already adds an inline sprite (via itemId) — skip the 🌱 emoji.
        scene.flashLoot(`✕ → ${t.id.replace(/_seed$/, '')} (${ti.label})`, ti.color, 1, t.id);
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

  // 1) Catch a creature within 4m of tap.
  { name: 'creature', try: (ctx) => {
    const { scene, save, wm, sx, sy } = ctx;
    return WorldGen.forEachItem('creatures', (c) => {
      if (save.caught.includes(c.id)) return;
      if (distM2(c.x, c.y, wm.x, wm.y) < REACH_CREATURE_M * REACH_CREATURE_M) {
        // Spend catch-energy BEFORE the catch so a tired player can't grab a
        // chicken for free. spendEnergy returns true on success / false-with-flash.
        if (!scene.spendEnergy(ENERGY_COST?.catch ?? 0, sx, sy)) return true;
        // catchCreature mutates + persists itself; consume the tap without
        // setting ctx.dirty (would double-flush via the dispatcher's final persistSave).
        scene.catchCreature(c, sx, sy);
        return true;
      }
    }) || false;
  }},

  // 1a) Pick the wild plant CLOSEST to the tap within REACH_WILDPLANT_M.
  { name: 'wildplant', try: (ctx) => {
    const { scene, save, wm, pWorldX, pWorldY, sx, sy } = ctx;
    const pickedSet = new Set(save.picked || []);
    let bestWp = null, bestD2 = REACH_WILDPLANT_M * REACH_WILDPLANT_M;
    WorldGen.forEachItem('wildplants', (wp) => {
      if (pickedSet.has(wp.id)) return;
      const d2 = distM2(wp.x, wp.y, wm.x, wm.y);
      if (d2 < bestD2) { bestD2 = d2; bestWp = wp; }
    });
    if (bestWp) {
      const wp = bestWp;
      if (distM2(wp.x, wp.y, pWorldX, pWorldY) > REACH_FAR_M * REACH_FAR_M) { scene.flash('too far', sx, sy); return 'far'; }
      // Some wild crops require physical work to harvest, mirroring their
      // hard-object cousins:
      //   rockfruit (stone debris) → pick relic speeds up rock-breaking work
      //   shrub     (woody bush)   → axe  relic speeds up chop work
      // Both: 3s with the matching relic, 10s bare-handed. Other wildplants
      // (rainberry, pairy, nut, longgrass …) stay instant.
      const award = () => {
        save.picked = [...new Set(save.picked || []), wp.id];
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
      if (distM2(o.x, o.y, pWorldX, pWorldY) > REACH_FAR_M * REACH_FAR_M) { scene.flash('too far', sx, sy); return 'far'; }
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
    const { scene, save, wm, pWorldX, pWorldY, sx, sy } = ctx;
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
      if (distM2(o.x, o.y, pWorldX, pWorldY) > REACH_FAR_M * REACH_FAR_M) {
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
        if (o.chopped) { scene.flash('stump', sx, sy); return true; }
        if (!save.relics?.axe) { scene.flash('need an axe', sx, sy); return true; }
        const durMs = (typeof toolDurationMs === 'function')
          ? toolDurationMs(save.relics, 'axe') : 3000;
        scene.startWorkProgress(o.x, o.y, () => {
          o.chopped = true;
          scene.addToInv('tree', 1 + Math.floor(Math.random() * 2));
          scene.flash('🌲 chopped', sx, sy);
        }, durMs);
        return true;
      }
      if (o.kind === 'house' || o.kind === 'tower') {
        scene.shopInteract(sx, sy, o);
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
    const playerCell = worldMetersToAbsCell(scene, pWorldX, pWorldY);
    const playerCellCentre = absCellCenterMeters(scene, playerCell.cellIX, playerCell.cellIY);
    if (Math.hypot(cwmx - playerCellCentre.x, cwmy - playerCellCentre.y) > scene.REACH_CELL_M) {
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
      if (r < 0.005)        { scene.addToInv('gemfruit', 1);        msg = '💥 → ✨ gemfruit'; }
      else if (r < 0.015)   { addMoney(save, 25); scene.updateMoneyDOM?.(); msg = '💥 → $25'; }
      else if (r < 0.035)   { scene.addToInv('gemfruit_seed', 1);   msg = '💥 → gemfruit seed'; }
      else if (r < 0.105)   { addMoney(save,  5); scene.updateMoneyDOM?.(); msg = '💥 → $5'; }
      else if (r < 0.555)   { scene.addToInv('rockfruit_seed', 1);  msg = '💥 → rockfruit seed'; }
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
      const yieldN = 1 + Math.floor(Math.random() * 3);
      scene.addToInv(p.crop, yieldN);
      const gotSeed = Math.random() < 0.25;
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
      ctx.dirty = true;
      scene.flash('💧 watered', sx, sy);
      return true;
    }
    const minsLeft = Math.max(1, Math.ceil((stageHoldMs - sinceWater) / 60000));
    scene.flash(`growing… ${minsLeft}m`, sx, sy);
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
        const oo = (e.objects || []).find(o =>
          o.kind !== 'flora' &&
          !(o.kind === 'chest' && openedSet.has(o.id)) &&
          !(o.kind === 'tree' && o.chopped) &&
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
    if (!scene.spendEnergy(ENERGY_COST?.till ?? 0, sx, sy)) return true;
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
  const ctx = { scene, save: scene.save, wm, pWorldX, pWorldY, sx, sy, dirty: false };
  for (const h of TAP_HANDLERS) {
    const consumed = h.try(ctx);
    if (consumed === true || consumed === 'far') break;
  }
  if (ctx.dirty) persistSave(scene.save);
}
