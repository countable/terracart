// Active map-profile checks: lifecycle, fruit hook and art dimensions survive the swap.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ctx = {console,addEventListener(){}};ctx.window=ctx;vm.createContext(ctx);
for (const name of ['enemy_roster','util','sprite_layout','rogue_object_bounds','crops','rogue_objects'])
  vm.runInContext(fs.readFileSync(path.join(root,'src',name+'.js'),'utf8'),ctx);
const assets={rogue_stone:{}};
ctx.RogueObjects.install(assets);
const pickedAt=10*ctx.Crops.FRUIT_RESPAWN_MS;
for(const species of ['apple','worldpeach']) {
  const tree={kind:'fruittree',species,id:'orchard'};
  const scene={save:{fruitPicked:{orchard:pickedAt}}};
  const after=()=>{};
  const spec=ctx.RogueObjects.spec(tree,scene,{after,shadow:true});
  assert.equal(spec.after,after,'fruit overlay hook must survive the active profile');
  assert.equal(spec.scale(tree,scene,{fruitNow:pickedAt}),.85);
  assert.equal(spec.key(tree,scene,{fruitNow:pickedAt}),'rogue_fruit_'+species);
  assert.equal(spec.key(tree,scene,{fruitNow:pickedAt+ctx.Crops.FRUIT_RESPAWN_MS-1}),'rogue_fruit_'+species+'_blossom');
  assert.equal(spec.key(tree,scene,{fruitNow:pickedAt+ctx.Crops.FRUIT_RESPAWN_MS}),'rogue_fruit_'+species);
  const planted={...tree,planted:true,planted_t:1};
  assert.equal(spec.scale(planted,scene,{fruitNow:1}),.35);
  assert.equal(spec.key(planted,scene,{fruitNow:1+ctx.Crops.FRUIT_STAGE_MS*3}),'rogue_fruit_'+species+'_blossom');
  assert.equal(spec.scale(planted,scene,{fruitNow:1+ctx.Crops.FRUIT_STAGE_MS*4}),.85);
  for(const suffix of ['','_blossom']) {
    const key='rogue_fruit_'+species+suffix,asset=assets[key];
    const png=fs.readFileSync(path.join(root,asset.path));
    assert.equal(png.readUInt32BE(16),asset.frameWidth);assert.equal(png.readUInt32BE(20),asset.frameHeight);
    const bounds=ctx.SpriteLayout.ART_BOUNDS[key+':__BASE'];
    const crown=ctx.SpriteLayout.CROWN_BOUNDS[key+':__BASE'];
    assert.ok(crown.maxY<bounds.maxY,'fruit belongs above the trunk');
    const offset=ctx.SpriteLayout.fruitCrownOffset(key,'__BASE',.5,.5,.85,.85);
    assert.ok(offset && offset.dyPx<0,'fruit sits in the upper canopy');
  }
}
console.log('PASS: RA fruit-tree assets, growth, mature regrowth, blossom timing and fruit-overlay hook');
