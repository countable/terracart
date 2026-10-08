// Single source of truth for every texture the game loads.
// preload() in app.js walks this object; per-asset post-processing
// (alpha-keying, manual frame registration) lives in onLoad callbacks.
const ASSETS = {
  progression_tiles: { kind: 'spritesheet', path: 'assets/Objects/Progression/tiles.png', frameWidth: 24, frameHeight: 24 },
  icon_progression: { kind: 'spritesheet', path: 'assets/Objects/Progression/icons.png', frameWidth: 16, frameHeight: 16 },
  pet_story_clearing: { deferred: true, kind: 'image', path: 'assets/art/pet_clearing.webp' },
  cave_props: { kind: 'spritesheet', path: 'assets/Objects/Cave/props.png', frameWidth: 24, frameHeight: 24,
    // The ruby and emerald grid cells catch a strip of the preceding row.
    // Register only their own art; previews and seating audits read these rectangles.
    frameRects: { 24: { x: 0, y: 99, width: 24, height: 21 }, 25: { x: 24, y: 97, width: 24, height: 23 } },
    onLoad: scene => {
      const texture = scene.textures.get('cave_props');
      for (const [frame, rect] of Object.entries(ASSETS.cave_props.frameRects)) {
        texture.remove(frame);
        texture.add(frame, 0, rect.x, rect.y, rect.width, rect.height);
      }
    } },
  cave_mechanisms: { kind: 'spritesheet', path: 'assets/Objects/Cave/mechanisms.png', frameWidth: 24, frameHeight: 24 },
  beehive: { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Beehive.png', frameWidth: 16, frameHeight: 16 },
  bramble: { kind: 'spritesheet', path: 'assets/Objects/Approved/bramble.png', frameWidth: 24, frameHeight: 24 },
  castle_tower_shapes: { kind: 'image', path: 'assets/Objects/Castle/tower_shapes.png' },
  // Potion projectiles use the same frames as inventory and shop icons.
  icon_potions: { kind: 'spritesheet', path: 'assets/Icons/Items/Potions.png', frameWidth: 16, frameHeight: 16 },
  icon_potion: { kind: 'spritesheet', path: 'assets/Icons/Items/Potion_light.png', frameWidth: 16, frameHeight: 16 },
  icon_sugar_potion: { kind: 'spritesheet', path: 'assets/Icons/Items/Honey.png', frameWidth: 16, frameHeight: 16 },
  orrin_idle: { kind: 'spritesheet', path: 'assets/NPC/Orrin_old_man_idle.png', frameWidth: 48, frameHeight: 48 },
  orrin_walk: { kind: 'spritesheet', path: 'assets/NPC/Orrin_old_man_walk.png', frameWidth: 48, frameHeight: 48 },
  npc_0_idle: { kind: 'spritesheet', path: 'assets/NPC/Citizen_woman01_idle.png', frameWidth: 48, frameHeight: 48 },
  npc_0_walk: { kind: 'spritesheet', path: 'assets/NPC/Citizen_woman01_walk.png', frameWidth: 48, frameHeight: 48 },
  npc_1_idle: { kind: 'spritesheet', path: 'assets/NPC/Citizen_woman02_idle.png', frameWidth: 48, frameHeight: 48 },
  npc_1_walk: { kind: 'spritesheet', path: 'assets/NPC/Citizen_woman02_walk.png', frameWidth: 48, frameHeight: 48 },
  npc_2_idle: { kind: 'spritesheet', path: 'assets/NPC/Citizen_woman03_idle.png', frameWidth: 48, frameHeight: 48 },
  npc_2_walk: { kind: 'spritesheet', path: 'assets/NPC/Citizen_woman03_walk.png', frameWidth: 48, frameHeight: 48 },
  // The player's own sheets (the cyan farmer every save starts on, the four
  // callings, the bicycle) are derived from SpriteLayout.PLAYER_ART below.
  // Red dragon transform (Dragon Powder). 11-col sheet of 96×96 frames;
  // row 0 (frames 0-7) is the wing-flap we loop while transformed.
  dragon:  { deferred: true, kind: 'spritesheet', path: 'assets/Character/Dragon/babydragon_sheets/dragon_red.png', frameWidth: 96, frameHeight: 96,
    onLoad: scene => {
      scene._createAnim('dragon-fly', 'dragon', 0, 7, 10);
      if (scene.isDragonActive()) scene._applyDragonSkin(true);
    } },
  trees:   { kind: 'spritesheet', path: 'assets/Objects/Approved/trees.png',       frameWidth: 32, frameHeight: 48 },
  house:   {
    kind: 'image', path: 'assets/Objects/Approved/house.png',
    // House.png is a tileset (two houses + detail bits). Register a single
    // "front" frame for the right-hand cabin so we only render that.
    onLoad: (scene) => { scene.textures.get('house').add('front', 0, 148, 3, 72, 95); },
  },
  // Cave staircases (the surface→cave entrance and the cave's way back up).
  // ?v= busts the SW/browser cache when the art changes.
  stair_down: { kind: 'image', path: 'assets/Objects/Approved/stair_down.png',
    // The upper half is the ascending ladder; the lower half is the down pit.
    onLoad: (scene) => { scene.textures.get('stair_down').add('down', 0, 0, 16, 32, 16); },
  },
  stair_up:   { kind: 'image', path: 'assets/Objects/Approved/stair_up.png' },
  rolling_ball: { kind: 'spritesheet', path: 'assets/Objects/RollingBallAndWall/ball.png', frameWidth: 24, frameHeight: 24 },
  sliding_spike_wall: { kind: 'spritesheet', path: 'assets/Objects/RollingBallAndWall/spike-wall.png', frameWidth: 24, frameHeight: 24 },
  vent_cycle: { kind: 'spritesheet', path: 'assets/Objects/HazardAnimationsV2/vent-cycle-complete.png', frameWidth: 24, frameHeight: 24 },
  cavein: { kind: 'spritesheet', path: 'assets/Objects/HazardAnimationsV2/cavein.png', frameWidth: 24, frameHeight: 24 },
  sinkhole: { kind: 'spritesheet', path: 'assets/Objects/HazardAnimationsV2/sinkhole.png', frameWidth: 48, frameHeight: 48 },
  whirlwind: { kind: 'spritesheet', path: 'assets/Objects/HazardAnimationsV2/tornado.png', frameWidth: 48, frameHeight: 48 },
  crystal_cluster: { kind: 'spritesheet', path: 'assets/Objects/Wilderness/crystal_cluster.png', frameWidth: 16, frameHeight: 16 },
  // Chicken Red.png is 64×32: a 4-col × 2-row grid of 16×16 frames (NOT
  // 2× 32×32 like its filename + the cow sheet might suggest). Loading at
  // 32×32 made every "frame" a 2×2 cluster of mini-chickens — so each
  // spawned chicken rendered as four. 16×16 plus a 2× scale in render.js
  // keeps the visual footprint comparable to the cow. Frames {0, 1} on
  // the top row form the idle animation pair.
  chicken: { kind: 'spritesheet', path: 'assets/Farm Animals/Chicken Red.png',        frameWidth: 16, frameHeight: 16 },
  cow:     { kind: 'spritesheet', path: 'assets/Farm Animals/Female Cow Brown.png',   frameWidth: 32, frameHeight: 32 },
  // Pet body sheets — 32×32 RPG-Maker-style anim grids (4 cols × 12-13 rows).
  // Row 0 is the down-walk cycle, which we loop as the idle anim. Source
  // PNGs are copied out of the gitignored Sprites/ dump into Objects/Pets/
  // so the tree builds without the raw asset pack (same pattern as
  // Objects/Wilderness/). Originals were Sprites/Animals/Pets/Cats/1/Ginger.png
  // and Sprites/Animals/Pets/Dogs/Premade/4/1.png (grey); swap with sibling
  // sheets from those folders if we ever want colour variety.
  cat:     { kind: 'spritesheet', path: 'assets/Objects/Pets/cat.png', frameWidth: 32, frameHeight: 32 },
  dog:     { kind: 'spritesheet', path: 'assets/Objects/Pets/dog.png', frameWidth: 32, frameHeight: 32 },
  // Approved closed gold chest: exact right-hand crop from Chests.png; see Gold Chest.md.
  chest:   { kind: 'spritesheet', path: 'assets/Objects/Approved/chest.png',       frameWidth: 16, frameHeight: 16,
    onLoad: scene => {
      const source = scene.textures.get('chest').getSourceImage();
      const sheet = makeChestTierSheet(source);
      scene.textures.remove('chest');
      scene.textures.addSpriteSheet('chest', sheet, { frameWidth: 16, frameHeight: 16 });
    } },
  // Market stall — a "produce stand" POI sprite (80×80 per frame). One frame
  // per product family (awning colour): 0 fruit, 1 veg, 2 meat, 3 fish,
  // 4 coffee/bakery, 5 dairy/egg, 6 flowers. See produceStandFor() in loot.js.
  market_stand: { kind: 'spritesheet', path: 'assets/Objects/Approved/market_stand.png', frameWidth: 80, frameHeight: 80 },
  // Crops sheet: 9 cols x 16 rows of 16x16 cells. Each crop = one row.
  // In-world growth: col 0 (sprout) -> col 4 (harvestable). Inventory: col 7 produce, col 8 seed.
  crops:   {
    kind: 'spritesheet', path: 'assets/Objects/Approved/crops.png', frameWidth: 16, frameHeight: 16,
    // Source PNG has a solid white background — alpha-key near-white pixels to transparent.
    onLoad: (scene) => {
      const tex = scene.textures.get('crops');
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
      scene.textures.remove('crops');
      scene.textures.addSpriteSheet('crops', c, { frameWidth: 16, frameHeight: 16 });
    },
  },
  // Spring Crops sheet (224x128, 14x8 of 16x16 frames). Used by crops whose
  // art lives here (e.g. potato) — see CROP_SPRITE override below.
  springcrops: { kind: 'spritesheet', path: 'assets/Objects/Approved/springcrops.png',  frameWidth: 16, frameHeight: 16 },
  // The legacy 16px cobble sheet. The game draws nothing from it; it stays loaded for the
  // art review tools (tools/world-art.js, tools/preview_map_art.py) that
  // still read its frames.
  cobble:      { kind: 'spritesheet', path: 'assets/Objects/Road copiar.png',   frameWidth: 16, frameHeight: 16 },
  // Bridge Beach — 128×224 = 8 cols × 14 rows of 16×16 frames. Wooden plank
  // tiles for pier rendering (transportation:pier OSM lines). Rows 0-3 are a
  // big multi-cell bridge structure; rows 4-13 are pairs of standalone 3-cell
  // horizontal bridges. Renderer uses frame 20 (row 2, col 4), an opaque
  // interior plank-deck tile, as the standard pier cell.
  pier:        { kind: 'spritesheet', path: 'assets/Objects/Approved/pier.png', frameWidth: 16, frameHeight: 16 },
  // Wilderness art — all copied out of the gitignored Sprites/ source dump
  // into Objects/Wilderness/ so the tree can build without the raw asset pack.
  // Ground coins use simplified native-size art. The detailed HUD and popup
  // icon stays in Icons/coin.png. Map quantity bands live in Render.COIN_PILES.
  coin_drop: { kind: 'image', path: 'assets/Objects/Approved/coin_single_ground.png?v=5' },
  coin_pile_2: { kind: 'image', path: 'assets/Objects/Approved/coin_pile_2.png' },
  coin_pile_3: { kind: 'image', path: 'assets/Objects/Approved/coin_pile_3.png' },
  coin_pile_4: { kind: 'image', path: 'assets/Objects/Approved/coin_pile_4.png' },
  coin_pile_5: { kind: 'image', path: 'assets/Objects/Approved/coin_pile_5.png' },
  coin_pile_6_10: { kind: 'image', path: 'assets/Objects/Approved/coin_pile_6_10.png' },
  coin_pile_11_25: { kind: 'image', path: 'assets/Objects/Approved/coin_pile_11_25.png' },
  coin_pile_26_50: { kind: 'image', path: 'assets/Objects/Approved/coin_pile_26_50.png' },
  coin_pile_51: { kind: 'image', path: 'assets/Objects/Approved/coin_pile_51.png' },
  // Misc 16x16 prop — single boxed crate from the Singles tileset.
  box:         { kind: 'image', path: 'assets/Objects/Approved/box.png' },
  // Forest critters. Sheets are 16x16 frames; renderer picks frames as needed.
  // Deer + Crow sheets are 32×32 frames despite living in a "Wilderness"
  // folder that mostly holds 16×16 props. Loading them as 16×16 sliced each
  // body into a 2×2 quadrant grid; render.js only ever showed the bottom-right
  // quadrant (a leg / tail tip) and the body itself sat invisible in the
  // upper cells. 32×32 + a scale ~1.0 matches the cow's visual footprint.
  deer:        { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Deer Idle.png',       frameWidth: 32, frameHeight: 32 },
  rabbit:      { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Rabbit White.png',    frameWidth: 16, frameHeight: 16 },
  crow:        { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Crow.png',            frameWidth: 32, frameHeight: 32 },
  butterfly:   { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Azure Butterfly.png', frameWidth: 16, frameHeight: 16 },
  // Shore crab — 3 cols x 4 rows of 16px frames (front, back, right, left).
  crab:        { kind: 'spritesheet', path: 'assets/Farm Animals/Crab.png',                 frameWidth: 16, frameHeight: 16 },
  // Horse — 4 cols x 6 rows of 32px frames: idle then walk for down, right, up.
  horse:       { kind: 'spritesheet', path: 'assets/Farm Animals/Horse.png',                frameWidth: 32, frameHeight: 32 },
  // Sea turtle — 2 cols x 4 rows of 16px frames (up, left, right, down), cut
  // from the marine-animals sheet; the fish columns were not used.
  sea_turtle:      { kind: 'spritesheet', path: 'assets/Farm Animals/Turtle.png',               frameWidth: 16, frameHeight: 16 },
  // Underground monster sheets. Goblins: 32×32 frames, 6 cols × 3 rows — row 0 (frames 0-5) is the walk cycle.
  purple_slime:  { kind: 'spritesheet', path: 'assets/Enemy/Purple Slime.png',  frameWidth: 32, frameHeight: 32 },
  ghost:         { kind: 'spritesheet', path: 'assets/Enemy/Ghost/1Fullsheet_Ghost.png', frameWidth: 16, frameHeight: 16 },
  // Friendly shrine discovery: supplied jfranci_px ghost artwork, separate
  // texture identity so it never acquires the hostile ghost's gameplay kind.
  shrine_spirit: { kind: 'spritesheet', path: 'assets/Enemy/Ghost/1Fullsheet_Ghost.png', frameWidth: 16, frameHeight: 16 },
  plant:         { kind: 'spritesheet', path: 'assets/Enemy/Plant/1Fullsheet_Plant.png', frameWidth: 16, frameHeight: 16 },
  goblin:        { kind: 'spritesheet', path: 'assets/Enemy/Goblin.png',        frameWidth: 32, frameHeight: 32 },
  goblin_archer: { kind: 'spritesheet', path: 'assets/Enemy/Goblin Archer.png', frameWidth: 32, frameHeight: 32 },
  // Fruit trees — 32x48 frames (2 cells wide x 3 cells tall), same shape as
  // Maple (32 wide). Each tree spans a 32px column; slicing at 16 split every
  // tree in half (the odd 16px frame was just the right half of a tree).
  apple_tree:   { kind: 'spritesheet', path: 'assets/Objects/Approved/apple_tree.png',   frameWidth: 32, frameHeight: 48 },
  worldpeach_tree:   { kind: 'spritesheet', path: 'assets/Objects/Approved/peach_tree.png',   frameWidth: 32, frameHeight: 48 },
  // Pine uses the upper 32×48 growth strip; the lower band is separate
  // ground decoration and must not enter the standing tree frame.
  pine_tree:     { kind: 'spritesheet', path: 'assets/Objects/Approved/pine_tree.png',     frameWidth: 32, frameHeight: 48 },
  // Mineral-bearing rocks — 176x272 sheet of 16x16 frames.
  mineralrock:    { kind: 'spritesheet', path: 'assets/Objects/Approved/mineralrock.png', frameWidth: 16, frameHeight: 16 },
  // Selected tall pillar (#63), replacing the global mapped-pole sprite.
  // One 24px frame displayed in a 32px cell; purely decorative as before.
  pillar:         { kind: 'spritesheet', path: 'assets/Objects/ZoneVariants/tall_pillar.png', frameWidth: 24, frameHeight: 24 },
  // STREET VARIANTS (src/street_variants.js): the generated 16px props (see
  // assets/Objects/Generated/README.md — placeholders): the pilgrim's
  // waystone, the barricade, and the burned row's tar pit and iron stakes
  // (one look each). wagon: the broken wagon a bandit-road bus stop wears
  // (loot.js chestLook), one compact 32×32 frame.
  waystone:       { kind: 'spritesheet', path: 'assets/Objects/Approved/waystone.png', frameWidth: 16, frameHeight: 16 },
  barricade:      { kind: 'spritesheet', path: 'assets/Objects/Approved/barricade.png', frameWidth: 24, frameHeight: 24 },
  tar:            { kind: 'spritesheet', path: 'assets/Objects/Approved/tar.png', frameWidth: 16, frameHeight: 16 },
  wagon:          { kind: 'spritesheet', path: 'assets/Objects/DailyVisits/wagon.png', frameWidth: 32, frameHeight: 32 },
  // INFLUENCE ZONES (src/zones.js): churchyard headstone, grove votive,
  // and the flint nodule (items.js CROP_SPRITE.flint).
  grove_votive: { kind: 'spritesheet', path: 'assets/Objects/ZoneVariants/seed_shrine.png', frameWidth: 24, frameHeight: 24 },
  flint:          { kind: 'spritesheet', path: 'assets/Objects/Approved/flint.png', frameWidth: 16, frameHeight: 16 },
  // SHRINE KINDS (src/shrines.js SHRINE_KINDS `frame`) — ten 16×24 generated
  // placeholders on one row, in the table's order.
  shrines:        { kind: 'spritesheet', path: 'assets/Objects/Generated/shrines.png', frameWidth: 16, frameHeight: 24 },
  // SCENIC PLACES (src/scenic.js) — generated placeholders, one art per
  // interactable: the viewpoint's scope (16×24, an object — RENDER_SPEC
  // vista_scope) and the tide line's driftwood and message bottle (wild
  // plants — items.js CROP_SPRITE).
  zone_objects: { kind: 'spritesheet', path: 'assets/Objects/ZoneVariants/approved-24.png', frameWidth: 24, frameHeight: 24 },
  zone_berry_bush: { kind: 'spritesheet', path: 'assets/Objects/ZoneVariants/berry_bush.png', frameWidth: 24, frameHeight: 24 },
  beach_palms: { kind: 'spritesheet', path: 'assets/Objects/Beach/palms.png', frameWidth: 16, frameHeight: 16 },
  zone_hedge_single: { kind: 'spritesheet', path: 'assets/Objects/Approved/approved_clipped_hedge.png', frameWidth: 16, frameHeight: 16 },
  zone_hedge: { kind: 'spritesheet', path: 'assets/Objects/Hedges/hedges-24.png?v=b465bfa1', frameWidth: 24, frameHeight: 24 },
  stronghold_wall: { kind: 'spritesheet', path: 'assets/Objects/Stronghold/walls-24.png?v=42926d98', frameWidth: 24, frameHeight: 24 },
  reef_coral: { kind: 'spritesheet', path: 'assets/Objects/Reef/coral.png', frameWidth: 24, frameHeight: 24 },
  vista_scope:    { kind: 'spritesheet', path: 'assets/Objects/Approved/vista_scope.png', frameWidth: 16, frameHeight: 24 },
  driftwood:      { kind: 'spritesheet', path: 'assets/Objects/Approved/driftwood.png', frameWidth: 16, frameHeight: 16 },
  bottle:         { kind: 'spritesheet', path: 'assets/Objects/Approved/bottle.png', frameWidth: 16, frameHeight: 16 },
  shipwreck_shrine: { kind: 'spritesheet', path: 'assets/Objects/Beach/shipwreck_shrine_runtime.png', frameWidth: 192, frameHeight: 128 },
  // POI props (assets/Objects/Generated/README.md — placeholders): a bin is a
  // BARREL or clay pot (standing, then smashed while restocking — isBarrel), a
  // bike rack the bicycle_parking POI (isBikeRack), a notice board the
  // information POI (render.js infoboard) and a gate's two posts (gatepost).
  barrel: { kind: 'spritesheet', path: 'assets/Objects/ZoneVariants/barrel.png', frameWidth: 24, frameHeight: 24 },
  clay_pot: { kind: 'spritesheet', path: 'assets/Objects/ZoneVariants/pots_cracked.png', frameWidth: 24, frameHeight: 24 },
  clay_pot_smashed: { kind: 'spritesheet', path: 'assets/Objects/ZoneVariants/pots_smashed.png', frameWidth: 24, frameHeight: 24 },
  bike_rack:      { kind: 'spritesheet', path: 'assets/Objects/Approved/bike_rack.png', frameWidth: 16, frameHeight: 16 },
  signpost:       { kind: 'spritesheet', path: 'assets/Objects/Approved/signpost.png', frameWidth: 16, frameHeight: 16 },
  gatepost:       { kind: 'spritesheet', path: 'assets/Objects/Approved/gatepost.png', frameWidth: 16, frameHeight: 16 },
  // THE MACRO STALLS (loot.js MACRO_KIND_BY_CLASS / macroFor): the in-building
  // POIs that are places you come back to. One 80×80 frame each, the same
  // frame and box as market_stand (art in x:[12,80) y:[0,70)), drawn by
  // RENDER_SPEC.chest exactly like the stall. Simple silhouettes and a few
  // large props keep each service readable at map scale. Each has its own
  // texKey (`macro_<kind>`), so the renderer and the dialog icon agree.
  macro_inn:         { kind: 'spritesheet', path: 'assets/Objects/Generated/inn_simple.png', frameWidth: 80, frameHeight: 80 },
  macro_chapel:      { kind: 'spritesheet', path: 'assets/Objects/Generated/chapel_simple.png', frameWidth: 80, frameHeight: 80 },
  macro_apothecary:  { kind: 'spritesheet', path: 'assets/Objects/Generated/apothecary_simple.png', frameWidth: 80, frameHeight: 80 },
  macro_scriptorium: { kind: 'spritesheet', path: 'assets/Objects/Generated/scriptorium_simple.png', frameWidth: 80, frameHeight: 80 },
  macro_guildhall:   { kind: 'spritesheet', path: 'assets/Objects/Generated/guildhall_simple.png', frameWidth: 80, frameHeight: 80 },
  macro_curio:       { kind: 'spritesheet', path: 'assets/Objects/Generated/curio_simple.png', frameWidth: 80, frameHeight: 80 },
  macro_sundries:    { kind: 'spritesheet', path: 'assets/Objects/Generated/sundries_simple.png', frameWidth: 80, frameHeight: 80 },
  macro_training:    { kind: 'spritesheet', path: 'assets/Objects/Generated/training_simple.png', frameWidth: 80, frameHeight: 80 },
  // Scholar has a dedicated reading booth, distinct from the book shop.
  macro_scholar:     { kind: 'spritesheet', path: 'assets/Objects/Generated/scholar_simple.png', frameWidth: 80, frameHeight: 80 },
  // Stone well — the in-game stand-in for OSM amenity=fountain points. Tapping
  // it refills the watering can like a water tile (see interact.js 'well'
  // branch).
  //
  // The PNG is 48×32 and holds the roofed well (opaque x2..29) PLUS a
  // hoist arm and bucket jutting off its right side (x30..36, only 6 rows
  // tall). Drawn whole, that arm is a ~6px orange-and-grey nub floating
  // beside the well at game scale, and — because the sprite is seated by its
  // ART bounds — it also dragged the well itself ~4px off the centre of its
  // own cell. Loading the file as a 30px-wide sheet takes frame 0 = the well
  // alone, so what's drawn is the well, centred.
  well:           { kind: 'spritesheet', path: 'assets/Objects/Wilderness/well.png?v=2',
                    frameWidth: 30, frameHeight: 32 },
  // Wizard tower — 320×208 sheet, 4 cols × 2 rows of 80×104.
  // Top row = 4 tower variants (blue-ivy, purple-ivy, blue-clean, purple-clean).
  // Wizard houses (role 'wizard') use frame 3 (fully-restored purple-clean).
  shrine:      { kind: 'spritesheet', path: 'assets/Objects/Approved/shrine.png', frameWidth: 80, frameHeight: 104 },
  // Shell collectible keeps its original 48×64 sheet geometry, with only
  // frame 0 occupied. Unused colour duplicates were cleared in place.
  shell_sheet: { kind: 'spritesheet', path: 'assets/Icons/Fish/Sea/Creatures/Shell.png', frameWidth: 16, frameHeight: 16 },
  // The Torch consumable's own 16×16 icon, drawn in the world where one lies
  // on a cave floor to be picked up (worldgen.js caveFloorTorches →
  // CROP_SPRITE.torch). Not the wall `torch` stake below, which is a light.
  icon_torch:  { kind: 'spritesheet', path: 'assets/Icons/Items/Torch.png', frameWidth: 16, frameHeight: 16 },
  // Shared inventory and projectile art: frame 0 faces right, frame 1 down.
  icon_throwing_spear:  { kind: 'spritesheet', path: 'assets/Icons/Items/Spear.png', frameWidth: 16, frameHeight: 16 },
  // The stronger throwing weapon keeps the spear silhouette, in cold steel.
  // Recolour source pixels so Canvas and WebGL, plus baked DOM icons, agree.
  icon_javelin: {
    kind: 'spritesheet', path: 'assets/Icons/Items/Spear.png', frameWidth: 16, frameHeight: 16,
    onLoad: scene => {
      const src = scene.textures.get('icon_javelin').getSourceImage();
      const canvas = document.createElement('canvas');
      canvas.width = src.width; canvas.height = src.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(src, 0, 0);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      recolorEnemyPixels(image.data, { shadow: '#25445a', mid: '#70a7bc', highlight: '#e4f7ff' });
      ctx.putImageData(image, 0, 0);
      scene.textures.remove('icon_javelin');
      scene.textures.addSpriteSheet('icon_javelin', canvas, { frameWidth: 16, frameHeight: 16 });
    },
  },
  // Orchard fruit icons — 32×16 each, two 16×16 frames (frame 0 is the whole
  // fruit; frame 1 a slice). These are the inventory icons (items.js
  // MINERAL_ICON_SHEET), loaded as WORLD textures too because a bearing fruit
  // tree wears one on its canopy (render.js's fruit pass) and a dropped stack
  // of them renders through inventoryIconSource → the same key. Only the two
  // species the world grows are loaded; the rest stay DOM-only icons.
  icon_apple:  { kind: 'spritesheet', path: 'assets/Icons/Food Icons/Apple.png', frameWidth: 16, frameHeight: 16 },
  icon_worldpeach:  { kind: 'spritesheet', path: 'assets/Icons/Food Icons/Peach.png', frameWidth: 16, frameHeight: 16 },
  // Scarecrow — 48×48 single-image prop (straw-man on a cross-pole). Pole base
  // anchors at origin (0.5, 1) so it stands on its placement cell; the render
  // spec scales the 48px art down to ~one cell. ?v= busts the SW/browser cache.
  scarecrow:   { kind: 'image', path: 'assets/Objects/Approved/scarecrow.png' },
  // Rustic default grass/mushroom in the original 22×12 prop grid. Other
  // flowers, seasonal props and existing cave mushrooms keep their source art.
  // Spring/autumn/winter/aqua grass tufts, ferns, wildflowers, mushrooms,
  // pebbles, logs. Wildplants pick a frame via CROP_SPRITE { sheet: 'props',
  // custom: true, frame: N }. Longgrass uses frame 10 (a grass tuft).
  props:       { kind: 'spritesheet', path: 'assets/Objects/Approved/props.png', frameWidth: 16, frameHeight: 16 },
  // Rounded woodland bush: shared by shrub wildplants and bush-sized trees.
  bushes:      { kind: 'spritesheet', path: 'assets/Objects/Approved/bushes.png', frameWidth: 48, frameHeight: 32 },
  // Animated campfire — 96×32 = 6 cols × 1 row of 16×32 frames. Lit by burning
  // a coal on bare ground (see interact.js 'light-fire'); the _fire render spec
  // cycles the 6 frames for a flicker. Repels slimes + slowly restores energy.
  bonfire:     { kind: 'spritesheet', path: 'assets/Objects/Wilderness/bonfire.png', frameWidth: 16, frameHeight: 32 },
  // Cave torch — 64×32 = 4 cols of 16×32 frames: a wooden stake with a wrapped
  // head and a small flame, authored in the bonfire's palette (no torch on any
  // shipped sheet). Planted on a cave level where a lowtier street-furniture
  // POI stands overhead (worldgen.js caveTorchesFrom) — the one kind of chest
  // that does NOT mirror underground, so the spot gets a light instead of a
  // box. Decorative: no interaction. The `torch` render spec cycles the 4
  // frames for a flicker and Lighting.KINDS.torch is its light.
  torch:       { kind: 'spritesheet', path: 'assets/Objects/Wilderness/torch.png', frameWidth: 16, frameHeight: 32 },
  // 7_Pickup_Items — 224×160 = 14 cols × 10 rows of 16×16 frames. Veggies,
  // fruits, fish, junk pulls (boot at row 6 col 4), sticks, logs, stars.
  // Used for the fishing-junk boot (88), rare-drop star (115), and memory (116).
  pickup:      { kind: 'spritesheet', path: 'assets/Objects/Pickup_Items.png', frameWidth: 16, frameHeight: 16 },
  // Wood logs — 48×16 sheet, 3 frames of 16×16 (brown / grey / amber
  // bark variants with little green sprigs). Sliced out of Sprites/
  // 7_Pickup_Items_16x16.png row 8 cols 0-2 — the bottom row of the
  // OBJECTS section. The previous wood.png (4-frame stack-growth pile
  // from Sprites/unused/Objects/Props/wood.png) had water tinting in it
  // that read poorly on grass. Renderer picks frame = min(2, qty - 1)
  // so the variant cycles with stack size. Inventory icon uses frame 2.
  wood:        {
    kind: 'spritesheet', path: 'assets/Objects/Wilderness/wood.png', frameWidth: 16, frameHeight: 16,
    // wood.png ships with a solid white background (RGB ≈ 248,248,248)
    // that reads as a "white outline" around each log when rendered on
    // the grass terrain. Alpha-key near-white pixels to transparent —
    // same trick crops.png uses.
    onLoad: (scene) => {
      const tex = scene.textures.get('wood');
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
      scene.textures.remove('wood');
      scene.textures.addSpriteSheet('wood', c, { frameWidth: 16, frameHeight: 16 });
    },
  },
  // Themed-house sprites (sliced top-left out of NPC house sheets in
  // Sprites/unused/Objects/Exterior/Houses/NPCS houses). Each replaces the
  // generic tinted 'house' for a specific role — see render.js' house key
  // function. Anchored at origin (0.5, 0.9) like the base house.
  house_blacksmith: { kind: 'image', path: 'assets/Objects/Approved/house_blacksmith.png' },
  house_trader:     { kind: 'image', path: 'assets/Objects/Approved/house_trader.png' },
  house_market:     { kind: 'image', path: 'assets/Objects/Approved/house_market.png' },
  house_fort:       { kind: 'image', path: 'assets/Objects/Approved/house_fort.png' },
  house_trailer:    { kind: 'image', path: 'assets/Objects/Home/home_wagon.png' },
  // Wreck: every tier-9 small house starts out as one of these until the
  // player brings the restoration materials. Single sprite shared across
  // all roles — what the wreck WILL become is hidden until restoration.
  // ?v= cache-bust: Wreck.png was re-cropped (trimmed 14px of empty bottom
  // padding so the foot-anchor seats it on the ground instead of floating
  // above its shadow). Bump this when the art changes again — the service
  // worker + browser HTTP cache key on the full URL, so the new query forces
  // a fresh fetch instead of serving the stale image.
  house_wreck:      { unclaimedArt: true, kind: 'image', path: 'assets/Objects/Approved/house_wreck.png' },
  // BEGIN approved map-art states and contexts
  house_fort_unclaimed: {"kind": "image", "path": "assets/Objects/Approved/house_fort_unclaimed.png", "unclaimedArt": true},
  approved_wetland_reeds: {"kind": "spritesheet", "path": "assets/Objects/Approved/approved_wetland_reeds.png", "frameWidth": 16, "frameHeight": 16},
  approved_clipped_hedge: {"kind": "spritesheet", "path": "assets/Objects/Approved/approved_clipped_hedge.png", "frameWidth": 16, "frameHeight": 16},
  approved_charred_stakes: {"kind": "spritesheet", "path": "assets/Objects/Approved/approved_charred_stakes.png", "frameWidth": 24, "frameHeight": 24},
  potofgold: {"kind": "image", "path": "assets/Objects/DailyVisits/potofgold.png"},
  // END approved map-art states and contexts
};

// Neighbour role sheets are listed once, in SpriteLayout.NPC_SHEETS; each
// idle sheet has a walk sheet beside it.
for (const sheet of SpriteLayout.NPC_SHEETS) {
  if (ASSETS[sheet.idle]) continue;
  ASSETS[sheet.idle] = { kind: 'spritesheet', path: sheet.path, frameWidth: 48, frameHeight: 48 };
  ASSETS[sheet.walk] = { kind: 'spritesheet', path: sheet.path.replace(/_idle\.png$/, '_walk.png'), frameWidth: 48, frameHeight: 48 };
}

// Player class and bicycle appearances share their verified layout metadata.
for (const art of Object.values(SpriteLayout.PLAYER_ART)) {
  ASSETS[art.sheet] = { kind: 'spritesheet', path: art.path, frameWidth: art.fw, frameHeight: art.fh };
}

// Enemy sheets and colour variants share the approved roster with the catalogue.
// Recolour luminance instead of multiplying RGB: dark red art must be able to
// become bright cyan. Alpha and the original source files remain untouched.
function recolorEnemyPixels(pixels, palette) {
  const rgb = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const stops = ['#000000', palette.shadow, palette.mid, palette.highlight].map(rgb);
  for (let i = 0; i < pixels.length; i += 4) {
    if (!pixels[i + 3]) continue;
    const luma = (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255;
    const t = Math.pow(luma, palette.gamma ?? 1) * 3;
    const segment = Math.min(2, Math.floor(t));
    const a = stops[segment], b = stops[segment + 1];
    const f = t - segment;
    for (let ch = 0; ch < 3; ch++) pixels[i + ch] = Math.round(a[ch] + (b[ch] - a[ch]) * f);
  }
  return pixels;
}
// Muted art keeps its original shading and alpha, with 20% of its saturation.
function muteSpritePixels(pixels) {
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
    for (let c = 0; c < 3; c++) pixels[i + c] = Math.round(gray + (pixels[i + c] - gray) * 0.2);
  }
}
function makeMutedSprite(source) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width; canvas.height = source.height;
  const ctx = canvas.getContext('2d'); ctx.drawImage(source, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  muteSpritePixels(pixels.data); ctx.putImageData(pixels, 0, 0);
  return canvas;
}
// The art registry owns which non-chest sprites use the muted treatment.
for (const [key, asset] of Object.entries(ASSETS)) {
  if (!asset.desaturated) continue;
  asset.onLoad = scene => {
    const canvas = makeMutedSprite(scene.textures.get(key).getSourceImage());
    scene.textures.remove(key);
    if (asset.kind === 'spritesheet') scene.textures.addSpriteSheet(key, canvas, asset);
    else scene.textures.addCanvas(key, canvas);
  };
}
// Tier recolors preserve the approved chest's silhouette, shading and alpha.
// Shared by the game loader and design report; source art stays untouched.
function makeChestTierSheet(source) {
  const size = ASSETS.chest.frameWidth;
  const canvas = document.createElement('canvas');
  // Through chestTierMaxFor(9): the underground tiers (T6 from cave level 3,
  // T7 from 6) recolor off their rarity badges the same way - no new source
  // art, the silhouette and shading carry.
  canvas.width = size * chestTierMaxFor(9); canvas.height = size;
  const ctx = canvas.getContext('2d');
  for (let tier = 1; tier <= chestTierMaxFor(9); tier++) {
    const x = (tier - 1) * size;
    ctx.drawImage(source, 0, 0, size, size, x, 0, size, size);
    const color = CHEST_TIER_COLOR[tier];
    if (color == null) continue;
    const channels = [color >> 16 & 255, color >> 8 & 255, color & 255];
    const hex = values => '#' + values.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
    const pixels = ctx.getImageData(x, 0, size, size);
    recolorEnemyPixels(pixels.data, {
      shadow: hex(channels.map(v => v * 0.3)),
      mid: hex(channels), highlight: hex(channels.map(v => v + (255 - v) * 0.65)),
    });
    if (tier === 1) muteSpritePixels(pixels.data);
    ctx.putImageData(pixels, x, 0);
  }
  return canvas;
}
// Fire slimes retain the 32px hop art; ordinary slimes use the roster's
// 16px full sheet. Register this source directly instead of copying an
// ordinary-slime entry that the roster later overrides.
ASSETS.fire_slime = { kind: 'spritesheet', path: 'assets/Enemy/Slime Green.png',
  frameWidth: 32, frameHeight: 32 };
if (typeof EnemyRoster !== 'undefined') {
  for (const row of EnemyRoster.ROWS) {
    // Size variants, identical atlases and trapper reuse their base texture; palette variants
    // resolve to their own sheet so their recolour hook still runs.
    if (SpriteLayout.creatureArt(row.id).sheet !== row.id) continue;
    const { path, frameWidth, frameHeight } = row.art;
    ASSETS[row.id] = { kind: 'spritesheet', path, frameWidth, frameHeight };
    if (row.palette) ASSETS[row.id].onLoad = (scene) => {
      const src = scene.textures.get(row.id).getSourceImage();
      const canvas = document.createElement('canvas');
      canvas.width = src.width; canvas.height = src.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(src, 0, 0);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      recolorEnemyPixels(image.data, row.palette);
      ctx.putImageData(image, 0, 0);
      scene.textures.remove(row.id);
      scene.textures.addSpriteSheet(row.id, canvas, { frameWidth, frameHeight });
    };
  }
}
window.recolorEnemyPixels = recolorEnemyPixels;
window.ASSETS = ASSETS;
