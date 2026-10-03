// ── Home / start area ───────────────────────────────────────────────────────
// Central hub for "near the start" geometry + early-game home-area tuning.
//
// The player begins at HOME_LON/HOME_LAT (or a teleport override) — see
// app.js START_LON/START_LAT. `startWorldM` (app.js) is that spawn point in
// absolute world metres, the SAME space every generated object's x/y lives in
// (playerM starts at {0,0}, so the player literally stands on startWorldM).
//
// This module owns the geometry ("am I near home?") and the home-area tuning
// that isn't bound to one specific shop. Loaded BEFORE worldgen.js so tile
// generation can ask `HomeArea.isNear(...)` while building.
//
// ── INDEX of home-area customization still living elsewhere ──────────────────
// (Migrate each into here as it's next touched, routing through HomeArea.)
//   • Start origin / synthetic trailer ……… scene_shops.js  isStarterShop / ensureStarterShopId
//   • What a wreck can become, by count … houses.js  BUILD_OPTIONS / STORY_RESTORES
//   • Starter blacksmith (1st smithy) ……… houses.js  isStarterBlacksmith
//   • Shops sell a line by restore order … scene_shops.js  marketTheme
//     (the first is the Seed Shop — see shops.js themeAt / roleLabel)
//   • First 8 delivery houses → T1 produce delivery.js Delivery.isEarly
//     (of which the first 7 walk delivery.js SCRIPTED_WISHLISTS — five
//      single-item asks, then the starter pair, then the flower trio)
//   • Starter loot crates (wood/rockfruit/seeds) starter.js  STARTER_LOOT
//   • Starting money / no free tools …… items.js STARTING_MONEY; a fresh save's
//                                        relic slots all default to null
//   • Fort unlock cost ………………………… houses.js  FORT_UNLOCK_WOOD
//
// Exposed as a global (no bundler): HomeArea
const HomeArea = {
  // World-metre position of the spawn/home origin. Set ONCE by the scene
  // (app.js) the moment startWorldM is known. Worldgen must NOT read it —
  // generation is the same for every player, and this is one player's home —
  // it is for per-player overlays applied after a tile is built
  // (applySoftwood). Null until then, which `isNear` treats as "not near
  // home" so nothing is mis-flagged before the origin exists.
  worldM: null,
  setOrigin(x, y) { this.worldM = { x, y }; },

  // Radius (m) of the "near the start" zone the softwood rule below uses.
  NEAR_M: 100,

  // True iff (x, y) world-metres is within `radiusM` of the spawn origin. Meant
  // as the shared "near home" test; today its one caller is softwoodSpeciesNear
  // below (via applySoftwood, app.js's per-player overlay) — a new home-area
  // feature should route through it rather than an inline hypot check, so the
  // zone keeps one definition.
  isNear(x, y, radiusM = HomeArea.NEAR_M) {
    if (!this.worldM) return false;
    const dx = x - this.worldM.x, dy = y - this.worldM.y;
    return dx * dx + dy * dy <= radiusM * radiusM;
  },

  // Trees within NEAR_M of the start are SOFTWOOD (species 'pine'). The early
  // game needs wood for the starter blacksmith's first tools, and softwood
  // fells one axe-tier easier than the default (util.js treeSpeciesTierShift),
  // so the home grove is reliably harvestable bare-handed / with a Wood axe.
  // Returns the species string to store on the tree (the fallback elsewhere).
  //
  // A PER-PLAYER OVERLAY, never a generation input: where "home" is differs
  // per save, so worldgen generates the world's species and applySoftwood
  // (below) stamps this rule onto a built tile's trees for THIS player.
  // Includes legacy bush-sized trees, which now use the small tree canopy.
  softwoodSpeciesNear(x, y, fallbackSpecies) {
    return this.isNear(x, y) ? 'pine' : fallbackSpecies;
  },

  // The overlay itself: re-species every generated `tree` object in `objects`
  // by softwoodSpeciesNear. Idempotent. Call it once per built entry, in the
  // spawn pass (scene_creatures.js spawnInTile), which a rebuilt entry re-runs
  // (the `_spawned` gate) since a rebuild mints fresh objects. Fruit trees and
  // non-trees are left alone. Returns the number of trees it changed.
  applySoftwood(objects) {
    if (!objects || !this.worldM) return 0;
    let n = 0;
    for (const o of objects) {
      if (!o || o.kind !== 'tree') continue;
      const sp = this.softwoodSpeciesNear(o.x, o.y, o.species, o.size);
      if (sp !== o.species) { o.species = sp; n++; }
    }
    return n;
  },

  // ── Starter provisioning ──────────────────────────────────────────────
  // The starter ladder assumes the world around spawn can teach it: something
  // to chop, something to mine, and a wreck to rebuild. A parkland or rural
  // spawn can have no OSM buildings (so "Rebuild a neighbour" never fires), and
  // a downtown spawn has only large hardwoods needing a Gold axe. So the home
  // area is AUDITED against a quota and only the shortfall is synthesized;
  // home keeps looking like the player's actual street.
  //
  // Geometry, in CELLS from the spawn anchor, measured against what the player
  // can perceive: the viewport is VIEW_CELLS (11) wide with the player in the
  // middle, so they see 5 cells in every direction.
  //   0..POCKET_CELLS   the cleared tutorial pocket (app.js CLEAR_R, derived
  //                     from this number). Kept clean so the crate trail and
  //                     starter soil plot read without competing scenery —
  //                     EXCEPT one token tree and one token rock, in plain
  //                     sight from Home. Exactly the opening screen.
  //   RING_MIN..RING_MAX  where the rest goes: it begins at the screen's edge,
  //                     so the pocket reads as a clearing RINGED by the
  //                     neighbourhood.
  //
  // If the pocket is ever widened, widen the view with it, or the ring is
  // seated beyond the visible area and fog and goes missing.
  //
  // RING_MIN is also where the fog begins: app.js HOME_REVEAL_CELLS is 6, one
  // cell past the player's sight, so the first ring of scenery is lit. The
  // rest of the band (7..16) is walked to, not given.
  POCKET_CELLS: 5,
  RING_MIN_CELLS: 6,
  RING_MAX_CELLS: 16,
  // How far the search may reach when the ring band cannot supply the quota
  // (a spawn on a pier, riverbank, marina, or inside a solid block of
  // buildings): the band widens outward until it finds ground, rather than
  // seating nothing. ~280 m.
  RING_MAX_ESCALATED_CELLS: 40,

  // What must be reachable on foot before the ladder can be completed.
  // Counted across the pocket AND the ring together — a tree is a tree
  // wherever it stands.
  //
  // `ladder` is a WAY DOWN — one cave entrance in the home area, so the
  // underground is within sight of home. A quota of ONE: worldgen scatters
  // entrances at ~30% per residential rock cluster (maybePlaceCaveEntrance),
  // but "somewhere on the tile" is not "in the ring". The audit counts any
  // down-staircase already standing, so a second is added only when the
  // neighbourhood didn't supply one.
  //
  // `mushroom` is FOOD, not a ladder lesson. Energy is the early game's real
  // constraint and a mushroom is 21 of it (items.js FOOD_ENERGY), so six is over
  // one full tank. Bounded on purpose: a picked wild plant never regrows
  // (save.picked is keyed by its cell id), so this is a one-time cushion while
  // the first crop matures. The residential flora window (biome_profiles.js) is
  // thin enough that a suburban spawn can have none in reach.
  QUOTA: { tree: 50, rock: 50, wreck: 6, ladder: 1, mushroom: 6 },
  // Of that quota, how many must sit inside the pocket as the visible example:
  // GUARANTEED, since the pocket is deliberately cleared of trees and rocks.
  TOKEN: { tree: 1, rock: 1 },
  // ...but not right against the door: the trailer's art spills into all eight
  // neighbouring cells and the crate trail seats from 2 cells out.
  TOKEN_MIN_CELLS: 4,

  // A tree a player with NO axe can fell: small + softwood is tier 0 via
  // util.js treeAxeReqTier (size 'small' = 1, pine shifts −1). Deliberately
  // not a bush — a bush renders as scrub, and the point is to show the player
  // what a choppable TREE looks like.
  STARTER_TREE: { species: 'pine', size: 'small' },
  // A rock bare hands can break: interactables.js treats yieldTier <= 1 as
  // "plain rock" and skips the pick gate entirely.
  STARTER_ROCK: { yieldTier: 1, requiredTier: 1 },
  // Food that needs no tool at all — a wild plant, picked bare-handed like any
  // other. Lives in the tile's `wildplants` stream, not `objects`, which is the
  // one place the starter provision crosses into a second stream.
  STARTER_MUSHROOM: { crop: 'mushroom' },

  // Can a beginner harvest this with the empty relic set they start with? Both
  // read the SHIPPING gate helpers so a change to the axe ladder or pick gate
  // can't leave the starter area full of things that aren't usable.
  //
  // A FRUIT tree is not a tree here: it is never chopped (its only interaction
  // is the pick, interactables.js fruittree) so it can't fill the chop quota,
  // and must never be tamed — stamping STARTER_TREE's species onto it made an
  // apple tree 'pine', which is not an item.
  isStarterTree(o) {
    if (!o || o.kind !== 'tree') return false;
    return (typeof treeAxeReqTier === 'function') ? treeAxeReqTier(o) === 0 : false;
  },
  isStarterRock(o) {
    if (!o || o.kind !== 'mineralrock') return false;
    return (o.yieldTier || 1) <= 1;
  },
  // A wild plant that feeds the player. Wild plants carry `crop`, not `kind` —
  // they are a separate stream from objects (see STARTER_MUSHROOM).
  isStarterMushroom(w) {
    return !!w && w.crop === this.STARTER_MUSHROOM.crop;
  },
  // A house the ladder's "Rebuild a neighbour" step can be performed on: a
  // plain small house, which renders as a wreck until restored. Forts (11) and
  // civic slabs (12) never wreck, and neither does HOME (render.js _houseRole
  // returns 'trailer' for it, never restorable).
  isStarterWreck(o, homeId) {
    if (!o || o.kind !== 'house') return false;
    if (homeId && o.id === homeId) return false;
    return o.tier == null || o.tier === 9;
  },

  // Would makeStarterUsable() succeed on this? Answered by trying it on a COPY
  // so it cannot disagree with the real thing. A SHINY tree is pinned to the
  // Gold-axe tier by its id (util.js treeAxeReqTier), so respeciating cannot
  // help and it must not be counted.
  canBeStarterUsable(o) {
    if (!o) return false;
    const probe = { ...o };
    this.makeStarterUsable(probe);
    return (probe.kind === 'mineralrock') ? this.isStarterRock(probe) : this.isStarterTree(probe);
  },

  // Bring a real tree/rock down to something a beginner can work, IN PLACE.
  // Preferred over adding another one beside it: the player's own street tree
  // stays their street tree, it just isn't a Gold-axe hardwood any more.
  // Returns true if the object was changed.
  makeStarterUsable(o) {
    if (!o) return false;
    if (o.kind === 'tree') {   // never a fruittree — see isStarterTree
      if (this.isStarterTree(o)) return false;
      o.species = this.STARTER_TREE.species;
      o.size = this.STARTER_TREE.size;
      return true;
    }
    if (o.kind === 'mineralrock') {
      if (this.isStarterRock(o)) return false;
      o.yieldTier = this.STARTER_ROCK.yieldTier;
      o.requiredTier = this.STARTER_ROCK.requiredTier;
      return true;
    }
    return false;
  },

  // Distance from the spawn anchor in CELLS (Chebyshev — the same metric the
  // pocket clearing and the crate seating use, so the three agree on "near").
  cellsFromAnchor(x, y, anchorX, anchorY, cellM) {
    return Math.max(Math.abs(x - anchorX), Math.abs(y - anchorY)) / cellM;
  },

  // THE AUDIT. Given the objects already in the home area, work out what is
  // missing. Pure — no scene, tile or RNG — so the policy is headless-testable.
  //
  // Returns:
  //   downgrade  objects to run makeStarterUsable() on (unusable naturals
  //              standing in the area — modify rather than crowd)
  //   need       how many of each to synthesize, after counting what is
  //              usable and what the downgrades will make usable
  //   tokens     whether the pocket still lacks its example tree / rock
  //   opts.homeId       the player's Home house id, so it isn't counted as a wreck
  //   opts.radiusCells  how far out to look (default RING_MAX_CELLS); widened
  //                     when an earlier pass escalated past the band, so what it
  //                     seated out there still counts.
  //   opts.wildplants   the area's wild-plant stream, separate in the tile
  //                     (entry.wildplants, keyed by `crop` not `kind`).
  planStarterProvision(objects, anchorX, anchorY, cellM, opts) {
    const homeId = opts && opts.homeId;
    const radius = (opts && opts.radiusCells) || this.RING_MAX_CELLS;
    const have = { tree: 0, rock: 0, wreck: 0, ladder: 0, mushroom: 0 };
    const pocket = { tree: 0, rock: 0 };
    // Tameable-but-currently-unusable naturals, kept with their distance so
    // the nearest can be preferred below.
    const candidates = { tree: [], rock: [] };
    for (const o of (objects || [])) {
      const d = this.cellsFromAnchor(o.x, o.y, anchorX, anchorY, cellM);
      if (d > radius) continue;
      if (o.kind === 'house') {
        if (this.isStarterWreck(o, homeId)) have.wreck++;
        continue;
      }
      // A way DOWN only. The up-staircase every cave level carries at the home
      // cell (app.js _ensureHomeUpStair) is not an entrance — counting it would
      // convince the audit the surface already has a mine mouth.
      if (o.kind === 'staircase') {
        if (o.dir === 'down') have.ladder++;
        continue;
      }
      // A fruit tree is scenery to this audit: not choppable, not tameable
      // (isStarterTree), so it neither fills the tree quota nor gets stamped.
      const isTree = o.kind === 'tree';
      const isRock = o.kind === 'mineralrock';
      if (!isTree && !isRock) continue;
      const kind = isTree ? 'tree' : 'rock';
      if (isTree ? this.isStarterTree(o) : this.isStarterRock(o)) {
        have[kind]++;
        if (d <= this.POCKET_CELLS) pocket[kind]++;
      } else if (o._synthetic) {
        // Seated by an earlier provisioning pass at a deliberately rolled
        // rarity: fills its slot in the quota; never replace or downgrade it.
        have[kind]++;
      } else if (this.canBeStarterUsable(o)) {
        // Untameable ones (a shiny tree) are skipped entirely — they are
        // scenery as far as the quota is concerned.
        candidates[kind].push({ o, d });
      }
    }
    // Tame ONLY as many as the quota is short by, nearest first, so a wooded
    // street isn't flattened into saplings.
    const downgrade = [];
    for (const kind of ['tree', 'rock']) {
      const short = Math.max(0, this.QUOTA[kind] - have[kind]);
      if (!short) continue;
      candidates[kind].sort((a, b) => a.d - b.d);
      for (const c of candidates[kind].slice(0, short)) {
        downgrade.push(c.o);
        have[kind]++;
        if (c.d <= this.POCKET_CELLS) pocket[kind]++;
      }
    }
    // Food already growing in the area counts, like a usable tree. No
    // downgrade path for a wild plant.
    for (const w of ((opts && opts.wildplants) || [])) {
      if (!this.isStarterMushroom(w)) continue;
      if (this.cellsFromAnchor(w.x, w.y, anchorX, anchorY, cellM) > radius) continue;
      have.mushroom++;
    }
    return {
      downgrade,
      need: {
        tree:     Math.max(0, this.QUOTA.tree     - have.tree),
        rock:     Math.max(0, this.QUOTA.rock     - have.rock),
        wreck:    Math.max(0, this.QUOTA.wreck    - have.wreck),
        ladder:   Math.max(0, this.QUOTA.ladder   - have.ladder),
        mushroom: Math.max(0, this.QUOTA.mushroom - have.mushroom),
      },
      // Independent of `need`: a lush neighbourhood can satisfy the whole
      // quota out in the ring and still leave the cleared pocket empty.
      tokens: {
        tree: pocket.tree < this.TOKEN.tree,
        rock: pocket.rock < this.TOKEN.rock,
      },
    };
  },
};
