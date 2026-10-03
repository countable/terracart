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
//                  catchCreature, screenToWorldMeters, cellAt, buildInventoryDOM);
//                  module-level helpers (distM2, isTillable, isTillableCell)
//   coords.js    — worldMetersToAbsCell, absCellCenterMeters, sameAbsCell,
//                  cellInReach (tap targeting is cell-bounded, see below)
//   worldgen.js  — WorldGen.tileCache, WorldGen.Z
//   items.js     — ITEM_BY_ID, SEED_TIER, MAX_GROWTH_STAGE
//   loot.js      — POI_CATEGORY, chestTier, rusticifyName
//   rarity.js    — pickReward
//   save.js      — persistSave
//
// Exports as globals:
//   TAP_HANDLERS   — priority-ordered array of { name, try(ctx) }
//   interactTap(scene, sx, sy)  — top-level dispatcher; MapScene.handleWorldTap forwards to this

// Successful kit work shares the same retain roll for traps and obstacles.
function finishTrapKit(ctx, action) {
  const { scene, save, sx, sy } = ctx;
  const kept = Math.random() < TRAP_KIT_KEEP_CHANCE;
  if (!kept) consumeSelected(save);
  ctx.dirty = true;
  scene.buildInventoryDOM();
  scene.flash(`${action}; kit ${kept ? 'kept' : 'used'}`, sx, sy);
}

// Decrement the selected inventory stack by `n` (default 1). If it hits zero,
// splice it out and leave the hand EMPTY (selSlot = -1) — the stack that
// slides into its index is not something the player chose. Used by every
// handler that consumes a held item (plant, release-animal, place-rock).
// Caller is responsible for setting ctx.dirty and calling buildInventoryDOM.
function consumeSelected(save, n = 1) {
  const sel = save.inv[save.selSlot];
  if (!sel) return;
  sel.count -= n;
  if (sel.count > 0) return;
  save.inv.splice(save.selSlot, 1);
  if (sel.id === 'egg' && Inventory.count(save, 'egg') === 0) save.eggHatchM = 0;
  save.selSlot = -1;
}

// Count only a favourite meal actually consumed, on both the live pet and its
// saved release row. (A tame pet leaves the world only by pickUpPet below.)
function consumePetFood(save, pet, foodId) {
  const sel = getSelectedSlot(save);
  if (!sel || sel.id !== foodId || !(sel.count > 0)) return false;
  consumeSelected(save);
  if (pet.raised && animalLikesFood(pet.kind, foodId)) {
    const row = save.released?.find(r => r.id === pet.id);
    const feeds = Math.min(SpriteLayout.PET_BABY.feeds, (row?.favouriteFeeds ?? pet.favouriteFeeds ?? 0) + 1);
    pet.favouriteFeeds = feeds;
    if (row) row.favouriteFeeds = feeds;
  }
  return true;
}

// Unique id for an animal/slime released (or tamed) at a spot. `extra`
// disambiguates a batch released in the same tick (the per-item index).
function releasedId(kind, extra) {
  const tail = extra === undefined ? '' : `_${extra}`;
  return `released_${kind}_${Date.now()}_${Math.floor(Math.random() * 1e6)}${tail}`;
}

// Befriend a wild creature IN PLACE: consume the treat, mark the wild one caught
// so it stops respawning, then re-add it as a tame 'released_' pet at the same
// spot (so the bond survives reloads / tile re-rasterise) and convert the
// in-world object's id to the tame id. Shared by the mango (universal) and
// favourite-food taming paths — they differ only in the flash icon/scale.
function tameInPlace(scene, save, target, flashMsg, flashIcon, flashScale) {
  consumeSelected(save);
  scene.buildInventoryDOM();
  if (!save.caught.includes(target.id)) save.caught.push(target.id);
  const tx = Math.floor(target.x / scene.tileEdgeM);
  const ty = Math.floor(target.y / scene.tileEdgeM);
  const tameId = releasedId(target.kind);
  save.released = save.released || [];
  const policy = Companions.releasePolicy(scene, target.x, target.y);
  save.released.push({ x: target.x, y: target.y, kind: target.kind, id: tameId, tx, ty, shiny: !!target.shiny, ...policy });
  Object.assign(target, policy);
  // A tame animal no longer belongs to its old hostile spawn or garrison.
  for (const key of ['_surfaceSpawn', '_surfaceInactive', '_surfaceAskedT', 'lair', 'immobile',
    'lairX', 'lairY', 'lairR', 'seatX', 'seatY', 'aggroCells', 'proximityCells',
    '_wardFrom', '_hunting', '_chaseTarget', '_wanderOffUntilT']) delete target[key];
  target.id = tameId;   // convert the in-world creature in place → now tame
  scene.flashLoot(flashMsg, '#a7ffb0', flashScale, flashIcon);
  persistSave(save);
}

// PICK UP a tame pet (a 'released_' id) — the owner's own animal goes
// straight into the bag: no wheel, no flee, no energy, and never the shiny
// windfall (awardShinyBonus pays cash every time, so a re-pocketed shiny pet
// must not farm it). Returns false when the kind has no bag item (a sapphire-
// tamed slime) so the tap falls through to petting; true once handled, even
// when the bag was full (the pet stays where it is).
//   The bag's stacks are fungible, so a RAISED pet (nest bush / hatched egg:
// `raised`, `born`, `favouriteFeeds`) would lose its growth in a plain stack.
// Its save.released row therefore STAYS while it is carried, with its id in
// save.caught — the one flag the spawner and the wander loop already read for
// "not in the world" — and `release` below hands that row back to the first
// baby_/shiny_ of the kind set down (carriedRaisedRow). A plain pet's row is
// dropped as catchCreature drops it. The item a raised pet pockets as is its
// state NOW: still a baby → baby_<kind>, grown → shiny_<kind> (a raised pet is
// always shiny). Its clock keeps running in the bag, which changes nothing a
// player can see: adulthood also needs its seven meals (isBabyPet).
function petPickupItemId(c) {
  if (c.raised) return SpriteLayout.isBabyPet(c) ? babyItemId(c.kind) : `shiny_${c.kind}`;
  if (c.shiny && ITEM_BY_ID[`shiny_${c.kind}`]) return `shiny_${c.kind}`;
  return c.kind;
}
function pickUpPet(scene, save, target, sx, sy) {
  if (SpriteLayout.isSummoned(target.kind)) return false;
  const invId = petPickupItemId(target);
  const item = ITEM_BY_ID[invId];
  if (!item || item.kind !== 'animal') return false;
  if (Inventory.roomFor(save, invId) < 1) {
    scene.flash('Make room for a pet first.', sx, sy);
    return true;
  }
  save.caught = save.caught || [];
  if (!save.caught.includes(target.id)) save.caught.push(target.id);
  save.released = save.released || [];
  const ri = save.released.findIndex(r => r.id === target.id);
  const raised = !!(target.raised || (ri >= 0 && save.released[ri].raised));
  if (ri >= 0 && raised) {
    save.released[ri].hp = Combat.hp(target);
    save.released[ri].lastDamagedAt = target._lastDamagedT ?? null;
  }
  if (ri >= 0 && !raised) save.released.splice(ri, 1);
  const tracked = scene._travellingPets?.get(target.id);
  const entries = new Set([...WorldGen.tileCache.values(), tracked?.entry]);
  for (const entry of entries) {
    if (!entry?.creatures) continue;
    for (let i = entry.creatures.length - 1; i >= 0; i--) {
      if (entry.creatures[i].id === target.id) entry.creatures.splice(i, 1);
    }
  }
  scene._travellingPets?.delete(target.id);
  scene.addToInv(invId, 1);
  scene.flashLoot(`+1 ${item.name || invId}`, raised || item.shiny ? '#ffd23a' : '#a7ffb0', 1, invId);
  persistSave(save);
  return true;
}
// The carried raised row a set-down baby_/shiny_ of `kind` brings back, or
// null for a fresh birth / a plain shiny. A row still a baby answers a baby
// item and a grown row a shiny one; a baby item with only grown rows left
// takes one of those (it grew up in the bag), a shiny item never takes a
// baby's row. Stacks are indistinguishable, so whichever release gets which
// row, the pets that come back are the pets that were picked up.
function carriedRaisedRow(save, kind, wantBaby) {
  const caught = save.caught || [];
  const rows = (save.released || []).filter(r => r && r.raised && r.kind === kind && caught.includes(r.id));
  if (!rows.length) return null;
  const exact = rows.find(r => SpriteLayout.isBabyPet(r) === !!wantBaby);
  if (exact) return exact;
  return wantBaby ? rows[0] : null;
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

// ─── Cell-bounded tap targeting ──────────────────────────────────────────────
// Everything in the world except FAUNA owns exactly one cell (CLAUDE.md's
// "one cell" sprite rule), so its tap target IS that cell: a tap inside the
// cell hits it, a tap outside never does.
//
// This replaces the old tap-PRECISION disks (REACH_OBJECT_M 3.5 m, house 6 m,
// wild plant 4 m, treasure 7.5 m, …). A disk big enough to cover its own cell
// must be at least the half-diagonal (5 m cell → 3.54 m), and such a disk
// necessarily spills ~1 m into all four neighbours — which is how a tap on the
// empty cell ABOVE a tall tree / turret / market stall still activated it.
// Cell membership can't spill, needs no per-kind tuning, and stays correct if
// CELL_M is ever retuned.
//
// Creatures keep their own hit test (a box matching the DRAWN sprite, see the
// 'creature' handler): they move continuously and are drawn feet-anchored, so
// they don't belong to a cell the way a planted object does. Multi-cell
// buildings are reached through the 'building-zone' handler, which is itself
// cell-based — it accepts any BUILDING-terrain cell of the footprint.

// Closest item of `layer` whose own cell is the cell the tap landed in, or
// null. "Closest" only breaks ties between items sharing one cell.
// A shipwreck's reserved cells all lead to its single daily shrine interaction.
// Ordinary tall sprites still own only their foot cell.
function itemContainsTapCell(scene, item, tapCell) {
  const own = worldMetersToAbsCell(scene, item.x, item.y);
  if (item.kind === 'grove_shrine' && item._shrineArt === 'shipwreck' && item._shrineExtentCells > 1) {
    const radius = (item._shrineExtentCells - 1) / 2;
    const d = absCellDelta(scene, own.cellIX, own.cellIY, tapCell.cellIX, tapCell.cellIY);
    return Math.abs(d.dx) <= radius && Math.abs(d.dy) <= radius;
  }
  return own.cellIX === tapCell.cellIX && own.cellIY === tapCell.cellIY;
}

function findItemInTapCell(scene, layer, wm, accept) {
  const tapCell = worldMetersToAbsCell(scene, wm.x, wm.y);
  let best = null, bestD2 = Infinity;
  WorldGen.forEachItem(layer, (item) => {
    if (accept && !accept(item)) return;
    if (!itemContainsTapCell(scene, item, tapCell)) return;
    const d2 = distM2(item.x, item.y, wm.x, wm.y);
    if (d2 < bestD2) { bestD2 = d2; best = item; }
  });
  return best;
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
// A Euclidean distance to the cell centre disagreed with the lit cells for
// objects whose world point sits off-centre (a house FOOT, up to ~0.7·cellM),
// so reach is cell-based only. THERE IS ONE REACH GATE: two gates that
// disagree is the bug this avoids.
function tooFar(ctx, x, y) {
  const { scene } = ctx;
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
  scene.hapticReject?.();
  return true;
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
  COMMERCIAL: WorldGen.T.COMMERCIAL,         // 16
  INDUSTRIAL: WorldGen.T.INDUSTRIAL,         // 17
  PIER: WorldGen.T.PIER,                     // 23
  CAVE_FLOOR: WorldGen.T.CAVE_FLOOR,         // 24
  CAVE_WALL: WorldGen.T.CAVE_WALL,           // 25
  CAVE_LAVA: WorldGen.T.CAVE_LAVA,           // 26
  TAR_YARD: WorldGen.T.TAR_YARD,             // 31
};

// Flavor label per NON-TILLABLE terrain code (the 'flavor' handler below).
// Every code in app.js' NON_TILLABLE set needs an entry here: a missing one
// used to fall through to a bare '·', which is what a tap on a COMMERCIAL /
// INDUSTRIAL / ROCK / PIER / cave cell showed — a lone dot with no idea what
// you'd tapped. The '·' is now only a defensive last resort for a terrain
// code that is neither tillable nor listed here.
// The label the `flavor` handler flashes when a tap lands on ground that
// CANNOT BE TILLED. Two jobs in one line, and it used to do neither:
//
//   1. It is the game's only description of the ground itself. Every proper
//      noun on the map goes through rusticifyName — a school is a Hedge
//      School, a restaurant a Tavern, a library a Scriptorium — and then the
//      earth under it read 'industrial yard', 'plaza', 'highway'. The one
//      handler NAMED for flavour was the one surface written in municipal
//      English.
//   2. It is the answer to "why did nothing happen?". `flavor` is ordered
//      ahead of `till` precisely so an untillable cell is claimed before the
//      hoe can reach it, so this flash IS the refusal — and a bare noun
//      ('road') never said it was a refusal at all. Each line now carries the
//      REASON, and the reason is the mechanic: paved and built ground has no
//      earth in it, and stone has to be broken before it is anything else.
//
// Kept to one short sentence: this is a flash over a cell, not a paragraph.
// The three paved codes deliberately repeat the same clause — that repetition
// is how a player learns the rule covers every paved thing, not just the one
// they happened to tap.
// (WATER is carried for completeness only: `fishing` is ordered ahead of
// `flavor` and consumes every water tap, bare-handed included, so that line
// is unreachable in play — it exists because the non-tillable sweep in
// interact_tap.test.js covers every code and a hole would read as a bug.)
const TERRAIN_FLAVOR = {
  [TERRAIN.WATER]:          'Open water. Nothing to till.',
  [TERRAIN.ROAD]:           'Hard road. No earth to turn.',
  [TERRAIN.PATH]:           'A path. No earth to turn.',
  [TERRAIN.BUILDING]:       'Someone else\'s floor.',
  [TERRAIN.ROCK]:           'Bare rock. Nothing roots here.',
  [TERRAIN.BUILDING_MED]:   'Someone else\'s floor.',
  [TERRAIN.BUILDING_LARGE]: 'A great hall\'s floor.',
  [TERRAIN.ROAD_LG]:        'A highway. No earth to turn.',
  [TERRAIN.ROAD_MD]:        'A broad avenue, well laid.',
  [TERRAIN.COMMERCIAL]:     'Flagstoned merchants\' square.',
  [TERRAIN.INDUSTRIAL]:     'A works yard. Gravel and oil.',
  [TERRAIN.PIER]:           'Planking over deep water.',
  [TERRAIN.CAVE_FLOOR]:     'Cave floor, worn smooth.',
  [TERRAIN.CAVE_WALL]:      'Solid rock. A pick opens it.',
  [TERRAIN.CAVE_LAVA]:      'Lava. It burns to stand in.',
  [TERRAIN.TAR_YARD]:       'Oily ground. Nothing roots.',
};

// ── Naming things the player can see ────────────────────────────────────────
// Two helpers behind the till refusal and the plant flash, both here for the
// same reason: a raw INTERNAL ID must never reach the screen (QC_RULES §4).
// cropName resolves a crop/produce id the way every loot toast already does:
// the catalog name first, CROP_NAMES second, and only then a Title-Cased
// version of the id, so an id that slips through still reads as English.
function cropName(id) {
  if (!id) return 'Something';
  const named = (typeof ITEM_BY_ID !== 'undefined' && ITEM_BY_ID[id]?.name)
    || (typeof CROP_NAMES !== 'undefined' && CROP_NAMES[id]);
  if (named) return named;
  return String(id).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// What stands in the way of a till, said in the player's words — and, where
// there IS one, the verb that clears it. That second half is the point: the
// old line named the obstacle and stopped, so a player who had just spent
// energy walking to a plot was told "occupied: tree" and left to guess whether
// that was permanent. A tree can be felled and a rock broken; a house cannot,
// and the line says so by offering no verb at all.
const TILL_BLOCKER_LINE = {
  tree:        'A tree — fell it first.',
  fruittree:   'A fruit tree — fell it.',
  mineralrock: 'A rock — break it first.',
  staircase:   'A stairway drops away here.',
  house:       'A building stands here.',
  tower:       'A watchtower stands here.',
  infoboard:   'A notice board stands here.',
  bottle:      'A bottle lies in the sand.',
  gatepost:    'A gate post stands here.',
  // No shrine / trailer rows: no world object has either kind — Home is a
  // `house` (its role is the trailer) and the wizard's tower draws on the
  // shrine art as a house too — so both land on the `house` line above.
};
function tillBlockerLine(o) {
  // NOT the chest's name: a POI name is arbitrary OSM text ('Saint Someone
  // Memorial Library and Reading Room'), and a line with a thirty-character
  // budget cannot interpolate something unbounded. The kind says enough.
  if (o.kind === 'chest') {
    if (typeof isBarrel === 'function' && isBarrel(o)) return `A ${chestLook(o).barrelName} stands here.`;
    if (typeof isBikeRack === 'function' && isBikeRack(o)) return 'A courier\'s post stands here.';
    return 'A chest — open it first.';
  }
  return TILL_BLOCKER_LINE[o.kind] || `${cropName(o.kind)} is in the way.`;
}

// GRASSLAND-biome cell types (spec §WORLD GENERATION grouping). These till in
// HALF the time (spec §cells: "grassland biome cells till in half the time").
const GRASSLAND_TILL = new Set([
  WorldGen.T.GRASS, WorldGen.T.PARK, WorldGen.T.SCHOOL, WorldGen.T.PLAYGROUND,
  WorldGen.T.PITCH, WorldGen.T.GOLF, WorldGen.T.FARMLAND,
]);

// Covered X marks become visible and tappable together after their rock is mined.
function treasureExposed(treasure, scene, save = scene?.save) {
  return !!treasure && (!treasure.coverRockId
    || (scene?.brokenRockSet || setOf(save?.brokenRocks)).has(treasure.coverRockId));
}

// Grant ONE buried-treasure roll: the pickReward('treasure:default') payout
// with every branch it can take — an item (low-tier seeds bundled up, jackpot
// fanfare on a big hit), a gold sum, or the fallback dollar if the pool comes
// back empty — plus the consolation coins the picker couldn't fold into the
// item's quantity.
//
// Factored out of the X-mark handler so a monster's rare drop pays the SAME
// table: two copies of this would be two loot pools to retune, and the whole
// point of the drop is that it feels like finding an X.
//   mark       — the glyph the loot flash leads with ('✕' dug up, '💀' off a kill)
//   contextKey — the LOOT_CONTEXTS pool ('treasure:default' unless the caller
//                says otherwise; an elite kill rolls 'treasure:elite')
//   opts       — passed through to pickReward (rollBonus buys tier)
// A context that can roll RELICS (the elite's) comes back as a gear upgrade
// or its cash-out, so those two shapes are handled here too, the way a chest
// handles them: an upgrade auto-equips, a dupe pays half its price.
// Sets no dirty flag and does not persist; the caller owns that.
// What a coin on the ground is worth: its `amount` (a kill's bounty coin,
// app.js _dropBountyCoin), else 1 — every burst / cave coin is a single.
function coinAmount(coin) {
  const n = Math.floor(coin?.amount);
  return n >= 1 ? n : 1;
}

// FOUND TREASURE (items.js FOUND_TREASURE_CONTEXT, a random chest tier): an
// ordinary treasure roll, announced with the jackpot fanfare and its confetti
// — a find nobody marked on the map is the moment it is.
function grantFoundTreasure(scene, save, sx, sy, mark, tier, headline) {
  grantTreasureRoll(scene, save, sx, sy, mark, FOUND_TREASURE_CONTEXT, { tier });
  scene.flashJackpot?.(1, headline);
}

// `opts.ceremony` ({ kind, header, sub, art, onDismiss }) shows the paid
// reward as a card (scene.showRewardCard) instead of the toast lines below —
// a reward the player earned (an elite's drop) rather than a find on the
// ground. The rest of `opts` is the roll's own (rollBonus, tier, classes).
function grantTreasureRoll(scene, save, sx, sy, mark, contextKey = 'treasure:default', opts) {
  const { ceremony, ...rollOpts } = opts || {};
  const reward = pickReward(contextKey, save, undefined, opts ? rollOpts : undefined);
  if (!reward) {
    // Shouldn't happen — context exists — but bail safely if the pool is empty.
    addMoney(save, 1);
    scene.flashLoot(`${mark} → 1`, '#ffe066', 1, null, scene.coinIconEl?.());
    return;
  }
  if (reward.kind === 'item' && isLowTierSeed(reward.id)) reward.qty += LOW_TIER_SEED_QTY_BONUS;
  Rewards.apply(save, reward, scene);
  // A beaten relic roll cashed out (reconcileRelicOffer) says so on its card.
  const shown = ceremony && typeof scene.showRewardCard === 'function'
    && scene.showRewardCard(reward, reward.kind === 'gold' && reward.slot
      ? { ...ceremony, sub: 'Already better — paid in coin instead.' } : ceremony);
  if (shown) {
    if (reward.jackpot >= 1 && typeof scene.flashJackpot === 'function') scene.flashJackpot(reward.jackpot);
  } else if (reward.kind === 'relic' || reward.kind === 'armor') {
    const label = (typeof gearName === 'function')
      ? gearName(reward.kind, reward.slot, reward.tier) : reward.slot;
    scene.flashLoot(`${mark} → ✨ ${label} (equipped!)`, '#ffe066', 1.6);
    if (reward.jackpot >= 1 && typeof scene.flashJackpot === 'function') {
      scene.flashJackpot(reward.jackpot);
    }
  } else if (reward.kind === 'gold' && reward.slot) {
    // A relic roll the player already beats — cashed out by reconcileRelicOffer.
    const label = (typeof gearName === 'function')
      ? gearName(reward.gearKind || 'relic', reward.slot, reward.tier) : reward.slot;
    scene.flashLoot(`${mark} Already better — ${reward.amount}`, '#aaa', 1.2, null, scene.coinIconEl?.());
  } else if (reward.kind === 'item') {
    const item = ITEM_BY_ID[reward.id];
    const ti = tierInfo(reward.id);
    const color = ti?.color || '#ffe066';
    const label = `${item?.name || reward.id}${reward.qty > 1 ? ` ×${reward.qty}` : ''}`;
    scene.flashLoot(label, color, 1, reward.id);
    if (reward.jackpot >= 1 && typeof scene.flashJackpot === 'function') {
      scene.flashJackpot(reward.jackpot);
    }
  } else if (reward.kind === 'gold') {
    scene.flashLoot(`${mark} → ${reward.amount}`, '#ffe066', 1, null, scene.coinIconEl?.());
  }
  // Consolation coins for any qty bumps the picker couldn't apply
  // (bracket at cap or single-stack class). Small gold trickle alongside
  // the main loot — never replaces it.
  if (reward.consolation > 0) {
    scene.flash(`+${reward.consolation}`, sx, sy + 16);
  }
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
        isTillableCell(cell) && !scene.tilledSet.has(cellKey) &&
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

// Catch wheel speed-up over the shared tool ladder (toolDurationMs) — 25%
// quicker to land chicken/cow/cat/dog/rabbit/butterfly than the bare net
// tier would otherwise take. Scoped to the catch wheel only: hunting
// (crow/deer) and every other toolDurationMs user (mining, tilling, combat)
// are unaffected.
const CATCH_SPEED_MUL = 0.75;

// Is this tapped cell one of the starter pond's four? save.starterPondAt is
// the pond's top-left cell centre; the pond is 2x2 on its own tile's grid.
function inStarterPond(scene, cell) {
  const at = scene.save?.starterPondAt;
  if (!at || (scene.depth || 0) !== 0) return false;
  const tl = worldMetersToTileCell(scene, at.x, at.y);
  if (tl.tx !== cell.tx || tl.ty !== cell.ty) return false;
  const dx = cell.ix - tl.ix, dy = cell.iy - tl.iy;
  return dx >= 0 && dx <= 1 && dy >= 0 && dy <= 1;
}

const TAP_HANDLERS = [
  // -1) Work-progress guard — any tap while a chop/break is in progress cancels it.
  // Ignore taps in the first 150ms after start so the same tap that LAUNCHED
  // the progress wheel can't be re-dispatched a frame later and immediately
  // cancel it (a real risk on double-tap or held-pointer interactions).
  { name: 'work-progress', try: (ctx) => {
    const wp = ctx.scene._workProgress;
    if (!wp) return false;
    // An AUTO-engaged sword fight (combat.js / app.js _combatTick) is not an
    // action the player started, so it must not eat their taps: fall through
    // and let the tap do whatever it was going to do. Without this, walking
    // past a slime would swallow every tap until the slime was dead.
    if (wp.auto) return false;
    if (performance.now() - (wp.startT || 0) < 150) return true;   // swallow, don't cancel
    ctx.scene.abortWorkProgress();   // refund any up-front energy — bailing costs nothing
    return true;
  }},

  // (Eat-by-tapping-the-player and the honey/book/potion/sapphire tap-on-feet
  // gestures removed — the persistent Eat and consumable Use buttons below the
  // inventory bar (syncEatButton / syncConsumableButton in app.js) cover those
  // affordances now, and the tap-on-feet variants were easy to trigger
  // accidentally while trying to till / plant under the player's own cell.)

  // 0) Treasure mark — tap the cell the X is drawn on to dig it up. The X is a
  // ~10 px mark sitting well inside one cell, so its own cell is the target
  // (it used to be a 7.5 m disk — a cell and a half of slop in every
  // direction, which dug up treasure from cells away from the mark).
  { name: 'treasure', try: (ctx) => {
    const { scene, save, wm, sx, sy } = ctx;
    const found = new Set(save.foundTreasures || []);
    const tryClaim = (tr) => {
      if (!treasureExposed(tr, scene, save) || found.has(tr.id)) return false;
      if (!sameAbsCell(scene, wm.x, wm.y, tr.x, tr.y)) return false;
      if (tooFar(ctx, tr.x, tr.y)) return 'far';
      save.foundTreasures = [...found, tr.id];
      // ONE find, paid on the spot — no pick (the road ladder's pick is the
      // only "several finds, keep one"). Underground the roll takes the cave
      // skew (app.js digTreasureOpts).
      // A mark that carries its own rollBonus (a hedgerow close's hoard —
      // StreetVariants.dress) pays that many extra roll steps on top.
      const dig = scene.digTreasureOpts?.();
      grantTreasureRoll(scene, save, sx, sy, '✕', 'treasure:default',
        tr.rollBonus > 0 ? { ...(dig || {}), rollBonus: tr.rollBonus } : dig);
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

  // 0b) A coin. INSTANT BEATS WORKABLE (owner, Sep 2026): a tap that can
  // be paid on the spot wins over one that would start a work wheel on the
  // same cell — a coin lying on a rock, a tuft or beside an animal is picked
  // up, not mined, pulled or caught. So the coin sits above the creature and
  // wild-plant handlers, next to the X mark (also instant).
  { name: 'coindrop', try: (ctx) => {
    const { scene, save, wm, sx, sy } = ctx;
    let bestEntry = null, bestIdx = -1, bestD2 = Infinity;
    // Scan the 3×3 tile neighbourhood around the player (same set the
    // renderer walks) — coins only live in loaded tiles.
    const pc = scene.playerToWorldCell();
    for (let dty = -1; dty <= 1; dty++) {
      for (let dtx = -1; dtx <= 1; dtx++) {
        const entry = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx + dtx, pc.ty + dty));
        if (!entry || !entry.coinDrops) continue;
        const now = Date.now();
        for (let i = 0; i < entry.coinDrops.length; i++) {
          const c = entry.coinDrops[i];
          if (c.expiresAt && c.expiresAt <= now) continue;
          if (!sameAbsCell(scene, wm.x, wm.y, c.x, c.y)) continue;
          // Distance only picks a winner among coins sharing the tapped cell.
          const d2 = distM2(c.x, c.y, wm.x, wm.y);
          if (d2 < bestD2) { bestD2 = d2; bestEntry = entry; bestIdx = i; }
        }
      }
    }
    if (!bestEntry) return false;
    // Player-reach gate — the cell test above is tap PRECISION (did you hit
    // the coin?); without this a coin in a neighbour tile but outside the lit
    // reach indicator could be grabbed (QC §7).
    const coin = bestEntry.coinDrops[bestIdx];
    if (tooFar(ctx, coin.x, coin.y)) return 'far';
    bestEntry.coinDrops.splice(bestIdx, 1);
    // A cave coin is GENERATED where it lies (worldgen.js caveCoins), so the
    // pickup is the delta: the id goes in the X marks' found list, and the
    // next build of the level leaves it out.
    if (coin.seeded) save.foundTreasures = [...(save.foundTreasures || []), coin.id];
    // A coin is worth its `amount` — a kill's bounty coin (app.js
    // _dropBountyCoin) carries the whole wage; every other coin is a single.
    const amount = coinAmount(coin);
    addMoney(save, amount);
    // The "+N" lands ON the cell the coin was picked from, like every other
    // number on the map (app.js _popCellNumber) — not at the finger, which
    // is over the coin only until it lifts. A stub scene has no cell pops.
    // The real number, always: it is the amount just banked.
    if (typeof scene._popCellNumber === 'function') {
      const cc = worldMetersToAbsCell(scene, coin.x, coin.y);
      scene._popCellNumber(`+${amount}`, UI_GOLD, cc.cellIX, cc.cellIY);
    } else {
      scene.flash(`+${amount}`, sx, sy);
    }
    ctx.dirty = true;   // money changed — persist
    return true;
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
    // Every creature is drawn FEET-ANCHORED (setOrigin(0.5, 0.9) in render.js),
    // so its visible BODY sits well ABOVE the logical ground point (c.x, c.y) —
    // a cow's body tops out ~0.75 cell north of its feet, a chicken's ~0.6. A
    // tap disk centred on the foot therefore misses the body the player is
    // actually pointing at and the tap falls through to the cell handler, which
    // tills the tile UNDER the animal — the reported "tapping an animal/slime
    // hits the tile below it" bug.
    //
    // Fix: accept a tap anywhere inside the sprite's DRAWN box instead of a
    // foot disk. Vertically the box is the kind's VISIBLE art —
    // SpriteLayout.creatureTapSpanPx, read off CREATURE_ART (scale, foot,
    // float, trimmed minY/maxY, the hop peak; a giant through creatureArt),
    // the one row the renderer draws from — so the tappable area is the body
    // on screen for tall sprites (cow/deer), floated ones (crow/butterfly) and
    // hopping ones (slimes, goblins). It was a second hand table here that had
    // drifted from the art; one table both sides read. Horizontally it's a
    // per-kind half-width (HALF_W): tap FORGIVENESS, not art — the row carries
    // no horizontal trim — scaled with a giant like the drawn body.
    // Metres per screen pixel: one cell is scene.cellM metres and
    // scene.cellPx (app.js CELL_PX) pixels.
    const px2m = scene.cellM / scene.cellPx;
    const UNDER_FEET_PAD_M = 0.3;          // a little grace below the art's bottom row
    // Per-kind horizontal grab half-width (m).
    const HALF_W = {
      npc: 1.8, cow: 2.4, deer: 2.0, dog: 1.8, cat: 1.7, crow: 1.7,
      chicken: 1.5, crab: 1.5, turtle: 1.5, rabbit: 1.4, butterfly: 1.4, gull: 1.7, raven: 1.7, horse: 2.2, boar: 1.7,
      slime: 2.0, cave_slime: 2.0, fire_slime: 2.0, goblin: 2.0, goblin_archer: 2.0, goblin_trapper: 2.0, purple_slime: 1.4,
    };
    // Closest tappable creature whose DRAWN box contains the tap. Rank by
    // distance to the body CENTRE so the most on-target animal wins overlaps.
    let target = null, bestD2 = Infinity;
    WorldGen.forEachItem('creatures', (c) => {
      if (save.caught.includes(c.id) || Combat.isBurrowed(c) || Combat.isDisguised(c)) return;
      // A SUMMONED ally (the spirit raven) is not a tap target: nothing to
      // catch, tame, feed or pet — a tap goes through it to whatever is there.
      if (SpriteLayout.isSummoned(c.kind)) return;
      // A variant monster is its base kind's art scaled by the same ratio the
      // renderer draws it with (creatureArt: GIANT_ART_SCALE times the row's
      // own artScale), so the tappable area stays the drawn body.
      const bk = SpriteLayout.baseKind(c.kind);
      // A softened lair guard is drawn smaller (creatureInstScale), so its
      // tap box shrinks with it.
      const inst = SpriteLayout.creatureInstScale(c);
      const gMul = SpriteLayout.creatureScale(c.kind) / SpriteLayout.creatureScale(bk) * inst;
      const span = SpriteLayout.creatureTapSpanPx(c.kind, inst)
        || SpriteLayout.creatureTapSpanPx('chicken', inst);
      const halfW = (HALF_W[bk] ?? 2.0) * gMul;
      const topY = c.y + span.top * px2m;                         // crown (or hop peak)
      const botY = c.y + span.bottom * px2m + UNDER_FEET_PAD_M;   // under the feet
      const bodyCY = c.y + (span.top + span.bottom) / 2 * px2m;   // drawn centre
      if (Math.abs(wm.x - c.x) > halfW) return;
      if (wm.y < topY || wm.y > botY) return;
      const ddx = wm.x - c.x, ddy = wm.y - bodyCY;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 < bestD2) { bestD2 = d2; target = c; }
    });
    if (!target) return false;
    // Player-reach gate (the same lit-cell tooFar test as treasure/wildplant/object
    // and the lit reach indicator). The sprite-box test above is tap-
    // forgiveness measured from the TAP point, not the player — without this a
    // visible-but-out-of-reach animal could be caught/fed by tapping it. Keeps
    // the lit-area ⇔ tap-accept invariant (QC §7). Gated on the FOOT cell
    // (target.x, target.y) so reach matches the lit highlight, not the body.
    if (tooFar(ctx, target.x, target.y)) return 'far';
    if (target.kind === 'npc') { NPC.interact(scene, target, sx, sy); return true; }

    // MANGO — the universal tame treat. Feeding a mango to ANY wild creature
    // (livestock, cats/dogs, even pests like slimes / crows / deer) befriends
    // it in place instead of catching or fighting. Checked before the slime /
    // DEFEAT / favourite-food paths so mango always wins. Already-tame pets
    // (id starts with 'released_') skip this and fall through to petting.
    const isTame = typeof target.id === 'string' && target.id.startsWith('released_');
    const _mangoSel = getSelectedSlot(save);
    // Underground monsters can't be befriended — they're DEFEAT-only foes.
    if (!isTame && !Combat.isMonster(target.kind) && _mangoSel?.id === 'mango' && (_mangoSel.count ?? 0) > 0) {
      const doMangoTame = () => tameInPlace(scene, save, target,
        `🥭 tamed ${itemName(target.kind)}`, 'mango', 1.2);
      confirmFeed(scene, 'mango', target.kind, doMangoTame);
      return true;
    }

    // PESTS / HUNTABLES — slimes, crows and deer are DEFEATED rather than
    // caught alive, and the two halves now diverge (see combat.js):
    //
    //   ENEMIES (wild slime + every cave monster) fight on the HP-driven
    //   COMBAT wheel. The ring is the foe's health, a sword (or bare hands)
    //   drains it while the wheel runs, and bow/staff shots drain the same
    //   pool. The combat tick chooses the closest enemy automatically.
    //
    //   GAME (crow / deer) keeps the old timed work wheel: nothing auto-fires
    //   at them and no shot can hit them, so a hunt is still a deliberate tap.
    //   The BUG NET is what speeds it — see the isGame branch below.
    //
    // Either way the defeat is FREE (no energy spent): your TIME is the cost,
    // which also means you can still kill the very slime that's draining you
    // when low on energy.

    // Secret: slime can be tamed with a sapphire. Hinted in ONE place — the
    // closing riddle in PLAY_TIPS — and nowhere else: ITEM_EFFECTS.sapphire
    // names the portal, which is the sapphire's advertised use.
    // Checked before the enemy branch below so the sapphire path wins over the
    // combat wheel — otherwise you'd stab the slime you meant to befriend.
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

    // A rose befriends an enemy temporarily; it does not make it catchable.
    if (Combat.isCharmed(target)) {
      const name = Combat.monster(target.kind)?.name || itemName(target.kind);
      scene.flash(name, sx, sy);
      return true;
    }

    // Enemy taps do not choose a melee target. The combat tick continuously
    // selects the closest foe in weapon reach; feeding/taming above still works.
    if (Combat.isEnemy(target)) {
      const name = Combat.monster(target.kind)?.name || itemName(target.kind);
      scene.flash(name, sx, sy);
      return true;
    }

    // HUNTING — GAME only, which is crow and deer: SpriteLayout.isGame reads
    // the one creature table, so what may be hunted is written beside what
    // that kill drops instead of in a set of its own here. A pet of any kind
    // falls through to petting below.
    if (!isTame && SpriteLayout.isGame(target.kind)) {
      const r = save.relics || {};
      // ONE TOOL TAKES ANIMALS: the BUG NET. Weapons fight ENEMIES
      // (combat.js); the net takes GAME and livestock alike, on the same slot
      // the catch wheel below already uses.
      // The net uses the shared spec tool ladder via toolDurationMs (wood 4s …
      // frost .3s). No net = tier 0 (bare hands): 9s — slow but always possible.
      // Named plainly, not `r.bugnet ? 'bugnet' : null`: toolDurationMs already
      // answers an unowned slot with the bare-handed rung, and the wheel's tool
      // badge answers "you own no net, so wear none" in _setWorkProgressIcon —
      // the one place that test lives.
      const netSlot = 'bugnet';
      const durMs = toolDurationMs(r, netSlot);
      // Rare shiny fauna have DOUBLE HP — the work wheel takes twice as long,
      // so a shiny crow/deer is markedly tougher to bring down than its plain
      // kind. (Enemies never reach here, and neither slimes nor monsters ever
      // go shiny, so this is a crow/deer rule outright now.)
      const hpMul = target.shiny ? 2 : 1;
      // Dragon Powder: 2× attack damage → the kill wheel finishes in half the
      // time during the 1-minute dragon form (see useDragonPowder in app.js).
      const dmgMul = (typeof scene.isDragonActive === 'function' && scene.isDragonActive()) ? 0.5 : 1;
      const victim = target;
      // The kill payload (drops, bounty, quest tick, shiny fanfare) is shared
      // with the combat wheel and with a killing bow/staff shot — it lives on
      // the scene as resolveDefeat so all three routes pay out identically.
      scene.startWorkProgress(victim.x, victim.y, () => scene.resolveDefeat(victim),
        durMs * hpMul * dmgMul, 0, netSlot, victim);   // track the victim → hunt aborts if it flees out of reach
      // A hunted crow retreats in full — the same departure a fed crow makes
      // — but on its OWN rhythm: it finishes the perch it is sitting and
      // leaves on its next launch, so the wheel races the perch the crow had
      // left when you tapped (creature_ai.js CROW_DEPART_HOP: a wood net at
      // point blank is a coin flip, decided by timing).
      if (victim.kind === 'crow') scene._crowDepart?.(victim, performance.now(), 'hunted');
      // A kind that FIGHTS BACK (the deer — SpriteLayout.creatureFightsBack)
      // turns on the hunter instead: enraged for its rageMs, it charges and
      // butts (scene_creatures.js wanderCreatures). Wall clock, like
      // _lastDamagedT.
      const fb = SpriteLayout.creatureFightsBack(victim.kind);
      if (fb) victim._rageUntil = Date.now() + fb.rageMs;
      return true;
    }
    // Catchable animals (chicken/cow/cat/dog/rabbit/butterfly) all flow through
    // the unified tame-or-catch logic below: favourite food TAMES (befriends in
    // place); an empty hand starts the CATCH work queue. Slimes/crows/deer were
    // defeated above and never reach here.
    const sel = getSelectedSlot(save);
    const selItem = sel ? ITEM_BY_ID[sel.id] : null;
    const isEdible = sel && (typeof FOOD_ENERGY !== 'undefined') && (sel.id in FOOD_ENERGY);
    // "Plant produce" = anything tagged kind:'produce' that came from a plant
    // — farmed crops carry an `item.crop` ref; longgrass too.
    // Excludes egg / milk (also kind:'produce' but they're animal-source).
    const isPlantProduce = selItem && selItem.kind === 'produce' && !!selItem.crop;

    // ── TAME PETS — released animals (id starts with 'released_'). Tame
    // pets never get "yuck'd"; tapping them while holding FOOD plays
    // a brief species-specific happy interaction (cluck / purr / etc.),
    // arms the shared petting-boost timer and its next-yield double chance,
    // and - for cats - kicks off the shared follow timer the wander loop honours. (isTame is decided above, before the mango path;
    // an empty hand or a tool PICKS THE PET UP instead — pickUpPet, just above.)
    // A tame PRODUCER (cow / chicken) fed PLANT PRODUCE must fall through to the
    // produce path below — that's where milk / eggs are granted and where the
    // petting boost armed here is consumed. Without this exception the isTame
    // block swallows every tap, so a tame cow/chicken only ever gets petted and
    // never produces (the reported "cow gives no milk when fed" bug). Petting
    // with an empty hand or a non-produce treat still runs the pet branch.
    const tameProducerFeed = isTame && isPlantProduce && (sel?.count ?? 0) > 0
      && !!SpriteLayout.creatureProduce(target.kind);
    // FOOD IS OFFERED, A HAND TAKES. Holding anything an animal could eat (a
    // treat, produce, a seed, a bite it won't want) pets the animal below; an
    // EMPTY hand or a tool picks the pet UP into the bag (pickUpPet) — the
    // same split the wild branch makes between feeding and the catch wheel,
    // minus the wheel: it is yours.
    const offering = sel && (sel.count ?? 0) > 0
      && (isEdible || isPlantProduce || selItem?.kind === 'seed' || animalLikesFood(target.kind, sel.id));
    if (isTame && !offering && pickUpPet(scene, save, target, sx, sy)) return true;
    if (isTame && !tameProducerFeed) {
      const SOUND = { chicken: 'cluck', cow: 'moo', cat: 'purr', dog: 'woof',
                      butterfly: 'flutter', crow: 'caw', rabbit: 'twitch', deer: 'snort',
                      crab: 'click', horse: 'whinny', turtle: 'blink' };
      const sound = SOUND[target.kind] || 'happy';
      // Petting accepts the favourite OR plant produce as a treat. Treats
      // get consumed; an empty-handed pet is free. animalLikesFood handles
      // species-specific quirks (e.g. tame chicken accepts any seed).
      const likesTame = sel && animalLikesFood(target.kind, sel.id);
      const isTreat = sel && (sel.count ?? 0) > 0
        && (likesTame || isPlantProduce);
      // Pet the animal: arm the shared double-yield boost and (for treats) eat
      // the held item. Both the in-memory timer and a persisted EPOCH-ms mirror
      // are set — creatures are re-spawned from tile data on every reload and
      // lose their in-memory _pettedUntilT (a performance.now value that also
      // resets to ~0 on reload), so the produce path below reads the persisted
      // copy; otherwise the boost would silently never survive a tile change.
      const ANIMAL_INTERACTION = SpriteLayout.ANIMAL_INTERACTION;
      const doPet = () => {
        if (isTreat && !consumePetFood(save, target, sel.id)) return;
        target._pettedUntilT = performance.now() + ANIMAL_INTERACTION.petBoostMs;
        save.petBoost = save.petBoost || {};
        save.petBoost[target.id] = Date.now() + ANIMAL_INTERACTION.petBoostMs;
        // A kind that FOLLOWS once petted (the cat) starts the shared follow
        // window - the same `follows` flag wanderCreatures reads to honour it.
        if (SpriteLayout.creatureFollows(target.kind)) {
          target._followUntilT = performance.now() + ANIMAL_INTERACTION.followMs;
        }
        if (isTreat) {
          scene.buildInventoryDOM();
        }
        // The boost is timed, so the flash says for how long — before this it
        // was the one buff in the game with no readout at all, and a player
        // who petted a cow had no way to know the double-yield window.
        scene.flashLoot(`💗 ${sound} - ${shortDuration(ANIMAL_INTERACTION.petBoostMs)}`, '#ff8aff', 0.85);
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
    const likes = sel && animalLikesFood(target.kind, sel.id);
    if (!isTame && sel && likes && (sel.count ?? 0) > 0) {
      const favId = sel.id;
      const doTame = () => tameInPlace(scene, save, target,
        `🐾 tamed ${itemName(target.kind)}`, target.kind, 1);
      confirmFeed(scene, favId, target.kind, doTame);
      return true;
    }
    // 2. Plant produce → produce (chicken / cow only). Recently-petted
    // tame animals roll the shared chance for a double yield.
    //
    // Per-creature production cooldown: each chicken / cow only yields once
    // per ANIMAL_INTERACTION.produceCooldownMs. The last-yield timestamp lives on
    // the creature object as `_lastProduceT` (epoch ms, NOT performance.now
    // — must survive save reloads + tile re-rasterise). The save also
    // persists save.lastProduce[id] so the timer survives across reloads:
    // creature objects are re-spawned each tile load and lose any in-memory
    // _lastProduceT, but the save-side mirror is read back below.
    const ANIMAL_INTERACTION = SpriteLayout.ANIMAL_INTERACTION;
    if (sel && isPlantProduce && (sel.count ?? 0) > 0) {
      // WHAT A FED FARM ANIMAL GIVES, and what it is called having given it,
      // are one row of the creature table (`produce`) — so "is this a
      // producer" above, the item here and the verb below can't disagree.
      const produce = SpriteLayout.creatureProduce(target.kind);
      const yieldId = produce ? produce.item : null;
      if (yieldId) {
        const now = Date.now();
        save.lastProduce = save.lastProduce || {};
        const lastT = save.lastProduce[target.id] || target._lastProduceT || 0;
        if (now - lastT < ANIMAL_INTERACTION.produceCooldownMs) {
          // Still on cooldown — refuse without consuming the produce. Bail
          // before the confirm dialog so we don't ask about a feed that can't
          // happen yet.
          const left = shortDuration(ANIMAL_INTERACTION.produceCooldownMs - (now - lastT));
          const verb = produce.verb;
          scene.flash(`already ${verb} — in ${left}`, sx, sy);
          return true;
        }
        const feedId = sel.id;
        const doFeed = () => {
          if (!consumePetFood(save, target, feedId)) return;
          // Petting boost: prefer the persisted epoch-ms expiry (survives reload)
          // and fall back to the in-memory timer for boosts armed this session.
          save.petBoost = save.petBoost || {};
          const petted = (save.petBoost[target.id] || 0) > Date.now()
            || (target._pettedUntilT && target._pettedUntilT > performance.now());
          const yieldN = petted && Math.random() < ANIMAL_INTERACTION.doubleYieldChance ? 2 : 1;
          if (petted) {                            // consume the boost (both copies)
            delete save.petBoost[target.id];
            target._pettedUntilT = 0;
          }
          scene.addToInv(yieldId, yieldN);
          scene.buildInventoryDOM();
          scene.flashLoot(`+${yieldN} ${itemName(yieldId)}`, '#a7ffb0', 1, yieldId);
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
    // catch fails (butterflies: 2.7× faster flee, 2 s grace). A Bug Net shortens
    // the wheel by tier; bare hands take the tier-0 (9s) time — long enough
    // that a slow target usually slips out of reach and escapes. Butterflies
    // catch bare-handed too — no tool gate.
    let catchMs = toolDurationMs(save.relics, 'bugnet') * CATCH_SPEED_MUL;
    // Rare shiny fauna have DOUBLE HP — the catch wheel runs twice as long, so
    // a shiny animal (which also flees at SHINY_SPEED_MUL, app.js) is much harder to net: it
    // has more time to slip out of reach and escape. Plain kinds are unchanged.
    if (target.shiny) catchMs *= 2;
    // …and a kind's own row may ask for longer still (a cow: twice).
    catchMs *= SpriteLayout.creatureCatchMul(target.kind);
    // Catching costs energy (refunded if the player cancels the wheel; not
    // refunded if the animal escapes the player's reach — the attempt was made).
    const catchCost = effectiveCatchCost(save.relics);
    if (catchCost && !scene.spendEnergy(catchCost, sx, sy)) return true;
    const victim = target;
    // The chicken has its own first-attempt story; other catches use the net
    // story. After the spend, so an unaffordable attempt tells neither.
    scene._catchStory?.(victim);
    scene.startCatchProgress(victim, catchMs, () => {
      scene.catchCreature(victim, sx, sy);
    }, () => {
      // On the cell the animal escaped FROM (where it stands now), not the
      // viewport centre.
      scene.flashAtWorld('🏃 it got away', victim.x, victim.y);
    }, 'bugnet', catchCost);
    return true;
  }},

  // A selected kit dismantles one obstacle before its normal axe-work tap.
  { name: 'disarm-obstacle', try: (ctx) => {
    const { scene, save, wm } = ctx;
    const sel = getSelectedSlot(save);
    if (!(sel?.id === 'trap_kit' && sel.count > 0)) return false;
    const spent = spentSets(scene, save);
    const accepts = o => isTrapKitObstacle(o) && !isSpent(o, spent);
    const o = findItemInTapCell(scene, 'wildplants', wm, accepts)
      || findItemInTapCell(scene, 'objects', wm, accepts);
    if (!o) return false;
    if (tooFar(ctx, o.x, o.y)) return 'far';
    save.picked = [...(save.picked || []), o.id];
    // Re-evaluate slowing immediately, including while standing on the piece.
    scene._streetFeetKey = null;
    scene._tickStreetFeet?.();
    finishTrapKit(ctx, o.kind === 'stakes' ? 'Spikes removed' : 'Barricade removed');
    return true;
  }},

  // 1a) Pick the unpicked wild plant standing in the TAPPED CELL. Tall flora
  // (shrubs, long grass) draw above their cell, but only the cell they're
  // rooted in picks them.
  { name: 'wildplant', try: (ctx) => {
    const { scene, save, wm, sx, sy } = ctx;
    const pickedSet = new Set([...(save.picked || []), ...(save.burnedObjects || [])]);
    // A TIDE pickup (src/scenic.js) is the day's: it answers through the one
    // spent predicate (isSpent — on the waterline today, not taken today).
    const tideSets = spentSets(scene, save);
    const bestWp = findItemInTapCell(scene, 'wildplants', wm,
      (wp) => !isSpent(wp, tideSets) && (wp.tide || !pickedSet.has(wp.id)));
    if (bestWp) {
      const wp = bestWp;
      if (tooFar(ctx, wp.x, wp.y)) return 'far';
      const rule = wildplantRule(wp.crop);
      if (rule?.hazardMinTier && isWalkHazard(wp)
          && (save.relics?.[rule.workRelic]?.tier || 0) < rule.hazardMinTier) {
        const need = TIER_BY_NUM[rule.hazardMinTier].name;
        scene.flash(`Need ${tierArticle(need)} ${need} ${rule.workRelic}.`, sx, sy);
        return true;
      }
      const selected = getSelectedSlot(save);
      if (rule?.disarmWithKit && selected?.id === 'trap_kit' && selected.count > 0) {
        save.picked = [...(save.picked || []), wp.id];
        const kept = Math.random() < TRAP_KIT_KEEP_CHANCE;
        if (!kept) consumeSelected(save);
        persistSave(save);
        ctx.dirty = true;
        scene.buildInventoryDOM();
        scene.flash(`Dismantled. Kit ${kept ? 'kept' : 'used'}.`, sx, sy);
        return true;
      }
      if (rule?.timber) return runWildplantTimber(ctx, wp);
      // What this wild plant DOES — what it drops, whether it hides a bonus,
      // which relic times its wheel and what that wheel costs — is one table
      // in items.js (WILDPLANT_RULES), read through the accessors below.
      // Some wild crops require physical work to harvest, mirroring their
      // hard-object cousins:
      //   rockfruit (stone debris) → pick relic speeds up rock-breaking work
      //   shrub     (woody bush)   → axe  relic speeds up chop work
      // Both run toolDurationMs of that relic (items.js TOOL_DURATION_MS —
      // 9s bare-handed, faster per tier). Other wildplants
      // (rainberry, pairy, nut, longgrass …) stay instant.
      const award = () => {
        if (isSpent(wp, spentSets(scene, save))) return;
        // Re-check picked at callback time. The work wheel runs async — if a
        // save reload or some other path already marked this wp.id as picked
        // between handler start and callback fire, awarding again would dupe.
        // A TIDE pickup is written to the DAY LEDGER (Macros.markToday), never
        // save.picked: it is back on the waterline another day.
        // A shaking bush has a stable occupant; only one fifth hide a baby. Before
        // the pick is written: with no room in the bag for it the bush stays
        // standing, unpicked, to be chopped again once there is.
        const nest = isNestBush(wp.crop, wp.id) ? nestBushContents(wp.id) : null;
        const babyId = nest?.type === 'baby' ? nest.item : null;
        if (babyId && Inventory.roomFor(save, babyId) < 1) {
          scene.flash('Make room for a pet first.', sx, sy);
          return;
        }
        if (wp.tide) {
          if (isSpent(wp, spentSets(scene, save))) return;
          Macros.markToday(save, wp.id);
        } else {
          if ((save.picked || []).includes(wp.id) || (save.burnedObjects || []).includes(wp.id)) return;
          save.picked = [...(save.picked || []), wp.id];
        }
        const rewards = wildplantRewards(wp.crop);
        const outId = rewards[0].id;
        for (const reward of rewards) scene.addToInv(reward.id, reward.qty);
        let bonus = '';
        const treasure = wildplantTreasure(wp.crop);
        if (treasure && Math.random() < treasure.chance) {
          if (treasure.coins) {
            addMoney(save, treasure.coins);
            bonus = ` ✨${treasure.coins} coin`;
          } else {
            scene.addToInv(treasure.bonus, 1);
            bonus = ` ✨${itemName(treasure.bonus)}`;
          }
        }
        persistSave(save);
        // Display NAMES, never raw ids (QC_RULES §4).
        const outName = itemName(outId);
        if (bonus) scene.flashLoot(`${outName}${bonus}`, '#ff8aff', 1, outId);
        else scene.flashLoot(wildplantHarvestLine(wp.crop), undefined, rewards[0].qty, outId);
        // Rare shiny flora — 10× money + a memory, on top of the
        // normal pickup, with fanfare.
        if (isShiny(wp.id, SHINY_RATE.flora)) scene.awardShinyBonus(outId, sx, sy);
        // The nest bush's baby, and the card that shows it.
        if (babyId) {
          scene.addToInv(babyId, 1);
          persistSave(save);
          if (typeof scene.showBabyFound === 'function') scene.showBabyFound(babyId, 'bush');
        } else if (nest) {
          spawnNestBushCreature(scene, wp, nest.type);
        }
        return true;
      };
      const reqRelic = wildplantWorkRelic(wp.crop);
      if (reqRelic) {
        // Chopping a shrub is real felling work — the table charges the shared
        // 9/3/1 tool curve off the axe tier (9 bare-handed, 3 with a Wood axe
        // … 1 frost). rockfruit debris stays free to gather.
        const workCost = wildplantWorkCost(wp.crop, save.relics);
        // Same pipeline as interactables.js runInteractable: pre-spend the
        // energy (an unaffordable tap is consumed without starting), then run
        // the wheel on the relic's tool ladder, refunding the cost on cancel.
        const durMs = toolDurationMs(save.relics, reqRelic);
        if (workCost && !scene.spendEnergy(workCost, sx, sy)) return true;
        // First felling chop the save ever starts tells its story. Only the
        // axe work counts here - rockfruit debris gathers free, by hand.
        if (reqRelic === 'axe') scene._toolActionStory?.('chop');
        const startingTier = save.relics?.[reqRelic]?.tier || 0;
        scene.startWorkProgress(wp.x, wp.y, () => {
          if (award()) scene._barehandWorkStory?.(reqRelic, startingTier);
        }, durMs, workCost || 0, reqRelic);
      } else {
        award();
        ctx.dirty = true;
      }
      return true;
    }
    return false;
  }},

  // 1a") Coin drops (ATM / bicycle_parking burst, cave coins, a kill's
  // bounty). The coin lying in the TAPPED CELL → +its amount (coinAmount),
  // splice it out of entry.coinDrops, pop the number on its cell. Runs
  // BEFORE the 'object' handler so a coin sitting near a chest sprite still
  // gets picked up cleanly. Does NOT consume energy — it's a tap, not work.
  // 1b) World objects: chest open, tree flavor, house shop.
  // 4.5) Staircase — tap a cave entrance / stairs within reach to change level.
  // Runs before the generic object handler so the stair consumes the tap rather
  // than falling through to it.
  { name: 'staircase', try: (ctx) => {
    const { scene, wm } = ctx;
    const stair = findItemInTapCell(scene, 'objects', wm, (o) => o.kind === 'staircase');
    if (!stair) return false;
    if (tooFar(ctx, stair.x, stair.y)) return 'far';
    scene.changeDepth(stair.dir === 'up' ? -1 : +1, stair);
    return true;
  }},

  { name: 'object', try: (ctx) => {
    const { scene, save, wm, sx, sy } = ctx;
    // Spent chests (opened for good, or a daily crate taken today) sort last,
    // off the one test the draw pass hides them by (interactables.js isSpent).
    const spentTap = spentSets(scene, save);
    const allObjs = [];
    // Wrap push in a block so we don't return its truthy result —
    // forEachItem treats any truthy return as "stop iterating".
    WorldGen.forEachItem('objects', (o) => { allObjs.push(o); });
    allObjs.sort((a, b) => {
      const ao = a.kind === 'chest' && isSpent(a, spentTap) ? 1 : 0;
      const bo = b.kind === 'chest' && isSpent(b, spentTap) ? 1 : 0;
      return ao - bo;
    });
    // Match render.js exactly: deterministic dedupe by game cell so the tap-target set
    // is identical to what's drawn. Sharing the same cell key (chest ids are cell-snapped)
    // avoids the order-dependent "see a crate but can't tap it" mismatch.
    // Hit testing is CELL-SHAPED — the same shape the till handler's "occupied"
    // guard uses (an object blocks the cell its FOOT sits in), so the two can't
    // disagree in either direction: no corner of an object's own cell falls
    // through to "occupied: chest", and no part of a NEIGHBOURING cell taps the
    // object. The old reach circles (3.5 m, or 6 m raised 4 m north for tall
    // sprites) had to be at least the cell half-diagonal to cover their own
    // cell, which necessarily spilled into the four neighbours — that is what
    // made a tall tree / turret / market stall tappable from the empty cell
    // above it.
    const tapCell = worldMetersToAbsCell(scene, wm.x, wm.y);
    // interactables.js › chestCellDedup — literally the predicate render.js
    // builds, so the tap-target set and the draw set can't disagree. One
    // instance per tap: it is stateful (first-seen-wins in this iteration).
    // scene.cellM, NOT this.cellM: these handlers are arrow fns defined at
    // module top level, so `this` is the global object (window) here, not the
    // scene — `this.cellM` was undefined, making every key "NaN_NaN". That
    // collapsed ALL loaded chests to one dedupe key, so only the first chest
    // iterated stayed tappable and every other chest fell through to the till
    // handler's "occupied: chest" flash.
    const isDupTapChest = chestCellDedup(scene.cellM);
    for (const o of allObjs) {
      if (o.kind === 'chest' && isDupTapChest(o)) continue;
      // The object's own cell is its whole tap target — for a house / turret /
      // market stall too, however far their art rises above it. Nothing is
      // lost for multi-cell buildings: the 'building-zone' handler below
      // catches taps on any BUILDING-terrain cell of a footprint and routes
      // them to that building, which is cell-based in the same way.
      if (!itemContainsTapCell(scene, o, tapCell)) continue;
      if (tooFar(ctx, o.x, o.y)) return 'far';
      // Every tap-driven world object (groundstack / chest / well / tree /
      // mineralrock / fruittree / house / tower) is declared in the
      // INTERACTABLES registry (interactables.js) and dispatched through one
      // shared driver instead of a per-kind if/else chain here. 'skip' = let
      // the tap fall through to the next object (e.g. a chopped tree stump or
      // an already-picked stack that mustn't consume the tap); otherwise the
      // driver consumed it. Reach + tall-sprite handling already ran above.
      if (typeof INTERACTABLES !== 'undefined' && INTERACTABLES[o.kind]) {
        const res = runInteractable(ctx, o);
        if (res === 'skip') continue;
        return res;
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
  // stand, so the reach (coords.js reachCells — 2.5 cells to start, more
  // with the Inner Light, less underground) is consistent everywhere.
  { name: 'cell-resolve', try: (ctx) => {
    const { scene, wm, sx, sy } = ctx;
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

  // No 'path-stone' handler: a street is rebuilt by PROXIMITY (app.js
  // _sweepStreets), not by tapping a cobble.

  // 2-disarm-trap) With a Trap Disarm Kit selected, tap a trap's own cell —
  // the hidden scuff or the already-sprung jaw, surface or cave — to remove
  // it for good (Traps.disarm, src/traps.js). Reach is already gated by
  // cell-resolve above, same as every other cell-shaped tap; a cell with no
  // trap on it falls through so the kit never eats a tap meant for till/plant.
  { name: 'disarm-trap', try: (ctx) => {
    const { scene, save, sx, sy, cell } = ctx;
    if (typeof Traps === 'undefined') return false;
    const sel = getSelectedSlot(save);
    if (!(sel && sel.id === 'trap_kit' && (sel.count ?? 0) > 0)) return false;
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(cell.tx, cell.ty));
    const trap = entry ? Traps.trapAt(entry, cell.ix, cell.iy) : null;
    // isTrapDisarmed / disarmTrap: a goblin's LAID snare keeps its state on
    // the record, never as a save id (traps.js) — the same kit shuts either.
    if (!trap || Traps.isTrapDisarmed(save, trap)) return false;
    Traps.disarmTrap(save, trap);
    finishTrapKit(ctx, 'Trap disarmed');
    return true;
  }},

  // 2a) Building-zone tap — runs AFTER cell-resolve so we already know the
  // player is within tap range of the cell. If that cell is a building tile
  // (small house / fort / castle terrain), find the nearest house/tower in
  // the loaded objects[] and route the tap to shopInteract as if the player
  // had clicked the building sprite itself. Without this, taps on the
  // non-sprite cells of a building's biome cluster fall through to the
  // til/release/etc. handlers and look like nothing happened, because the
  // 'object' handler only accepts the one cell the house sprite stands on.
  // This is how a multi-cell building stays tappable across its whole
  // footprint WITHOUT any hit area spilling past it: every cell that accepts
  // the tap is a building cell you can see. The 30 m snap keeps us from
  // bridging across to a different cluster on the next tile.
  { name: 'building-zone', try: (ctx) => {
    const { scene, sx, sy, cwmx, cwmy, cell } = ctx;
    if (!BUILDING_TYPES.has(cell.type)) return false;
    const best = findClosestItem('objects', cwmx, cwmy, 30,
      (o) => isBuilding(o.kind));
    if (!best) return false;
    scene.shopInteract(sx, sy, best);
    return true;
  }},

  // 2-pre) Release a selected animal onto this cell.
  // Only on passable (tillable) ground — water, roads, paths, buildings, and cement
  // pads all refuse the release so the creature sprite never ends up floating on a
  // roof / inside a wall.
  { name: 'fire-held', try: (ctx) => {
    // 2-fire-held) Tap a lit campfire while HOLDING something. The fire either
    // MAKES something of it (items.js CAMPFIRE_MAKES: meat → grilled meat,
    // the cooked foods) or, for anything else, asks "Burn <name>?" and destroys
    // one on yes (app.js presentBurnConfirm). Empty-handed, the tap falls
    // through to extinguish-fire. Runs before `release` so a held animal
    // over a fire is a burn question, not a release into the flames.
    const { scene, save, sx, sy, cwmx, cwmy } = ctx;
    const sel = getSelectedSlot(save);
    if (!sel || (sel.count ?? 0) <= 0) return false;
    const half = scene.cellM / 2;
    const fireIdx = PlacedFloor.indexAt(save.fires, cwmx, cwmy, scene.depth, half);
    const fire = fireIdx >= 0 ? save.fires[fireIdx] : null;
    if (!fire) return false;
    const made = CAMPFIRE_MAKES[sel.id];
    if (!made) { scene.presentBurnConfirm(sel.id, { x: fire.x, y: fire.y }); return true; }
    // The product has to fit before the input goes — unless this is the last
    // one, whose own slot frees up for it.
    const input = sel.id;
    const last = sel.count === 1;
    if (last) consumeSelected(save);
    if (!scene.addToInv(made, 1, false, { notWild: true })) {
      if (last) scene.addToInv(input, 1, true, { notWild: true });   // put it back
      return true;
    }
    if (!last) consumeSelected(save);
    ctx.dirty = true;
    scene.buildInventoryDOM();
    scene.flashLoot(`🔥 ${itemName(made)}`, '#ffb070', 1, made);
    return true;
  }},

  { name: 'release', try: (ctx) => {
    const { scene, save, sx, sy, cwmx, cwmy, cell } = ctx;
    const sel = getSelectedSlot(save);
    const item = sel ? ITEM_BY_ID[sel.id] : null;
    if (!(item && item.kind === 'animal' && (sel.count ?? 0) > 0)) return false;
    if (!isTillableCell(cell)) {
      scene.flash("can't release here", sx, sy);
      return true;
    }
    // Shiny animals release as their plain kind (so the world creature
    // renders + behaves normally) but carry a shiny flag so they tint gold and
    // re-catch back into the shiny stack.
    const baseKind = item.base || item.id;
    // A BABY (items.js BABY_KINDS) is born the moment it is set down: `raised`
    // + `born` ride the save row and the live creature alike, and both the
    // size (SpriteLayout.isBabyPet) and, once grown, the double strength
    // (combat.js raisedMul) read them. A raised pet is always shiny.
    const isBaby = !!item.baby;
    const tx = Math.floor(cwmx / scene.tileEdgeM);
    const ty = Math.floor(cwmy / scene.tileEdgeM);
    save.released = save.released || [];
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
    // A raised pet PICKED UP earlier (pickUpPet) comes back as itself: its row
    // kept its id, birth and meals while its id sat in save.caught, so the
    // row moves here and the mark comes off instead of a new birth.
    const carried = carriedRaisedRow(save, baseKind, isBaby);
    const isShinyItem = !!item.shiny || isBaby || !!carried;
    const birth = carried
      ? { raised: true, born: carried.born, favouriteFeeds: carried.favouriteFeeds || 0 }
      : isBaby ? { raised: true, born: Date.now(), favouriteFeeds: 0 } : {};
    const id = carried ? carried.id : releasedId(baseKind);
    const policy = Companions.releasePolicy(scene, cwmx, cwmy);
    if (carried) {
      Object.assign(carried, { x: cwmx, y: cwmy, tx, ty, ...policy });
      save.caught = (save.caught || []).filter(cid => cid !== id);
    } else {
      save.released.push({ x: cwmx, y: cwmy, kind: baseKind, id, tx, ty, shiny: isShinyItem, ...birth, ...policy });
    }
    if (entry && entry.creatures) {
      entry.creatures.push(WorldGen.makeCreature(baseKind, cwmx, cwmy, id, { shiny: isShinyItem, ...birth, ...policy,
        ...(carried?.hp != null ? {_hp:carried.hp} : {}),
        _lastDamagedT:carried?.lastDamagedAt ?? null }));
    }
    consumeSelected(save);
    ctx.dirty = true;
    scene.buildInventoryDOM();
    scene.flash(`released ${item.name || item.id}`, sx, sy);
    return true;
  }},

  // 2-placed-rock) Tap a player-placed rockfruit stone → pick it back up (with progress wheel).
  { name: 'pickup-rock', try: (ctx) => {
    const { scene, save, sx, sy, cellKey, cwmx, cwmy } = ctx;
    // Placed stones live on the surface only; underground the same abs-cell key
    // would otherwise phantom-match a surface stone (GPS-mirrored coords).
    if ((scene.depth ?? 0) !== 0) return false;
    if (!scene.placedRockSet.has(cellKey)) return false;
    scene.startWorkProgress(cwmx, cwmy, () => {
      scene.placedRockSet.delete(cellKey);
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
    // Only match a scarecrow placed on the level we're standing on — a surface
    // scarecrow and the cave cell below it share world coords (GPS mirror), so
    // without the depth gate a cave tap would reclaim the farm scarecrow above.
    const idx = PlacedFloor.indexAt(arr, cwmx, cwmy, scene.depth, half);
    if (idx < 0) return false;
    arr.splice(idx, 1);
    scene.addToInv('scarecrow', 1, false, { notWild: true });   // reclaimed, not found
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
    extraGuard: ({ scene, save, cwmx, cwmy }) =>
      PlacedFloor.indexAt(save.scarecrows, cwmx, cwmy, scene.depth, 0.1) < 0,
    place: ({ scene, save, cwmx, cwmy }) => {
      save.scarecrows = save.scarecrows || [];
      // Tag the level so it renders / wards only here (see src/placed_floor.js).
      save.scarecrows.push(PlacedFloor.stampDepth({ x: cwmx, y: cwmy }, scene.depth));
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
    // Match only a fire lit on this level — fires are placeable underground
    // (they ward slimes), so the GPS-mirror depth gate matters here too.
    const idx = PlacedFloor.indexAt(arr, cwmx, cwmy, scene.depth, half);
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
    extraGuard: ({ scene, save, cwmx, cwmy }) =>
      PlacedFloor.indexAt(save.fires, cwmx, cwmy, scene.depth, 0.1) < 0,
    place: ({ scene, save, cwmx, cwmy }) => {
      save.fires = save.fires || [];
      // Tag the level so it renders / wards only here (see src/placed_floor.js).
      save.fires.push(PlacedFloor.stampDepth({ x: cwmx, y: cwmy }, scene.depth));
      // The FIRST fire a save ever lights tells its story. A busy screen
      // returns false unmarked (the story ledger), so the next fire asks again.
      scene._storySplashOnce?.('fire', {
        art: 'fire_first',
        title: 'First fire',
        body: 'The flames catch. Beside their warmth, your weary limbs begin to ease.',
      });
    },
    flashMsg: '🔥 The fire crackles.',
  })},

  // 2-place-magic-trap) With a Magic Trap selected, set it on an empty cell in
  // reach (reach is cell-resolve's gate). PLACED-bucket state: save.magicTraps
  // = [{ id, x, y, depth }], the id from the cell (Traps.magicTrapId — tile +
  // local cell + level), never a clock. Not placeOnEmptyCell: that asks for
  // TILLABLE ground, and cave floor is not — the trap's home is the dark. The
  // cell test is the one a snare goes down by (Traps.canLay: walkable, off
  // the drawn road, not under a seated object, no trap there already) — one
  // question, "can a trap sit here", whoever is setting it — plus the placed
  // things only the save knows about: a crop, a tilled bed, a fire, a
  // scarecrow, another magic trap. app.js _tickMagicTraps springs it.
  { name: 'place-magic-trap', try: (ctx) => {
    const { scene, save, sx, sy, cell, cellKey, cwmx, cwmy } = ctx;
    if (typeof Traps === 'undefined') return false;
    const sel = getSelectedSlot(save);
    if (!(sel && sel.id === 'magic_trap' && (sel.count ?? 0) > 0)) return false;
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(cell.tx, cell.ty));
    const half = scene.cellM / 2;
    const onCell = (list) => (list || []).some(o => PlacedFloor.onDepth(o, scene.depth) &&
      Math.abs(o.x - cwmx) < half && Math.abs(o.y - cwmy) < half);
    const free = !!entry && Traps.canLay(entry, cell.ix, cell.iy)
      && !(PlacedFloor.isSurface(scene.depth) && scene.tilledSet?.has(cellKey))
      && !onCell(save.planted) && !onCell(save.fires) && !onCell(save.scarecrows)
      && !onCell(save.magicTraps);
    if (!free) { scene.flash("can't set a trap here", sx, sy); return true; }
    save.magicTraps = save.magicTraps || [];
    save.magicTraps.push(PlacedFloor.stampDepth({
      id: Traps.magicTrapId(scene.depth, cell.tx, cell.ty, cell.ix, cell.iy),
      x: cwmx, y: cwmy,
    }, scene.depth));
    consumeSelected(save);
    ctx.dirty = true;
    scene.buildInventoryDOM();
    scene.flash('✨ The trap is set.', sx, sy);
    return true;
  }},

  // 2-place-rock) With rockfruit selected, drop a stone on an empty tillable cell.
  { name: 'place-rock', try: (ctx) => placeOnEmptyCell(ctx, {
    itemId: 'rockfruit',
    energyKey: 'rockPlace',
    place: ({ scene, cellKey }) => {
      scene.placedRockSet.add(cellKey);
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
    // Match only crops sown on the current level — a surface crop and the cave
    // cell directly below it share world coords (GPS mirror), so without the
    // depth gate a tap underground would harvest the farm overhead.
    const curDepth = scene.depth ?? 0;
    const plantedIdx = save.planted.findIndex(p =>
      (p.depth ?? 0) === curDepth &&
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
    const stageHoldMs = Crops.plantHoldMs(p);   // this stage's hold, can cut included (crops.js)
    // The wait to the next stage, in the shared largest-unit notation — or ''
    // when the plant isn't counting down (unwatered, or ripe). The corner
    // badge over the cell has always shown this number; the tap that reads the
    // plant out loud did not, so a player who tapped instead of squinting at
    // the badge was told the stage and nothing about the wait.
    const growthLeft = () => {
      if (!p.watered_t || Crops.isMature(p)) return '';
      return ` — ${shortDuration(stageHoldMs - (Date.now() - p.watered_t))}`;
    };
    const sinceWater = p.watered_t ? Date.now() - p.watered_t : Infinity;
    if (p.watered_t && sinceWater >= stageHoldMs && !Crops.isMature(p)) {
      p.stage = (p.stage ?? 0) + 1;
      p.watered_t = 0;
      ctx.dirty = true;
      // This branch GREW the plant and cleared its watering. Report the stage
      // it just reached and that it wants water again, like the branches below.
      // (Rarely seen: the scene's once-a-second advanceGrowth tick normally
      // gets here first, so this only fires on a tap inside that window or
      // after the tab was backgrounded. Wrong either way.)
      scene.flash(`🌱 ${stageReadout()} — water it`, sx, sy);
      scene._burstAtWorld?.('sprout', cwmx, cwmy);
      return true;
    }
    if (Crops.isMature(p)) {
      if (!scene.spendEnergy(ENERGY_COST?.harvest ?? 0, sx, sy)) return true;
      save.planted.splice(plantedIdx, 1);
      Crops.invalidateSpatialIndex(save);
      scene.tilledSet.delete(cellKey);
      Crops.clearBedQuality(save, cellKey);
      // The BED's quality, banked on the crop when it was planted (the hoe
      // tier that tilled the cell — Crops.bedQuality). Each quality tier
      // raises the extra-seed chance by 10% (base 25%) and adds
      // +floor(qual/3) to the produce yield. `canBoost` is the pre-Sep-2026
      // watering-can field, read once so a crop already in the ground when
      // the bonus moved to the hoe still pays out.
      const qual = p.qualBoost ?? p.canBoost ?? 0;
      const yieldN = randInt(1, 3) + Math.floor(qual / 3);
      scene.addToInv(p.crop, yieldN);
      const gotSeed = Math.random() < (0.25 + qual * 0.10);
      if (gotSeed) scene.addToInv(`${p.crop}_seed`, 1);
      ctx.dirty = true;
      // flashLoot draws the crop sprite from the itemId arg — the text stays
      // emoji-free (name + count only).
      scene.flashLoot(`harvested ${p.crop} ×${yieldN}${gotSeed ? ' +seed' : ''}`, '#a7ffb0', 1, p.crop);
      // The first harvest ends the pest amnesty around home (app.js
      // _pestFreeZone): from here on, slimes, crows and ravens spawn at home
      // like anywhere else. Persisted with this tap's ctx.dirty save.
      save.hasHarvested = true;
      // The FIRST harvest of each crop type is a memory — the same ledger a
      // shiny find and a first delivery bank in (app.js _bankDiscovery), keyed
      // `harvest:<crop>` so it can't collide with an item id and pays once.
      // Farming was the one income with no memory of its own (economy
      // audit, 2026-09-27).
      scene._bankDiscovery?.(`harvest:${p.crop}`,
        `your first ${ITEM_BY_ID[p.crop]?.name || p.crop} harvest`);
      scene.questEvent?.('harvest');
      return true;
    }
    if (!p.watered_t) {
      // Through the shared core (Crops.waterOne), which also rolls the can's
      // chance to jump the plant a stage on the spot — nothing without a can,
      // certain at Frost. See crops.js waterJumpChance.
      const jumped = Crops.waterOne(save, p, save.relics) === 'jumped';
      // First real watering the save ever does tells its story - here, where
      // the water landed, not on a dry tap of an already-watered plant.
      scene._toolActionStory?.('water');
      // The can does ONE thing now: the growth jump above — how soon you get
      // it. WHAT you get (produce quality) is the bed's, set by the hoe that
      // tilled it and banked on the crop at planting (Crops.bedQuality).
      const can = save.relics?.can;
      ctx.dirty = true;
      // Say what the tap DID, like every other farm action does ('tilled',
      // 'planted …', 'harvested …'): until Sep 2026 this read only the stage
      // readout — "Pairy 2/5 — 15m" — which is the same line a tap on an
      // already-watered plant gives, so nothing told the player the watering
      // had happened. With no can the verb also says HOW: bare hands are the
      // tool, and naming them is the only hint the game gives that a better
      // one exists. Kept to three words — the flash also carries the stage
      // readout and the wait, and "you water by cupping your hands" ran the
      // line off the screen.
      // Then the growth readout, so the player can see how close it is to
      // harvest (e.g. "Pairy 2/5"). No wait on this line (owner's call, Sep
      // 2026): the stage badge and a second tap already show it.
      const how = can?.tier ? 'watered' : 'watered by hand';
      scene.flash((jumped ? `🌱 sprang ahead! ${stageReadout()}`
                          : `💧 ${how} — ${stageReadout()}`), sx, sy);
      // The visual cue: a sprinkle of drops onto the cell (particles.js
      // 'water'). A jump adds the sprout burst on top — two things happened.
      scene._burstAtWorld?.('water', cwmx, cwmy);
      if (jumped) scene._burstAtWorld?.('sprout', cwmx, cwmy);
      return true;
    }
    // Already watered and still growing: the stage readout plus the wait left.
    scene.flash(stageReadout() + growthLeft(), sx, sy);
    return true;
  }},

  // 2a-fish) Fishing: tap a water cell (type 3). Triggers a cast
  // work-progress, then rolls the whiff, the junk and the catch — every one of
  // those numbers is the ROD's (items.js › the FISHING block). Placed BEFORE
  // flavor so the water-tap doesn't get eaten by the 'water' label.
  { name: 'fishing', try: (ctx) => {
    const { scene, save, sx, sy, cell } = ctx;
    if (cell.type !== TERRAIN.WATER) return false;
    // No rod? You can still fish BARE-HANDED — it just takes 3× as long. A rod
    // cheapens the cast and lets fewer big fish get away (spec §FISHING).
    const fishCost = effectiveFishCost(save.relics);
    if (!scene.spendEnergy(fishCost, sx, sy)) return true;
    // Cast time is LOCKED to 9s bare-handed / 3s with any rod — deliberately
    // NOT the per-tier toolDurationMs ladder. Rod tier already scales the
    // catch table and the energy cost; letting it also shrink the cast to
    // 0.3s turned a Frost rod into a 3-casts-per-second money faucet.
    const castMs = save.relics?.rod ? 3000 : 9000;
    // Which spot this is, and whether a fish is secretly in it (items.js
    // FISH_STOCK_CHANCE / fishSpotStocked; the starter pond always is). A
    // spot already fished out is in save.fishedSpots for good.
    const spotId = fishSpotId(cell.tx, cell.ty, cell.ix, cell.iy);
    const stocked = inStarterPond(scene, cell) || fishSpotStocked(spotId);
    scene.startWorkProgress(ctx.cwmx, ctx.cwmy, () => {
      const tier = save.relics?.rod?.tier || 0;   // 0 = bare hands (worst odds)
      // An empty or fished-out spot looks and casts like any other and is
      // always an empty cast — the player learns where the fish are by
      // fishing. A spot still holding its fish always bites.
      if (!stocked || scene.fishedSpotSet?.has(spotId)) {
        // An EMPTY CAST is not always empty (items.js rollEmptyCast): now and
        // then a treasure roll, a slime, or junk off the bottom.
        const empty = rollEmptyCast(Math.random, tier);
        if (empty?.kind === 'treasure') {
          grantFoundTreasure(scene, save, sx, sy, '🎣', empty.tier, '✨ SUNKEN TREASURE ✨');
          persistSave(save);
          return;
        }
        if (empty?.kind === 'slime' && scene.spawnFishedSlime?.()) {
          scene.flashLoot('🎣 A slime on the line!', '#ff8a8a', 1.2);
          return;
        }
        if (empty?.kind === 'junk') {
          scene.addToInv(empty.id, 1);
          persistSave(save);
          scene.flashLoot(`🎣 ${ITEM_BY_ID[empty.id]?.name || empty.id}`, '#999', 1, empty.id);
          return;
        }
        scene.flashLoot('🎣 nothing biting…', '#888', 0.9);
        return;
      }
      // The spot's fish is fixed (items.js spotFish); one above the rod's
      // tier may get away (fishCatchChance) and stays for the next cast.
      const pick = spotFish(spotId);
      const shiny = fishSpotShiny(spotId);   // a tier harder to land, and pays the shiny bonus
      if (Math.random() >= fishCatchChance(pick, tier, shiny)) {
        scene.flashLoot(`🐟 ${ITEM_BY_ID[pick]?.name || pick} got away!`, '#ff8a8a', 1, pick);
        return;
      }
      scene.fishedSpotSet?.add(spotId);   // one fish a spot, gone for good
      scene.addToInv(pick, 1);
      scene.questEvent?.('fish');     // the castle board's 'Fish for the table'
      persistSave(save);
      const item = ITEM_BY_ID[pick];
      scene.flashLoot(`🐟 ${item?.name || pick}`, '#7adcff', 1, pick);
      if (shiny) scene.awardShinyBonus(pick, sx, sy);
    }, castMs, 5, 'rod');   // castMs = locked cast time (9s bare / 3s rod); 5 = cancel refund
    return true;
  }},

  // 2a-cave-wall) A solid cave wall blocking the player can be mined out like a
  // plain ground rock: tap it within reach to dig it into walkable floor and
  // collect stone. Underground only; no pick tier required (it's plain rock).
  // The wall (a surface road/building/water footprint mirrored below ground) is
  // converted in the live tile grid AND remembered in save.dugWalls so the dug
  // passage survives a tile reload (see app.js digCaveWall / _applyDugWalls).
  { name: 'cave-wall', try: (ctx) => {
    const { scene, save, sx, sy, cell, cellIX, cellIY, cwmx, cwmy } = ctx;
    if ((scene.depth ?? 0) <= 0) return false;
    if (cell.type !== TERRAIN.CAVE_WALL) return false;
    const cost = effectivePickCost(save.relics);
    if (cost && !scene.spendEnergy(cost, sx, sy)) return true;   // can't afford — tap consumed
    const durMs = toolDurationMs(save.relics, 'pick');
    // First dig the save ever starts tells its story - after the spend, so a
    // tap that could not afford it tells none.
    scene._toolActionStory?.('dig');
    scene.startWorkProgress(cwmx, cwmy, () => {
      scene.digCaveWall(cell.tx, cell.ty, cell.ix, cell.iy, cellIX, cellIY);
      // A wall pays the wall's own table (interactables.js caveWallDrop) —
      // one stone, flint on 30 % — the same one the auto-mine pays.
      const qty = caveWallDrop(scene);
      persistSave(save);
      const item = ITEM_BY_ID['rockfruit'];
      scene.flashLoot(`+${qty} ${item?.name || 'Stone'}`, '#a7ffb0', 1, 'rockfruit');
    }, durMs, cost || 0, 'pick');
    return true;
  }},

  // 2b) Tap non-tillable terrain → flavor label. A road-BAND cell (grass in
  // the grid, asphalt on screen — see isTillableCell) lands here too and
  // reads as road, matching what the player is looking at.
  { name: 'flavor', try: (ctx) => {
    const { scene, sx, sy, cell } = ctx;
    if (isTillableCell(cell)) return false;
    const flavor = TERRAIN_FLAVOR[cell.underRoad ? TERRAIN.ROAD : cell.type] || '·';
    scene.flash(flavor, sx, sy);
    return true;
  }},

  // 2c) Tilled empty cell: with a seed → plant. Without one, say so.
  //
  // A tap on tilled soil never un-tills it (players tap it to ask "what now?");
  // it only says what is missing.
  { name: 'plant', try: (ctx) => {
    const { scene, save, sx, sy, cellKey, cwmx, cwmy } = ctx;
    if (!scene.tilledSet.has(cellKey)) return false;
    const sel = getSelectedSlot(save);
    const item = sel ? ITEM_BY_ID[sel.id] : null;
    if (!item || item.kind !== 'seed') {
      scene.flash('Pick a seed from your bag.', sx, sy);
      return true;
    }
    if ((sel.count ?? 0) <= 0) {
      scene.flash('That pouch is empty.', sx, sy);
      return true;
    }
    if (!scene.spendEnergy(ENERGY_COST?.plant ?? 0, sx, sy)) return true;
    if (item.plants) {
      // Plant a sapling → a growing tree (persisted in save.fruittrees,
      // re-injected per tile in spawnInTile). TWO kinds share this path and
      // this list:
      //   `plants:'tree'` (the ACORN) → a `tree` object: timber, chopped for
      //       wood like any other, its growth stage read off planted_t by
      //       util.js treeGrowthStage so the frame, the axe gate and the wood
      //       yield all climb together over the same PLANTED_TREE_GROW_MS.
      //   otherwise (apple / peach) → a `fruittree`: picked, not chopped. It
      //       advances through the species sheet's life-cycle frames and bears
      //       fruit at maturity (render.js fruittree spec + the fruittree
      //       harvest handler).
      const asTree = item.plants === 'tree';
      save.fruittrees = save.fruittrees || [];
      const id = `${asTree ? 'ptr' : 'pft'}_${Math.round(cwmx)}_${Math.round(cwmy)}`;
      const planted_t = Date.now();
      if (!save.fruittrees.some(f => f.id === id)) {
        save.fruittrees.push({ x: cwmx, y: cwmy, species: item.grows, planted_t, id,
                               ...(asTree ? { kind: 'tree' } : {}) });
      }
      // It's a tree now, not soil - drop the tilled marker and its bed quality.
      scene.tilledSet.delete(cellKey);
      Crops.clearBedQuality(save, cellKey);
      // Inject the growing fruittree straight into the covering tile's LIVE
      // cache entry (mirrors spawnInTile's fruittree block) so it appears at
      // once. Deleting the cache entry would drop
      // the tile's ground `grid`, so the synchronous ground render fell back to
      // grass for every cell (the "whole landscape goes green" crash) until the
      // async loadTile re-fetched the tile. See render.js GRASS_FALLBACK_COLOR.
      const tEdge = scene.tileEdgeM;
      const tx = Math.floor(cwmx / tEdge), ty = Math.floor(cwmy / tEdge);
      const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
      if (entry) {
        entry.objects = entry.objects || [];
        if (!entry.objects.some(o => o.id === id)) {
          entry.objects.push(asTree
            ? WorldGen.makeObject('tree', cwmx, cwmy, id, { planted: true, planted_t })
            : WorldGen.makeObject('fruittree', cwmx, cwmy, id,
                { species: item.grows, planted: true, planted_t }));
        }
      }
      consumeSelected(save);
      ctx.dirty = true;
      scene.buildInventoryDOM();
      // NAMES, not ids — 'planted apple sapling' read as a stray database row
      // beside every other loot toast (QC_RULES §4). The tree branch says what
      // it will become, since a bare 'a tree' is the one plant whose payoff is
      // days away and needs to read as deliberate.
      scene.flash(asTree ? `\ud83c\udf31 Timber tree planted — ${shortDuration(PLANTED_TREE_GROW_MS)}.`
                         : `\ud83c\udf31 ${cropName(item.grows)} sapling planted.`, sx, sy);
      scene.questEvent?.('plant');
      return true;
    }
    // The crop takes the bed's quality with it — the hoe tier that tilled this
    // cell (Crops.takeBedQuality clears the cell's entry as it hands it over).
    save.planted.push({ x: cwmx, y: cwmy, crop: item.grows, stage: 0, watered_t: 0,
      depth: scene.depth ?? 0, qualBoost: Crops.takeBedQuality(save, cellKey) });
    Crops.invalidateSpatialIndex(save);
    consumeSelected(save);
    ctx.dirty = true;
    scene.buildInventoryDOM();
    // 'planted rainberry' → 'Planted Rainberry — water it.' The nudge is the
    // point: a seed does nothing at all until its first watering, and this is
    // the moment the player is looking at the cell.
    scene.flash(`\ud83c\udf31 ${cropName(item.grows)} — water it.`, sx, sy);
    scene.questEvent?.('plant');
    return true;
  }},

  // 2d) Untilled tillable cell → till it (refuses if occupied by any interactable).
  { name: 'till', try: (ctx) => {
    const { scene, save, sx, sy, cell, cellKey, cwmx, cwmy } = ctx;
    const cellHalfM = scene.cellM / 2;
    const pickedAll = new Set([...(save.picked || []), ...(save.burnedObjects || [])]);
    let blocker = null;
    if (scene.placedRockSet.has(cellKey)) blocker = 'Your own stone fence.';
    if (!blocker) {
      const pp = save.planted.find(p => inPlantedCell(p, cwmx, cwmy, cellHalfM));
      if (pp) blocker = `${cropName(pp.crop)} grows here.`;
    }
    if (!blocker) {
      const spentTill = spentSets(scene, save);
      for (const e of WorldGen.tileCache.values()) {
        const wp = (e.wildplants || []).find(wp => !pickedAll.has(wp.id) && Math.abs(wp.x - cwmx) < cellHalfM && Math.abs(wp.y - cwmy) < cellHalfM);
        if (wp) { blocker = `Pick ${cropName(wp.crop)} first.`; break; }
        const oo = (e.objects || []).find(o =>
          // Spent generated objects leave their cell. A spent barrel remains
          // a blocker because its smashed art still stands in the world.
          !(isSpent(o, spentTill) && !isBarrel(o)) &&
          Math.abs(o.x - cwmx) < cellHalfM && Math.abs(o.y - cwmy) < cellHalfM);
        if (oo) { blocker = tillBlockerLine(oo); break; }
      }
    }
    if (blocker) { scene.flash(blocker, sx, sy); return true; }
    // Hoe relic discounts (and sometimes zeroes out) the till cost.
    const tillCost = effectiveTillCost(save.relics);
    if (!scene.spendEnergy(tillCost, sx, sy)) return true;
    // Tilling runs a WORK WHEEL. Duration follows the shared tool ladder via the
    // hoe slot (bare hands 9s; a Hoe relic speeds it by tier). GRASSLAND-biome
    // cells till in HALF the time (spec §cells). Energy is pre-spent and refunds
    // if the player cancels the wheel.
    let tillMs = toolDurationMs(save.relics, 'hoe');
    // Global 2× tilling speed-up — applied on top of the tool-tier ladder and
    // the grassland half-time below, so every till is twice as fast everywhere.
    tillMs = Math.round(tillMs / 2);
    if (GRASSLAND_TILL.has(cell.type)) tillMs = Math.round(tillMs / 2);
    // First furrow the save ever turns tells its story, as the wheel starts.
    scene._toolActionStory?.('till');
    const startingTier = save.relics?.hoe?.tier || 0;
    scene.startWorkProgress(cwmx, cwmy, () => {
      scene.tilledSet.add(cellKey);
      // The bed remembers the hoe that made it - that's the produce QUALITY a
      // crop planted here will carry (Crops.bedQuality). A better hoe is
      // therefore a better harvest, not just a cheaper one.
      const bedQ = Crops.setBedQuality(save, cellKey, save.relics?.hoe?.tier || 0);
      persistSave(save);
      scene.flash(bedQ ? `tilled — quality ${bedQ}` : 'tilled', sx, sy);
      scene.questEvent?.('till');
      // Now and then the hoe turns something up (items.js rollTillFind).
      const find = rollTillFind(Math.random, save.relics?.hoe?.tier || 0);
      if (find?.kind === 'treasure') {
        grantFoundTreasure(scene, save, sx, sy, '⛏', find.tier, '✨ BURIED TREASURE ✨');
        persistSave(save);
      } else if (find?.kind === 'item') {
        scene.addToInv(find.id, 1);
        persistSave(save);
        scene.flashLoot(`+1 ${ITEM_BY_ID[find.id]?.name || find.id}`, '#a7ffb0', 1, find.id);
      }
      scene._barehandWorkStory?.('hoe', startingTier);
    }, tillMs, tillCost, 'hoe');
    return true;
  }},
];

// Tap diagnostics. "Taps randomly stop working" is otherwise invisible — the
// DOM inventory bar keeps working because it isn't a canvas tap, so the only
// signal is that the world stops responding. When window.DEBUG_TAPS is on, this
// surfaces WHY a canvas tap produced no visible action: it flashes near the tap
// AND logs to console. Three telltales it distinguishes:
//   • "outside play area"  → the view-bounds guard rejected it; if EVERY tap
//      (even centre-screen) says this, scene.viewLeft/viewSize are corrupt.
//   • "an action was in progress" → a work wheel ate the tap (a STUCK wheel
//      shows this on every tap while nothing visibly progresses).
//   • "nothing here responded" → reached the handlers but none matched.
// The ABSENCE of any flash on a debug tap is itself the clue that the tap never
// reached interactTap at all (Phaser input disabled or an overlay swallowing it).
function _tapDiag(scene, sx, sy, reason) {
  if (typeof window === 'undefined' || !window.DEBUG_TAPS) return;
  try { console.debug('[tap]', reason, `@(${Math.round(sx)},${Math.round(sy)})`); } catch (_) {}
  if (typeof scene.flash === 'function') scene.flash(`⚠ ${reason}`, sx, sy);
}

function interactTap(scene, sx, sy) {
  if (sx < scene.viewLeft || sx > scene.viewLeft + scene.viewSize ||
      sy < scene.viewTop  || sy > scene.viewTop  + scene.viewSize) {
    _tapDiag(scene, sx, sy,
      `tap outside play area — x${Math.round(sx)} ∉ [${Math.round(scene.viewLeft)},`
      + `${Math.round(scene.viewLeft + scene.viewSize)}], y${Math.round(sy)} ∉ `
      + `[${Math.round(scene.viewTop)},${Math.round(scene.viewTop + scene.viewSize)}]`);
    return;
  }
  const wm = scene.screenToWorldMeters(sx, sy);
  // The player's position is NOT carried on ctx: every reach test goes through
  // tooFar → cellInReach (coords.js), which reads the player's feet cell off
  // the scene itself, so the handlers only need the tap.
  const ctx = { scene, save: scene.save, wm, sx, sy, dirty: false };
  let consumedBy = null;
  for (const h of TAP_HANDLERS) {
    const consumed = h.try(ctx);
    if (consumed === true || consumed === 'far') { consumedBy = h.name; break; }
  }
  if (ctx.dirty) persistSave(scene.save);
  // Surface the "my tap did nothing" cases so the player can see the cause.
  if (!consumedBy) {
    _tapDiag(scene, sx, sy, 'nothing here responded to the tap');
  } else if (consumedBy === 'work-progress') {
    _tapDiag(scene, sx, sy, 'an action was in progress — tap cancelled it');
  }
}
