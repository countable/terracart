// ── Home / start area ───────────────────────────────────────────────────────
// Central hub for "near the start" geometry + early-game home-area tuning.
//
// The player begins at HOME_LON/HOME_LAT (or a teleport override) — see
// app.js START_LON/START_LAT. `startWorldM` (app.js) is that spawn point in
// absolute world metres, the SAME space every generated object's x/y lives in
// (playerM starts at {0,0}, so the player literally stands on startWorldM).
//
// A lot of early-game customization keys off being near that origin, or off
// being among the first houses/shops restored. This module owns the geometry
// ("am I near home?") and the home-area tuning that isn't bound to one specific
// shop, so future tweaks have one obvious place to live. Loaded BEFORE
// worldgen.js so tile generation can ask `HomeArea.isNear(...)` while building.
//
// ── INDEX of home-area customization still living elsewhere ──────────────────
// (Migrate each into here as it's next touched, routing through HomeArea.)
//   • Start origin / synthetic trailer ……… app.js  isStarterShop / ensureStarterShopId
//   • Starter blacksmith (1st restored) …… app.js  isStarterBlacksmith, PRESEED_RESTORE_ROLES
//   • Scarecrow shop (early house) ………… app.js  isScarecrowShop
//   • First market sells T1/T2 seeds …… app.js  isFirstMarket
//   • First 8 delivery houses → T1 produce app.js  isEarlyDeliveryHouse
//     (of which the first 7 walk delivery.js SCRIPTED_WISHLISTS — five
//      single-item asks, then the starter pair, then the flower trio)
//   • Starter loot crates (wood/rockfruit/seeds) app.js  STARTER_LOOT
//   • Starting money / no free tools …… items.js STARTING_MONEY, app.js starterToolsStripped
//   • Fort unlock cost ………………………… app.js  FORT_UNLOCK_WOOD
//
// Exposed as a global (no bundler): HomeArea
const HomeArea = {
  // World-metre position of the spawn/home origin. Set ONCE by the scene
  // (app.js) the moment startWorldM is known — before any tile is generated —
  // so worldgen, which runs on the same thread, can ask "is this near home?"
  // mid-build. Null until then, which `isNear` treats as "not near home" so
  // nothing is mis-flagged before the origin exists.
  worldM: null,
  setOrigin(x, y) { this.worldM = { x, y }; },

  // Radius (m) of the "near the start" zone the softwood rule below uses.
  NEAR_M: 100,

  // True iff (x, y) world-metres is within `radiusM` of the spawn origin. This
  // is the canonical "near home" test — prefer it over inline hypot checks so
  // every home-area feature shares one definition of the zone.
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
  // EXCEPT bush-tier trees: the smallest size class renders as a uniform
  // `bushes` sprite regardless of species (render.js), AND it's already
  // bare-hands tier-0 with no species shift / 1× wood (util.js), so stamping
  // 'pine' gains nothing gameplay-wise — it only mislabels a tiny bush as a
  // "softwood" tree (treeSpeciesName). Leave bushes their own species so the
  // sprite and the label agree.
  softwoodSpeciesNear(x, y, fallbackSpecies, size) {
    if (size === 'bush') return fallbackSpecies;
    return this.isNear(x, y) ? 'pine' : fallbackSpecies;
  },

  // ── Starter provisioning ──────────────────────────────────────────────
  // The starter ladder assumes the world around spawn can actually teach it:
  // something to chop, something to mine, and a wreck to rebuild. The real
  // world does not promise any of that. A parkland or rural spawn can have no
  // OSM buildings at all — no wreck means step 4 ("Rebuild a neighbour") can
  // never fire, and with no blacksmith there is nothing to spend the crates'
  // wood and stone on. A downtown spawn has the opposite problem: plenty of
  // trees, all of them large hardwoods needing a Gold axe the player will not
  // own for hours.
  //
  // So the home area is AUDITED against a quota and only the shortfall is
  // synthesized. What the real neighbourhood already provides is kept — the
  // point is that home looks like the player's actual street, not a stamped
  // homestead.
  //
  // Geometry, in CELLS from the spawn anchor. Both bands are measured against
  // the one distance the player can actually perceive: the viewport is
  // VIEW_CELLS (11) wide with the player in the middle of it, so they see 5
  // cells in every direction and nothing further out exists to them until
  // they walk.
  //   0..POCKET_CELLS   the cleared tutorial pocket (app.js CLEAR_R, which is
  //                     derived from this number). Kept clean so the crate
  //                     trail and the starter soil plot read without competing
  //                     scenery — EXCEPT one token tree and one token rock, so
  //                     the first thing a player learns to chop and mine is in
  //                     plain sight from Home. Exactly the ground on screen at
  //                     spawn, so the tidy pocket IS the opening screen.
  //   RING_MIN..RING_MAX  where the rest goes: it begins at the screen's edge,
  //                     so the pocket reads as a clearing RINGED by the
  //                     neighbourhood rather than as bare ground running off
  //                     every side of the display.
  //
  // The pocket used to be 10 cells and the ring 11..16 — twice as far out as a
  // player can see, and past HOME_REVEAL_CELLS (10) as well. So a new save
  // opened on bald ground to every edge of the screen, and the ring of trees
  // and rocks around home was seated exactly as designed, two screens out,
  // under fog: correct in the tile, invisible in the game. If the pocket is
  // ever widened again, widen the view with it or the ring goes missing the
  // same way.
  POCKET_CELLS: 5,
  RING_MIN_CELLS: 6,
  RING_MAX_CELLS: 16,
  // How far the search may reach when the ring band itself cannot supply the
  // quota — a spawn on a pier, a riverbank, a marina, or inside a solid block
  // of buildings, where most of the band is water or floor and simply has
  // nowhere to stand anything. Rather than silently under-supplying (the old
  // behaviour: an all-water spawn seated NOTHING, so there was no wreck to
  // rebuild and the ladder could not be finished), the band widens outward
  // until it finds ground. ~280 m — a walk, but a reachable one.
  RING_MAX_ESCALATED_CELLS: 40,

  // What must be reachable on foot before the ladder can be completed.
  // Counted across the pocket AND the ring together — a tree is a tree
  // wherever it stands.
  //
  // `ladder` is a WAY DOWN — one cave entrance in the home area, so a new
  // player always has the underground within sight of home instead of having
  // to stumble across a mine mouth. It is a quota of ONE, not fifty: worldgen
  // scatters entrances at ~30% per residential rock cluster with a per-tile
  // guarantee (see maybePlaceCaveEntrance), so most spawns already have one
  // somewhere on the tile — but "somewhere on a 222-cell tile" is not "in the
  // ring", and a bare or parkland spawn can put it a long walk away. The audit
  // counts any down-staircase already standing in the area, so this adds a
  // second entrance only when the neighbourhood didn't supply one.
  //
  // `mushroom` is FOOD, and it is the one quota entry that isn't about the
  // ladder's lessons. Energy is the early game's real constraint — every swing
  // costs some and the only refills are eating and resting — and a mushroom is
  // 16 of it (items.js FOOD_ENERGY), so six is about one full tank scattered
  // around the ring. Bounded on purpose: a picked wild plant never regrows
  // (save.picked is keyed by its cell id), so this is a one-time cushion while
  // the first crop matures, not an income source. The map's own mushrooms are
  // no help here — the residential flora window is 0.008..0.025 per cell
  // (biome_profiles.js), so a suburban spawn can easily have none in reach.
  QUOTA: { tree: 50, rock: 50, wreck: 6, ladder: 1, mushroom: 6 },
  // Of that quota, how many must sit inside the pocket as the visible example.
  // GUARANTEED, not a shortfall: the pocket is deliberately cleared of trees
  // and rocks, so however lush the surrounding neighbourhood is, a player
  // standing at their own front door can otherwise see nothing to chop or
  // mine. The token pair is what the first two lessons are performed on.
  TOKEN: { tree: 1, rock: 1 },
  // ...but not right against the door. The trailer's art spills into all eight
  // neighbouring cells and the crate trail seats from 2 cells out, so a token
  // any closer reads as clutter in the doorway rather than scenery.
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

  // Can a beginner actually harvest this, with the empty relic set they start
  // with? Both read the SHIPPING gate helpers rather than re-deriving them, so
  // a change to the axe ladder or the pick gate can't silently leave the
  // starter area full of things that look usable and aren't.
  //
  // A FRUIT tree is not a tree here. It is never chopped — its only
  // interaction is the pick (interactables.js fruittree), which hands out the
  // item named by `o.species` — so it can't fill the "something to chop"
  // quota, and it must never be tamed: makeStarterUsable used to count it as
  // a tree and stamp STARTER_TREE's species onto it, and an apple tree near
  // spawn became species 'pine'. 'pine' is not an item, so the pick flashed
  // "harvested pine" and Inventory.add dropped it on the floor — no apple.
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
  // plain small house, which renders as a wreck until it is restored. Forts
  // (11) and civic slabs (12) never wreck, so they don't count — and neither
  // does HOME, which is a plain house by tier but renders as the trailer and
  // can never be restored (render.js _houseRole returns 'trailer' for it). A
  // player standing next to their own front door has no wreck to rebuild.
  isStarterWreck(o, homeId) {
    if (!o || o.kind !== 'house') return false;
    if (homeId && o.id === homeId) return false;
    return o.tier == null || o.tier === 9;
  },

  // Would makeStarterUsable() actually succeed on this? Answered by trying it
  // on a COPY rather than by re-deriving the rules, so it cannot disagree with
  // the real thing. Not everything can be tamed: a SHINY tree is pinned to the
  // Gold-axe tier by its id (util.js treeAxeReqTier checks isShiny first), so
  // no amount of respeciating it helps — and one standing near spawn must not
  // be counted as the player's choppable tree.
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
  // missing. Pure — no scene, no tile, no RNG — so the whole policy is
  // testable headlessly and app.js is left with just the seating.
  //
  // Returns:
  //   downgrade  objects to run makeStarterUsable() on (unusable naturals
  //              standing in the area — modify rather than crowd)
  //   need       how many of each to synthesize, after counting what is
  //              usable and what the downgrades will make usable
  //   tokens     whether the pocket still lacks its example tree / rock
  //   opts.homeId       the player's Home house id, so it isn't counted as a wreck
  //   opts.radiusCells  how far out to look (default RING_MAX_CELLS). Widens
  //                     when an earlier pass had to escalate past the band to
  //                     find ground, so what it seated out there still counts
  //                     and the quota isn't provisioned twice.
  //   opts.wildplants   the area's wild-plant stream. Passed separately because
  //                     it IS separate in the tile (entry.wildplants, keyed by
  //                     `crop` where objects are keyed by `kind`) — merging the
  //                     two into one list here would only hide that.
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
        // rarity (the occasional ore-bearing rock / bigger tree). It fills
        // its slot in the quota — a later pass must not seat a replacement
        // beside it, and must never downgrade the find back to plain.
        have[kind]++;
      } else if (this.canBeStarterUsable(o)) {
        // Untameable ones (a shiny tree) are skipped entirely — they are
        // scenery as far as the quota is concerned.
        candidates[kind].push({ o, d });
      }
    }
    // Tame ONLY as many as the quota is short by, nearest first. Taming every
    // unusable tree in range would flatten a wooded street into saplings to
    // supply four of them — the opposite of "home looks like the player's
    // actual neighbourhood".
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
    // Food already growing in the area counts, the same way a usable tree does:
    // a woodland spawn with mushrooms all over it is not owed six more. No
    // downgrade path — there is nothing about a wild plant to make easier.
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
