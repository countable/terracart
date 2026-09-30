#!/usr/bin/env node
// Export shipping appearances and unmodified source sheets for the art audit.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, 'src', name + '.js'), 'utf8');
const now = 1800000000000;
class AuditDate extends Date { static now() { return now; } }
const ctx = { addEventListener() {}, Date: AuditDate, performance: { now: () => 0 }, CELL_PX: 32 };
ctx.window = ctx;
vm.createContext(ctx);
for (const name of ['enemy_roster', 'util', 'sprite_layout', 'assets', 'items', 'crops', 'biome_profiles', 'render']) {
  vm.runInContext(read(name), ctx, { filename: name + '.js' });
}
const registry = vm.runInContext('({assets:ASSETS,crops:CROP_SPRITE,contexts:WILDPLANT_CONTEXT_ART,rows:CROP_ROW,names:CROP_NAMES,tiers:MINERAL_TIERS,maxStage:MAX_GROWTH_STAGE,cellPx:SpriteLayout.CELL_PX})', ctx);
ctx.scene = { save: { fruitPicked: {} }, textures: { exists: key => !!registry.assets[key] }, cellM: 7 };
const resolver = vm.runInContext('Render.objectAppearance(scene, new Map())', ctx);
// Run the actual planted/wildplant branch with a sprite recorder. The slice
// deliberately fails if the owning renderer changes its structure.
const render = read('render');
const start = render.indexOf('    if (p._placedRock) {');
const endText = 's.setOrigin(0.5, oy).setScale(cropScl).setPosition(Math.round(sx), Math.round(sy) - plantedYOffset);';
const end = render.indexOf(endText, start);
if (start < 0 || end < 0) throw new Error('Cannot locate shipping plant appearance branch');
vm.runInContext('globalThis.auditPlant = function(p,s) { const sx=0,sy=0; ' + render.slice(start, end + endText.length) + '\n};', ctx);
ctx.setTextureIfDifferent = (sprite, key) => { sprite.texture = { key }; };
const samples = [];
function plantAppearance(o) {
  const s = {
    setFrame(frame) { this.frame = { name: frame }; return this; },
    setOrigin(x,y) { this.originX=x;this.originY=y;return this; },
    setScale(n) { this.scaleX=this.scaleY=n;return this; },
    setPosition(x,y) { this.x=x;this.y=y;return this; },
  };
  ctx.auditPlant(o, s);
  return {texKey:s.texture.key,frameVal:s.frame.name,scl:s.scaleX,origin:[s.originX,s.originY],scaleYMul:1,dxPx:s.x,dyPx:s.y,visible:true};
}
function add(id,label,group,object,usage,note='') {
  object = {id, x:0, y:0, ...object};
  const SL=ctx.SpriteLayout;
  const full = object.kind === 'plant' ? {
    texKey:SL.creatureSheet(object.kind),frameVal:SL.creatureAppearance(object,object._auditTime).frame,
    scl:SL.creatureScale(object.kind),origin:[0.5,SL.creatureFoot(object.kind)],scaleYMul:1,
    dxPx:0,dyPx:SL.CREATURE_GROUND_DY-SL.creatureFloat(object.kind),visible:true,
  } : object.kind === 'wildplant' ? plantAppearance(object) : resolver.resolveAppearance(object);
  if (!full || !full.visible) throw new Error('Missing appearance: ' + id);
  const {spec, ...appearance} = full;
  appearance.tint = object.kind === 'wildplant' ? (ctx.BiomeProfiles.tint(object._biome, object.crop) || 0xffffff) : vm.runInContext('Render',ctx).spriteTint(object,ctx.scene,appearance.texKey);
  const overlays = [];
  if (object.kind === 'fruittree') {
    resolver.fruitList.length = 0;
    spec.after({texture:{key:appearance.texKey},frame:{name:appearance.frameVal},originX:appearance.origin[0],originY:appearance.origin[1],scaleX:appearance.scl,scaleY:appearance.scl*appearance.scaleYMul,x:appearance.dxPx,y:appearance.dyPx,depth:0}, object, ctx.scene);
    overlays.push(...resolver.fruitList);
  }
  const asset = registry.assets[appearance.texKey];
  const status = appearance.texKey === 'hedge_trimmed' ? 'Review: legacy cut hedge' :
    object.kind === 'tree' && object.species === 'maple' && !object.size && object.variant < 3 ? 'Review: small growth frames' :
    asset.path.includes('/Approved/') ? 'Approved-path art; visually verify' : 'Other source; visually verify';
  samples.push({id,label,group,usage,object,appearance,overlays,note,status});
}
for (const species of ['maple','pine','birch','mahogany']) {
  for (const size of ['bush','small','medium','large']) add(`tree-${species}-${size}`,`${species} · ${size}`,'Trees',{kind:'tree',species,size},'Detected / generated timber tree',size === 'bush' ? 'All bush-sized species use the shared bush texture.' : 'Mature crown at the runtime size class.');
  for (const variant of [1,2,3]) add(`tree-${species}-stage-${variant}`,`${species} · growth ${variant}`,'Tree growth',{kind:'tree',species,variant},'Timber growth / size-less tree',species !== 'maple' ? 'Non-maple species use their mature frame at every variant; shown to expose that runtime behavior.' : 'Small growth frames should be compared with the mature crown.');
}
for (const species of ['apple','peach']) {
  for (let stage=0;stage<=4;stage++) add(`fruit-${species}-${stage}`,`${species} · ${['sprout','young','green','blossom','bearing'][stage]}`,'Fruit trees',{kind:'fruittree',species,planted:true,planted_t:now-(stage+0.1)*ctx.Crops.FRUIT_STAGE_MS},'Planted fruit tree');
  const id=`fruit-${species}-picked`;
  ctx.scene.save.fruitPicked[id]=now;
  add(id,`${species} · picked`,'Fruit trees',{kind:'fruittree',species},'Wild / orchard tree after harvest','Bearing fruit is a separate runtime overlay.');
}
function plant(id,label,crop,extra={},group='Foliage and ground cover',usage='Wild / zone plant',note='') {
  add(id,label,group,{kind:'wildplant',crop,stage:registry.maxStage,wildId:id,...extra},usage,note);
}
const natural = ['shrub','longgrass','mushroom','forgetmenot','marigold','wildrose','starflower','rockfruit','flint','shell','driftwood'];
for (const crop of natural) {
  const group = ['rockfruit','flint','shell','driftwood'].includes(crop) ? 'Loose stones and beach' : 'Foliage and ground cover';
  plant(`plant-${crop}`,registry.names[crop] || crop,crop,{},group);
  for (const look of Object.keys(registry.crops[crop]?.looks || {})) plant(`plant-${crop}-${look}`,`${crop} · ${look}`,crop,{_plantArt:look},group,'Authored zone / road look',look==='trimmed' ? 'Hedgerow road uses this cut hedge; distinct from the approved clipped hedge.' : 'Same harvest mechanics as the base crop.');
  for (const cave of [false,true]) {
    const frames = cave ? registry.crops[crop]?.caveFrames : registry.crops[crop]?.frames;
    if (!frames || frames.length < 2) continue;
    for (const frame of frames) {
      let n=0,id;
      do { id=`variant-${crop}-${cave}-${n++}`;ctx.probe={crop,wildId:id,_cave:cave}; } while (vm.runInContext('wildplantFrame(probe)',ctx)!==frame && n<1000);
      if(n>=1000)throw new Error('Cannot resolve plant frame');
      plant(id,`${crop} · ${cave?'cave ':''}frame ${frame}`,crop,{_cave:cave},group);
    }
  }
}
for (const [look,row] of Object.entries(registry.contexts)) plant(`context-${look}`,`${row.crop} · ${look}`,row.crop,{_plantArt:look},row.crop==='rockfruit'?'Loose stones and beach':'Foliage and ground cover','Context-specific art');
for (const biome of [5,16]) plant(`shrub-biome-${biome}`,`shrub · ${biome===5?'residential':'commercial'}`,'shrub',{_biome:biome},'Foliage and ground cover','Automatic biome look','Shows automatic clipped hedge selection without an explicit art tag.');
for (const moss of [false,true]) for(let rockVariant=0;rockVariant<4;rockVariant++) add(`rock-${moss?'moss':'plain'}-${rockVariant}`,`${moss?'moss':'plain'} rock · shape ${rockVariant+1}`,'Mineral rocks',{kind:'mineralrock',rockVariant,yieldTier:1,...(moss?{_objectArt:'moss'}:{})},'Surface / cave plain rock');
// Moss is only authored for plain Stone Garden rocks, not ore tiers.
for(const tier of Object.keys(registry.tiers)) add(`ore-${tier}`,`${registry.tiers[tier].barId.replace('_bar','')} ore`,'Mineral rocks',{kind:'mineralrock',yieldTier:Number(tier)},'Tiered ore');
for(const crop of Object.keys(registry.rows).filter(k=>!natural.includes(k))) for(let stage=0;stage<=registry.maxStage;stage++) add(`crop-${crop}-${stage}`,`${registry.names[crop]||crop} · stage ${stage}`,'Crop growth',{kind:'wildplant',crop,stage},'Player-planted crop','Includes the runtime planted-crop scale reduction and vertical offset.');
for (const biomeName of ['COMMERCIAL','INDUSTRIAL','WETLAND','GOLF']) {
  const biome=ctx.BiomeProfiles.T[biomeName];
  for(const variant of [1,3]) add(`biome-${biomeName}-tree-${variant}`,`${biomeName.toLowerCase()} · maple ${variant===1?'sprout':'mature'}`,'Biome tint comparisons',{kind:'tree',species:'maple',variant,_biome:biome},'Runtime biome tint');
  for(const crop of ['shrub','longgrass','mushroom']) plant(`biome-${biomeName}-${crop}`,`${biomeName.toLowerCase()} · ${crop}`,crop,{_biome:biome},'Biome tint comparisons','Runtime biome tint');
  add(`biome-${biomeName}-rock`,`${biomeName.toLowerCase()} · rock`,'Biome tint comparisons',{kind:'mineralrock',rockVariant:0,yieldTier:1,_biome:biome},'Runtime biome tint');
}
add('placed-rockfruit','Placed stone','Loose stones and beach',{kind:'wildplant',crop:'rockfruit',_placedRock:true},'Player-placed rock','Uses the shipping produce-icon frame, distinct from loose wild rockfruit.');
for (let qty=1;qty<=3;qty++) add(`wood-stack-${qty}`,`Fallen wood · look ${qty}`,'Loose stones and beach',{kind:'groundstack',itemId:'wood',qty},'Dropped wood stack');
for(let stage=0;stage<=registry.maxStage;stage++) add(`crop-rockfruit-${stage}`,`Stone · stage ${stage}`,'Crop growth',{kind:'wildplant',crop:'rockfruit',stage},'Player-planted stone crop','Includes the runtime planted-crop scale reduction and vertical offset.');
for(let frame=0;frame<ctx.SpriteLayout.creatureFrames('plant');frame++) add(`carnivorous-plant-${frame}`,`Carnivorous plant · idle ${frame+1}`,'Carnivorous plants',{kind:'plant',_auditTime:frame*ctx.SpriteLayout.creatureFrameMs('plant')},'Static zone pattern / rooted enemy','Actual idle animation frame at runtime creature scale; enemy mechanics.');
const assets = {};
for(const sample of samples) for(const [key,frame] of [[sample.appearance.texKey,sample.appearance.frameVal],...sample.overlays.map(o=>[o.key,o.frame])]) {
  if(!assets[key]) {
    const a=registry.assets[key];
    if(!a)throw new Error('Unknown asset: '+key);
    const bytes=fs.readFileSync(path.join(root,a.path.split('?')[0]));
    if(bytes.toString('hex',0,8)!=='89504e470d0a1a0a')throw new Error('Expected PNG: '+a.path);
    const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
    assets[key]={kind:a.kind,path:a.path,width,height,frameWidth:a.frameWidth||width,frameHeight:a.frameHeight||height,whiteKey:!!(a.onLoad&&/data\.data\[i\] > 240/.test(a.onLoad.toString())),src:'data:image/png;base64,'+bytes.toString('base64')};
  }
  const a=assets[key],count=Math.floor(a.width/a.frameWidth)*Math.floor(a.height/a.frameHeight);
  if(!Number.isInteger(frame??0)||(frame??0)<0||(frame??0)>=count)throw new Error(`Invalid frame ${key}:${frame}`);
}
const direction=JSON.parse(fs.readFileSync(path.join(root,'docs/art/art-direction.json'),'utf8'));
process.stdout.write(JSON.stringify({version:1,cellPx:registry.cellPx,samples,assets,palette:direction.palette,notes:['Original asset bytes are embedded unchanged. Runtime white-key transparency is declared separately.','Approved-path status describes registry provenance, not a visual approval of every frame.','Lighting, shadows and shiny effects are omitted. Explicit biome comparison samples include the shipping multiply tint.']}));
