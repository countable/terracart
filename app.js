// terracart prototype — gameplay layer on top of MVT-driven world.
// - Mobile-sized Phaser canvas (390x844). 11x11 viewport of 5m cells.
// - Real GPS (Geolocation API) if available + permitted; WASD fallback.
// - Tap player to lock/unlock GPS snap.
// - Random creatures spawn in grass/farmland cells (seeded per tile).
// - Tap creature → catch (added to farm). Tap ground with seed selected → plant.
// - Inventory bottom bar shows starter items; tap to select.

const START_LON = -119.47870;
const START_LAT = 49.85438;
const VIEW_CELLS = 11;
const CELL_PX = 32;
const WALK_M_S = 1.4;
const W = 352, H = 844;   // 352 = VIEW_CELLS × CELL_PX → map view fills the canvas edge-to-edge with no horizontal padding

// --- Debug ---
// Arrow keys move the player at DEBUG_SPEED_MUL × walk speed when DEBUG is true.
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
};
// Tillable = soil-ish ground. Concrete pads / cement (commercial/industrial), water, all
// road tiers, paths, every building tier, and rock are NOT tillable.
// Rock (10) is non-tillable too — taps break the rock instead (see handleWorldTap).
const NON_TILLABLE = new Set([3, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17]);
function isTillable(type) { return !NON_TILLABLE.has(type); }
// Building interior cells — small house, fort, civic slab. Used for the
// "rest inside to recover energy" loop (slow, opt-in regen while indoors).
const BUILDING_TYPES = new Set([9, 11, 12]);
// Indoor resting fills the full energy bar in this many seconds while the
// player stands on a building cell. Slower than active food, fast enough to
// matter — sitting for ~5 minutes recovers from empty.
const INDOOR_FULL_REST_S = 300;
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



class MapScene extends Phaser.Scene {
  constructor() { super('map'); }

  preload() {
    this.load.spritesheet('idle', 'Character/Idle.png',  { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('walk', 'Character/Walk.png',  { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('trees','Objects/Maple Tree.png', { frameWidth: 32, frameHeight: 48 });
    this.load.image('house', 'Objects/House.png');
    // House.png is a tileset (two houses + detail bits). Register a single
    // "front" frame for the right-hand cabin so we only render that.
    this.load.once('filecomplete-image-house', () => {
      this.textures.get('house').add('front', 0, 148, 3, 72, 95);
    });
    this.load.spritesheet('chicken', 'Farm Animals/Chicken Red.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('cow',     'Farm Animals/Female Cow Brown.png', { frameWidth: 32, frameHeight: 32 });
    // Cats + dogs use the Icons/Pets icon sheets (16×16 cells) since we don't
    // have animated spritesheets for them — render as static single-frame.
    this.load.spritesheet('cat', 'Icons/Pets/cats icons.png', { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('dog', 'Icons/Pets/dogs icons.png', { frameWidth: 16, frameHeight: 16 });
    // chest.png is 32x32 with one chest per row (centered horizontally, ~16px wide with 8px padding).
    // Frames: 0 = closed, 1 = open.
    this.load.spritesheet('chest',   'Objects/chest.png',            { frameWidth: 32, frameHeight: 16 });
    // Crops sheet: 9 cols x 16 rows of 16x16 cells. Each crop = one row.
    // In-world growth: col 0 (sprout) → col 4 (harvestable). Inventory: col 7 produce, col 8 seed.
    this.load.spritesheet('crops',   'Objects/Crops.png',            { frameWidth: 16, frameHeight: 16 });
    // Spring Crops sheet (224×128, 14×8 of 16×16 frames). Used by crops whose
    // art lives here (e.g. potato) — see CROP_SPRITE override below.
    this.load.spritesheet('springcrops', 'Objects/Spring Crops.png',  { frameWidth: 16, frameHeight: 16 });
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
    this.load.spritesheet('cobble',  'Objects/Road copiar.png',      { frameWidth: 16, frameHeight: 16 });
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
        // inv is array of {id, count} — seeds-only per spec; planting decrements count.
        inv: [
          { id: 'potato_seed', count: 10 },
        ],
        selSlot: 0,
        invPage: 0,
      },
      loadSave()
    );
    this.save.opened = this.save.opened || [];
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
    // Starter shop nearest spawn — guaranteed wood pick + wood axe for sale.
    // starterStock tracks which of those two items have been bought.
    this.save.starterStock = this.save.starterStock || { pick: true, axe: true };
    // Backfill armor slots (spread, not || , so a save missing one slot key
    // still gets defaults rather than carrying gaps that crash maxEnergyFromArmor).
    this.save.armor = { helmet: null, chest: null, legs: null, boots: null, ...(this.save.armor || {}) };
    this.save.starterStock = { pick: true, axe: true, ...(this.save.starterStock || {}) };
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
    this.viewCenterY = H / 2 - 60;            // raise to leave room for inventory bar (extra 20px so the map's bottom edge doesn't kiss the bar on small iPhones)
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
    this.REACH_OBJECT_M = 18; // object taps: chests, trees, houses, treasure
    this.startWorldM = {
      x: this.originPx.x * this.mPerPx,
      y: this.originPx.y * this.mPerPx,
    };

    this.playerM = { x: 0, y: 0 };
    this.facing = { x: 0, y: 1 }; // unit-ish vector; updated by movement
    this._ease = null;            // {fromX, fromY, toX, toY, t0, dur} for GPS easing
    this.gpsM = null;
    this.gpsAvailable = false;

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
    // Per-polygon flora (flowers / pebbles / mushrooms). Plaque textures are
    // baked in the 'crops' post-load handler in preload, since they composite
    // the produce icon onto a wooden sign.
    makeFloraTextures(this);
    makeTowerTexture(this);
    // Long-grass wild-debris sprite. 16x16 so it scales the same as crop frames.
    if (!this.textures.exists('longgrass')) {
      const tex = this.textures.createCanvas('longgrass', 16, 16);
      drawLongGrassTex(tex.getContext(), 16, seededRand(31337));
      tex.refresh();
    }
    // Cache data URLs for items whose map sprite isn't on Crops.png / Spring Crops.png,
    // so the inventory bar and shop modal (which are DOM, not Phaser) can render the
    // exact same image. Run after makeFloraTextures + sheet loads so all source images
    // are ready. Key = item id; value = a data URL of the chosen representative frame.
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
    window.ITEM_DATA_URLS.longgrass = bakeCanvas('longgrass');
    window.ITEM_DATA_URLS.chicken   = bakeSheetFrame('chicken', 0, 32, 32);
    window.ITEM_DATA_URLS.cow       = bakeSheetFrame('cow',     0, 32, 32);
    // Cat + dog use the 32×32 RPG-style sheets (the older 16×16 Icons/Pets
    // file is gone). Frame 0 is the down-facing standing pose.
    window.ITEM_DATA_URLS.cat       = bakeSheetFrame('cat',     0, 32, 32);
    window.ITEM_DATA_URLS.dog       = bakeSheetFrame('dog',     0, 32, 32);
    window.ITEM_DATA_URLS.flowers   = bakeCanvas('flora_flower_0');
    // Wilderness fauna inventory icons — baked from the same 16×16 wilderness
    // sheets used to render them in-world. Without these, catching a deer
    // would show 🦌 emoji instead of the deer sprite.
    window.ITEM_DATA_URLS.deer      = bakeSheetFrame('deer',      0, 16, 16);
    window.ITEM_DATA_URLS.rabbit    = bakeSheetFrame('rabbit',    0, 16, 16);
    window.ITEM_DATA_URLS.crow      = bakeSheetFrame('crow',      0, 16, 16);
    window.ITEM_DATA_URLS.butterfly = bakeSheetFrame('butterfly', 0, 16, 16);
    // Wilderness drops + flora that share their world sprite.
    window.ITEM_DATA_URLS.mushroom  = bakeSheetFrame('mushroom_world', 0, 32, 32);
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
    this.objectsContainer = this.add.container(0, 0);
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
        font: 'bold 11px serif', color: '#000000',
      }).setOrigin(0.5, 0.5).setAlpha(0.40).setDepth(0).setVisible(false);
      this.letterContainer.add(t);
      this.letterPool.push(t);
    }

    this.objectPool = [];
    this.plantedPool = [];
    this.plantedTimerPool = []; // small Phaser.Text in cell corner: growth minutes remaining
    this.creaturePool = [];
    this.chestLabelPool = []; // Phaser.Text objects for POI names above chests
    this.shopLabelPool  = []; // Phaser.Text objects for specialty-shop labels above houses
    this.padPool = [];        // sprites for per-POI concrete-pad textures under chests

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
    this.objectsContainer.setMask(mask);
    this.creaturesContainer.setMask(mask);
    this.tierGfx.setMask(mask);

    // Work-progress wheel — drawn above all world objects, not masked.
    this._workProgressGfx = this.add.graphics().setDepth(95);
    this._workProgress = null;

    const frame = this.add.graphics();
    frame.lineStyle(2, 0x000000, 0.6)
      .strokeRect(this.viewLeft - 1, this.viewTop - 1, this.viewSize + 2, this.viewSize + 2);

    // Animations
    this.anims.create({ key: 'idle-anim', frames: this.anims.generateFrameNumbers('idle', { start: 0, end: 3 }), frameRate: 6, repeat: -1 });
    this.anims.create({ key: 'walk-anim', frames: this.anims.generateFrameNumbers('walk', { start: 0, end: 5 }), frameRate: 10, repeat: -1 });
    this.anims.create({ key: 'chicken-idle', frames: this.anims.generateFrameNumbers('chicken', { start: 0, end: 1 }), frameRate: 3, repeat: -1 });
    this.anims.create({ key: 'cow-idle',     frames: this.anims.generateFrameNumbers('cow',     { start: 0, end: 3 }), frameRate: 4, repeat: -1 });

    // Player sprite
    // Player sprite — not interactive so taps on it fall through to the world
    // handler (which then treats the tap as if it were the cell under the player).
    this.player = this.add.sprite(this.viewCenterX, this.viewCenterY, 'idle', 0)
      .setScale(1.5)
      .play('idle-anim')
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

    // Soft-joystick state. When enabled (toggled from the menu) it replaces
    // GPS movement — used for testing on mobile without real walking.
    this.save.joystick = !!this.save.joystick;
    this.joystickVec = { x: 0, y: 0 };
    this.syncJoystickButton();

    // GPS watch + device compass (best-effort). Test mode skips them so the
    // test harness can drive playerM directly without GPS easing fighting it.
    // Joystick mode also skips GPS so the two don't fight over playerM.
    // Compass + GPS are gated behind the safety-splash button click (the
    // genuine user gesture iOS requires for DeviceOrientationEvent
    // permission) — see #safety-dismiss in index.html, which sets
    // window.__compassPerm and calls scene.startSensors(). If the modal
    // was dismissed BEFORE this scene finished loading, do it now.
    if (!window.__TEST_MODE) {
      this.setupLifecycle();
      if (window.__compassPerm) this.startSensors();
    }
    if (this.save.joystick) this.buildJoystick();
    // Tests reach into the scene via window.__scene.
    window.__scene = this;
  }

  // Called from the safety-splash button click (or from create() if the
  // modal was already dismissed when the scene loaded). Idempotent: safe
  // to call repeatedly. The compass listener attach is gated on
  // window.__compassPerm because iOS gives us nothing without 'granted'.
  startSensors() {
    if (window.__compassPerm === 'granted') this._attachCompass();
    if (!this.save.joystick && this.gpsWatchId == null) this.startGps();
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

  // === GPS ===
  startGps() {
    // Sandbox mode parks the player at a synthetic biome-grid plot and uses
    // keyboard / joystick movement only — GPS would snap them away to their
    // real-world coords on first fix.
    if (this._sandboxMode) return;
    if (!navigator.geolocation) return;
    this.gpsAvailable = true;
    try {
      this.gpsWatchId = navigator.geolocation.watchPosition(
        pos => {
          const { latitude, longitude } = pos.coords;
          const dxM = (longitude - START_LON) * 111320 * Math.cos(START_LAT * Math.PI / 180);
          const dyM = -(latitude - START_LAT) * 111320;
          const prev = this.gpsM;
          this.gpsM = { x: dxM, y: dyM };
          // Ease toward the new GPS fix instead of snapping.
          this._ease = {
            fromX: this.playerM.x, fromY: this.playerM.y,
            toX: this.gpsM.x, toY: this.gpsM.y,
            t0: performance.now(), dur: 300,
          };
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
        // iOS: tilt-compensated and CW from true north. We previously gated
        // on webkitCompassAccuracy < 0 to skip uncalibrated readings, but
        // iOS persistently reports -1 indoors / near anything magnetic and
        // the gate was making the compass appear stuck. Smoothing absorbs
        // the extra noise; let the readings through.
        deg = e.webkitCompassHeading;
        absoluteThisEvent = true;
      } else if (e.absolute && typeof e.alpha === 'number') {
        deg = (360 - e.alpha) % 360;  // alpha is CCW from north; flip
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
    const tilePx = 256;
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
    const SOFT_GROUND = new Set([0, 4, 5, 6]);                // grass / farmland / residential / park
    const GLOBAL_NAT  = new Set([0, 1, 2, 4, 5, 6]);          // every natural biome (incl. sand + forest)
    const FOREST_NATURAL = new Set([0, 1, 6]);                // grass, forest, park
    const PARKLAND       = new Set([1, 6]);                   // park + forest
    const splitPlace = (kind, n, primary, fallback, salt) => {
      const primN = Math.round(n * 0.8);
      for (let i = 0; i < primN; i++)     tryPlace(kind, primary,  i,           salt);
      for (let i = primN; i < n; i++)     tryPlace(kind, fallback, i,           salt);
    };
    // Chickens: residential primarily, soft ground elsewhere. ~50 per tile.
    const chickenN = 40 + Math.floor(rng() * 20);
    splitPlace('chicken', chickenN, RESIDENTIAL, SOFT_GROUND, 'chicken');
    // Cows: grassland primarily, soft ground elsewhere. ~23 per tile.
    const cowN = 15 + Math.floor(rng() * 16);
    splitPlace('cow', cowN, GRASSLAND, SOFT_GROUND, 'cow');
    // Cat / dog: global — every natural biome, no primary bias.
    const catN = 15 + Math.floor(rng() * 16);
    for (let i = 0; i < catN; i++) tryPlace('cat', GLOBAL_NAT, i, 'cat');
    const dogN = 15 + Math.floor(rng() * 16);
    for (let i = 0; i < dogN; i++) tryPlace('dog', GLOBAL_NAT, i, 'dog');
    // Wilderness fauna:
    //   rabbit    → grass / forest / park (skittish, wide)
    //   deer      → forest + park (rare, weapon-gated)
    //   crow      → global — smart birds everywhere
    //   butterfly → park / forest (flower-rich biomes)
    const rabbitN = 30 + Math.floor(rng() * 20);
    for (let i = 0; i < rabbitN; i++) tryPlace('rabbit', FOREST_NATURAL, i, 'rabbit');
    const deerN = 8 + Math.floor(rng() * 6);
    for (let i = 0; i < deerN; i++) tryPlace('deer', PARKLAND, i, 'deer');
    const crowN = 40 + Math.floor(rng() * 20);
    for (let i = 0; i < crowN; i++) tryPlace('crow', GLOBAL_NAT, i, 'crow');
    const butterflyN = 40 + Math.floor(rng() * 20);
    for (let i = 0; i < butterflyN; i++) tryPlace('butterfly', PARKLAND, i, 'butterfly');
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

    // Wild debris is generated per-polygon in worldgen and lives on entry.wildplants
    // (set by rasterizeTile). Picked-state filtering happens at render/interact time
    // via this.save.picked.
    entry.wildplants = entry.wildplants || [];

    // Treasure mark — 1/200 tiles get a subtle X (deterministic per tile).
    // Stored on entry.treasure = { x, y, id } or null. Found state lives in save.foundTreasures.
    entry.treasure = null;
    // Force a guaranteed X ~10m north of the player's start (whichever tile
    // contains the spawn). All four locals here were previously undefined and
    // every tile load threw "sx is not defined" — see the tile-fetch warnings.
    const tx0 = tx * this.tileEdgeM, ty0 = ty * this.tileEdgeM;
    const sx = this.startWorldM.x, sy = this.startWorldM.y;
    if (sx >= tx0 && sx < tx0 + this.tileEdgeM && sy >= ty0 && sy < ty0 + this.tileEdgeM) {
      entry.treasure = { x: sx, y: sy - 10, id: `treasure_start_${tx}_${ty}` };
    } else if (rng() < 1 / 200) {
      for (let attempt = 0; attempt < 16; attempt++) {
        const cx = Math.floor(rng() * N);
        const cy = Math.floor(rng() * N);
        const t = entry.grid[cy * N + cx];
        // Place on any walkable ground (skip water + buildings).
        if (t === 3 || t === 9 || t === 11 || t === 12) continue;
        const wmx = tx * this.tileEdgeM + (cx + 0.5) * this.cellM;
        const wmy = ty * this.tileEdgeM + (cy + 0.5) * this.cellM;
        entry.treasure = { x: wmx, y: wmy, id: `treasure_${tx}_${ty}` };
        break;
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
    let vx = 0, vy = 0;
    const k = this.keys;
    if (k.A.isDown) vx -= 1;
    if (k.D.isDown) vx += 1;
    if (k.W.isDown) vy -= 1;
    if (k.S.isDown) vy += 1;
    // Arrow keys: DEBUG_SPEED_MUL × speed for fast debug travel (gated on DEBUG).
    let speedMul = 1;
    if (DEBUG) {
      if (k.LEFT.isDown)  { vx -= 1; speedMul = DEBUG_SPEED_MUL; }
      if (k.RIGHT.isDown) { vx += 1; speedMul = DEBUG_SPEED_MUL; }
      if (k.UP.isDown)    { vy -= 1; speedMul = DEBUG_SPEED_MUL; }
      if (k.DOWN.isDown)  { vy += 1; speedMul = DEBUG_SPEED_MUL; }
    }
    // Soft joystick contribution (when enabled). Vec is already in [-1, 1].
    // Joystick is for testing on mobile — boost to 4× walk speed so a tester
    // can cover ground quickly without endless thumb-pushing.
    if (this.save.joystick && this.joystickVec) {
      vx += this.joystickVec.x;
      vy += this.joystickVec.y;
      if (this.joystickVec.x || this.joystickVec.y) speedMul = 4;
    }
    const moving = vx || vy;
    if (moving) {
      const n = Math.hypot(vx, vy);
      this.playerM.x += (vx / n) * WALK_M_S * speedMul * dt;
      this.playerM.y += (vy / n) * WALK_M_S * speedMul * dt;
      // Only let WASD drive facing when there's no compass heading available.
      if (this.compassDeg == null) this.facing = { x: vx, y: vy };
      if (this.player.anims.currentAnim?.key !== 'walk-anim') this.player.play('walk-anim');
      if (vx < 0) this.player.setFlipX(true);
      else if (vx > 0) this.player.setFlipX(false);
    } else if (this._ease) {
      // Ease playerM toward last GPS fix (easeOutCubic, 300ms).
      const u = Math.min(1, (performance.now() - this._ease.t0) / this._ease.dur);
      const e = 1 - Math.pow(1 - u, 3);
      this.playerM.x = this._ease.fromX + (this._ease.toX - this._ease.fromX) * e;
      this.playerM.y = this._ease.fromY + (this._ease.toY - this._ease.fromY) * e;
      const easeDx = this._ease.toX - this._ease.fromX;
      const easeDy = this._ease.toY - this._ease.fromY;
      if (u < 1 && (easeDx || easeDy)) {
        if (easeDx < -0.001) this.player.setFlipX(true);
        else if (easeDx > 0.001) this.player.setFlipX(false);
        if (this.player.anims.currentAnim?.key !== 'walk-anim') this.player.play('walk-anim');
      } else if (u >= 1) {
        this._ease = null;
        if (this.player.anims.currentAnim?.key !== 'idle-anim') this.player.play('idle-anim');
      }
    } else if (this.player.anims.currentAnim?.key !== 'idle-anim') {
      this.player.play('idle-anim');
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
      const pWX = this.startWorldM.x + this.playerM.x;
      const pWY = this.startWorldM.y + this.playerM.y;
      const here = this.cellAt(pWX, pWY);
      const indoors = here.loaded && BUILDING_TYPES.has(here.type);
      const maxE = this.getMaxEnergy();
      if (indoors && (this.save.energy ?? 0) < maxE) {
        this._restAccrueE += maxE * (dt / INDOOR_FULL_REST_S);
        const pip = Math.floor(this._restAccrueE);
        if (pip > 0) {
          this._restAccrueE -= pip;
          this.save.energy = Math.min(maxE, (this.save.energy ?? 0) + pip);
          if (this.updateEnergyDOM) this.updateEnergyDOM();
        }
      } else {
        this._restAccrueE = 0;
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
      const lp = this._lastFootprintM;
      const dx = this.playerM.x - lp.x, dy = this.playerM.y - lp.y;
      // First GPS fix can jump hundreds of meters from playerM=(0,0); skip the
      // single huge step so the inaugural footprint isn't dropped at world
      // origin. 200m = ~13 cells, well outside any normal walking gait.
      const tooFar = dx * dx + dy * dy > 200 * 200;
      if (tooFar) {
        this._lastFootprintM = { x: this.playerM.x, y: this.playerM.y };
      } else if (dx * dx + dy * dy >= 2 * 2) {
        for (const fp of this.footprints) fp.alpha *= 0.9;
        this.footprints.push({ x: this.playerM.x, y: this.playerM.y, alpha: 0.45 });
        // Cap at 5 so the trail stays short — the 10%/step fade alone would
        // keep ~22 dots alive before they drop below visibility.
        if (this.footprints.length > 5) this.footprints.splice(0, this.footprints.length - 5);
        this._lastFootprintM = { x: this.playerM.x, y: this.playerM.y };
      }
      this.footprintGfx.clear();
      const pWX = this.startWorldM.x + this.playerM.x;
      const pWY = this.startWorldM.y + this.playerM.y;
      for (const fp of this.footprints) {
        const sx2 = this.viewCenterX + ((fp.x + this.startWorldM.x - pWX) / this.cellM) * CELL_PX;
        // +22 lands the dot at the sprite's feet (sprite scale 1.5 × 32 = 48,
        // origin (.5,.5) so feet are at sprite_y + 24). Earlier +6 buried the
        // first dots inside the sprite body where they were unreadable; now
        // they sit on the grass just below the sprite.
        const sy2 = this.viewCenterY + ((fp.y + this.startWorldM.y - pWY) / this.cellM) * CELL_PX + 22;
        this.footprintGfx.fillStyle(0x000000, fp.alpha);
        this.footprintGfx.fillCircle(Math.round(sx2), Math.round(sy2), 4);
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
    const STAGE_HOLD_MS = 60 * 60 * 1000;
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

  // --- Work-progress wheel (rock-break / tree-chop) ---
  startWorkProgress(worldX, worldY, onComplete, durationMs = 3000) {
    this._workProgress = { worldX, worldY, onComplete, durationMs, startT: performance.now() };
  }
  cancelWorkProgress() {
    this._workProgress = null;
    this._workProgressGfx?.clear();
  }
  _drawWorkProgress() {
    const wp = this._workProgress;
    if (!wp) return;
    const dur = wp.durationMs || 3000;
    const elapsed = performance.now() - wp.startT;
    if (elapsed >= dur) {
      const cb = wp.onComplete;
      this.cancelWorkProgress();
      cb();
      return;
    }
    const progress = elapsed / dur;
    const screen = this.worldMetersToScreen(wp.worldX, wp.worldY);
    const cx = Math.round(screen.x);
    const cy = Math.round(screen.y) - 14;
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
    // Pest spawn: if the player has any planted crop and the player's
    // 3×3 tile neighbourhood contains < 2 wild crows, spawn one off-screen
    // every ~30 s. The crow's wander loop targets the nearest crop and
    // destroys it on contact (see below).
    this._lastPestT = this._lastPestT || 0;
    if (this.save.planted && this.save.planted.length > 0 && now - this._lastPestT > 30000) {
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
      if (wildCrows < 2) {
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
                    || (isTame && c.kind === 'butterfly');
      if (!wanders) return;
      if (this.save.caught.includes(c.id)) return;
      const ddx = c.x - px, ddy = c.y - py;
      if (ddx * ddx + ddy * ddy > RANGE_SQ) return;
      if (c._nextChooseT == null) {
        c._nextChooseT = now + Math.random() * STEP_MS;
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
        // Movement target — five modes, checked in order:
        //   (a) Scared (_scaredUntilT > now): the creature flees the player
        //       at full step distance until the timer expires. Set when a
        //       weapon-less player taps a wild crow / deer.
        //   (b) Cat-following (_followUntilT > now): cat homes in on the
        //       player, gap-stopping so it doesn't mob.
        //   (c) Crow targeting a planted crop: pick the nearest planted
        //       cell within RANGE_M and head toward it with random jitter
        //       ("haphazardly"). On contact (≤ cellM/2) destroy the crop.
        //   (d) Tame pets — tighter home-bias radius so they stay near
        //       their drop point.
        //   (e) Default — wild farm animals random-wander around home.
        const FOLLOW_GAP = 1.5 * this.cellM;
        const isScared = c._scaredUntilT && c._scaredUntilT > now;
        const isCatFollowing = c.kind === 'cat' && c._followUntilT && c._followUntilT > now;
        // Crows hunting crops: find the nearest planted crop. The
        // haphazard wobble + the random-attempt loop below combine into
        // the "drifts toward the crop" behaviour the user described.
        let cropTarget = null;
        if (c.kind === 'crow' && !isTame && !isScared && this.save.planted && this.save.planted.length) {
          let best = null, bestD2 = Infinity;
          for (const pp of this.save.planted) {
            const dx = pp.x - c.x, dy = pp.y - c.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) { bestD2 = d2; best = pp; }
          }
          cropTarget = best;
          // Contact check — if we're already on the crop cell, eat it.
          if (best && bestD2 < (this.cellM * 0.5) * (this.cellM * 0.5)) {
            const idx = this.save.planted.indexOf(best);
            if (idx >= 0) this.save.planted.splice(idx, 1);
            this.flash?.('🐦 crop eaten!', this.viewCenterX, this.viewCenterY - 60);
            cropTarget = null;
          }
        }
        const dxh = c._homeX - c.x, dyh = c._homeY - c.y;
        const homeRadius = isTame ? 1.5 * this.cellM : 3 * this.cellM;
        const homeBias = Math.hypot(dxh, dyh) > homeRadius;
        const dxp = px - c.x, dyp = py - c.y;
        const distToPlayer = Math.hypot(dxp, dyp);
        let tx = c.x, ty = c.y, angle = 0;
        let foundValidTarget = false;
        for (let attempt = 0; attempt < 6; attempt++) {
          if (isScared) {
            // Flee directly away from the player, jittered.
            angle = Math.atan2(-dyp, -dxp) + (Math.random() - 0.5) * 0.6;
          } else if (isCatFollowing && distToPlayer > FOLLOW_GAP) {
            angle = Math.atan2(dyp, dxp) + (Math.random() - 0.5) * 0.4;
          } else if (cropTarget) {
            // Haphazard advance toward the targeted crop.
            const dxc = cropTarget.x - c.x, dyc = cropTarget.y - c.y;
            angle = Math.atan2(dyc, dxc) + (Math.random() - 0.5) * 1.2;
          } else if (homeBias) {
            angle = Math.atan2(dyh, dxh) + (Math.random() - 0.5) * 0.8;
          } else {
            angle = Math.random() * Math.PI * 2;
          }
          tx = c.x + Math.cos(angle) * STEP_M;
          ty = c.y + Math.sin(angle) * STEP_M;
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
        c._startX = c.x; c._startY = c.y;
        c._targetX = tx; c._targetY = ty;
        c._stepT0 = now;
        c._nextChooseT = now + STEP_MS;
        c._faceFlip = (c._targetX - c._startX) < 0;
      }
      const u = Math.min(1, (now - c._stepT0) / STEP_MS);
      c.x = c._startX + (c._targetX - c._startX) * u;
      c.y = c._startY + (c._targetY - c._startY) * u;
    });
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

  cellAt(wmx, wmy) {
    const wx = this.originPx.x + (wmx - this.startWorldM.x) / this.mPerPx;
    const wy = this.originPx.y + (wmy - this.startWorldM.y) / this.mPerPx;
    const tx = Math.floor(wx / 256), ty = Math.floor(wy / 256);
    const ix = Math.floor((wx - tx * 256) / (256 / this.cellsPerTile));
    const iy = Math.floor((wy - ty * 256) / (256 / this.cellsPerTile));
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
    // Per-creature catch yield. Chickens yield 4 (eggs + bird); cows yield 1.
    const yieldN = c.kind === 'chicken' ? 4 : 1;
    // addToInv already persists; passing silent=true to avoid a double write.
    this.addToInv(c.kind, yieldN, true);
    persistSave(this.save);
    const item = ITEM_BY_ID[c.kind];
    // Animals have no Crops.png sprite, so the emoji icon stays as a fallback.
    this.flashLoot(`+${yieldN} ${item?.icon || ''} ${c.kind}`, '#a7ffb0', 1, c.kind);
  }

  // Debug-only: jump to the next-nearest POI chest that has a decoration pad,
  // walking outward by distance. First press preferentially seeks the named
  // POI in `_poiTpFirst` if it's loaded.
  teleportNextPoi() {
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
    this.tweens.add({
      targets: t, y: y - 30, alpha: 0, duration: 900,
      onComplete: () => t.destroy(),
    });
  }

  // Bigger, longer-dwelling pop for loot pickups (chest opens, treasure X, harvest, debris).
  // Brief scale-up then a slow drift + fade. Always rendered at the player's viewport center
  // so the eye doesn't have to chase it back to where the X used to be.
  // dwellMul scales the hold + fade portion (chest opens use 1.25 for a longer read).
  flashLoot(text, color = '#ffe066', dwellMul = 1, itemId = null) {
    const x = this.viewCenterX, y = this.viewCenterY - 90;
    // Resolve an inline sprite for the loot item. When present, we reserve room
    // INSIDE the text bg via left-padding so the icon sits over the dark label
    // (rather than floating outside its left edge).
    const iconSrc = itemId && (typeof inventoryIconSource === 'function')
      ? inventoryIconSource(itemId) : null;
    const ICON_PX = 28;       // displayed icon side
    const ICON_GAP = 8;       // gap between icon and text inside the bg
    const RESERVE = iconSrc ? ICON_PX + ICON_GAP : 0;
    const t = this.add.text(x, y, text, {
      font: 'bold 22px monospace', color, backgroundColor: '#000c',
      stroke: '#000', strokeThickness: 3,
      padding: { left: 10 + RESERVE, right: 10, top: 5, bottom: 5 },
    }).setOrigin(0.5, 1).setDepth(101).setScale(0.6).setAlpha(0);
    let icon = null;
    if (iconSrc) {
      icon = this.add.image(0, 0, iconSrc.sheet)
        .setFrame(iconSrc.frame)
        .setOrigin(0.5, 0.5).setDepth(102).setScale(0.6).setAlpha(0);
      icon.setDisplaySize(ICON_PX, ICON_PX);
      // Centre the icon inside the reserved zone (which lives at the LEFT of the
      // text bg). Coordinates are in screen-space; account for text.scale.
      const placeIcon = () => {
        const b = t.getBounds();
        const reserveCentreFromLeft = (10 + RESERVE / 2) * t.scaleX;
        icon.setPosition(b.left + reserveCentreFromLeft, (b.top + b.bottom) / 2);
      };
      placeIcon();
      this.tweens.add({ targets: icon, scale: 1.0, alpha: 1, duration: 140, ease: 'Back.Out',
        onUpdate: placeIcon });
      this.tweens.add({ targets: icon, y: y - 50, alpha: 0,
        duration: Math.round(700 * dwellMul), delay: Math.round(1440 * dwellMul),
        ease: 'Sine.In', onComplete: () => icon.destroy() });
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
    const lat = START_LAT + (-this.playerM.y) / 111320;
    const lon = START_LON + this.playerM.x / (111320 * Math.cos(START_LAT * Math.PI / 180));
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
    consumeSelected(this.save);
    persistSave(this.save);
    this.buildInventoryDOM();
    this.showMessageModal({
      title: '🪈 You play the flute',
      body: lured > 0 ? `${lured} creature${lured === 1 ? '' : 's'} come${lured === 1 ? 's' : ''} closer.` : 'Nothing stirs nearby.',
    });
    return true;
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
    consumeSelected(this.save);
    persistSave(this.save);
    this.buildInventoryDOM();
    this.showMessageModal({ title, body });
    return true;
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
    const item = ITEM_BY_ID[sel.id];
    this.showMessageModal({
      title: 'You eat the ' + (item?.name || sel.id),
      body: `⚡ +${gained} energy${extra}`,
    });
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

  // Simple OK-button modal for ambient game messages (eat effects, status, etc.).
  showMessageModal({ title, body, okLabel = 'OK' }) {
    document.getElementById('offer-modal')?.remove();
    document.getElementById('message-modal')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'message-modal';
    wrap.style.cssText =
      'position:absolute;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;' +
      'background:#0008;pointer-events:auto;';
    const box = document.createElement('div');
    box.style.cssText =
      'min-width:230px;max-width:320px;background:#1a1612;color:#fff;border:2px solid #c8a64a;' +
      'border-radius:10px;padding:14px 16px;font:13px ui-monospace,monospace;text-align:center;';
    const safeBody = String(body).replace(/\n/g, '<br>');
    box.innerHTML =
      `<div style="opacity:.85;font-size:13px;margin-bottom:8px;color:#ffe066">${title}</div>` +
      `<div style="margin:6px 0 12px;white-space:pre-wrap">${safeBody}</div>`;
    const btn = document.createElement('button');
    btn.textContent = okLabel;
    btn.style.cssText = 'padding:8px 14px;border-radius:6px;background:#c8a64a;color:#1a1612;border:0;font:700 13px ui-monospace,monospace;cursor:pointer;';
    btn.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); });
    wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
    box.appendChild(btn);
    wrap.appendChild(box);
    (document.getElementById('game') || document.body).appendChild(wrap);
  }

  // Stats / Relics menu — shows energy and every equipped relic / armor slot.
  showStatsModal() {
    document.getElementById('stats-modal')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'stats-modal';
    wrap.style.cssText =
      'position:absolute;inset:0;z-index:55;display:flex;align-items:center;justify-content:center;' +
      'background:#0008;pointer-events:auto;';
    const box = document.createElement('div');
    box.style.cssText =
      'min-width:260px;max-width:340px;background:#1a1612;color:#fff;border:2px solid #c8a64a;' +
      'border-radius:10px;padding:14px 16px;font:13px ui-monospace,monospace;';
    const cur = this.save.energy ?? 0, max = this.getMaxEnergy();
    const slotRow = (kind, slot) => {
      const eq = (kind === 'relic' ? this.save.relics : this.save.armor)?.[slot];
      const def = gearDef(kind, slot);
      const label = def?.name || slot;
      if (!eq) {
        return `<div style="display:flex;justify-content:space-between;padding:2px 0;opacity:.55"><span>${label}</span><span style="font-size:11px">— empty —</span></div>`;
      }
      const t = TIER_BY_NUM[eq.tier];
      const iconHtml = this.gearIconHTML(kind, slot, eq.tier, 20);
      return `<div style="display:flex;justify-content:space-between;padding:2px 0"><span>${label}</span><span>${iconHtml} ${t?.name || ''} (T${eq.tier})</span></div>`;
    };
    box.innerHTML =
      `<div style="text-align:center;color:#ffe066;font-weight:700;margin-bottom:6px">Stats &amp; Relics</div>` +
      `<div style="text-align:center;margin-bottom:10px">⚡ Energy: <b>${cur}</b> / ${max}</div>` +
      `<div style="opacity:.7;font-size:11px;margin:6px 0 2px">RELICS</div>` +
      Object.keys(RELIC_DEFS).map(s => slotRow('relic', s)).join('') +
      `<div style="opacity:.7;font-size:11px;margin:10px 0 2px">ARMOR</div>` +
      Object.keys(ARMOR_DEFS).map(s => slotRow('armor', s)).join('');
    const btn = document.createElement('button');
    btn.textContent = 'Close';
    btn.style.cssText = 'margin-top:12px;padding:8px 14px;border-radius:6px;background:#c8a64a;color:#1a1612;border:0;font:700 13px ui-monospace,monospace;cursor:pointer;width:100%';
    btn.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); });
    wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
    box.appendChild(btn);
    wrap.appendChild(box);
    (document.getElementById('game') || document.body).appendChild(wrap);
  }

  shopInteract(sx, sy, house) {
    // Single-modal guard: if a confirmation modal is already open, ignore the tap so
    // rapid double-taps can't stack two modals or stale closures.
    if (document.getElementById('offer-modal')) return;
    // Per-building deal rate-limit. Bigger buildings handle more daily traffic:
    //   house (small)      → 1  deal/hr
    //   fort  (mid-tier)   → 5  deals/hr
    //   castle / tower     → unlimited (they sell relics only — see below)
    // Counted per house.id over a rolling 1-hour window.
    const isCastle = !!house && (house.kind === 'tower' || house.tier === 12);
    // Starter shop has uncapped traffic while either tool is still in stock —
    // we'd otherwise lock the only source of pick/axe behind a 1-deal/hr cap.
    const isStarter = !!house && this.isStarterShop(house) && !!this.starterShopOffer();
    const dealCap = !house ? Infinity
      : isCastle ? Infinity
      : isStarter ? Infinity
      : (house.tier === 11 /* BUILDING_MED */) ? 5
      : 1;
    // Hour-bucket deal cap. Each shop has its own offset (hash of id mod 1h)
    // so all shops don't rotate at the same minute. cur.deals counts this
    // bucket's deals; rolls over automatically when the bucket changes via
    // shopBucketState() below.
    if (house && house.id && dealCap !== Infinity) {
      const cur = this.shopBucketState(house);
      if (cur.deals >= dealCap) {
        const now = Date.now();
        const offset = this._shopBucketOffset(house.id);
        const nextBucketStart = (cur.bucket + 1) * 60 * 60 * 1000 - offset;
        const waitMin = Math.max(1, Math.ceil((nextBucketStart - now) / 60000));
        const kindLabel = (house.kind === 'tower' || house.tier === 12) ? 'castle'
                        : (house.tier === 11) ? 'fort' : 'house';
        this.flash(`${kindLabel} busy — try again in ${waitMin}m`, sx, sy);
        return;
      }
    }
    // Record a deal against this house — called from inside the accept path.
    const recordDeal = () => {
      if (!house || !house.id || dealCap === Infinity) return;
      const cur = this.shopBucketState(house);
      cur.deals += 1;
    };
    const shopType = Shops.shopType(house);
    const sel = this.save.inv[this.save.selSlot];
    if (sel && sel.id) {
      // SELL one of the selected stack — confirm first so an accidental
      // house tap can't silently dump a high-value item. Sword relic scales
      // the price from half (no sword) up to full base value at tier 7.
      // Specialty shops pay a bonus on their associated goods: markets on
      // produce, blacksmiths on gems, traders on anything (their thing IS trade).
      const sellMul = (typeof sellMultiplier === 'function') ? sellMultiplier(this.save.relics) : 0.5;
      const shopMul = Shops.shopSellBonus(shopType, sel.id);
      const price = Math.max(1, Math.ceil((PRICES[sel.id] ?? 1) * sellMul * shopMul));
      const item = ITEM_BY_ID[sel.id];
      const sellId = sel.id;
      this.showOfferModal({
        title: 'Sell to the shopkeep?',
        get: `+$${price}`,
        cost: `1× ${this.iconSpanHTML(sellId)} ${item?.name || sellId}`,
        canAfford: true,
        acceptLabel: 'Sell',
        onAccept: () => {
          // Re-find by id (not index) — the slot may have shifted, but as long as
          // SOME stack of this id still exists we can fulfil the sale.
          const idx = this.save.inv.findIndex(s => s && s.id === sellId && (s.count ?? 0) > 0);
          if (idx < 0) { this.flash('gone', sx, sy); return; }
          const cur = this.save.inv[idx];
          cur.count -= 1;
          addMoney(this.save, price);
          if (cur.count <= 0) {
            this.save.inv.splice(idx, 1);
            if (this.save.selSlot >= this.save.inv.length) {
              this.save.selSlot = Math.max(0, this.save.inv.length - 1);
            }
          }
          recordDeal();
          persistSave(this.save);
          this.buildInventoryDOM();
          if (this.updateMoneyDOM) this.updateMoneyDOM();
          // Sprite shows the sold item — drop the item-icon emoji from the text.
          this.flashLoot(`🪙 +$${price}`, '#ffe066', 1, sellId);
        },
      });
      return;
    }
    // BUY — empty slot: generate an offer and present a confirmation modal.
    // Special tracks come BEFORE the regular seed/produce rotation:
    //   (a) Starter shop  — the nearest building to spawn always has a wood
    //       pickaxe AND wood axe in stock until each is bought (so players
    //       can clear rocks/trees without hunting for a relic).
    //   (b) Castle / tower — always sells relics, no rate-limit, with re-roll.
    //   (c) Blacksmith     — address-ending-in-9 houses trade 5 gems for a relic.
    //   (d) Regular house  — 10% chance to swap the normal offer for a relic.
    if (house && this.isStarterShop(house) && this.starterShopOffer()) {
      this.presentRelicOffer(sx, sy, this.starterShopOffer(), recordDeal, house, false);
      return;
    }
    if (isCastle) {
      const offer = this.peekOrBuildRelicOffer(house);
      if (offer) { this.presentRelicOffer(sx, sy, offer, recordDeal, house, true); return; }
      // Every relic + armor slot is at max tier. Castles only deal in relics,
      // so there's nothing left to sell — say so explicitly rather than
      // silently swapping the player onto potato seeds.
      this.flash('castle has nothing better to sell', sx, sy);
      return;
    }
    if (shopType === 'blacksmith') {
      const offer = this.peekOrBuildRelicOffer(house);
      if (offer) { this.presentBlacksmithOffer(sx, sy, offer, recordDeal, house); return; }
      this.flash('we are still working on something for you', sx, sy);
      return;
    }
    // Markets and traders skip the 10% relic-swap; their shop kind is dedicated.
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
    // Traders never want cash — they only deal in barter (non-gold items).
    const offer = this.buildShopOffer(id, baseValue, shopType === 'trader');
    if (!offer) {
      this.flash('no deal', sx, sy);
      return;
    }
    this.showOfferModal({
      title: 'A trader offers:',
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
        if (this.updateMoneyDOM) this.updateMoneyDOM();
        // Use the loud loot pop so a purchase reads as a real gain.
        // Sprite shows the bought item — drop the item-icon emoji.
        this.flashLoot(`🪙 ${item?.name || id}\n${offer.shortGain}`, '#ffe066', 1, id);
      },
    });
  }

  // The "starter shop" is the building closest to the player's spawn. It's
  // guaranteed to stock a wood pickaxe + wood axe so the player can always
  // unlock rock/tree clearing without random-shopping. We pick it once and
  // memoize in save.starterShopId so reloads + roaming keep the same shop.
  isStarterShop(house) {
    if (!house || !house.id) return false;
    if (this.save.starterShopId == null) {
      const nearestId = this.findStarterHouseId();
      if (nearestId) this.save.starterShopId = nearestId;
    }
    return this.save.starterShopId === house.id;
  }

  // Find the house nearest startWorldM among all loaded objects. Returns the
  // house id, or null if no house is loaded yet.
  findStarterHouseId() {
    let bestId = null, bestD2 = Infinity;
    for (const e of WorldGen.tileCache.values()) {
      for (const o of (e.objects || [])) {
        if (o.kind !== 'house') continue;
        if (!o.id) continue;
        const dx = o.x - this.startWorldM.x, dy = o.y - this.startWorldM.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; bestId = o.id; }
      }
    }
    return bestId;
  }

  // Return the next starter-shop offer (wood pick, then wood axe), or null
  // when both have been bought.
  starterShopOffer() {
    const stk = this.save.starterStock || {};
    const want = stk.pick ? 'pick' : (stk.axe ? 'axe' : null);
    if (!want) return null;
    // Wood pickaxe is fixed at $30 — the gating tool to unlock the entire
    // rock-breaking loop, so it shouldn't depend on global price scaling.
    const price = want === 'pick' ? 30 : gearPrice('relic', want, 1);
    return { kind: 'relic', slot: want, tier: 1, price, starter: true };
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
    if (!house?.id) return this.buildRelicOffer();
    const rng = this.shopRng(house, 'relic');
    return this.buildRelicOffer(rng);
  }

  // Pick a random relic OR armor piece the player can actually use — meaning
  // their current slot is empty or holds a strictly lower tier. Returns null
  // if no upgrade is possible (caller falls through to the usual seed offer).
  // Tier is biased low so most offers are wood/copper; rare materials are rare.
  // `rng` defaults to Math.random — pass a seeded one for stable per-bucket offers.
  buildRelicOffer(rng = Math.random) {
    const candidates = [];
    // Pick all (kind, slot) combos where the player can upgrade.
    const consider = (kind, slot, currentTier) => {
      for (const t of MATERIAL_TIERS) {
        if (t.tier <= currentTier) continue;     // never offer same-or-lower
        candidates.push({ kind, slot, tier: t.tier });
      }
    };
    for (const slot of Object.keys(RELIC_DEFS))  consider('relic', slot, this.save.relics?.[slot]?.tier ?? 0);
    for (const slot of Object.keys(ARMOR_DEFS)) consider('armor', slot, this.save.armor?.[slot]?.tier  ?? 0);
    if (!candidates.length) return null;
    // Bias toward low tiers: weight ∝ 1 / 2^(tier-1). Tier 1 weight 1, t2 0.5, t3 0.25, …
    const weighted = candidates.map(c => ({ c, w: 1 / Math.pow(2, c.tier - 1) }));
    const total = weighted.reduce((a, b) => a + b.w, 0);
    let r = rng() * total;
    let pick = weighted[weighted.length - 1].c;
    for (const w of weighted) { r -= w.w; if (r <= 0) { pick = w.c; break; } }
    const price = Math.max(1, Math.ceil(gearPrice(pick.kind, pick.slot, pick.tier) * (1.2 + rng() * 1.8)));
    return { ...pick, price };
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
    const showReroll = allowReroll && !offer.starter;
    const curState = (house?.id && !offer.starter) ? this.shopBucketState(house) : null;
    const rerollCost = 5 * Math.pow(2, curState?.rerolls || 0);
    this.showOfferModal({
      title: offer.starter ? 'Starter gear in stock:' : 'A trader offers a relic:',
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
        if (offer.tier <= curTier) { this.flash('already own better', sx, sy); return; }
        if ((this.save.money ?? 0) < offer.price) { this.flash(`need $${offer.price}`, sx, sy); return; }
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
        if (offer.starter && this.save.starterStock) this.save.starterStock[offer.slot] = false;
        recordDeal();
        persistSave(this.save);
        this.updateHUD();
        this.flashLoot(`🪙 ${name}\n−$${offer.price}`, '#ffe066', 1.25);
      },
      secondary: showReroll ? {
        label: `Re-roll<br><span style="font-weight:400;font-size:10px;opacity:.85">$${rerollCost}</span>`,
        disabled: (this.save.money ?? 0) < rerollCost,
        onClick: () => {
          if ((this.save.money ?? 0) < rerollCost) { this.flash(`need $${rerollCost}`, sx, sy); return; }
          // Pivot the seed lane so the next peekOrBuildRelicOffer returns
          // something else — no per-house cache to invalidate.
          if (curState) curState.rerolls += 1;
          const next = this.peekOrBuildRelicOffer(house);
          if (!next) { this.flash('nothing else in stock', sx, sy); return; }
          addMoney(this.save, -rerollCost);
          persistSave(this.save);
          this.updateHUD();
          this.presentRelicOffer(sx, sy, next, recordDeal, house, true);
        },
      } : undefined,
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
  //   • Tools / weapons / armor / utility — pay `tier` × tier-matched bar.
  //     T2..T4 bars (copper / iron / gold) are mined; T5..T7 bars
  //     (platinum / crimson / frost) are SMELTED from their flowers, so the
  //     flower bond is implicit through the bar requirement.
  //   • Jewelry slots (ring / staff / amulet) — geometric gem cost
  //     (1, 2, 4, 8, 16, 32 from T2..T7) of the slot-specific gem:
  //       ring → ruby, staff → emerald, amulet → sapphire
  //     plus 1 of the tier-matched bar.
  // T1 wood gear is starter-shop-only and doesn't pass through here.
  blacksmithRecipe(kind, slot, tier) {
    if (!tier || tier < 2) return null;
    const JEWELRY_GEM = { ring: 'ruby', staff: 'emerald', amulet: 'sapphire' };
    const BAR_BY_TIER = [, , 'copper_bar', 'iron_bar', 'gold_bar', 'platinum_bar', 'crimson_bar', 'frost_bar'];
    const bar = BAR_BY_TIER[tier];
    if (!bar) return null;
    if (JEWELRY_GEM[slot]) {
      // Geometric gem ramp: 1, 2, 4, 8, 16, 32 from T2..T7.
      const gemQty = Math.pow(2, tier - 2);
      return [
        { id: JEWELRY_GEM[slot], qty: gemQty },
        { id: bar, qty: 1 },
      ];
    }
    return [{ id: bar, qty: tier }];
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
    if (level >= 7) return null;
    // Indexed by current level. Index 1 = the bundle to go from L1 → L2.
    // T4-T6 substitute seeds for the missing animal-byproduct slot.
    const BUNDLES = [, // 0: unused
      [{ id: 'potato',     qty: 5 }, { id: 'egg',           qty: 5 }, { id: 'coal',         qty: 5 }],  // L1→L2 (T1)
      [{ id: 'rainberry',  qty: 5 }, { id: 'milk',          qty: 5 }, { id: 'copper_bar',   qty: 5 }],  // L2→L3 (T2)
      [{ id: 'coffee',     qty: 5 }, { id: 'meat',          qty: 5 }, { id: 'iron_bar',     qty: 5 }],  // L3→L4 (T3)
      [{ id: 'sunflower',  qty: 5 }, { id: 'sunflower_seed',qty: 5 }, { id: 'gold_bar',     qty: 5 }],  // L4→L5 (T4)
      [{ id: 'fireflower', qty: 5 }, { id: 'fireflower_seed',qty:5 }, { id: 'platinum_bar', qty: 5 }],  // L5→L6 (T5)
      [{ id: 'iceflower',  qty: 5 }, { id: 'iceflower_seed', qty:5 }, { id: 'crimson_bar',  qty: 5 }],  // L6→L7 (T6)
    ];
    return BUNDLES[level] || null;
  }

  // Transforms unlocked at each level. Index = level, value = { input, output }.
  // Each transform is 1 produce → 1 bar. shrineLevel >= entry.level means
  // the player has unlocked that transform.
  static SHRINE_TRANSFORMS = [, // 0,1 unused
    null,                                            // L1: nothing
    { input: 'rainberry',  output: 'copper_bar' },   // L2
    { input: 'coffee',     output: 'iron_bar' },     // L3
    { input: 'sunflower',  output: 'gold_bar' },     // L4
    { input: 'fireflower', output: 'platinum_bar' }, // L5
    { input: 'iceflower',  output: 'crimson_bar' },  // L6
    { input: 'iceflower',  output: 'frost_bar' },    // L7 — endgame, ALSO iceflower
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
          if (heldCount(matching.input) < 1) { this.flash('gone', sx, sy); return; }
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
    const costHTML = bundle.map(r => {
      const it = ITEM_BY_ID[r.id];
      return `${r.qty}× ${this.iconSpanHTML(r.id)} ${it?.name || r.id}`;
    }).join(' + ');
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
        const newTransform = MapScene.SHRINE_TRANSFORMS[this.save.shrineLevel];
        const unlockMsg = newTransform
          ? `unlocked ${ITEM_BY_ID[newTransform.input]?.name} → ${ITEM_BY_ID[newTransform.output]?.name}`
          : 'shrine grows in power';
        this.flashLoot(`✨ Shrine L${this.save.shrineLevel}\n${unlockMsg}`, '#a7e9ff', 1.4);
      },
    });
  }

  presentBlacksmithOffer(sx, sy, offer, recordDeal, house) {
    const recipe = this.blacksmithRecipe(offer.kind, offer.slot, offer.tier);
    if (!recipe) {
      this.flash('we are still working on something for you', sx, sy);
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
    this.showOfferModal({
      title: 'The blacksmith will forge:',
      get: `${iconHtml} ${name}`,
      cost: costHTML,
      canAfford: canAfford(),
      acceptLabel: 'Trade',
      onAccept: () => {
        const curTier = offer.kind === 'relic'
          ? (this.save.relics?.[offer.slot]?.tier ?? 0)
          : (this.save.armor?.[offer.slot]?.tier ?? 0);
        if (offer.tier <= curTier) { this.flash('already own better', sx, sy); return; }
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
        this.flashLoot(`🪙 ${name}`, '#ffe066', 1.25);
      },
    });
  }

  // Build a shop offer for buying ${id} (baseValue = PRICES[id]).
  // 1/3 chance: trader wants 2x value in cash. 2/3: barter for an inventory item.
  // Barter threshold is 0.75× baseValue (lenient) so debris-tier wild pickups
  // qualify too — otherwise early-game players almost never see a barter, since
  // wild rockfruit/shrub/longgrass at $1-2 fall below higher thresholds.
  // If the player owns NO qualifying barter item, the trader still names what
  // they want; the modal just disables the accept button (shows "✗"). This way
  // the player learns "this trader wants rockfruit" and can come back with it.
  buildShopOffer(id, baseValue, forceBarter = false) {
    const wantMoney = !forceBarter && Math.random() < 1/3;
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
        shortGain: `−1 ${wishItem?.icon || ''}`,
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
      shortGain: `−1 ${pickItem?.icon || ''}`,
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
        crops:       { url: 'Objects/Crops.png',                       cols: 9,  srcW: 144, srcH: 256 },
        springcrops: { url: 'Objects/Spring Crops.png',                cols: 14, srcW: 224, srcH: 128 },
        gems:        { url: 'Icons/RPG icons/Extras/Gemstones.png',    cols: 7,  srcW: 112, srcH: 64  },
        coal_icon:   { url: 'Icons/RPG icons/Extras/Coal.png',         cols: 2,  srcW: 32,  srcH: 32  },
        // Animal produce — 32×16 (2 frames). frame 0 = standalone item.
        icon_egg:    { url: 'Icons/Food Icons/Chicken Egg.png',        cols: 2,  srcW: 32,  srcH: 16  },
        icon_milk:   { url: 'Icons/Food Icons/Small Cow Milk.png',     cols: 2,  srcW: 32,  srcH: 16  },
        // Orchard fruit — 32×16 each (frame 0 = whole fruit).
        icon_apple:   { url: 'Icons/Food Icons/Apple.png',             cols: 2,  srcW: 32,  srcH: 16  },
        icon_cherry:  { url: 'Icons/Food Icons/Cherry.png',            cols: 2,  srcW: 32,  srcH: 16  },
        icon_peach:   { url: 'Icons/Food Icons/Peach.png',             cols: 2,  srcW: 32,  srcH: 16  },
        icon_banana:  { url: 'Icons/Food Icons/Banana.png',            cols: 2,  srcW: 32,  srcH: 16  },
        icon_orange:  { url: 'Icons/Food Icons/Orange.png',            cols: 2,  srcW: 32,  srcH: 16  },
        icon_mango:   { url: 'Icons/Food Icons/Mango.png',             cols: 2,  srcW: 32,  srcH: 16  },
        icon_coconut: { url: 'Icons/Food Icons/Coconut.png',           cols: 2,  srcW: 32,  srcH: 16  },
        icon_apricot: { url: 'Icons/Food Icons/Apricot.png',           cols: 2,  srcW: 32,  srcH: 16  },
        // Fish — 64×16 (4 frames). No dedicated minnow art — reuse the
        // smallmouth bass icon (same family, just smaller fiction).
        icon_minnow:     { url: 'Icons/Fish/Sea/Smallmouth Bass.png',    cols: 4, srcW: 64, srcH: 16 },
        icon_bass:       { url: 'Icons/Fish/River/Large Mouth Bass.png', cols: 4, srcW: 64, srcH: 16 },
        icon_trout:      { url: 'Icons/Fish/River/Tiger Trout.png',      cols: 4, srcW: 64, srcH: 16 },
        icon_salmon:     { url: 'Icons/Fish/Sea/Salmon.png',             cols: 4, srcW: 64, srcH: 16 },
        icon_goldenfish: { url: 'Icons/Fish/River/Golden Fish.png',      cols: 4, srcW: 64, srcH: 16 },
        // Consumables + wilderness drops.
        icon_flute:    { url: 'Icons/RPG icons/Extras/Flutes.png',          cols: 2,  srcW: 32,  srcH: 32 },
        icon_book:     { url: 'Icons/RPG icons/Extras/Books.png',           cols: 15, srcW: 240, srcH: 64 },
        icon_meat:     { url: 'Icons/Food Icons/Beef.png',                  cols: 2,  srcW: 32,  srcH: 32 },
        icon_pelt:     { url: 'Icons/Food Icons/Black rabbit Fur.png',      cols: 2,  srcW: 32,  srcH: 16 },
        icon_feather:  { url: 'Icons/RPG icons/Extras/Chicken feather.png', cols: 9,  srcW: 144, srcH: 32 },
        // Beach pickup — 48×64 = 3×4 of 16×16. Frame 0 is the canonical
        // cowrie used as the inventory icon.
        shell_sheet:   { url: 'Icons/Fish/Sea/Creatures/Shell.png',         cols: 3,  srcW: 48,  srcH: 64 },
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
        el.textContent = item?.icon || '·';
        el.style.cssText = `display:inline-block;font-size:${Math.round(sizePx * 0.9)}px;line-height:${sizePx}px;`;
      }
      return el;
    }
    // Inline string form (used inside modal cost/get text).
    if (css) return `<span style="${css}"></span>`;
    return item?.icon || '?';
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
  syncJoystickButton() {
    const btn = document.getElementById('joystick-toggle');
    if (btn) btn.textContent = `Joystick: ${this.save.joystick ? 'on' : 'off'}`;
  }
  toggleJoystick() {
    this.save.joystick = !this.save.joystick;
    persistSave(this.save);
    this.syncJoystickButton();
    if (this.save.joystick) {
      // Turn ON: stop any GPS watch, clear pending ease, show the pad.
      if (this.gpsWatchId != null && navigator.geolocation) {
        try { navigator.geolocation.clearWatch(this.gpsWatchId); } catch {}
      }
      this.gpsWatchId = null;
      this.gpsAvailable = false;
      this.gpsM = null;
      this._ease = null;
      this.buildJoystick();
    } else {
      // Turn OFF: tear down the pad, restart GPS so real walking works again.
      this.removeJoystick();
      this.joystickVec = { x: 0, y: 0 };
      if (!window.__TEST_MODE) this.startGps();
    }
  }
  removeJoystick() {
    document.getElementById('joystick')?.remove();
  }
  // Virtual analog stick — bottom-right above the inventory bar. Fixed to the
  // viewport (outside #game for the usual transform-containing-block reason).
  // Pointer events drive this.joystickVec ∈ [-1, 1]²; update() adds it to the
  // movement vector exactly like WASD.
  buildJoystick() {
    this.removeJoystick();
    const PAD = 110, NUB = 48;
    const HALF = (PAD - NUB) / 2;     // nub centred in the pad at rest
    const R = HALF;                   // max nub offset from pad centre
    const pad = document.createElement('div');
    pad.id = 'joystick';
    // Sits above the inventory bar (bar bottom 48 + bar height ~54 + gap).
    pad.style.cssText =
      `position:fixed;` +
      `bottom:calc(118px + env(safe-area-inset-bottom, 0px));` +
      `right:calc(var(--phone-right, 0px) + 16px);width:${PAD}px;height:${PAD}px;border-radius:50%;` +
      `background:rgba(0,0,0,0.35);border:2px solid #666;z-index:6;` +
      `touch-action:none;user-select:none;-webkit-user-select:none;`;
    const nub = document.createElement('div');
    nub.style.cssText =
      `position:absolute;left:${HALF}px;top:${HALF}px;` +
      `width:${NUB}px;height:${NUB}px;border-radius:50%;` +
      `background:rgba(255,255,255,0.55);border:2px solid #fff;pointer-events:none;`;
    pad.appendChild(nub);
    document.body.appendChild(pad);

    let activePtr = null;
    const reset = () => {
      activePtr = null;
      nub.style.left = `${HALF}px`;
      nub.style.top  = `${HALF}px`;
      this.joystickVec = { x: 0, y: 0 };
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
  // Bump _relicsGen at every site that writes save.relics / save.armor so the
  // per-frame row rebuild can early-out by comparing a counter instead of
  // recomputing a join-string of every slot every frame.
  markRelicsDirty() { this._relicsGen = (this._relicsGen || 0) + 1; }
  updateRelicRow() {
    const gen = this._relicsGen || 0;
    if (this._relicRowGen === gen) return;
    this._relicRowGen = gen;
    const relics = this.save.relics || {};
    const order = ['pick','axe','sword','bow','staff','ring','amulet'];
    document.getElementById('relic-row')?.remove();
    const owned = order.filter(s => relics[s]);
    if (!owned.length) return;
    const row = document.createElement('div');
    row.id = 'relic-row';
    // position:fixed + appended to <body> for the same reason as the inv bar
    // (see buildInventoryDOM): a fixed element inside transformed #game would
    // anchor to #game, not the viewport.
    row.style.cssText = 'position:fixed;top:calc(42px + env(safe-area-inset-top, 0px));right:calc(var(--phone-right, 0px) + 8px);display:flex;gap:4px;padding:4px 6px;background:#000a;border:2px solid #444;border-radius:8px;z-index:7;pointer-events:none;';
    for (const slot of owned) {
      const wrap = document.createElement('span');
      wrap.style.cssText = 'display:inline-block;line-height:0;';
      wrap.innerHTML = this.gearIconHTML('relic', slot, relics[slot].tier, 20);
      row.appendChild(wrap);
    }
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
  showOfferModal({ title, get, blurb, cost, canAfford, onAccept, acceptLabel = 'Buy', secondary }) {
    document.getElementById('offer-modal')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'offer-modal';
    wrap.style.cssText =
      'position:absolute;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;' +
      'background:#0008;pointer-events:auto;';
    const box = document.createElement('div');
    box.style.cssText =
      'min-width:230px;max-width:340px;background:#1a1612;color:#fff;border:2px solid #c8a64a;' +
      'border-radius:10px;padding:14px 16px;font:13px ui-monospace,monospace;text-align:center;';
    const blurbHtml = blurb
      ? `<div style="font-size:11px;opacity:.75;margin-bottom:6px">${blurb}</div>`
      : '';
    box.innerHTML =
      `<div style="opacity:.75;font-size:11px;margin-bottom:6px">${title}</div>` +
      `<div style="font-size:16px;font-weight:700;margin:4px 0;color:#ffe066">${get}</div>` +
      blurbHtml +
      `<div style="opacity:.85;margin:6px 0 4px">for</div>` +
      `<div style="font-size:16px;font-weight:700;margin:4px 0 10px;color:${canAfford ? '#a7ffb0' : '#ff8a7a'}">${cost}</div>`;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;justify-content:center;margin-top:4px;flex-wrap:wrap;';
    const mkBtn = (label, primary, disabled) => {
      const b = document.createElement('button');
      b.innerHTML = label;
      b.style.cssText =
        `padding:8px 12px;border-radius:6px;font:700 12px ui-monospace,monospace;cursor:pointer;` +
        (primary
          ? 'background:#c8a64a;color:#1a1612;border:0;'
          : 'background:transparent;color:#ddd;border:2px solid #444;');
      if (disabled) { b.disabled = true; b.style.opacity = '0.4'; b.style.cursor = 'not-allowed'; }
      return b;
    };
    const cancel = mkBtn('Cancel', false, false);
    const sec    = secondary ? mkBtn(secondary.label, false, !!secondary.disabled) : null;
    const accept = mkBtn(acceptLabel, true, !canAfford);
    cancel.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); });
    accept.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); onAccept(); });
    if (sec) sec.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); secondary.onClick(); });
    wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
    row.appendChild(cancel);
    if (sec) row.appendChild(sec);
    row.appendChild(accept);
    box.appendChild(row);
    wrap.appendChild(box);
    (document.getElementById('game') || document.body).appendChild(wrap);
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
    const pageCount = Math.max(1, Math.ceil(this.save.inv.length / PAGE));
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
    nameLbl.style.cssText = 'position:fixed;bottom:calc(30px + env(safe-area-inset-bottom, 0px));left:var(--phone-left, 0px);right:var(--phone-right, 0px);text-align:center;color:#ffd866;font:11px ui-monospace,monospace;pointer-events:none;z-index:6;text-shadow:1px 1px 2px #000,0 0 3px #000;';
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
  // No audio in this game — disable both backends so Phaser uses the
  // NoAudioSoundManager and never creates an AudioContext. Without this the
  // browser logs a "failed to start the audio device" warning on iOS/Android
  // because Web Audio can't start before the first user gesture.
  audio: { noAudio: true, disableWebAudio: true },
});
