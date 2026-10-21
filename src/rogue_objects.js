// The complete reference art profile changes presentation, never geographic data.
const RogueObjects = (() => {
  const enabled = typeof location !== 'undefined'
    && new URLSearchParams(location.search).get('artTrial') === 'rogue';
  const trees = ['tree_wide_a','tree_wide_b','tree_root_a','tree_root_b','tree_rounded_2','tree_rounded_3'];
  function hash(id) { let value=2166136261; for (const c of String(id || '')) value=Math.imul(value ^ c.charCodeAt(0),16777619); return value >>> 0; }
  function install(assets) {
    if (!enabled) return;
    for (const [name,bounds] of Object.entries(ROGUE_OBJECT_BOUNDS)) {
      const key='rogue_'+name;
      assets[key]={kind:'image',path:'assets/ArtTrials/RogueObjects/'+name.replaceAll('_','-')+'.png'};
      if (typeof SpriteLayout !== 'undefined') SpriteLayout.ART_BOUNDS[key+':__BASE']=bounds;
    }
  }
  function houseKey(o,scene,role) {
    if (!enabled || (scene?.depth || 0)>0 || !o || ![9,11].includes(o.tier)
      || !['plain','trailer','shop','trader','blacksmith','fort'].includes(role)) return null;
    if (role==='trailer' && scene.homeInside?.()) return null;
    return o.tier===9 ? 'rogue_house_small' : hash(o.id)%2 ? 'rogue_house_sw' : 'rogue_house_large';
  }
  function houseScale(o,scene,width) {
    const cells=o.area>0 && scene.cellM>0 ? Math.sqrt(o.area)/scene.cellM : 2.5;
    return Math.max(1.5,Math.min(5,cells))*CELL_PX/width;
  }
  function spec(o,scene,original) {
    if (!enabled || (scene?.depth || 0)>0) return original;
    let key,scale;
    if (o.kind==='tree') {
      key=o._objectArt==='dead_tree' ? 'tree_dead' : trees[hash(o.id)%trees.length];
      // Keep growth legible. Full trees use the reference's broad canopy;
      // smaller living stages retain their data and scale the native artwork.
      const stage=treeArtFrame(o); scale=stage===1 ? .35 : stage===2 ? .6 : .85;
    } else if (o.kind==='_streetlamp') {key=o.lit ? 'lamp':'lamp_unlit';scale=1.25;}
    else if (o.kind==='mineralrock' && mineralRockMaterial(o)==='plain') {key=hash(o.id)%2 ? 'stone':'rock_mid';scale=o.sightBlocking ? 2.4 : 1.6;}
    else if (o.kind==='staircase' && o.dir==='down' && !o.elevator) {key='ladder_down';scale=1;}
    if (!key) return original;
    return {...original,key:'rogue_'+key,frame:'__BASE',scale,origin:[.5,.5],seat:true,
      groundAtOrigin:false,dxPx:0,dyPx:0,scaleYMul:1,artBounds:undefined,after:undefined};
  }
  function status(scene) {
    const textures={};
    for(const sprite of scene?.objectPool || []) if(sprite.visible && sprite.texture?.key?.startsWith('rogue_')) {
      const key=sprite.texture.key;textures[key]=(textures[key] || 0)+1;
    }
    return {enabled,textures};
  }
  return {enabled,install,houseKey,houseScale,spec,status};
})();
if(typeof ASSETS!=='undefined') RogueObjects.install(ASSETS);
if(typeof window!=='undefined') window.RogueObjects=RogueObjects;
// Both modules are no-ops outside their opt-in profile.
const WorldArtProfile=RogueObjects.enabled ? RogueObjects : DreamlandObjects;
