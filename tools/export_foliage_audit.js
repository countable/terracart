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
const endText = 's.setOrigin(0.5, oy).setScale(cropScl).setPosition(Math.round(sx) + placement.dxPx, Math.round(sy) + placement.dyPx - plantedYOffset);';
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
  appearance.tint = object.kind === 'plant' ? SL.creatureTint(object.kind) : object.kind === 'wildplant' ? (ctx.BiomeProfiles.tint(object._biome, object.crop) || 0xffffff) : vm.runInContext('Render',ctx).spriteTint(object,ctx.scene,appearance.texKey);
  const overlays = [];
  if (object.kind === 'fruittree') {
    resolver.fruitList.length = 0;
    spec.after({texture:{key:appearance.texKey},frame:{name:appearance.frameVal},originX:appearance.origin[0],originY:appearance.origin[1],scaleX:appearance.scl,scaleY:appearance.scl*appearance.scaleYMul,x:appearance.dxPx,y:appearance.dyPx,depth:0}, object, ctx.scene);
    overlays.push(...resolver.fruitList);
  }
  const asset = registry.assets[appearance.texKey];
  const status = object.crop === 'shrub' ? 'Shared shrub mechanics' :
    object.kind === 'tree' && object.species === 'maple' && !object.size && object.variant < 3 ? 'Review: small growth frames' :
    asset.path.includes('/Approved/') ? 'Approved-path art; visually verify' : 'Other source; visually verify';
  samples.push({id,label,group,usage,object,appearance,overlays,note,status});
}
for (const species of ['maple','pine']) {
  for (const size of ['small','medium','large']) add(`tree-${species}-${size}`,`${species} · ${size}`,'Trees',{kind:'tree',species,size},'Detected / generated timber tree','Mature crown at the runtime size class.');
  if (species === 'maple') for (const variant of [1,2,3]) add(`tree-${species}-stage-${variant}`,`${species} · growth ${variant}`,'Tree growth',{kind:'tree',species,variant},'Timber growth / size-less tree','Small growth frames should be compared with the mature crown.');
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
  plant(`plant-${crop}`,registry.names[crop] || crop,crop,{},group,crop==='shrub'?'Basic shrub':'Wild / zone plant',crop==='shrub'?'The basic bush and cut hedge share the same harvesting mechanics.':'');
  for (const look of Object.keys(registry.crops[crop]?.looks || {})) plant(`plant-${crop}-${look}`,`${crop} · ${look}`,crop,{_plantArt:look},group,'Authored zone / road look',crop==='shrub' ? 'Cut hedge, 20% smaller than the former residential hedge. Same harvesting mechanics as the basic bush.' : 'Same harvest mechanics as the base crop.');
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
for(let rockVariant=0;rockVariant<4;rockVariant++) add(`rock-plain-${rockVariant}`,`plain rock · shape ${rockVariant+1}`,'Mineral rocks',{kind:'mineralrock',rockVariant,yieldTier:1},'Surface / cave plain rock');
// Ore tiers keep their material-specific artwork.
for(const tier of Object.keys(registry.tiers)) add(`ore-${tier}`,`${registry.tiers[tier].barId.replace('_bar','')} ore`,'Mineral rocks',{kind:'mineralrock',yieldTier:Number(tier)},'Tiered ore');
for(const crop of Object.keys(registry.rows).filter(k=>!natural.includes(k))) for(let stage=0;stage<=registry.maxStage;stage++) add(`crop-${crop}-${stage}`,`${registry.names[crop]||crop} · stage ${stage}`,'Crop growth',{kind:'wildplant',crop,stage},'Player-planted crop','Includes the runtime planted-crop scale reduction and vertical offset.');
add('placed-rockfruit','Placed stone','Loose stones and beach',{kind:'wildplant',crop:'rockfruit',_placedRock:true},'Player-placed rock','Uses the shipping produce-icon frame, distinct from loose wild rockfruit.');
add('wood-stack-2','Fallen wood · look 2','Loose stones and beach',{kind:'groundstack',itemId:'wood',qty:2},'Dropped wood stack','The same artwork is used for every stack quantity.');
for(let stage=0;stage<=registry.maxStage;stage++) add(`crop-rockfruit-${stage}`,`Stone · stage ${stage}`,'Crop growth',{kind:'wildplant',crop:'rockfruit',stage},'Player-planted stone crop','Includes the runtime planted-crop scale reduction and vertical offset.');
for(let frame=0;frame<ctx.SpriteLayout.creatureFrames('plant');frame++) add(`carnivorous-plant-${frame}`,`Carnivorous plant · idle ${frame+1}`,'Carnivorous plants',{kind:'plant',_auditTime:frame*ctx.SpriteLayout.creatureFrameMs('plant')},'Static zone pattern / rooted enemy','Actual idle animation frame at runtime creature scale; enemy mechanics.');
// Organize the audit by gameplay family, keeping growth and contextual art
// together rather than scattering one mechanic across unrelated sections.
for (const sample of samples) {
  const o=sample.object;
  if(o.kind==='tree') {
    sample.group='Timber trees · wood harvest';sample.family=o.species;
    sample.phase=o._biome!=null?'Context tint':o.size?'Crown size':'Growth stage';
  } else if(o.kind==='fruittree') {
    sample.group='Fruit trees · recurring fruit';sample.family=o.species;sample.phase=o.planted?'Growth stage':'After picking';
  } else if(o.kind==='plant') {
    sample.group='Carnivorous plants · rooted enemy';sample.family='Carnivorous plant';sample.phase='Idle animation';
  } else if(o.kind==='mineralrock') {
    sample.group='Rocks · mining';sample.family=o.yieldTier>1?'Tiered ore':'Plain stones';sample.phase='Default appearance';
  } else if(o.kind==='groundstack') {
    sample.group='Loose materials · pickup';sample.family='Fallen wood';sample.phase='Stack appearance';
  } else if(o.crop==='shrub') {
    sample.group='Shrubs · wood harvest';sample.family='Shrub';sample.phase='Appearance';
  } else if(o._placedRock) {
    sample.group='Rocks · mining';sample.family='Placed stone';sample.phase='Placed appearance';
  } else if(o.wildId==null) {
    sample.group='Planted crops · growth and harvest';sample.family=registry.names[o.crop]||o.crop;sample.phase='Growth stage';
  } else {
    sample.group='Forage · wild harvest';sample.family=registry.names[o.crop]||o.crop;
    sample.phase=o._biome!=null?'Context tint':o._cave?'Cave appearance':'Appearance';
  }
}
const phaseOrder=['Growth stage','Crown size','Appearance','Default appearance','Cave appearance','After picking','Context tint'];
const groupOrder=['Timber trees · wood harvest','Fruit trees · recurring fruit','Shrubs · wood harvest','Forage · wild harvest','Rocks · mining','Loose materials · pickup','Planted crops · growth and harvest','Carnivorous plants · rooted enemy'];
samples.sort((a,b)=>groupOrder.indexOf(a.group)-groupOrder.indexOf(b.group)||a.family.localeCompare(b.family)||phaseOrder.indexOf(a.phase)-phaseOrder.indexOf(b.phase));
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
process.stdout.write(JSON.stringify({version:1,cellPx:registry.cellPx,samples,assets,palette:direction.palette,notes:['Original asset bytes are embedded unchanged. Runtime white-key transparency is declared separately.','Approved-path status describes registry provenance, not a visual approval of every frame.','Lighting, shadows and shiny effects are omitted. Sprites retain their source colours across biomes.']}));
