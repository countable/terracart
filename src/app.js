// terracart prototype — gameplay layer on top of MVT-driven world.
// - Mobile-sized Phaser canvas (390x844). 11x11 viewport of 5m cells.
// - Real GPS (Geolocation API) if available + permitted; WASD fallback.
// - Tap player to lock/unlock GPS snap.
// - Random creatures spawn in grass/farmland cells (seeded per tile).
// - Tap creature → catch (added to farm). Tap ground with seed selected → plant.
// - Inventory bottom bar shows starter items; tap to select.

// Home — 3586 Athalmer Rd, Kelowna BC. The default world origin and where the
// satextract DeepForest trees live.
const HOME_LON = -119.47870;
const HOME_LAT = 49.85438;
// Teleport presets — well-mapped suburban areas to showcase OSM features
// (trees, street furniture, etc.). Counts are mapped natural=tree nodes within
// ~300 m, measured against Overpass on 2026-05-29. Edit this table to add/
// remove destinations; index.html builds the menu from window.TELEPORT_PRESETS.
// A preset relocates the world origin (START_LON/LAT) on reload and disables
// GPS for the session so the player stays at the chosen spot.
const TELEPORT_PRESETS = {
  home:     { name: 'Home (Kelowna)',   lon: HOME_LON,    lat: HOME_LAT   },
  paloalto: { name: 'Palo Alto, CA',    lon: -122.1500,   lat: 37.4222    },
  seattle:  { name: 'Seattle (Ballard)',lon: -122.3840,   lat: 47.6680    },
  munich:   { name: 'Munich, Germany',  lon: 11.6100,     lat: 48.1520    },
};
// Active teleport override (set by the menu, persisted in localStorage). Read
// once at load so the entire projection initializes for the chosen latitude.
let _teleportOverride = null;
try {
  const raw = localStorage.getItem('terracart.teleport');
  if (raw) {
    const o = JSON.parse(raw);
    if (o && Number.isFinite(o.lon) && Number.isFinite(o.lat)) _teleportOverride = o;
  }
} catch { /* malformed override → ignore, fall back to home/GPS */ }
// Per-save FROZEN home origin. Set once from the first GPS fix on a brand-new
// save (see startGps), then used as the world projection origin forever — so
// each save is anchored at the player's real location instead of a hardcoded
// city. Read here at module load (before the scene builds the projection) so
// the whole world initialises at the saved home. initSaves() points SAVE_KEY
// at the active slot; loadSave() then reads that slot's data. A teleport
// override still wins (it's an explicit relocation).
let _saveHome = null;
try {
  if (typeof initSaves === 'function') initSaves();
  const _sv = (typeof loadSave === 'function') ? loadSave() : null;
  if (_sv && _sv.home && Number.isFinite(_sv.home.lat) && Number.isFinite(_sv.home.lon)) {
    _saveHome = _sv.home;
  }
} catch { /* no saved home → fall back to teleport / HOME */ }
const START_LON = _teleportOverride ? _teleportOverride.lon : (_saveHome ? _saveHome.lon : HOME_LON);
const START_LAT = _teleportOverride ? _teleportOverride.lat : (_saveHome ? _saveHome.lat : HOME_LAT);
// Expose the preset table + active override so index.html can build the menu.
if (typeof window !== 'undefined') {
  window.TELEPORT_PRESETS = TELEPORT_PRESETS;
  window.TELEPORT_ACTIVE = _teleportOverride;
}
// Metres per degree of latitude (≈ constant everywhere). Longitude metres
// additionally scale by cos(latitude). This is a rule-of-thumb scale — it is
// NOT how a GPS fix reaches the map any more: that goes through the map's own
// Web-Mercator projection (coords.js lonLatToLocalM), which is exact at any
// distance from the origin. Kept because worldgen.js scatters small features
// off the same number.
const METERS_PER_DEG_LAT = 111320;
const VIEW_CELLS = 11;
const CELL_PX = 32;
const WALK_M_S = 1.4;
// Surface GPS gap (metres) past which a fix PLACES the body instead of being
// walked off. The body chases the GPS target at up to DEBUG_SPEED_MUL × walk
// pace (14 m/s), which comfortably keeps up with a real walk or a slow drive;
// anything beyond this is a vehicle trip or a backgrounded tab catching up —
// travel the player never made on foot, so walking it back would be a
// minutes-long trek across terrain they aren't on any more. 200 m is roughly
// 15 s of that chase, and about three screens of the 11-cell view.
// Underground is exempt: down there the body mines its way to the target no
// matter how far, and a snap would drop the player inside solid rock.
const GPS_SNAP_M = 200;
// Backoff for re-fetching a 3x3 tile block that came back short (see
// _scheduleTileRetry). The floor clears WorldGen's own per-tile failure
// backoff (TILE_RETRY_MS, 3 s) so a retry isn't answered from it, and the cap
// keeps a genuinely offline session down to one attempt a minute rather than
// hammering a host that isn't answering.
// How long a neighbouring tile's build will wait for an idle moment before
// going ahead anyway (see _whenIdle). Long enough that a player actively
// walking and tapping keeps the thread, short enough that the ring is all in
// well before they could walk out of the centre tile.
// A pot of gold bursts into at least this many coins. The scatter search
// widens until it can seat them (see _coinBurstInteract) — a burst that came
// back with one coin was the search giving up, never the reward being small.
const COIN_BURST_MIN = 8;
const RING_IDLE_TIMEOUT_MS = 400;
const TILE_RETRY_BASE_MS = 4000;
const TILE_RETRY_MAX_MS = 60000;
// Save fields written by the passes that run BEFORE a home is captured — the
// starter crate anchor, the guaranteed soil plot and the starter-home
// provision. Every one of them is DERIVED from the projection origin and is
// rebuilt from scratch at a new one, so none of them commits the save to the
// origin it was built at.
//
// They are cleared together by the capture path and skipped together by
// _worldPlaced(), off this one list, because the bug was exactly the two
// disagreeing: the 2-minute safety net freezes the crate anchor at the default
// origin, and _setStarterCratesAt places the trail, which carves the plot and
// provisions the home. Only starterCratesAt was treated as provisional, so the
// net's own side effects made _worldPlaced() true within a frame of it firing —
// and the very next GPS fix, the one the net had deliberately stayed armed for,
// was thrown away. A player whose first fix took over two minutes (a cold
// start indoors, a new install, a permission dialog left sitting) was anchored
// at the default map for good, with their crates, Home and objective arrow a
// city away and no warning under ORIGIN_STRANDED_M.
const PROVISIONAL_ORIGIN_KEYS = ['starterCratesAt', 'starterPlotAt', 'starterHome'];
// How far a player can stand from their world's projection origin before that
// origin is definitively WRONG rather than merely far — see _warnStrandedOrigin.
// Only reachable by a save that never captured a home (its first GPS fix was
// too slow, or was denied and later granted): the world, Home and the starter
// trail were all built at the default map while the player is somewhere else
// entirely. 25 km is well past a day's walk and well past any GPS error.
const ORIGIN_STRANDED_M = 25000;
const W = 352, H = 844;   // 352 = VIEW_CELLS × CELL_PX → map view fills the canvas edge-to-edge with no horizontal padding
// How far above dead-centre every dialog rides (game px, in #game's 844-tall
// box). Reserved as bottom padding on the shared modal wrap so the flex-centred
// box lifts clear of the bottom inventory/HUD cluster. See makeModalShell —
// this is the one knob that moves all dialogs together.
const MODAL_LIFT_PX = 140;

// ── Toast style ────────────────────────────────────────────────────────────
// One dark chip for every in-world message, and one four-step type scale. The
// old code had #000a, #000c and rgba(0,0,0,.6) for what was meant to be the
// same chip, and 12 / 16 / 22 / 26px picked independently per call site.
//
// The four tiers are the distinctions worth keeping:
//   note    — "that didn't work", small status. Lands where the player TAPPED
//             so it stays attached to the thing they touched. No pop: a status
//             message that animates in reads as more important than it is.
//             The only tier with NO chip (bg: null) — it sits ON the map at
//             the tapped cell, and a dark box there hides the thing the
//             message is about. A drop shadow lifts it off the ground instead.
//   sub     — a second line under a fanfare. Fades rather than pops so it
//             doesn't compete with the headline it belongs to.
//   gain    — "you got something". Centred, pops in, can carry an icon.
//   fanfare — jackpot / shiny. Biggest, keeps its own chip colour, overshoots
//             and settles, and stacks ABOVE a gain (hence the depth gap).
//
// dy is the offset from the viewport centre, and the ladder of values is what
// lets a gain and a fanfare fired in the same moment stack instead of overlap.
const TOAST_BG = '#000c';
const TOAST_TIER = {
  // pad here buys no visible chip — it stops Phaser cropping the shadow's
  // blur at the glyph bounds, which is what makes an un-chipped Text look
  // like its shadow has a straight edge cut through it.
  note:    { font: '12px',      stroke: 0, pad: 6,  padY: 4, depth: 100, dy:  -70,
             bg: null, shadow: { offsetX: 1, offsetY: 1, blur: 4 },
             pop: 0,   hold: 1300, fade: 700, rise: 30 },
  sub:     { font: 'bold 16px', stroke: 3, pad: 8,  padY: 3, depth: 110, dy: -142,
             pop: 0,   fadeIn: 240, hold: 1800, fade: 700, rise: 60, ease: 'Sine.In' },
  gain:    { font: 'bold 22px', stroke: 3, pad: 10, padY: 5, depth: 101, dy:  -90,
             pop: 140, popScale: 0.6, hold: 1440, fade: 700, rise: 50, ease: 'Sine.In' },
  fanfare: { font: 'bold 26px', stroke: 4, pad: 14, padY: 6, depth: 110, dy: -150,
             pop: 220, popScale: 0.2, overshoot: 1.1, hold: 1800, fade: 700, rise: 60,
             ease: 'Sine.In' },
};

// ── What KIND of dialog is this? ────────────────────────────────────────────
// Every modal opens with one of these: a hero icon and a one-word category, so
// the player knows what they are looking at before reading a line of it — a
// castle says QUEST, a chest says TREASURE, a blacksmith says FORGE. Dialogs
// used to open straight into flavour copy ("The trader offers:"), which reads
// fine once you already know where you are and not at all when you don't.
//
// The label is the CATEGORY, not the specific offer — the flavour line under
// it still carries that. Callers may override the label for a one-off outcome
// ("MILL LANE complete") and keep the kind's icon; see showChestRewardModal.
//
// `supplies` exists because the tutorial's own material handout was opening as
// TREASURE: the objective chip calls them supply crates, they render as the
// humble box sprite precisely so they read as supplies, and then 9 wood
// arrived under a diamond. Spending the treasure ceremony there costs it its
// meaning for the thing at the end of the same trail that IS treasure — the
// spawn relic chest. The COLOUR stays blue-white either way: both are things
// the world gives the player (spec §UI COLOUR LANGUAGE). Only the word and the
// hero icon change.
//
// Keys are referenced by every modal call site and pinned by
// tools/modal_audit.js, which fails the build if a dialog opens without one.
const MODAL_KINDS = {
  quest:    { icon: '🏰', label: 'Quest'     },   // castle quest board
  treasure: { icon: '💎', label: 'Treasure'  },   // chests, boxes, loot ceremonies
  supplies: { icon: '🧰', label: 'Supplies'  },   // the starter crates' handout — see below
  trail:    { icon: '🗺️', label: 'Trail'     },   // road/trail completion rewards
  shop:     { icon: '🪙', label: 'Shop'      },   // buying and selling for money
  trade:    { icon: '🤝', label: 'Trade'     },   // goods-for-goods barter
  forge:    { icon: '🔨', label: 'Forge'     },   // blacksmith: forging + smelting
  relics:   { icon: '💍', label: 'Relics'    },   // relic + armor offers
  delivery: { icon: '📦', label: 'Delivery'  },   // household orders
  build:    { icon: '🛠', label: 'Build'     },   // restoring wrecks, unsealing forts, moving home
  wizard:   { icon: '🔮', label: 'Wizard'    },   // Inner Light reach upgrades
  farm:     { icon: '🌾', label: 'Farm'      },   // scarecrows, feeding fauna
  stats:    { icon: '📊', label: 'Stats'     },   // stats & relics readout
  energy:   { icon: '⚡', label: 'Energy'    },   // the energy explainer
  rest:     { icon: '😵', label: 'Exhausted' },   // passing out underground
  use:      { icon: '🎒', label: 'Use'       },   // confirming a consumable from the bag
  note:     { icon: '📜', label: 'Note'      },   // generic message dialog
};

// Inventory category tabs (the top bar of the two-bar bottom HUD). The order
// here is the on-screen left→right order. Item categories filter save.inv by
// `kind`; gear categories (relic / armor) synthesize their slot list from
// save.relics / save.armor (one-per-slot) instead of save.inv. `sym` is the
// tab glyph — plain emoji so no new pixel art is needed for the chrome.
const INV_CATS = [
  { key: 'seed',        label: 'Seeds',       sym: '🌱', kinds: ['seed', 'sapling'] },
  { key: 'produce',     label: 'Produce',     sym: '🍎', kinds: ['produce'] },
  { key: 'animal',      label: 'Animals',     sym: '🐔', kinds: ['animal'] },
  { key: 'relic',       label: 'Relics',      sym: '💍', gear: 'relic' },
  { key: 'armor',       label: 'Armor',       sym: '🛡️', gear: 'armor' },
  { key: 'ores',        label: 'Ores',        sym: '💎', kinds: ['mineral'] },
  // 'badge' = the Discovery badge stack — listed here so it's visible/countable,
  // though it's spent only at the wizard tower (no tap-to-use handler).
  { key: 'consumables', label: 'Items',       sym: '🧪', kinds: ['consumable', 'badge'] },
];
const INV_CAT_BY_KEY = Object.fromEntries(INV_CATS.map(c => [c.key, c]));
// Slot draw order within each gear tab (owned slots only are rendered).
const INV_RELIC_ORDER = ['pick', 'axe', 'sword', 'bow', 'staff', 'ring', 'amulet', 'can', 'hoe', 'bugnet', 'rod', 'bags'];
const INV_ARMOR_ORDER = ['helmet', 'chest', 'legs', 'boots'];
// The three combat weapons — the only slots save.activeWeapon ever holds. Only
// the active one auto-engages (sword) or auto-fires (bow/staff) in _combatTick;
// the others sit inert until switched to (tapping one in the Relics tab, or
// obtaining/forging a new one — see Gear.equip). Mirrors Gear.WEAPON_SLOTS.
const WEAPON_SLOTS = ['sword', 'bow', 'staff'];

// Terrain cell types fauna may NEVER step onto (spec §fauna: "no fauna may move
// onto a building footing, or road"). WATER (3) + all building tiers (9/11/12)
// + all road tiers (ROAD 7 / ROAD_LG 13 / ROAD_MD 14). PATHS (8) are pedestrian
// / public and stay passable.
const FAUNA_BLOCKED_TYPES = new Set([3, 9, 11, 12, 7, 13, 14, 25 /* CAVE_WALL */]);
function faunaBlocksCell(type) { return FAUNA_BLOCKED_TYPES.has(type); }

// Underground wandering MONSTERS. Mechanically they're the surface slime: each
// drifts toward the player and drains energy when within RANGE — but they
// differ by HP / RANGE / DMG / SPEED. Only the goblin archer reaches past one
// cell (range 3); everything else is melee (range 1). Tougher kinds are gated
// to deeper levels via minDepth, so descending introduces new foes. Placeholder
// art: every monster reuses the slime sprite with a per-kind TINT (see
// render.js) until dedicated sheets land — swapping in real art is a one-line
// assets.js + render.js change per kind.
//   hp     → defeat work-wheel length (scaled off the 15-HP slime baseline)
//   range  → cells within which it drains energy
//   dmg    → energy drained per hit (one hit per MONSTER_HIT_MS per monster)
//   speed  → step cadence multiplier (1 = slime cadence; higher = moves more often)
//   weight → relative spawn share among the kinds eligible at a given depth
// hp and dmg below are the BASELINE: every entry is doubled by CAVE_ENEMY_MUL
// right after the table, so what the game runs on is twice what is written.
const MONSTERS = {
  cave_slime:    { name: 'Cave Slime',    hp: 15, range: 1, dmg: 2, speed: 0.7, minDepth: 1, weight: 5 },
  purple_slime:  { name: 'Purple Slime',  hp: 6,  range: 1, dmg: 1, speed: 1.8, minDepth: 1, weight: 4, fly: true },
  goblin:        { name: 'Goblin',        hp: 25, range: 1, dmg: 4, speed: 1.0, minDepth: 2, weight: 3 },
  goblin_archer: { name: 'Goblin Archer', hp: 18, range: 3, dmg: 3, speed: 0.8, minDepth: 3, weight: 2 },
};
// The first slime is the tutorial; everything past it is a real fight.
//
// The wild surface slime is the only enemy above ground and the first one
// anybody meets — deliberately gentle, a crop pest you can walk away from.
// Every enemy BEYOND it is underground, chosen by a player who went looking,
// and those are twice the foe: double HP and double damage.
//
// Applied as ONE rule over the baseline above rather than eight retuned
// numbers, so the ratio to that first slime stays readable at a glance and a
// kind added to the table inherits the doubling the moment it has stats. The
// knock-ons are derived and intended: the dps identity is untouched, so double
// HP is exactly double the time to kill at any weapon tier, and enemyBounty
// pays per HP, so a foe that takes twice as long pays twice as much.
const CAVE_ENEMY_MUL = 2;
for (const m of Object.values(MONSTERS)) {
  m.hp *= CAVE_ENEMY_MUL;
  m.dmg *= CAVE_ENEMY_MUL;
}
// Seconds between one monster's hits. Per user: monsters were landing a hit a
// second each, so a pack shredded the energy bar faster than it could be read —
// halved to one hit per 2 s. (The surface slime keeps its own 1 s cadence: it's
// a crop pest, not a cave enemy.)
const MONSTER_HIT_MS = 2000;

// combat.js owns the fight maths (HP, melee dps, bow/staff shots) and is loaded
// before this file so headless tests can use it without Phaser. It needs the
// monster stats to answer "is this an enemy" and "how much HP", so hand the
// table over — by REFERENCE, so a kind added above is a foe there immediately.
// It sits HERE, against the table, rather than further down the file: the
// bounty below asks Combat how much HP a kind has, so the registration has to
// come first, and the headless lift of this block gets it for free.
Combat.registerMonsters(MONSTERS);

// --- Defeat bounty -------------------------------------------------------
// A defeated enemy used to drop NOTHING: you paid the work wheel and the energy
// it drained off you and got a flash message, so the only rational play was to
// walk around every foe you met. Now a kill pays coins, always.
//
// EVERY ENEMY DRAWS ONE, not just the cave monsters. `Combat.isEnemyKind` is
// the single definition of "a thing that attacks you" — the cave monsters and
// the surface slime — and it is what this reads, so a hostile kind added to
// MONSTERS is priced the moment it has stats and can never end up fought for
// free. The surface slime was exactly that gap: it fights you, it eats your
// crops, and killing one paid nothing at all. Crow and deer are NOT enemies
// (they're game) and still pay in feathers and meat instead.
//
// The bounty is DERIVED from `hp` — the same number that sets the wheel length
// — rather than hand-tuned per kind, so a tougher foe can never quietly pay
// less than an easier one. Roughly a coin per 5 HP, floored at 1:
//   surface slime 15hp → $3 · purple slime 12hp → $2 · cave slime 30hp → $6 ·
//   archer 36hp → $7 · goblin 50hp → $10
//   (the cave kinds are the doubled ones — see CAVE_ENEMY_MUL above)
// The HP comes from Combat.creatureMaxHp, which is the monster table first and
// the fauna ladder second — one source, so the coins a kind pays and the HP you
// have to chew through can't drift apart. Depth adds a slow climb on top (a
// coin per 3 levels down) so descending pays for itself even where the same
// kinds keep spawning; at the surface it contributes nothing.
const ENEMY_COIN_PER_HP  = 1 / 5;
const ENEMY_DEPTH_BONUS  = 1 / 3;    // extra coins per level below the surface
function enemyBounty(kind, depth) {
  if (!Combat.isEnemyKind(kind)) return 0;
  return Math.max(1, Math.round(Combat.creatureMaxHp(kind) * ENEMY_COIN_PER_HP))
       + Math.floor(Math.max(0, depth || 0) * ENEMY_DEPTH_BONUS);
}
// Chance a defeated CAVE MONSTER also drops a buried-treasure roll — literally
// the same pickReward('treasure:default') payout digging an X gives, so the
// rare drop needs no table of its own and can't drift from the one players
// already know. Deliberately small: the coins are the wage, this is the
// surprise. Unlike the wage it stays a monsters-only thing — a buried hoard is
// something you turn up underground, and the surface slime in your potatoes is
// not standing on one.
const MONSTER_TREASURE_CHANCE = 0.10;
const MONSTER_KINDS = new Set(Object.keys(MONSTERS));
function isMonster(kind) { return MONSTER_KINDS.has(kind); }
// What a tame pet hunts (wanderCreatures' prey scan) — hoisted so the per-step
// scan doesn't allocate fresh Sets.
const CAT_PREY = new Set(['crow']);
const DOG_PREY = new Set(['deer', 'slime']);
// ── Home is pest-free until the first harvest ────────────────────────────
// A slime sits on your crops and drains 3 energy a second, a crow eats the
// crop outright, and the opening session is the one stretch a player has
// nothing to answer either with: no weapon, no relic, an empty bag and a
// ladder telling them to stand still and till. Meeting a pest there is not a
// fight, it is the tutorial being interrupted — so until the save's FIRST
// CROP IS HARVESTED (save.hasHarvested, stamped at the harvest site in
// interact.js) the fauna spawner seats no slime and no crow anywhere near the
// starting anchor. It is a spawn rule, not a cull: the same number of each
// spawn per tile, they just land outside the home area (the count is
// preserved by retrying the cell, see tryPlace), and the rest of the map is
// as it always was — walk a couple of hundred metres and there they are.
//
// Baked into the tile at build time, so a tile built during the grace period
// keeps its clear home area until it is rebuilt: no pest pops into being at
// the player's feet the moment the first crop comes in.
//
// Chebyshev radius of the amnesty, in cells. The starter home's own ring
// reaches 16 (HomeArea.RING_MAX_CELLS) and the relic chest sits at 11, so this
// covers everything the opening asks a player to walk to, plus a few cells
// so a pest isn't spawned right on the edge of it.
const PEST_FREE_CELLS = 20;
// How long a wounded enemy keeps its floating health bar after the last hit.
// A bow shot lands from clear across the screen, so without this the only
// feedback for a hit would be the foe eventually vanishing — but a bar that
// never faded would clutter a cave full of monsters you shot once.
const ENEMY_HEALTH_RING_MS = 4000;
// Damage numbers are throttled per foe: a shot pops its whole payload at once,
// but the melee wheel lands fractional damage EVERY FRAME, so without a beat
// between popups a sword fight would spray sixty overlapping "-0"s a second.
// Damage keeps accumulating between beats and pops as one rounded number, so
// nothing is lost to the throttle — it just reads as swings instead of a hose.
const DMG_POPUP_BEAT_MS = 500;
// How long ONE drawn sword swing lasts, in ms — the slash sweeps across its
// arc over this window, then fades. Swings themselves fire on the SAME
// DMG_POPUP_BEAT_MS cadence the damage numbers already beat at (see above:
// "it just reads as swings instead of a hose") — one throttle, so the blade
// and the number it earns land on the same beat instead of drifting apart.
// Comfortably shorter than the beat itself so one slash finishes before the
// next starts, whatever the weapon's tier.
const SWORD_SWING_MS = 220;
// Screen-px lift on a drawn shot. Shots fly between FOOT positions (the anchor
// every creature and the player use), so without this they'd skim the ground
// under the bodies they hit.
const SHOT_DRAW_LIFT_PX = 10;
// Crows ignore potato crops — they won't notice, orbit, land on, or eat them.
// The rule (and its crop set) now lives in crops.js; this stays as a free-
// function alias because the crow pest logic calls it bare in several spots.
function crowEatsCrop(p) { return Crops.crowEats(p); }

// --- Debug ---
// WASD and arrow keys move the player at DEBUG_SPEED_MUL × walk speed when DEBUG is true.
const DEBUG = true;
const DEBUG_SPEED_MUL = 10;
// Dragon Powder is not a movement mode — it's a stat buff wearing a dragon
// sprite. For its minute the player walks as if they had an amulet of this
// tier (one past Frost, see items.js steerSpeedMul / steerEnergyCost) and hits
// twice as hard (interact.js). The Speed potion stands in a tier higher still.
// Straying from your real position, in cells. Inside this ring stick walking is
// cheap (you're pottering around the spot you're actually standing on) and the
// character reads normally; outside it the walk costs full price and the
// character darkens the further out they get.
// Fog of war: how much of the starting neighbourhood is known ground before
// the player has walked a step. See _revealStarterTrail — the onboarding trail
// is a sightline chain (walk to the crate you can see, and the next is in
// view), and the walk's own 3-cell reveal cannot carry that on a fresh save.
//
// HOME is the player's own block, which they are not discovering: the tutorial
// pocket _placeStarterTrail clears and curates (CLEAR_R = HomeArea.POCKET_CELLS)
// AND the near half of the starter ring seated just outside it, so the trees
// and rocks ringing the opening screen are lit rather than sitting under the
// wash. It stays 10 even though the pocket is now 5 for exactly that reason —
// a reveal cut back to the pocket would re-fog the ring. TRAIL is the margin
// around each crate and the relic chest, wide enough that a crate reads as
// sitting on ground rather than punched out of the dark, and narrow enough
// that the map still opens up by being walked rather than by spawning.
const HOME_REVEAL_CELLS = 10;
const TRAIL_REVEAL_CELLS = 5;
// How close a road or path has to pass to the starting anchor for the supply
// crates to be laid along its shoulder instead of spread down the walk to the
// relic chest (see _placeStarterTrail). The objective chip literally says
// "supply crates were left along the road nearby", so when there IS a road
// nearby, the crates keep its word. 6 cells (~40 m) is "very near": the kerb
// is in view from the doorstep, so the trail still starts with a crate the
// player can see.
const NEAR_ROAD_CELLS = 6;
const NEAR_GPS_CELLS = 3;
const NEAR_GPS_COST_MUL = 0.2;      // 80% off inside the ring
// How long the stick must sit idle before the character walks itself home.
//
// This is a DEBOUNCE, not a pause — it exists so lifting a thumb to reposition
// it doesn't send the character trotting back the instant you let go. Long
// enough that stopping to look around, line up a tap, or shift your grip is
// simply standing still; short enough that a player who has genuinely finished
// walking isn't left waiting on a character that won't come back.
//
// It has been both too long and too short. At 3000 ms it read as the character
// ignoring you. Chasing that, it went to 700 ms and then 500 ms, which is a
// hair-trigger: players nudge themselves along in short pushes, and every beat
// between pushes started a return, so the character was forever leaning back
// against the direction of travel. 5000 ms is the number playtesting settled
// on — past the longest natural gap between two deliberate stick pushes, so the
// walk home only ever starts when the player has actually stopped.
//
// The timer only decides when the return BEGINS, and it begins gently: the
// speed eases in over WALK_HOME_RAMP_MS below rather than switching on at full
// pace, so even a push that lands just after the timer expires gives up almost
// no ground. That ramp is what keeps a longer debounce from feeling like a
// cliff in the other direction.
const WALK_HOME_IDLE_MS = 5000;
// How long the walk home takes to reach full pace once it starts. Squared, so
// the first fraction of a second is nearly stationary — that is what stops an
// interrupted nudge from reading as the character fighting you — and the last
// stretch is at normal walking speed.
const WALK_HOME_RAMP_MS = 1100;
// ...and how long before the walk home SHOWS ITSELF (_drawWalkHomeHint). The
// hint is deliberately quieter than the walk: a player who has just let go of
// the stick knows perfectly well what the character is doing, so the lead line
// stays out of the way until the stick has been untouched for this long.
//
// It has to stay LONGER than the walk's own delay (or the lead line appears
// before there's a walk to lead) but not so much longer that it never shows:
// a typical return is over in a couple of seconds, so a hint that waits much
// past the walk's start only ever appears on very long journeys home. Tracks
// WALK_HOME_IDLE_MS — it is that plus a beat and a half.
const WALK_HOME_HINT_IDLE_MS = 6500;
// Shared unit for the consumable-buff durations below (reach/speed/shield
// potion, dragon powder, coffee, pairy compass) so a duration reads as a
// count of minutes instead of a repeated 60 * 1000 literal.
const MINUTE_MS = 60 * 1000;
// Flower charm — gifting a Flowers stack item to a cash shop halves its
// prices at that building for this long (see the flower-gift branch in
// shopInteract + shopCharmMul).
const SHOP_CHARM_MS = 5 * MINUTE_MS;
const DRAGON_AMULET_TIER = 8;
const SPEED_POTION_AMULET_TIER = 9;
// Coffee: unlike Dragon Powder / the Speed potion (which OVERRIDE the amulet
// tier used for stick-walking to a fixed high number), coffee is a common
// crop, not a rare potion — so it just gives a caffeine-buzz +1 tier for 3
// minutes, stacking additively on top of whatever tier is already in play
// (worn amulet, Dragon, or the Speed potion), capped at the same ceiling
// those top out at so a coffee can't out-tier the rarest buff.
const COFFEE_AMULET_BOOST = 1;
const COFFEE_BUFF_MS = 3 * MINUTE_MS;
// Tap diagnostics (interact.js _tapDiag): when on, a canvas tap that produces no
// visible action flashes WHY (out-of-bounds / busy wheel / nothing here), to
// debug "taps randomly stop working". On by default in DEBUG builds; force on
// anywhere with ?debugtaps in the URL. Set window.DEBUG_TAPS = false to silence.
if (typeof window !== 'undefined') {
  window.DEBUG_TAPS = DEBUG || /[?&]debugtaps\b/.test(location.search || '');
}

// --- Tap reach (metres). Used by handleWorldTap distance checks. ---
// The per-target tap-PRECISION radii that used to live here (wild plant 4 m,
// object 3.5 m, house 6 m + a 4 m northward rise, treasure 7.5 m) are gone:
// every non-fauna target is now hit-tested against its OWN CELL (interact.js
// findItemInTapCell / sameAbsCell), because any disk wide enough to cover its
// own cell also spilled into the neighbouring ones. Creatures still use a
// per-kind drawn-sprite box in interact.js — they move and aren't cell-bound.
// Outer "too far" gate. Matches the visual reach outline drawn by drawCells
// (coords.js reachRadiusM). Distance is measured from the player's CELL CENTRE
// (not their feet) — same basis as the visual — so any cell shown inside the
// reach outline is tappable, regardless of where in the cell the player stands.
// 16m = √(5² + 15²) + ε, just enough to include (±1, ±3) and (±3, ±1) so the
// reach silhouette is a rounded square rather than a strict 3-cell diamond.
const REACH_FAR_M       = 16;

// --- Economy tuning ---
// Deliveries (plain-house produce-set turn-ins) pay this multiple of the set's
// summed full price — a 50% premium over selling the items individually.
const DELIVERY_BONUS_MULT = 1.5;
// A castle stays sealed until the player has proven themselves on the delivery
// routes. Gated by the lifetime tally (save.deliveryCount): the vault opens
// after a number of completed deliveries. Replaces the old one-time goods
// tribute — the price of entry is footwork, not a stack of produce.
//
// The gate FOLLOWS A PROGRESSION across castles: the first castle you open
// asks for CASTLE_DELIVERY_GATE_START (2) deliveries, and each subsequent
// castle steps up by CASTLE_DELIVERY_GATE_STEP (1) — 2, 3, 4, 5 … — capped at
// CASTLE_DELIVERY_GATE (5). "How many castles already opened" is tracked in
// save.openedCastles (a per-castle id map, recorded the first time you reach
// an unsealed vault).
const CASTLE_DELIVERY_GATE = 5;
const CASTLE_DELIVERY_GATE_START = 2;
const CASTLE_DELIVERY_GATE_STEP = 1;
// A fort, by contrast, is unsealed with materials — like restoring a wreck
// house, the player pays a one-time stack of wood to open the quartermaster.
// Recorded per-fort in save.unlockedForts.
//
// The wood price ALSO FOLLOWS A PROGRESSION: the first fort you unseal costs
// FORT_UNLOCK_WOOD_START (6) wood and each later fort steps up by
// FORT_UNLOCK_WOOD_STEP (6) — 6, 12, 18, 24, 30 … — capped at FORT_UNLOCK_WOOD
// (30). The step index is "how many forts already unsealed" (save.unlockedForts).
const FORT_UNLOCK_WOOD = 30;
const FORT_UNLOCK_WOOD_START = 6;
const FORT_UNLOCK_WOOD_STEP = 6;
// Pre-seeded house roles by RESTORE ORDER (0-based). Rather than skinning the
// two nearest houses as blacksmith/trader up front, a wreck reveals its role
// from the order the player restores it: the opening stretch is a fixed
// tutorial run (blacksmith, trader, house, market, house, house) and the 15th
// restore is always a wizard tower. Restores BEYOND these slots fall back to
// the address-derived Shops.shopType so the wider neighbourhood keeps its
// organic variety. 'plain' === a plain residential house (no shop). The chosen
// role is frozen into save.restoredHouses[id] at restore time so it never
// shifts on later loads.
const PRESEED_RESTORE_ROLES = {
  0:  'blacksmith',
  1:  'trader',
  2:  'plain',
  3:  'market',
  4:  'plain',
  5:  'plain',
  14: 'wizard',   // the 15th restored wreck is a wizard tower
};
// Delivery wishlists unlock higher tiers as the player's lifetime tally grows;
// the tier cap (PRODUCE_TIER_MIN/MAX, TIER_UNLOCK_EVERY) and the wishlist roll
// now live with the rest of the delivery logic in delivery.js (Delivery.tierCap).
// Trader BARTER deals hand the player this many of the offered item per deal,
// so swapping goods is twice as favourable as raw cash. CASH purchases are
// deliberately excluded (they hand over exactly 1): a ×2 cash bundle made the
// effective per-unit buy price ~0.6× base, which a mid-tier Sword (sell
// 0.5→1.0×) turned into a buy-then-resell money loop.
const TRADE_OFFER_QTY     = 2;

// Compare-only squared distance — avoids sqrt.
function distM2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

const COLORS = {
  // POST-APOCALYPTIC FARM PALETTE. The world is a neighbourhood going back to
  // seed: sun-bleached, dust-blown, overgrown rather than landscaped. Every
  // ground tone is pulled toward khaki / olive / grey-brown, and saturation is
  // kept low so the eye reads the world as backdrop.
  //
  // YELLOW IS RESERVED FOR PLAYER INTERACTION — menus, buttons, the stick,
  // money, loot. No terrain may claim it, or the one colour that means "you
  // can touch this" turns into scenery. That is why sand, the paths, the
  // farmland mud, the plank floors and tilled soil all sit in grey-brown and
  // olive here rather than the golds they used to carry.
  0: 0x6b7d4a,  // grass — dry meadow khaki-green (was a fresh lawn green)
  1: 0x3c5233,  // forest — deep desaturated olive
  2: 0xc6b9a2,  // sand — pale grit; was a golden tan, the worst yellow offender
  3: 0x3f6b7a,  // water — murky standing teal, not swimming-pool blue
  4: 0x7e7350,  // farmland — dull olive-brown mud
  5: 0x9c968a,  // residential — dirty concrete
  6: 0x7b8c53,  // park — unmown, going to seed
  7: 0x474441,  // road — asphalt with dust blown over it
  8: 0x8b8071,  // path — a worn grey dust track
  9: 0x9d6350,  // building — small house: weathered brick
  10: 0x776d63, // rock
  11: 0x9b8365, // building_med — weathered grey-brown plank floor
  12: 0x787a80, // building_large — civic / castle floor (mid slate; carries a subtle cobble overlay (drawCastleFloorTex), kept darker than the LIGHT rampart walls)
  13: 0x3b3936, // road_lg (motorway/trunk/primary) — darkest
  14: 0x413f3b, // road_md (secondary/tertiary)
  // --- Subtype splits — each tile fits into one of three base biomes ---
  15: 0x77805e, // SCHOOL       (GRASSLAND) — schoolyard: greyer, patchier turf than the meadow around it
  16: 0x999790, // COMMERCIAL   (ROCKY)     — grimy floor tile
  17: 0x9a8279, // INDUSTRIAL   (ROCKY)     — same hue, rust-dusted
  18: 0x8e8270, // PLAYGROUND   (GRASSLAND) — rotting mulch
  19: 0x62753f, // PITCH        (GRASSLAND) — pitch markings long gone
  20: 0x3d4f3c, // WETLAND      (FOREST)    — dim swampy green
  21: 0x87995c, // GOLF         (GRASSLAND) — fairway reverting to scrub
  22: 0x556237, // ORCHARD      (FOREST)    — olive
  // PIER (transportation:pier OSM lines, painted as T.PIER=23 in worldgen).
  // Base cell colour is the water tone — the wooden plank sprite from
  // Objects/Wilderness/Bridge Beach.png is drawn on top via the cobblePool
  // (see render.js PIER_FRAME). The water peeks through any plank-art alpha
  // so the cell still reads as "walkway over water".
  23: 0x3f6b7a, // PIER         (WATER base) — plank sprite overlays on top
  // --- Underground cave biome (depth > 0) ---
  24: 0x4a423b, // CAVE_FLOOR — packed earth/stone floor (walkable)
  25: 0x241f1b, // CAVE_WALL  — near-black solid rock (surface buildings/roads/water)
  // UNMAPPED (30) — render-only: render.js stamps this on cells whose map tile
  // hasn't loaded yet (never appears in a tile's grid). Dark fog, deliberately
  // darker than every real biome so "beyond the charted world" reads as the
  // same visual language as the distance dim; textures.js drives the animated
  // survey-line shimmer over it (BIOME_TEX[30]).
  30: 0x2b2926,
};

// Tillable = soil-ish ground. Concrete pads / cement (commercial/industrial), water, all
// road tiers, paths, every building tier, and rock are NOT tillable.
// Rock (10) is non-tillable — mineral rocks spawn as objects on rock terrain instead.
// 23 = PIER (wooden walkway over water) — walkable but not soil.
const NON_TILLABLE = new Set([3, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 23, 24, 25]);
function isTillable(type) { return !NON_TILLABLE.has(type); }
// The full "can this CELL take a hoe / placement / released animal" test:
// soil-ish terrain AND no drawn road band over it. A cell's terrain says
// "grass" for most of the ground a road actually covers (see cellAt's
// underRoad note), so type-only checks let players till the middle of a
// street. Takes a cellAt() result; a stub cell without underRoad (tests)
// behaves exactly like the old type-only check.
function isTillableCell(cell) { return isTillable(cell.type) && !cell.underRoad; }
// Building interior cells — small house, fort, civic slab. Used for the
// "rest inside to recover energy" loop (slow, opt-in regen while indoors).
const BUILDING_TYPES = new Set([9, 11, 12]);
// Indoor resting fills the full energy bar in this many seconds while the
// player stands on a building cell. Slower than active food, fast enough to
// matter — sitting for ~5 minutes recovers from empty.
const INDOOR_FULL_REST_S = 300;
// Resting AT Home (the starter shop / trailer) is much faster than any other
// building — a full bar in 90s (~3.3× the indoor rate). The hearth bonus: your
// own place recovers you quickly. See isRestingAtHome + the rest loop in update.
const HOME_FULL_REST_S = 90;
// Resting near a lit campfire (burned from a coal on bare ground) refills the
// bar outdoors, but slowly — a full bar in 6 min (slower than any building).
// The trade-off: a fire also repels slimes nearby, so it makes a safe, slow
// recovery spot out in the wild. See the fire-warmth block in update().
const FIRE_FULL_REST_S = 360;
// A CLAIMED castle is a hearth. Visiting one gives back a tenth of the bar,
// once an hour per castle (save.claimedCastles[key] holds the last draw).
// Deliberately a lump on arrival rather than a rest rate like the ones above:
// the castle is somewhere you travel to, so the payoff should land the moment
// you get there instead of asking you to stand still on it. Small enough that
// it can't replace food or sleeping at Home — a tenth of a bar an hour is a
// courtesy for the walk, not an income.
const CASTLE_REST_FRAC = 0.10;
const CASTLE_REST_COOLDOWN_MS = 60 * 60 * 1000;
const FIRE_REST_R = 3;   // cells — must be within this of a fire to warm up
// Time-since-tab-close that grants the FULL energy bar back (1h, pro-rated
// linearly) now lives with the offline-rest formula in energy.js as
// Energy.OFFLINE_FULL_REST_MS.




// Chests pick a tier (weighted), then a random seed within that tier. Yield depends on tier.

// Tool slots the starter blacksmith can forge a wooden (T1) relic for. All
// six have wooden-tier art via gearAssetPath. The smithy picks 2 at random
// (see starterSmithSlots) as the player's bootstrap tools.
const STARTER_SMITH_SLOTS = ['pick', 'axe', 'hoe', 'rod', 'can', 'bugnet'];

// Relic slots the spawn treasure chest (see _placeStarterRelicChest) can hand
// out. Every one of these ships art in the `1. Wood` tier folder, which is what
// makes a WOODEN relic of it drawable; the two jewelry slots are absent because
// there is no wooden jewelry anywhere in the game (Gear.blacksmithRecipe refuses
// to forge one below T2), and the ring is the wizard tower's exclusive gift on
// top of that. Audited against the shipped PNGs in test/node/starter_relic.test.js.
const STARTER_RELIC_SLOTS = ['pick', 'axe', 'hoe', 'rod', 'can', 'bugnet', 'sword', 'bow', 'staff'];
// Wood — the first rung of MATERIAL_TIERS. The chest is a bootstrap, not a
// jackpot: it makes the player's first swing 2.25× quicker and leaves every finer
// tier to be bought, forged or looted.
const STARTER_RELIC_TIER = 1;

// ── Icon-sheet loading indicator + prewarm ──────────────────────────────────
// Modal item/gear icons are <span>s that CSS-clip a sheet PNG via
// background-image. A sheet that isn't in the browser cache yet paints
// NOTHING for the whole fetch — on a slow line the treasure ceremony opened
// on seconds of blank space where the reward should be. IconNet fixes that
// twice over:
//   1. INDICATOR — renderItemIcon / gearIconHTML tag any icon whose sheet
//      isn't known-loaded with .icon-loading (a soft pulsing plate holding
//      the icon's footprint; CSS in index.html) + data-iconsrc. A single
//      MutationObserver spots those spans as modals insert them, probes the
//      URL with an Image(), and strips the plate from every span showing
//      that sheet the moment it decodes. Probe and background-image share
//      the HTTP cache, so the swap is atomic — no double fetch.
//   2. PREWARM — a few seconds after boot (deliberately after the map tiles
//      have had first claim on the connection) every modal-only sheet is
//      trickled into the cache two at a time, so by the first chest the
//      plate never shows at all. ~110 small PNGs, idle bandwidth only.
const IconNet = {
  _loaded: new Set(),    // URLs known decoded + cached this session
  _loading: new Map(),   // URL → [afterFns] while a probe is in flight
  ready(url) { return this._loaded.has(url); },
  // Probe `url`; when it settles (load OR error — a 404 must not pulse
  // forever), mark it, clear the placeholder from every current span showing
  // it, then run `after` (the prewarm queue's pump).
  probe(url, after) {
    if (this._loaded.has(url)) { after?.(); return; }
    const waiters = this._loading.get(url);
    if (waiters) { if (after) waiters.push(after); return; }
    this._loading.set(url, after ? [after] : []);
    const img = new Image();
    const settle = () => {
      const fns = this._loading.get(url) || [];
      this._loading.delete(url);
      this._loaded.add(url);
      try {
        document.querySelectorAll('.px-icon.icon-loading').forEach((el) => {
          if (el.dataset.iconsrc === url) el.classList.remove('icon-loading');
        });
      } catch (_) { /* headless / detached DOM */ }
      for (const fn of fns) fn();
    };
    img.onload = settle;
    img.onerror = settle;
    img.src = url;
  },
  // Watch the whole document for freshly inserted pending icons — modals are
  // built as HTML strings in a dozen call sites, so one observer here beats
  // a scan call in every one of them. Modals appear a few times a minute at
  // most; the per-mutation work is a matches/querySelectorAll pair.
  observe() {
    if (this._obs || typeof MutationObserver === 'undefined' || !document.body) return;
    this._obs = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (!n || n.nodeType !== 1) continue;
          const els = n.matches?.('.px-icon[data-iconsrc]')
            ? [n]
            : (n.querySelectorAll ? n.querySelectorAll('.px-icon[data-iconsrc]') : []);
          for (const el of els) {
            const url = el.dataset.iconsrc;
            if (this._loaded.has(url)) el.classList.remove('icon-loading');
            else this.probe(url);
          }
        }
      }
    });
    this._obs.observe(document.body, { childList: true, subtree: true });
  },
  // Trickle a URL list into the cache, two fetches in flight at a time so a
  // burst of ~60 requests can't compete with tile loads or gameplay.
  prewarm(urls) {
    const queue = urls.filter((u) => u && !this._loaded.has(u) && !this._loading.has(u));
    let idx = 0, active = 0;
    const pump = () => {
      while (active < 2 && idx < queue.length) {
        active++;
        this.probe(queue[idx++], () => { active--; pump(); });
      }
    };
    pump();
  },
};
if (typeof document !== 'undefined' && document.body) IconNet.observe();

// ── Item icon sheet table ───────────────────────────────────────────────────
// PNG sheet metadata for renderItemIcon's CSS-clip icons. Module scope so
// IconNet's prewarmer can enumerate every sheet URL (and so the table isn't
// rebuilt on every icon render). Adding a new icon sheet is one entry here
// plus a row in MINERAL_ICON_SHEET (items.js) — a hardcoded if-else here once
// silently fell through to Crops.png for any unknown sheet, so a request like
// { sheet: 'gems', frame: 4 } rendered as rainberry stage 4.
const ICON_SHEETS = {
  crops:       { url: 'assets/Objects/Crops.png',                       cols: 9,  srcW: 144, srcH: 256 },
  springcrops: { url: 'assets/Objects/Spring Crops.png',                cols: 14, srcW: 224, srcH: 128 },
  gems:        { url: 'assets/Icons/RPG icons/Extras/Gemstones.png',    cols: 7,  srcW: 112, srcH: 64  },
  coal_icon:   { url: 'assets/Icons/RPG icons/Extras/Coal.png',         cols: 2,  srcW: 32,  srcH: 32  },
  // Bars + ores — 256×64, 16 cols × 4 rows of 16×16. Row 0 left-to-right
  // is the bar tier ladder: copper, iron, gold, platinum, crimson, frost
  // (frames 0..5). MINERAL_ICON_SHEET maps each bar id to its frame.
  // Without this entry, every bar fell through to crops.png frame 0 and
  // rendered as a grass sprout in smith trade modals.
  bars:        { url: 'assets/Icons/RPG icons/Extras/Bars and ores.png', cols: 16, srcW: 256, srcH: 64 },
  // Animal produce — 32×16 (2 frames). frame 0 = standalone item.
  icon_egg:    { url: 'assets/Icons/Food Icons/Chicken Egg.png',        cols: 2,  srcW: 32,  srcH: 16  },
  icon_milk:   { url: 'assets/Icons/Food Icons/Small Cow Milk.png',     cols: 2,  srcW: 32,  srcH: 16  },
  // Orchard fruit — 32×16 each (frame 0 = whole fruit).
  icon_apple:   { url: 'assets/Icons/Food Icons/Apple.png',             cols: 2,  srcW: 32,  srcH: 16  },
  icon_cherry:  { url: 'assets/Icons/Food Icons/Cherry.png',            cols: 2,  srcW: 32,  srcH: 16  },
  icon_peach:   { url: 'assets/Icons/Food Icons/Peach.png',             cols: 2,  srcW: 32,  srcH: 16  },
  icon_mango:   { url: 'assets/Icons/Food Icons/Mango.png',             cols: 2,  srcW: 32,  srcH: 16  },
  icon_apricot: { url: 'assets/Icons/Food Icons/Apricot.png',           cols: 2,  srcW: 32,  srcH: 16  },
  icon_banana:  { url: 'assets/Icons/Food Icons/Banana.png',            cols: 2,  srcW: 32,  srcH: 16  },
  icon_orange:  { url: 'assets/Icons/Food Icons/Orange.png',            cols: 2,  srcW: 32,  srcH: 16  },
  icon_coconut: { url: 'assets/Icons/Food Icons/Coconut.png',           cols: 2,  srcW: 32,  srcH: 16  },
  // Fish — 64×16 (4 frames). No dedicated minnow art — reuse the
  // smallmouth bass icon (same family, just smaller fiction).
  icon_minnow:     { url: 'assets/Icons/Fish/Sea/Smallmouth Bass.png',    cols: 4, srcW: 64, srcH: 16 },
  icon_bass:       { url: 'assets/Icons/Fish/River/Large Mouth Bass.png', cols: 4, srcW: 64, srcH: 16 },
  icon_trout:      { url: 'assets/Icons/Fish/River/Tiger Trout.png',      cols: 4, srcW: 64, srcH: 16 },
  icon_salmon:     { url: 'assets/Icons/Fish/Sea/Salmon.png',             cols: 4, srcW: 64, srcH: 16 },
  icon_goldenfish: { url: 'assets/Icons/Fish/River/Golden Fish.png',      cols: 4, srcW: 64, srcH: 16 },
  // Consumables + wilderness drops.
  icon_flute:    { url: 'assets/Icons/RPG icons/Extras/Flutes.png',          cols: 2,  srcW: 32,  srcH: 32 },
  icon_book:     { url: 'assets/Icons/RPG icons/Extras/Books.png',           cols: 15, srcW: 240, srcH: 64 },
  // Potion of Reach — single 16×16 glowing-flask icon (hand-drawn).
  icon_potion:   { url: 'assets/Icons/Items/Potion_light.png?v=1',           cols: 1,  srcW: 16,  srcH: 16 },
  // Flask-style potions sheet (Potions.png): 5 cols × 7 rows of 16×16.
  // Row 2: frame 11=green (vigor), 12=red (speed), 13=purple (shield).
  icon_potions:  { url: 'assets/Icons/Items/Potions.png?v=1',                cols: 5,  srcW: 80,  srcH: 112 },
  icon_meat:     { url: 'assets/Icons/Food Icons/Beef.png',                  cols: 2,  srcW: 32,  srcH: 32 },
  icon_pelt:     { url: 'assets/Icons/Food Icons/Black rabbit Fur.png',      cols: 2,  srcW: 32,  srcH: 16 },
  icon_feather:  { url: 'assets/Icons/RPG icons/Extras/Chicken feather.png', cols: 9,  srcW: 144, srcH: 32 },
  // Beach pickup — 48×64 = 3×4 of 16×16. Frame 0 is the canonical
  // cowrie used as the inventory icon.
  shell_sheet:   { url: 'assets/Icons/Fish/Sea/Creatures/Shell.png',         cols: 3,  srcW: 48,  srcH: 64 },
  // ALL props seasons — 352×192 of 16×16. 22 cols × 12 rows. Frame 0
  // (top-left grass tuft) backs the longgrass inventory icon now
  // that the procedural sprite has been retired.
  props:         { url: 'assets/Objects/Wilderness/Props.png',               cols: 22, srcW: 352, srcH: 192 },
  // 7_Pickup_Items — 224×160, 14×10 of 16×16. Frame 88 (row 6 col 4)
  // is the brown leather boot used as the fishing-junk inventory icon.
  pickup:        { url: 'assets/Objects/Pickup_Items.png',                   cols: 14, srcW: 224, srcH: 160 },
  // wood — 48×16, 3 frames. MINERAL_ICON_SHEET.wood points here. In
  // practice wood always renders via the baked ITEM_DATA_URLS snapshot
  // (which alpha-keys the white bg), so this entry is a fallback: if the
  // bake ever fails it renders wood (white bg and all) instead of
  // silently falling through to SHEETS.crops → a grass sprout.
  wood:          { url: 'assets/Objects/Wilderness/wood.png',                cols: 3,  srcW: 48,  srcH: 16 },
};

class MapScene extends Phaser.Scene {
  constructor() { super('map'); }

  preload() {
    // Boot loading overlay (index.html #bootload). Asset fetches are the long
    // pole of a cold boot, so the Phaser loader's own progress drives the bar:
    // 0→0.85 here, 0.9 as create() builds the world, 1 on the first update()
    // frame (which fades the overlay out and hands off to the in-world
    // unmapped-tile shimmer for whatever tiles are still loading).
    this.load.on('progress', (p) => window.__bootStatus?.(p * 0.85, 'Unpacking supplies…'));
    this.load.spritesheet('idle', 'assets/Character/Idle.png',  { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('walk', 'assets/Character/Walk.png',  { frameWidth: 32, frameHeight: 32 });
    // Red dragon transform (Dragon Powder). 11-col sheet of 96×96 frames;
    // row 0 (frames 0-7) is the wing-flap we loop while transformed.
    this.load.spritesheet('dragon', 'assets/Character/Dragon/babydragon_sheets/dragon_red.png', { frameWidth: 96, frameHeight: 96 });
    this.load.spritesheet('trees','assets/Objects/Maple Tree.png', { frameWidth: 32, frameHeight: 48 });
    this.load.image('house',       'assets/Objects/House.png');
    this.load.image('stair_down',  'assets/Objects/stair_down.png?v=2');
    this.load.image('stair_up',    'assets/Objects/stair_up.png?v=1');
    // House.png is a tileset (two houses + detail bits). Register a single
    // "front" frame for the right-hand cabin so we only render that.
    this.load.once('filecomplete-image-house', () => {
      this.textures.get('house').add('front', 0, 148, 3, 72, 95);
    });
    // Chicken is loaded by the ASSETS catalog below (16×16 — see assets.js).
    // A manual load.spritesheet('chicken', ..., 32×32) here used to shadow
    // assets.js because Phaser's loader keeps the first config queued for a
    // given key. The resulting 32×32 frame was actually a 2×2 grid of
    // 16×16 chickens, so every spawned creature rendered as four. Don't
    // re-add this line — let ASSETS own the framing.
    this.load.spritesheet('cow',     'assets/Farm Animals/Female Cow Brown.png', { frameWidth: 32, frameHeight: 32 });
    // Pet body sheets — 32×32 RPG-Maker-style anim grids (4 cols × 12-13 rows).
    // Row 0 is the down-walk cycle, which we loop as the idle anim. Source
    // PNGs are copied out of the gitignored Sprites/ dump into Objects/Pets/
    // so the tree builds without the raw asset pack (same pattern as
    // Objects/Wilderness/). Originals were Sprites/Animals/Pets/Cats/1/Ginger.png
    // and Sprites/Animals/Pets/Dogs/Premade/4/1.png (grey); swap with sibling
    // sheets from those folders if we ever want colour variety.
    this.load.spritesheet('cat', 'assets/Objects/Pets/cat.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('dog', 'assets/Objects/Pets/dog.png', { frameWidth: 32, frameHeight: 32 });
    // trunk.png: 32x64, two 32x32 frames stacked. Frame 0 = closed, frame 1 = open (lid up).
    this.load.spritesheet('chest',   'assets/Objects/trunk.png',            { frameWidth: 32, frameHeight: 32 });
    // Crops sheet: 9 cols x 16 rows of 16x16 cells. Each crop = one row.
    // In-world growth: col 0 (sprout) → col 4 (harvestable). Inventory: col 7 produce, col 8 seed.
    this.load.spritesheet('crops',   'assets/Objects/Crops.png',            { frameWidth: 16, frameHeight: 16 });
    // Spring Crops sheet (224×128, 14×8 of 16×16 frames). Used by crops whose
    // art lives here (e.g. potato) — see CROP_SPRITE override below.
    this.load.spritesheet('springcrops', 'assets/Objects/Spring Crops.png',  { frameWidth: 16, frameHeight: 16 });
    // Source PNG has a solid white background — alpha-key near-white pixels to transparent.
    this.load.once('filecomplete-spritesheet-crops', () => {
      const tex = this.textures.get('crops');
      const src = tex.getSourceImage();
      const c = document.createElement('canvas');
      c.width = src.width; c.height = src.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(src, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < data.data.length; i += 4) {
        if (data.data[i] > 240 && data.data[i+1] > 240 && data.data[i+2] > 240) {
          data.data[i+3] = 0;
        }
      }
      ctx.putImageData(data, 0, 0);
      this.textures.remove('crops');
      this.textures.addSpriteSheet('crops', c, { frameWidth: 16, frameHeight: 16 });
    });
    this.load.spritesheet('cobble',  'assets/Objects/Road copiar.png',      { frameWidth: 16, frameHeight: 16 });
    // Walk the ASSETS catalog (assets.js) so wilderness textures, gem
    // icons, scarecrow, shell sheet, etc. all preload. Without this loop
    // every reference in render.js / renderItemIcon falls back to the
    // __MISSING texture — visible as broken grey blocks for deer / rabbit
    // / mineralrock / etc., and item icons that should be sprites silently
    // resolve to Crops.png frame 0.
    if (typeof ASSETS !== 'undefined') {
      for (const [key, a] of Object.entries(ASSETS)) {
        if (this.textures.exists(key)) continue;
        if (a.kind === 'spritesheet') {
          this.load.spritesheet(key, a.path, { frameWidth: a.frameWidth, frameHeight: a.frameHeight });
        } else if (a.kind === 'image') {
          this.load.image(key, a.path);
        }
        if (a.onLoad) {
          const tag = a.kind === 'spritesheet'
            ? `filecomplete-spritesheet-${key}` : `filecomplete-image-${key}`;
          this.load.once(tag, () => a.onLoad(this));
        }
      }
    }
    // Relic / armor icons (7 tiers × 7 slots + extras) are NOT preloaded — they
    // only ever appear inside DOM modals via `<img src="${gearAssetPath(...)}">`,
    // so the browser fetches each one on demand and caches it. Eagerly loading
    // ~50 PNGs at startup blocked the splash screen for several seconds.
  }

  create() {
    window.__bootStatus?.(0.9, 'Surveying the neighbourhood…');
    this.save = Object.assign(
      {
        caught: [], planted: [], opened: [], tilled: [], picked: [], foundTreasures: [], brokenRocks: [], placedRocks: [],
        money: STARTING_MONEY, buyIndex: 0,
        // inv is array of {id, count} — seeds-only per spec; planting decrements
        // count. Starts empty: the player's first potato seeds come from a
        // starter chest on the spawn trail (see STARTER_LOOT below).
        inv: [],
        selSlot: 0,
        invPage: 0,
        // Two-bar inventory: invCat is the active type tab (see INV_CATS);
        // selGear is the highlighted relic/armor slot when a gear tab is active
        // (items keep using selSlot; the two are mutually exclusive — a gear
        // selection sets selSlot to -1 so item actions read "nothing selected").
        invCat: 'seed',
        selGear: null,
      },
      loadSave()
    );
    // All one-time save-shape migrations — slot/default backfills, the maxEnergy
    // re-derive, the history cap, and the data migrations (inv string→object,
    // stash fold, venison→meat, golden→shiny, released golden flag, the sapling
    // review seed) — live in savemigrate.js so they're testable headlessly.
    // Returns true iff a real data migration changed something and the save
    // should be re-persisted now. Runs before any in-memory Set is mirrored off
    // a save array below, so the HISTORY_CAP trim above actually sticks — build
    // a mirror from the pre-trim array and the next rewrite un-trims it.
    const needsMigrationPersist = SaveMigrate.migrate(this.save);
    this.save.opened = this.save.opened || [];
    // Chests left for later because the bag was full: { [chestId]: {id, n} }.
    // The chest stays out of save.opened (so it still renders + reopens) and
    // remembers exactly what it rolled, so reopening can't re-roll the loot.
    this.save.chestHold = this.save.chestHold || {};
    this.save.tilled = this.save.tilled || [];
    if (this.save.money == null) this.save.money = STARTING_MONEY;
    if (this.save.buyIndex == null) this.save.buyIndex = 0;
    this.tilledSet = new Set(this.save.tilled);
    this.save.brokenRocks = this.save.brokenRocks || [];
    this.brokenRockSet = new Set(this.save.brokenRocks);
    this.save.placedRocks = this.save.placedRocks || [];
    this.placedRockSet = new Set(this.save.placedRocks);
    // Cave walls the player has mined into walkable floor. Keys are
    // "<depth>:<absCellIX>_<absCellIY>" so the same GPS-mirrored cell can be dug
    // independently on each level. Re-applied to a cave tile's grid on load.
    this.save.dugWalls = this.save.dugWalls || [];
    this.dugWallSet = new Set(this.save.dugWalls);
    // Per-save relic salt, mixed into the starter chest's SLOT roll (see
    // _placeStarterRelicChest). World generation is deliberately seedless —
    // everything hashes off location so the world survives tile eviction —
    // which meant the opening relic was a fact about your house: reset as
    // often as you liked, the same spawn rolled the same tool forever. The
    // salt is the one per-save die: rolled once when a save first boots,
    // persisted, and wiped with the save, so a reset rerolls the relic while
    // everything else stays location-stable. Math.random is right here —
    // this IS the save's identity, not world state.
    if (this.save.relicSalt == null) this.save.relicSalt = (Math.random() * 0x100000000) >>> 0;
    // Offline-rest restoration. Time since the last lastSeenAt heartbeat is
    // treated as "the player was resting" — pro-rated 100% per hour, capped at
    // maxEnergy (re-derived in migrate above). Skipped in test mode so the
    // harness's deterministic energy values aren't bumped on every reload. Runs
    // before the migration persist so a bumped energy is saved with it.
    if (this.save.lastSeenAt && !window.__TEST_MODE) {
      this.applyOfflineRest(Math.max(0, Date.now() - this.save.lastSeenAt));
    }
    this.save.lastSeenAt = Date.now();
    // Float accumulator for indoor resting — fractions of an energy point
    // accrue here between integer-pip bumps to save.energy.
    this._restAccrueE = 0;
    // Mark relics dirty so the first updateRelicRow call actually rebuilds.
    this._relicsGen = 1;
    // Transient runtime state — not persisted.
    this.pairyCompass = null;   // { targetId, x, y, until } when active
    if (needsMigrationPersist) persistSave(this.save);

    // Drop the dead dragon_potion slot left over from the build that renamed
    // it to dragon_powder. A migration, not a grant: it only ever REMOVES a
    // stack no handler can spend any more.
    //
    // This used to also push one dragon_powder into the bag ("TEST SEED", so
    // the transform could be tried without finding one in the wild). That ran
    // on a brand-new save too, which made a tier-8 transform consumable the
    // first and ONLY thing in a new player's bag — the sole count pip on the
    // opening screen, on a tab the fresh-save default doesn't even show, and
    // flatly against the starter crates' premise that the bag starts empty.
    // The dev affordance it existed for is now the ☰ › Developer › "Give
    // Dragon Powder" button, which is where a dev affordance belongs.
    if (!this.save.gotDragonTestPowder) {
      this.save.gotDragonTestPowder = true;
      this.save.inv = (this.save.inv || []).filter(s => !s || s.id !== 'dragon_potion');
      persistSave(this.save);
    }

    this.cameras.main.setBackgroundColor('#222');
    this.viewCenterX = W / 2;
    this.viewCenterY = H / 2 - 150;           // raise map clear of the TWO-bar inventory HUD (type tabs + item slots) and the Eat button beneath it
    this.viewLeft = this.viewCenterX - (VIEW_CELLS / 2) * CELL_PX;
    this.viewTop  = this.viewCenterY - (VIEW_CELLS / 2) * CELL_PX;
    this.viewSize = VIEW_CELLS * CELL_PX;

    const origin = WorldGen.lonLatToWorldPx(START_LON, START_LAT, WorldGen.Z);
    this.originPx = origin;
    this.mPerPx = WorldGen.metersPerPixel(START_LAT, WorldGen.Z);
    this.cellM = WorldGen.CELL_M;
    this.cellsPerTile = WorldGen.cellsPerEdgeForLat(START_LAT);
    this.tileEdgeM = WorldGen.tileEdgeMeters(START_LAT);
    // Fog of war — load the explored-cell masks. Keyed by tile and sized by
    // cellsPerTile, so it has to come after that is known and before the first
    // draw. (src/fog.js owns the storage; the masks deliberately do NOT live on
    // the WorldGen tile-cache entries, which get evicted and re-rasterised.)
    Fog.init(this.save, this.cellsPerTile);
    // Player sprite renders at scale 1.215 (32px frame, origin 0.5/0.5). Its
    // visual feet sit ~14px below the sprite centre (same anchor as the
    // footprint dot). The reach is cell-quantised and centres on the CELL the
    // player stands in, so we offset the cell lookup down to the feet: 24px
    // (0.75 cell) overshot into the cell to the SOUTH (reach appeared a cell
    // low); 14px (~0.44 cell) keeps the lookup in the feet's own cell so the
    // reach centres on the player. ~2.6m.
    this.feetOffsetM = (14 / CELL_PX) * this.cellM;
    // Reach RADIUS is now computed dynamically in coords.js (reachRadiusM): it
    // starts at 2.5 cells and grows to 5.5 via Inner Light upgrades.
    // NOTE: object/creature/wildplant taps share the SAME reach radius as cell
    // taps — interact.js' tooFar gate now reads coords.js reachRadiusM (the
    // dynamic 2.5..5.5-cell radius), NOT a fixed distance, so the lit
    // reach indicator and the tap-accept gate stay in lock-step at every reach
    // tier. REACH_FAR_M (16m) survives only as a fallback if that helper is
    // somehow unavailable. Tap PRECISION — how exactly your tap must land on
    // the target — is a separate question, answered by cell membership
    // (interact.js), and is independent of how far the player can reach.
    this.startWorldM = {
      x: this.originPx.x * this.mPerPx,
      y: this.originPx.y * this.mPerPx,
    };
    // Publish the spawn origin to the home-area hub (home.js) so worldgen can
    // ask "is this near home?" while building tiles — set before the first
    // ensureTilesAround() below.
    if (typeof HomeArea !== 'undefined') HomeArea.setOrigin(this.startWorldM.x, this.startWorldM.y);

    this.playerM = { x: 0, y: 0 };
    // Underground depth: 0 = surface, 1,2,… = cave levels below. Persisted in
    // the save so a reload underground stays underground. Point WorldGen at the
    // matching tile cache before any tiles load.
    this.depth = this.save.depth || 0;
    WorldGen.setDepth(this.depth);
    if (this.depth > 0) this.cameras.main.setBackgroundColor('#0a0a12');
    this.facing = { x: 0, y: 1 }; // unit-ish vector; updated by movement
    this._spriteDir = { x: 0, y: 1 }; // last movement direction used for sprite facing
    this.gpsM = null;
    this.gpsAvailable = false;
    // Set true the moment the player drives themselves with manual controls
    // (WASD / arrow keys, SPACE-teleport, T-teleport). Once on, the GPS watcher
    // stops snapping the player back to their real-world fix for the rest of
    // the session. Session-scoped ONLY — never persisted — so a fresh load
    // resumes live GPS tracking.
    this._gpsManualOverride = false;
    // Set when the browser told us location is PERMISSION_DENIED. The one
    // thing that stops the game watching for fixes — see _retryGps.
    this._gpsDenied = false;
    // Home anchoring — a brand-new save with no frozen home adopts the player's
    // FIRST GPS fix as its permanent origin: startGps captures it, then reloads
    // so the projection re-inits there. Gated to genuinely fresh saves (no
    // starter home placed yet): world coords are global + latitude-dependent,
    // so moving the origin of a save that already placed objects would drift
    // them. Such saves keep their origin; Reset adopts a new home. No
    // geolocation / a teleport override / sandbox → no capture (HOME fallback).
    // Sandbox detection reads the URL directly here: this._sandboxMode isn't
    // set until Sandbox.install() runs much later in create(), so we'd see
    // undefined and fail to exclude sandbox sessions from home capture.
    const _sandbox = (typeof Sandbox !== 'undefined' && Sandbox.detect());
    this._homeCapturePending =
      !_teleportOverride &&
      !_saveHome &&
      !this.save.starterShopId &&
      !_sandbox &&
      (typeof navigator !== 'undefined' && !!navigator.geolocation);
    // Two flags, because "hold the starter home back until we know where we
    // are" and "a fix may still become this save's origin" have different
    // deadlines. Placement can only wait so long (the safety net in startGps
    // gives up after 2 min and lets the world build at the default origin) —
    // but the ADOPTION stays armed for as long as nothing has been placed, so
    // a first fix that takes four minutes on a cold phone still anchors the
    // save where the player actually is instead of stranding them at the
    // default home with the map a province away. Anything that puts an object
    // in the world disarms it (see startGps): from then on the origin is load
    // bearing and moving it would drift everything already placed.
    this._homeCaptureArmed = this._homeCapturePending;
    // (The no-fix safety net for home capture is armed in startGps, once
    // GPS is actually watching — sensors now start only after the opening
    // story + the location CTA, so arming it here would count story-reading
    // time against the fix and could silently skip the capture.)

    // One-time migration: older saves used pWorldX/cellM for cell indices, which
    // drifts vs the rendered (tile-pixel-basis) cells. Remap tilled keys and
    // snap planted positions to the unified basis so they line up visually.
    if (!this.save.coordSchema || this.save.coordSchema < 2) {
      const remapped = new Set();
      for (const key of this.tilledSet) {
        const [ox, oy] = key.split('_').map(Number);
        const cwmx = (ox + 0.5) * this.cellM;
        const cwmy = (oy + 0.5) * this.cellM;
        const { cellIX, cellIY } = worldMetersToAbsCell(this, cwmx, cwmy);
        remapped.add(cellKeyFromAbsCell(cellIX, cellIY));
      }
      this.tilledSet = remapped;
      this.save.tilled = [...remapped];
      for (const p of (this.save.planted || [])) {
        const { cellIX, cellIY } = worldMetersToAbsCell(this, p.x, p.y);
        const c = absCellCenterMeters(this, cellIX, cellIY);
        p.x = c.x; p.y = c.y;
      }
      this.save.coordSchema = 2;
      persistSave(this.save);
    }

    // Procedural per-biome textures for flat-color terrain (water ripples, brick, etc.).
    makeBiomeTextures(this, CELL_PX);
    makeTowerTexture(this);
    // Pot of gold — art for the coin-burst POIs (ATM + bicycle_parking).
    makePotOfGoldTexture(this);
    // (Longgrass used to be a procedural canvas texture painted by
    // drawLongGrassTex. CROP_SPRITE.longgrass now points at frame 0 of the
    // 'props' sheet, which reads as a hand-painted grass tuft consistent
    // with the rest of the wilderness art. Procedural texture + the
    // drawLongGrassTex helper have been removed.)
    // Cache data URLs for items whose map sprite isn't on Crops.png / Spring Crops.png,
    // so the inventory bar and shop modal (which are DOM, not Phaser) can render the
    // exact same image. Run after sheet loads so all source images are ready.
    // Key = item id; value = a data URL of the chosen representative frame.
    window.ITEM_DATA_URLS = window.ITEM_DATA_URLS || {};
    const bakeSheetFrame = (key, frameIdx, frameW, frameH) => {
      const src = this.textures.get(key)?.getSourceImage();
      if (!src) return null;
      const c = document.createElement('canvas');
      c.width = frameW; c.height = frameH;
      const cx = c.getContext('2d');
      const cols = Math.max(1, Math.floor(src.width / frameW));
      const fx = (frameIdx % cols) * frameW;
      const fy = Math.floor(frameIdx / cols) * frameH;
      cx.drawImage(src, fx, fy, frameW, frameH, 0, 0, frameW, frameH);
      return c.toDataURL();
    };
    const bakeCanvas = (key) => this.textures.get(key)?.getSourceImage()?.toDataURL?.() || null;
    // Longgrass (display name "Long grass") — bake frame 10 of the 'props'
    // sheet (col 11 row 1 in 1-indexed coords = leafy green frond). Same
    // sprite as the in-world wildplant via CROP_SPRITE.longgrass.frame.
    window.ITEM_DATA_URLS.longgrass = bakeSheetFrame('props', 10, 16, 16);
    window.ITEM_DATA_URLS.chicken   = bakeSheetFrame('chicken', 0, 16, 16);
    window.ITEM_DATA_URLS.cow       = bakeSheetFrame('cow',     0, 32, 32);
    // Cat + dog use the 32×32 RPG-style sheets (the older 16×16 Icons/Pets
    // file is gone). Frame 0 is the down-facing standing pose.
    window.ITEM_DATA_URLS.cat       = bakeSheetFrame('cat',     0, 32, 32);
    window.ITEM_DATA_URLS.dog       = bakeSheetFrame('dog',     0, 32, 32);
    // Wilderness fauna inventory icons — baked from the world sprite sheets.
    // Deer + crow are 32×32; rabbit + butterfly stay 16×16. Without these,
    // catching a deer would show 🦌 emoji instead of the deer sprite.
    window.ITEM_DATA_URLS.deer      = bakeSheetFrame('deer',      0, 32, 32);
    window.ITEM_DATA_URLS.rabbit    = bakeSheetFrame('rabbit',    0, 16, 16);
    window.ITEM_DATA_URLS.crow      = bakeSheetFrame('crow',      0, 32, 32);
    window.ITEM_DATA_URLS.butterfly = bakeSheetFrame('butterfly', 0, 16, 16);
    // Wilderness drops that share their world sprite. Source sheet
    // + frame come from CROP_SPRITE.mushroom so the inventory icon stays
    // glued to whatever the world renderer is drawing.
    window.ITEM_DATA_URLS.mushroom  = bakeSheetFrame(
      CROP_SPRITE.mushroom?.sheet ?? 'mushroom_world',
      CROP_SPRITE.mushroom?.frame ?? 0, 16, 16);
    // Wood — inventory uses frame 2 (the third / "amber" log variant
    // of the three). Ground stacks pick a frame based on the stack's
    // qty (see render.js groundstack branch).
    window.ITEM_DATA_URLS.wood      = bakeSheetFrame('wood', 2, 16, 16);
    // Scarecrow — the placeable item shares the world sprite (32×32 single
    // image). Without this bake its inventory / shop / pickup-toast icon fell
    // back to the item.icon emoji (a 🪦 headstone), so the held item looked
    // nothing like what gets planted. Bake the frame so all surfaces match.
    window.ITEM_DATA_URLS.scarecrow = bakeSheetFrame('scarecrow', 0, 32, 32);
    // Concrete pads under POI chests — one rounded, slightly-oversized slab in
    // the single cell under the chest (texture `pad_round1`, see textures.js).
    makeAllPadShapes(this);

    // Layers
    this.cellGfx = this.add.graphics();
    this.gridContainer = this.add.container(0, 0);  // dashed grid — only redrawn on cell crossing
    this.gridGfx = this.add.graphics();
    this.gridContainer.add(this.gridGfx);
    this.noiseContainer = this.add.container(0, 0);
    this.borderContainer = this.add.container(0, 0); // scrolled each frame for sub-cell offset
    this.borderGfx = this.add.graphics();  // biome-boundary borders — only redrawn on cell crossing
    this.borderContainer.add(this.borderGfx);
    this.terrainContainer = this.add.container(0, 0);
    // Original OSM road geometry (road_overlay.js) — the raw vector linework
    // the rasterizer turned into road/path cells, as a muted brown band. Sits
    // above the terrain + biome borders but BELOW the cobbles: the linework is
    // the evidence of what the rasterizer was AIMING at, so the stones it
    // actually laid have to read on top of it, not through it. Anything above
    // the cobble is likewise above this — road labels, plants, objects.
    // Scrolled each frame for the sub-cell offset, like the border layer.
    // Only the container is made here: road_overlay.js draws into an offscreen
    // canvas (round caps, one flat alpha over the whole network) and adds the
    // resulting image to this container on its first pass.
    this.roadGeomContainer = this.add.container(0, 0);
    // Cobblestone overlay sprites for road/path/pier cells. Sits ABOVE the
    // noise + border layers, so biome speckle and the wavy zone borders never
    // paint over the road surface, above the OSM linework overlay, and BELOW
    // the road-label layer.
    this.cobbleContainer = this.add.container(0, 0);
    // Road-name letters render WITH the road stones (just above the cobble),
    // BELOW the rampart/back wall + objects — so a road passing north of a
    // castle tucks behind the back wall instead of its letters poking over it.
    // (Pool populated further down, after the cobble pool.)
    this.letterContainer = this.add.container(0, 0);
    // Pads (rounded concrete slabs under POI chests) draw under objects.
    this.padContainer = this.add.container(0, 0);
    // Soft contact shadows under buildings — drawn just below the object
    // sprites so a house/tower visibly sits ON the ground instead of floating.
    this.shadowContainer = this.add.container(0, 0);
    // Atmosphere: the GROUND-PLANE wash. One flat fill of the current biome's
    // haze colour over the whole viewport, sitting above every ground layer
    // (terrain, noise, borders, cobbles, road geometry, pads, shadows) and
    // below every standing sprite. That split is what gives a top-down grid a
    // readable foreground/background: the ground recedes into the biome's air
    // while trees, houses and creatures stay at full contrast on top of it.
    // Painted in Render.drawCells; see BiomeProfiles.atmos for the palette.
    this.atmosGroundGfx = this.add.graphics();
    // LIGHTING — the out-of-reach dim, the underground torch wash, the
    // low-energy pink tint and the white reach outline. It sits here, ABOVE
    // every piece of ground decoration (biome seams, cobbles, road letters,
    // treasure pads, shadows, the haze) and BELOW the standing sprites,
    // because "outside the lit area" has to mean the whole ground goes dark —
    // not just the flat terrain fill. POI halos are the one ground element
    // that sits ABOVE this layer instead — see the note where
    // poiHaloContainer is created just below, right after this one.
    //
    // These passes used to live in cellGfx, the bottom-most layer, so the dim
    // could only reach the base colour: biome BOUNDARIES in particular stayed
    // at full brightness outside the lit area and read as glowing seams in the
    // dark. (The distance falloff hit the same wall and was moved above the
    // sprites for it; this is the same bug one layer down.) Sprites stay at
    // full contrast on purpose — see the note on atmosGroundGfx above — and
    // distance, not reach, is what dims them, via atmosFalloffGfx.
    this.reachGfx = this.add.graphics();
    // POI halos — the slow ring "ping" under every live POI (render.js) — sit
    // ABOVE the lighting layer, DELIBERATELY exempt from the out-of-reach dim
    // every other ground layer gets. A halo's whole job is to read as a place
    // "from across the map" (see render.js's POI-halo comment); crushing it
    // under the same dim that swallows biome seams and cobbles defeats that —
    // most of the visible grid sits outside the small reach radius at any
    // moment, so the ping would only ever show right under the player's feet.
    // It's still below worldContainer (so it doesn't draw over the chest
    // itself) and below atmosFalloffGfx (so it still fades with sheer
    // distance) — only the binary in-reach/out-of-reach dim is skipped. The
    // ring's own texture is a transparent-centred band, so drawing it above
    // padContainer here (instead of below, as before) doesn't hide the pad —
    // the ring just crosses over the slab's rim as it expands.
    this.poiHaloContainer = this.add.container(0, 0);
    // Castle ramparts (tier-12) split across two layers so towers sort per-edge.
    // BACK layer — the north/top wall + the E/W side walls — sits BELOW the
    // object sprites so towers on those edges read as standing IN FRONT of them
    // (and side walls tuck under everything). Added before objectsContainer.
    this.rampartBackGfx = this.add.graphics();
    // ONE display layer for every cell-anchored world sprite — planted crops,
    // world objects (trees / buildings / chests / rocks) and creatures. They
    // share a layer so render.js can depth-sort them TOGETHER by screen cell
    // row: anything in a lower row always draws over anything in a higher row,
    // whatever kind it is. Inside one cell row the old layer hierarchy still
    // holds (crops under objects under creatures) — see the z-order pass in
    // Render.drawObjects, which stamps each sprite's depth and sorts this
    // container. The three aliases below are the names the renderer uses.
    this.worldContainer = this.add.container(0, 0);
    this.plantedContainer = this.worldContainer;
    this.objectsContainer = this.worldContainer;
    this.creaturesContainer = this.worldContainer;
    // FRONT layer — the south wall + its battlements — sits ABOVE the object
    // sprites so a building or chest south of the wall reads as standing
    // BEHIND it. Both rampart layers are cleared + repainted each frame in
    // Render.drawCells.
    this.rampartFrontGfx = this.add.graphics();
    // Castle turrets get their OWN layer, added after both rampart layers, so
    // a tower always reads as standing above the wall it's built on — on the
    // front (south) edge too, where it used to be painted over by the wall in
    // front of it.
    //
    // The cost of that: a turret sits outside worldContainer's row sort, so it
    // no longer yields to a sprite one row further south — an animal crossing
    // in front of a turret is drawn behind it. Anything above the front wall
    // has to leave the shared layer, and the wall-over-turret artefact is the
    // one people actually noticed. Coins / sparks / labels still draw above.
    this.towerContainer = this.add.container(0, 0);
    // Coin-burst drops (from ATM / bicycle_parking tap). Sits above objects
    // so coins read on top of pads + the source chest sprite.
    this.coinContainer = this.add.container(0, 0);
    // Rare "shiny" sparkle markers — a gold twinkle floated above each shiny
    // animal / wild plant / tree. Added AFTER the world layer so the spark
    // draws on top of every world sprite. This is the renderer-AGNOSTIC shiny
    // cue: the multiply setTint() used elsewhere silently no-ops under the
    // Phaser Canvas fallback (Phaser.AUTO), so a tint-only shiny was invisible
    // on those devices. The spark texture is baked gold and animates via
    // scale/alpha/rotation (pure transforms), so it reads in WebGL and Canvas.
    this.sparkContainer = this.add.container(0, 0);
    // Atmosphere: the RIM HAZE. A short ramp of the biome's haze colour inward
    // from the viewport edge — the top-down stand-in for atmospheric
    // perspective. The map is a hard-clipped window onto the world, so the rim
    // is exactly where "far away" lives; fading it into the biome's air is what
    // makes the edge read as distance rather than as a crop.
    //
    // Deliberately added AFTER the world sprites (so distant objects haze too)
    // but BEFORE labelContainer — POI name tablets are UI and must stay crisp.
    // Position in the display list is what does this, NOT setDepth: the
    // vignette's depth 90 would put it over the labels as well.
    this.atmosRimGfx = this.add.graphics();
    // Atmosphere: the DISTANCE FALLOFF. Concentric rings deepening the
    // out-of-reach dim with distance from the player (render.js drawCells).
    // Sits beside the rim haze for the same reason and with the same
    // constraint: after every world sprite, so distant OBJECTS recede along
    // with the ground they stand on — in cellGfx (the bottom layer) it could
    // only darken the base terrain fill, and objects at the rim stayed fully
    // lit and read as stickers on dark ground. Still before labelContainer:
    // POI name tablets are UI and must stay crisp at any distance.
    this.atmosFalloffGfx = this.add.graphics();
    // Text-label layer — POI name tablets, specialty-shop signs, and open/busy
    // pips. Added AFTER every world-object layer (including the castle
    // rampartFrontGfx) so a label always reads ABOVE map objects like castle
    // walls / towers, and is only ever covered by popups (Phaser flash text at
    // depth 100+ and the DOM modals). Without its own layer the labels lived in
    // objectsContainer and the castle front wall painted over them.
    this.labelContainer = this.add.container(0, 0);
    // Tier-diamond layer — drawn LAST so the indicator floats above chests / labels / pads.
    this.tierGfx = this.add.graphics();
    // FOG OF WAR — the wash over cells the player has never visited. The very
    // top of the world display list, above EVERYTHING the world draws: ground,
    // the lighting dim, the sprites, the rim haze, the distance falloff, the
    // POI name tablets and the tier diamonds. That is the point of it — "you
    // have not been here" has to beat every other pass, and a label or a tier
    // pip poking through the fog would announce the contents of a place the
    // player has not found yet. (Everything drawn ABOVE this is deliberately
    // not world: the vignette, the work wheel and flash text all set an
    // explicit depth, which floats them clear of the insertion-ordered layers.)
    //
    // A CONTAINER, like borderContainer, because the fog only changes when the
    // player crosses a cell: render.js rebuilds the rects on that crossing and
    // scrolls this by the sub-cell fraction in between. See the fog pass there.
    this.fogContainer = this.add.container(0, 0);
    this.fogGfx = this.add.graphics();
    this.fogContainer.add(this.fogGfx);

    // Legacy terrain sprite pool — ground art is fully procedural now, so this
    // is empty. Kept as a defined property so render.js's defensive length check
    // continues to short-circuit without an undefined access.
    this.terrainPool = [];

    // Noise overlay pool — one image per visible cell, set to a hashed noise frame.
    this.noisePool = [];
    for (let i = 0; i < (VIEW_CELLS + 2) * (VIEW_CELLS + 2); i++) {
      const s = this.add.image(0, 0, 'biome5_0').setOrigin(0, 0)
        .setDisplaySize(CELL_PX, CELL_PX).setVisible(false);
      this.noiseContainer.add(s);
      this.noisePool.push(s);
    }

    // Cobblestone overlay pool for ROAD cells (one decorative stone centered per cell).
    this.cobblePool = [];
    for (let i = 0; i < (VIEW_CELLS + 2) * (VIEW_CELLS + 2); i++) {
      const s = this.add.image(0, 0, 'cobble', 0).setOrigin(0.5, 0.5)
        .setDisplaySize(CELL_PX, CELL_PX).setVisible(false);
      this.cobbleContainer.add(s);
      this.cobblePool.push(s);
    }

    // Road-label pool: compact whole-word street names (one anchor every ~12
    // road cells, rotated along the road by render.js), drawn low-alpha in
    // dark ink — the cobble tiles are light warm stone, so black reads like
    // worn paint markings on them (white washed out over pale stone).
    // A road cell is only PART stone, though: the ground the road was painted
    // over shows between the cobbles, so on a road crossing grass or forest
    // the dark glyphs used to disappear into the dark background. A pale
    // stone-coloured halo around each glyph carries the word over both — the
    // lettering stays dark on the stones and stays readable off them.
    // Pool is sized one slot per visible cell because render walks cells — at
    // most one anchor can occupy a cell, and most slots simply stay invisible.
    // (letterContainer itself is created earlier, next to cobbleContainer, so it
    // sits below the rampart back wall + objects.)
    this.letterPool = [];
    for (let i = 0; i < (VIEW_CELLS + 2) * (VIEW_CELLS + 2); i++) {
      // The serif face is the cartographic cue (street names on a paper map),
      // but the family has to be PINNED: a bare `serif` resolves to whatever
      // the platform picked — Times on iOS/macOS, Liberation/DejaVu Serif on
      // Linux, Cambria on Windows — so the one label in the game that should
      // look like a map label rendered differently on every device, at
      // different widths. Same stack the shop-ready plaque already pins.
      // Alpha 0.88, not the old 0.72: at three-quarter alpha the dark ink
      // washed toward its own pale halo and the street name read as a smudge
      // rather than as lettering. Still short of full opacity so it stays
      // map-printed rather than stamped on.
      const t = this.add.text(0, 0, '', {
        font: fontSerif('bold 10px'), color: UI_SHADOW,
        stroke: '#d8cdb4', strokeThickness: 3,
      }).setOrigin(0.5, 0.5).setAlpha(0.88).setDepth(0).setVisible(false);
      this.letterContainer.add(t);
      this.letterPool.push(t);
    }

    this.objectPool = [];
    // Turrets render from their own pool into towerContainer (above the
    // ramparts); every other world object shares objectPool.
    this.towerPool = [];
    this.castleFlagPool = [];   // the claimed-castle banner, one per castle
    this.plantedPool = [];
    this.plantedTimerPool = []; // small Phaser.Text in cell corner: growth minutes remaining
    this.creaturePool = [];
    this.sparkPool = [];      // gold sparkle sprites floated above shiny entities
    this.chestLabelPool = []; // Phaser.Text objects for POI names above chests
    this.shopLabelPool  = []; // Phaser.Text objects for specialty-shop labels above houses
    this.shopReadyPool  = []; // Phaser.Text "✓ / Xm" readiness pip above each house/tower
    this.padPool = [];        // sprites for per-POI concrete-pad textures under chests
    this.poiHaloPool = [];    // slow pulsing glow under each live POI (render.js)
    this.coinPool = [];       // sprites for in-world coin drops (coin-burst mechanic)

    // Bake the coin sprite: a 16×16 gold disc with a soft outline + highlight.
    // Generated once at scene-create so we don't need an art asset on disk.
    if (!this.textures.exists('coin_drop')) {
      const cg = this.make.graphics({ x: 0, y: 0, add: false });
      // Outer dark rim for contrast on any terrain
      cg.fillStyle(0x6b4a00, 1); cg.fillCircle(8, 8, 7);
      // Gold body
      cg.fillStyle(0xffcf3a, 1); cg.fillCircle(8, 8, 6);
      // Inner brighter ring
      cg.fillStyle(0xffe066, 1); cg.fillCircle(8, 8, 4);
      // Top-left highlight dot
      cg.fillStyle(0xffffff, 0.7); cg.fillCircle(6, 6, 1.5);
      cg.generateTexture('coin_drop', 16, 16);
      cg.destroy();
    }

    // Bake a soft building shadow: a flat dark ellipse that fades at the rim.
    // Drawn as concentric ellipses of decreasing alpha so the edge feathers
    // out instead of hard-cutting. 64×32 texture; render.js scales per object.
    if (!this.textures.exists('bldg_shadow')) {
      const sg = this.make.graphics({ x: 0, y: 0, add: false });
      const cx = 32, cy = 16, rings = 12;
      for (let i = rings; i >= 1; i--) {
        const t = i / rings;                 // 1 at outer rim, →0 at centre
        const rx = 30 * t, ry = 15 * t;
        // Alpha builds toward the centre: outer rings barely visible.
        sg.fillStyle(0x000000, 0.05 + 0.16 * (1 - t));
        sg.fillEllipse(cx, cy, rx * 2, ry * 2);
      }
      sg.generateTexture('bldg_shadow', 64, 32);
      sg.destroy();
    }
    // Soft round halos — a glow that fades from the centre out, baked once and
    // reused for every pulsing aura: the player's warning auras (out of energy,
    // strayed far from the GPS) and the slow breath that marks a POI. Baked in
    // their own COLOURS rather than baked white and tinted, because setTint()
    // is a no-op under the Phaser Canvas fallback and a colourless warning halo
    // says nothing. 64×64; every user scales it to the size it wants.
    const bakeHalo = (key, color, peak) => {
      if (this.textures.exists(key)) return;
      const hg = this.make.graphics({ x: 0, y: 0, add: false });
      const C = 32, rings = 16;
      for (let i = rings; i >= 1; i--) {
        const t = i / rings;               // 1 at the rim, → 0 at the centre
        // Quadratic falloff: a soft cloud rather than a flat disc with an edge.
        hg.fillStyle(color, peak * (1 - t) * (1 - t));
        hg.fillCircle(C, C, 30 * t);
      }
      hg.generateTexture(key, 64, 64);
      hg.destroy();
    };
    bakeHalo('halo_red',  0xff2a2a, 0.55);   // out of energy
    bakeHalo('halo_dark', 0x05040a, 0.60);   // strayed far from the GPS
    // POI marker: a thick soft-edged RING (not a filled disc like the warning
    // halos above) that render.js expands outward and fades as it grows — a
    // "ping" rather than a breathing glow. Drawn as concentric strokes whose
    // alpha follows a triangular feather peaking at the middle of the band,
    // so both the inner and outer edge of the ring soften instead of hard-
    // cutting. Treasure blue-white (spec §UI COLOUR LANGUAGE), matching the
    // pale pad it rings out from — a gold ring under a blue-white slab would
    // read as two different signals for the same thing.
    if (!this.textures.exists('halo_poi')) {
      const rg = this.make.graphics({ x: 0, y: 0, add: false });
      const C = 32, steps = 24, outerR = 30, bandW = 9;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;                        // 0 → inner edge of band, 1 → outer edge
        const r = outerR - bandW + bandW * t;
        const feather = 1 - Math.abs(t - 0.5) * 2;   // 0 at both edges, 1 at band centre
        rg.lineStyle(2, 0xcfe2ff, 0.65 * feather);
        rg.strokeCircle(C, C, r);
      }
      rg.generateTexture('halo_poi', 64, 64);
      rg.destroy();
    }
    // GPS crosshair — the marker at your REAL (GPS) position (see gpsGhost
    // below). An open ring with four ticks crossing it, deliberately NOT a
    // filled disc: a small gold disc IS a coin in this game, and the map is
    // full of coin bursts, so the previous dot read as loot lying on the
    // ground rather than as a position. The shape is what carries the meaning
    // now; the gold only says whose it is — the player's own position sits on
    // the control side of the colour law (spec §UI COLOUR LANGUAGE), same as
    // the stick that walked them off it.
    //
    // Baked 1:1 at its drawn size (20 game px) rather than big-and-scaled like
    // the soft halos above: those are clouds where a half-pixel of blur costs
    // nothing, this is 1.5px linework that has to stay crisp under the canvas
    // upscale. Dark keyline under the gold, the same trick the stick's rim and
    // the walk-home lead use, so it holds up over pale ground (roads, sand) as
    // well as over grass.
    if (!this.textures.exists('gps_crosshair')) {
      const cg = this.make.graphics({ x: 0, y: 0, add: false });
      const C = 10, R = 5, TICK_IN = 3, TICK_OUT = 8;
      const pass = (colour, alpha, width) => {
        cg.lineStyle(width, colour, alpha);
        cg.strokeCircle(C, C, R);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          cg.beginPath();
          cg.moveTo(C + dx * TICK_IN, C + dy * TICK_IN);
          cg.lineTo(C + dx * TICK_OUT, C + dy * TICK_OUT);
          cg.strokePath();
        }
      };
      pass(0x0a1420, 0.55, 3);        // keyline
      pass(0xffe066, 1, 1.5);         // UI_CONTROL gold
      cg.fillStyle(0xffe066, 1);
      cg.fillCircle(C, C, 1);         // centre pip — the fix itself
      cg.generateTexture('gps_crosshair', 20, 20);
      cg.destroy();
    }
    // The banner a CLAIMED castle flies — a cream pennant on a short pole with
    // a green heart on it. Green because that is already this game's word for
    // energy (UI_GREEN, "success / ready / energy gain"), and the heart is
    // exactly what the castle now does for you: a tenth of the bar back, once
    // an hour. Red would have read as the danger/out-of-energy halo instead.
    //
    // Baked 1:1 at its drawn size for the same reason the GPS crosshair is —
    // this is pixel work, not a soft cloud, and a scaled bake would smear the
    // 5px heart into a blob.
    if (!this.textures.exists('castle_flag')) {
      const fg = this.make.graphics({ x: 0, y: 0, add: false });
      const INK = 0x14110c, POLE = 0x6b5334, CLOTH = 0xf2ead6, HEART = 0x3f9e57;
      fg.fillStyle(INK, 1);    fg.fillRect(2, 0, 3, 18);      // pole keyline
      fg.fillStyle(POLE, 1);   fg.fillRect(2, 1, 2, 17);      // pole
      fg.fillStyle(INK, 1);    fg.fillRect(4, 1, 10, 12);     // banner keyline
      fg.fillStyle(CLOTH, 1);  fg.fillRect(5, 2, 8, 10);      // banner
      // A 5x5 pixel heart, plotted rather than drawn from circles: at this
      // size an arc rounds to mush and the shape stops reading as a heart.
      const H = ['.X.X.', 'XXXXX', 'XXXXX', '.XXX.', '..X..'];
      fg.fillStyle(HEART, 1);
      for (let r = 0; r < H.length; r++) {
        for (let c = 0; c < H[r].length; c++) {
          if (H[r][c] === 'X') fg.fillRect(6 + c, 4 + r, 1, 1);
        }
      }
      fg.generateTexture('castle_flag', 16, 18);
      fg.destroy();
    }
    // Activated path-stone art. A claimed stone used to just jump to full
    // opacity — the same grey pebble, only less see-through, which barely
    // read as "claimed" next to the unclaimed ones. Bake a genuinely
    // recoloured copy of the same frame (source-atop clips the tint to the
    // stone's own silhouette, then a multiply pass re-lays the original
    // shading on top so it still reads as carved stone, not a flat sticker)
    // instead of setTint(), which is a no-op under the Phaser Canvas
    // fallback — see the halo note above. Treasure blue-white (spec §UI
    // COLOUR LANGUAGE): a claimed stone is progress toward a world reward
    // (the path's coin milestones + completion chest), the same family as
    // the POI pad/halo it shares that meaning with.
    if (!this.textures.exists('cobble_path_active')) {
      const srcFrame = this.textures.getFrame('cobble', PATH_FRAME);
      if (srcFrame && typeof document !== 'undefined') {
        const img = srcFrame.source.image;
        const cw = srcFrame.cutWidth, ch = srcFrame.cutHeight;
        const cvs = document.createElement('canvas');
        cvs.width = cw; cvs.height = ch;
        const cctx = cvs.getContext('2d');
        cctx.drawImage(img, srcFrame.cutX, srcFrame.cutY, cw, ch, 0, 0, cw, ch);
        cctx.globalCompositeOperation = 'source-atop';
        cctx.fillStyle = '#bfe8ff';
        cctx.fillRect(0, 0, cw, ch);
        cctx.globalCompositeOperation = 'multiply';
        cctx.globalAlpha = 0.75;
        cctx.drawImage(img, srcFrame.cutX, srcFrame.cutY, cw, ch, 0, 0, cw, ch);
        cctx.globalAlpha = 1;
        cctx.globalCompositeOperation = 'source-over';
        this.textures.addCanvas('cobble_path_active', cvs);
      }
    }
    // Shiny sparkle marker — a 4-point gold glint floated above rare shiny
    // entities (render.js). Baked GOLD (not white-then-tinted) so it shows its
    // colour even under the Phaser Canvas renderer, where setTint() is a no-op.
    if (!this.textures.exists('shiny_spark')) {
      const pg = this.make.graphics({ x: 0, y: 0, add: false });
      const C = 16;
      // Soft outer glow.
      pg.fillStyle(0xfff3b0, 0.85); pg.fillCircle(C, C, 4);
      // Two crossed slim diamonds form the 4-point sparkle.
      pg.fillStyle(0xffd23a, 1);
      pg.fillPoints([{ x: C, y: C - 14 }, { x: C + 2.8, y: C }, { x: C, y: C + 14 }, { x: C - 2.8, y: C }], true);
      pg.fillPoints([{ x: C - 14, y: C }, { x: C, y: C - 2.8 }, { x: C + 14, y: C }, { x: C, y: C + 2.8 }], true);
      // White-hot core sells the glint.
      pg.fillStyle(0xffffff, 1); pg.fillCircle(C, C, 2);
      pg.generateTexture('shiny_spark', 32, 32);
      pg.destroy();
    }
    // Shadow pool — one sprite per visible object that stands off the ground
    // (buildings plus seated sprites: trees, rocks, chests, wells, poles).
    // Sized to the worst case; reuses the object pool budget.
    this.shadowPool = [];
    // Creatures get their own pool so their shadows can stay pinned to the
    // cell while the sprite hops — see the creature shadow pass in render.js.
    this.creatureShadowPool = [];

    // Viewport mask clips everything inside the 11x11 area.
    const maskG = this.make.graphics({ x: 0, y: 0, add: false });
    maskG.fillStyle(0xffffff);
    maskG.fillRect(this.viewLeft, this.viewTop, this.viewSize, this.viewSize);
    const mask = maskG.createGeometryMask();
    this.cellGfx.setMask(mask);
    this.gridContainer.setMask(mask);
    this.noiseContainer.setMask(mask);
    this.borderContainer.setMask(mask);
    this.terrainContainer.setMask(mask);
    this.cobbleContainer.setMask(mask);
    this.letterContainer.setMask(mask);
    this.roadGeomContainer.setMask(mask);
    this.poiHaloContainer.setMask(mask);
    this.padContainer.setMask(mask);
    this.shadowContainer.setMask(mask);
    this.atmosGroundGfx.setMask(mask);
    this.reachGfx.setMask(mask);
    this.rampartBackGfx.setMask(mask);
    this.worldContainer.setMask(mask);   // crops + objects + creatures
    this.rampartFrontGfx.setMask(mask);
    this.towerContainer.setMask(mask);
    this.coinContainer.setMask(mask);
    this.sparkContainer.setMask(mask);
    this.atmosRimGfx.setMask(mask);
    this.atmosFalloffGfx.setMask(mask);
    this.labelContainer.setMask(mask);
    this.tierGfx.setMask(mask);
    this.fogContainer.setMask(mask);

    // Work-progress wheel — drawn above all world objects, not masked.
    this._workProgressGfx = this.add.graphics().setDepth(95);
    this._workProgressIcon = null;   // DOM element created per-action, removed on cancel/complete
    this._workProgress = null;

    const frame = this.add.graphics();
    frame.lineStyle(2, 0x000000, 0.6)
      .strokeRect(this.viewLeft - 1, this.viewTop - 1, this.viewSize + 2, this.viewSize + 2);

    // Inner vignette. The map is a hard-clipped 352×352 square sitting on the
    // flat #222 page, so its edge used to end as an abrupt seam: bright grass
    // straight into dead grey. A short darkening ramp inward from the rim
    // makes the square read as a WINDOW onto the world rather than a cropped
    // rectangle, and it does the usual vignette job of pulling the eye to the
    // player at the centre.
    //
    // Nested 1px strokes rather than a gradient fill: Phaser's Graphics has no
    // gradient primitive, and 1px rings cost nothing to bake once (the
    // viewport never moves, so this is drawn exactly once in create()).
    // Quadratic falloff over 14px, drawn as four separate edges because the
    // top and bottom need a different rim from the left and right.
    //
    // The RIM LIP — the outer 4px ramped to near-opaque — exists so art that
    // overhangs the mask FADES out instead of being sliced mid-pixel (bottom-
    // row houses were cut cleanly in half — UX audit §15). That is a fix for a
    // cut the player can SEE AGAINST THE PAGE, and only the top and bottom
    // edges have a page to be seen against: they sit in the middle of the
    // screen with the HUD chrome above and below them.
    //
    // The LEFT AND RIGHT EDGES ARE THE SCREEN EDGES. The box spans the whole
    // viewport width on a phone, so those two rings are the outermost pixels
    // of the display — and painting them near-black drew a ~4px black bar down
    // both sides of the map that read, correctly, as the game not being full
    // width. Nothing is sliced there that the bezel doesn't slice anyway, and
    // sprites overhang far less sideways than they do vertically (art is
    // centred in its cell horizontally, but seated at the cell's bottom).
    // So those edges get the soft ramp alone — still a vignette, no bar.
    //
    // Unmasked and depth 90: above every world container (all depth 0) and
    // below the work-progress wheel (95) + flash text (100+), which are UI and
    // shouldn't be dimmed.
    const vignette = this.add.graphics().setDepth(90);
    const VIG_PX = 14;
    const VIG_LIP = 4;                       // outermost rings that go opaque
    // The soft ramp every edge gets: light enough that the outer cell ring
    // stays readable, because that ring is where objects first appear as the
    // player walks toward them.
    const vigSoft = (i) => 0.15 * (1 - i / VIG_PX) ** 2;
    // Top/bottom only: 0.92 → 0.15 across VIG_LIP rings, then the soft ramp.
    const vigLip = (i) => (i < VIG_LIP
      ? 0.92 - (0.92 - 0.15) * (i / VIG_LIP)
      : vigSoft(i));
    const x0 = this.viewLeft, y0 = this.viewTop, size = this.viewSize;
    for (let i = 0; i < VIG_PX; i++) {
      // Horizontal edges run the full width so the corners stay closed.
      vignette.lineStyle(1, 0x000000, vigLip(i));
      vignette.lineBetween(x0, y0 + i + 0.5, x0 + size, y0 + i + 0.5);
      vignette.lineBetween(x0, y0 + size - i - 0.5, x0 + size, y0 + size - i - 0.5);
      vignette.lineStyle(1, 0x000000, vigSoft(i));
      vignette.lineBetween(x0 + i + 0.5, y0 + VIG_LIP, x0 + i + 0.5, y0 + size - VIG_LIP);
      vignette.lineBetween(x0 + size - i - 0.5, y0 + VIG_LIP, x0 + size - i - 0.5, y0 + size - VIG_LIP);
    }

    // Animations — Idle.png: 4 cols × 3 rows; Walk.png: 6 cols × 3 rows
    // Row 0 = facing down, row 1 = facing up, row 2 = facing side (right; flip for left)
    this.anims.create({ key: 'idle-down', frames: this.anims.generateFrameNumbers('idle', { start: 0,  end: 3  }), frameRate: 6,  repeat: -1 });
    this.anims.create({ key: 'idle-up',   frames: this.anims.generateFrameNumbers('idle', { start: 4,  end: 7  }), frameRate: 6,  repeat: -1 });
    this.anims.create({ key: 'idle-side', frames: this.anims.generateFrameNumbers('idle', { start: 8,  end: 11 }), frameRate: 6,  repeat: -1 });
    this.anims.create({ key: 'walk-down', frames: this.anims.generateFrameNumbers('walk', { start: 0,  end: 5  }), frameRate: 10, repeat: -1 });
    this.anims.create({ key: 'walk-up',   frames: this.anims.generateFrameNumbers('walk', { start: 6,  end: 11 }), frameRate: 10, repeat: -1 });
    this.anims.create({ key: 'walk-side', frames: this.anims.generateFrameNumbers('walk', { start: 12, end: 17 }), frameRate: 10, repeat: -1 });
    // Dragon transform — single non-directional flap, mirrored by heading in
    // _playDirected (the art faces right at rest). Used for both idle and fly.
    this.anims.create({ key: 'dragon-fly', frames: this.anims.generateFrameNumbers('dragon', { start: 0, end: 7 }), frameRate: 10, repeat: -1 });
    this.anims.create({ key: 'chicken-idle', frames: this.anims.generateFrameNumbers('chicken', { start: 0, end: 1 }), frameRate: 3, repeat: -1 });
    this.anims.create({ key: 'cow-idle',     frames: this.anims.generateFrameNumbers('cow',     { start: 0, end: 3 }), frameRate: 4, repeat: -1 });
    // Cat / dog idle — row 0 (frames 0-3) of their 4×N pet body sheets. The
    // renderer's cat/dog branch calls s.play('{kind}-idle'); without these
    // anims defined, leftover chicken/cow-idle from the pooled sprite kept
    // re-stamping the wrong texture onto cats and dogs.
    this.anims.create({ key: 'cat-idle', frames: this.anims.generateFrameNumbers('cat', { start: 0, end: 3 }), frameRate: 4, repeat: -1 });
    this.anims.create({ key: 'dog-idle', frames: this.anims.generateFrameNumbers('dog', { start: 0, end: 3 }), frameRate: 4, repeat: -1 });

    // Player sprite
    // Player sprite — not interactive so taps on it fall through to the world
    // handler (which then treats the tap as if it were the cell under the player).
    // Depth 10: above the footprint trail (9) so dots can't draw on the
    // character's face, below the facing-arrow overlay (11).
    //
    // Scale 1.215 = 1.35 × 0.9 (sprite shrunk 10%). With the default 0.5/0.5
    // origin the projected world position lands at the sprite CENTRE and the
    // feet sat 14px below it at 1.35× (footprint anchor, see drawFootprints).
    // That 14px is a texture offset of 14/1.35 ≈ 10.37px; at 1.215× the feet
    // would ride up to 10.37 × 1.215 ≈ 12.6px below centre. Nudge every player
    // sprite DOWN by the difference (~1.4px) so the feet — and the +14
    // footprint anchor — stay exactly where they were.
    this.playerScale = 1.215;
    // Dragon Powder skin: the 96×96 dragon frames are scaled down so the red
    // dragon reads a touch larger than the human walker without dwarfing the
    // map. Applied in _applyDragonSkin.
    this.dragonScale = 0.7;
    this.playerFeetNudgeY = 14 - (14 / 1.35) * this.playerScale;
    this.player = this.add.sprite(this.viewCenterX, this.viewCenterY + this.playerFeetNudgeY, 'idle', 0)
      .setScale(this.playerScale)
      .setDepth(10)
      .play('idle-down')
      .setMask(mask);
    // Contact shadow under the player's feet. The player is camera-locked at
    // viewCentre, so this never moves — it just sits at the footprint anchor
    // (+14px, the same point drawFootprints drops its dots at). Depth 9.5:
    // above the footprint trail (9) so a fresh dot can't sit on top of the
    // shadow, below the character (10). Created here rather than in the
    // per-frame pass because there is exactly one and it never relocates.
    // 'bldg_shadow' is baked further up in create(), so it always exists.
    this.playerShadow = this.add.image(this.viewCenterX, this.viewCenterY + 13, 'bldg_shadow')
      .setOrigin(0.5, 0.5)
      .setDisplaySize(17, 6)
      .setAlpha(0.34)
      .setDepth(9.5)
      .setMask(mask);
    // Countdown label floated over the dragon's head while Dragon Powder is
    // active — shows whole seconds of the buff remaining. Hidden whenever the
    // player isn't a dragon. The player sprite is camera-locked at viewCenter,
    // so this just rides a fixed offset above it (set per-frame in update()).
    this.dragonTimerText = this.add.text(this.viewCenterX, this.viewCenterY, '', {
      font: fontMono('bold 13px'), color: UI_GOLD,
      stroke: '#5a1400', strokeThickness: 3,
    }).setOrigin(0.5, 1).setDepth(11).setVisible(false);
    // Walk-target marker. Movement is target-follow at every depth: GPS fixes
    // and steering input move a free-flying target (this._targetM) and the
    // opaque body (this.player) walks toward it — underground it also passes
    // through rock, which the body mines out. This small dot marks where the
    // target is whenever it has pulled away from the body; it stays hidden once
    // the two coincide. A plain marker, not a player-shaped sprite — the only
    // player sprites on the map belong to real bodies (this.player, and any
    // other live player — see multiplayer.js).
    this.targetGhost = this.add.circle(this.viewCenterX, this.viewCenterY + this.playerFeetNudgeY, 5, 0xffffff, 0.55)
      .setStrokeStyle(1.5, 0x000000, 0.4)
      .setDepth(10)
      .setVisible(false)
      .setMask(mask);
    // Warning halo behind the player: red when the tank is empty, near-black
    // when the stick has walked them a long way off the GPS. Pulses so it reads
    // as a live warning rather than a smudge under the sprite. Depth 9.7 puts
    // it under the character (10) and over the footprint trail (9).
    this.playerHalo = this.add.image(this.viewCenterX, this.viewCenterY + this.playerFeetNudgeY, 'halo_red')
      .setOrigin(0.5, 0.5)
      .setDepth(9.7)
      .setVisible(false)
      .setMask(mask);
    // GPS marker — a crosshair at your REAL (GPS) position, shown once the
    // stick has walked the character far enough off it to matter. Walking off
    // the GPS is the whole point of the stick, so you need to see where you
    // actually are to find your way back; without this the only clue was the
    // character quietly not being where you're standing.
    //
    // Not a player-shaped sprite — the only player sprites on the map belong
    // to real bodies — and not a filled dot either: gold and round at this
    // size is a coin, which is the one thing on this map you are meant to walk
    // over and collect. See the 'gps_crosshair' bake above.
    this.gpsGhost = this.add.image(this.viewCenterX, this.viewCenterY + this.playerFeetNudgeY, 'gps_crosshair')
      .setOrigin(0.5, 0.5)
      .setDepth(9.8)
      .setVisible(false)
      .setMask(mask);
    // Walk-home lead — the dashed line from the feet to the GPS dot while
    // the character is walking itself back (see _drawWalkHomeHint). Depth
    // 9.75 tucks it under the character (10) and the dot (9.8) but over the
    // halo (9.7), so it reads as being on the ground.
    this.walkHomeGfx = this.add.graphics().setDepth(9.75).setMask(mask);
    this._walkHomeDashPhase = 0;
    this._driftingHome = false;
    // Marching dashes are decoration — the line itself says where the
    // character is headed, so honour a reduced-motion preference by holding
    // them still. Read once: the pass runs every frame.
    this._reducedMotion = !!(typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    // Target-follow state. _targetM is the walk target in body-relative world
    // metres; _autoMineKey marks the wall cell a wheel is currently chewing
    // through (underground only); _followPaused halts pursuit after the player
    // taps to interrupt auto-mining (cleared on the next steer input or fix).
    this._targetM = null;
    this._autoMineKey = null;
    this._followPaused = false;
    // Facing direction indicator — arrow rendered via Graphics, pointed in the
    // direction of the device compass (or last movement as a fallback).
    this.facingGfx = this.add.graphics().setDepth(11).setMask(mask);
    this.compassDeg = null; // degrees clockwise from north, or null if no sensor
    // Bow / staff shots in flight (see _combatTick). Drawn just above the
    // facing arrow — a shot travels along that arrow, so it has to read as
    // coming off the tip rather than sliding under it.
    this.projGfx = this.add.graphics().setDepth(12).setMask(mask);
    this._shots = [];
    this._nextShotT = {};              // per-slot next-fire clock, in performance.now() ms
    // Health bars over recently-hurt enemies. Under the work wheel (95) so a
    // foe you are actually swinging at keeps the brighter bar on top.
    this.enemyHealthGfx = this.add.graphics().setDepth(94).setMask(mask);
    // Sword-swing slash — a short arc drawn near the player, toward whatever
    // it's engaged with, on the same beat the melee wheel's damage numbers
    // pop (see SWORD_SWING_MS / _drawSwordSwing). Depth 11: same tier as the
    // facing arrow, above the body (10).
    this.swordSwingGfx = this.add.graphics().setDepth(11).setMask(mask);
    this._swing = null;                // { startT, dir: {x,y} } while a slash is animating
    this._nextSwingT = 0;              // performance.now() ms the next swing may fire
    // Footprint trail — small 50% grey dots dropped as the player moves, each
    // fading 10% per new drop so ~5 are visible. Drawn under the player sprite.
    this.footprintGfx = this.add.graphics().setDepth(9).setMask(mask);
    this.footprints = [];               // [{ x, y, alpha }, …] in world meters
    this._lastFootprintM = { x: this.playerM.x, y: this.playerM.y };

    // Keyboard
    this.keys = this.input.keyboard.addKeys({
      W: Phaser.Input.Keyboard.KeyCodes.W,
      A: Phaser.Input.Keyboard.KeyCodes.A,
      S: Phaser.Input.Keyboard.KeyCodes.S,
      D: Phaser.Input.Keyboard.KeyCodes.D,
      UP: Phaser.Input.Keyboard.KeyCodes.UP,
      DOWN: Phaser.Input.Keyboard.KeyCodes.DOWN,
      LEFT: Phaser.Input.Keyboard.KeyCodes.LEFT,
      RIGHT: Phaser.Input.Keyboard.KeyCodes.RIGHT,
    });
    // Debug: SPACE teleports to the next-nearest decorated POI chest.
    // First press goes to Windermere Park, subsequent presses cycle by distance.
    this._poiTpVisited = new Set();
    this._poiTpFirst = 'Windermere Park';
    this.input.keyboard.on('keydown-SPACE', () => this.teleportNextPoi());
    // Debug: T hops to the next-nearest INDIVIDUAL tree (the standalone OSM
    // street / yard trees wired in from the satextract sidecar, flagged
    // `individual:true`), cycling outward by distance so repeated presses
    // walk you through them. No game-state side effects beyond the teleport.
    this.input.keyboard.on('keydown-T', () => this.teleportNextIndividualTree());
    // F — toggle fast-walk (5× speed, all inputs)
    this._fastWalk = false;
    this.input.keyboard.on('keydown-F', () => { this._fastWalk = !this._fastWalk; });

    // World tap (player handler runs first and stops propagation). Ping mode
    // (multiplayer.js — "tap 📍, then tap the map") takes the tap first.
    this.input.on('pointerdown', (p) => {
      if (typeof Multiplayer !== 'undefined' && Multiplayer.consumeTap(this, p.x, p.y)) return;
      this.handleWorldTap(p.x, p.y);
    });

    // Stuck-touch-pointer sweeper. Phaser frees a touch pointer only when its
    // touchend/touchcancel reaches its handlers with a matching identifier —
    // and two things on this page can eat that event: the double-tap-zoom
    // guard in index.html (preventDefault on a quick second touchend, which
    // Phaser's window listener explicitly ignores) and DOM rebuilt under a
    // held finger (buildInventoryDOM removes the bars; a touchend dispatched
    // to a detached node never bubbles to window). A pointer left `active`
    // with no finger on the glass is stranded FOREVER — Phaser never assigns
    // new touches to an occupied slot and nothing else resets it — which
    // played as "touch randomly dies after a few minutes, until reload".
    // After the last finger lifts, give Phaser its normal crack at the event
    // (setTimeout 0), then reset any touch pointer still claiming to be
    // active. The mouse pointer (id 0) is never touched.
    if (!window.__touchSweeperInstalled) {
      window.__touchSweeperInstalled = true;
      const sweep = (e) => {
        if (e.touches && e.touches.length) return;   // fingers still down
        setTimeout(() => {
          const pointers = this.input?.manager?.pointers;
          if (!pointers) return;
          for (const p of pointers) {
            if (p.id !== 0 && p.active) p.reset();
          }
        }, 0);
      };
      window.addEventListener('touchend', sweep, { passive: true });
      window.addEventListener('touchcancel', sweep, { passive: true });
    }

    // The movement pads (stick / debug) are position:fixed on <body> at
    // z-index 6, but every modal lives INSIDE #game, whose CSS transform makes
    // its own stacking context — so a modal's z-index can't climb above the
    // body-level pads. The bottom-right pad — now always on screen — sits ON
    // TOP of an open dialog and eats the taps that
    // would dismiss it (and even walks the player), so the chest reward modal
    // gets stuck: "I can still walk around but can't interact." Gate the pads
    // behind a body.modal-open class toggled whenever a .game-modal is shown.
    this._installModalPadGate();

    // HUD + banner + inventory
    this.hud = document.getElementById('hud');
    this.moneyEl = document.getElementById('money');
    this.banner = document.getElementById('banner');
    this._settleInvCatOnBoot();
    this.buildInventoryDOM();

    // First-session objective chip. A save that predates the starter ladder is
    // already past the point it teaches — retire it rather than telling a
    // player with a built farm to go till their first cell. The tell is that
    // they have played at all: any tilled ground, any restored house, any
    // opened chest, or money moved off the starting purse.
    if (typeof Quests !== 'undefined' && !this.save.starter) {
      if (SaveMigrate.hasPlayed(this.save)) Quests.starterSkipAll(this.save);
    }
    document.getElementById('objective-hide')
      ?.addEventListener('click', (e) => { e.stopPropagation(); this.dismissObjective(); });
    this.updateObjectiveDOM();

    // Sandbox mode (`?sandbox=true`): pre-seed the start tile + 8 neighbours
    // with a synthetic 5×5 grid of biome plots containing every native
    // interactable. Runs BEFORE ensureTilesAround so WorldGen.loadTile short-
    // circuits on the cached tile and skips the network fetch.
    if (typeof Sandbox !== 'undefined' && Sandbox.detect()) {
      Sandbox.install(this);
    }

    // Bridge for the how-to card's "Skip the tutorial" button. The card is
    // plain DOM in index.html, outside the scene, so it drives the starter
    // ladder through these two hooks rather than touching the save itself.
    window.__tutorialActive = () =>
      typeof Quests !== 'undefined' && !Quests.starterHidden(this.save);
    window.__disableTutorial = () => this.dismissObjective();

    // First arrival in the world — show the how-to card over the live map, so
    // the reach bubble and the objective chip it points at are visible behind
    // it. Shown once (localStorage terracart.howtoSeen); the ☰ menu's "How to
    // play" reopens it any time. Must sit BELOW the Sandbox.install above:
    // that call is what sets _sandboxMode, and the sandbox is a dev world that
    // has no use for the card. index.html queues the first-run card behind the
    // opening story slides, so calling it here can't jump the story.
    if (!this._sandboxMode) window.showHowTo?.();

    // Boot tile load. The boot overlay (index.html) used to fade the instant
    // the FIRST update() frame ran, leaving the in-world "unmapped" shimmer as
    // the only sign anything was happening for however long the initial 3×3
    // tile block took to fetch — several seconds on a cold cache, and a
    // dark shimmer reads as stalled, not loading. Keep the overlay up (its bar
    // fed per-tile by ensureTilesAround itself) until this first call actually
    // resolves, success or failure, instead of handing off at first paint.
    this.ensureTilesAround()
      .catch(e => console.error(e))
      .then(() => { this._bootOverlayGone = true; window.__bootStatus?.(1); });

    // Network status
    window.addEventListener('offline', () => this.showBanner(true));
    window.addEventListener('online', () => this.showBanner(false));

    // Movement-stick state. The stick is ALWAYS on screen (the debug pad is
    // the only thing that ever takes its slot) — it's the control that walks
    // you somewhere other than where the GPS puts you, and an amulet only
    // makes that walking faster and cheaper. joystickVec is driven by pointer
    // events on the pad, _movePadHeld says whether the pointer is currently
    // down, and _manualOffsetM accumulates how far the stick has walked you
    // from your real position: every fix targets gpsM + this offset, so the
    // ground you covered by hand survives the next fix instead of being
    // yanked back. _steerDistAccrue buffers metres toward the next energy pip.
    this.joystickVec = { x: 0, y: 0 };
    this._movePadHeld = false;
    this._manualOffsetM = { x: 0, y: 0 };
    this._steerDistAccrue = 0;
    this._steerCostAccrue = 0;


    // GPS watch + device compass (best-effort). Test mode skips them so the
    // test harness can drive playerM directly without GPS easing fighting it.
    // Compass + GPS are gated behind the safety-splash button click (the
    // genuine user gesture iOS requires for DeviceOrientationEvent
    // permission) — see #safety-dismiss in index.html, which sets
    // window.__compassPerm and calls scene.startSensors(). If the modal
    // was dismissed BEFORE this scene finished loading, do it now.
    if (!window.__TEST_MODE) {
      this.setupLifecycle();
      if (window.__compassPerm) this.startSensors();
    }
    // Tests reach into the scene via window.__scene.
    window.__scene = this;
    // Other players. No-op until the save carries a player name (the
    // welcome splash / ☰ menu set it); tick() picks it up once it does.
    if (!window.__TEST_MODE && typeof Multiplayer !== 'undefined') Multiplayer.start(this);
  }

  // Called from the safety-splash button click (or from create() if the
  // modal was already dismissed when the scene loaded). Idempotent: safe
  // to call repeatedly. The compass listener attach is gated on
  // window.__compassPerm because iOS gives us nothing without 'granted'.
  startSensors() {
    if (window.__compassPerm === 'granted') this._attachCompass();
    if (this.gpsWatchId == null) this.startGps();
  }

  // Re-arm the GPS watch after a background nap (the watch is released on
  // hide to save battery) — and, when the player denied location and has
  // since changed their mind in the browser's own settings, after that too.
  //
  // The gate is the PERMISSION, never how the watch has been behaving: a
  // transient TIMEOUT or POSITION_UNAVAILABLE used to leave the game refusing
  // to watch again for the rest of the session, which is exactly how a player
  // ends up parked at the default home with location switched on. A denial is
  // re-checked through the Permissions API (no second prompt, and no nagging
  // if the answer is still no) — a browser that lacks it keeps the old
  // behaviour of waiting for a reload.
  _retryGps() {
    if (window.__TEST_MODE || this._sandboxMode || _teleportOverride) return;
    if (this.gpsWatchId != null) return;
    if (!this._gpsDenied) { this.startGps(); return; }
    try {
      navigator.permissions?.query({ name: 'geolocation' }).then((st) => {
        if (!st || st.state === 'denied' || this.gpsWatchId != null) return;
        this._gpsDenied = false;
        this.startGps();
      }).catch(() => {});
    } catch (_) { /* no Permissions API — a reload re-asks */ }
  }

  // Has this save written anything into the world yet? Each of these is a
  // coordinate in the origin's own metre frame (metres = z=14 px × mPerPx,
  // and mPerPx is fixed at the origin's latitude), so the moment one exists
  // the origin is load bearing and can no longer move under it.
  _worldPlaced() {
    const sv = this.save;
    // PROVISIONAL_ORIGIN_KEYS are deliberately NOT in this list: they are the
    // starter kit the pre-capture passes lay down, all of it re-derived at the
    // new origin after the reload. Counting them let the safety net disarm the
    // capture it had just stayed armed for — see PROVISIONAL_ORIGIN_KEYS.
    //
    // What IS here is what the PLAYER committed: a Home adopted onto a real
    // house (or a trailer dropped under them — both need a GPS fix, so they
    // can only exist once capture has already resolved), and ground they have
    // tilled or planted, which is stored as cells in this origin's own frame.
    return !!(sv.starterShopId || sv.starterTrailer
      || (sv.tilled && sv.tilled.length) || (sv.planted && sv.planted.length));
  }

  // A save that never captured a home plays at the DEFAULT origin. Standing a
  // few streets from it is ordinary — that IS the default neighbourhood for
  // the players it was picked for. Standing a province away is not: the map,
  // Home, the starter crates and the objective arrow are all back there while
  // the player is here.
  //
  // It cannot be re-anchored under them: every coordinate this save has
  // written is metres in a frame scaled at the origin's latitude, so moving
  // the origin drifts the lot (which is why the capture window closes as soon
  // as the world places anything — see startGps). So this says it plainly,
  // once a session, and names the one control that rebuilds the farm here.
  _warnStrandedOrigin(fix) {
    if (this._strandedWarned || !fix) return;
    if (this.save.home || _teleportOverride || this._sandboxMode || window.__TEST_MODE) return;
    // Wait for the boot overlay to actually be gone — a dialog stacked under
    // it is a dialog nobody reads. A later fix re-offers it. This is the
    // overlay's OWN dismissal (_bootOverlayGone, set once the initial tile
    // load resolves), not just "a frame has rendered" (_bootStatusDone) — the
    // overlay now outlives the first frame on purpose (see create()).
    if (!this._bootOverlayGone) return;
    const d = Math.hypot(fix.x, fix.y);
    if (!(d >= ORIGIN_STRANDED_M)) return;
    this._strandedWarned = true;
    this.showMessageModal({
      title: 'Your farm is somewhere else',
      body: `This game was built around the default map — ${Math.round(d / 1000)} km from where you are `
          + `standing. Its first GPS fix didn't arrive in time to anchor the world on you.\n\n`
          + `You can walk around here, but Home, your starter crates and the objective arrow all point `
          + `back there.\n\nTo rebuild the farm where you are: ☰ menu › Reset this game.`,
      okLabel: 'Got it',
    });
  }

  // === Power / lifecycle ===
  // Keep the screen awake while the game is foreground, and pause the game +
  // GPS watch whenever the tab is backgrounded. The OS automatically releases
  // the wake lock when the tab loses visibility, so it has to be re-requested
  // on each visibility→visible transition.
  setupLifecycle() {
    // Wake Lock — best-effort; not all browsers support it (e.g. iOS < 16.4).
    this._wakeLock = null;
    const acquireWakeLock = async () => {
      if (!('wakeLock' in navigator)) return;
      try {
        this._wakeLock = await navigator.wakeLock.request('screen');
        this._wakeLock.addEventListener('release', () => { this._wakeLock = null; });
      } catch (e) {
        // User-facing failure modes: page not visible, battery saver, etc.
        // No need to surface — the screen just times out normally.
        this._wakeLock = null;
      }
    };
    acquireWakeLock();

    // Visibility lifecycle: pause game + GPS when hidden, resume on return.
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        // Pause Phaser's render+update loop — saves CPU/battery while backgrounded.
        if (this.game && !this.game.isPaused) this.game.pause();
        // Stop tracking GPS — by far the biggest battery drain — and re-arm
        // on return so a fresh fix is taken. Releasing the subscription
        // doesn't tear the watch down instantly: Geo holds it for a short
        // grace period, so a quick app-switch and back rejoins the SAME watch
        // instead of starting a new one (a new watch means another location
        // prompt on browsers whose grant is per page session).
        if (this.gpsWatchId != null) {
          Geo.unsubscribe(this.gpsWatchId);
          this.gpsWatchId = null;
        }
        // Snapshot the moment we paused. Phaser stops calling update() while
        // hidden, so the per-frame heartbeat freezes — anchor lastSeenAt here
        // so the next visible-transition (or page reload) measures from now.
        // Fog reveals are persisted on a throttle (see _revealFog); this is
        // the trailing flush that catches the tail of the walk before the tab
        // goes away.
        if (typeof Fog !== 'undefined') Fog.flush(this.save);
        this.save.lastSeenAt = Date.now();
        persistSave(this.save);
      } else {
        // Foregrounded after a background nap. Resume the game loop FIRST:
        // everything after this line is nice-to-have, and a throw from any of
        // it (applyOfflineRest builds Phaser text + tweens) used to escape the
        // event handler before resume() ran — leaving the game paused forever,
        // a dead screen that no longer took taps. Guard the rest so one bad
        // step can't skip the others either.
        if (this.game && this.game.isPaused) this.game.resume();
        try {
          // Pro-rate energy restoration by the gap, just like a fresh page
          // load would do in create().
          if (this.save.lastSeenAt && !window.__TEST_MODE) {
            this.applyOfflineRest(Math.max(0, Date.now() - this.save.lastSeenAt));
          }
          this.save.lastSeenAt = Date.now();
          persistSave(this.save);
          this._retryGps();
          // A block that came back short waits out its backoff while hidden
          // (see _scheduleTileRetry). Coming back is the likeliest moment for
          // the network to be good again, so take it from the top rather than
          // sitting on a minute-long delay in front of an empty map.
          if (this._tileRetryMs) {
            this._tileRetryMs = 0;
            if (this._tileRetryTimer) { clearTimeout(this._tileRetryTimer); this._tileRetryTimer = null; }
            this.ensureTilesAround().catch(() => {});
          }
          // Wake lock is auto-released on hide; re-acquire on return.
          if (!this._wakeLock) acquireWakeLock();
        } catch (e) { this._reportLoopError?.(e); }
      }
    };
    document.addEventListener('visibilitychange', onVis);
  }

  // Latch manual control: once the player moves themselves (keyboard, or a
  // SPACE / T teleport) we stop letting GPS yank them back to their physical
  // location for the rest of the session. Idempotent — safe to call every
  // frame from the movement loop. Drops any in-flight GPS ease so the current
  // manual move isn't fought. NOT persisted (session-scoped); a reload resumes
  // live GPS.
  disableGpsForSession() {
    if (this._gpsManualOverride) return;
    this._gpsManualOverride = true;
    this.syncMoveTarget();   // drop the last GPS target so it can't keep pulling
    if (this.gpsAvailable) {
      this.flash('GPS off — manual control', this.viewCenterX, this.viewCenterY - 40);
    }
  }

  // === GPS ===
  startGps() {
    // Sandbox mode parks the player at a synthetic biome-grid plot and uses
    // keyboard / joystick movement only — GPS would snap them away to their
    // real-world coords on first fix.
    if (this._sandboxMode) return;
    // A teleport preset relocates the world origin; live GPS would immediately
    // snap the player back to their real location, so leave it off while an
    // override is active (same rationale as sandbox above).
    if (_teleportOverride) { this.gpsAvailable = false; return; }
    if (!navigator.geolocation) return;
    // Already watching (or the subscription is being re-armed) — never stack a
    // second watch: on browsers that grant location per page session rather
    // than per origin, every extra watchPosition can mean another prompt.
    if (this.gpsWatchId != null) return;
    this.gpsAvailable = true;
    // Safety net: if no fix ever arrives, stop waiting for home capture after
    // 2 min so the start flow falls back to the default origin rather than
    // hang forever. Generous on purpose: a cold GPS start indoors routinely
    // takes 30-60 s, and giving up early permanently anchors the save at the
    // default home — the starter-chest trail then spawns half a world from
    // the player (the post-reset "my loot boxes are missing" bug). While
    // capture is pending nothing is placed or adopted (ensureStarterShopId
    // waits), so the only cost of patience is Home appearing a little later.
    // Armed here — not in create() — so the clock starts when GPS actually
    // starts watching; the opening story + safety splash can hold sensors
    // off far longer than that.
    // The net only lets the WORLD get on with it (_homeCapturePending);
    // _homeCaptureArmed stays set, so a fix that finally lands at 3 minutes
    // still becomes this save's home as long as nothing has been placed yet.
    if (this._homeCapturePending && !this._homeCaptureTimer) {
      this._homeCaptureTimer = setTimeout(() => {
        if (!this._homeCapturePending) return;
        this._homeCapturePending = false;
        // Placement unblocked — this save carries on at the current (default)
        // origin, so freeze the starter crate trail there now. The spawn
        // tile usually rasterized minutes ago, so this retro-places it.
        if (!this.save.home && !this.save.starterShopId) {
          this._setStarterCratesAt(this.startWorldM.x, this.startWorldM.y);
        }
      }, 120000);
    }
    // One watch per page, shared through Geo (src/geo.js) — index.html's
    // boot-time home capture uses the same one, so a fresh start asks the
    // player for their location exactly once.
    try {
      this.gpsWatchId = Geo.subscribe(
        pos => {
          const { latitude, longitude } = pos.coords;
          // First GPS fix on a brand-new save: freeze THIS location as the
          // save's home origin and reload so the whole projection re-anchors
          // here. Only reload after VERIFYING the write landed (read it back) —
          // otherwise a failed localStorage write would loop on every fix.
          // (Fallback path only: index.html normally captures home BEFORE
          // app.js loads, so no reload — and no second location prompt — is
          // needed. This runs when that boot gate gave up waiting and the
          // fix landed afterwards.)
          // The window closes the moment the world puts something down: after
          // that the origin is load bearing (every saved coordinate is metres
          // in a frame scaled at the origin's latitude), so moving it would
          // drift the lot. Until then a late fix is still welcome — that is
          // what stops a slow first fix leaving the save marooned at the
          // default home for good.
          if (this._homeCaptureArmed && this._worldPlaced()) this._homeCaptureArmed = false;
          if (this._homeCaptureArmed) {
            this._homeCapturePending = false;
            this._homeCaptureArmed = false;
            this.save.home = { lat: latitude, lon: longitude };
            // The 2-minute net may already have dropped this save's whole
            // starter kit at the default origin on the way here — the crate
            // anchor, the soil plot, the provisioned trees/rocks/wrecks. All
            // of it is metres in the frame we are about to replace, so drop it
            // and let the reloaded world lay it down again on the player
            // (_starterTrailAnchor / _carveStarterPlot / _provisionStarterHome
            // each re-freeze from scratch when their field is empty).
            for (const k of PROVISIONAL_ORIGIN_KEYS) this.save[k] = null;
            let ok = false;
            try {
              persistSave(this.save);
              if (typeof flushSave === 'function') flushSave();
              const rb = loadSave();
              ok = !!(rb && rb.home && rb.home.lat === latitude && rb.home.lon === longitude);
            } catch (_) { ok = false; }
            if (ok) {
              // One-shot flag for the reload: the player answered the safety
              // splash seconds ago, so the reloaded page skips it and reuses
              // the same compass-permission answer (sessionStorage — gone once
              // the browsing session ends, so a later cold load asks again).
              try { sessionStorage.setItem('terracart.skipSafety', window.__compassPerm || 'granted'); } catch (_) {}
              location.reload(); return;
            }
            // write/readback failed — don't loop; carry on with current origin.
          }
          // Project the fix the way the MAP is projected (coords.js
          // lonLatToLocalM — exact Web-Mercator), not with a flat metres-per-
          // degree approximation: the flat one only agrees with the map at the
          // origin and drifts as you walk away from it, which put a player
          // metres off their own map after a long walk and a province off it on
          // a save that never captured a home.
          const fix = lonLatToLocalM(this, longitude, latitude);
          const prev = this.gpsM;
          this.gpsM = { x: fix.x, y: fix.y };
          // A fix in hand: GPS is live again, whatever transient error the
          // watch reported earlier (see the error handler — a cold start
          // routinely TIMEOUTs once before the first fix lands).
          this.gpsAvailable = true;
          // Nothing left to anchor, and the player is nowhere near the world
          // they were given? Say so — it can't be fixed under them.
          this._warnStrandedOrigin(this.gpsM);
          // A manual-control takeover this session (WASD / arrow keys / SPACE /
          // T teleport) owns movement entirely: skip the GPS-driven target
          // write so the keyboard isn't fighting the watcher. gpsM still tracks
          // so the HUD's gps-live check and the facing fallback below keep
          // working. Debug controls no longer opt out — they only make stick
          // walking free (see _steerManual) — and neither does a dragon, which
          // is now a stat buff rather than a flight mode.
          if (this._gpsManualOverride) {
            // intentionally no target / playerM write
          } else {
            // THE FIX IS THE TARGET — plus whatever the stick has walked you
            // off it (_manualOffsetM). The body walks toward that in
            // _followStep: underground through rock it mines out, on the
            // surface as a plain walk. Adding the offset rather than
            // overwriting the target is what lets stick walking survive the
            // next fix a second later instead of being yanked straight back.
            // A fresh fix counts as a steer, so it also resumes any pursuit
            // paused by a tap-interrupt.
            const off = this._manualOffsetM;
            // Is this fix a jump too big to have been WALKED? Measure in the
            // GPS's own frame — body minus the stick offset — so walking 200 m
            // off the GPS by hand doesn't read as a 200 m GPS jump and snap
            // you home.
            const bodyGpsX = this.playerM.x - off.x;
            const bodyGpsY = this.playerM.y - off.y;
            if (this.depth === 0
                && (!prev || Math.hypot(this.gpsM.x - bodyGpsX,
                                        this.gpsM.y - bodyGpsY) > GPS_SNAP_M)) {
              // First fix of the session, or a real jump (see GPS_SNAP_M) —
              // place the body outright and drop the stick offset: the
              // character is being re-anchored on the true position, and
              // keeping the offset would just walk it back off again. Surface
              // only: a snap underground would drop the player inside solid
              // rock, so down there the body always mines its way over,
              // however far it is.
              off.x = 0; off.y = 0;
              this.playerM.x = this.gpsM.x;
              this.playerM.y = this.gpsM.y;
            }
            this._targetM = { x: this.gpsM.x + off.x, y: this.gpsM.y + off.y };
            this._followPaused = false;
          }
          if (prev) {
            const ddx = this.gpsM.x - prev.x, ddy = this.gpsM.y - prev.y;
            // Only use movement as facing fallback when there's no compass.
            if ((ddx || ddy) && this.compassDeg == null) this.facing = { x: ddx, y: ddy };
          }
        },
        err => {
          console.warn('GPS error', err.message);
          // The HUD's "have we actually got GPS?" line only. NOT a latch: it
          // goes true again on the next fix, and nothing decides whether to
          // keep watching from it. It used to, and that cost a player their
          // GPS for the whole session — a cold start TIMEOUTs once (below)
          // before the first fix, and the visibility handler then refused to
          // re-arm the watch after the first app-switch, freezing the farmer
          // wherever it stood (on a fresh save: the default home, half a
          // country from the player).
          this.gpsAvailable = false;
          // Only a hard permission denial stops the watch. Transient
          // errors — TIMEOUT (err.code 3, guaranteed within 10 s by the
          // watch's `timeout` option on a cold GPS start) and
          // POSITION_UNAVAILABLE (2) — must NOT: cancelling home capture here
          // froze the save's origin at the DEFAULT home, so when the real fix
          // finally arrived the starter-chest trail + cleared tutorial pocket
          // had spawned on the default spawn tile, nowhere near the player
          // (classic symptom right after a save reset).
          if (err && err.code === 1 /* PERMISSION_DENIED */) {
            this._gpsDenied = true;
            // Let the dead subscription go: the watch will never fire again,
            // and holding it stops a later grant (Settings → Location, then
            // back to the tab) from arming a fresh one — see _retryGps.
            if (this.gpsWatchId != null) { Geo.unsubscribe(this.gpsWatchId); this.gpsWatchId = null; }
            this._homeCapturePending = false;
            this._homeCaptureArmed = false;
            // No GPS for this save — it plays out at the current (default)
            // origin, so freeze the starter crate trail there (retro-places
            // onto the already-rasterized spawn tile).
            if (!this.save.home && !this.save.starterShopId) {
              this._setStarterCratesAt(this.startWorldM.x, this.startWorldM.y);
            }
          }
        }
      );
      if (this.gpsWatchId == null) this.gpsAvailable = false;
    } catch { this.gpsAvailable = false; }
  }
  // Device compass: prefer absolute-orientation events (Android), fall back to
  // webkitCompassHeading (iOS), then to non-absolute `deviceorientation` as a
  // last resort. Stores smoothed degrees CW-from-north in this.compassDeg.
  //
  // Three things this handles that the naive version didn't:
  //  1. Once we get a TRUE absolute reading, we lock to it — later non-absolute
  //     events (which are relative to whatever the device booted into) are
  //     ignored. Conversely if we only ever get non-absolute, we KEEP accepting
  //     them (the previous code latched after one reading → compass froze).
  //  2. Screen-orientation correction: alpha is reported relative to the
  //     device's natural orientation. When the player rotates to landscape,
  //     we subtract screen.orientation.angle so north stays north.
  //  3. Exponential-moving-average low-pass — raw readings jitter ±5–10°.
  //     Smooth toward the new reading via the shorter arc on the 360° circle.
  //
  // Permission is requested in index.html on the safety-splash button click
  // (the only iOS-honoured user gesture in our boot flow); this method just
  // attaches listeners. Idempotent — bails out if called twice.
  _attachCompass() {
    if (this._compassAttached) return;
    this._compassAttached = true;
    let sawAbsolute = false;
    const onOrient = (e) => {
      let deg = null;
      let absoluteThisEvent = false;
      if (typeof e.webkitCompassHeading === 'number') {
        // iOS: tilt-compensated and CW from true north. Use directly.
        deg = e.webkitCompassHeading % 360;
        absoluteThisEvent = true;
      } else if (e.absolute && typeof e.alpha === 'number') {
        // alpha is CCW from north; flip to CW.
        deg = (360 - e.alpha) % 360;
        absoluteThisEvent = true;
      } else if (typeof e.alpha === 'number' && !sawAbsolute) {
        // Best-effort non-absolute fallback — keep updating every event until
        // (and unless) a true-absolute source appears.
        deg = (360 - e.alpha) % 360;
      }
      if (deg == null || Number.isNaN(deg)) return;
      if (absoluteThisEvent) sawAbsolute = true;
      // Subtract the screen rotation so a landscape-held phone still points
      // north correctly. screen.orientation.angle ∈ {0,90,180,270}.
      const screenAngle = (window.screen?.orientation?.angle) ?? 0;
      deg = (deg - screenAngle + 360) % 360;
      // Smooth the HEADING UNIT VECTOR, not the degrees — avoids the
      // wraparound special-case entirely and is symmetric in all directions
      // (smoothing degrees subtly biases towards 180° because of how the
      // shortest-arc fold interacts with averaged drift).
      //
      // Time-constant low-pass: alpha = dt / (TAU + dt). Devices fire at very
      // different rates (~60 Hz Android, ~10 Hz iOS), so a fixed per-event
      // alpha gives wildly different convergence speeds. TAU is the response
      // time constant (~63% of the way to a new reading) in milliseconds —
      // small enough to feel realtime while still absorbing per-event jitter.
      const now = performance.now();
      const dt = this._lastOrientT ? (now - this._lastOrientT) : 16;
      this._lastOrientT = now;
      const TAU = 40;
      const alpha = dt / (TAU + dt);
      const rad = deg * Math.PI / 180;
      const fx = Math.sin(rad), fy = -Math.cos(rad);   // unit vector in screen coords
      if (!this._facingSmooth) {
        this._facingSmooth = { x: fx, y: fy };
      } else {
        this._facingSmooth.x += (fx - this._facingSmooth.x) * alpha;
        this._facingSmooth.y += (fy - this._facingSmooth.y) * alpha;
      }
      // Re-normalise so the magnitude stays 1 (EMA of two points on a circle
      // produces a chord; without renormalising the smoothed vector shrinks
      // toward 0 during fast rotation).
      const m = Math.hypot(this._facingSmooth.x, this._facingSmooth.y) || 1;
      this.facing = { x: this._facingSmooth.x / m, y: this._facingSmooth.y / m };
      this.compassDeg = (Math.atan2(this.facing.x, -this.facing.y) * 180 / Math.PI + 360) % 360;
    };
    window.addEventListener('deviceorientationabsolute', onOrient, true);
    window.addEventListener('deviceorientation', onOrient, true);
  }

  // === Tiles ===
  // What the ⚡ chip does when tapped (UX audit §20): "how do I refill this?"
  // is the obvious gesture and it did nothing. Says where energy comes from,
  // and how much this save's armor allows.
  showEnergyHelp() {
    const cur = Math.floor(this.save.energy ?? 0), max = this.getMaxEnergy();
    const { wrap, box, mount, mkBtn } = this.makeModalShell('energy-help',
      { maxWidth: 300, textAlign: 'left', onClose: () => {}, kind: 'energy' });
    const h = document.createElement('div');
    h.style.cssText = 'font:700 14px ui-monospace,monospace;color:var(--green);'
      + 'margin-bottom:8px;text-align:center;';
    h.textContent = `${cur} / ${max}`;   // the kind header already says ENERGY
    box.appendChild(h);
    const body = document.createElement('div');
    body.style.cssText = 'font:12px/1.5 ui-monospace,monospace;color:#ddd;';
    body.innerHTML =
      'Energy pays for tilling, chopping, mining and walking off the GPS.<br><br>'
      + '• <b>Eat</b> — select any food in the bag and use the Eat button.<br>'
      + '• <b>Rest</b> — it refills slowly on its own over time.<br>'
      + '• <b>Armor</b> — each piece raises the cap (currently ' + max + ').';
    box.appendChild(body);
    const close = mkBtn('Got it');
    close.style.marginTop = '12px';
    close.style.width = '100%';
    close.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); });
    box.appendChild(close);
    mount();
  }

  // Short vibration on tap outcomes. An outdoor phone game in sunlight can't
  // rely on a 12px flash label alone (UX audit §18), so a tap that lands and a
  // tap that's rejected feel different. Off is remembered in the save; the API
  // is absent on desktop and iOS Safari, hence the optional call.
  haptic(ms) {
    if (this.save?.haptics === false) return;
    try { navigator.vibrate?.(ms); } catch (_) {}
  }
  hapticOk()     { this.haptic(15); }
  hapticReject() { this.haptic(40); }

  showBanner(on) {
    this.banner.style.display = on ? 'block' : 'none';
    // Wire tap-to-retry once: drop the failed tiles so the next ensureTiles
    // refetches them rather than serving the cached failure.
    if (on && !this.banner._retryWired) {
      this.banner._retryWired = true;
      this.banner.addEventListener('click', (e) => {
        e.stopPropagation();
        for (const [k, t] of WorldGen.tileCache) if (t && t.status !== 'ready') WorldGen.tileCache.delete(k);
        this.banner.textContent = 'retrying…';
        this.ensureTilesAround?.().finally?.(() => {
          this.banner.textContent = "can't reach the map — tap to retry";
        });
      });
    }
  }

  playerToWorldCell() {
    const wx = this.originPx.x + this.playerM.x / this.mPerPx;
    const wy = this.originPx.y + this.playerM.y / this.mPerPx;
    const tilePx = WorldGen.TILE_PX;
    const tx = Math.floor(wx / tilePx);
    const ty = Math.floor(wy / tilePx);
    const cellPxSize = tilePx / this.cellsPerTile;
    const cx = (wx - tx * tilePx) / cellPxSize;
    const cy = (wy - ty * tilePx) / cellPxSize;
    return { tx, ty, cx, cy };
  }

  // Fog of war — mark the ground under and around the player as explored.
  //
  // Called every frame before drawCells, and free on all but a handful of them:
  // Fog.reveal bails immediately unless the player has changed CELL, which is
  // once per 7 m walked. Only when something is genuinely newly revealed does
  // it touch the save (persistSave already coalesces writes at 500 ms) or move
  // Fog.revision, which is the renderer's dirty gate.
  //
  // Underground has no fog (see the fog pass in render.js), so don't record a
  // cave walk as surface exploration — the cave's cell indices are the SURFACE
  // ones, and revealing them would hand the player the map above them.
  _revealFog() {
    if (this.depth !== 0) return;
    const pc = this.playerToWorldCell();
    const ix = pc.tx * this.cellsPerTile + Math.floor(pc.cx);
    const iy = pc.ty * this.cellsPerTile + Math.floor(pc.cy);
    if (!Fog.reveal(ix, iy)) return;
    // Persist on a 10 s throttle, not per revealed cell. Continuous walking
    // reveals a new cell every second or two, and each persistSave lands a
    // full-save JSON.stringify + synchronous localStorage.setItem on the main
    // thread 500 ms later — a per-cell hitch that grew with save size (the
    // fog blobs themselves make the save bigger every tile explored). Fog's
    // in-memory masks are the truth between flushes; the visibilitychange
    // hidden-branch does an unconditional flush so backgrounding/closing the
    // tab never loses more than the walk since the last one, and any OTHER
    // persistSave caller in that window at worst stores fog that's 10 s stale.
    const nowT = performance.now();
    if (this._fogPersistT && nowT - this._fogPersistT < 10000) return;
    this._fogPersistT = nowT;
    Fog.flush(this.save);
    persistSave(this.save);
  }

  // Debug: dump what worldgen actually produced for the tile under the player,
  // in a copyable form (routed through the #errbar overlay). DevTools isn't
  // reachable on a phone, so this is how we see how a real-world feature (e.g.
  // a rec centre) is tagged in the OpenFreeMap vector data — which layer it
  // lands in, its class/subclass, whether it carries a name, and what terrain
  // the rasteriser painted under the player.
  dumpTileDebug() {
    try {
      // Optional name search: scan EVERY loaded tile for features whose name
      // contains a substring (case-insensitive) and report the exact layer +
      // class/subclass each came in as. This is how we locate a specific
      // real-world place (e.g. a rec centre) and see how the vector data tags
      // it — even when it sits in a neighbouring tile or under a class we'd
      // never guess. Blank input falls through to the current-tile dump.
      let filter = null;
      try { filter = window.prompt('Find feature by name (blank = dump current tile):', ''); } catch (_) {}
      if (filter && filter.trim()) {
        const q = filter.trim().toLowerCase();
        const hits = [];
        const cache = WorldGen.tileCache;
        if (cache) for (const [k, entry] of cache) {
          for (const l of (entry.layers || [])) for (const f of (l.features || [])) {
            const nm = f.tags && f.tags.name;
            if (nm && nm.toLowerCase().includes(q)) {
              hits.push(`${k} [${l.name}] t${f.type} class=${f.tags.class || '-'} sub=${f.tags.subclass || '-'}: ${nm}`);
            }
          }
          for (const o of (entry.objects || [])) {
            if (o.kind === 'chest' && o.name && o.name.toLowerCase().includes(q)) {
              hits.push(`${k} CHEST poiClass=${o.poiClass}: ${o.name}`);
            }
          }
        }
        const text = hits.length ? hits.join('\n') : `no loaded feature name contains "${q}"\n(walk the area first so its tiles load)`;
        try { console.log('[tiledebug search]\n' + text); } catch (_) {}
        if (window.showError) window.showError(`SEARCH "${q}" (${hits.length} hit${hits.length === 1 ? '' : 's'})`, text);
        return;
      }
      const { tx, ty, cx, cy } = this.playerToWorldCell();
      const key = WorldGen.tileKey(tx, ty);
      const entry = WorldGen.tileCache && WorldGen.tileCache.get(key);
      const T = WorldGen.T || {};
      const TNAME = {};
      for (const k in T) TNAME[T[k]] = k;
      const out = [];
      // LAYOUT first. There is no console on a phone, and the whole UI scale is
      // derived from the viewport (index.html fitGame / layOutVertically), so
      // "the UI looks zoomed out" is unanswerable without these numbers — iOS
      // Safari in particular changes innerHeight as its toolbar collapses,
      // which moves the scale with it.
      try {
        const g = document.getElementById('game');
        const m = g && getComputedStyle(g).transform.match(/matrix\(([-\d.]+)/);
        const vv = window.visualViewport;
        out.push(`layout: inner=${window.innerWidth}x${window.innerHeight}`
          + (vv ? ` visual=${Math.round(vv.width)}x${Math.round(vv.height)}` : '')
          + ` dpr=${window.devicePixelRatio} scale=${m ? (+m[1]).toFixed(4) : '?'}`
          + ` standalone=${!!(window.navigator.standalone
              || (window.matchMedia && matchMedia('(display-mode: standalone)').matches))}`);
      } catch (_) {}
      out.push(`tile ${key}  cell(${Math.floor(cx)},${Math.floor(cy)})  depth=${this.depth}`);
      // Location / GPS status — explains why the world might be pinned to the
      // Kelowna home origin instead of following the player's real GPS. Any of
      // these will keep GPS fixes from moving the player:
      //   teleport  — a preset override is active (GPS is force-disabled)
      //   manualOvr — WASD/arrows/teleport were used this session (GPS write skipped)
      //   gpsAvail=false / gpsM=none — no GPS fix has been applied
      let tp = null;
      try { tp = JSON.parse(localStorage.getItem('terracart.teleport') || 'null'); } catch (_) {}
      const gm = this.gpsM ? `(${Math.round(this.gpsM.x)},${Math.round(this.gpsM.y)})m` : 'none';
      const originSrc = _teleportOverride ? ('TELEPORT ' + (tp && tp.name || '?')) : (_saveHome ? 'saved-home' : 'default-home/GPS');
      out.push(`origin: ${START_LAT.toFixed(5)},${START_LON.toFixed(5)} (${originSrc})`);
      out.push(`gpsAvail=${this.gpsAvailable} gpsFix=${gm} manualOvr=${!!this._gpsManualOverride} denied=${!!this._gpsDenied} watching=${this.gpsWatchId != null} sandbox=${!!this._sandboxMode}`);
      out.push(`homePending=${!!this._homeCapturePending} homeArmed=${!!this._homeCaptureArmed} saveHome=${this.save && this.save.home ? this.save.home.lat.toFixed(4) + ',' + this.save.home.lon.toFixed(4) : 'none'}`);
      // Starter-trail forensics — which mode the trail pass took when it last
      // ran this session (recorded in _placeStarterTrail), plus a live census
      // of every starter chest actually in the cache and whether the save has
      // it opened. Together these answer "why are there no crates along my
      // road" from a phone, which nothing else on screen can.
      try {
        const sca = this.save && this.save.starterCratesAt;
        out.push('trail anchor: ' + (sca ? `(${Math.round(sca.x)},${Math.round(sca.y)})m` : 'NOT SET')
          + `  salt=${this.save && this.save.relicSalt != null ? this.save.relicSalt : 'none'}`);
        out.push('trail: ' + (this._trailDebug || '(pass has not run this session)'));
        const openedIds = new Set((this.save && this.save.opened) || []);
        const rows2 = [];
        if (WorldGen.tileCache) for (const [, e2] of WorldGen.tileCache) {
          for (const o of ((e2 && e2.objects) || [])) {
            if (o.kind !== 'chest' || !String(o.id).startsWith('chest_start')) continue;
            rows2.push(`${o.id}@(${Math.round(o.x)},${Math.round(o.y)})m`
              + (openedIds.has(o.id) ? ' OPENED' : ''));
          }
        }
        out.push('starter chests: ' + (rows2.join('; ') || 'NONE IN CACHE'));
      } catch (_) {}
      out.push(`playerM=(${Math.round(this.playerM.x)},${Math.round(this.playerM.y)})`);
      const tgt = this._targetM
        ? `(${Math.round(this._targetM.x)},${Math.round(this._targetM.y)}) d=${Math.round(Math.hypot(this._targetM.x - this.playerM.x, this._targetM.y - this.playerM.y))}m`
        : 'none';
      out.push(`walkTarget=${tgt} paused=${!!this._followPaused}`);
      // How far the stick has walked the player off their real (GPS) position.
      const off = this._manualOffsetM || { x: 0, y: 0 };
      out.push(`stickOffset=(${Math.round(off.x)},${Math.round(off.y)}) `
        + `${Math.round(Math.hypot(off.x, off.y))}m  `
        + `speed=${steerSpeedMul(this._walkRelics())}× `
        + `cost=${steerEnergyCost(this._walkRelics())}/cell`);
      if (!entry || !entry.grid) {
        out.push('(tile not loaded — stand on the spot, then dump)');
        if (window.showError) window.showError('TILE DEBUG', out.join('\n'));
        return;
      }
      const cpe = entry.cellsPerEdge;
      const icx = Math.max(0, Math.min(cpe - 1, Math.floor(cx)));
      const icy = Math.max(0, Math.min(cpe - 1, Math.floor(cy)));
      const under = entry.grid[icy * cpe + icx];
      out.push(`under player: ${TNAME[under] ?? '?'} (${under})`);
      // 7×7 terrain-code window centred on the player cell.
      const rows = [];
      for (let dy = -3; dy <= 3; dy++) {
        let r = '';
        for (let dx = -3; dx <= 3; dx++) {
          const xx = icx + dx, yy = icy + dy;
          r += (xx < 0 || yy < 0 || xx >= cpe || yy >= cpe)
            ? '..' : String(entry.grid[yy * cpe + xx]).padStart(2, '0');
          r += ' ';
        }
        rows.push(r.trimEnd());
      }
      out.push('grid 7x7 (codes):\n' + rows.join('\n'));
      if (WorldGen.overpassTileInfo) {
        try { out.push('overpass: ' + WorldGen.overpassTileInfo(tx, ty)); } catch (_) {}
      }
      const layers = entry.layers || [];
      out.push('layers: ' + layers.map(l => l.name).join(', '));
      // Per-layer class/subclass histogram for the polygon-ish + poi layers.
      const interesting = new Set(['landcover', 'landuse', 'park', 'building', 'poi', 'transportation']);
      for (const l of layers) {
        if (!interesting.has(l.name)) continue;
        const classes = new Map();
        for (const f of l.features) {
          const c = (f.tags && (f.tags.class || f.tags.subclass)) || '(none)';
          classes.set(c, (classes.get(c) || 0) + 1);
        }
        out.push(`[${l.name}] ` + [...classes.entries()].map(([c, n]) => `${c}:${n}`).join(' '));
      }
      // Every NAMED feature, minus street names + bus stops (pure noise) — this
      // is where a rec centre / civic building shows, with the layer + class it
      // came in as. No cap, so nothing hides past a truncation.
      const named = [];
      for (const l of layers) {
        if (l.name === 'transportation_name') continue;   // street names — noise
        for (const f of (l.features || [])) {
          const nm = f.tags && f.tags.name;
          if (!nm) continue;
          const cls = f.tags.class || f.tags.subclass || '?';
          if (cls === 'bus') continue;                    // dozens of bus stops — noise
          named.push(`${l.name}/${cls}: ${nm}`);
        }
      }
      if (named.length) out.push(`named (${named.length}, excl. streets/bus):\n` + named.join('\n'));
      const chests = (entry.objects || []).filter(o => o.kind === 'chest');
      if (chests.length) {
        out.push('chests: ' + chests.map(c => `${c.poiClass}${c.name ? ('=' + c.name) : ''}`).slice(0, 40).join(' | '));
      }
      const text = out.join('\n');
      try { console.log('[tiledebug]\n' + text); } catch (_) {}
      if (window.showError) window.showError('TILE DEBUG (copy me)', text);
    } catch (e) {
      if (window.showError) window.showError('tile debug failed', (e && e.stack) || String(e));
    }
  }

  async ensureTilesAround() {
    const cell = this.playerToWorldCell();
    const needed = new Set();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      needed.add(`${cell.tx + dx}/${cell.ty + dy}`);
    }
    // The tile the player is standing in — the only one they can see or reach
    // right now, and so the only one worth making them wait for.
    const centreKey = `${cell.tx}/${cell.ty}`;
    // Overpass is fired only for the centre tile (the one the player is in).
    // Neighbours get their Overpass fetch when the player walks into them and
    // they become the centre tile on the next ensureTilesAround call.
    // warmOverpass resolves true when the bin landed after the tile had
    // already rasterized without it (cold cache — e.g. right after a save
    // reset) and evicted the stale entry; re-run so the rebuilt tile (now
    // with its real-world trees) loads even if the player is standing still.
    const warmed = WorldGen.warmOverpass(cell.tx, cell.ty, START_LAT);
    if (warmed && typeof warmed.then === 'function') {
      warmed.then((evicted) => { if (evicted) this.ensureTilesAround().catch(() => {}); });
    }
    let anyFailed = false;
    // Fetch/decode/rasterize the whole 3×3 block CONCURRENTLY rather than one
    // tile at a time. This used to be a serial `for...of` with an `await`
    // inside — on a cold cache every neighbour is a real network round trip,
    // so 9 tiles paid 9× the latency back to back, which is where the ~5s
    // blank-map stretch after boot came from. Nothing here depends on load
    // order (each tile only reads/writes its own entry; the one cross-tile
    // read, dedup, already tolerates tiles racing each other — see
    // collectDedupIndex), so there's nothing to lose by firing them together.
    let doneCount = 0;
    const total = needed.size;
    const buildOne = async (k) => {
      const [tx, ty] = k.split('/').map(Number);
      try {
        const entry = await WorldGen.loadTile(tx, ty, START_LAT);
        if (entry.status === 'loading') await entry.promise;
        // Surface fauna on depth 0; hostile wandering monsters underground.
        if (this.depth === 0 && !entry.creatures) this.spawnInTile(entry, tx, ty);
        else if (this.depth > 0 && !entry.creatures) this.spawnCaveCreatures(entry, tx, ty, this.depth);
        // Re-open any walls the player has already mined on this level, and
        // guarantee an up-staircase by the starting house so you can always
        // climb back to the surface from home.
        if (this.depth > 0) {
          this._applyDugWalls(entry, tx, ty);
          this._ensureHomeUpStair(entry, tx, ty);
        }
      } catch (e) {
        anyFailed = true;
        console.warn('tile fetch failed', k, e.message);
      } finally {
        // Feeds the boot overlay's progress bar for the one stretch it used
        // to have no visibility into (index.html hands off to this call the
        // instant the world is on screen — see the create() call site). A
        // no-op once the overlay has vanished, so this is harmless to call
        // for every later ensureTilesAround too (walking into a new tile,
        // depth changes, …).
        doneCount++;
        window.__bootStatus?.(0.9 + 0.1 * (doneCount / total), 'Loading the map…');
      }
    };
    // Show the banner whenever tiles FAIL, not only when the browser admits
    // it's offline: a captive portal, a blocked or DNS-failed tile host, a
    // 5xx, a corporate proxy or a VPN all keep navigator.onLine true, and the
    // player was left with a featureless green field, no message and no retry.
    // Zero tiles ready means the world is empty — the objective ladder's
    // "crates were left along the road nearby" reads as a lie over it.
    const settle = () => {
      this.showBanner(anyFailed);
      this._tilesReady = [...WorldGen.tileCache.values()].filter(t => t.status === 'ready').length;
      this._scheduleTileRetry(anyFailed);
    };

    // THE CENTRE TILE FIRST, and hand control back the moment it is done.
    //
    // A tile build is one uninterruptible 300-800 ms chunk of rasterize on the
    // main thread. Awaiting all nine before returning meant the player waited
    // through nine of them — measured at ~5 s of frozen UI on the boot path,
    // with the overlay up and nothing responding — for eight tiles of ground
    // they cannot see. The viewport is 11 cells across and a tile is 222, so
    // the centre tile alone is already ~400× what is on screen; the ring is
    // walking headroom, minutes away at 1.4 m/s.
    //
    // So: await the centre, settle, return. The ring streams in behind, one
    // chunk per painted frame (worldgen's heavy-phase chain), and settles
    // again when it lands. One ring pass at a time — walking into a new tile
    // re-enters here, and stacking ring passes would put the pile-up back.
    await buildOne(centreKey);
    settle();
    const ring = [...needed].filter(k => k !== centreKey);
    if (!ring.length || this._ringBuild) return;
    this._ringBuild = (async () => {
      // One at a time, each waiting for an IDLE moment first. Fired together
      // they queue straight onto the heavy chain and spend the player's first
      // seconds of play the same way the boot did — a 300-800 ms stall, eight
      // times, while they are trying to walk. The ring is walking headroom a
      // tile wide (~1.5 km, minutes away at 1.4 m/s), so it can afford to wait
      // for gaps. requestIdleCallback picks the gaps; the timeout is the floor
      // that keeps it moving on a busy thread, and the rAF fallback covers
      // browsers without it.
      for (const k of ring) {
        await this._whenIdle();
        await buildOne(k);
      }
    })().catch(() => {}).then(() => { this._ringBuild = null; settle(); });
  }

  // Resolve on the next idle slice, or after RING_IDLE_TIMEOUT_MS at the
  // latest. A tile build overruns any idle deadline on its own (it is one
  // uninterruptible chunk), so this is about picking a better MOMENT, not
  // about fitting inside the budget.
  _whenIdle() {
    return new Promise((resolve) => {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => resolve(), { timeout: RING_IDLE_TIMEOUT_MS });
      } else if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => setTimeout(resolve, RING_IDLE_TIMEOUT_MS));
      } else {
        setTimeout(resolve, RING_IDLE_TIMEOUT_MS);
      }
    });
  }

  // Re-fetch a block that came back short, on a backoff, until it is whole.
  //
  // Nothing used to. The only automatic re-fetch in the game is the 20 m walk
  // check in update(), so a player standing still kept whatever the boot load
  // managed — and the boot load is the one that fires all nine tiles at once
  // into a cold cache. One bad moment there (a captive portal, a phone still
  // handing off from cell to wifi, the tile host shedding a burst) left a
  // brand-new player on a featureless green field: no houses, no POIs and —
  // because the trail is laid when the anchor tile rasterizes — no starter
  // crates either. Measured: the host recovered 25 s in and the game had still
  // fetched nothing two minutes later. A veteran never sees it; their tiles
  // are already in IndexedDB.
  //
  // Failures evict themselves in WorldGen, so a retry is a genuine re-fetch.
  // One timer at a time, reset the moment a pass comes back whole.
  _scheduleTileRetry(anyFailed) {
    if (window.__TEST_MODE) return;
    if (!anyFailed) {
      this._tileRetryMs = 0;
      if (this._tileRetryTimer) { clearTimeout(this._tileRetryTimer); this._tileRetryTimer = null; }
      return;
    }
    if (this._tileRetryTimer) return;
    this._tileRetryMs = this._tileRetryMs
      ? Math.min(TILE_RETRY_MAX_MS, this._tileRetryMs * 2)
      : TILE_RETRY_BASE_MS;
    this._tileRetryTimer = setTimeout(() => {
      this._tileRetryTimer = null;
      // Backgrounded: the game loop is paused and the radio is the player's to
      // spend, so wait rather than fetch. Coming back re-arms immediately
      // (see the visibilitychange handler), which is when it matters anyway.
      if (typeof document !== 'undefined' && document.hidden) {
        this._scheduleTileRetry(true);
        return;
      }
      this.ensureTilesAround().catch(() => {});
    }, this._tileRetryMs);
  }

  // === Spawns ===
  spawnInTile(entry, tx, ty) {
    const rng = WorldGen.makeRng(tx * 0x1f1f1f1f ^ ty * 0x12345);
    const creatures = [];
    const N = entry.cellsPerEdge;
    // Even pets only belong near street frontage / public space inside a
    // residential block, so creature placement shares the spawn rule too.
    // POI chests (already placed by worldgen) count as public anchors.
    const _spawnOpts = {
      // The tile's road footprint — wider than the road TERRAIN wherever the
      // real carriageway is (a motorway's band covers a cell either side of
      // the one it paints) and present at all in a parking lot, whose aisles
      // paint nothing. Without it the X-mark scatter below reads the grid,
      // is told "grass", and buries treasure in the middle of the asphalt.
      roadMask: entry.roadMask,
      pois: (entry.objects || [])
        .filter(o => o.kind === 'chest')
        .map(o => ({
          ix: Math.floor((o.x - tx * this.tileEdgeM) / this.cellM),
          iy: Math.floor((o.y - ty * this.tileEdgeM) / this.cellM),
        })),
    };
    // Home holds no slimes or crows until the first harvest (see
    // PEST_FREE_CELLS). Resolved once per tile build; null once the grace has
    // lapsed, which is the common case.
    const pestFree = this._pestFreeZone(tx, ty);
    const tryPlace = (kindWant, classesOK, idx, kindStr) => {
      for (let attempt = 0; attempt < 12; attempt++) {
        const cx = Math.floor(rng() * N);
        const cy = Math.floor(rng() * N);
        // `continue`, not `return`: the pest is re-rolled onto another cell
        // rather than dropped, so the amnesty moves slimes and crows out of
        // the starting area without thinning the tile's population.
        if ((kindStr === 'slime' || kindStr === 'crow') && pestFree && pestFree.has(cx, cy)) continue;
        const t = entry.grid[cy * N + cx];
        if (classesOK.has(t)) {
          // Residential cells are private yards — only spawn near a public anchor.
          if (t === 5 /* RESIDENTIAL */ && !WorldGen.isSpawnCell(entry.grid, N, N, cx, cy, _spawnOpts)) continue;
          const wmx = tx * this.tileEdgeM + (cx + 0.5) * this.cellM;
          const wmy = ty * this.tileEdgeM + (cy + 0.5) * this.cellM;
          const id = `${kindStr}_${tx}_${ty}_${idx}`;
          if (this.save.caught.includes(id)) return;
          // ~5% of wild animals spawn as the rare shiny variant — stamped at
          // spawn off the stable id so it survives reloads and rides along
          // through tame/release/re-catch. Slimes are energy pests with no
          // catch/hunt payoff, so they never go shiny (a shiny slime would
          // promise a reward it can't pay).
          const shiny = kindStr !== 'slime' && isShiny(id, SHINY_RATE.animal);
          creatures.push({ x: wmx, y: wmy, kind: kindStr, id, shiny });
          return;
        }
      }
    };
    // Biome-biased fauna spawn — each species' primary (dominant) biome set,
    // wider fallback set, count and primary-share come from the central registry
    // (BIOME_FAUNA in src/biome_profiles.js). ~`share` of a species' count goes
    // to its primary biomes, the rest to the fallback set, so animals read
    // correct (cows in fields, butterflies in parks, pets in the suburbs) while
    // still scattering everywhere — and extending the sets to the newly-wired
    // biomes is what finally puts fauna in wetland / commercial / industrial
    // zones. Iteration order (FAUNA_ORDER) and per-species id scheme are
    // unchanged so seeds reproduce. Slimes never go shiny (see tryPlace).
    for (const sp of FAUNA_ORDER) {
      const cfg = BIOME_FAUNA[sp];
      if (!cfg) continue;
      const n = cfg.base + (cfg.range ? Math.floor(rng() * cfg.range) : 0);
      const primary  = new Set(cfg.primary);
      const fallback = new Set(cfg.fallback || cfg.primary);
      const primN = Math.round(n * (cfg.share ?? 0.8));
      for (let i = 0; i < primN; i++) tryPlace(sp, primary,  i, sp);
      for (let i = primN; i < n; i++) tryPlace(sp, fallback, i, sp);
    }
    // (Starter-cow at spawn removed — cows are valuable enough that none should be gifted.)
    // Merge in any creatures the player has released back into the world for this tile.
    // save.released is a flat array of {x,y,kind,id,tx,ty} — filter by tile + caught state.
    if (this.save.released) {
      for (const r of this.save.released) {
        if (r.tx !== tx || r.ty !== ty) continue;
        if (this.save.caught.includes(r.id)) continue;
        creatures.push({ x: r.x, y: r.y, kind: r.kind, id: r.id, shiny: !!r.shiny });
      }
    }
    entry.creatures = creatures;

    // Starter loot now lives entirely in the road-side starter chests placed
    // below (entry.objects, kind:'chest' with fixedLoot). No loose groundstack
    // logs / rockfruit piles near spawn — the tutorial pocket stays clean.
    entry.objects = entry.objects || [];

    // Wild debris is generated per-polygon in worldgen and lives on entry.wildplants
    // (set by rasterizeTile). Picked-state filtering happens at render/interact time
    // via this.save.picked.
    entry.wildplants = entry.wildplants || [];

    // Treasure marks. Three streams:
    //  1) entry.treasure       — single legacy slot. Starter tile (guaranteed)
    //                            + low-density random across all tiles.
    //  2) entry.parkingTreasures — one per OSM parking-lot POI (worldgen).
    //  3) entry.extraTreasures   — per-tile random scatter (new). Every tile
    //                            rolls for 4–10 X marks dropped on random
    //                            walkable cells, so X's feel like a regular
    //                            ambient reward instead of a once-a-walk find.
    // All three render + interact through the same code path.
    entry.treasure = null;
    entry.extraTreasures = [];
    // Spawnability for all three treasure streams below is decided by
    // WorldGen.isSpawnCell (the single shared rule): walkable, off-road, and —
    // on RESIDENTIAL cells — only near a public anchor (road/path, public area,
    // or POI). The `_spawnOpts` POI-anchor list was already built at the top of
    // this method for creature placement; reuse it here.
    // Guaranteed starter trail: when this tile holds the starter-trail
    // anchor, place the starter crates along the nearest road. The anchor is
    // the player's HOME (frozen in save.starterCratesAt — see
    // _starterTrailAnchor), NOT raw startWorldM: a save whose home capture
    // failed keeps the default projection origin while the player actually
    // plays somewhere else entirely, and the old origin-keyed check then put
    // the crates on a tile that never loads. When the anchor can't resolve
    // yet (fresh save still waiting on its first GPS fix), no tile places
    // the trail now — it retro-places the moment the anchor freezes (home
    // capture reloads the page; Home adoption calls _setStarterCratesAt).
    const tx0 = tx * this.tileEdgeM, ty0 = ty * this.tileEdgeM;
    const _trailAnchor = this._starterTrailAnchor();
    const isStarterTile = !!_trailAnchor &&
      _trailAnchor.x >= tx0 && _trailAnchor.x < tx0 + this.tileEdgeM &&
      _trailAnchor.y >= ty0 && _trailAnchor.y < ty0 + this.tileEdgeM;
    if (isStarterTile) {
      this._placeStarterTrail(entry, tx, ty);
    } else {
      // Any tile arriving can complete a starter-home plan that was deferred
      // (or left short) because the map around spawn was still streaming —
      // this is what lets the arc across a tile seam get filled in at all.
      // Cheap no-op once the plan is done.
      this._provisionStarterHome(entry, tx, ty);
    }
    if (!isStarterTile && rng() < 1 / 2) {
      // 1/200 → 1/4 → 1/2. Combined with the scatter below, players see X's
      // frequently instead of stumbling onto one a session. This stream caps
      // at ONE mark per tile however it rolls, so the probability IS its yield.
      for (let attempt = 0; attempt < 16; attempt++) {
        const cx = Math.floor(rng() * N);
        const cy = Math.floor(rng() * N);
        // Walkable, off-road, and not deep in a private yard — one shared rule.
        if (!WorldGen.isSpawnCell(entry.grid, N, N, cx, cy, _spawnOpts)) continue;
        const wmx = tx * this.tileEdgeM + (cx + 0.5) * this.cellM;
        const wmy = ty * this.tileEdgeM + (cy + 0.5) * this.cellM;
        entry.treasure = { x: wmx, y: wmy, id: `treasure_${tx}_${ty}` };
        break;
      }
    }
    // Extra scatter: 4–10 X's per tile on random walkable cells (doubled from
    // 2–5). Each gets a stable id derived from its cell so save.foundTreasures
    // persists across reloads. Failed placement attempts (water/building cells)
    // just drop that slot — small scatter variance is fine.
    // Skip the extra-X scatter in test mode — the unified treasure handler
    // runs BEFORE wildplant/creature/till/plant/water dispatches, and tests
    // that tap arbitrary cells would have the tap stolen by a random X.
    const EXTRA_X_COUNT = window.__TEST_MODE ? 0 : (4 + Math.floor(rng() * 7));
    for (let k = 0; k < EXTRA_X_COUNT; k++) {
      let placed = false;
      for (let attempt = 0; attempt < 8 && !placed; attempt++) {
        const cx = Math.floor(rng() * N);
        const cy = Math.floor(rng() * N);
        if (!WorldGen.isSpawnCell(entry.grid, N, N, cx, cy, _spawnOpts)) continue;
        const wmx = tx * this.tileEdgeM + (cx + 0.5) * this.cellM;
        const wmy = ty * this.tileEdgeM + (cy + 0.5) * this.cellM;
        entry.extraTreasures.push({ x: wmx, y: wmy, id: `treasure_x_${tx}_${ty}_${cx}_${cy}` });
        placed = true;
      }
    }

    // Bonus X marks alongside pedestrian paths (terrain 8). Walkers drop
    // things — the fiction is that the X marks small finds (a coin, an
    // earring) just off the trail. We sample up to PATH_BONUS_COUNT
    // path cells at random and place an X on a tillable neighbour cell
    // (4-connected) so the X visually sits adjacent to the path, not on
    // it. Skipped when the tile has no path cells.
    const pathCells = [];
    for (let cy = 0; cy < N; cy++) {
      for (let cx = 0; cx < N; cx++) {
        if (entry.grid[cy * N + cx] === 8 /* PATH */) pathCells.push(cx * 256 + cy);
      }
    }
    if (pathCells.length > 0) {
      // 4-8 bonus X marks per tile that has any path (doubled from 2-4).
      // Capped by path density so a tile with one stub doesn't get spammed —
      // the cap doubles with the count (one per 2 path cells, was one per 4),
      // otherwise a thin-path tile clamps at the old number and the extra
      // marks never appear.
      const PATH_BONUS_COUNT = Math.min(
        4 + Math.floor(rng() * 5),
        Math.max(1, Math.floor(pathCells.length / 2))
      );
      const NEIGHBOURS = [[1,0],[-1,0],[0,1],[0,-1]];
      for (let k = 0; k < PATH_BONUS_COUNT; k++) {
        let placed = false;
        for (let attempt = 0; attempt < 8 && !placed; attempt++) {
          const cell = pathCells[Math.floor(rng() * pathCells.length)];
          const pcx = Math.floor(cell / 256), pcy = cell % 256;
          // Shuffle the neighbour list per attempt so a packed path
          // doesn't always seat the X on the same side.
          const [ndx, ndy] = NEIGHBOURS[Math.floor(rng() * 4)];
          const ncx = pcx + ndx, ncy = pcy + ndy;
          if (ncx < 0 || ncy < 0 || ncx >= N || ncy >= N) continue;
          // Want the X visually OFF the trail: not on the path cell itself,
          // and otherwise a legitimate spawn cell (walkable, off-road, out of
          // private yards). Avoid stacking on an existing X below.
          if (entry.grid[ncy * N + ncx] === 8 /* PATH */) continue;
          if (!WorldGen.isSpawnCell(entry.grid, N, N, ncx, ncy, _spawnOpts)) continue;
          const wmx = tx * this.tileEdgeM + (ncx + 0.5) * this.cellM;
          const wmy = ty * this.tileEdgeM + (ncy + 0.5) * this.cellM;
          const id = `treasure_path_${tx}_${ty}_${ncx}_${ncy}`;
          if (entry.extraTreasures.some(t => t.id === id)) continue;
          entry.extraTreasures.push({ x: wmx, y: wmy, id });
          placed = true;
        }
      }
    }

    // Player-planted fruit-tree saplings (save.fruittrees) → growing
    // `fruittree` objects on the tile that owns each one. Injected AFTER the
    // spawn-area strip above so a sapling planted near home survives. The
    // fruittree render spec advances the sprite through its growth frames from
    // planted_t; the harvest handler gates picking until it matures.
    if (this.save.fruittrees && this.save.fruittrees.length) {
      const t0x = tx * this.tileEdgeM, t0y = ty * this.tileEdgeM;
      for (const ft of this.save.fruittrees) {
        if (ft.x < t0x || ft.x >= t0x + this.tileEdgeM ||
            ft.y < t0y || ft.y >= t0y + this.tileEdgeM) continue;
        if ((entry.objects || []).some(o => o.id === ft.id)) continue;
        entry.objects = entry.objects || [];
        entry.objects.push({
          kind: 'fruittree', x: ft.x, y: ft.y,
          species: ft.species === 'peach' ? 'peach' : 'apple',
          id: ft.id, planted: true, planted_t: ft.planted_t,
        });
      }
    }
  }

  // Resolve — and freeze — the world-metre anchor of the starter crate
  // trail (save.starterCratesAt).
  //
  // Healthy saves anchor at the projection origin: either the captured home
  // (save.home — the player's first GPS fix) or, for sessions that will play
  // out at the default origin anyway (no geolocation at all), the default
  // home. But a save whose home capture failed — the old 20 s GPS timeout,
  // a denied prompt, a failed write — keeps the DEFAULT origin while the
  // player actually plays somewhere else entirely; keying the crates off
  // startWorldM then dropped them on a tile that never even loads ("my
  // starting crates are not showing up"), even though Home itself anchors
  // on the player's real position. For those saves the anchor resolves
  // later, off the same Home adoption point (_setStarterCratesAt calls in
  // ensureStarterShopId / startGps), and retro-places onto the loaded tile.
  _starterTrailAnchor() {
    const sv = this.save;
    if (sv.starterCratesAt && Number.isFinite(sv.starterCratesAt.x)) return sv.starterCratesAt;
    if (this._sandboxMode) return null;     // sandbox curates its own loot
    // Origin is trustworthy: a captured home, or a save that hasn't anchored
    // anything anywhere else and isn't waiting on a capture reload.
    if (_saveHome || (!this._homeCapturePending && !sv.starterShopId)) {
      sv.starterCratesAt = { x: this.startWorldM.x, y: this.startWorldM.y };
      if (typeof persistSave === 'function') persistSave(sv);
      return sv.starterCratesAt;
    }
    return null;  // unresolved — frozen on home-capture reload or Home adoption
  }

  // The pest (slime + crow) amnesty around home, in cells of the tile being
  // built — or null when it has lapsed (or there is no anchor to measure from
  // yet). See PEST_FREE_CELLS. The centre is returned in TILE-LOCAL cells and
  // is free to be negative or past the tile's edge: a tile a few hundred
  // metres away simply never has a cell inside the box, which is what makes
  // the amnesty work across tile seams without a special case.
  //
  // It ends at the FIRST HARVEST, not on a clock: bringing in a crop is the
  // ladder's proof the player has the loop (and the produce to fight with),
  // where a timer just measured how long the tab sat closed. A veteran's save
  // can never fall into the grace — SaveMigrate.stampHarvested marks any save
  // that predates the flag and has been played as already harvested.
  _pestFreeZone(tx, ty) {
    const sv = this.save;
    if (!sv || sv.hasHarvested) return null;   // first crop is in: the map is itself again
    // The frozen trail anchor is where the player actually started; startWorldM
    // is the projection origin, which is the same thing until a save's home
    // capture puts them somewhere else (see _starterTrailAnchor).
    const a = (sv.starterCratesAt && Number.isFinite(sv.starterCratesAt.x))
      ? sv.starterCratesAt : this.startWorldM;
    if (!a || !Number.isFinite(a.x)) return null;
    const cx = Math.floor((a.x - tx * this.tileEdgeM) / this.cellM);
    const cy = Math.floor((a.y - ty * this.tileEdgeM) / this.cellM);
    // `has` travels with the zone so the spawner and the tests ask the same
    // question of the same object — the containment rule can't be restated
    // (and mis-stated) at the call site.
    return {
      cx, cy, r: PEST_FREE_CELLS,
      has: (ix, iy) => Math.max(Math.abs(ix - cx), Math.abs(iy - cy)) <= PEST_FREE_CELLS,
    };
  }

  // Freeze the starter-trail anchor (idempotent — a save keeps its first
  // anchor forever) and retro-place the trail when the anchor's tile has
  // already spawned; tiles loading later place it in spawnInTile.
  _setStarterCratesAt(x, y) {
    const sv = this.save;
    if (this._sandboxMode) return;
    if (sv.starterCratesAt && Number.isFinite(sv.starterCratesAt.x)) return;
    sv.starterCratesAt = { x, y };
    if (typeof persistSave === 'function') persistSave(sv);
    if ((this.depth || 0) !== 0) return;     // tileCache is repointed underground
    const tx = Math.floor(x / this.tileEdgeM), ty = Math.floor(y / this.tileEdgeM);
    const e = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
    if (e && (!e.status || e.status === 'ready') && e.grid) this._placeStarterTrail(e, tx, ty);
  }

  // Starter crate trail + tutorial-pocket clearing around the frozen anchor
  // (save.starterCratesAt). Four starter chests, one stack of 9 each, in the
  // order the ladder wants them (see STARTER_LOOT): potato seeds then rockfruit
  // seeds (the player's first crops — the inventory starts empty), then
  // rockfruit (the "Rock" stone — restoring themed shops) and wood (restoring
  // plain houses + unsealing forts). Per-chest counts stay within the
  // no-bag stack cap (9) so nothing overflows. These are real kind:'chest'
  // objects carrying a `fixedLoot` payload, so they open through the
  // standard chest path (the ceremony modal + one-time save.opened) instead
  // of the rarity picker. (No free scarecrow — it's sold at the forced
  // scarecrow shop, the next house out past the starter blacksmith.)
  //
  // The crates are a TRAIL, and where they lie depends on the ground:
  //
  //   1. A road or path passing VERY NEAR the anchor (within NEAR_ROAD_CELLS)
  //      wins. The whole trail moves onto the kerb: the crates seat down the
  //      road's shoulder walking outward — the chip says "supply crates were
  //      left along the road nearby", and when there is a road nearby the
  //      trail keeps its word — and the relic chest seats on the shoulder at
  //      the END of that line, about a screen out, so the line of crates
  //      still leads somewhere. The gold arrow walks the player crate to
  //      crate and hands them the chest last either way.
  //   2. Otherwise they are laid along the walked route from the anchor to
  //      that chest, evenly spaced, so each is in view from the one before
  //      and the last puts the chest in view.
  //   3. A road too far away to prefer still catches the crates when no chest
  //      could be seated at all (the kerb walk below); a tight ring round the
  //      anchor is the last resort.
  //
  // Runs from spawnInTile when the tile holding the anchor rasterizes, and
  // from _setStarterCratesAt when the anchor resolves after the tile already
  // spawned.
  _placeStarterTrail(entry, tx, ty) {
    const anchor = this.save.starterCratesAt || this._starterTrailAnchor();
    if (!anchor || entry._starterTrail) return;
    entry._starterTrail = true;             // once per build (rebuilds re-run)
    entry.objects = entry.objects || [];
    const N = entry.cellsPerEdge;
    const tx0 = tx * this.tileEdgeM, ty0 = ty * this.tileEdgeM;
    const ROAD_TYPES = new Set([7 /* ROAD */, 13 /* ROAD_LG */, 14 /* ROAD_MD */, 8 /* PATH */]);
    const BLOCKED_FOR_X = new Set([3 /* WATER */, 9 /* BUILDING */, 11 /* BUILDING_MED */, 12 /* BUILDING_LARGE */]);
    // A crate is seated on the shoulder of the road it's found beside, so
    // "which cells are the road" has to mean the ground the player SEES as
    // road, not just the one cell per way the rasterizer paints. See
    // entry.roadMask (worldgen). Undefined on tiles built before the mask
    // existed (or underground) — then the terrain test stands alone.
    const onRoadBand = (cx, cy) =>
      !!entry.roadMask && entry.roadMask[cy * N + cx] === 1;
    const spawnIX = Math.floor((anchor.x - tx0) / this.cellM);
    const spawnIY = Math.floor((anchor.y - ty0) / this.cellM);
    // Forensics for the ☰ Dump-tile readout (dumpTileDebug): which mode this
    // pass took and why, one compact line recorded as it runs. The trail has
    // three fallbacks, so "the crates aren't where the objective said" is
    // unanswerable from a phone without this — costs nothing the pass wasn't
    // already computing.
    const dbg = [`anchor(${spawnIX},${spawnIY}) tile ${tx}/${ty}`];
    // Clear the immediate anchor area of natural mineralrocks and procedural
    // forest fill so the starter crates aren't visually competing with debris
    // the player can't open. Chebyshev radius, in cells, around the anchor.
    // EXCEPTION: real-world detected trees (the player's actual yard / street
    // trees — flagged `individual` or carrying a DeepForest crown_color/size)
    // are kept, so the home reads like the real neighbourhood instead of a
    // bald pocket. Only procedural debris (rocks, groundstacks) and anonymous
    // forest-grove trees get cleared near the anchor.
    //
    // ONE number with HomeArea.POCKET_CELLS, read from it rather than restated
    // here: the pocket this pass CLEARS and the pocket the starter-home audit
    // calls clean have to be the same ring. When they drifted (this was a flat
    // 10 while the ring started at 11), the cleared ground reached two screens
    // out — a whole screen further than the player can see — so the ring of
    // trees seated just past it was never once in frame. See home.js.
    const CLEAR_R = (typeof HomeArea !== 'undefined' ? HomeArea.POCKET_CELLS : 5);
    const STRIP_KINDS = new Set(['mineralrock', 'tree', 'fruittree', 'groundstack']);
    const _isRealTree = (o) =>
      (o.kind === 'tree' || o.kind === 'fruittree') &&
      (o.individual || o.crown_color || o.size);
    const _nearSpawn = (wx, wy) => {
      const oIx = Math.floor((wx - tx0) / this.cellM);
      const oIy = Math.floor((wy - ty0) / this.cellM);
      return Math.max(Math.abs(oIx - spawnIX), Math.abs(oIy - spawnIY)) <= CLEAR_R;
    };
    entry.objects = entry.objects.filter(o =>
      _isRealTree(o) || !STRIP_KINDS.has(o.kind) || !_nearSpawn(o.x, o.y));
    // Wild rockfruit / debris (entry.wildplants) is its own stream — clear
    // any within the tutorial pocket too so spawn is free of pickable scrub.
    if (Array.isArray(entry.wildplants)) {
      entry.wildplants = entry.wildplants.filter(w => !_nearSpawn(w.x, w.y));
    }
    // Cells with something standing on them — a crate seated on top of a tree
    // reads as a bug whichever one the renderer draws second.
    const occupied = new Set();
    const cellKeyAt = (wx, wy) =>
      Math.floor((wx - tx0) / this.cellM) + ',' + Math.floor((wy - ty0) / this.cellM);
    for (const o of entry.objects) occupied.add(cellKeyAt(o.x, o.y));
    for (const w of (entry.wildplants || [])) occupied.add(cellKeyAt(w.x, w.y));
    // BFS from the anchor cell for the nearest road cell within 15 cells.
    let roadCell = null;
    const visited = new Set();
    const queue = [[spawnIX, spawnIY]];
    visited.add(spawnIX + ',' + spawnIY);
    while (queue.length > 0 && !roadCell) {
      const [cx, cy] = queue.shift();
      if (cx < 0 || cx >= N || cy < 0 || cy >= N) continue;
      const dist = Math.max(Math.abs(cx - spawnIX), Math.abs(cy - spawnIY));
      if (dist > 15) continue;
      const t = entry.grid[cy * N + cx];
      if (ROAD_TYPES.has(t)) { roadCell = { cx, cy }; break; }
      for (const [ddx, ddy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const k = (cx + ddx) + ',' + (cy + ddy);
        if (!visited.has(k)) { visited.add(k); queue.push([cx + ddx, cy + ddy]); }
      }
    }
    dbg.push(roadCell
      ? `road@(${roadCell.cx},${roadCell.cy}) d=${Math.max(Math.abs(roadCell.cx - spawnIX), Math.abs(roadCell.cy - spawnIY))} t=${entry.grid[roadCell.cy * N + roadCell.cx]}`
      : 'no road/path within 15');
    // Loot in the order the crates are seated — nearest the door first — which
    // is deliberately the LADDER's order of need, not the tidiest reading of
    // the list. STARTER_CHAIN goes open a crate → till → SOW A SEED → rebuild a
    // wreck, so the first crate has to be the one holding a seed: it used to
    // hold the wood, and a player who did exactly what the chip told them
    // reached "select a seed from your bag" with an empty bag while the seeds
    // sat at the far end of the trail. Wood (5 per plain house, and what
    // unseals a fort) rides at the far end instead, arriving about when step 4
    // asks for it — and the green arrow, which always points at the nearest
    // unopened crate, now agrees with the chip instead of contradicting it.
    const STARTER_LOOT = [
      { id: 'potato_seed',    qty: 9 },
      { id: 'rockfruit_seed', qty: 9 },
      { id: 'rockfruit',      qty: 9 },
      { id: 'wood',           qty: 9 },
    ];
    const COUNT = STARTER_LOOT.length;
    const usedSeats = new Set();          // 'cx,cy' of cells already holding a chest
    const placedIdx = new Set();          // loot indices successfully seated
    const MIN_GAP = 3;                    // Chebyshev spacing between consecutive chests
    // The Home trailer covers its own cell and spills into all eight
    // neighbours, and clearHomeTrailerOverlap() deletes whatever sits in them.
    // A crate seated there would be swept away with its starter loot, so the
    // trail skips the moat rather than losing a chest to it. (The ring
    // fallback below already starts 2 cells out.)
    const inTrailerMoat = (cx, cy) =>
      Math.max(Math.abs(cx - spawnIX), Math.abs(cy - spawnIY)) <= 1;
    const seatCrate = (cx, cy, i) => {
      // Snap to the canonical global-cell centre. The tile-relative basis
      // (tx*tileEdgeM + (cx+0.5)*cellM) drifts off the absolute cell grid
      // because tileEdgeM is not an exact multiple of cellM, leaving the
      // chest ~0.8 m off the centre cellAt() resolves it to. Round-tripping
      // through worldMetersToAbsCell → absCellCenterMeters (the same basis
      // POI chests and every cell tap use) keeps the chest exactly on-grid.
      const rawX = tx * this.tileEdgeM + (cx + 0.5) * this.cellM;
      const rawY = ty * this.tileEdgeM + (cy + 0.5) * this.cellM;
      const { cellIX, cellIY } = worldMetersToAbsCell(this, rawX, rawY);
      const { x: wmx, y: wmy } = absCellCenterMeters(this, cellIX, cellIY);
      // A real chest with hardcoded contents — opens via the standard chest
      // handler (interact.js), which reads o.fixedLoot and shows the same
      // reward modal as POI chests. `crate: true` renders the humble lowtier
      // crate (box) sprite instead of the tier-2 treasure chest, matching
      // their role as starter supplies. No poiClass → no POI label.
      entry.objects.push({
        kind: 'chest', x: wmx, y: wmy,
        fixedLoot: STARTER_LOOT[i],
        crate: true,
        id: `chest_start_${tx}_${ty}_${i + 1}`,
      });
      usedSeats.add(cx + ',' + cy);
      placedIdx.add(i);
    };
    // ── The trail proper: breadcrumbs that lead somewhere ──────────────────
    // The relic chest goes down first, because it is the DESTINATION. It sits
    // one screen out (see _placeStarterRelicChest), which is precisely far
    // enough to be off the opening screen — so a player who is only told "look
    // around" never learns it is there. The crates are then laid along the
    // walk to it, evenly spaced: walk to the crate you can see, and from there
    // the next one is in view, and the last one puts the chest in view. That
    // is the whole onboarding read — a trail with something at the end of it,
    // rather than four boxes scattered down whichever street happened to be
    // nearest. On a kerb spawn (mode 1) the walk IS the road: the crates seat
    // down its shoulder and the chest ends the line, on the kerb like them.
    //
    // How much of the walk the crates occupy. They sit in the NEAR part of
    // it rather than spread the whole way: a new player should meet all four
    // early, while they are still learning what a crate even is, and then
    // have a clear stretch of walking left to the chest at the end. Spread
    // evenly over the whole route the last crate landed a step or two short
    // of the chest, which made the supplies feel like something to hike for.
    const TRAIL_SPAN = 0.55;
    const TRAIL_GAP = 1;            // Chebyshev spacing between crates on the route
    // Where a crate (or the kerb chest) may stand — the street, the trailer
    // moat and occupied cells are all out, and dropping one over them would
    // break the chain the player is following.
    const seatOK = (cx, cy) => {
      if (cx < 0 || cx >= N || cy < 0 || cy >= N) return false;
      const t = entry.grid[cy * N + cx];
      if (ROAD_TYPES.has(t) || BLOCKED_FOR_X.has(t)) return false;
      if (onRoadBand(cx, cy)) return false;
      if (usedSeats.has(cx + ',' + cy) || occupied.has(cx + ',' + cy)) return false;
      return !inTrailerMoat(cx, cy);
    };
    // A road or path within NEAR_ROAD_CELLS of the anchor takes the trail
    // (mode 1 above). roadCell came back nearest-first from the BFS, so its
    // distance IS the road's distance.
    const roadNear = !!roadCell &&
      Math.max(Math.abs(roadCell.cx - spawnIX), Math.abs(roadCell.cy - spawnIY)) <= NEAR_ROAD_CELLS;
    // The kerb line: walk the road outward from the cell nearest the door
    // until it is about a screen from the anchor, and note the shoulder there
    // — that is where the chest goes, so the line of crates ends at it. BFS
    // over connected road cells, so a bending or branching street is followed
    // by its shape; the first cell reached a screen out picks the direction
    // the road actually goes somewhere. A road that ends short still ends the
    // line with the chest, as long as it at least clears the tidy pocket —
    // shorter than that and there is no line worth ending (kerbPath stays
    // null and the route spread below takes over).
    let kerbPath = null, chestWant = null;
    if (roadNear) {
      const shoulderFor = (cx, cy) => {
        for (const [adx, ady] of [[0, -1], [0, 1], [1, 0], [-1, 0]]) {
          if (seatOK(cx + adx, cy + ady)) return { cx: cx + adx, cy: cy + ady };
        }
        return null;
      };
      const from = new Map([[roadCell.cx + ',' + roadCell.cy, null]]);
      const rq = [[roadCell.cx, roadCell.cy]];
      let target = null, far = null, farSh = null, farD = -1;
      for (let head = 0; head < rq.length && head < 600 && !target; head++) {
        const [cx, cy] = rq[head];
        const d = Math.max(Math.abs(cx - spawnIX), Math.abs(cy - spawnIY));
        const sh = shoulderFor(cx, cy);
        if (sh && d > farD) { farD = d; far = [cx, cy]; farSh = sh; }
        if (sh && d >= VIEW_CELLS) { target = [cx, cy]; chestWant = sh; break; }
        for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + ddx, ny = cy + ddy;
          if (nx < 0 || nx >= N || ny < 0 || ny >= N) continue;
          const k = nx + ',' + ny;
          if (from.has(k)) continue;
          if (!ROAD_TYPES.has(entry.grid[ny * N + nx])) continue;
          from.set(k, [cx, cy]);
          rq.push([nx, ny]);
        }
      }
      if (!target && far &&
          farD >= (typeof HomeArea !== 'undefined' ? HomeArea.POCKET_CELLS : 10)) {
        target = far; chestWant = farSh;
      }
      if (target) {
        kerbPath = [];
        for (let at = target; at; at = from.get(at[0] + ',' + at[1])) {
          kerbPath.push({ cx: at[0], cy: at[1] });
        }
        kerbPath.reverse();          // nearest the door first, the chest end last
      }
    }
    dbg.push(`roadNear=${roadNear} kerb=${kerbPath ? kerbPath.length : 0}`
      + ` chestWant=${chestWant ? chestWant.cx + ',' + chestWant.cy : 'none'}`);
    const trail = this._placeStarterRelicChest(entry, tx, ty, spawnIX, spawnIY, usedSeats, chestWant);
    const trailPath = trail && trail.path;
    dbg.push(trail ? `chest ok route=${trailPath ? trailPath.length : 0}` : 'CHEST NOT SEATED');
    if (kerbPath && kerbPath.length > 1) {
      // Mode 1: crates down the kerb. Same packing as the route spread — the
      // near TRAIL_SPAN of the walk, distance measured ALONG the road — but
      // every seat is a shoulder cell: beside the street, never in it.
      const L = kerbPath.length - 1;
      let lastSeat = null;
      for (let i = 0; i < COUNT; i++) {
        const want = Math.round((TRAIL_SPAN * L * (i + 1)) / COUNT);
        let seat = null;
        for (let off = 0; off <= 3 && !seat; off++) {
          for (const at of (off === 0 ? [want] : [want - off, want + off])) {
            const p = kerbPath[at];
            if (!p) continue;
            for (const [adx, ady] of [[0, -1], [0, 1], [1, 0], [-1, 0]]) {
              const cx = p.cx + adx, cy = p.cy + ady;
              if (!seatOK(cx, cy)) continue;
              if (lastSeat && Math.max(Math.abs(cx - lastSeat.cx),
                                       Math.abs(cy - lastSeat.cy)) < TRAIL_GAP) continue;
              seat = { cx, cy }; break;
            }
            if (seat) break;
          }
        }
        if (!seat) continue;
        seatCrate(seat.cx, seat.cy, i);
        lastSeat = seat;
      }
    } else if (trailPath && trailPath.length > COUNT) {
      const L = trailPath.length - 1;         // steps from the anchor to the chest
      let lastSeat = null;
      for (let i = 0; i < COUNT; i++) {
        // Evenly spaced across the near TRAIL_SPAN of the walk — so on a
        // typical route the four sit at roughly 2, 3, 5 and 6 cells out with
        // the chest at 11, and no leg is long enough to lose the thread.
        // Distance is measured ALONG the route, not across it: a route that
        // bends round a pond still spaces its crates by how far the player
        // actually walks. A crate takes the route cell itself where it
        // legally can, and steps one cell off it where it can't.
        const want = Math.round((TRAIL_SPAN * L * (i + 1)) / COUNT);
        let seat = null;
        for (let off = 0; off <= 3 && !seat; off++) {
          for (const at of (off === 0 ? [want] : [want - off, want + off])) {
            const p = trailPath[at];
            if (!p) continue;
            for (const [adx, ady] of [[0, 0], [0, -1], [0, 1], [1, 0], [-1, 0]]) {
              const cx = p.cx + adx, cy = p.cy + ady;
              if (!seatOK(cx, cy)) continue;
              if (lastSeat && Math.max(Math.abs(cx - lastSeat.cx),
                                       Math.abs(cy - lastSeat.cy)) < TRAIL_GAP) continue;
              seat = { cx, cy }; break;
            }
            if (seat) break;
          }
        }
        if (!seat) continue;
        seatCrate(seat.cx, seat.cy, i);
        lastSeat = seat;
      }
    }
    // Undirected kerb walk — the last road-shaped resort: neither the kerb
    // line nor the route spread seated anything (no chest could go down, or
    // every shoulder along the line was blocked), so seat the crates on the
    // shoulders of the nearest road nearest-first, which at least reads as
    // breadcrumbs even though it leads nowhere in particular. Only when
    // NOTHING was seated above — a half-laid trail is topped up by the ring
    // below instead, which never double-seats a loot index.
    if (roadCell && placedIdx.size === 0) {
      // BFS-collect connected road cells from the nearest road cell, in
      // nearest-first order, then seat crates on walkable, non-road
      // neighbours spaced at least MIN_GAP apart. Following the road's
      // shape (rather than a fixed straight line) means crates keep
      // getting placed even when the street curves or branches.
      const roadCells = [];
      const rVisited = new Set();
      const rQueue = [[roadCell.cx, roadCell.cy]];
      rVisited.add(roadCell.cx + ',' + roadCell.cy);
      while (rQueue.length > 0 && roadCells.length < 120) {
        const [cx, cy] = rQueue.shift();
        if (cx < 0 || cx >= N || cy < 0 || cy >= N) continue;
        if (!ROAD_TYPES.has(entry.grid[cy * N + cx])) continue;
        roadCells.push([cx, cy]);
        for (const [ddx, ddy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const k = (cx + ddx) + ',' + (cy + ddy);
          if (!rVisited.has(k)) { rVisited.add(k); rQueue.push([cx + ddx, cy + ddy]); }
        }
      }
      let nextIdx = 0;
      let lastSeat = null;
      for (const [rcx, rcy] of roadCells) {
        if (nextIdx >= COUNT) break;
        let seat = null;
        for (const [adx, ady] of [[0,-1],[0,1],[1,0],[-1,0]]) {
          const nx = rcx + adx, ny = rcy + ady;
          if (nx < 0 || nx >= N || ny < 0 || ny >= N) continue;
          const tt = entry.grid[ny * N + nx];
          if (ROAD_TYPES.has(tt) || BLOCKED_FOR_X.has(tt)) continue;
          if (onRoadBand(nx, ny)) continue;
          // occupied too: the pocket keeps the player's real street trees
          // (see the CLEAR_R exception), and a crate seated on one reads as
          // a bug whichever the renderer draws second.
          if (usedSeats.has(nx + ',' + ny) || occupied.has(nx + ',' + ny)) continue;
          if (inTrailerMoat(nx, ny)) continue;
          // Enforce a minimum gap from the previous crate so the trail
          // spreads out instead of clustering on adjacent road cells.
          if (lastSeat &&
              Math.max(Math.abs(nx - lastSeat.nx), Math.abs(ny - lastSeat.ny)) < MIN_GAP) continue;
          seat = { nx, ny }; break;
        }
        if (!seat) continue;
        seatCrate(seat.nx, seat.ny, nextIdx);
        lastSeat = seat;
        nextIdx++;
      }
    }
    // Fill any crates the road couldn't host (no road found, or the road
    // ran out of walkable shoulders) in a tight ring around the anchor
    // on walkable cells. Guarantees the player always gets all four crates.
    if (placedIdx.size < COUNT) {
      const RING = [[2, 0], [-2, 0], [0, 2], [0, -2], [3, 0], [-3, 0],
                    [2, 2], [-2, -2], [2, -2], [-2, 2]];
      let ringPos = 0;
      for (let i = 0; i < COUNT; i++) {
        if (placedIdx.has(i)) continue;
        let seated = false;
        while (ringPos < RING.length && !seated) {
          const [bdx, bdy] = RING[ringPos++];
          let ncx = spawnIX + bdx, ncy = spawnIY + bdy;
          for (let step = 0; step < 5; step++) {
            if (ncx < 0 || ncx >= N || ncy < 0 || ncy >= N) break;
            const t = entry.grid[ncy * N + ncx];
            if (!BLOCKED_FOR_X.has(t) && !ROAD_TYPES.has(t) && !onRoadBand(ncx, ncy)
                && !usedSeats.has(ncx + ',' + ncy)) break;
            ncx += Math.sign(bdx) || 0;
            ncy += Math.sign(bdy) || 0;
          }
          if (ncx < 0 || ncx >= N || ncy < 0 || ncy >= N) continue;
          const tt = entry.grid[ncy * N + ncx];
          if (BLOCKED_FOR_X.has(tt) || ROAD_TYPES.has(tt) || onRoadBand(ncx, ncy)
              || usedSeats.has(ncx + ',' + ncy)) continue;
          seatCrate(ncx, ncy, i);
          seated = true;
        }
      }
    }
    // Last, on the now-cleared pocket: the guaranteed patch of soil the
    // ladder's "Break ground" step needs, then the wood / rock / wreck the
    // rest of the ladder needs to have something to act on.
    dbg.push(`crates=${placedIdx.size}/${COUNT}`);
    this._trailDebug = dbg.join(' | ');
    this._carveStarterPlot(entry, tx, ty, spawnIX, spawnIY, usedSeats);
    this._provisionStarterHome(entry, tx, ty, spawnIX, spawnIY, usedSeats);
    this._revealStarterTrail(entry, tx, ty, spawnIX, spawnIY);
  }

  // Lift the fog off the onboarding trail the moment it is laid.
  //
  // The trail is a SIGHTLINE CHAIN, and that is the whole of its design: walk
  // to the crate you can see, and from there the next one is in view, and the
  // last one puts the relic chest in view. Fog of war reveals 3 cells around
  // the player and the trail reaches up to 15 from the anchor, so shipping the
  // two together left every crate under an 80% black wash on a brand-new save
  // — the quest said "supply crates were left along the road nearby" and the
  // road was invisible. A chain of landmarks nobody can see is not a chain.
  //
  // So the pocket the player starts in is known ground: their own block, plus
  // a disc around each thing the trail seated. Deliberately NOT a blanket
  // radius around the anchor — that would reveal map in every direction,
  // including the way the trail does not go. Following the crates is what
  // opens the map up; this only makes the crates themselves findable.
  _revealStarterTrail(entry, tx, ty, spawnIX, spawnIY) {
    if (typeof Fog === 'undefined' || this.depth !== 0) return;
    const N = entry.cellsPerEdge;
    const abs = (cx, cy) => ({ ix: tx * N + cx, iy: ty * N + cy });
    // Home: the tutorial pocket _placeStarterTrail has just cleared and
    // curated. The player lives here; they are not discovering it.
    const home = abs(spawnIX, spawnIY);
    let changed = Fog.revealDisc(home.ix, home.iy, HOME_REVEAL_CELLS);
    // ...and each crate / the relic chest, with enough margin that the crate
    // reads as sitting on ground rather than punched out of the dark. Found by
    // id rather than threaded through the seater: `chest_start_` is already the
    // stamp the onboarding arrow (_nearestStarterCrate) keys off, so the two
    // can't disagree about what the trail consists of.
    for (const o of (entry.objects || [])) {
      if (!o.id || !String(o.id).startsWith('chest_start_')) continue;
      const cx = Math.floor((o.x - tx * this.tileEdgeM) / this.cellM);
      const cy = Math.floor((o.y - ty * this.tileEdgeM) / this.cellM);
      const a = abs(cx, cy);
      if (Fog.revealDisc(a.ix, a.iy, TRAIL_REVEAL_CELLS)) changed = true;
    }
    if (!changed) return;
    Fog.flush(this.save);
    if (typeof persistSave === 'function') persistSave(this.save);
  }

  // A treasure chest one screen out from the spawn anchor, holding one random
  // WOODEN (T1) relic. Returns { chest, path } — the walked route from the
  // anchor to it (anchor first, chest last, one 4-connected step per entry) is
  // what _placeStarterTrail lays the crate breadcrumbs along — or null when
  // there is nowhere legal to put it.
  //
  // The supply crates hand a new player materials; nothing hands them a TOOL.
  // Every relic is otherwise bought or forged, so the opening hour is spent
  // bare-handed at 9 s a swing — a wooden one is 2.25× quicker (toolDurationMs) —
  // and which tool it is decides what that hour can even be spent on. So this
  // is a real treasure chest, not another supply crate: no `crate` flag, so it
  // renders as the trunk with its tier gem rather than a box, and it disappears
  // when opened. Its id carries the `chest_start_` stamp, so the gold onboarding
  // arrow (_nearestStarterCrate) will point the way to it like any other.
  //
  // "A screen away": the view is VIEW_CELLS across with the player in the middle
  // of it, so a chest VIEW_CELLS cells out is just past the edge of the opening
  // screen — a walk in some direction, not something already in frame — and
  // clear of the CLEAR_R tutorial pocket that gets stripped bare around the
  // anchor, and of the starter ring that begins at its edge. It takes the
  // first ring from there out with a free cell (searching to RELIC_MAX_R), so
  // a spawn hemmed in by water or buildings still gets it —
  // and only ever a cell the anchor can be WALKED to, since a chest at the end
  // of a trail is no use across a river.
  //
  // Which slot and which direction are both derived from the frozen anchor
  // through a seeded rng, never Math.random: a tile rebuild has to reproduce
  // the same chest, in the same cell, with the same relic in it — a player who
  // walked off and came back to find a different reward waiting would be
  // watching the world re-roll itself. The id is keyed off the tile (not the
  // cell) for the same reason save.opened keys off it: an opened chest must
  // stay opened even if a future rebuild ever seats it one cell over.
  _placeStarterRelicChest(entry, tx, ty, spawnIX, spawnIY, usedSeats, seatWant) {
    const grid = entry.grid;
    if (!grid || typeof WorldGen === 'undefined') return null;
    const N = entry.cellsPerEdge;
    entry.objects = entry.objects || [];
    const id = `chest_start_relic_${tx}_${ty}`;
    if (entry.objects.some(o => o.id === id)) return null;   // already seated
    // Ring band: one screen out, widening only as far as the starter home's
    // own ring reaches so the chest can never end up somewhere that reads as
    // "another neighbourhood" instead of "just off the opening screen".
    const RELIC_MIN_R = VIEW_CELLS;
    const RELIC_MAX_R = (typeof HomeArea !== 'undefined' ? HomeArea.RING_MAX_CELLS : 16);
    // Cells already spoken for — a crate seat, or anything standing on the
    // tile. Nothing but the chest may share the cell it seats on.
    const taken = new Set(usedSeats || []);
    const tx0 = tx * this.tileEdgeM, ty0 = ty * this.tileEdgeM;
    const markTaken = (wx, wy) => taken.add(
      Math.floor((wx - tx0) / this.cellM) + ',' + Math.floor((wy - ty0) / this.cellM));
    for (const o of entry.objects) markTaken(o.x, o.y);
    for (const w of (entry.wildplants || [])) markTaken(w.x, w.y);
    // The shared spawn rule — walkable, off anyone's road BAND (not merely off
    // the one cell per way the grid paints), out of the back gardens. A chest
    // in the street is the bug this mask exists to stop.
    const spawnOpts = { roadMask: entry.roadMask };
    const cellKey = (cx, cy) => cx + ',' + cy;
    // ── The walk there ──────────────────────────────────────────────────
    // Flood out from the anchor over ground a ROUTE may be drawn across. This
    // is not a collision test — the surface has none (_cellBlocked), the player
    // can walk anywhere — it is about what a trail may cross: stepping over a
    // street is ordinary, so roads are in; wading a river or strolling through
    // someone's living room is not, so water and buildings are out. Every cell
    // it reaches carries the step it was reached FROM, which is what turns the
    // chosen chest cell into a walked route the crate trail can be laid along
    // (see _placeStarterTrail).
    const UNCROSSABLE = new Set([3 /* WATER */, 9 /* BUILDING */,
      11 /* BUILDING_MED */, 12 /* BUILDING_LARGE */]);
    // A few cells of slack past the band, so a route that has to bend round a
    // pond or a block to reach the far side of the ring still gets found.
    const FLOOD_R = RELIC_MAX_R + 4;
    const cameFrom = new Map([[cellKey(spawnIX, spawnIY), null]]);
    const flood = [[spawnIX, spawnIY]];
    for (let head = 0; head < flood.length; head++) {
      const [cx, cy] = flood[head];
      for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + ddx, ny = cy + ddy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        if (Math.max(Math.abs(nx - spawnIX), Math.abs(ny - spawnIY)) > FLOOD_R) continue;
        const k = cellKey(nx, ny);
        if (cameFrom.has(k)) continue;
        if (UNCROSSABLE.has(grid[ny * N + nx])) continue;
        cameFrom.set(k, [cx, cy]);
        flood.push([nx, ny]);
      }
    }
    // A cell the flood never reached is somewhere the player would have to
    // swim or trespass to get to — no trail can lead there, so it is no place
    // for the chest at the end of one.
    const free = (cx, cy) => !taken.has(cellKey(cx, cy)) &&
      cameFrom.has(cellKey(cx, cy)) &&
      WorldGen.isSpawnCell(grid, N, N, cx, cy, spawnOpts);
    const seed =
      ((tx * 0x1f1f1f1f) ^ (ty * 0x9e3779b1) ^ (spawnIX * 73856093) ^ (spawnIY * 19349663)) >>> 0;
    const rng = WorldGen.makeRng(seed);
    // The SLOT rolls off its own stream with the per-save salt mixed in, so a
    // save RESET rerolls which relic the chest holds. The SEAT stream (rng)
    // stays purely location-keyed: the chest sits where it always sat, the
    // trail geometry doesn't move, and a tile rebuild mid-save reproduces
    // both — the salt lives in the save, so it is exactly as stable as the
    // loot needs to be and no more. Salt 0 (test stubs, pre-salt saves at
    // the moment of upgrade) degrades to the old purely-location roll.
    const slotRng = WorldGen.makeRng((seed ^ (this.save?.relicSalt || 0)) >>> 0);
    const slot = STARTER_RELIC_SLOTS[Math.floor(slotRng() * STARTER_RELIC_SLOTS.length)];
    // The slot used to be drawn off `rng`; burn that draw so every chest laid
    // by the old code keeps its seat under the new one.
    rng();
    // A caller may nominate the seat — the kerb trail (mode 1 in
    // _placeStarterTrail) wants the chest at the end of the crate line, on
    // the road's shoulder. Honoured only if it passes the same legality the
    // ring scan enforces (walkable from the anchor, the shared spawn rule,
    // unclaimed), so a bad hint falls back to the ring below rather than
    // seating the chest across a river or in the street.
    let seat = null;
    if (seatWant && free(seatWant.cx, seatWant.cy)) seat = { cx: seatWant.cx, cy: seatWant.cy };
    // Nearest ring first; within a ring, a seeded pick so the chest isn't
    // always due east of every spawn in the game. Ring cells are collected in
    // a fixed scan order, so the pick is reproducible.
    for (let r = RELIC_MIN_R; r <= RELIC_MAX_R && !seat; r++) {
      const ring = [];
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;   // ring edge only
          const cx = spawnIX + dx, cy = spawnIY + dy;
          if (free(cx, cy)) ring.push({ cx, cy });
        }
      }
      if (ring.length) seat = ring[Math.floor(rng() * ring.length)];
    }
    // Nothing seated: every ring cell in reach is water, road, floor or taken —
    // or, on a spawn right against a tile seam, off the edge of the only grid
    // this pass can read. A tile is ~220 cells across and the band is 16, so a
    // seam only ever costs the arcs on that side; the rest of the compass still
    // answers, which is why this stays clamped to the anchor's own tile rather
    // than reaching across seams the way _provisionStarterHome has to.
    if (!seat) return null;
    // Snap to the canonical global cell centre, the basis seatCrate and every
    // cell tap share (the tile-relative basis drifts off it — see seatCrate).
    const rawX = tx0 + (seat.cx + 0.5) * this.cellM;
    const rawY = ty0 + (seat.cy + 0.5) * this.cellM;
    const { cellIX, cellIY } = worldMetersToAbsCell(this, rawX, rawY);
    const { x: wmx, y: wmy } = absCellCenterMeters(this, cellIX, cellIY);
    const chest = {
      kind: 'chest', x: wmx, y: wmy, id,
      // Named so it draws a label: the whole point is that the player can see
      // there is something worth the walk once it comes into view.
      name: 'Old Chest',
      // Opens through the standard chest path (interactables.js), which reads
      // fixedLoot and — for a gear payload — reconciles it against what the
      // player already owns before equipping.
      fixedLoot: { kind: 'relic', slot, tier: STARTER_RELIC_TIER },
    };
    entry.objects.push(chest);
    if (usedSeats) usedSeats.add(seat.cx + ',' + seat.cy);
    // Hand back the walk, anchor first, chest last — one 4-connected step per
    // entry. The caller lays the crate trail along it.
    const path = [];
    for (let at = [seat.cx, seat.cy]; at; at = cameFrom.get(cellKey(at[0], at[1]))) {
      path.push({ cx: at[0], cy: at[1] });
    }
    path.reverse();
    return { chest, path };
  }

  // A guaranteed 2x2 patch of tillable grass near the spawn anchor.
  //
  // STARTER_CHAIN step 2 ("Break ground") assumes there is ground to break,
  // and the gold guidance arrow pointed at a supply CRATE through every step
  // of the ladder. A player who spawns somewhere with no soil in reach — a
  // parking lot, a terraced street, a riverbank — was therefore told to till a
  // patch of grass while the only arrow on screen led to a box that isn't one.
  // This paints a plot the step can actually be performed on, and freezes its
  // position on the save so the arrow has an honest target to point at.
  //
  // 2x2 rather than a single cell: one cell to till for the step itself, and
  // three more beside it so the first crop has somewhere to go without
  // hunting for a second patch.
  //
  // save.starterPlotAt holds the TOP-LEFT cell's centre in world metres. It is
  // chosen once and re-painted at those same cells on every later rebuild of
  // the tile, so the plot can never drift out from under a player who has
  // already tilled it.
  _carveStarterPlot(entry, tx, ty, spawnIX, spawnIY, usedSeats) {
    const grid = entry.grid;
    if (!grid) return;
    // Only for a player the ladder is still guiding. A veteran save has no use
    // for the plot and shouldn't have its home terrain quietly edited on a
    // reload — but one already frozen keeps being repainted forever (below),
    // so a player who finishes the ladder doesn't watch their first field turn
    // back into whatever was under it.
    if (!this.save.starterPlotAt &&
        (typeof Quests === 'undefined' || Quests.starterHidden(this.save))) return;
    const N = entry.cellsPerEdge;
    const GRASS = 0;
    const tx0 = tx * this.tileEdgeM, ty0 = ty * this.tileEdgeM;
    const paint = (cx, cy) => {
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) grid[(cy + dy) * N + (cx + dx)] = GRASS;
      }
    };
    const inTile = (cx, cy) => cx >= 0 && cy >= 0 && cx + 1 < N && cy + 1 < N;

    // Already frozen — repaint in place. The plot lives within a few cells of
    // the anchor, so a frozen plot that doesn't land on THIS tile belongs to a
    // neighbour and is that tile's job to paint.
    const frozen = this.save.starterPlotAt;
    if (frozen && Number.isFinite(frozen.x)) {
      const fcx = Math.floor((frozen.x - tx0) / this.cellM);
      const fcy = Math.floor((frozen.y - ty0) / this.cellM);
      if (inTile(fcx, fcy)) paint(fcx, fcy);
      return;
    }

    // Cells a plot must never overwrite: the street, anyone's floor, open
    // water and the decking over it. Everything else the world puts under
    // your feet — yards, lots, scrub, sand, bare rock — is fair game to turn
    // into a patch of soil.
    const UNPAINTABLE = new Set([3 /* WATER */, 7 /* ROAD */, 8 /* PATH */,
      9 /* BUILDING */, 11 /* BUILDING_MED */, 12 /* BUILDING_LARGE */,
      13 /* ROAD_LG */, 14 /* ROAD_MD */, 23 /* PIER */,
      24 /* CAVE_FLOOR */, 25 /* CAVE_WALL */]);
    // Anything still standing in a cell blocks the till handler, so the plot
    // has to avoid the objects and wild plants the clearing pass kept (real
    // street trees, houses, the crates themselves).
    const occupied = new Set();
    const mark = (wx, wy) => occupied.add(
      Math.floor((wx - tx0) / this.cellM) + ',' + Math.floor((wy - ty0) / this.cellM));
    for (const o of (entry.objects || [])) mark(o.x, o.y);
    for (const w of (entry.wildplants || [])) mark(w.x, w.y);

    const usable = (cx, cy) => {
      // The Home trailer covers the anchor cell and spills into all eight
      // neighbours (see inTrailerMoat in the caller) — a plot there would sit
      // under the building art.
      if (Math.max(Math.abs(cx - spawnIX), Math.abs(cy - spawnIY)) <= 1) return false;
      if (usedSeats.has(cx + ',' + cy)) return false;
      if (occupied.has(cx + ',' + cy)) return false;
      // UNPAINTABLE is the road TERRAIN; the mask is the rest of the band the
      // player sees drawn over it (see entry.roadMask). Soil tilled under the
      // asphalt reads as a plot in the middle of the street.
      if (entry.roadMask && entry.roadMask[cy * N + cx] === 1) return false;
      return !UNPAINTABLE.has(grid[cy * N + cx]);
    };
    const blockUsable = (cx, cy) => inTile(cx, cy) &&
      usable(cx, cy) && usable(cx + 1, cy) && usable(cx, cy + 1) && usable(cx + 1, cy + 1);

    // Nearest-first ring scan out to 8 cells, so the plot lands as close to
    // the trailer as the surroundings allow. The scan order is fixed (not
    // seeded), so a rebuild of the same tile would reach the same answer even
    // if the freeze above were somehow missing.
    let found = null;
    for (let r = 2; r <= 8 && !found; r++) {
      for (let dy = -r; dy <= r && !found; dy++) {
        for (let dx = -r; dx <= r && !found; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;   // ring edge only
          const cx = spawnIX + dx, cy = spawnIY + dy;
          if (blockUsable(cx, cy)) found = { cx, cy };
        }
      }
    }
    // Nothing within 8 cells can host one (mid-river, deep inside a block of
    // buildings). Leave the grid alone and freeze nothing — the arrow falls
    // back to the crates, which is where it pointed before this existed.
    if (!found) return;
    paint(found.cx, found.cy);
    // Snap the frozen point to the canonical global cell centre, the same
    // basis seatCrate uses, so the arrow and the tap grid agree on where the
    // plot is.
    const rawX = tx0 + (found.cx + 0.5) * this.cellM;
    const rawY = ty0 + (found.cy + 0.5) * this.cellM;
    const { cellIX, cellIY } = worldMetersToAbsCell(this, rawX, rawY);
    const { x: wmx, y: wmy } = absCellCenterMeters(this, cellIX, cellIY);
    this.save.starterPlotAt = { x: wmx, y: wmy };
    if (typeof persistSave === 'function') persistSave(this.save);
  }

  // Rebuild one frozen starter-home record into a world object. Kept beside
  // the placer so the shape written to the save and the shape pushed into a
  // tile can't drift — the record IS the object, minus its position basis.
  _starterHomeObject(rec) {
    const base = { x: rec.x, y: rec.y, id: rec.id, _synthetic: true };
    // A record may carry a rarity rolled at seat time (see the seatAt roll in
    // _provisionStarterHome): a rock's deposit tier, or a tree grown a size
    // up. The frozen record is the truth — legacy records carry neither and
    // rebuild as the plain starter shape.
    if (rec.k === 'tree') {
      const o = { kind: 'tree', ...base, ...HomeArea.STARTER_TREE, variant: rec.variant || 1 };
      if (rec.size) o.size = rec.size;
      return o;
    }
    if (rec.k === 'rock') {
      const o = { kind: 'mineralrock', ...base, ...HomeArea.STARTER_ROCK };
      if (rec.yieldTier > 1) {
        o.yieldTier = rec.yieldTier;
        o.requiredTier = rec.requiredTier || Math.max(1, rec.yieldTier - 1);
      }
      return o;
    }
    // A cave entrance on the surface. Same shape maybePlaceCaveEntrance emits,
    // so it descends through the ordinary staircase path and loadCaveTile
    // mirrors an up-stair onto the level below it like any other mine mouth.
    if (rec.k === 'ladder') {
      return { kind: 'staircase', dir: 'down', depth: 0, ...base };
    }
    // A plain small house, so _houseRole draws it as a wreck until the player
    // restores it — which is exactly what step 4 of the ladder asks for. The
    // address decides its post-restore shop role the same way a real one's does.
    return { kind: 'house', ...base, tier: WorldGen.T.BUILDING, address: rec.address || 0 };
  }

  // The same, for the one starter record that is NOT an object: a mushroom
  // lives in the tile's `wildplants` stream (keyed by `crop`, picked bare-
  // handed) rather than in `objects`. Kept beside _starterHomeObject so the
  // two halves of "a frozen record becomes a world thing" stay together.
  //
  // _ix/_iy are the ABSOLUTE cell, not the tile-local index worldgen stores.
  // They are only ever a hash for the sprite variant (render.js), so absolute
  // is strictly better: it doesn't change when a record is injected into a
  // neighbour tile across a seam. Derived rather than frozen, so records
  // written before this existed rebuild identically.
  _starterHomeWildplant(rec) {
    const c = worldMetersToAbsCell(this, rec.x, rec.y);
    return {
      x: rec.x, y: rec.y, id: rec.id, _synthetic: true,
      ...HomeArea.STARTER_MUSHROOM,
      _ix: c.cellIX, _iy: c.cellIY,
    };
  }

  // Which of a tile's two streams a frozen starter record belongs in.
  _starterHomeStream(entry, rec) {
    if (rec.k === 'mushroom') {
      entry.wildplants = entry.wildplants || [];
      return { list: entry.wildplants, make: () => this._starterHomeWildplant(rec) };
    }
    entry.objects = entry.objects || [];
    return { list: entry.objects, make: () => this._starterHomeObject(rec) };
  }

  // Make sure the starter ladder has something to teach WITH.
  //
  // The ladder assumes the world around spawn can carry it: wood to chop,
  // rock to mine, a wreck to rebuild. The real map promises none of that. A
  // parkland or rural spawn can have no OSM buildings at all, so step 4
  // ("Rebuild a neighbour") can never fire and the crates' wood and stone have
  // nothing to be spent on. A downtown spawn has the opposite problem: trees
  // everywhere, every one of them a large hardwood wanting a Gold axe.
  //
  // The POLICY — what counts, what a beginner can actually harvest, and how
  // much is required — lives in home.js (HomeArea.planStarterProvision), which
  // is pure and headless-testable. This method only does what needs a tile:
  // seating the shortfall on real cells and freezing the result.
  //
  // Placement follows the same split the tutorial pocket already establishes:
  // the pocket stays tidy for the crate trail and the soil plot, apart from one
  // token tree and one token rock so the first thing to chop and mine is in
  // sight of Home; everything else seats in the ring just outside it.
  _provisionStarterHome(entry, tx, ty, spawnIX, spawnIY, usedSeats) {
    const grid = entry.grid;
    if (!grid || typeof HomeArea === 'undefined' || typeof WorldGen === 'undefined') return;
    // Same gate as the starter plot: provision only while the ladder is still
    // guiding someone, but once frozen keep re-applying forever, so a player
    // who finishes it doesn't watch their home dissolve back into bare map.
    if (!this.save.starterHome &&
        (typeof Quests === 'undefined' || Quests.starterHidden(this.save))) return;
    const N = entry.cellsPerEdge;
    const tx0 = tx * this.tileEdgeM, ty0 = ty * this.tileEdgeM;
    entry.objects = entry.objects || [];
    // Callable from any tile's spawn, not just the starter trail's own pass:
    // without the spawn cell, derive it from the frozen anchor. It may land
    // outside this tile, which is fine — everything below works in world space.
    if (spawnIX == null || spawnIY == null) {
      const a = this.save.starterCratesAt;
      if (!a || !Number.isFinite(a.x)) return;
      spawnIX = Math.floor((a.x - tx0) / this.cellM);
      spawnIY = Math.floor((a.y - ty0) / this.cellM);
    }
    if (!usedSeats) usedSeats = new Set();

    // ── Re-apply what is already frozen ────────────────────────────────
    // Every tile does this for the records that land inside it, so an item
    // seated across a tile seam is that neighbour's job to inject — the same
    // division of labour _carveStarterPlot uses for the soil plot.
    const inThisTile = (wx, wy) =>
      wx >= tx0 && wx < tx0 + this.tileEdgeM && wy >= ty0 && wy < ty0 + this.tileEdgeM;
    const present = new Set();
    for (const o of entry.objects) if (o.id) present.add(o.id);
    for (const w of (entry.wildplants || [])) if (w.id) present.add(w.id);
    const inject = (rec) => {
      if (inThisTile(rec.x, rec.y)) {
        if (present.has(rec.id)) return;
        const s = this._starterHomeStream(entry, rec);
        s.list.push(s.make());
        present.add(rec.id);
        return;
      }
      // Seated across a seam: put it in whichever loaded tile owns it, so a
      // pass driven by one tile still lands its neighbours' share immediately
      // instead of waiting for those tiles to rebuild.
      const otx = Math.floor(rec.x / this.tileEdgeM), oty = Math.floor(rec.y / this.tileEdgeM);
      const e = WorldGen.tileCache.get(WorldGen.tileKey(otx, oty));
      if (!e || !e.objects) return;
      const s = this._starterHomeStream(e, rec);
      for (const o of s.list) if (o.id === rec.id) return;
      s.list.push(s.make());
    };
    const frozen = this.save.starterHome;
    if (frozen) {
      for (const rec of (frozen.placed || [])) inject(rec);
      // A tamed natural is regenerated at its original tier on every rebuild,
      // so the downgrade has to be re-applied or the player's one choppable
      // street tree turns back into a hardwood on the next reload.
      const wasTamed = new Set(frozen.tamed || []);
      if (wasTamed.size) {
        for (const o of entry.objects) if (o.id && wasTamed.has(o.id)) HomeArea.makeStarterUsable(o);
      }
      // A finished plan needs nothing more. An UNFINISHED one falls through to
      // top itself up: the first pass runs while the neighbouring tiles are
      // often still streaming, and a spawn near a tile seam can't seat into a
      // tile that hasn't loaded — measured on a real spawn at cell iy=213 of a
      // 222-cell tile, which left the whole southern arc bare. Later passes see
      // more of the map. Bounded, so a genuinely hemmed-in spawn stops trying.
      if (frozen.done || (frozen.tries || 0) >= 4) return;
    }

    // ── First pass: audit, then fill only the gaps ─────────────────────
    // Only the tile holding the anchor can see the home area, so only it
    // plans. (The ring reaches 16 cells and a tile is ~222, so the area sits
    // inside one tile except right on a seam — where the audit simply sees
    // less of the neighbourhood and errs toward providing a little extra.)
    const anchorX = tx0 + (spawnIX + 0.5) * this.cellM;
    const anchorY = ty0 + (spawnIY + 0.5) * this.cellM;
    // Audit every loaded tile the home area touches. Reading this tile alone
    // would miss both the neighbourhood across a seam and the items an earlier
    // pass already seated there, and would re-provision them all over again.
    const atx2 = Math.floor(tx0 / this.tileEdgeM), aty2 = Math.floor(ty0 / this.tileEdgeM);
    const seen = new Set();
    const areaObjects = [];
    const areaPlants = [];
    const collect = (list, into) => {
      for (const o of (list || [])) {
        if (o.id) { if (seen.has(o.id)) continue; seen.add(o.id); }
        into.push(o);
      }
    };
    collect(entry.objects, areaObjects);
    collect(entry.wildplants, areaPlants);
    for (const [k, e] of WorldGen.tileCache) {
      if (!e || !e.objects) continue;
      const parts = k.split('/');
      if (Math.abs(+parts[1] - atx2) > 1 || Math.abs(+parts[2] - aty2) > 1) continue;
      collect(e.objects, areaObjects);
      collect(e.wildplants, areaPlants);
    }
    // Audit as far out as an earlier pass had to reach. Without this, anything
    // seated in the escalated band sits outside the default audit radius, so
    // the next pass sees the quota unmet and provisions it all over again.
    let auditR = HomeArea.RING_MAX_CELLS;
    for (const rec of ((frozen && frozen.placed) || [])) {
      const d = HomeArea.cellsFromAnchor(rec.x, rec.y, anchorX, anchorY, this.cellM);
      if (d > auditR) auditR = Math.ceil(d);
    }
    const plan = HomeArea.planStarterProvision(areaObjects, anchorX, anchorY, this.cellM,
      { homeId: this.save.starterShopId, radiusCells: auditR, wildplants: areaPlants });

    // Modify the unusable naturals standing here rather than crowding more in
    // beside them: the player's own street tree stays their street tree, it
    // just stops demanding an axe they will not own for hours.
    const tamed = [];
    for (const o of plan.downgrade) {
      if (HomeArea.makeStarterUsable(o) && o.id) tamed.push(o.id);
    }

    // Cells nothing may be seated on: the street, anyone's floor, water and
    // the decking over it, and the cave layers. Mirrors the starter plot's
    // UNPAINTABLE set — the difference is that a plot REPLACES a cell whereas
    // an object has to stand on one, so bare rock is fine for both.
    const BLOCKED = new Set([3 /* WATER */, 7 /* ROAD */, 8 /* PATH */,
      9 /* BUILDING */, 11 /* BUILDING_MED */, 12 /* BUILDING_LARGE */,
      13 /* ROAD_LG */, 14 /* ROAD_MD */, 23 /* PIER */,
      24 /* CAVE_FLOOR */, 25 /* CAVE_WALL */]);
    const key = (cx, cy) => cx + ',' + cy;
    const taken = new Set();
    const mark = (wx, wy) => taken.add(key(
      Math.floor((wx - tx0) / this.cellM), Math.floor((wy - ty0) / this.cellM)));
    // Terrain lookup that CROSSES TILE SEAMS, in cells relative to the anchor
    // tile. Seating used to be clamped to the anchor's own tile, so a spawn
    // landing within ring-distance of a seam lost that whole arc — measured on
    // a real spawn at cell iy=213 of a 222-cell tile, the entire southern side
    // was unreachable and came out bare. A tile is only consulted once it has
    // loaded; an unloaded neighbour reads as unusable rather than being
    // guessed at, so nothing is ever seated into unseen water or road.
    // Returns null when the cell can't be resolved.
    const gridAt = (cx, cy) => {
      if (cx >= 0 && cy >= 0 && cx < N && cy < N) return grid[cy * N + cx];
      const wx = tx0 + (cx + 0.5) * this.cellM, wy = ty0 + (cy + 0.5) * this.cellM;
      const ntx = Math.floor(wx / this.tileEdgeM), nty = Math.floor(wy / this.tileEdgeM);
      const e = WorldGen.tileCache.get(WorldGen.tileKey(ntx, nty));
      if (!e || !e.grid || (e.status && e.status !== 'ready')) return null;
      const nN = e.cellsPerEdge;
      const ix = Math.floor((wx - ntx * this.tileEdgeM) / this.cellM);
      const iy = Math.floor((wy - nty * this.tileEdgeM) / this.cellM);
      if (ix < 0 || iy < 0 || ix >= nN || iy >= nN) return null;
      return e.grid[iy * nN + ix];
    };
    // The same lookup for the road FOOTPRINT (see entry.roadMask in worldgen):
    // the terrain code alone under-reports the road, because every way
    // rasterizes one cell wide however wide it really is and parking aisles
    // rasterize to nothing at all. Truthy = the cell is under a drawn road
    // band. Unresolvable cells read as 0 — gridAt already refused them.
    const roadMaskAt = (cx, cy) => {
      if (cx >= 0 && cy >= 0 && cx < N && cy < N) return entry.roadMask ? entry.roadMask[cy * N + cx] : 0;
      const wx = tx0 + (cx + 0.5) * this.cellM, wy = ty0 + (cy + 0.5) * this.cellM;
      const ntx = Math.floor(wx / this.tileEdgeM), nty = Math.floor(wy / this.tileEdgeM);
      const e = WorldGen.tileCache.get(WorldGen.tileKey(ntx, nty));
      if (!e || !e.roadMask) return 0;
      const nN = e.cellsPerEdge;
      const ix = Math.floor((wx - ntx * this.tileEdgeM) / this.cellM);
      const iy = Math.floor((wy - nty * this.tileEdgeM) / this.cellM);
      if (ix < 0 || iy < 0 || ix >= nN || iy >= nN) return 0;
      return e.roadMask[iy * nN + ix];
    };
    // The anchor's own tile has to be readable before anything can be planned.
    if (gridAt(spawnIX, spawnIY) == null) return;
    // And don't plan against HALF A MAP. Seating is spatial: a first pass that
    // can only see the anchor's tile spends the whole quota on the directions
    // it can reach and leaves the rest bare for good, because the quota is then
    // satisfied and no later pass wants anything. So wait until every tile the
    // ring reaches into has loaded. Bounded — a tile that never arrives must
    // not leave the player with no starter resources at all.
    this._starterHomeDefers = (this._starterHomeDefers || 0) + 1;
    if (this._starterHomeDefers <= 8) {
      const R = HomeArea.RING_MAX_CELLS;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        if (gridAt(spawnIX + dx * R, spawnIY + dy * R) == null) return;
      }
    }
    // Occupancy from the anchor tile AND any loaded neighbour, so a seat can't
    // land on a tree that belongs to the tile next door.
    const atx = Math.floor(tx0 / this.tileEdgeM), aty = Math.floor(ty0 / this.tileEdgeM);
    for (const [k, e] of WorldGen.tileCache) {
      if (!e || !e.objects) continue;
      const parts = k.split('/');
      if (Math.abs(+parts[1] - atx) > 1 || Math.abs(+parts[2] - aty) > 1) continue;
      for (const o of e.objects) mark(o.x, o.y);
      for (const w of (e.wildplants || [])) mark(w.x, w.y);
    }
    for (const o of entry.objects) mark(o.x, o.y);
    for (const w of (entry.wildplants || [])) mark(w.x, w.y);
    // The soil plot is a 2x2 the player is about to till — keep it clear.
    const plot = this.save.starterPlotAt;
    if (plot && Number.isFinite(plot.x)) {
      const pcx = Math.floor((plot.x - tx0) / this.cellM);
      const pcy = Math.floor((plot.y - ty0) / this.cellM);
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) taken.add(key(pcx + dx, pcy + dy));
    }
    // Nothing goes in the Home trailer's moat (clearHomeTrailerOverlap would
    // sweep it away) or on a crate seat.
    const free = (cx, cy) => {
      if (Math.max(Math.abs(cx - spawnIX), Math.abs(cy - spawnIY)) <= 1) return false;
      if (usedSeats.has(key(cx, cy)) || taken.has(key(cx, cy))) return false;
      // BLOCKED covers the road TERRAIN; the mask covers the rest of the band
      // the player sees drawn over it. The first thing a new player is taught
      // to chop cannot be standing in the street.
      if (roadMaskAt(cx, cy)) return false;
      const t = gridAt(cx, cy);
      return t != null && !BLOCKED.has(t);
    };

    // Seating spreads items around the COMPASS, not along one edge. The
    // obvious ring scan (for dy… for dx… take the first free cell) walks the
    // ring's cells in order and so drops every item on its north row, two
    // cells apart: a player who walked north tripped over all of them and one
    // who walked any other direction found nothing at all. Instead each item
    // gets a target bearing, evenly spaced around the circle, and takes the
    // free cell closest to it — so setting off in any direction runs into
    // something. Fixed order, no RNG: a rebuild reaching this path again would
    // reach the same answer.
    const placed = [];
    // Every free cell in a radius band, with its bearing from the anchor.
    const bandCells = (rMin, rMax) => {
      const out = [];
      for (let r = rMin; r <= rMax; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;   // ring edge only
            const cx = spawnIX + dx, cy = spawnIY + dy;
            if (!free(cx, cy)) continue;
            out.push({ cx, cy, r, bearing: Math.atan2(dy, dx) });
          }
        }
      }
      return out;
    };
    // Cells within one step of something already seeded. Keeping this as a set
    // makes the spacing test O(1): rescanning every placement for every
    // candidate is quadratic, and at a quota of 50 each that alone cost most
    // of a second on the tile that builds under the player.
    const crowded = new Set();
    // `plain` pins the seat to the guaranteed beginner tier (the token pair —
    // the pocket's teaching examples must be workable bare-handed). Everything
    // else rolls rarity like a real deposit below, so the ring holds the
    // occasional better rock or bigger tree instead of fifty identical props.
    const seatAt = (kind, cells, bearing, plain) => {
      let best = null, bestScore = Infinity;
      for (const c of cells) {
        if (c.used) continue;
        // Keep the seeded items a couple of cells apart so they read as
        // scenery rather than a stockpile.
        if (crowded.has(key(c.cx, c.cy))) continue;
        let da = Math.abs(c.bearing - bearing);
        if (da > Math.PI) da = 2 * Math.PI - da;
        // Direction dominates; among cells pointing the same way, take the
        // nearer one so the player meets it sooner.
        const score = da * 100 + c.r;
        if (score < bestScore) { bestScore = score; best = c; }
      }
      if (!best) return false;
      best.used = true;
      const raw = { x: tx0 + (best.cx + 0.5) * this.cellM, y: ty0 + (best.cy + 0.5) * this.cellM };
      // Snap to the canonical global cell centre, the basis every tap and
      // every other placed object uses (see seatCrate).
      const abs = worldMetersToAbsCell(this, raw.x, raw.y);
      const c = absCellCenterMeters(this, abs.cellIX, abs.cellIY);
      const rec = { k: kind, x: c.x, y: c.y, cx: best.cx, cy: best.cy,
        id: `starter_${kind}_${abs.cellIX}_${abs.cellIY}` };
      if (kind === 'tree') rec.variant = 1 + ((abs.cellIX ^ abs.cellIY) & 3);
      if (kind === 'wreck') {
        rec.address = (((abs.cellIX * 7919) ^ (abs.cellIY * 104729)) >>> 0) % 1000;
      }
      // Rarity roll for the ring fill — the SAME roll a real deposit gets, so
      // the provisioned home holds the occasional better find. Seeded off the
      // cell (never Math.random) and FROZEN into the record, so a rebuild
      // reproduces the same rock at the same tier — the world must not re-roll
      // itself. Legacy records carry no tier and fall back to the plain
      // starter shape in _starterHomeObject.
      if (!plain && (kind === 'rock' || kind === 'tree')) {
        const rollRng = WorldGen.makeRng(
          ((abs.cellIX * 73856093) ^ (abs.cellIY * 19349663)) >>> 0);
        if (kind === 'rock') {
          // Exactly a residential surface deposit's odds (~90% plain, then
          // the ore-subset weights — WorldGen.rollSurfaceRockTier).
          const t = WorldGen.rollSurfaceRockTier(rollRng);
          if (t.yieldTier > 1) { rec.yieldTier = t.yieldTier; rec.requiredTier = t.requiredTier; }
        } else {
          // Trees have no tier table, so they borrow the deposits' rarity
          // SHAPE: the same ~10% that would have rolled ore instead grows a
          // size up — mostly medium (Wood-axe pine, 2× wood), rarely large
          // (Copper axe, 4×). Species stays the home softwood, so the find is
          // a bigger payday, not a wall.
          const r = rollRng();
          const plainP = WorldGen.SURFACE_PLAIN_ROCK_P ?? 0.90;
          if (r >= plainP) rec.size = (r >= 1 - (1 - plainP) * 0.3) ? 'large' : 'medium';
        }
      }
      taken.add(key(best.cx, best.cy));
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) crowded.add(key(best.cx + dx, best.cy + dy));
      }
      placed.push(rec);
      return true;
    };

    // The token pair goes in the pocket; everything else in the ring outside
    // it. The tokens are NOT conditional on the quota still being short: the
    // pocket is deliberately cleared of trees and rocks, so a spawn in dense
    // woodland can satisfy the whole quota out in the ring and still leave a
    // player at their own front door with nothing in sight to chop or mine.
    // If the quota did still want one, the token counts toward it.
    const POCKET = HomeArea.POCKET_CELLS;
    const TOKEN0 = HomeArea.TOKEN_MIN_CELLS;
    const R0 = HomeArea.RING_MIN_CELLS, R1 = HomeArea.RING_MAX_CELLS;
    // Widen the search when the band can't take something. A spawn on a pier or
    // a riverbank has most of its ring in water; an all-water spawn used to
    // seat nothing at all, leaving no wreck to rebuild and the ladder
    // unfinishable. Built lazily — the wide band is only paid for if needed.
    let wideCells = null;
    const seatOrWiden = (kind, cells, bearing, plain) => {
      if (seatAt(kind, cells, bearing, plain)) return true;
      if (!wideCells) wideCells = bandCells(R0, HomeArea.RING_MAX_ESCALATED_CELLS);
      return seatAt(kind, wideCells, bearing, plain);
    };
    const pocketCells = bandCells(TOKEN0, POCKET);
    // Opposite sides of the doorway, so one doesn't hide behind the other.
    // Seated PLAIN (no rarity roll): these are the examples the first two
    // lessons are performed on, so they must stay bare-hands workable.
    let tokensWanted = 0, tokensSeated = 0;
    if (plan.tokens.tree) {
      tokensWanted++;
      if (seatOrWiden('tree', pocketCells, 0, true)) { tokensSeated++; plan.need.tree = Math.max(0, plan.need.tree - 1); }
    }
    if (plan.tokens.rock) {
      tokensWanted++;
      if (seatOrWiden('rock', pocketCells, Math.PI, true)) { tokensSeated++; plan.need.rock = Math.max(0, plan.need.rock - 1); }
    }
    const ringCells = bandCells(R0, R1);
    // The way down, seated in the RING and seated FIRST. It's a landmark, not
    // scenery: one of a hundred entries in the round-robin below would get
    // whatever cell was left over after the trees and rocks had their pick,
    // which for a hemmed-in spawn means the far end of the escalated band.
    // Taking its cell before the queue runs keeps it a short walk out.
    // Its own bearing (due north) so it doesn't land in the same
    // neighbourhood as the token pair or read as part of the scenery.
    let ladderWanted = 0;
    if (plan.need.ladder > 0) {
      ladderWanted = 1;
      seatOrWiden('ladder', ringCells, -Math.PI / 2);
    }
    // Round-robin the kinds into the queue so the seating ORDER is fair — every
    // kind gets a pick of the good cells each round, instead of the last pool
    // taking whatever the first fifty seats left.
    //
    // The BEARING, though, comes from each item's index within its OWN pool,
    // never from its index in the queue. A queue-index bearing only spreads a
    // kind around the compass when every pool is the same size: round-robin
    // puts a SMALL pool entirely in the first rounds, so its items take the
    // first slice of the circle and nothing else. With six mushrooms against
    // fifty trees that is the whole quota of food in one wedge — the same
    // all-on-one-side bug the round-robin was added to fix, one level down.
    // Per-pool bearings walk each kind around the full circle on its own, and
    // the per-kind phase keeps two kinds from marching in lockstep on the same
    // bearings the whole way round.
    const KIND_PHASE = { tree: 0, rock: Math.PI / 2, wreck: Math.PI, mushroom: Math.PI * 1.5 };
    // atan2 (what a cell's own bearing is measured with) returns -PI..PI, and
    // seatAt's shortest-arc test assumes both sides are in that range.
    const wrapPi = (b) => b - 2 * Math.PI * Math.floor((b + Math.PI) / (2 * Math.PI));
    const pools = [['tree', plan.need.tree], ['rock', plan.need.rock],
                   ['wreck', plan.need.wreck], ['mushroom', plan.need.mushroom]];
    const queue = [];
    const totalWanted = pools.reduce((sum, [, count]) => sum + count, 0);
    for (let n = 0; queue.length < totalWanted; n++) {
      for (const [kind, count] of pools) {
        if (n >= count) continue;
        queue.push({ kind, bearing: wrapPi((2 * Math.PI * n) / count + KIND_PHASE[kind]) });
      }
    }
    for (const q of queue) seatOrWiden(q.kind, ringCells, q.bearing);
    const wanted = tokensWanted + ladderWanted + queue.length;

    // Freeze BOTH halves — what was added and what was tamed. Without the
    // second, a rebuild regenerates the naturals at full tier and the home
    // area silently gets harder. Passes accumulate: a top-up keeps everything
    // the earlier pass seated and adds only what it could not reach then.
    for (const rec of placed) { delete rec.cx; delete rec.cy; }
    const prev = this.save.starterHome;
    this.save.starterHome = {
      v: 1,
      placed: (prev && prev.placed ? prev.placed : []).concat(placed),
      tamed: [...new Set((prev && prev.tamed ? prev.tamed : []).concat(tamed))],
      // Everything this pass set out to seat actually found a cell, so there
      // is nothing for a later pass to finish.
      done: placed.length >= wanted,
      tries: ((prev && prev.tries) || 0) + 1,
    };
    for (const rec of placed) inject(rec);
    if (typeof persistSave === 'function') persistSave(this.save);
  }

  // Cave fauna: hostile wandering MONSTERS on CAVE_FLOOR cells (depth > 0).
  // Unlike surface animals these stalk the player and drain energy in range
  // (see wanderCreatures + MONSTERS). Eligible kinds are gated by depth
  // (MONSTERS.minDepth) and drawn from a weighted bag, so deeper levels mix in
  // tougher foes; density rises gently with depth. Ids are stable + seeded so a
  // defeated monster (recorded in save.caught) stays dead across reloads, just
  // like surface fauna.
  spawnCaveCreatures(entry, tx, ty, depth) {
    const rng = WorldGen.makeRng((tx * 0x2c1b3a5f ^ ty * 0x9e3779b1 ^ depth * 0x85ebca77) >>> 0);
    const N = entry.cellsPerEdge;
    const creatures = [];
    // Weighted bag of the kinds that may appear at this depth.
    const bag = [];
    for (const [kind, m] of Object.entries(MONSTERS)) {
      if (depth >= m.minDepth) for (let w = 0; w < (m.weight || 1); w++) bag.push(kind);
    }
    if (!bag.length) { entry.creatures = creatures; return; }
    // Anchor spawns near the up-staircases (where the player enters) so
    // monsters are immediately visible rather than scattered across the
    // ~229×229 cell tile. A level has an up-stair at EVERY surface entrance
    // (and the player may descend any of them), so anchor around ALL of them —
    // the old single-anchor (`find` → first stair) left every other entrance
    // monster-free, and with the underground torch bubble only ~2 cells wide
    // the far-away swarm was never seen ("I never see monsters underground").
    // Falls back to the tile centre when no staircase exists on this tile.
    const cellSizeM = entry.tileEdgeM / N;
    const anchors = (entry.objects || [])
      .filter(o => o.kind === 'staircase' && o.dir === 'up')
      .map(s => ({
        lix: Math.floor((s.x - tx * entry.tileEdgeM) / cellSizeM),
        liy: Math.floor((s.y - ty * entry.tileEdgeM) / cellSizeM),
      }));
    if (!anchors.length) anchors.push({ lix: Math.floor(N / 2), liy: Math.floor(N / 2) });
    const SPAWN_R = 25; // cells — fills 2–3 screens worth around each entry point
    const randCell = () => {
      const a = anchors[Math.floor(rng() * anchors.length)];
      return {
        cx: a.lix + Math.round((rng() - 0.5) * 2 * SPAWN_R),
        cy: a.liy + Math.round((rng() - 0.5) * 2 * SPAWN_R),
      };
    };
    // TOTAL population matches the old single-stair tuning, regardless of how
    // many up-staircases this tile has — anchors.length only widens WHERE
    // spawns land (randCell already picks a random anchor per creature), so a
    // stair-dense tile spreads the same population across more entrances
    // instead of multiplying it. This used to multiply the count by
    // anchors.length too, which quietly doubled (or tripled) the population
    // on any tile with more than one up-staircase — the common case, since
    // each residential cluster rolls its own staircase independently (~30%
    // odds each), so 2 anchors on a tile is typical, not an edge case.
    // The 160 cap is a dead-but-harmless safety net at today's depths — keep
    // it in case a much deeper level or a MONSTERS-table change changes that.
    const count = Math.min(160, 50 + depth * 10);
    for (let i = 0; i < count; i++) {
      const kind = bag[Math.floor(rng() * bag.length)];
      for (let attempt = 0; attempt < 20; attempt++) {
        const { cx, cy } = randCell();
        if (cx < 0 || cy < 0 || cx >= N || cy >= N) continue;
        if (entry.grid[cy * N + cx] !== 24 /* CAVE_FLOOR */) continue;
        const id = `mon_${kind}_${depth}_${tx}_${ty}_${i}`;
        if (this.save.caught.includes(id)) break;   // already defeated — stays dead
        const wmx = tx * this.tileEdgeM + (cx + 0.5) * cellSizeM;
        const wmy = ty * this.tileEdgeM + (cy + 0.5) * cellSizeM;
        creatures.push({ x: wmx, y: wmy, kind, id });
        break;
      }
    }
    // Rabbits: also anchored near the staircases, spread the same way — not
    // multiplied by anchor count, for the same reason as `count` above.
    const rabbitN = 10 + Math.floor(rng() * 8);
    for (let i = 0; i < rabbitN; i++) {
      for (let attempt = 0; attempt < 20; attempt++) {
        const { cx, cy } = randCell();
        if (cx < 0 || cy < 0 || cx >= N || cy >= N) continue;
        if (entry.grid[cy * N + cx] !== 24 /* CAVE_FLOOR */) continue;
        const id = `rabbit_${depth}_${tx}_${ty}_${i}`;
        if (this.save.caught.includes(id)) break;   // already caught — stays gone
        const wmx = tx * this.tileEdgeM + (cx + 0.5) * cellSizeM;
        const wmy = ty * this.tileEdgeM + (cy + 0.5) * cellSizeM;
        creatures.push({ x: wmx, y: wmy, kind: 'rabbit', id });
        break;
      }
    }
    entry.creatures = creatures;
  }

  // Dark-outlined, solid-filled arrow triangle (facing indicator + pairy
  // compass both draw this onto facingGfx).
  _drawArrowTriangle(g, tx, ty, blx, bly, brx, bry, outlineAlpha, fillColor) {
    g.lineStyle(2, 0x000000, outlineAlpha);
    g.beginPath();
    g.moveTo(tx, ty);
    g.lineTo(blx, bly);
    g.lineTo(brx, bry);
    g.closePath();
    g.strokePath();
    g.fillStyle(fillColor, 1);
    g.fillTriangle(tx, ty, blx, bly, brx, bry);
  }

  // Edge compass: an arrow parked on the rim of the viewport pointing at a
  // world-space target. Three callers share it — the pairy chest compass, the
  // delivery waypoint, and the starter-crate trail — so the ring geometry
  // lives here once instead of being re-derived (identically) at each site.
  // Returns the distance to the target in metres so callers can decide when
  // "close enough" retires their arrow.
  //
  // Draws NOTHING for a target already inside the viewport (see below). That
  // is deliberately here and not at the call sites: it is a fact about what an
  // edge compass is for, not a policy any one caller owns, and the callers'
  // own retire rules (the delivery waypoint's 1.2 cells, the starter arrow's
  // 1.5) are about clearing their STATE, which still happens on their own
  // terms. The return value is unchanged either way, so that logic is
  // untouched.
  _drawEdgeCompass(targetWX, targetWY, fillColor, outlineAlpha = 0.85) {
    const pWX = this.startWorldM.x + this.playerM.x;
    const pWY = this.startWorldM.y + this.playerM.y;
    const dxM = targetWX - pWX, dyM = targetWY - pWY;
    const mag = Math.hypot(dxM, dyM);
    if (!(mag > 0.001)) return mag;
    const ux = dxM / mag, uy = dyM / mag;
    const dist = Math.min(this.viewSize / 2 - 18, 140);
    // An edge compass is for a target you CANNOT SEE. Once the target's own
    // cell is inside the masked map rect, the arrow stops being a bearing and
    // becomes clutter parked on the world — and because it parks on a FIXED
    // ring (dist, ~4.4 cells) while the target slides in toward it, the two
    // meet: the compass triangle lands squarely on the first supply crate on the
    // opening screen, hiding the very thing it is pointing at, and pointing
    // past it. Reproduced at 390×844, 360×640 and 768×1024 on a fresh save.
    //
    // Half a cell of inset so a target sitting right on the mask edge — drawn
    // half-clipped, easy to miss — still gets its arrow.
    const sx = ((targetWX - pWX) / this.cellM) * CELL_PX;
    const sy = ((targetWY - pWY) / this.cellM) * CELL_PX;
    const half = this.viewSize / 2 - CELL_PX / 2;
    if (Math.abs(sx) <= half && Math.abs(sy) <= half) return mag;
    const tipX = this.viewCenterX + ux * dist, tipY = this.viewCenterY + uy * dist;
    // Perpendicular to the bearing gives the triangle's base.
    const pxN = -uy, pyN = ux;
    const back = 14, halfW = 7;
    this._drawArrowTriangle(this.facingGfx, tipX, tipY,
      tipX - ux * back + pxN * halfW, tipY - uy * back + pyN * halfW,
      tipX - ux * back - pxN * halfW, tipY - uy * back - pyN * halfW,
      outlineAlpha, fillColor);
    return mag;
  }

  // The nearest starter supply crate the player has not opened yet, or null.
  // The crate trail (see _placeStarterTrail) is seeded along the road out to
  // 15 cells, but the viewport is only VIEW_CELLS across — so most of the
  // trail spawns off-screen, and without a bearing the "follow the breadcrumbs"
  // onboarding is unfollowable. Ids are stamped `chest_start_*` at placement,
  // which is what distinguishes them from ordinary POI chests.
  _nearestStarterCrate() {
    const opened = setOf(this.save.opened);
    const pWX = this.startWorldM.x + this.playerM.x;
    const pWY = this.startWorldM.y + this.playerM.y;
    let best = null, bestD2 = Infinity;
    for (const e of WorldGen.tileCache.values()) {
      for (const o of (e.objects || [])) {
        if (o.kind !== 'chest' || !o.id) continue;
        if (!String(o.id).startsWith('chest_start_')) continue;
        if (opened.has(o.id)) continue;
        const dx = o.x - pWX, dy = o.y - pWY;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; best = o; }
      }
    }
    return best;
  }

  // Where the green starter arrow points for the ACTIVE ladder step: the space
  // the chip is actually talking about, not a generic breadcrumb.
  //
  //   chest   → nearest unopened starter crate (the relic chest included)
  //   till    → the carved 2x2 starter plot
  //   plant   → the tilled-but-empty soil — or the crates while the bag holds
  //             no seed, since the seeds are in them (nearest crate first)
  //   restore → the nearest wreck — or the crates while the bag can't pay the
  //             restore cost, since the materials are in them
  //   harvest → the nearest crop the player planted
  //   sell    → Home (selling only happens there)
  //
  // Every step past "Break ground" used to fall back to the crates. That read
  // fine while the crates spread across the whole walk, but once they packed
  // into its first few cells (TRAIL_SPAN) a player opened all four early —
  // leaving the RELIC CHEST as the only unopened `chest_start_*`, a full
  // screen away. So for most of the ladder the one arrow on screen pointed at
  // the horizon while the chip asked them to tap their soil, their crop, a
  // wreck or their own house, all of which are near spawn: the arrow did not
  // point at the intended space. Each unresolvable target still falls back to
  // the crates, which remain worth collecting.
  _starterGuidanceGoal(step) {
    const sv = this.save;
    const pWX = this.startWorldM.x + this.playerM.x;
    const pWY = this.startWorldM.y + this.playerM.y;
    const nearest = (pts) => {
      let best = null, bestD2 = Infinity;
      for (const p of pts) {
        if (!p || !Number.isFinite(p.x)) continue;
        const dx = p.x - pWX, dy = p.y - pWY, d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; best = p; }
      }
      return best;
    };
    // starterPlotAt is the top-left cell centre; aim at the 2x2's middle.
    const plotMiddle = () => (sv.starterPlotAt && Number.isFinite(sv.starterPlotAt.x))
      ? { x: sv.starterPlotAt.x + this.cellM / 2, y: sv.starterPlotAt.y + this.cellM / 2 }
      : null;
    switch (step.event) {
      case 'till':
        return plotMiddle() || this._nearestStarterCrate();
      case 'plant': {
        // An empty seed pocket means the crates are the step's real errand —
        // the nearest one is seeded first (STARTER_LOOT's order of need).
        const hasSeed = (sv.inv || []).some(s =>
          s && (s.count || 0) > 0 && ITEM_BY_ID[s.id]?.kind === 'seed');
        if (!hasSeed) return this._nearestStarterCrate() || plotMiddle();
        // The soil the chip says to tap: tilled cells nothing is planted in.
        const plantedCells = new Set((sv.planted || []).map(p => {
          const c = worldMetersToAbsCell(this, p.x, p.y);
          return cellKeyFromAbsCell(c.cellIX, c.cellIY);
        }));
        const open = [];
        for (const key of (this.tilledSet || [])) {
          if (plantedCells.has(key)) continue;
          const [ix, iy] = key.split('_').map(Number);
          open.push(absCellCenterMeters(this, ix, iy));
        }
        return nearest(open) || plotMiddle() || this._nearestStarterCrate();
      }
      case 'restore': {
        // While the bag can't pay a wreck's flat restore price and crates
        // remain unopened, the materials are in the crates — point there.
        const cost = this._wreckRestoreCost(null);
        if (Inventory.count(sv, cost.id) < cost.qty) {
          const crate = this._nearestStarterCrate();
          if (crate) return crate;
        }
        const wrecks = [];
        for (const e of WorldGen.tileCache.values()) {
          for (const o of (e.objects || [])) {
            if (this._isHouseWreck(o)) wrecks.push(o);
          }
        }
        return nearest(wrecks) || this._nearestStarterCrate();
      }
      case 'harvest':
        return nearest(sv.planted || []) || this._nearestStarterCrate();
      case 'sell': {
        // Home is the trailer at the frozen trail anchor; startWorldM until a
        // home capture moved it (same resolution rule as _slimeFreeZone).
        const a = (sv.starterCratesAt && Number.isFinite(sv.starterCratesAt.x))
          ? sv.starterCratesAt : this.startWorldM;
        return (a && Number.isFinite(a.x)) ? { x: a.x, y: a.y } : this._nearestStarterCrate();
      }
      default:
        return this._nearestStarterCrate();
    }
  }

  // === Tick ===
  update(_, dtMs) {
    // The whole per-frame body runs inside a try/catch — INCLUDING the boot
    // and modal-gate prologue, which used to sit before the try and was the
    // one per-frame stretch where a throw could still kill the loop. Phaser's
    // RAF driver reschedules the NEXT frame only AFTER this callback returns
    // (see RequestAnimationFrame.step in vendor/phaser.js), so a single
    // uncaught throw in here would permanently kill the game loop — frozen
    // render plus a dead input plugin, i.e. "the UI stops accepting taps."
    // Swallowing a bad frame keeps the loop (and taps) alive; _reportLoopError
    // surfaces the error so the underlying cause stays diagnosable on a phone.
    try {
    // First frame = the world is on screen. The boot overlay itself now waits
    // on the initial tile load rather than this frame (see create() /
    // _bootOverlayGone) — this flag only times the icon prewarm below.
    if (!this._bootStatusDone) {
      this._bootStatusDone = true;
      // Prewarm the modal-only icon sheets once the boot rush is over — 4s
      // gives the first map tiles and Phaser's own assets first claim on the
      // connection. See IconNet for why (treasure-modal icons were blank for
      // the whole first-fetch on slow lines).
      if (!window.__TEST_MODE) setTimeout(() => this._prewarmModalIcons(), 4000);
    }
    // Keep body.modal-open honest. The MutationObserver in
    // _installModalPadGate misses an overlay that is REMOVED from the document
    // (the story and safety cards are), and a latched class hides the entire
    // bottom HUD. This is only a backstop for that case, and the sync forces a
    // style/layout flush (getClientRects on every .game-modal), so it runs on
    // a ~10-frame throttle rather than every frame — a removed overlay
    // un-latches within ~170 ms, which the eye reads as instant.
    this._modalGateTick = (this._modalGateTick || 0) + 1;
    if (this._modalGateTick % 10 === 0) this._syncModalGate?.();
    const dt = dtMs / 1000;
    // Dragon powder is a 1-minute timed buff (this._dragonUntil, in-memory —
    // NOT persisted, so a refresh ends it). It's no longer a movement MODE:
    // a dragon walks the same way everyone walks, just with a tier-8 amulet's
    // legs (DRAGON_AMULET_TIER, see _walkRelics) and double damage. All the
    // edge does is swap the sprite skin; the countdown label is refreshed
    // every frame below.
    const dragonActive = this.isDragonActive();
    if (this._dragonBuffActive !== dragonActive) {
      this._dragonBuffActive = dragonActive;
      this._applyDragonSkin(dragonActive);
      if (!dragonActive) this.dragonTimerText.setVisible(false);
    }
    if (dragonActive) {
      const secs = Math.max(0, Math.ceil((this._dragonUntil - Date.now()) / 1000));
      this.dragonTimerText
        .setText(`${secs}s`)
        .setPosition(this.viewCenterX, this.viewCenterY - 34)
        .setVisible(true);
    }
    let vx = 0, vy = 0;
    const k = this.keys;
    let wasd = false;
    if (k.A.isDown) { vx -= 1; wasd = true; }
    if (k.D.isDown) { vx += 1; wasd = true; }
    if (k.W.isDown) { vy -= 1; wasd = true; }
    if (k.S.isDown) { vy += 1; wasd = true; }
    // WASD and arrow keys move at the same speed: DEBUG_SPEED_MUL × walk speed
    // for fast debug travel (gated on DEBUG). Kept in sync so the two keyboard
    // schemes feel identical.
    let speedMul = 1;
    if (DEBUG) {
      if (wasd) speedMul = DEBUG_SPEED_MUL;
      if (k.LEFT.isDown)  { vx -= 1; speedMul = DEBUG_SPEED_MUL; }
      if (k.RIGHT.isDown) { vx += 1; speedMul = DEBUG_SPEED_MUL; }
      if (k.UP.isDown)    { vy -= 1; speedMul = DEBUG_SPEED_MUL; }
      if (k.DOWN.isDown)  { vy += 1; speedMul = DEBUG_SPEED_MUL; }
    }
    // Keyboard movement (WASD / arrow keys) is a manual takeover — any non-zero
    // value here means the player is driving themselves, so latch off GPS for
    // the rest of the session. The movement STICK is not a takeover: it walks
    // you off the GPS while the GPS keeps tracking you (see _steerManual /
    // _manualOffsetM).
    if (vx || vy) this.disableGpsForSession();
    if (this._fastWalk) speedMul = 25;
    // The movement stick — always on screen, always live.
    const stick = (this._movePadHeld && this.joystickVec) ? this.joystickVec : null;
    // ONE movement model, at every depth and under every buff (see
    // _steerTarget / _followStep): inputs and GPS fixes move a free-flying
    // TARGET, and the opaque body — still this.playerM, so the camera and the
    // reach/tap origin stay on it — walks toward it. Underground it mines
    // through any wall in the way; on the surface nothing blocks, so it's a
    // plain walk toward the target.
    // Stick → walk yourself off the GPS (costs stamina, amulet-scaled).
    if (stick && (stick.x || stick.y)) this._steerManual(stick.x, stick.y, dt);
    // Stick idle for a few seconds → walk back to where you really are.
    else this._driftHome(dt);
    // Keyboard → steer the target directly, free, no offset.
    this._steerTarget(vx, vy, speedMul, dt);
    this._followStep(dt);

    // Exhaustion underground: hit 0 energy below the surface and you black out
    // and wake up top-side. Guarded so the modal fires once, and skipped in
    // tests (which drive energy directly and don't want a DOM modal).
    if (this.depth > 0 && (this.save.energy ?? 0) <= 0
        && !this._passingOut && !window.__TEST_MODE) {
      this._passOutToSurface();
    }

    // (Underground rock-wall collision is handled per-frame inside
    // _followStep, which steps the body toward the target and mines any wall
    // in the way — see the target-follow branch above.)

    // Walk-target marker: show where the body is headed whenever the target has
    // pulled away from it (underground: trailing / mining; on the surface: the
    // GPS says you're over there and the body is still catching up). When the
    // two are basically coincident — arrived — keep it hidden so nothing
    // diverges. The surface threshold is far looser: a GPS fix jitters a few
    // metres every second even when the player is standing still, and a marker
    // strobing on and off with the noise is worse than no marker.
    const markerDiv = this.cellM * (this.depth > 0 ? 0.5 : 3);
    if (this._targetM) {
      const gdx = this._targetM.x - this.playerM.x;
      const gdy = this._targetM.y - this.playerM.y;
      const diverged = (gdx * gdx + gdy * gdy) > markerDiv ** 2;
      if (diverged) {
        const p = worldMetersToScreen(this,
          this.startWorldM.x + this._targetM.x,
          this.startWorldM.y + this._targetM.y);
        this.targetGhost.setPosition(Math.round(p.x), Math.round(p.y + this.playerFeetNudgeY)).setVisible(true);
      } else {
        this.targetGhost.setVisible(false);
      }
    } else if (this.targetGhost.visible) {
      this.targetGhost.setVisible(false);
    }

    // GPS ghost: where you REALLY are, whenever the character isn't standing
    // there. One cell of slack keeps it off screen for ordinary GPS jitter (a
    // fix wanders a few metres while you stand still) so it appears only when
    // the stick has genuinely walked you off your position. Surface only —
    // underground the fix isn't where you are in any useful sense.
    if (this.gpsM && this.depth === 0) {
      const rdx = this.gpsM.x - this.playerM.x;
      const rdy = this.gpsM.y - this.playerM.y;
      if ((rdx * rdx + rdy * rdy) > this.cellM ** 2) {
        const g = worldMetersToScreen(this,
          this.startWorldM.x + this.gpsM.x,
          this.startWorldM.y + this.gpsM.y);
        this.gpsGhost.setPosition(Math.round(g.x), Math.round(g.y + this.playerFeetNudgeY)).setVisible(true);
      } else {
        this.gpsGhost.setVisible(false);
      }
    } else if (this.gpsGhost.visible) {
      this.gpsGhost.setVisible(false);
    }
    this._drawWalkHomeHint(dt);
    this._updatePlayerAura();

    // Heartbeat the "last seen" timestamp every frame. In-memory only — the
    // save object is mutated by reference, so the next persistSave (or the
    // pagehide flush in save.js) carries it. This bounds offline-rest drift
    // to at most one frame if the tab dies without firing visibilitychange.
    this.save.lastSeenAt = Date.now();

    // Indoor resting: standing on a building cell slowly fills the bar.
    // Float accumulator avoids per-frame integer churn — we only bump
    // save.energy + refresh the DOM when a whole pip has accrued. Test mode
    // skips this so deterministic test runs don't see energy creep.
    if (!window.__TEST_MODE) {
      const pWX = this.startWorldM.x + this.playerM.x;
      const pWY = this.startWorldM.y + this.playerM.y;
      const here = this.cellAt(pWX, pWY);
      const indoors = here.loaded && BUILDING_TYPES.has(here.type);
      // Resting at Home fills the bar much faster (HOME_FULL_REST_S) than any
      // other building. atHome also lets a synthetic trailer count as a rest
      // spot — it paints no building cell underneath, so `indoors` is false
      // there (see ensureStarterTrailerObject + isRestingAtHome).
      const atHome = this.isRestingAtHome(pWX, pWY, indoors);
      const maxE = this.getMaxEnergy();
      if ((indoors || atHome) && (this.save.energy ?? 0) < maxE) {
        const restS = atHome ? HOME_FULL_REST_S : INDOOR_FULL_REST_S;
        this._accrueRestEnergy('_restAccrueE', maxE * (dt / restS), maxE);
      } else {
        // Stopped resting — flush any unsplashed accumulation so the last few
        // points of a short rest still register.
        if (this._restSplashAccum > 0) {
          this._splashEnergyGain(this._restSplashAccum);
          this._restSplashAccum = 0;
        }
        this._restAccrueE = 0;
      }
      // Campfire warmth: standing within FIRE_REST_R cells of a lit fire slowly
      // restores energy — the same accumulator trick as indoor rest, but it
      // works outdoors and is slower (FIRE_FULL_REST_S). Independent of the
      // indoor/home rest above; a fire can't sit on a building cell so the two
      // rarely overlap.
      if ((this.save.energy ?? 0) < maxE) {
        if (this._nearAny('fires', pWX, pWY, FIRE_REST_R)) {
          this._accrueRestEnergy('_fireAccrueE', maxE * (dt / FIRE_FULL_REST_S), maxE);
        } else {
          this._fireAccrueE = 0;
        }
      }
      // Stepping on a named path stone claims it. Memoised by absolute cell
      // index so we only do the lookup once per cell-change — without this
      // every frame inside the same cell would re-walk the pathNames map.
      // Derive tile coords from the body position directly.
      if (here.loaded && here.type === 8 /* PATH */) {
        const { cellIX, cellIY } = worldMetersToAbsCell(this, pWX, pWY);
        const key = `${cellIX},${cellIY}`;
        if (this._lastPathStepKey !== key) {
          this._lastPathStepKey = key;
          const ctx = Math.floor(pWX / this.tileEdgeM);
          const cty = Math.floor(pWY / this.tileEdgeM);
          this._activatePathStone(ctx, cty, cellIX, cellIY);
        }
      } else if (this._lastPathStepKey != null) {
        this._lastPathStepKey = null;
      }
    }

    // Facing-direction indicator: yellow triangle arrow at the player's head,
    // pointing in the compass heading (or last movement, as fallback).
    // Normally it rides the player's head at the viewport center. Underground,
    // while the target is out ahead leading the body through rock, the compass
    // rides the TARGET instead — the player is steering that, so the
    // device-orientation arrow belongs over it (targetGhost was positioned and
    // its visibility decided in the walk-target-marker block above). On the
    // surface the arrow stays on the player: up there the target is just the
    // GPS fix drifting a few metres about, not something being steered.
    this.facingGfx.clear();
    const fmag = Math.hypot(this.facing.x, this.facing.y);
    if (fmag > 0.001) {
      const fx = this.facing.x / fmag, fy = this.facing.y / fmag;
      // perpendicular for the base of the triangle
      const px = -fy, py = fx;
      // Arrow geometry, all measured from the anchor point so the whole shape
      // scales about it. SCALE 0.85 = 15% smaller than the sizes it was drawn
      // at before (tip 22 / base 14 / halfW 6).
      const SCALE = 0.85;
      const tip = 22 * SCALE; // distance from anchor to arrow tip
      const base = 14 * SCALE; // distance from anchor to arrow base midpoint
      const halfW = 6 * SCALE; // half-width of the base
      // Head offset: how far ABOVE the sprite's centre the arrow is anchored.
      // 0 sits it on the centre, negative nudges it below — it rode 2px high
      // once, and now sits 1px under centre, where it lines up with the art.
      const HEAD_DY = -1;
      let cx = this.viewCenterX, cy = this.viewCenterY - HEAD_DY;
      if (this.depth > 0 && this.targetGhost.visible) {
        // Anchor over the target marker's head. targetGhost sits at sprite-center
        // (p.y + playerFeetNudgeY); back out the nudge + the same head offset
        // used at the viewport center so the arrow hovers identically.
        cx = this.targetGhost.x;
        cy = this.targetGhost.y - this.playerFeetNudgeY - HEAD_DY;
      }
      const tx = cx + fx * tip, ty = cy + fy * tip;
      const blx = cx + fx * base + px * halfW, bly = cy + fy * base + py * halfW;
      const brx = cx + fx * base - px * halfW, bry = cy + fy * base - py * halfW;
      this._drawArrowTriangle(this.facingGfx, tx, ty, blx, bly, brx, bry, 0.85, 0xffd24a);
    }

    // Footprint trail. Each ~2m the player moves, fade existing dots by 10%
    // and drop a fresh one AT THE PLAYER'S CURRENT FEET. (Previously dropped
    // at the player's _previous_ position, which made the freshest dot trail
    // ~2m behind the sprite — the trail visibly started a body-length away
    // from the feet.) Starting alpha is 0.45 (was 0.65 — ~30% lower) so the
    // freshest dot reads as a soft press rather than ink.
    {
      const bodyM = this.playerM;
      const lp = this._lastFootprintM;
      const dx = bodyM.x - lp.x, dy = bodyM.y - lp.y;
      // First GPS fix can jump hundreds of meters from playerM=(0,0); skip the
      // single huge step so the inaugural footprint isn't dropped at world
      // origin. 200m = ~13 cells, well outside any normal walking gait.
      const tooFar = dx * dx + dy * dy > 200 * 200;
      if (tooFar) {
        this._lastFootprintM = { x: bodyM.x, y: bodyM.y };
      } else if (dx * dx + dy * dy >= 2 * 2) {
        for (const fp of this.footprints) fp.alpha *= 0.8;
        this.footprints.push({ x: bodyM.x, y: bodyM.y, alpha: 0.45 });
        // Cap at 5 so the trail stays short — the 20%/step fade alone would
        // keep ~11 dots alive before they drop below visibility.
        if (this.footprints.length > 5) this.footprints.splice(0, this.footprints.length - 5);
        this._lastFootprintM = { x: bodyM.x, y: bodyM.y };
      }
      this.footprintGfx.clear();
      // Camera anchor stays on playerM, so footprints drawn at body world
      // coords land at the body's screen offset.
      const pWX = this.startWorldM.x + this.playerM.x;
      const pWY = this.startWorldM.y + this.playerM.y;
      for (const fp of this.footprints) {
        const sx2 = this.viewCenterX + ((fp.x + this.startWorldM.x - pWX) / this.cellM) * CELL_PX;
        // +14 lands the dot right at the sprite's feet. (Sprite scale 1.35 × 32
        // ≈ 43, origin (.5,.5) so the sprite's nominal bottom is ~+22, but the
        // visible foot pixels sit several px above the bottom of the texture —
        // +14 lines up with where the shoes actually meet the ground.)
        const sy2 = this.viewCenterY + ((fp.y + this.startWorldM.y - pWY) / this.cellM) * CELL_PX + 14;
        this.footprintGfx.fillStyle(0x000000, fp.alpha);
        this.footprintGfx.fillCircle(Math.round(sx2), Math.round(sy2), 3);
      }
    }

    // Pairy chest-compass indicator. Active for 5 minutes after eating a pairy
    // (see eatSelected). Renders a magenta arrow at the viewport edge pointing
    // toward the nearest undiscovered chest, blinking at 1 Hz. Cleared once
    // the chest is opened (target appears in save.opened) or the timer expires.
    if (this.pairyCompass) {
      const opened = setOf(this.save.opened);
      const expired = Date.now() >= this.pairyCompass.until;
      const claimed = opened.has(this.pairyCompass.targetId);
      if (expired || claimed) {
        this.pairyCompass = null;
      } else {
        // Blinks at 1 Hz to distinguish it from the solid delivery arrow.
        if (Math.floor(Date.now() / 500) % 2 === 0) {
          this._drawEdgeCompass(this.pairyCompass.x, this.pairyCompass.y, 0xc77dff, 0.8);
        }
      }
    }

    // Delivery waypoint — a solid WHITE arrow at the viewport edge pointing at
    // the house the player picked from the delivery menu (openDeliveryMenu).
    // Same edge-compass geometry as the pairy arrow but persistent (no blink),
    // cleared once the player arrives or the house is satisfied for the day.
    if (this.deliveryCompass) {
      const dayKey = this._deliveryDayKey();
      const satisfied = this.save.houseSatisfied?.[this.deliveryCompass.id] === dayKey;
      const pWX = this.startWorldM.x + this.playerM.x;
      const pWY = this.startWorldM.y + this.playerM.y;
      const mag = Math.hypot(this.deliveryCompass.x - pWX, this.deliveryCompass.y - pWY);
      if (satisfied || mag < this.cellM * 1.2) {
        this.deliveryCompass = null;
      } else {
        this._drawEdgeCompass(this.deliveryCompass.x, this.deliveryCompass.y, 0xffffff, 0.9);
      }
    }

    // Starter guidance — a LIGHT-GREEN arrow toward whatever the ACTIVE ladder
    // step actually wants, shown only while the first-session ladder is
    // running. Green is the tutorial's colour: the chip's step tag, the
    // step-complete toast and this arrow all wear --green (#a7ffb0), so
    // everything the ladder owns reads as one system — and the arrow can't be
    // confused with the gold facing triangle on the player.
    //
    // The target is PER-STEP (see _starterGuidanceGoal): the crates while the
    // chip says to open one, the carved plot for "Break ground", and the
    // tilled soil / the nearest wreck / the crop / Home for the steps that
    // happen at those places. Everything past step 2 used to fall back to the
    // nearest unopened `chest_start_*`, which — once the crates packed into
    // the first few cells of the walk (TRAIL_SPAN) — was the relic chest a
    // screen away for the whole rest of the ladder: the one arrow on screen
    // led AWAY from the space the chip was asking the player to tap.
    //
    // Retires itself the moment the ladder finishes or is dismissed, and stops
    // pointing once the player is on top of the target (it is in reach by
    // then, and the arrow would only cover the sprite).
    if (this.depth === 0 && typeof Quests !== 'undefined' && !Quests.starterHidden(this.save)) {
      const step = Quests.starterCurrent(this.save);
      // Memoise the goal on a 500 ms clock. _starterGuidanceGoal walks every
      // object in every cached tile (crates, wrecks) — fine as a tap-time
      // query, far too heavy per frame, and it ran per frame for the entire
      // tutorial. The goal only moves when the player acts or walks; half a
      // second of arrow staleness is imperceptible.
      const gNow = performance.now();
      if (!this._starterGoalMemo || gNow - this._starterGoalMemo.t > 500 ||
          this._starterGoalMemo.event !== (step && step.event)) {
        this._starterGoalMemo = {
          t: gNow,
          event: step && step.event,
          goal: step ? this._starterGuidanceGoal(step) : null,
        };
      }
      const goal = this._starterGoalMemo.goal;
      if (goal) {
        const pWX = this.startWorldM.x + this.playerM.x;
        const pWY = this.startWorldM.y + this.playerM.y;
        if (Math.hypot(goal.x - pWX, goal.y - pWY) > this.cellM * 1.5) {
          this._drawEdgeCompass(goal.x, goal.y, 0xa7ffb0, 0.9);
        }
      }
    }

    if (!this._lastCheckM ||
        Math.hypot(this.playerM.x - this._lastCheckM.x, this.playerM.y - this._lastCheckM.y) > 20) {
      this._lastCheckM = { ...this.playerM };
      this.ensureTilesAround().catch(() => {});
    }

    // Watering + harvesting are still tap-driven. STAGE ADVANCEMENT, however,
    // auto-fires once the per-stage hold has elapsed since the last watering —
    // including for plants that grew while the player was away (offscreen,
    // app closed, tab backgrounded). Cheap: O(plants), tick once a second.
    this._lastGrowthTick = this._lastGrowthTick || 0;
    if (performance.now() - this._lastGrowthTick > 1000) {
      this._lastGrowthTick = performance.now();
      this.advanceGrowth();
    }

    this.wanderCreatures();
    // Fight tick — bow/staff auto-fire, shots in flight, sword auto-engage.
    // Runs AFTER the creatures have moved (so shots resolve against where the
    // foes actually are this frame) and BEFORE the wheel, which is where melee
    // damage lands.
    this._combatTick(dt);
    this._revealFog();
    this.drawCells();
    this.drawRoadGeometry();
    this.drawObjects();
    this._drawWorkProgress();
    if (typeof Multiplayer !== 'undefined') Multiplayer.tick(this);
    this.updateHUD();
    } catch (e) {
      this._reportLoopError(e);
    }
  }

  // Funnel for exceptions thrown inside update(). Keeps the Phaser loop alive
  // (an escaped throw would stop the RAF reschedule and freeze the game + kill
  // input) while still surfacing the error: throttled console.error plus a
  // brief on-screen banner, since DevTools isn't reachable on a phone.
  _reportLoopError(e) {
    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    if (this._lastLoopErrAt && now - this._lastLoopErrAt < 3000) return;   // throttle a per-frame storm
    this._lastLoopErrAt = now;
    try { console.error('update() frame error (loop kept alive):', e); } catch (_) {}
    try {
      const msg = (e && (e.message || e.toString())) || 'frame error';
      const stack = (e && e.stack) || '';
      // Prefer the copyable error overlay (index.html) so the full message +
      // stack can be read/copied on a phone. Fall back to the transient
      // #banner flash only if the overlay isn't wired up.
      if (typeof window !== 'undefined' && typeof window.showError === 'function') {
        window.showError(`⚠ ${msg}`, stack);
      } else {
        const b = document.getElementById('banner');
        if (b) {
          b.textContent = `⚠ ${msg}`.slice(0, 80);
          b.style.display = 'block';
          clearTimeout(this._loopErrBannerT);
          this._loopErrBannerT = setTimeout(() => { b.style.display = 'none'; }, 4000);
        }
      }
    } catch (_) { /* never let error reporting itself throw */ }
  }

  // Scan save.planted and bump stage on any watered crop whose stage hold
  // (Crops.STAGE_HOLD_MS — 15 min) has elapsed. After each advance the crop needs re-watering, so
  // a single tick advances each plant by at most one stage; a long-idle
  // plant catches up over subsequent waterings, not all at once.
  advanceGrowth() {
    if (Crops.advanceGrowth(this.save)) persistSave(this.save);
  }

  // ── COMBAT ───────────────────────────────────────────────────────────────
  // Per-frame fight tick: pick up the enemies on screen, let the ACTIVE bow or
  // staff loose its shots along the compass, fly the shots already out, and —
  // if the sword is the active weapon — engage the nearest foe without being
  // asked. Only one of sword/bow/staff (save.activeWeapon) acts on its own
  // here at a time; the rest sit inert until switched to. The maths (what
  // counts as an enemy, damage per shot, shot flight) all lives in combat.js;
  // this method is the scene glue.
  _combatTick(dt) {
    const px = this.startWorldM.x + this.playerM.x;
    const py = this.startWorldM.y + this.playerM.y;
    const now = performance.now();
    // "On screen" = inside the drawn viewport, measured as a box rather than a
    // radius because the viewport IS a box: a foe in the corner is visible and
    // must count. Half a cell of margin so one stepping in at the edge starts
    // drawing fire the moment it appears rather than a cell later.
    const halfSpanM = (VIEW_CELLS / 2 + 0.5) * this.cellM;
    const enemies = [];
    // 3×3 neighbourhood + memoised caught-Set: this runs every frame, and the
    // all-tiles forEachItem with a per-creature Array.includes was an
    // O(cached-creatures × caught) scan that grew with every tile walked.
    // Cheap box cull first, membership test last.
    const caughtSet = setOf(this.save.caught);
    const pcTick = this.playerToWorldCell();
    WorldGen.forEachItemNear('creatures', pcTick.tx, pcTick.ty, (c) => {
      if (Math.abs(c.x - px) > halfSpanM || Math.abs(c.y - py) > halfSpanM) return;
      if (!Combat.isEnemy(c)) return;
      if (caughtSet.has(c.id)) return;
      enemies.push(c);
    });

    const relics = this.save.relics || {};
    // Dragon Powder doubles attack damage for its minute (same buff the melee
    // wheel reads), so a dragon's arrows hit twice as hard too.
    const dmgMul = this.isDragonActive() ? 2 : 1;

    // ── Bow / staff: one shot a second, along the COMPASS heading ──────────
    // They do not home and they do not pick a target: the shot goes where you
    // are facing, so aiming is turning. Firing is gated on an enemy being on
    // screen — otherwise every walk across town would be trailing arrows.
    // Only the ACTIVE weapon fires (save.activeWeapon) — an owned-but-inactive
    // bow or staff sits quiet, exactly like an owned-but-inactive sword doesn't
    // auto-engage below.
    if (enemies.length) {
      for (const slot of Combat.RANGED_SLOTS) {
        if (!relics[slot] || this.save.activeWeapon !== slot) continue;
        const due = this._nextShotT[slot];
        if (due == null) {
          // First sighting this weapon has been active for: arm the cadence
          // (phaseMs is 0 for both slots now that only one can ever fire).
          this._nextShotT[slot] = now + Combat.SHOT[slot].phaseMs;
          continue;
        }
        if (now < due) continue;
        // The staff draws energy per bolt (Combat.SHOT.staff.energyCost — the
        // price of its pierce + double punch). No energy → no bolt, SILENTLY:
        // an auto-firing weapon must not spam "too tired" (spendEnergy only
        // flashes when handed coordinates). The cadence is left due, so the
        // first bolt after a meal fires immediately.
        const eCost = Combat.SHOT[slot].energyCost || 0;
        if (eCost && !this.spendEnergy(eCost)) continue;
        this._nextShotT[slot] = now + Combat.FIRE_INTERVAL_MS;
        const shot = Combat.spawnShot(slot, px, py, this.facing, this.cellM,
                                      Combat.shotDamage(relics, slot) * dmgMul);
        if (shot) this._shots.push(shot);
      }
    } else {
      // Nothing to shoot at — re-arm, so the next foe to walk on screen is shot
      // at almost immediately instead of waiting out a cadence that has been
      // ticking away in an empty street.
      this._nextShotT = {};
    }

    if (this._shots.length) {
      // What stops an ARROW (staff bolts pierce and never consult this):
      // underground, cave rock — _cellBlocked is the SAME test the body walks
      // against, so what blocks you blocks your arrows; on the surface,
      // standing timber and stone — an unchopped tree or bush, an unbroken
      // mineral rock. The surface set is built lazily, once per tick, only
      // when a shot is actually in flight: stepShots samples the test every
      // half-cell of every shot, far too often for a per-sample object scan.
      let solidCells = null;
      const shotBlocked = (x, y) => {
        if (this._cellBlocked(x, y)) return true;
        if (this.depth !== 0) return false;
        if (!solidCells) {
          solidCells = new Set();
          const choppedSet = setOf(this.save.chopped);
          WorldGen.forEachItemNear('objects', pcTick.tx, pcTick.ty, (o) => {
            if (o.kind === 'tree' || o.kind === 'fruittree') {
              if (o.chopped || choppedSet.has(o.id)) return;
            } else if (o.kind === 'mineralrock') {
              if (this.brokenRockSet.has(o.id)) return;
            } else return;
            if (Math.abs(o.x - px) > halfSpanM * 2 || Math.abs(o.y - py) > halfSpanM * 2) return;
            const c = worldMetersToAbsCell(this, o.x, o.y);
            solidCells.add(c.cellIX + '_' + c.cellIY);
          });
        }
        const cc = worldMetersToAbsCell(this, x, y);
        return solidCells.has(cc.cellIX + '_' + cc.cellIY);
      };
      this._shots = Combat.stepShots(this._shots, dt, enemies,
        Combat.HIT_RADIUS_CELLS * this.cellM,
        (enemy, shot) => this._damageEnemy(enemy, shot.damage),
        { blocked: shotBlocked, cellM: this.cellM });
    }
    this._drawShots();

    // ── Sword: auto-engage ─────────────────────────────────────────────────
    // The sword being the ACTIVE weapon means you no longer have to tap the
    // slime that is already chewing on you: the nearest enemy IN REACH is
    // picked up on its own. A sword you still own but switched away from
    // (bow/staff active instead) does not — see the WEAPON_SLOTS note above.
    // The wheel is flagged `auto`, which is what keeps it from behaving
    // like a tapped action — it doesn't swallow taps, hold the body still, or
    // block the walk home (see _busyWheel).
    if (relics.sword && this.save.activeWeapon === 'sword' && !this._workProgress && enemies.length) {
      let best = null, bestD2 = Infinity;
      for (const c of enemies) {
        const fc = worldMetersToAbsCell(this, c.x, c.y);
        if (!cellInReach(this, fc.cellIX, fc.cellIY)) continue;
        const d2 = (c.x - px) * (c.x - px) + (c.y - py) * (c.y - py);
        if (d2 < bestD2) { bestD2 = d2; best = c; }
      }
      if (best) this.startCombat(best, { auto: true });
    }

    this._drawEnemyHealth(enemies);
  }

  // Shots in flight, drawn as a short streak along their own heading so the
  // direction they're travelling is legible at a glance (a dot would just read
  // as a floating pixel).
  _drawShots() {
    const g = this.projGfx;
    if (!g) return;
    g.clear();
    for (const s of this._shots) {
      const spec = Combat.SHOT[s.slot];
      const head = this.worldMetersToScreen(s.x, s.y);
      // Shots travel between FOOT positions (that's where the player and every
      // creature are anchored), but drawing them down at ankle height would
      // have them skim under the bodies they're hitting. Lift the streak to
      // roughly chest height so it leaves the archer and crosses the foe.
      const hx = Math.round(head.x), hy = Math.round(head.y) - SHOT_DRAW_LIFT_PX;
      if (spec.dotPx) {
        // The staff bolt is a fat glowing dot, not a streak — a bolt reads as
        // a thrown thing, an arrow as a flying line.
        g.fillStyle(spec.color, 0.95);
        g.fillCircle(hx, hy, spec.dotPx);
        g.lineStyle(1, 0xffffff, 0.5);
        g.strokeCircle(hx, hy, spec.dotPx);
        continue;
      }
      // The tail trails a fixed number of SCREEN pixels back along the
      // heading — the streak is a readability device, not a world-space
      // object, so it shouldn't grow or shrink with the projection.
      g.lineStyle(spec.widthPx, spec.color, 0.9);
      g.beginPath();
      g.moveTo(Math.round(hx - s.vx * spec.lenPx), Math.round(hy - s.vy * spec.lenPx));
      g.lineTo(hx, hy);
      g.strokePath();
    }
  }

  // A health bar over every enemy hurt in the last few seconds — the same bar
  // the combat wheel's target wears, at the same crown seating, so a bow shot
  // from across the street reports its damage exactly the way a sword swing
  // does. The wheel's own target is skipped: it draws its own, brighter, on
  // top (in _drawWorkProgress).
  _drawEnemyHealth(enemies) {
    const g = this.enemyHealthGfx;
    if (!g) return;
    g.clear();
    const now = performance.now();
    const engaged = this._workProgress?.combat || null;
    for (const c of enemies) {
      if (c === engaged) continue;
      if (!c._hurtUntilT || now >= c._hurtUntilT) continue;
      const screen = this.worldMetersToScreen(c.x, c.y);
      this._drawEnemyHealthBar(g, Math.round(screen.x),
        Math.round(screen.y) + Math.round(this._healthBarTop(c.kind)),
        Combat.hpFraction(c), 0.62);
    }
  }

  // Where an enemy's health bar TOP edge sits over a creature — floats just
  // above the kind's crown (SpriteLayout.creatureHealthBarTop), derived from
  // the same art table the wheel seats from. Never a flat offset.
  _healthBarTop(kind) {
    const SL = (typeof window !== 'undefined' && window.SpriteLayout) || null;
    return SL ? SL.creatureHealthBarTop(kind) : -25;
  }

  // The health bar itself: a small strip floating over the foe's head — a
  // faint full-HP track with the REMAINING hit points filled over it, tinted
  // green → amber → red on the way down. Deliberately NOT the work wheel's
  // ring: the wheel is a ring that sits ON the thing being worked, health is a
  // bar in the sky above it, so a fight and a job can never be misread for
  // each other. `cx` is the bar's horizontal centre, `top` its top edge;
  // `alpha` scales the whole bar (the engaged target draws brighter than a
  // foe merely hurt in passing).
  _drawEnemyHealthBar(g, cx, top, frac, alpha) {
    const SL = (typeof window !== 'undefined' && window.SpriteLayout) || null;
    const W = (SL && SL.HEALTH_BAR_W != null) ? SL.HEALTH_BAR_W : 18;
    const H = (SL && SL.HEALTH_BAR_H != null) ? SL.HEALTH_BAR_H : 3;
    const x = cx - Math.floor(W / 2);
    // Dark backing one pixel proud on every side — the border that keeps the
    // strip legible over pale terrain, same job as the wheel's backing disc.
    g.fillStyle(0x000000, 0.5 * alpha);
    g.fillRect(x - 1, top - 1, W + 2, H + 2);
    // Faint full-width track: how much health there ISN'T, at a glance.
    g.fillStyle(0xffffff, 0.16 * alpha);
    g.fillRect(x, top, W, H);
    if (frac > 0) {
      g.fillStyle(Combat.healthColor(frac), 0.95 * alpha);
      g.fillRect(x, top, Math.max(1, Math.round(W * frac)), H);
    }
  }

  // A floating "-N" over a foe as damage lands — the sword's melee wheel and
  // every bow/staff shot funnel through _damageEnemy, so they all pop the
  // same way. Spawned at the health bar and drifting up into the sky above
  // it; short-lived enough that it doesn't need to track a moving target.
  _popDamageNumber(c, amount) {
    if (!this.add) return;                       // headless / teardown guard
    const screen = this.worldMetersToScreen(c.x, c.y);
    // Small horizontal scatter so back-to-back numbers (a bow hit landing
    // mid-swing) read as separate hits instead of overprinting.
    const jitter = Math.round((Math.random() - 0.5) * 10);
    const x = Math.round(screen.x) + jitter;
    const y = Math.round(screen.y) + Math.round(this._healthBarTop(c.kind)) - 3;
    const t = this.add.text(x, y, `-${amount}`, {
      font: fontMono('bold 11px'), color: '#ff8a75',
      stroke: UI_SHADOW, strokeThickness: 3,
    }).setOrigin(0.5, 1).setDepth(96).setAlpha(0.95);
    // Clip to the map viewport like every other world-anchored layer.
    if (this.enemyHealthGfx?.mask) t.setMask(this.enemyHealthGfx.mask);
    t.setScale(0.7);
    this.tweens.add({ targets: t, scale: 1, duration: 90, ease: 'Back.Out' });
    this.tweens.add({
      targets: t, y: y - 13, alpha: 0,
      duration: 520, delay: 90, ease: 'Sine.Out',
      onComplete: () => t.destroy(),
    });
  }

  // The WORK wheel's ring: an arc that fills with progress toward finishing the
  // job (chop / mine / fish / hunt / catch), over a faint full-circle track so
  // it shows how far there is still to go and not just how much is done
  // (UX audit §20).
  //
  // The wheel sits ON the thing being worked, so its alphas have been walked
  // back twice: first 20% off everything (0.55 → 0.44 backing, 0.9 → 0.72 arc),
  // then a flat 0.1 off each — backing 0.34, arc 0.62, tool icon 0.7 (that one
  // set on the DOM element in startWorkProgress / startCatchProgress). At full
  // strength it hid the very sprite it was reporting progress against. The
  // track is thinned in step with the arc (×0.62/0.72) rather than by the flat
  // 0.1, which would have all but erased it.
  _strokeWorkRing(g, cx, cy, progress) {
    // Radius comes from the same table that PLACES the wheel — the crown
    // seating clears the outer edge (R + 1, the backing disc), so a resize here
    // without one there would put the ring back in the sky.
    const SL = (typeof window !== 'undefined' && window.SpriteLayout) || null;
    const R = (SL && SL.CREATURE_WHEEL_R != null) ? SL.CREATURE_WHEEL_R : 9;
    g.fillStyle(0x000000, 0.34);
    g.fillCircle(cx, cy, R + 1);
    g.lineStyle(3, 0xffffff, 0.155);
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2, false);
    g.strokePath();
    if (progress > 0) {
      g.lineStyle(3, 0xffffff, 0.62);
      g.beginPath();
      g.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress, false);
      g.strokePath();
    }
  }

  // Apply damage to an enemy from any source (a shot, or the melee wheel).
  // Returns true if that blow killed it. `_hurtUntilT` is what keeps the
  // floating health bar up for a few seconds after the hit; `_lastDamagedT`
  // feeds the existing 20-minute regen in wanderCreatures, so a foe you wound
  // and abandon does heal back up.
  _damageEnemy(c, amount) {
    if (!(amount > 0)) return false;
    const left = Combat.damage(c, amount);
    c._lastDamagedT = Date.now();
    const now = performance.now();
    c._hurtUntilT = now + ENEMY_HEALTH_RING_MS;
    // Damage numbers. Accumulate-and-beat rather than pop-per-call: a shot
    // arrives as one whole payload, but the melee wheel calls this every
    // frame with a fraction of a point — see DMG_POPUP_BEAT_MS. The kill blow
    // flushes whatever the throttle was still holding, so the numbers a fight
    // shows always sum to the HP it took.
    c._dmgPopupAccum = (c._dmgPopupAccum || 0) + amount;
    const dead = left <= 0;
    if (dead || now >= (c._dmgPopupNextT || 0)) {
      const n = Math.round(c._dmgPopupAccum);
      if (n >= 1) {
        this._popDamageNumber(c, n);
        // Subtract, don't zero: the rounding error carries into the next beat
        // instead of quietly inflating what a long fight claims to have dealt.
        c._dmgPopupAccum -= n;
        c._dmgPopupNextT = now + DMG_POPUP_BEAT_MS;
      }
    }
    if (!dead) return false;
    if (this._workProgress?.combat === c) this.cancelWorkProgress();
    this.resolveDefeat(c);
    return true;
  }

  // Start (or re-target) the COMBAT wheel on an enemy. Unlike the timed work
  // wheel this one is driven by the target's HP: the foe wears its health bar
  // (drawn bright in _drawWorkProgress), melee drains it every frame, and
  // bow/staff shots drain the same pool — so an arrow landing mid-swing
  // visibly shortens the fight.
  //
  // `durationMs` is still filled in, with the kill time at the CURRENT melee
  // rate and WITHOUT the dragon bonus. Nothing reads it as a deadline (HP ends
  // the fight), but the orphaned-wheel watchdog in _drawWorkProgress does, and
  // since every other damage source only makes the fight shorter, that
  // estimate is a true upper bound.
  startCombat(victim, opts = {}) {
    const dps = Combat.meleeDps(this.save.relics);
    const estMs = (Combat.hp(victim) / Math.max(0.01, dps)) * 1000;
    const now = performance.now();
    // A fight shows the foe's health bar, not a progress arc, so the tool
    // badge is the one place left that still says what you're hitting it WITH.
    this._setWorkProgressIcon(this.save.relics?.sword ? 'sword' : null);
    this._workProgress = {
      worldX: victim.x, worldY: victim.y,
      combat: victim,
      track: victim,              // reuse the hunt wheel's follow + escape abort
      auto: !!opts.auto,
      onComplete: () => this.resolveDefeat(victim),
      durationMs: estMs,
      energyRefund: 0,
      startT: now, _lastT: now,
    };
  }

  // The kill payload — drops, bounty, quest tick, shiny fanfare. Every route
  // to a dead creature funnels through here (the tap-hunt wheel in interact.js,
  // the combat wheel, and a killing bow/staff shot) so they can't pay out
  // differently.
  resolveDefeat(victim) {
    const save = this.save;
    save.caught = save.caught || [];
    if (save.caught.includes(victim.id)) return;
    save.caught.push(victim.id);
    const dropId = victim.kind === 'crow' ? 'crow_feather'
                 : victim.kind === 'deer' ? 'meat'
                 : null;
    if (dropId) {
      this.addToInv(dropId, 1);
      const item = ITEM_BY_ID[dropId];
      this.flashLoot(`+1 ${item?.name || dropId}`, '#ffe066', 1, dropId);
    } else if (Combat.isEnemyKind(victim.kind)) {
      // Every enemy kill pays a bounty (enemyBounty — derived from the kind's
      // HP plus a depth climb). The gold is the reliable part: before this a
      // foe dropped nothing at all and the only sane play was to walk around
      // it. The SURFACE SLIME draws one too — it fights you and eats your
      // crops, and for a long time killing one paid nothing, which is the gap
      // this branch closes by asking Combat what an enemy is rather than
      // asking the cave-monster table.
      const coins = (typeof enemyBounty === 'function')
        ? enemyBounty(victim.kind, this.depth) : 0;
      if (coins > 0) addMoney(save, coins);
      const name = MONSTERS[victim.kind]?.name || 'Slime';
      this.flash(`⚔️ ${name} defeated${coins > 0 ? `  +$${coins}` : ''}`,
        this.viewCenterX, this.viewCenterY - 60);
      // One in ten cave monsters also drops a buried-treasure roll — the same
      // table an X pays, so a lucky kill reads as finding one. Underground
      // only; see MONSTER_TREASURE_CHANCE.
      if (isMonster(victim.kind) && Math.random() < MONSTER_TREASURE_CHANCE) {
        grantTreasureRoll(this, save, this.viewCenterX, this.viewCenterY - 24, '💀');
      }
    } else {
      // Nothing defeatable reaches here today — interact.js sends only slimes,
      // crows and deer down the hunt wheel, and the other two routes only ever
      // carry enemies. A kind that ever did would otherwise die in silence.
      this.flash(`${victim.kind} defeated`, this.viewCenterX, this.viewCenterY - 60);
    }
    if (typeof Quests !== 'undefined') {
      const qDone = Quests.onKill(save, victim.kind);
      if (qDone) this.flash('Quest done! Return to the castle.', this.viewCenterX, this.viewCenterY - 60);
    }
    persistSave(save);
    // Rare shiny deer / crow — hunted fauna drop their product (meat /
    // feather), so there's no live shiny animal to keep, but the shiny find
    // still pays the 10× money + discovery bonus with fanfare.
    if (victim.shiny && dropId) {
      this.awardShinyBonus(victim.kind, this.viewCenterX, this.viewCenterY - 60);
    }
  }

  // The wheel that BLOCKS things — taps, the body's footsteps, the walk home.
  // An auto-engaged combat wheel is not one of those: the sword picks fights
  // on its own, so if it also froze the character and ate every tap, walking
  // past a slime would lock the game up until the slime died. So it fights in
  // the background and the player keeps playing.
  _busyWheel() {
    const wp = this._workProgress;
    return (wp && !wp.auto) ? wp : null;
  }

  // --- Work-progress wheel (rock-break / tree-chop / fish / defeat / catch) ---
  // `trackCreature` (optional): a moving target (e.g. a deer/crow being hunted)
  // whose position the wheel follows and whose escape ABORTS the action. Unlike
  // startCatchProgress' `flee`, the wheel does NOT drive the creature — its own
  // wander/flee AI does — track just re-anchors the wheel over it and cancels if
  // it slips out of reach. Omit it for static targets (rock / tree / fish).
  startWorkProgress(worldX, worldY, onComplete, durationMs = 3000, energyRefund = 0, toolSlot = null, trackCreature = null) {
    this._setWorkProgressIcon(toolSlot);
    this._workProgress = { worldX, worldY, onComplete, durationMs, energyRefund, startT: performance.now(), track: trackCreature };
  }
  // Swap the small tool badge shown beside a work-progress wheel: remove
  // whatever badge is up, then (if `toolSlot` is equipped and has an icon)
  // build the fixed-position DOM element and stash it as _workProgressIcon so
  // the next call — or cancelWorkProgress — can remove it in turn. Shared by
  // every wheel starter (combat, mine/chop/fish, catch) so the DOM/cssText
  // can't drift between them.
  _setWorkProgressIcon(toolSlot) {
    this._workProgressIcon?.remove();
    this._workProgressIcon = null;
    if (!toolSlot) return;
    const tier = this.save.relics?.[toolSlot]?.tier || 1;
    const html = this.gearIconHTML('relic', toolSlot, tier, 16);
    if (!html) return;
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:0;top:0;z-index:96;pointer-events:none;opacity:0.7;';
    el.innerHTML = html;
    document.body.appendChild(el);
    this._workProgressIcon = el;
  }
  // Catch wheel: like startWorkProgress, but the TARGET CREATURE flees the
  // player at FLEE_MPS while it runs (see _drawWorkProgress). If it escapes the
  // viewport the catch FAILS (onFail) instead of completing; the wheel tracks
  // the fleeing creature. _beingCaught flags it so wanderCreatures leaves its
  // movement to the wheel.
  startCatchProgress(creature, durationMs, onComplete, onFail, toolSlot = null, energyRefund = 0) {
    creature._beingCaught = true;
    const t = performance.now();
    this._setWorkProgressIcon(toolSlot);
    this._workProgress = {
      worldX: creature.x, worldY: creature.y, onComplete, durationMs,
      energyRefund, startT: t, _lastT: t, flee: creature, onFail,
    };
  }
  // Clear the wheel WITHOUT refunding energy. Used by the completion path and
  // test helpers — the work actually finished, so the up-front spend was earned.
  // Always releases a fleeing catch target so it resumes normal wandering.
  cancelWorkProgress() {
    if (this._workProgress?.flee) this._workProgress.flee._beingCaught = false;
    this._workProgress = null;
    this._workProgressGfx?.clear();
    this._workProgressIcon?.remove();
    this._workProgressIcon = null;
  }
  // Player bailed on an in-flight mine/chop/cast (any tap aborts the wheel).
  // Refund the energy that was charged up-front when the action started, so
  // cancelling costs nothing, then clear. Clamp to max in case energy changed
  // (e.g. offline rest fired while the tab was backgrounded mid-wheel).
  abortWorkProgress() {
    const wp = this._workProgress;
    if (wp && wp.energyRefund > 0) {
      this.save.energy = Math.min(this.getMaxEnergy(), (this.save.energy ?? 0) + wp.energyRefund);
      this.updateEnergyDOM();
    }
    // Tapping to bail on an underground auto-mine pauses the body's pursuit of
    // the target so the player can do something else; the next steer (GPS fix,
    // stick, keyboard, debug pad) clears the pause and resumes following.
    if (this._autoMineKey) {
      this._followPaused = true;
      this._autoMineKey = null;
    }
    this.cancelWorkProgress();
  }
  // The visible slash to go with a sword swing — a short arc drawn near the
  // player's chest, swept toward whatever it's engaged with. Player-anchored
  // (the player sprite is camera-locked at viewCentre, so no world→screen
  // projection is needed) rather than world-anchored, unlike every other
  // combat visual here (shots, health bars): this reads as coming FROM the
  // player, not landing at a world point.
  _drawSwordSwing() {
    const g = this.swordSwingGfx;
    if (!g) return;
    g.clear();
    const sw = this._swing;
    if (!sw) return;
    const t = (performance.now() - sw.startT) / SWORD_SWING_MS;
    if (t >= 1) { this._swing = null; return; }
    // Sweep a wide arc centred on the direction of the target: the LEADING
    // edge is the blade's current position, the trailing edge a fixed slice
    // behind it, so the stroke reads as a slash in flight rather than a
    // wedge appearing all at once (the same "trailing streak" idea _drawShots
    // uses for an arrow, just swept angularly instead of along a line).
    const baseAngle = Math.atan2(sw.dir.y, sw.dir.x);
    const SWEEP = Math.PI * 0.6;                    // ~108° tip-to-tip
    const startA = baseAngle - SWEEP / 2;
    const headA = startA + SWEEP * t;
    const tailA = startA + SWEEP * Math.max(0, t - 0.35);
    const cx = this.viewCenterX;
    const cy = this.viewCenterY + this.playerFeetNudgeY - 8;   // roughly chest height
    const R = 15;
    // Fade only in the closing stretch — a slash that's visible then vanishes
    // instantly reads as a glitch, not a completed swing.
    const alpha = t < 0.7 ? 0.9 : 0.9 * (1 - (t - 0.7) / 0.3);
    g.lineStyle(3, 0xe8ecf0, alpha);
    g.beginPath();
    g.arc(cx, cy, R, tailA, headA, false);
    g.strokePath();
  }
  _drawWorkProgress() {
    // Independent of wp — a killing blow clears _workProgress the instant it
    // lands, and the swing that landed it should still finish its fade rather
    // than being cut off mid-sweep by the early `if (!wp) return` below.
    this._drawSwordSwing();
    const wp = this._workProgress;
    if (!wp) return;
    const now = performance.now();
    // Stuck-wheel watchdog. A wheel always resolves at wp.durationMs (complete,
    // fail, or cancel), so one that has outlived that by a wide margin is
    // orphaned — e.g. its completion / flee / track code threw (the update loop
    // is kept alive by _reportLoopError, so a per-frame throw won't surface),
    // leaving _workProgress set forever. That makes the interact.js work-progress
    // tap guard swallow EVERY tap, which reads as "taps randomly stopped
    // working". Force-clear it here, at the very top — above the flee/track
    // blocks that might be the thing throwing — so the loop self-heals within a
    // few seconds. Generous +8s margin so a legitimately long bare-hands wheel
    // (9s) is never cut short.
    if (now - (wp.startT || now) > (wp.durationMs || 3000) + 8000) {
      try { console.warn('[wheel] watchdog cleared an orphaned work wheel after',
        Math.round(now - (wp.startT || now)), 'ms (dur', wp.durationMs, ')'); } catch (_) {}
      this.cancelWorkProgress();
      try { this.flash?.('(cleared a stuck action)', this.viewCenterX, this.viewCenterY - 60); } catch (_) {}
      return;
    }
    // Fleeing catch target: it backs away from the player at FLEE_MPS while the
    // wheel runs. If it stays outside the player's reach long enough the catch
    // fails. The wheel anchor (worldX/Y) follows the creature so it stays drawn
    // over it.
    if (wp.flee) {
      const c = wp.flee;
      const dt = Math.min(0.1, (now - (wp._lastT ?? wp.startT)) / 1000);
      wp._lastT = now;
      const px = this.startWorldM.x + this.playerM.x;
      const py = this.startWorldM.y + this.playerM.y;
      let dx = c.x - px, dy = c.y - py;
      let dist = Math.hypot(dx, dy);
      if (dist < 0.001) { dx = 1; dy = 0; dist = 1; }   // degenerate — pick a heading
      // Butterflies bolt 3× faster than other fauna while the net wheel runs.
      // Rare shiny animals flee at 2× too — consistent with their 2× wander
      // speed, making them a genuinely slippery catch.
      const isButterfly = c.kind === 'butterfly';
      const shinyFast = isShiny(c.id, SHINY_RATE.animal) ? 2 : 1;
      const FLEE_MPS = (isButterfly ? 6 : 2) * shinyFast;
      c.x += (dx / dist) * FLEE_MPS * dt;
      c.y += (dy / dist) * FLEE_MPS * dt;
      wp.worldX = c.x; wp.worldY = c.y;
      // Escape: once the animal has been OUTSIDE the player's reach (the lit
      // interaction range — same radius the tap-gate uses) for a continuous
      // grace window, the catch FAILS. Re-entering reach resets the timer.
      // cancelWorkProgress() does NOT refund the up-front energy, so a getaway
      // costs the player the attempt. Normal animals get a 1 s grace;
      // butterflies flee faster but get 2 s, then keep bolting away from the
      // player for 2 minutes (see wanderCreatures' _escapingUntil handling).
      // Out-of-reach uses the SAME lit-cell test as the reach silhouette
      // (coords.js cellInReach) so a catch only fails once the target sits on a
      // visibly-UNLIT cell — measuring raw centre-to-centre distance instead
      // drifted from the lit diamond, failing catches while the animal was
      // still plainly inside the player's lit range.
      const fc = worldMetersToAbsCell(this, c.x, c.y);
      const outOfRange = (typeof cellInReach === 'function')
        ? !cellInReach(this, fc.cellIX, fc.cellIY)
        : ((c.x - px) ** 2 + (c.y - py) ** 2) > (reachRadiusM(this)) ** 2;
      const graceMs = isButterfly ? 2000 : 1000;
      if (outOfRange) {
        wp._outSinceT = wp._outSinceT ?? now;
        if (now - wp._outSinceT >= graceMs) {
          const onFail = wp.onFail;
          if (isButterfly) c._escapingUntil = now + 120000;   // 2 min of post-catch fleeing
          this.cancelWorkProgress();         // clears _beingCaught; keeps energy spent
          if (onFail) onFail();
          return;
        }
      } else {
        wp._outSinceT = null;                // back in reach — reset grace
      }
    }
    // Tracked defeat target (deer / crow / slime hunt): the creature moves under
    // its OWN wander/flee AI, not the wheel. Keep the wheel drawn over it, and
    // abort the hunt if it escapes the player's reach for a short grace window —
    // previously the defeat wheel was anchored to a FIXED point and happily ran
    // to completion even after a fleeing deer had bounded clear out of range.
    if (wp.track) {
      const c = wp.track;
      wp.worldX = c.x; wp.worldY = c.y;        // follow the target
      // Use the lit-cell test (coords.js cellInReach), identical to the reach
      // silhouette, so a hunt only fails once the target is on a visibly-unlit
      // cell. The old raw centre-to-centre circle was tighter than the lit
      // diamond, so a crow still sitting inside the lit range read as "got
      // away" while it hadn't visually left it.
      const tc = worldMetersToAbsCell(this, c.x, c.y);
      const outOfRange = (typeof cellInReach === 'function')
        ? !cellInReach(this, tc.cellIX, tc.cellIY)
        : ((c.x - (this.startWorldM.x + this.playerM.x)) ** 2
           + (c.y - (this.startWorldM.y + this.playerM.y)) ** 2) > (reachRadiusM(this)) ** 2;
      if (outOfRange) {
        wp._outSinceT = wp._outSinceT ?? now;
        if (now - wp._outSinceT >= 1000) {     // 1 s grace — matches the catch wheel
          const wasAuto = wp.auto;
          this.cancelWorkProgress();
          // An AUTO-engaged sword fight breaks off constantly — you walk, the
          // foe drifts, the reach diamond shrinks as energy drains. That's
          // normal, not a failed hunt, so it says nothing; a hunt or a fight
          // you actually chose still reports the getaway.
          if (!wasAuto && this.flash) this.flash('It got away.', this.viewCenterX, this.viewCenterY - 60);
          return;
        }
      } else {
        wp._outSinceT = null;
      }
    }
    // COMBAT wheel: the target's HP, not the clock, ends this one. Melee
    // damage lands every frame at the sword's rate (bare hands at the tier-0
    // rung), and bow/staff shots drain the same pool from _damageEnemy — so a
    // fight you started with a swing can be finished by an arrow.
    if (wp.combat) {
      const c = wp.combat;
      // Killed by something else mid-swing (a shot, a tame dog) — nothing left
      // to fight, and the kill has already paid out.
      if (this.save.caught?.includes(c.id)) { this.cancelWorkProgress(); return; }
      const dt = Math.min(0.1, (now - (wp._lastT ?? wp.startT)) / 1000);
      wp._lastT = now;
      const dps = Combat.meleeDps(this.save.relics) * (this.isDragonActive() ? 2 : 1);
      // A blade to actually swing — bare hands (no sword owned) has none, so
      // no slash draws, same gate _setWorkProgressIcon's tool badge uses.
      if (this.save.relics?.sword && now >= this._nextSwingT) {
        this._nextSwingT = now + DMG_POPUP_BEAT_MS;
        const px = this.startWorldM.x + this.playerM.x;
        const py = this.startWorldM.y + this.playerM.y;
        const dx = c.x - px, dy = c.y - py;
        const d = Math.hypot(dx, dy) || 1;
        this._swing = { startT: now, dir: { x: dx / d, y: dy / d } };
      }
      if (this._damageEnemy(c, dps * dt)) return;   // _damageEnemy clears the wheel + pays out
    }
    const dur = wp.durationMs || 3000;
    const elapsed = now - wp.startT;
    if (!wp.combat && elapsed >= dur) {
      const cb = wp.onComplete;
      this.cancelWorkProgress();
      cb();
      return;
    }
    const progress = elapsed / dur;
    const screen = this.worldMetersToScreen(wp.worldX, wp.worldY);
    const cx = Math.round(screen.x);
    // Static targets (rock / tree / crop / fish) sit in their cell, so a flat
    // -7 puts the wheel on them. A CREATURE can't use a flat offset: the
    // animals are drawn feet-anchored at wildly different sizes, so the one
    // number that hugged a cow's head floated ~4 px clear above a chicken and
    // sat down at a perched crow's feet. Wheels over a creature — a capture
    // (wp.flee) or a hunt (wp.track) — are placed by the crown rule instead
    // (SpriteLayout.creatureWheelDy): centred on the top row of that kind's
    // art, half the ring over the body and half in clear sky. That subsumes
    // the old per-case fudges, including the capture wheel's extra lift for
    // "clear the fleeing animal" — it clears it by construction now.
    const creature = wp.flee || wp.track || null;
    const SL = (typeof window !== 'undefined' && window.SpriteLayout) || null;
    const dyWheel = (creature && SL) ? SL.creatureWheelDy(creature.kind) : -7;
    const cy = Math.round(screen.y) + Math.round(dyWheel);
    const g = this._workProgressGfx;
    g.clear();
    // Two readouts, two shapes — deliberately. A WORK wheel is the original
    // ring: the arc FILLS with progress toward finishing the job, seated on
    // the crown. A COMBAT target wears the enemy HEALTH BAR instead — the
    // strip above its head that drains as you hurt it, the same bar every
    // hurt foe floats (_drawEnemyHealthBar), just brighter for the one you
    // are actually engaged with. A fight and a job can't be misread for each
    // other any more; the tool badge below still says what you're swinging.
    if (wp.combat) {
      this._drawEnemyHealthBar(g, cx,
        Math.round(screen.y) + Math.round(this._healthBarTop(wp.combat.kind)),
        Combat.hpFraction(wp.combat), 1);
    } else {
      this._strokeWorkRing(g, cx, cy, progress);
    }
    if (this._workProgressIcon) {
      const gr = gameScreenRect();
      if (!gr) return;
      const scaleX = gr.width / W, scaleY = gr.height / H;
      const ICON_PX = 16;
      const px = gr.left + cx * scaleX - ICON_PX / 2;
      const py = gr.top  + cy * scaleY - ICON_PX / 2;
      this._workProgressIcon.style.transform = `translate(${Math.round(px)}px,${Math.round(py)}px)`;
    }
  }

  // Chickens and cows wander ~1 cell every 5s in a random direction.
  // Per-creature state lives on the creature object: _startX/Y, _targetX/Y,
  // _stepT0, _nextChooseT, _homeX/Y, _faceFlip.
  wanderCreatures() {
    const now = performance.now();
    const STEP_MS = 5000;
    const STEP_M = this.cellM;   // 1 cell per step
    // Only sim chickens near the player (slightly beyond viewport). Off-screen
    // chickens stay frozen at their last position — cheap and invisible.
    const px = this.startWorldM.x + this.playerM.x;
    const py = this.startWorldM.y + this.playerM.y;
    // Spec §fauna: "animals simulate when within viewport range (~7-8 cells);
    // stationary beyond that." The viewport corner sits at VIEW_CELLS/2 * √2 ≈
    // 7.8 cells, so 8 cells covers a creature just entering the viewport while
    // matching the spec's ~7-8 cell sim window.
    const RANGE_M = 8 * this.cellM;
    const RANGE_SQ = RANGE_M * RANGE_M;
    // Per-frame loop hygiene (the render pass documents the same fix): only
    // the 3×3 tile neighbourhood is simmed — the sim range above is a handful
    // of cells and a tile edge is hundreds, so one ring of tiles always covers
    // it — and caught-membership is a memoised Set, not an Array.includes per
    // creature. The all-tiles + includes version was an O(every creature ever
    // loaded × caught) scan per frame that grew the longer you walked.
    const pcW = this.playerToWorldCell();
    const caughtSet = setOf(this.save.caught);
    // Pest spawn: if the player has any planted crop and there are NO wild
    // crows already near the player, spawn one off-screen every ~90 s. The
    // crow's wander loop targets the nearest crop and destroys it on contact
    // (see below). Eased from "top up to 2 every 30 s" — that relentless pump
    // made crops unfarmable: another bird arrived seconds after you dealt with
    // the last. Now the pump only backfills an emptied field, and slowly, so
    // defeating the crows near your field actually buys a quiet window.
    this._lastPestT = this._lastPestT || 0;
    // Only crops crows actually eat (not potato) justify spawning a pest —
    // and none at all until the player's FIRST crop is in (save.hasHarvested,
    // the same grace the tile spawner's pest-free home zone reads). Before
    // that, the only crops in the world are the tutorial's; a zone check on
    // the spawn point would be theatre, because the pump spawns the crow just
    // off-screen and it flies straight to the nearest crop anyway.
    // Timer gate first: the planted-crop scan is O(planted) and has no
    // business running on the ~5400 frames between pest windows.
    if (now - this._lastPestT > 90000) {
      const hasCrowCrop = this.save.planted && this.save.planted.some(crowEatsCrop);
      if (hasCrowCrop && this.save.hasHarvested) {
        this._lastPestT = now;
        // Count nearby wild (non-released, not-yet-caught) crows.
        let wildCrows = 0;
        WorldGen.forEachItemNear('creatures', pcW.tx, pcW.ty, (c) => {
          if (c.kind !== 'crow') return;
          if (typeof c.id === 'string' && c.id.startsWith('released_')) return;
          if (caughtSet.has(c.id)) return;
          const dx = c.x - px, dy = c.y - py;
          if (dx * dx + dy * dy <= RANGE_SQ) wildCrows++;
        });
        if (wildCrows < 1) {
          const pc = pcW;
          const entry = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx, pc.ty));
          if (entry && entry.creatures) {
            // Spawn 12 m away in a random direction so the crow is just
            // off-screen; it flies toward the nearest crop next tick.
            const angle = Math.random() * Math.PI * 2;
            const SPAWN_R = 12 * this.cellM;   // ~12 cells; outside viewport
            entry.creatures.push({
              kind: 'crow',
              x: px + Math.cos(angle) * SPAWN_R,
              y: py + Math.sin(angle) * SPAWN_R,
              id: `pest_crow_${pc.tx}_${pc.ty}_${Math.floor(now)}_${Math.floor(Math.random() * 1e4)}`,
            });
          }
        }
      }
    }

    WorldGen.forEachItemNear('creatures', pcW.tx, pcW.ty, (c) => {
      // Cheapest reject first: the sim range cull. Everything below runs only
      // for the handful of creatures actually near the player.
      const ddx = c.x - px, ddy = c.y - py;
      if (ddx * ddx + ddy * ddy > RANGE_SQ) return;
      const isTame = typeof c.id === 'string' && c.id.startsWith('released_');
      // Wandering kinds: farm + pet animals always; butterflies (wild + tame)
      // flit about constantly — tame ones also pollinate. Crows + deer also
      // wander when wild so they can eat crops / be hunted.
      const wanders = c.kind === 'chicken' || c.kind === 'cow'
                    || c.kind === 'cat' || c.kind === 'dog'
                    || c.kind === 'crow' || c.kind === 'deer'
                    || c.kind === 'slime' || c.kind === 'rabbit'
                    || c.kind === 'butterfly' || isMonster(c.kind);
      if (!wanders) return;
      if (caughtSet.has(c.id)) return;
      // Mid-catch: the catch wheel owns this creature's movement (it flees the
      // player), so the generic wander must not also drive it.
      if (c._beingCaught) return;
      // Slime energy steal: a slime sitting on/near the player drains 1 energy
      // on a per-slime cooldown. Accumulated across all slimes this frame and
      // surfaced with one throttled flash after the loop (see below) so a swarm
      // doesn't spam 50 popups. Runs every frame (wanderCreatures is per-tick),
      // independent of the slime's slow step cadence.
      if (c.kind === 'slime' && !isTame) {
        const STEAL_R = this.cellM;   // 1 cell — adjacent only
        if (ddx * ddx + ddy * ddy <= STEAL_R * STEAL_R &&
            (!c._nextStealT || now >= c._nextStealT)) {
          c._nextStealT = now + 1000;   // 3 energy/sec
          const before = this.save.energy ?? 0;
          if (before > 0) {
            const slimeDmg = (this.save.shieldPotionUntil ?? 0) > now ? 2 : 3;
            this.save.energy = Math.max(0, before - slimeDmg);
            this._slimeStealAccum = (this._slimeStealAccum || 0) + (before - this.save.energy);
            this._warnIfTiring(before);
            if (this.updateEnergyDOM) this.updateEnergyDOM();
          }
        }
      }
      // Underground monster attack: the slime's energy leech, parametrised.
      // A monster within its RANGE (cells) drains DMG energy on a
      // MONSTER_HIT_MS per-monster cooldown. Melee kinds use range 1
      // (adjacent); the goblin archer reaches 3 cells, so it chips at you
      // before you can close. Accumulated + flashed once per window after the
      // loop, like the slime swarm.
      if (isMonster(c.kind)) {
        const m = MONSTERS[c.kind];
        const R = m.range * this.cellM;
        // A RANGED monster needs a clear line, for the same reason your bow
        // does: the goblin archer reaches three cells, and through rock that
        // is a foe you often cannot even see chipping at your energy from
        // inside a wall. Melee kinds (range 1) are adjacent by definition, so
        // they skip the walk and the cost of it.
        const clear = m.range <= 1 ||
          Combat.lineOfFire(c.x, c.y, px, py, (x, y) => this._cellBlocked(x, y), this.cellM);
        if (clear && ddx * ddx + ddy * ddy <= R * R && (!c._nextStealT || now >= c._nextStealT)) {
          c._nextStealT = now + MONSTER_HIT_MS;
          const before = this.save.energy ?? 0;
          if (before > 0) {
            const monDmg = (this.save.shieldPotionUntil ?? 0) > now ? Math.ceil(m.dmg / 2) : m.dmg;
            this.save.energy = Math.max(0, before - monDmg);
            this._monsterDmgAccum = (this._monsterDmgAccum || 0) + (before - this.save.energy);
            this._warnIfTiring(before);
            if (this.updateEnergyDOM) this.updateEnergyDOM();
          }
        }
      }
      // Wild-crow flight rhythm: perch (still 2-4 s) → one long flight
      // burst (500-800 ms, eased) → perch again. Targets a nearest planted
      // crop by ORBITING it — most flight legs end on the ring 1.5-3.5
      // cells out, only ~30% are a tight-ring "landing attempt" that may
      // actually touch the crop's cell. On a landing-on-crop the crow
      // arms a 2-second destroy timer; the crop is only eaten when that
      // timer fires, so scaring / capturing the crow within those 2 s
      // saves it. Tame (released_*) crows fall through to the generic
      // wander below so they behave like other pets.
      if (c.kind === 'crow' && !isTame) {
        this._wildCrowTick(c, now, px, py);
        return;
      }
      // Per-kind step duration for everything else falling through to the
      // generic wander below.
      // Rabbits: quick hop burst + long pause; flee when player is within 4 cells.
      const isRabbit = c.kind === 'rabbit' && !isTame;
      const RABBIT_FLEE_R2 = (4 * this.cellM) ** 2;
      const rabbitFleeing = isRabbit && (ddx * ddx + ddy * ddy <= RABBIT_FLEE_R2);
      // Deer: skittish wild grazers. They used to just amble at the base wander
      // speed, so a player could stroll right up and the deer never reacted
      // ("very slow at escaping"). Give them a proper flight response — once the
      // player closes within 5 cells a wild deer bolts directly away in long,
      // fast strides (even quicker than a rabbit, befitting their size/speed).
      const isDeer = c.kind === 'deer' && !isTame;
      const DEER_FLEE_R2 = (5 * this.cellM) ** 2;
      const deerFleeing = isDeer && (ddx * ddx + ddy * ddy <= DEER_FLEE_R2);
      // Butterflies flit constantly; after a failed net-catch they spend 2 min
      // bolting away from the player (set in _drawWorkProgress).
      const isButterfly = c.kind === 'butterfly';
      const butterflyEscaping = isButterfly && c._escapingUntil && now < c._escapingUntil;
      // Underground monsters: cadence scales by SPEED (faster ⇒ shorter step,
      // moves more often); flyers (bats) dart a full cell, ground monsters
      // lumber like the slime (0.6 cell).
      const isMon = isMonster(c.kind);
      const mon = isMon ? MONSTERS[c.kind] : null;
      // Rare shiny animals move at 2× speed — same hop distances, but the
      // whole step cadence (hop duration + any pause) is halved, so they cover
      // ground twice as fast. isShiny() is keyed off the creature id, so the
      // status is stable across reloads (matches the shiny-tint in render).
      // Monsters never go shiny, so their cadence comes purely from SPEED.
      const shinyFast = (!isMon && isShiny(c.id, SHINY_RATE.animal)) ? 0.5 : 1;
      // stepMs = animation duration of the hop itself (short burst).
      const stepMs = (isRabbit ? (rabbitFleeing ? 300 : 420)
                   : isButterfly ? (butterflyEscaping ? 350 : 900)
                   : deerFleeing ? 340
                   : isMon ? STEP_MS / mon.speed
                   : STEP_MS) * shinyFast;
      // Slimes ooze in short, lazy hops (0.6 cell); rabbits hop 0.5/1.4 cells;
      // butterflies dart further (1.5 cells) while escaping.
      const stepM = c.kind === 'slime' ? STEP_M * 0.6
                  : isMon ? STEP_M * (mon.fly ? 1.0 : 0.6)
                  : isRabbit ? (rabbitFleeing ? STEP_M * 1.4 : STEP_M * 0.5)
                  : isButterfly ? (butterflyEscaping ? STEP_M * 1.5 : STEP_M)
                  : deerFleeing ? STEP_M * 1.8
                  : STEP_M;
      if (c._nextChooseT == null) {
        c._nextChooseT = now + Math.random() * stepMs;
        c._startX = c.x; c._startY = c.y;
        c._targetX = c.x; c._targetY = c.y;
        c._stepT0 = now;
      }
      if (now >= c._nextChooseT) {
        if (c._homeX == null) { c._homeX = c.x; c._homeY = c.y; }
        // Tame butterflies pollinate nearby planted crops while wandering —
        // mirror the water-can boost (canBoost flag). Each step they're
        // within 8 m of a planted cell, that cell gets armed for a double
        // harvest on the next maturation.
        if (isTame && c.kind === 'butterfly' && this.save.planted) {
          for (const pp of this.save.planted) {
            const dx = pp.x - c.x, dy = pp.y - c.y;
            if (dx * dx + dy * dy <= 64) pp.canBoost = true;
          }
        }
        // HP healing: if 20 min since last damage, restore to max. Max comes
        // from Combat.creatureMaxHp so a monster wounded by an arrow heals back
        // to ITS hit points, not the 10-HP fallback a local table gave it.
        if (c._lastDamagedT && Date.now() - c._lastDamagedT >= 20 * 60 * 1000) {
          c._hp = Combat.creatureMaxHp(c.kind);
          c._lastDamagedT = null;
        }

        // Pet combat: tame cats hunt crows; tame dogs hunt deer + slimes.
        // Scans for the nearest valid prey within 8 cells each wander step.
        if (isTame && (c.kind === 'cat' || c.kind === 'dog')) {
          const CHASE_R = 8 * this.cellM;
          const CHASE_R2 = CHASE_R * CHASE_R;
          const PREY = c.kind === 'cat' ? CAT_PREY : DOG_PREY;
          let nearest = null, nearestD2 = CHASE_R2;
          // Pet is within sim range of the player and prey within 8 cells of
          // the pet, so the player's 3×3 tile ring covers the search box.
          WorldGen.forEachItemNear('creatures', pcW.tx, pcW.ty, (cr) => {
            if (!PREY.has(cr.kind)) return;
            if (cr.id?.startsWith('released_')) return;
            if (caughtSet.has(cr.id)) return;
            const d2 = (cr.x - c.x) ** 2 + (cr.y - c.y) ** 2;
            if (d2 < nearestD2) { nearestD2 = d2; nearest = cr; }
          });
          c._chaseTarget = nearest;
        }

        // Flee override: prey that was just hit runs away.
        if (c._fleeUntilT && c._fleeUntilT > now) {
          const fa = c._fleeAngle ?? 0;
          for (let attempt = 0; attempt < 4; attempt++) {
            const fleeAngle = fa + (Math.random() - 0.5) * 0.6;
            const ftx = c.x + Math.cos(fleeAngle) * stepM * 2;
            const fty = c.y + Math.sin(fleeAngle) * stepM * 2;
            const dest = this.cellAt(ftx, fty);
            if (dest.loaded && !faunaBlocksCell(dest.type)) {
              c._startX = c.x; c._startY = c.y;
              c._targetX = ftx; c._targetY = fty;
              c._stepT0 = now;
              c._nextChooseT = now + stepMs * 0.5;
              break;
            }
          }
          c._fleeUntilT = 0;
          return;   // skip rest of wander step; interpolation resumes next frame
        }

        // Movement target — modes checked in order:
        //   (a) Pet chasing prey (_chaseTarget set above)
        //   (b) Cat-following (_followUntilT > now): cat homes in on player.
        //   (c) Slime — lazily drawn toward the player.
        //   (d) Tame pets — home-bias keeps them near release point.
        //   (e) Default — wild farm animals random-wander around home.
        // Wild crows take a separate path (_wildCrowTick) above; deer use the
        // generic random wander.
        const FOLLOW_GAP = 1.5 * this.cellM;
        const isCatFollowing = c.kind === 'cat' && c._followUntilT && c._followUntilT > now;
        const dxh = c._homeX - c.x, dyh = c._homeY - c.y;
        const retreating = c._retreatUntilT && c._retreatUntilT > now;
        const homeRadius = retreating ? 0 : isTame ? 5 * this.cellM : 3 * this.cellM;
        const homeBias = Math.hypot(dxh, dyh) > homeRadius;
        const dxp = px - c.x, dyp = py - c.y;
        const distToPlayer = Math.hypot(dxp, dyp);
        let tx = c.x, ty = c.y, angle = 0;
        let foundValidTarget = false;
        // Fight resolution: if chasing pet is in fight range, deal damage.
        if (c._chaseTarget) {
          const tgt = c._chaseTarget;
          const fd2 = (tgt.x - c.x) ** 2 + (tgt.y - c.y) ** 2;
          const FIGHT_R2 = (1.5 * this.cellM) ** 2;
          if (fd2 <= FIGHT_R2) {
            // One HP table for every fight in the game (combat.js) — a slime a
            // dog has been worrying shows the damage on the player's health
            // ring too, and finishing it off with an arrow is that much less
            // work.
            tgt._hp = Combat.damage(tgt, 1);
            c._hp   = Combat.damage(c, 1);
            tgt._lastDamagedT = Date.now();
            c._lastDamagedT   = Date.now();
            // Push prey away from pet; force immediate direction-change.
            tgt._fleeAngle   = Math.atan2(tgt.y - c.y, tgt.x - c.x);
            tgt._fleeUntilT  = now + 8000;   // > one wander step so flee fires
            tgt._nextChooseT = 0;            // interrupt current step immediately
            if (tgt._hp <= 0) {
              // Auto-defeat the prey — the SAME outcome as the player killing
              // it, by calling the one payout path rather than re-implementing
              // it. This branch used to carry its own copy of the drop logic,
              // which is how a pet's kill came to skip the bounty, the quest
              // tick, the treasure roll and the shiny fanfare: your dog killing
              // a slime paid nothing while your arrow paid coins.
              this.resolveDefeat(tgt);
              c._chaseTarget = null;
            }
            if (c._hp <= 0) {
              // Pet retreats home to recover.
              c._hp = 1;
              c._chaseTarget = null;
              c._retreatUntilT = now + 30000;   // 30s forced home-bias
            }
          }
        }

        for (let attempt = 0; attempt < 6; attempt++) {
          if (c._chaseTarget && !this.save.caught?.includes(c._chaseTarget.id)) {
            const tgt = c._chaseTarget;
            angle = Math.atan2(tgt.y - c.y, tgt.x - c.x) + (Math.random() - 0.5) * 0.3;
          } else if (isCatFollowing && distToPlayer > FOLLOW_GAP) {
            angle = Math.atan2(dyp, dxp) + (Math.random() - 0.5) * 0.4;
          } else if (rabbitFleeing) {
            // Flee directly away from player with wide jitter so it zig-zags.
            angle = Math.atan2(-dyp, -dxp) + (Math.random() - 0.5) * 1.1;
          } else if (deerFleeing) {
            // Bound straight away from the player with only mild jitter — a deer
            // runs in a committed line rather than a rabbit's panicked zig-zag.
            angle = Math.atan2(-dyp, -dxp) + (Math.random() - 0.5) * 0.6;
          } else if (butterflyEscaping) {
            // Bolt away from the player, careening with wide jitter.
            angle = Math.atan2(-dyp, -dxp) + (Math.random() - 0.5) * 1.2;
          } else if (c.kind === 'slime') {
            // Lazily drawn to the player: about half its hops amble toward
            // them (heavy ±0.7 rad jitter so it's a meander, not a beeline),
            // the rest are aimless. Slimes ignore home-bias — they roam free
            // and home in on whoever's nearby.
            if (Math.random() < 0.5 && distToPlayer > 0.5 * this.cellM) {
              angle = Math.atan2(dyp, dxp) + (Math.random() - 0.5) * 1.4;
            } else {
              angle = Math.random() * Math.PI * 2;
            }
          } else if (isMon) {
            // Monsters HUNT: a committed stalk toward the player (tighter jitter
            // than the slime's meander), no home-bias. Flyers (bats) careen with
            // wide jitter so they read as erratic. The archer closes in too —
            // its range only lets it start draining sooner, not hang back.
            if (distToPlayer > 0.5 * this.cellM) {
              angle = Math.atan2(dyp, dxp) + (Math.random() - 0.5) * (mon.fly ? 1.6 : 0.8);
            } else {
              angle = Math.random() * Math.PI * 2;
            }
          } else if (homeBias) {
            angle = Math.atan2(dyh, dxh) + (Math.random() - 0.5) * 0.8;
          } else {
            angle = Math.random() * Math.PI * 2;
          }
          tx = c.x + Math.cos(angle) * stepM;
          ty = c.y + Math.sin(angle) * stepM;
          const { cellIX, cellIY } = worldMetersToAbsCell(this, tx, ty);
          if (this.placedRockSet && this.placedRockSet.has(cellKeyFromAbsCell(cellIX, cellIY))) continue;
          const dest = this.cellAt(tx, ty);
          if (dest.loaded && faunaBlocksCell(dest.type)) continue;
          // Scarecrow aversion (crow + deer only) — refuse any target cell
          // within 4 cells of an active scarecrow. Crows/deer that wander into
          // such cells get bounced by the attempt loop until they pick a
          // different direction.
          if ((c.kind === 'crow' || c.kind === 'deer') && this._nearAny('scarecrows', tx, ty, 4)) continue;
          // Fire aversion (slime only) — a lit campfire repels slimes exactly
          // like a scarecrow repels crows/deer, so slimes can't ooze into (or
          // steal energy across) the warm ring around a campfire.
          if (c.kind === 'slime' && this._nearAny('fires', tx, ty, 4)) continue;
          foundValidTarget = true;
          break;
        }
        // If every attempt was blocked (e.g. crow surrounded by scarecrows
        // / water / buildings), stand still instead of moving onto a bad
        // cell — the old code took the last attempted target which let
        // crows phase into the very cell the aversion was supposed to
        // protect.
        if (!foundValidTarget) { tx = c.x; ty = c.y; }
        // Deer crop damage: each wander step, 20% chance to eat the nearest
        // planted crop within 1.5 cells. Scarecrows already avert the deer
        // before this point, so no extra scarecrow check needed here.
        if (c.kind === 'deer' && !isTame && this.save.planted?.length) {
          const DR2 = (1.5 * this.cellM) * (1.5 * this.cellM);
          if (Math.random() < 0.20) {
            const idx = this.save.planted.findIndex(p => {
              const ddx = p.x - c.x, ddy = p.y - c.y;
              return ddx * ddx + ddy * ddy <= DR2;
            });
            if (idx >= 0) {
              this.save.planted.splice(idx, 1);
              this.flash?.('🦌 crop eaten!', this.viewCenterX, this.viewCenterY - 60);
            }
          }
        }
        c._startX = c.x; c._startY = c.y;
        c._targetX = tx; c._targetY = ty;
        c._stepT0 = now;
        c._hopMs = stepMs;
        // Rabbits sit still between hops: short pause when fleeing, long when idle.
        const pauseMs = isRabbit
          ? (rabbitFleeing ? 80 + Math.random() * 120 : 700 + Math.random() * 1300)
          : 0;
        c._nextChooseT = now + stepMs + pauseMs;
        c._faceFlip = (c._targetX - c._startX) < 0;
      }
      const u = Math.min(1, (now - c._stepT0) / (c._hopMs || STEP_MS));
      c.x = c._startX + (c._targetX - c._startX) * u;
      c.y = c._startY + (c._targetY - c._startY) * u;
    });
    // One throttled flash for everything the slimes drained this window, so a
    // swarm reads as a single "-N⚡" pop rather than 50 of them. Persist here
    // too (debounced in save.js) so the energy loss survives a reload.
    if (this._slimeStealAccum > 0 && now - (this._lastSlimeFlashT || 0) > 1200) {
      this._lastSlimeFlashT = now;
      const drained = this._slimeStealAccum;
      this._slimeStealAccum = 0;
      if (this.flash) this.flash(`🟢 slime drained ${drained}⚡`, this.viewCenterX, this.viewCenterY - 40);
      if (typeof persistSave === 'function') persistSave(this.save);
    }
    // Same throttled roll-up for underground monster hits, so a pack reads as a
    // single "-N⚡" pop rather than one flash per monster.
    if (this._monsterDmgAccum > 0 && now - (this._lastMonsterFlashT || 0) > 1200) {
      this._lastMonsterFlashT = now;
      const hit = this._monsterDmgAccum;
      this._monsterDmgAccum = 0;
      if (this.flash) this.flash(`⚔️ monsters hit ${hit}⚡`, this.viewCenterX, this.viewCenterY - 40);
      if (typeof persistSave === 'function') persistSave(this.save);
    }
  }

  // Per-tick movement for wild crows. Three-phase state machine:
  //   PERCH      → still for 2–4.5 s
  //   FLIGHT     → one eased glide over ~800–1200 ms covering ~1–2.5 cells
  //                (slow + short — crows used to be too fast / fly too far)
  //   DESTROYING → committed to a planted crop; the crow must perch ON the
  //                crop for 2 full cycles (hopping in place) before it eats.
  // The flight target is usually picked by ORBITING the nearest crop at
  // radius ~1.5–3.5 cells (so the crow looks like it's circling, casing
  // the field). With ~30% probability the chosen orbit ring collapses
  // toward radius 0 — a "landing attempt" that may end with the crow's
  // landed position inside the crop's cell, starting the 2-cycle pause.
  // Once committed, the crow keeps hopping on the crop, decrementing the
  // cycle counter each landing; it eats only when the counter hits 0.
  // Defeating the crow during the pause cancels the destruction, giving the
  // player a generous grace window.
  _wildCrowTick(c, now, px, py) {
    // A fleeing crow (just hit by a pet) skips crop logic and runs.
    if (c._fleeUntilT && c._fleeUntilT > now) return;
    // (1) Resolve any pending crop destruction. The destroy timer arms
    // when the crow lands on a crop's cell; it fires here if the crop
    // is still present, or quietly cancels if the player harvested it
    // first.
    if (c._destroyCropRef && this.save.planted.indexOf(c._destroyCropRef) < 0) {
      c._destroyCropRef = null;
      c._destroyAtT = null;
      c._destroyCyclesLeft = 0;
    }
    if (c._destroyAtT != null && now >= c._destroyAtT) {
      const idx = c._destroyCropRef ? this.save.planted.indexOf(c._destroyCropRef) : -1;
      if (idx >= 0) {
        this.save.planted.splice(idx, 1);
        this.flash?.('🐦 crop eaten!', this.viewCenterX, this.viewCenterY - 60);
        // Sated: after a meal the crow takes off and stays away for a few
        // minutes before it will case the field again. Force it out of the
        // current perch so it launches an outbound flight on this very tick.
        c._departUntilT = now + 150000 + Math.random() * 90000;   // ~2.5–4 min
        c._perchUntilT = now;
        c._flightUntilT = null;
      }
      c._destroyCropRef = null;
      c._destroyAtT = null;
    }
    // (2) Initialise rhythm on first encounter.
    if (c._perchUntilT == null && c._flightUntilT == null) {
      c._perchUntilT = now + 1500 + Math.random() * 2500;
    }
    // (3) FLIGHT phase — interpolate with ease-in/out toward target.
    if (c._flightUntilT && now < c._flightUntilT) {
      const dur = c._flightUntilT - c._flightT0;
      const t = Math.min(1, (now - c._flightT0) / dur);
      const u = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      c.x = c._startX + (c._targetX - c._startX) * u;
      c.y = c._startY + (c._targetY - c._startY) * u;
      return;
    }
    // (4) FLIGHT completion — snap to final, start a new perch, and
    // arm the destroy timer if we landed on a planted crop's cell.
    if (c._flightUntilT && now >= c._flightUntilT) {
      c.x = c._targetX;
      c.y = c._targetY;
      c._flightUntilT = null;
      c._perchUntilT = now + 2000 + Math.random() * 2500;
      c._faceFlip = (c._targetX - c._startX) < 0;
      if (this.save.planted) {
        const NEAR2 = (this.cellM * 0.5) * (this.cellM * 0.5);
        let landedOn = null;
        for (const pp of this.save.planted) {
          if (!crowEatsCrop(pp)) continue;   // crows ignore potato crops
          const ddx = pp.x - c.x, ddy = pp.y - c.y;
          if (ddx * ddx + ddy * ddy <= NEAR2) { landedOn = pp; break; }
        }
        if (landedOn) {
          // Require the crow to pause for 2 full perch cycles ON the crop
          // before it destroys it. The first landing starts the count; each
          // subsequent landing on the SAME crop decrements it.
          if (c._destroyCropRef === landedOn) {
            c._destroyCyclesLeft = (c._destroyCyclesLeft || 1) - 1;
          } else {
            c._destroyCropRef = landedOn;
            c._destroyCyclesLeft = 2;
          }
          // When the pause is spent, arm the destroy timer to fire on the
          // next resolution tick (step 1).
          if (c._destroyCyclesLeft <= 0) c._destroyAtT = now;
        } else {
          // Drifted off the crop — abandon any in-progress pause.
          c._destroyCropRef = null;
          c._destroyCyclesLeft = 0;
          c._destroyAtT = null;
        }
      }
      return;
    }
    // (5) PERCH phase — sit still until the timer expires.
    if (c._perchUntilT && now < c._perchUntilT) return;

    // (6) Time to launch a new flight burst. Pick a target with up to
    // 6 attempts so we can reject water / buildings / scarecrow rings.
    let tx = c.x, ty = c.y, chosen = false;
    // Sated crow leaving the field — ignore all crops and fly steadily away
    // from the player until the few-minute timer lapses (it freezes once it
    // drifts off the sim range, so it simply stays gone).
    const departing = c._departUntilT && now < c._departUntilT;
    if (departing) { c._destroyCropRef = null; c._destroyCyclesLeft = 0; c._destroyAtT = null; }
    const committed = !departing && c._destroyCropRef &&
      c._destroyCyclesLeft > 0 && this.save.planted &&
      this.save.planted.indexOf(c._destroyCropRef) >= 0;
    for (let attempt = 0; attempt < 6 && !chosen; attempt++) {
      if (departing) {
        // Long outbound hop directly away from the player, with a little jitter.
        const away = Math.atan2(c.y - py, c.x - px) + (Math.random() - 0.5) * 0.6;
        const d = (2 + Math.random() * 0.5) * this.cellM;
        tx = c.x + Math.cos(away) * d;
        ty = c.y + Math.sin(away) * d;
      } else if (committed) {
        // Committed to a crop mid-pause — keep hopping in place ON the crop
        // so each landing counts down a cycle toward destruction.
        const ang = Math.random() * Math.PI * 2;
        const r = Math.random() * 0.3 * this.cellM;
        tx = c._destroyCropRef.x + Math.cos(ang) * r;
        ty = c._destroyCropRef.y + Math.sin(ang) * r;
      } else if (this.save.planted && this.save.planted.length) {
        // ORBIT the nearest planted crop the crow can NOTICE. Notice radius is
        // DETECT_R (~8 cells — the on-screen sim range, so crows spot a field
        // from across the viewport). They don't teleport in, though: the
        // flight-leg cap below makes them approach over several short hops, so
        // a far crow visibly flies toward the field rather than snapping onto
        // it. Deliberate pest crows (id `pest_crow_*`) keep unlimited range.
        // 30% of notice-flights collapse to a tight ring that may land on the
        // crop cell.
        const isPest = typeof c.id === 'string' && c.id.startsWith('pest_crow_');
        const DETECT_R = 8 * this.cellM;
        let nearest = null, bestD2 = isPest ? Infinity : DETECT_R * DETECT_R;
        for (const pp of this.save.planted) {
          if (!crowEatsCrop(pp)) continue;   // crows ignore potato crops
          const dx = pp.x - c.x, dy = pp.y - c.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) { bestD2 = d2; nearest = pp; }
        }
        if (nearest) {
          const landAttempt = Math.random() < 0.30;
          const radius = landAttempt
            ? Math.random() * 0.4 * this.cellM
            : (1.5 + Math.random() * 2.0) * this.cellM;   // spec orbit ring 1.5-3.5 cells
          const ang = Math.random() * Math.PI * 2;
          tx = nearest.x + Math.cos(ang) * radius;
          ty = nearest.y + Math.sin(ang) * radius;
        } else {
          const a = Math.random() * Math.PI * 2;
          const d = (1 + Math.random() * 1.5) * this.cellM;
          tx = c.x + Math.cos(a) * d;
          ty = c.y + Math.sin(a) * d;
        }
      } else {
        // No crops to harass — random roam, ~1–2.5 cell hops.
        const a = Math.random() * Math.PI * 2;
        const d = (1 + Math.random() * 1.5) * this.cellM;
        tx = c.x + Math.cos(a) * d;
        ty = c.y + Math.sin(a) * d;
      }
      // Cap any single flight leg to ~2.5 cells so a crow APPROACHES a crop
      // over several hops instead of teleport-swooping the whole distance in
      // one glide. In-place hops (committed) and short roams are already
      // under the cap; this only shortens a long approach toward a noticed
      // crop. Capping BEFORE the cell gate means the intermediate landing
      // point — not the far crop — is what gets validated for water/buildings.
      const MAX_LEG = 2.5 * this.cellM;
      const legDX = tx - c.x, legDY = ty - c.y;
      const legD = Math.hypot(legDX, legDY);
      if (legD > MAX_LEG) {
        tx = c.x + (legDX / legD) * MAX_LEG;
        ty = c.y + (legDY / legD) * MAX_LEG;
      }
      // Reject targets on water / buildings / roads / placed rocks. Same gate
      // the generic wander uses.
      const dest = this.cellAt(tx, ty);
      if (dest.loaded && faunaBlocksCell(dest.type)) continue;
      const { cellIX, cellIY } = worldMetersToAbsCell(this, tx, ty);
      if (this.placedRockSet && this.placedRockSet.has(cellKeyFromAbsCell(cellIX, cellIY))) continue;
      // Scarecrow aversion — refuse any target within 4 cells of an active scarecrow.
      if (this._nearAny('scarecrows', tx, ty, 4)) continue;
      chosen = true;
    }
    if (!chosen) {
      // All 6 attempts blocked — perch a bit longer and re-roll later.
      c._perchUntilT = now + 800;
      return;
    }
    c._startX = c.x; c._startY = c.y;
    c._targetX = tx; c._targetY = ty;
    c._flightT0 = now;
    c._flightUntilT = now + 800 + Math.random() * 400;   // 800–1200 ms slow glide
    c._perchUntilT = null;
    c._faceFlip = (tx - c.x) < 0;
  }

  // Sample a symmetric square neighbourhood around (wcx, wcy) and return the
  // COLOR of the most-common non-road / non-building / non-path cell. Used to
  // tint road cells so cobbles sit on the surrounding zone.
  //
  // First-hit-in-asymmetric-ring picked DIFFERENT zones for each cell across a
  // wide road, producing visible green/brown stripes where a residential strip
  // ran along one side of the road and grass along the other. Mode of a
  // symmetric radius-3 sample keeps the whole road segment one consistent tint.
  neighborNonRoadColor(wcx, wcy) {
    // Memoise the per-cell result. Terrain is static after a tile loads, so
    // the mode of a 7×7 sample never changes for a given (wcx, wcy). Without
    // this, every road cell did ~48 `tileCache.get(string-key)` lookups +
    // a Map allocation EVERY FRAME — measurable cause of tap-input lag once
    // a viewport had ≥20 road cells. Cache is unbounded by design but each
    // entry is small and only ever-rendered road cells are populated.
    if (!this._neighborColorCache) this._neighborColorCache = new Map();
    const key = Math.floor(wcx) * 100000 + Math.floor(wcy);
    const hit = this._neighborColorCache.get(key);
    if (hit !== undefined) return hit;
    const R = 3;
    // Flat counts array beats Map for ~20-element domains; saves the per-call
    // Map allocation and avoids string keys.
    const counts = new Int16Array(32);
    let bestT = -1, bestN = 0;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx === 0 && dy === 0) continue;
        const ncx = wcx + dx, ncy = wcy + dy;
        const tx = Math.floor(ncx / this.cellsPerTile);
        const ty = Math.floor(ncy / this.cellsPerTile);
        const ix = Math.floor(ncx - tx * this.cellsPerTile);
        const iy = Math.floor(ncy - ty * this.cellsPerTile);
        const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
        if (!entry || !entry.grid) continue;
        const t = entry.grid[iy * this.cellsPerTile + ix] || 0;
        // Skip roads (any tier), path, and buildings — those are overlays.
        if (t === 7 || t === 8 || t === 13 || t === 14 || t === 9 || t === 11 || t === 12) continue;
        const c = ++counts[t];
        if (c > bestN) { bestN = c; bestT = t; }
      }
    }
    const color = bestT === -1 ? null : (COLORS[bestT] ?? null);
    // Don't memoise a "no neighbour found" — the surrounding tiles may load
    // moments later and we'd be stuck with a bad result. Only cache once we
    // sampled at least one valid neighbour.
    if (bestN > 0) this._neighborColorCache.set(key, color);
    return color;
  }

  // === Drawing ===
  // Bodies live in render.js. These thin forwarders preserve the existing
  // call-site shape (this.drawCells, this.drawObjects, this.renderPool,
  // this.worldMetersToScreen, this.screenToWorldMeters) for the update loop,
  // interact.js, and test/tests.js -- behaviour is bit-identical.
  drawCells() { Render.drawCells(this); }
  drawRoadGeometry() { if (typeof RoadOverlay !== 'undefined') RoadOverlay.draw(this); }
  drawObjects() { Render.drawObjects(this); }
  renderPool(pool, container, list, configure) { Render.renderPool(this, pool, container, list, configure); }
  worldMetersToScreen(wmx, wmy) { return worldMetersToScreen(this, wmx, wmy); }
  screenToWorldMeters(sx, sy) { return screenToWorldMeters(this, sx, sy); }
  // === Interaction ===
  // Dispatch lives in interact.js as a flat TAP_HANDLERS priority array;
  // this method just forwards to it.
  handleWorldTap(sx, sy) { interactTap(this, sx, sy); }

  // === Coin-burst (ATM / bicycle_parking) =================================
  // Daily-cap key format: `<poiId>YYYYMMDD` (UTC). Each POI can be tapped
  // once per UTC day; subsequent taps within the same day flash a hint and
  // spawn no coins. Coins themselves are in-memory only (entry.coinDrops);
  // only the daily-cap dictionary persists.
  _coinBurstDayKey() {
    return new Date().toISOString().slice(0, 10).replace(/-/g, '');
  }
  _coinBurstInteract(sx, sy, poi) {
    const dayKey = this._coinBurstDayKey();
    const claimedKey = poi.id + dayKey;
    this.save.coinBurstClaimed = this.save.coinBurstClaimed || {};
    if (this.save.coinBurstClaimed[claimedKey] === 1) {
      this.flash('Already used today.', sx, sy);
      return;
    }
    // Mark BEFORE spawning so a double-tap can't double-spawn.
    this.save.coinBurstClaimed[claimedKey] = 1;
    // Opportunistic prune: drop any keys for days other than today so the
    // dictionary stays small over weeks of play.
    for (const k of Object.keys(this.save.coinBurstClaimed)) {
      if (!k.endsWith(dayKey)) delete this.save.coinBurstClaimed[k];
    }
    if (typeof persistSave === 'function') persistSave(this.save);

    // Find walkable cells within ~25m of the POI on the POI's host tile.
    // We restrict to the POI's home tile (cells_per_edge × cells_per_edge)
    // — the burst radius is ~5 cells at 5m/cell which fits inside one tile
    // for almost every POI placement, and saves us a multi-tile scan.
    const N = this.cellsPerTile;
    const tileEdgeM = this.tileEdgeM;
    const cellM = this.cellM;
    const tx = Math.floor(poi.x / tileEdgeM);
    const ty = Math.floor(poi.y / tileEdgeM);
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
    if (!entry || !entry.grid) {
      // Tile evicted between render and tap — shouldn't happen since the
      // chest sprite is in view, but bail rather than crash.
      this.flash('...', sx, sy);
      return;
    }
    const poiLocalCX = Math.floor((poi.x - tx * tileEdgeM) / cellM);
    const poiLocalCY = Math.floor((poi.y - ty * tileEdgeM) / cellM);
    const RADIUS_CELLS = Math.max(2, Math.ceil(25 / cellM));   // ~5 cells at 5m
    const MAX_BURST_CELLS = RADIUS_CELLS * 3;                  // ~75 m, the escalated reach
    // Scatter only on legitimate spawn cells: walkable, off-road, and not deep
    // in a private yard. WorldGen.isSpawnCell is the single source of truth,
    // shared with the X-mark scatter above. This burst is centred on a POI, so
    // pass it as a public anchor — residential cells right around the chest are
    // fair game even if no road is within frontage.
    const burstOpts = { roadMask: entry.roadMask, pois: [{ ix: poiLocalCX, iy: poiLocalCY }] };
    // Cells within `r` that will take a coin. `strict` is the shared scenery
    // rule (walkable, off the road band, and on RESIDENTIAL only near a public
    // anchor); relaxed keeps the two that matter for a coin — not in water or
    // a wall, not in the traffic — and drops the frontage rule.
    const gather = (r, strict) => {
      const out = [];
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const cx = poiLocalCX + dx, cy = poiLocalCY + dy;
          if (cx < 0 || cy < 0 || cx >= N || cy >= N) continue;
          // Skip the POI's own cell (chest sprite sits there).
          if (dx === 0 && dy === 0) continue;
          if (strict) {
            if (!WorldGen.isSpawnCell(entry.grid, N, N, cx, cy, burstOpts)) continue;
          } else {
            if (!WorldGen.isWalkable(entry.grid[cy * N + cx])) continue;
            if (entry.roadMask && entry.roadMask[cy * N + cx]) continue;
          }
          out.push({ cx, cy });
        }
      }
      return out;
    };
    // KEEP LOOKING UNTIL THERE IS A BURST TO SCATTER. The strict rule is built
    // for scenery that stays put: on residential ground it wants a road, a
    // public area or a POI within SPAWN_FRONTAGE, which around a pot of gold
    // in a suburb can come back with a handful of cells — or one. The count
    // below is capped by whatever this finds, so the burst quietly became a
    // single coin. A coin is not scenery: it is a 60-second pickup a few steps
    // from a chest the player is standing on, so it may lie in a front garden.
    // Widen first (still strict), and only then relax.
    let candidates = gather(RADIUS_CELLS, true);
    for (let r = RADIUS_CELLS + 2; candidates.length < COIN_BURST_MIN && r <= MAX_BURST_CELLS; r += 2) {
      candidates = gather(r, true);
    }
    if (candidates.length < COIN_BURST_MIN) candidates = gather(MAX_BURST_CELLS, false);
    if (candidates.length === 0) {
      this.flash('No room to scatter!', sx, sy);
      return;
    }
    // Shuffle (Fisher-Yates) then pick 8-12.
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    // Spec: one coin per ~5 cells of vicinity, clamped to [COIN_BURST_MIN, 12].
    const target = Math.max(COIN_BURST_MIN,
      Math.min(12, Math.floor(candidates.length / 5) || COIN_BURST_MIN));
    const n = Math.min(target, candidates.length);
    entry.coinDrops = entry.coinDrops || [];
    const expiresAt = Date.now() + 60_000;
    for (let i = 0; i < n; i++) {
      const { cx, cy } = candidates[i];
      const wmx = tx * tileEdgeM + (cx + 0.5) * cellM;
      const wmy = ty * tileEdgeM + (cy + 0.5) * cellM;
      const id = `coin_${poi.id}_${dayKey}_${i}`;
      entry.coinDrops.push({ kind: 'coindrop', x: wmx, y: wmy, id, expiresAt });
    }
    this.flashLoot(`🪙 Scattered ${n} coins!`, '#ffe066');
  }

  // --- Movement collision & level transitions ---
  // True if the cell at world point (wmx,wmy) is a solid cave wall. Unloaded
  // cells return false so the player is never trapped at a tile seam mid-load.
  //
  // The SURFACE has no movement collision at all. WorldGen.isWalkable answers a
  // different question up here — "may a person legally stand on this cell",
  // which excludes every road tier and water, and is what gates loot/spawn
  // placement. The player has always been free to walk over roads and rivers
  // (they're really out there doing it), so feeding that predicate to the
  // follow step would wall the body in behind the nearest street.
  _cellBlocked(wmx, wmy) {
    if (this.depth === 0) return false;
    const c = this.cellAt(wmx, wmy);
    if (!c.loaded) return false;
    return !WorldGen.isWalkable(c.type);
  }
  // Mine a blocking cave wall into walkable floor. Mutates the live tile grid
  // (so collision + rendering update at once) and records the dug cell so the
  // passage is re-opened whenever this tile is regenerated (_applyDugWalls).
  digCaveWall(tx, ty, ix, iy, cellIX, cellIY) {
    const N = this.cellsPerTile;
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
    if (entry && entry.grid) entry.grid[iy * N + ix] = 24;   // CAVE_FLOOR
    this.dugWallSet.add(`${this.depth}:${cellKeyFromAbsCell(cellIX, cellIY)}`);
    this.save.dugWalls = [...this.dugWallSet];
  }
  // Re-apply previously-dug walls to a freshly (re)generated cave tile's grid.
  // Cave tiles are derived from the surface on demand, so a dug-out cell would
  // otherwise come back as solid rock after the tile is evicted and reloaded.
  _applyDugWalls(entry, tx, ty) {
    if (!entry || !entry.grid || !this.dugWallSet.size) return;
    const N = entry.cellsPerEdge;
    const prefix = `${entry.depth}:`;
    for (const k of this.dugWallSet) {
      if (!k.startsWith(prefix)) continue;
      const coord = k.slice(prefix.length);          // "absIX_absIY"
      const us = coord.indexOf('_');
      const aix = parseInt(coord.slice(0, us), 10);
      const aiy = parseInt(coord.slice(us + 1), 10);
      const ix = aix - tx * N, iy = aiy - ty * N;
      if (ix < 0 || iy < 0 || ix >= N || iy >= N) continue;
      const idx = iy * N + ix;
      if (entry.grid[idx] === 25) entry.grid[idx] = 24;   // CAVE_WALL → CAVE_FLOOR
    }
  }
  // === Target-follow movement (every depth) ===
  // ONE movement model, surface and cave alike: nothing drives the body
  // directly. A TARGET point moves — the GPS fix up top, the player's steering
  // input either way — and the body walks toward it. Underground the target
  // floats free through rock and the body mines what blocks it; on the surface
  // _cellBlocked is always false, so the same code degrades to a plain walk and
  // the mining branches can never fire.
  //
  // Steer the target by an input velocity (keyboard / debug pad). The target
  // ignores walls entirely — it's just a point the body heads toward. Any steer
  // clears the auto-mine pause so pursuit resumes.
  _steerTarget(vx, vy, speedMul, dt) {
    if (!this._targetM) this._targetM = { x: this.playerM.x, y: this.playerM.y };
    if (!vx && !vy) return;
    const n = Math.hypot(vx, vy);
    this._targetM.x += (vx / n) * WALK_M_S * speedMul * dt;
    this._targetM.y += (vy / n) * WALK_M_S * speedMul * dt;
    this._followPaused = false;
    if (this.compassDeg == null) this.facing = { x: vx, y: vy };
  }
  // Snap the walk target onto the body and drop any pause. Call after ANY warp
  // that moves playerM without the body having walked there — teleport presets,
  // taking a staircase, a dragon landing. Also drops the stick's manual offset:
  // after a warp there's no "how far I walked off the GPS" left to honour, and
  // keeping it would just walk the player straight back off the new spot.
  // Without this the stale target survives the warp and the body immediately
  // sets off walking back to wherever it used to be headed.
  syncMoveTarget() {
    this._targetM = { x: this.playerM.x, y: this.playerM.y };
    this._manualOffsetM = { x: 0, y: 0 };
    this._steerDistAccrue = 0;
    this._steerCostAccrue = 0;
    this._followPaused = false;
    if (this.targetGhost) this.targetGhost.setVisible(false);
  }
  // How far the character is standing from the player's REAL position, in
  // metres. That gap is what stick walking buys and what the map's warnings are
  // about: cheap steering close to home, a darkening character further out, and
  // the walk back when you let go. Measured body-to-fix when there's a fix; with
  // no GPS at all the accumulated stick offset is the only notion of "away".
  _gpsAwayM() {
    if (this.gpsM) {
      return Math.hypot(this.playerM.x - this.gpsM.x, this.playerM.y - this.gpsM.y);
    }
    const o = this._manualOffsetM;
    return Math.hypot(o.x, o.y);
  }
  // Is the stick actually being PUSHED right now? Pointer-down alone isn't
  // enough — a finger resting on a centred nub holds _movePadHeld true while
  // steering nothing, and treating that as steering would animate the player
  // walking on the spot.
  _stickPushed() {
    const v = this.joystickVec;
    return !!(this._movePadHeld && v && (v.x || v.y));
  }
  // Effective amulet for WALKING: the best of what the player is wearing and
  // what they're currently buffed with. Dragon Powder and the Speed potion are
  // both just borrowed amulet tiers now — no modes, no separate speed ladders
  // — so every walking site (stick speed, stamina cost, the body's catch-up
  // floor, the debug dump) asks this one question. Returns a relics-shaped
  // object so it can be handed straight to items.js's steer* helpers; tier 0
  // is a bare hand, which those answer for.
  _walkRelics() {
    let tier = this.save.relics?.amulet?.tier || 0;
    if (this.isDragonActive()) tier = Math.max(tier, DRAGON_AMULET_TIER);
    if ((this.save.speedPotionUntil ?? 0) > Date.now()) {
      tier = Math.max(tier, SPEED_POTION_AMULET_TIER);
    }
    // Coffee ADDS a tier rather than overriding to one — a caffeine buzz on
    // top of whatever's already active, not a replacement for it.
    if ((this.save.coffeeUntil ?? 0) > Date.now()) {
      tier = Math.min(SPEED_POTION_AMULET_TIER, tier + COFFEE_AMULET_BOOST);
    }
    return { amulet: { tier } };
  }
  // Steer with the STICK — the one control that walks you somewhere other than
  // where the GPS says you are. Unlike _steerTarget (keyboard / debug pad,
  // which is a free debug takeover) this is a first-class part of play:
  //
  //   • it moves the target AND banks the same delta into _manualOffsetM, so
  //     the next fix targets gpsM + offset and the ground you covered by hand
  //     isn't undone a second later;
  //   • it costs STAMINA, per cell, because this is the character covering
  //     ground you didn't. Walking with the GPS stays free — that's you
  //     actually walking.
  //
  // The amulet is the upgrade to exactly this: steerSpeedMul scales how fast
  // the stick walks you (5× bare — one cell a second — → 15.5× at Frost) and
  // steerEnergyCost scales what it costs (1 pip/cell bare → 0.15 at Frost).
  // Dragon Powder and the speed potion stand in for tier 8 / 9 amulets on both
  // counts for their minute (see _walkRelics).
  _steerManual(vx, vy, dt) {
    // Steering by hand is the opposite of walking home — clear the flag the
    // hint draws from, or it would stay lit from the last drift frame.
    this._driftingHome = false;
    const n = Math.hypot(vx, vy);
    if (!n) return;
    // The "no GPS — use the stick or WASD" line is a lesson, not a status.
    // The player just demonstrated they know it, so updateHUD stops drawing
    // it from here on. Session-scoped: a fresh load offers the hint again,
    // which costs one line until the first step and needs no save migration.
    this._steeredManually = true;
    // Out of energy is a hard stop, not a slow crawl: the stick simply can't
    // walk you any further off the GPS until you rest. Throttle the nag so it
    // doesn't fire every frame the player keeps pushing.
    if ((this.save.energy ?? 0) <= 0) {
      const now = Date.now();
      if (now - (this._steerTiredFlashAt || 0) > 3000) {
        this._steerTiredFlashAt = now;
        this.flash('too tired', this.viewCenterX, this.viewCenterY);
      }
      return;
    }
    const relics = this._walkRelics();
    const step = WALK_M_S * steerSpeedMul(relics) * dt;
    const dx = (vx / n) * step, dy = (vy / n) * step;
    if (!this._targetM) this._targetM = { x: this.playerM.x, y: this.playerM.y };
    this._targetM.x += dx;
    this._targetM.y += dy;
    this._manualOffsetM.x += dx;
    this._manualOffsetM.y += dy;
    this._followPaused = false;
    // Remember which way the stick is pushing. _followStep animates from this
    // rather than from its own step vector while you steer: the body sits
    // within a step of a target you're dragging along, so its step vector
    // wobbles (and briefly points backwards) frame to frame, which showed up
    // as the sprite flickering between walk and idle and flipping direction.
    this._stickHeading = { x: vx / n, y: vy / n };
    this._lastStickT = Date.now();   // the walk-home timer starts when you stop
    if (this.compassDeg == null) this.facing = { x: vx, y: vy };
    // Per-cell stamina, banked fractionally so a 0.15/cell amulet debits a
    // whole pip every ~7 cells instead of rounding up to one per cell. Close to
    // your real position it's a fifth of that: pottering around the block you're
    // actually standing on shouldn't cost what striking out across town does,
    // and the discount is what makes the stick usable for lining up a tap.
    this._steerDistAccrue += Math.hypot(dx, dy);
    const near = this._gpsAwayM() <= NEAR_GPS_CELLS * this.cellM;
    const costPerCell = steerEnergyCost(relics) * (near ? NEAR_GPS_COST_MUL : 1);
    while (this._steerDistAccrue >= this.cellM) {
      this._steerDistAccrue -= this.cellM;
      this._steerCostAccrue += costPerCell;
      while (this._steerCostAccrue >= 1) {
        this._steerCostAccrue -= 1;
        const before = this.save.energy ?? 0;
        this.save.energy = Math.max(0, before - 1);
        this._warnIfTiring(before);
        if (this.updateEnergyDOM) this.updateEnergyDOM();
      }
    }
  }
  // Let go of the stick and, after a few seconds, the character walks itself
  // back to where you actually are. Stick walking builds up an offset from the
  // GPS (see _steerManual); this bleeds that offset back toward zero, dragging
  // the walk target home with it so _followStep walks the body there at its
  // own pace. Free — you're returning to reality, not spending a trip.
  //
  // Only on the surface, only while a fix is actually driving (a keyboard
  // takeover owns the target outright), and never mid-wheel: standing still to
  // chop a tree fifty metres out is being busy, not being idle.
  _driftHome(dt) {
    // Every early return below is a frame where the character is NOT walking
    // itself home, so the flag the hint reads is cleared up front and set only
    // once the offset is actually being bled off.
    this._driftingHome = false;
    if (this.depth !== 0 || !this.gpsM || this._gpsManualOverride) return;
    if (this._busyWheel() || this._stickPushed()) return;
    if (Date.now() - (this._lastStickT || 0) < WALK_HOME_IDLE_MS) return;
    // TOO FAR TO WALK — place the body instead. Past GPS_SNAP_M the gap is the
    // same thing a jumped fix treats as travel the player never made on foot,
    // and the rule has to be the same whichever side opened it: a fix that
    // jumps 500 m re-anchors you instantly, so a 500 m gap the stick opened
    // cannot be a minutes-long trudge back across terrain you aren't on any
    // more. The body chases at DEBUG_SPEED_MUL x walk pace (14 m/s) at best,
    // so half a kilometre is the better part of a minute of watching a
    // character walk in a straight line with the stick unusable under it.
    // Measured body-to-fix (_gpsAwayM), not by the stick offset: the offset
    // can bleed to zero with the body still hundreds of metres behind it, and
    // that lag is the same walk from the player's side of the screen.
    //
    // Still behind the idle debounce above, and deliberately: the distance
    // decides how the return is MADE, never when it starts. Yanking someone
    // mid-push would be the 500 ms hair-trigger bug with a warp on the end.
    if (this._gpsAwayM() > GPS_SNAP_M) {
      this.playerM.x = this.gpsM.x;
      this.playerM.y = this.gpsM.y;
      this.syncMoveTarget();      // drops the offset, the target and the ghost
      return;
    }
    const off = this._manualOffsetM;
    const mag = Math.hypot(off.x, off.y);
    if (mag < 0.01) return;
    this._driftingHome = true;
    // Ease the return in (see WALK_HOME_RAMP_MS): squared ramp from the moment
    // the idle timer expires, so an interrupted nudge gives up almost no ground
    // while a real stop still gets home at walking pace.
    const rampT = Math.min(1, (Date.now() - (this._lastStickT || 0) - WALK_HOME_IDLE_MS)
                              / WALK_HOME_RAMP_MS);
    const ease = rampT * rampT;
    const step = Math.min(mag, WALK_M_S * steerSpeedMul(this._walkRelics()) * ease * dt);
    if (step <= 0) return;
    const dx = -(off.x / mag) * step, dy = -(off.y / mag) * step;
    off.x += dx; off.y += dy;
    if (!this._targetM) this._targetM = { x: this.playerM.x, y: this.playerM.y };
    this._targetM.x += dx;
    this._targetM.y += dy;
    this._followPaused = false;
  }
  // The walk home is the one bit of movement the player didn't ask for frame by
  // frame — the character just starts walking, and until now the only clue was
  // the GPS dot quietly getting closer. So while it runs, draw a lead: a thin
  // dashed line from the feet to the dot with the dashes marching that way
  // and a chevron at the far end. It says "on my way back there" in the one
  // place the player is already looking, and it costs nothing to ignore.
  //
  // Deliberately quiet. It waits out WALK_HOME_HINT_IDLE_MS after the stick was
  // last touched (the walk itself starts earlier, at WALK_HOME_IDLE_MS — the
  // first moments need no explaining to the player who just let go),
  // and it needs the dot on screen, which is the game's own test for "far
  // enough off your real position to matter". White and translucent — quieter
  // than the coloured compasses (the green tutorial arrow, the magenta pairy
  // blink): this is ambient "on my way" information, not a call to action, and
  // white doesn't claim membership of any of the game's colour languages.
  _drawWalkHomeHint(dt) {
    const g = this.walkHomeGfx;
    if (!g) return;
    g.clear();
    if (!this._driftingHome || !this.gpsGhost?.visible) return;
    if (Date.now() - (this._lastStickT || 0) < WALK_HOME_HINT_IDLE_MS) return;
    // Both markers are drawn from their centre with the same nudge, so backing
    // it out and adding the footprint anchor puts each endpoint at the feet.
    const FEET = 13;
    const x0 = this.viewCenterX, y0 = this.viewCenterY + FEET;
    const x1 = this.gpsGhost.x;
    const y1 = this.gpsGhost.y - this.playerFeetNudgeY + FEET;
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    // Stop short at both ends so the line never runs into either character.
    const NEAR_GAP = 11, FAR_GAP = 13;
    if (len < NEAR_GAP + FAR_GAP + 10) return;
    const ux = dx / len, uy = dy / len;
    const from = NEAR_GAP, to = len - FAR_GAP;
    const DASH = 5, PERIOD = 11, MARCH = 26;   // px, px, px/s
    if (!this._reducedMotion) {
      this._walkHomeDashPhase = (this._walkHomeDashPhase + MARCH * dt) % PERIOD;
    }
    // Collected first, stroked twice: a soft dark pass under the blue one, so
    // the line holds up over pale ground (roads, sand) as well as grass — the
    // same keyline trick the stick's rim uses.
    const segs = [];
    // One period of lead-in so the dash entering at the near end is drawn
    // clipped rather than popping into existence at full length.
    for (let s = from - PERIOD + this._walkHomeDashPhase; s < to; s += PERIOD) {
      const a = Math.max(s, from), b = Math.min(s + DASH, to);
      if (b > a) segs.push([x0 + ux * a, y0 + uy * a, x0 + ux * b, y0 + uy * b]);
    }
    // Chevron at the dot end — the arrowhead the dashes are walking into.
    const px = -uy, py = ux;
    const H = 6, W = 4.5;
    const hx = x0 + ux * to, hy = y0 + uy * to;
    const head = [
      [hx - ux * H + px * W, hy - uy * H + py * W, hx, hy],
      [hx, hy, hx - ux * H - px * W, hy - uy * H - py * W],
    ];
    const stroke = (list, width, colour, alpha) => {
      g.lineStyle(width, colour, alpha);
      for (const [ax, ay, bx, by] of list) {
        g.beginPath();
        g.moveTo(ax, ay);
        g.lineTo(bx, by);
        g.strokePath();
      }
    };
    stroke(segs, 3.5, 0x0a1420, 0.22);
    stroke(head, 3.5, 0x0a1420, 0.26);
    stroke(segs, 2, 0xffffff, 0.42);
    stroke(head, 2, 0xffffff, 0.7);
  }
  // Two states the player needs to feel without reading a number, both painted
  // on the character itself: an EMPTY TANK (nothing works until you rest) and
  // being FAR from where you actually are (the walk home is long and every step
  // out there is at full price). Each tints the sprite and lights a pulsing
  // halo behind it — red for empty, near-black for far — so the warning reads
  // at a glance in the corner of the eye. Empty wins when both are true: it's
  // the one that stops you doing anything.
  //
  // The far-tint is graded, not a switch: the character dims steadily from the
  // edge of the near ring out to DARK_FULL_CELLS, so the drift outward is
  // visible while it's happening rather than snapping at a threshold.
  _updatePlayerAura() {
    const DARK_FULL_CELLS = 10;     // fully dimmed by here
    const DIM_FLOOR = 0.45;         // darkest the character gets
    const away = this._gpsAwayM();
    const nearM = NEAR_GPS_CELLS * this.cellM;
    const spent = (this.save.energy ?? 0) <= 0;
    const far = away > nearM;
    // Pulse: a slow breath, faster and deeper for the empty-tank warning.
    const t = performance.now() / 1000;
    const periodS = spent ? 1.2 : 2.0;
    const wave = 0.5 + 0.5 * Math.sin((t / periodS) * Math.PI * 2);
    if (spent || far) {
      let tint = 0xffffff;
      if (spent) {
        tint = 0xff6b6b;
      } else {
        const k = Math.min(1, (away - nearM) / Math.max(1, (DARK_FULL_CELLS - NEAR_GPS_CELLS) * this.cellM));
        const v = Math.round(255 * (1 - (1 - DIM_FLOOR) * k));
        tint = (v << 16) | (v << 8) | v;
      }
      this.player.setTint(mulTint(tint, this._dragonActive ? null : this.save.playerColor));
      const key = spent ? 'halo_red' : 'halo_dark';
      if (this.playerHalo.texture.key !== key) this.playerHalo.setTexture(key);
      // Strength follows the same k as the tint for the far case, so a halo
      // never shouts before the character has visibly dimmed.
      const strength = spent ? 1 : Math.min(1, (away - nearM) / (nearM * 2));
      this.playerHalo
        .setDisplaySize(38 + 6 * wave, 38 + 6 * wave)
        .setAlpha((0.25 + 0.35 * wave) * strength)
        .setPosition(this.viewCenterX, this.viewCenterY + this.playerFeetNudgeY)
        .setVisible(true);
    } else {
      // At rest the farmer wears the save's own colour — the same tint other
      // players see on them (multiplayer.js), so you can spot yourself.
      this.player.setTint((!this._dragonActive && this.save.playerColor) || 0xffffff);
      if (this.playerHalo.visible) this.playerHalo.setVisible(false);
    }
  }
  // Move the body one frame toward the target through open cells, mining a wall
  // only when it actually blocks the path AND can't be walked around (a cave
  // case only — the surface has no blocked cells).
  // "Choice of 2 cells": try the X-step and the Y-step of the heading
  // independently so the body slides past a wall that's off to the side. Then
  // DETECT BEING BLOCKED BY PROGRESS, not geometry: if heading toward the target
  // barely closed the gap this frame, a wall is in the way (a flat wall the old
  // wedge-only check would slide against forever). When blocked, first try a
  // single-cell jog around it (_detourDir) and only dig if no such trivial
  // detour exists. _startAutoMine no-ops unless a wall is really ahead, so a
  // body merely outrun by fast steering on open floor won't dig.
  _followStep(dt) {
    // No target yet (surface before the first fix / any steer) — stand still.
    if (!this._targetM) { this._playDirected(this.player, 'idle'); return; }
    // A wheel is running (auto-mine, or a manual chop/mine the player tapped):
    // hold position until it resolves so the body doesn't wander off its work.
    // An AUTO-engaged sword fight is exempt — you didn't ask for it, so it must
    // not root you to the spot (see _busyWheel).
    if (this._busyWheel()) { this._playDirected(this.player, 'idle'); return; }
    // Paused after a tap-interrupt — wait for the next steer (GPS/keyboard).
    if (this._followPaused) { this._playDirected(this.player, 'idle'); return; }
    // Steering? Then the walk animation follows the STICK, not the step vector
    // (see _stickHeading) — and "arrived" doesn't mean stop, because the target
    // is being dragged away again the very next frame.
    const steering = this._stickPushed() && this._stickHeading;
    const body = this.playerM;
    const dx = this._targetM.x - body.x, dy = this._targetM.y - body.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= this.cellM * 0.15) {   // arrived — sit still, don't jitter
      if (steering) this._playDirected(this.player, 'walk', this._stickHeading.x, this._stickHeading.y);
      else this._playDirected(this.player, 'idle');
      return;
    }
    // Catch-up speed: walk pace, scaled up with distance so the body keeps up
    // with fast (debug/GPS-jump) steering without ever teleporting, capped so a
    // big jump still reads as travel rather than a warp.
    //
    // While the STICK is held, floor it at the player's own stick speed: you
    // can never outrun your own legs. Without this the body settles
    // (steerSpeedMul - 1) cells behind a stick that's being held down — at
    // Frost that's a 20 m tail, and 20 m of coasting after you let go, which
    // reads as lag rather than speed. The floor is deliberately NOT applied
    // when the stick is idle: an amulet would otherwise have the body darting
    // after every few metres of GPS jitter. The cap has to clear the floor —
    // stick speeds run past DEBUG_SPEED_MUL from tier 4 up, and a cap under
    // the floor would silently cancel it.
    const stickMul = this._stickPushed() ? steerSpeedMul(this._walkRelics()) : 1;
    const mul = Math.min(Math.max(DEBUG_SPEED_MUL, stickMul),
                         Math.max(stickMul, 1 + dist / this.cellM));
    const move = Math.min(WALK_M_S * mul * dt, dist);
    const ux = dx / dist, uy = dy / dist;
    const foot = this.feetOffsetM;
    const open = (nx, ny) =>
      !this._cellBlocked(this.startWorldM.x + nx, this.startWorldM.y + ny + foot);
    const nx = body.x + ux * move, ny = body.y + uy * move;
    if ((ux !== 0) && open(nx, body.y)) body.x = nx;
    if ((uy !== 0) && open(body.x, ny)) body.y = ny;
    // Heading is the facing FALLBACK only — a real compass reading wins, same
    // rule _steerTarget follows. (The walk animation always uses the heading:
    // _playDirected is handed the vector explicitly rather than reading
    // this.facing.)
    if (this.compassDeg == null) this.facing = { x: ux, y: uy };
    if (steering) this._playDirected(this.player, 'walk', this._stickHeading.x, this._stickHeading.y);
    else this._playDirected(this.player, 'walk', ux, uy);
    // How much closer did we actually get? Against a wall in the heading
    // direction this collapses toward zero even while sliding sideways, so
    // we're blocked when progress is under half the step we tried to take.
    const moved = dist - Math.hypot(this._targetM.x - body.x, this._targetM.y - body.y);
    if (moved < move * 0.5) {
      // Blocked. Don't dig if a single-cell jog gets us around the obstacle —
      // mining is reserved for walls the player can't trivially walk past.
      const detour = this._detourDir(ux, uy);
      if (detour) {
        const sx = body.x + detour.x * move, sy = body.y + detour.y * move;
        if (detour.x !== 0 && open(sx, body.y)) body.x = sx;
        if (detour.y !== 0 && open(body.x, sy)) body.y = sy;
        if (this.compassDeg == null) this.facing = { x: detour.x, y: detour.y };
        this._playDirected(this.player, 'walk', detour.x, detour.y);
      } else {
        this._startAutoMine(ux, uy);
      }
    }
  }
  // Is the wall blocking forward progress one the body can trivially walk
  // around — one cell out of its way? Returns a unit perpendicular vector to
  // jog toward (the open side), or null if rounding the obstacle would take
  // more than a single-cell detour (in which case mining is the only way
  // through). "Trivial" means: the cell one step to the side is open AND the
  // cell forward of that sidestep is open, so a single jog clears a 1-cell-wide
  // wall. A thicker wall fails the forward check and falls through to mining.
  _detourDir(ux, uy) {
    const m = this.cellM;
    const bx = this.startWorldM.x + this.playerM.x;
    const by = this.startWorldM.y + this.playerM.y + this.feetOffsetM;
    const open = (cdx, cdy) => !this._cellBlocked(bx + cdx * m, by + cdy * m);
    // Forward = dominant heading axis; perpendicular = the other axis.
    const fwd = Math.abs(ux) >= Math.abs(uy) ? [Math.sign(ux), 0] : [0, Math.sign(uy)];
    if (!fwd[0] && !fwd[1]) return null;
    const perp = fwd[0] !== 0 ? [0, 1] : [1, 0];
    // Prefer the side the target leans toward, so we round the corner the short
    // way; with no lean (pure-axis heading) try one side then the other.
    const lean = fwd[0] !== 0 ? Math.sign(uy) : Math.sign(ux);
    for (const s of (lean < 0 ? [-1, 1] : [1, -1])) {
      const px = perp[0] * s, py = perp[1] * s;
      if (open(px, py) && open(px + fwd[0], py + fwd[1])) return { x: px, y: py };
    }
    return null;
  }
  // Pick the wall cell blocking progress toward the target (dominant axis first)
  // and start an auto-mine wheel on it. No-op if no adjacent wall is found.
  _startAutoMine(ux, uy) {
    const bx = this.startWorldM.x + this.playerM.x;
    const by = this.startWorldM.y + this.playerM.y + this.feetOffsetM;
    // Two candidates: the X-neighbour and Y-neighbour toward the target, in
    // dominant-axis order so we cut the most useful wall first.
    const cand = Math.abs(ux) >= Math.abs(uy)
      ? [[Math.sign(ux), 0], [0, Math.sign(uy)]]
      : [[0, Math.sign(uy)], [Math.sign(ux), 0]];
    for (const [cdx, cdy] of cand) {
      if (!cdx && !cdy) continue;
      const c = this.cellAt(bx + cdx * this.cellM, by + cdy * this.cellM);
      if (c.loaded && c.type === 25 /* CAVE_WALL */) { this._beginAutoMine(c); return; }
    }
  }
  // Start a work-wheel that digs cave-wall cell `c` (from cellAt) into floor and
  // drops stone — the same payout/cost as tapping a wall by hand. Auto-pauses on
  // empty energy so the player isn't silently stuck against a wall.
  _beginAutoMine(c) {
    const N = this.cellsPerTile;
    const cellIX = c.tx * N + c.ix, cellIY = c.ty * N + c.iy;
    const { x: wx, y: wy } = absCellCenterMeters(this, cellIX, cellIY);
    const cost = (typeof effectivePickCost === 'function') ? effectivePickCost(this.save.relics) : 0;
    // Affordability GATE only — do NOT deduct here. Unlike a hand-tapped mine
    // (which the player starts deliberately and waits out), the body kicks off
    // these wheels on its own — up to 9s bare-handed — while the player is
    // tapping to steer underground. An up-front charge with
    // refund-on-bail (abortWorkProgress) meant every tap during the wheel handed
    // the energy back, so a whole tunnel could be dug for almost nothing.
    // Charge at COMPLETION instead (in the wheel callback below): a dug wall
    // always costs, an interrupted one costs nothing — and isn't dug.
    if (cost > (this.save.energy ?? 0)) {
      this.flash('too tired', this.viewCenterX, this.viewCenterY);
      this._followPaused = true;   // out of energy — stop chewing the wall
      return;
    }
    const durMs = (typeof toolDurationMs === 'function')
      ? toolDurationMs(this.save.relics, 'pick')
      : (this.save.relics?.pick ? 4000 : 9000);
    this._autoMineKey = `${c.tx}/${c.ty}/${c.ix}/${c.iy}`;
    // energyRefund = 0: nothing was charged up-front, so a tap-bail has nothing
    // to refund (it just cancels the dig). The spend lands at the dig instant.
    this.startWorkProgress(wx, wy, () => {
      // Energy can have drained mid-wheel (monsters chip away at it during the
      // up-to-9s dig) even though the gate above passed at start — re-check at
      // completion and bail with no dig/loot if it no longer affords, same as
      // every other spendEnergy bail (flash already fired inside spendEnergy).
      if (!this.spendEnergy(cost, this.viewCenterX, this.viewCenterY)) {
        this._followPaused = true;   // out of energy — stop chewing the wall
        this._autoMineKey = null;
        return;
      }
      this.digCaveWall(c.tx, c.ty, c.ix, c.iy, cellIX, cellIY);
      const qty = randInt(1, 3);
      this.addToInv('rockfruit', qty);
      if (Math.random() < 0.20) this.addToInv('coal', 1);
      this._autoMineKey = null;
      persistSave(this.save);
      const item = (typeof ITEM_BY_ID !== 'undefined') ? ITEM_BY_ID['rockfruit'] : null;
      this.flashLoot(`+${qty} ${item?.name || 'Stone'}`, '#a7ffb0', 1, 'rockfruit');
    }, durMs, 0, 'pick');
  }
  // Take a staircase: delta +1 descends, -1 ascends. Snaps the player onto the
  // staircase's cell at the new depth (where a matching stair sits), swaps the
  // active tile cache, repaints the background, and loads the new level.
  changeDepth(delta, stair) {
    const target = Math.max(0, (this.depth || 0) + delta);
    if (target === this.depth) return;
    // Can't descend on an empty tank — you'd just pass out down there. Climbing
    // up is always allowed (it's how you escape exhaustion).
    if (delta > 0 && (this.save.energy ?? 0) <= 0) {
      this.flash('Too exhausted to go down — rest first.', this.viewCenterX, this.viewCenterY);
      return;
    }
    this.depth = target;
    this.save.depth = target;
    WorldGen.setDepth(target);
    // GPS-mirror: keep the same world coordinates, just snap feet onto the stair.
    this.playerM.x = stair.x - this.startWorldM.x;
    this.playerM.y = stair.y - this.startWorldM.y - this.feetOffsetM;
    // Reset target-follow: any in-flight auto-mine is dropped, and the target
    // starts coincident with the body (syncMoveTarget, below) so the two don't
    // diverge until the player steers or the next GPS fix lands.
    if (this._workProgress && this._autoMineKey) this.cancelWorkProgress();
    this._autoMineKey = null;
    // A fight doesn't follow you up the stairs: drop any auto-engaged wheel and
    // the shots still in the air, or they'd carry on against a foe on a level
    // you just left.
    if (this._workProgress?.combat) this.cancelWorkProgress();
    this._shots = [];
    this._nextShotT = {};
    this.syncMoveTarget();
    this.cameras.main.setBackgroundColor(target > 0 ? '#0a0a12' : '#222');
    this.ensureTilesAround().catch(() => {});
    this.flash(target > 0 ? `Descended — depth ${target}` : 'Back on the surface',
               this.viewCenterX, this.viewCenterY);
    persistSave(this.save);
  }
  // Black out at 0 energy underground and wake on the surface. Keeps the same
  // world coordinates (GPS re-asserts position up top); the player wakes still
  // drained, so they must rest before heading back down (changeDepth gate).
  // Passing out also costs HALF the purse — floored, so it can't go negative
  // and a broke player loses nothing further. A real cost for running the
  // tank dry is what makes "rest first" a warning worth heeding rather than a
  // free teleport home.
  _passOutToSurface() {
    this._passingOut = true;
    if (this._workProgress) this.cancelWorkProgress();
    this._autoMineKey = null;
    this._shots = [];              // nothing you loosed down there follows you up
    this._nextShotT = {};
    this.depth = 0;
    this.save.depth = 0;
    WorldGen.setDepth(0);
    // Same world coordinates, now on the surface — park the target on the body
    // so the walk up top doesn't start by chasing the cave target we woke with.
    this.syncMoveTarget();
    this.cameras.main.setBackgroundColor('#222');
    this.ensureTilesAround().catch(() => {});
    const lost = Math.floor((this.save.money ?? 0) / 2);
    if (lost > 0) addMoney(this.save, -lost);
    persistSave(this.save);
    this.showChestRewardModal({
      kind: 'rest',
      header: 'Exhausted',
      iconHTML: '<span style="font-size:42px">😵</span>',
      name: 'You pass out from exhaustion and wake up on the surface.',
      sub: lost > 0 ? `Lost $${lost} while you were out cold.` : undefined,
      color: '#ff8c3b', accent: '#ff8c3b',
      onDismiss: () => { this._passingOut = false; },
    });
  }
  // Guarantee an UP staircase (and never a DOWN one) on the home cell of every
  // cave level, so the player can always climb back toward the surface from the
  // starting house. Idempotent — runs on each (re)load of the home tile.
  _ensureHomeUpStair(entry, tx, ty) {
    if (!entry || !entry.grid || typeof HomeArea === 'undefined' || !HomeArea.worldM) return;
    const N = entry.cellsPerEdge;
    const tileEdgeM = entry.tileEdgeM;
    const hx = HomeArea.worldM.x, hy = HomeArea.worldM.y;
    if (Math.floor(hx / tileEdgeM) !== tx || Math.floor(hy / tileEdgeM) !== ty) return;
    const mPerCell = tileEdgeM / N;
    const lix = Math.floor((hx - tx * tileEdgeM) / mPerCell);
    const liy = Math.floor((hy - ty * tileEdgeM) / mPerCell);
    if (lix < 0 || liy < 0 || lix >= N || liy >= N) return;
    entry.grid[liy * N + lix] = 24;   // CAVE_FLOOR — the stair must sit on floor
    const cx = tx * tileEdgeM + (lix + 0.5) * mPerCell;
    const cy = ty * tileEdgeM + (liy + 0.5) * mPerCell;
    const half = mPerCell * 0.5;
    const atHome = (o) => Math.abs(o.x - cx) < half && Math.abs(o.y - cy) < half;
    entry.objects = entry.objects || [];
    // No descending from the house — drop any down-stair that landed here.
    entry.objects = entry.objects.filter(o => !(o.kind === 'staircase' && o.dir === 'down' && atHome(o)));
    if (!entry.objects.some(o => o.kind === 'staircase' && o.dir === 'up' && atHome(o))) {
      entry.objects.push({ kind: 'staircase', dir: 'up', x: cx, y: cy, depth: entry.depth,
        id: `homeup_${entry.depth}_${tx}_${ty}_${lix}_${liy}` });
    }
  }
  cellAt(wmx, wmy) {
    const wx = this.originPx.x + (wmx - this.startWorldM.x) / this.mPerPx;
    const wy = this.originPx.y + (wmy - this.startWorldM.y) / this.mPerPx;
    const TILE_PX = WorldGen.TILE_PX;
    const cps = TILE_PX / this.cellsPerTile;
    const tx = Math.floor(wx / TILE_PX), ty = Math.floor(wy / TILE_PX);
    const ix = Math.floor((wx - tx * TILE_PX) / cps);
    const iy = Math.floor((wy - ty * TILE_PX) / cps);
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
    const loaded = !!(entry && entry.grid);
    // Road-band flag. The terrain grid under-reports roads (QC rules: a way
    // rasterizes exactly ONE cell wide however wide its drawn band really
    // is), so "is this ground road" must come from entry.roadMask — stamped
    // from the same WorldGen.roadOverlayWidthM the overlay strokes with.
    // Checking road TERRAIN alone is the bug, not the fix.
    const underRoad = !!(loaded && entry.roadMask
      && entry.roadMask[iy * this.cellsPerTile + ix]);
    return { tx, ty, ix, iy, loaded, underRoad, type: loaded ? entry.grid[iy * this.cellsPerTile + ix] : 0 };
  }
  catchCreature(c, sx, sy) {
    this.save.caught.push(c.id);   // keep so the creature doesn't respawn
    // If this was a player-released creature, also trim it from save.released so the
    // array doesn't grow unbounded across many release-and-recatch cycles.
    if (this.save.released) {
      const ri = this.save.released.findIndex(r => r.id === c.id);
      if (ri >= 0) this.save.released.splice(ri, 1);
    }
    // One creature → one inventory entry. Egg / milk yield happens via the
    // produce branch (tap with plant produce selected), not the catch branch.
    const yieldN = 1;
    // A shiny animal stays shiny in its own per-kind stack (shiny_chicken,
    // shiny_cow, …) — never folded into the plain stack or other shinies. It
    // also pays the headline 10× money + discovery bonus with fanfare.
    const isShinyCatch = !!c.shiny && !!ITEM_BY_ID[`shiny_${c.kind}`];
    const invId = isShinyCatch ? `shiny_${c.kind}` : c.kind;
    // addToInv already persists; passing silent=true to avoid a double write.
    this.addToInv(invId, yieldN, true);
    persistSave(this.save);
    const item = ITEM_BY_ID[invId];
    // flashLoot draws the item's sprite (from the itemId arg) beside the text,
    // so the text carries the name only — no emoji standing in for the item.
    this.flashLoot(`+${yieldN} ${item?.name || invId}`, isShinyCatch ? '#ffd23a' : '#a7ffb0', 1, invId);
    if (isShinyCatch) this.awardShinyBonus(c.kind, sx, sy);
  }

  // Debug-only: jump to the next-nearest POI chest that has a decoration pad,
  // walking outward by distance. First press preferentially seeks the named
  // POI in `_poiTpFirst` if it's loaded.
  // Debug key T — cycle through tree species and teleport to the densest
  // currently-loaded grove of each. Density = "this tree plus other same-
  // species trees within 50 m." If no trees of the current species are
  // loaded, skip to the next species in the cycle so the key never
  // silently no-ops on a thin forest.
  teleportNextIndividualTree() {
    this.disableGpsForSession();
    const px = this.startWorldM.x + this.playerM.x;
    const py = this.startWorldM.y + this.playerM.y;
    if (!this._indivTreeVisited) this._indivTreeVisited = new Set();
    // Gather every standalone OSM tree across currently-loaded tiles.
    const all = [];
    WorldGen.forEachItem('objects', (o) => {
      if (o.kind === 'tree' && o.individual) all.push(o);
    });
    if (!all.length) {
      this.flash('no individual trees loaded yet', this.viewCenterX, this.viewCenterY - 40);
      return;
    }
    // Cycle outward: hop to the nearest tree we haven't visited yet. Once we've
    // seen them all, wrap around so the key keeps working. Because each hop
    // measures distance from the *new* position, repeated presses naturally
    // walk you through a cluster rather than ping-ponging.
    let pool = all.filter(o => !this._indivTreeVisited.has(o.id));
    if (!pool.length) { this._indivTreeVisited.clear(); pool = all; }
    let best = null, bestD = Infinity;
    for (const o of pool) {
      const dx = o.x - px, dy = o.y - py;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = o; }
    }
    this._indivTreeVisited.add(best.id);
    this.playerM.x = best.x - this.startWorldM.x;
    this.playerM.y = best.y - this.startWorldM.y + 4;
    this.gpsM = { x: this.playerM.x, y: this.playerM.y };
    this.syncMoveTarget();
    this.flash(`→ ${treeSpeciesName(best)} (${this._indivTreeVisited.size}/${all.length})`,
               this.viewCenterX, this.viewCenterY - 40);
  }

  teleportNextPoi() {
    this.disableGpsForSession();
    const px = this.startWorldM.x + this.playerM.x;
    const py = this.startWorldM.y + this.playerM.y;
    // Deterministic visit key by game cell — matches the render/tap dedupe so the
    // teleport cycle visits exactly the crates you can see. Chest ids are cell-snapped,
    // so duplicates of one POI across tile seams share a cell and count as a single stop.
    const chestKey = (o) => Math.floor(o.x / this.cellM) + '_' + Math.floor(o.y / this.cellM);
    // First press: try to find the named seed POI (e.g. Windermere Park).
    if (this._poiTpVisited.size === 0 && this._poiTpFirst) {
      WorldGen.forEachItem('objects', (o) => {
        if (o.kind !== 'chest' || o.name !== this._poiTpFirst) return;
        this._poiTpVisited.add(chestKey(o));
        this.playerM.x = o.x - this.startWorldM.x;
        this.playerM.y = o.y - this.startWorldM.y + 4;
        this.syncMoveTarget();
        this.flash(`→ ${rusticifyName(o.name)} (${o.poiClass})`, this.viewCenterX, this.viewCenterY - 40);
        return true; // short-circuit
      });
      if (this._poiTpVisited.size > 0) return;
    }
    // Find the nearest unvisited decorated chest, deduped by key.
    let best = null, bestD = Infinity, bestKey = null;
    const seenKey = new Set();
    WorldGen.forEachItem('objects', (o) => {
      if (o.kind !== 'chest' || !o.poiClass) return;
      if (!padShapeKeyForPoi(o.poiClass)) return;
      const k = chestKey(o);
      if (seenKey.has(k)) return;
      seenKey.add(k);
      if (this._poiTpVisited.has(k)) return;
      const d = Math.hypot(o.x - px, o.y - py);
      if (d < bestD) { bestD = d; best = o; bestKey = k; }
    });
    if (!best) {
      // Out of decorated chests within loaded tiles — reset cycle.
      this._poiTpVisited.clear();
      this.flash('cycle reset — press space again', this.viewCenterX, this.viewCenterY - 40);
      return;
    }
    this._poiTpVisited.add(bestKey);
    this.playerM.x = best.x - this.startWorldM.x;
    this.playerM.y = best.y - this.startWorldM.y + 4;
    this.syncMoveTarget();
    const label = best.name ? rusticifyName(best.name) : best.poiClass;
    this.flash(`→ ${label} (${best.poiClass}, ${Math.round(bestD)}m)`, this.viewCenterX, this.viewCenterY - 40);
  }

  // ── Toasts ───────────────────────────────────────────────────────────────
  // Every transient in-world message goes through _toast. There used to be
  // five separate builders (flash, _splashEnergyGain, flashLoot, flashJackpot,
  // flashShiny) which between them used three dark backgrounds (#000a, #000c,
  // rgba(0,0,0,.6)), four unrelated font sizes, three stroke weights including
  // none at all, and four padding shapes — so two messages a second apart could
  // look like they came from different games.
  //
  // The tiers below are the differences that are actually meaningful; every
  // other axis is now shared. See TOAST_TIER in this file for the table.
  //
  // Returns the text object so a caller can hang extra tweens on it (the
  // fanfares add a wobble). Options:
  //   tier          which row of TOAST_TIER
  //   x, y          absolute position; default is the viewport centre offset
  //                 by the tier's dy
  //   originY       1 (default) hangs the chip above y; 0 drops it below
  //   color, bg     ink and chip colour
  //   dwellMul      scales hold + fade (a chest open lingers longer)
  //   padExtraLeft  reserve inside the chip for flashLoot's DOM icon
  _toast(text, opts = {}) {
    const S = TOAST_TIER[opts.tier || 'note'];
    const x = opts.x ?? this.viewCenterX;
    const y = opts.y ?? (this.viewCenterY + S.dy);
    const mul = opts.dwellMul || 1;
    // Chip colour: caller override, else the tier's own, else the shared one.
    // A tier may opt out entirely with `bg: null`, so this can't collapse to
    // `opts.bg || S.bg || TOAST_BG` — null is exactly the value that must win.
    const bg = opts.bg !== undefined ? opts.bg
             : (S.bg !== undefined ? S.bg : TOAST_BG);
    const style = {
      font: fontMono(S.font),
      color: opts.color || UI_INK,
      stroke: UI_SHADOW, strokeThickness: S.stroke,
      padding: {
        left: S.pad + (opts.padExtraLeft || 0), right: S.pad,
        top: S.padY, bottom: S.padY,
      },
    };
    if (bg) style.backgroundColor = bg;
    if (S.shadow) {
      style.shadow = {
        offsetX: S.shadow.offsetX, offsetY: S.shadow.offsetY,
        color: UI_SHADOW, blur: S.shadow.blur, fill: true, stroke: true,
      };
    }
    const t = this.add.text(x, y, text, style)
      .setOrigin(0.5, opts.originY ?? 1).setDepth(opts.depth ?? S.depth);
    // EVERY tier clamps now. Only `flash` used to, which is why a tap near an
    // edge rendered half a message ("Just out o") — and why a long item name
    // at 22px could still run off the 352px viewport in the loot pop, where
    // nobody had noticed because most names are short.
    t.x = clampTextX(x, t.width, W);
    // Stack instead of overlapping. Do this BEFORE the drift tween is built so
    // the tween captures the final resting y.
    if (opts.stack !== false) this._stackToast(t);
    if (S.pop) {
      t.setScale(S.popScale).setAlpha(0);
      const peak = S.overshoot || 1;
      this.tweens.add({ targets: t, scale: peak, alpha: 1, duration: S.pop, ease: 'Back.Out' });
      // Fanfares overshoot and settle back; the loot pop lands directly.
      if (peak !== 1) {
        this.tweens.add({ targets: t, scale: 1, duration: S.pop, delay: S.pop, ease: 'Sine.InOut' });
      }
    } else if (S.fadeIn) {
      t.setAlpha(0);
      this.tweens.add({ targets: t, alpha: 1, duration: S.fadeIn, delay: 160 });
    }
    // t.y, not the anchor y — _stackToast may have lifted it clear.
    this.tweens.add({
      targets: t, y: t.y - S.rise, alpha: 0,
      duration: Math.round(S.fade * mul), delay: Math.round(S.hold * mul),
      ease: S.ease, onComplete: () => t.destroy(),
    });
    return t;
  }

  // Lift a freshly-built toast until it clears every toast already on screen.
  //
  // The NEW one moves, never the ones already placed. That is not a style
  // choice: a placed toast already owns a tween on its own `y` for the drift,
  // and a second tween on the same property fights it — the toast would snap
  // between the two values for the rest of its life. Walking the newcomer
  // upward past what is already there needs no tween at all.
  //
  // Overlap is tested on real rendered bounds rather than on tier or anchor,
  // so it also catches a note colliding with a loot pop, and leaves two
  // messages at opposite corners alone.
  _stackToast(t) {
    const live = this._liveToasts || (this._liveToasts = []);
    // Drop anything Phaser has already destroyed. The destroy handler below
    // normally does this; the sweep covers a scene teardown that fired none.
    for (let i = live.length - 1; i >= 0; i--) {
      if (!live[i].scene || live[i].active === false) live.splice(i, 1);
    }
    const GAP = 3;
    const ceiling = (this.viewTop ?? 0) + 2;
    const hits = (b) => live.find((o) => {
      const ob = o.getBounds();
      return !(b.right <= ob.left || b.left >= ob.right
            || b.bottom <= ob.top  || b.top  >= ob.bottom);
    });
    // Bounded: a burst of messages must not march off the top of the map. Once
    // the stack reaches the ceiling the newest simply overlaps, which is the
    // old behaviour and still better than a toast nobody can see.
    for (let guard = 0; guard < 6; guard++) {
      const b = t.getBounds();
      const hit = hits(b);
      if (!hit) break;
      const lift = (b.bottom - hit.getBounds().top) + GAP;
      if (b.top - lift < ceiling) break;
      t.y -= lift;
    }
    live.push(t);
    t.once('destroy', () => {
      const i = live.indexOf(t);
      if (i >= 0) live.splice(i, 1);
    });
  }

  // Radial ✦ burst behind a fanfare. Was written out twice, identically bar
  // the count and the throw distance.
  _starburst(x, y, count, dist, duration) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const sx = x + Math.cos(a) * 12, sy = y - 18 + Math.sin(a) * 12;
      const star = this.add.text(sx, sy, '✦', {
        font: fontMono('bold 18px'), color: UI_GOLD,
        stroke: UI_SHADOW, strokeThickness: 2,
      }).setOrigin(0.5, 0.5).setDepth(TOAST_TIER.fanfare.depth + 1).setAlpha(0.95);
      this.tweens.add({
        targets: star, x: sx + Math.cos(a) * dist, y: sy + Math.sin(a) * dist,
        alpha: 0, duration, ease: 'Sine.Out', onComplete: () => star.destroy(),
      });
    }
  }

  // Small status message, placed where the player tapped so it stays attached
  // to the thing they touched.
  flash(text, x, y) {
    this._toast(text, { tier: 'note', x, y });
  }

  // Small green "+N⚡" splash near the player when energy is RECOVERED
  // (passive rest, offline rest). No-ops before the viewport centre is known.
  _splashEnergyGain(amount) {
    if (!(amount > 0) || this.viewCenterX == null) return;
    this._toast(`+${amount}⚡`, { tier: 'note', color: UI_GREEN });
  }

  // Shared rest-energy accumulator. Adds `gain` energy onto the named fractional
  // accumulator field, spends whole points into save.energy (capped at maxE),
  // and emits the throttled green "+N⚡" splash. Used by BOTH indoor/home rest
  // and campfire warmth so the two share one mental model (and one bug surface).
  _accrueRestEnergy(accrueKey, gain, maxE) {
    this[accrueKey] = (this[accrueKey] || 0) + gain;
    const pip = Math.floor(this[accrueKey]);
    if (pip <= 0) return;
    this[accrueKey] -= pip;
    const beforeE = this.save.energy ?? 0;
    this.save.energy = Math.min(maxE, beforeE + pip);
    const gainedE = this.save.energy - beforeE;
    // Accumulate rest gains and splash a throttled "+N⚡" so a long rest shows
    // periodic ticks rather than one pop per energy pip.
    if (gainedE > 0) {
      this._restSplashAccum = (this._restSplashAccum || 0) + gainedE;
      const tnow = performance.now();
      if (!this._restSplashNextT || tnow >= this._restSplashNextT) {
        this._splashEnergyGain(this._restSplashAccum);
        this._restSplashAccum = 0;
        this._restSplashNextT = tnow + 1200;
      }
    }
    if (this.updateEnergyDOM) this.updateEnergyDOM();
  }

  // True if world point (wx,wy) is within `cells` cells of ANY entry (a {x,y})
  // in save[listKey]. Shared by fauna aversion: scarecrows repel crows/deer and
  // campfires repel slimes, both at the same radius, so the wander/flight target
  // pickers funnel through one check instead of three copies of the loop.
  _nearAny(listKey, wx, wy, cells) {
    const list = this.save[listKey];
    if (!list || !list.length) return false;
    const r2 = (cells * this.cellM) * (cells * this.cellM);
    for (const e of list) {
      // Wards (scarecrows / fires) only repel on their own level — the world is
      // GPS-mirrored across depths, so a surface ward must not reach a cave
      // creature at the same (x, y). See src/placed_floor.js.
      if (!PlacedFloor.onDepth(e, this.depth)) continue;
      const dx = e.x - wx, dy = e.y - wy;
      if (dx * dx + dy * dy < r2) return true;
    }
    return false;
  }

  // Bigger, longer-dwelling pop for loot pickups (chest opens, treasure X, harvest, debris).
  // Brief scale-up then a slow drift + fade. Always rendered at the player's viewport center
  // so the eye doesn't have to chase it back to where the X used to be.
  // dwellMul scales the hold + fade portion (chest opens use 1.25 for a longer read).
  // iconEl: an optional pre-rendered 28px icon element. Used for forged GEAR
  // (pick / axe / armor), whose art comes from gearIconHTML rather than the
  // ITEM_BY_ID-only renderItemIcon that the `itemId` path uses.
  flashLoot(text, color = UI_GOLD, dwellMul = 1, itemId = null, iconEl = null) {
    // Every "you got something" goes through here, so it's the one place a
    // success buzz needs wiring (UX audit §18).
    this.hapticOk();
    // Loot icon = DOM overlay using the same CSS-background renderer the
    // inventory uses. Going through scene.add.image(sheet) would demand
    // every icon sheet be preloaded into Phaser textures (egg / milk /
    // fish / fruit / etc.); the inventory doesn't need that, it draws
    // straight from disk via background-image. The DOM icon is appended
    // to <body> (matching the inventory bar's anchoring) and re-positioned
    // each frame against #game's CSS-scaled bounding rect.
    iconEl = iconEl || (itemId && this.renderItemIcon
      ? this.renderItemIcon(itemId, 28, 'block') : null);
    const ICON_PX = 28;       // displayed icon side
    const ICON_GAP = 8;       // gap between icon and text inside the bg
    const RESERVE = iconEl ? ICON_PX + ICON_GAP : 0;
    const t = this._toast(text, { tier: 'gain', color, dwellMul, padExtraLeft: RESERVE });
    if (iconEl) {
      // The 'block' icon came back as inline-block — restyle as a fixed
      // overlay we can absolute-position with transform.
      iconEl.style.position = 'fixed';
      iconEl.style.left = '0px';
      iconEl.style.top  = '0px';
      iconEl.style.zIndex = '102';
      iconEl.style.pointerEvents = 'none';
      iconEl.style.opacity = '0';
      iconEl.style.transformOrigin = 'center center';
      document.body.appendChild(iconEl);
      // Re-place every frame so the icon tracks the text through pop-in,
      // hold, and drift-up. Cheap — getBoundingClientRect + transform set.
      const gameEl = document.getElementById('game');
      const placeIcon = () => {
        // Runs on the scene 'update' event — INSIDE Phaser's RAF callback but
        // outside MapScene.update()'s try/catch, so a throw here would escape
        // and freeze the whole loop. If the text is already destroyed (a tween
        // onComplete / scene shutdown race could fire between frames), detach
        // and bail; wrap the rest so a transient layout error can't kill taps.
        if (!t || !t.scene || t.active === false) {
          this.events.off('update', placeIcon);
          iconEl.remove();
          return;
        }
        try {
          const r = gameScreenRect() || gameEl.getBoundingClientRect();
          const sx = r.width  / W;   // current CSS scale (uniform — same value either axis)
          const sy = r.height / H;
          const b = t.getBounds();   // Phaser/game coords
          const reserveCentreFromLeft = (10 + RESERVE / 2) * t.scaleX;
          const cx = b.left + reserveCentreFromLeft;
          const cy = (b.top + b.bottom) / 2;
          const px = r.left + cx * sx;
          const py = r.top  + cy * sy;
          // Match the text's current scale (0.6 → 1.0 during pop-in) and alpha.
          iconEl.style.transform =
            `translate(${Math.round(px - ICON_PX / 2)}px, ${Math.round(py - ICON_PX / 2)}px) scale(${t.scaleX})`;
          iconEl.style.opacity = String(t.alpha);
        } catch (_) { /* keep the loop alive; the destroy handler will clean up */ }
      };
      this.events.on('update', placeIcon);
      // Clean up alongside the text — covers normal completion AND any
      // early scene shutdown (Phaser destroys all GOs on stop).
      t.once('destroy', () => {
        this.events.off('update', placeIcon);
        iconEl.remove();
      });
      placeIcon();
    }
  }

  // Jackpot fanfare for rarity.js' boost-chain rewards. Fires on any jackpot
  // (+1 or larger) since rarity.js now gates the geometric chain at a low
  // jackpotEntryP (~16%) so each fanfare feels earned. Call AFTER flashLoot
  // — stacks above the loot pop at depth 110.
  flashJackpot(n) {
    if (!n || n < 1) return;
    if (!this.add) return;
    try {
      const t = this._toast(`✨ JACKPOT +${n} ✨`,
        { tier: 'fanfare', color: UI_GOLD, bg: '#3a1f5a' });
      this.tweens.add({ targets: t, angle: 4, duration: 320, yoyo: true, repeat: 2, delay: 200, ease: 'Sine.InOut' });
      this._starburst(t.x, t.y, 6, 70, 900);
    } catch (_) {}
  }

  // A rare SHINY find (yellow-tinted flora / tree / animal). Pays 10× the
  // harvested/caught item's value in cash, banks a Discovery point, and fires
  // the shiny fanfare. `baseId` is the plain item id used to read the value
  // (e.g. 'wood', 'apple', 'cow'). Returns the cash awarded.
  awardShinyBonus(baseId, sx, sy) {
    const value = (typeof itemValue === 'function')
      ? itemValue(baseId)
      : (PRICES[baseId] ?? 1);
    const money = Math.max(10, Math.round(value * 10));
    addMoney(this.save, money);
    // Discovery badge: at most ONE per type of interactable (keyed by baseId —
    // the species/kind/produce id). The first shiny of a given type banks a
    // Discovery badge — a normal inventory stack (id 'discovery', cap-exempt so
    // a full bag can never eat one); later shinies of the same type still pay
    // the cash windfall but don't re-award the badge. Added silent so the
    // fanfare moment doesn't hijack the player's selected tab/stack; the
    // explicit rebuild below makes the new badge count show immediately.
    const found = this.save.discovered = this.save.discovered || {};
    const isNew = !found[baseId];
    if (isNew) {
      found[baseId] = 1;
      this.addToInv('discovery', 1, true);
    }
    persistSave(this.save);
    if (isNew && this.buildInventoryDOM) this.buildInventoryDOM();
    this.flashShiny(money, isNew);
    return money;
  }

  // Shiny-find fanfare — a richer cousin of flashJackpot in warm gold. Headline
  // banner + a money line + a Discovery line, with a starburst. Call AFTER the
  // loot/catch flash so it stacks above (depth 110).
  flashShiny(money, isNew = true) {
    if (!this.add) return;
    try {
      const banner = this._toast('✨ SHINY FIND ✨',
        { tier: 'fanfare', color: UI_GOLD_PALE, bg: '#7a5200' });
      this.tweens.add({ targets: banner, angle: 4, duration: 320, yoyo: true, repeat: 2, delay: 200, ease: 'Sine.InOut' });
      // Hangs BELOW the headline (originY 0) rather than above it, which is
      // the whole reason `sub` is its own tier.
      const subText = isNew ? `+$${money}   🔆 +1 Discovery` : `+$${money}`;
      // Pinned 8px under the headline's FINAL y (the banner may have been
      // lifted clear of a loot pop — flashShiny is documented to fire after
      // one) and opted out of stacking, so the pair always reads as one unit
      // instead of the sub wandering off to find its own clear slot.
      this._toast(subText, {
        tier: 'sub', color: UI_GOLD_DEEP, originY: 0,
        y: banner.y + 8, stack: false,
      });
      this._starburst(banner.x, banner.y, 8, 80, 950);
    } catch (_) {}
  }

  updateHUD() {
    // Runs every frame, so every write in here is guarded on the value having
    // actually changed. Money and energy move a few times a minute at most,
    // but an unguarded textContent/style assignment still costs a style
    // invalidation on each of the ~60 frames a second in between.
    // Money badge always shown.
    if (this.moneyEl) {
      const money = `$${this.save.money ?? 0}`;
      if (this._moneyDOM !== money) { this._moneyDOM = money; this.moneyEl.textContent = money; }
      // The chip now holds a real balance, so it can be shown. Until this
      // point body.booting keeps the whole top row off screen: the markup
      // ships "$0" and "⚡100/100" as placeholder text, and on a fresh save the
      // scene does not exist for the whole opening story — so the first thing
      // a new player read was a money chip saying $0, which then became $50
      // the moment the world came up. (body.modal-open, which dims these two
      // for a dialog, cannot cover that stretch: it is toggled from the
      // scene's own update loop, and there is no scene yet.)
      document.body.classList.remove('booting');
    }
    this.updateEnergyDOM();
    this.updateRelicRow();
    // Debug HUD: only show when GPS is unavailable or unfixed — i.e. an
    // exception case (desktop/wasd, denied permission, still acquiring).
    const gpsLive = this.gpsAvailable && this.gpsM;
    if (gpsLive) {
      if (this._hudDOM !== '') { this._hudDOM = ''; this.hud.textContent = ''; }
      return;
    }
    // 'waiting for GPS…' is genuine live status and stays until a fix lands.
    // The no-GPS movement hint retires the moment the player moves by hand
    // (see _steerManual) — after that it is a permanent line of instructions
    // for something they have already done.
    const text = this.gpsAvailable ? 'waiting for GPS…'
      : (this._steeredManually ? '' : 'no GPS — use the stick or WASD to move');
    if (this._hudDOM !== text) { this._hudDOM = text; this.hud.textContent = text; }
  }

  // Always derive the cap from currently-equipped armor (rather than reading
  // a stale save.maxEnergy that may pre-date the latest armor change). All
  // energy reads/writes funnel through this so the UI and the writer agree.
  getMaxEnergy() {
    return Energy.maxEnergy(this.save);
  }

  // Equip a bought/forged relic or armor piece into its slot. Armor also
  // recomputes max energy and grants the freshly-unlocked headroom (captured
  // BEFORE mutating armor so the bump is the delta, not the whole new max).
  _equipGear(kind, slot, tier) {
    Gear.equip(this.save, kind, slot, tier);
  }

  // Convert a wall-time gap (since the previous lastSeenAt) into energy and
  // restore it. Called from create() and the visibilitychange handler so the
  // same formula serves both "tab was closed" and "tab was backgrounded".
  applyOfflineRest(gapMs) {
    const gained = Energy.applyOfflineRest(this.save, gapMs);
    if (gained > 0 && this.updateEnergyDOM) this.updateEnergyDOM();
    if (gained > 0) this._splashEnergyGain(gained);
  }

  updateEnergyDOM() {
    // Element refs are looked up once and kept: the energy widget is static
    // markup in index.html and is never rebuilt. Re-query until found, so a
    // call that somehow lands before the DOM is parsed can't cache nulls.
    let els = this._energyEls;
    if (!els || !els.el) {
      els = this._energyEls = {
        el:    document.getElementById('energy'),
        label: document.getElementById('energy-label'),
        fill:  document.getElementById('energy-bar-fill'),
      };
    }
    const el = els.el;
    if (!el) return;
    const cur = Math.max(0, this.save.energy ?? 0);
    const max = this.getMaxEnergy();
    // Every value written below — the two colours, the label text, the bar
    // width — is a pure function of (cur, max). This is called once per frame
    // from updateHUD, so when neither has moved there is nothing to write:
    // bail before touching the DOM rather than restating the same six values
    // and dirtying style for the next layout pass.
    if (this._energyDOMCur === cur && this._energyDOMMax === max) return;
    this._energyDOMCur = cur;
    this._energyDOMMax = max;
    const pct = max > 0 ? cur / max : 0;
    // Green normally, yellow at/below 30%, red when critically low.
    // Green → GOLD → red. Gold is the interaction colour everywhere else in the
    // HUD, and this gauge is not a control — it was briefly moved to amber for
    // that reason. Reverted on the call that the traffic-light reading is worth
    // more here than the strict colour law: a draining bar is an idiom players
    // already know, and the gauge carries no affordance for gold to confuse.
    const color = pct > 0.30 ? '#a7ffb0' : (pct > 0.10 ? '#ffe066' : '#ff8a7a');
    el.style.borderColor = pct > 0.30 ? '#4a8c4a' : (pct > 0.10 ? '#8c7a2a' : '#a04040');
    const label = els.label;
    if (label) { label.style.color = color; label.textContent = `⚡${cur}/${max}`; }
    else { el.style.color = color; el.textContent = `⚡${cur}/${max}`; }
    const fill = els.fill;
    if (fill) {
      fill.style.width = `${Math.round(pct * 100)}%`;
      fill.style.background = color;
    }
  }

  // ── First-session objective chip ────────────────────────────────────────
  // Renders the active step of the starter ladder (quests.js STARTER_CHAIN)
  // into #objective. One step is shown at a time — the whole point is to
  // answer "what now?" with a single instruction, not a checklist. The chip
  // removes itself once the ladder is finished or the player dismisses it.
  updateObjectiveDOM() {
    const el = document.getElementById('objective');
    if (!el) return;
    if (typeof Quests === 'undefined' || Quests.starterHidden(this.save)) {
      el.style.display = 'none';
      return;
    }
    // With no map tiles loaded there is no road and no crate, so the ladder's
    // "supply crates were left along the road nearby" reads as a lie over an
    // empty green field. Hold the chip until at least one tile is ready; the
    // #banner is what's talking to the player in that state.
    if (this._tilesReady === 0) { el.style.display = 'none'; return; }
    const step = Quests.starterCurrent(this.save);
    if (!step) { el.style.display = 'none'; return; }
    const idx = Quests.starterStepIndex(this.save);
    el.querySelector('.step').textContent  = `${idx + 1}/${Quests.starterTotal()}`;
    el.querySelector('.title').textContent = step.title;
    el.querySelector('.body').textContent  = step.body;
    el.style.display = 'block';
  }

  // Hide the chip for good (the × button). The ladder keeps tracking quietly
  // underneath, so nothing downstream has to care that it was dismissed.
  dismissObjective() {
    if (typeof Quests === 'undefined') return;
    Quests.starterDismiss(this.save);
    persistSave(this.save);
    this.updateObjectiveDOM();
  }

  // Report a gameplay event to the starter ladder. Called from the site that
  // performs the action (open a crate, till, plant, restore, harvest, sell);
  // no-ops unless that event is exactly what the current step is waiting for,
  // so the call sites can fire unconditionally and stay ignorant of the chain.
  questEvent(event) {
    if (typeof Quests === 'undefined') return;
    const done = Quests.onStarterEvent(this.save, event);
    if (!done) return;
    // Bank the step NOW — the money and the advanced ladder are earned whether
    // or not the player ever looks at the celebration.
    if (done.reward?.money) addMoney(this.save, done.reward.money);
    persistSave(this.save);
    this.buildInventoryDOM();
    this._celebrateStarterStep(done);
  }

  // Say that a starter step just completed: a green toast at the view centre
  // and a 1400 ms hold on the objective chip.
  //
  // Always QUEUED, never played inline, because the first step of the ladder —
  // the one EVERY player completes first — fires from inside the chest
  // handler, one line before it opens the reward modal. Both halves of the
  // celebration then played underneath that card: the toast clipped to a
  // sliver at the modal's top edge, and the chip hold (which body.modal-open
  // hides outright) expiring before the player had tapped through. They came
  // back to a chip reading 2/6 with nothing having acknowledged step 1.
  //
  // Testing "is a modal open?" right here does NOT work and was the first
  // attempt: at that moment the reward modal has not been created and
  // body.modal-open still says no. So the decision waits a frame, for
  // _installModalPadGate's sync to have looked at the real DOM — that sync
  // owns the flush. With no dialog in the way the delay is one frame, which
  // is not perceptible; with one, the cheer waits for it to close.
  //
  // Gated on ANY modal rather than on the chest path specifically, so
  // restoring a wreck (its own ceremony) and any future step that completes
  // behind a dialog get the same treatment without their call sites knowing.
  _celebrateStarterStep(done) {
    (this._pendingStarterCheers = this._pendingStarterCheers || []).push(done);
  }

  _flushStarterCheers() {
    const queued = this._pendingStarterCheers;
    if (!queued || !queued.length) return;
    this._pendingStarterCheers = [];
    // Only the LAST one gets the full ceremony: two cheers racing for the same
    // chip means the first is overwritten mid-hold anyway, and stacking their
    // toasts on one frame just makes an unreadable pile. The rest are already
    // banked; the chip resync at the end of the play shows where the ladder
    // actually stands.
    // Own try/catch: this is also called from _installModalPadGate's
    // MutationObserver callback, which runs outside update()'s guard — a throw
    // escaping from a microtask there is uncatchable by the game loop.
    try { this._playStarterCheer(queued[queued.length - 1]); }
    catch (e) { this._reportLoopError?.(e); }
  }

  _playStarterCheer(done) {
    this.flashLoot(`✅ ${done.title}${done.reward?.money ? ` +$${done.reward.money}` : ''}`, '#a7ffb0', 1.3);
    // Hold the COMPLETED step on screen in green for a beat before swapping in
    // the next one, so finishing something is legible instead of an instant
    // relabel. The held text is written from `done` rather than left as
    // whatever the chip happened to show, so two completions in quick
    // succession each get their own flash instead of re-freezing a stale one.
    const el = document.getElementById('objective');
    // No chip on screen (dismissed, or not built yet) — just resync and go.
    if (!el || el.style.display === 'none') { this.updateObjectiveDOM(); return; }
    el.classList.add('done');
    el.querySelector('.step').textContent  = '✓';
    el.querySelector('.title').textContent = done.title;
    el.querySelector('.body').textContent  = done.reward?.money
      ? `Done — $${done.reward.money} earned.`
      : 'Done.';
    if (this._objectiveTimer) clearTimeout(this._objectiveTimer);
    this._objectiveTimer = setTimeout(() => {
      el.classList.remove('done');
      this.updateObjectiveDOM();
    }, 1400);
  }

  // Spend energy if the player has enough, returning true on success.
  // Callers (interact.js handlers) refuse the action when this returns false.
  spendEnergy(cost, sx, sy) {
    if (cost <= 0) return true;
    const r = Energy.spend(this.save, cost);
    if (!r.ok) {
      if (sx != null && sy != null) this.flash('too tired', sx, sy);
      return false;
    }
    this._warnIfTiring(r.before, sx, sy);
    this.updateEnergyDOM();
    return true;
  }

  // Flash a "getting tired" warning the first time a drain crosses below 30%
  // energy, so running down toward 0 (where you can't reach at all) isn't a
  // silent surprise. `before` is the energy reading just before the drain;
  // sx/sy are optional and default to the view centre.
  _warnIfTiring(before, sx, sy) {
    // Energy.crossedTired owns the reach-potion guard + 30%-threshold math; this
    // wrapper only fires the flash (defaulting to the view centre).
    if (Energy.crossedTired(this.save, before)) {
      this.flash('getting tired…', sx != null ? sx : this.viewCenterX,
                                    sy != null ? sy : this.viewCenterY);
    }
  }

  // Eat one of the selected food stack (consumes 1, restores FOOD_ENERGY[id]).
  // Returns true if eaten, false if not edible / nothing selected.
  // Side-effects: pairy → arm chest compass for 5 min; rainberry → water all crops within 20m.
  // === Consumables ============================================
  // Play a flute (consumed): every wandering chicken / cow within 30m has its
  // home position re-anchored to ~5m from the player so they wander toward you
  // over the next few seconds. Doesn't teleport — that would feel cheesy.
  // Shared tail for modal-feedback consumables (flute, book): consume the
  // selected item, persist, rebuild the inventory bar, and pop a message
  // modal. Returns true so callers can `return this._finishConsumable(...)`.
  // NOTE: eatSelected deliberately does NOT use this — it consumes mid-method
  // (before computing side-effects) and gives flash feedback + energy DOM.
  _finishConsumable(title, body) {
    consumeSelected(this.save);
    persistSave(this.save);
    this.buildInventoryDOM();
    this.showMessageModal({ title, body });
    return true;
  }

  playFlute() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'flute' || (sel.count ?? 0) <= 0) return false;
    const pWX = this.startWorldM.x + this.playerM.x;
    const pWY = this.startWorldM.y + this.playerM.y;
    let lured = 0;
    for (const entry of WorldGen.tileCache.values()) {
      if (!entry.creatures) continue;
      for (const c of entry.creatures) {
        if (this.save.caught.includes(c.id)) continue;
        if (c.kind !== 'chicken' && c.kind !== 'cow') continue;
        const d = Math.hypot(c.x - pWX, c.y - pWY);
        if (d > 30) continue;
        // Re-anchor the wander home toward the player. The wanderer's next
        // step picks a direction biased back toward _homeX/_homeY when it
        // drifts beyond ~3 cells, so this pulls them in over a few ticks.
        const ang = Math.atan2(pWY - c.y, pWX - c.x);
        const r = 3;   // place home 3m from player
        c._homeX = pWX + Math.cos(ang) * r;
        c._homeY = pWY + Math.sin(ang) * r;
        c._nextChooseT = 0;   // force a fresh step now
        lured++;
      }
    }
    return this._finishConsumable(
      '🪈 You play the flute',
      lured > 0 ? `${lured} creature${lured === 1 ? '' : 's'} come${lured === 1 ? 's' : ''} closer.` : 'Nothing stirs nearby.',
    );
  }

  // Read a book (consumed): pick a random tip from PLAY_TIPS, OR — 50% of the
  // time when an unopened chest exists within ~250 paces — reveal directional
  // hint to the nearest one ("about 47 paces northwest"). Either way it's
  // never useless: even repeat-readers learn something or get a hint.
  readBook() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'book' || (sel.count ?? 0) <= 0) return false;
    let body;
    let title = '📖 You crack open the book';
    // Try the directional-hint branch first (coin flip).
    if (Math.random() < 0.5) {
      const chest = this.findNearestUnopenedChest();
      if (chest) {
        const pWX = this.startWorldM.x + this.playerM.x;
        const pWY = this.startWorldM.y + this.playerM.y;
        const dxM = chest.x - pWX, dyM = chest.y - pWY;
        const distM = Math.hypot(dxM, dyM);
        if (distM <= 250) {
          // ~1 pace = 0.75m, so paces ≈ distM / 0.75.
          const paces = Math.max(1, Math.round(distM / 0.75));
          const ang = (Math.atan2(dyM, dxM) * 180 / Math.PI + 450) % 360;   // 0=N, CW
          const dirs = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
          const dir = dirs[Math.round(ang / 45) % 8];
          const placeName = chest.name ? rusticifyName(chest.name) : 'a chest';
          body = `"${placeName} lies about ${paces} paces ${dir}."`;
        }
      }
    }
    if (!body) {
      // Generic tip from the pool.
      const tip = PLAY_TIPS[Math.floor(Math.random() * PLAY_TIPS.length)];
      body = `"${tip}"`;
    }
    return this._finishConsumable(title, body);
  }

  // Drink a Potion of Reach (consumed): light up the whole visible view for
  // 1 minute. coords.js' reachRadiusM checks save.reachPotionUntil and, while
  // it's in the future, returns a full-screen radius regardless of energy — so
  // the lit silhouette AND every tap-accept gate cover everything on screen.
  // Stored in `save` (not just in-memory) so the buff survives tile reloads
  // within the minute; the timestamp self-expires, so a stale save is harmless.
  drinkReachPotion() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'reach_potion' || (sel.count ?? 0) <= 0) return false;
    this.save.reachPotionUntil = Date.now() + MINUTE_MS;
    return this._finishConsumable(
      '✨ You drink the Potion of Reach',
      'The whole world snaps into reach — for one minute, everything on screen is yours to touch.',
    );
  }

  drinkVigorPotion() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'vigor_potion' || (sel.count ?? 0) <= 0) return false;
    const max = this.getMaxEnergy();
    const restored = Math.min(40, max - (this.save.energy ?? 0));
    this.save.energy = Math.min(max, (this.save.energy ?? 0) + 40);
    if (this.updateEnergyDOM) this.updateEnergyDOM();
    return this._finishConsumable(
      'You drink the Potion of Vigor',
      restored > 0 ? `Energy restored by ${restored}.` : 'You were already at full energy.',
    );
  }

  // Potion of Speed: a minute of tier-9 amulet walking, even without an amulet
  // — the stick moves you faster and costs almost no stamina (_walkRelics
  // reads speedPotionUntil).
  drinkSpeedPotion() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'speed_potion' || (sel.count ?? 0) <= 0) return false;
    this.save.speedPotionUntil = Date.now() + MINUTE_MS;
    return this._finishConsumable(
      'You drink the Potion of Speed',
      'Your legs blaze — tier-9 amulet walking for one minute.',
    );
  }

  drinkShieldPotion() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'shield_potion' || (sel.count ?? 0) <= 0) return false;
    this.save.shieldPotionUntil = Date.now() + MINUTE_MS;
    return this._finishConsumable(
      'You drink the Potion of Shielding',
      'A shimmering barrier wraps you — monster damage halved for one minute.',
    );
  }

  // True while a Dragon Powder is active. The buff is a 1-minute in-memory
  // timer (this._dragonUntil) — deliberately NOT persisted to the save, so a
  // refresh ends it. _walkRelics (the tier-8 legs) and interact.js's 2×-damage
  // check both route through here.
  isDragonActive() {
    return (this._dragonUntil ?? 0) > Date.now();
  }

  // Dragon Powder: for ONE MINUTE you wear a red dragon and get its stats —
  // a tier-8 amulet's legs (DRAGON_AMULET_TIER, so the stick walks you faster
  // and for less stamina than any forged amulet can) and 2× attack damage
  // (interact.js halves the kill-wheel duration while in dragon form). No
  // flight, no separate movement mode: a dragon walks the way everyone walks.
  useDragonPowder() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'dragon_powder' || (sel.count ?? 0) <= 0) return false;
    this._dragonUntil = Date.now() + MINUTE_MS;
    return this._finishConsumable(
      '🐉 You toss the Dragon Powder',
      'Scales erupt across your skin — you ARE a dragon for one minute: dragon legs on the stick, and every blow lands twice as hard.',
    );
  }

  // Sapphire portal: spend one gem to open a one-shot shaft straight down a
  // level, in place. Down-only — there's no return portal; climb back up a
  // staircase as usual. The gem is consumed only when the descent actually
  // happens, so an empty energy tank (which changeDepth refuses) never burns it.
  useSapphirePortal() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'sapphire' || (sel.count ?? 0) <= 0) return false;
    if ((this.save.energy ?? 0) <= 0) {
      this.flash('Too exhausted to open a portal — rest first.', this.viewCenterX, this.viewCenterY);
      return false;
    }
    // Synthetic "stair" at the player's own world cell. changeDepth GPS-mirrors
    // coords onto the stair, so handing it our current position drops us down
    // one level without moving — the cave cell under a walkable surface cell is
    // floor, so we land on solid ground.
    const stair = {
      x: this.startWorldM.x + this.playerM.x,
      y: this.startWorldM.y + this.playerM.y + this.feetOffsetM,
    };
    consumeSelected(this.save);
    this.buildInventoryDOM();
    this.changeDepth(+1, stair);
    return true;
  }

  eatSelected() {
    const sel = getSelectedSlot(this.save);
    if (!sel || (sel.count ?? 0) <= 0) return false;
    const restore = FOOD_ENERGY[sel.id];
    if (restore == null) return false;
    // First taste of a new edible permanently grows the bar: +1 max energy per
    // distinct food ever eaten (Energy.maxEnergy folds save.eaten into the
    // cap). Recorded BEFORE the restore below so the new headroom is fillable
    // by this very bite.
    let firstTaste = false;
    this.save.eaten = this.save.eaten || [];
    if (!this.save.eaten.includes(sel.id)) {
      this.save.eaten.push(sel.id);
      firstTaste = true;
    }
    const before = this.save.energy ?? 0;
    this.save.energy = Math.min(this.getMaxEnergy(), before + restore);
    const gained = this.save.energy - before;
    consumeSelected(this.save);
    // Special effects.
    let extra = '';
    if (sel.id === 'pairy') {
      const target = this.findNearestUnopenedChest();
      if (target) {
        this.pairyCompass = { targetId: target.id, x: target.x, y: target.y,
          until: Date.now() + 5 * MINUTE_MS };
        extra = `\n🧭 chest compass: 5 min`;
      } else {
        extra = `\n🧭 no chests nearby`;
      }
    } else if (sel.id === 'rainberry') {
      const watered = this.waterCropsWithin(20);
      extra = watered > 0 ? `\n💧 watered ${watered} crop${watered === 1 ? '' : 's'}` : '\n💧 no crops nearby';
    } else if (sel.id === 'coffee') {
      this.save.coffeeUntil = Date.now() + COFFEE_BUFF_MS;
      extra = `\n☕ amulet buzz: +${COFFEE_AMULET_BOOST} tier, 3 min`;
    }
    if (firstTaste) extra += `\n🍽 first taste: +1 max ⚡`;
    persistSave(this.save);
    this.buildInventoryDOM();
    this.updateEnergyDOM();
    // Quiet pop-up instead of a modal — eating is a frequent action and a
    // dismiss-tap every time would get old fast. Longer dwellMul so the
    // gain (+ any compass / water side-effect) is readable before fading.
    this.flashLoot(`+${gained}⚡${extra}`, '#a7ffb0', 1.8, sel.id);
    return true;
  }

  // Find the nearest chest the player hasn't opened. Used by the pairy compass.
  findNearestUnopenedChest() {
    const pWX = this.startWorldM.x + this.playerM.x;
    const pWY = this.startWorldM.y + this.playerM.y;
    const opened = setOf(this.save.opened);
    let best = null, bestD2 = Infinity;
    for (const e of WorldGen.tileCache.values()) {
      for (const o of (e.objects || [])) {
        if (o.kind !== 'chest') continue;
        if (opened.has(o.id)) continue;
        const dx = o.x - pWX, dy = o.y - pWY;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { best = o; bestD2 = d2; }
      }
    }
    return best;
  }

  // Water every planted crop within ${radius} meters of the player. Returns count.
  // Sets watered_t = now on cells that aren't already watered or at MAX_GROWTH_STAGE.
  waterCropsWithin(radius) {
    const pWX = this.startWorldM.x + this.playerM.x;
    const pWY = this.startWorldM.y + this.playerM.y;
    return Crops.waterWithin(this.save, pWX, pWY, radius);
  }

  // Shared factory for all modal overlays. Returns { wrap, box, mount, mkBtn }.
  //   onClose — if provided, backdrop click (tap on wrap outside box) removes
  //             the modal and calls onClose(). Pass () => {} for no-op backdrop.
  //   mkBtn(label, primary, disabled) — standardised button factory reused by
  //             every modal so styling stays consistent site-wide.
  //   borderColor — defaults to the CONTROL gold: an ordinary dialog is
  //             something the player drives. Treasure ceremonies override it
  //             with the blue-white (spec §UI COLOUR LANGUAGE).
  makeModalShell(id, { zIndex = 50, minWidth = 230, maxWidth = 320, borderColor = UI_CONTROL_DIM,
    textAlign = 'center', wrapBg = '#0008', wrapExtra = '', boxExtra = '', onClose,
    kind, kindLabel } = {}) {
    document.getElementById(id)?.remove();
    const wrap = document.createElement('div');
    wrap.id = id;
    // Shared marker so _installModalPadGate can tell when ANY dialog is open and
    // hide the movement pads (which otherwise sit on top of the modal — see the
    // gate). Every modal goes through here, so one class covers them all.
    wrap.classList.add('game-modal');
    // Single source of truth for where EVERY dialog sits vertically. The wrap
    // fills #game's 844px box and flex-centres the box, but we reserve space at
    // the bottom (MODAL_LIFT_PX) so the centred dialog rides ABOVE dead-centre,
    // clear of the bottom inventory/HUD cluster (tabs/slots/name/action btns).
    // Because all modals go through here, they all position identically — tweak
    // this one constant to move them all.
    // Cover the VISIBLE slice of the game box, not the whole 844-tall box —
    // fitGame publishes it as --view-top/--view-h in game px. Centring on the
    // box put a dialog's middle below the viewport on every short screen.
    wrap.style.cssText =
      `position:absolute;left:0;right:0;top:var(--view-top,0px);height:var(--view-h,100%);` +
      `z-index:${zIndex};display:flex;align-items:center;justify-content:center;` +
      `padding-bottom:${MODAL_LIFT_PX}px;box-sizing:border-box;` +
      `background:${wrapBg};pointer-events:auto;${wrapExtra}`;
    const box = document.createElement('div');
    box.style.cssText =
      `min-width:${minWidth}px;max-width:${maxWidth}px;background:#1a1612;color:#fff;` +
      `border:2px solid ${borderColor};border-radius:10px;padding:14px 16px;` +
      `font:13px ui-monospace,monospace;` +
      // Any dialog taller than the viewport scrolls INSIDE itself. Stats &
      // Relics had neither cap nor scroll, so its header was clipped off the
      // top and its Close button ran off the bottom — the only way out was a
      // backdrop tap on whatever sliver of wrap was still visible.
      // Minus the wrap's own bottom lift as well as the margin: the lift eats
      // into the flex content box, so a dialog capped only against --view-h
      // still overflowed BOTH ends (its header clipped off the top).
      `max-height:calc(var(--view-h, 100%) - ${MODAL_LIFT_PX}px - 32px);` +
      `overflow-y:auto;overscroll-behavior:contain;` +
      (textAlign ? `text-align:${textAlign};` : '') +
      boxExtra;
    if (onClose !== undefined) {
      wrap.addEventListener('click', (e) => { if (e.target === wrap) { wrap.remove(); onClose?.(); } });
    }
    // ── The kind header ────────────────────────────────────────────────
    // A hero icon plus the one-word category (MODAL_KINDS), so every dialog
    // announces what it is before its first line of copy. `kindLabel`
    // overrides the word for a one-off outcome while keeping the icon.
    //
    // Built here but inserted in mount(), NOT appended to `box` now: several
    // callers build their contents with `box.innerHTML = …`, which would
    // silently wipe a header added up front. mount() runs after all of them,
    // so injecting at the top there is the one placement no caller can undo.
    const k = typeof kind === 'string' ? MODAL_KINDS[kind] : kind;
    let kindNode = null;
    if (k) {
      kindNode = document.createElement('div');
      kindNode.className = 'modal-kind';
      kindNode.style.cssText =
        'display:flex;align-items:center;justify-content:center;gap:7px;' +
        'margin:-2px 0 10px;padding-bottom:8px;' +
        `border-bottom:1px solid ${borderColor}59;`;
      const ico = document.createElement('span');
      ico.style.cssText = 'font-size:22px;line-height:1';
      ico.textContent = k.icon;
      const lbl = document.createElement('span');
      lbl.style.cssText =
        'font:700 11px ui-monospace,monospace;letter-spacing:.14em;' +
        `text-transform:uppercase;color:${borderColor};`;
      lbl.textContent = kindLabel ?? k.label;
      kindNode.appendChild(ico);
      kindNode.appendChild(lbl);
    }
    const mount = () => {
      if (kindNode) box.insertBefore(kindNode, box.firstChild);
      wrap.appendChild(box);
      (document.getElementById('game') || document.body).appendChild(wrap);
    };
    const mkBtn = (label, primary = true, disabled = false) => {
      const b = document.createElement('button');
      b.innerHTML = label;
      b.style.cssText =
        `padding:8px 14px;border-radius:6px;font:700 13px ui-monospace,monospace;cursor:pointer;` +
        (primary
          // Buttons are CONTROLS — gold, always (spec §UI COLOUR LANGUAGE).
          ? `background:${UI_CONTROL_DIM};color:#1a1612;border:0;`
          : 'background:transparent;color:#ddd;border:2px solid #444;');
      if (disabled) { b.disabled = true; b.style.opacity = '0.4'; b.style.cursor = 'not-allowed'; }
      return b;
    };
    return { wrap, box, mount, mkBtn };
  }

  // Simple OK-button modal for ambient game messages (eat effects, status, etc.).
  showMessageModal({ title, body, okLabel = 'OK' }) {
    document.getElementById('offer-modal')?.remove();
    const { wrap, box, mount, mkBtn } = this.makeModalShell('message-modal',
      { zIndex: 60, onClose: () => {}, kind: 'note' });
    const safeBody = String(body).replace(/\n/g, '<br>');
    box.innerHTML =
      `<div style="opacity:.85;font-size:13px;margin-bottom:8px;color:#ffe066">${title}</div>` +
      `<div style="margin:6px 0 12px;white-space:pre-wrap">${safeBody}</div>`;
    const btn = mkBtn(okLabel);
    btn.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); });
    box.appendChild(btn);
    mount();
  }

  // Confirmation dialog shown BEFORE an item is fed to a creature, so a stray
  // tap never silently consumes food. It spells out exactly WHAT is being fed
  // to WHICH fauna (icon + name on each side) and runs onConfirm() only if the
  // player accepts; Cancel or a backdrop tap aborts without consuming anything.
  showFeedConfirm({ foodId, faunaKind, onConfirm }) {
    // A confirm dialog is already open (rapid double-tap) — ignore the new one
    // so we never stack two over the same animal.
    if (document.getElementById('feed-confirm-modal')) return;
    const foodName  = ITEM_BY_ID[foodId]?.name || foodId;
    const faunaName = ITEM_BY_ID[faunaKind]?.name || faunaKind;
    const { wrap, box, mount, mkBtn } =
      this.makeModalShell('feed-confirm-modal', { zIndex: 60, onClose: () => {}, kind: 'farm' });
    const side = (iconId, label) =>
      `<span style="display:inline-flex;flex-direction:column;align-items:center;gap:3px">` +
        `${this.iconSpanHTML(iconId, 32)}<span style="font-size:11px">${label}</span></span>`;
    box.innerHTML =
      `<div style="opacity:.85;font-size:13px;margin-bottom:10px;color:#ffe066">Feed the ${faunaName}?</div>` +
      `<div style="display:flex;align-items:center;justify-content:center;gap:12px;margin:6px 0 14px">` +
        side(foodId, foodName) +
        `<span style="font-size:18px;opacity:.7">→</span>` +
        side(faunaKind, faunaName) +
      `</div>`;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:center';
    const cancel = mkBtn('Cancel', false);
    const feed   = mkBtn('Feed', true);
    cancel.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); });
    feed.addEventListener('click',   (e) => { e.stopPropagation(); wrap.remove(); onConfirm?.(); });
    row.appendChild(cancel);
    row.appendChild(feed);
    box.appendChild(row);
    mount();
  }

  // Stats / Relics menu — shows energy and every equipped relic / armor slot.
  showStatsModal() {
    const { wrap, box, mount, mkBtn } = this.makeModalShell('stats-modal',
      { zIndex: 55, minWidth: 260, maxWidth: 340, textAlign: null, onClose: () => {}, kind: 'stats' });
    const cur = this.save.energy ?? 0, max = this.getMaxEnergy();
    // Compact effect blurb per slot — for empty slots, the def.blurb tells
    // the player what the relic WOULD do (useful preview). For equipped, we
    // also try to surface a tier-scaled numeric where the catalog exposes
    // one cheaply (energy bonus for armor, stack cap for bags, etc.).
    const effectFor = (kind, slot, tierOrZero) => {
      const def = gearDef(kind, slot);
      if (!def) return '';
      if (kind === 'armor') {
        const per = ARMOR_DEFS?.[slot]?.energyPerTier ?? 0;
        if (tierOrZero > 0) return `+${per * tierOrZero} max energy`;
        return `+${per}/tier max energy`;
      }
      // Relics: per-slot blurb. Add a quantitative tier-scaled hint where
      // the formula is cheap to evaluate without re-deriving game balance.
      const base = def.blurb || '';
      if (slot === 'bags' && tierOrZero > 0 && typeof stackCapForBags === 'function') {
        return `${base} (cap ${Inventory.stackCap(this.save)})`;
      }
      if (slot === 'rod' && tierOrZero > 0) {
        const skunk = Math.max(0.20, 0.55 - tierOrZero * 0.05);
        return `${base} (${Math.round((1 - skunk) * 100)}% bite)`;
      }
      if ((slot === 'bow' || slot === 'staff') && tierOrZero > 0) {
        const f = 1 - tierOrZero / 7;
        const hi = Math.round((1 + 2 * f) * 100);
        return `${base} (≤${hi}% mark-up)`;
      }
      return base;
    };
    const slotRow = (kind, slot) => {
      const eq = (kind === 'relic' ? this.save.relics : this.save.armor)?.[slot];
      const def = gearDef(kind, slot);
      const label = def?.name || slot;
      const effect = effectFor(kind, slot, eq?.tier || 0);
      if (!eq) {
        return `<div style="padding:3px 0;opacity:.55">` +
          `<div style="display:flex;justify-content:space-between"><span>${label}</span><span style="font-size:11px">— empty —</span></div>` +
          (effect ? `<div style="font-size:10px;opacity:.75;line-height:1.2">${effect}</div>` : '') +
          `</div>`;
      }
      const t = TIER_BY_NUM[eq.tier];
      const iconHtml = this.gearIconHTML(kind, slot, eq.tier, 20);
      return `<div style="padding:3px 0">` +
        `<div style="display:flex;justify-content:space-between"><span>${label}</span><span>${iconHtml} ${t?.name || ''} (T${eq.tier})</span></div>` +
        (effect ? `<div style="font-size:10px;color:#a7ffb0;line-height:1.2">${effect}</div>` : '') +
        `</div>`;
    };
    box.innerHTML =
      // (no title line — the kind header already says STATS)
      `<div style="text-align:center;margin-bottom:4px">⚡ Energy: <b>${cur}</b> / ${max}</div>` +
      `<div style="text-align:center;margin-bottom:10px;color:#ffd23a">🔆 Discovery: <b>${Inventory.count(this.save, 'discovery')}</b></div>` +
      `<div style="opacity:.7;font-size:11px;margin:6px 0 2px">RELICS</div>` +
      Object.keys(RELIC_DEFS).map(s => slotRow('relic', s)).join('') +
      `<div style="opacity:.7;font-size:11px;margin:10px 0 2px">ARMOR</div>` +
      Object.keys(ARMOR_DEFS).map(s => slotRow('armor', s)).join('');
    const btn = mkBtn('Close');
    btn.style.marginTop = '12px';
    btn.style.width = '100%';
    btn.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); });
    box.appendChild(btn);
    mount();
  }

  // Building-flavored title for an offer modal. Different building kinds
  // (castle / fort / market / trader / blacksmith / plain house) get their
  // own greeting so the player can tell at a glance what they walked into,
  // instead of every dialog reading "A trader offers:". `action` is one of:
  //   'buy'      → routine seed/produce/barter buy
  //   'relic'    → a relic offer (non-starter)
  //   'forge'    → blacksmith forge offer
  // One-time scarecrow sale at the forced scarecrow shop. Cash only; on
  // accept it deducts the price, grants one scarecrow, and flips
  // save.scarecrowShopUsed so the house reverts to its normal role. Mirrors
  // the cash branch of the regular buy modal (loud loot pop, real sprite).
  presentScarecrowOffer(sx, sy, house, recordDeal) {
    const id = 'scarecrow';
    const item = ITEM_BY_ID[id];
    const price = PRICES[id] ?? 30;
    const canAfford = () => (this.save.money ?? 0) >= price;
    this.showOfferModal({
      kind: 'farm',
      title: 'The farmhand offers a scarecrow:',
      cancelLabel: 'Later',
      get: `${this.iconSpanHTML(id)} ${item?.name || id} ×1`,
      blurb: 'Crows and deer steer clear of a planted field.',
      cost: `$${price}`,
      canAfford: canAfford(),
      onAccept: () => {
        if (!canAfford()) { this.flash(`need $${price}`, sx, sy); return; }
        addMoney(this.save, -price);
        this.addToInv(id, 1);
        this.save.scarecrowShopUsed = true;
        recordDeal();
        persistSave(this.save);
        this.buildInventoryDOM();
        this.flashLoot(`🪙 ${item?.name || id}\n−$${price}`, '#ffe066', 1, id);
      },
    });
  }

  // Produce stand = a roadside MARKET (not a one-shot chest). It sells the
  // produce its awning advertises (loot.js produceStandFor → { item, frame })
  // BELOW par — a fresh stall undercuts the listed price rather than applying
  // the 1.2–3.0× buyPrice ramp, which is for restocking village shops. How far
  // below is ShopsMath.standPrice's business: the discount is capped by what
  // the player could resell for, so a stand can never be an arbitrage pump.
  // Repeatable: a quantity stepper lets the player buy as many as they can
  // afford and carry, and the stall is never marked save.opened.
  presentMarketStandOffer(sx, sy, o, stand) {
    // Single-modal guard — mirror shopInteract so rapid taps can't stack modals.
    if (document.getElementById('offer-modal')) return;
    const id = stand.item;
    const item = ITEM_BY_ID[id];
    const unitPrice = ShopsMath.standPrice(this.save, PRICES[id] ?? 1);
    const listPrice = Math.max(1, PRICES[id] ?? 1);
    const iconHTML = this.iconSpanHTML(id);
    const itemName = item?.name || id;
    // Cap the stepper at what the player can both afford AND fit in their bag.
    const money = () => this.save.money ?? 0;
    const room  = () => { const r = this.invRoomFor(id); return r === Infinity ? 99 : r; };
    const maxQty = Math.max(1, Math.min(room(), Math.max(1, Math.floor(money() / unitPrice))));
    // Show what the stall is knocking off, so the discount reads as a deal
    // rather than as an arbitrary number. Suppressed at par (a maxed-out sword
    // pushes the price back up to the listed value — see ShopsMath.standPrice).
    const saved = (listPrice - unitPrice);
    const fmt = (q) => {
      const total = unitPrice * q;
      return {
        get: `${iconHTML} ${itemName} ×${q}`,
        cost: saved > 0 ? `$${total} <span style="opacity:.6">(save $${saved * q})</span>`
                        : `$${total}`,
        canAfford: money() >= total && q <= room(),
      };
    };
    const first = fmt(1);
    this.showOfferModal({
      kind: 'shop',
      title: 'The market stall sells fresh:',
      get: first.get,
      cost: first.cost,
      canAfford: first.canAfford,
      acceptLabel: 'Buy',
      cancelLabel: 'Later',
      quantity: { min: 1, max: maxQty, initial: 1, format: fmt },
      onAccept: (q) => {
        const want = Math.max(1, q ?? 1);
        const take = Math.min(want, room());
        if (take <= 0) { this.flash('Bag full', sx, sy); return; }
        const pay = unitPrice * take;
        if (money() < pay) { this.flash(`need $${pay}`, sx, sy); return; }
        addMoney(this.save, -pay);
        this.addToInv(id, take);
        persistSave(this.save);
        this.buildInventoryDOM();
        this.flashLoot(`🪙 ${take}× ${itemName}\n−$${pay}`, '#ffe066', 1, id);
      },
    });
  }

  buildingFlavorTitle(house, action) {
    const isCastle = !!house && (house.kind === 'tower' || house.tier === 12);
    const isFort   = !!house && house.tier === 11;
    const st = (!isCastle && !isFort && house) ? this.houseShopRole(house) : null;
    if (action === 'forge')   return 'The blacksmith will forge:';
    if (action === 'relic') {
      if (isCastle) return "The castle's vault holds:";
      if (isFort)   return 'The fort quartermaster offers a relic:';
      if (st === 'wizard') return 'The wizard conjures a relic:';
      return 'A villager offers a relic:';
    }
    // 'buy'
    if (isCastle) return "From the castle's vault:";
    if (isFort)   return 'The fort quartermaster offers:';
    if (st === 'market')     return 'The market has fresh stock:';
    if (st === 'trader')     return 'The trader proposes a barter:';
    if (st === 'blacksmith') return 'The blacksmith has on hand:';
    if (st === 'wizard')     return 'The wizard conjures a relic:';
    return 'A villager offers:';
  }
  shopInteract(sx, sy, house) {
    // Single-modal guard: if a confirmation modal is already open, ignore the tap so
    // rapid double-taps can't stack two modals or stale closures.
    if (document.getElementById('offer-modal')) return;
    // Wreck → restoration modal. Every tier-9 small house starts as a
    // wreck (see save.restoredHouses); the trailer is exempt and forts /
    // castles never wreck. Plain houses cost 5 wood (tree); themed
    // tier-9 shops (blacksmith / market / trader) cost 5 rockfruit.
    if (house && this._isHouseWreck && this._isHouseWreck(house)) {
      this.presentWreckRestoreModal(sx, sy, house);
      return;
    }
    // Fort → sealed until unsealed with a one-time wood payment, just like a
    // wreck house pays masonry. Pay FORT_UNLOCK_WOOD and the quartermaster
    // opens for good (recorded in save.unlockedForts).
    if (house && this._isFortLocked && this._isFortLocked(house)) {
      this.presentFortUnlockModal(sx, sy, house);
      return;
    }
    // Castle → sealed until the player has logged enough lifetime deliveries
    // (5 for the vault). A locked-until-earned gate with no payment: the entry
    // fee is delivery footwork rather than a stack of goods.
    if (house && this._isBuildingSealed && this._isBuildingSealed(house)) {
      this.presentSealedBuildingModal(sx, sy, house);
      return;
    }
    // House routing:
    //   HOME (starter trailer)  → only SELL. Tap with nothing selected
    //                              just flashes "home sweet home"; tap
    //                              with a selected stack opens the sell
    //                              modal (no specialty bonus — home isn't
    //                              a specialty shop).
    //   Every other house       → only its PRIMARY interaction (buy /
    //                              trade / smith / relic). Selling
    //                              anywhere but home is intentionally
    //                              gated so the player has a reason to
    //                              come home with their haul.
    const isHome = !!house && this.isStarterShop(house);
    const sel = this.save.inv[this.save.selSlot];
    const hasSel = sel && sel.id && (sel.count ?? 0) > 0;
    if (isHome) {
      if (!hasSel) { this.flash('home sweet home', sx, sy); return; }
      // noSell items (the Discovery badge) never enter the sell modal — the
      // wizard tower is the only place they're worth anything.
      if (ITEM_BY_ID[sel.id]?.noSell) { this.flash('Only the wizard values that.', sx, sy); return; }
      // SELL one of the selected stack — confirm first so an accidental
      // home tap can't silently dump a high-value item. Sword relic scales
      // the price from half (no sword) up to full base value at tier 7.
      // No shop specialty bonus at home — it's a private sale, not a
      // shopkeep's bid.
      const sellMul = (typeof sellMultiplier === 'function') ? sellMultiplier(this.save.relics) : 0.5;
      const unitPrice = Math.max(1, Math.ceil((PRICES[sel.id] ?? 1) * sellMul));
      const item = ITEM_BY_ID[sel.id];
      const sellId = sel.id;
      const maxQty = Math.max(1, sel.count | 0);
      const iconHTML = this.iconSpanHTML(sellId);
      const itemName = item?.name || sellId;
      const fmt = (q) => ({
        get: `+$${unitPrice * q}`,
        cost: `${q}× ${iconHTML} ${itemName}`,
        canAfford: true,
      });
      const first = fmt(1);
      this.showOfferModal({
        kind: 'shop',
        title: 'Sell from your stash?',
        get: first.get,
        cost: first.cost,
        canAfford: true,
        acceptLabel: 'Sell',
        quantity: { min: 1, max: maxQty, initial: 1, format: fmt },
        onAccept: (q) => {
          const idx = this.save.inv.findIndex(s => s && s.id === sellId && (s.count ?? 0) > 0);
          if (idx < 0) { this.flash('Gone — already used.', sx, sy); return; }
          const cur = this.save.inv[idx];
          const sold = Math.max(1, Math.min(q ?? 1, cur.count ?? 0));
          if (sold <= 0) { this.flash('Gone — already used.', sx, sy); return; }
          cur.count -= sold;
          const gain = unitPrice * sold;
          addMoney(this.save, gain);
          if (cur.count <= 0) {
            this.save.inv.splice(idx, 1);
            if (this.save.selSlot >= this.save.inv.length) {
              this.save.selSlot = Math.max(0, this.save.inv.length - 1);
            }
          }
          persistSave(this.save);
          this.buildInventoryDOM();
          this.flashLoot(`🪙 +$${gain}`, '#ffe066', 1, sellId);
          this.questEvent('sell');
        },
      });
      return;
    }
    // Per-building deal rate-limit — see shopDealCap() / shopReadiness() for
    // the ladder + bucket math. Renderer reuses the same helpers to draw the
    // ready/timer pip above each house, so the player sees the same state
    // the tap handler will enforce.
    const isCastle = !!house && (house.kind === 'tower' || house.tier === 12);
    const isStarterSmith = this.isStarterBlacksmith(house);
    const { dealCap, ready: shopReady, waitMin } = this.shopReadiness(house);
    if (house && !shopReady) {
      const kindLabel = isCastle ? 'castle' : (house.tier === 11) ? 'fort' : 'house';
      this.flash(`${kindLabel} busy — try again in ${waitMin}m`, sx, sy);
      return;
    }
    // Record a deal against this house — called from inside the accept path.
    const recordDeal = () => {
      if (!house || !house.id || dealCap === Infinity) return;
      const cur = this.shopBucketState(house);
      cur.deals += 1;
    };
    // Effective shop role from the frozen restore-order assignment (falls back
    // to the address-derived type for legacy saves). Returns 'blacksmith' for
    // the first-restored starter smithy too, so the forge branch fires
    // regardless of the underlying house number.
    const shopType = this.houseShopRole(house);
    const isFort = !!house && house.tier === 11;
    // FLOWER GIFT — tapping a CASH shop (market / fort storefront / castle
    // vault) with Flowers selected offers to charm the keeper: one bouquet
    // buys half prices at THIS building for SHOP_CHARM_MS. Only cash shops —
    // a bouquet at a barter trader / wizard / delivery house would buy
    // nothing, so those never offer to take one. Checked after the busy gate
    // so a bouquet can't be spent on a shut door, and skipped while a charm
    // is already running so repeat taps don't burn the stack.
    if (house && house.id != null && sel && sel.id === 'flowers' && (sel.count ?? 0) > 0
        && (isCastle || isFort || shopType === 'market')
        && this.shopCharmMul(house) === 1) {
      this.showOfferModal({
        kind: 'shop',
        title: 'Charm the shopkeeper?',
        get: `💐 half prices here, ${Math.round(SHOP_CHARM_MS / MINUTE_MS)} min`,
        cost: `1× ${this.iconSpanHTML('flowers')} Flowers`,
        canAfford: true,
        acceptLabel: 'Gift',
        onAccept: () => {
          const idx = this.save.inv.findIndex(s => s && s.id === 'flowers' && (s.count ?? 0) > 0);
          if (idx < 0) { this.flash('Gone — already used.', sx, sy); return; }
          const cur = this.save.inv[idx];
          cur.count -= 1;
          if (cur.count <= 0) {
            this.save.inv.splice(idx, 1);
            if (this.save.selSlot >= this.save.inv.length) {
              this.save.selSlot = Math.max(0, this.save.inv.length - 1);
            }
          }
          this.save.shopCharm = this.save.shopCharm || {};
          // Prune spent charms while we're here so the map can't grow without
          // bound across many gifts.
          for (const k of Object.keys(this.save.shopCharm)) {
            if (this.save.shopCharm[k] <= Date.now()) delete this.save.shopCharm[k];
          }
          this.save.shopCharm[house.id] = Date.now() + SHOP_CHARM_MS;
          persistSave(this.save);
          this.buildInventoryDOM();
          this.flashLoot('💐 charmed — half prices!', '#ff8aff', 1.2, 'flowers');
          // Straight back into the shop so the discounted offer is in hand.
          this.shopInteract(sx, sy, house);
        },
      });
      return;
    }
    // Forced scarecrow shop (the house just past the starter blacksmith).
    // Sells a single scarecrow for cash, ONCE, then this branch goes quiet
    // and the house reverts to its normal role (delivery / shop). Checked
    // before every other small-house branch so it wins regardless of the
    // underlying address-derived role.
    if (!isCastle && !isFort && house && this.isScarecrowShop(house) && !this.save.scarecrowShopUsed) {
      this.presentScarecrowOffer(sx, sy, house, recordDeal);
      return;
    }
    // Plain houses — small residential without a shop role and not the
    // starter blacksmith — are delivery sites only. Each wants a SET of 2-3
    // produce and buys it as a bundle: one of each, full price, no sword
    // sellMul. They don't sell anything or do the old 10% relic swap. Their
    // sign shows the wanted icons so the player can scout a street and gather
    // the matching set.
    if (!isCastle && !isFort && !shopType && !isStarterSmith && house) {
      this.presentDeliveryOffer(sx, sy, house, recordDeal);
      return;
    }
    // Selling is HOME-ONLY (handled above). Every other house runs straight
    // into its primary interaction below — selected-item taps no longer
    // open a sell modal here. The player has to bring the haul back to
    // their trailer to cash out.
    // BUY — generate an offer and present a confirmation modal.
    // Special tracks come BEFORE the regular seed/produce rotation:
    //   (a) Castle / tower — always sells relics, no rate-limit, with re-roll.
    //   (b) Blacksmith     — address-ending-in-9 houses trade 5 gems for a relic.
    //   (c) Regular house  — 10% chance to swap the normal offer for a relic.
    // (Home / starter trailer is handled at the top of this function — it
    // only sells, never buys.)
    if (isCastle) {
      // The hearth first: a castle you claimed gives energy back on arrival,
      // before any trading, so the player has the bar to act on what's inside.
      this._castleHearth(sx, sy, house);
      // First time the player reaches this (now-unsealed) vault, record it so
      // the NEXT un-opened castle ramps to a higher delivery gate (see
      // _deliveryGate / CASTLE_DELIVERY_GATE_START). The seal check above
      // already returned for sealed castles, so reaching here means it's open.
      if (house.id && !this.save.openedCastles?.[house.id]) {
        this.save.openedCastles = this.save.openedCastles || {};
        this.save.openedCastles[house.id] = true;
        persistSave(this.save);
      }
      const offer = this.peekOrBuildRelicOffer(house);
      // No re-roll at castles per balance pass — the castle's draw is the
      // exorbitant base price (4× minus bow/staff discount), not a re-roll
      // lottery, so the player must accept what's offered or leave.
      if (offer) { this.presentRelicOffer(sx, sy, offer, recordDeal, house, false); return; }
      // Every relic + armor slot is at max tier. Castles only deal in relics,
      // so there's nothing left to sell — say so explicitly rather than
      // silently swapping the player onto potato seeds.
      this.flash("The castellan shrugs — you've outgrown the vault.", sx, sy);
      return;
    }
    if (shopType === 'blacksmith') {
      // Starter blacksmith: forge the two random wooden tools (see
      // starterSmithSlots) one at a time before falling through to the
      // random-relic forge. Custom recipe (not bar-based) so blacksmithRecipe
      // stays T2+ for every other smithy.
      if (isStarterSmith) {
        const woodOffer = this.starterBlacksmithOffer();
        if (woodOffer) {
          const recipe = this.starterBlacksmithRecipe(woodOffer.slot);
          this.presentBlacksmithOffer(sx, sy, woodOffer, recordDeal, house, { recipe, noReroll: true });
          return;
        }
      }
      const offer = this.peekOrBuildRelicOffer(house);
      if (offer) { this.presentBlacksmithOffer(sx, sy, offer, recordDeal, house); return; }
      this.flash('"Anvil\'s resting, friend. Try again later."', sx, sy);
      return;
    }
    // Traders are barter-only with their own seeded offer (qty scales to a
    // target value) and a re-roll secondary — fully self-contained branch.
    if (shopType === 'trader') {
      this.presentTraderOffer(sx, sy, house, recordDeal);
      return;
    }
    // Wizard tower (the 15th restored wreck) — no longer a relic vendor. The
    // mage now trades the player's hard-won Discovery badges for an "Inner
    // Light": one +0.5-cell reach (range) upgrade per 5 badges. See
    // presentInnerLightOffer.
    if (shopType === 'wizard') {
      this.presentInnerLightOffer(sx, sy, recordDeal);
      return;
    }
    // Markets skip the 10% relic-swap; the market shop kind is dedicated.
    // SEEDED, not Math.random: this coin decides WHAT the shop is selling, so
    // an unseeded flip let the player reopen a fort until it came up relic.
    // Its own lane, so it can't consume a roll the offer itself needs.
    // (house is always a real object from the tap dispatch, but everything
    // around here is written null-tolerant, so keep the unseeded fallback.)
    const swapRoll = house?.id ? this.shopRng(house, 'relicswap')() : Math.random();
    if (!shopType && swapRoll < 0.10) {
      const relicOffer = this.peekOrBuildRelicOffer(house);
      if (relicOffer) { this.presentRelicOffer(sx, sy, relicOffer, recordDeal, house, false); return; }
    }
    // Each house has a deterministic "shop kind" derived from its world
    // position: ~30% of houses sell PRODUCE (harvested crops), the rest sell
    // SEEDS from the rotating buyIndex. Same house always offers the same
    // category, so the player learns "this house sells crops". Markets force
    // produce regardless of the position-derived flag.
    const houseSeed = house
      ? ((Math.round(house.x * 100) ^ Math.round(house.y * 100)) >>> 0)
      : 0;
    // The tutorial's first market is the guaranteed beginner SEED shop: it
    // rotates through T1/T2 (low-tier) seeds only, never produce or higher-tier
    // crops the player can't use yet.
    const isFirstMarket = this.isFirstMarket(house);
    const sellsProduce = !isFirstMarket && ((shopType === 'market')
      || (houseSeed && ((houseSeed * 2654435761) >>> 0) % 10 < 3));
    let id;
    if (isFirstMarket) {
      const lowSeeds = BUY_LIST.filter(isLowTierSeed);
      id = lowSeeds[(this.save.buyIndex ?? 0) % lowSeeds.length] || BUY_LIST[0];
    } else if (sellsProduce) {
      // Cycle through produce, weighted toward the buyIndex so it still rotates.
      const produceIds = Object.keys(CROP_ROW);
      id = produceIds[((this.save.buyIndex ?? 0) + (houseSeed >>> 8)) % produceIds.length];
    } else {
      id = BUY_LIST[(this.save.buyIndex ?? 0) % BUY_LIST.length];
    }
    const baseValue = PRICES[id] ?? 1;
    const item = ITEM_BY_ID[id];
    // Every cash storefront (markets + generic houses) buys for money now;
    // barter lives only in the dedicated 'trader' shop kind (presentTraderOffer
    // above). buildShopOffer always returns a cash offer.
    const offer = this.buildShopOffer(id, baseValue, { house });
    if (!offer) {
      this.flash('no deal', sx, sy);
      return;
    }
    // Cash purchases hand over exactly ONE unit — the ×2 TRADE_OFFER_QTY
    // bundle is barter-only (see presentTraderOffer) so cash buys can't be
    // flipped at a profit. Low-tier seeds still ship a few extra (planted in
    // bulk; a starter nicety, not an arbitrage vector at $3 a pack).
    const buyQty = 1 + (isLowTierSeed(id) ? LOW_TIER_SEED_QTY_BONUS : 0);
    this.showOfferModal({
      kind: 'shop',
      title: this.buildingFlavorTitle(house, 'buy'),
      cancelLabel: 'Later',
      get: `${this.iconSpanHTML(id)} ${item?.name || id} ×${buyQty}`,
      cost: offer.label,
      canAfford: offer.canAfford(),
      onAccept: () => {
        if (!offer.canAfford()) { this.flash(offer.shortDenial, sx, sy); return; }
        offer.consume();
        this.addToInv(id, buyQty);
        this.save.buyIndex = (this.save.buyIndex ?? 0) + 1;
        recordDeal();
        persistSave(this.save);
        this.buildInventoryDOM();
        // Use the loud loot pop so a purchase reads as a real gain.
        // Sprite shows the bought item — drop the item-icon emoji.
        this.flashLoot(`🪙 ${buyQty}× ${item?.name || id}\n${offer.shortGain}`, '#ffe066', 1, id);
      },
    });
  }

  // The "starter shop" is the building closest to the player's spawn — the
  // player's Home. Tap it to sell from your stash; the starter blacksmith
  // (nearest house to Home) handles wooden-tool crafting. Pick it once and
  // memoize in save.starterShopId so reloads + roaming keep the same shop.
  isStarterShop(house) {
    if (!house || !house.id) return false;
    this.ensureStarterShopId();
    return this.save.starterShopId === house.id;
  }

  // Resolve (and self-heal) save.starterShopId: the player's Home. Home is the
  // house nearest the player's ACTUAL location — their first GPS fix — NOT the
  // fixed map origin (startWorldM, anchored at START_LAT/LON). Anchoring on the
  // origin was the old bug: a player who starts far from START_LAT got a
  // trailer dropped near the origin, off-screen, so it never appeared.
  //
  // Once a GPS fix is in, the rule is "what you can see is home":
  //   • if any house is visible ON-SCREEN, adopt the nearest one as the trailer;
  //   • if NO house is on-screen, synthesize a trailer under the player.
  // "On-screen" = within the VIEW_CELLS-square map viewport centred on the
  // player (HALF_VIEW_M each way). This replaces an earlier fixed-metres radius:
  // tying it to the viewport means the player always either sees the house that
  // became their trailer, or gets one dropped on themselves — never a Home left
  // sitting off-screen that they can't find. Tiles stream in asynchronously, so
  // before concluding "nothing on-screen" we wait for every tile the viewport
  // overlaps to be ready (the viewport is far smaller than a tile, so that's the
  // player's own tile, plus its neighbours when they sit near a tile edge — all
  // kept loaded by the 3×3 ensureTilesAround). A previously chosen home that is
  // still loaded is kept so the trailer is stable across roaming and reloads
  // (even once it scrolls off-screen), while a stale origin-anchored memo (whose
  // tile never loads near the new spawn) self-heals. Cheap after it locks in via
  // the _starterShopOk early-out; called lazily (isStarterShop) and every frame
  // from Render.drawObjects.
  ensureStarterShopId() {
    if (this._starterShopOk) return;
    // A fresh save is still waiting to anchor its home origin to the first GPS
    // fix (startGps reloads once it arrives) — don't place the trailer yet, it
    // would be positioned against the provisional origin we're about to drop.
    if (this._homeCapturePending) return;
    // A synthetic trailer from a prior session — restore it and lock in.
    if (this.save.starterTrailer && this.save.starterShopId === this.save.starterTrailer.id) {
      this.ensureStarterTrailerObject();
      this._starterShopOk = true;
      // Heal a save whose home capture failed (no save.home): anchor the
      // starter crate trail on Home, where the player actually is — the
      // origin-keyed anchor would sit on a tile that never loads.
      this._setStarterCratesAt(this.save.starterTrailer.x, this.save.starterTrailer.y);
      return;
    }
    // Anchor on the player's real position: their GPS fix (gpsM, in playerM's
    // frame). A sandbox session may have no fix at all — fall back to the
    // player's current position so Home still resolves.
    const anchor = this.gpsM || (this._sandboxMode ? this.playerM : null);
    if (!anchor) return;                       // no fix yet — wait for one
    const ax = this.startWorldM.x + anchor.x;
    const ay = this.startWorldM.y + anchor.y;
    // "On-screen" = within the visible map viewport (a VIEW_CELLS square centred
    // on the player). Half-extent each way, in world metres.
    const HALF_VIEW_M = (VIEW_CELLS / 2) * this.cellM;
    const cur = this.save.starterShopId;
    let nearestId = null, nearestD2 = Infinity, curFound = false;
    for (const e of WorldGen.tileCache.values()) {
      for (const o of (e.objects || [])) {
        if (o.kind !== 'house' || !o.id) continue;
        if (o.id === cur) curFound = true;       // track the current Home anywhere (roaming)
        const dx = o.x - ax, dy = o.y - ay;
        // Only houses inside the viewport count toward "the nearest visible one".
        if (Math.abs(dx) > HALF_VIEW_M || Math.abs(dy) > HALF_VIEW_M) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 < nearestD2) { nearestD2 = d2; nearestId = o.id; }
      }
    }
    // An existing home that is still loaded → keep it (stable across roaming,
    // even once it scrolls off-screen). A stale far memo simply isn't loaded near
    // the new spawn, so curFound is false and we re-resolve below.
    // _setStarterCratesAt on each lock-in below is the no-home heal: it
    // no-ops for anchored saves, and freezes the crate trail at the player's
    // real position for a save whose home capture failed (see
    // _starterTrailAnchor).
    if (cur != null && curFound) {
      this._starterShopOk = true;
      this._setStarterCratesAt(ax, ay);
      return;
    }
    // A house is visible on-screen → adopt the nearest one as the trailer.
    if (nearestId != null) {
      this.save.starterShopId = nearestId;
      this.save.starterTrailer = null;         // drop any prior synthetic trailer
      this._starterShopOk = true;
      this._setStarterCratesAt(ax, ay);
      return;
    }
    // No house on-screen. Don't synthesize until every tile the viewport overlaps
    // is ready — otherwise we might be staring at a half-streamed map and would
    // drop a trailer on top of a house that simply hadn't arrived. The viewport
    // is tiny next to a tile, so this is the player's own tile, plus its
    // neighbours when they sit near a tile edge (all kept loaded by
    // ensureTilesAround). Check the four viewport corners.
    const tileReadyAt = (offMx, offMy) => {
      const tx = Math.floor((this.originPx.x + (anchor.x + offMx) / this.mPerPx) / WorldGen.TILE_PX);
      const ty = Math.floor((this.originPx.y + (anchor.y + offMy) / this.mPerPx) / WorldGen.TILE_PX);
      const t = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
      return t && (!t.status || t.status === 'ready');
    };
    for (const ox of [-HALF_VIEW_M, HALF_VIEW_M])
      for (const oy of [-HALF_VIEW_M, HALF_VIEW_M])
        if (!tileReadyAt(ox, oy)) return;        // a viewport tile is still streaming — wait
    // Drop a trailer under the player.
    this._makeStarterTrailer(ax, ay);
    this.save.starterShopId = this.save.starterTrailer.id;
    this._starterShopOk = true;
    this._setStarterCratesAt(ax, ay);
  }

  // Is the player resting AT their Home? Drives the faster HOME_FULL_REST_S
  // energy-rest rate. Home is either an adopted real house (which paints
  // BUILDING cells into the grid) or a synthetic trailer dropped on open ground
  // (which paints NO cell — see ensureStarterTrailerObject), so there are two
  // cases:
  //   • real house  → the player must be standing on a building cell (indoors)
  //     AND the nearest loaded house to them must be Home, so a neighbour's
  //     house next door doesn't read as Home.
  //   • trailer     → the player must be standing on the trailer's own snapped
  //     cell (there's no building cell to stand on, so `indoors` is false).
  // The house scan only runs on indoor frames (rare — you have to be standing
  // on a building), and ensureStarterShopId early-outs once Home is locked in.
  isRestingAtHome(pWX, pWY, indoors) {
    this.ensureStarterShopId();
    const homeId = this.save.starterShopId;
    if (!homeId) return false;
    const st = this.save.starterTrailer;
    if (st && st.id === homeId) {
      const half = this.cellM / 2;     // within the trailer's snapped cell
      return Math.abs(pWX - st.x) <= half && Math.abs(pWY - st.y) <= half;
    }
    if (!indoors) return false;        // real house only counts from inside it
    let nearId = null, nearD2 = Infinity;
    for (const e of WorldGen.tileCache.values()) {
      for (const o of (e.objects || [])) {
        if (o.kind !== 'house' || !o.id) continue;
        const dx = o.x - pWX, dy = o.y - pWY;
        const d2 = dx * dx + dy * dy;
        if (d2 < nearD2) { nearD2 = d2; nearId = o.id; }
      }
    }
    return nearId === homeId;
  }

  // Build a synthetic "trailer" house at (wmx, wmy), snapped to the cell-grid
  // centre like every real placed object. Worldgen never emits this object, so
  // its position is persisted to save.starterTrailer and re-injected into the
  // owning tile on every load by ensureStarterTrailerObject().
  _makeStarterTrailer(wmx, wmy) {
    const cellPx = WorldGen.TILE_PX / this.cellsPerTile;
    const snap = (wm) => (Math.floor((wm / this.mPerPx) / cellPx) + 0.5) * cellPx * this.mPerPx;
    const x = snap(wmx), y = snap(wmy);
    const id = 'starter_trailer';
    const address = ((Math.round(x) ^ Math.round(y)) >>> 0) % 1000;
    // tier = T.BUILDING (a plain small house); the starter role overrides the
    // wreck/shop skin in the renderer, so it draws as the trailer regardless.
    this.save.starterTrailer = { id, x, y, tier: WorldGen.T.BUILDING, address };
    this._starterTrailerObj = null;            // force a rebuild on next inject
    this.ensureStarterTrailerObject();
  }

  // Keep the synthetic trailer present in its owning tile's object list. Runs
  // every frame (cheap) so the trailer survives reloads and tile eviction —
  // worldgen output never contains it, so without this it would vanish.
  ensureStarterTrailerObject() {
    const st = this.save.starterTrailer;
    if (!st) return;
    // Surface-only. Underground, WorldGen.tileCache is repointed at the active
    // depth's cave map (setDepth), so injecting here would drop a phantom
    // trailer into a cave tile. The trailer lives on the surface — depth 0.
    if ((this.depth || 0) !== 0) return;
    // Only inject while the trailer is actually the active Home. If the player
    // has since adopted a real house (starterShopId points elsewhere), a stale
    // starterTrailer must not keep spawning a phantom trailer in the world.
    if (this.save.starterShopId !== st.id) return;
    // Rebuild the in-memory object after a reload (or position change).
    if (!this._starterTrailerObj || this._starterTrailerObj.id !== st.id) {
      this._starterTrailerObj = { kind: 'house', x: st.x, y: st.y,
        tier: st.tier, id: st.id, address: st.address, _synthetic: true };
    }
    const obj = this._starterTrailerObj;
    const tx = Math.floor((obj.x / this.mPerPx) / WorldGen.TILE_PX);
    const ty = Math.floor((obj.y / this.mPerPx) / WorldGen.TILE_PX);
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
    if (!entry || !entry.objects) return;      // owning tile not loaded yet
    let present = false;
    for (const o of entry.objects) { if (o.id === obj.id) { present = true; break; } }
    if (!present) entry.objects.push(obj);
    this.clearHomeTrailerOverlap();
  }

  // Nothing sits inside the Home trailer. Its art is the 108×75 trailer PNG at
  // scale 0.6 — 65×45 px centred on its cell — so it covers its own cell whole
  // and reaches ~32px sideways and ~22px up/down into all eight neighbours. A
  // crate, tree or rock in any of those cells is drawn half-buried in the
  // trailer, which reads as a glitch rather than scenery.
  //
  // Worldgen already keeps a one-cell moat clear of scatter objects around
  // every building cell, but the trailer is synthetic: it paints no building
  // terrain, so that pass never sees it. This is the same moat, applied
  // wherever the trailer actually stands (including after "Move Home here").
  //
  // Buildings are left alone — a real house that happens to be next door is
  // part of the neighbourhood, and deleting one would take its shop with it.
  // So is ground flora: wild plants draw small and low, and the starter-area
  // clearing deliberately keeps the player's real yard planting.
  //
  // Each tile is scanned once per (trailer position, object count) — cheap
  // enough for the per-frame caller, and re-runs whenever a tile gains objects
  // (a starter crate trail seating late, an Overpass decoration arriving).
  clearHomeTrailerOverlap() {
    const st = this.save.starterTrailer;
    if (!st || (this.depth || 0) !== 0) return;
    if (this.save.starterShopId !== st.id) return;   // trailer isn't Home any more
    const home = worldMetersToAbsCell(this, st.x, st.y);
    const stamp = `${st.id}@${home.cellIX},${home.cellIY}`;
    // Only the trailer's own tile and its 8 neighbours can hold a cell in the
    // moat, so the rest of the cache is skipped without touching its objects.
    const htx = Math.floor(st.x / this.tileEdgeM), hty = Math.floor(st.y / this.tileEdgeM);
    for (const [key, entry] of WorldGen.tileCache) {
      if (!entry || !entry.objects) continue;
      const parts = key.split('/');
      if (Math.abs(+parts[1] - htx) > 1 || Math.abs(+parts[2] - hty) > 1) continue;
      if (entry._trailerMoat === stamp && entry._trailerMoatN === entry.objects.length) continue;
      for (let i = entry.objects.length - 1; i >= 0; i--) {
        const o = entry.objects[i];
        if (o === this._starterTrailerObj || o.kind === 'house' || o.kind === 'tower') continue;
        const oc = worldMetersToAbsCell(this, o.x, o.y);
        if (Math.abs(oc.cellIX - home.cellIX) <= 1 && Math.abs(oc.cellIY - home.cellIY) <= 1) {
          entry.objects.splice(i, 1);
        }
      }
      entry._trailerMoat = stamp;
      entry._trailerMoatN = entry.objects.length;
    }
  }

  // ☰ menu → "Move Home here". Confirmation dialog for relocating the Home
  // trailer to the player's current position. The move costs HALF the player's
  // current coins, capped at $500 — always affordable by construction, so the
  // dialog never needs a can't-afford state; it just shows the price.
  confirmMoveHomeTrailer() {
    // The trailer lives on the surface (ensureStarterTrailerObject is
    // depth-0-only), so relocating from inside a cave would silently target
    // the surface spot above the player. Refuse with an explanation instead.
    if ((this.depth || 0) !== 0) {
      this.showMessageModal({ title: 'Move Home',
        body: 'Your trailer stays on the surface — climb back up before moving Home.' });
      return;
    }
    const cost = Math.min(500, Math.floor((this.save.money ?? 0) / 2));
    const { wrap, box, mount, mkBtn } =
      this.makeModalShell('move-home-modal', { zIndex: 60, onClose: () => {}, kind: 'build' });
    box.innerHTML =
      `<div style="opacity:.85;font-size:13px;margin-bottom:8px;color:#ffe066">Move Home here?</div>` +
      `<div style="margin:6px 0 12px">Your Home trailer relocates to where you're standing.` +
      `<br><br>Cost: <b style="color:#ffe066">$${cost}</b>` +
      `<span style="opacity:.7"> (half your coins, max $500)</span></div>`;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:center';
    const cancel = mkBtn('Cancel', false);
    const move   = mkBtn(`Move ($${cost})`, true);
    cancel.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); });
    move.addEventListener('click', (e) => {
      e.stopPropagation(); wrap.remove();
      addMoney(this.save, -cost);
      this.moveHomeTrailerHere();
      this.updateHUD();
      if (typeof persistSave === 'function') persistSave(this.save);
      this.flashLoot('🏠 Home moved!');
    });
    row.appendChild(cancel);
    row.appendChild(move);
    box.appendChild(row);
    mount();
  }

  // Relocate Home to the player's current position by (re)synthesizing the
  // starter trailer there. Works whether the current Home is a real adopted
  // house (it simply becomes a normal house again) or an existing synthetic
  // trailer (it moves). Surface-only — the confirm above guards depth.
  moveHomeTrailerHere() {
    // Evict any previously injected trailer object from the loaded tiles.
    // ensureStarterTrailerObject only dedupes within the NEW owning tile, so
    // without this sweep a moved trailer leaves a phantom copy in its old
    // tile's object list until that tile is evicted.
    for (const e of WorldGen.tileCache.values()) {
      if (!e.objects) continue;
      const i = e.objects.findIndex((o) => o._synthetic && o.id === 'starter_trailer');
      if (i >= 0) e.objects.splice(i, 1);
    }
    // playerM → absolute world metres (the space every object's x/y lives in).
    const ax = this.startWorldM.x + this.playerM.x;
    const ay = this.startWorldM.y + this.playerM.y;
    this._makeStarterTrailer(ax, ay);
    this.save.starterShopId = this.save.starterTrailer.id;
    this._starterShopOk = true;
  }

  // Wooden-tool blacksmith. The house closest to Home (the starter shop)
  // is forced to be a Blacksmith that forges T1 pick / axe / hoe out of
  // a flat 5 wood each (see starterBlacksmithRecipe).
  // Memoized once like starterShopId so reloads + roaming keep the same shop.
  // Falls through to the normal random-relic forge once all three wooden
  // tools have been crafted — the smithy keeps doing useful business.
  isStarterBlacksmith(house) {
    if (!house || !house.id) return false;
    // The starter blacksmith is now whichever wreck is restored FIRST (it gets
    // the 'blacksmith' role + this id stamped at restore time — see
    // presentWreckRestoreModal). No longer force-anchored to the nearest house,
    // so there's no lazy nearest-house resolution here.
    return this.save.starterBlacksmithId != null
      && this.save.starterBlacksmithId === house.id;
  }

  // The shop role a (restored) house plays: 'blacksmith' | 'trader' | 'market'
  // | 'wizard', or null for a plain residential house. Single source of truth
  // for both the renderer and the interaction handler. Once a wreck is restored
  // its role is frozen into save.restoredHouses[id] as a role string and read
  // straight back here. Legacy `true` entries (saved before role-freezing) and
  // any house consulted before restore fall back to the address-derived
  // Shops.shopType, plus the first-restored starter blacksmith.
  houseShopRole(house) {
    if (!house || house.kind !== 'house') return null;
    const stored = this.save.restoredHouses && this.save.restoredHouses[house.id];
    if (typeof stored === 'string') return stored === 'plain' ? null : stored;
    if (this.save.starterBlacksmithId && this.save.starterBlacksmithId === house.id) return 'blacksmith';
    return (typeof Shops !== 'undefined' && Shops.shopType(house)) || null;
  }

  // Resolve the role a wreck reveals when restored, given its 0-based restore
  // order. Fixed tutorial slots (PRESEED_RESTORE_ROLES) win; everything else
  // defers to the address-derived shop type so the neighbourhood keeps its
  // variety. Always returns a concrete role string ('plain' for a house).
  _preseedRestoreRole(order, house) {
    if (Object.prototype.hasOwnProperty.call(PRESEED_RESTORE_ROLES, order)) {
      return PRESEED_RESTORE_ROLES[order];
    }
    return (typeof Shops !== 'undefined' && Shops.shopType(house)) || 'plain';
  }

  // The tutorial's first restored market (PRESEED_RESTORE_ROLES order 3) is the
  // player's guaranteed early SEED shop: it vends only T1/T2 seeds for cash
  // instead of the produce a normal market sells, so a beginner always has a
  // reliable source of plantable starter crops. Memoize its id; self-heal for
  // saves that restored it before this stamp existed by scanning restoredHouses
  // in insertion order (object keys preserve insert order, so the first 'market'
  // entry is the earliest-restored market).
  ensureFirstMarketId() {
    if (this.save.firstMarketId) return this.save.firstMarketId;
    const rh = this.save.restoredHouses || {};
    for (const id of Object.keys(rh)) {
      if (rh[id] === 'market') { this.save.firstMarketId = id; persistSave(this.save); return id; }
    }
    return null;
  }

  isFirstMarket(house) {
    return !!house && !!house.id && this.ensureFirstMarketId() === house.id;
  }

  // 0-based position of this house among restored residential (delivery)
  // houses, in restore order; -1 if it isn't a (restored) delivery house.
  // restoredHouses keys preserve insertion order, so the Nth 'plain' entry is
  // the Nth-restored delivery house. Drives the scripted early wishlists
  // (houses 1-3 → TIER-1 produce, house 4 → the foraged-flower trio).
  deliveryHouseOrder(house) {
    return Delivery.houseOrder(this.save, house);
  }

  // True for the first 3 RESTORED delivery houses — they get pinned to TIER-1
  // produce wishlists (see wantedProduce).
  isEarlyDeliveryHouse(house) {
    return Delivery.isEarly(this.save, house);
  }

  // Every restored delivery house currently asking for a bundle (not satisfied
  // today), nearest first, with its wanted produce + distance in metres. Drives
  // the delivery menu (openDeliveryMenu). Home / forts / castles / wrecks are
  // excluded — only plain residential delivery houses appear.
  knownDeliveryHouses() {
    const pWX = this.startWorldM.x + this.playerM.x;
    const pWY = this.startWorldM.y + this.playerM.y;
    const out = [];
    const seen = new Set();
    for (const e of WorldGen.tileCache.values()) {
      for (const o of (e.objects || [])) {
        if (o.kind !== 'house' || !o.id || seen.has(o.id)) continue;
        if (o.tier === 11 || o.tier === 12) continue;             // forts / civic slabs
        if (this.houseShopRole(o) !== null) continue;             // only plain (no shop role)
        if (this._isHouseWreck && this._isHouseWreck(o)) continue; // still a wreck
        if (this.isStarterShop(o)) continue;                      // home sells, doesn't ask
        if (this.isHouseSatisfied(o)) continue;                   // happy until tomorrow
        const wanted = this.wantedProduce(o);
        if (!wanted.length) continue;
        seen.add(o.id);
        const dx = o.x - pWX, dy = o.y - pWY;
        out.push({ id: o.id, x: o.x, y: o.y, wanted, dist: Math.hypot(dx, dy) });
      }
    }
    out.sort((a, b) => a.dist - b.dist);
    return out;
  }

  // Point the white waypoint arrow at a delivery house (cleared automatically
  // once the player reaches it or it's satisfied — see the update loop).
  setDeliveryCompass(id, x, y) {
    this.deliveryCompass = { id, x, y };
  }

  // Delivery list overlay: tap a row to aim the white waypoint arrow at that
  // house. Opened from the ☰ menu's "Deliveries" button (wired in index.html).
  openDeliveryMenu() {
    const { wrap, box, mount, mkBtn } = this.makeModalShell('delivery-menu',
      { maxWidth: 320, textAlign: 'left', onClose: () => {}, kind: 'delivery' });
    // No title line — the kind header already says DELIVERY.
    const houses = this.knownDeliveryHouses();
    if (!houses.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'opacity:.7;text-align:center;padding:10px 4px;font:12px ui-monospace,monospace;';
      empty.textContent = 'No delivery requests nearby. Restore a house to start.';
      box.appendChild(empty);
    } else {
      for (const h of houses) {
        const row = document.createElement('button');
        row.style.cssText =
          'display:flex;align-items:center;gap:8px;width:100%;margin:3px 0;padding:8px;'
          + 'background:#222a;border:2px solid #555;border-radius:6px;color:#fff;'
          + 'cursor:pointer;font:12px ui-monospace,monospace;text-align:left;';
        // Icons alone told you nothing: three unlabelled sprites and a
        // distance, so you couldn't tell what a run needed, what it paid, or
        // which of five rows you could actually complete. Name every item,
        // show how many of each you're carrying against the one needed, and
        // price the set.
        const icons = h.wanted.map(id => this.iconSpanHTML(id)).join(' ');
        const names = h.wanted.map(id => ITEM_BY_ID[id]?.name || id).join(' + ');
        const have = h.wanted.map(id => Inventory.count(this.save, id));
        const ready = have.every(n => n >= 1);
        // Say what's MISSING rather than printing a have/need ratio per item —
        // "5/1 Coal 5/1 Wood" parses as arithmetic, not as an answer to "can I
        // do this run?".
        const missing = h.wanted
          .filter((id, i) => have[i] < 1)
          .map(id => ITEM_BY_ID[id]?.name || id);
        const stock = missing.length ? `need ${missing.join(', ')}` : '✓ you have everything';
        const setPrice = Math.max(1, Math.round(
          h.wanted.reduce((sum, id) => sum + Math.max(1, PRICES[id] ?? 1), 0) * DELIVERY_BONUS_MULT));
        row.innerHTML =
          `<span style="flex:1;min-width:0;">`
          + `<span style="display:flex;align-items:center;gap:4px;">${icons}`
          + `<b style="font-weight:700;">${names}</b></span>`
          + `<span style="display:block;font-size:11px;margin-top:2px;`
          + `color:${ready ? 'var(--green)' : '#ddd'};opacity:${ready ? '1' : '.75'};">`
          + `${stock}</span></span>`
          + `<span style="white-space:nowrap;text-align:right;">`
          + `<b style="color:var(--gold);">+$${setPrice}</b><br>`
          + `<span style="opacity:.7;font-size:11px;">${Math.round(h.dist)}m ›</span></span>`;
        // A row you can complete right now reads as ready.
        if (ready) row.style.borderColor = '#4a8c4a';
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          this.setDeliveryCompass(h.id, h.x, h.y);
          wrap.remove();
          this.flash('following the white arrow', this.viewCenterX, this.viewCenterY);
        });
        box.appendChild(row);
      }
    }
    // Every other modal ends in a button; this one was backdrop-tap only, on a
    // box that fills most of the width.
    const close = mkBtn('Close');
    close.style.marginTop = '10px';
    close.style.width = '100%';
    close.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); });
    box.appendChild(close);
    mount();
  }

  findStarterBlacksmithId() {
    // Resolve the starter shop first — needed both to anchor the search and
    // to exclude it from the candidate list. Goes through the guarded
    // resolver so a half-streamed map can't anchor the smithy across town.
    this.ensureStarterShopId();
    const starterId = this.save.starterShopId;
    // Anchor the distance search at the starter house's world position when
    // it's loaded; otherwise fall back to the player's spawn so the choice
    // converges to the same answer once tiles around home stream in.
    let fromPos = this.startWorldM;
    for (const e of WorldGen.tileCache.values()) {
      for (const o of (e.objects || [])) {
        if (o.kind === 'house' && o.id === starterId) {
          fromPos = { x: o.x, y: o.y }; break;
        }
      }
    }
    // Closest small house (BUILDING tier) to the starter, excluding the
    // starter itself. Skip forts and castles so a civic building next door
    // doesn't get re-skinned as a smithy.
    let bestId = null, bestD2 = Infinity;
    for (const e of WorldGen.tileCache.values()) {
      for (const o of (e.objects || [])) {
        if (o.kind !== 'house' || !o.id || o.id === starterId) continue;
        if (o.tier && WorldGen?.T?.BUILDING != null && o.tier !== WorldGen.T.BUILDING) continue;
        const dx = o.x - fromPos.x, dy = o.y - fromPos.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; bestId = o.id; }
      }
    }
    return bestId;
  }

  // Forced scarecrow shop. The next house out past the starter blacksmith
  // (so: Home is nearest, smithy is 2nd, this is 3rd) is pinned as a one-time
  // scarecrow vendor — the player begins with no scarecrow now, so this is
  // where they buy their first crow/deer ward. Memoized like the blacksmith.
  // Sells a single scarecrow for cash, then reverts to a normal house (see
  // save.scarecrowShopUsed).
  isScarecrowShop(house) {
    if (!house || !house.id) return false;
    if (this.save.scarecrowShopId == null) {
      const id = this.findScarecrowShopId();
      if (id) this.save.scarecrowShopId = id;
    }
    return this.save.scarecrowShopId === house.id;
  }

  findScarecrowShopId() {
    // Anchor at the blacksmith (resolving it first) and exclude both Home and
    // the smithy, so the nearest remaining small house becomes the scarecrow
    // shop — one house further out than the smithy. Same guarded-resolver +
    // BUILDING-tier filter as findStarterBlacksmithId.
    this.ensureStarterShopId();
    const starterId = this.save.starterShopId;
    const smithId = this.save.starterBlacksmithId != null
      ? this.save.starterBlacksmithId : this.findStarterBlacksmithId();
    // Anchor the search at the smithy when it's loaded, else fall back to spawn
    // so the choice converges once tiles around home stream in.
    let fromPos = this.startWorldM;
    for (const e of WorldGen.tileCache.values()) {
      for (const o of (e.objects || [])) {
        if (o.kind === 'house' && o.id === smithId) {
          fromPos = { x: o.x, y: o.y }; break;
        }
      }
    }
    let bestId = null, bestD2 = Infinity;
    for (const e of WorldGen.tileCache.values()) {
      for (const o of (e.objects || [])) {
        if (o.kind !== 'house' || !o.id) continue;
        if (o.id === starterId || o.id === smithId) continue;
        if (o.tier && WorldGen?.T?.BUILDING != null && o.tier !== WorldGen.T.BUILDING) continue;
        const dx = o.x - fromPos.x, dy = o.y - fromPos.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; bestId = o.id; }
      }
    }
    return bestId;
  }

  // The two random wooden relics this smithy offers. Chosen once from
  // STARTER_SMITH_SLOTS and memoized in save.starterSmithSlots so reloads +
  // re-taps keep the same pair. (A migration concern: older saves that
  // already forged pick/axe under the fixed queue just see whichever of the
  // two they don't yet own — owned slots are skipped in starterBlacksmithOffer.)
  starterSmithSlots() {
    if (!Array.isArray(this.save.starterSmithSlots) || this.save.starterSmithSlots.length !== 2) {
      const pool = [...STARTER_SMITH_SLOTS];
      // Fisher–Yates the pool, take the first two for a distinct random pair.
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      this.save.starterSmithSlots = [pool[0], pool[1]];
      persistSave(this.save);
    }
    return this.save.starterSmithSlots;
  }

  // Recipes the starter blacksmith trades for wooden tools. Every T1 item
  // costs a flat 5 wood — wood drops from ground stacks sprinkled near the
  // starting area (no tool needed), from chopping shrubs (bare-handed slow
  // chop), and from chopping trees (axe). The starter crate seeds the first
  // 5 wood so the player can forge their first tool immediately.
  starterBlacksmithRecipe(slot) {
    if (STARTER_SMITH_SLOTS.includes(slot)) {
      return [{ id: 'wood', qty: 5 }];
    }
    return null;
  }

  // Next of the two random wooden tools the player still needs. Returns null
  // once both are owned so the caller falls through to the normal random-relic
  // forge — the smithy keeps doing useful business after the starter pair.
  starterBlacksmithOffer() {
    for (const slot of this.starterSmithSlots()) {
      if (!(this.save.relics?.[slot]?.tier)) {
        return { kind: 'relic', slot, tier: 1 };
      }
    }
    return null;
  }

  // ─── Deliveries: plain houses only buy specific produce ──────────────
  // UTC day stamp ("YYYYMMDD") — the wishlist + happy state turn over on the
  // day boundary, so a house satisfied today wants a fresh bundle tomorrow.
  // Mirrors the coin-burst daily-cap key format.
  // Delivery wishlist logic lives in delivery.js (headlessly tested). These stay
  // as scene methods because render.js + the interact/present handlers call them
  // as scene.wantedProduce(o) / scene.isHouseSatisfied(o) / etc.
  _deliveryDayKey() {
    return Delivery.dayKey();
  }

  wantedProduceRng(house, dayKey) {
    return Delivery.wantedRng(house, dayKey);
  }

  _produceTier(id) {
    return Delivery.produceTier(id);
  }

  // 2-3 produce ids this plain house wants TODAY (re-rolled daily, tier-biased,
  // cached on the house per day so the render sign and interact handler agree).
  wantedProduce(house) {
    return Delivery.wantedProduce(this.save, house);
  }

  // True if this house had a bundle delivered already TODAY — happy until the
  // next UTC day boundary.
  isHouseSatisfied(house) {
    return Delivery.isSatisfied(this.save, house);
  }

  // Delivery interaction. Plain houses buy a SET — they want one of EACH of
  // their 2-3 wanted produce, delivered together. Tap with the full set in
  // your bags → deliver 1 of each per set for the summed full price (no sword
  // sellMul, no specialty bonus); the quantity selector lets you turn in
  // multiple complete sets at once. Tap without the full set → flash the
  // wanted icons so the player can see what to gather. Selling a single item
  // type isn't accepted here; that keeps plain houses distinct from markets.
  presentDeliveryOffer(sx, sy, house, recordDeal) {
    // Already fed today — the household is happy and won't take another
    // bundle until tomorrow. They'll want a fresh one on the next day.
    if (this.isHouseSatisfied(house)) {
      this.flash('happy — come back tomorrow', sx, sy);
      return;
    }
    const wanted = this.wantedProduce(house);
    if (!wanted.length) { this.flash('nobody home', sx, sy); return; }
    const invCount = (id) => {
      const s = (this.save.inv || []).find(e => e && e.id === id);
      return s ? (s.count ?? 0) : 0;
    };
    // Full set requires at least one of every wanted item. maxSets is how many
    // complete sets the current bags can fulfil (0 if any item is missing).
    const maxSets = wanted.reduce((m, id) => Math.min(m, invCount(id)), Infinity);
    const setIcons = wanted.map(id => this.iconSpanHTML(id)).join(' ');
    if (!maxSets) {
      const names = wanted.map(id => ITEM_BY_ID[id]?.name || id).join(', ');
      this.flash(`wants the set: ${names}`, sx, sy);
      return;
    }
    // Price of one complete set = sum of each wanted item's full price, plus a
    // delivery premium (DELIVERY_BONUS_MULT) so delivering the set beats selling
    // the items individually. Drives both the modal display and the payout.
    const setPrice = Math.max(1, Math.round(
      wanted.reduce((sum, id) => sum + Math.max(1, PRICES[id] ?? 1), 0) * DELIVERY_BONUS_MULT));
    // Name the goods rather than showing bare ~20px icons against 13px body
    // text, and say what the stepper counts.
    const setNames = wanted.map(id => ITEM_BY_ID[id]?.name || id).join(' + ');
    const fmt = (q) => ({
      get: `+$${setPrice * q}`,
      cost: `${q} ${q === 1 ? 'set' : 'sets'} × [ ${setIcons} ${setNames} ]`,
      canAfford: true,
    });
    const first = fmt(1);
    this.showOfferModal({
      kind: 'delivery',
      title: 'The household wants the full set:',
      cancelLabel: 'Later',
      get: first.get,
      cost: first.cost,
      canAfford: true,
      acceptLabel: 'Deliver',
      quantity: { min: 1, max: maxSets, initial: 1, format: fmt },
      onAccept: (q) => {
        // Re-validate against live bags so a stale modal can't over-deliver.
        const sets = Math.max(1, Math.min(q ?? 1,
          wanted.reduce((m, id) => Math.min(m, invCount(id)), Infinity)));
        if (!sets || sets === Infinity) { this.flash('Set incomplete now.', sx, sy); return; }
        for (const id of wanted) {
          const idx = this.save.inv.findIndex(s => s && s.id === id && (s.count ?? 0) > 0);
          if (idx < 0) continue;
          const cur = this.save.inv[idx];
          cur.count -= sets;
          if (cur.count <= 0) this.save.inv.splice(idx, 1);
        }
        if (this.save.selSlot >= this.save.inv.length) {
          this.save.selSlot = Math.max(0, this.save.inv.length - 1);
        }
        const gain = setPrice * sets;
        addMoney(this.save, gain);
        // Lifetime delivery tally — each completed SET counts as one delivery.
        // Gates the castle vault and ramps the delivery produce tier (see
        // delivery.js / shopGateInfo).
        this.save.deliveryCount = (this.save.deliveryCount ?? 0) + sets;
        // Mark this household satisfied for the rest of the UTC day — it stops
        // asking (shows "happy" instead of a wishlist) and wants a fresh bundle
        // tomorrow. Prune stale day stamps so the map stays small over weeks.
        const dayKey = this._deliveryDayKey();
        this.save.houseSatisfied = this.save.houseSatisfied || {};
        for (const k of Object.keys(this.save.houseSatisfied)) {
          if (this.save.houseSatisfied[k] !== dayKey) delete this.save.houseSatisfied[k];
        }
        this.save.houseSatisfied[house.id] = dayKey;
        recordDeal();
        persistSave(this.save);
        this.buildInventoryDOM();
        this.flashLoot(`🪙 +$${gain}`, '#ffe066', 1, wanted[0]);
      },
    });
  }

  // Read the persisted offer for this house if set, else build a new one and
  // persist. Persisting means the same offer "stays on display" until the
  // player either buys it, rerolls it, or (for non-castle shops) leaves and
  // the cap resets it. Castle offers persist forever and rotate on purchase.
  //
  // ─── Hour-bucket helpers ────────────────────────────────────────
  // Per-shop sub-hour offset so two shops don't rotate at the same wall-clock
  // minute. Cached on the scene because every tap consults it.
  // Shop hour-bucket scheduling + the seeded per-bucket RNG live in
  // shops_math.js (ShopsMath.*); these stay as scene methods because the present*
  // handlers + the renderer's ready/timer indicator call them as this.shopX(…).
  _shopBucketOffset(houseId) {
    return ShopsMath.bucketOffset(houseId);
  }
  _shopBucket(houseId, now = Date.now()) {
    return ShopsMath.bucket(houseId, now);
  }
  shopDealCap(house) {
    return ShopsMath.dealCap(house, this.isStarterBlacksmith(house));
  }
  shopReadiness(house) {
    return ShopsMath.readiness(this.save, house, this.shopDealCap(house));
  }
  // Flower charm: 0.5 while this building holds an unexpired charm (bought
  // with a Flowers gift — see the flower-gift branch in shopInteract), else 1.
  // Every cash price a shop quotes multiplies by this in one of two places:
  // buildShopOffer (seed/produce storefronts) and presentRelicOffer (castle /
  // relic-swap offers).
  shopCharmMul(house) {
    const until = house && house.id != null && this.save.shopCharm
      ? this.save.shopCharm[house.id] : 0;
    return until && Date.now() < until ? 0.5 : 1;
  }
  shopBucketState(house) {
    return ShopsMath.bucketState(this.save, house);
  }
  shopRng(house, lane = '') {
    return ShopsMath.rng(this.save, house, lane);
  }

  // Build a relic/armor offer for a specific house, derived purely from the
  // seeded RNG so the same shop in the same bucket always shows the same
  // offer — no need to persist the offer object. Re-roll bumps cur.rerolls
  // which pivots the seed lane.
  peekOrBuildRelicOffer(house) {
    const isCastle = !!house && (house.kind === 'tower' || house.tier === 12);
    if (!house?.id) return this.buildRelicOffer(Math.random, { isCastle });
    const rng = this.shopRng(house, 'relic');
    return this.buildRelicOffer(rng, { isCastle });
  }

  // Pick a random relic OR armor piece the player can actually use — meaning
  // their current slot is empty or holds a strictly lower tier. Returns null
  // if no upgrade is possible (caller falls through to the usual seed offer).
  // Tier is biased low so most offers are wood/copper; rare materials are rare.
  // `rng` defaults to Math.random — pass a seeded one for stable per-bucket offers.
  buildRelicOffer(rng = Math.random, opts = {}) {
    // Relic/armor offer roll lives in gear.js (Gear.buildRelicOffer) — armor +
    // relic pools normalised to ~50% airtime each, low-tier biased, castle vs
    // regular pricing. Kept as a scene method so peekOrBuildRelicOffer (which
    // threads the seeded shopRng) calls it the same way. The Ring is excluded
    // there (it's the wizard tower's exclusive gift — see syncInnerLightRing).
    return Gear.buildRelicOffer(this.save, rng, opts);
  }

  // Build the "Re-roll" secondary button shared by the relic and blacksmith
  // offers. Both pivot the same seed lane (curState.rerolls) and pull the next
  // target from peekOrBuildRelicOffer; they differ only in the "nothing left"
  // flash text and which present* method re-renders. Cost = 5 × 2^rerolls.
  // (The trader offer's re-roll is structurally different — it has no peek
  // step — so it stays inline in presentTraderOffer.)
  _makeRerollSecondary(house, sx, sy, emptyMsg, present) {
    const curState = house?.id ? this.shopBucketState(house) : null;
    const rerollCost = 5 * Math.pow(2, curState?.rerolls || 0);
    return {
      label: `Re-roll<br><span style="font-weight:400;font-size:10px;opacity:.85">$${rerollCost}</span>`,
      disabled: (this.save.money ?? 0) < rerollCost,
      onClick: () => {
        if ((this.save.money ?? 0) < rerollCost) { this.flash(`Coin purse won't stretch — need $${rerollCost}.`, sx, sy); return; }
        if (curState) curState.rerolls += 1;
        const next = this.peekOrBuildRelicOffer(house);
        if (!next) { this.flash(emptyMsg, sx, sy); return; }
        addMoney(this.save, -rerollCost);
        persistSave(this.save);
        this.updateHUD();
        present(next);
      },
    };
  }

  // Present a relic/armor offer. Re-roll is only shown at castles — regular
  // houses + the starter shop hide it. The offer is derived from the bucket
  // seed via peekOrBuildRelicOffer, so no per-tap persistence is needed; the
  // re-roll button bumps cur.rerolls which pivots the seed lane.
  presentRelicOffer(sx, sy, offer, recordDeal, house, allowReroll = false) {
    const name = gearName(offer.kind, offer.slot, offer.tier);
    const iconHtml = this.gearIconHTML(offer.kind, offer.slot, offer.tier, 24);
    const blurb = offer.kind === 'relic'
      ? (gearDef(offer.kind, offer.slot)?.blurb || '')
      : `+${(ARMOR_DEFS[offer.slot]?.energyPerTier || 0) * offer.tier} max energy`;
    // Flower charm halves the asking price for the charm window (floor $1).
    const price = Math.max(1, Math.ceil(offer.price * this.shopCharmMul(house)));
    this.showOfferModal({
      kind: 'relics',
      title: this.buildingFlavorTitle(house, 'relic'),
      cancelLabel: 'Later',
      get: `${iconHtml} ${name}`,
      blurb,
      cost: `$${price}`,
      canAfford: (this.save.money ?? 0) >= price,
      acceptLabel: 'Buy',
      onAccept: () => {
        // Last-chance downgrade guard — by the time the player taps Buy, the
        // slot may have been upgraded elsewhere (chest reward, another shop).
        const curTier = offer.kind === 'relic'
          ? (this.save.relics?.[offer.slot]?.tier ?? 0)
          : (this.save.armor?.[offer.slot]?.tier ?? 0);
        if (offer.tier <= curTier) { this.flash('Already carry a finer one.', sx, sy); return; }
        if ((this.save.money ?? 0) < price) { this.flash(`Coin purse won't stretch — need $${price}.`, sx, sy); return; }
        addMoney(this.save, -price);
        this._equipGear(offer.kind, offer.slot, offer.tier);
        this.markRelicsDirty();
        recordDeal();
        persistSave(this.save);
        this.updateHUD();
        this.flashLoot(`🪙 ${name}\n−$${price}`, '#ffe066', 1.25);
      },
      // Pivot the seed lane so the next peekOrBuildRelicOffer returns
      // something else — no per-house cache to invalidate.
      secondary: allowReroll
        ? this._makeRerollSecondary(house, sx, sy, 'Stalls are empty for now.',
            next => this.presentRelicOffer(sx, sy, next, recordDeal, house, true))
        : undefined,
    });
  }

  // Blacksmiths (houses with an address ending in 9) forge a relic for
  // exactly 5 of a gem they pick. Gem type is deterministic per house so a
  // smith always demands the same stone; relic comes from peekOrBuildRelicOffer
  // so it's stable until bought. Reuses the generic showOfferModal — same UI
  // as cash/barter trades, just with a gem cost.
  // Blacksmith recipe lookup. Returns an array of { id, qty } ingredient
  // entries for forging the given (kind, slot, tier) relic/armor. Recipe
  // rules:
  //   • Tools / weapons / armor / utility — pay max(5, tier) of the
  //     tier-matched bar. The low tiers (T1 wood, T2 copper, T3 iron,
  //     T4 gold, T5 platinum) all cost 5; crimson (T6) / frost (T7) keep
  //     ramping to 6 / 7 so nothing high-tier got cheaper. T2..T4 bars are
  //     mined; T5..T7 bars (platinum / crimson / frost) are SMELTED from
  //     their flowers, so the flower bond is implicit through the bar req.
  //   • Jewelry slots (ring / staff / amulet) — geometric gem cost
  //     (1, 2, 4, 8, 16, 32 from T2..T7) of the slot-specific gem:
  //       ring → ruby, staff → emerald, amulet → sapphire
  //     plus 1 of the tier-matched bar.
  // (The starter shop's T1 wooden pick / axe / hoe use a separate cheap
  // bootstrap recipe — see starterBlacksmithRecipe — and don't pass here.)
  // Forge + smelt recipes live in gear.js (Gear.*). Kept as scene methods
  // because the present* shop modals call them as this.blacksmithRecipe(…) etc.
  blacksmithRecipe(kind, slot, tier) {
    return Gear.blacksmithRecipe(kind, slot, tier);
  }

  smeltingRecipe(barId) {
    return Gear.smeltingRecipe(barId);
  }

  smeltUnlockedBars() {
    return Gear.smeltUnlockedBars();
  }

  // Smelt tab at the blacksmith. Focuses ONE unlocked top bar at a time, with a
  // quantity stepper, consuming the recipe ingredients to mint bars. The
  // `secondary` button rotates through the other unlocked bars, and a Forge /
  // Smelt tab row (forgeBack re-opens the forge tab) lets the player toggle
  // back without leaving the shop. `target` defaults to the highest unlocked
  // bar the player can currently afford, so the modal opens on something usable.
  presentSmeltOffer(sx, sy, house, recordDeal, forgeBack, target = null) {
    const bars = this.smeltUnlockedBars();
    const heldCount = (id) =>
      ((this.save.inv || []).find(s => s && s.id === id)?.count) ?? 0;
    const consume = (id, n) => {
      let left = n;
      for (let i = this.save.inv.length - 1; i >= 0 && left > 0; i--) {
        const s = this.save.inv[i];
        if (!s || s.id !== id) continue;
        const take = Math.min(left, s.count ?? 0);
        s.count -= take; left -= take;
        if ((s.count ?? 0) <= 0) {
          this.save.inv.splice(i, 1);
          if (this.save.selSlot >= this.save.inv.length) {
            this.save.selSlot = Math.max(0, this.save.inv.length - 1);
          }
        }
      }
    };
    const tabs = [
      { label: 'Forge', active: false, onSelect: forgeBack },
      { label: 'Smelt', active: true,  onSelect: () => {} },
    ];
    if (!bars.length) {
      this.showOfferModal({
        kind: 'forge',
        title: 'Nothing to smelt',
        cancelLabel: 'Later',
        get: 'No ingredients yet',
        blurb: 'Gather the ingredients to smelt platinum, crimson, or frost bars here.',
        cost: '',
        canAfford: false,
        acceptLabel: 'Close',
        tabs,
        onAccept: () => {},
      });
      return;
    }
    // Default focus: highest unlocked bar the player can afford ≥1 of, else
    // the highest unlocked. An explicit `target` (from the rotate button) wins
    // as long as it's actually unlocked. Prefer the highest unlocked bar the
    // player can actually afford ≥1 of, so the modal opens on something usable
    // rather than a bar they lack ingredients for (the rotate button still
    // reaches the others).
    if (!target || !bars.includes(target)) {
      target = bars.slice().reverse().find(id =>
        this.smeltingRecipe(id).every(r => heldCount(r.id) >= r.qty)) || bars[bars.length - 1];
    }
    const recipe = this.smeltingRecipe(target);
    const outItem = ITEM_BY_ID[target];
    // Max smeltable = min over ingredients of floor(held / qty). Guard the
    // empty/missing-recipe case explicitly: an empty recipe would leave the
    // reduce seed (Infinity) untouched, and `Infinity || 0` is Infinity (truthy)
    // — so an unbounded stepper. Treat a non-2-ingredient recipe as cap 0.
    const cap = (Array.isArray(recipe) && recipe.length)
      ? Math.max(0, recipe.reduce(
          (m, r) => Math.min(m, Math.floor(heldCount(r.id) / r.qty)), Infinity))
      : 0;
    const recipeLine = (n) => recipe.map(r => {
      const it = ITEM_BY_ID[r.id];
      const ok = heldCount(r.id) >= r.qty * n;
      return `<span style="color:${ok ? '#a7ffb0' : '#ff8a7a'}">`
        + `${r.qty * n}× ${this.iconSpanHTML(r.id)} ${it?.name || r.id}</span>`;
    }).join(' + ');
    // Rotate-target button cycles to the next unlocked bar (wraps around).
    const idx = bars.indexOf(target);
    const next = bars[(idx + 1) % bars.length];
    const fmt = (n) => ({
      get: `${n}× ${this.iconSpanHTML(target)} ${outItem?.name || target}`,
      cost: recipeLine(n),
      canAfford: cap >= n && n >= 1,
    });
    const first = fmt(1);
    this.showOfferModal({
      kind: 'forge',
      title: 'The blacksmith stokes the crucible:',
      cancelLabel: 'Later',
      get: first.get,
      cost: cap >= 1 ? first.cost : recipeLine(1),
      canAfford: cap >= 1,
      acceptLabel: 'Smelt',
      tabs,
      quantity: cap >= 1 ? { min: 1, max: cap, initial: 1, format: fmt } : undefined,
      secondary: (bars.length > 1 && next !== target)
        ? { label: `Smelt ${ITEM_BY_ID[next]?.name || 'other'}`,
            onClick: () => this.presentSmeltOffer(sx, sy, house, recordDeal, forgeBack, next) }
        : undefined,
      onAccept: (n) => {
        const q = Math.max(1, Math.min(n ?? 1, cap));
        if (q < 1 || !recipe.every(r => heldCount(r.id) >= r.qty * q)) {
          this.flash('not enough to smelt', sx, sy); return;
        }
        for (const r of recipe) consume(r.id, r.qty * q);
        this.addToInv(target, q);
        recordDeal();
        persistSave(this.save);
        this.buildInventoryDOM();
        this.flashLoot(`✨ ${outItem?.name || target} ×${q}`, '#ffe066', 1.25, target);
      },
    });
  }

  // ─── Wizard tower: Inner Light (Discovery → reach) ───────────────
  // The wizard tower spends the player's Discovery badges on an "Inner
  // Light": each one is a +0.5-cell reach (range) upgrade on the reachUpgrades
  // ladder (capped at 5 cells / 6 upgrades). The tower is the SOLE source of
  // reach upgrades — each Inner Light costs WIZARD_INNER_LIGHT_COST Discovery.
  //
  // The Inner Light and the RING relic are one and the same: kindling a light
  // also forges a Ring whose tier tracks the inner-light level (reachUpgrades).
  // The ring is the wizard tower's exclusive gift — it is no longer offered for
  // sale or at the smithy (see buildRelicOffer), so the only way to a Ring is
  // to widen your sight. syncInnerLightRing() is the single point that keeps the
  // ring tier in step with the light; it's called from every place the reach
  // ladder advances.
  WIZARD_INNER_LIGHT_COST = 5;
  // Keep the Ring relic's tier locked to the inner-light level. Never downgrades
  // a ring the player somehow holds higher (e.g. a legacy forged ring on an old
  // save); the ring tops out at the reach ladder's 6 upgrades.
  syncInnerLightRing() {
    const level = Math.min(7, this.save.reachUpgrades ?? 0);
    if (level <= 0) return;
    this.save.relics = this.save.relics || {};
    const cur = this.save.relics.ring?.tier ?? 0;
    if (level > cur) this._equipGear('relic', 'ring', level);
  }
  presentInnerLightOffer(sx, sy, recordDeal) {
    const cost = this.WIZARD_INNER_LIGHT_COST;
    const claimed = this.save.reachUpgrades ?? 0;
    // Reach already maxed — the Inner Light has nothing left to widen.
    if (claimed >= this.REACH_UPGRADE_MAX) {
      this.flash('The wizard nods — your sight already spans the world.', sx, sy);
      return;
    }
    const have = Inventory.count(this.save, 'discovery');
    const reachAfter = Math.min(5, 2 + 0.5 * (claimed + 1));
    this.showOfferModal({
      kind: 'wizard',
      title: 'The wizard offers an Inner Light:',
      cancelLabel: 'Later',
      acceptLabel: 'Kindle',
      get: `🔆 Inner Light — reach ${reachAfter} cells`,
      cost: `🔆 ${cost} Discovery (you have ${have})`,
      canAfford: have >= cost,
      onAccept: () => {
        // Re-read the live stack so a stale modal can't overspend badges.
        if (Inventory.count(this.save, 'discovery') < cost) { this.flash('Not enough Discovery.', sx, sy); return; }
        if ((this.save.reachUpgrades ?? 0) >= this.REACH_UPGRADE_MAX) { this.flash('Reach already maxed.', sx, sy); return; }
        Inventory.remove(this.save, 'discovery', cost);
        // The spend may have spliced the badge stack out — keep selSlot valid.
        if (this.save.selSlot >= this.save.inv.length) {
          this.save.selSlot = Math.max(0, this.save.inv.length - 1);
        }
        this.save.reachUpgrades = (this.save.reachUpgrades ?? 0) + 1;
        // The light's gift is a Ring whose tier matches the new inner-light
        // level — the relic that embodies your widened sight.
        this.syncInnerLightRing();
        recordDeal();
        // The reach silhouette redraws every frame from reachRadiusM, so the
        // wider reach shows on the next frame with no explicit invalidation.
        persistSave(this.save);
        if (this.buildInventoryDOM) this.buildInventoryDOM();
        this.showChestRewardModal({
          kind: 'wizard',
          header: '✨ Inner Light kindled ✨',
          iconHTML: '',
          name: `Reach ${reachAfter} cells · Ring T${Math.min(7, this.save.reachUpgrades)}`,
          sub: `The wizard channels your discoveries into wider sight — and a Ring to bear it.`,
          color: UI_TREASURE,
        });
      },
    });
  }

  // ─── Reach / Inner Light cap ─────────────────────────────────────
  // Six +0.5-cell steps carry reach from 2 cells to 5. They're claimed
  // EXCLUSIVELY at the wizard tower's Inner Light (presentInnerLightOffer),
  // which also forges the matching Ring tier.
  REACH_UPGRADE_MAX = 6;

  // Trader offer: barter-only, qty scaled to a target trade value. The trader
  // picks an item to give the player, picks an asking item from inventory,
  // then asks for whatever count of it hits a target value (1.0..2.0× of the
  // offered item's base price). Seeded by (house, bucket, rerolls) so the
  // offer is stable until the player buys, walks away through a bucket flip,
  // or pays the re-roll cost.
  peekOrBuildTraderOffer(house) {
    if (!house?.id) return null;
    const rng = this.shopRng(house, 'trader');
    // Same houseSeed produce-vs-buylist coin flip the generic path uses.
    const houseSeed = ((Math.round(house.x * 100) ^ Math.round(house.y * 100)) >>> 0);
    const sellsProduce = !!houseSeed && ((houseSeed * 2654435761) >>> 0) % 10 < 3;
    let giveId;
    if (sellsProduce) {
      const ids = Object.keys(CROP_ROW);
      giveId = ids[Math.floor(rng() * ids.length)] || ids[0];
    } else {
      giveId = BUY_LIST[Math.floor(rng() * BUY_LIST.length)] || BUY_LIST[0];
    }
    if (!giveId) return null;
    const baseValue = Math.max(1, PRICES[giveId] ?? 1);
    // Target trade value the trader considers appropriate.
    const target = baseValue * (1.0 + rng());
    // Asking item: any priced item, excluding the offered id. Prefer something
    // the player actually owns so the offer is acceptable on the spot;
    // otherwise fall back to a wishlist pick so the player still learns what
    // the trader wants.
    const owned = (this.save.inv || []).filter(s =>
      s && s.id && s.id !== giveId && (s.count ?? 0) > 0 && (PRICES?.[s.id] ?? 0) > 0);
    let askId;
    if (owned.length) {
      askId = owned[Math.floor(rng() * owned.length)].id;
    } else {
      const wishlist = Object.keys(PRICES).filter(k =>
        k !== giveId && (PRICES[k] ?? 0) > 0 && ITEM_BY_ID[k]);
      if (!wishlist.length) return null;
      askId = wishlist[Math.floor(rng() * wishlist.length)];
    }
    const askQty = Math.max(1, Math.ceil(target / Math.max(1, PRICES[askId] ?? 1)));
    return { giveId, askId, askQty };
  }

  presentTraderOffer(sx, sy, house, recordDeal) {
    const offer = this.peekOrBuildTraderOffer(house);
    if (!offer) { this.flash('no deal', sx, sy); return; }
    const giveItem = ITEM_BY_ID[offer.giveId];
    const askItem  = ITEM_BY_ID[offer.askId];
    const heldCount = () =>
      ((this.save.inv || []).find(s => s && s.id === offer.askId)?.count) ?? 0;
    const curState = this.shopBucketState(house);
    const rerollCost = 5 * Math.pow(2, curState.rerolls || 0);
    // Low-tier seeds barter in a slightly larger bundle (planted in bulk).
    const giveQty = TRADE_OFFER_QTY
      + (isLowTierSeed(offer.giveId) ? LOW_TIER_SEED_QTY_BONUS : 0);
    this.showOfferModal({
      kind: 'trade',
      // Spell out who gives what so the barter can't be read backwards:
      // "Trader offers <giveItem> for your <askItem>".
      title: 'The trader offers:',
      forLabel: 'for your',
      cancelLabel: 'Later',
      get: `${this.iconSpanHTML(offer.giveId)} ${giveItem?.name || offer.giveId} ×${giveQty}`,
      cost: `${offer.askQty}× ${this.iconSpanHTML(offer.askId)} ${askItem?.name || offer.askId}`,
      canAfford: heldCount() >= offer.askQty,
      onAccept: () => {
        if (heldCount() < offer.askQty) {
          this.flash(`need ${offer.askQty} ${askItem?.name || offer.askId}`, sx, sy);
          return;
        }
        const idx = this.save.inv.findIndex(s => s && s.id === offer.askId);
        const cur = this.save.inv[idx];
        cur.count -= offer.askQty;
        if (cur.count <= 0) {
          this.save.inv.splice(idx, 1);
          if (this.save.selSlot >= this.save.inv.length) {
            this.save.selSlot = Math.max(0, this.save.inv.length - 1);
          }
        }
        this.addToInv(offer.giveId, giveQty);
        this.save.buyIndex = (this.save.buyIndex ?? 0) + 1;
        recordDeal();
        persistSave(this.save);
        this.buildInventoryDOM();
        this.flashLoot(
          `🪙 ${giveQty}× ${giveItem?.name || offer.giveId}\n−${offer.askQty} ${askItem?.name || offer.askId}`,
          '#ffe066', 1, offer.giveId,
        );
      },
      secondary: {
        label: `Re-roll<br><span style="font-weight:400;font-size:10px;opacity:.85">$${rerollCost}</span>`,
        disabled: (this.save.money ?? 0) < rerollCost,
        onClick: () => {
          if ((this.save.money ?? 0) < rerollCost) { this.flash(`Coin purse won't stretch — need $${rerollCost}.`, sx, sy); return; }
          curState.rerolls += 1;
          addMoney(this.save, -rerollCost);
          persistSave(this.save);
          this.updateHUD();
          this.presentTraderOffer(sx, sy, house, recordDeal);
        },
      },
    });
  }

  // True iff `house` is a tier-9 small building that hasn't been restored
  // yet. Trailer (starter shop) and forts/castles skip wreck status. Used
  // ─── Path-stone activation ───────────────────────────────────────
  // Each cell of a named pedestrian path is a "stone" the player can
  // claim by either tapping it or walking onto it. Claimed stones get a
  // full opacity (render.js looks them up via _isPathStoneActive). When
  // every stone of one named path on one tile is claimed, the player
  // gets a fanfare modal with a T4 lowtier-class loot roll — the kind
  // of nice surprise a focused "walk the whole trail" run deserves.
  // State shape:
  //   save.pathStones = {
  //     "<z/tx/ty>": {
  //       "<full street name>": { stones: ["ix_iy", ...], done: bool }
  //     }
  //   }
  // Per-tile keying keeps the data structure bounded and means a path
  // crossing N tiles offers up to N rewards (one per tile completed).
  _isPathStoneActive(tx, ty, ix, iy) {
    const tileKey = WorldGen.tileKey(tx, ty);
    const tile = this.save.pathStones && this.save.pathStones[tileKey];
    if (!tile) return false;
    const entry = WorldGen.tileCache.get(tileKey);
    if (!entry || !entry.pathNames) return false;
    // Callers pass ABSOLUTE cell coords; pathNames is keyed by tile-local
    // ix_iy (per the worldgen rasterize loop). Convert by stripping out
    // the tile-origin offset.
    const N = entry.cellsPerEdge;
    const lix = ((ix % N) + N) % N;
    const liy = ((iy % N) + N) % N;
    const cellKey = `${lix}_${liy}`;
    const name = entry.pathNames[cellKey];
    if (!name) return false;
    const rec = tile[name];
    return !!(rec && (rec.done || (rec.stones && rec.stones.includes(cellKey))));
  }
  // Mark the path stone under abs cell (ix, iy) as activated. Returns
  // true iff the cell was newly activated (so callers can suppress flash
  // spam on every step over an already-claimed stone). Fires the path-
  // completion reward when this activation closes out the named path.
  _activatePathStone(tx, ty, ix, iy) {
    const tileKey = WorldGen.tileKey(tx, ty);
    const entry = WorldGen.tileCache.get(tileKey);
    if (!entry || !entry.pathNames) return false;
    // ABS → tile-local conversion (mirrors _isPathStoneActive — see comment
    // there for the rationale).
    const N = entry.cellsPerEdge;
    const lix = ((ix % N) + N) % N;
    const liy = ((iy % N) + N) % N;
    const cellKey = `${lix}_${liy}`;
    const name = entry.pathNames[cellKey];
    if (!name) return false;
    this.save.pathStones = this.save.pathStones || {};
    const tileStones = this.save.pathStones[tileKey] =
      this.save.pathStones[tileKey] || {};
    const rec = tileStones[name] = tileStones[name] || { stones: [], done: false };
    if (rec.done || rec.stones.includes(cellKey)) return false;
    rec.stones.push(cellKey);
    // Record a short-lived "just claimed" flash for render.js's cobble pass
    // (see PATH_STONE_FLASH_MS there) — a little scale-pop plays on this
    // exact cell so claiming a stone reads as an event, not just a silent
    // opacity change next frame. Keyed by ABS cell so it survives the
    // tx/ty → tile-local conversion above. Pruned here (not every frame) —
    // activations are rare enough that this map never grows unbounded.
    this._pathStoneFlashes = this._pathStoneFlashes || new Map();
    const flashNow = performance.now();
    // Prune window must stay comfortably above render.js's PATH_STONE_FLASH_MS
    // (the animation's own length) or an activation would get pruned away
    // mid-animation instead of aging out after it's already finished playing.
    const pruneMs = (typeof PATH_STONE_FLASH_MS === 'number' ? PATH_STONE_FLASH_MS : 900) + 500;
    for (const [k, t] of this._pathStoneFlashes) {
      if (flashNow - t > pruneMs) this._pathStoneFlashes.delete(k);
    }
    this._pathStoneFlashes.set(cellKeyFromAbsCell(ix, iy), flashNow);
    // Spec §PATH STONES: every 2nd claimed stone on the same named path awards
    // 1 coin (a 30-stone path pays 15 total; a single stone pays nothing). Pay
    // each 2-stone milestone exactly once as the player walks it. This is in
    // ADDITION to the one-time completion reward fired below.
    const milestones = Math.floor(rec.stones.length / 2);
    if (milestones > (rec.coinsPaid || 0)) {
      const newCoins = milestones - (rec.coinsPaid || 0);
      rec.coinsPaid = milestones;
      addMoney(this.save, newCoins);
      this.flashLoot(`🪙 +$${newCoins} path`, '#ffe066', 1);
    }
    // Completion check: count every cell whose pathNames entry === name.
    let total = 0;
    for (const k in entry.pathNames) if (entry.pathNames[k] === name) total++;
    if (rec.stones.length >= total) {
      rec.done = true;
      // Only reward trails of real length. Every path cell is now named
      // (worldgen flood-fill), so without this floor a 1–2 cell footpath stub
      // would pop the full fanfare. 8 cells ≈ 40 m — a trail worth walking.
      const MIN_TRAIL = 8;
      if (total >= MIN_TRAIL) this._firePathCompletionReward(name);
    }
    persistSave(this.save);
    return true;
  }
  // Reward fired when every stone of a named path on the current tile
  // has been activated. Uses the unified rarity picker with the lowtier
  // chest biome at tier 4 (the most generous lowtier curve) so the
  // reward is meaningful without competing with the actual T4 epic
  // POI chests. Routed through showChestRewardModal so it shares the
  // same fanfare + sparkles as chest opens.
  _firePathCompletionReward(name) {
    const reward = (typeof pickReward === 'function')
      ? pickReward('chest:lowtier', this.save, undefined, { tier: 4 })
      : null;
    // Unnamed trails carry a synthetic "trail#<tile>_<n>" key (worldgen
    // flood-fill) — show a generic title rather than the raw id.
    const title = name.startsWith('trail#') ? 'HIDDEN TRAIL' : name.toUpperCase();
    if (!reward) {
      // Defensive fallback — give $5 so the player isn't stiffed.
      addMoney(this.save, 5);
      this.showChestRewardModal({
        kind: 'trail',
        header: `${title} complete`,
        iconHTML: '<span style="font-size:48px">🪙</span>',
        name: '+$5',
        color: UI_GOLD,
      });
      return;
    }
    if (reward.kind === 'item') {
      this.addToInv(reward.id, reward.qty);
      const item = ITEM_BY_ID[reward.id];
      const color = (typeof tierInfo === 'function' ? tierInfo(reward.id).color : '#a7e9ff');
      const iconHTML = this.iconSpanHTML ? this.iconSpanHTML(reward.id, 64) : '';
      this.showChestRewardModal({
        kind: 'trail',
        header: `${title} complete`,
        iconHTML,
        name: item?.name || reward.id,
        qty: reward.qty > 1 ? `× ${reward.qty}` : null,
        color,
      });
    } else if (reward.kind === 'gold') {
      addMoney(this.save, reward.amount);
      this.showChestRewardModal({
        kind: 'trail',
        header: `${title} complete`,
        iconHTML: '<span style="font-size:48px">🪙</span>',
        name: `+$${reward.amount}`,
        color: UI_GOLD,
      });
    } else if (reward.kind === 'relic' || reward.kind === 'armor') {
      // A gear roll can yield a relic OR armor (armor is just another gear
      // slot). equipGearReward handles both and bumps energy for armor.
      if (typeof equipGearReward === 'function') {
        equipGearReward(reward, this.save, this);
      } else {
        this.save.relics[reward.slot] = { tier: reward.tier };
        this.markRelicsDirty?.();
      }
      const relicName = (typeof gearName === 'function')
        ? gearName(reward.kind, reward.slot, reward.tier)
        : `${reward.slot} T${reward.tier}`;
      const iconHTML = this.gearIconHTML
        ? this.gearIconHTML(reward.kind, reward.slot, reward.tier, 64)
        : '★';
      this.showChestRewardModal({
        kind: 'trail',
        header: `${title} complete`,
        iconHTML,
        name: relicName,
        sub: 'equipped',
        color: UI_TREASURE,
      });
    }
    if (reward.consolation > 0) {
      addMoney(this.save, reward.consolation);
    }
  }

  // by shopInteract to route to the restore modal and by the render layer
  // indirectly via save.restoredHouses (see _houseRole in render.js).
  _isHouseWreck(house) {
    if (!house || house.kind !== 'house') return false;
    if (house.tier !== 9) return false;   // forts (11) + castles (12) skip wreck
    if (this.save.starterShopId && this.save.starterShopId === house.id) return false;
    return !this.save.restoredHouses?.[house.id];
  }

  // Restoration cost: every house repair costs a flat 3 stone (rockfruit —
  // wild residential debris, gatherable bare-handed). Themed shops and plain
  // residential alike rebuild from the same masonry.
  _wreckRestoreCost(house) {
    return { id: 'rockfruit', qty: 3, material: 'stone' };
  }

  // The role a wreck reveals once restored — mirrors render.js _houseTrueRole
  // (minus fort/trailer, which never wreck). 'blacksmith' | 'market' |
  // 'trader' | 'wizard' | 'plain'. Reads the frozen restore-order role via
  // houseShopRole; 'plain' for a role-less residential house.
  _restoredRole(house) {
    return this.houseShopRole(house) || 'plain';
  }

  // Bake a restored building's sprite to an <img> data URL for the
  // restoration fanfare modal. Themed roles (blacksmith/market/trader) are
  // single-image textures; 'plain' uses the 'house' tileset's 'front' sub-rect
  // (registered in assets.js as add('front', 0, 148, 3, 72, 95)).
  buildingImgHTML(role, px = 72) {
    let url = null;
    try {
      if (role === 'plain') {
        const src = this.textures.get('house')?.getSourceImage();
        if (src) {
          const c = document.createElement('canvas');
          c.width = 72; c.height = 95;
          c.getContext('2d').drawImage(src, 148, 3, 72, 95, 0, 0, 72, 95);
          url = c.toDataURL();
        }
      } else if (role === 'wizard') {
        // Wizard towers use wizard.png; crop the fully-restored top-row frame
        // (frame 3 = col×80px → x:240).
        const src = this.textures.get('shrine')?.getSourceImage();
        if (src) {
          const c = document.createElement('canvas');
          c.width = 80; c.height = 104;
          c.getContext('2d').drawImage(src, 240, 0, 80, 104, 0, 0, 80, 104);
          url = c.toDataURL();
        }
      } else {
        url = this.textures.get('house_' + role)?.getSourceImage()?.toDataURL?.() || null;
      }
    } catch (_) { /* fall back to emoji below */ }
    if (!url) return '🏠';
    return `<img src="${url}" alt="" style="width:${px}px;height:auto;image-rendering:pixelated;">`;
  }

  presentWreckRestoreModal(sx, sy, house) {
    const cost = this._wreckRestoreCost(house);
    const heldCount = ((this.save.inv || []).find(s => s && s.id === cost.id)?.count) ?? 0;
    const canAfford = heldCount >= cost.qty;
    const item = ITEM_BY_ID[cost.id];
    // Role this wreck will reveal, picked from the player's current restore
    // order (this house isn't in restoredHouses yet, so the live count IS its
    // 0-based index). Single-modal guard keeps the count stable while the modal
    // is open, so recomputing the same index on accept lands on the same role.
    const restoreOrder = Object.keys(this.save.restoredHouses || {}).length;
    const prospectiveRole = this._preseedRestoreRole(restoreOrder, house);
    // "shop" if this wreck restores into a themed business, else "house".
    const isThemed = prospectiveRole !== 'plain';   // blacksmith / market / trader / wizard
    // Always show the modal — even when the player can't yet afford it,
    // they need to see WHAT to gather. Accept stays disabled (red cost
    // line, greyed button) so the dialog reads as a price tag rather
    // than a tease. The player will dismiss, go collect, come back.
    this.showOfferModal({
      kind: 'build',
      title: 'Restore this wreck?',
      cancelLabel: 'Later',
      get: `🛠 a working ${isThemed ? 'shop' : 'house'}`,
      blurb: 'Hauls the rubble away and pulls back the boards.',
      cost: `${cost.qty}× ${this.iconSpanHTML(cost.id)} ${item?.name || cost.id}`
        + (canAfford ? '' : ` <span style="opacity:.7">(have ${heldCount})</span>`),
      canAfford,
      acceptLabel: 'Restore',
      onAccept: () => {
        // Re-check stock at accept time — the player might have spent
        // the materials elsewhere while the modal was open.
        const idx = this.save.inv.findIndex(s => s && s.id === cost.id && (s.count ?? 0) >= cost.qty);
        if (idx < 0) { this.flash(`need ${cost.qty} ${item?.name || cost.id}`, sx, sy); return; }
        const stack = this.save.inv[idx];
        stack.count -= cost.qty;
        if ((stack.count ?? 0) <= 0) {
          this.save.inv.splice(idx, 1);
          if (this.save.selSlot >= this.save.inv.length) {
            this.save.selSlot = Math.max(0, this.save.inv.length - 1);
          }
        }
        this.save.restoredHouses = this.save.restoredHouses || {};
        // Freeze the restore-order role onto this house so it never shifts.
        // Recompute the index at accept time (still stable behind the modal
        // guard) so a stale closure can't desync from the live count.
        const order = Object.keys(this.save.restoredHouses).length;
        const restoredRole = this._preseedRestoreRole(order, house);
        this.save.restoredHouses[house.id] = restoredRole;   // role string, not bare `true`
        // The first wreck restored becomes the starter blacksmith (wooden-tool
        // forge). Stamp its id so isStarterBlacksmith / shopDealCap pick it up.
        if (restoredRole === 'blacksmith' && this.save.starterBlacksmithId == null) {
          this.save.starterBlacksmithId = house.id;
        }
        // The first restored market becomes the guaranteed T1/T2 seed shop
        // (see isFirstMarket / the buy branch in shopInteract).
        if (restoredRole === 'market' && this.save.firstMarketId == null) {
          this.save.firstMarketId = house.id;
        }
        persistSave(this.save);
        this.buildInventoryDOM();
        this.questEvent('restore');
        if (this.showChestRewardModal) {
          // Name the building, describe what it does, show its sprite, and let
          // showChestRewardModal's sparkle burst supply the fanfare.
          const role = this._restoredRole(house);
          const INFO = {
            blacksmith: { name: 'Blacksmith',   blurb: 'Forge tools and trade gems for relics here.' },
            market:     { name: 'Market',       blurb: 'Buys your crops at a premium — and stocks fresh produce.' },
            trader:     { name: 'Trader',       blurb: 'Barters goods and pays a bonus on every sale.' },
            wizard:     { name: 'Wizard Tower', blurb: 'A reclusive mage kindles an Inner Light — trade 5 Discovery badges for a wider reach and the Ring that carries it.' },
            plain:      { name: 'House',        blurb: 'Neighbours pay coin for the produce bundles they crave.' },
          };
          const info = INFO[role] || INFO.plain;
          this.showChestRewardModal({
            kind: 'build',
            iconHTML: this.buildingImgHTML(role, 72),
            header: 'Restored!',
            name: `You restored a ${info.name}`,
            sub: info.blurb,
            color: '#a7ffb0', accent: '#a7ffb0',
          });
        } else {
          this.flashLoot('🛠 restored', '#a7ffb0', 1.25);
        }
      },
    });
  }

  // Lifetime deliveries this building demands before it'll trade, or 0 if it
  // has no delivery gate. Only castles (BUILDING_LARGE / tower, tier 12) gate
  // on deliveries now — forts unseal with wood (see _isFortLocked).
  //
  // The gate ramps per castle (see CASTLE_DELIVERY_GATE_START): an already-opened
  // castle has no gate (0); an un-opened one asks START + STEP×(castles already
  // opened), capped at CASTLE_DELIVERY_GATE.
  _deliveryGate(house) {
    if (!house) return 0;
    if (house.kind === 'tower' || house.tier === 12) {
      // Already opened → no gate. (id-less castles can't be recorded, so they
      // always read the ramped gate below.)
      if (house.id && this.save.openedCastles?.[house.id]) return 0;
      const opened = Object.keys(this.save.openedCastles || {}).length;
      return Math.min(
        CASTLE_DELIVERY_GATE_START + CASTLE_DELIVERY_GATE_STEP * opened,
        CASTLE_DELIVERY_GATE,
      );
    }
    return 0;
  }

  // Wood this fort demands to unseal, following the per-fort progression
  // (see FORT_UNLOCK_WOOD_START): START + STEP×(forts already unsealed), capped
  // at FORT_UNLOCK_WOOD. A locked fort isn't yet in save.unlockedForts, so the
  // map's size is the 0-based index of the fort about to be paid for.
  _fortUnlockCost() {
    const unlocked = Object.keys(this.save.unlockedForts || {}).length;
    return Math.min(
      FORT_UNLOCK_WOOD_START + FORT_UNLOCK_WOOD_STEP * unlocked,
      FORT_UNLOCK_WOOD,
    );
  }

  // True iff `house` is a castle still sealed because the player hasn't logged
  // enough lifetime deliveries (save.deliveryCount). The delivery-gate analogue
  // of _isHouseWreck. The gate reads the global delivery tally, so — unlike the
  // old per-castle tribute — an id-less building is gated too; there's no
  // payment to record against a house key.
  _isBuildingSealed(house) {
    // Claimed outright — the player solved a quest at THIS castle, so it is
    // theirs for good and the quest board never comes back here.
    if (this.isCastleClaimed(house)) return false;
    const need = this._deliveryGate(house);
    if (!need) return false;
    // Players who passed the old delivery threshold keep access.
    if ((this.save.deliveryCount ?? 0) >= need) return false;
    // Quest chain replaces the delivery gate.
    if (typeof Quests !== 'undefined') return !Quests.allDone(this.save);
    return true;
  }

  // The sealed castle gate — now delegates to the quest board.
  presentSealedBuildingModal(sx, sy, house) {
    this.showQuestBoard(sx, sy, house);
  }

  // WHICH CASTLE this is. A castle emits no house object of its own — it is a
  // block of tier-12 cells with a scatter of `tower` objects round its rim,
  // one per ~5 perimeter cells, each carrying its own id. So a tower id names
  // A TURRET, not a castle, and anything recorded against one made the same
  // castle read as claimed from one corner and unclaimed from another.
  // worldgen stamps every turret with its footprint's stable key (`castle`);
  // that is the only thing that means "this castle".
  _castleKey(house) {
    return (house && house.castle) || null;
  }

  // IS THE BUILDING UNDER THIS CELL THE PLAYER'S? One predicate over every way
  // a building can become yours, keyed by whatever worldgen stamped on the
  // cell (see ownerKeys): a house by its own id, a fort by its own id, a
  // castle by its footprint key. Home counts however it was adopted — a real
  // house or the synthetic trailer.
  //
  // Everything else is somebody else's, and the renderer washes it toward
  // dark green so the map reads at a glance as what you have taken back.
  isClaimedKey(key) {
    if (!key) return false;
    const sv = this.save;
    if (sv.starterShopId && sv.starterShopId === key) return true;   // Home
    if (sv.restoredHouses && sv.restoredHouses[key]) return true;    // rebuilt wreck
    if (sv.unlockedForts && sv.unlockedForts[key]) return true;      // unsealed fort
    if (sv.claimedCastles && sv.claimedCastles[key] != null) return true;
    return false;
  }

  // Has the player solved a quest AT this castle? Claiming is per castle and
  // permanent: the vault opens, the banner goes up, and the quest board never
  // comes back here — the next job is somewhere else, which is what makes the
  // map worth walking.
  isCastleClaimed(house) {
    const key = this._castleKey(house);
    // PRESENCE, not truthiness: the value is the last hearth draw and a castle
    // claimed but never drawn from stores 0, which is falsy.
    return !!key && this.save.claimedCastles?.[key] != null;
  }

  // Record the claim. Stores the last hearth draw (0 = never drawn), so the
  // one map carries both "is it claimed" and "when did it last feed you".
  _claimCastle(house) {
    const key = this._castleKey(house);
    if (!key) return false;
    this.save.claimedCastles = this.save.claimedCastles || {};
    if (this.save.claimedCastles[key] != null) return false;
    this.save.claimedCastles[key] = 0;
    return true;
  }

  // The hearth: arriving at a castle you claimed gives back CASTLE_REST_FRAC of
  // the bar, at most once an hour per castle. Silent when the castle is on
  // cooldown or the bar is already full — a toast saying "nothing happened" is
  // worse than nothing happening.
  _castleHearth(sx, sy, house) {
    if (!this.isCastleClaimed(house)) return;
    const key = this._castleKey(house);
    const now = Date.now();
    const last = this.save.claimedCastles[key] || 0;
    if (last && now - last < CASTLE_REST_COOLDOWN_MS) return;
    const maxE = this.getMaxEnergy();
    const cur = this.save.energy ?? 0;
    if (cur >= maxE) return;                       // nothing to give back
    const gain = Math.max(1, Math.round(maxE * CASTLE_REST_FRAC));
    this.save.energy = Math.min(maxE, cur + gain);
    this.save.claimedCastles[key] = now;
    if (typeof persistSave === 'function') persistSave(this.save);
    this.buildInventoryDOM();
    this.flashLoot(`💚 +${Math.min(gain, maxE - cur)} energy`, '#a7ffb0');
  }

  // Quest board modal for castles. Shows the active quest's progress; when the
  // quest is complete the player can claim the reward — which also CLAIMS THIS
  // CASTLE: the one you solved it at, and no other. A claimed castle never
  // shows this board again (the seal check below lets it straight through to
  // its vault), so the next job is always somewhere you haven't been.
  showQuestBoard(sx, sy, house) {
    if (typeof Quests === 'undefined') return;
    const q = Quests.current(this.save);
    if (!q) { this.flash('Castle vault is now open!', sx, sy); return; }
    const prog = Quests.progress(this.save);
    const done = Quests.isComplete(this.save);
    let progressLine;
    switch (q.type) {
      case 'kill':  progressLine = `${prog} / ${q.count} defeated`; break;
      case 'poi':   progressLine = done ? 'Discovered!' : 'Explore the map to find it.'; break;
      case 'item':  progressLine = done ? 'Retrieved!' : `Need depth ≥ ${q.minDepth}`; break;
      default:      progressLine = '';
    }
    // A quest board is NOT a trade — there is nothing to pay — so it fills the
    // headline only and passes no cost. It used to hand the SAME string to both
    // `get` and `cost`, which printed the progress line ("3 / 10 defeated")
    // twice with a stray "for" wedged between the two copies, and on a finished
    // quest printed the reward figure twice the same way.
    this.showOfferModal({
      kind: 'quest',
      title: done ? 'Quest complete!' : q.title,
      get: done ? `Reward: $${q.reward?.money || 0}` : progressLine,
      blurb: q.body,
      canAfford: done,
      acceptLabel: done ? 'Claim Reward' : 'Locked',
      cancelLabel: 'Later',
      onAccept: () => {
        if (!done) return;
        const reward = Quests.advance(this.save);
        if (reward?.money) addMoney(this.save, reward.money);
        // THIS castle, and no other. The job was done for the people here, so
        // this is the vault that opens and the tower that raises a banner; the
        // next quest is somebody else's, at a castle the player hasn't been to.
        const claimed = this._claimCastle(house);
        persistSave(this.save);
        this.buildInventoryDOM();
        this.flashLoot(`🪙 +$${reward?.money || 0}`, '#ffe066');
        if (claimed) {
          this.flash('The castle is yours — its vault is open.',
            this.viewCenterX, this.viewCenterY - 60);
        }
      },
    });
  }

  // True iff `house` is a fort the player hasn't unsealed yet. Forts (tier 11)
  // open with a one-time wood payment (FORT_UNLOCK_WOOD), tracked per-fort in
  // save.unlockedForts — the wood analogue of _isHouseWreck for tier-9 homes.
  _isFortLocked(house) {
    if (!house || house.tier !== 11) return false;
    return !this.save.unlockedForts?.[house.id];
  }

  // Pay-to-unseal modal for a locked fort. Costs FORT_UNLOCK_WOOD wood, mirrors
  // the wreck-restore flow: shown even when unaffordable (so the player sees
  // the price), re-checks stock on accept, then records the unlock and plays
  // the same restoration fanfare.
  presentFortUnlockModal(sx, sy, house) {
    const need = this._fortUnlockCost();
    const heldCount = ((this.save.inv || []).find(s => s && s.id === 'wood')?.count) ?? 0;
    const canAfford = heldCount >= need;
    this.showOfferModal({
      kind: 'build',
      title: 'Unseal this fort?',
      cancelLabel: 'Later',
      get: '🛡️ the fort quartermaster',
      blurb: 'Shore up the gate and the garrison will trade relics with you.',
      cost: `${need}× ${this.iconSpanHTML('wood')} ${ITEM_BY_ID['wood']?.name || 'Wood'}`
        + (canAfford ? '' : ` <span style="opacity:.7">(have ${heldCount})</span>`),
      canAfford,
      acceptLabel: 'Unseal',
      onAccept: () => {
        // Re-check stock at accept time — the player might have spent the wood
        // elsewhere while the modal was open.
        const idx = this.save.inv.findIndex(s => s && s.id === 'wood' && (s.count ?? 0) >= need);
        if (idx < 0) { this.flash(`need ${need} wood`, sx, sy); return; }
        const stack = this.save.inv[idx];
        stack.count -= need;
        if ((stack.count ?? 0) <= 0) {
          this.save.inv.splice(idx, 1);
          if (this.save.selSlot >= this.save.inv.length) {
            this.save.selSlot = Math.max(0, this.save.inv.length - 1);
          }
        }
        this.save.unlockedForts = this.save.unlockedForts || {};
        this.save.unlockedForts[house.id] = true;
        persistSave(this.save);
        this.buildInventoryDOM();
        if (this.showChestRewardModal) {
          this.showChestRewardModal({
            kind: 'build',
            iconHTML: this.buildingImgHTML('fort', 72),
            header: 'Unsealed!',
            name: 'You unsealed a Fort',
            sub: 'The quartermaster trades relics — up to 5 deals an hour.',
            color: '#a7ffb0', accent: '#a7ffb0',
          });
        } else {
          this.flashLoot('🛡️ unsealed', '#a7ffb0', 1.25);
        }
      },
    });
  }

  presentBlacksmithOffer(sx, sy, offer, recordDeal, house, opts = {}) {
    // recipe override lets the starter blacksmith define T1 wooden recipes
    // (rockfruit + tree) without loosening the T2+ bar requirement in
    // blacksmithRecipe — keeps every other smithy on the original ladder.
    const recipe = opts.recipe || this.blacksmithRecipe(offer.kind, offer.slot, offer.tier);
    if (!recipe) {
      this.flash('"Anvil\'s resting, friend. Try again later."', sx, sy);
      return;
    }
    const name = gearName(offer.kind, offer.slot, offer.tier);
    const iconHtml = this.gearIconHTML(offer.kind, offer.slot, offer.tier, 20);
    const heldCount = (id) =>
      ((this.save.inv || []).find(s => s && s.id === id)?.count) ?? 0;
    const canAfford = () => recipe.every(r => heldCount(r.id) >= r.qty);
    const costHTML = recipe.map(r => {
      const itm = ITEM_BY_ID[r.id];
      return `${r.qty}× ${this.iconSpanHTML(r.id)} ${itm?.name || r.id}`;
    }).join(' + ');
    // Re-roll mirrors the relic-offer flow (shared via _makeRerollSecondary):
    // cost = 5 × 2^rerolls, bumps curState.rerolls so the next
    // peekOrBuildRelicOffer returns a different forge target. Suppressed for
    // the starter blacksmith — the wooden-tool queue is sequential, not
    // random, so there's nothing to re-roll into.
    const secondary = opts.noReroll ? undefined
      : this._makeRerollSecondary(house, sx, sy, 'nothing else to forge',
          next => this.presentBlacksmithOffer(sx, sy, next, recordDeal, house));
    // Forge / Smelt tab row — only on a normal smithy (not the starter
    // wooden-tool queue). Switching to Smelt re-presents this same forge
    // offer as the "back" target so the player can toggle freely.
    const tabs = (!opts.noReroll && this.smeltUnlockedBars().length)
      ? [
          { label: 'Forge', active: true,  onSelect: () => {} },
          { label: 'Smelt', active: false, onSelect: () =>
              this.presentSmeltOffer(sx, sy, house, recordDeal,
                () => this.presentBlacksmithOffer(sx, sy, offer, recordDeal, house, opts)) },
        ]
      : undefined;
    this.showOfferModal({
      kind: 'forge',
      title: this.buildingFlavorTitle(house, 'forge'),
      cancelLabel: 'Later',
      get: `${iconHtml} ${name}`,
      cost: costHTML,
      canAfford: canAfford(),
      acceptLabel: 'Forge',
      tabs,
      secondary,
      onAccept: () => {
        const curTier = offer.kind === 'relic'
          ? (this.save.relics?.[offer.slot]?.tier ?? 0)
          : (this.save.armor?.[offer.slot]?.tier ?? 0);
        if (offer.tier <= curTier) { this.flash('Already carry a finer one.', sx, sy); return; }
        if (!canAfford()) {
          const missing = recipe.find(r => heldCount(r.id) < r.qty);
          const itm = ITEM_BY_ID[missing.id];
          this.flash(`need ${missing.qty} ${itm?.name || missing.id}`, sx, sy);
          return;
        }
        // Consume every ingredient. Loop bottom-up so splicing is safe.
        for (const r of recipe) {
          let left = r.qty;
          for (let i = this.save.inv.length - 1; i >= 0 && left > 0; i--) {
            const s = this.save.inv[i];
            if (!s || s.id !== r.id) continue;
            const take = Math.min(left, s.count ?? 0);
            s.count -= take; left -= take;
            if ((s.count ?? 0) <= 0) {
              this.save.inv.splice(i, 1);
              if (this.save.selSlot >= this.save.inv.length) {
                this.save.selSlot = Math.max(0, this.save.inv.length - 1);
              }
            }
          }
        }
        this._equipGear(offer.kind, offer.slot, offer.tier);
        this.markRelicsDirty();
        recordDeal();
        // Forging "settles" the smithy — reset its re-roll count so the next
        // re-roll cost drops back to the $5 base (cost = 5 × 2^rerolls)
        // instead of staying inflated from pre-forge re-rolls.
        if (house && house.id) {
          const cur = this.shopBucketState(house);
          if (cur) cur.rerolls = 0;
        }
        persistSave(this.save);
        this.updateHUD();
        this.buildInventoryDOM();
        // Splash the forged tool's own art (not a coin) — gear uses
        // gearIconHTML, so render it into a throwaway span and hand the
        // sized element to flashLoot.
        const splashWrap = document.createElement('span');
        splashWrap.innerHTML = this.gearIconHTML(offer.kind, offer.slot, offer.tier, 28);
        this.flashLoot(name, '#ffe066', 1.25, null, splashWrap.firstElementChild);
      },
    });
  }

  // Build a shop offer for buying ${id} (baseValue = PRICES[id]). Always a
  // CASH price now — the old mixed "1/3 cash / 2/3 barter" roll was removed so
  // the two trade idioms map cleanly onto shop types: MARKETS (and every
  // generic cash storefront) want money, TRADERS barter (their own qty-scaled
  // path in presentTraderOffer). opts is accepted for call-site compatibility
  // (the former forceMoney flag) but no longer changes anything.
  buildShopOffer(id, baseValue, opts = {}) {
    // Pricing (incl. the Bow-discounted markup) lives in ShopsMath.buyPrice; the
    // offer object's afford/consume closures stay here (they bind this.save).
    // Seed the markup roll off the shop's hour bucket when we know which shop
    // is asking. buyPrice spans 1.2x-3.0x base, so on Math.random the player
    // could close and reopen the modal until the price came up cheap — the
    // markup is part of the offer, and the offer holds for the hour.
    const priceRng = (opts.house && opts.house.id)
      ? this.shopRng(opts.house, 'price')
      : undefined;
    // Flower charm halves the quoted price (floor $1) — see shopCharmMul.
    const cashCost = Math.max(1,
      Math.ceil(ShopsMath.buyPrice(this.save, baseValue, priceRng) * this.shopCharmMul(opts.house)));
    return {
      kind: 'money',
      label: `$${cashCost}`,
      shortGain: `−$${cashCost}`,
      shortDenial: `need $${cashCost}`,
      canAfford: () => (this.save.money ?? 0) >= cashCost,
      consume: () => { addMoney(this.save, -cashCost); },
    };
  }

  // Simple yes/no DOM modal. Dismissible. Renders over #game so it scales with the viewport.
  // Inline HTML <span> showing the same Crops.png / Spring Crops.png cell the
  // inventory bar uses. Returns '' if the item has no sprite (fall back to text).
  // Canonical icon renderer — single source of truth used by BOTH inventory
  // slots and modal cost text. Resolves an itemId to a styled <span>:
  //   1. ITEM_DATA_URLS cache  (longgrass / chicken / cow / flowers — map-sprite snapshots)
  //   2. inventoryIconSource() (Crops.png / Spring Crops.png lookup)
  //   3. fallback to the item.icon emoji
  // `style` ('inline' or 'block') controls vertical-align + display so the
  // same function works inside text (modal cost) and as a standalone tile
  // (inventory slot). Returns either an HTMLElement (style='block') or an
  // HTML string (style='inline') — the caller picks based on context.
  renderItemIcon(itemId, sizePx, style = 'inline') {
    const item = ITEM_BY_ID[itemId];
    // Shiny variants (shiny_chicken, …) have no sprite of their own — they
    // reuse the base animal's icon, recoloured with the warm filter applied
    // below. Fall back to `item.base` only when there's no dedicated bake.
    const hasOwnBake = !!(window.ITEM_DATA_URLS && window.ITEM_DATA_URLS[itemId]);
    const iconId = (item && item.base && !hasOwnBake) ? item.base : itemId;
    const dataUrl = window.ITEM_DATA_URLS && window.ITEM_DATA_URLS[iconId];
    const src = (typeof inventoryIconSource === 'function') ? inventoryIconSource(iconId) : null;
    const base = `width:${sizePx}px;height:${sizePx}px;image-rendering:pixelated;`
      + (style === 'inline' ? 'display:inline-block;vertical-align:middle;' : 'display:inline-block;');
    let css = null;
    // Network-fetched sheet URL backing this icon, if any — a data-URL bake
    // paints instantly, but a sheet PNG that isn't in the browser cache yet
    // leaves the span BLANK for however long the fetch takes (seconds on a
    // slow line — most visible as an empty hole in the treasure ceremony).
    // IconNet turns that hole into a pulsing placeholder plate; see below.
    let netUrl = null;
    if (dataUrl) {
      css = base + `background-image:url('${dataUrl}');background-size:${sizePx}px ${sizePx}px;`;
    } else if (src) {
      // Sheet table — ICON_SHEETS, module scope above the class: shared with
      // IconNet's prewarmer, and not rebuilt on every icon render.
      const sheet = ICON_SHEETS[src.sheet] || ICON_SHEETS.crops;
      const col = src.frame % sheet.cols;
      const row = Math.floor(src.frame / sheet.cols);
      const scale = sizePx / 16;
      css = base + `background-image:url('${sheet.url}');`
        + `background-size:${sheet.srcW * scale}px ${sheet.srcH * scale}px;`
        + `background-position:-${col * sizePx}px -${row * sizePx}px;`;
      if (!IconNet.ready(sheet.url)) netUrl = sheet.url;
    }
    // Shiny variants tint the base sprite warm-gold with a sheen.
    if (css && item && item.shiny) {
      css += 'filter:sepia(1) saturate(3.2) hue-rotate(-18deg) brightness(1.08)'
        + ` drop-shadow(0 0 ${Math.max(1, Math.round(sizePx * 0.06))}px #ffd23a);`;
    }
    if (style === 'block') {
      const el = document.createElement('span');
      if (css) {
        el.style.cssText = css;
        if (netUrl) {
          el.className = 'px-icon icon-loading';
          el.dataset.iconsrc = netUrl;
        }
      } else {
        // No sprite source resolved — show a neutral placeholder, never an
        // item-emoji (every catalogued item has a real sprite; a bare dot
        // here surfaces a missing icon source instead of masking it).
        el.textContent = '·';
        el.style.cssText = `display:inline-block;font-size:${Math.round(sizePx * 0.9)}px;line-height:${sizePx}px;`;
      }
      return el;
    }
    // Inline string form (used inside modal cost/get text).
    if (css) {
      return netUrl
        ? `<span class="px-icon icon-loading" data-iconsrc="${netUrl}" style="${css}"></span>`
        : `<span style="${css}"></span>`;
    }
    return '?';
  }

  iconSpanHTML(itemId, sizePx = 20) {
    return this.renderItemIcon(itemId, sizePx, 'inline');
  }

  // Every PNG a DOM modal can ask for outside the Phaser preloader: the
  // CSS-clip icon sheets (ICON_SHEETS) plus each gear slot's per-tier art.
  // Handed to IconNet.prewarm shortly after boot (see update()) so the
  // treasure / trade / forge modals open with their icons already cached.
  _prewarmModalIcons() {
    const urls = new Set();
    for (const s of Object.values(ICON_SHEETS)) urls.add(s.url);
    for (const kind of ['relic', 'armor']) {
      const defs = kind === 'relic' ? RELIC_DEFS : ARMOR_DEFS;
      for (const slot of Object.keys(defs)) {
        for (const tier of Object.keys(TIER_BY_NUM)) {
          const p = gearAssetPath(kind, slot, Number(tier));
          if (p) urls.add(p);
        }
      }
    }
    IconNet.prewarm([...urls]);
  }

  // Canonical relic / armor icon renderer — used by BOTH the Stats modal and
  // the Buy/Re-roll relic modal so they stay perfectly in sync.
  //
  // The gear PNGs are spritesheets, not single icons:
  //   weapons + armor (Pickaxe.png, Helmet.png, …): 32×16, two 16×16 frames
  //     side-by-side. We show frame 0.
  //   rings + amulets (Rings.png, Amulet.png):    96×64, 6 cols × 4 rows of
  //     16×16 variants. Pick a per-tier slot so each tier shows a different
  //     colour band as the player upgrades.
  // CSS-clip via background-image instead of an unclipped <img> — otherwise
  // the entire sheet gets crushed into the icon box ("ring looks like a
  // whole spritesheet", "armor shows 2 suits").
  // Row of obtained-relic icons, anchored top-right just below the
  // money/energy badges. Rebuilds only when the relics signature changes,
  // so calling from updateHUD every frame stays cheap.
  // Play a directional player animation on `sprite`. When dx/dy are supplied
  // (movement frame), updates this._spriteDir so the idle pose holds the last
  // walking direction. Avoids restarting the anim if the key is unchanged.
  // Swap the player between the human sheets and the red dragon while the
  // Dragon Powder is active. Sets _dragonActive so
  // _playDirected routes both sprites through the looping 'dragon-fly' anim,
  // and rescales the 96×96 dragon frames down to roughly the walker's size.
  _applyDragonSkin(on) {
    // Guard: if the dragon spritesheet failed to load (e.g. the asset 404s on
    // a deploy), 'dragon-fly' would be a frameless anim and play() would crash
    // on currentFrame.duration. Degrade to no visual transform — the flight
    // buff (free flight + 2× damage) still works off the _dragonUntil
    // timer, which is independent of the skin.
    const ready = on && this.textures.exists('dragon')
      && (this.anims.get('dragon-fly')?.frames?.length > 0);
    this._dragonActive = ready;
    for (const s of [this.player]) {
      if (!s) continue;
      if (ready) {
        s.setScale(this.dragonScale);
        if (s.anims.currentAnim?.key !== 'dragon-fly') s.play('dragon-fly');
      } else {
        s.setScale(this.playerScale);
        s.setFlipX(false);
        if (s.anims.currentAnim?.key !== 'idle-down') s.play('idle-down');   // _playDirected re-picks the directional anim next frame
      }
    }
    // A flying dragon isn't standing on the cell, so its shadow shrinks and
    // fades — the standard "it left the ground" read. Restored on landing.
    if (this.playerShadow) {
      this.playerShadow
        .setDisplaySize(ready ? 13 : 17, ready ? 5 : 6)
        .setAlpha(ready ? 0.20 : 0.34);
    }
  }
  _playDirected(sprite, baseKey, dx, dy) {
    if (dx !== undefined) {
      const d = Math.hypot(dx, dy);
      if (d > 0.001) this._spriteDir = { x: dx / d, y: dy / d };
    }
    const { x, y } = this._spriteDir;
    // Dragon transform: the player flies as a single-direction dragon.
    // Keep the flap looping and just mirror by heading (art faces
    // right at rest), ignoring the human walk/idle directional sheets.
    if (this._dragonActive && sprite === this.player) {
      if (sprite.anims.currentAnim?.key !== 'dragon-fly') sprite.play('dragon-fly');
      if (Math.abs(x) > 0.001) sprite.setFlipX(x < 0);
      return;
    }
    let dir = 'down', flip = false;
    if (Math.abs(x) > Math.abs(y)) { dir = 'side'; flip = x < 0; }
    else if (y < 0) dir = 'up';
    const key = `${baseKey}-${dir}`;
    if (sprite.anims.currentAnim?.key !== key) sprite.play(key);
    sprite.setFlipX(flip);
  }
  // Watch #game for modal dialogs and mirror their presence onto a
  // body.modal-open class. CSS uses it to hide the movement pads while any
  // dialog is up — the pads are fixed on <body> above #game's transform
  // stacking context, so without this they'd cover an open modal and steal the
  // taps meant to close it (the "taps stop working after opening a crate" bug).
  // Observing #game's direct children is enough: makeModalShell appends every
  // wrap there, and pads created mid-dialog are caught by the CSS rule itself.
  _installModalPadGate() {
    if (typeof MutationObserver === 'undefined') return;
    const gameEl = document.getElementById('game');
    // The four hand-written overlays in index.html (#story / #safety /
    // #locating / #howto) carry .game-modal too, but unlike makeModalShell's
    // wraps they are always IN the document and toggle display — so presence
    // alone can't gate anything, or the HUD would hide forever. Test that the
    // element actually renders: getClientRects() is empty under display:none
    // and non-empty for a visible fixed-position overlay (offsetParent is null
    // for those, so it can't be used here).
    const shown = (el) => el.getClientRects().length > 0;
    const sync = () => {
      const any = [...document.querySelectorAll('.game-modal')].some(shown);
      document.body.classList.toggle('modal-open', any);
      // Nothing covering the screen — so anything the starter ladder is
      // holding can be said now. See _celebrateStarterStep: cheers always
      // queue and this is the only thing that plays them, which is why the
      // test is "no modal" rather than "a modal just closed". At the instant a
      // step completes the answer is not yet knowable: the chest handler
      // credits the step one line BEFORE it opens the reward modal, so at that
      // point no modal exists and none of this class's state has been updated
      // for the one that is about to. One frame later it has.
      if (!any) this._flushStarterCheers();
    };
    this._modalPadObserver = new MutationObserver(sync);
    // makeModalShell appends its wrap as a direct child of #game…
    if (gameEl) this._modalPadObserver.observe(gameEl, { childList: true });
    // …and the static overlays just flip their own style, so watch that.
    for (const id of ['story', 'safety', 'locating', 'howto', 'tooshort']) {
      const el = document.getElementById(id);
      if (el) this._modalPadObserver.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
    }
    // The observer alone is not enough: an overlay that is REMOVED from the
    // document (the story and safety cards are, rather than hidden) fires no
    // mutation any of the above watches, so the class latched on and the whole
    // HUD stayed hidden. The per-frame call in update() is the backstop — a
    // querySelectorAll over a handful of .game-modal nodes.
    this._syncModalGate = sync;
    sync();
  }
  // The movement stick is ALWAYS on screen — it's how you walk anywhere the
  // GPS isn't taking you, with or without an amulet, buff, or debug flag.
  // Nothing takes its slot any more. Idempotent, so it's safe to call from the
  // per-frame relic sync, which is what puts it up on the first frame.
  syncMovePad() {
    if (!document.getElementById('move-pad')) this.buildMovePad();
  }
  removeMovePad() {
    document.getElementById('move-pad')?.remove();
    this.joystickVec = { x: 0, y: 0 };
    this._movePadHeld = false;
  }
  // Virtual analog stick — bottom-right above the inventory bar. Fixed to the
  // viewport (outside #game for the usual transform-containing-block reason).
  // Pointer events drive this.joystickVec ∈ [-1, 1]² and _movePadHeld;
  // update() reads both to walk the player off the GPS while held.
  buildMovePad() {
    this.removeMovePad();
    const PAD = 110, NUB = 48;
    const HALF = (PAD - NUB) / 2;     // nub centred in the pad at rest
    const R = HALF;                   // max nub offset from pad centre
    this._installMovePadCss(PAD, NUB, HALF);
    const pad = document.createElement('div');
    pad.id = 'move-pad';
    const nub = document.createElement('div');
    nub.className = 'nub';
    pad.appendChild(nub);
    document.body.appendChild(pad);

    let activePtr = null;
    const reset = () => {
      activePtr = null;
      // Dropping .held re-arms the nub's transform transition (see the CSS
      // note), so clearing the offset here is what plays the spring-back.
      pad.classList.remove('held');
      nub.style.transform = '';
      this.joystickVec = { x: 0, y: 0 };
      this._movePadHeld = false;
    };
    const place = (e) => {
      const rect = pad.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top  + rect.height / 2;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const m = Math.hypot(dx, dy);
      if (m > R) { dx = dx / m * R; dy = dy / m * R; }
      nub.style.transform = `translate(${dx}px, ${dy}px)`;
      this.joystickVec = { x: dx / R, y: dy / R };
    };
    pad.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      activePtr = e.pointerId;
      pad.setPointerCapture(e.pointerId);
      pad.classList.add('held');
      this._movePadHeld = true;
      place(e);
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== activePtr) return;
      e.stopPropagation();
      place(e);
    });
    const release = (e) => {
      if (e.pointerId !== activePtr) return;
      e.stopPropagation();
      reset();
    };
    pad.addEventListener('pointerup', release);
    pad.addEventListener('pointercancel', release);
    pad.addEventListener('lostpointercapture', reset);
  }
  // The stick's looks live in one injected sheet rather than inline styles:
  // the recessed well, the domed cap and the spring-back all need states and
  // pseudo-elements that a style attribute can't express. Geometry still comes
  // from buildMovePad's constants, so the CSS and the pointer maths can't drift.
  //
  // The shape it's going for: a well sunk into the HUD (dark centre, inner
  // shadow, a lit lower rim) with a brass cap sitting proud of it (top-lit
  // dome, its own drop shadow). The stick is GOLD because gold is the
  // interaction colour — it is the single most-touched control in the game,
  // so it wears the affordance hue at full strength (it used to be purple,
  // which said nothing about being touchable). The dark keyline and blur keep
  // it legible over a bright map.
  _installMovePadCss(PAD, NUB, HALF) {
    if (document.getElementById('move-pad-css')) return;
    const s = document.createElement('style');
    s.id = 'move-pad-css';
    s.textContent = `
      #move-pad {
        position: fixed;
        /* Placed by fitGame, which measures what is actually left between the
           map's bottom edge and the inventory tabs: centred in that gap when
           the stick fits there, tucked just above the tabs (overlaying the
           map's bottom corner) when it doesn't. The 160px fallback is the old
           fixed offset, used only if the variable is somehow unset. */
        bottom: calc(var(--stick-bottom, 160px) + env(safe-area-inset-bottom, 0px));
        /* Right-anchored via --phone-right so the pad tucks inside the
           simulated phone column on desktop. */
        right: calc(var(--phone-right, 0px) + 16px);
        width: ${PAD}px; height: ${PAD}px; border-radius: 50%;
        z-index: 6; touch-action: none;
        user-select: none; -webkit-user-select: none;
        background:
          radial-gradient(circle at 50% 38%,
            rgba(138,116,64,0.30) 0%,
            rgba(66,52,22,0.48) 58%,
            rgba(28,22,12,0.62) 100%);
        border: 2px solid rgba(200,166,74,0.78);   /* --gold-dark / UI_CONTROL_DIM */
        box-shadow:
          inset 0 3px 12px rgba(0,0,0,0.58),
          inset 0 -2px 6px rgba(255,224,102,0.16),
          0 4px 14px rgba(0,0,0,0.48),
          0 0 0 1px rgba(0,0,0,0.42);
        -webkit-backdrop-filter: blur(3px) saturate(1.15);
        backdrop-filter: blur(3px) saturate(1.15);
        transition: border-color 140ms ease, box-shadow 140ms ease;
      }
      /* Four ticks just inside the rim — N/E/S/W, so the well reads as a
         direction control at a glance instead of a plain circle. */
      #move-pad::before {
        content: ''; position: absolute; inset: 0; border-radius: 50%;
        pointer-events: none; opacity: 0.5;
        background:
          linear-gradient(rgba(255,243,176,1), rgba(255,243,176,1)) 50% 7px / 2px 7px no-repeat,
          linear-gradient(rgba(255,243,176,1), rgba(255,243,176,1)) 50% calc(100% - 7px) / 2px 7px no-repeat,
          linear-gradient(rgba(255,243,176,1), rgba(255,243,176,1)) 7px 50% / 7px 2px no-repeat,
          linear-gradient(rgba(255,243,176,1), rgba(255,243,176,1)) calc(100% - 7px) 50% / 7px 2px no-repeat;
        transition: opacity 140ms ease;
      }
      #move-pad .nub {
        position: absolute; left: ${HALF}px; top: ${HALF}px;
        width: ${NUB}px; height: ${NUB}px; border-radius: 50%;
        pointer-events: none;
        background:
          radial-gradient(circle at 38% 30%,
            rgba(255,247,203,0.97) 0%,
            rgba(255,214,92,0.94) 38%,
            rgba(168,128,40,0.96) 100%);
        border: 2px solid rgba(255,232,150,0.9);
        box-shadow:
          inset 0 -3px 7px rgba(96,72,18,0.55),
          inset 0 2px 4px rgba(255,255,255,0.5),
          0 3px 8px rgba(0,0,0,0.45);
        /* Only the RELEASED nub animates. While .held is on, transform is
           excluded from the transition list so the cap tracks the finger
           1:1; dropping the class on release re-arms it, so clearing the
           inline transform plays as a spring back to centre. */
        transition: transform 170ms cubic-bezier(.22,1,.36,1),
                    box-shadow 140ms ease, border-color 140ms ease;
      }
      /* Held: the well lights up and the cap lifts, so a finger already
         covering the nub still gets feedback from the ring around it. */
      #move-pad.held {
        border-color: rgba(255,224,102,0.95);
        box-shadow:
          inset 0 3px 12px rgba(0,0,0,0.5),
          inset 0 -2px 6px rgba(255,224,102,0.24),
          0 4px 16px rgba(0,0,0,0.45),
          0 0 14px rgba(255,210,58,0.5),
          0 0 0 1px rgba(0,0,0,0.42);
      }
      #move-pad.held::before { opacity: 0.75; }
      #move-pad.held .nub {
        transition: box-shadow 140ms ease, border-color 140ms ease;
        border-color: #fff8d6;
        box-shadow:
          inset 0 -3px 7px rgba(96,72,18,0.5),
          inset 0 2px 4px rgba(255,255,255,0.55),
          0 3px 10px rgba(0,0,0,0.5),
          0 0 12px rgba(255,224,102,0.6);
      }
      /* The spring-back is decoration — the nub is already back at centre as
         far as movement is concerned the moment the finger leaves. */
      @media (prefers-reduced-motion: reduce) {
        #move-pad, #move-pad::before, #move-pad .nub { transition: none; }
      }
    `;
    document.head.appendChild(s);
  }
  // Dev tool (☰ › Developer): call a pack of wild slimes to the edge of the
  // screen. They spawn as ORDINARY surface slimes — same kind, same HP table,
  // same wander/leech/combat behaviour — pushed into the covering tile's
  // creature list, so everything downstream (render, the sim loops, the
  // combat tick) picks them up with no special path. The pack arrives
  // clustered on one random side, just inside the view edge, and oozes in
  // from there (slimes drift toward the player), which is what makes it a
  // usable combat test: the fight starts a moment later, not on your feet.
  // Returns how many actually landed (a spot with no walkable ground — open
  // water, a cave wall — re-rolls a few times, then gives up on that slime).
  debugSpawnSlimePack(n = 6) {
    const px = this.startWorldM.x + this.playerM.x;
    const py = this.startWorldM.y + this.playerM.y;
    // Just inside the view edge: visible the moment they land (so the
    // auto-fire gate sees them too), but a full screen-half from the player.
    const edgeM = (VIEW_CELLS / 2 - 0.5) * this.cellM;
    const heading = Math.random() * Math.PI * 2;   // the side the pack comes from
    let placed = 0;
    for (let i = 0; i < n; i++) {
      // Fan the pack ±~45° around the heading, one slot per slime, with a
      // little jitter so it reads as a mob rather than a picket line. A spot
      // a slime can't stand on re-rolls its jitter, then gives up.
      const slot = (n > 1 ? i / (n - 1) - 0.5 : 0) * 1.6;
      for (let attempt = 0; attempt < 8; attempt++) {
        const a = heading + slot + (Math.random() - 0.5) * 0.35;
        const r = edgeM - Math.random() * this.cellM;
        const x = px + Math.cos(a) * r;
        const y = py + Math.sin(a) * r;
        const entry = this._devSlimeGroundAt(x, y);
        if (!entry) continue;
        entry.creatures = entry.creatures || [];
        this._devSlimeSeq = (this._devSlimeSeq || 0) + 1;
        // Unique per press — never a tile-data id, so a dev slime can't mark
        // a real spawn as caught when it dies.
        entry.creatures.push({
          x, y, kind: 'slime', shiny: false,
          id: `slime_dev_${Date.now()}_${this._devSlimeSeq}`,
        });
        placed++;
        break;
      }
    }
    this.flash?.(placed ? `🟢 ${placed} slimes closing in!` : 'No ground for slimes here',
      this.viewCenterX, this.viewCenterY - 40);
    return placed;
  }
  // The cached tile entry covering a world-metre spot, but only if a slime
  // can stand there — walkable terrain on a loaded tile (surface or the
  // current cave level; the tile cache already reflects the active depth).
  _devSlimeGroundAt(wmx, wmy) {
    const tx = Math.floor(wmx / this.tileEdgeM), ty = Math.floor(wmy / this.tileEdgeM);
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
    if (!entry || !entry.grid) return null;
    const N = this.cellsPerTile;
    const ix = Math.floor((wmx - tx * this.tileEdgeM) / this.cellM);
    const iy = Math.floor((wmy - ty * this.tileEdgeM) / this.cellM);
    if (ix < 0 || iy < 0 || ix >= N || iy >= N) return null;
    if (!WorldGen.isWalkable(entry.grid[iy * N + ix])) return null;
    return entry;
  }
  // Bump _relicsGen at every site that writes save.relics / save.armor so the
  // per-frame row rebuild can early-out by comparing a counter instead of
  // recomputing a join-string of every slot every frame.
  markRelicsDirty() { this._relicsGen = (this._relicsGen || 0) + 1; }
  // Relics/armor used to render as a read-only icon strip at the top-right.
  // That strip is gone: equipped gear now lives in the Relics / Armor tabs of
  // the two-bar inventory HUD (buildInventoryDOM). This method survives because
  // it's the per-frame hook that keeps the movement stick / debug pad on screen
  // — guarded by a generation counter so it only does work
  // when gear actually changed (markRelicsDirty bumps the counter).
  updateRelicRow() {
    const gen = this._relicsGen || 0;
    if (this._relicRowGen === gen) return;
    this._relicRowGen = gen;
    // The stick doesn't depend on gear any more, but syncing here (idempotent)
    // is what puts it on screen on the first frame.
    this.syncMovePad();
    // Drop the legacy top strip if an older build left one in the DOM.
    document.getElementById('relic-row')?.remove();
    // If a gear tab is currently showing, rebuild the inventory bars so a newly
    // bought/forged/looted relic or armor piece appears immediately.
    const cat = INV_CAT_BY_KEY[this.save.invCat];
    if (cat && cat.gear && typeof this.buildInventoryDOM === 'function') {
      this.buildInventoryDOM();
    }
  }
  gearIconHTML(kind, slot, tier, sizePx = 20) {
    const path = gearAssetPath(kind, slot, tier);
    if (!path) return '';
    // Each gear asset has its own sprite-sheet layout. Pick [cols, rows] + the
    // frame to show so we never squish a multi-frame strip into one cell or
    // crop a single-frame icon:
    //   ring/amulet — 6×4 variant grid, frame = tier-1
    //   bags        — 7×1 strip (one bag per tier), frame = tier-1
    //   bug net     — single 16×16 icon
    //   everything else (tools/armor) — 32×16 two-frame sheet, show frame 0
    let sheetCols, sheetRows, frame;
    if (kind === 'relic' && (slot === 'ring' || slot === 'amulet')) {
      sheetCols = 6; sheetRows = 4; frame = tier - 1;
    } else if (kind === 'relic' && slot === 'bags') {
      sheetCols = 7; sheetRows = 1; frame = tier - 1;
    } else if (kind === 'relic' && slot === 'bugnet') {
      sheetCols = 1; sheetRows = 1; frame = 0;
    } else {
      sheetCols = 2; sheetRows = 1; frame = 0;
    }
    const col = frame % sheetCols;
    const row = Math.floor(frame / sheetCols) % sheetRows;
    const bgW = sheetCols * sizePx, bgH = sheetRows * sizePx;
    // Gear PNGs load only when a modal first shows them — never through the
    // Phaser preloader — so on a cold cache the icon is blank for the whole
    // fetch. IconNet holds the footprint with a pulsing plate until it lands.
    const net = IconNet.ready(path) ? '' : ` class="px-icon icon-loading" data-iconsrc="${path}"`;
    return `<span${net} style="display:inline-block;vertical-align:middle;`
      + `width:${sizePx}px;height:${sizePx}px;image-rendering:pixelated;`
      + `background-image:url('${path}');background-size:${bgW}px ${bgH}px;`
      + `background-position:-${col * sizePx}px -${row * sizePx}px;"></span>`;
  }

  // Canonical "trade with the shopkeep" modal. Used by every shop path —
  // sell, buy, relic, blacksmith forge — so the chrome (stone-tablet panel,
  // Cancel/accept layout, dismiss-on-overlay-click) stays in one place.
  //   title:        small caption ("A trader offers:")
  //   get:          HTML for the headline (gear icon + name, item ×1, +$5)
  //   blurb:        OPTIONAL HTML, smaller text below `get` (e.g. relic effect)
  //   cost:         HTML for the price line ("$30", "1× icon Item", "5× gem")
  //   canAfford:    grey out the accept button when false
  //   onAccept:     called after the modal closes
  //   acceptLabel:  primary button label ('Buy' default; 'Sell' / 'Trade'…)
  //   cancelLabel:  dismiss button label. Defaults to 'Cancel'; pass 'Later'
  //                 for offers tied to a persistent venue (a shop, a wreck,
  //                 a sealed building) the player can simply come back to —
  //                 "Later" reads as "still on the table" rather than "gone".
  //   secondary:    OPTIONAL { label: HTML, disabled: bool, onClick: fn }
  //                 — rendered between Cancel and accept (re-roll button).
  showOfferModal({ title, get, blurb, cost, canAfford, onAccept, acceptLabel = 'Buy', cancelLabel = 'Cancel', secondary, quantity, tabs, forLabel = 'for', kind, kindLabel }) {
    const { wrap, box, mount, mkBtn } = this.makeModalShell('offer-modal',
      { maxWidth: 340, onClose: () => {}, kind, kindLabel });
    // Optional tab row (e.g. the blacksmith's Forge / Smelt switch). Each tab
    // is { label, active, onSelect }. Tapping an inactive tab closes this modal
    // and calls onSelect, which re-presents the sibling modal — cheap "tabs"
    // without restructuring the single-offer modal into a stateful panel.
    if (tabs && tabs.length) {
      const tabRow = document.createElement('div');
      tabRow.style.cssText = 'display:flex;gap:4px;justify-content:center;margin-bottom:8px;';
      for (const t of tabs) {
        const tb = document.createElement('button');
        tb.textContent = t.label;
        tb.style.cssText =
          'flex:1;padding:6px 4px;border-radius:6px 6px 0 0;font:700 12px ui-monospace,monospace;'
          + 'border:2px solid #555;border-bottom:none;cursor:pointer;'
          + (t.active
              ? 'background:#3a3322;color:#ffe066;border-color:#c8a64a;'
              : 'background:transparent;color:#999;');
        if (!t.active) {
          tb.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); t.onSelect(); });
        }
        tabRow.appendChild(tb);
      }
      box.appendChild(tabRow);
    }
    // Build the chrome out of individual nodes so the quantity stepper (when
    // present) can live-update the get/cost lines without re-rendering the
    // whole modal — tap − / + and the headline price + cost-line stack count
    // refresh in place.
    const titleDiv = document.createElement('div');
    titleDiv.style.cssText = 'opacity:.75;font-size:11px;margin-bottom:6px';
    titleDiv.textContent = title;
    box.appendChild(titleDiv);
    const getDiv = document.createElement('div');
    getDiv.style.cssText = 'font-size:16px;font-weight:700;margin:4px 0;color:#ffe066';
    getDiv.innerHTML = get;
    box.appendChild(getDiv);
    if (blurb) {
      const blurbDiv = document.createElement('div');
      blurbDiv.style.cssText = 'font-size:11px;opacity:.75;margin-bottom:6px';
      blurbDiv.innerHTML = blurb;
      box.appendChild(blurbDiv);
    }
    // `cost` is what the player PAYS — the second half of a "you get X FOR y"
    // trade, and the `forLabel` row is the literal word joining the two. Not
    // every caller is a trade: the quest board reports progress and asks for
    // nothing. Those get neither row, rather than a dangling "for" over an
    // empty line — or, as the quest board did, the same sentence printed twice
    // because both halves were handed the same string.
    const hasCost = cost != null && cost !== '';
    let costDiv = null;
    if (hasCost) {
      const forDiv = document.createElement('div');
      forDiv.style.cssText = 'opacity:.85;margin:6px 0 4px';
      forDiv.textContent = forLabel;
      box.appendChild(forDiv);
      costDiv = document.createElement('div');
      costDiv.style.cssText = 'font-size:16px;font-weight:700;margin:4px 0 10px;';
      costDiv.style.color = canAfford ? '#a7ffb0' : '#ff8a7a';
      costDiv.innerHTML = cost;
      box.appendChild(costDiv);
    }
    // Quantity stepper (only when caller passes `quantity`). Lays out as
    // [ − ]  N / MAX  [ + ] just above the action-button row.
    let qty = 1;
    let liveCanAfford = canAfford;
    let stepperRefresh = null;
    if (quantity) {
      const minQ = quantity.min ?? 1;
      const maxQ = Math.max(minQ, quantity.max ?? 1);
      qty = Math.max(minQ, Math.min(maxQ, quantity.initial ?? minQ));
      const stepRow = document.createElement('div');
      stepRow.style.cssText =
        'display:flex;gap:10px;justify-content:center;align-items:center;margin:2px 0 10px;';
      const mkStep = (label) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText =
          'width:44px;height:44px;border-radius:6px;font:700 20px ui-monospace,monospace;cursor:pointer;' +
          'background:transparent;color:#ddd;border:2px solid #555;line-height:1;';
        return b;
      };
      const minusBtn = mkStep('−');
      const plusBtn  = mkStep('+');
      const countSpan = document.createElement('span');
      countSpan.style.cssText =
        'min-width:72px;text-align:center;font:700 14px ui-monospace,monospace;color:#fff';
      stepRow.appendChild(minusBtn);
      stepRow.appendChild(countSpan);
      stepRow.appendChild(plusBtn);
      box.appendChild(stepRow);
      stepperRefresh = () => {
        countSpan.textContent = `${qty} / ${maxQ}`;
        if (typeof quantity.format === 'function') {
          const r = quantity.format(qty) || {};
          if (r.get  != null) getDiv.innerHTML  = r.get;
          if (r.cost != null && costDiv) costDiv.innerHTML = r.cost;
          if (r.canAfford != null) {
            liveCanAfford = !!r.canAfford;
            if (costDiv) costDiv.style.color = liveCanAfford ? '#a7ffb0' : '#ff8a7a';
          }
        }
        const dim = (b, off) => {
          b.disabled = off;
          b.style.opacity = off ? '0.4' : '1';
          b.style.cursor  = off ? 'not-allowed' : 'pointer';
        };
        dim(minusBtn, qty <= minQ);
        dim(plusBtn,  qty >= maxQ);
        // Keep the primary action button in sync with the live canAfford.
        if (accept) {
          accept.disabled = !liveCanAfford;
          accept.style.opacity = liveCanAfford ? '1' : '0.4';
          accept.style.cursor  = liveCanAfford ? 'pointer' : 'not-allowed';
        }
      };
      minusBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (qty > minQ) { qty--; stepperRefresh(); }
      });
      plusBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (qty < maxQ) { qty++; stepperRefresh(); }
      });
    }
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;justify-content:center;margin-top:4px;flex-wrap:wrap;';
    const cancel = mkBtn(cancelLabel, false, false);
    const sec    = secondary ? mkBtn(secondary.label, false, !!secondary.disabled) : null;
    const accept = mkBtn(acceptLabel, true, !canAfford);
    cancel.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); });
    accept.addEventListener('click', (e) => {
      e.stopPropagation(); wrap.remove();
      onAccept(quantity ? qty : undefined);
    });
    if (sec) sec.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); secondary.onClick(); });
    row.appendChild(cancel);
    if (sec) row.appendChild(sec);
    row.appendChild(accept);
    box.appendChild(row);
    // First paint of stepper-driven state (also syncs accept-button disabled
    // colours with the format() canAfford if the caller computes it).
    if (stepperRefresh) stepperRefresh();
    mount();
  }

  // Big "ceremony" modal for chest opens — chest loot earns a stop-everything
  // celebration (the player walked over and tapped a chest; they want to
  // SEE what they got). Tap anywhere to dismiss. Quick-feedback pickups
  // (X-marks, harvests, mining drops) keep using flashLoot — only chests
  // route through this.
  //
  //   iconHTML      string → HTML for the icon (renderItemIcon('inline')
  //                          for items, gearIconHTML for relics, or a
  //                          standalone emoji span for gold).
  //   name          string → big bold label (e.g. "Egg", "Wood Pickaxe").
  //   sub           string? → smaller line under the name (e.g. "× 3"
  //                          for stacks, or a relic-equipped tagline).
  //   color         string? → tier / semantic colour for the NAME + qty lines
  //                          (rarity tier, coin gold, …). Defaults to the
  //                          treasure blue-white.
  //   accent        string? → the modal's CHROME colour: frame, sparkle burst,
  //                          primary button. Defaults to UI_TREASURE, because
  //                          this modal is the treasure ceremony (spec
  //                          §UI COLOUR LANGUAGE: blue-white = treasure &
  //                          powerups). The few NON-treasure ceremonies that
  //                          reuse this shell (passing out, restoring a wreck)
  //                          pass their own accent so they don't read as loot.
  //   onDismiss     fn?    → called after the modal closes.
  //   actions       array? → [{ label, primary?, onClick }]. When present the
  //                          modal becomes a CHOICE (explicit buttons, no
  //                          tap-to-dismiss) instead of a tap-to-continue
  //                          acknowledgement — used for the bag-full chest open.
  // `header` is the legacy per-reward line ('MILL LANE complete', 'Restored!').
  // It now feeds the shared kind header as a LABEL OVERRIDE — the dialog keeps
  // its outcome wording and gains the kind's hero icon — so this modal shows
  // one header, not two. Callers that say nothing get TREASURE, which is what
  // a chest is.
  showChestRewardModal({ iconHTML, name, sub, qty, color = UI_TREASURE, accent = UI_TREASURE,
    onDismiss, header, kind = 'treasure', actions }) {
    const { wrap, box, mount } = this.makeModalShell('chest-reward-modal', {
      zIndex: 55, minWidth: 220, maxWidth: 300, borderColor: accent, wrapBg: '#000c',
      kind, kindLabel: header,
      wrapExtra: 'animation:chestModalIn 180ms ease-out;',
      boxExtra: `border-width:3px;border-radius:14px;padding:22px 22px 14px;font-size:14px;` +
        `animation:chestRewardPop 320ms cubic-bezier(.34,1.56,.64,1);`,
    });
    // Keyframes injected once. The sparkle keyframe reads its drift vector
    // from per-element CSS custom properties (--dx/--dy) so a single shared
    // rule animates N sparkles each along its own randomised direction. The
    // translate(-50%,-50%) prefix keeps each sparkle centred on its
    // perimeter anchor while drifting outward.
    if (!document.getElementById('chest-modal-css')) {
      const s = document.createElement('style');
      s.id = 'chest-modal-css';
      s.textContent =
        '@keyframes chestModalIn { from { opacity:0 } to { opacity:1 } }' +
        '@keyframes chestRewardPop { 0% { transform:scale(.6); opacity:0 } ' +
        '60% { transform:scale(1.08); opacity:1 } 100% { transform:scale(1); opacity:1 } }' +
        '@keyframes chestSparkle {' +
        ' 0%   { transform: translate(-50%, -50%) scale(0);   opacity: 0 }' +
        ' 18%  { transform: translate(calc(-50% + var(--dx) * 0.18), calc(-50% + var(--dy) * 0.18)) scale(1.15); opacity: 1 }' +
        ' 100% { transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(0.35); opacity: 0 }' +
        '}';
      document.head.appendChild(s);
    }
    // `qty` (e.g. "× 5") renders as a bold, full-size, coloured line so the
    // amount the player just received reads at a glance. `sub` stays the
    // quiet descriptive line ("equipped", "already owned", flavour text).
    const qtyHtml = qty
      ? `<div style="margin-top:6px;font-size:22px;font-weight:700;color:${color};line-height:1.1">${qty}</div>`
      : '';
    const subHtml = sub
      ? `<div style="margin-top:4px;font-size:13px;opacity:.85">${sub}</div>`
      : '';
    const hasActions = Array.isArray(actions) && actions.length > 0;
    box.innerHTML =
      `<div style="margin:6px 0 10px;font-size:0">${iconHTML}</div>` +
      `<div style="font-size:18px;font-weight:700;color:${color};line-height:1.2">${name}</div>` +
      qtyHtml +
      subHtml +
      (hasActions ? '' : '<div style="margin-top:14px;opacity:.45;font-size:10px;letter-spacing:.06em">tap to continue</div>');
    const close = () => {
      wrap.remove();
      if (typeof onDismiss === 'function') onDismiss();
    };
    if (hasActions) {
      // Choice variant: explicit buttons, and NO tap-to-dismiss — the player
      // must pick an action so the chest is never left half-resolved. Overlay
      // clicks are inert (no close listener on wrap).
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;justify-content:center;margin-top:16px;flex-wrap:wrap;';
      for (const a of actions) {
        const b = document.createElement('button');
        b.innerHTML = a.label;
        b.style.cssText =
          'padding:9px 14px;border-radius:7px;font:700 12px ui-monospace,monospace;cursor:pointer;' +
          (a.primary
            ? `background:${accent};color:#1a1612;border:0;`
            : 'background:transparent;color:#ddd;border:2px solid #555;');
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          wrap.remove();
          if (typeof a.onClick === 'function') a.onClick();
          if (typeof onDismiss === 'function') onDismiss();
        });
        row.appendChild(b);
      }
      box.appendChild(row);
    } else {
      // Dismiss on any tap — overlay or box, doesn't matter (this is a "tap
      // to acknowledge" not a "choose action" modal). stopPropagation on the
      // box would otherwise let the player click-through it.
      wrap.addEventListener('click', (e) => { e.stopPropagation(); close(); }, true);
    }
    mount();
    // Sparkle burst around the modal — drives the "fanfare" feel. Spawned
    // AFTER the wrap is in the DOM so getBoundingClientRect() gives us the
    // box's real on-screen footprint (it's flex-centred, so the rect depends
    // on viewport size). Each sparkle is parented to wrap and animates from
    // a randomised point on the box perimeter outward along its --dx/--dy
    // vector. Tier colour bleeds into the glow so chests/etc each
    // sparkle in their own hue.
    requestAnimationFrame(() => {
      const wr = wrap.getBoundingClientRect();
      const br = box.getBoundingClientRect();
      // Coords RELATIVE to wrap (which is the absolute-positioned overlay).
      const bx = br.left - wr.left, by = br.top - wr.top;
      const bw = br.width, bh = br.height;
      const SPARKLE_COUNT = 14;
      for (let i = 0; i < SPARKLE_COUNT; i++) {
        // Pick a point on the box perimeter (parametrise the rectangle by
        // its perimeter length so corners aren't oversampled).
        const t = Math.random() * 2 * (bw + bh);
        let px, py;
        if (t < bw)                        { px = bx + t;            py = by; }
        else if (t < bw + bh)              { px = bx + bw;           py = by + (t - bw); }
        else if (t < 2 * bw + bh)          { px = bx + bw - (t - bw - bh); py = by + bh; }
        else                                { px = bx;                py = by + bh - (t - 2 * bw - bh); }
        // Drift outward from the box centre — vector from centre through the
        // perimeter point, scaled to 40..90 px.
        const cx = bx + bw / 2, cy = by + bh / 2;
        let vx = px - cx, vy = py - cy;
        const vlen = Math.hypot(vx, vy) || 1;
        const drift = 40 + Math.random() * 50;
        const dx = (vx / vlen) * drift;
        const dy = (vy / vlen) * drift;
        const sp = document.createElement('div');
        const size = 8 + Math.floor(Math.random() * 6);   // 8..13 px
        const delay = Math.random() * 220;                // 0..220 ms stagger
        sp.style.cssText =
          `position:absolute;left:${px}px;top:${py}px;` +
          `width:${size}px;height:${size}px;pointer-events:none;` +
          `--dx:${dx.toFixed(1)}px;--dy:${dy.toFixed(1)}px;` +
          // Radial gradient = soft glow; the central white core sits on a
          // tier-coloured halo that fades to transparent. Layered with a thin
          // 4-point star (drawn via conic-gradient masking is overkill —
          // simpler to fake the star highlight with a tighter inner gradient).
          `background:` +
            `radial-gradient(circle at 50% 50%, #ffffff 0%, #ffffff 18%, ` +
            `${accent} 40%, ${accent}88 65%, transparent 100%);` +
          `border-radius:50%;` +
          `box-shadow:0 0 6px 1px ${accent}cc, 0 0 12px 2px ${accent}55;` +
          `transform:translate(-50%,-50%) scale(0);opacity:0;` +
          `animation:chestSparkle 1100ms ease-out ${delay.toFixed(0)}ms forwards;`;
        wrap.appendChild(sp);
      }
    });
  }

  // How many more of `id` would fit right now (0 = full for that item).
  // Thin wrapper over Inventory.roomFor — the stack/cap math lives in
  // inventory.js (headlessly tested). Used by the chest open to detect overflow
  // BEFORE committing ("leave it for later" instead of silently dropping loot).
  invRoomFor(id) {
    return Inventory.roomFor(this.save, id);
  }

  // Add up to `n` of `id` to inventory. The stack/cap/dedupe/autoselect rules
  // live in Inventory.add (inventory.js); this wrapper owns only the scene side
  // effects: persist + rebuild the inventory DOM, and the deferred 'bag full'
  // flash. Returns the count actually accepted so callers can adjust narration.
  addToInv(id, n = 1, silent = false) {
    const r = Inventory.add(this.save, id, n, { autoselect: !silent, pageSize: 5 });
    if (!r.valid) return 0;                      // not a real item / n<=0: no-op, no persist/DOM
    if (!silent) {
      // A brand-new stack surfaces on its own type tab. Switch the active tab
      // and page so the freshly-obtained item is visible (Inventory.add already
      // pointed selSlot at the new stack). Topping up an existing stack leaves
      // the tab/selection alone so harvest→replant loops aren't disrupted.
      if (r.isNewStack && r.accepted > 0) {
        this.save.invCat = this.invCatForItem(id);
        const pos = this.invEntriesForCat(this.save.invCat).findIndex(e => e.idx === this.save.selSlot);
        this.save.invPage = pos >= 0 ? Math.floor(pos / 5) : 0;
      }
      persistSave(this.save);
      this.buildInventoryDOM();
      if (r.accepted > 0 && typeof Quests !== 'undefined') {
        const qDone = Quests.onItemAcquired(this.save, id, this.depth);
        if (qDone) {
          persistSave(this.save);
          this.flash('Quest done! Return to the castle.', this.viewCenterX, this.viewCenterY - 60);
        }
      }
    }
    // Flash whenever anything was rejected — that's the player attempting to
    // exceed the cap. Deferred via setTimeout so it can't race a flashLoot the
    // caller fires right after addToInv (back-to-back add.text in the same
    // synchronous chain exhausts Phaser's text-canvas pool under the harness).
    // Coalesced so a bulk drop fires once.
    if (r.rejected > 0 && !silent && typeof this.flash === 'function' && this.add) {
      if (!this._bagFullPending) {
        this._bagFullPending = true;
        setTimeout(() => {
          this._bagFullPending = false;
          try {
            this.flash('bag full', this.viewCenterX, this.viewCenterY - 28);
          } catch (_) {}
        }, 0);
      }
    }
    return r.accepted;
  }
  // --- Two-bar inventory helpers ------------------------------------------
  // Which type tab an item id belongs to (by its `kind`). Falls back to the
  // Produce tab for anything unmapped so a stray item is still reachable.
  invCatForItem(id) {
    const kind = ITEM_BY_ID[id]?.kind;
    for (const c of INV_CATS) if (c.kinds && c.kinds.includes(kind)) return c.key;
    return 'produce';
  }
  // Filtered, index-tagged stacks for an item category. Each element is
  // { idx, entry } where idx is the real position in save.inv (so selection +
  // every downstream save.inv[selSlot] reader keep working unchanged). Gear
  // categories return [] — they synthesize their list in gearEntriesForCat.
  invEntriesForCat(catKey) {
    const cat = INV_CAT_BY_KEY[catKey];
    if (!cat || !cat.kinds) return [];
    const out = [];
    (this.save.inv || []).forEach((entry, idx) => {
      if (!entry) return;
      const kind = ITEM_BY_ID[entry.id]?.kind;
      if (cat.kinds.includes(kind)) out.push({ idx, entry });
    });
    return out;
  }
  // Owned relic/armor slots for a gear category, in draw order. One per slot —
  // these are equipped gear (save.relics / save.armor), not save.inv stacks.
  gearEntriesForCat(catKey) {
    const cat = INV_CAT_BY_KEY[catKey];
    if (!cat || !cat.gear) return [];
    if (cat.gear === 'relic') {
      const r = this.save.relics || {};
      return INV_RELIC_ORDER.filter(s => r[s]).map(s => ({ kind: 'relic', slot: s, tier: r[s].tier }));
    }
    const a = this.save.armor || {};
    return INV_ARMOR_ORDER.filter(s => a[s]).map(s => ({ kind: 'armor', slot: s, tier: a[s].tier }));
  }
  // Switch the active type tab and re-anchor the selection to that tab's first
  // entry (or empty). Used by the tab buttons.
  // Land the inventory on a tab that has something in it — ONCE, at boot.
  //
  // save.invCat defaults to 'seed' and otherwise persists whatever tab was
  // last open. Either can point somewhere empty on the screen the player
  // arrives at: a fresh save opens on Seeds with nothing in it, and a
  // returning one opens on the tab it was left on, which may have been emptied
  // since. Both read as "my bag is broken" on the one screen that has no
  // history to explain it.
  //
  // Deliberately boot-only, NOT part of buildInventoryDOM: mid-session an open
  // empty tab is a CHOICE (the player tapped it, or just spent the last of a
  // stack and wants to see that), and re-homing under them there would be the
  // UI arguing with the tap they just made. At boot there is no such choice to
  // respect. addToInv already handles the other direction — a new stack pulls
  // its own tab forward.
  _settleInvCatOnBoot() {
    const has = (c) => (c.gear ? this.gearEntriesForCat(c.key) : this.invEntriesForCat(c.key)).length > 0;
    const cur = INV_CAT_BY_KEY[this.save.invCat];
    if (cur && has(cur)) return;               // already showing something
    const stocked = INV_CATS.find(has);
    if (stocked) this.selectInvCat(stocked.key);   // persists + reconciles selection
  }

  selectInvCat(catKey) {
    if (!INV_CAT_BY_KEY[catKey]) return;
    this.save.invCat = catKey;
    this.save.invPage = 0;
    const cat = INV_CAT_BY_KEY[catKey];
    if (cat.gear) {
      this.save.selSlot = -1;
      const list = this.gearEntriesForCat(catKey);
      this.save.selGear = list[0] ? { kind: list[0].kind, slot: list[0].slot } : null;
    } else {
      this.save.selGear = null;
      const list = this.invEntriesForCat(catKey);
      this.save.selSlot = list[0] ? list[0].idx : -1;
    }
    persistSave(this.save);
    this.buildInventoryDOM();
  }

  buildInventoryDOM() {
    const PAGE = 5;
    if (!INV_CAT_BY_KEY[this.save.invCat]) this.save.invCat = 'seed';
    if (this.save.invPage == null) this.save.invPage = 0;
    const cat = INV_CAT_BY_KEY[this.save.invCat];
    const isGear = !!cat.gear;
    const gearList = isGear ? this.gearEntriesForCat(cat.key) : null;
    const itemList = isGear ? null : this.invEntriesForCat(cat.key);

    // Reconcile the selection so the highlight always points at something IN
    // the active tab (or "empty"). This also self-heals after an item is
    // consumed: the action handlers clamp selSlot to a raw save.inv index that
    // may belong to another category, so we re-anchor it here. We deliberately
    // do NOT move invPage to the selection — paging is driven by ◀ ▶ / tab
    // switches / pickups, not by every rebuild.
    if (isGear) {
      this.save.selSlot = -1;
      const owned = this.save.selGear &&
        gearList.some(g => g.kind === this.save.selGear.kind && g.slot === this.save.selGear.slot);
      if (!owned) this.save.selGear = gearList[0] ? { kind: gearList[0].kind, slot: gearList[0].slot } : null;
    } else {
      this.save.selGear = null;
      const inCat = this.save.selSlot >= 0 && itemList.some(e => e.idx === this.save.selSlot);
      if (!inCat) this.save.selSlot = itemList[0] ? itemList[0].idx : -1;
    }

    // Cell count: gear tabs are exactly their owned entries; item tabs keep one
    // trailing EMPTY slot so the player can select "nothing" → buy intent at a
    // shop. One blank page is always reachable beyond a full one.
    const cellCount = isGear ? gearList.length : itemList.length + 1;
    const pageCount = Math.max(1, Math.ceil(Math.max(1, cellCount) / PAGE));
    if (this.save.invPage >= pageCount) this.save.invPage = pageCount - 1;
    if (this.save.invPage < 0) this.save.invPage = 0;

    // ── Type-selector bar (TOP of the two-bar HUD) ────────────────────────
    let tabs = document.getElementById('inv-tabs');
    if (tabs) tabs.remove();
    tabs = document.createElement('div');
    tabs.id = 'inv-tabs';
    // position:fixed + appended to <body> for the same containing-block reason
    // as the item bar below. Sits just above the item bar.
    tabs.style.cssText = 'position:fixed;bottom:calc(118px + env(safe-area-inset-bottom, 0px));left:var(--phone-left, 0px);right:var(--phone-right, 0px);display:flex;justify-content:center;align-items:stretch;gap:2px;padding:0 6px;z-index:6;pointer-events:auto;';
    for (const c of INV_CATS) {
      const active = c.key === this.save.invCat;
      const count = c.gear ? this.gearEntriesForCat(c.key).length : this.invEntriesForCat(c.key).length;
      const tab = document.createElement('button');
      tab.dataset.cat = c.key;
      tab.title = c.label;
      // Layout inline, paint from .hud-tab / .hud-tab.sel (index.html).
      tab.className = active ? 'hud-tab sel' : 'hud-tab';
      tab.style.cssText =
        'position:relative;flex:1 1 0;min-width:0;height:44px;border-radius:7px 7px 0 0;cursor:pointer;' +
        'font-size:16px;line-height:1;display:flex;flex-direction:column;align-items:center;' +
        'justify-content:center;gap:1px;padding:0;overflow:hidden;';
      // Glyph in its own span so the desaturation targets ONLY the emoji — the
      // count pip below keeps its full colour. The active tab shows its glyph in
      // full colour; inactive tabs render greyscale + dimmed so the lit-up tab
      // reads as the current category at a glance.
      const glyph = document.createElement('span');
      glyph.textContent = c.sym;
      glyph.style.cssText = 'line-height:1;' + (active ? '' : 'filter:grayscale(1) opacity(0.55);');
      tab.appendChild(glyph);
      // Word under the glyph. Seven unlabelled emoji left a new player guessing
      // which one holds seeds — and the seed tab is the first thing the starter
      // ladder asks them to find. `title` alone doesn't help on a touch device,
      // where there is nothing to hover.
      const caption = document.createElement('span');
      caption.textContent = c.label;
      caption.style.cssText =
        'font:700 7px ui-monospace,monospace;letter-spacing:-0.2px;line-height:1;' +
        'max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
        (active ? 'color:#ffe066;' : 'color:#999;');
      tab.appendChild(caption);
      // An EMPTY tab reads as empty: without this a fresh save's Relics and
      // Armor tabs looked identical to stocked ones bar a missing pip (UX audit
      // §20). The active tab always stays full strength — you're looking at it.
      if (!count && !active) tab.style.opacity = '0.45';
      // Tiny count pip so the player can see at a glance which tabs hold gear.
      if (count > 0) {
        const pip = document.createElement('span');
        pip.textContent = count;
        pip.className = 'hud-pip';
        pip.style.cssText = 'position:absolute;top:-2px;right:1px;font:700 9px ui-monospace,monospace;padding:0 3px;border-radius:7px;line-height:13px;';
        tab.appendChild(pip);
      }
      tab.addEventListener('click', (e) => { e.stopPropagation(); this.selectInvCat(c.key); });
      tabs.appendChild(tab);
    }
    document.body.appendChild(tabs);

    // ── Item / gear slot bar (BOTTOM of the two-bar HUD) ──────────────────
    let bar = document.getElementById('inv');
    if (bar) bar.remove();
    bar = document.createElement('div');
    bar.id = 'inv';
    // The bar is the OPEN DRAWER under the tab row: painted --tab-brown, the
    // same colour the selected tab fades into (index.html .hud-tab.sel), so
    // the active tab and the panel below it read as one surface.
    bar.style.cssText = 'position:fixed;bottom:calc(66px + env(safe-area-inset-bottom, 0px));left:var(--phone-left, 0px);right:var(--phone-right, 0px);display:flex;justify-content:center;align-items:center;gap:3px;padding:4px;z-index:6;pointer-events:auto;background:var(--tab-brown, #4a3a17);';

    // 40×44, not 28×42: this is a one-handed outdoor game and the pager sat
    // well under the 44px guideline (QC/UX audit §13).
    const makeBtn = (txt, onclick, w = 40) => {
      const b = document.createElement('button');
      b.textContent = txt;
      b.className = 'hud-btn';
      b.style.cssText = `width:${w}px;height:44px;border-radius:6px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;`;
      b.addEventListener('click', (e) => { e.stopPropagation(); onclick(); });
      return b;
    };

    // Sort (item tabs only) — group by kind then alphabetical by name. Selection
    // is re-anchored to the same item id so the highlight follows the resort.
    const KIND_ORDER = { produce: 0, seed: 1, animal: 2 };
    if (!isGear) {
      bar.appendChild(makeBtn('⇅', () => {
        const selId = this.save.inv[this.save.selSlot]?.id;
        this.save.inv = [...this.save.inv].sort((a, b) => {
          const ia = ITEM_BY_ID[a.id], ib = ITEM_BY_ID[b.id];
          const ka = KIND_ORDER[ia?.kind] ?? 9, kb = KIND_ORDER[ib?.kind] ?? 9;
          if (ka !== kb) return ka - kb;
          return (ia?.name || a.id).localeCompare(ib?.name || b.id);
        });
        if (selId != null) {
          const newIdx = this.save.inv.findIndex(e => e.id === selId);
          if (newIdx >= 0) {
            this.save.selSlot = newIdx;
            const pos = this.invEntriesForCat(this.save.invCat).findIndex(e => e.idx === newIdx);
            if (pos >= 0) this.save.invPage = Math.floor(pos / PAGE);
          }
        }
        persistSave(this.save); this.buildInventoryDOM();
      }));
    }
    // ◀ ▶ and the page plate only exist when the category actually spans more
    // than one page. Most do not, and three dead controls on a bar that is
    // already wider than the 352px column (5×42 slots + 3×40 buttons + the
    // plate) cost both space and attention for nothing.
    const paged = pageCount > 1;
    if (paged) {
      bar.appendChild(makeBtn('◀', () => {
        this.save.invPage = (this.save.invPage - 1 + pageCount) % pageCount;
        persistSave(this.save); this.buildInventoryDOM();
      }));
    }

    const slotCss = 'position:relative;width:42px;height:42px;flex:0 0 42px;border-radius:6px;font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;';
    const startPos = this.save.invPage * PAGE;
    for (let s = 0; s < PAGE; s++) {
      const p = startPos + s;
      const slot = document.createElement('button');
      slot.className = 'hud-slot';
      slot.style.cssText = slotCss;
      if (isGear) {
        const g = gearList[p];
        if (g) {
          slot.dataset.gear = `${g.kind}:${g.slot}`;
          slot.title = (typeof gearName === 'function') ? gearName(g.kind, g.slot, g.tier) : g.slot;
          const wrap = document.createElement('span');
          wrap.style.cssText = 'display:inline-block;line-height:0;';
          wrap.innerHTML = this.gearIconHTML(g.kind, g.slot, g.tier, 32);
          slot.appendChild(wrap);
          // Tier badge mirrors the item count badge so gear reads consistently.
          const badge = document.createElement('span');
          badge.textContent = 'T' + g.tier;
          badge.className = 'hud-badge';
          badge.style.cssText = 'position:absolute;bottom:1px;right:2px;font-size:10px;padding:0 3px;border-radius:3px;line-height:12px;';
          slot.appendChild(badge);
          // "E" (Equipped/active) badge — only the weapon currently doing the
          // auto-engage/auto-fire (save.activeWeapon) wears it, opposite corner
          // from the tier badge so the two never collide.
          const isWeapon = g.kind === 'relic' && WEAPON_SLOTS.includes(g.slot);
          if (isWeapon && this.save.activeWeapon === g.slot) {
            const eBadge = document.createElement('span');
            eBadge.textContent = 'E';
            eBadge.title = 'Active weapon';
            eBadge.className = 'hud-badge';
            eBadge.style.cssText = 'position:absolute;top:1px;left:2px;font-size:10px;padding:0 3px;border-radius:3px;line-height:12px;background:#ffe066;color:#3a3322;';
            slot.appendChild(eBadge);
          }
          slot.addEventListener('click', (e) => {
            e.stopPropagation();
            this.save.selGear = { kind: g.kind, slot: g.slot };
            this.save.selSlot = -1;
            // Tapping a weapon makes it the active one — the other owned
            // weapons go inert (see combat.js / _combatTick).
            if (isWeapon && this.save.activeWeapon !== g.slot) {
              this.save.activeWeapon = g.slot;
              this.markRelicsDirty();
              persistSave(this.save);
              this.buildInventoryDOM();
              return;
            }
            persistSave(this.save);
            this.refreshInventoryHighlight();
          });
        } else {
          // Empty gear well — no glyph. '·' is reserved for MISSING ART
          // (QC_RULES §1); using it here made five empty slots read as five
          // broken icons on a fresh save.
          slot.textContent = '';
          slot.style.cursor = 'default';
        }
      } else if (p < itemList.length) {
        const { idx, entry } = itemList[p];
        const item = ITEM_BY_ID[entry.id];
        slot.dataset.slot = idx;
        slot.title = item ? `${item.name}${entry.count != null ? ' ×' + entry.count : ''}` : 'empty';
        if (item) slot.appendChild(this.renderItemIcon(item.id, 32, 'block'));
        else slot.textContent = '·';
        if (entry.count != null) {
          const badge = document.createElement('span');
          badge.textContent = entry.count;
          badge.className = 'hud-badge';
          badge.style.cssText = 'position:absolute;bottom:1px;right:2px;font-size:10px;padding:0 3px;border-radius:3px;line-height:12px;';
          slot.appendChild(badge);
        }
        slot.addEventListener('click', (e) => {
          e.stopPropagation();
          this.save.selSlot = idx;
          persistSave(this.save);
          this.refreshInventoryHighlight();
        });
      } else if (p === itemList.length) {
        // The single trailing EMPTY slot — selecting it means "nothing held",
        // which a shop reads as buy intent. dataset.slot = -1.
        slot.dataset.slot = -1;
        slot.title = 'empty';
        slot.textContent = '';
        slot.addEventListener('click', (e) => {
          e.stopPropagation();
          this.save.selSlot = -1;
          persistSave(this.save);
          this.refreshInventoryHighlight();
        });
      } else {
        // Filler beyond the list — inert, and blank for the same reason.
        slot.textContent = '';
        slot.style.cursor = 'default';
      }
      bar.appendChild(slot);
    }
    if (paged) {
      bar.appendChild(makeBtn('▶', () => {
        this.save.invPage = (this.save.invPage + 1) % pageCount;
        persistSave(this.save); this.buildInventoryDOM();
      }));
      const pageLbl = document.createElement('span');
      pageLbl.textContent = `${this.save.invPage + 1}/${pageCount}`;
      pageLbl.className = 'hud-page';
      pageLbl.style.cssText = 'min-width:28px;height:22px;padding:0 6px;display:inline-flex;align-items:center;justify-content:center;border:1px solid #4a4238;border-radius:11px;font:700 11px ui-monospace,monospace;margin-left:4px;';
      bar.appendChild(pageLbl);
    }

    document.body.appendChild(bar);

    // Name plate — shows the selected item / gear name + effect line. Its own
    // struck box (.hud-name, index.html), stacked with NO gap between the
    // slot bar above (bottom:66) and the Eat/Read/Drink button below
    // (bottom:4..40) — same touching-edges convention as the tabs sitting
    // directly on the slot bar. Giving it a fixed box (instead of bare
    // floating text) is what stops the name/effect line from running under
    // the icons above or getting covered by the action button below.
    let nameLbl = document.getElementById('inv-name');
    if (nameLbl) nameLbl.remove();
    nameLbl = document.createElement('div');
    nameLbl.id = 'inv-name';
    nameLbl.className = 'hud-name';
    nameLbl.style.cssText = 'position:fixed;bottom:calc(40px + env(safe-area-inset-bottom, 0px));left:calc(var(--phone-left, 0px) + 6px);right:calc(var(--phone-right, 0px) + 6px);height:26px;border-radius:6px;box-sizing:border-box;padding:0 8px;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;text-align:center;font:12px/14px ui-monospace,monospace;pointer-events:none;z-index:6;text-shadow:1px 1px 2px #000,0 0 3px #000;';
    document.body.appendChild(nameLbl);

    this.refreshInventoryHighlight();
  }
  refreshInventoryHighlight() {
    const bar = document.getElementById('inv');
    if (!bar) return;
    const cat = INV_CAT_BY_KEY[this.save.invCat] || INV_CAT_BY_KEY.seed;
    const isGear = !!cat.gear;
    const gearKey = this.save.selGear ? `${this.save.selGear.kind}:${this.save.selGear.slot}` : null;
    [...bar.querySelectorAll('button[data-slot],button[data-gear]')].forEach(el => {
      let isSel;
      if (el.dataset.gear != null) isSel = el.dataset.gear === gearKey;
      else isSel = +el.dataset.slot === this.save.selSlot;
      // .sel carries the whole selected look (gold rim + glow, lit well) —
      // see .hud-slot in index.html. Inline paint here would outrank it.
      el.classList.toggle('sel', isSel);
    });
    const nameLbl = document.getElementById('inv-name');
    if (nameLbl) {
      nameLbl.textContent = '';
      if (isGear) {
        const g = this.save.selGear;
        if (!g) {
          // Empty gear tab — tell the player where this gear comes from.
          const hint = document.createElement('div');
          hint.textContent = cat.key === 'armor'
            ? 'No armor yet — forge or find it'
            : 'No relics yet — forge or find them';
          hint.style.cssText = 'opacity:0.7;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
          nameLbl.appendChild(hint);
        } else {
          const nameSpan = document.createElement('div');
          nameSpan.textContent = (typeof gearName === 'function') ? gearName(g.kind, g.slot, this.save[g.kind === 'armor' ? 'armor' : 'relics']?.[g.slot]?.tier) : g.slot;
          nameSpan.style.cssText = 'max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
          nameLbl.appendChild(nameSpan);
          const def = (g.kind === 'relic' && typeof RELIC_DEFS !== 'undefined') ? RELIC_DEFS[g.slot] : null;
          if (def && def.blurb) {
            const fx = document.createElement('div');
            fx.textContent = `✦ ${def.blurb}`;
            fx.style.cssText = 'font:10px/12px ui-monospace,monospace;color:#9fe6ff;opacity:0.92;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
            nameLbl.appendChild(fx);
          }
        }
      } else {
        const sel = this.save.inv[this.save.selSlot];
        const it = sel && ITEM_BY_ID[sel.id];
        if (it) {
          const nameTxt = sel.count != null ? `${it.name} ×${sel.count}` : it.name;
          const effect = (typeof ITEM_EFFECTS !== 'undefined') ? ITEM_EFFECTS[sel.id] : null;
          const nameSpan = document.createElement('div');
          nameSpan.textContent = nameTxt;
          nameSpan.style.cssText = 'max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
          nameLbl.appendChild(nameSpan);
          if (effect) {
            const fx = document.createElement('div');
            fx.textContent = `✦ ${effect}`;
            fx.style.cssText = 'font:10px/12px ui-monospace,monospace;color:#9fe6ff;opacity:0.92;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
            nameLbl.appendChild(fx);
          }
        }
      }
    }
    this.syncEatButton();
    this.syncConsumableButton();
  }

  // Eat button — appears bottom-right when the selected stack is food.
  // Tapping the player sprite to eat works too (interact.js 'eat' handler),
  // but on a small screen the body is fiddly to hit; this surfaces an
  // explicit affordance below the inventory bar.
  syncEatButton() {
    const sel = this.save.inv?.[this.save.selSlot];
    const restore = (sel && typeof FOOD_ENERGY !== 'undefined') ? FOOD_ENERGY[sel.id] : null;
    const existing = document.getElementById('eat-btn');
    if (restore == null) { existing?.remove(); return; }
    const iconHtml = this.iconSpanHTML(sel.id, 20);
    const label = `${iconHtml} Eat +${restore}⚡`;
    if (existing) { existing.innerHTML = label; return; }
    const btn = document.createElement('button');
    btn.id = 'eat-btn';
    // Bottom-right, BELOW the inventory bar (the bar bottom sits at
    // safe-area + 48px, so a button at safe-area + 4px sits in the gap
    // underneath). Right-anchored to --phone-right so the button tucks
    // inside the simulated phone column on desktop.
    btn.className = 'hud-action';
    btn.style.cssText =
      'position:fixed;' +
      'bottom:calc(4px + env(safe-area-inset-bottom, 0px));' +
      'right:calc(var(--phone-right, 0px) + 8px);z-index:7;' +
      'display:flex;align-items:center;gap:6px;' +
      'padding:6px 10px;border-radius:8px;cursor:pointer;' +
      'color:#a7ffb0;border:2px solid #4a8c4a;' +
      'font:700 12px ui-monospace,monospace;';
    btn.innerHTML = label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.eatSelected();
      this.syncEatButton();   // refresh count / hide if stack ran out
    });
    document.body.appendChild(btn);
  }

  // Book / Flute Read / Play button. Mirror of syncEatButton — sits next
  // to the Eat button (or in the same spot when food isn't selected). This
  // is THE way to use a self-targeted consumable: the old tap-your-own-feet
  // gesture (interact.js 'use-consumable') was removed because it was easy
  // to trigger accidentally while tilling / planting under the player.
  syncConsumableButton() {
    const sel = this.save.inv?.[this.save.selSlot];
    const existing = document.getElementById('consumable-btn');
    const CONSUMABLE = {
      book:  { verb: 'Read', method: 'readBook',  title: 'Read the book?',  get: '📖 a tip from the elders' },
      flute: { verb: 'Play', method: 'playFlute', title: 'Play the flute?', get: '🪈 lure nearby creatures' },
      reach_potion:  { verb: 'Drink', method: 'drinkReachPotion',  title: 'Drink the Potion of Reach?',     get: '✨ full-screen reach for 1 min' },
      vigor_potion:  { verb: 'Drink', method: 'drinkVigorPotion',  title: 'Drink the Potion of Vigor?',     get: 'restore 40 energy' },
      speed_potion:  { verb: 'Drink', method: 'drinkSpeedPotion',  title: 'Drink the Potion of Speed?',     get: 'tier-9 amulet walking for 1 min' },
      shield_potion: { verb: 'Drink', method: 'drinkShieldPotion', title: 'Drink the Potion of Shielding?', get: 'half monster damage for 1 min' },
      dragon_powder: { verb: 'Use', method: 'useDragonPowder', title: 'Use the Dragon Powder?',       get: '🐉 become a dragon for 1 min — tier-8 amulet legs + 2× damage' },
      sapphire: { verb: 'Portal', method: 'useSapphirePortal', title: 'Open a portal down?', get: '💎 descend one level' },
    };
    const cfg = sel && CONSUMABLE[sel.id];
    if (!cfg || (sel.count ?? 0) <= 0) { existing?.remove(); return; }
    const iconHtml = this.iconSpanHTML(sel.id, 20);
    const label = `${iconHtml} ${cfg.verb}`;
    if (existing) { existing.innerHTML = label; existing.dataset.id = sel.id; return; }
    const btn = document.createElement('button');
    btn.id = 'consumable-btn';
    btn.dataset.id = sel.id;
    // Sit to the LEFT of the Eat button (Eat lives at right:8). Since the
    // two are mutually-exclusive in normal play (Eat = food selected,
    // consumable = book/flute selected) we use the same right slot. CSS
    // identical except border colour (warm tan to distinguish from
    // Eat's green).
    btn.className = 'hud-action';
    btn.style.cssText =
      'position:fixed;' +
      'bottom:calc(4px + env(safe-area-inset-bottom, 0px));' +
      'right:calc(var(--phone-right, 0px) + 8px);z-index:7;' +
      'display:flex;align-items:center;gap:6px;' +
      'padding:6px 10px;border-radius:8px;cursor:pointer;' +
      'color:#ffe066;border:2px solid #c8a64a;' +
      'font:700 12px ui-monospace,monospace;';
    btn.innerHTML = label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const entry = CONSUMABLE[id];
      const fn = entry?.method;
      if (!fn || typeof this[fn] !== 'function') return;
      // Mirror the interact.js use-consumable flow: confirmation modal,
      // accept consumes 1 and triggers the action.
      const item = ITEM_BY_ID[id];
      this.showOfferModal({
        kind: 'use',
        title: entry.title,
        get: entry.get,
        cost: `1× ${this.iconSpanHTML(id)} ${item?.name || id}`,
        canAfford: true,
        acceptLabel: entry.verb,
        onAccept: () => { this[fn](); this.syncConsumableButton(); },
      });
    });
    document.body.appendChild(btn);
  }
}

const game = window.__game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: W, height: H,
  backgroundColor: '#000',
  pixelArt: true,
  scene: [MapScene],
  scale: { mode: Phaser.Scale.NONE },
  // Phaser's loader defaults to maxParallelDownloads: 32. ASSETS in
  // assets.js already exceeds that, and the queue-pump fails to move the
  // remaining files into inflight after the first 32 finish — the scene
  // stalls in LOADING forever, leaving the game frozen on a black canvas
  // (and the test harness timing out on "scene never booted"). Bump the
  // cap above the asset count so every file fits in one batch; nothing in
  // this project is big enough to make parallel downloads a network
  // concern.
  loader: { maxParallelDownloads: 128 },
  // No audio in this game — disable both backends so Phaser uses the
  // NoAudioSoundManager and never creates an AudioContext. Without this the
  // browser logs a "failed to start the audio device" warning on iOS/Android
  // because Web Audio can't start before the first user gesture.
  audio: { noAudio: true, disableWebAudio: true },
  // Phaser defaults to ONE touch pointer (pointers[1]; pointers[0] is the
  // mouse). With a single slot, holding the movement stick — a plain DOM
  // element whose touches still bubble to Phaser's window listeners —
  // occupies the only pointer, so a world tap with the other thumb is
  // silently dropped. Worse, a touchend that never reaches Phaser (see the
  // stuck-pointer sweeper in create()) strands that one pointer `active`
  // forever and ALL canvas taps die until reload. Three slots covers
  // stick + tap + one stray finger.
  input: { activePointers: 3 },
});
