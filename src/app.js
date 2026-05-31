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
const START_LON = _teleportOverride ? _teleportOverride.lon : HOME_LON;
const START_LAT = _teleportOverride ? _teleportOverride.lat : HOME_LAT;
// Expose the preset table + active override so index.html can build the menu.
if (typeof window !== 'undefined') {
  window.TELEPORT_PRESETS = TELEPORT_PRESETS;
  window.TELEPORT_ACTIVE = _teleportOverride;
}
// Meters per degree of latitude (≈ constant everywhere). Longitude meters
// additionally scale by cos(latitude). Used by the GPS watcher and the
// debug-HUD lat/lon recompute.
const METERS_PER_DEG_LAT = 111320;
const VIEW_CELLS = 11;
const CELL_PX = 32;
const WALK_M_S = 1.4;
const W = 352, H = 844;   // 352 = VIEW_CELLS × CELL_PX → map view fills the canvas edge-to-edge with no horizontal padding

// --- Debug ---
// WASD and arrow keys move the player at DEBUG_SPEED_MUL × walk speed when DEBUG is true.
const DEBUG = true;
const DEBUG_SPEED_MUL = 10;

// --- Tap reach radii (metres). Used by handleWorldTap distance checks. ---
const REACH_CREATURE_M  = 4;
const REACH_WILDPLANT_M = 4;
const REACH_OBJECT_M    = 3.5; // chest / tree
const REACH_HOUSE_M     = 6;   // house body is larger than 3.5m
// Outer "too far" gate. Matches the visual reach outline drawn by drawCells
// (scene.REACH_CELL_M). Distance is measured from the player's CELL CENTRE
// (not their feet) — same basis as the visual — so any cell shown inside the
// reach outline is tappable, regardless of where in the cell the player stands.
// 16m = √(5² + 15²) + ε, just enough to include (±1, ±3) and (±3, ±1) so the
// reach silhouette is a rounded square rather than a strict 3-cell diamond.
const REACH_FAR_M       = 16;
const REACH_TREASURE_M  = 7.5; // treasure mark

// Compare-only squared distance — avoids sqrt.
function distM2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

const COLORS = {
  0: 0x5fa84a,  // grass
  1: 0x2e6a2e,  // forest
  2: 0xd9c98a,  // sand
  3: 0x3a78c2,  // water
  4: 0xc7a85b,  // farmland
  5: 0xada695,  // residential
  6: 0x7fbf63,  // park
  7: 0x444444,  // road
  8: 0x9a7a4a,  // path
  9: 0xb2705a,  // building — small house (lifted warm brown)
  10: 0x7d736b, // rock
  11: 0xc99858, // building_med — wooden plank floor (warm yellow wood)
  12: 0x868a92, // building_large — civic / school / industrial (lifted slate)
  13: 0x383838, // road_lg (motorway/trunk/primary) — darkest
  14: 0x3f3f3f, // road_md (secondary/tertiary)
  // --- Subtype splits — each tile fits into one of three base biomes ---
  15: 0x7eb55a, // SCHOOL       (GRASSLAND) — schoolyard green, slightly mown
  16: 0xc4a5b0, // COMMERCIAL   (ROCKY)     — warm pink-tan, brightness ≈ residential
  17: 0xaa8d99, // INDUSTRIAL   (ROCKY)     — same hue, ~15% darker
  18: 0xa39065, // PLAYGROUND   (GRASSLAND) — mulchy tan
  19: 0x6fa850, // PITCH        (GRASSLAND) — vivid sports-field green
  20: 0x365a3a, // WETLAND      (FOREST)    — dim swampy green
  21: 0x88c460, // GOLF         (GRASSLAND) — bright emerald
  22: 0x4a7a32, // ORCHARD      (FOREST)    — olive
  // PIER (transportation:pier OSM lines, painted as T.PIER=23 in worldgen).
  // Base cell colour is the water blue — the wooden plank sprite from
  // Objects/Wilderness/Bridge Beach.png is drawn on top via the cobblePool
  // (see render.js PIER_FRAME). The water peeks through any plank-art alpha
  // so the cell still reads as "walkway over water".
  23: 0x3a78c2, // PIER         (WATER base) — plank sprite overlays on top
};
// Tillable = soil-ish ground. Concrete pads / cement (commercial/industrial), water, all
// road tiers, paths, every building tier, and rock are NOT tillable.
// Rock (10) is non-tillable — mineral rocks spawn as objects on rock terrain instead.
// 23 = PIER (wooden walkway over water) — walkable but not soil.
const NON_TILLABLE = new Set([3, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 23]);
function isTillable(type) { return !NON_TILLABLE.has(type); }
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
// Time-since-tab-close that grants the FULL energy bar back. Closing the tab
// or backgrounding the app for an hour returns at 100% energy; shorter rests
// are pro-rated linearly.
const OFFLINE_FULL_REST_MS = 60 * 60 * 1000;


// === Crop-affinity plaque (per-crop wooden sign baked once) ===
// Kept in app.js (not textures.js) because it depends on CROP_ROW + PRODUCE_COL.
function makePlaqueTextures(scene) {
  for (const crop of Object.keys(CROP_ROW)) {
    const key = `plaque_${crop}`;
    if (scene.textures.exists(key)) continue;
    const PW = 26, PH = 22;
    const tex = scene.textures.createCanvas(key, PW, PH);
    const ctx = tex.getContext();
    const BW = 22, BH = 12;
    const BX = (PW - BW) / 2, BY = 2;
    const PX = PW / 2 - 1, PY_TOP = BY + BH, PY_H = 5;
    // ground shadow at base of post
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fillRect(PX - 3, PY_TOP + PY_H - 1, 8, 2);
    // short post
    ctx.fillStyle = '#3a2410'; ctx.fillRect(PX, PY_TOP, 2, PY_H);
    ctx.fillStyle = '#5a3a1c'; ctx.fillRect(PX, PY_TOP, 1, PY_H);
    // board
    ctx.fillStyle = '#3a2410'; ctx.fillRect(BX, BY, BW, BH);
    ctx.fillStyle = '#a07043'; ctx.fillRect(BX + 1, BY + 1, BW - 2, BH - 2);
    ctx.fillStyle = '#caa170'; ctx.fillRect(BX + 1, BY + 1, BW - 2, 1);
    ctx.fillStyle = '#6b4824'; ctx.fillRect(BX + 1, BY + BH - 2, BW - 2, 1);
    // bake crop icon — small, desaturated, label-style
    const cropsImg = scene.textures.get('crops')?.getSourceImage();
    if (cropsImg) {
      const row = CROP_ROW[crop];
      ctx.save();
      ctx.filter = 'grayscale(70%) brightness(0.95)';
      const ICON = 10;
      const ix = BX + (BW - ICON) / 2;
      const iy = BY + (BH - ICON) / 2;
      ctx.drawImage(cropsImg, PRODUCE_COL * 16, row * 16, 16, 16, ix, iy, ICON, ICON);
      ctx.restore();
    }
    tex.refresh();
  }
}

// Chests pick a tier (weighted), then a random seed within that tier. Yield depends on tier.

// Tool slots the starter blacksmith can forge a wooden (T1) relic for. All
// six have wooden-tier art via gearAssetPath. The smithy picks 2 at random
// (see starterSmithSlots) as the player's bootstrap tools.
const STARTER_SMITH_SLOTS = ['pick', 'axe', 'hoe', 'rod', 'can', 'bugnet'];

class MapScene extends Phaser.Scene {
  constructor() { super('map'); }

  preload() {
    this.load.spritesheet('idle', 'assets/Character/Idle.png',  { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('walk', 'assets/Character/Walk.png',  { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('trees','assets/Objects/Maple Tree.png', { frameWidth: 32, frameHeight: 48 });
    this.load.image('house', 'assets/Objects/House.png');
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
    // chest.png is 32x32 with one chest per row (centered horizontally, ~16px wide with 8px padding).
    // Frames: 0 = closed, 1 = open.
    this.load.spritesheet('chest',   'assets/Objects/chest.png',            { frameWidth: 32, frameHeight: 16 });
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
      // Now that the alpha-keyed 'crops' image is available, bake per-crop plaque textures.
      makePlaqueTextures(this);
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
    this.save = Object.assign(
      {
        caught: [], planted: [], opened: [], tilled: [], picked: [], foundTreasures: [], brokenRocks: [], placedRocks: [],
        money: STARTING_MONEY, buyIndex: 0,
        // inv is array of {id, count} — seeds-only per spec; planting decrements
        // count. Starts empty: the player's first potato seeds come from a
        // starter crate on the spawn trail (see STARTER_LOOT below).
        inv: [],
        selSlot: 0,
        invPage: 0,
      },
      loadSave()
    );
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
    // Stats / equipment migration — adds energy + relic/armor slots to older saves.
    this.save.relics = this.save.relics || { pick: null, axe: null, ring: null, amulet: null,
                                              sword: null, bow: null, staff: null };
    if (this.save.relics.axe === undefined)   this.save.relics.axe = null;   // older saves
    if (this.save.relics.sword === undefined) this.save.relics.sword = null;
    if (this.save.relics.bow === undefined)   this.save.relics.bow = null;
    if (this.save.relics.staff === undefined) this.save.relics.staff = null;
    if (this.save.relics.can === undefined)   this.save.relics.can = null;
    if (this.save.relics.hoe === undefined)   this.save.relics.hoe = null;
    if (this.save.relics.bugnet === undefined) this.save.relics.bugnet = null;
    if (this.save.relics.rod === undefined)    this.save.relics.rod = null;
    if (this.save.relics.bags === undefined)   this.save.relics.bags = null;
    // Magic Crafting Shrine — one per game, spawned on the start tile at
    // worldgen. shrineLevel ramps 1..7 as the player feeds it harvest
    // bundles, unlocking new produce→bar transforms (see SHRINE_TRANSFORMS).
    // save.shrine = { id, x, y } once spawned; null until then.
    if (this.save.shrine === undefined)           this.save.shrine = null;
    if (this.save.shrineLevel === undefined)      this.save.shrineLevel = 1;
    // Self-heal pre-fix save state: pre-fix, forest trees spawned without
    // an `id` field, so chopping one pushed `undefined` into save.chopped.
    // A `choppedSet.has(undefined)` lookup then matched every other tree
    // (also id-less) and wiped the whole grove. Strip any falsy entries on
    // load so old saves recover automatically.
    if (Array.isArray(this.save.chopped)) {
      const cleaned = this.save.chopped.filter(id => !!id);
      if (cleaned.length !== this.save.chopped.length) this.save.chopped = cleaned;
    }
    // POIs span tile seams (worldgen replicates them across up to 4
    // neighbouring tile entries). When the shrine REPLACES a POI we need
    // to suppress that chest id everywhere it appears, not just on the
    // tile the spawn picked. Single id is enough — only one shrine per
    // game and a POI's id is unique.
    if (this.save.shrineReplacedId === undefined) this.save.shrineReplacedId = null;
    // Per-shop bucket state: { [houseId]: { bucket, deals, rerolls } }.
    // Replaces the old shopDeals (rolling timestamp array) + shopOffers
    // (cached offer object) — both are re-derivable from a seeded RNG keyed
    // by (house.id, bucket, rerolls). offerSalt is a once-per-save random
    // so identical worlds won't see identical shops across players.
    if (!this.save.shopState) {
      this.save.shopState = {};
      this.save.offerSalt = (Math.floor(Math.random() * 0xffffffff)) >>> 0;
      delete this.save.shopDeals;
      delete this.save.shopOffers;
    }
    if (this.save.offerSalt == null) {
      this.save.offerSalt = (Math.floor(Math.random() * 0xffffffff)) >>> 0;
    }
    // Backfill armor slots (spread, not || , so a save missing one slot key
    // still gets defaults rather than carrying gaps that crash maxEnergyFromArmor).
    this.save.armor = { helmet: null, chest: null, legs: null, boots: null, ...(this.save.armor || {}) };
    // Always re-derive maxEnergy from the equipped armor — never trust a stale
    // saved value (older saves may have had a lower maxEnergy than the current
    // armor set warrants, which would silently cap energy below the real ceiling).
    const maxE = (typeof maxEnergyFromArmor === 'function')
      ? maxEnergyFromArmor(this.save.armor) : (typeof STARTING_ENERGY !== 'undefined' ? STARTING_ENERGY : 100);
    this.save.maxEnergy = maxE;
    if (!Number.isFinite(this.save.energy)) this.save.energy = maxE;
    // Clamp current to whatever the new max allows.
    this.save.energy = Math.min(maxE, Math.max(0, this.save.energy));
    // Offline-rest restoration. Time since the last lastSeenAt heartbeat is
    // treated as "the player was resting" — pro-rated 100% per hour, capped at
    // maxEnergy. Skipped in test mode so the harness's deterministic energy
    // values aren't bumped on every harness reload.
    if (this.save.lastSeenAt && !window.__TEST_MODE) {
      this.applyOfflineRest(Math.max(0, Date.now() - this.save.lastSeenAt));
    }
    this.save.lastSeenAt = Date.now();
    // Float accumulator for indoor resting — fractions of an energy point
    // accrue here between integer-pip bumps to save.energy.
    this._restAccrueE = 0;
    // Mark relics dirty so the first updateRelicRow call actually rebuilds.
    this._relicsGen = 1;
    // Restored-houses set: empty by default. Every tier-9 small-house starts
    // out as a "wreck" sprite with no shop function — the player has to
    // bring 5 wood (plain residential) or 5 rockfruit (themed: blacksmith /
    // market / trader) to restore it. The starter trailer is exempt — it's
    // marked as restored on first load so Home is functional from day one.
    if (!this.save.restoredHouses || typeof this.save.restoredHouses !== 'object') {
      this.save.restoredHouses = {};
    }
    // Tributed-castles set: empty by default. Every castle (BUILDING_LARGE)
    // starts occupied by corrupt residents who demand a one-time tribute —
    // 10 of a random Tier-2 good (5 if it's a live animal) — before they'll
    // open the vault. Mirrors the wreck-restore gate; see _isCastleUnappeased.
    if (!this.save.tributedCastles || typeof this.save.tributedCastles !== 'object') {
      this.save.tributedCastles = {};
    }
    // No starter-tools gift: the player begins tool-less and forges their
    // first wooden pick → axe → hoe at the starter blacksmith (5 wood each).
    // Wood comes from ground stacks + bare-handed shrub chops (no tool
    // needed), and the starter crate seeds the first 5 wood, so the very
    // first pick is always reachable on day one.
    //
    // One-time migration for saves made under the old gift: strip the free
    // tier-1 pick/axe so existing players also start the forge loop. Only
    // nulls a *wooden* (tier 1) tool — an upgraded pick/axe was earned and
    // is left alone. Gated behind a flag so a re-forged wooden tool isn't
    // re-wiped on the next reload.
    if (!this.save.starterToolsStripped) {
      if (this.save.relics?.pick?.tier === 1) this.save.relics.pick = null;
      if (this.save.relics?.axe?.tier  === 1) this.save.relics.axe  = null;
      this.save.starterToolsStripped = true;
    }
    // Soft cap on unbounded "history" save fields. A heavy player who walks
    // for hours can balloon these to MBs and silently break localStorage
    // writes (quota exceeded). Keeping the MOST RECENT N entries means the
    // oldest opened chests / picked plants / treasures may eventually
    // respawn if the player walks back, but the alternative is a totally
    // broken save once quota hits.
    const HISTORY_CAP = 5000;
    for (const k of ['opened', 'picked', 'foundTreasures', 'caught', 'brokenRocks', 'placedRocks', 'chopped']) {
      const arr = this.save[k];
      if (Array.isArray(arr) && arr.length > HISTORY_CAP) {
        this.save[k] = arr.slice(arr.length - HISTORY_CAP);
      }
    }
    // Transient runtime state — not persisted.
    this.pairyCompass = null;   // { targetId, x, y, until } when active
    // Migrate older save (inv as string array, or stash object).
    let needsMigrationPersist = false;
    if (this.save.inv && typeof this.save.inv[0] === 'string') {
      // Items must have a numeric count — otherwise later sel.count -= 1 yields NaN
      // and stacks become uncountable + un-spliceable.
      this.save.inv = this.save.inv.filter(Boolean).map(id => ({ id, count: 1 }));
      needsMigrationPersist = true;
    }
    if (this.save.stash) {
      for (const [id, n] of Object.entries(this.save.stash)) if (n > 0) this.addToInv(id, n, true);
      delete this.save.stash;
      needsMigrationPersist = true;
    }
    // Rename: venison → meat. Folds any existing 'venison' inv stacks into
    // the new 'meat' stack so older saves don't lose hunting loot when the
    // dog favourite-food rework dropped the venison item id.
    if (Array.isArray(this.save.inv)) {
      const merged = [];
      let meatCount = 0;
      for (const s of this.save.inv) {
        if (!s) continue;
        if (s.id === 'venison') {
          meatCount += (s.count ?? 0);
          needsMigrationPersist = true;
        } else if (s.id === 'meat') {
          meatCount += (s.count ?? 0);
        } else {
          merged.push(s);
        }
      }
      if (meatCount > 0) merged.push({ id: 'meat', count: meatCount });
      this.save.inv = merged;
    }
    if (needsMigrationPersist) persistSave(this.save);

    this.cameras.main.setBackgroundColor('#222');
    this.viewCenterX = W / 2;
    this.viewCenterY = H / 2 - 110;           // raise map well clear of the inventory bar AND the Eat button beneath it
    this.viewLeft = this.viewCenterX - (VIEW_CELLS / 2) * CELL_PX;
    this.viewTop  = this.viewCenterY - (VIEW_CELLS / 2) * CELL_PX;
    this.viewSize = VIEW_CELLS * CELL_PX;

    const origin = WorldGen.lonLatToWorldPx(START_LON, START_LAT, WorldGen.Z);
    this.originPx = origin;
    this.mPerPx = WorldGen.metersPerPixel(START_LAT, WorldGen.Z);
    this.cellM = WorldGen.CELL_M;
    this.cellsPerTile = WorldGen.cellsPerEdgeForLat(START_LAT);
    this.tileEdgeM = WorldGen.tileEdgeMeters(START_LAT);
    // Player sprite (idle, 32px frame, scale 1.5, origin 0.5/0.5) has its visual
    // feet at viewCenterY + 24 px. Offset reach checks downward by the same so
    // the reachable area is symmetric around the visible character, not the
    // sprite's geometric center. ~3.75m at the default CELL_PX/cellM.
    this.feetOffsetM = (24 / CELL_PX) * this.cellM;
    this.REACH_CELL_M = 16;   // cell taps: till / plant / water / harvest. 16m = √(5²+15²)+ε includes (±1,±3) / (±3,±1) cells.
    // NOTE: object/creature/wildplant taps do NOT use a scene-level reach —
    // their distance gate is the global REACH_FAR_M (16m, == REACH_CELL_M, same
    // feet-cell anchor) so the lit reach indicator and tap-accept stay in lock-
    // step. A former `this.REACH_OBJECT_M = 18` was dead (never read; object
    // taps use the global REACH_OBJECT_M=3.5 for tap-precision) and was removed
    // — wiring an 18m object reach would let objects be tapped OUTSIDE the lit
    // indicator. Keep object reach == cell reach.
    this.startWorldM = {
      x: this.originPx.x * this.mPerPx,
      y: this.originPx.y * this.mPerPx,
    };

    this.playerM = { x: 0, y: 0 };
    this.facing = { x: 0, y: 1 }; // unit-ish vector; updated by movement
    this._spriteDir = { x: 0, y: 1 }; // last movement direction used for sprite facing
    this._ease = null;            // {fromX, fromY, toX, toY, t0, dur} for GPS easing
    this.gpsM = null;
    this.gpsAvailable = false;
    // Set true the moment the player drives themselves with manual controls
    // (WASD / arrow keys, SPACE-teleport, T-teleport). Once on, the GPS watcher
    // stops snapping the player back to their real-world fix for the rest of
    // the session. Session-scoped ONLY — never persisted — so a fresh load
    // resumes live GPS tracking.
    this._gpsManualOverride = false;

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
    // Longgrass (display name "Fern") — bake frame 10 of the 'props' sheet
    // (col 11 row 1 in 1-indexed coords = leafy green fern frond). Same
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
    // Shape-based concrete pads under POI chests. One texture per unique shape
    // (square3 / square2 / cross / triangle); the POI's class picks the shape
    // (see padShapeForPoi below). The pad SHAPE alone conveys POI type.
    makeAllPadShapes(this);

    // Layers
    this.cellGfx = this.add.graphics();
    this.noiseContainer = this.add.container(0, 0);
    this.terrainContainer = this.add.container(0, 0);
    this.cobbleContainer = this.add.container(0, 0);
    this.plantedContainer = this.add.container(0, 0);
    // Pads (3x3 concrete slabs under POI chests) draw under objects.
    this.padContainer = this.add.container(0, 0);
    // Soft contact shadows under buildings — drawn just below the object
    // sprites so a house/tower visibly sits ON the ground instead of floating.
    this.shadowContainer = this.add.container(0, 0);
    this.objectsContainer = this.add.container(0, 0);
    // Coin-burst drops (from ATM / bicycle_parking tap). Sits above objects
    // so coins read on top of pads + the source chest sprite.
    this.coinContainer = this.add.container(0, 0);
    this.creaturesContainer = this.add.container(0, 0);
    // Tier-diamond layer — drawn LAST so the indicator floats above chests / labels / pads.
    this.tierGfx = this.add.graphics();

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

    // Road-letter pool: small light letters with a soft drop shadow, laid out one
    // per cell along named streets. Lighter than the cobble background so they
    // read like worn paint markings rather than carved-in lettering.
    this.letterContainer = this.add.container(0, 0);
    this.letterPool = [];
    for (let i = 0; i < (VIEW_CELLS + 2) * (VIEW_CELLS + 2); i++) {
      const t = this.add.text(0, 0, '', {
        font: 'bold 10px serif', color: '#000000',
      }).setOrigin(0.5, 0.5).setAlpha(0.55).setDepth(0).setVisible(false);
      this.letterContainer.add(t);
      this.letterPool.push(t);
    }

    this.objectPool = [];
    this.plantedPool = [];
    this.plantedTimerPool = []; // small Phaser.Text in cell corner: growth minutes remaining
    this.creaturePool = [];
    this.chestLabelPool = []; // Phaser.Text objects for POI names above chests
    this.shopLabelPool  = []; // Phaser.Text objects for specialty-shop labels above houses
    this.shopReadyPool  = []; // Phaser.Text "✓ / Xm" readiness pip above each house/tower
    this.padPool = [];        // sprites for per-POI concrete-pad textures under chests
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
    // Shadow pool — one sprite per visible building. Sized to the worst case
    // (every object cell could be a building); reuses the object pool budget.
    this.shadowPool = [];

    // Viewport mask clips everything inside the 11x11 area.
    const maskG = this.make.graphics({ x: 0, y: 0, add: false });
    maskG.fillStyle(0xffffff);
    maskG.fillRect(this.viewLeft, this.viewTop, this.viewSize, this.viewSize);
    const mask = maskG.createGeometryMask();
    this.cellGfx.setMask(mask);
    this.noiseContainer.setMask(mask);
    this.terrainContainer.setMask(mask);
    this.cobbleContainer.setMask(mask);
    this.letterContainer.setMask(mask);
    this.plantedContainer.setMask(mask);
    this.padContainer.setMask(mask);
    this.shadowContainer.setMask(mask);
    this.objectsContainer.setMask(mask);
    this.coinContainer.setMask(mask);
    this.creaturesContainer.setMask(mask);
    this.tierGfx.setMask(mask);

    // Work-progress wheel — drawn above all world objects, not masked.
    this._workProgressGfx = this.add.graphics().setDepth(95);
    this._workProgressIcon = null;   // DOM element created per-action, removed on cancel/complete
    this._workProgress = null;

    const frame = this.add.graphics();
    frame.lineStyle(2, 0x000000, 0.6)
      .strokeRect(this.viewLeft - 1, this.viewTop - 1, this.viewSize + 2, this.viewSize + 2);

    // Animations — Idle.png: 4 cols × 3 rows; Walk.png: 6 cols × 3 rows
    // Row 0 = facing down, row 1 = facing up, row 2 = facing side (right; flip for left)
    this.anims.create({ key: 'idle-down', frames: this.anims.generateFrameNumbers('idle', { start: 0,  end: 3  }), frameRate: 6,  repeat: -1 });
    this.anims.create({ key: 'idle-up',   frames: this.anims.generateFrameNumbers('idle', { start: 4,  end: 7  }), frameRate: 6,  repeat: -1 });
    this.anims.create({ key: 'idle-side', frames: this.anims.generateFrameNumbers('idle', { start: 8,  end: 11 }), frameRate: 6,  repeat: -1 });
    this.anims.create({ key: 'walk-down', frames: this.anims.generateFrameNumbers('walk', { start: 0,  end: 5  }), frameRate: 10, repeat: -1 });
    this.anims.create({ key: 'walk-up',   frames: this.anims.generateFrameNumbers('walk', { start: 6,  end: 11 }), frameRate: 10, repeat: -1 });
    this.anims.create({ key: 'walk-side', frames: this.anims.generateFrameNumbers('walk', { start: 12, end: 17 }), frameRate: 10, repeat: -1 });
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
    this.player = this.add.sprite(this.viewCenterX, this.viewCenterY, 'idle', 0)
      .setScale(1.5)
      .setDepth(10)
      .play('idle-down')
      .setMask(mask);
    // Second sprite for the player's real body when ghost mode is active.
    // While ghost mode is OFF (the default) this stays hidden and `this.player`
    // is the body. When ghost mode flips ON, `this.player` becomes the ghost
    // (at 50% alpha, centred at viewCenter) and this sprite shows up at the
    // body's offset, full opacity.
    this.bodyPlayer = this.add.sprite(this.viewCenterX, this.viewCenterY, 'idle', 0)
      .setScale(1.5)
      .play('idle-down')
      .setVisible(false)
      .setMask(mask);
    // Facing direction indicator — arrow rendered via Graphics, pointed in the
    // direction of the device compass (or last movement as a fallback).
    this.facingGfx = this.add.graphics().setDepth(11).setMask(mask);
    this.compassDeg = null; // degrees clockwise from north, or null if no sensor
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

    // World tap (player handler runs first and stops propagation)
    this.input.on('pointerdown', (p) => this.handleWorldTap(p.x, p.y));

    // HUD + banner + inventory
    this.hud = document.getElementById('hud');
    this.moneyEl = document.getElementById('money');
    this.banner = document.getElementById('banner');
    this.buildInventoryDOM();

    // Sandbox mode (`?sandbox=true`): pre-seed the start tile + 8 neighbours
    // with a synthetic 5×5 grid of biome plots containing every native
    // interactable. Runs BEFORE ensureTilesAround so WorldGen.loadTile short-
    // circuits on the cached tile and skips the network fetch.
    if (typeof Sandbox !== 'undefined' && Sandbox.detect()) {
      Sandbox.install(this);
    }

    // Boot tile load
    this.ensureTilesAround().catch(e => console.error(e));

    // Network status
    window.addEventListener('offline', () => this.showBanner(true));
    window.addEventListener('online', () => this.showBanner(false));

    // Ghost-mode state. The pad shows up only when an amulet is equipped
    // (managed in updateRelicRow → syncGhostPad). joystickVec is driven by
    // pointer events on the pad; _ghostPadHeld tracks whether the pointer is
    // currently down (so we can collapse the ghost on release even when the
    // nub is centred). _bodyM is set on activation to remember where the
    // real body was — restored to playerM on collapse.
    this.joystickVec = { x: 0, y: 0 };
    this._ghostPadHeld = false;
    this._bodyM = null;
    this._ghostDistAccrue = 0;   // meters of ghost travel since last energy pip

    // Debug-controls pad (opt-in via the ☰ menu). When save.debugControls is
    // true the ghost pad is suppressed and a debug pad takes its slot —
    // direct body movement at DEBUG_SPEED_MUL × walk speed, no energy cost.
    this.debugJoystickVec = { x: 0, y: 0 };
    this._debugPadHeld = false;

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
  }

  // Called from the safety-splash button click (or from create() if the
  // modal was already dismissed when the scene loaded). Idempotent: safe
  // to call repeatedly. The compass listener attach is gated on
  // window.__compassPerm because iOS gives us nothing without 'granted'.
  startSensors() {
    if (window.__compassPerm === 'granted') this._attachCompass();
    if (this.gpsWatchId == null) this.startGps();
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
        // Stop the GPS watcher — by far the biggest battery drain. We'll
        // re-arm it on return so a fresh fix is taken.
        if (this.gpsWatchId != null) {
          try { navigator.geolocation.clearWatch(this.gpsWatchId); } catch {}
          this.gpsWatchId = null;
        }
        // Snapshot the moment we paused. Phaser stops calling update() while
        // hidden, so the per-frame heartbeat freezes — anchor lastSeenAt here
        // so the next visible-transition (or page reload) measures from now.
        this.save.lastSeenAt = Date.now();
        persistSave(this.save);
      } else {
        // Foregrounded after a background nap. Pro-rate energy restoration
        // by the gap, just like a fresh page load would do in create().
        if (this.save.lastSeenAt && !window.__TEST_MODE) {
          this.applyOfflineRest(Math.max(0, Date.now() - this.save.lastSeenAt));
        }
        this.save.lastSeenAt = Date.now();
        persistSave(this.save);
        if (this.game && this.game.isPaused) this.game.resume();
        if (!this.gpsWatchId && this.gpsAvailable !== false) this.startGps();
        // Wake lock is auto-released on hide; re-acquire on return.
        if (!this._wakeLock) acquireWakeLock();
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
    this._ease = null;
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
    this.gpsAvailable = true;
    try {
      this.gpsWatchId = navigator.geolocation.watchPosition(
        pos => {
          const { latitude, longitude } = pos.coords;
          const dxM = (longitude - START_LON) * METERS_PER_DEG_LAT * Math.cos(START_LAT * Math.PI / 180);
          const dyM = -(latitude - START_LAT) * METERS_PER_DEG_LAT;
          const prev = this.gpsM;
          this.gpsM = { x: dxM, y: dyM };
          // Debug controls — or a manual-control takeover this session (WASD /
          // arrow keys / SPACE / T teleport) — own movement entirely: skip the
          // GPS-driven ease (and the silent body-warp under ghost mode) so the
          // gold joystick / arrow keys aren't fighting the watcher. gpsM still
          // tracks so the HUD's gps-live check and the facing fallback below
          // keep working.
          if (this.save.debugControls || this._gpsManualOverride) {
            // intentionally no playerM / _bodyM write
          } else if (this._bodyM) {
            // While ghost mode is active, playerM IS the ghost; GPS updates
            // the body silently behind it (the body sprite re-positions
            // itself off-centre based on _bodyM during render).
            this._bodyM.x = this.gpsM.x;
            this._bodyM.y = this.gpsM.y;
          } else {
            // Ease toward the new GPS fix instead of snapping.
            this._ease = {
              fromX: this.playerM.x, fromY: this.playerM.y,
              toX: this.gpsM.x, toY: this.gpsM.y,
              t0: performance.now(), dur: 300,
            };
          }
          if (prev) {
            const ddx = this.gpsM.x - prev.x, ddy = this.gpsM.y - prev.y;
            // Only use movement as facing fallback when there's no compass.
            if ((ddx || ddy) && this.compassDeg == null) this.facing = { x: ddx, y: ddy };
          }
        },
        err => { console.warn('GPS error', err.message); this.gpsAvailable = false; },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
      );
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
  showBanner(on) { this.banner.style.display = on ? 'block' : 'none'; }

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

  playerAbsCell() {
    const pc = this.playerToWorldCell();
    return {
      cellIX: pc.tx * this.cellsPerTile + Math.floor(pc.cx),
      cellIY: pc.ty * this.cellsPerTile + Math.floor(pc.cy),
    };
  }

  async ensureTilesAround() {
    const cell = this.playerToWorldCell();
    const needed = new Set();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      needed.add(`${cell.tx + dx}/${cell.ty + dy}`);
    }
    let anyFailed = false;
    for (const k of needed) {
      const [tx, ty] = k.split('/').map(Number);
      try {
        const entry = await WorldGen.loadTile(tx, ty, START_LAT);
        if (entry.status === 'loading') await entry.promise;
        if (!entry.creatures) this.spawnInTile(entry, tx, ty);
      } catch (e) {
        anyFailed = true;
        console.warn('tile fetch failed', k, e.message);
      }
    }
    this.showBanner(anyFailed && !navigator.onLine);
  }

  // === Spawns ===
  spawnInTile(entry, tx, ty) {
    const rng = WorldGen.makeRng(tx * 0x1f1f1f1f ^ ty * 0x12345);
    const creatures = [];
    const N = entry.cellsPerEdge;
    const tryPlace = (kindWant, classesOK, idx, kindStr) => {
      for (let attempt = 0; attempt < 12; attempt++) {
        const cx = Math.floor(rng() * N);
        const cy = Math.floor(rng() * N);
        const t = entry.grid[cy * N + cx];
        if (classesOK.has(t)) {
          const wmx = tx * this.tileEdgeM + (cx + 0.5) * this.cellM;
          const wmy = ty * this.tileEdgeM + (cy + 0.5) * this.cellM;
          const id = `${kindStr}_${tx}_${ty}_${idx}`;
          if (this.save.caught.includes(id)) return;
          creatures.push({ x: wmx, y: wmy, kind: kindStr, id });
          return;
        }
      }
    };
    // Biome biasing: each fauna gets a "primary" biome and a wider "fallback" set.
    // We split the spawn count 80/20 between primary and fallback to keep them
    // visible everywhere while still feeling correct (cows in fields, chickens
    // on lawns, etc.). Cat/dog/crow are "global" — they roam every natural cell.
    const RESIDENTIAL = new Set([5]);
    const GRASSLAND   = new Set([0]);
    const FARM_GRASS  = new Set([0, 4]);                      // grass + farmland (chickens)
    const SOFT_GROUND = new Set([0, 4, 5, 6]);                // grass / farmland / residential / park
    const GLOBAL_NAT  = new Set([0, 1, 2, 4, 5, 6]);          // every natural biome (incl. sand + forest)
    const FOREST_NATURAL = new Set([0, 1, 6]);                // grass, forest, park
    const PARKLAND       = new Set([1, 6]);                   // park + forest
    const splitPlace = (kind, n, primary, fallback, salt, primaryShare = 0.8) => {
      const primN = Math.round(n * primaryShare);
      for (let i = 0; i < primN; i++)     tryPlace(kind, primary,  i,           salt);
      for (let i = primN; i < n; i++)     tryPlace(kind, fallback, i,           salt);
    };
    // Chickens: farm/grass primarily, soft ground elsewhere. ~40/tile. Pulled
    // OUT of residential as the primary biome (per user: too many of them
    // crowding the suburbs) — barn-yard fauna belongs on farmland.
    const chickenN = 30 + Math.floor(rng() * 15);
    splitPlace('chicken', chickenN, FARM_GRASS, SOFT_GROUND, 'chicken');
    // Cows: grassland primarily, soft ground elsewhere. Tightened primary
    // share to 0.90 (was 0.80) so fewer cows wander into residential.
    const cowN = 12 + Math.floor(rng() * 12);
    splitPlace('cow', cowN, GRASSLAND, SOFT_GROUND, 'cow', 0.90);
    // Cat / dog: RARER than barn fauna, but heavily residential-biased —
    // they're pets, not livestock. ~10/tile each, 80% in residential.
    const catN = 6 + Math.floor(rng() * 8);
    splitPlace('cat', catN, RESIDENTIAL, GLOBAL_NAT, 'cat');
    const dogN = 6 + Math.floor(rng() * 8);
    splitPlace('dog', dogN, RESIDENTIAL, GLOBAL_NAT, 'dog');
    // Wilderness fauna:
    //   rabbit    → grass / forest / park (skittish, wide)
    //   deer      → forest + park (rare, weapon-gated)
    //   crow      → global — smart birds; ~200/tile (heavy swarm, paired with
    //               the starter scarecrow + wide 15-cell notice radius)
    //   butterfly → park / forest (flower-rich biomes)
    const rabbitN = 30 + Math.floor(rng() * 20);
    for (let i = 0; i < rabbitN; i++) tryPlace('rabbit', FOREST_NATURAL, i, 'rabbit');
    const deerN = 8 + Math.floor(rng() * 6);
    for (let i = 0; i < deerN; i++) tryPlace('deer', PARKLAND, i, 'deer');
    const crowN = 200;
    for (let i = 0; i < crowN; i++) tryPlace('crow', GLOBAL_NAT, i, 'crow');
    const butterflyN = 40 + Math.floor(rng() * 20);
    for (let i = 0; i < butterflyN; i++) tryPlace('butterfly', PARKLAND, i, 'butterfly');
    // Slimes: energy-leeching pests that roam every natural biome and drift
    // lazily toward the player (see wanderCreatures). Flat 50/tile.
    const slimeN = 50;
    for (let i = 0; i < slimeN; i++) tryPlace('slime', GLOBAL_NAT, i, 'slime');
    // (Starter-cow at spawn removed — cows are valuable enough that none should be gifted.)
    // Merge in any creatures the player has released back into the world for this tile.
    // save.released is a flat array of {x,y,kind,id,tx,ty} — filter by tile + caught state.
    if (this.save.released) {
      for (const r of this.save.released) {
        if (r.tx !== tx || r.ty !== ty) continue;
        if (this.save.caught.includes(r.id)) continue;
        creatures.push({ x: r.x, y: r.y, kind: r.kind, id: r.id });
      }
    }
    entry.creatures = creatures;

    // Starter loot now lives entirely in the two road-side crates placed
    // below (entry.extraTreasures with starterLoot). No loose groundstack
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
    //                            rolls for 2–5 X marks dropped on random
    //                            walkable cells, so X's feel like a regular
    //                            ambient reward instead of a once-a-walk find.
    // All three render + interact through the same code path.
    entry.treasure = null;
    entry.extraTreasures = [];
    // Residential cells are players' yards/lots — X marks dropped 3+ cells
    // deep into someone's backyard would bait the player into trespassing.
    // Allow X marks on residential cells only when the cell has a road
    // within Chebyshev 2 (kerb / driveway-ish). Reused for all three
    // treasure streams below.
    const _xRoadOK = (cx, cy) => {
      const here = entry.grid[cy * N + cx];
      if (here !== 5 /* RESIDENTIAL */) return true;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= N || ny < 0 || ny >= N) continue;
        const tt = entry.grid[ny * N + nx];
        if (tt === 7 /* ROAD */ || tt === 13 /* ROAD_LG */
            || tt === 14 /* ROAD_MD */ || tt === 8 /* PATH */) return true;
      }
      return false;
    };
    // Guaranteed starter trail: when this is the spawn tile, place 4 X
    // marks along the nearest road instead of one X dangling 10 m north
    // of the spawn point. The player walks out, sees a numbered breadcrumb
    // along the kerb, and the onboarding is "follow the X's" instead of
    // "go straight up". Falls back to the legacy north-of-spawn placement
    // when no road exists within 15 cells of the spawn.
    const tx0 = tx * this.tileEdgeM, ty0 = ty * this.tileEdgeM;
    const sx = this.startWorldM.x, sy = this.startWorldM.y;
    const isStarterTile = (sx >= tx0 && sx < tx0 + this.tileEdgeM && sy >= ty0 && sy < ty0 + this.tileEdgeM);
    if (isStarterTile) {
      const ROAD_TYPES = new Set([7 /* ROAD */, 13 /* ROAD_LG */, 14 /* ROAD_MD */, 8 /* PATH */]);
      const BLOCKED_FOR_X = new Set([3 /* WATER */, 9 /* BUILDING */, 11 /* BUILDING_MED */, 12 /* BUILDING_LARGE */]);
      const spawnIX = Math.floor((sx - tx0) / this.cellM);
      const spawnIY = Math.floor((sy - ty0) / this.cellM);
      // BFS from the spawn cell for the nearest road cell within 15 cells.
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
      // Seven starter crates: one of 9 potato seeds (the player's first crop —
      // inventory starts empty), three of 5 wood for restoring a plain house,
      // three of 5 rockfruit for restoring a themed shop — interleaved so the
      // trail alternates. Per-crate counts stay within the no-bag stack cap (9)
      // so nothing overflows. Fixed contents instead of the unified rarity
      // picker — the player gets exactly what they need to bootstrap the
      // restoration loop. (No free scarecrow — it's sold at the forced
      // scarecrow shop, the next house out past the starter blacksmith.)
      const STARTER_LOOT = [
        { id: 'potato_seed', qty: 9 },
        { id: 'wood',        qty: 5 },
        { id: 'rockfruit',   qty: 5 },
        { id: 'wood',        qty: 5 },
        { id: 'rockfruit',   qty: 5 },
        { id: 'wood',        qty: 5 },
        { id: 'rockfruit',   qty: 5 },
      ];
      const COUNT = STARTER_LOOT.length;
      const usedSeats = new Set();          // 'cx,cy' of cells already holding a crate
      const placedIdx = new Set();          // loot indices successfully seated
      const MIN_GAP = 3;                    // Chebyshev spacing between consecutive crates
      const seatCrate = (cx, cy, i) => {
        const wmx = tx * this.tileEdgeM + (cx + 0.5) * this.cellM;
        const wmy = ty * this.tileEdgeM + (cy + 0.5) * this.cellM;
        entry.extraTreasures.push({
          x: wmx, y: wmy, n: i + 1,
          starterLoot: STARTER_LOOT[i],
          id: `treasure_start_${tx}_${ty}_${i + 1}`,
        });
        usedSeats.add(cx + ',' + cy);
        placedIdx.add(i);
      };
      if (roadCell) {
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
            if (usedSeats.has(nx + ',' + ny)) continue;
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
      // ran out of walkable shoulders) in a tight ring around the spawn
      // point on walkable cells. Guarantees the player always gets all six
      // = 15 wood + 15 rockfruit (in 5-stacks).
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
              if (!BLOCKED_FOR_X.has(t) && !ROAD_TYPES.has(t) && !usedSeats.has(ncx + ',' + ncy)) break;
              ncx += Math.sign(bdx) || 0;
              ncy += Math.sign(bdy) || 0;
            }
            if (ncx < 0 || ncx >= N || ncy < 0 || ncy >= N) continue;
            const tt = entry.grid[ncy * N + ncx];
            if (BLOCKED_FOR_X.has(tt) || ROAD_TYPES.has(tt) || usedSeats.has(ncx + ',' + ncy)) continue;
            seatCrate(ncx, ncy, i);
            seated = true;
          }
        }
      }
      // Clear the immediate spawn area of natural mineralrocks and trees
      // so the starter crates aren't visually competing with debris the
      // player can't open. 10-cell Chebyshev radius (~50 m) around the
      // spawn point — far enough that the crates and the player's home
      // sit in a clean tutorial pocket, close enough that the surrounding
      // streets / wilderness still feel populated.
      const CLEAR_R = 10;
      const STRIP_KINDS = new Set(['mineralrock', 'tree', 'fruittree', 'groundstack']);
      const _nearSpawn = (wx, wy) => {
        const oIx = Math.floor((wx - tx0) / this.cellM);
        const oIy = Math.floor((wy - ty0) / this.cellM);
        return Math.max(Math.abs(oIx - spawnIX), Math.abs(oIy - spawnIY)) <= CLEAR_R;
      };
      entry.objects = entry.objects.filter(o =>
        !STRIP_KINDS.has(o.kind) || !_nearSpawn(o.x, o.y));
      // Wild rockfruit / debris (entry.wildplants) is its own stream — clear
      // any within the tutorial pocket too so spawn is free of pickable scrub.
      if (Array.isArray(entry.wildplants)) {
        entry.wildplants = entry.wildplants.filter(w => !_nearSpawn(w.x, w.y));
      }
    } else if (rng() < 1 / 4) {
      // Bumped from 1/200 to 1/4 — combined with the scatter below, players
      // see X's frequently instead of stumbling onto one a session.
      for (let attempt = 0; attempt < 16; attempt++) {
        const cx = Math.floor(rng() * N);
        const cy = Math.floor(rng() * N);
        const t = entry.grid[cy * N + cx];
        // Place on any walkable ground (skip water + buildings).
        if (t === 3 || t === 9 || t === 11 || t === 12) continue;
        if (!_xRoadOK(cx, cy)) continue;   // residential cells need a road within 2
        const wmx = tx * this.tileEdgeM + (cx + 0.5) * this.cellM;
        const wmy = ty * this.tileEdgeM + (cy + 0.5) * this.cellM;
        entry.treasure = { x: wmx, y: wmy, id: `treasure_${tx}_${ty}` };
        break;
      }
    }
    // Extra scatter: 2–5 X's per tile on random walkable cells. Each gets a
    // stable id derived from its cell so save.foundTreasures persists across
    // reloads. Failed placement attempts (water/building cells) just drop
    // that slot — small scatter variance is fine.
    // Skip the extra-X scatter in test mode — the unified treasure handler
    // runs BEFORE wildplant/creature/till/plant/water dispatches, and tests
    // that tap arbitrary cells would have the tap stolen by a random X.
    const EXTRA_X_COUNT = window.__TEST_MODE ? 0 : (2 + Math.floor(rng() * 4));
    for (let k = 0; k < EXTRA_X_COUNT; k++) {
      let placed = false;
      for (let attempt = 0; attempt < 8 && !placed; attempt++) {
        const cx = Math.floor(rng() * N);
        const cy = Math.floor(rng() * N);
        const t = entry.grid[cy * N + cx];
        if (t === 3 || t === 9 || t === 11 || t === 12) continue;
        if (!_xRoadOK(cx, cy)) continue;   // residential cells need a road within 2
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
      // 2-4 bonus X marks per tile that has any path. Capped by path
      // density so a tile with one stub doesn't get spammed.
      const PATH_BONUS_COUNT = Math.min(
        2 + Math.floor(rng() * 3),
        Math.max(1, Math.floor(pathCells.length / 4))
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
          const nt = entry.grid[ncy * N + ncx];
          // Reject non-walkable neighbour cells AND path cells themselves
          // (we want the X visually OFF the trail), and avoid stacking on
          // an existing X.
          if (nt === 3 || nt === 8 || nt === 9 || nt === 11 || nt === 12) continue;
          if (!_xRoadOK(ncx, ncy)) continue;   // residential cells need a road within 2
          const wmx = tx * this.tileEdgeM + (ncx + 0.5) * this.cellM;
          const wmy = ty * this.tileEdgeM + (ncy + 0.5) * this.cellM;
          const id = `treasure_path_${tx}_${ty}_${ncx}_${ncy}`;
          if (entry.extraTreasures.some(t => t.id === id)) continue;
          entry.extraTreasures.push({ x: wmx, y: wmy, id });
          placed = true;
        }
      }
    }

    // Magic Crafting Shrine — one per game. REPLACES the nearest POI ≥200m
    // from the player's start. We try to spawn on the current tile; if no
    // qualifying POI here, the next loaded tile gets a shot. save.shrine
    // pins the world position once chosen so the placement is stable across
    // reloads. The replaced POI's id is tracked in save.shrineReplacedId
    // so we can suppress its ghost in neighbouring tiles where the same
    // chest replicates (worldgen seam handling).
    if (!this.save.shrine) {
      this._trySpawnShrineOnTile(entry, tx, ty);
    }
    if (this.save.shrine) {
      // Always: filter out the replaced chest from THIS tile's objects.
      // Worldgen rebuilds entry.objects on every load so the chest would
      // otherwise come back like a zombie.
      if (this.save.shrineReplacedId) {
        entry.objects = (entry.objects || []).filter(
          o => !(o.kind === 'chest' && o.id === this.save.shrineReplacedId)
        );
      }
      // Always: if this tile owns the shrine's world position, ensure the
      // shrine object is present.
      const s = this.save.shrine;
      if (
        s.x >= tx0 && s.x < tx0 + this.tileEdgeM &&
        s.y >= ty0 && s.y < ty0 + this.tileEdgeM
      ) {
        const already = (entry.objects || []).some(o => o.kind === 'shrine' && o.id === s.id);
        if (!already) {
          entry.objects = entry.objects || [];
          entry.objects.push({ kind: 'shrine', x: s.x, y: s.y, id: s.id });
        }
      }
    }
  }

  _trySpawnShrineOnTile(entry, tx, ty) {
    if (this.save.shrine) return;
    const sx = this.startWorldM.x, sy = this.startWorldM.y;
    // Find POIs (chests are pinned to POIs) on this tile that are at least
    // 200m from spawn. Walk objects, score by distance, take nearest.
    const MIN_DIST_M = 200;
    let bestIdx = -1, bestD2 = Infinity;
    const objs = entry.objects || [];
    for (let i = 0; i < objs.length; i++) {
      const o = objs[i];
      if (o.kind !== 'chest') continue;
      const dx = o.x - sx, dy = o.y - sy;
      const d2 = dx * dx + dy * dy;
      if (d2 < MIN_DIST_M * MIN_DIST_M) continue;
      if (d2 < bestD2) { bestIdx = i; bestD2 = d2; }
    }
    if (bestIdx < 0) return;
    // REPLACE the chest with the shrine at the same world position. The
    // chest id is recorded in save.shrineReplacedId so spawnInTile can
    // suppress it on every tile load (including the other tiles where
    // worldgen mirrors the same POI at the seam).
    const replaced = objs[bestIdx];
    const id = `shrine_${tx}_${ty}_${Math.round(replaced.x)}_${Math.round(replaced.y)}`;
    this.save.shrine = { id, x: replaced.x, y: replaced.y };
    this.save.shrineReplacedId = replaced.id;
    objs.splice(bestIdx, 1, { kind: 'shrine', x: replaced.x, y: replaced.y, id });
    if (typeof persistSave === 'function') persistSave(this.save);
  }

  // === Tick ===
  update(_, dtMs) {
    const dt = dtMs / 1000;
    // Ghost-mode lifecycle: the pad is held iff the player has an amulet AND
    // they're actively touching the pad. On the down-edge, snapshot the body
    // into _bodyM and let `this.playerM` become the ghost. On the up-edge,
    // collapse — restore playerM to the body and tidy ghost render state.
    const ghostEligible = !!this.save.relics?.amulet;
    const ghostHeld = ghostEligible && this._ghostPadHeld;
    if (ghostHeld && !this._bodyM) {
      this._bodyM = { x: this.playerM.x, y: this.playerM.y };
      this._ghostDistAccrue = 0;
      this._ghostCostAccrue = 0;
      this._ease = null;                  // cancel any pending GPS ease on the body
      // (No relic-icon flash — bodyPlayer.setVisible + alpha drop give the
      // visual cue that ghost mode armed.)
      this.bodyPlayer.setVisible(true);
      this.player.setAlpha(0.5);
    } else if (!ghostHeld && this._bodyM) {
      this.collapseGhost();
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
    // Keyboard movement (WASD / arrow keys) is a manual takeover — at this
    // point vx/vy reflect only keyboard input (the ghost / debug-pad joystick
    // overrides below come after), so any non-zero value means the player is
    // driving themselves. Latch off GPS for the rest of the session.
    if (vx || vy) this.disableGpsForSession();
    // Ghost-mode joystick: vec ∈ [-1,1], amulet-tier-scaled speed. Keyboard
    // movement is suppressed while the ghost is out so the two control
    // schemes don't fight. Energy is debited per cell of ghost travel —
    // amulet tier shrinks the per-cell cost (frost = 0.15/cell).
    if (this._bodyM && this.joystickVec) {
      vx = this.joystickVec.x;
      vy = this.joystickVec.y;
      speedMul = ghostSpeedMul(this.save.relics) || 8;
    } else if (this._debugPadHeld && this.debugJoystickVec) {
      // Debug pad replaces the ghost pad while save.debugControls is on:
      // drives the body directly at DEBUG_SPEED_MUL × walk speed (same
      // behaviour as the keyboard arrow keys, just touch-friendly).
      vx = this.debugJoystickVec.x;
      vy = this.debugJoystickVec.y;
      speedMul = DEBUG_SPEED_MUL;
    }
    const moving = vx || vy;
    if (moving) {
      const n = Math.hypot(vx, vy);
      const dx = (vx / n) * WALK_M_S * speedMul * dt;
      const dy = (vy / n) * WALK_M_S * speedMul * dt;
      this.playerM.x += dx;
      this.playerM.y += dy;
      if (this._bodyM) {
        // Each cell crossed accrues ghostEnergyCost(amulet) into the
        // fractional buffer; whole units come out of save.energy. Higher
        // amulet tier → smaller per-cell cost → fewer pips debited per cell.
        // Collapse on empty so the player isn't stranded with no body.
        this._ghostDistAccrue += Math.hypot(dx, dy);
        const costPerCell = ghostEnergyCost(this.save.relics) || 1;
        while (this._ghostDistAccrue >= this.cellM) {
          this._ghostDistAccrue -= this.cellM;
          this._ghostCostAccrue = (this._ghostCostAccrue || 0) + costPerCell;
          while (this._ghostCostAccrue >= 1) {
            this._ghostCostAccrue -= 1;
            if ((this.save.energy ?? 0) <= 0) {
              this.flash('too tired', this.viewCenterX, this.viewCenterY);
              this.collapseGhost();
              break;
            }
            this.save.energy = Math.max(0, (this.save.energy ?? 0) - 1);
            if (this.updateEnergyDOM) this.updateEnergyDOM();
          }
          if (!this._bodyM) break;   // collapse happened inside inner loop
        }
      }
      // Only let WASD drive facing when there's no compass heading available.
      if (this.compassDeg == null) this.facing = { x: vx, y: vy };
      this._playDirected(this.player, 'walk', vx, vy);
    } else if (this._ease) {
      // Ease playerM toward last GPS fix (easeOutCubic, 300ms).
      const u = Math.min(1, (performance.now() - this._ease.t0) / this._ease.dur);
      const e = 1 - Math.pow(1 - u, 3);
      this.playerM.x = this._ease.fromX + (this._ease.toX - this._ease.fromX) * e;
      this.playerM.y = this._ease.fromY + (this._ease.toY - this._ease.fromY) * e;
      const easeDx = this._ease.toX - this._ease.fromX;
      const easeDy = this._ease.toY - this._ease.fromY;
      if (u < 1 && (easeDx || easeDy)) {
        this._playDirected(this.player, 'walk', easeDx, easeDy);
      } else if (u >= 1) {
        this._ease = null;
        this._playDirected(this.player, 'idle');
      }
    } else {
      this._playDirected(this.player, 'idle');
    }

    // Position the body sprite at its true world offset from the ghost.
    // worldMetersToScreen does the camera-relative projection in one place;
    // inlining the math here would let it drift away from every other
    // render site if cellM / CELL_PX semantics ever change.
    if (this._bodyM) {
      const p = worldMetersToScreen(this,
        this.startWorldM.x + this._bodyM.x,
        this.startWorldM.y + this._bodyM.y);
      this.bodyPlayer.setPosition(Math.round(p.x), Math.round(p.y));
    }

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
      // Rest is a body activity — when ghost mode is out, the BODY decides
      // whether the player is indoors. Otherwise scouting a ghost into a
      // house would let the body recover without ever being there.
      const restAnchor = this._bodyM || this.playerM;
      const pWX = this.startWorldM.x + restAnchor.x;
      const pWY = this.startWorldM.y + restAnchor.y;
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
        this._restAccrueE += maxE * (dt / restS);
        const pip = Math.floor(this._restAccrueE);
        if (pip > 0) {
          this._restAccrueE -= pip;
          this.save.energy = Math.min(maxE, (this.save.energy ?? 0) + pip);
          if (this.updateEnergyDOM) this.updateEnergyDOM();
        }
      } else {
        this._restAccrueE = 0;
      }
      // Stepping on a named path stone claims it. Memoised by absolute cell
      // index so we only do the lookup once per cell-change — without this
      // every frame inside the same cell would re-walk the pathNames map.
      // Derive tile coords from the body position directly (NOT from
      // playerToWorldCell, which tracks the ghost during ghost-mode).
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
    this.facingGfx.clear();
    const fmag = Math.hypot(this.facing.x, this.facing.y);
    if (fmag > 0.001) {
      const fx = this.facing.x / fmag, fy = this.facing.y / fmag;
      // perpendicular for the base of the triangle
      const px = -fy, py = fx;
      const tip = 22; // distance from player center to arrow tip
      const base = 14; // distance from player center to arrow base midpoint
      const halfW = 6; // half-width of the base
      const cx = this.viewCenterX, cy = this.viewCenterY - 2;
      const tx = cx + fx * tip, ty = cy + fy * tip;
      const blx = cx + fx * base + px * halfW, bly = cy + fy * base + py * halfW;
      const brx = cx + fx * base - px * halfW, bry = cy + fy * base - py * halfW;
      // dark outline
      this.facingGfx.lineStyle(2, 0x000000, 0.85);
      this.facingGfx.beginPath();
      this.facingGfx.moveTo(tx, ty);
      this.facingGfx.lineTo(blx, bly);
      this.facingGfx.lineTo(brx, bry);
      this.facingGfx.closePath();
      this.facingGfx.strokePath();
      // bright yellow fill
      this.facingGfx.fillStyle(0xffd24a, 1);
      this.facingGfx.fillTriangle(tx, ty, blx, bly, brx, bry);
    }

    // Footprint trail. Each ~2m the player moves, fade existing dots by 10%
    // and drop a fresh one AT THE PLAYER'S CURRENT FEET. (Previously dropped
    // at the player's _previous_ position, which made the freshest dot trail
    // ~2m behind the sprite — the trail visibly started a body-length away
    // from the feet.) Starting alpha is 0.45 (was 0.65 — ~30% lower) so the
    // freshest dot reads as a soft press rather than ink.
    {
      // Footprints belong to the BODY — the ghost is an ethereal projection
      // and shouldn't leave prints. When ghost mode is out, anchor logic to
      // _bodyM (true body coords). When inactive, playerM IS the body.
      const bodyM = this._bodyM || this.playerM;
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
      // Camera anchor stays on playerM (= ghost while active), so footprints
      // drawn at body world coords land at the body's screen offset.
      const pWX = this.startWorldM.x + this.playerM.x;
      const pWY = this.startWorldM.y + this.playerM.y;
      for (const fp of this.footprints) {
        const sx2 = this.viewCenterX + ((fp.x + this.startWorldM.x - pWX) / this.cellM) * CELL_PX;
        // +16 lands the dot right at the sprite's feet. (Sprite scale 1.5 × 32
        // = 48, origin (.5,.5) so the sprite's nominal bottom is +24, but the
        // visible foot pixels sit several px above the bottom of the texture —
        // +16 lines up with where the shoes actually meet the ground.)
        const sy2 = this.viewCenterY + ((fp.y + this.startWorldM.y - pWY) / this.cellM) * CELL_PX + 16;
        this.footprintGfx.fillStyle(0x000000, fp.alpha);
        this.footprintGfx.fillCircle(Math.round(sx2), Math.round(sy2), 3);
      }
    }

    // Pairy chest-compass indicator. Active for 5 minutes after eating a pairy
    // (see eatSelected). Renders a magenta arrow at the viewport edge pointing
    // toward the nearest undiscovered chest, blinking at 1 Hz. Cleared once
    // the chest is opened (target appears in save.opened) or the timer expires.
    if (this.pairyCompass) {
      const opened = new Set(this.save.opened || []);
      const expired = Date.now() >= this.pairyCompass.until;
      const claimed = opened.has(this.pairyCompass.targetId);
      if (expired || claimed) {
        this.pairyCompass = null;
      } else {
        const pWX = this.startWorldM.x + this.playerM.x;
        const pWY = this.startWorldM.y + this.playerM.y;
        const dxM = this.pairyCompass.x - pWX, dyM = this.pairyCompass.y - pWY;
        const mag = Math.hypot(dxM, dyM);
        if (mag > 0.001 && Math.floor(Date.now() / 500) % 2 === 0) {
          const ux = dxM / mag, uy = dyM / mag;
          const dist = Math.min(this.viewSize / 2 - 18, 140);
          const cx = this.viewCenterX, cy = this.viewCenterY;
          const tipX = cx + ux * dist, tipY = cy + uy * dist;
          // Perpendicular for triangle base.
          const pxN = -uy, pyN = ux;
          const back = 14, halfW = 7;
          const blx2 = tipX - ux * back + pxN * halfW, bly2 = tipY - uy * back + pyN * halfW;
          const brx2 = tipX - ux * back - pxN * halfW, bry2 = tipY - uy * back - pyN * halfW;
          this.facingGfx.lineStyle(2, 0x000000, 0.8);
          this.facingGfx.beginPath();
          this.facingGfx.moveTo(tipX, tipY);
          this.facingGfx.lineTo(blx2, bly2);
          this.facingGfx.lineTo(brx2, bry2);
          this.facingGfx.closePath();
          this.facingGfx.strokePath();
          this.facingGfx.fillStyle(0xc77dff, 1);
          this.facingGfx.fillTriangle(tipX, tipY, blx2, bly2, brx2, bry2);
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
    this.drawCells();
    this.drawObjects();
    this._drawWorkProgress();
    this.updateHUD();
  }

  // Scan save.planted and bump stage on any watered crop whose 60-minute
  // hold has elapsed. After each advance the crop needs re-watering, so
  // a single tick advances each plant by at most one stage; a long-idle
  // plant catches up over subsequent waterings, not all at once.
  advanceGrowth() {
    const STAGE_HOLD_MS = 15 * 60 * 1000;   // 15 min/stage — keep in sync with interact.js + render.js
    const now = Date.now();
    let mutated = false;
    for (const p of this.save.planted || []) {
      if (!p.watered_t) continue;
      if ((p.stage ?? 0) >= MAX_GROWTH_STAGE) continue;
      if (now - p.watered_t < STAGE_HOLD_MS) continue;
      p.stage = (p.stage ?? 0) + 1;
      p.watered_t = 0;
      mutated = true;
    }
    if (mutated) persistSave(this.save);
  }

  // --- Work-progress wheel (rock-break / tree-chop / fish / defeat / catch) ---
  startWorkProgress(worldX, worldY, onComplete, durationMs = 3000, energyRefund = 0, toolSlot = null) {
    this._workProgressIcon?.remove();
    this._workProgressIcon = null;
    if (toolSlot) {
      const tier = this.save.relics?.[toolSlot]?.tier || 1;
      const html = this.gearIconHTML('relic', toolSlot, tier, 16);
      if (html) {
        const el = document.createElement('div');
        el.style.cssText = 'position:fixed;left:0;top:0;z-index:96;pointer-events:none;';
        el.innerHTML = html;
        document.body.appendChild(el);
        this._workProgressIcon = el;
      }
    }
    this._workProgress = { worldX, worldY, onComplete, durationMs, energyRefund, startT: performance.now() };
  }
  // Catch wheel: like startWorkProgress, but the TARGET CREATURE flees the
  // player at FLEE_MPS while it runs (see _drawWorkProgress). If it escapes the
  // viewport the catch FAILS (onFail) instead of completing; the wheel tracks
  // the fleeing creature. _beingCaught flags it so wanderCreatures leaves its
  // movement to the wheel.
  startCatchProgress(creature, durationMs, onComplete, onFail, toolSlot = null) {
    creature._beingCaught = true;
    const t = performance.now();
    this._workProgressIcon?.remove();
    this._workProgressIcon = null;
    if (toolSlot) {
      const tier = this.save.relics?.[toolSlot]?.tier || 1;
      const html = this.gearIconHTML('relic', toolSlot, tier, 16);
      if (html) {
        const el = document.createElement('div');
        el.style.cssText = 'position:fixed;left:0;top:0;z-index:96;pointer-events:none;';
        el.innerHTML = html;
        document.body.appendChild(el);
        this._workProgressIcon = el;
      }
    }
    this._workProgress = {
      worldX: creature.x, worldY: creature.y, onComplete, durationMs,
      energyRefund: 0, startT: t, _lastT: t, flee: creature, onFail,
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
    this.cancelWorkProgress();
  }
  _drawWorkProgress() {
    const wp = this._workProgress;
    if (!wp) return;
    const now = performance.now();
    // Fleeing catch target: it backs away from the player at FLEE_MPS while the
    // wheel runs. If it slips outside the viewport the catch fails. The wheel
    // anchor (worldX/Y) follows the creature so it stays drawn over it.
    if (wp.flee) {
      const c = wp.flee;
      const dt = Math.min(0.1, (now - (wp._lastT ?? wp.startT)) / 1000);
      wp._lastT = now;
      const px = this.startWorldM.x + this.playerM.x;
      const py = this.startWorldM.y + this.playerM.y;
      let dx = c.x - px, dy = c.y - py;
      let dist = Math.hypot(dx, dy);
      if (dist < 0.001) { dx = 1; dy = 0; dist = 1; }   // degenerate — pick a heading
      const FLEE_MPS = 2;
      c.x += (dx / dist) * FLEE_MPS * dt;
      c.y += (dy / dist) * FLEE_MPS * dt;
      wp.worldX = c.x; wp.worldY = c.y;
      // Escaped the viewport? Chebyshev distance beyond the visible half-grid.
      const halfM = (VIEW_CELLS / 2) * this.cellM;
      if (Math.abs(c.x - px) > halfM || Math.abs(c.y - py) > halfM) {
        const onFail = wp.onFail;
        this.cancelWorkProgress();         // clears _beingCaught
        if (onFail) onFail();
        return;
      }
    }
    const dur = wp.durationMs || 3000;
    const elapsed = now - wp.startT;
    if (elapsed >= dur) {
      const cb = wp.onComplete;
      this.cancelWorkProgress();
      cb();
      return;
    }
    const progress = elapsed / dur;
    const screen = this.worldMetersToScreen(wp.worldX, wp.worldY);
    const cx = Math.round(screen.x);
    const cy = Math.round(screen.y) - 9;
    const R = 9;
    const g = this._workProgressGfx;
    g.clear();
    g.fillStyle(0x000000, 0.55);
    g.fillCircle(cx, cy, R + 1);
    if (progress > 0) {
      g.lineStyle(3, 0xffffff, 0.9);
      g.beginPath();
      g.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress, false);
      g.strokePath();
    }
    if (this._workProgressIcon) {
      const gameEl = document.getElementById('game');
      const gr = gameEl.getBoundingClientRect();
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
    // Viewport corner is VIEW_CELLS/2 * √2 cells away; add a generous margin so
    // a chicken just entering the viewport is already mid-step.
    const RANGE_M = (VIEW_CELLS + 4) * this.cellM;
    const RANGE_SQ = RANGE_M * RANGE_M;
    // Pest spawn: if the player has any planted crop and there are NO wild
    // crows already near the player, spawn one off-screen every ~90 s. The
    // crow's wander loop targets the nearest crop and destroys it on contact
    // (see below). Eased from "top up to 2 every 30 s" — that relentless pump
    // made crops unfarmable: another bird arrived seconds after you dealt with
    // the last. Now the pump only backfills an emptied field, and slowly, so
    // defeating the crows near your field actually buys a quiet window.
    this._lastPestT = this._lastPestT || 0;
    if (this.save.planted && this.save.planted.length > 0 && now - this._lastPestT > 90000) {
      this._lastPestT = now;
      // Count nearby wild (non-released, not-yet-caught) crows.
      let wildCrows = 0;
      WorldGen.forEachItem('creatures', (c) => {
        if (c.kind !== 'crow') return;
        if (typeof c.id === 'string' && c.id.startsWith('released_')) return;
        if (this.save.caught.includes(c.id)) return;
        const dx = c.x - px, dy = c.y - py;
        if (dx * dx + dy * dy <= RANGE_SQ) wildCrows++;
      });
      if (wildCrows < 1) {
        const pc = this.playerToWorldCell();
        const entry = WorldGen.tileCache.get(`${WorldGen.Z}/${pc.tx}/${pc.ty}`);
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

    WorldGen.forEachItem('creatures', (c) => {
      const isTame = typeof c.id === 'string' && c.id.startsWith('released_');
      // Wandering kinds: farm + pet animals always; tame butterflies also
      // wander so they can pollinate. Crows + deer also wander when wild
      // so they can eat crops / be hunted.
      const wanders = c.kind === 'chicken' || c.kind === 'cow'
                    || c.kind === 'cat' || c.kind === 'dog'
                    || c.kind === 'crow' || c.kind === 'deer'
                    || c.kind === 'slime'
                    || (isTame && c.kind === 'butterfly');
      if (!wanders) return;
      if (this.save.caught.includes(c.id)) return;
      // Mid-catch: the catch wheel owns this creature's movement (it flees the
      // player), so the generic wander must not also drive it.
      if (c._beingCaught) return;
      const ddx = c.x - px, ddy = c.y - py;
      if (ddx * ddx + ddy * ddy > RANGE_SQ) return;
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
            this.save.energy = Math.max(0, before - 3);
            this._slimeStealAccum = (this._slimeStealAccum || 0) + (before - this.save.energy);
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
      const stepMs = STEP_MS;
      // Slimes ooze in short, lazy hops (0.6 cell) — slower drift than the
      // 1-cell stride every other creature takes.
      const stepM = c.kind === 'slime' ? STEP_M * 0.6 : STEP_M;
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
        // HP healing: if 20 min since last damage, restore to max.
        const HP_MAX = { cat: 20, dog: 40, crow: 8, deer: 15, slime: 15 };
        if (c._lastDamagedT && Date.now() - c._lastDamagedT >= 20 * 60 * 1000) {
          c._hp = HP_MAX[c.kind] ?? 10;
          c._lastDamagedT = null;
        }

        // Pet combat: tame cats hunt crows; tame dogs hunt deer + slimes.
        // Scans for the nearest valid prey within 8 cells each wander step.
        if (isTame && (c.kind === 'cat' || c.kind === 'dog')) {
          const CHASE_R = 8 * this.cellM;
          const CHASE_R2 = CHASE_R * CHASE_R;
          const PREY = c.kind === 'cat' ? new Set(['crow']) : new Set(['deer', 'slime']);
          let nearest = null, nearestD2 = CHASE_R2;
          WorldGen.forEachItem('creatures', (cr) => {
            if (!PREY.has(cr.kind)) return;
            if (cr.id?.startsWith('released_')) return;
            if (this.save.caught?.includes(cr.id)) return;
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
            if (dest.loaded && dest.type !== 3 && dest.type !== 9 && dest.type !== 11 && dest.type !== 12) {
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
            const HP_MAX = { cat: 20, dog: 40, crow: 8, deer: 15, slime: 15 };
            tgt._hp = (tgt._hp ?? HP_MAX[tgt.kind] ?? 8) - 1;
            c._hp   = (c._hp   ?? HP_MAX[c.kind]   ?? 20) - 1;
            tgt._lastDamagedT = Date.now();
            c._lastDamagedT   = Date.now();
            // Push prey away from pet; force immediate direction-change.
            tgt._fleeAngle   = Math.atan2(tgt.y - c.y, tgt.x - c.x);
            tgt._fleeUntilT  = now + 8000;   // > one wander step so flee fires
            tgt._nextChooseT = 0;            // interrupt current step immediately
            if (tgt._hp <= 0) {
              // Auto-defeat the prey — same outcome as player defeating it.
              this.save.caught = this.save.caught || [];
              if (!this.save.caught.includes(tgt.id)) {
                this.save.caught.push(tgt.id);
                const dropId = tgt.kind === 'crow' ? 'crow_feather'
                             : tgt.kind === 'deer' ? 'meat' : null;
                if (dropId) {
                  this.addToInv(dropId, 1);
                  const item = ITEM_BY_ID[dropId];
                  this.flashLoot?.(`+1 ${item?.name || dropId}`, '#a7ffb0', 1, dropId);
                } else {
                  this.flash?.('slime defeated!', this.viewCenterX, this.viewCenterY - 60);
                }
              }
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
          if (dest.loaded && (dest.type === 3 || dest.type === 9 || dest.type === 11 || dest.type === 12)) continue;
          // Scarecrow aversion (crow + deer only) — refuse any target cell
          // within 4 m of an active scarecrow. Crows/deer that wander into
          // such cells get bounced by the attempt loop until they pick a
          // different direction.
          if ((c.kind === 'crow' || c.kind === 'deer') && this.save.scarecrows && this.save.scarecrows.length) {
            const SC_R = 4 * this.cellM;
            const SC_R2 = SC_R * SC_R;
            let blocked = false;
            for (const sc of this.save.scarecrows) {
              const dxs = sc.x - tx, dys = sc.y - ty;
              if (dxs * dxs + dys * dys < SC_R2) { blocked = true; break; }
            }
            if (blocked) continue;
          }
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
        c._nextChooseT = now + stepMs;
        c._faceFlip = (c._targetX - c._startX) < 0;
      }
      const u = Math.min(1, (now - c._stepT0) / stepMs);
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
  }

  // Per-tick movement for wild crows. Three-phase state machine:
  //   PERCH      → still for 2–4.5 s
  //   FLIGHT     → one eased glide over ~800–1200 ms covering ~1–2.5 cells
  //                (slow + short — crows used to be too fast / fly too far)
  //   DESTROYING → committed to a planted crop; the crow must perch ON the
  //                crop for 2 full cycles (hopping in place) before it eats.
  // The flight target is usually picked by ORBITING the nearest crop at
  // radius ~0.75–1.75 cells (so the crow looks like it's circling, casing
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
    const committed = c._destroyCropRef &&
      c._destroyCyclesLeft > 0 && this.save.planted &&
      this.save.planted.indexOf(c._destroyCropRef) >= 0;
    for (let attempt = 0; attempt < 6 && !chosen; attempt++) {
      if (committed) {
        // Committed to a crop mid-pause — keep hopping in place ON the crop
        // so each landing counts down a cycle toward destruction.
        const ang = Math.random() * Math.PI * 2;
        const r = Math.random() * 0.3 * this.cellM;
        tx = c._destroyCropRef.x + Math.cos(ang) * r;
        ty = c._destroyCropRef.y + Math.sin(ang) * r;
      } else if (this.save.planted && this.save.planted.length) {
        // ORBIT the nearest planted crop the crow can NOTICE. Notice radius is
        // DETECT_R (~15 cells — the full on-screen sim range, so crows spot a
        // field from across the screen). They don't teleport in, though: the
        // flight-leg cap below makes them approach over several short hops, so
        // a far crow visibly flies toward the field rather than snapping onto
        // it. Deliberate pest crows (id `pest_crow_*`) keep unlimited range.
        // 30% of notice-flights collapse to a tight ring that may land on the
        // crop cell.
        const isPest = typeof c.id === 'string' && c.id.startsWith('pest_crow_');
        const DETECT_R = 15 * this.cellM;
        let nearest = null, bestD2 = isPest ? Infinity : DETECT_R * DETECT_R;
        for (const pp of this.save.planted) {
          const dx = pp.x - c.x, dy = pp.y - c.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) { bestD2 = d2; nearest = pp; }
        }
        if (nearest) {
          const landAttempt = Math.random() < 0.30;
          const radius = landAttempt
            ? Math.random() * 0.4 * this.cellM
            : (0.75 + Math.random() * 1.0) * this.cellM;
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
      // Reject targets on water / buildings / placed rocks. Same gate
      // the generic wander uses.
      const dest = this.cellAt(tx, ty);
      if (dest.loaded && (dest.type === 3 || dest.type === 9 || dest.type === 11 || dest.type === 12)) continue;
      const { cellIX, cellIY } = worldMetersToAbsCell(this, tx, ty);
      if (this.placedRockSet && this.placedRockSet.has(cellKeyFromAbsCell(cellIX, cellIY))) continue;
      // Scarecrow aversion — refuse any target within 4 m of an active scarecrow.
      if (this.save.scarecrows && this.save.scarecrows.length) {
        const SC_R2 = (4 * this.cellM) * (4 * this.cellM);
        let blocked = false;
        for (const sc of this.save.scarecrows) {
          const dxs = sc.x - tx, dys = sc.y - ty;
          if (dxs * dxs + dys * dys < SC_R2) { blocked = true; break; }
        }
        if (blocked) continue;
      }
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
    const key = wcx * 100000 + wcy;
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
        const entry = WorldGen.tileCache.get(`${WorldGen.Z}/${tx}/${ty}`);
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
    const entry = WorldGen.tileCache.get(`${WorldGen.Z}/${tx}/${ty}`);
    if (!entry || !entry.grid) {
      // Tile evicted between render and tap — shouldn't happen since the
      // chest sprite is in view, but bail rather than crash.
      this.flash('...', sx, sy);
      return;
    }
    const poiLocalCX = Math.floor((poi.x - tx * tileEdgeM) / cellM);
    const poiLocalCY = Math.floor((poi.y - ty * tileEdgeM) / cellM);
    const RADIUS_CELLS = Math.max(2, Math.ceil(25 / cellM));   // ~5 cells at 5m
    // Same walkability rule the X-mark scatter uses: skip water (3), path (8 ok),
    // roads (9, 11, 12 ok? — extraTreasures excludes 9/11/12 + 3). Match that.
    const isWalkable = (t) => !(t === 3 || t === 9 || t === 11 || t === 12);
    const candidates = [];
    for (let dy = -RADIUS_CELLS; dy <= RADIUS_CELLS; dy++) {
      for (let dx = -RADIUS_CELLS; dx <= RADIUS_CELLS; dx++) {
        const cx = poiLocalCX + dx, cy = poiLocalCY + dy;
        if (cx < 0 || cy < 0 || cx >= N || cy >= N) continue;
        // Skip the POI's own cell (chest sprite sits there).
        if (dx === 0 && dy === 0) continue;
        const t = entry.grid[cy * N + cx];
        if (!isWalkable(t)) continue;
        candidates.push({ cx, cy });
      }
    }
    if (candidates.length === 0) {
      this.flash('No room to scatter!', sx, sy);
      return;
    }
    // Shuffle (Fisher-Yates) then pick 8-12.
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    // Spec: one coin per ~5 cells of vicinity, clamped to [8, 12].
    const target = Math.max(8, Math.min(12, Math.floor(candidates.length / 5) || 8));
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
    this.flashLoot(`🪙 Scattered ${n} coins!`, '#ffd96b');
  }

  cellAt(wmx, wmy) {
    const wx = this.originPx.x + (wmx - this.startWorldM.x) / this.mPerPx;
    const wy = this.originPx.y + (wmy - this.startWorldM.y) / this.mPerPx;
    const TILE_PX = WorldGen.TILE_PX;
    const cps = TILE_PX / this.cellsPerTile;
    const tx = Math.floor(wx / TILE_PX), ty = Math.floor(wy / TILE_PX);
    const ix = Math.floor((wx - tx * TILE_PX) / cps);
    const iy = Math.floor((wy - ty * TILE_PX) / cps);
    const entry = WorldGen.tileCache.get(`${WorldGen.Z}/${tx}/${ty}`);
    const loaded = !!(entry && entry.grid);
    return { tx, ty, ix, iy, loaded, type: loaded ? entry.grid[iy * this.cellsPerTile + ix] : 0 };
  }
  catchCreature(c, sx, sy) {
    this.save.caught.push(c.id);   // keep so the creature doesn't respawn
    // Track catches by kind so loot.js chestRelicAllowedTiers can unlock the
    // cow-gated Platinum tier. (Previously read but never written — Platinum
    // was unreachable.)
    this.save.caughtKinds = this.save.caughtKinds || {};
    this.save.caughtKinds[c.kind] = (this.save.caughtKinds[c.kind] || 0) + 1;
    // If this was a player-released creature, also trim it from save.released so the
    // array doesn't grow unbounded across many release-and-recatch cycles.
    if (this.save.released) {
      const ri = this.save.released.findIndex(r => r.id === c.id);
      if (ri >= 0) this.save.released.splice(ri, 1);
    }
    // One creature → one inventory entry. Egg / milk yield happens via the
    // produce branch (tap with plant produce selected), not the catch branch.
    const yieldN = 1;
    // addToInv already persists; passing silent=true to avoid a double write.
    this.addToInv(c.kind, yieldN, true);
    persistSave(this.save);
    const item = ITEM_BY_ID[c.kind];
    // flashLoot draws the item's sprite (from the itemId arg) beside the text,
    // so the text carries the name only — no emoji standing in for the item.
    this.flashLoot(`+${yieldN} ${item?.name || c.kind}`, '#a7ffb0', 1, c.kind);
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
    this._ease = null;
    this.flash(`→ ${best.species || 'tree'} (${this._indivTreeVisited.size}/${all.length})`,
               this.viewCenterX, this.viewCenterY - 40);
  }

  teleportNextPoi() {
    this.disableGpsForSession();
    const px = this.startWorldM.x + this.playerM.x;
    const py = this.startWorldM.y + this.playerM.y;
    // Distance-based dedupe: a POI represented multiple times within ~40m of each other
    // (typical OSM duplication near tile borders) collapses to a single visit-candidate.
    // The "visit key" anchors on the FIRST chest we accept for a given ident, so subsequent
    // copies share that key in the visited set.
    const TP_DEDUPE_R2 = 40 * 40;
    const identAnchor = new Map(); // ident → {x, y} (first accepted position for this ident)
    const chestKey = (o) => {
      const ident = o.name || o.poiClass;
      if (!ident) return o.id;
      const anchor = identAnchor.get(ident);
      if (!anchor) {
        identAnchor.set(ident, { x: o.x, y: o.y });
        return `${ident}|${Math.round(o.x)}|${Math.round(o.y)}`;
      }
      // If within dedupe radius, reuse anchor's key. Otherwise treat as a separate POI.
      const dx = o.x - anchor.x, dy = o.y - anchor.y;
      if (dx*dx + dy*dy < TP_DEDUPE_R2) {
        return `${ident}|${Math.round(anchor.x)}|${Math.round(anchor.y)}`;
      }
      // Far apart — record a separate anchor under a per-position key.
      return `${ident}|${Math.round(o.x)}|${Math.round(o.y)}`;
    };
    // First press: try to find the named seed POI (e.g. Windermere Park).
    if (this._poiTpVisited.size === 0 && this._poiTpFirst) {
      WorldGen.forEachItem('objects', (o) => {
        if (o.kind !== 'chest' || o.name !== this._poiTpFirst) return;
        this._poiTpVisited.add(chestKey(o));
        this.playerM.x = o.x - this.startWorldM.x;
        this.playerM.y = o.y - this.startWorldM.y + 4;
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
    const label = best.name ? rusticifyName(best.name) : best.poiClass;
    this.flash(`→ ${label} (${best.poiClass}, ${Math.round(bestD)}m)`, this.viewCenterX, this.viewCenterY - 40);
  }

  flash(text, x, y) {
    const t = this.add.text(x, y, text, {
      font: '12px monospace', color: '#ffffff', backgroundColor: '#000a',
      padding: { x: 4, y: 2 },
    }).setOrigin(0.5, 1).setDepth(100);
    // 2 s total — per user "tooltip splash …are a little too quick". Hold the
    // text visible for the first ~70 % of the duration, then drift up + fade
    // over the remainder so the eye has time to read it before it leaves.
    const total = 2000;
    const fade = 700;
    this.tweens.add({
      targets: t, y: y - 30, alpha: 0, duration: fade, delay: total - fade,
      onComplete: () => t.destroy(),
    });
  }

  // Bigger, longer-dwelling pop for loot pickups (chest opens, treasure X, harvest, debris).
  // Brief scale-up then a slow drift + fade. Always rendered at the player's viewport center
  // so the eye doesn't have to chase it back to where the X used to be.
  // dwellMul scales the hold + fade portion (chest opens use 1.25 for a longer read).
  // iconEl: an optional pre-rendered 28px icon element. Used for forged GEAR
  // (pick / axe / armor), whose art comes from gearIconHTML rather than the
  // ITEM_BY_ID-only renderItemIcon that the `itemId` path uses.
  flashLoot(text, color = '#ffe066', dwellMul = 1, itemId = null, iconEl = null) {
    const x = this.viewCenterX, y = this.viewCenterY - 90;
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
    const t = this.add.text(x, y, text, {
      font: 'bold 22px monospace', color, backgroundColor: '#000c',
      stroke: '#000', strokeThickness: 3,
      padding: { left: 10 + RESERVE, right: 10, top: 5, bottom: 5 },
    }).setOrigin(0.5, 1).setDepth(101).setScale(0.6).setAlpha(0);
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
        const r = gameEl.getBoundingClientRect();
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
    // Pop in (140ms), hold (1.44s * dwellMul), drift up + fade (700ms * dwellMul).
    this.tweens.add({ targets: t, scale: 1.0, alpha: 1, duration: 140, ease: 'Back.Out' });
    this.tweens.add({ targets: t, y: y - 50, alpha: 0,
      duration: Math.round(700 * dwellMul), delay: Math.round(1440 * dwellMul),
      ease: 'Sine.In', onComplete: () => t.destroy() });
  }

  // Jackpot fanfare for rarity.js' boost-chain rewards. Fires on any jackpot
  // (+1 or larger) since rarity.js now gates the geometric chain at a low
  // jackpotEntryP (~16%) so each fanfare feels earned. Call AFTER flashLoot
  // — stacks above the loot pop at depth 110.
  flashJackpot(n) {
    if (!n || n < 1) return;
    if (!this.add) return;
    const x = this.viewCenterX, y = this.viewCenterY - 140;
    try {
      const label = `✨ JACKPOT +${n} ✨`;
      const t = this.add.text(x, y, label, {
        font: 'bold 26px monospace', color: '#ffd866',
        backgroundColor: '#3a1f5a', stroke: '#000', strokeThickness: 4,
        padding: { left: 14, right: 14, top: 6, bottom: 6 },
      }).setOrigin(0.5, 1).setDepth(110).setScale(0.2).setAlpha(0);
      this.tweens.add({ targets: t, scale: 1.1, alpha: 1, duration: 220, ease: 'Back.Out' });
      this.tweens.add({ targets: t, scale: 1.0, duration: 220, delay: 220, ease: 'Sine.InOut' });
      this.tweens.add({ targets: t, angle: 4, duration: 320, yoyo: true, repeat: 2, delay: 200, ease: 'Sine.InOut' });
      this.tweens.add({ targets: t, y: y - 60, alpha: 0,
        duration: 700, delay: 1800, ease: 'Sine.In',
        onComplete: () => t.destroy() });
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const sx = x + Math.cos(angle) * 12;
        const sy = y - 18 + Math.sin(angle) * 12;
        const star = this.add.text(sx, sy, '✦', {
          font: 'bold 18px monospace', color: '#ffd866',
          stroke: '#000', strokeThickness: 2,
        }).setOrigin(0.5, 0.5).setDepth(111).setAlpha(0.95);
        this.tweens.add({
          targets: star,
          x: sx + Math.cos(angle) * 70,
          y: sy + Math.sin(angle) * 70,
          alpha: 0, duration: 900, ease: 'Sine.Out',
          onComplete: () => star.destroy(),
        });
      }
    } catch (_) {}
  }

  updateHUD() {
    // Money badge always shown.
    if (this.moneyEl) this.moneyEl.textContent = `$${this.save.money ?? 0}`;
    this.updateEnergyDOM();
    this.updateRelicRow();
    // Debug HUD: only show when GPS is unavailable or unfixed — i.e. an
    // exception case (desktop/wasd, denied permission, still acquiring).
    const gpsLive = this.gpsAvailable && this.gpsM;
    if (gpsLive) {
      this.hud.textContent = '';
      return;
    }
    const gps = this.gpsAvailable ? 'waiting' : 'wasd';
    const pc = this.playerToWorldCell();
    const lat = START_LAT + (-this.playerM.y) / METERS_PER_DEG_LAT;
    const lon = START_LON + this.playerM.x / (METERS_PER_DEG_LAT * Math.cos(START_LAT * Math.PI / 180));
    const loaded = [...WorldGen.tileCache.values()].filter(t => t.status === 'ready').length;
    this.hud.textContent =
      `${lat.toFixed(5)}, ${lon.toFixed(5)}   gps:${gps}\n` +
      `tile ${pc.tx}/${pc.ty}   tiles:${loaded}   caught:${this.save.caught.length}   plots:${this.save.planted.length}`;
  }

  // Always derive the cap from currently-equipped armor (rather than reading
  // a stale save.maxEnergy that may pre-date the latest armor change). All
  // energy reads/writes funnel through this so the UI and the writer agree.
  getMaxEnergy() {
    const fromArmor = (typeof maxEnergyFromArmor === 'function')
      ? maxEnergyFromArmor(this.save.armor) : null;
    if (fromArmor != null) { this.save.maxEnergy = fromArmor; return fromArmor; }
    return this.save.maxEnergy ?? STARTING_ENERGY;
  }

  // Convert a wall-time gap (since the previous lastSeenAt) into energy and
  // restore it. Called from create() and the visibilitychange handler so the
  // same formula serves both "tab was closed" and "tab was backgrounded".
  applyOfflineRest(gapMs) {
    if (!(gapMs > 0)) return;
    const maxE = this.getMaxEnergy();
    const restored = Math.floor(maxE * (gapMs / OFFLINE_FULL_REST_MS));
    if (restored <= 0) return;
    const before = this.save.energy ?? 0;
    this.save.energy = Math.min(maxE, before + restored);
    const gained = this.save.energy - before;
    if (gained > 0 && this.updateEnergyDOM) this.updateEnergyDOM();
  }

  updateEnergyDOM() {
    const el = document.getElementById('energy');
    if (!el) return;
    const cur = Math.max(0, this.save.energy ?? 0);
    const max = this.getMaxEnergy();
    const pct = max > 0 ? cur / max : 0;
    const color = pct > 0.5 ? '#a7ffb0' : (pct > 0.25 ? '#ffe066' : '#ff8a7a');
    el.style.color = color;
    el.style.borderColor = pct > 0.25 ? '#4a8c4a' : '#a04040';
    el.textContent = `⚡${cur}/${max}`;
  }

  // Spend energy if the player has enough, returning true on success.
  // Callers (interact.js handlers) refuse the action when this returns false.
  spendEnergy(cost, sx, sy) {
    if (cost <= 0) return true;
    if ((this.save.energy ?? 0) < cost) {
      if (sx != null && sy != null) this.flash('too tired', sx, sy);
      return false;
    }
    this.save.energy = Math.max(0, (this.save.energy ?? 0) - cost);
    this.updateEnergyDOM();
    return true;
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

  eatSelected() {
    const sel = getSelectedSlot(this.save);
    if (!sel || (sel.count ?? 0) <= 0) return false;
    const restore = FOOD_ENERGY[sel.id];
    if (restore == null) return false;
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
          until: Date.now() + 5 * 60 * 1000 };
        extra = `\n🧭 chest compass: 5 min`;
      } else {
        extra = `\n🧭 no chests nearby`;
      }
    } else if (sel.id === 'rainberry') {
      const watered = this.waterCropsWithin(20);
      extra = watered > 0 ? `\n💧 watered ${watered} crop${watered === 1 ? '' : 's'}` : '\n💧 no crops nearby';
    }
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
    const opened = new Set(this.save.opened || []);
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
    const r2 = radius * radius;
    let n = 0;
    for (const p of (this.save.planted || [])) {
      const dx = p.x - pWX, dy = p.y - pWY;
      if (dx * dx + dy * dy > r2) continue;
      if ((p.stage ?? 0) >= (typeof MAX_GROWTH_STAGE !== 'undefined' ? MAX_GROWTH_STAGE : 4)) continue;
      if (p.watered_t) continue;
      p.watered_t = Date.now();
      n++;
    }
    return n;
  }

  // Shared factory for all modal overlays. Returns { wrap, box, mount, mkBtn }.
  //   onClose — if provided, backdrop click (tap on wrap outside box) removes
  //             the modal and calls onClose(). Pass () => {} for no-op backdrop.
  //   mkBtn(label, primary, disabled) — standardised button factory reused by
  //             every modal so styling stays consistent site-wide.
  makeModalShell(id, { zIndex = 50, minWidth = 230, maxWidth = 320, borderColor = '#c8a64a',
    textAlign = 'center', wrapBg = '#0008', wrapExtra = '', boxExtra = '', onClose } = {}) {
    document.getElementById(id)?.remove();
    const wrap = document.createElement('div');
    wrap.id = id;
    wrap.style.cssText =
      `position:absolute;inset:0;z-index:${zIndex};display:flex;align-items:center;justify-content:center;` +
      `background:${wrapBg};pointer-events:auto;${wrapExtra}`;
    const box = document.createElement('div');
    box.style.cssText =
      `min-width:${minWidth}px;max-width:${maxWidth}px;background:#1a1612;color:#fff;` +
      `border:2px solid ${borderColor};border-radius:10px;padding:14px 16px;` +
      `font:13px ui-monospace,monospace;` +
      (textAlign ? `text-align:${textAlign};` : '') +
      boxExtra;
    if (onClose !== undefined) {
      wrap.addEventListener('click', (e) => { if (e.target === wrap) { wrap.remove(); onClose?.(); } });
    }
    const mount = () => { wrap.appendChild(box); (document.getElementById('game') || document.body).appendChild(wrap); };
    const mkBtn = (label, primary = true, disabled = false) => {
      const b = document.createElement('button');
      b.innerHTML = label;
      b.style.cssText =
        `padding:8px 14px;border-radius:6px;font:700 13px ui-monospace,monospace;cursor:pointer;` +
        (primary
          ? 'background:#c8a64a;color:#1a1612;border:0;'
          : 'background:transparent;color:#ddd;border:2px solid #444;');
      if (disabled) { b.disabled = true; b.style.opacity = '0.4'; b.style.cursor = 'not-allowed'; }
      return b;
    };
    return { wrap, box, mount, mkBtn };
  }

  // Simple OK-button modal for ambient game messages (eat effects, status, etc.).
  showMessageModal({ title, body, okLabel = 'OK' }) {
    document.getElementById('offer-modal')?.remove();
    const { wrap, box, mount, mkBtn } = this.makeModalShell('message-modal', { zIndex: 60, onClose: () => {} });
    const safeBody = String(body).replace(/\n/g, '<br>');
    box.innerHTML =
      `<div style="opacity:.85;font-size:13px;margin-bottom:8px;color:#ffe066">${title}</div>` +
      `<div style="margin:6px 0 12px;white-space:pre-wrap">${safeBody}</div>`;
    const btn = mkBtn(okLabel);
    btn.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); });
    box.appendChild(btn);
    mount();
  }

  // Stats / Relics menu — shows energy and every equipped relic / armor slot.
  showStatsModal() {
    const { wrap, box, mount, mkBtn } = this.makeModalShell('stats-modal', { zIndex: 55, minWidth: 260, maxWidth: 340, textAlign: null, onClose: () => {} });
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
        return `${base} (cap ${stackCapForBags({ tier: tierOrZero })})`;
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
      `<div style="text-align:center;color:#ffe066;font-weight:700;margin-bottom:6px">Stats &amp; Relics</div>` +
      `<div style="text-align:center;margin-bottom:10px">⚡ Energy: <b>${cur}</b> / ${max}</div>` +
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
      title: 'The farmhand offers a scarecrow:',
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

  buildingFlavorTitle(house, action) {
    const isCastle = !!house && (house.kind === 'tower' || house.tier === 12);
    const isFort   = !!house && house.tier === 11;
    const st = (!isCastle && !isFort && house && typeof Shops !== 'undefined')
      ? Shops.shopType(house) : null;
    if (action === 'forge')   return 'The blacksmith will forge:';
    if (action === 'relic') {
      if (isCastle) return "The castle's vault holds:";
      if (isFort)   return 'The fort quartermaster offers a relic:';
      return 'A villager offers a relic:';
    }
    // 'buy'
    if (isCastle) return "From the castle's vault:";
    if (isFort)   return 'The fort quartermaster offers:';
    if (st === 'market')     return 'The market has fresh stock:';
    if (st === 'trader')     return 'The trader proposes a barter:';
    if (st === 'blacksmith') return 'The blacksmith has on hand:';
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
    // Castle → its corrupt post-apocalyptic residents demand a one-time tribute
    // before they'll open the vault (the same locked-until-paid gate the wreck
    // houses use, one tier up).
    if (house && this._isCastleUnappeased && this._isCastleUnappeased(house)) {
      this.presentCastleTributeModal(sx, sy, house);
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
    // The starter blacksmith overrides the address-derived shop role so the
    // forge branch below fires regardless of the underlying house number.
    const shopType = isStarterSmith ? 'blacksmith' : Shops.shopType(house);
    const isFort = !!house && house.tier === 11;
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
    // Markets skip the 10% relic-swap; the market shop kind is dedicated.
    if (!shopType && Math.random() < 0.10) {
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
    const sellsProduce = (shopType === 'market')
      || (houseSeed && ((houseSeed * 2654435761) >>> 0) % 10 < 3);
    let id;
    if (sellsProduce) {
      // Cycle through produce, weighted toward the buyIndex so it still rotates.
      const produceIds = Object.keys(CROP_ROW);
      id = produceIds[((this.save.buyIndex ?? 0) + (houseSeed >>> 8)) % produceIds.length];
    } else {
      id = BUY_LIST[(this.save.buyIndex ?? 0) % BUY_LIST.length];
    }
    const baseValue = PRICES[id] ?? 1;
    const item = ITEM_BY_ID[id];
    // Markets are cash-only storefronts — they SELL produce for money. Barter
    // is reserved for the dedicated 'trader' shop kind (presentTraderOffer
    // above). Plain houses still roll the mixed money/barter offer.
    const offer = this.buildShopOffer(id, baseValue, { forceMoney: shopType === 'market' });
    if (!offer) {
      this.flash('no deal', sx, sy);
      return;
    }
    this.showOfferModal({
      title: this.buildingFlavorTitle(house, 'buy'),
      get: `${this.iconSpanHTML(id)} ${item?.name || id} ×1`,
      cost: offer.label,
      canAfford: offer.canAfford(),
      onAccept: () => {
        if (!offer.canAfford()) { this.flash(offer.shortDenial, sx, sy); return; }
        offer.consume();
        this.addToInv(id, 1);
        this.save.buyIndex = (this.save.buyIndex ?? 0) + 1;
        recordDeal();
        persistSave(this.save);
        this.buildInventoryDOM();
        // Use the loud loot pop so a purchase reads as a real gain.
        // Sprite shows the bought item — drop the item-icon emoji.
        this.flashLoot(`🪙 ${item?.name || id}\n${offer.shortGain}`, '#ffe066', 1, id);
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
    // A synthetic trailer from a prior session — restore it and lock in.
    if (this.save.starterTrailer && this.save.starterShopId === this.save.starterTrailer.id) {
      this.ensureStarterTrailerObject();
      this._starterShopOk = true;
      return;
    }
    // Anchor on the player's real position: their GPS fix (gpsM, in playerM's
    // frame). Sandbox / debug-control sessions have no GPS — fall back to the
    // player's current position so Home still resolves.
    const anchor = this.gpsM
      || ((this._sandboxMode || this.save.debugControls) ? this.playerM : null);
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
    if (cur != null && curFound) { this._starterShopOk = true; return; }
    // A house is visible on-screen → adopt the nearest one as the trailer.
    if (nearestId != null) {
      this.save.starterShopId = nearestId;
      this.save.starterTrailer = null;         // drop any prior synthetic trailer
      this._starterShopOk = true;
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
      const t = WorldGen.tileCache.get(`${WorldGen.Z}/${tx}/${ty}`);
      return t && (!t.status || t.status === 'ready');
    };
    for (const ox of [-HALF_VIEW_M, HALF_VIEW_M])
      for (const oy of [-HALF_VIEW_M, HALF_VIEW_M])
        if (!tileReadyAt(ox, oy)) return;        // a viewport tile is still streaming — wait
    // Drop a trailer under the player.
    this._makeStarterTrailer(ax, ay);
    this.save.starterShopId = this.save.starterTrailer.id;
    this._starterShopOk = true;
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
    const entry = WorldGen.tileCache.get(`${WorldGen.Z}/${tx}/${ty}`);
    if (!entry || !entry.objects) return;      // owning tile not loaded yet
    for (const o of entry.objects) { if (o.id === obj.id) return; }   // already in
    entry.objects.push(obj);
  }

  // Wooden-tool blacksmith. The house closest to Home (the starter shop)
  // is forced to be a Blacksmith that forges T1 pick / axe / hoe out of
  // a flat 5 wood each (see starterBlacksmithRecipe).
  // Memoized once like starterShopId so reloads + roaming keep the same shop.
  // Falls through to the normal random-relic forge once all three wooden
  // tools have been crafted — the smithy keeps doing useful business.
  isStarterBlacksmith(house) {
    if (!house || !house.id) return false;
    if (this.save.starterBlacksmithId == null) {
      const id = this.findStarterBlacksmithId();
      if (id) this.save.starterBlacksmithId = id;
    }
    return this.save.starterBlacksmithId === house.id;
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
  // Stable per-house RNG keyed only on house.id. Differs from shopRng (which
  // rotates with the deal bucket) — the wanted-produce list shouldn't shift
  // out from under the player when the shop's hour resets.
  wantedProduceRng(house) {
    let h = 2166136261 >>> 0;
    const s = String(house?.id || '');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    let state = h;
    return () => {
      state = (Math.imul(state, 0x9e3779b1) + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
      t ^= (t + Math.imul(t ^ (t >>> 7), t | 61)) >>> 0;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 2-3 produce ids this plain house is willing to buy at full price. Picked
  // once and cached on the house object so the render-loop sign and the
  // interact handler agree without re-rolling.
  wantedProduce(house) {
    if (!house?.id) return [];
    if (house._wantedProduce) return house._wantedProduce;
    const universe = (typeof ITEMS !== 'undefined')
      ? ITEMS.filter(i => i.kind === 'produce').map(i => i.id)
      : [];
    if (!universe.length) return [];
    const rng = this.wantedProduceRng(house);
    const count = 2 + Math.floor(rng() * 2);  // 2 or 3
    const pool = universe.slice();
    const picks = [];
    while (picks.length < count && pool.length) {
      const idx = Math.floor(rng() * pool.length);
      picks.push(pool.splice(idx, 1)[0]);
    }
    house._wantedProduce = picks;
    return picks;
  }

  // Delivery interaction. Plain houses buy a SET — they want one of EACH of
  // their 2-3 wanted produce, delivered together. Tap with the full set in
  // your bags → deliver 1 of each per set for the summed full price (no sword
  // sellMul, no specialty bonus); the quantity selector lets you turn in
  // multiple complete sets at once. Tap without the full set → flash the
  // wanted icons so the player can see what to gather. Selling a single item
  // type isn't accepted here; that keeps plain houses distinct from markets.
  presentDeliveryOffer(sx, sy, house, recordDeal) {
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
    // Price of one complete set = sum of each wanted item's full price.
    const setPrice = wanted.reduce((sum, id) => sum + Math.max(1, PRICES[id] ?? 1), 0);
    const fmt = (q) => ({
      get: `+$${setPrice * q}`,
      cost: `${q}× [ ${setIcons} ]`,
      canAfford: true,
    });
    const first = fmt(1);
    this.showOfferModal({
      title: 'The household wants the full set:',
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
  _shopBucketOffset(houseId) {
    // FNV-1a 32-bit on the id string, modulo 1h. Fast and uniform.
    let h = 2166136261 >>> 0;
    const s = String(houseId);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % (60 * 60 * 1000);
  }
  _shopBucket(houseId, now = Date.now()) {
    return Math.floor((now + this._shopBucketOffset(houseId)) / (60 * 60 * 1000));
  }
  // Per-house deal-rate ladder. Mirrors the cap math used inside
  // shopInteract — extracted so the renderer's ready/timer indicator and the
  // tap handler can both pull it from one place without divergence.
  //   castle / tower     → Infinity (relics only — never busy)
  //   starter blacksmith → Infinity (first tools shouldn't gate on an hour)
  //   fort (tier 11)     → 5 deals / hour
  //   small house        → 1 deal  / hour
  shopDealCap(house) {
    if (!house) return Infinity;
    if (house.kind === 'tower' || house.tier === 12) return Infinity;
    if (this.isStarterBlacksmith(house)) return Infinity;
    if (house.tier === 11) return 5;
    return 1;
  }
  // Snapshot a house's readiness. `ready` is true if a new deal would be
  // accepted right now; `waitMin` is how many wall-clock minutes until the
  // next bucket if not. Returns `{ dealCap, ready, waitMin }`.
  shopReadiness(house) {
    const dealCap = this.shopDealCap(house);
    if (dealCap === Infinity || !house || !house.id) {
      return { dealCap, ready: true, waitMin: 0 };
    }
    const cur = this.shopBucketState(house);
    if (cur.deals < dealCap) return { dealCap, ready: true, waitMin: 0 };
    const now = Date.now();
    const offset = this._shopBucketOffset(house.id);
    const nextBucketStart = (cur.bucket + 1) * 60 * 60 * 1000 - offset;
    const waitMin = Math.max(1, Math.ceil((nextBucketStart - now) / 60000));
    return { dealCap, ready: false, waitMin };
  }
  // Returns the live { bucket, deals, rerolls } record for a house, creating
  // it and GC-ing any stale-bucket predecessor on the way. Self-cleaning, so
  // we never need a separate sweep.
  shopBucketState(house) {
    this.save.shopState = this.save.shopState || {};
    const id = house.id;
    const bucket = this._shopBucket(id);
    let cur = this.save.shopState[id];
    if (cur && cur.bucket !== bucket) cur = null;
    if (!cur) {
      cur = { bucket, deals: 0, rerolls: 0 };
      this.save.shopState[id] = cur;
    }
    return cur;
  }
  // Deterministic 0..1 RNG keyed by (house.id, bucket, rerolls, lane). `lane`
  // namespaces independent rolls within the same bucket — pass 'relic-pick',
  // 'shop-offer-id', etc. so the price RNG can't accidentally consume the
  // pool-pick RNG.
  shopRng(house, lane = '') {
    const cur = this.shopBucketState(house);
    let h = ((this._shopBucketOffset(house.id) >>> 0)
           ^ (cur.bucket >>> 0)
           ^ ((this.save.offerSalt || 0) >>> 0)
           ^ Math.imul(cur.rerolls + 1, 0x9e3779b1)) >>> 0;
    for (let i = 0; i < lane.length; i++) {
      h ^= lane.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    let s = h;
    return () => {
      s = (Math.imul(s, 0x9e3779b1) + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
      t ^= (t + Math.imul(t ^ (t >>> 7), t | 61)) >>> 0;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
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
    // Armor pieces (helmet / chest / legs / boots) are conceptually part
    // of the relic family — the player thinks of every wearable upgrade
    // as "a relic." They're split across save.relics and save.armor only
    // because armor has the separate max-energy bonus to compute.
    //
    // For offer balance we want the 4 armor SLOTS to get equal airtime
    // with the 12 non-armor RELIC SLOTS — without this normalisation the
    // candidate pool is 84 relic-candidates vs 28 armor-candidates and
    // armor surfaces only ~22-25% of the time. Players reported castle
    // visits "never" showing armor; this normalisation puts the two
    // pools at ~50% each by total weight. Inside each pool we still
    // bias toward low tiers (weight ∝ 1 / 2^(tier-1)) so early game
    // sees mostly wood/copper offers.
    const candidates = [];
    const consider = (kind, slot, currentTier) => {
      for (const t of MATERIAL_TIERS) {
        if (t.tier <= currentTier) continue;
        candidates.push({ kind, slot, tier: t.tier });
      }
    };
    for (const slot of Object.keys(RELIC_DEFS))  consider('relic', slot, this.save.relics?.[slot]?.tier ?? 0);
    for (const slot of Object.keys(ARMOR_DEFS)) consider('armor', slot, this.save.armor?.[slot]?.tier  ?? 0);
    if (!candidates.length) return null;
    const tierW = (t) => 1 / Math.pow(2, t - 1);
    const relicSum = candidates.filter(c => c.kind === 'relic').reduce((a, c) => a + tierW(c.tier), 0);
    const armorSum = candidates.filter(c => c.kind === 'armor').reduce((a, c) => a + tierW(c.tier), 0);
    const relicNorm = relicSum > 0 ? 1 / relicSum : 0;
    const armorNorm = armorSum > 0 ? 1 / armorSum : 0;
    const weighted = candidates.map(c => ({
      c,
      w: (c.kind === 'relic' ? relicNorm : armorNorm) * tierW(c.tier),
    }));
    const total = weighted.reduce((a, b) => a + b.w, 0);
    let r = rng() * total;
    let pick = weighted[weighted.length - 1].c;
    for (const w of weighted) { r -= w.w; if (r <= 0) { pick = w.c; break; } }
    // Pricing:
    //   Default — random markup in 1.2..3.0× base (regular shops, smithy).
    //   Castle  — flat 4.0× base "exorbitant" markup, discounted by the
    //             player's best bow/staff tier. f = 1 - t/7 → at T7 the
    //             markup collapses to 1.0× (par); at T0 it's the full 4.0×.
    //             User: "always 400% base minus weapon bonus".
    const baseP = gearPrice(pick.kind, pick.slot, pick.tier);
    let mul;
    if (opts.isCastle) {
      const f = 1 - ((typeof bestWeaponTier === 'function') ? bestWeaponTier(this.save.relics) : 0) / 7;
      mul = 1 + 3 * f;                // T0 → 4.0×, T7 → 1.0×
    } else {
      mul = 1.2 + rng() * 1.8;        // existing random range
    }
    const price = Math.max(1, Math.ceil(baseP * mul));
    return { ...pick, price };
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
    this.showOfferModal({
      title: this.buildingFlavorTitle(house, 'relic'),
      get: `${iconHtml} ${name}`,
      blurb,
      cost: `$${offer.price}`,
      canAfford: (this.save.money ?? 0) >= offer.price,
      acceptLabel: 'Buy',
      onAccept: () => {
        // Last-chance downgrade guard — by the time the player taps Buy, the
        // slot may have been upgraded elsewhere (chest reward, another shop).
        const curTier = offer.kind === 'relic'
          ? (this.save.relics?.[offer.slot]?.tier ?? 0)
          : (this.save.armor?.[offer.slot]?.tier ?? 0);
        if (offer.tier <= curTier) { this.flash('Already carry a finer one.', sx, sy); return; }
        if ((this.save.money ?? 0) < offer.price) { this.flash(`Coin purse won't stretch — need $${offer.price}.`, sx, sy); return; }
        addMoney(this.save, -offer.price);
        if (offer.kind === 'relic') {
          this.save.relics[offer.slot] = { tier: offer.tier };
        } else {
          this.save.armor[offer.slot] = { tier: offer.tier };
          const newMax = maxEnergyFromArmor(this.save.armor);
          const bump = Math.max(0, newMax - this.getMaxEnergy());
          this.save.maxEnergy = newMax;
          this.save.energy = Math.min(newMax, (this.save.energy ?? 0) + bump);
        }
        this.markRelicsDirty();
        recordDeal();
        persistSave(this.save);
        this.updateHUD();
        this.flashLoot(`🪙 ${name}\n−$${offer.price}`, '#ffe066', 1.25);
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
  blacksmithRecipe(kind, slot, tier) {
    if (!tier) return null;
    const JEWELRY_GEM = { ring: 'ruby', staff: 'emerald', amulet: 'sapphire' };
    // T1 wooden tools use plain wood (no bar). T2+ use the matching metal
    // bar. Jewelry starts at T2 — no wooden jewelry recipe at T1.
    const BAR_BY_TIER = [, 'wood', 'copper_bar', 'iron_bar', 'gold_bar', 'platinum_bar', 'crimson_bar', 'frost_bar'];
    const bar = BAR_BY_TIER[tier];
    if (!bar) return null;
    if (JEWELRY_GEM[slot]) {
      // No wooden jewelry — T1 jewelry isn't craftable at the smithy.
      if (tier < 2) return null;
      // Geometric gem ramp: 1, 2, 4, 8, 16, 32 from T2..T7.
      const gemQty = Math.pow(2, tier - 2);
      return [
        { id: JEWELRY_GEM[slot], qty: gemQty },
        { id: bar, qty: 1 },
      ];
    }
    return [{ id: bar, qty: Math.max(5, tier) }];
  }

  // Bar smelting recipes — only T5+ bars can be smelted; T2-T4 are mined.
  // Returns null for non-smeltable bars. UI flow for smelting is a separate
  // pass (smith offer presents smelting if player has the ingredients).
  smeltingRecipe(barId) {
    const RECIPES = {
      platinum_bar: [{ id: 'sunflower',    qty: 1 }, { id: 'gold_bar',     qty: 1 }],
      crimson_bar:  [{ id: 'fireflower',   qty: 1 }, { id: 'platinum_bar', qty: 1 }],
      frost_bar:    [{ id: 'iceflower',    qty: 1 }, { id: 'crimson_bar',  qty: 1 }],
    };
    return RECIPES[barId] || null;
  }

  // ─── Magic Crafting Shrine ───────────────────────────────────────
  // The shrine is a per-game upgradable altar spawned near the player's
  // start. Tap it to either (a) level it up by paying a harvest bundle of
  // 5× three items at the next tier, or (b) trade a flower/produce for a
  // matching bar using one of the transforms unlocked so far.
  //
  // Each level unlocks one new produce → bar transform. shrineLevel is the
  // CURRENT level (capped at 7); shrineLevelUpCost(level) returns the cost
  // to advance ABOVE that level.

  // Cost to advance from `level` to `level + 1`. Always 5 × 3 distinct items
  // at the same tier as the level you're currently sitting at.
  shrineLevelUpCost(level) {
    // Shrine caps at L6 since the transform table now ends there (the
    // offset-by-1 fix made iceflower→frost the endgame; L7 had nothing
    // left to unlock so it was dropped).
    if (level >= 6) return null;
    // Indexed by current level. Index 1 = the bundle to go from L1 → L2.
    // T4-T5 substitute seeds for the missing animal-byproduct slot.
    const BUNDLES = [, // 0: unused
      [{ id: 'potato',     qty: 5 }, { id: 'egg',           qty: 5 }, { id: 'coal',         qty: 5 }],  // L1→L2 (T1)
      [{ id: 'rainberry',  qty: 5 }, { id: 'milk',          qty: 5 }, { id: 'copper_bar',   qty: 5 }],  // L2→L3 (T2)
      [{ id: 'coffee',     qty: 5 }, { id: 'meat',          qty: 5 }, { id: 'iron_bar',     qty: 5 }],  // L3→L4 (T3)
      [{ id: 'sunflower',  qty: 5 }, { id: 'sunflower_seed',qty: 5 }, { id: 'gold_bar',     qty: 5 }],  // L4→L5 (T4)
      [{ id: 'fireflower', qty: 5 }, { id: 'fireflower_seed',qty:5 }, { id: 'platinum_bar', qty: 5 }],  // L5→L6 (T5)
    ];
    return BUNDLES[level] || null;
  }

  // Transforms unlocked at each level. Index = level, value = { input, output }.
  // Each transform is 1 produce → 1 bar. shrineLevel >= entry.level means
  // the player has unlocked that transform.
  // Per user: the trade table was offset by 1 — every output sat one tier
  // lower than the player expected. Whole ladder bumped up one bar tier so
  // rainberry→iron, coffee→gold, sunflower→platinum, fireflower→crimson,
  // iceflower→frost. The previously-bottom copper_bar slot is no longer a
  // shrine output (still available from mineralrocks + the blacksmith). L7
  // unlocks no new transform — L6's iceflower→frost is the endgame.
  static SHRINE_TRANSFORMS = [, // 0,1 unused
    null,                                            // L1: nothing
    { input: 'rainberry',  output: 'iron_bar' },     // L2
    { input: 'coffee',     output: 'gold_bar' },     // L3
    { input: 'sunflower',  output: 'platinum_bar' }, // L4
    { input: 'fireflower', output: 'crimson_bar' },  // L5
    { input: 'iceflower',  output: 'frost_bar' },    // L6 — endgame
  ];

  // All transforms the player currently has access to (level <= shrineLevel).
  shrineTransforms() {
    const lvl = this.save.shrineLevel || 1;
    const out = [];
    for (let i = 2; i <= Math.min(lvl, 7); i++) {
      const t = MapScene.SHRINE_TRANSFORMS[i];
      if (t) out.push({ level: i, ...t });
    }
    return out;
  }

  // Shrine tap handler. Presents a single-modal offer: either the next
  // level-up bundle (if the player has every ingredient) OR a transform
  // (if the player has matching produce selected). On the first tap with
  // no selection we show the level-up bundle path.
  shrineInteract(sx, sy, shrine) {
    if (document.getElementById('offer-modal')) return;
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
    const lvl = this.save.shrineLevel || 1;
    const sel = this.save.inv[this.save.selSlot];
    const transforms = this.shrineTransforms();

    // If the player has a matching produce selected, offer the transform.
    const matching = sel ? transforms.find(t => t.input === sel.id) : null;
    if (matching && (sel.count ?? 0) > 0) {
      const inItem = ITEM_BY_ID[matching.input];
      const outItem = ITEM_BY_ID[matching.output];
      this.showOfferModal({
        title: 'The shrine glows. Transform?',
        get: `1× ${this.iconSpanHTML(matching.output)} ${outItem?.name || matching.output}`,
        cost: `1× ${this.iconSpanHTML(matching.input)} ${inItem?.name || matching.input}`,
        canAfford: true,
        acceptLabel: 'Transform',
        onAccept: () => {
          if (heldCount(matching.input) < 1) { this.flash('Gone — already used.', sx, sy); return; }
          consume(matching.input, 1);
          this.addToInv(matching.output, 1);
          persistSave(this.save);
          this.buildInventoryDOM();
          this.flashLoot(`✨ ${outItem?.name || matching.output}`, '#a7e9ff', 1.25, matching.output);
        },
      });
      return;
    }

    // No matching produce selected — present the next level-up bundle.
    const bundle = this.shrineLevelUpCost(lvl);
    if (!bundle) {
      // Maxed out at level 7 — list the transforms.
      const lines = transforms.map(t => {
        const i = ITEM_BY_ID[t.input], o = ITEM_BY_ID[t.output];
        return `${this.iconSpanHTML(t.input)} ${i?.name} → ${this.iconSpanHTML(t.output)} ${o?.name}`;
      }).join('<br>');
      this.showOfferModal({
        title: 'Magic Crafting Shrine (Level 7)',
        get: `the shrine hums at full power`,
        blurb: `Hold a matching produce + tap to transform:<br>${lines}`,
        cost: '',
        canAfford: false,
        acceptLabel: 'Close',
        onAccept: () => {},
      });
      return;
    }

    const canAfford = bundle.every(r => heldCount(r.id) >= r.qty);
    // Cost is rendered as one row per ingredient instead of "A + B + C" on
    // one line — three "5× ICON Name" segments overflow the 340px modal width
    // and wrap mid-ingredient, splitting an icon from its label.
    const costHTML = bundle.map(r => {
      const it = ITEM_BY_ID[r.id];
      const have = heldCount(r.id);
      const ok = have >= r.qty;
      const color = ok ? '#a7ffb0' : '#ff8a7a';
      return `<div style="color:${color};margin:2px 0">`
        + `${r.qty}× ${this.iconSpanHTML(r.id)} ${it?.name || r.id}`
        + `<span style="opacity:.5;font-size:11px;margin-left:6px">(have ${have})</span>`
        + `</div>`;
    }).join('');
    const transformsBlurb = transforms.length
      ? `Unlocked: ${transforms.map(t => `${ITEM_BY_ID[t.input]?.name}→${ITEM_BY_ID[t.output]?.name}`).join(' · ')}`
      : 'No transforms unlocked yet.';
    this.showOfferModal({
      title: `Magic Crafting Shrine (Level ${lvl})`,
      get: `Advance to Level ${lvl + 1}`,
      blurb: transformsBlurb,
      cost: costHTML,
      canAfford,
      acceptLabel: 'Offer',
      onAccept: () => {
        if (!bundle.every(r => heldCount(r.id) >= r.qty)) {
          const missing = bundle.find(r => heldCount(r.id) < r.qty);
          const it = ITEM_BY_ID[missing.id];
          this.flash(`need ${missing.qty} ${it?.name || missing.id}`, sx, sy);
          return;
        }
        for (const r of bundle) consume(r.id, r.qty);
        this.save.shrineLevel = (this.save.shrineLevel || 1) + 1;
        persistSave(this.save);
        this.buildInventoryDOM();
        const newLvl = this.save.shrineLevel;
        const newTransform = MapScene.SHRINE_TRANSFORMS[newLvl];
        const unlockMsg = newTransform
          ? `Unlocked: ${this.iconSpanHTML(newTransform.input)} ${ITEM_BY_ID[newTransform.input]?.name} → ${this.iconSpanHTML(newTransform.output)} ${ITEM_BY_ID[newTransform.output]?.name}`
          : 'the shrine hums at full power';
        // 64×85 fountain frame for the new level (row-major over 4×2 grid,
        // 48×64 each — scaled up 1.78× for the big icon slot). newLvl tops out
        // at 6 (shrineLevelUpCost returns null past L5), so frame is 1..5 —
        // well inside the 8-frame (0..7) sheet. Clamp to the L6 cap defensively.
        const frame = Math.min(6, newLvl) - 1;
        const fcol = frame % 4, frow = Math.floor(frame / 4);
        const ICON_SIZE = 96;            // big icon slot in the reward modal
        const SCALE = ICON_SIZE / 48;    // scale the 48-wide frame up to ICON_SIZE
        const iconHTML = `<span style="display:inline-block;width:${ICON_SIZE}px;height:${64 * SCALE}px;`
          + `background-image:url('assets/Objects/Wilderness/Water fountain.png');`
          + `background-size:${192 * SCALE}px ${128 * SCALE}px;`
          + `background-position:-${fcol * ICON_SIZE}px -${frow * 64 * SCALE}px;`
          + `image-rendering:pixelated"></span>`;
        this.showChestRewardModal({
          header: '✨ Shrine ascended ✨',
          iconHTML,
          name: `Level ${newLvl}`,
          sub: unlockMsg,
          color: '#a7e9ff',
        });
      },
    });
  }

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
    this.showOfferModal({
      title: this.buildingFlavorTitle(house, 'buy'),
      get: `${this.iconSpanHTML(offer.giveId)} ${giveItem?.name || offer.giveId} ×1`,
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
        this.addToInv(offer.giveId, 1);
        this.save.buyIndex = (this.save.buyIndex ?? 0) + 1;
        recordDeal();
        persistSave(this.save);
        this.buildInventoryDOM();
        this.flashLoot(
          `🪙 ${giveItem?.name || offer.giveId}\n−${offer.askQty} ${askItem?.name || offer.askId}`,
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
  // blue tint (render.js looks them up via _isPathStoneActive). When
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
    const tileKey = `${WorldGen.Z}/${tx}/${ty}`;
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
    const tileKey = `${WorldGen.Z}/${tx}/${ty}`;
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
        header: `${title} complete`,
        iconHTML: '<span style="font-size:48px">🪙</span>',
        name: '+$5',
        color: '#a7e9ff',
      });
      return;
    }
    if (reward.kind === 'item') {
      this.addToInv(reward.id, reward.qty);
      const item = ITEM_BY_ID[reward.id];
      const color = (typeof tierInfo === 'function' ? tierInfo(reward.id).color : '#a7e9ff');
      const iconHTML = this.iconSpanHTML ? this.iconSpanHTML(reward.id, 64) : '';
      this.showChestRewardModal({
        header: `${title} complete`,
        iconHTML,
        name: item?.name || reward.id,
        qty: reward.qty > 1 ? `× ${reward.qty}` : null,
        color,
      });
    } else if (reward.kind === 'gold') {
      addMoney(this.save, reward.amount);
      this.showChestRewardModal({
        header: `${title} complete`,
        iconHTML: '<span style="font-size:48px">🪙</span>',
        name: `+$${reward.amount}`,
        color: '#ffd96b',
      });
    } else if (reward.kind === 'relic') {
      this.save.relics[reward.slot] = { tier: reward.tier };
      this.markRelicsDirty?.();
      const relicName = (typeof gearName === 'function')
        ? gearName('relic', reward.slot, reward.tier)
        : `${reward.slot} T${reward.tier}`;
      const iconHTML = this.gearIconHTML
        ? this.gearIconHTML('relic', reward.slot, reward.tier, 64)
        : '★';
      this.showChestRewardModal({
        header: `${title} complete`,
        iconHTML,
        name: relicName,
        sub: 'equipped',
        color: '#ffe066',
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

  presentWreckRestoreModal(sx, sy, house) {
    const cost = this._wreckRestoreCost(house);
    const heldCount = ((this.save.inv || []).find(s => s && s.id === cost.id)?.count) ?? 0;
    const canAfford = heldCount >= cost.qty;
    const item = ITEM_BY_ID[cost.id];
    // "shop" if this wreck restores into a themed business, else "house".
    const isThemed =
      (this.save.starterBlacksmithId && this.save.starterBlacksmithId === house.id) ||
      !!Shops.shopType(house);   // 'blacksmith' | 'market' | 'trader' | null
    // Always show the modal — even when the player can't yet afford it,
    // they need to see WHAT to gather. Accept stays disabled (red cost
    // line, greyed button) so the dialog reads as a price tag rather
    // than a tease. The player will dismiss, go collect, come back.
    this.showOfferModal({
      title: 'Restore this wreck?',
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
        this.save.restoredHouses[house.id] = true;
        persistSave(this.save);
        this.buildInventoryDOM();
        if (this.showChestRewardModal) {
          this.showChestRewardModal({
            iconHTML: '🏠',
            name: 'A working building',
            sub: 'Tap it again to do business.',
            color: '#a7ffb0',
          });
        } else {
          this.flashLoot('🛠 restored', '#a7ffb0', 1.25);
        }
      },
    });
  }

  // True iff `house` is a castle (BUILDING_LARGE / tower) whose corrupt
  // residents haven't been paid their one-time tribute yet. The castle analogue
  // of _isHouseWreck. Id-less castles (rare — no stable key to record payment
  // against) skip the gate and trade normally rather than re-demanding forever.
  _isCastleUnappeased(house) {
    if (!house || !house.id) return false;
    const isCastle = house.kind === 'tower' || house.tier === 12;
    if (!isCastle) return false;
    return !this.save.tributedCastles?.[house.id];
  }

  // The tribute a castle demands before it'll trade: a stable-random Tier-2
  // good keyed on the castle id (so it never reshuffles between visits). 10 of
  // the item — or just 5 when it's a live animal (livestock is dearer). Seeds
  // are excluded from the pool; the residents want goods, not a seed pouch.
  _castleTribute(house) {
    const pool = (typeof ITEMS !== 'undefined')
      ? ITEMS.filter(it => it.baseTier === 2 && it.kind !== 'seed')
      : [];
    if (!pool.length) return { id: 'rainberry', qty: 10, name: 'Rainberry' };
    // FNV-1a over the id → stable pick (same hash style as wantedProduceRng).
    let h = 2166136261 >>> 0;
    const s = String(house?.id || '');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    const item = pool[h % pool.length];
    const qty = item.kind === 'animal' ? 5 : 10;
    return { id: item.id, qty, name: item.name || item.id };
  }

  presentCastleTributeModal(sx, sy, house) {
    const cost = this._castleTribute(house);
    const heldCount = ((this.save.inv || []).find(s => s && s.id === cost.id)?.count) ?? 0;
    const canAfford = heldCount >= cost.qty;
    const item = ITEM_BY_ID[cost.id];
    // Always show it (even when short) so the player learns WHAT to bring;
    // accept stays disabled until they hold the full stack.
    this.showOfferModal({
      title: "The castle demands tribute",
      get: '🏰 the vault opens to you',
      blurb: "Its corrupt residents won't trade until their palms are greased.",
      cost: `${cost.qty}× ${this.iconSpanHTML(cost.id)} ${item?.name || cost.name}`
        + (canAfford ? '' : ` <span style="opacity:.7">(have ${heldCount})</span>`),
      canAfford,
      acceptLabel: 'Pay tribute',
      onAccept: () => {
        // Re-check stock at accept time — the modal may have lingered while the
        // player spent the goods elsewhere.
        const idx = this.save.inv.findIndex(s => s && s.id === cost.id && (s.count ?? 0) >= cost.qty);
        if (idx < 0) { this.flash(`need ${cost.qty} ${item?.name || cost.name}`, sx, sy); return; }
        const stack = this.save.inv[idx];
        stack.count -= cost.qty;
        if ((stack.count ?? 0) <= 0) {
          this.save.inv.splice(idx, 1);
          if (this.save.selSlot >= this.save.inv.length) {
            this.save.selSlot = Math.max(0, this.save.inv.length - 1);
          }
        }
        this.save.tributedCastles = this.save.tributedCastles || {};
        this.save.tributedCastles[house.id] = true;
        persistSave(this.save);
        this.buildInventoryDOM();
        if (this.showChestRewardModal) {
          this.showChestRewardModal({
            iconHTML: '🏰',
            name: 'The vault is yours',
            sub: 'Tap the castle again to browse its relics.',
            color: '#a7ffb0',
          });
        } else {
          this.flashLoot('🏰 tribute paid', '#a7ffb0', 1.25);
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
    this.showOfferModal({
      title: this.buildingFlavorTitle(house, 'forge'),
      get: `${iconHtml} ${name}`,
      cost: costHTML,
      canAfford: canAfford(),
      acceptLabel: 'Trade',
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
        if (offer.kind === 'relic') {
          this.save.relics[offer.slot] = { tier: offer.tier };
        } else {
          this.save.armor[offer.slot] = { tier: offer.tier };
          const newMax = maxEnergyFromArmor(this.save.armor);
          const bump = Math.max(0, newMax - this.getMaxEnergy());
          this.save.maxEnergy = newMax;
          this.save.energy = Math.min(newMax, (this.save.energy ?? 0) + bump);
        }
        this.markRelicsDirty();
        recordDeal();
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

  // Build a shop offer for buying ${id} (baseValue = PRICES[id]).
  // 1/3 chance: shop wants 2x value in cash. 2/3: barter for an inventory item.
  // opts.forceMoney pins it to the cash branch — used by markets, which are
  // cash-only storefronts (barter is the 'trader' shop kind's job).
  // Barter threshold is 0.75× baseValue (lenient) so debris-tier wild pickups
  // qualify too — otherwise early-game players almost never see a barter, since
  // wild rockfruit/shrub/longgrass at $1-2 fall below higher thresholds.
  // If the player owns NO qualifying barter item, the shop still names what
  // they want; the modal just disables the accept button (shows "✗"). This way
  // the player learns "this shop wants rockfruit" and can come back with it.
  // (Traders take a different path in presentTraderOffer — qty-scaled barter
  // with a re-roll button.)
  buildShopOffer(id, baseValue, opts = {}) {
    const wantMoney = opts.forceMoney || Math.random() < 1/3;
    // Bow / Staff relics shrink the markup. Without either, the range stays
    // at 1.2..3.0× base; at tier 7 it collapses to a flat 1.0× (par).
    const { lo, hi } = (typeof buyMarkupRange === 'function')
      ? buyMarkupRange(this.save.relics) : { lo: 1.2, hi: 3.0 };
    const cashCost = Math.max(1, Math.ceil(baseValue * (lo + Math.random() * (hi - lo))));
    const cashOffer = {
      kind: 'money',
      label: `$${cashCost}`,
      shortGain: `−$${cashCost}`,
      shortDenial: `need $${cashCost}`,
      canAfford: () => (this.save.money ?? 0) >= cashCost,
      consume: () => { addMoney(this.save, -cashCost); },
    };
    if (wantMoney) return cashOffer;
    // Barter — find a held stack worth ≥ 0.75 × baseValue, pick one at random.
    // Exclude `id` itself from both the candidate pool and the wishlist
    // fallback: a trader who tries to swap a rockfruit FOR a rockfruit reads
    // like a bug regardless of stack sizes ("trade me an X for an X?").
    const need = baseValue * 0.75;
    const candidates = (this.save.inv || []).filter(s =>
      s && s.id && s.id !== id && (s.count ?? 0) >= 1 && (PRICES[s.id] ?? 0) >= need);
    if (!candidates.length) {
      // Player owns nothing qualifying — name a deterministic-but-varied want
      // so the offer text reads like a real ask. Pick any item priced ≥ need;
      // anchor by buyIndex so the same shop tap is stable until the player
      // earns enough buyIndex turns elsewhere to rotate it.
      const wishlist = Object.keys(PRICES).filter(k =>
        k !== id && PRICES[k] >= need && ITEM_BY_ID[k]);
      const wish = wishlist[(this.save.buyIndex ?? 0) % wishlist.length] || cashOffer;
      if (wish === cashOffer) return cashOffer;
      const wishItem = ITEM_BY_ID[wish];
      return {
        kind: 'item',
        label: `1× ${this.iconSpanHTML(wish)} ${wishItem?.name || wish}`,
        shortGain: `−1 ${wishItem?.name || wish}`,
        shortDenial: `no ${wishItem?.name || wish}`,
        canAfford: () => false,
        consume: () => {},   // never called (canAfford is false)
      };
    }
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const pickItem = ITEM_BY_ID[pick.id];
    return {
      kind: 'item',
      label: `1× ${this.iconSpanHTML(pick.id)} ${pickItem?.name || pick.id}`,
      shortGain: `−1 ${pickItem?.name || pick.id}`,
      shortDenial: `no ${pickItem?.name || pick.id}`,
      canAfford: () => {
        const cur = (this.save.inv || []).find(s => s && s.id === pick.id);
        return !!cur && (cur.count ?? 0) >= 1;
      },
      consume: () => {
        const idx = this.save.inv.findIndex(s => s && s.id === pick.id);
        if (idx < 0) return;
        const cur = this.save.inv[idx];
        cur.count -= 1;
        if (cur.count <= 0) {
          this.save.inv.splice(idx, 1);
          if (this.save.selSlot >= this.save.inv.length) {
            this.save.selSlot = Math.max(0, this.save.inv.length - 1);
          }
        }
      },
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
    const dataUrl = window.ITEM_DATA_URLS && window.ITEM_DATA_URLS[itemId];
    const src = (typeof inventoryIconSource === 'function') ? inventoryIconSource(itemId) : null;
    const base = `width:${sizePx}px;height:${sizePx}px;image-rendering:pixelated;`
      + (style === 'inline' ? 'display:inline-block;vertical-align:middle;' : 'display:inline-block;');
    let css = null;
    if (dataUrl) {
      css = base + `background-image:url('${dataUrl}');background-size:${sizePx}px ${sizePx}px;`;
    } else if (src) {
      // Sheet table — adding a new icon sheet is one entry here plus a row
      // in MINERAL_ICON_SHEET (items.js). The previous hardcoded if-else
      // silently fell through to Crops.png for any unknown sheet, so a
      // request like { sheet: 'gems', frame: 4 } rendered as rainberry
      // stage 4 (the "berry bush" the user reported on sapphire offers).
      const SHEETS = {
        crops:       { url: 'assets/Objects/Crops.png',                       cols: 9,  srcW: 144, srcH: 256 },
        springcrops: { url: 'assets/Objects/Spring Crops.png',                cols: 14, srcW: 224, srcH: 128 },
        gems:        { url: 'assets/Icons/RPG icons/Extras/Gemstones.png',    cols: 7,  srcW: 112, srcH: 64  },
        coal_icon:   { url: 'assets/Icons/RPG icons/Extras/Coal.png',         cols: 2,  srcW: 32,  srcH: 32  },
        // Bars + ores — 256×64, 16 cols × 4 rows of 16×16. Row 0 left-to-right
        // is the bar tier ladder: copper, iron, gold, platinum, crimson, frost
        // (frames 0..5). MINERAL_ICON_SHEET maps each bar id to its frame.
        // Without this entry, every bar fell through to crops.png frame 0 and
        // rendered as a grass sprout in shrine / smith trade modals.
        bars:        { url: 'assets/Icons/RPG icons/Extras/Bars and ores.png', cols: 16, srcW: 256, srcH: 64 },
        // Animal produce — 32×16 (2 frames). frame 0 = standalone item.
        icon_egg:    { url: 'assets/Icons/Food Icons/Chicken Egg.png',        cols: 2,  srcW: 32,  srcH: 16  },
        icon_milk:   { url: 'assets/Icons/Food Icons/Small Cow Milk.png',     cols: 2,  srcW: 32,  srcH: 16  },
        // Orchard fruit — 32×16 each (frame 0 = whole fruit).
        icon_apple:   { url: 'assets/Icons/Food Icons/Apple.png',             cols: 2,  srcW: 32,  srcH: 16  },
        icon_cherry:  { url: 'assets/Icons/Food Icons/Cherry.png',            cols: 2,  srcW: 32,  srcH: 16  },
        icon_peach:   { url: 'assets/Icons/Food Icons/Peach.png',             cols: 2,  srcW: 32,  srcH: 16  },
        icon_banana:  { url: 'assets/Icons/Food Icons/Banana.png',            cols: 2,  srcW: 32,  srcH: 16  },
        icon_orange:  { url: 'assets/Icons/Food Icons/Orange.png',            cols: 2,  srcW: 32,  srcH: 16  },
        icon_mango:   { url: 'assets/Icons/Food Icons/Mango.png',             cols: 2,  srcW: 32,  srcH: 16  },
        icon_coconut: { url: 'assets/Icons/Food Icons/Coconut.png',           cols: 2,  srcW: 32,  srcH: 16  },
        icon_apricot: { url: 'assets/Icons/Food Icons/Apricot.png',           cols: 2,  srcW: 32,  srcH: 16  },
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
        wood:          { url: 'assets/Objects/wood.png',                          cols: 3,  srcW: 48,  srcH: 16 },
      };
      const sheet = SHEETS[src.sheet] || SHEETS.crops;
      const col = src.frame % sheet.cols;
      const row = Math.floor(src.frame / sheet.cols);
      const scale = sizePx / 16;
      css = base + `background-image:url('${sheet.url}');`
        + `background-size:${sheet.srcW * scale}px ${sheet.srcH * scale}px;`
        + `background-position:-${col * sizePx}px -${row * sizePx}px;`;
    }
    if (style === 'block') {
      const el = document.createElement('span');
      if (css) {
        el.style.cssText = css;
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
    if (css) return `<span style="${css}"></span>`;
    return '?';
  }

  iconSpanHTML(itemId, sizePx = 20) {
    return this.renderItemIcon(itemId, sizePx, 'inline');
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
  // Collapse the ghost back into the body: restore playerM to the snapshot,
  // re-show the now-merged sprite at full opacity, hide the body double.
  // Safe to call when no ghost is active (it's a no-op).
  // Play a directional player animation on `sprite`. When dx/dy are supplied
  // (movement frame), updates this._spriteDir so the idle pose holds the last
  // walking direction. Avoids restarting the anim if the key is unchanged.
  _playDirected(sprite, baseKey, dx, dy) {
    if (dx !== undefined) {
      const d = Math.hypot(dx, dy);
      if (d > 0.001) this._spriteDir = { x: dx / d, y: dy / d };
    }
    const { x, y } = this._spriteDir;
    let dir = 'down', flip = false;
    if (Math.abs(x) > Math.abs(y)) { dir = 'side'; flip = x < 0; }
    else if (y < 0) dir = 'up';
    const key = `${baseKey}-${dir}`;
    if (sprite.anims.currentAnim?.key !== key) sprite.play(key);
    sprite.setFlipX(flip);
  }
  collapseGhost() {
    if (!this._bodyM) return;
    this.playerM.x = this._bodyM.x;
    this.playerM.y = this._bodyM.y;
    this._bodyM = null;
    this._ghostDistAccrue = 0;
    this._ghostCostAccrue = 0;
    this.bodyPlayer.setVisible(false);
    this.player.setAlpha(1);
  }
  // Show or tear down the ghost pad based on amulet ownership. Called from
  // updateRelicRow so the pad appears the moment the player first equips an
  // amulet (and disappears if they ever ditch it). Debug controls win the
  // slot — when save.debugControls is on the ghost pad is suppressed even
  // if an amulet is equipped.
  syncGhostPad() {
    const has = !!this.save.relics?.amulet && !this.save.debugControls;
    const exists = !!document.getElementById('ghost-pad');
    if (has && !exists) this.buildGhostPad();
    else if (!has && exists) this.removeGhostPad();
  }
  removeGhostPad() {
    document.getElementById('ghost-pad')?.remove();
    this.joystickVec = { x: 0, y: 0 };
    this._ghostPadHeld = false;
    if (this._bodyM) this.collapseGhost();
  }
  // Virtual analog stick — bottom-right above the inventory bar. Fixed to the
  // viewport (outside #game for the usual transform-containing-block reason).
  // Pointer events drive this.joystickVec ∈ [-1, 1]² and _ghostPadHeld;
  // update() reads both to advance the ghost while held.
  buildGhostPad() {
    this.removeGhostPad();
    const PAD = 110, NUB = 48;
    const HALF = (PAD - NUB) / 2;     // nub centred in the pad at rest
    const R = HALF;                   // max nub offset from pad centre
    const pad = document.createElement('div');
    pad.id = 'ghost-pad';
    // Sits above the inventory bar (bar bottom 48 + bar height ~54 + gap).
    // Purple tint so the player reads it as "amulet/ghost" rather than
    // generic d-pad.
    pad.style.cssText =
      `position:fixed;` +
      `bottom:calc(118px + env(safe-area-inset-bottom, 0px));` +
      // Purple tint reads as "amulet/ghost" rather than generic d-pad.
      // Right-anchored via --phone-right so the pad tucks inside the
      // simulated phone column on desktop.
      `right:calc(var(--phone-right, 0px) + 16px);width:${PAD}px;height:${PAD}px;border-radius:50%;` +
      `background:rgba(80,30,120,0.35);border:2px solid #b07adc;z-index:6;` +
      `touch-action:none;user-select:none;-webkit-user-select:none;`;
    const nub = document.createElement('div');
    nub.style.cssText =
      `position:absolute;left:${HALF}px;top:${HALF}px;` +
      `width:${NUB}px;height:${NUB}px;border-radius:50%;` +
      `background:rgba(220,180,255,0.65);border:2px solid #fff;pointer-events:none;`;
    pad.appendChild(nub);
    document.body.appendChild(pad);

    let activePtr = null;
    const reset = () => {
      activePtr = null;
      nub.style.left = `${HALF}px`;
      nub.style.top  = `${HALF}px`;
      this.joystickVec = { x: 0, y: 0 };
      this._ghostPadHeld = false;
    };
    const place = (e) => {
      const rect = pad.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top  + rect.height / 2;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const m = Math.hypot(dx, dy);
      if (m > R) { dx = dx / m * R; dy = dy / m * R; }
      nub.style.left = `${HALF + dx}px`;
      nub.style.top  = `${HALF + dy}px`;
      this.joystickVec = { x: dx / R, y: dy / R };
    };
    pad.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      activePtr = e.pointerId;
      pad.setPointerCapture(e.pointerId);
      this._ghostPadHeld = true;
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
  // Debug pad — same footprint as the ghost pad but gold-tinted, replaces
  // the ghost pad while save.debugControls is on, and drives the body
  // directly at DEBUG_SPEED_MUL × walk speed instead of activating a ghost.
  syncDebugPad() {
    const want = !!this.save.debugControls;
    const exists = !!document.getElementById('debug-pad');
    if (want && !exists) this.buildDebugPad();
    else if (!want && exists) this.removeDebugPad();
  }
  removeDebugPad() {
    document.getElementById('debug-pad')?.remove();
    this.debugJoystickVec = { x: 0, y: 0 };
    this._debugPadHeld = false;
  }
  buildDebugPad() {
    this.removeDebugPad();
    const PAD = 110, NUB = 48;
    const HALF = (PAD - NUB) / 2;
    const R = HALF;
    const pad = document.createElement('div');
    pad.id = 'debug-pad';
    // Gold tint so it reads as a dev/debug control rather than the purple
    // ghost amulet pad. Same anchor point as the ghost pad — they're
    // mutually exclusive (see syncGhostPad / syncDebugPad).
    pad.style.cssText =
      `position:fixed;` +
      `bottom:calc(118px + env(safe-area-inset-bottom, 0px));` +
      `right:calc(var(--phone-right, 0px) + 16px);width:${PAD}px;height:${PAD}px;border-radius:50%;` +
      `background:rgba(120,90,20,0.35);border:2px solid #ffd96b;z-index:6;` +
      `touch-action:none;user-select:none;-webkit-user-select:none;`;
    const nub = document.createElement('div');
    nub.style.cssText =
      `position:absolute;left:${HALF}px;top:${HALF}px;` +
      `width:${NUB}px;height:${NUB}px;border-radius:50%;` +
      `background:rgba(255,224,128,0.7);border:2px solid #fff;pointer-events:none;`;
    pad.appendChild(nub);
    document.body.appendChild(pad);

    let activePtr = null;
    const reset = () => {
      activePtr = null;
      nub.style.left = `${HALF}px`;
      nub.style.top  = `${HALF}px`;
      this.debugJoystickVec = { x: 0, y: 0 };
      this._debugPadHeld = false;
    };
    const place = (e) => {
      const rect = pad.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top  + rect.height / 2;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const m = Math.hypot(dx, dy);
      if (m > R) { dx = dx / m * R; dy = dy / m * R; }
      nub.style.left = `${HALF + dx}px`;
      nub.style.top  = `${HALF + dy}px`;
      this.debugJoystickVec = { x: dx / R, y: dy / R };
    };
    pad.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      activePtr = e.pointerId;
      pad.setPointerCapture(e.pointerId);
      this._debugPadHeld = true;
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
  // Toggle entry point wired from the ☰ menu. Persists the flag, swaps the
  // ghost pad for the debug pad (or back), and returns the new state so the
  // menu button can update its label.
  setDebugControls(on) {
    this.save.debugControls = !!on;
    persistSave(this.save);
    this.syncGhostPad();
    this.syncDebugPad();
    // Cancel any in-flight GPS ease so a fix that landed milliseconds before
    // the toggle doesn't keep dragging the player after the gold joystick
    // takes over. The startGps callback will skip future eases on its own.
    if (this.save.debugControls) this._ease = null;
    return this.save.debugControls;
  }
  // Bump _relicsGen at every site that writes save.relics / save.armor so the
  // per-frame row rebuild can early-out by comparing a counter instead of
  // recomputing a join-string of every slot every frame.
  markRelicsDirty() { this._relicsGen = (this._relicsGen || 0) + 1; }
  updateRelicRow() {
    const gen = this._relicsGen || 0;
    if (this._relicRowGen === gen) return;
    this._relicRowGen = gen;
    // Amulet → ghost mode: the pad lives or dies with the slot. Mirror it
    // here so the toggle happens the moment a buy/forge writes save.relics.
    // syncDebugPad rides along so a save with debugControls already true
    // gets its pad on first frame (the menu toggle path handles later flips).
    this.syncGhostPad();
    this.syncDebugPad();
    const relics = this.save.relics || {};
    const armor = this.save.armor || {};
    const order = ['pick','axe','sword','bow','staff','ring','amulet'];
    const armorOrder = ['helmet','chest','legs','boots'];
    document.getElementById('relic-row')?.remove();
    const ownedRelics = order.filter(s => relics[s]);
    const ownedArmor = armorOrder.filter(s => armor[s]);
    if (!ownedRelics.length && !ownedArmor.length) return;
    const row = document.createElement('div');
    row.id = 'relic-row';
    // position:fixed + appended to <body> for the same reason as the inv bar
    // (see buildInventoryDOM): a fixed element inside transformed #game would
    // anchor to #game, not the viewport.
    row.style.cssText = 'position:fixed;top:calc(42px + env(safe-area-inset-top, 0px));right:calc(var(--phone-right, 0px) + 8px);display:flex;gap:4px;padding:4px 6px;background:#000a;border-radius:8px;z-index:7;pointer-events:none;';
    const addIcon = (kind, slot, tier) => {
      const wrap = document.createElement('span');
      wrap.style.cssText = 'display:inline-block;line-height:0;';
      wrap.innerHTML = this.gearIconHTML(kind, slot, tier, 20);
      row.appendChild(wrap);
    };
    for (const slot of ownedRelics) addIcon('relic', slot, relics[slot].tier);
    // Thin divider between the relic group and the armor group when both exist.
    if (ownedRelics.length && ownedArmor.length) {
      const sep = document.createElement('span');
      sep.style.cssText = 'align-self:stretch;width:1px;background:#666;margin:0 1px;';
      row.appendChild(sep);
    }
    for (const slot of ownedArmor) addIcon('armor', slot, armor[slot].tier);
    document.body.appendChild(row);
  }
  gearIconHTML(kind, slot, tier, sizePx = 20) {
    const path = gearAssetPath(kind, slot, tier);
    if (!path) return '';
    const isMultiVariant = kind === 'relic' && (slot === 'ring' || slot === 'amulet');
    const sheetCols = isMultiVariant ? 6 : 2;
    const sheetRows = isMultiVariant ? 4 : 1;
    const col = isMultiVariant ? ((tier - 1) % sheetCols) : 0;
    const row = isMultiVariant ? Math.floor((tier - 1) / sheetCols) % sheetRows : 0;
    const bgW = sheetCols * sizePx, bgH = sheetRows * sizePx;
    return `<span style="display:inline-block;vertical-align:middle;`
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
  //   secondary:    OPTIONAL { label: HTML, disabled: bool, onClick: fn }
  //                 — rendered between Cancel and accept (re-roll button).
  showOfferModal({ title, get, blurb, cost, canAfford, onAccept, acceptLabel = 'Buy', secondary, quantity }) {
    const { wrap, box, mount, mkBtn } = this.makeModalShell('offer-modal', { maxWidth: 340, onClose: () => {} });
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
    const forDiv = document.createElement('div');
    forDiv.style.cssText = 'opacity:.85;margin:6px 0 4px';
    forDiv.textContent = 'for';
    box.appendChild(forDiv);
    const costDiv = document.createElement('div');
    costDiv.style.cssText = 'font-size:16px;font-weight:700;margin:4px 0 10px;';
    costDiv.style.color = canAfford ? '#a7ffb0' : '#ff8a7a';
    costDiv.innerHTML = cost;
    box.appendChild(costDiv);
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
          'width:40px;height:34px;border-radius:6px;font:700 20px ui-monospace,monospace;cursor:pointer;' +
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
          if (r.cost != null) costDiv.innerHTML = r.cost;
          if (r.canAfford != null) {
            liveCanAfford = !!r.canAfford;
            costDiv.style.color = liveCanAfford ? '#a7ffb0' : '#ff8a7a';
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
    const cancel = mkBtn('Cancel', false, false);
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
  //   color         string? → tier colour for the name (defaults gold).
  //   onDismiss     fn?    → called after the modal closes.
  //   actions       array? → [{ label, primary?, onClick }]. When present the
  //                          modal becomes a CHOICE (explicit buttons, no
  //                          tap-to-dismiss) instead of a tap-to-continue
  //                          acknowledgement — used for the bag-full chest open.
  showChestRewardModal({ iconHTML, name, sub, qty, color = '#ffe066', onDismiss, header = 'From the chest', actions }) {
    const { wrap, box, mount } = this.makeModalShell('chest-reward-modal', {
      zIndex: 55, minWidth: 220, maxWidth: 300, borderColor: color, wrapBg: '#000c',
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
      `<div style="opacity:.6;font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px">${header}</div>` +
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
            ? `background:${color};color:#1a1612;border:0;`
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
    // vector. Tier colour bleeds into the glow so chest/shrine/etc each
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
            `${color} 40%, ${color}88 65%, transparent 100%);` +
          `border-radius:50%;` +
          `box-shadow:0 0 6px 1px ${color}cc, 0 0 12px 2px ${color}55;` +
          `transform:translate(-50%,-50%) scale(0);opacity:0;` +
          `animation:chestSparkle 1100ms ease-out ${delay.toFixed(0)}ms forwards;`;
        wrap.appendChild(sp);
      }
    });
  }

  // How many more of `id` would fit right now (0 = full for that item).
  // Mirrors addToInv's single-stack-per-id cap so a caller can detect overflow
  // BEFORE committing — the chest open uses it to offer "leave it for later"
  // instead of silently dropping loot that won't fit.
  invRoomFor(id) {
    const cap = (typeof stackCapForBags === 'function')
      ? stackCapForBags(this.save.relics?.bags) : 9;
    let have = 0;
    for (const s of (this.save.inv || [])) if (s && s.id === id) have += (s.count || 0);
    return Math.max(0, cap - have);
  }

  // Add up to `n` of `id` to inventory. Each item id is allowed AT MOST ONE
  // stack and that stack is capped at stackCapForBags(bags relic) — 9 with
  // no bag, 249 at tier 7. Excess is rejected (no ground drops in this game)
  // and the player sees a 'bag full' flash. Returns the count actually
  // accepted so callers can adjust their narration if they care.
  addToInv(id, n = 1, silent = false) {
    const item = ITEM_BY_ID[id];
    if (!item || n <= 0) return 0;
    const cap = (typeof stackCapForBags === 'function')
      ? stackCapForBags(this.save.relics?.bags) : 9;
    // Find the single canonical stack for this id. If duplicate stacks slipped
    // in via a legacy save (the old addToInv path could create them), fold
    // them into one here so the no-duplicate invariant self-heals.
    let stack = null;
    for (let i = this.save.inv.length - 1; i >= 0; i--) {
      const s = this.save.inv[i];
      if (!s || s.id !== id) continue;
      if (!stack) { stack = s; continue; }
      stack.count = (stack.count || 0) + (s.count || 0);
      this.save.inv.splice(i, 1);
    }
    if (!stack) {
      stack = { id, count: 0 };
      this.save.inv.push(stack);
    }
    const room = Math.max(0, cap - (stack.count || 0));
    const accepted = Math.min(room, n);
    stack.count = (stack.count || 0) + accepted;
    const rejected = n - accepted;
    if (!silent) {
      persistSave(this.save);
      this.buildInventoryDOM();
    }
    // Flash whenever anything was rejected — that's the player attempting to
    // exceed the cap. Deferred via setTimeout so it can't race a flashLoot the
    // caller fires right after addToInv (back-to-back add.text in the same
    // synchronous chain exhausts Phaser's text-canvas pool under the harness).
    // Coalesced so a bulk drop fires once.
    if (rejected > 0 && !silent && typeof this.flash === 'function' && this.add) {
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
    return accepted;
  }
  buildInventoryDOM() {
    const PAGE = 5;
    const game = document.getElementById('game');
    let bar = document.getElementById('inv');
    if (bar) bar.remove();
    bar = document.createElement('div');
    bar.id = 'inv';
    // position:fixed anchors to the visual viewport, so the bar stays at the
    // bottom of the screen regardless of #game's CSS scale or any iOS Safari /
    // Firefox Mobile URL-bar chrome. Appended to <body> because a position:
    // fixed element inside a transformed parent (#game uses transform:scale)
    // takes the transformed parent as its containing block — defeats the point.
    bar.style.cssText = 'position:fixed;bottom:calc(48px + env(safe-area-inset-bottom, 0px));left:var(--phone-left, 0px);right:var(--phone-right, 0px);display:flex;justify-content:center;align-items:center;gap:3px;padding:6px;z-index:6;pointer-events:auto;';
    if (this.save.selSlot == null || this.save.selSlot < 0) this.save.selSlot = 0;
    if (this.save.invPage == null) this.save.invPage = 0;
    // Always keep one extra blank page reachable — a multiple-of-5 inventory
    // would otherwise have no empty slot for the player to select before
    // tapping a shop to BUY (empty selection = buy intent).
    const filledPages = Math.ceil(this.save.inv.length / PAGE);
    const pageCount = Math.max(1, this.save.inv.length % PAGE === 0
      ? filledPages + 1
      : filledPages);
    if (this.save.invPage >= pageCount) this.save.invPage = pageCount - 1;

    const makeBtn = (txt, onclick, w = 28) => {
      const b = document.createElement('button');
      b.textContent = txt;
      b.style.cssText = `width:${w}px;height:42px;background:#222a;border:2px solid #555;border-radius:6px;color:#fff;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;`;
      b.addEventListener('click', (e) => { e.stopPropagation(); onclick(); });
      return b;
    };
    // Sort: group by kind (produce → seed → animal → other), then alphabetical
    // by name within each group. Selection is re-anchored to whatever item the
    // user had selected so the highlight follows it across the resort.
    const KIND_ORDER = { produce: 0, seed: 1, animal: 2 };
    bar.appendChild(makeBtn('⇅', () => {
      const selId = this.save.inv[this.save.selSlot]?.id;
      this.save.inv = [...this.save.inv].sort((a, b) => {
        const ia = ITEM_BY_ID[a.id], ib = ITEM_BY_ID[b.id];
        const ka = KIND_ORDER[ia?.kind] ?? 9, kb = KIND_ORDER[ib?.kind] ?? 9;
        if (ka !== kb) return ka - kb;
        return (ia?.name || a.id).localeCompare(ib?.name || b.id);
      });
      if (selId) {
        const newIdx = this.save.inv.findIndex(e => e.id === selId);
        if (newIdx >= 0) {
          this.save.selSlot = newIdx;
          this.save.invPage = Math.floor(newIdx / PAGE);
        }
      }
      persistSave(this.save); this.buildInventoryDOM();
    }));
    bar.appendChild(makeBtn('◀', () => {
      this.save.invPage = (this.save.invPage - 1 + pageCount) % pageCount;
      persistSave(this.save); this.buildInventoryDOM();
    }));

    const startIdx = this.save.invPage * PAGE;
    for (let s = 0; s < PAGE; s++) {
      const i = startIdx + s;
      const entry = this.save.inv[i];
      const item = entry ? ITEM_BY_ID[entry.id] : null;
      const slot = document.createElement('button');
      slot.dataset.slot = i;
      slot.style.cssText = 'position:relative;width:42px;height:42px;flex:0 0 42px;background:#222a;border:2px solid #555;border-radius:6px;font-size:22px;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;';
      slot.title = item ? `${item.name}${entry.count != null ? ' ×' + entry.count : ''}` : 'empty';
      // Inventory icon — routed through renderItemIcon so modals stay perfectly
      // in sync. The generic seedbag fallback for seeds-without-Spring-Crops-art
      // and the ITEM_DATA_URLS path (longgrass/chicken/cow/flowers) both live
      // inside renderItemIcon now.
      if (item) {
        slot.appendChild(this.renderItemIcon(item.id, 32, 'block'));
      } else {
        slot.textContent = '·';
      }
      if (entry && entry.count != null) {
        const badge = document.createElement('span');
        badge.textContent = entry.count;
        badge.style.cssText = 'position:absolute;bottom:1px;right:2px;font-size:10px;background:#000c;padding:0 3px;border-radius:3px;line-height:12px;';
        slot.appendChild(badge);
      }
      slot.addEventListener('click', (e) => {
        e.stopPropagation();
        this.save.selSlot = i;
        persistSave(this.save);
        this.refreshInventoryHighlight();
      });
      bar.appendChild(slot);
    }
    bar.appendChild(makeBtn('▶', () => {
      this.save.invPage = (this.save.invPage + 1) % pageCount;
      persistSave(this.save); this.buildInventoryDOM();
    }));
    // Page indicator — pill-shaped so it visibly belongs to the inv bar even at
    // its smaller size, and reads at a glance against any terrain underneath.
    const pageLbl = document.createElement('span');
    pageLbl.textContent = `${this.save.invPage + 1}/${pageCount}`;
    pageLbl.style.cssText = 'min-width:28px;height:22px;padding:0 6px;display:inline-flex;align-items:center;justify-content:center;background:#000a;border:1px solid #555;border-radius:11px;color:#ffd866;font:700 11px ui-monospace,monospace;margin-left:4px;';
    bar.appendChild(pageLbl);

    document.body.appendChild(bar);

    // Name strip just below the bar — always shows the currently selected
    // item's name (across pages), so the player isn't guessing what's
    // selected when scrolled to a different page. Also position:fixed for the
    // same reason as the bar above.
    let nameLbl = document.getElementById('inv-name');
    if (nameLbl) nameLbl.remove();
    nameLbl = document.createElement('div');
    nameLbl.id = 'inv-name';
    nameLbl.style.cssText = 'position:fixed;bottom:calc(30px + env(safe-area-inset-bottom, 0px));left:var(--phone-left, 0px);right:var(--phone-right, 0px);text-align:center;color:#ffd866;font:13px ui-monospace,monospace;pointer-events:none;z-index:6;text-shadow:1px 1px 2px #000,0 0 3px #000;';
    document.body.appendChild(nameLbl);

    this.refreshInventoryHighlight();
  }
  refreshInventoryHighlight() {
    const bar = document.getElementById('inv');
    if (!bar) return;
    const PAGE = 5;
    const startIdx = this.save.invPage * PAGE;
    [...bar.querySelectorAll('button[data-slot]')].forEach(el => {
      const i = +el.dataset.slot;
      const isSel = i === this.save.selSlot;
      el.style.borderColor = isSel ? '#ffd866' : '#555';
      el.style.background  = isSel ? '#553a' : '#222a';
    });
    const nameLbl = document.getElementById('inv-name');
    if (nameLbl) {
      const sel = this.save.inv[this.save.selSlot];
      const it = sel && ITEM_BY_ID[sel.id];
      nameLbl.textContent = it ? (sel.count != null ? `${it.name} ×${sel.count}` : it.name) : '';
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
    btn.style.cssText =
      'position:fixed;' +
      'bottom:calc(4px + env(safe-area-inset-bottom, 0px));' +
      'right:calc(var(--phone-right, 0px) + 8px);z-index:7;' +
      'display:flex;align-items:center;gap:6px;' +
      'padding:6px 10px;border-radius:8px;cursor:pointer;' +
      'background:#1a1612;color:#a7ffb0;border:2px solid #4a8c4a;' +
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
  // to the Eat button (or in the same spot when food isn't selected) so
  // the player has a one-tap affordance to use a consumable without
  // having to tap their own feet precisely. Honours the existing
  // showOfferModal flow used by interact.js 'use-consumable'.
  syncConsumableButton() {
    const sel = this.save.inv?.[this.save.selSlot];
    const existing = document.getElementById('consumable-btn');
    const CONSUMABLE = { book: { verb: 'Read', method: 'readBook' },
                         flute: { verb: 'Play', method: 'playFlute' } };
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
    btn.style.cssText =
      'position:fixed;' +
      'bottom:calc(4px + env(safe-area-inset-bottom, 0px));' +
      'right:calc(var(--phone-right, 0px) + 8px);z-index:7;' +
      'display:flex;align-items:center;gap:6px;' +
      'padding:6px 10px;border-radius:8px;cursor:pointer;' +
      'background:#1a1612;color:#ffd866;border:2px solid #c8a64a;' +
      'font:700 12px ui-monospace,monospace;';
    btn.innerHTML = label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const fn = CONSUMABLE[id]?.method;
      if (!fn || typeof this[fn] !== 'function') return;
      // Mirror the interact.js use-consumable flow: confirmation modal,
      // accept consumes 1 and triggers the action.
      const item = ITEM_BY_ID[id];
      this.showOfferModal({
        title: id === 'flute' ? 'Play the flute?' : 'Read the book?',
        get: id === 'flute' ? '🪈 lure nearby creatures' : '📖 a tip from the elders',
        cost: `1× ${this.iconSpanHTML(id)} ${item?.name || id}`,
        canAfford: true,
        acceptLabel: CONSUMABLE[id].verb,
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
});
