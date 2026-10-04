// Entity-driven interactable registry.
//
// World objects the player taps (trees, ore rocks, fruit trees, …) are
// described here, not in an if/else chain on `o.kind`. Three orthogonal
// concerns per kind:
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
// TIER_BY_NUM, chestTier (loot.js), isShiny, SHINY_RATE, randInt, pickFromArray, ITEM_BY_ID,
// persistSave, toolDurationMs) are globals from util.js / items.js / save.js,
// all loaded before this module.

// ── Shared world-object predicates ─────────────────────────────────────────
// Three kind tests that were spelled out as `o.kind === 'a' || o.kind === 'b'`
// in render.js / interact.js / worldgen.js / multiplayer.js / shops_math.js.
// They live here because interactables.js is the registry every consumer
// already loads before itself, and because a new kind that joins one of these
// groups has to join it EVERYWHERE at once — a tower that is a castle to the
// shop but not to the renderer is the drift these replace.
// Each says what it is NOT, so the next reason lands in the right lane.

// The CASTLE — the one building that never gates a deal and wears the tier-12
// rampart. NOT "big" (a fort is tier 11 and gates at 5/hour) and NOT "has a
// turret sprite": a `tower` IS the castle's turret, so the kind and the tier
// are two spellings of the same building, not two conditions.
function isCastle(o) {
  return !!o && (o.kind === 'tower' || o.tier === 12);
}

// The two kinds that draw as a TREE — a shiny sheen, a canopy against a wall,
// a name in the peer readout. NOT "you can chop it" (a fruittree is harvested,
// never felled — see INTERACTABLES.fruittree) and NOT "wooden".
function isTreeLike(kind) {
  return kind === 'tree' || kind === 'fruittree';
}

// The house/tower PAIR — the two object kinds that are a building you tap to
// open a shop. NOT "has a footprint" (BUILDING_TYPES is the terrain-side test,
// and a market stall / shrine / pot-of-gold has art without being either of
// these) and NOT "exempt from the one-cell seat rule", which is a longer list.
function isBuilding(kind) {
  return kind === 'house' || kind === 'tower';
}

// Each ordinary surface chest keeps its disguise across reloads and visits.
// A separate seeded stream leaves its loot and all world placement unchanged.
function chestHidesMimic(o) {
  return !!o && o.kind === 'chest' && !!o.id && !(o.depth > 0)
    && !o.fixedLoot && !o.crate && !restocks(o) && !macroFor(o)
    && !isPotOfGold(o) && !isBikeRack(o) && !isBarrel(o) && !produceStandFor(o)
    && chestTier(o) === 2 && makeRng32(fnv1a(o.id + '#mimic'))() < 0.15;
}

// ---- Slow grind ------------------------------------------------------------
// A tool job EXACTLY one tier out of reach (bare hands = tier 0 included) is
// not refused outright: the player can choose to grind it out with what they
// have — a long fixed wheel at a steep flat energy price. See the gate branch
// in runInteractable.
const SLOW_GRIND_MS = 30000;
const SLOW_GRIND_ENERGY = 15;

// A chest's HARDCODED payload → the reward shape pickReward would have
// returned, so both kinds of chest leave the handler down the same paths.
//
// Two payload shapes exist. `{id, qty}` is a stack of an item (the four spawn
// supply crates). `{kind:'relic'|'armor', slot, tier}` is a piece of gear (the
// spawn relic chest's wooden tool) — and gear cannot simply be handed over the
// way an item can: the player may already be wearing something better in that
// slot by the time they open it, and equipping the fixed payload regardless
// would DOWNGRADE them for opening a chest. reconcileRelicOffer is the rule
// the rest of the game settles that with (walk the slot up from what's owned,
// cash out to gold along the way), so a fixed gear payload goes through it too
// — meaning the payload names the FLOOR of what the chest is worth, not a
// promise that this exact tier is what comes out.
function fixedChestReward(fixedLoot, save) {
  if (!fixedLoot) return null;
  if (fixedLoot.kind === 'relic' || fixedLoot.kind === 'armor') {
    const offer = { kind: fixedLoot.kind, slot: fixedLoot.slot, tier: fixedLoot.tier, jackpot: 0 };
    // reconcileRelicOffer handles both gear kinds (rolled.kind picks the right
    // save table — relics vs armor) — see rarity.js. Route BOTH here, not just
    // relic, so a fixed armor payload can't downgrade equipped armor either.
    if (typeof reconcileRelicOffer === 'function') {
      const out = reconcileRelicOffer(offer, save, Math.random);
      if (out) { out.consolation = 0; return out; }
    }
    return offer;
  }
  return { kind: 'item', id: fixedLoot.id, qty: fixedLoot.qty, consolation: 0 };
}

// Plain-rock base drop: rockfruit + a 10% chance of one coal. Shared by the
// mineralrock 'isPlain' branch below AND the cave-wall dig handler in
// interact.js (loaded after this module, so the runtime reference is safe) —
// both used to hardcode this table separately. Only the BASE table lives
// here: mineralrock layers its own bar-chance loop on top afterward, while
// cave walls take the base table as-is — that split is deliberate, not an
// oversight.
//
// `stones` is HOW MANY STONES THE SPRITE SHOWS (SpriteLayout.plainRockStones —
// 2 for the pair variant, 1 for the singles); the rock pays out EXACTLY that
// many — no roll, so a pair is always 2 and a single always 1, and what you
// see is what you get.
// Flint on PLAIN_ROCK_FLINT_P of breaks.
const PLAIN_ROCK_FLINT_P = 0.10;
// Copper stays at 1/8; the extra rarity rises smoothly to 3x at Frost.
// These are independent bonus rolls on ordinary rocks, not the guaranteed
// primary bar paid by a named ore deposit.
function plainRockBarChance(tier) {
  if (!Number.isInteger(tier) || tier < 2 || tier > 7) return 0;
  return 1 / (2 * tier * tier * Math.pow(3, (tier - 2) / 5));
}
function plainRockBaseDrop(scene, stones) {
  const qty = stones == null ? 1 : stones;
  scene.addToInv('rubble', qty);
  if (Math.random() < PLAIN_ROCK_FLINT_P) scene.addToInv('flint_shard', 1);
  return qty;
}
// A PLAIN rock: a cave rock or a T1 surface rock with no named deposit —
// bare-hand-breakable, drawn off SpriteLayout.PLAIN_ROCK_VARIANTS, paid off
// the base table above. The one test the gate, the tier-shortfall, the
// completion and the glint below all read.
function isPlainRock(o) {
  return !!o && !mineralDeposit(o) && (o.caveVariant != null || (o.yieldTier || 1) <= 1);
}

// Quarry rubble takes more work for one stone; ore deposits and walls keep
// their own costs and yields. Bonus finds still use the ordinary rock rolls.
const QUARRY_ROCK_RULES = Object.freeze({ energyMul: 1.5, stones: 1 });
function quarryRockRules(o) {
  return o?.kind === 'mineralrock' && o.zone === 'quarry' && isPlainRock(o) ? QUARRY_ROCK_RULES : null;
}

// One first find per surface quarry, shared by every tile seeing its anchor.
// Existing sapphire loot satisfies the find rather than duplicating it.
const QUARRY_SAPPHIRE_CHANCE = 0.10;
function quarrySapphire(ctx, rock, alreadyFound = false, rng = Math.random) {
  const { scene, save } = ctx;
  if ((scene.depth || 0) !== 0 || !scene.cellAt || typeof Zones === 'undefined') return false;
  const cell = scene.cellAt(rock.x, rock.y);
  const entry = WorldGen.tileCache.get(WorldGen.tileKey(cell.tx, cell.ty));
  const zone = Zones.at(entry, cell.ix, cell.iy);
  if (zone?.kind !== 'quarry') return false;
  const key = `${zone.anchor.gx},${zone.anchor.gy}`;
  const mined = save.quarryMined = save.quarryMined || {};
  const reward = !mined[key] || rng() < QUARRY_SAPPHIRE_CHANCE;
  mined[key] = true;
  if (!reward && !alreadyFound) return false;
  if (!alreadyFound) {
    scene.addToInv('sapphire', 1);
    scene.flashLoot('+1 Sapphire', '#a7ffb0', 1, 'sapphire');
  }
  scene.showMessageModal?.({ art: 'quarry_sapphire', title: 'Inside the rock',
    body: 'Inside the rock... a glowing sapphire.\n<em>precious...</em>' });
  return true;
}

// The gem an ORE rock (T4+) may hold beside its bar, per yield tier, and how
// often. The T7 (frost) rock's headline gem is the diamond — listed FIRST so
// it reads as the primary — with the emerald as its secondary. pickFromArray
// rolls the list uniformly. Both tables are also what the glint rock's
// crystal odds derive from (GLINT_ROCK_FINDS).
const GEM_BY_TIER = { 4: ['sapphire'], 5: ['ruby'], 6: ['emerald'], 7: ['diamond', 'emerald'] };
const GEM_P_BY_TIER = { 4: 0.25, 5: 0.35, 6: 0.40, 7: 0.50 };

// ── The GLINT ROCK ────────────────────────────────────────────────────────
// One plain rock in twenty (SHINY_RATE.rock, off the rock's id like every
// shiny — the same rocks glint for every player, and a cave rock's id is its
// cell too) catches the light for a moment every 10-60 s. Breaking it pays
// what any plain rock pays PLUS ONE GUARANTEED FIND, drawn from the plain
// rock's own rarity ladder: flint at its base chance, each bar at its bonus
// chance, and a crystal — the sapphire, the T4 gem — at the gold rock's own
// gem odds against its bar (GEM_P_BY_TIER[4] × the T4 bar chance). So a
// glint rock's find is most often flint or copper, sometimes iron, rarely a
// gem — the ordinary luck of a hundred rocks, promised on this one.
// Identity and drop are ONE predicate (isGlintRock); render.js reads it for
// the glint and never keeps a list of glinting rocks.
function isGlintRock(o) {
  return isPlainRock(o) && isShiny(o.id, SHINY_RATE.rock);
}
const GLINT_ROCK_FINDS = Object.freeze([
  Object.freeze({ id: 'flint_shard', weight: PLAIN_ROCK_FLINT_P }),
  ...[2, 3, 4, 5, 6, 7].map(t => Object.freeze({ id: mineralBarId(t), weight: plainRockBarChance(t) })),
  Object.freeze({ id: GEM_BY_TIER[4][0], weight: GEM_P_BY_TIER[4] * plainRockBarChance(4) }),
]);
function glintRockFind(rng) {
  return weightedPickBy(GLINT_ROCK_FINDS, f => f.weight, rng).id;
}
// When a glint rock glints: its own BEAT (util.js beatPhase) — a period of
// 10-60 s off the rock's id, the glint showing GLINT_ROCK_SHOW_MS once per
// period. Returns the glint's progress 0..1 while it shows, else -1.
const GLINT_ROCK_PERIOD_MS = Object.freeze({ min: 10000, max: 60000 });
const GLINT_ROCK_SHOW_MS = 700;
const GLINT_ROCK_BEAT = Object.freeze({ salt: 'glint', minMs: GLINT_ROCK_PERIOD_MS.min, maxMs: GLINT_ROCK_PERIOD_MS.max, showMs: GLINT_ROCK_SHOW_MS });
function glintRockPeriodMs(id) { return beatPeriodMs(id, GLINT_ROCK_BEAT); }
function glintRockPhase(id, nowMs, revealStartedMs) { return beatPhase(id, nowMs, GLINT_ROCK_BEAT, revealStartedMs); }

// A CAVE WALL dug out — by a tap (interact.js cave-wall) or by walking into
// it (app.js auto-mine), both through here: always one stone, and flint on
// CAVE_WALL_FLINT_P of digs (a wall is where the flint is — a plain rock
// gives it a third as often).
const CAVE_WALL_FLINT_P = 0.30;
function caveWallDrop(scene) {
  scene.addToInv('rubble', 1);
  if (Math.random() < CAVE_WALL_FLINT_P) scene.addToInv('flint_shard', 1);
  return 1;
}

// 'a' or 'an' for a tier name. Iron is the only vowel-initial rung, and both
// tool gates read it out in a line short enough that the mistake is the whole
// sentence.
function tierArticle(name) {
  return /^[aeiou]/i.test(String(name)) ? 'an' : 'a';
}

// A page stone's interactable (INTERACTABLES.infoboard / .bottle) — see
// the note on those rows.
function pageStone({ title, art, spent, read }) {
  return {
    custom: (ctx, o) => {
      const { scene, save, sx, sy } = ctx;
      if ((save.opened || []).includes(o.id) || typeof scene._bookRead !== 'function') {
        scene.flash(spent, sx, sy);
        return true;
      }
      save.opened = [...(save.opened || []), o.id];
      const { body } = scene._bookRead();
      ctx.dirty = true;
      if (typeof scene.showMessageModal === 'function') {
        scene.showMessageModal({ title, body, kind: 'story', ...(art ? { art } : {}) });
      } else {
        scene.flash(read, sx, sy);
      }
      return true;
    },
  };
}

const INTERACTABLES = {
  // ---- Tree: chop with an axe for wood -------------------------------------
  // Bigger / harder trees demand a sturdier axe and pay out proportionally more
  // wood (treeWoodMul); softwood fells a tier easier, hardwood a tier harder
  // (treeAxeReqTier). A chopped stump is skipped so its cell stays tillable.
  tree: {
    tool: 'axe',
    spent: (o, ctx) => isSpent(o, spentSets(ctx.scene, ctx.save)),
    spentAction: 'skip',
    gate: (o, save) => {
      const reqTier = treeAxeReqTier(o);
      const axeTier = save.relics?.axe?.tier || 0;
      if (axeTier < reqTier) {
        const need = TIER_BY_NUM[reqTier]?.name || 'better';
        // The tool TIER is the only actionable half — the player is looking
        // at the tree they just tapped, so naming its species and the verb
        // spent twenty characters restating the obvious (util.js MAP_MSG_MAX).
        // `Iron` is the one tier name that starts with a vowel (tierArticle).
        return `Need ${tierArticle(need)} ${need} axe.`;
      }
      return null;
    },
    // How many tiers the current axe falls short (0/negative = able). Bare
    // hands are tier 0, so a tier-1 tree bare-handed is exactly 1 short —
    // that's the slow-grind case (see runInteractable).
    tierShort: (o, save) => treeAxeReqTier(o) - (save.relics?.axe?.tier || 0),
    energy: (save, o) => (typeof effectiveChopCost === 'function')
      ? effectiveChopCost(save.relics, o) : 0,
    complete: (ctx, o) => {
      const { scene, save, sx, sy } = ctx;
      const woodMul = treeWoodMul(o);
      const wood = randInt(2, 3) * woodMul;
      o.chopped = true;
      save.chopped = save.chopped || [];
      if (!save.chopped.includes(o.id)) save.chopped.push(o.id);
      // A tree the player PLANTED (an acorn) lives in save.fruittrees and is
      // re-injected into its tile on every load. Felling it has to retire the
      // record, or spawnInTile keeps rebuilding a tree that only the chopped
      // list hides — and the list grows a dead entry per fell, forever.
      if (o.planted && save.fruittrees) {
        save.fruittrees = save.fruittrees.filter(f => f.id !== o.id);
      }
      scene.addToInv('wood', wood);
      // ACORN — the axe tier's other reward (acornDropChance, items.js): a
      // sapling that plants a new timber tree, so a felled wood can be
      // replanted. ACORN_P_BASE bare-handed, climbing geometrically to
      // ACORN_P_FROST with a Frost axe (10% → certain, today).
      const gotAcorn = Math.random() < acornDropChance(save.relics);
      if (gotAcorn) scene.addToInv('acorn', 1);
      persistSave(save);
      // Say what came off the tree, like mining / harvesting / fishing do.
      // The glyph follows the species: conifers keep 🌲,
      // everything else gets the broadleaf 🌳.
      const conifer = /pine|fir|spruce|cedar/i.test(treeSpeciesName(o) || '');
      scene.flash(o.size === 'bush' ? `🌿 Cleared a bush.`
                : `${conifer ? '🌲' : '🌳'} Felled ${treeSpeciesName(o)} tree.`, sx, sy);
      scene.flashLoot(`+${wood} ${ITEM_BY_ID.wood?.name || 'Wood'}`, undefined, 1, 'wood');
      if (gotAcorn) scene.flashLoot(`+1 ${ITEM_BY_ID.acorn?.name || 'Acorn'}`, '#d9b382', 1.1, 'acorn');
      // Rare shiny tree — 10× wood value in cash + a memory.
      if (isShiny(o.id, SHINY_RATE.tree)) scene.awardShinyBonus('wood', sx, sy);
    },
  },

  // ---- Mineral rock: mine with a pick for stone / ore / gems ---------------
  // "Plain rock" (a cave variant or a T1 deposit) is bare-hand-breakable and
  // drops stone + a small chance of a sliver of ore. Ore rock (T2+) is pick-tier
  // gated and drops exactly one namesake bar + coal + tier-rolled gems.
  mineralrock: {
    tool: 'pickaxe',
    spent: (o, ctx) => isSpent(o, spentSets(ctx.scene, ctx.save)),
    spentAction: 'consume',
    gate: (o, save) => {
      const deposit = mineralDeposit(o);
      if (isPlainRock(o)) return null;   // plain rock is ungated
      const pickTier = save.relics?.pickaxe?.tier || 0;
      const reqTier = deposit?.requiredTier || o.requiredTier || Math.max(1, (o.yieldTier || 1) - 1);
      if (pickTier < reqTier) {
        const need = TIER_BY_NUM[reqTier]?.name || 'better';
        return `Need ${tierArticle(need)} ${need} pick.`;
      }
      return null;
    },
    // Tier shortfall for the slow-grind offer — same req the gate reads.
    // Plain rock is ungated, so it never reports short.
    tierShort: (o, save) => {
      const deposit = mineralDeposit(o);
      if (isPlainRock(o)) return 0;
      const reqTier = deposit?.requiredTier || o.requiredTier || Math.max(1, (o.yieldTier || 1) - 1);
      return reqTier - (save.relics?.pickaxe?.tier || 0);
    },
    // Shared tool-tier baseline (9 bare → 1 Frost via effectivePickCost) OR a
    // +9-per-tier surcharge when the rock out-tiers the pick, whichever is more.
    energy: (save, o) => {
      const pickTier = save.relics?.pickaxe?.tier || 0;
      const rockTier = mineralDeposit(o)?.yieldTier || o.yieldTier || 1;
      const cost = Math.max(effectivePickCost(save.relics), 9 * (rockTier - pickTier));
      // Energy uses whole pips; preserve the 50% increase in expectation.
      return probEnergy(cost * (quarryRockRules(o)?.energyMul || 1));
    },
    complete: (ctx, o) => {
      const { scene, save } = ctx;
      scene.brokenRockSet.add(o.id);
      let sapphireFound = false;
      const addLoot = (id, n) => {
        if (id === 'sapphire') sapphireFound = true;
        scene.addToInv(id, n);
      };
      const deposit = mineralDeposit(o);
      if (deposit) {
        addLoot(deposit.item, deposit.quantity);
        quarrySapphire(ctx, o, sapphireFound);
        persistSave(save);
        scene.flashLoot(`+${deposit.quantity} ${ITEM_BY_ID[deposit.item]?.name || deposit.item}`, '#a7ffb0', 1, deposit.item);
        return;
      }
      if (isPlainRock(o)) {
        // Plain rock — stone, coal on ~10% (shared base table, see
        // plainRockBaseDrop), plus the shared, tier-steepened bonus-bar
        // chances, on top of the base — and, on a GLINT rock, one
        // guaranteed find off that same ladder (glintRockFind).
        // Quarry rubble pays one stone regardless of its pile silhouette.
        // Elsewhere the original pair/single artwork still owns the quantity.
        const qty = plainRockBaseDrop(scene, quarryRockRules(o)?.stones ?? SpriteLayout.plainRockStones(o));
        let flashId = 'rubble';
        for (let t = 2; t <= 7; t++) {
          if (Math.random() < plainRockBarChance(t)) {
            const bar = mineralBarId(t);
            if (bar) { addLoot(bar, 1); flashId = bar; }
          }
        }
        if (isGlintRock(o)) {
          // The glint's promise: one find, always, rolled AFTER the chance
          // rolls so it upstages them in the toast. A crystal is a gem find
          // and takes the ore rock's jackpot fanfare.
          const find = glintRockFind();
          addLoot(find, 1);
          flashId = find;
          if (GEM_BY_TIER[4].includes(find) && typeof scene.flashJackpot === 'function') scene.flashJackpot(1);
        }
        quarrySapphire(ctx, o, sapphireFound);
        persistSave(save);
        const item = ITEM_BY_ID[flashId];
        // Report the REAL count. A bar upstages the stones in the toast and
        // only ever drops one at a time, so it stays "+1"; stones say how many
        // actually went in the bag — this line read "+1 Rock" while handing
        // over three, the one loot path that under-reported itself (the cave
        // wall's own toast in interact.js has always flashed its qty).
        const flashQty = (flashId === 'rubble') ? qty : 1;
        scene.flashLoot(`+${flashQty} ${item?.name || flashId}`, '#a7ffb0', 1, flashId);
        return;
      }
      // Ore-bearing rock — exactly ONE bar of the indicated type, plus a coal
      // nugget and a tier-rolled gem on T4+.
      addLoot('flint_shard', randInt(1, 2));
      const t = o.yieldTier || 1;
      const primaryBar = mineralBarId(t) || mineralBarId(2);
      addLoot(primaryBar, 1);
      let flashId = primaryBar;
      let gemsFound = 0;
      // One gem per tier of the ladder (GEM_BY_TIER / GEM_P_BY_TIER above).
      const gems = GEM_BY_TIER[t];
      if (gems && Math.random() < (GEM_P_BY_TIER[t] || 0)) {
        const gemId = pickFromArray(gems);
        addLoot(gemId, 1);
        flashId = gemId;
        gemsFound++;
      }
      // T7 rocks have a bonus 25% chance for a second ruby on top — a lesser
      // gem, so the diamond stays the T7 headline.
      if (t === 7 && Math.random() < 0.25) {
        addLoot('ruby', 1);
        flashId = 'ruby';
        gemsFound++;
      }
      quarrySapphire(ctx, o, sapphireFound);
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
  // via `custom`. A planted sapling must mature (PLANTED_TREE_GROW_MS, a day)
  // before its first pick,
  // and each tree fruits once per 24h.
  fruittree: {
    custom: (ctx, o) => {
      const { scene, save, sx, sy } = ctx;
      const now = Date.now();
      const state = Crops.fruitTreeState(o, save.fruitPicked?.[o.id], now);
      if (!state.ready) {
        const left = shortDuration(state.remainingMs);
        if (state.mature) scene.flash(`Picked — ripe again in ${left}`, sx, sy);
        else scene.flash(`Still growing — ${left}`, sx, sy);
        return true;
      }
      save.fruitPicked = save.fruitPicked || {};
      save.fruitPicked[o.id] = now;
      // A fruit tree's species IS the item it hands out, so it must be one.
      // The starter provisioning once tamed the fruit tree nearest spawn into
      // species 'pine' (home.js makeStarterUsable — fixed there), and 'pine'
      // is not an item: the pick flashed "harvested pine" and Inventory.add
      // dropped it on the floor. The source is fixed, but the bin objects a
      // tile is rebuilt from are shared for the session and a stale cached
      // home.js can still stamp them, so the tree repairs itself here: a
      // species that is not a produce item reverts to apple, in place, so the
      // pick, the flash and the shiny bonus all agree on one real fruit.
      if (!ITEM_BY_ID[o.species] || ITEM_BY_ID[o.species].kind !== 'produce') o.species = 'apple';
      const n = randInt(1, 2);
      scene.addToInv(o.species, n);
      ctx.dirty = true;
      const item = ITEM_BY_ID[o.species];
      scene.flashLoot(`harvested ${item?.name || o.species}`, '#a7ffb0', 1, o.species);
      // Rare shiny fruit tree — 10× fruit value in cash + a memory.
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
    // Chest loot IS luck-aware, but not from here: pickReward() (rarity.js)
    // reads permanent luck straight off `save`. The GATHER drops in this
    // registry (wood, ore, gems, fruit) are not — the declarative `luck` field
    // that would have made them so shipped switched OFF and was removed.
    custom: (ctx, o) => {
      const { scene, save, sx, sy } = ctx;
      // A POT OF GOLD (an ATM — loot.js isPotOfGold) hijacks the chest tap
      // before the standard open-and-loot path. It never goes into
      // save.opened — it is gated by the day ledger (Macros.usedToday) so it
      // refreshes daily, and produces world-scattered coin pickups instead
      // of inventory loot. A cave-level mirror is a plain chest.
      if (isPotOfGold(o)) {
        if (typeof scene._coinBurstInteract === 'function') {
          scene._coinBurstInteract(sx, sy, o);
          return true;
        }
        // Fall through to default chest behaviour if the method isn't wired
        // (defensive — keeps these POIs usable if app.js is out of sync).
      }
      // A BIKE RACK (loot.js isBikeRack): a stick-walk speed boost, once a
      // UTC day per rack — the day ledger, lit while it is there (poiLit).
      // The boost itself is a REASON in the stick-walk speed lane
      // (save.bikeUntil, read by app.js _walkRelics → items.js
      // steerSpeedMul), not a speed system of its own.
      if (isBikeRack(o) && typeof Macros !== 'undefined') {
        return Macros.dailyVisit(ctx, o, { grant: () => {
          save.bikeUntil = Math.max(save.bikeUntil || 0, Date.now() + BIKE_RACK_MS);
          scene.flash(bikeRackFlash(), sx, sy);
        } });
      }
      if (Macros.visitKindForObject(o) === Macros.DAILY_VISIT_KINDS.wagon) {
        return Macros.hireMercenary(ctx, o);
      }
      // Pots and barrels smash once. Keep their broken remains and record
      // the take in the permanent chest ledger, including empty rolls.
      if (isBarrel(o)) {
        save.opened ||= [];
        if (save.opened.includes(o.id)) {
          scene.flash('Already smashed.', sx, sy);
          return true;
        }
        save.opened.push(o.id);
        ctx.dirty = true;
        const got = rollBarrel(o);
        if (got.kind !== 'empty') Rewards.apply(save, got, scene);
        if (got.kind === 'gold') scene.flashLoot?.(barrelFlash(got), '#ffe066', 1, null, scene.coinIconEl?.());
        else if (got.kind === 'item') scene.flashLoot?.(barrelFlash(got), '#a7ffb0', 1, got.id);
        else scene.flash(barrelFlash(got), sx, sy);
        return true;
      }
      // Produce/food stands are MARKETS, not one-shot chests: tapping opens a
      // repeatable buy modal that SELLS the themed produce (loot.js
      // produceStandFor) at par value (PRICES[item], no shop markup). The stall
      // never goes into save.opened — a market doesn't get "picked clean".
      const stand = (typeof produceStandFor === 'function') ? produceStandFor(o) : null;
      if (stand && typeof scene.presentMarketStandOffer === 'function') {
        scene.presentMarketStandOffer(sx, sy, stand);
        return true;
      }
      // MACRO STALLS (loot.js macroFor — an inn, chapel, apothecary, …): a
      // place you come back to, never a chest. A tap is a VISIT, so a Scouting
      // report aimed at its class (QUEST_POIS: library, museum,
      // place_of_worship) is credited here, on every tap — a macro never opens. Every kind but
      // the chapel is a dialog (app.js presentMacro); the chapel pays through
      // THIS ceremony below, once a UTC day (the macro-service lane,
      // Macros.serviceUsedToday) and a tier humbler (Macros.chapelRollTier), and
      // never touches save.opened.
      const macro = (typeof macroFor === 'function') ? macroFor(o) : null;
      if (macro) {
        if (typeof Quests !== 'undefined' && o.poiClass && Quests.onPoiVisit(save, o.poiClass)) ctx.dirty = true;
        if (macro.kind !== 'chapel') {
          if (typeof scene.presentMacro === 'function') scene.presentMacro(sx, sy, o, macro);
          return true;
        }
      }
      const chapel = !!macro;
      const daily = !chapel && restocks(o) && typeof Macros !== 'undefined';
      const held0 = save.chestHold && save.chestHold[o.id];
      if (chapel) {
        // A left-for-later roll is still this chapel's (claimed when taken),
        // so it replays whatever the day.
        if (!held0 && typeof Macros !== 'undefined' && Macros.serviceUsedToday(save, o.id)) {
          scene.flash(`The chapel is quiet. ${shortDuration(msToNextUtcDay())}.`, sx, sy);
          return true;
        }
        // The first visit tells what the place is, and the blessing follows when
        // the story is tapped away (a story never opens on top of a dialog).
        if (typeof scene._macroStory === 'function' && scene._macroStory('chapel', () => {
          const again = { scene, save, sx, sy, dirty: false };
          INTERACTABLES.chest.custom(again, o);
          if (again.dirty && typeof persistSave === 'function') persistSave(save);
        }, o)) return true;
      } else if (daily) {
        // A crate (restocks) taken is bare for crateRestoreDays UTC days —
        // the day ledger, never save.opened. A left-for-later roll is still
        // its to take.
        const days = crateRestoreDays(o);
        if (!held0 && Macros.stillBare(save, o.id, days)) {
          scene.flash(`The crate is bare. ${shortDuration(Macros.restockWaitMs(save, o.id, days))}.`, sx, sy);
          return true;
        }
      } else if ((save.opened || []).includes(o.id)) { scene.flash('Picked clean already.', sx, sy); return true; }
      if (!held0 && chestHidesMimic(o) && scene._revealMimic?.(o)) {
        // The disguise is spent before another tap can open it or roll loot.
        // Defeating the revealed creature pays the ordinary monster reward.
        (save.opened ||= []).push(o.id);
        ctx.dirty = true;
        scene.flash('The chest snaps at you!', sx, sy);
        return true;
      }
      // The hero glyph every ceremony below opens with: the sprite this chest
      // was standing as, off the SAME resolver render.js draws it from
      // (loot.js chestLook), so a crate opens under a crate and a trunk under
      // a trunk instead of both under the TREASURE diamond. '' falls back to
      // the kind's emoji — a market stand and a coin-burst pot never reach
      // here (both return above), so in practice it is the trunk or the box.
      const iconLook = typeof chestLook === 'function' ? chestLook(o) : null;
      const kindIcon = (iconLook && scene.worldIconHTML)
        ? scene.worldIconHTML(iconLook.texKey, 26, iconLook.frame) : '';
      // The chapel's blessing opens on the chapel's own painting and name the place.
      const dress = (chapel && typeof Macros !== 'undefined')
        ? { art: Macros.KIND_TRANSACTION.chapel.art, header: Macros.KIND_TRANSACTION.chapel.title }
        : { art: chestOpeningArt(o) || undefined };
      // Every path below that actually spends the chest goes through this, so
      // the starter ladder's "open a crate" step is credited exactly once no
      // matter which branch (item / relic / gold / partial take) claimed it.
      // The chapel's "spend" is the day ledger's service lane, not
      // save.opened, and it is no chest for the 'chest' quest (its visit was
      // credited above). A daily crate spends into the plain lane beside it,
      // and is still a chest for both quest credits below — once per crate per UTC
      // day, because the gate above refuses a second open the same day.
      const markOpened = chapel ? () => { Macros.markServiceToday(save, o.id); } : () => {
        if (daily) Macros.markToday(save, o.id);
        else save.opened.push(o.id);
        scene.questEvent?.('chest');
        // BUG (Scouting report / QUEST_POIS): Quests.onPoiVisit is the only
        // thing that can credit a 'poi' quest, and its ONLY call site used to
        // be the well interactable below, hardcoded to the literal 'well'.
        // Six of QUEST_POIS's seven targets (fountain/library/museum/park/
        // place_of_worship/playground) never reach a well object — they land
        // on the world as plain kind:'chest' objects carrying that class as
        // o.poiClass (worldgen.js's POI 'USEFUL' set + loot.js POI_CATEGORY /
        // chestTier), so those quest slots sat on the board permanently
        // uncompletable (~1 in 20 generated slots, given the 'poi' template's
        // weight). Crediting from every chest open — not just from well — is
        // the fix: onEvent() only advances a poi-quest slot when its target
        // matches o.poiClass, so this is a no-op on every chest that isn't
        // the one a live quest is scouting for, and it can't double-credit
        // the 'chest' quest above (different `event` string, separate loop).
        // Firing it INSIDE markOpened (not the coin-burst / market-stand
        // shortcuts above, and not the "Picked clean already" / "leave for
        // later" paths that return before this runs) means a chest can only
        // ever award this once — exactly the same guarantee save.opened
        // already gives the 'chest' quest (a daily crate: once per UTC day,
        // the day ledger's guarantee).
        if (typeof Quests !== 'undefined' && o.poiClass) Quests.onPoiVisit(save, o.poiClass);
      };
      // A chest previously left-for-later has its exact loot saved in chestHold;
      // reopening replays that same roll. Fresh opens go through pickReward
      // which handles items AND relics (biome-specific weights).
      const held = held0;
      const chestT = chapel ? Macros.chapelRollTier(o)
        : ((typeof chestTier === 'function') ? chestTier(o) : 2);
      const theme = chestThemeFor(o);
      let result = held
        ? { kind: 'item', id: held.id, qty: held.n, consolation: held.consolation || 0 }
        // Starter chests carry a fixed payload (9 wood / 9 rockfruit / 9 seeds,
        // or the spawn relic chest's wooden tool) so the first restoration loop
        // is deterministic — skip the rarity picker and synthesize the same
        // shape it returns, then fall through to the normal paths below.
        : (o.fixedLoot
            ? fixedChestReward(o.fixedLoot, save)
            : (stand
                ? { kind: 'item', id: stand.item, qty: 2 + Math.floor(Math.random() * 3), consolation: 0 }
                : ((typeof pickReward === 'function')
                    ? pickReward('chest:' + theme, save, undefined, { tier: chestT, depth: chestLootDepth(o),
                        venueProduct: venueProductFor(o) })
                    : null)));
      result = Rewards.reconcileUnique(save, result);
      if (!result) {
        addMoney(save, 1);
        markOpened();
        ctx.dirty = true;
        scene.flash(`${chapel ? 'A quiet blessing. Go well.' : 'Chest had nothing useful.'}`, sx, sy);
        if (chapel) scene._macroTransaction?.('chapel', `You received ${scene.moneyHTML(1)} as today’s blessing.`);
        return true;
      }
      if (result.kind === 'relic' || result.kind === 'armor') {
        Rewards.apply(save, result, scene);
        markOpened();
        ctx.dirty = true;
        const name = (typeof gearName === 'function')
          ? gearName(result.kind, result.slot, result.tier)
          : result.slot;
        const iconHTML = scene.gearIconHTML
          ? scene.gearIconHTML(result.kind, result.slot, result.tier, 64) : '★';
        scene.showChestRewardModal({ ...dress, iconHTML, name, sub: 'equipped', color: UI_TREASURE, kindIcon,
                                     tier: result.tier });
        if (result.jackpot >= 1 && typeof scene.flashJackpot === 'function') {
          scene.flashJackpot(result.jackpot);
        }
        return true;
      }
      if (result.kind === 'gold' && !result.slot) {
        // PLAIN CASH — the 'cash' class (rarity.js), which a commerce chest
        // rolls more often than anything but its produce. No slot, so there is
        // no gear to name: it is a purse, and it says so. Told apart from the
        // gear cash-out below by exactly that field, the same test
        // interact.js grantTreasureRoll uses.
        markOpened();
        if (save.chestHold) delete save.chestHold[o.id];
        ctx.dirty = true;
        Rewards.apply(save, result, scene);
        scene.showChestRewardModal({ ...dress,
          iconHTML: scene.coinIconHTML ? scene.coinIconHTML(48) : '',
          name: `+${result.amount || 0}`, color: UI_GOLD, kindIcon,
        });
        if (result.jackpot >= 1 && typeof scene.flashJackpot === 'function') {
          scene.flashJackpot(result.jackpot);
        }
        return true;
      }
      if (result.kind === 'gold') {
        // Non-upgrade relic consolation (reconcileRelicOffer walked up and cashed out).
        markOpened();
        ctx.dirty = true;
        Rewards.apply(save, result, scene);
        const gearKind = result.gearKind || 'relic';
        const name = (typeof gearName === 'function')
          ? gearName(gearKind, result.slot, result.tier)
          : result.slot;
        const iconHTML = scene.gearIconHTML
          ? scene.gearIconHTML(gearKind, result.slot, result.tier, 64) : '★';
        scene.showChestRewardModal({ ...dress, iconHTML, name, sub: 'already own better — discarded', color: '#aaa',
                                     kindIcon, tier: result.tier });
        if (result.jackpot >= 1 && typeof scene.flashJackpot === 'function') {
          scene.flashJackpot(result.jackpot);
        }
        return true;
      }
      // kind === 'item'
      const lootId  = result.id;
      const lootQty = result.qty;
      const lootName = itemName(lootId).toString();
      const lootColor = (typeof tierInfo === 'function') ? tierInfo(lootId).color : UI_TREASURE;
      const lootTier = (typeof itemTierOf === 'function') ? itemTierOf(lootId) : 0;
      // A starter supply crate is not treasure. `o.crate` is the same test the
      // renderer uses to draw the box sprite instead of the tier-2 trunk, and
      // the same one the label pass uses to keep its name horizontal — so the
      // ceremony now agrees with both. Everything else, the spawn relic chest
      // included, keeps the treasure header.
      const rewardKind = o.crate ? 'supplies' : 'treasure';
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
        let resolved = false;
        scene.showChestRewardModal({ ...dress,
          ...(chapel ? { art: Macros.KIND_DIALOG.chapel.art, header: Macros.KIND_DIALOG.chapel.label } : {}),
          iconHTML, name: lootName, qty: qtyLabel, color: lootColor, kind: rewardKind, kindIcon, tier: lootTier,
          sub: room > 0
            ? `Bag full — room for only ${room} of ${lootQty}.`
            : 'Your bag is full.',
          actions: [
            { label: 'Leave for later', primary: true, onClick: () => {
              if (resolved) return;
              resolved = true;
              save.chestHold = save.chestHold || {};
              save.chestHold[o.id] = { id: lootId, n: lootQty, consolation: result.consolation || 0 };
              persistSave(save);
              scene.flash?.('Left it in the chest.', sx, sy);
            } },
            { label: room > 0 ? `Take ${room}` : 'Discard', onClick: () => {
              if (resolved) return;
              resolved = true;
              // Discard still claims the chest's coins, without attempting
              // an item grant into a full bag.
              const granted = Rewards.apply(save, room > 0 ? result : { kind: 'gold', amount: result.consolation || 0 }, scene, { deferBookRead: chapel });
              markOpened();
              if (save.chestHold) delete save.chestHold[o.id];
              persistSave(save);
              if (chapel && (granted.accepted > 0 || granted.money > 0)) {
                const gifts = [];
                if (granted.accepted > 0) gifts.push(`${lootName} ×${granted.accepted}`);
                if (granted.money > 0) gifts.push(scene.moneyHTML(granted.money));
                scene._macroTransaction?.('chapel', `You received ${gifts.join(' and ')} as today’s blessing.`,
                  () => scene._revealPendingBookReads?.());
              }
            } },
          ],
        });
        if (result.jackpot >= 1 && typeof scene.flashJackpot === 'function') {
          scene.flashJackpot(result.jackpot);
        }
        return true;
      }
      // Fits fully — take it and empty the chest.
      // deferBookRead: a Book grant would otherwise pop its read modal right
      // here, before showChestRewardModal below even mounts — two modals at
      // once. Queue it and reveal once the "you found a Book" ceremony is
      // dismissed instead (see addToInv / _revealPendingBookReads in app.js);
      // a no-op for every other loot id.
      Rewards.apply(save, result, scene, { deferBookRead: true });
      markOpened();
      if (save.chestHold) delete save.chestHold[o.id];
      ctx.dirty = true;
      scene.showChestRewardModal({ ...dress, iconHTML, name: lootName, qty: qtyLabel, color: lootColor,
                                   kind: rewardKind, kindIcon, tier: lootTier,
                                   onDismiss: () => scene._revealPendingBookReads() });
      if (result.jackpot >= 1 && typeof scene.flashJackpot === 'function') {
        scene.flashJackpot(result.jackpot);
      }
      return true;
    },
  },

  // ---- Well / fountain: a landmark on the quest trail ----------------------
  // OSM amenity=fountain — a water source on dry land. Visited FOR the quest
  // tick; otherwise it reads as scenery.
  well: {
    custom: (ctx, o) => {
      const { scene, save, sx, sy } = ctx;
      if (typeof Quests !== 'undefined') {
        const done = Quests.onPoiVisit(save, 'well');
        if (done) {
          ctx.dirty = true;
          scene.flashAtWorld('Quest done — see the castle.', o.x, o.y);
          return true;
        }
      }
      scene.flash('Cool, clear water.', sx, sy);
      return true;
    },
  },

  // Waystones share the daily visit ledger; notice boards remain one-time.
  waystone: {
    custom: (ctx, o) => {
      const { scene, save } = ctx;
      if (typeof scene._bookRead !== 'function') return true;
      return Macros.dailyVisit(ctx, o, { afterStory: () => {
        const { body } = scene._bookRead();
        if (typeof scene.showMessageModal === 'function') {
          scene.showMessageModal({ title: 'The waystone remembers', body,
            art: Shrines.REWARD_KINDS.waystone.art, kind: 'story' });
        }
        if (typeof persistSave === 'function') persistSave(save);
      } });
    },
  },
  infoboard: pageStone({ title: 'A notice board', art: null,
    spent: 'Read it already.', read: 'You read the notice.' }),
  // A MESSAGE BOTTLE on the waterline (src/scenic.js BEACH_BOTTLES_PER_TILE):
  // the notice board's lane — one Book page, once (save.opened) — and,
  // unlike the board, picked up: isSpent hides it once opened.
  bottle: pageStone({ title: 'A message in a bottle', art: 'bottle_read',
    spent: 'Only sand here now.', read: 'You read the message.' }),

  // ---- Influence zones (src/zones.js) --------------------------------------
  // A HEADSTONE (an Old Stones churchyard — churches and cemeteries only).
  // Every tap may raise a ghost (Zones.HEADSTONE_GHOST_P, at any hour — the
  // night's own ghost, creature_ai.js raiseGhostAt); Zones.headstoneHoards
  // (a hash of the stone's id — the same stones for every player) says which
  // hold a one-off find, rolled once from the low-tier chest table and spent
  // in save.opened, the POI delta. The stone itself stays. A variant may
  // keep its pillars quiet through its optional headstones policy.
  headstone: {
    custom: (ctx, o) => {
      const { scene, save, sx, sy } = ctx;
      const policy = typeof ZoneVariants !== 'undefined' && ZoneVariants.byId(o.zoneVariant)?.headstones;
      let paid = false;
      if (policy?.hoards !== false && typeof Zones !== 'undefined' && Zones.headstoneHoards(o.id)
          && !(save.opened || []).includes(o.id)) {
        save.opened = [...(save.opened || []), o.id];
        ctx.dirty = true;
        paid = true;
        grantTreasureRoll(scene, save, sx, sy, '\u{1FAA6}', Zones.HEADSTONE_CONTEXT, { tier: Zones.HEADSTONE_TIER });
      }
      const ghostP = policy?.ghostChance ?? ((typeof Zones !== 'undefined') ? Zones.HEADSTONE_GHOST_P : 0);
      const ghost = ghostP > 0 && Math.random() < ghostP && typeof raiseGhostAt === 'function'
        && raiseGhostAt(scene, o.x, o.y, performance.now(), 'hs');
      if (ghost) scene.flash('The grave stirs\u2026', sx, sy - (paid ? 22 : 0));
      else if (!paid) scene.flash('Here lies someone. At rest.', sx, sy);
      return true;
    },
  },
  // A GROVE SHRINE (one per named park's grove). Once per UTC day per shrine
  // it leaves a gift: one roll of Zones.SHRINE_CONTEXT, claimed in the
  // coin-burst daily ledger (Macros.usedToday / markToday —
  // save.coinBurstClaimed[id + dayKey], pruned of other days), the plain lane
  // the daily crate shares. The chapel uses the same ledger's service lane.
  // While the gift is there it wears the
  // POI light (poiLit) on top of its own; not a rest ring, not a ward — its
  // own light (Lighting.KINDS.shrine) is what keeps the night off.
  grove_shrine: {
    custom: (ctx, o) => {
      const { scene, save, sx, sy } = ctx;
      const row = Shrines.kindForObject(o);
      if (row.reward === 'coins') {
        scene._coinBurstInteract(sx, sy, o);
        return true;
      }
      return Macros.dailyVisit(ctx, o, {
        row,
        grant: row.reward ? null : () => {
          Shrines.grant(save, o.shrineKind, Date.now(), scene);
          scene.flash(Shrines.boonFlash(o.shrineKind), sx, sy);
        },
        afterStory: row.reward === 'treasure'
          ? () => grantTreasureRoll(scene, save, sx, sy, '\u{1F33F}', Zones.SHRINE_CONTEXT)
          : null,
      });
    },
  },

  // The looking glass finds a target; only the first visit grants a bag.
  vista_scope: {
    custom: (ctx, o) => {
      const { scene, save, sx, sy } = ctx;
      if (typeof Scenic === 'undefined') return true;
      const st = Scenic.VISTA_STORY;
      const menu = () => scene.presentTelescopeMenu?.(sx, sy, o);
      const prize = Scenic.firstVistaPrize(save);
      let next = menu;
      if (prize) {
        save.vistaRelic = 1;
        ctx.dirty = true;
        const got = (typeof reconcileRelicOffer === 'function') ? reconcileRelicOffer(prize, save, Math.random) : prize;
        Rewards.apply(save, got, scene);
        next = () => {
          const shown = scene.showRewardCard?.(got, {
            kind: 'treasure', header: 'For the journey', art: st.story,
            sub: "You'll need this for all the things you'll find with this looking glass!",
            onDismiss: menu,
          });
          if (!shown) menu();
        };
      }
      const told = scene._storySplashOnce?.(st.story, {
        art: st.story, title: st.title, body: st.body, onDismiss: next,
      });
      if (!told) next();
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

// Ruin masonry uses the same pick work, stone payout and persistent broken
// ledger as loose quarry rocks; its connected artwork only changes its look.
INTERACTABLES.stronghold_wall = INTERACTABLES.mineralrock;

// ── "Already spent", in ONE place ──────────────────────────────────────────
// An opened chest, a chopped tree, a mined-out mineralrock and a picked-up
// groundstack are one state wearing four names: the object is still GENERATED
// (the world is a pure function of where it is), and the save carries only the
// id that says "…except that one" (CLAUDE.md, bucket 2). render.js drops them
// from the draw list and the registry's `spent` rows refuse the tap.
//
// It takes the SETS, not the save, because render.js runs it over every object
// of the 3×3 tile ring EVERY FRAME: the sets are built once for the frame and
// the same object is handed to every call, where a `save` shape would rebuild
// four Sets per object per frame. A tap path builds one with spentSets(), whose
// three `setOf` reads are memoised on the arrays anyway.
//
// It is NOT the `spent` CALLBACK, which is the TAP's question and carries
// `spentAction` with it — those rows are readers of this, not a second lane.
// And it is not "can this be worked": an unopened chest, a fruit tree between
// harvests and a house are all un-spent.
// THE DAY LEDGER, read once per frame: ledger id -> whole UTC days since it
// was last taken (0 = today), for every take the ledger still keeps. Plain
// ids cover crates and recurring gifts; `macro:` ids cover services such as
// the chapel's blessing (macros.js). A pot of gold, a bike rack and a shrine's gift are
// spent while theirs is 0; a crate while it is under its own
// crateRestoreDays. Keys are the id plus an 8-digit day, so the id is all
// but the last eight characters.
function dayLedgerAges(save) {
  const out = new Map();
  const m = save && save.coinBurstClaimed;
  if (!m || typeof Macros === 'undefined') return out;
  const today = utcDayIndex(Date.now());
  for (const k of Object.keys(m)) {
    if (m[k] !== 1 || k.length <= 8) continue;
    const age = today - Macros.ledgerKeyDay(k);
    if (!(age >= 0)) continue;
    const id = k.slice(0, -8);
    const prev = out.get(id);
    if (prev === undefined || age < prev) out.set(id, age);
  }
  return out;
}

function burnedGroundLookup(scene, save) {
  if (!scene?._groundFireAtWorld || !scene.startWorldM || !scene.originPx ||
      !(scene.mPerPx > 0) || typeof GroundFire === 'undefined') return null;
  // Avoid coordinate work before the first ignition, without enumerating a
  // potentially large permanent history into an array each frame.
  let hasHistory = false;
  for (const key in save?.groundFire) { hasHistory = true; break; }
  if (!hasHistory) return null;
  const now = Date.now();
  return o => {
    if (!GroundFire.flammable(o) || GroundFire.survives(o) ||
        !Number.isFinite(o.x) || !Number.isFinite(o.y)) return false;
    const fire = scene._groundFireAtWorld(o.x, o.y);
    return !!fire && (fire.extinguished || fire.until <= now);
  };
}

function spentSets(scene, save) {
  const s = save || (scene && scene.save) || {};
  return {
    opened: setOf(s.opened),
    burst: dayLedgerAges(s),
    chopped: setOf(s.chopped),
    picked: setOf(s.picked),
    burned: setOf(s.burnedObjects),
    burnedGround: burnedGroundLookup(scene, s),
    // The broken-rock ids live on the scene as a Set already (app.js rebuilds
    // it from save.brokenRocks), so it is passed through rather than rebuilt.
    broken: (scene && scene.brokenRockSet) || new Set(),
    // The UTC day the tide line is laid for (Scenic.tideLive).
    day: utcDayKey(),
  };
}
// Was `o` taken today, by the frame's ledger ages?
function takenToday(o, sets) {
  return !!(sets && sets.burst && sets.burst.get(o.id) === 0);
}
function serviceTakenToday(o, sets) {
  return !!(sets && sets.burst && sets.burst.get(Macros.serviceLedgerId(o.id)) === 0);
}
function chestNeverSpent(o) {
  return !!((typeof produceStandFor === 'function' && produceStandFor(o))
    || (typeof macroFor === 'function' && macroFor(o)));
}
// ── What RESTOCKS ─────────────────────────────────────────────────────────
// Most chests are offered ONCE (save.opened, the delta, forever — that is what
// keeps a dense city from being a fountain). What comes back is the CRATE — a
// surface POI chest wearing the crate look (loot.js chestLook `box`: tier 1,
// i.e. one the tile's quota pyramid left unseated, with no nexus bonus)
// — never a starter supply crate
// (`o.crate`, fixedLoot), never a cave copy (depth / caveOf), never a wagon,
// stall, macro, pot of gold or bike rack. Taking one is written to the DAY LEDGER
// (Macros.markToday — save.coinBurstClaimed[id + dayKey], kept a week), the
// lane the pot of gold, the bike rack and the grove shrine's gift already
// share (the chapel's blessing takes the macro: service lane above), and it
// stands bare for crateRestoreDays UTC
// days (1 for an ordinary crate, up to CRATE_RESTORE_MAX_DAYS for a class
// the tile is crowded with) before it restocks at its normal tier.
// Crate availability reads the day ledger, independently of save.opened.
// X marks, headstones, trunks, nexus chests and cave chests never restock.
// Wagons and daily visit sites share the day ledger and glow through their
// own visit predicate, rather than this crate schedule.
function restocks(o) {
  if (!o || o.kind !== 'chest' || !o.poiClass || o.crate || o.fixedLoot) return false;
  if (o.depth > 0 || o.caveOf) return false;
  if (typeof chestLook !== 'function') return false;
  const L = chestLook(o);
  if (L.barrel) return false;
  return !!(L.box && !L.stand && !L.coin && !L.bike && !L.macro && !L.wagon);
}
function isSpent(o, sets) {
  if (o && sets.burned?.has(o.id)) return true;
  if (o && sets.burnedGround?.(o)) return true;
  switch (o && o.kind) {
    // A pot of gold or a bike rack used TODAY is spent until the UTC day
    // rolls. A market stall and a macro stall (loot.js produceStandFor /
    // macroFor) are never spent: a counter is not a chest, and an id a save
    // put in save.opened while that POI was still a crate, or in the day
    // ledger for the inn's rest, leaves the building standing.
    // A recurring crate uses the day ledger; smashed pots and barrels use
    // save.opened forever. Only pots retain broken art (render.js).
    case 'chest': {
      if (chestNeverSpent(o)) return false;
      if (isBarrel(o)) return sets.opened.has(o.id);
      if (restocks(o)) {
        const age = sets.burst ? sets.burst.get(o.id) : undefined;
        return age !== undefined && age < crateRestoreDays(o);
      }
      if (Macros.visitKindForObject(o)) return takenToday(o, sets);
      return sets.opened.has(o.id) || takenToday(o, sets);
    }
    // o.chopped is the in-memory flag the chop wheel sets; save.chopped is the
    // source of truth that survives a tile re-rasterize. Both, as both sites
    // always checked both.
    case 'tree':        return !!o.chopped || sets.chopped.has(o.id);
    case 'stronghold_wall':
    case 'mineralrock': return sets.broken.has(o.id);
    // Same key (save.picked) as the wildplant pickup tracking, so a save
    // doesn't grow a field for it.
    case 'stakes':
    case 'groundstack': return sets.picked.has(o.id);
    // A message bottle is picked up as it is read (INTERACTABLES.bottle).
    case 'bottle':      return sets.opened.has(o.id);
    // A wild plant is spent once picked (save.picked) — except a TIDE pickup
    // (src/scenic.js): the day's, so it is spent when it is not on the
    // waterline today (Scenic.tideLive, which also sets its crop to the day's
    // find) or was taken today (the day ledger — never save.picked).
    case 'wildplant':
      if (o.tide) {
        const live = typeof Scenic === 'undefined' || Scenic.tideLive(o, sets.day);
        return !live || takenToday(o, sets);
      }
      return sets.picked.has(o.id);
    default:            return false;
  }
}

// ── Does this glow as "something to take here"? ────────────────────────────
// The POI light (Lighting.KINDS.poi) is the one mark for it. A chest wears it
// until it is spent; the RECURRING places — a crate (restocks,
// dark until it restocks), a pot of gold, a bike rack, the chapel's blessing and
// a grove shrine's gift — wear it exactly while the take is there (the day
// ledger), and go dark once it is taken. Every other stall and market stays lit (a counter is always
// open). Takes the frame's sets, like isSpent. Loose starter crates are no
// place and never lit.
function poiLit(o, sets) {
  if (!o) return false;
  const today = takenToday(o, sets);
  if (o.kind === 'vista_scope') return true;
  if (Macros.visitKindForObject(o)) return !today;
  if (o.kind !== 'chest' || o.crate || isSpent(o, sets)) return false;
  const macro = (typeof macroFor === 'function') ? macroFor(o) : null;
  if (macro && macro.kind === 'chapel') return !serviceTakenToday(o, sets);
  return true;
}

// ── One chest per cell ─────────────────────────────────────────────────────
// A chest's id is already cell-snapped (`c_<cellX>_<cellY>`), so the same POI
// duplicated across adjacent tiles — and any two chests that land in the same
// cell — collapse to a single crate. The key is derived from WORLD POSITION,
// so *which* copy survives no longer depends on tile-iteration or load order:
// that order-dependence is what made crates blink in and out as you walked.
// Distinct POIs that merely share a name within ~40 m are NOT collapsed —
// those are different crates and both stay visible.
//
// The draw pass (render.js) and the tap pass (interact.js) have to collapse
// identically or you get a crate you can see and cannot tap, so both take
// their first-seen-wins predicate from here instead of each keeping a copy.
// Returns a stateful predicate: build ONE per pass, then ask it in the pass's
// own iteration order.
// The grid is `scene.cellM` METRES — a dedup bucket, not a coordinate, so it
// is deliberately not coords.js' tile-pixel abs-cell key.
function chestCellDedup(cellM) {
  const seen = new Set();
  return (o) => {
    const k = Math.floor(o.x / cellM) + '_' + Math.floor(o.y / cellM);
    if (seen.has(k)) return true;
    seen.add(k);
    return false;
  };
}

// Generic driver for a registered interactable. Returns:
//   'skip'  — caller should `continue` to the next object (spent + spentAction
//             'skip', e.g. a chopped tree stump that shouldn't block the cell)
//   true    — the tap was consumed (gate blocked, work started, or custom done)
//   false   — `o.kind` is not registered (caller falls through to other blocks)
// ── Tool-gate fade ──────────────────────────────────────────────────────────
// A tree or rock the player's current tool can't work is drawn at half alpha,
// so what is reachable NOW reads at a glance instead of by tapping everything
// and reading refusals. "Can't work" is the entry's own tierShort — the same
// number the tap gate refuses on (and offers the slow grind at exactly 1) — so
// the fade and the refusal can never disagree. Kinds without a tool gate
// (fruit trees, chests, plants) are never faded; nor is a bush (axe tier 0) or
// a plain rock (ungated). render.js applies it in the tree / mineralrock
// `after` hooks; it lives here so it reads the shipping gate, not a copy.
const TOOL_GATED_ALPHA = 0.5;
function isToolGated(o, save) {
  const def = INTERACTABLES[o.kind];
  return !!(def && def.tierShort && def.tierShort(o, save || {}) > 0);
}
function toolGatedAlpha(o, save) {
  return isToolGated(o, save) ? TOOL_GATED_ALPHA : 1;
}

function runInteractable(ctx, o, definition) {
  if (setOf(ctx.save?.burnedObjects).has(o.id)) return 'skip';
  if (burnedGroundLookup(ctx.scene, ctx.save)?.(o)) return 'skip';
  const def = definition || INTERACTABLES[o.kind];
  if (!def) return false;
  const { scene, save, sx, sy } = ctx;

  if (def.spent && def.spent(o, ctx)) {
    return def.spentAction === 'skip' ? 'skip' : true;
  }
  // Non-tool interactables (fruit harvest, …) own their whole flow.
  if (def.custom) return def.custom(ctx, o);

  // Capture equipment when the wheel starts, including a later slow-grind
  // acceptance. Cancellation never invokes the completion story.
  const startJob = (duration, cost) => {
    const startingTier = save.relics?.[def.tool]?.tier || 0;
    const action = { axe: 'chop', pickaxe: 'dig', hoe: 'till' }[def.tool];
    if (action) scene._toolActionStory?.(action);
    scene.startWorkProgress(o.x, o.y, () => {
      if (def.spent && def.spent(o, ctx)) return;
      def.complete(ctx, o);
      scene._barehandWorkStory?.(def.tool, startingTier, o.kind === 'tree' && o.size !== 'bush');
    }, duration, cost, def.tool);
  };

  // Tool pipeline: gate → spend energy → start the tier-driven work wheel.
  const blockMsg = def.gate ? def.gate(o, save) : null;
  if (blockMsg) {
    // EXACTLY one tier short (bare hands = tier 0 included): instead of a
    // flat refusal, offer to grind it out — a long SLOW_GRIND_MS wheel at a
    // steep flat SLOW_GRIND_ENERGY, next to the ~3-9s / few-⚡ cost the right
    // tool would pay. Two or more tiers short stays a hard no.
    const short = def.tierShort ? def.tierShort(o, save) : 0;
    if (short === 1 && typeof scene.showOfferModal === 'function') {
      scene.showOfferModal({
        kind: 'note',
        title: 'Your tools would make hard work of this.',
        get: 'Do it anyway?',
        cost: `${SLOW_GRIND_ENERGY}⚡ · ${shortDuration(Gear.workDurationMs(save, SLOW_GRIND_MS))} of work`,
        canAfford: (save.energy ?? 0) >= SLOW_GRIND_ENERGY,
        acceptLabel: 'Do it',
        cancelLabel: 'Not now',
        onAccept: () => {
          if (!scene.spendEnergy(SLOW_GRIND_ENERGY, sx, sy)) return;
          // Same completion as a proper-tool job; the energy rides along as
          // the refund if the player cancels the wheel mid-grind.
          startJob(SLOW_GRIND_MS, SLOW_GRIND_ENERGY);
        },
      });
      return true;
    }
    scene.flash(blockMsg, sx, sy);
    return true;
  }

  const cost = def.energy ? def.energy(save, o) : 0;
  const durMs = toolDurationMs(save.relics, def.tool);
  if (cost && !scene.spendEnergy(cost, sx, sy)) return true;   // can't afford — tap consumed
  // cost is passed through as the refund amount if the player cancels mid-work.
  startJob(durMs, cost || 0);
  return true;
}


// A timber wildplant shares tree work, retaining its own spent ledger and loot.
function runWildplantTimber(ctx, plant) {
  const timber = { ...plant, ...wildplantRule(plant.crop).timber };
  const tree = INTERACTABLES.tree;
  return runInteractable(ctx, plant, {
    tool: tree.tool,
    spent: (o, c) => isSpent(o, spentSets(c.scene, c.save)),
    spentAction: 'skip',
    gate: (_o, save) => tree.gate(timber, save),
    tierShort: (_o, save) => tree.tierShort(timber, save),
    energy: (save) => tree.energy(save, timber),
    complete: ({ scene, save, sx, sy }, o) => {
      save.picked = [...(save.picked || []), o.id];
      const wood = randInt(2, 3) * treeWoodMul(timber);
      scene.addToInv('wood', wood);
      persistSave(save);
      scene.flashLoot(`+${wood} ${itemName('wood')}`, undefined, 1, 'wood');
      if (isShiny(o.id, SHINY_RATE.flora)) scene.awardShinyBonus('wood', sx, sy);
    },
  });
}
