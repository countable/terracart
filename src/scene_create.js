// The scene's CREATE: MapScene.create, the one Phaser entry that builds the
// world once the assets are in — textures, layers, camera, HUD wiring, the
// save's starting state and the first tile requests — and hands over to tick().
//
// Moved verbatim out of app.js. The methods live on `class SceneCreate`, a MIXIN:
// app.js installs them onto MapScene.prototype right after the class closes
// (installSceneMixin, from modal_shell.js), so callers still say `this.x()`.
// This file loads BEFORE app.js: the methods read app.js names and this.* at
// CALL time only.

class SceneCreate {
  create() {
    this._endPreload?.(); this._endPreload = null;
    const _endCreate = window.__boot?.begin('scene create (world + textures)');
    window.__bootStatus?.(0.9, 'Surveying the neighbourhood…');
    // ── Phaser's own render step, timed from OUTSIDE it ──────────────────
    // Frame time minus our 'update (all)' tick has always been a black box:
    // is the rest of the frame our JS, or Phaser's (Graphics tessellation,
    // sprite batching, the GPU upload)? Game.prototype.step in
    // vendor/phaser.js runs scene.update() (our 'update (all)') THEN
    // renderer.preRender() / scene.render(s) / renderer.postRender(),
    // bracketed by the game's own 'prerender'/'postrender' events — so
    // timing exactly those two events is Phaser's render cost and nothing
    // of ours. Registered once here: create() runs exactly once for this
    // game's single scene (MapScene is never restarted).
    let _renderT0 = 0;
    this.game.events.on('prerender', () => { _renderT0 = performance.now(); });
    this.game.events.on('postrender', () => {
      const dt = performance.now() - _renderT0;
      window.__boot?.tick('phaser render', dt);
      if (this._boot_still) window.__boot?.tick('phaser render @still', dt);
    });
    // ── Device line for the load profile ─────────────────────────────────
    // "What is the slow device" needs a device to name: renderer type
    // (WebGL vs the Canvas fallback), navigator.deviceMemory where the
    // browser reports it, and the unmasked WebGL vendor/renderer strings
    // (WEBGL_debug_renderer_info — not every browser exposes it, hence the
    // guard). Read once here, not live in the report handler: the GL
    // extension lookup is cheap once, not something to redo on every menu
    // tap.
    if (window.__boot) {
      const device = { deviceMemory: navigator.deviceMemory || null };
      const renderer = this.game.renderer;
      device.rendererType = renderer && renderer.type === Phaser.WEBGL ? 'WebGL'
        : renderer && renderer.type === Phaser.CANVAS ? 'Canvas' : 'unknown';
      try {
        const gl = renderer && renderer.gl;
        const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) {
          device.gpuRenderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
          device.gpuVendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL);
        }
      } catch (_) { /* extension unavailable on this browser — leave gpu* unset */ }
      window.__boot.device = device;
    }
    this.save = Object.assign(
      {
        caught: [], planted: [], opened: [], tilled: [], picked: [], foundTreasures: [], brokenRocks: [], placedRocks: [],
        // Ids of traps the player has SPRUNG. Where the traps are is generated
        // from the tile's coordinates every time (src/traps.js) and never
        // stored; this list is what keeps a discovered trap discovered across
        // a reload. sprungTraps and disarmedTraps are the only two things
        // about a trap that are ever written down.
        sprungTraps: [],
        // Ids of traps the player has DISARMED with a Trap Disarm Kit — gone
        // for good: the tick that bites/bleeds and the renderer that draws
        // the mark both skip an id in here (see Traps.isDisarmed).
        disarmedTraps: [],
        money: STARTING_MONEY, buyIndex: 0,
        // inv is array of {id, count} — seeds-only per spec; planting decrements
        // count. Starts empty: the player's first potato seeds come from a
        // starter chest on the spawn trail (see STARTER_LOOT below).
        inv: [],
        // -1 = nothing in hand. The resting state: no pickup, tab switch,
        // spend or boot ever picks an item for the player (see inventory.js).
        selSlot: -1,
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
    // Normalize before building runtime membership views, so history caps stick.
    const needsStatePersist = SaveState.normalize(this.save);
    // Pin the game mode for the pure modules (prices, enemy HP, offline rest
    // read Difficulty.get(), not the save). Unset — a fresh save the how-to
    // card hasn't asked yet — reads as easy until chooseMode() runs.
    if (typeof Difficulty !== 'undefined') Difficulty.setMode(this.save.mode);
    // Chests left for later because the bag was full: { [chestId]: {id, n} }.
    // The chest stays out of save.opened (so it still renders + reopens) and
    // remembers exactly what it rolled, so reopening can't re-roll the loot.
    // (A SaveState.SAVE_DEFAULTS row — normalize above has already seated it.)
    // These runtime membership views write through to their save arrays. Each
    // mutation also joins the normal debounced persistence lane, so no caller
    // can update the live Set while leaving reload with stale progress.
    this.tilledSet = bindIdSet(this.save, 'tilled');
    this.brokenRockSet = bindIdSet(this.save, 'brokenRocks');
    this.placedRockSet = bindIdSet(this.save, 'placedRocks');
    // Cave walls the player has mined into walkable floor. Keys are
    // "<depth>:<absCellIX>_<absCellIY>" so the same GPS-mirrored cell can be dug
    // independently on each level. Re-applied to a cave tile's grid on load.
    this.dugWallSet = bindIdSet(this.save, 'dugWalls');
    // Fishing spots the player has landed a fish from (items.js fishSpotId).
    // One fish a spot, so a spot in here never bites again — never capped.
    this.fishedSpotSet = bindIdSet(this.save, 'fishedSpots');
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
    // maxEnergy (re-derived above). Skipped in test mode so the
    // harness's deterministic energy values aren't bumped on every reload. Runs
    // before the initial-state persist so a bumped energy is saved with it.
    if (this.save.lastSeenAt && !window.__TEST_MODE) {
      this.applyOfflineRest(Math.max(0, Date.now() - this.save.lastSeenAt));
    }
    SaveSession.attach(this.save);
    // Float accumulator for resting at Home — fractions of an energy point
    // accrue here between integer-pip bumps to save.energy.
    this._restAccrueE = 0;
    // Mark relics dirty so the first updateRelicRow call actually rebuilds.
    this._relicsGen = 1;
    // Transient runtime state — not persisted.
    this.pairyCompass = null;   // { targetId, x, y, until } when active
    if (needsStatePersist) persistSave(this.save);

    this.cameras.main.setBackgroundColor('#000');
    // Everything below this line is in LOGICAL px; the camera is what maps
    // them onto the device-resolution canvas (see the note by W/H).
    applyRenderScale(this.cameras.main);
    this.viewCenterX = W / 2;
    this.viewCenterY = H / 2 - 150;           // raise map clear of the TWO-bar inventory HUD (type tabs + item slots) and the Eat button beneath it
    this.viewLeft = this.viewCenterX - (VIEW_CELLS / 2) * CELL_PX;
    this.viewTop  = this.viewCenterY - (VIEW_CELLS / 2) * CELL_PX;
    this.viewSize = VIEW_CELLS * CELL_PX;
    // Camera offset from the player, in metres — non-zero only while a peek
    // drag is live or springing back. Set up here, with the rest of the view,
    // so it exists before anything can draw; the drag that moves it and the
    // rules it obeys are in the PEEK DRAG block further down.
    this.peekM = { x: 0, y: 0 };

    const origin = WorldGen.lonLatToWorldPx(START_LON, START_LAT, WorldGen.Z);
    this.originPx = origin;
    this.mPerPx = WorldGen.metersPerPixel(START_LAT, WorldGen.Z);
    this.cellM = WorldGen.CELL_M;
    // A tile's cell grid is its ROW's (WorldGen.cellsPerEdgeForTile — CLAUDE.md
    // "Every player sees the SAME generated world"); cellsForRow hands that to
    // coords.js, which indexes every tile by it. cellsPerTile is only the
    // frame's REFERENCE count (START_LAT's, the pre-per-row grid): the
    // absolute-cell encoding (tilled / dug-wall / placed-rock keys) is anchored
    // on it so a save's keys stay put on every row whose grid still matches it.
    // Never index a tile's arrays by it — entry.cellsPerEdge / rowCells().
    this.cellsPerTile = WorldGen.cellsPerEdgeForLat(START_LAT);
    this.cellsForRow = WorldGen.cellsPerEdgeForTile;
    this.tileEdgeM = WorldGen.tileEdgeMeters(START_LAT);
    // Fog of war — load the explored-cell masks. Keyed by tile and sized by
    // that tile's row grid, so it has to come after the grid is known and
    // before the first draw. (src/fog.js owns the storage; the masks
    // deliberately do NOT live on the WorldGen tile-cache entries, which get
    // evicted and re-rasterised.)
    Fog.init(this.save, this.cellsPerTile, this._fogGeom());
    // THE FEET ARE ON THE FIX. playerM is the GPS position, and the player
    // sprite is seated so its visible feet land exactly on it (see
    // playerFeetNudgeY below) — so the ground under your real position is the
    // ground the character is standing on. Until Sep 2026 the sprite was
    // CENTRED on the fix and the feet hung 14px (3 m) south of it: standing on
    // a road's centreline put the band through the character's waist and the
    // feet on the south shoulder, and the whole map read as shifted north of
    // where you were. feetOffsetM is the metres the feet sit south of playerM;
    // it is kept as a field because every reach / collision / stair site adds
    // it, and it is now 0 by construction. If you are tempted to seat the feet
    // below the fix again and compensate here, that is the bug coming back.
    this.feetOffsetM = 0;
    // Screen pixels per cell, published for modules that size sprite boxes in
    // metres (interact.js' creature hit-test) without an app.js global.
    this.cellPx = CELL_PX;
    // Reach RADIUS is now computed dynamically in coords.js (reachRadiusM): it
    // starts at 2.5 cells and grows to 5.5 via Inner Light upgrades.
    // NOTE: object/creature/wildplant taps share the SAME reach radius as cell
    // taps — interact.js' tooFar gate now reads coords.js reachRadiusM (the
    // dynamic 2.5..5.5-cell radius), NOT a fixed distance, so the lit
    // reach indicator and the tap-accept gate stay in lock-step at every reach
    // tier — and it is the ONLY reach gate; the Euclidean one it replaced is
    // gone rather than kept behind a guard. Tap PRECISION — how exactly your
    // tap must land on
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
    // An interrupted trial returns to its surface portal; completed wins persist.
    this._recoverArenaRun();
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

    // Bake terrain patterns and the two castle restoration-state atlases once.
    makeBiomeTextures(this, CELL_PX);
    makeTowerTexture(this);
    // Both tower atlases share their colours with the walls and courtyard.
    makeTowerTexture(this, CASTLE_STONE_UNCLAIMED, 'tower_unclaimed');
    // Pot of gold — art for the coin-burst POI (the ATM — loot.js isPotOfGold).
    makePotOfGoldTexture(this);
    // Traps: the barely-there scuff of a hidden one and the sprung iron jaw of
    // a discovered one. Temporary procedural stand-ins — see textures.js.
    makeTrapTextures(this);
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
    // Longgrass (display name "Long grass") — bake frame 10 of the 'props'
    // sheet (col 11 row 1 in 1-indexed coords = leafy green frond). Same
    // sprite as the in-world wildplant via CROP_SPRITE.longgrass.frame.
    // The Javelin's steel palette is applied by ASSETS before create. Bake
    // that same texture for inventory, shop offers and pickup toasts.
    window.ITEM_DATA_URLS.javelin = bakeSheetFrame('icon_javelin', 0, 16, 16);
    window.ITEM_DATA_URLS.longgrass = bakeSheetFrame('props', 10, 16, 16);
    for (const kind of ['slime', 'cave_slime', 'purple_slime', 'fire_slime']) {
      const art = SpriteLayout.creatureArt(kind);
      window.ITEM_DATA_URLS[kind] = bakeSheetFrame(art.sheet, 0, 32, 32);
    }
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
    window.ITEM_DATA_URLS.crab      = bakeSheetFrame('crab',      0, 16, 16);
    // The horse's right-facing idle (frame 8) and the turtle's top-down down
    // pose (frame 6) — the same sheets the world draws.
    window.ITEM_DATA_URLS.horse     = bakeSheetFrame('horse',     8, 32, 32);
    window.ITEM_DATA_URLS.sea_turtle    = bakeSheetFrame('sea_turtle',    6, 16, 16);
    // Wilderness drops that share their world sprite. Source sheet
    // + frame come from CROP_SPRITE.mushroom so the inventory icon stays
    // glued to whatever the world renderer is drawing.
    window.ITEM_DATA_URLS.mushroom  = bakeSheetFrame(
      CROP_SPRITE.mushroom.sheet,
      CROP_SPRITE.mushroom.frame, 16, 16);
    // Wood — inventory uses frame 2 (the third / "amber" log variant
    // of the three). Ground stacks pick a frame based on the stack's
    // qty (see render.js groundstack branch).
    window.ITEM_DATA_URLS.wood      = bakeSheetFrame('wood', 2, 16, 16);
    // Scarecrow — the placeable item shares the world sprite (32×32 single
    // image). Without this bake its inventory / shop / pickup-toast icon fell
    // back to the item.icon emoji (a 🪦 headstone), so the held item looked
    // nothing like what gets planted. Bake the frame so all surfaces match.
    window.ITEM_DATA_URLS.scarecrow = bakeSheetFrame('scarecrow', 0, 32, 32);
    // Badged icons (iconBadgeItem, items.js): the items whose own art is
    // shared — the Crops.png seeds' one bag, the saplings' one young tree —
    // wear the icon of what they yield in the corner. Baked at 32×32 off the
    // same sheet frames the icons resolve to (inventoryIconSource). Both
    // pieces are trimmed to their half-opaque pixels (these sheets carry faint
    // stray pixels across a cell) and drawn at a whole-pixel scale: the base
    // as large as fits (≤2×) and centred, the badge 2× when that fits
    // BADGE_MAX_PX, else 1×, in the bottom-right corner with a 1px dark rim
    // so it reads against the base.
    const BADGE_MAX_PX = 20;
    const trimmedFrame = (src) => {
      const fr = src && this.textures.getFrame(src.sheet, src.frame);
      if (!fr || !fr.source?.image) return null;
      const c = document.createElement('canvas');
      c.width = fr.cutWidth; c.height = fr.cutHeight;
      const cx = c.getContext('2d');
      cx.drawImage(fr.source.image, fr.cutX, fr.cutY, fr.cutWidth, fr.cutHeight, 0, 0, fr.cutWidth, fr.cutHeight);
      const a = cx.getImageData(0, 0, c.width, c.height).data;
      let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
      for (let i = 0; i < c.width * c.height; i++) {
        if (a[i * 4 + 3] < 128) continue;
        const x = i % c.width, y = (i / c.width) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      return x1 < 0 ? null : { c, x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    };
    for (const it of ITEMS) {
      const badgeId = iconBadgeItem(it.id);
      if (!badgeId) continue;
      const base = trimmedFrame(inventoryIconSource(it.id));
      const badge = trimmedFrame(inventoryIconSource(badgeId));
      if (!base || !badge) continue;
      const out = document.createElement('canvas');
      out.width = out.height = 32;
      const ox = out.getContext('2d');
      ox.imageSmoothingEnabled = false;
      const kb = Math.max(1, Math.min(2, Math.floor(32 / Math.max(base.w, base.h))));
      ox.drawImage(base.c, base.x0, base.y0, base.w, base.h,
        Math.floor((32 - base.w * kb) / 2), Math.floor((32 - base.h * kb) / 2), base.w * kb, base.h * kb);
      const k = Math.max(badge.w, badge.h) * 2 <= BADGE_MAX_PX ? 2 : 1;
      const dw = badge.w * k, dh = badge.h * k;
      const dx = 32 - 1 - dw, dy = 32 - 1 - dh;
      // The rim: the badge's silhouette in dark, stamped one pixel out.
      const rim = document.createElement('canvas');
      rim.width = badge.c.width; rim.height = badge.c.height;
      const rx = rim.getContext('2d');
      rx.drawImage(badge.c, 0, 0);
      rx.globalCompositeOperation = 'source-in';
      rx.fillStyle = '#1a1210';
      rx.fillRect(0, 0, rim.width, rim.height);
      for (const [mx, my] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        ox.drawImage(rim, badge.x0, badge.y0, badge.w, badge.h, dx + mx, dy + my, dw, dh);
      }
      ox.drawImage(badge.c, badge.x0, badge.y0, badge.w, badge.h, dx, dy, dw, dh);
      window.ITEM_DATA_URLS[it.id] = out.toDataURL();
    }
    // World sprites a DOM dialog can ask for by TEXTURE KEY — not items, so
    // they don't belong in ITEM_DATA_URLS. The treasure ceremony opens with
    // the art the chest it came out of was standing as (loot.js chestLook
    // names the key and frame; worldIconHTML turns them into a span), so a crate
    // opens under a crate and a trunk under a trunk. Baked from the same
    // sheets the renderer draws, including each trunk's tier colour.
    window.WORLD_ICON_URLS = window.WORLD_ICON_URLS || {};
    for (let frame = 0; frame < chestTierMaxFor(9); frame++) {
      window.WORLD_ICON_URLS['chest:' + frame] = bakeSheetFrame('chest', frame, 16, 16);
    }
    window.WORLD_ICON_URLS.chest = window.WORLD_ICON_URLS['chest:0'];
    window.WORLD_ICON_URLS.box   = bakeSheetFrame('box',   0, 16, 16);
    // An old trade road's bus stop is a broken wagon (loot.js chestLook).
    if (this.textures.exists('wagon')) window.WORLD_ICON_URLS.wagon = bakeSheetFrame('wagon', 0, 128, 96);
    // The burn confirm opens with the campfire the player just tapped.
    window.WORLD_ICON_URLS.bonfire = bakeSheetFrame('bonfire', 0, 16, 32);
    // Home's panel opens with the trailer the player just tapped — the whole
    // image, which is one frame.
    const trailerSrc = this.textures.get('house_trailer')?.getSourceImage();
    if (trailerSrc && trailerSrc.width) {
      window.WORLD_ICON_URLS.house_trailer =
        bakeSheetFrame('house_trailer', 0, trailerSrc.width, trailerSrc.height);
    }
    // Concrete pads under POI chests — one rounded, slightly-oversized slab in
    // the single cell under the chest (texture `pad_round1`, see textures.js).
    makeAllPadShapes(this);

    // Layers
    this.cellGfx = this.add.graphics();
    this.gridContainer = this.add.container(0, 0);  // dashed grid — only redrawn on cell crossing
    // BAKED, not a live Graphics (render.js BakedGfx): Phaser would replay its
    // ~10 000 dash commands every frame, still or not.
    this.gridGfx = new Render.BakedGfx(this, 'grid_baked', this.gridContainer);
    this.noiseContainer = this.add.container(0, 0);
    this.borderContainer = this.add.container(0, 0); // scrolled each frame for sub-cell offset
    // Biome-boundary borders — only redrawn on cell crossing, and BAKED
    // (render.js BakedGfx) so the frames between cost one quad, not ~7 000
    // replayed rects and earcut circles.
    this.borderGfx = new Render.BakedGfx(this, 'border_baked', this.borderContainer);
    // Original OSM road geometry (road_overlay.js) — the raw vector linework
    // the rasterizer turned into road/path cells, as a muted brown band. Sits
    // above the terrain + biome borders but BELOW the ground decoration: the linework is
    // the evidence of what the rasterizer was AIMING at, so the stones it
    // actually laid have to read on top of it, not through it. Anything above
    // the plank is likewise above this — road labels, plants, objects.
    // Scrolled each frame for the sub-cell offset, like the border layer.
    // Only the container is made here: road_overlay.js draws into an offscreen
    // canvas (round caps, one flat alpha over the whole network) and adds the
    // resulting image to this container on its first pass.
    this.roadGeomContainer = this.add.container(0, 0);
    // Ground-decoration sprites (the pier plank). Sits ABOVE the
    // noise + border layers, so biome speckle and the wavy zone borders never
    // paint over the road surface, above the OSM linework overlay, and BELOW
    // the road-label layer.
    this.cobbleContainer = this.add.container(0, 0);
    // Road-name letters render just above the ground decoration,
    // BELOW the rampart/back wall + objects — so a road passing north of a
    // castle tucks behind the back wall instead of its letters poking over it.
    // (Pool populated further down, after the decoration pool.)
    this.letterContainer = this.add.container(0, 0);
    // POLYGONAL building footprints (building_overlay.js) — the source OSM
    // rings the rasterizer turned into building cells, filled at their true
    // shape with the tier's floor, wall and rampart. While the mode is on
    // (BuildingOverlay.enabled()) drawCells paints those cells as plain ground
    // and skips every piece of tiled building art, so this layer IS the
    // buildings, not a decoration over them.
    //
    // It sits above all the ground decoration it stands on (terrain, biome
    // seams, planks, the road linework, road letters) and below the pads,
    // shadows, haze, lighting and sprites — the same slot the tiled floor
    // occupied relative to those, so a house sprite still stands on its own
    // floor and the out-of-reach dim, the biome haze and the fog all still
    // cover it. Scrolled each frame for the sub-cell offset, like the road
    // layer; the module draws into an offscreen canvas and adds the resulting
    // image here on its first pass.
    this.buildingGeomContainer = this.add.container(0, 0);
    // Pads (rounded concrete slabs under POI chests) draw under objects.
    this.padContainer = this.add.container(0, 0);
    // TRAPS — flat marks lying ON the ground (src/traps.js), so they belong
    // with the ground decoration: above the terrain, the planks and the road
    // linework the trap is laid beside, and BELOW the shadows, the sprites and
    // (crucially) the lightmap. Under the lightmap is the point: a hidden trap
    // is meant to be spottable in daylight and invisible in an unlit cave, and
    // "how well lit is this cell" is the lightmap's answer, not a second
    // brightness rule here.
    this.trapContainer = this.add.container(0, 0);
    // Soft contact shadows under buildings — drawn just below the object
    // sprites so a house/tower visibly sits ON the ground instead of floating.
    this.shadowContainer = this.add.container(0, 0);
    // Atmosphere: the GROUND-PLANE wash. One flat fill of the current biome's
    // haze colour over the whole viewport, sitting above every ground layer
    // (terrain, noise, borders, planks, road geometry, pads, shadows) and
    // below every standing sprite. That split is what gives a top-down grid a
    // readable foreground/background: the ground recedes into the biome's air
    // while trees, houses and creatures stay at full contrast on top of it.
    // Painted in Render.drawCells; see BiomeProfiles.atmos for the palette.
    this.atmosGroundGfx = this.add.graphics();
    // REACH — the unmapped-tile reveal. It sits here, ABOVE every piece of
    // ground decoration (biome seams, planks, road letters, treasure pads,
    // shadows, the haze) so the reveal is never covered by the ground it
    // fades off, and BELOW the standing sprites so a tree stands over it.
    //
    // Two passes left this layer in Sep 2026 and nothing replaced them. The
    // DARKNESS went first: the out-of-reach dim, the underground torch wash
    // and the low-energy pink were fillRects here, below the sprites, which
    // were deliberately exempt from the dim — they moved to the lightMap
    // (below, above the sprites) when the world gained more than one light,
    // see src/lighting.js. Then the white reach OUTLINE, the tap affordance:
    // the lightmap's plateau is bright enough (PLATEAU_OUTPUT_K) to mark the
    // reach area on its own, and it traces the same cell-exact staircase the
    // line did. What remains here is the reveal alone.
    this.reachGfx = this.add.graphics();
    // The Potion of Blight's aura (_tickBlightAura) — a disc LYING on the
    // ground around the feet, so it is a ground layer: over the terrain and
    // the reveal, under every standing sprite (a foe walking into it stands
    // in it) and under the lightmap (it is not a light — it doesn't shine).
    // The image itself is added in create() once its texture is baked.
    this.auraContainer = this.add.container(0, 0);
    // (The POI halo layer — a ring "ping" under every live POI — lived here
    // until Sep 2026. A live POI is a LIGHT now, breathing in the lightmap:
    // Lighting.KINDS.poi.)
    // Flat building trim and claim washes stay below upright world pieces.
    this.rampartBackGfx = this.add.graphics();
    // Upright scenery and characters share a continuous ground-Y sort.
    // Cell art keeps its seating; moving feet can cross its base within a cell.
    this.worldContainer = this.add.container(0, 0);
    this.plantedContainer = this.worldContainer;
    this.objectsContainer = this.worldContainer;
    this.creaturesContainer = this.worldContainer;
    // Castle walls, turrets and flags participate in the world foot sort.
    this.towerContainer = this.worldContainer;
    // Cell gas veils standing objects, then shares their lighting and fog.
    this.gasGfx = this.add.graphics();
    // Coin-burst drops (from ATM / bicycle_parking tap). Sits above objects
    // so coins read on top of pads + the source chest sprite.
    this.coinContainer = this.add.container(0, 0);
    // (The shiny sparkle / glint-rock layer, sparkContainer, lived here —
    // under the lightmap — until Oct 2026. It is SELF-LIT now: see below the
    // lightmap image.)
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
    // BAKED (render.js BakedGfx): 30 nested strokeRects Phaser would replay
    // every frame; they change only with the haze colour.
    this.atmosRimGfx = new Render.BakedGfx(this, 'atmos_rim_baked', null);
    // THE LIGHTMAP — every light in the world, composed in one canvas texture
    // (src/lighting.js) and MULTIPLIED over everything below it by this image.
    // Each frame the canvas is filled with the ambient darkness and every
    // light source adds its baked cookie: the player's reach plateau (per
    // cell) with the distance falloff around it, Home, each restored
    // building, each campfire, each live POI.
    //
    // It sits AFTER every world sprite, so a house or a tree outside every
    // light goes as dark as the ground it stands on — the same lesson the old
    // falloff rings learned when they moved up from cellGfx (objects at the
    // rim read as stickers on dark ground) — and BEFORE labelContainer: POI
    // name tablets are UI and stay crisp in the dark. Exactly the viewport
    // square, so it needs no geometry mask.
    //
    // A canvas texture, like the fog's, rather than a RenderTexture: the
    // passes it replaced — a fillRect per unlit cell, ~100 strokeCircle
    // falloff rings — were all darkness, and darkness can't add up into a
    // second light; and drawing the cookies through Phaser's render-texture
    // batch cut them into pieces on some GPUs. A 2D canvas composites the
    // same way everywhere. LINEAR filtering (WebGL) keeps the upscale from
    // the logical grid to the device canvas from stepping the gradients.
    this.lightTex = Render.viewportCanvas(this, 'lightmap', 0).tex;   // the view box, no halo
    try { this.lightTex.setFilter(Phaser.Textures.FilterMode.LINEAR); } catch (e) { /* Canvas: no texture filter */ }
    this.lightMap = this.add.image(this.viewLeft, this.viewTop, 'lightmap')
      .setOrigin(0, 0).setBlendMode(Phaser.BlendModes.MULTIPLY);
    // PARTICLE BURSTS (src/particles.js) — the one-shot puffs: gold stars off
    // a jackpot / shiny banner, pale chips off a street coming back, leaf
    // flecks off a crop reaching its next stage. ABOVE the lightmap because a
    // burst is bright by definition (a gold star multiplied by the night dim
    // is a grey smudge), BELOW the labels and the fog. The emitters
    // themselves are created lazily on first burst and parked in here.
    this.fxContainer = this.add.container(0, 0);
    // Rare "shiny" sparkle markers and the GLINT ROCK's catch of light — a
    // gold twinkle floated above each shiny animal / wild plant / tree, and
    // the small star on a glint rock (render.js sparkList). SELF-LIT (owner,
    // Oct 2026): ABOVE the lightmap, so a glint in an unlit cave cell shows
    // at full brightness — it is a catch of light, bright by definition, and
    // multiplied by the dark it was a grey fleck nobody ever saw. It is NOT a
    // light: it lights nothing around it (a glint rock has no Lighting row;
    // a shiny animal's light is offered separately), which is why it lives
    // here beside the ghost glow and not in the lightmap. BELOW the labels
    // and the fog. This is also the renderer-AGNOSTIC shiny cue: the multiply
    // setTint() used elsewhere silently no-ops under the Phaser Canvas
    // fallback (Phaser.AUTO), so a tint-only shiny was invisible on those
    // devices; the spark texture is baked gold and animates via
    // scale/alpha/rotation (pure transforms), so it reads in WebGL and Canvas.
    this.sparkContainer = this.add.container(0, 0);
    // THE GHOST'S GLOW (SpriteLayout.creatureGlow) — a faint halo per ghost,
    // ABOVE the lightmap so the night dim cannot swallow it and a ghost can be
    // seen coming across the dark, BELOW the labels and the fog. It is not a
    // light: it lights nothing around it (no Lighting row) — which is why it
    // lives here and not in the lightmap.
    this.ghostGlowContainer = this.add.container(0, 0);
    // Text-label layer — POI name tablets, specialty-shop signs, and open/busy
    // pips. Added AFTER every world-object layer (including the castle
    // worldContainer) so a label always reads ABOVE map objects like castle
    // walls / towers, and is only ever covered by popups (Phaser flash text at
    // depth 100+ and the DOM modals). Without its own layer the labels lived in
    // objectsContainer and the castle front wall painted over them.
    this.labelContainer = this.add.container(0, 0);
    // Top world Graphics layer (the name is historical: it once drew tier
    // diamonds). render.js now draws enemy attack-warning footprints here,
    // above scenery and labels so cover cannot hide a warning.
    this.tierGfx = this.add.graphics();
    // FOG OF WAR — the wash over cells the player has never visited. The very
    // top of the world display list, above EVERYTHING the world draws: ground,
    // the sprites, the lighting, the POI name tablets and the attack-warning
    // footprints. That is the point of it — "you have not been here" has to
    // beat every other pass, and a label or a chest's tier look poking through
    // the fog would announce the contents of a place the
    // player has not found yet. (Everything drawn ABOVE this is deliberately
    // not world: the vignette, the work wheel and flash text all set an
    // explicit depth, which floats them clear of the insertion-ordered layers.)
    //
    // A CONTAINER, like borderContainer, because the fog only changes when the
    // player crosses a cell: render.js repaints the wash on that crossing and
    // scrolls this by the sub-cell fraction in between. See the fog pass there.
    this.fogContainer = this.add.container(0, 0);
    // The wash itself is a CANVAS TEXTURE, not Graphics fills. Fog drawn as
    // rects is fog made of cells: whatever you do to the frontier — shells,
    // corner bites — a 32px alpha step still reads as a UI element laid on the
    // world. render.js computes a continuous alpha field at sub-cell resolution
    // and smooth-upscales it into this texture, which Phaser then blits 1:1, so
    // the game's pixelArt (NEAREST) filtering can't put the steps back.
    // FOG_TEX_CELLS_PAD (render.js) is one cell of halo either side of the
    // view, so the container's sub-cell scroll never exposes an unfogged edge.
    // Taken from there, not retyped, so the texture can't be sized for a halo
    // the painter doesn't lay out.
    this.fogTex = Render.viewportCanvas(this, 'fogwash', FOG_TEX_CELLS_PAD * CELL_PX / 2).tex;
    this.fogImage = this.add.image(0, 0, 'fogwash').setOrigin(0, 0).setVisible(false);
    this.fogContainer.add(this.fogImage);

    // Noise overlay pool — one image per visible cell, set to a hashed noise frame.
    this.terrainCache = new Render.TerrainCache(this);
    this.noisePool = [];
    for (let i = 0; i < (VIEW_CELLS + 2) * (VIEW_CELLS + 2); i++) {
      const s = this.add.image(0, 0, 'biome5_0').setOrigin(0, 0)
        .setDisplaySize(CELL_PX, CELL_PX).setVisible(false);
      this.noiseContainer.add(s);
      this.noisePool.push(s);
    }

    // Ground-decoration sprite pool. It carried the road/path cobbles as well
    // as the pier planks until Sep 2026; a street's paving is the road band's
    // own texture now (road_overlay.js), so the PIER plank is all that is left
    // on it. The pool and its container keep the name — the layer order is
    // pinned on it (tools/layer_audit.js).
    this.cobblePool = [];
    for (let i = 0; i < (VIEW_CELLS + 2) * (VIEW_CELLS + 2); i++) {
      const s = this.add.image(0, 0, 'pier', 0).setOrigin(0.5, 0.5)
        .setDisplaySize(CELL_PX, CELL_PX).setVisible(false);
      this.cobbleContainer.add(s);
      this.cobblePool.push(s);
    }

    // THE STREET LAMPS — the gilded lamps a restored street carries, one every
    // Streets.lampSpacingM() metres of rebuilt carriageway. Baked ONCE here
    // (road_overlay.js paints the lamp; a canvas, because the glow is a radial
    // gradient and Phaser's Graphics has no gradient primitive), and drawn by
    // the shared world sprite pass — RENDER_SPEC._streetlamp, into
    // worldContainer with every other standing thing, so a lamp sorts by
    // SCREEN ROW against the trees, houses and animals around it (not a
    // ground-decoration pool, which would hide it under building footprints).
    //
    // Sized in CELLS (RoadOverlay.LAMP_DRAW_CELLS) by that spec, so the lamp
    // keeps its proportion to the carriageway at any latitude's cell size.
    // The default glow is baked here at boot; a themed street's colour is
    // baked the first time a lit lamp of it comes near (_updateStreetLamps).
    this._ensureStreetLampTex(UI_LAMP_GLOW);
    this._ensureBrokenLampTex();

    // Road-label pool: compact whole-word street names (one anchor every ~12
    // road cells, rotated along the road by render.js), drawn low-alpha in
    // dark ink — the road band is a light warm stone, so black reads like
    // worn paint markings on them (white washed out over pale stone).
    // A road cell is only PART stone, though: the ground the road was painted
    // over shows around the band, so on a road crossing grass or forest
    // dark glyphs disappear into the dark background. A pale
    // stone-coloured halo around each glyph carries the word over both — the
    // lettering stays dark on the stones and stays readable off them.
    // Pool is sized one slot per visible cell because render walks cells — at
    // most one anchor can occupy a cell, and most slots simply stay invisible.
    // (letterContainer itself is created earlier, next to cobbleContainer, so it
    // sits below the rampart back wall + objects.)
    this.letterPool = [];
    for (let i = 0; i < (VIEW_CELLS + 2) * (VIEW_CELLS + 2); i++) {
      // Street names share the native UI face used by other small labels.
      // Alpha 0.88, not the old 0.72: at three-quarter alpha the dark ink
      // washed toward its own pale halo and the street name read as a smudge
      // rather than as lettering. Still short of full opacity so it stays
      // map-printed rather than stamped on.
      const t = this.add.text(0, 0, '', {
        // 11px, up one from 10: at dpr 3 on a phone the street name was
        // legible but not comfortably so, and a map label the player has to
        // squint at is doing half its job.
        font: fontUI('bold 11px'), color: UI_SHADOW,
        stroke: '#d8cdb4', strokeThickness: 3,
      }).setOrigin(0.5, 0.5).setAlpha(0.88).setDepth(0).setVisible(false);
      this.letterContainer.add(t);
      this.letterPool.push(t);
    }

    this.objectPool = [];
    // Turrets use their own pool within the shared world container.
    this.towerPool = [];
    this.castleFlagPool = [];   // the claimed-castle banner, one per castle
    this.fruitPool = [];        // ripe fruit worn on a bearing fruit tree's crown (render.js)
    this.plantedPool = [];
    this.plantedTimerPool = []; // small Phaser.Text in cell corner: growth minutes remaining
    this.creaturePool = [];
    this.ghostGlowPool = [];  // the ghost's non-lighting halo (render.js)
    this.sparkPool = [];      // gold sparkle sprites floated above shiny entities
    this.chestLabelPool = []; // Phaser.Text objects for POI names above chests
    this.shopLabelPool  = []; // Phaser.Text objects for specialty-shop labels above houses
    this.padPool = [];        // sprites for per-POI concrete-pad textures under chests
    this.coinPool = [];       // sprites for in-world coin drops (coin-burst mechanic)
    this.trapPool = [];       // sprites for hidden / sprung traps lying on the ground (src/traps.js)

    // Ground coin sprites load through ASSETS at their native map sizes.

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
    // THE ELITE'S RUNE CIRCLE (render.js lays it flat under the feet): baked
    // top-down in gold — so it shows without the optional FX pipeline — as an
    // outer and an inner ring with a band of runes between, each stroke laid
    // over a dark under-stroke so it reads on sand and snow as well as grass.
    if (!this.textures.exists('elite_ring')) {
      const S = 96, C = S / 2, R1 = 44, R2 = 31, RM = (R1 + R2) / 2;
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      // A rune: a few strokes in the band's local frame (u along the ring,
      // v outward), four shapes in turn around the circle.
      const RUNES = [
        [[0, -4, 0, 4], [0, -1, 3, -4]],
        [[-3, 4, 0, -4], [0, -4, 3, 4]],
        [[0, -4, 3, 0], [3, 0, 0, 4], [0, 4, -3, 0], [-3, 0, 0, -4]],
        [[0, -4, 0, 4], [-3, 0, 3, 0], [-3, -3, -3, 3]],
      ];
      const N = 12;
      const draw = (width, color, alpha) => {
        g.lineStyle(width, color, alpha);
        g.strokeCircle(C, C, R1);
        g.strokeCircle(C, C, R2);
        for (let i = 0; i < N; i++) {
          const a = (i / N) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
          const at = (u, v) => [C + ca * (RM + v) - sa * u, C + sa * (RM + v) + ca * u];
          for (const [u0, v0, u1, v1] of RUNES[i % RUNES.length]) {
            const [x0, y0] = at(u0, v0), [x1, y1] = at(u1, v1);
            g.lineBetween(x0, y0, x1, y1);
          }
        }
      };
      draw(6, 0x000000, 0.5);           // the under-stroke
      draw(5, SHINY_TINT, 0.18);        // a soft gold glow
      draw(2, SHINY_TINT, 1);           // the runes themselves
      g.generateTexture('elite_ring', S, S);
      g.destroy();
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
    // The ghost's glow (SpriteLayout.GHOST_GLOW): a soft disc in GHOST_TINT,
    // opaque at the centre and gone at the rim; the renderer scales it to the
    // row's px and fades it to the row's alpha.
    const t = SpriteLayout.GHOST_TINT, rgb = `${(t >> 16) & 255}, ${(t >> 8) & 255}, ${t & 255}`;
    this._ensureCanvasTex('ghost_glow', 64, (ctx, S) => paintRadialDisc(ctx, S,
      [[0, `rgba(${rgb}, 1)`], [0.4, `rgba(${rgb}, 0.45)`], [1, `rgba(${rgb}, 0)`]]));
    // Every influence circle shares its baked fill and boundary; the drawn
    // outer edge is the gameplay radius. Baking also preserves colour in Canvas.
    for (const [key, color] of [['aura_blight', 0xd2285a], ['aura_frost', FROZEN_TINT]]) {
      this._ensureCanvasTex(key, 128, (ctx, S) => paintAuraDisc(ctx, S, color));
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
    makeCastleSkullFlagTexture(this);
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
    this.cobbleContainer.setMask(mask);
    this.letterContainer.setMask(mask);
    this.roadGeomContainer.setMask(mask);
    this.buildingGeomContainer.setMask(mask);
    this.padContainer.setMask(mask);
    this.trapContainer.setMask(mask);
    this.shadowContainer.setMask(mask);
    this.atmosGroundGfx.setMask(mask);
    this.reachGfx.setMask(mask);
    this.auraContainer.setMask(mask);
    this.rampartBackGfx.setMask(mask);
    this.worldContainer.setMask(mask);   // crops + objects + creatures
    this.gasGfx.setMask(mask);
    this.coinContainer.setMask(mask);
    this.sparkContainer.setMask(mask);
    this.atmosRimGfx.setMask(mask);
    this.fxContainer.setMask(mask);
    this.ghostGlowContainer.setMask(mask);
    this.labelContainer.setMask(mask);
    this.tierGfx.setMask(mask);
    this.fogContainer.setMask(mask);

    // Work-progress wheel — drawn above all world objects, not masked.
    this._workProgressGfx = this.add.graphics().setDepth(95);
    this._workToolGfx = this.add.graphics().setDepth(96);
    this._wateringEffects = [];
    // One reusable image swings the owned tool beside the target cell.
    this._workProgressIcon = this.add.image(0, 0, '__WHITE')
      .setDepth(97).setAlpha(WORK_TOOL_ALPHA).setVisible(false);
    this._workProgressToolKey = null;
    this._workProgress = null;

    const frame = this.add.graphics();
    frame.lineStyle(2, 0x000000, 0.6)
      .strokeRect(this.viewLeft - 1, this.viewTop - 1, this.viewSize + 2, this.viewSize + 2);

    // Inner vignette. The map is a hard-clipped 352×352 square sitting on the
    // flat #222 page, so its edge would be an abrupt seam. A short darkening ramp inward from the rim
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

    // The player's directional idle / walk cycles come from
    // SpriteLayout.PLAYER_ART below — every sheet (the cyan farmer every save
    // starts on, the callings, the bicycle) authors all four directions.
    // Dragon transform — single non-directional flap, mirrored by heading in
    // _playDirected (the art faces right at rest). Used for both idle and fly.
    // Dragon Powder's optional sheet builds its animation when loaded.
    for (const art of Object.values(SpriteLayout.PLAYER_ART)) {
      if (!this.textures.exists(art.sheet)) continue;
      for (const [dir, states] of Object.entries(art.directions)) {
        for (const [state, frames] of Object.entries(states)) {
          this._createAnim(`${art.sheet}-${state}-${dir}`, art.sheet, frames, null, state === 'walk' ? 10 : 6);
        }
      }
    }
    this._createAnim('chicken-idle', 'chicken', 0, 1, 3);
    this._createAnim('cow-idle', 'cow', 0, 3, 4);
    // Cat / dog idle — row 0 (frames 0-3) of their 4×N pet body sheets. The
    // renderer's cat/dog branch calls s.play('{kind}-idle'); without these
    // anims defined, leftover chicken/cow-idle from the pooled sprite kept
    // re-stamping the wrong texture onto cats and dogs.
    this._createAnim('cat-idle', 'cat', 0, 3, 4);
    this._createAnim('dog-idle', 'dog', 0, 3, 4);

    // Player sprite
    // Player sprite — not interactive so taps on it fall through to the world
    // handler (which then treats the tap as if it were the cell under the player).
    // Depth 10: above the footprint trail (9) so dots can't draw on the
    // character's face, below the facing-arrow overlay (11).
    //
    // The base scale is the cyan farmer's own (SpriteLayout.PLAYER_ART.farmer:
    // 16px frames at 1.5, a 24px body a little under a cell — the size every
    // calling's sheet shares, see assets/Character/README.md). It is the one
    // scale the player is drawn at when no calling or bicycle skin overrides
    // it (_syncPlayerSkin), and everything derived from it below (the feet
    // nudge, the footprint stance) is written as a multiple of it, so the art
    // table stays the one owner of the number.
    this.playerScale = PLAYER_ART_SCALE;
    // Dragon Powder skin: the 96×96 dragon frames are scaled down so the red
    // dragon reads a touch larger than the human without dwarfing the map.
    // Applied in _applyDragonSkin.
    this.dragonScale = 0.7;
    // FEET ON THE FIX: the projected world position (viewCentre for the local
    // player, the fix's screen point for a peer) is where the FEET go, so
    // every player sprite is drawn this much ABOVE its point — the negative
    // of the feet drop. Anything that wants the sprite's body centre adds
    // this to the point; anything on the ground (shadow, footprints, the GPS
    // and target markers) sits on the point itself. It was +1.4 until Sep
    // 2026 — sprite centred on the fix, feet 14px (3 m) south of it — which
    // put the map a body-length north of where the player stood (see
    // feetOffsetM in create()).
    this.playerFeetNudgeY = -PLAYER_FEET_DROP_PX * this.playerScale;
    // Born on the cyan farmer's sheet (frame 0, the front idle pose); the
    // _playDirected call below picks the directional cycle, and the skin the
    // save is owed once its sheet is up (_syncPlayerSkin).
    this.player = this.add.sprite(this.viewCenterX, this.viewCenterY + this.playerFeetNudgeY, SpriteLayout.PLAYER_ART.farmer.sheet, 0)
      .setScale(this.playerScale)
      .setDepth(10)
      .setMask(mask);
    // The body and its melee effect occlude together at the player's feet.
    // Keep this container at (0,0): existing drawing uses screen coordinates.
    this.playerWorldContainer = this.add.container(0, 0);
    this.worldContainer.add(this.playerWorldContainer);
    this.player.clearMask();
    this.playerWorldContainer.add(this.player);
    this._playDirected(this.player, 'idle');
    this.player.setY(this.viewCenterY + this.playerFeetNudgeY);
    // Contact shadow under the player's feet. It is created at viewCentre and
    // re-seated every frame on scene.playerScreen() (update(): the feet, which
    // a peek drag slides off the viewport centre) — a pixel above them, so the
    // sole reads as resting on the shadow rather than cut by it (the same 1px
    // the footprint dots keep).
    // Depth 9.5: above the footprint trail (9) so a fresh dot can't sit on
    // top of the shadow, below the character (10). Created here rather than
    // in the per-frame pass because there is exactly one. 'bldg_shadow' is
    // baked further up in create(), so it always exists.
    this.playerShadow = this.add.image(this.viewCenterX, this.viewCenterY - 1, 'bldg_shadow')
      .setOrigin(0.5, 0.5)
      .setDisplaySize(17, 6)
      .setAlpha(PLAYER_SHADOW_ALPHA)
      .setDepth(9.5)
      .setMask(mask);
    this.playerShadow.clearMask();
    this.shadowContainer.add(this.playerShadow);
    this.blightAura = this.add.image(this.viewCenterX, this.viewCenterY, 'aura_blight')
      .setOrigin(0.5, 0.5)
      .setVisible(false);
    this.auraContainer.add(this.blightAura);
    // There is NO walk-target marker. Movement is target-follow at every depth:
    // GPS fixes and steering input move a free-flying target (this._targetM)
    // and the opaque body (this.player) walks toward it — underground it also
    // passes through rock, which the body mines out. A target dot read as a
    // blob floating ahead of the character, so there is none. The ONE ground
    // marker beside the body is the GPS crosshair (gpsGhost, below): where you
    // REALLY are, shown at every depth once the body has left it.
    // Warning halo behind the player: red when the tank is empty, near-black
    // when the stick has walked them a long way off the GPS. Pulses so it reads
    // as a live warning rather than a smudge under the sprite. Depth 9.7 puts
    // it under the character (10) and over the footprint trail (9).
    this.playerHalo = this.add.image(this.viewCenterX, this.viewCenterY + this.playerFeetNudgeY, 'halo_red')
      .setOrigin(0.5, 0.5)
      .setDepth(9.7)
      .setVisible(false)
      .setMask(mask);
    this.playerHalo.clearMask();
    this.playerWorldContainer.add(this.playerHalo);
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
    this.gpsGhost = this.add.image(this.viewCenterX, this.viewCenterY, 'gps_crosshair')
      .setOrigin(0.5, 0.5)
      .setDepth(9.8)
      .setVisible(false)
      .setMask(mask);
    // Walk-home lead — the dashed line from the feet to the GPS dot while
    // the character is walking itself back (see _drawWalkHomeHint). Depth
    // Keep the line on the ground, below characters and upright scenery.
    this.walkHomeGfx = this.add.graphics().setDepth(9.75);
    this.shadowContainer.add(this.walkHomeGfx);
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
    // taps to interrupt auto-mining (cleared on the next steer input or fix);
    // _detourHold is the side the body has committed to walking round a wall
    // on (see _detourDir / DETOUR_COMMIT_MS).
    this._targetM = null;
    this._autoMineKey = null;
    this._followPaused = false;
    this._detourHold = null;
    // Facing direction indicator — arrow rendered via Graphics, pointed in the
    // direction of the device compass (or last movement as a fallback).
    this.facingGfx = this.add.graphics().setDepth(11).setMask(mask);
    this.compassDeg = null; // degrees clockwise from north, or null if no sensor
    // Bow / staff shots in flight (see _combatTick). Drawn just above the
    // facing arrow — a shot travels along that arrow, so it has to read as
    // coming off the tip rather than sliding under it.
    this.projGfx = this.add.graphics().setDepth(12).setMask(mask);
    // The staff's bolts and its charging orb are not Graphics: they are soft
    // baked glows (_boltGlowKey) with ADD blending, pooled in their own layer
    // at the shots' depth — see _drawShots. ADD composites as 'lighter' under
    // the Canvas fallback too, and the colour is baked, never tinted. One
    // mask on the container, not one per image (a mask per object is a
    // stencil pass each under WebGL).
    this.boltContainer = this.add.container(0, 0).setDepth(12).setMask(mask);
    this._boltPool = [];
    this._spearPool = [];
    this._shots = [];
    this._nextShotT = {};              // per-slot next-fire clock, in performance.now() ms
    // Castle turrets' own clocks (turret id → next-fire ms) and the cached
    // on-screen turret scan — see _turretFire.
    this._turretNextT = {};
    this._turretScan = null;
    // Health bars over recently-hurt enemies. Under the work wheel (95) so a
    // foe you are actually swinging at keeps the brighter bar on top.
    this.enemyHealthGfx = this.add.graphics().setDepth(94).setMask(mask);
    // Sword-swing slash — a short arc drawn near the player, toward whatever
    // it's engaged with, on the same beat the melee wheel's damage numbers
    // pop (see Render.MELEE_LOOKS / _drawSwordSwing). Depth 11: same tier as the
    // facing arrow, above the body (10).
    this.swordSwingGfx = this.add.graphics().setDepth(11);
    this.playerWorldContainer.add(this.swordSwingGfx);
    this.playerWorldContainer.sort('depth');
    this._swing = null;                // { startT, dir: {x,y} } while a slash is animating
    this._nextBlowT = 0;               // performance.now() ms the next melee blow may land
    // Footprint trail — small dark ovals dropped as the player moves, laid
    // along the step and alternating left/right foot (see _fillFootprint),
    // each fading 20% per new drop so ~5 are visible. Under the player sprite.
    this.footprintGfx = this.add.graphics().setDepth(9);
    this.shadowContainer.add(this.footprintGfx);
    this.shadowContainer.sort('depth');
    this.footprints = [];               // [{ x, y, alpha, ux, uy, side }, …], world metres
    this._lastFootprintM = { x: this.playerM.x, y: this.playerM.y };
    this._footSide = 1;                 // flipped on each drop: left, right, left…

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
    // Debug: SPACE teleports to the next-nearest decorated POI chest (first
    // press goes to Windermere Park, subsequent presses cycle by distance); T
    // hops to the next-nearest INDIVIDUAL tree (the standalone OSM street /
    // yard trees wired in from the satextract sidecar, flagged
    // `individual:true`), cycling outward by distance; F toggles fast-walk
    // (5× speed, all inputs). SPACE and T disable GPS for the session outright
    // (see disableGpsForSession), so — like the WASD/arrow takeover in
    // update() — these must stay behind DEBUG: bound unconditionally, an
    // ordinary keypress on a real GPS-tracked session could silently strand
    // the player off their real position or lurch every input to 5× speed.
    this._poiTpVisited = new Set();
    this._poiTpFirst = 'Windermere Park';
    this._fastWalk = false;
    if (DEBUG) {
      this.input.keyboard.on('keydown-SPACE', () => this.teleportNextPoi());
      this.input.keyboard.on('keydown-T', () => this.teleportNextIndividualTree());
      this.input.keyboard.on('keydown-F', () => { this._fastWalk = !this._fastWalk; });
    }

    // World tap + PEEK DRAG. One pointer does both, and which one it was is
    // only known when it lifts: a pointer that never travelled PEEK_DRAG_SLOP_PX
    // is a tap and fires on the up (the few ms of delay is the whole price of
    // being able to drag). A pointer that DID travel drags the camera
    // and taps nothing: you cannot chop a tree by sliding the map off it.
    //
    // Ping mode (multiplayer.js — "tap 📍, then tap the map") still takes the
    // tap first, on the tap path only — a drag isn't a ping either.
    this._peekPointerId = null;        // the one pointer that owns the drag
    this._peekDragging = false;        // past the slop — this is a drag, not a tap
    this._peekReturning = false;       // finger's gone, camera easing home
    this.input.on('pointerdown', (p) => {
      // Second finger down mid-drag is left alone: the drag keeps the pointer
      // it started with, and a pinch never becomes a tap. But only while that
      // pointer is REALLY still down — a touch whose release never reached
      // Phaser (the stuck-touch case the sweeper below exists for) would
      // otherwise own the map forever and swallow every tap after it.
      if (this._peekPointerId !== null && this._peekPointer?.isDown) return;
      const down = this._gamePt(p);
      this._peekPointer = p;
      this._peekPointerId = p.id;
      this._peekDownX = down.x;
      this._peekDownY = down.y;
      this._peekDragging = false;
      this._peekReturning = false;     // a new grab cancels the spring-back
      this._peekFromM = { x: this.peekM.x, y: this.peekM.y };
    });
    this.input.on('pointermove', (p) => {
      if (p.id !== this._peekPointerId || !p.isDown) return;
      const at = this._gamePt(p);
      const dx = at.x - this._peekDownX, dy = at.y - this._peekDownY;
      if (!this._peekDragging && Math.hypot(dx, dy) < PEEK_DRAG_SLOP_PX) return;
      this._peekDragging = true;
      // Measured from where the camera was when the finger landed, so grabbing
      // the map again mid-spring-back continues from there rather than jumping.
      const k = CELL_PX / this.cellM;
      this._setPeekFromDrag(dx - this._peekFromM.x * k, dy - this._peekFromM.y * k);
    });
    const endPeekPointer = (p) => {
      if (p.id !== this._peekPointerId) return;
      const wasDrag = this._peekDragging;
      this._releasePeek();
      if (wasDrag) return;             // dragged the map; nothing was tapped
      const up = this._gamePt(p);
      if (typeof Multiplayer !== 'undefined' && Multiplayer.consumeTap(this, up.x, up.y)) return;
      if (this._tapEdgeDot(up.x, up.y)) return;
      this._resetWalkHome();           // a tap on the world is interacting
      this.handleWorldTap(up.x, up.y);
    };
    this.input.on('pointerup', endPeekPointer);
    // A touch that ends off the canvas (or is stolen by the browser) never
    // reaches 'pointerup'. Without this the drag would stay latched and the
    // next tap would be swallowed as its release.
    this.input.on('pointerupoutside', endPeekPointer);

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
          // A peek drag whose finger left without a 'pointerup' (a cancelled
          // touch, an event eaten on the way out) would stay latched and
          // swallow the next tap as its release. The last finger is off the
          // glass here, so let the camera spring home.
          if (this._peekPointerId !== null) this._releasePeek();
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
    this._installMenuDialog();

    // HUD + banner + inventory
    this.hud = document.getElementById('hud');
    this.moneyEl = document.getElementById('money');
    this._buildMemoriesChip();
    this._buildRoadChip();
    this._buildBookChip();
    this._buildStatusRow();
    this.banner = document.getElementById('banner');
    this._settleInvCatOnBoot();
    this.buildInventoryDOM();

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

    // Bridge for the how-to card's "Skip tutorial" button. The card is
    // plain DOM in index.html, outside the scene, so it drives the starter
    // ladder through these two hooks rather than touching the save itself.
    window.__tutorialActive = () =>
      typeof Quests !== 'undefined' && !Quests.starterHidden(this.save);
    window.__disableTutorial = () => this.dismissObjective();
    // The card's two CTAs — "Easy mode, enable tutorial" / "Hard mode, no
    // tutorial" — pick the save's game mode (difficulty.js). __gameMode is
    // null until a choice is made, which is what makes the card ask.
    window.__gameMode = () => (Difficulty.isMode(this.save.mode) ? this.save.mode : null);
    window.__chooseMode = (mode) => this.chooseMode(mode);

    // First arrival in the world — show the how-to card over the live map, so
    // the reach bubble and the objective chip it points at are visible behind
    // it. Shown once (localStorage terracart.howtoSeen); the ☰ menu's "How to
    // play" reopens it any time. Must sit BELOW the Sandbox.install above:
    // that call is what sets _sandboxMode, and the sandbox is a dev world that
    // has no use for the card. index.html queues the first-run card behind the
    // opening story slides, so calling it here can't jump the story.
    if (!this._sandboxMode) window.showHowTo?.();

    // Boot tile load. The initial 3×3 tile block can take seconds on a cold
    // cache and the in-world shimmer reads as stalled, not loading. Keep the overlay up (its bar
    // fed per-tile by ensureTilesAround itself) until this first call actually
    // resolves, success or failure, instead of handing off at first paint.
    const _endTiles = window.__boot?.begin('first tile block (overlay stays up)');
    this.ensureTilesAround()
      .catch(e => console.error(e))
      .then(() => {
        _endTiles?.();
        window.__boot?.mark('MAP PLAYABLE — boot overlay hidden');
        this._bootOverlayGone = true; window.__bootStatus?.(1);
        // No launch card here: the STAY SAFE message is the loading screen
        // itself (index.html #safety), already read and acknowledged.
        // The map is the player's now, so responsiveness beats throughput:
        // Tile builds go back to short slices (see WorldGen.setSliceBudgetMs).
        // Phaser counts every display frame even when FPS_LIMIT skips game
        // steps, so actualFps is the refresh interval the slice must fit.
        const displayFps = this.game?.loop?.actualFps;
        WorldGen.setSliceBudgetMs?.(WorldGen.RASTER_SLICE_LIVE_MS, true,
          displayFps > 0 ? 1000 / displayFps : 16.7);
      });

    // Network status
    window.addEventListener('offline', () => this.showBanner(true, 'offline'));
    // Back online: hide the banner AND fetch now. The retry timer may be a
    // minute out by this point (it doubles on every miss), and the player
    // is standing on ground that could load this instant.
    window.addEventListener('online', () => {
      this.showBanner(false);
      if (this._tileRetryTimer) { clearTimeout(this._tileRetryTimer); this._tileRetryTimer = null; }
      this._tileRetryMs = 0;
      this.ensureTilesAround?.().catch?.(() => {});
    });

    // Movement-stick state. The stick is ALWAYS on screen — it's the control
    // that walks you somewhere other than where the GPS puts you, with boots
    // increasing speed and boots reducing the energy cost. joystickVec is driven by pointer
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


    let debugGpsStick = false;
    try { debugGpsStick = localStorage.getItem('terracart.debugGpsStick') === '1'; } catch (_) {}
    this.setDebugGpsStick(debugGpsStick);

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
    _endCreate?.();
    // Other players. No-op until the save carries a player name (the
    // welcome splash / ☰ menu set it); tick() picks it up once it does.
    if (!window.__TEST_MODE && typeof Multiplayer !== 'undefined') Multiplayer.start(this);
  }
}
