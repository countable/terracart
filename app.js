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
const W = 390, H = 844;

// --- Debug ---
// Arrow keys move the player at DEBUG_SPEED_MUL × walk speed when DEBUG is true.
const DEBUG = true;
const DEBUG_SPEED_MUL = 10;

// --- Tap reach radii (metres). Used by handleWorldTap distance checks. ---
const REACH_CREATURE_M  = 4;
const REACH_WILDPLANT_M = 4;
const REACH_OBJECT_M    = 3.5; // chest / tree
const REACH_HOUSE_M     = 6;   // house body is larger than 3.5m
// Outer "too far" gate from the player. Matches the visual reach outline drawn by
// drawCells (15m, scene.REACH_CELL_M) so anything outside the boundary is unreachable.
const REACH_FAR_M       = 15;
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
  16: 0x7a7a82, // COMMERCIAL   (ROCKY)     — cool slate
  17: 0x5a5a5e, // INDUSTRIAL   (ROCKY)     — dark slate
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
    if (window.TileMap) {
      this.load.spritesheet(TileMap.KEY, TileMap.PATH, { frameWidth: TileMap.FRAME_W, frameHeight: TileMap.FRAME_H });
    }
    // Relic / armor icons — one per (kind, slot, tier). Per-tier art lives under
    // Weapons and Armor/<tier>/; the ring + amulet share a single sprite-sheet
    // image under Extras/ (tier shown via a coloured badge in the UI).
    if (typeof RELIC_DEFS !== 'undefined') {
      for (const slot of Object.keys(RELIC_DEFS)) {
        for (const t of MATERIAL_TIERS) {
          const key = gearIconKey('relic', slot, t.tier);
          const path = gearAssetPath('relic', slot, t.tier);
          if (key && path) this.load.image(key, path);
        }
      }
      for (const slot of Object.keys(ARMOR_DEFS)) {
        for (const t of MATERIAL_TIERS) {
          const key = gearIconKey('armor', slot, t.tier);
          const path = gearAssetPath('armor', slot, t.tier);
          if (key && path) this.load.image(key, path);
        }
      }
    }
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
    this.save.relics = this.save.relics || { pick: null, axe: null, ring: null, amulet: null };
    if (this.save.relics.axe === undefined) this.save.relics.axe = null;   // older saves
    // Per-shop offer state: { [houseId]: { kind, slot, tier, price, rerollCount } }
    this.save.shopOffers = this.save.shopOffers || {};
    // Starter shop nearest spawn — guaranteed wood pick + wood axe for sale.
    // starterStock tracks which of those two items have been bought.
    this.save.starterStock = this.save.starterStock || { pick: true, axe: true };
    this.save.armor  = this.save.armor  || { helmet: null, chest: null, legs: null, boots: null };
    const maxE = (typeof maxEnergyFromArmor === 'function')
      ? maxEnergyFromArmor(this.save.armor) : (typeof STARTING_ENERGY !== 'undefined' ? STARTING_ENERGY : 100);
    if (this.save.maxEnergy == null) this.save.maxEnergy = maxE;
    if (this.save.energy == null)    this.save.energy = this.save.maxEnergy;
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
    if (needsMigrationPersist) persistSave(this.save);

    this.cameras.main.setBackgroundColor('#222');
    this.viewCenterX = W / 2;
    this.viewCenterY = H / 2 - 40;            // raise to leave room for inventory bar
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
    this.REACH_CELL_M = 15;   // cell taps: till / plant / water / harvest
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
    window.ITEM_DATA_URLS.flowers   = bakeCanvas('flora_flower_0');
    // Shape-based concrete pads under POI chests. One texture per unique shape
    // (square3 / square2 / cross / triangle); the POI's class picks the shape
    // (see padShapeForPoi below). No statues — the pad SHAPE conveys POI type.
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

    // Pre-create terrain sprite pool (one per visible cell) to avoid allocation churn.
    this.terrainPool = [];
    if (window.TileMap) {
      for (let i = 0; i < VIEW_CELLS * VIEW_CELLS; i++) {
        const s = this.add.image(0, 0, TileMap.KEY, 0).setOrigin(0, 0)
          .setDisplaySize(CELL_PX, CELL_PX).setVisible(false);
        this.terrainContainer.add(s);
        this.terrainPool.push(s);
      }
    }

    // Noise overlay pool — one image per visible cell, set to a hashed noise frame.
    this.noisePool = [];
    for (let i = 0; i < VIEW_CELLS * VIEW_CELLS; i++) {
      const s = this.add.image(0, 0, 'biome5_0').setOrigin(0, 0)
        .setDisplaySize(CELL_PX, CELL_PX).setVisible(false);
      this.noiseContainer.add(s);
      this.noisePool.push(s);
    }

    // Cobblestone overlay pool for ROAD cells (one decorative stone centered per cell).
    this.cobblePool = [];
    for (let i = 0; i < VIEW_CELLS * VIEW_CELLS; i++) {
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
    for (let i = 0; i < VIEW_CELLS * VIEW_CELLS; i++) {
      const t = this.add.text(0, 0, '', {
        font: 'bold 13px serif', color: '#000000',
      }).setOrigin(0.5, 0.5).setAlpha(0.40).setDepth(0).setVisible(false);
      this.letterContainer.add(t);
      this.letterPool.push(t);
    }

    this.objectPool = [];
    this.plantedPool = [];
    this.plantedTimerPool = []; // small Phaser.Text in cell corner: growth minutes remaining
    this.creaturePool = [];
    this.chestLabelPool = []; // Phaser.Text objects for POI names above chests
    this.decorPool = [];      // sprites for per-POI "statue" decorations beside chests

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

    // Boot tile load
    this.ensureTilesAround().catch(e => console.error(e));

    // Network status
    window.addEventListener('offline', () => this.showBanner(true));
    window.addEventListener('online', () => this.showBanner(false));

    // GPS watch + device compass (best-effort). Test mode skips them so the
    // test harness can drive playerM directly without GPS easing fighting it.
    if (!window.__TEST_MODE) {
      this.startGps();
      this.startCompass();
      this.setupLifecycle();
    }
    // Tests reach into the scene via window.__scene.
    window.__scene = this;
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
      } else {
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
  // webkitCompassHeading (iOS). Stores degrees clockwise from north in this.compassDeg.
  startCompass() {
    const onOrient = (e) => {
      let deg = null;
      if (typeof e.webkitCompassHeading === 'number') {
        deg = e.webkitCompassHeading; // iOS: already CW from north
      } else if (e.absolute && typeof e.alpha === 'number') {
        deg = (360 - e.alpha) % 360;  // alpha is CCW from north; flip
      } else if (typeof e.alpha === 'number' && this.compassDeg == null) {
        deg = (360 - e.alpha) % 360;  // best-effort non-absolute fallback
      }
      if (deg != null && !Number.isNaN(deg)) {
        const rad = deg * Math.PI / 180;
        this.compassDeg = deg;
        this.facing = { x: Math.sin(rad), y: -Math.cos(rad) };
      }
    };
    const attach = () => {
      window.addEventListener('deviceorientationabsolute', onOrient, true);
      window.addEventListener('deviceorientation', onOrient, true);
    };
    // iOS 13+ requires explicit permission. If the API is gated, request it.
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      DOE.requestPermission().then(r => { if (r === 'granted') attach(); }).catch(() => {});
    } else {
      attach();
    }
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
    // Spawn chickens on any soft ground (grass / farmland / park / residential lawn).
    // Each MVT tile is ~1.5km across — the 55m viewport is only ~0.1% of a tile —
    // so we need hundreds per tile for any to actually be visible.
    const chickenN = 75 + Math.floor(rng() * 50);    // 75..125 per tile (halved)
    for (let i = 0; i < chickenN; i++) tryPlace('chicken', new Set([0, 4, 5, 6]), i, 'chicken');
    // Cows: same soft ground as chickens, but ~10x rarer.
    const cowN = 15 + Math.floor(rng() * 16);   // 15..30 per tile
    for (let i = 0; i < cowN; i++) tryPlace('cow', new Set([0, 4, 5, 6]), i, 'cow');
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
    // Force a guaranteed X ~10m north of the player's start.
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
  startWorkProgress(worldX, worldY, onComplete) {
    this._workProgress = { worldX, worldY, onComplete, startT: performance.now() };
  }
  cancelWorkProgress() {
    this._workProgress = null;
    this._workProgressGfx?.clear();
  }
  _drawWorkProgress() {
    const wp = this._workProgress;
    if (!wp) return;
    const elapsed = performance.now() - wp.startT;
    if (elapsed >= 3000) {
      const cb = wp.onComplete;
      this.cancelWorkProgress();
      cb();
      return;
    }
    const progress = elapsed / 3000;
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
    WorldGen.forEachItem('creatures', (c) => {
      if (c.kind !== 'chicken' && c.kind !== 'cow') return;
      if (this.save.caught.includes(c.id)) return;
      const ddx = c.x - px, ddy = c.y - py;
      if (ddx * ddx + ddy * ddy > RANGE_SQ) return;
      if (c._nextChooseT == null || now >= c._nextChooseT) {
        if (c._homeX == null) { c._homeX = c.x; c._homeY = c.y; }
        // Bias back toward home if we've drifted far so chickens stay near
        // their spawn cluster rather than wandering off forever.
        const dxh = c._homeX - c.x, dyh = c._homeY - c.y;
        const homeBias = Math.hypot(dxh, dyh) > 3 * this.cellM;
        // Try up to 6 angles to find one whose destination isn't blocked:
        // placed rockfruit fences AND any building footprint (small/med/large).
        // Animals path around walls and houses both.
        let tx = c.x, ty = c.y, angle = 0;
        for (let attempt = 0; attempt < 6; attempt++) {
          angle = homeBias
            ? Math.atan2(dyh, dxh) + (Math.random() - 0.5) * 0.8
            : Math.random() * Math.PI * 2;
          tx = c.x + Math.cos(angle) * STEP_M;
          ty = c.y + Math.sin(angle) * STEP_M;
          const cellIX = Math.floor(tx / this.cellM);
          const cellIY = Math.floor(ty / this.cellM);
          if (this.placedRockSet && this.placedRockSet.has(cellKeyFromAbsCell(cellIX, cellIY))) continue;
          const dest = this.cellAt(tx, ty);
          // Block on water (3) and any building tier (9/11/12).
          if (dest.loaded && (dest.type === 3 || dest.type === 9 || dest.type === 11 || dest.type === 12)) continue;
          break;
        }
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

  // Walk outward in a ring (up to 6 cells) from the given world-cell coords and return
  // the COLOR of the first non-road, non-building cell found. Returns null if none found.
  neighborNonRoadColor(wcx, wcy) {
    const offsets = [
      [1,0],[-1,0],[0,1],[0,-1],
      [2,0],[-2,0],[0,2],[0,-2],[1,1],[1,-1],[-1,1],[-1,-1],
      [3,0],[-3,0],[0,3],[0,-3],
    ];
    for (const [dx, dy] of offsets) {
      const ncx = wcx + dx, ncy = wcy + dy;
      const tx = Math.floor(ncx / this.cellsPerTile);
      const ty = Math.floor(ncy / this.cellsPerTile);
      const ix = Math.floor(ncx - tx * this.cellsPerTile);
      const iy = Math.floor(ncy - ty * this.cellsPerTile);
      const entry = WorldGen.tileCache.get(`${WorldGen.Z}/${tx}/${ty}`);
      if (!entry || !entry.grid) continue;
      const t = entry.grid[iy * this.cellsPerTile + ix] || 0;
      // Skip roads (any tier) and buildings — those are themselves overlays.
      if (t !== 7 && t !== 13 && t !== 14 && t !== 9 && t !== 11 && t !== 12) return COLORS[t] ?? null;
    }
    return null;
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
    // If this was a player-released creature, also trim it from save.released so the
    // array doesn't grow unbounded across many release-and-recatch cycles.
    if (this.save.released) {
      const ri = this.save.released.findIndex(r => r.id === c.id);
      if (ri >= 0) this.save.released.splice(ri, 1);
    }
    // Per-creature catch yield. Chickens yield 4 (eggs + bird); cows yield 1.
    const yieldN = c.kind === 'chicken' ? 4 : 1;
    this.addToInv(c.kind, yieldN); // stack into inventory (icon comes from ITEMS)
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

  updateHUD() {
    // Money badge always shown.
    if (this.moneyEl) this.moneyEl.textContent = `$${this.save.money ?? 0}`;
    this.updateEnergyDOM();
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

  updateEnergyDOM() {
    const el = document.getElementById('energy');
    if (!el) return;
    const cur = Math.max(0, this.save.energy ?? 0);
    const max = this.save.maxEnergy ?? STARTING_ENERGY;
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
  eatSelected() {
    const sel = getSelectedSlot(this.save);
    if (!sel || (sel.count ?? 0) <= 0) return false;
    const restore = FOOD_ENERGY[sel.id];
    if (restore == null) return false;
    const before = this.save.energy ?? 0;
    this.save.energy = Math.min(this.save.maxEnergy ?? STARTING_ENERGY, before + restore);
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
    const cur = this.save.energy ?? 0, max = this.save.maxEnergy ?? STARTING_ENERGY;
    const slotRow = (kind, slot) => {
      const eq = (kind === 'relic' ? this.save.relics : this.save.armor)?.[slot];
      const def = gearDef(kind, slot);
      const label = def?.name || slot;
      if (!eq) {
        return `<div style="display:flex;justify-content:space-between;padding:2px 0;opacity:.55"><span>${label}</span><span style="font-size:11px">— empty —</span></div>`;
      }
      const path = gearAssetPath(kind, slot, eq.tier);
      const t = TIER_BY_NUM[eq.tier];
      const iconHtml = path ? `<img src="${path}" style="width:20px;height:20px;image-rendering:pixelated;vertical-align:middle">` : '';
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
    if (house && house.id && dealCap !== Infinity) {
      this.save.shopDeals = this.save.shopDeals || {};
      const now = Date.now();
      const hourAgo = now - 60 * 60 * 1000;
      const list = (this.save.shopDeals[house.id] || []).filter(t => t > hourAgo);
      this.save.shopDeals[house.id] = list;
      if (list.length >= dealCap) {
        const oldest = Math.min(...list);
        const waitMin = Math.max(1, Math.ceil((oldest + 60 * 60 * 1000 - now) / 60000));
        const kindLabel = (house.kind === 'tower' || house.tier === 12) ? 'castle'
                        : (house.tier === 11) ? 'fort' : 'house';
        this.flash(`${kindLabel} busy — try again in ${waitMin}m`, sx, sy);
        return;
      }
    }
    // Record a deal against this house — called from inside the accept path.
    const recordDeal = () => {
      if (!house || !house.id || dealCap === Infinity) return;
      this.save.shopDeals = this.save.shopDeals || {};
      const list = this.save.shopDeals[house.id] = this.save.shopDeals[house.id] || [];
      list.push(Date.now());
    };
    const sel = this.save.inv[this.save.selSlot];
    if (sel && sel.id) {
      // SELL one of the selected stack — confirm first so an accidental
      // house tap can't silently dump a high-value item.
      const price = Math.max(1, Math.ceil((PRICES[sel.id] ?? 1) / 2));
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
    // Three special tracks come BEFORE the regular seed/produce rotation:
    //   (a) Starter shop  — the nearest building to spawn always has a wood
    //       pickaxe AND wood axe in stock until each is bought (so players
    //       can clear rocks/trees without hunting for a relic).
    //   (b) Castle / tower — always sells relics, no rate-limit, with re-roll.
    //   (c) Regular house — 10% chance to swap the normal offer for a relic.
    if (house && this.isStarterShop(house) && this.starterShopOffer()) {
      this.presentRelicOffer(sx, sy, this.starterShopOffer(), recordDeal, house);
      return;
    }
    if (isCastle) {
      const offer = this.peekOrBuildRelicOffer(house);
      if (offer) { this.presentRelicOffer(sx, sy, offer, recordDeal, house); return; }
      // (very rare) every slot is at max tier — fall through to regular offer.
    }
    if (Math.random() < 0.10) {
      const relicOffer = this.peekOrBuildRelicOffer(house);
      if (relicOffer) { this.presentRelicOffer(sx, sy, relicOffer, recordDeal, house); return; }
    }
    // Each house has a deterministic "shop kind" derived from its world
    // position: ~30% of houses sell PRODUCE (harvested crops), the rest sell
    // SEEDS from the rotating buyIndex. Same house always offers the same
    // category, so the player learns "this house sells crops".
    const houseSeed = house
      ? ((Math.round(house.x * 100) ^ Math.round(house.y * 100)) >>> 0)
      : 0;
    const sellsProduce = houseSeed && ((houseSeed * 2654435761) >>> 0) % 10 < 3;
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
    const offer = this.buildShopOffer(id, baseValue);
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
    return {
      kind: 'relic', slot: want, tier: 1,
      price: gearPrice('relic', want, 1),
      starter: true,
    };
  }

  // Read the persisted offer for this house if set, else build a new one and
  // persist. Persisting means the same offer "stays on display" until the
  // player either buys it, rerolls it, or (for non-castle shops) leaves and
  // the cap resets it. Castle offers persist forever and rotate on purchase.
  peekOrBuildRelicOffer(house) {
    const id = house?.id;
    if (id && this.save.shopOffers[id]) return this.save.shopOffers[id];
    const off = this.buildRelicOffer();
    if (off && id) {
      off.rerollCount = 0;
      this.save.shopOffers[id] = off;
    }
    return off;
  }

  // Pick a random relic OR armor piece the player can actually use — meaning
  // their current slot is empty or holds a strictly lower tier. Returns null
  // if no upgrade is possible (caller falls through to the usual seed offer).
  // Tier is biased low so most offers are wood/copper; rare materials are rare.
  buildRelicOffer() {
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
    let r = Math.random() * total;
    let pick = weighted[weighted.length - 1].c;
    for (const w of weighted) { r -= w.w; if (r <= 0) { pick = w.c; break; } }
    const price = Math.max(1, Math.ceil(gearPrice(pick.kind, pick.slot, pick.tier) * (1.2 + Math.random() * 1.8)));
    return { ...pick, price };
  }

  // Render a relic/armor offer with Buy / Re-roll / Cancel buttons. Re-rolls
  // cost 5 × 2^(rerollCount) and stop when no other valid offers exist. The
  // offer is persisted under save.shopOffers[house.id] so a subsequent tap on
  // the same shop shows the same offer until it's bought.
  presentRelicOffer(sx, sy, offer, recordDeal, house) {
    document.getElementById('offer-modal')?.remove();
    const def = gearDef(offer.kind, offer.slot);
    const name = gearName(offer.kind, offer.slot, offer.tier);
    const path = gearAssetPath(offer.kind, offer.slot, offer.tier);
    const iconHtml = path
      ? `<img src="${path}" style="width:24px;height:24px;image-rendering:pixelated;vertical-align:middle">`
      : '';
    const blurb = offer.kind === 'relic'
      ? (def?.blurb || '')
      : `+${(ARMOR_DEFS[offer.slot]?.energyPerTier || 0) * offer.tier} max energy`;
    const canAfford = (this.save.money ?? 0) >= offer.price;
    const rerollCost = 5 * Math.pow(2, offer.rerollCount || 0);
    const rerollAfford = (this.save.money ?? 0) >= rerollCost && !offer.starter;

    const wrap = document.createElement('div');
    wrap.id = 'offer-modal';
    wrap.style.cssText =
      'position:absolute;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;' +
      'background:#0008;pointer-events:auto;';
    const box = document.createElement('div');
    box.style.cssText =
      'min-width:240px;max-width:340px;background:#1a1612;color:#fff;border:2px solid #c8a64a;' +
      'border-radius:10px;padding:14px 16px;font:13px ui-monospace,monospace;text-align:center;';
    const title = offer.starter ? 'Starter gear in stock:' : 'A trader offers a relic:';
    box.innerHTML =
      `<div style="opacity:.75;font-size:11px;margin-bottom:6px">${title}</div>` +
      `<div style="font-size:16px;font-weight:700;margin:4px 0;color:#ffe066">${iconHtml} ${name}</div>` +
      `<div style="font-size:11px;opacity:.75;margin-bottom:6px">${blurb}</div>` +
      `<div style="opacity:.85;margin:6px 0 4px">for</div>` +
      `<div style="font-size:16px;font-weight:700;margin:4px 0 10px;color:${canAfford ? '#a7ffb0' : '#ff8a7a'}">$${offer.price}</div>`;
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
    const reroll = offer.starter ? null : mkBtn(`Re-roll<br><span style="font-weight:400;font-size:10px;opacity:.85">$${rerollCost}</span>`, false, !rerollAfford);
    const buy = mkBtn(canAfford ? 'Buy' : '✗', true, !canAfford);
    cancel.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); });
    buy.addEventListener('click', (e) => {
      e.stopPropagation();
      if ((this.save.money ?? 0) < offer.price) { this.flash(`need $${offer.price}`, sx, sy); return; }
      addMoney(this.save, -offer.price);
      if (offer.kind === 'relic') {
        this.save.relics[offer.slot] = { tier: offer.tier };
      } else {
        this.save.armor[offer.slot] = { tier: offer.tier };
        const newMax = maxEnergyFromArmor(this.save.armor);
        const bump = Math.max(0, newMax - (this.save.maxEnergy ?? STARTING_ENERGY));
        this.save.maxEnergy = newMax;
        this.save.energy = Math.min(newMax, (this.save.energy ?? 0) + bump);
      }
      // Starter stock: mark the slot as bought so the shop rotates to the next item.
      if (offer.starter && this.save.starterStock) this.save.starterStock[offer.slot] = false;
      // Clear the persisted offer so the next tap generates a fresh one.
      if (house && house.id && this.save.shopOffers) delete this.save.shopOffers[house.id];
      recordDeal();
      persistSave(this.save);
      this.updateHUD();
      this.flashLoot(`🪙 ${name}\n−$${offer.price}`, '#ffe066', 1.25);
      wrap.remove();
    });
    if (reroll) reroll.addEventListener('click', (e) => {
      e.stopPropagation();
      if ((this.save.money ?? 0) < rerollCost) { this.flash(`need $${rerollCost}`, sx, sy); return; }
      const next = this.buildRelicOffer();
      if (!next) { this.flash('nothing else in stock', sx, sy); return; }
      addMoney(this.save, -rerollCost);
      next.rerollCount = (offer.rerollCount || 0) + 1;
      if (house && house.id) this.save.shopOffers[house.id] = next;
      persistSave(this.save);
      this.updateHUD();
      wrap.remove();
      this.presentRelicOffer(sx, sy, next, recordDeal, house);
    });
    wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
    row.appendChild(cancel);
    if (reroll) row.appendChild(reroll);
    row.appendChild(buy);
    box.appendChild(row);
    wrap.appendChild(box);
    (document.getElementById('game') || document.body).appendChild(wrap);
  }

  // Build a shop offer for buying ${id} (baseValue = PRICES[id]).
  // 1/3 chance: trader wants 2x value in cash. 2/3: barter for an inventory item.
  // Barter threshold is 0.75× baseValue (lenient) so debris-tier wild pickups
  // qualify too — otherwise early-game players almost never see a barter, since
  // wild rockfruit/shrub/longgrass at $1-2 fall below higher thresholds.
  // If the player owns NO qualifying barter item, the trader still names what
  // they want; the modal just disables the accept button (shows "✗"). This way
  // the player learns "this trader wants rockfruit" and can come back with it.
  buildShopOffer(id, baseValue) {
    const wantMoney = Math.random() < 1/3;
    const cashCost = Math.max(1, Math.ceil(baseValue * (1.2 + Math.random() * 1.8)));
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
    const need = baseValue * 0.75;
    const candidates = (this.save.inv || []).filter(s => s && s.id && (s.count ?? 0) >= 1 && (PRICES[s.id] ?? 0) >= need);
    if (!candidates.length) {
      // Player owns nothing qualifying — name a deterministic-but-varied want
      // so the offer text reads like a real ask. Pick any item priced ≥ need;
      // anchor by buyIndex so the same shop tap is stable until the player
      // earns enough buyIndex turns elsewhere to rotate it.
      const wishlist = Object.keys(PRICES).filter(k => PRICES[k] >= need && ITEM_BY_ID[k]);
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
      const sheetSize = src.sheet === 'springcrops'
        ? { cols: 14, srcW: 224, srcH: 128 }
        : { cols: 9,  srcW: 144, srcH: 256 };
      const col = src.frame % sheetSize.cols;
      const row = Math.floor(src.frame / sheetSize.cols);
      const url = src.sheet === 'springcrops' ? 'Objects/Spring Crops.png' : 'Objects/Crops.png';
      const scale = sizePx / 16;
      css = base + `background-image:url('${url}');`
        + `background-size:${sheetSize.srcW * scale}px ${sheetSize.srcH * scale}px;`
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

  showOfferModal({ title, get, cost, canAfford, onAccept, acceptLabel = 'Buy' }) {
    // Remove any existing modal first (only one at a time).
    document.getElementById('offer-modal')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'offer-modal';
    wrap.style.cssText =
      'position:absolute;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;' +
      'background:#0008;pointer-events:auto;';
    const box = document.createElement('div');
    box.style.cssText =
      'min-width:230px;max-width:320px;background:#1a1612;color:#fff;border:2px solid #c8a64a;' +
      'border-radius:10px;padding:14px 16px;font:13px ui-monospace,monospace;text-align:center;';
    box.innerHTML =
      `<div style="opacity:.75;font-size:11px;margin-bottom:6px">${title}</div>` +
      `<div style="font-size:18px;font-weight:700;margin:4px 0;color:#ffe066">${get}</div>` +
      `<div style="opacity:.85;margin:8px 0 4px">for</div>` +
      `<div style="font-size:16px;font-weight:700;margin:4px 0 12px;color:${canAfford ? '#a7ffb0' : '#ff8a7a'}">${cost}</div>`;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:center;margin-top:4px;';
    const mkBtn = (label, primary) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText =
        `padding:8px 14px;border-radius:6px;font:700 13px ui-monospace,monospace;cursor:pointer;` +
        (primary
          ? 'background:#c8a64a;color:#1a1612;border:0;'
          : 'background:transparent;color:#ddd;border:2px solid #444;');
      if (primary && !canAfford) { b.disabled = true; b.style.opacity = '0.4'; b.style.cursor = 'not-allowed'; }
      return b;
    };
    // When the player can't afford the asked item, swap the Yes label for ✗
    // so the modal still names the want, but the button reads as a refusal.
    const yes = mkBtn(canAfford ? acceptLabel : '✗', true);
    const no = mkBtn('Cancel', false);
    yes.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); onAccept(); });
    no.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); });
    wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
    row.appendChild(no); row.appendChild(yes);
    box.appendChild(row);
    wrap.appendChild(box);
    (document.getElementById('game') || document.body).appendChild(wrap);
  }

  addToInv(id, n = 1, silent = false) {
    const item = ITEM_BY_ID[id];
    if (!item) return;
    const existing = this.save.inv.find(s => s && s.id === id);
    if (existing) existing.count = (existing.count || 0) + n;
    else this.save.inv.push({ id, count: n });
    if (!silent) {
      persistSave(this.save);
      this.buildInventoryDOM();
    }
  }
  buildInventoryDOM() {
    const PAGE = 5;
    const game = document.getElementById('game');
    let bar = document.getElementById('inv');
    if (bar) bar.remove();
    bar = document.createElement('div');
    bar.id = 'inv';
    bar.style.cssText = 'position:absolute;bottom:48px;left:0;right:0;display:flex;justify-content:center;align-items:center;gap:3px;padding:6px;z-index:6;pointer-events:auto;';
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
    const pageLbl = document.createElement('span');
    pageLbl.textContent = `${this.save.invPage + 1}/${pageCount}`;
    pageLbl.style.cssText = 'color:#fff8;font:10px ui-monospace,monospace;margin-left:4px;';
    bar.appendChild(pageLbl);

    game.appendChild(bar);
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
});
