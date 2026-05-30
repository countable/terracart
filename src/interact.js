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

// Nearest item in a WorldGen layer to (px, py) within reachM that passes
// `accept`, or null. Centralizes the bestD2 scan every "tap the closest X"
// handler repeats. `accept` may be omitted to consider all items.
function findClosestItem(layer, px, py, reachM, accept) {
  let best = null, bestD2 = reachM * reachM;
  WorldGen.forEachItem(layer, (item) => {
    if (accept && !accept(item)) return;
    const d2 = distM2(item.x, item.y, px, py);
    if (d2 < bestD2) { bestD2 = d2; best = item; }
  });
  return best;
}

// Shared "too far to reach from the player's cell" guard. Flashes and returns
// true when (x, y) is beyond REACH_FAR_M of the player cell centre, so callers
// do `if (tooFar(ctx, x, y)) return 'far';`.
function tooFar(ctx, x, y) {
  if (distM2(x, y, ctx.pCellCx, ctx.pCellCy) > REACH_FAR_M * REACH_FAR_M) {
    ctx.scene.flash('Just out of reach.', ctx.sx, ctx.sy);
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
        !save.planted.some(p => Math.abs(p.x - cwmx) < 0.1 && Math.abs(p.y - cwmy) < 0.1))) {
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
      // Starter crates carry a fixed `starterLoot` payload (5 wood / 5
      // rockfruit) so the player gets a deterministic head start on the
      // first restoration. Skip the rarity picker for these and synthesize
      // the same shape pickReward returns so the rest of the flash /
      // accept logic keeps working.
      let reward;
      if (tr.starterLoot) {
        reward = { kind: 'item', id: tr.starterLoot.id, qty: tr.starterLoot.qty, jackpot: 0, consolation: 0 };
      } else {
        reward = (typeof pickReward === 'function')
          ? pickReward('treasure:default', save) : null;
      }
      if (!reward) {
        // Shouldn't happen — context exists — but bail safely if rarity.js
        // is missing or the pool is empty.
        addMoney(save, 1);
        scene.flashLoot('✕ → $1', '#ffd96b');
      } else if (reward.kind === 'item') {
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
  // PRIORITY: creature checks happen BEFORE wildplant / object / cell so a
  // tap near any nearby animal always reads as "I'm trying to interact with
  // the animal." A tap on a tree two metres from a chicken will trigger the
  // chicken handler (favourite-food hint / catch / yuck), not the chop —
  // step away from the animal to chop the tree. This is intentional: in
  // practice missing a chicken tap is more frustrating than missing a tree.
  { name: 'creature', try: (ctx) => {
    const { scene, save, wm, sx, sy } = ctx;
    const target = findClosestItem('creatures', wm.x, wm.y, REACH_CREATURE_M,
      (c) => !save.caught.includes(c.id));
    if (!target) return false;
    // Player-reach gate (same 16m feet-cell limit as treasure/wildplant/object
    // and the lit reach indicator). The 4m REACH_CREATURE_M above is tap-
    // forgiveness measured from the TAP point, not the player — without this a
    // visible-but-out-of-reach animal could be caught/fed by tapping it. Keeps
    // the reach outline ⇔ tap-accept invariant (QC §7).
    if (tooFar(ctx, target.x, target.y)) return 'far';
    // PESTS / HUNTABLES — slimes, crows and deer are DEFEATED via a work
    // queue rather than caught alive. A weapon (sword / bow / staff) speeds
    // the kill up by tier; bare-handed still works but is a long slog. On
    // completion the creature is removed from the world (marked caught) and
    // drops its product if it has one (crow → feather, deer → meat; slimes
    // drop nothing — they're just an energy pest). The defeat is FREE (no
    // energy spent): your TIME at the work wheel IS the cost, which also means
    // you can still kill the very slime that's draining you when low on energy.
    const DEFEAT_KINDS = new Set(['slime', 'crow', 'deer']);
    if (DEFEAT_KINDS.has(target.kind)) {
      const r = save.relics || {};
      const weaponTier = Math.max(r.sword?.tier || 0, r.bow?.tier || 0, r.staff?.tier || 0);
      // Weapon = tier-N tool: 3 s at tier 1, −750 ms per tier, floored 500 ms
      // (mirrors toolDurationMs). No weapon = tier 0 (bare hands): 9 s, 3× the
      // wooden weapon — slow but always possible.
      const durMs = weaponTier > 0
        ? Math.max(500, 3000 - (weaponTier - 1) * 750)
        : 9000;
      const victim = target;
      const dropId = victim.kind === 'crow' ? 'crow_feather'
                   : victim.kind === 'deer' ? 'meat'
                   : null;
      scene.startWorkProgress(victim.x, victim.y, () => {
        save.caught.push(victim.id);
        save.caughtKinds = save.caughtKinds || {};
        save.caughtKinds[victim.kind] = (save.caughtKinds[victim.kind] || 0) + 1;
        if (dropId) {
          scene.addToInv(dropId, 1);
          const item = ITEM_BY_ID[dropId];
          scene.flashLoot(`+1 ${item?.name || dropId}`, '#ffe066', 1, dropId);
        } else {
          scene.flash('🟢 slime defeated', scene.viewCenterX, scene.viewCenterY - 60);
        }
        persistSave(save);
      }, durMs);
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
    // — farmed crops carry an `item.crop` ref; longgrass too; the bare
    // 'flowers' pickup is a wild plant with no .crop but still plant-origin.
    // Excludes egg / milk (also kind:'produce' but they're animal-source).
    const isPlantProduce = selItem && selItem.kind === 'produce'
      && (!!selItem.crop || sel.id === 'flowers');

    // ── TAME PETS — released animals (id starts with 'released_'). Tame
    // pets never get "yuck'd"; tapping them with any item (or none) plays
    // a brief species-specific happy interaction (cluck / purr / etc.),
    // arms a petting-boost timer that gives the next produce roll a +50%
    // double chance, and — for cats — kicks off a 5-minute follow timer
    // the wander loop honours.
    const isTame = typeof target.id === 'string' && target.id.startsWith('released_');
    if (isTame) {
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
      target._pettedUntilT = performance.now() + 10 * 60 * 1000;
      // Mirror the boost expiry into the save as EPOCH ms (keyed by creature
      // id, like save.lastProduce). Creatures are re-spawned from tile data on
      // every reload and lose their in-memory _pettedUntilT (which is a
      // performance.now value that also resets to ~0 on reload), so the produce
      // path below reads this persisted copy — otherwise the +50% double-yield
      // silently never survived a tile change or restart.
      save.petBoost = save.petBoost || {};
      save.petBoost[target.id] = Date.now() + 10 * 60 * 1000;
      if (target.kind === 'cat') {
        target._followUntilT = performance.now() + 5 * 60 * 1000;
      }
      // Arming the boost is state worth persisting even when the pet was pet
      // empty-handed (no treat consumed).
      ctx.dirty = true;
      if (isTreat) {
        consumeSelected(save);
        scene.buildInventoryDOM();
      }
      scene.flashLoot(`💗 ${sound}`, '#ff8aff', 0.85);
      return true;
    }

    // 1. Favourite food → TAME (befriend in place), NOT catch. Converts the
    // wild animal into a tame 'released_' pet at its spot: it stays in the
    // world, becomes pettable / produces / follows, but does NOT enter your
    // inventory. Capturing-into-inventory is the separate CATCH work queue
    // below. animalLikesFood handles the chicken-eats-any-seed special case.
    const likes = (typeof animalLikesFood === 'function') && sel
      && animalLikesFood(target.kind, sel.id);
    if (sel && likes && (sel.count ?? 0) > 0) {
      consumeSelected(save);
      scene.buildInventoryDOM();
      // Stop the wild one respawning, then re-add it as a tame pet at the same
      // spot so the bond persists across reloads (mirrors the release handler).
      const oldId = target.id;
      if (!save.caught.includes(oldId)) save.caught.push(oldId);
      const tx = Math.floor(target.x / scene.tileEdgeM);
      const ty = Math.floor(target.y / scene.tileEdgeM);
      const tameId = `released_${target.kind}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
      save.released = save.released || [];
      save.released.push({ x: target.x, y: target.y, kind: target.kind, id: tameId, tx, ty });
      target.id = tameId;   // convert the in-world object in place → now tame
      ctx.dirty = true;
      scene.flashLoot(`🐾 tamed ${ITEM_BY_ID[target.kind]?.name || target.kind}`, '#a7ffb0', 1, target.kind);
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
          // Still on cooldown — refuse without consuming the produce.
          const remainMs = PRODUCE_COOLDOWN_MS - (now - lastT);
          const mins = Math.max(1, Math.ceil(remainMs / 60000));
          const verb = target.kind === 'chicken' ? 'laid' : 'milked';
          scene.flash(`already ${verb} (${mins}m)`, sx, sy);
          return true;
        }
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
        // (survives tile reload + game restart).
        target._lastProduceT = now;
        save.lastProduce[target.id] = now;
        ctx.dirty = true;
        return true;
      }
    }
    // 3. Any other food → yuck. Wasted bite.
    if (sel && isEdible && (sel.count ?? 0) > 0) {
      consumeSelected(save);
      scene.buildInventoryDOM();
      scene.flashLoot(`🤢 Spits it out.`, '#ff8a7a', 1, sel.id);
      ctx.dirty = true;
      return true;
    }
    // 4. CATCH via work queue. Reached with an empty hand (or any non-food,
    // non-favourite selection) — favourite food TAMED above, edible food was
    // yuck'd above. The animal FLEES the player at 2 m/s while the wheel runs
    // (startCatchProgress); if it escapes the viewport the catch fails. A Bug
    // Net shortens the wheel by tier; bare hands take the tier-0 (9s) time.
    // Butterflies are the lone exception with no bare-hands tier — they REQUIRE
    // the net.
    if (target.kind === 'butterfly' && !save.relics?.bugnet) {
      scene.flash('It flits away — you need a Bug Net.', sx, sy);
      return true;
    }
    const catchMs = (typeof toolDurationMs === 'function')
      ? toolDurationMs(save.relics, 'bugnet')
      : (save.relics?.bugnet ? 3000 : 9000);
    const victim = target;
    scene.startCatchProgress(victim, catchMs, () => {
      scene.catchCreature(victim, sx, sy);
    }, () => {
      scene.flash('🏃 it got away', scene.viewCenterX, scene.viewCenterY - 60);
    });
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
    const bestF = findClosestItem('objects', wm.x, wm.y, REACH_WILDPLANT_M,
      (o) => o.kind === 'flora' && o.deco === 'flower' && !pickedSet.has(o.id));
    if (bestF) {
      const o = bestF;
      if (tooFar(ctx, o.x, o.y)) return 'far';
      save.picked = [...pickedSet, o.id];
      scene.addToInv('flowers', 1);
      ctx.dirty = true;
      scene.flashLoot(`+1 🌼 flowers`);
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
      // Shrine + house/tower share the wider house-sized reach: their sprites
      // are taller than the default 3.5m hit zone (fountain is ~9m tall in
      // world units), so a tap on the visible top of the sprite would otherwise
      // miss-and-fall-through to the till handler under it.
      const r = (o.kind === 'house' || o.kind === 'tower' || o.kind === 'shrine' || o.kind === 'well') ? REACH_HOUSE_M : REACH_OBJECT_M;
      if (distM2(o.x, o.y, wm.x, wm.y) >= r * r) continue;
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
        // A chest the player previously opened but LEFT FOR LATER (bag was full)
        // remembers exactly what it rolled: reopen serves that same loot, and we
        // skip the relic re-roll below so leaving-and-reopening can't fish for a
        // better drop.
        const held = save.chestHold && save.chestHold[o.id];
        // 10% chance to roll a relic reward instead of normal loot. The picker
        // is biased by the chest's TIER (lowtier → wood, flora → frost) and
        // gated by player harvests/cow catch. If the rolled slot/tier would be
        // an upgrade → equip it. Otherwise → half its gold value as a
        // consolation (player always gets something useful).
        if (!held && Math.random() < 0.10) {
          const chestT = (typeof chestTier === 'function') ? chestTier(o.poiClass) : 2;
          const reward = (typeof pickChestRelic === 'function')
            ? pickChestRelic(undefined, save, save.relics, chestT, save.armor)
            : null;
          if (reward?.kind === 'relic' || reward?.kind === 'armor') {
            const kind = reward.kind;
            if (kind === 'armor') {
              save.armor = save.armor || {};
              save.armor[reward.slot] = { tier: reward.tier };
              // Armor bumps maxEnergy — bring current energy along by the
              // delta so the new ceiling isn't just a future-cap.
              if (typeof maxEnergyFromArmor === 'function' && typeof scene.getMaxEnergy === 'function') {
                const newMax = maxEnergyFromArmor(save.armor);
                const bump = Math.max(0, newMax - scene.getMaxEnergy());
                save.maxEnergy = newMax;
                save.energy = Math.min(newMax, (save.energy ?? 0) + bump);
              }
            } else {
              save.relics[reward.slot] = { tier: reward.tier };
            }
            scene.markRelicsDirty?.();
            save.opened.push(o.id);
            ctx.dirty = true;
            const name = (typeof gearName === 'function')
              ? gearName(kind, reward.slot, reward.tier)
              : `${reward.slot} T${reward.tier}`;
            const iconHTML = scene.gearIconHTML
              ? scene.gearIconHTML(kind, reward.slot, reward.tier, 64)
              : '★';
            scene.showChestRewardModal({
              iconHTML, name, sub: 'equipped', color: '#ffe066',
            });
            return true;
          }
          if (reward?.kind === 'gold') {
            addMoney(save, reward.amount);
            save.opened.push(o.id);
            ctx.dirty = true;
            const gearKind = reward.gearKind || 'relic';
            const name = (typeof gearName === 'function')
              ? gearName(gearKind, reward.slot, reward.tier)
              : `${reward.slot} T${reward.tier}`;
            const iconHTML = scene.gearIconHTML
              ? scene.gearIconHTML(gearKind, reward.slot, reward.tier, 64)
              : '★';
            scene.showChestRewardModal({
              iconHTML, name: `+$${reward.amount}`,
              sub: `${name} (already owned)`, color: '#ffd96b',
            });
            return true;
          }
          // reward is null (no allowed tiers — very early game) — fall through.
        }
        const loot = held ? { id: held.id, n: held.n }
                          : pickLoot(undefined, o.poiClass, save.relics);
        const lootName = (ITEM_BY_ID[loot.id]?.name || loot.id).toString();
        const lootColor = tierInfo(loot.id).color;
        // Chest loot gets the full ceremony modal — quick-feedback flashLoot
        // is reserved for X-marks / harvest / mining (cheap repeating rewards).
        const iconHTML = scene.iconSpanHTML
          ? scene.iconSpanHTML(loot.id, 64) : '';
        const qtyLabel = loot.n > 1 ? `× ${loot.n}` : null;
        // If the loot won't fully fit, don't silently drop the overflow — let the
        // player TAKE what fits (chest emptied, rest lost) or LEAVE it for later
        // (chest kept, its exact contents remembered in save.chestHold). Modal
        // buttons fire after this handler returns, so they persist themselves.
        const room = (typeof scene.invRoomFor === 'function') ? scene.invRoomFor(loot.id) : Infinity;
        if (loot.n > room) {
          scene.showChestRewardModal({
            iconHTML, name: lootName, qty: qtyLabel, color: lootColor,
            sub: room > 0
              ? `Bag full — room for only ${room} of ${loot.n}.`
              : 'Your bag is full.',
            actions: [
              { label: 'Leave for later', primary: true, onClick: () => {
                save.chestHold = save.chestHold || {};
                save.chestHold[o.id] = { id: loot.id, n: loot.n };
                persistSave(save);
                scene.flash?.('Left it in the chest.', sx, sy);
              } },
              { label: room > 0 ? `Take ${room}` : 'Discard', onClick: () => {
                if (room > 0) scene.addToInv(loot.id, loot.n);   // takes `room`; bag-full flash covers the rest
                save.opened.push(o.id);
                if (save.chestHold) delete save.chestHold[o.id];
                persistSave(save);
              } },
            ],
          });
          return true;
        }
        // Fits fully — take it and empty the chest.
        scene.addToInv(loot.id, loot.n);
        save.opened.push(o.id);
        if (save.chestHold) delete save.chestHold[o.id];
        ctx.dirty = true;
        scene.showChestRewardModal({
          iconHTML, name: lootName, qty: qtyLabel, color: lootColor,
        });
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
        // No axe? Bare hands still fell the tree — toolDurationMs returns the
        // tier-0 (9s) time, 3× the wooden axe.
        const durMs = (typeof toolDurationMs === 'function')
          ? toolDurationMs(save.relics, 'axe') : 9000;
        scene.startWorkProgress(o.x, o.y, () => {
          o.chopped = true;
          save.chopped = save.chopped || [];
          if (!save.chopped.includes(o.id)) save.chopped.push(o.id);
          // Trees drop 2-3 wood logs (more generous than the shrub's 1).
          scene.addToInv('wood', randInt(2, 3));
          persistSave(save);
          scene.flash('🌲 Felled.', sx, sy);
        }, durMs);
        return true;
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
        const pickedSet = new Set(save.picked || []);
        if (pickedSet.has(o.id)) {
          scene.flash('Not ripe yet — give it time.', sx, sy);
          return true;
        }
        save.picked = [...pickedSet, o.id];
        scene.addToInv(o.species, randInt(1, 2));
        ctx.dirty = true;
        const item = ITEM_BY_ID[o.species];
        scene.flashLoot(`harvested ${item?.name || o.species}`, '#a7ffb0', 1, o.species);
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
        const pickTier = save.relics?.pick?.tier || 0;
        const isCave = o.caveVariant != null;
        if (pickTier < o.requiredTier) {
          // Flavour: name the player's CURRENT pick (the one that's too
          // weak) rather than telling them what tier they'd need. Player
          // already feels the "this one isn't enough" — naming their tool
          // makes the failure read like an in-world moment instead of a
          // game-system error.
          let msg;
          if (pickTier <= 0) {
            msg = 'Bare hands just bounce off.';
          } else {
            const tName = (typeof TIER_BY_NUM !== 'undefined')
              ? (TIER_BY_NUM[pickTier]?.name || `T${pickTier}`)
              : `T${pickTier}`;
            msg = `${tName} pick just bounces off.`;
          }
          scene.flash(msg, sx, sy);
          return true;
        }
        // Cave rocks are plain — quick (3s) and cheap (10 energy). Ore
        // rocks scale work + cost by their YIELD tier (the richer the
        // rock, the harder it is to crack open).
        const tierForWork = isCave ? 1 : (o.yieldTier || 1);
        const cost = 10 + (tierForWork - 1) * 4;
        if (!scene.spendEnergy(cost, sx, sy)) return true;
        const durMs = (3 + (tierForWork - 1) * 1) * 1000;
        scene.startWorkProgress(o.x, o.y, () => {
          scene.brokenRockSet.add(o.id);
          save.brokenRocks = [...scene.brokenRockSet];
          // Bar lookup is shared between the cave-rock lucky-strike and the
          // ore-rock primary drop. Slot 0 is unused (tier index starts at 1).
          // T1/T2 → copper, T3 → iron, T4-T7 → gold (platinum / crimson /
          // frost bars are blacksmith-smelting only — high-tier rocks just
          // pay out gold + extra gems via the GEM table below).
          const BARS = ['', 'copper_bar', 'copper_bar', 'iron_bar', 'gold_bar', 'gold_bar', 'gold_bar', 'gold_bar'];
          if (isCave) {
            // Plain cave rock — primarily stone (1-3 rockfruit) plus a
            // small chance per tier of cracking open a sliver of ore.
            // Per-tier probability is 1/(2*t²): T1 50 %, T2 12.5 %, T3
            // ~5.6 %, T4 ~3.1 % … T7 ~1 %. Independent rolls so a lucky
            // cave can yield multiple low-tier bars, while T7 lucky
            // strikes stay genuinely rare (~1 in 100).
            const qty = randInt(1, 3);
            scene.addToInv('rockfruit', qty);
            if (Math.random() < 0.15) scene.addToInv('coal', 1);
            let flashId = 'rockfruit';
            for (let t = 1; t <= 7; t++) {
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
          const GEM_BY_TIER = { 4: ['sapphire'], 5: ['ruby'], 6: ['emerald'], 7: ['emerald', 'ruby'] };
          const GEM_P_BY_TIER = { 4: 0.25, 5: 0.35, 6: 0.40, 7: 0.50 };
          const gems = GEM_BY_TIER[t];
          if (gems && Math.random() < (GEM_P_BY_TIER[t] || 0)) {
            const gemId = pickFromArray(gems);
            scene.addToInv(gemId, 1);
            flashId = gemId;
          }
          // T7 rocks have a bonus 25% chance for a second ruby on top.
          if (t === 7 && Math.random() < 0.25) {
            scene.addToInv('ruby', 1);
            flashId = 'ruby';
          }
          persistSave(save);
          const item = ITEM_BY_ID[flashId];
          // Real loot icon via flashLoot (was a text-only 💎 emoji flash that
          // showed a gem glyph instead of the mined bar/gem icon).
          scene.flashLoot(`+1 ${item?.name || flashId}`, '#a7ffb0', 1, flashId);
        }, durMs, cost);   // cost = refund if the player cancels mid-mine
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
    // Chickens are flock animals — one "release" drops a clutch of 4 hens, so
    // you need at least 4 in the stack to place any. Cows (and any future
    // non-flock animal) still release one at a time.
    const flockSize = item.id === 'chicken' ? 4 : 1;
    if ((sel.count ?? 0) < flockSize) {
      scene.flash(`Need ${flockSize} ${item.id}s for a flock.`, sx, sy);
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

  // 2-rock) Tap a natural rock cell → break it. Requires a pickaxe relic;
  // costs energy (mitigated by pick tier).
  { name: 'rock', try: (ctx) => {
    const { scene, save, sx, sy, cell, cellKey, cwmx, cwmy } = ctx;
    if (cell.type !== TERRAIN.ROCK) return false;
    if (scene.brokenRockSet.has(cellKey)) {
      scene.flash('Rubble — nothing salvageable.', sx, sy);
      return true;
    }
    // No pickaxe? Bare-handed mining still works — it just takes ~3× longer.
    // Bare hands: 9s · Wood: 3s · Copper: 2.25s · Iron: 1.5s · floor 0.5s.
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
      else if (r < 0.040)   { addMoney(save, 25); msg = '💥 → $25'; }
      else if (r < 0.060)   { scene.addToInv('gemfruit_seed', 1);     msg = '💥 → gemfruit seed'; }
      else if (r < 0.130)   { addMoney(save,  5); msg = '💥 → $5'; }
      else if (r < 0.430)   { scene.addToInv('coal', randInt(1, 2)); msg = '💥 → coal'; }
      else if (r < 0.700)   { scene.addToInv('rockfruit_seed', 1);    msg = '💥 → rock seed'; }
      persistSave(save);
      scene.flash(msg, sx, sy);
    }, durMs, cost);   // cost = refund if the player cancels mid-break
    return true;
  }},

  // 2a) Tap a planted cell → harvest / advance / water / nag.
  { name: 'planted', try: (ctx) => {
    const { scene, save, sx, sy, cellKey, cwmx, cwmy } = ctx;
    const plantedIdx = save.planted.findIndex(p =>
      Math.abs(p.x - cwmx) < 0.1 && Math.abs(p.y - cwmy) < 0.1);
    if (plantedIdx < 0) return false;
    const p = save.planted[plantedIdx];
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
      // Track harvest milestones — gates which relic tiers can drop from chests
      // (sunflower→Gold, fireflower→Crimson, iceflower→Frost). See loot.js
      // pickChestRelic / chestRelicAllowedTiers.
      save.harvested = save.harvested || {};
      save.harvested[p.crop] = (save.harvested[p.crop] || 0) + 1;
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
    // tier-0 cast time from toolDurationMs). A rod speeds the cast by tier;
    // loot stays the tier-1 table bare-handed and improves with the rod.
    if (!scene.spendEnergy(5, sx, sy)) return true;
    // A rod owner can't reach 'can-refill' (the rod owns water taps), so top
    // the can up here as part of the cast so owning a rod never costs you your
    // watering charges. Bare-handed casts without a can simply skip this.
    if (save.relics?.can) { save.canCharges = 50; ctx.dirty = true; }
    const castMs = (typeof toolDurationMs === 'function')
      ? toolDurationMs(save.relics, 'rod') : (save.relics?.rod ? 3000 : 9000);
    scene.startWorkProgress(ctx.cwmx, ctx.cwmy, () => {
      const tier = save.relics?.rod?.tier || 1;
      // Per user: most of the wait results in nothing on a low-tier rod,
      // and that "skunk" rate falls as the rod climbs. Linear ramp:
      //   T1 → 50%  (the user's "half the time")
      //   T7 → 20%
      // Formula: max(0.20, 0.55 - tier * 0.05). T7 floors at 0.20.
      const skunkChance = Math.max(0.20, 0.55 - tier * 0.05);
      if (Math.random() < skunkChance) {
        scene.flashLoot('🎣 nothing biting…', '#888', 0.9);
        return;
      }
      // 2% per cast → relic jackpot. Pick a random slot, random tier in
      // 1..rod_tier. Equips it if it's better than the current slot;
      // otherwise the relic is kept as a salvage event (recorded on
      // save.relicsCaught) and the flash explains the outcome. Returns
      // before the regular fish loot table so no double drop.
      if (Math.random() < 0.02) {
        const slots = (typeof RELIC_DEFS !== 'undefined') ? Object.keys(RELIC_DEFS) : [];
        if (slots.length) {
          const slot = pickFromArray(slots);
          const relicTier = randInt(1, tier);
          save.relicsCaught = save.relicsCaught || [];
          save.relicsCaught.push({ slot, tier: relicTier, t: Date.now() });
          const cur = save.relics?.[slot];
          let equipped = false;
          if (!cur || (cur.tier ?? 0) < relicTier) {
            save.relics = save.relics || {};
            save.relics[slot] = { tier: relicTier };
            equipped = true;
          }
          persistSave(save);
          const label = (typeof gearName === 'function')
            ? gearName('relic', slot, relicTier)
            : `${slot} T${relicTier}`;
          scene.flashLoot(equipped
            ? `✨ ${label} (equipped!)`
            : `✨ ${label} (already better)`,
            '#ffd96b', 1.6);
          return;
        }
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
    }, castMs, 5);   // castMs = rod-tier cast time (bare hands 9s); 5 = cancel refund
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
    if (!item || item.kind !== 'seed') {
      scene.tilledSet.delete(cellKey);
      save.tilled = [...scene.tilledSet];
      ctx.dirty = true;
      scene.flash('Soil loosened.', sx, sy);
      return true;
    }
    if ((sel.count ?? 0) <= 0) {
      scene.flash('That seed pouch is empty.', sx, sy);
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
