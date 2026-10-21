// The complete reference art profile changes presentation, never geographic data.
const RogueObjects = (() => {
  const enabled = typeof location !== 'undefined'
    && new URLSearchParams(location.search).get('artTrial') === 'rogue';
  const trees = ['tree_wide_a','tree_wide_b','tree_root_a','tree_root_b','tree_rounded_2','tree_rounded_3'];
  function hash(id) { let value=2166136261; for (const c of String(id || '')) value=Math.imul(value ^ c.charCodeAt(0),16777619); return value >>> 0; }
  function install(assets) {
    if (!enabled) return;
    // Source-preserving palette adaptation; the existing berry baker derives
    // fruiting/picked states from this same canopy, with unchanged 24px frames.
    if (assets.bushes) assets.bushes = {...assets.bushes,
      path:'assets/ArtTrials/RogueObjects/bushes-olive.png'};
    if (assets.selected_shrub) assets.selected_shrub = {...assets.selected_shrub,
      path:'assets/ArtTrials/RogueObjects/shrub-olive.png'};
    for (const [name,bounds] of Object.entries(ROGUE_OBJECT_BOUNDS)) {
      // Houses use the shared footprint-based renderer and its current scheme.
      if (name.startsWith('house_')) continue;
      const key='rogue_'+name;
      assets[key]={kind:'image',path:'assets/ArtTrials/RogueObjects/'+name.replaceAll('_','-')+'.png'};
      if (typeof SpriteLayout !== 'undefined') SpriteLayout.ART_BOUNDS[key+':__BASE']=bounds;
    }
  }
  // No facade override: retain the normal 3D house renderer (and its Canvas
  // fallback), including footprint, restoration, rotation and open-roof Home.
  function houseKey() { return null; }
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
  return {enabled,install,houseKey,spec,status};
})();
if(typeof ASSETS!=='undefined') RogueObjects.install(ASSETS);
if(typeof window!=='undefined') window.RogueObjects=RogueObjects;
// Both modules are no-ops outside their opt-in profile.
const WorldArtProfile=RogueObjects.enabled ? RogueObjects : DreamlandObjects;
