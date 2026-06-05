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
//                  absCellCenterMeters, buildInventoryDOM);
//                  module-level helpers (distM2, isTillable);
//                  reach constants (REACH_*).
//   worldgen.js  — WorldGen.tileCache, WorldGen.Z
//   items.js     — ITEM_BY_ID, SEED_TIER, MAX_GROWTH_STAGE
//   loot.js      — POI_CATEGORY, chestTier, rusticifyName, WILD_TREASURE
//   rarity.js    — pickReward, rollGearUpgrade
//   save.js      — persistSave
//
// Exports as globals:
//   TAP_HANDLERS   — priority-ordered array of { name, try(ctx) }
//   interactTap(scene, sx, sy)  — top-level dispatcher; MapScene.handleWorldTap forwards to this

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

// Unique id for an animal/slime released (or tamed) at a spot. `extra`
// disambiguates a batch released in the same tick (the per-item index).
function releasedId(kind, extra) {
  const tail = extra === undefined ? '' : `_${extra}`;
  return `released_${kind}_${Date.now()}_${Math.floor(Math.random() * 1e6)}${tail}`;
}

// True when planted entry `p` sits in the cell at (cwmx, cwmy). eps is 0.1 for
// an exact snapped-center match, or cellHalfM to accept anything overlapping.
const inPlantedCell = (p, cwmx, cwmy, eps) =>
  Math.abs(p.x - cwmx) < eps && Math.abs(p.y - cwmy) < eps;

// Gate a feeding action behind a "Feed <food> to the <fauna>?" confirmation.
// `doFeed` performs the actual feed AND must persist its own state: it runs
// asynchronously from the modal callback, after interactTap has already
// returned (so the ctx.dirty → persistSave path no longer applies). When the
// scene can't show the modal (headless/test scene) or we're in TEST_MODE, the
// feed runs immediately so the deterministic test suite stays synchronous.
function confirmFeed(scene, foodId, faunaKind, doFeed) {
  const canModal = typeof scene.showFeedConfirm === 'function'
    && !(typeof window !== 'undefined' && window.__TEST_MODE);
  if (!canModal) { doFeed(); return; }
  scene.showFeedConfirm({ foodId, faunaKind, onConfirm: doFeed });
}

// Nearest item in a WorldGen layer to (px, py) within reach that passes
// `accept`, or null. Centralizes the bestD2 scan every "tap the closest X"
// handler repeats. `accept` may be omitted to consider all items.
// `reach` is either a fixed radius (m) or a function(item) → radius, so a
// layer with differently-sized items (e.g. a cow vs a chicken) can gate each
// item by its own footprint instead of one flat disk.
function findClosestItem(layer, px, py, reach, accept, offset) {
  let best = null, bestD2 = Infinity;
  WorldGen.forEachItem(layer, (item) => {
    if (accept && !accept(item)) return;
    const r = typeof reach === 'function' ? reach(item) : reach;
    // Optional per-item position offset (metres) — lets a caller test the tap
    // against where an item is DRAWN rather than its logical cell (e.g. a flyer
    // rendered floated north of its ground point). Default: no offset.
    let ix = item.x, iy = item.y;
    if (offset) { const o = offset(item); if (o) { ix += o.dx || 0; iy += o.dy || 0; } }
    const d2 = distM2(ix, iy, px, py);
    if (d2 <= r * r && d2 < bestD2) { bestD2 = d2; best = item; }
  });
  return best;
}

// Shared "too far to reach" guard. Flashes and returns true when (x, y) is
// beyond the player's reach, so callers do `if (tooFar(ctx, x, y)) return 'far';`.
//
// Judges reach by the CELL that (x, y) falls in, via the shared cellInReach
// (coords.js) — the exact same integer cell-index math the lit reach silhouette
// (render.js drawCells) and the cell-resolve tap gate use. This keeps the lit
// area byte-identical to the tappable area for objects/creatures/treasure too.
//
// Earlier this measured a raw Euclidean distance from (x, y) to the player CELL
// CENTRE. For objects whose world point sits off its cell centre — e.g. a house
// FOOT, up to ~0.7·cellM from the centre of its cell — a cell that was lit (and
// passed the cell gate) could still trip this Euclidean gate at the reach edge,
// flashing "Just out of reach" only some of the time depending on where the
// foot sat and cardinal-vs-diagonal geometry. Going cell-based removes that drift.
function tooFar(ctx, x, y) {
  const { scene } = ctx;
  if (typeof cellInReach === 'function' && typeof worldMetersToAbsCell === 'function') {
    // Reach gate = "is it in a lit cell?" — byte-identical to the on-screen
    // highlight (render.js drawCells / cellInReach). An entity counts as in
    // reach if EITHER its own foot cell is lit OR the cell the player actually
    // TAPPED is lit. The tapped-cell clause is what keeps the highlight honest
    // for tall sprites: a tree/house at the south edge of the reach draws its
    // canopy in a lit cell while its FOOT sits one cell further south (unlit),
    // so a foot-cell-only test flashed "out of reach" on a tap that clearly
    // landed inside the highlighted square. Honour whichever cell the player
    // pointed at — if it's lit, the tap is in reach.
    const foot = worldMetersToAbsCell(scene, x, y);
    if (cellInReach(scene, foot.cellIX, foot.cellIY)) return false;
    if (ctx.wm) {
      const tap = worldMetersToAbsCell(scene, ctx.wm.x, ctx.wm.y);
      if (cellInReach(scene, tap.cellIX, tap.cellIY)) return false;
    }
    scene.flash('Just out of reach.', ctx.sx, ctx.sy);
    return true;
  }
  // Fallback (helpers somehow unavailable): legacy Euclidean foot→cell-centre gate.
  const reachM = (typeof reachRadiusM === 'function')
    ? reachRadiusM(scene) : REACH_FAR_M;
  if (distM2(x, y, ctx.pCellCx, ctx.pCellCy) > reachM * reachM) {
    scene.flash('Just out of reach.', ctx.sx, ctx.sy);
    return true;
  }
  return false;
}

// Named terrain-type codes. Mirrors WorldGen.T (the uint8 cell.type enum from
// worldgen.js) so the inline `cell.type === N` comparisons in the handlers
// below read by name instead of by magic integer. Values are identical to the
// shared enum; we snapshot the members interact.js actually compares against.
// (WorldGen is a runtime global — same source these handlers already read
// WorldGen.tileCache / .Z / .forEachItem from.)
const TERRAIN = {
  WATER: WorldGen.T.WATER,                   // 3
  ROAD: WorldGen.T.ROAD,                     // 7
  PATH: WorldGen.T.PATH,                     // 8
  BUILDING: WorldGen.T.BUILDING,             // 9
  ROCK: WorldGen.T.ROCK,                     // 10
  BUILDING_MED: WorldGen.T.BUILDING_MED,     // 11
  BUILDING_LARGE: WorldGen.T.BUILDING_LARGE, // 12
  ROAD_LG: WorldGen.T.ROAD_LG,               // 13
  ROAD_MD: WorldGen.T.ROAD_MD,               // 14
};

// GRASSLAND-biome cell types (spec §WORLD GENERATION grouping). These till in
// HALF the time (spec §cells: "grassland biome cells till in half the time").
const GRASSLAND_TILL = new Set([
  WorldGen.T.GRASS, WorldGen.T.PARK, WorldGen.T.SCHOOL, WorldGen.T.PLAYGROUND,
  WorldGen.T.PITCH, WorldGen.T.GOLF, WorldGen.T.FARMLAND,
]);

// Equip a relic or armor reward from a chest / fishing jackpot. Mutates save
// and calls scene.markRelicsDirty. Caller is responsible for persistence
// (ctx.dirty or persistSave) and any follow-up UI (modal or flash).
function equipGearReward(reward, save, scene) {
  if (reward.kind === 'armor') {
    save.armor = save.armor || {};
    if (typeof maxEnergyFromArmor === 'function' && typeof scene.getMaxEnergy === 'function') {
      const oldMax = scene.getMaxEnergy();           // capture BEFORE mutating armor
      save.armor[reward.slot] = { tier: reward.tier };
      const newMax = maxEnergyFromArmor(save.armor);
      const bump = Math.max(0, newMax - oldMax);
      save.maxEnergy = newMax;
      save.energy = Math.min(newMax, (save.energy ?? 0) + bump);
    } else {
      save.armor[reward.slot] = { tier: reward.tier };
    }
  } else {
    save.relics = save.relics || {};
    save.relics[reward.slot] = { tier: reward.tier };
  }
  scene.markRelicsDirty?.();
}

// Shared work-queue launcher for tool-driven interactions (chop, mine, pick).
// Looks up the correct duration from toolDurationMs (falling back to 9s
// bare-hands / 3s T1 if the helper isn't available), optionally pre-spends
// energy (returning true without starting if the player can't afford it),
// then starts the progress wheel. Always returns true (consumed the tap).
//   relicSlot  — the relic key passed to toolDurationMs ('axe', 'pick', etc.)
//   energyCost — energy to spend up-front (0 / falsy = free)
//   onComplete — callback fired when the wheel finishes
function startToolWork(ctx, x, y, relicSlot, energyCost, onComplete) {
  const { scene, save, sx, sy } = ctx;
  const durMs = (typeof toolDurationMs === 'function')
    ? toolDurationMs(save.relics, relicSlot)
    : (save.relics?.[relicSlot] ? 3000 : 9000);
  if (energyCost && !scene.spendEnergy(energyCost, sx, sy)) return true;
  scene.startWorkProgress(x, y, onComplete, durMs, energyCost || 0, relicSlot);
  return true;
}

// Shared "drop a held item onto an empty tillable cell" path for the
// place-scarecrow / place-rock handlers — they were ~95% identical (same
// tilled/occupied guards, same 0.1m overlap epsilon against save.planted,
// same consume → persist → flash). Differences are passed in:
//   itemId     — the selected inventory id that arms this placement
//   energyKey  — optional ENERGY_COST key spent on success (rock costs energy,
//                scarecrow is free); spend failure consumes the tap (returns
//                true) without placing, exactly like the inline version did
//   extraGuard — optional predicate (ctx) ⇒ bool; an additional "already
//                occupied" check beyond the planted-overlap one (scarecrow
//                also rejects an existing scarecrow on the cell)
//   place      — performs the actual placement + persistence side effects
//   flashMsg   — the success flash text
// Returns the handler result (false = not this handler, true = consumed).
function placeOnEmptyCell(ctx, { itemId, energyKey, extraGuard, place, flashMsg }) {
  const { scene, save, sx, sy, cell, cellKey, cwmx, cwmy } = ctx;
  const sel = getSelectedSlot(save);
  const selItem = sel ? ITEM_BY_ID[sel.id] : null;
  if (!(selItem && selItem.id === itemId && (sel.count ?? 0) > 0 &&
        isTillable(cell.type) && !scene.tilledSet.has(cellKey) &&
        (!extraGuard || extraGuard(ctx)) &&
        !save.planted.some(p => inPlantedCell(p, cwmx, cwmy, 0.1)))) {
    return false;
  }
  if (energyKey && !scene.spendEnergy(ENERGY_COST?.[energyKey] ?? 0, sx, sy)) return true;
  place(ctx);
  consumeSelected(save);
  ctx.dirty = true;
  scene.buildInventoryDOM();
  scene.flash(flashMsg, sx, sy);
  return true;
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
    ctx.scene.abortWorkProgress();   // refund any up-front energy — bailing costs nothing
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
    if (sel.id === 'reach_potion') {
      scene.showOfferModal({
        title: 'Drink the Potion of Reach?',
        get: '✨ full-screen reach for 1 min',
        cost: `1× ✨ Potion of Reach`,
        canAfford: true,
        acceptLabel: 'Drink',
        onAccept: () => scene.drinkReachPotion(),
      });
      return true;
    }
    return false;
  }},

  // (Eat-by-tapping-the-player removed — the persistent Eat button below the
  // inventory bar covers this affordance now, and the tap-on-feet variant
  // was easy to trigger accidentally while trying to till / plant under the
  // player's own cell.)

  // 0) Treasure mark — tap within ~1.5 cells of the X opens it.
  { name: 'treasure', try: (ctx) => {
    const { scene, save, wm, sx, sy } = ctx;
    const found = new Set(save.foundTreasures || []);
    const tryClaim = (tr) => {
      if (!tr || found.has(tr.id)) return false;
      if (distM2(tr.x, tr.y, wm.x, wm.y) >= REACH_TREASURE_M * REACH_TREASURE_M) return false;
      if (tooFar(ctx, tr.x, tr.y)) return 'far';
      save.foundTreasures = [...found, tr.id];
      const reward = (typeof pickReward === 'function')
        ? pickReward('treasure:default', save) : null;
      if (!reward) {
        // Shouldn't happen — context exists — but bail safely if rarity.js
        // is missing or the pool is empty.
        addMoney(save, 1);
        scene.flashLoot('✕ → $1', '#ffd96b');
      } else if (reward.kind === 'item') {
        // Low-tier seeds dig up in a slightly larger bundle (planted in bulk).
        if (typeof isLowTierSeed === 'function' && isLowTierSeed(reward.id)) {
          reward.qty += LOW_TIER_SEED_QTY_BONUS;
        }
        scene.addToInv(reward.id, reward.qty);
        const item = ITEM_BY_ID[reward.id];
        const ti = (typeof tierInfo === 'function') ? tierInfo(reward.id) : null;
        const color = ti?.color || '#ffe066';
        const label = `✕ → ${item?.name || reward.id}${reward.qty > 1 ? ` ×${reward.qty}` : ''}`;
        scene.flashLoot(label, color, 1, reward.id);
        if (reward.jackpot >= 1 && typeof scene.flashJackpot === 'function') {
          scene.flashJackpot(reward.jackpot);
        }
      } else if (reward.kind === 'gold') {
        addMoney(save, reward.amount);
        scene.flashLoot(`✕ → $${reward.amount}`, '#ffd96b');
      }
      // Consolation coins for any qty bumps the picker couldn't apply
      // (bracket at cap or single-stack class). Small gold trickle alongside
      // the main loot — never replaces it.
      if (reward && reward.consolation > 0) {
        addMoney(save, reward.consolation);
        scene.flash(`+$${reward.consolation}`, sx, sy + 16);
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
      if (entry.extraTreasures) for (const tr of entry.extraTreasures) {
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
  //                                    chicken→any seed, cow→pairy,
  //                                    cat→milk or any fish, dog→meat.
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
  // PRIORITY: creature checks happen BEFORE wildplant / object / cell so a
  // tap near any nearby animal always reads as "I'm trying to interact with
  // the animal." A tap on a tree two metres from a chicken will trigger the
  // chicken handler (favourite-food hint / catch / yuck), not the chop —
  // step away from the animal to chop the tree. This is intentional: in
  // practice missing a chicken tap is more frustrating than missing a tree.
  { name: 'creature', try: (ctx) => {
    const { scene, save, wm, sx, sy } = ctx;
    // Per-kind tap radius (m), scaled to each animal's on-ground footprint
    // rather than a flat 4 m disk that made even a chicken tappable a whole
    // cell away. Bigger animals (cow/deer) keep a larger grab; small ones
    // (chicken/rabbit/butterfly) tighten up. Mirrors the render scales in
    // render.js (cow 1.5 > deer/crow 1.3 > chicken 1.2 > rabbit footprint).
    const CREATURE_TAP_R = {
      cow: 2.4, deer: 2.0, dog: 1.8, cat: 1.7, crow: 1.7, slime: 1.7,
      chicken: 1.5, rabbit: 1.4, butterfly: 1.4,
    };
    const creatureTapR = (c) => CREATURE_TAP_R[c.kind] ?? 2.0;
    // Flyers/hoverers are RENDERED floated north of their ground cell (crow
    // sy-14, butterfly sy-8 in render.js — 14px == scene.feetOffsetM). A tap on
    // the visible bird therefore lands ~2 m north of its logical (x,y); with a
    // 1.7 m crow disk centred on the ground point the sprite was unreachable and
    // the tap fell through to the cell underneath. Offset the tap-test by the
    // same float so a flyer is tested where it's drawn (north = −y).
    const CREATURE_FLOAT_PX = { crow: 14, butterfly: 8 };
    const creatureTapOffset = (c) => {
      const px = CREATURE_FLOAT_PX[c.kind] || 0;
      return px ? { dx: 0, dy: -(px / 14) * scene.feetOffsetM } : null;
    };
    const target = findClosestItem('creatures', wm.x, wm.y, creatureTapR,
      (c) => !save.caught.includes(c.id), creatureTapOffset);
    if (!target) return false;
    // Player-reach gate (same 16m feet-cell limit as treasure/wildplant/object
    // and the lit reach indicator). The per-kind CREATURE_TAP_R above is tap-
    // forgiveness measured from the TAP point, not the player — without this a
    // visible-but-out-of-reach animal could be caught/fed by tapping it. Keeps
    // the reach outline ⇔ tap-accept invariant (QC §7).
    if (tooFar(ctx, target.x, target.y)) return 'far';

    // MANGO — the universal tame treat. Feeding a mango to ANY wild creature
    // (livestock, cats/dogs, even pests like slimes / crows / deer) befriends
    // it in place instead of catching or fighting. Checked before the slime /
    // DEFEAT / favourite-food paths so mango always wins. Already-tame pets
    // (id starts with 'released_') skip this and fall through to petting.
    const _isReleased = typeof target.id === 'string' && target.id.startsWith('released_');
    const _mangoSel = getSelectedSlot(save);
    if (!_isReleased && _mangoSel?.id === 'mango' && (_mangoSel.count ?? 0) > 0) {
      const doMangoTame = () => {
        consumeSelected(save);
        scene.buildInventoryDOM();
        if (!save.caught.includes(target.id)) save.caught.push(target.id);
        const tx2 = Math.floor(target.x / scene.tileEdgeM);
        const ty2 = Math.floor(target.y / scene.tileEdgeM);
        const tameId = releasedId(target.kind);
        save.released = save.released || [];
        save.released.push({ x: target.x, y: target.y, kind: target.kind, id: tameId, tx: tx2, ty: ty2, shiny: !!target.shiny });
        target.id = tameId;   // convert the in-world creature in place → now tame
        scene.flashLoot(`🥭 tamed ${ITEM_BY_ID[target.kind]?.name || target.kind}`, '#a7ffb0', 1.2, 'mango');
        persistSave(save);
      };
      confirmFeed(scene, 'mango', target.kind, doMangoTame);
      return true;
    }

    // PESTS / HUNTABLES — slimes, crows and deer are DEFEATED via a work
    // queue rather than caught alive. A weapon (sword / bow / staff) speeds
    // the kill up by tier; bare-handed still works but is a long slog. On
    // completion the creature is removed from the world (marked caught) and
    // drops its product if it has one (crow → feather, deer → meat; slimes
    // drop nothing — they're just an energy pest). The defeat is FREE (no
    // energy spent): your TIME at the work wheel IS the cost, which also means
    // you can still kill the very slime that's draining you when low on energy.

    // Secret: slime can be tamed with a sapphire (hinted only via book tips).
    // Checked before DEFEAT_KINDS so the sapphire path wins over the work queue.
    if (target.kind === 'slime') {
      const selNow = getSelectedSlot(save);
      if (selNow?.id === 'sapphire' && (selNow.count ?? 0) > 0) {
        consumeSelected(save);
        scene.buildInventoryDOM();
        if (!save.caught.includes(target.id)) save.caught.push(target.id);
        const tx2 = Math.floor(target.x / scene.tileEdgeM);
        const ty2 = Math.floor(target.y / scene.tileEdgeM);
        const tameId = releasedId('slime');
        save.released = save.released || [];
        save.released.push({ x: target.x, y: target.y, kind: 'slime', id: tameId, tx: tx2, ty: ty2 });
        target.id = tameId;
        ctx.dirty = true;
        scene.flashLoot('💎 slime tamed!', '#aa88ff', 1.2, 'sapphire');
        return true;
      }
    }

    const DEFEAT_KINDS = new Set(['slime', 'crow', 'deer']);
    if (DEFEAT_KINDS.has(target.kind)) {
      const r = save.relics || {};
      const weaponTier = Math.max(r.sword?.tier || 0, r.bow?.tier || 0, r.staff?.tier || 0);
      const bestWeapon = ['sword', 'bow', 'staff'].reduce((b, w) => (r[w]?.tier || 0) > (r[b]?.tier || 0) ? w : b, 'sword');
      const weaponSlot = weaponTier > 0 ? bestWeapon : null;
      // Weapon uses the shared spec tool ladder via toolDurationMs (wood 3s …
      // frost .3s). No weapon = tier 0 (bare hands): 9s — slow but always possible.
      const durMs = (typeof toolDurationMs === 'function')
        ? toolDurationMs(r, weaponSlot)
        : (weaponTier > 0 ? Math.max(300, 3000 - (weaponTier - 1) * 450) : 9000);
      const victim = target;
      const dropId = victim.kind === 'crow' ? 'crow_feather'
                   : victim.kind === 'deer' ? 'meat'
                   : null;
      scene.startWorkProgress(victim.x, victim.y, () => {
        save.caught.push(victim.id);
        if (dropId) {
          scene.addToInv(dropId, 1);
          const item = ITEM_BY_ID[dropId];
          scene.flashLoot(`+1 ${item?.name || dropId}`, '#ffe066', 1, dropId);
        } else {
          scene.flash('🟢 slime defeated', scene.viewCenterX, scene.viewCenterY - 60);
        }
        persistSave(save);
        // Rare shiny deer / crow — hunted fauna drop their product (meat /
        // feather), so there's no live shiny animal to keep, but the shiny
        // find still pays the 10× money + discovery bonus with fanfare.
        if (victim.shiny && dropId) {
          scene.awardShinyBonus(victim.kind, scene.viewCenterX, scene.viewCenterY - 60);
        }
      }, durMs, 0, weaponSlot);
      return true;
    }
    // Catchable animals (chicken/cow/cat/dog/rabbit/butterfly) all flow through
    // the unified tame-or-catch logic below: favourite food TAMES (befriends in
    // place); an empty hand starts the CATCH work queue. Slimes/crows/deer were
    // defeated above and never reach here.
    const sel = getSelectedSlot(save);
    // ANIMAL_FOOD is keyed by creature kind. The catalog now stores either a
    // single string ('rainberry') or an array of accepted ids (e.g. cats take
    // milk OR any fish). Normalise to a Set so the membership check below
    // doesn't need to branch on type.
    const wantRaw = (typeof ANIMAL_FOOD !== 'undefined') ? ANIMAL_FOOD[target.kind] : null;
    const wantPrimary = wantRaw ? (Array.isArray(wantRaw) ? wantRaw[0] : wantRaw) : null;
    const selItem = sel ? ITEM_BY_ID[sel.id] : null;
    const isEdible = sel && (typeof FOOD_ENERGY !== 'undefined') && (sel.id in FOOD_ENERGY);
    // "Plant produce" = anything tagged kind:'produce' that came from a plant
    // — farmed crops carry an `item.crop` ref; longgrass too.
    // Excludes egg / milk (also kind:'produce' but they're animal-source).
    const isPlantProduce = selItem && selItem.kind === 'produce' && !!selItem.crop;

    // ── TAME PETS — released animals (id starts with 'released_'). Tame
    // pets never get "yuck'd"; tapping them with any item (or none) plays
    // a brief species-specific happy interaction (cluck / purr / etc.),
    // arms a petting-boost timer that gives the next produce roll a +50%
    // double chance, and — for cats — kicks off a 5-minute follow timer
    // the wander loop honours.
    const isTame = typeof target.id === 'string' && target.id.startsWith('released_');
    // A tame PRODUCER (cow / chicken) fed PLANT PRODUCE must fall through to the
    // produce path below — that's where milk / eggs are granted and where the
    // petting boost armed here is consumed. Without this exception the isTame
    // block swallows every tap, so a tame cow/chicken only ever gets petted and
    // never produces (the reported "cow gives no milk when fed" bug). Petting
    // with an empty hand or a non-produce treat still runs the pet branch.
    const tameProducerFeed = isTame && isPlantProduce && (sel?.count ?? 0) > 0
      && (target.kind === 'cow' || target.kind === 'chicken');
    if (isTame && !tameProducerFeed) {
      const SOUND = { chicken: 'cluck', cow: 'moo', cat: 'purr', dog: 'woof',
                      butterfly: 'flutter', crow: 'caw', rabbit: 'twitch', deer: 'snort' };
      const sound = SOUND[target.kind] || 'happy';
      // Petting accepts the favourite OR plant produce as a treat. Treats
      // get consumed; an empty-handed pet is free. animalLikesFood handles
      // species-specific quirks (e.g. tame chicken accepts any seed).
      const likesTame = (typeof animalLikesFood === 'function')
        && sel && animalLikesFood(target.kind, sel.id);
      const isTreat = sel && (sel.count ?? 0) > 0
        && (likesTame || isPlantProduce);
      // Pet the animal: arm the +50% double-yield boost and (for treats) eat
      // the held item. Both the in-memory timer and a persisted EPOCH-ms mirror
      // are set — creatures are re-spawned from tile data on every reload and
      // lose their in-memory _pettedUntilT (a performance.now value that also
      // resets to ~0 on reload), so the produce path below reads the persisted
      // copy; otherwise the boost would silently never survive a tile change.
      const doPet = () => {
        target._pettedUntilT = performance.now() + 10 * 60 * 1000;
        save.petBoost = save.petBoost || {};
        save.petBoost[target.id] = Date.now() + 10 * 60 * 1000;
        if (target.kind === 'cat') {
          target._followUntilT = performance.now() + 5 * 60 * 1000;
        }
        if (isTreat) {
          consumeSelected(save);
          scene.buildInventoryDOM();
        }
        scene.flashLoot(`💗 ${sound}`, '#ff8aff', 0.85);
        persistSave(save);
      };
      // A treat is FED → confirm what's going to the pet first. An empty-handed
      // (or non-treat) pet consumes nothing, so it stays instant.
      if (isTreat) {
        confirmFeed(scene, sel.id, target.kind, doPet);
      } else {
        doPet();
      }
      return true;
    }

    // 1. Favourite food → TAME (befriend in place), NOT catch. Converts the
    // wild animal into a tame 'released_' pet at its spot: it stays in the
    // world, becomes pettable / produces / follows, but does NOT enter your
    // inventory. Capturing-into-inventory is the separate CATCH work queue
    // below. animalLikesFood handles the chicken-eats-any-seed special case.
    // Guarded on !isTame so an already-tame cow fed its favourite (pairy, which
    // is also plant produce) doesn't re-tame — it falls through to milk instead.
    const likes = (typeof animalLikesFood === 'function') && sel
      && animalLikesFood(target.kind, sel.id);
    if (!isTame && sel && likes && (sel.count ?? 0) > 0) {
      const favId = sel.id;
      const doTame = () => {
        consumeSelected(save);
        scene.buildInventoryDOM();
        // Stop the wild one respawning, then re-add it as a tame pet at the same
        // spot so the bond persists across reloads (mirrors the release handler).
        const oldId = target.id;
        if (!save.caught.includes(oldId)) save.caught.push(oldId);
        const tx = Math.floor(target.x / scene.tileEdgeM);
        const ty = Math.floor(target.y / scene.tileEdgeM);
        const tameId = releasedId(target.kind);
        save.released = save.released || [];
        save.released.push({ x: target.x, y: target.y, kind: target.kind, id: tameId, tx, ty, shiny: !!target.shiny });
        target.id = tameId;   // convert the in-world object in place → now tame
        scene.flashLoot(`🐾 tamed ${ITEM_BY_ID[target.kind]?.name || target.kind}`, '#a7ffb0', 1, target.kind);
        persistSave(save);
      };
      confirmFeed(scene, favId, target.kind, doTame);
      return true;
    }
    // 2. Plant produce → produce (chicken / cow only). Recently-petted
    // tame animals roll a +50% chance for a double yield.
    //
    // Per-creature production cooldown: each chicken / cow only yields once
    // per PRODUCE_COOLDOWN_MS (1 hour). The last-yield timestamp lives on
    // the creature object as `_lastProduceT` (epoch ms, NOT performance.now
    // — must survive save reloads + tile re-rasterise). The save also
    // persists save.lastProduce[id] so the timer survives across reloads:
    // creature objects are re-spawned each tile load and lose any in-memory
    // _lastProduceT, but the save-side mirror is read back below.
    const PRODUCE_COOLDOWN_MS = 60 * 60 * 1000;
    if (sel && isPlantProduce && (sel.count ?? 0) > 0) {
      const yieldId = target.kind === 'chicken' ? 'egg'
                    : target.kind === 'cow'     ? 'milk'
                    : null;
      if (yieldId) {
        const now = Date.now();
        save.lastProduce = save.lastProduce || {};
        const lastT = save.lastProduce[target.id] || target._lastProduceT || 0;
        if (now - lastT < PRODUCE_COOLDOWN_MS) {
          // Still on cooldown — refuse without consuming the produce. Bail
          // before the confirm dialog so we don't ask about a feed that can't
          // happen yet.
          const remainMs = PRODUCE_COOLDOWN_MS - (now - lastT);
          const mins = Math.max(1, Math.ceil(remainMs / 60000));
          const verb = target.kind === 'chicken' ? 'laid' : 'milked';
          scene.flash(`already ${verb} (${mins}m)`, sx, sy);
          return true;
        }
        const feedId = sel.id;
        const doFeed = () => {
          consumeSelected(save);
          // Petting boost: prefer the persisted epoch-ms expiry (survives reload)
          // and fall back to the in-memory timer for boosts armed this session.
          save.petBoost = save.petBoost || {};
          const petted = (save.petBoost[target.id] || 0) > Date.now()
            || (target._pettedUntilT && target._pettedUntilT > performance.now());
          const yieldN = petted && Math.random() < 0.5 ? 2 : 1;
          if (petted) {                            // consume the boost (both copies)
            delete save.petBoost[target.id];
            target._pettedUntilT = 0;
          }
          scene.addToInv(yieldId, yieldN);
          scene.buildInventoryDOM();
          scene.flashLoot(`+${yieldN} ${ITEM_BY_ID[yieldId]?.name || yieldId}`, '#a7ffb0', 1, yieldId);
          // Stamp the cooldown on the creature (in-memory) AND in the save
          // (survives tile reload + game restart). Re-read the clock here since
          // the confirm dialog may have sat open for a while.
          const stamp = Date.now();
          target._lastProduceT = stamp;
          save.lastProduce[target.id] = stamp;
          persistSave(save);
        };
        confirmFeed(scene, feedId, target.kind, doFeed);
        return true;
      }
    }
    // 3. Any other food → yuck. Wasted bite. Confirm first so a stray tap
    // doesn't silently burn a food item the animal won't even accept.
    if (sel && isEdible && (sel.count ?? 0) > 0) {
      const yuckId = sel.id;
      const doYuck = () => {
        consumeSelected(save);
        scene.buildInventoryDOM();
        scene.flashLoot(`🤢 Spits it out.`, '#ff8a7a', 1, yuckId);
        persistSave(save);
      };
      confirmFeed(scene, yuckId, target.kind, doYuck);
      return true;
    }
    // 4. CATCH via work queue. Reached with an empty hand (or any non-food,
    // non-favourite selection) — favourite food TAMED above, edible food was
    // yuck'd above. The animal FLEES the player at 2 m/s while the wheel runs
    // (startCatchProgress); if it stays outside the player's reach for 1 s the
    // catch fails (butterflies: 3× faster flee, 2 s grace). A Bug Net shortens
    // the wheel by tier; bare hands take the tier-0 (9s) time — long enough
    // that a slow target usually slips out of reach and escapes. Butterflies
    // catch bare-handed too — no tool gate.
    const catchMs = (typeof toolDurationMs === 'function')
      ? toolDurationMs(save.relics, 'bugnet')
      : (save.relics?.bugnet ? 3000 : 9000);
    // Catching costs energy (refunded if the player cancels the wheel; not
    // refunded if the animal escapes the player's reach — the attempt was made).
    const catchCost = (typeof effectiveCatchCost === 'function')
      ? effectiveCatchCost(save.relics) : (ENERGY_COST?.catch ?? 0);
    if (catchCost && !scene.spendEnergy(catchCost, sx, sy)) return true;
    const victim = target;
    scene.startCatchProgress(victim, catchMs, () => {
      scene.catchCreature(victim, sx, sy);
    }, () => {
      scene.flash('🏃 it got away', scene.viewCenterX, scene.viewCenterY - 60);
    }, 'bugnet', catchCost);
    return true;
  }},

  // 1a) Pick the wild plant CLOSEST to the tap within REACH_WILDPLANT_M.
  { name: 'wildplant', try: (ctx) => {
    const { scene, save, wm, sx, sy } = ctx;
    const pickedSet = new Set(save.picked || []);
    const bestWp = findClosestItem('wildplants', wm.x, wm.y, REACH_WILDPLANT_M,
      (wp) => !pickedSet.has(wp.id));
    if (bestWp) {
      const wp = bestWp;
      if (tooFar(ctx, wp.x, wp.y)) return 'far';
      // Some wild crops require physical work to harvest, mirroring their
      // hard-object cousins:
      //   rockfruit (stone debris) → pick relic speeds up rock-breaking work
      //   shrub     (woody bush)   → axe  relic speeds up chop work
      // Both: 3s with the matching relic, 10s bare-handed. Other wildplants
      // (rainberry, pairy, nut, longgrass …) stay instant.
      // shrub → wood: chopping a bush yields the wood mineral, not a 'shrub'
      // item (tree + shrub no longer have inventory item counterparts).
      // Any other wildplant crop drops itself as before.
      const HARVEST_OUTPUT = { shrub: 'wood' };
      const award = () => {
        // Re-check picked at callback time. The work wheel runs async — if a
        // save reload or some other path already marked this wp.id as picked
        // between handler start and callback fire, awarding again would dupe.
        if ((save.picked || []).includes(wp.id)) return;
        save.picked = [...(save.picked || []), wp.id];
        const outId = HARVEST_OUTPUT[wp.crop] || wp.crop;
        scene.addToInv(outId, 1);
        let bonus = '';
        const treasure = WILD_TREASURE[wp.crop];
        if (treasure && Math.random() < treasure.chance) {
          scene.addToInv(treasure.bonus, 1);
          bonus = ` ✨${treasure.bonus}`;
        }
        persistSave(save);
        if (bonus) scene.flashLoot(`${outId}${bonus}`, '#ff8aff', 1, outId);
        else scene.flashLoot(`+1 ${outId}`, undefined, 1, outId);
        // Rare shiny flora — 10× money + a discovery point, on top of the
        // normal pickup, with fanfare.
        if (isShiny(wp.id, SHINY_RATE.flora)) scene.awardShinyBonus(outId, sx, sy);
      };
      const WORK_RELIC = { rockfruit: 'pick', shrub: 'axe' };
      const reqRelic = WORK_RELIC[wp.crop];
      if (reqRelic) {
        // Chopping a shrub is real felling work — charge the shared 9/3/1 tool
        // curve off the axe tier (9 bare-handed, 3 with a Wood axe … 1 frost).
        // rockfruit debris stays free to gather.
        const workCost = (wp.crop === 'shrub' && typeof toolEnergyExpected === 'function')
          ? probEnergy(toolEnergyExpected(save.relics?.axe?.tier || 0))
          : 0;
        startToolWork(ctx, wp.x, wp.y, reqRelic, workCost, award);
      } else {
        award();
        ctx.dirty = true;
      }
      return true;
    }
    return false;
  }},

  // 1a") Coin drops (ATM / bicycle_parking burst). Closest coin within ~3m
  // of the tap → +$1, splice it out of entry.coinDrops, mini flash. Runs
  // BEFORE the 'object' handler so a coin sitting near a chest sprite still
  // gets picked up cleanly. Does NOT consume energy — it's a tap, not work.
  { name: 'coindrop', try: (ctx) => {
    const { scene, save, wm, sx, sy } = ctx;
    const REACH_COIN_M = 3;
    const REACH2 = REACH_COIN_M * REACH_COIN_M;
    let bestEntry = null, bestIdx = -1, bestD2 = REACH2;
    // Scan the 3×3 tile neighbourhood around the player (same set the
    // renderer walks) — coins only live in loaded tiles.
    const pc = scene.playerToWorldCell();
    for (let dty = -1; dty <= 1; dty++) {
      for (let dtx = -1; dtx <= 1; dtx++) {
        const entry = WorldGen.tileCache.get(`${WorldGen.Z}/${pc.tx + dtx}/${pc.ty + dty}`);
        if (!entry || !entry.coinDrops) continue;
        const now = Date.now();
        for (let i = 0; i < entry.coinDrops.length; i++) {
          const c = entry.coinDrops[i];
          if (c.expiresAt && c.expiresAt <= now) continue;
          const d2 = distM2(c.x, c.y, wm.x, wm.y);
          if (d2 < bestD2) { bestD2 = d2; bestEntry = entry; bestIdx = i; }
        }
      }
    }
    if (!bestEntry) return false;
    // Player-reach gate — the 3m REACH_COIN_M above is tap-precision from the
    // tap point; without this a coin in a neighbour tile but outside the lit
    // reach indicator could be grabbed (QC §7).
    const coin = bestEntry.coinDrops[bestIdx];
    if (tooFar(ctx, coin.x, coin.y)) return 'far';
    bestEntry.coinDrops.splice(bestIdx, 1);
    addMoney(save, 1);
    scene.flash('+$1', sx, sy);
    ctx.dirty = true;   // money changed — persist
    return true;
  }},

  // 1b) World objects: chest open, tree flavor, house shop.
  { name: 'object', try: (ctx) => {
    const { scene, save, wm, sx, sy } = ctx;
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
    // Match render.js exactly: deterministic dedupe by game cell so the tap-target set
    // is identical to what's drawn. Sharing the same cell key (chest ids are cell-snapped)
    // avoids the order-dependent "see a crate but can't tap it" mismatch.
    // The till handler below treats an object as "occupied" whenever its FOOT
    // sits in the tapped cell — a cell-shaped target. The reach test here is a
    // circle of radius REACH_OBJECT_M (3.5m) around the foot, measured from the
    // raw tap. The two disagree at the corners: a tap near the far corner of an
    // object's own 5m cell is ~3.54m from the foot, just past 3.5m, so the
    // object falls through and till reports "occupied: chest" even though you
    // clearly tapped it. Compute the tapped cell once so the open-test can also
    // accept any object whose foot shares the tapped cell — symmetric with the
    // occupied-guard, no more "tapped the chest but it won't open".
    const tapCell = worldMetersToAbsCell(scene, wm.x, wm.y);
    const seenTapCell = new Set();
    const isDupTapChest = (o) => {
      // scene.cellM, NOT this.cellM: these handlers are arrow fns defined at
      // module top level, so `this` is the global object (window) here, not the
      // scene — `this.cellM` was undefined, making every key "NaN_NaN". That
      // collapsed ALL loaded chests to one dedupe key, so only the first chest
      // iterated stayed tappable and every other chest fell through to the till
      // handler's "occupied: chest" flash. Mirror render.js, which uses scene.cellM.
      const k = Math.floor(o.x / scene.cellM) + '_' + Math.floor(o.y / scene.cellM);
      if (seenTapCell.has(k)) return true;
      seenTapCell.add(k);
      return false;
    };
    for (const o of allObjs) {
      if (o.kind === 'chest' && isDupTapChest(o)) continue;
      // Shrine + house/tower share the wider house-sized reach: their sprites
      // are taller than the default 3.5m hit zone, so a tap on the visible top
      // of the sprite would otherwise miss-and-fall-through to the till handler
      // under it. Wells are deliberately NOT here — they must activate on their
      // own cell only (a tap on the cell above should not trigger them).
      const tallSprite = (o.kind === 'house' || o.kind === 'tower' || o.kind === 'shrine');
      const r = tallSprite ? REACH_HOUSE_M : REACH_OBJECT_M;
      // The sprite rises NORTH (toward smaller world-y) from its foot at o.y, so
      // for tall sprites measure reach from the sprite's mid-height — HOUSE_HIT_RISE_M
      // north of the foot — rather than the foot itself. This lets a tap on the
      // visible body of a SMALL/MEDIUM house (whose footprint is only 1-2 cells,
      // all tucked under the roof) activate it, instead of missing the 6m foot
      // circle and falling through to the till handler.
      const oy = tallSprite ? o.y - HOUSE_HIT_RISE_M : o.y;
      // Accept the tap if it lands within the sprite's reach circle OR anywhere
      // in the object's own cell (so corner taps don't fall through to the till
      // "occupied" guard). Opened chests are excluded from the cell-fallback so
      // their cell stays tillable — the till guard skips them too, and a tap
      // right on one still flashes "Picked clean already" via the reach circle.
      const withinReach = distM2(o.x, oy, wm.x, wm.y) < r * r;
      let inTapCell = false;
      if (!withinReach && !(o.kind === 'chest' && openedSetTap.has(o.id))) {
        const oc = worldMetersToAbsCell(scene, o.x, o.y);
        const sameCol = oc.cellIX === tapCell.cellIX;
        inTapCell = sameCol && oc.cellIY === tapCell.cellIY;
        // A castle/tower turret rises tall above its foot cell — let a tap on
        // the empty cell directly ABOVE (north of) the turret activate it too.
        // North is toward smaller world-y → smaller cellIY (see coords.js).
        if (!inTapCell && o.kind === 'tower') {
          inTapCell = sameCol && tapCell.cellIY === oc.cellIY - 1;
        }
      }
      if (!withinReach && !inTapCell) continue;
      if (tooFar(ctx, o.x, o.y)) return 'far';
      if (o.kind === 'groundstack') {
        // Already-picked stacks are filtered out at render time, but the
        // forEachItem here walks all objects regardless of save state, so
        // guard again in case a tap races a re-render.
        if (save.picked && save.picked.includes(o.id)) continue;
        save.picked = [...(save.picked || []), o.id];
        const qty = Math.max(1, o.qty || 1);
        scene.addToInv(o.itemId, qty);
        ctx.dirty = true;
        const item = ITEM_BY_ID[o.itemId];
        scene.flashLoot(`+${qty} ${item?.name || o.itemId}`, undefined, 1, o.itemId);
        return true;
      }
      if (o.kind === 'chest') {
        // Coin-burst POIs (ATM + bicycle parking) hijack the chest tap before
        // the standard open-and-loot path. They never go into save.opened —
        // they're gated by save.coinBurstClaimed[id+YYYYMMDD] so they refresh
        // daily, and produce world-scattered coin pickups instead of inventory loot.
        if (o.poiClass === 'atm' || o.poiClass === 'bicycle_parking') {
          if (typeof scene._coinBurstInteract === 'function') {
            scene._coinBurstInteract(sx, sy, o);
            return true;
          }
          // Fall through to default chest behaviour if the method isn't wired
          // (defensive — keeps these POIs usable if app.js is out of sync).
        }
        if (save.opened.includes(o.id)) { scene.flash('Picked clean already.', sx, sy); return true; }
        // A chest previously left-for-later has its exact loot saved in
        // chestHold; reopening replays that same roll. Fresh opens go through
        // pickReward which handles items AND relics (biome-specific weights).
        const held = save.chestHold && save.chestHold[o.id];
        const chestT = (typeof chestTier === 'function') ? chestTier(o.poiClass) : 2;
        const category = (typeof POI_CATEGORY !== 'undefined' && POI_CATEGORY[o.poiClass]) || 'lowtier';
        const result = held
          ? { kind: 'item', id: held.id, qty: held.n, consolation: 0 }
          // Starter chests carry a fixed payload (5 wood / 5 rockfruit / 9
          // potato seeds) so the first restoration loop is deterministic —
          // skip the rarity picker and synthesize the same item shape it
          // returns, then fall through to the normal item/modal path below.
          : (o.fixedLoot
              ? { kind: 'item', id: o.fixedLoot.id, qty: o.fixedLoot.qty, consolation: 0 }
              : ((typeof pickReward === 'function')
                  ? pickReward('chest:' + category, save, undefined, { tier: chestT })
                  : null));
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
        // Chest loot gets the full ceremony modal — quick-feedback flashLoot
        // is reserved for X-marks / harvest / mining (cheap repeating rewards).
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
      }
      if (o.kind === 'well') {
        // Fountain / well (OSM amenity=fountain) — a water source on dry land.
        // Tapping it tops the watering can up to full, exactly like tapping a
        // WATER tile via the 'can-refill' handler. No can owned yet → a flavour
        // flash so the well still reads as interactive (and hints at its use).
        if (!save.relics?.can) {
          scene.flash('Cool, clear water. (need a watering can)', sx, sy);
          return true;
        }
        save.canCharges = 50;
        ctx.dirty = true;
        scene.flash('🪣 Watering can full — 50 charges.', sx, sy);
        return true;
      }
      if (o.kind === 'tree') {
        // Chopped flag is persisted into save.chopped so a tile re-rasterize
        // (e.g. cache eviction after a long walk) doesn't regrow the stump.
        // We skip chopped trees entirely so they don't block 'till' on their
        // cell — let the next handler claim the tap instead of consuming it
        // with a 'stump' flash that the player can't act on.
        if (o.chopped || (save.chopped && save.chopped.includes(o.id))) continue;
        // Bigger trees need a sturdier axe and pay out proportionally more
        // wood: full-size → Iron axe (4× wood), medium → Copper (2×), small /
        // bush → any axe (base). Softwood (pine) fells one tier easier,
        // hardwood (maple) one tier harder (clamped to the axe range). Rare
        // shiny trees demand a Gold axe whatever their size. An axe below the
        // required tier just bounces with a hint.
        const reqTier = treeAxeReqTier(o);
        const axeTier = save.relics?.axe?.tier || 0;
        if (axeTier < reqTier) {
          const need = TIER_BY_NUM[reqTier]?.name || 'better';
          scene.flash(`Need a ${need} axe to fell this ${treeSpeciesName(o)} tree.`, sx, sy);
          return true;
        }
        const woodMul = treeWoodMul(o);
        const chopCost = (typeof effectiveChopCost === 'function')
          ? effectiveChopCost(save.relics, o) : 0;
        return startToolWork(ctx, o.x, o.y, 'axe', chopCost, () => {
          o.chopped = true;
          save.chopped = save.chopped || [];
          if (!save.chopped.includes(o.id)) save.chopped.push(o.id);
          scene.addToInv('wood', randInt(2, 3) * woodMul);
          persistSave(save);
          scene.flash(`🌲 Felled ${treeSpeciesName(o)} tree.`, sx, sy);
          // Rare shiny tree — 10× wood value in cash + a discovery point.
          if (isShiny(o.id, SHINY_RATE.tree)) scene.awardShinyBonus('wood', sx, sy);
        });
      }
      if (o.kind === 'house' || o.kind === 'tower') {
        scene.shopInteract(sx, sy, o);
        return true;
      }
      if (o.kind === 'shrine') {
        // Magic Crafting Shrine — opens level-up + transform UI.
        if (typeof scene.shrineInteract === 'function') {
          scene.shrineInteract(sx, sy, o);
        } else {
          const lvl = save.shrineLevel || 1;
          scene.flash(`shrine L${lvl}`, sx, sy);
        }
        return true;
      }
      if (o.kind === 'fruittree') {
        const FRUIT_RESPAWN_MS = 24 * 60 * 60 * 1000;   // one harvest per 24h
        // A planted sapling can't be harvested until it has matured (reached
        // its fruiting stage). ~12 min sprout→fruit (4 × 3-min stages).
        if (o.planted) {
          const FRUIT_STAGE_MS = 3 * 60 * 1000;
          const elapsed = Date.now() - (o.planted_t || 0);
          if (elapsed < 4 * FRUIT_STAGE_MS) {
            const minsLeft = Math.max(1, Math.ceil((4 * FRUIT_STAGE_MS - elapsed) / 60000));
            scene.flash(`Still growing — ${minsLeft}m`, sx, sy);
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
        scene.addToInv(o.species, randInt(1, 2));
        ctx.dirty = true;
        const item = ITEM_BY_ID[o.species];
        scene.flashLoot(`harvested ${item?.name || o.species}`, '#a7ffb0', 1, o.species);
        // Rare shiny fruit tree — 10× fruit value in cash + a discovery point.
        if (isShiny(o.id, SHINY_RATE.tree)) scene.awardShinyBonus(o.species, sx, sy);
        return true;
      }
      if (o.kind === 'mineralrock') {
        // brokenRockSet is normally keyed by cell-key (numeric "IX_IY") for
        // natural rock cells. Mineral rock ids look like "mr_..." so collisions
        // with cell-keys are essentially impossible — reuse the same set.
        // (Spent rocks are filtered out of the render list, so we shouldn't
        // hit this branch in practice; keep the guard for taps that race a
        // render frame or hit a stale object reference.)
        if (scene.brokenRockSet.has(o.id)) return true;
        const isCave = o.caveVariant != null;
        // "Plain rock" = a cave rock OR a T1 deposit. Both render as the vanilla
        // rock sprite and drop rockfruit (stone), not a bar — ore proper starts
        // at copper (T2). Plain rock is bare-hand-breakable and ungated.
        const isPlain = isCave || (o.yieldTier || 1) <= 1;
        const pickTier = save.relics?.pick?.tier || 0;
        // Pick-tier gate on ORE rocks (T2+): copper-bearing rock needs a Wood
        // pick, and every fancier ore needs a pick one tier below its own
        // (requiredTier = max(1, yieldTier-1), set in worldgen). Pickaxe tier
        // ALSO affects SPEED (toolDurationMs: 9s bare → 0.3s frost).
        if (!isPlain) {
          const reqTier = o.requiredTier || Math.max(1, (o.yieldTier || 1) - 1);
          if (pickTier < reqTier) {
            const need = TIER_BY_NUM[reqTier]?.name || 'better';
            scene.flash(`Need a ${need} pick to mine this ore.`, sx, sy);
            return true;
          }
        }
        // Energy is the shared tool-tier baseline (9 bare-handed → 3 Wood → 1
        // Frost, probabilistic between via effectivePickCost) OR a +9-per-tier
        // surcharge when the rock out-tiers your pick, whichever is greater.
        // Plain rock counts as tier 1, so bare hands (tier 0) pay 9; a Frost
        // pick on plain rock pays the 1 baseline.
        const rockTier = o.yieldTier || 1;
        const cost = Math.max(effectivePickCost(save.relics), 9 * (rockTier - pickTier));
        if (!scene.spendEnergy(cost, sx, sy)) return true;
        const durMs = (typeof toolDurationMs === 'function')
          ? toolDurationMs(save.relics, 'pick')
          : (save.relics?.pick ? 3000 : 9000);
        scene.startWorkProgress(o.x, o.y, () => {
          scene.brokenRockSet.add(o.id);
          save.brokenRocks = [...scene.brokenRockSet];
          // Bar lookup is shared between the plain-rock lucky-strike and the
          // ore-rock primary drop. Slot 0/1 are unused for the primary drop
          // (ore starts at copper = T2); each tier T2+ yields its OWN namesake
          // bar. Higher tiers still get bonus gems on top via the GEM table.
          const BARS = ['', 'copper_bar', 'copper_bar', 'iron_bar', 'gold_bar', 'platinum_bar', 'crimson_bar', 'frost_bar'];
          if (isPlain) {
            // Plain rock (cave variant or T1) — primarily stone (1-3 rockfruit),
            // coal on ~20 % of breaks, plus a small chance per tier of
            // cracking open a sliver of ore. Ore rolls START at copper (t=2):
            // BARS[1] and BARS[2] are both copper, so the old t=1 pass handed
            // out copper 50 % of the time on top of t=2 — plain rock gave
            // copper more than half the swings. Now per-tier P is 1/(2*t²) from
            // copper: ~12.5 % copper, ~5.6 % iron, ~3.1 % gold … ~1 % frost.
            // Independent rolls, so a lucky cave can still yield multiple bars.
            const qty = randInt(1, 3);
            scene.addToInv('rockfruit', qty);
            if (Math.random() < 0.20) scene.addToInv('coal', 1);
            let flashId = 'rockfruit';
            for (let t = 2; t <= 7; t++) {
              if (Math.random() < 1 / (2 * t * t)) {
                const bar = BARS[t];
                if (bar) { scene.addToInv(bar, 1); flashId = bar; }
              }
            }
            persistSave(save);
            const item = ITEM_BY_ID[flashId];
            // Show the real loot icon (copper bar, rockfruit, gem) via flashLoot,
            // exactly like every other pickup. The old text-only `flash` baked a
            // literal 🪨 emoji into the string, so the splash rendered the rock
            // glyph instead of the copper-bar icon the player actually mined.
            scene.flashLoot(`+1 ${item?.name || flashId}`, '#a7ffb0', 1, flashId);
            return;
          }
          // Ore-bearing rock — exactly ONE bar of the indicated type, plus
          // a coal nugget and a tier-rolled gem on T4+. Bar count is no
          // longer randomised (was 2-3) — every iron rock gives one iron,
          // every gold rock gives one gold. Predictable yield per swing.
          scene.addToInv('coal', randInt(1, 2));
          const t = o.yieldTier || 1;
          const primaryBar = BARS[t] || 'copper_bar';
          scene.addToInv(primaryBar, 1);
          // Side gems on T4+ rocks. Higher tier rocks have richer gem yields.
          let flashId = primaryBar;
          let gemsFound = 0;
          const GEM_BY_TIER = { 4: ['sapphire'], 5: ['ruby'], 6: ['emerald'], 7: ['emerald', 'ruby'] };
          const GEM_P_BY_TIER = { 4: 0.25, 5: 0.35, 6: 0.40, 7: 0.50 };
          const gems = GEM_BY_TIER[t];
          if (gems && Math.random() < (GEM_P_BY_TIER[t] || 0)) {
            const gemId = pickFromArray(gems);
            scene.addToInv(gemId, 1);
            flashId = gemId;
            gemsFound++;
          }
          // T7 rocks have a bonus 25% chance for a second ruby on top.
          if (t === 7 && Math.random() < 0.25) {
            scene.addToInv('ruby', 1);
            flashId = 'ruby';
            gemsFound++;
          }
          persistSave(save);
          // Finding a gem is a rare score — fire the jackpot fanfare (banner +
          // radiating stars) on top of the usual loot flash, sized to the gem
          // count so a T7 double-ruby reads even bigger.
          if (gemsFound >= 1 && typeof scene.flashJackpot === 'function') {
            scene.flashJackpot(gemsFound);
          }
          const item = ITEM_BY_ID[flashId];
          // Real loot icon via flashLoot (was a text-only 💎 emoji flash that
          // showed a gem glyph instead of the mined bar/gem icon).
          scene.flashLoot(`+1 ${item?.name || flashId}`, '#a7ffb0', 1, flashId);
        }, durMs, cost, 'pick');   // cost = refund if the player cancels mid-mine
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
    // Single source of truth (coords.js): cellInReach uses the same
    // (cellIX - playerCellIX, cellIY - feetCellIY) integer math as the
    // visual reach silhouette in render.js, so a cell that's visually
    // lit is always tap-accepted — no FP / cell-centre / hypot drift.
    if (!cellInReach(scene, cellIX, cellIY)) {
      scene.flash('Just out of reach.', sx, sy); return true;
    }
    ctx.cell = cell;
    ctx.cellIX = cellIX;
    ctx.cellIY = cellIY;
    ctx.cwmx = cwmx;
    ctx.cwmy = cwmy;
    ctx.cellKey = cellKeyFromAbsCell(cellIX, cellIY);
    return false;
  }},

  // 2a-path) Path-stone tap. Tapping a named pedestrian-path cell claims
  // it (same effect as stepping on it). Doesn't consume the tap — falls
  // through so any other handler on the same cell still fires (e.g. a
  // wildplant on the cell next to the path). The activation method is
  // a no-op if the cell isn't a named path or is already claimed.
  { name: 'path-stone', try: (ctx) => {
    const { scene, cellIX, cellIY, cwmx, cwmy, cell } = ctx;
    if (!cell || cell.type !== TERRAIN.PATH) return false;
    const ctx_tx = Math.floor(cwmx / scene.tileEdgeM);
    const ctx_ty = Math.floor(cwmy / scene.tileEdgeM);
    if (typeof scene._activatePathStone === 'function') {
      scene._activatePathStone(ctx_tx, ctx_ty, cellIX, cellIY);
    }
    return false;   // don't consume — let downstream handlers run
  }},

  // 2a) Building-zone tap — runs AFTER cell-resolve so we already know the
  // player is within tap range of the cell. If that cell is a building tile
  // (small house / fort / castle terrain), find the nearest house/tower in
  // the loaded objects[] and route the tap to shopInteract as if the player
  // had clicked the building sprite itself. Without this, taps on the
  // non-sprite cells of a building's biome cluster fall through to the
  // til/release/etc. handlers and look like nothing happened, because the
  // 'object' handler's REACH_HOUSE_M=6m doesn't span the full 5×5-cell
  // building footprint (≈35 m diagonal). The 30 m snap keeps us from
  // bridging across to a different cluster on the next tile.
  { name: 'building-zone', try: (ctx) => {
    const { scene, sx, sy, cwmx, cwmy, cell } = ctx;
    if (!BUILDING_TYPES.has(cell.type)) return false;
    const best = findClosestItem('objects', cwmx, cwmy, 30,
      (o) => o.kind === 'house' || o.kind === 'tower');
    if (!best) return false;
    scene.shopInteract(sx, sy, best);
    return true;
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
    // Shiny animals release as their plain kind (so the world creature
    // renders + behaves normally) but carry a shiny flag so they tint gold and
    // re-catch back into the shiny stack.
    const baseKind = item.base || item.id;
    const isShinyItem = !!item.shiny;
    // Chickens are flock animals — one "release" drops a clutch of 4 hens, so
    // you need at least 4 in the stack to place any. Cows (and any future
    // non-flock animal) still release one at a time.
    const flockSize = baseKind === 'chicken' ? 4 : 1;
    if ((sel.count ?? 0) < flockSize) {
      scene.flash(`Need ${flockSize} ${item.name || item.id}s for a flock.`, sx, sy);
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
      const id = releasedId(baseKind, i);
      save.released.push({ x: cwmx + ox, y: cwmy + oy, kind: baseKind, id, tx, ty, shiny: isShinyItem });
      if (entry && entry.creatures) entry.creatures.push({ x: cwmx + ox, y: cwmy + oy, kind: baseKind, id, shiny: isShinyItem });
    }
    consumeSelected(save, flockSize);
    ctx.dirty = true;
    scene.buildInventoryDOM();
    scene.flash(`released ${flockSize}× ${item.name || item.id}`, sx, sy);
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
      scene.flash('⛏ rock', sx, sy);
    });
    return true;
  }},

  // 2-pickup-scarecrow) Tap a placed scarecrow (any tap, any selection) to
  // pick it back up. Stores positions in save.scarecrows = [{ x, y }, …].
  { name: 'pickup-scarecrow', try: (ctx) => {
    const { scene, save, sx, sy, cwmx, cwmy } = ctx;
    const arr = save.scarecrows = save.scarecrows || [];
    const half = scene.cellM / 2;
    const idx = arr.findIndex(s => Math.abs(s.x - cwmx) < half && Math.abs(s.y - cwmy) < half);
    if (idx < 0) return false;
    arr.splice(idx, 1);
    scene.addToInv('scarecrow', 1);
    ctx.dirty = true;
    scene.flash('🪦 reclaimed', sx, sy);
    return true;
  }},

  // 2-place-scarecrow) With scarecrow selected, drop one on an empty tillable cell.
  { name: 'place-scarecrow', try: (ctx) => placeOnEmptyCell(ctx, {
    itemId: 'scarecrow',
    // Scarecrow placement is free (no energyKey). Extra guard: refuse if a
    // scarecrow already sits on this cell (rock has no such per-cell list to
    // check — placedRockSet membership is implied by the tilled/planted gates).
    extraGuard: ({ save, cwmx, cwmy }) =>
      !(save.scarecrows || []).some(s => Math.abs(s.x - cwmx) < 0.1 && Math.abs(s.y - cwmy) < 0.1),
    place: ({ save, cwmx, cwmy }) => {
      save.scarecrows = save.scarecrows || [];
      save.scarecrows.push({ x: cwmx, y: cwmy });
    },
    flashMsg: '🪦 The scarecrow watches.',
  })},

  // 2-extinguish-fire) Tap a placed campfire (any tap, any selection) to put it
  // out. The coal already burned, so there's no refund — this just clears the
  // cell. Runs before light-fire so tapping a fire never stacks a second one.
  { name: 'extinguish-fire', try: (ctx) => {
    const { scene, save, sx, sy, cwmx, cwmy } = ctx;
    const arr = save.fires = save.fires || [];
    const half = scene.cellM / 2;
    const idx = arr.findIndex(f => Math.abs(f.x - cwmx) < half && Math.abs(f.y - cwmy) < half);
    if (idx < 0) return false;
    arr.splice(idx, 1);
    ctx.dirty = true;
    scene.flash('🔥 out', sx, sy);
    return true;
  }},

  // 2-light-fire) With coal selected, burn it to light a campfire on an empty
  // bare (tillable) cell. The fire repels slimes within 4 m — the same way a
  // scarecrow repels crows/deer — and slowly restores energy to anyone resting
  // near it (see app.js). Coal is consumed; the fire persists until tapped out.
  { name: 'light-fire', try: (ctx) => placeOnEmptyCell(ctx, {
    itemId: 'coal',
    extraGuard: ({ save, cwmx, cwmy }) =>
      !(save.fires || []).some(f => Math.abs(f.x - cwmx) < 0.1 && Math.abs(f.y - cwmy) < 0.1),
    place: ({ save, cwmx, cwmy }) => {
      save.fires = save.fires || [];
      save.fires.push({ x: cwmx, y: cwmy });
    },
    flashMsg: '🔥 The fire crackles.',
  })},

  // 2-place-rock) With rockfruit selected, drop a stone on an empty tillable cell.
  { name: 'place-rock', try: (ctx) => placeOnEmptyCell(ctx, {
    itemId: 'rockfruit',
    energyKey: 'rockPlace',
    place: ({ scene, save, cellKey }) => {
      scene.placedRockSet.add(cellKey);
      save.placedRocks = [...scene.placedRockSet];
    },
    flashMsg: '🪨 Stone set.',
  })},

  // 2a) Tap a planted cell → harvest / advance / water / stage readout.
  { name: 'planted', try: (ctx) => {
    const { scene, save, sx, sy, cellKey, cwmx, cwmy } = ctx;
    // Match against the whole CELL the tap lands in (same half-cell epsilon the
    // till path uses below), not a tight 0.1m epsilon. A planted cell must
    // always be handled here so a tap on an immature crop reports its growth
    // stage — it must never fall through to the till path's "occupied:" message.
    const cellHalfM = scene.cellM / 2;
    const plantedIdx = save.planted.findIndex(p =>
      Math.abs(p.x - cwmx) < cellHalfM && Math.abs(p.y - cwmy) < cellHalfM);
    if (plantedIdx < 0) return false;
    const p = save.planted[plantedIdx];
    // 1-indexed "<stage>/<total>" growth readout for an immature crop, e.g.
    // a freshly-seeded plant (stage 0) reads "1/5"; one short of mature reads
    // "4/5". CROP_NAMES gives a friendly label; fall back to the raw crop id.
    // Potato gets descriptive per-stage names instead of the numeric readout:
    // stage 0..4 → seedling → sprout → small plant → plant → harvest.
    const POTATO_STAGE_NAMES = [
      'Potato Seedling', 'Potato Sprout', 'Small Potato Plant',
      'Potato Plant', 'Potato Harvest',
    ];
    const stageReadout = () => {
      const stage = p.stage ?? 0;
      if (p.crop === 'potato') return POTATO_STAGE_NAMES[stage];
      return `${CROP_NAMES?.[p.crop] || p.crop} ${stage + 1}/${MAX_GROWTH_STAGE + 1}`;
    };
    const stageHoldMs = 15 * 60 * 1000;   // 15 min/stage — keep in sync with app.js + render.js STAGE_HOLD_MS
    const sinceWater = p.watered_t ? Date.now() - p.watered_t : Infinity;
    if (p.watered_t && sinceWater >= stageHoldMs && (p.stage ?? 0) < MAX_GROWTH_STAGE) {
      p.stage = (p.stage ?? 0) + 1;
      p.watered_t = 0;
      ctx.dirty = true;
      scene.flash('🌱 Watered.', sx, sy);
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
      const yieldN = randInt(1, 3) + Math.floor(qual / 3);
      scene.addToInv(p.crop, yieldN);
      const gotSeed = Math.random() < (0.25 + qual * 0.10);
      if (gotSeed) scene.addToInv(`${p.crop}_seed`, 1);
      ctx.dirty = true;
      // flashLoot draws the crop sprite from the itemId arg — the text stays
      // emoji-free (name + count only).
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
      // Water the plant AND report its growth progress so the player can see
      // how close it is to harvest (e.g. "Pairy 2/5").
      scene.flash(stageReadout(), sx, sy);
      return true;
    }
    // Already watered and still growing: show the growth-stage readout.
    scene.flash(stageReadout(), sx, sy);
    return true;
  }},

  // 2a') Refill the watering can from any WATER tile (type 3). Sets a charge
  // bank that gives +2 tiers of quality bonus on the next 50 watering events.
  { name: 'can-refill', try: (ctx) => {
    const { scene, save, sx, sy, cell } = ctx;
    if (cell.type !== TERRAIN.WATER) return false;          // not water
    if (!save.relics?.can) return false;         // no can owned
    // Neither the can nor the rod is a selectable inventory item, so a bare
    // water tap is ambiguous when the player owns both. A rod wins — water
    // taps cast a line (see 'fishing' below), and the cast tops the can up
    // for free, so a rod owner loses nothing by skipping this handler.
    if (save.relics?.rod) return false;
    save.canCharges = 50;
    ctx.dirty = true;
    scene.flash('🪣 Watering can full — 50 charges.', sx, sy);
    return true;
  }},

  // 2a-fish) Fishing: tap a water cell (type 3) with a Fishing Rod relic equipped.
  // Triggers a 5s work-progress, then drops a random fish weighted by rarity
  // (modified by rod tier — higher tier → more chance of rare fish). Placed
  // BEFORE flavor so the water-tap doesn't get eaten by the 'water' label.
  { name: 'fishing', try: (ctx) => {
    const { scene, save, sx, sy, cell } = ctx;
    if (cell.type !== TERRAIN.WATER) return false;
    // No rod? You can still fish BARE-HANDED — it just takes 3× as long (the
    // tier-0 cast time from toolDurationMs). A rod speeds the cast by tier AND
    // improves the catch; bare hands fish at tier 0 (higher skunk rate, minnow-
    // heavy weights) so only owning a rod improves the catch (spec §FISHING).
    const fishCost = (typeof effectiveFishCost === 'function')
      ? effectiveFishCost(save.relics) : (ENERGY_COST?.fish ?? 9);
    if (!scene.spendEnergy(fishCost, sx, sy)) return true;
    // A rod owner can't reach 'can-refill' (the rod owns water taps), so top
    // the can up here as part of the cast so owning a rod never costs you your
    // watering charges. Bare-handed casts without a can simply skip this.
    if (save.relics?.can) { save.canCharges = 50; ctx.dirty = true; }
    const castMs = (typeof toolDurationMs === 'function')
      ? toolDurationMs(save.relics, 'rod') : (save.relics?.rod ? 3000 : 9000);
    scene.startWorkProgress(ctx.cwmx, ctx.cwmy, () => {
      const tier = save.relics?.rod?.tier || 0;   // 0 = bare hands (worst odds)
      // Per user: most of the wait results in nothing on a low-tier rod,
      // and that "skunk" rate falls as the rod climbs. Linear ramp:
      //   tier 0 (bare hands) → 55%
      //   T1 → 50%  (the user's "half the time")
      //   T7 → 20%
      // Formula: max(0.20, 0.55 - tier * 0.05). T7 floors at 0.20.
      const skunkChance = Math.max(0.20, 0.55 - tier * 0.05);
      if (Math.random() < skunkChance) {
        scene.flashLoot('🎣 nothing biting…', '#888', 0.9);
        return;
      }
      // 2% per cast → gear jackpot. The rolled tier is capped by the loot rule
      // (chestT=2 → preferred tier clamp in rollGearUpgrade); harvest/catch
      // milestone gating was removed, so this always yields a gear roll. An
      // upgrade auto-equips; a dupe cashes out as consolation gold.
      if (Math.random() < 0.02) {
        const reward = (typeof rollGearUpgrade === 'function')
          ? rollGearUpgrade(undefined, save, save.relics, 2, save.armor)
          : null;
        if (reward?.kind === 'relic' || reward?.kind === 'armor') {
          equipGearReward(reward, save, scene);
          persistSave(save);
          const label = (typeof gearName === 'function')
            ? gearName(reward.kind, reward.slot, reward.tier)
            : `${reward.slot} T${reward.tier}`;
          scene.flashLoot(`✨ ${label} (equipped!)`, '#ffd96b', 1.6);
          return;
        }
        if (reward?.kind === 'gold') {
          const label = (typeof gearName === 'function')
            ? gearName(reward.gearKind || 'relic', reward.slot, reward.tier)
            : `${reward.slot} T${reward.tier}`;
          scene.flashLoot(`✨ ${label} (already better)`, '#aaa', 1.2);
          persistSave(save);
          return;
        }
        // reward null (no milestones yet) — fall through to fish table.
      }
      // 6% per cast → junk pull (old boot). Below the relic jackpot in the
      // order so the 2% jackpot wins the cast outright when both would
      // fire.
      if (Math.random() < 0.06) {
        scene.addToInv('boot', 1);
        persistSave(save);
        scene.flashLoot('🥾 Old Boot', '#999', 1, 'boot');
        return;
      }
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
    }, castMs, 5, 'rod');   // castMs = rod-tier cast time (bare hands 9s); 5 = cancel refund
    return true;
  }},

  // 2b) Tap non-tillable terrain → flavor label.
  { name: 'flavor', try: (ctx) => {
    const { scene, sx, sy, cell } = ctx;
    if (isTillable(cell.type)) return false;
    const t = cell.type;
    const flavor = t === TERRAIN.WATER ? 'water'
                 : (t === TERRAIN.BUILDING || t === TERRAIN.BUILDING_MED || t === TERRAIN.BUILDING_LARGE) ? 'building'
                 : t === TERRAIN.ROAD_LG ? 'highway'
                 : t === TERRAIN.ROAD_MD ? 'avenue'
                 : t === TERRAIN.ROAD    ? 'road'
                 : t === TERRAIN.PATH    ? 'path'
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
    if (!item || (item.kind !== 'seed' && item.kind !== 'sapling')) {
      scene.tilledSet.delete(cellKey);
      save.tilled = [...scene.tilledSet];
      ctx.dirty = true;
      scene.flash('Soil loosened.', sx, sy);
      return true;
    }
    if ((sel.count ?? 0) <= 0) {
      scene.flash('That pouch is empty.', sx, sy);
      return true;
    }
    if (!scene.spendEnergy(ENERGY_COST?.plant ?? 0, sx, sy)) return true;
    if (item.kind === 'sapling') {
      // Plant a fruit-tree sapling → a growing `fruittree` (persisted in
      // save.fruittrees, re-injected per tile in spawnInTile). It advances
      // through the species sheet's life-cycle frames and bears fruit at
      // maturity (render.js fruittree spec + the fruittree harvest handler).
      save.fruittrees = save.fruittrees || [];
      const id = `pft_${Math.round(cwmx)}_${Math.round(cwmy)}`;
      const planted_t = Date.now();
      const species = item.grows === 'peach' ? 'peach' : 'apple';
      if (!save.fruittrees.some(f => f.id === id)) {
        save.fruittrees.push({ x: cwmx, y: cwmy, species: item.grows, planted_t, id });
      }
      // It's a tree now, not soil — drop the tilled marker.
      scene.tilledSet.delete(cellKey);
      save.tilled = [...scene.tilledSet];
      // Inject the growing fruittree straight into the covering tile's LIVE
      // cache entry (mirrors spawnInTile's fruittree block) so it appears at
      // once. Deleting the cache entry instead — as this used to do — dropped
      // the tile's ground `grid`, so the synchronous ground render fell back to
      // grass for every cell (the "whole landscape goes green" crash) until the
      // async loadTile re-fetched the tile. See render.js GRASS_FALLBACK_COLOR.
      const tEdge = scene.tileEdgeM;
      const tx = Math.floor(cwmx / tEdge), ty = Math.floor(cwmy / tEdge);
      const entry = WorldGen.tileCache.get(`${WorldGen.Z}/${tx}/${ty}`);
      if (entry) {
        entry.objects = entry.objects || [];
        if (!entry.objects.some(o => o.id === id)) {
          entry.objects.push({ kind: 'fruittree', x: cwmx, y: cwmy, species, id, planted: true, planted_t });
        }
      }
      consumeSelected(save);
      ctx.dirty = true;
      scene.buildInventoryDOM();
      scene.flash(`planted ${item.grows} sapling`, sx, sy);
      return true;
    }
    save.planted.push({ x: cwmx, y: cwmy, crop: item.grows, stage: 0, watered_t: 0 });
    consumeSelected(save);
    ctx.dirty = true;
    scene.buildInventoryDOM();
    scene.flash(`planted ${item.grows}`, sx, sy);
    return true;
  }},

  // 2d) Untilled tillable cell → till it (refuses if occupied by any interactable).
  { name: 'till', try: (ctx) => {
    const { scene, save, sx, sy, cell, cellKey, cwmx, cwmy } = ctx;
    const cellHalfM = scene.cellM / 2;
    const pickedAll = new Set(save.picked || []);
    let blocker = null;
    if (scene.placedRockSet.has(cellKey)) blocker = 'rock';
    if (!blocker) {
      const pp = save.planted.find(p => inPlantedCell(p, cwmx, cwmy, cellHalfM));
      if (pp) blocker = pp.crop || 'crop';
    }
    if (!blocker) {
      const openedSet = new Set(save.opened || []);
      for (const e of WorldGen.tileCache.values()) {
        const wp = (e.wildplants || []).find(wp => !pickedAll.has(wp.id) && Math.abs(wp.x - cwmx) < cellHalfM && Math.abs(wp.y - cwmy) < cellHalfM);
        if (wp) { blocker = wp.crop || 'plant'; break; }
        const choppedSet = new Set(save.chopped || []);
        const oo = (e.objects || []).find(o =>
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
    // Tilling runs a WORK WHEEL. Duration follows the shared tool ladder via the
    // hoe slot (bare hands 9s; a Hoe relic speeds it by tier). GRASSLAND-biome
    // cells till in HALF the time (spec §cells). Energy is pre-spent and refunds
    // if the player cancels the wheel.
    let tillMs = (typeof toolDurationMs === 'function')
      ? toolDurationMs(save.relics, 'hoe') : (save.relics?.hoe ? 3000 : 9000);
    if (GRASSLAND_TILL.has(cell.type)) tillMs = Math.round(tillMs / 2);
    scene.startWorkProgress(cwmx, cwmy, () => {
      scene.tilledSet.add(cellKey);
      save.tilled = [...scene.tilledSet];
      persistSave(save);
      scene.flash('tilled', sx, sy);
    }, tillMs, tillCost, 'hoe');
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
