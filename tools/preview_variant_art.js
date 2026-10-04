#!/usr/bin/env node
// Read the shipping art registries for the standalone variant preview.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, 'src', name + '.js'), 'utf8');
const ctx = { addEventListener() {} };
ctx.window = ctx;
vm.createContext(ctx);
for (const name of ['enemy_roster', 'enemy_spawns', 'util', 'coords', 'sprite_layout', 'assets', 'items', 'chest_themes', 'loot', 'zone_variant_data', 'zone_variants', 'shrines', 'streets', 'street_variants', 'biome_profiles', 'macros', 'interactables', 'worldgen', 'road_overlay', 'lighting', 'lairs', 'zones']) {
  vm.runInContext(read(name), ctx, { filename: name + '.js' });
}
const render = read('render');
const fruit = render.match(/const FRUIT_FRAMES = (\{[\s\S]*?\n  \});/);
if (!fruit) throw new Error('Cannot find shipping fruit-tree frames');
vm.runInContext('globalThis.fruitFrames = ' + fruit[1], ctx);
// These painters depend only on Canvas2D. Embed the actual shipping functions
// so procedural trap and lamp art works offline without a Phaser scene.
function slice(source, from, to) {
  const a = source.indexOf(from), b = source.indexOf(to, a);
  if (a < 0 || b < a) throw new Error('Cannot find preview painter: ' + from);
  return source.slice(a, b);
}
const shadowLook = render.match(/const SHADOW_LOOK = \{[\s\S]*?\n\};/);
if (shadowLook) vm.runInContext(shadowLook[0], ctx);
vm.runInContext('const Render = {}; ' + slice(render, 'Render.wildplantShadow =', 'Render.objectAppearance ='), ctx);
const painters = slice(read('textures'), 'function seededRand(', 'function drawGrassTex(') + '\n'
  + slice(read('textures'), 'const TRAP_PX =', '// === Animated biome textures ===');
const data = vm.runInContext(`({ assets: ASSETS, crops: CROP_SPRITE, contextLooks: WILDPLANT_CONTEXT_ART, cropRows: CROP_ROW,
  cropColumns: CROPS_SHEET_COLS, matureStage: MAX_GROWTH_STAGE,
  plantPlacements: Object.fromEntries([CROP_SPRITE.shrub, CROP_SPRITE.giant_mushroom, ...Object.values(CROP_SPRITE.shrub.looks), ...Object.values(WILDPLANT_CONTEXT_ART)].flatMap(art => (art.frames || [art.frame]).map(frame => ({...art, frame}))).map(art => {
    const asset = ASSETS[art.sheet], box = SpriteLayout.ART_BOUNDS[art.sheet+':'+art.frame];
    const offset = art.seat && box ? SpriteLayout.seatInCell(box,.5,.5,art.scale,art.scale) : {dxPx:0,dyPx:0};
    return [art.sheet+':'+art.frame, {width:asset.frameWidth*art.scale,height:asset.frameHeight*art.scale,shadow:Render.wildplantShadow(null,art),...offset}];
  })),
  mineralTiers: MINERAL_TIERS, mineralDeposits: GEM_DEPOSITS, fruitFrames, names: CROP_NAMES,
  treeArt: Object.fromEntries(['maple','pine'].map(species => [species, Object.fromEntries(['small','medium','large'].map(size => [size,{frame:treeArtFrame({species,size}),scale:treeScale({species,size})}]))])),
  treeSizes: Object.fromEntries(['small','medium','large'].map(size => [size, treeScale({species:'maple',size})])),
  treeStages: Object.fromEntries([1,2,3].map(variant => [variant,
    {frame:treeGrowthStage({species:'maple',variant}),scale:treeScale({species:'maple',variant})}])) ,
  churchyardFrame: SpriteLayout.plainRockFrame({rockVariant: SpriteLayout.CHURCHYARD_ROCK_VARIANT}),
  groveShrines: SpriteLayout.GROVE_SHRINE_ART, shipwreckShrine: SpriteLayout.SHIPWRECK_SHRINE_ART,
  lighting: Lighting.KINDS, wildplantRules: WILDPLANT_RULES,
  shrineKinds: Shrines.SHRINE_KINDS, shrineRewards: Shrines.REWARD_KINDS,
  quarryRockRules: QUARRY_ROCK_RULES, quarrySapphireChance: QUARRY_SAPPHIRE_CHANCE,
  lairs: {kinds:Lairs.KIND_ORDER,counts:Lairs.STREET_TIER_GUARDS,daily:[...Lairs.DAILY_TIERS]},
  zoneKinds: Zones.ZONE_KINDS,
  cellPx: SpriteLayout.CELL_PX, pathClasses: [...WorldGen.PATH_CLASSES], waterTerrain: WorldGen.T.WATER,
  lampDrawCells: RoadOverlay.LAMP_DRAW_CELLS, lampGroundFrac: RoadOverlay.LAMP_GROUND_FRAC,
  creatures: SpriteLayout.CREATURE_ART, lampGold: UI_LAMP_GOLD, lampGlow: UI_LAMP_GLOW })`, ctx);
// A JSON registry cannot carry onLoad functions. Declare the alpha-keying
// operation from the owning callback, rather than keying every pale sprite.
for (const row of Object.values(data.assets)) {
  row.whiteKey = !!(row.onLoad && /data\.data\[i\] > 240/.test(row.onLoad.toString()));
}
data.assets.icon_goldenfish = {whiteKey:false,kind:'spritesheet',path:'assets/Icons/Fish/River/Golden Fish.png',frameWidth:16,frameHeight:16};
data.enemyPalettes = Object.fromEntries(ctx.EnemyRoster.ROWS.filter(row => row.palette).map(row => [row.id, row.palette]));
data.containerLootProfiles = vm.runInContext('({barrel:BARREL_LOOT, clay_pot:CLAY_POT_LOOT})', ctx);
data.painters = painters;
data.chestPainter = vm.runInContext("'const CHEST_TIER_COLOR = '+JSON.stringify(CHEST_TIER_COLOR)+'; const ASSETS={chest:{frameWidth:16}}; const chestTierMaxFor=()=>'+chestTierMaxFor(9)+';\\n'+recolorEnemyPixels.toString()+'\\n'+muteSpritePixels.toString()+'\\n'+makeChestTierSheet.toString()", ctx);
// Basic terrain samples use the same base colours and texture painter as the map.
const colourTable = read('app').match(/const COLORS = (\{[\s\S]*?\n\});/);
if (!colourTable) throw new Error('Cannot find shipping ground colours');
vm.runInContext('const COLORS = ' + colourTable[1] + ';' + read('textures'), ctx);
data.terrainTiles = vm.runInContext(`Object.entries(BiomeProfiles.T)
  .map(([name,type]) => ({
  name, type, color: COLORS[type], variants: typeof BIOME_TEX[type] === 'object' ? BIOME_TEX[type].variants : 0,
  flora: BiomeProfiles.flora(type),
}))`, ctx);
// These ground types exist only as special-zone overlays; rock also occurs naturally.
data.groundAccents = vm.runInContext('ZONE_GROUND_ACCENTS', ctx);
const basicExamples = require('./preview_basic_tiles')(ctx);
data.basicCoverage = require('./preview_basic_coverage')(ctx);
data.parkCharacterShares = Object.fromEntries(Object.entries(ctx.BiomeProfiles.PARK_CHARACTERS).map(([k,row]) => [k,row.share]));
data.basicTiles = data.terrainTiles.filter(tile => !['GROVE', 'CHURCHYARD', 'TAR_YARD'].includes(tile.name));
for (const tile of data.basicTiles) {
  tile.examples = basicExamples[tile.name]?.objects || [];
  tile.fauna = Object.entries(ctx.BIOME_FAUNA).filter(([kind, row]) => kind !== 'slime' && basicExamples[tile.name]?.creatureSeats && row.primary?.includes(tile.type) && ctx.BiomeProfiles.faunaAllows(kind, tile.type)).map(([kind]) => kind);
  tile.enemies = ctx.EnemySpawns.surfaceRows(tile.type).filter(row => basicExamples[tile.name]?.creatureSeats).filter(row => row.surface.weight > 0).map(row => row.id);
  if (tile.name === 'SAND' || tile.name === 'PIER') tile.fauna = Object.entries(ctx.SHORE_FAUNA)
    .filter(([kind, row]) => (tile.name === 'SAND' || row.pier) && ctx.BiomeProfiles.faunaAllows(kind, tile.type)).map(([kind]) => kind);
  if (tile.name === 'CAVE_FLOOR') {
    const plants = [], grid = new Uint8Array(32*32).fill(tile.type);
    ctx.WorldGen.spawnCaveMushrooms(grid, 32, 2622, 5615, 32*ctx.WorldGen.CELL_M, 1, plants, new Set());
    tile.examples = plants.slice(0, 1);
    tile.enemies = ctx.EnemySpawns.caveRows(1).map(row => row.id);
  }
  for (const o of tile.examples) if (o.kind === 'mineralrock' && o._zoneObjectFrame == null && (o.caveVariant != null || (o.yieldTier || 1) <= 1)) {
    o.previewArt = {sheet:'mineralrock', frames:[ctx.SpriteLayout.plainRockFrame(o)]};
  }
  tile.creatureExamples = [...new Set([...tile.fauna, ...tile.enemies.slice(0,2)])].map(kind => {
    const art = ctx.SpriteLayout.creatureArt(kind);
    return {kind, previewArt:{sheet:art.sheet,frames:[art.directions?.down?.idle?.[0] || 0],tint:art.tint ?? 0xffffff}};
  });

}
data.biomePainter = vm.runInContext('lerp.toString()', ctx) + '\n' + read('textures').slice(0, read('textures').indexOf('const ZONE_GROUND_ACCENTS ='));
// Embed the shipping pavement/lamp painters, preserving their shared helpers.
data.roadPainter = read('road_overlay');
data.zoneTraits = Object.fromEntries(ctx.ZoneVariantData.variants.map(row => [row.id, ctx.ZoneVariants.traitsFor(row)]));
data.variantSource = read('zone_variant_data') + '\n' + read('zone_variants') + '\n' + read('street_variants');
process.stdout.write(JSON.stringify(data));
