// The sole map-art renderer changes presentation, never geographic data.
const RogueObjects = (() => {
  const enabled = true;
  const trees = ['tree_wide_a','tree_wide_b','tree_root_a','tree_root_b','tree_rounded_2','tree_rounded_3'];
  const fruitTrees = { apple: 'tree_rounded_2', worldpeach: 'tree_rounded_3' };
  function hash(id) { let value=2166136261; for (const c of String(id || '')) value=Math.imul(value ^ c.charCodeAt(0),16777619); return value >>> 0; }
  // Native-pixel seams and crystal facets over the reference stone. Bake once
  // at load time; moving or rotating the camera only reuses the flat frames.
  const mineralColors = {
    flint: ['#49474d', '#96949a'], quartz: ['#b9b9b3', '#f1efdc'],
    topaz: ['#b87e32', '#f4ce67'], amethyst: ['#85558f', '#d5a0dd'],
    sapphire: ['#365e9e', '#83bee0'], ruby: ['#9c3e52', '#e78a91'],
    emerald: ['#387957', '#8bc98b'], diamond: ['#83abb5', '#e5f8eb'],
    copper: ['#a56543', '#dfaa72'], iron: ['#65737c', '#b3c0c3'],
    gold: ['#b18a37', '#f0d275'], platinum: ['#8d9199', '#dde1e4'],
    crimson: ['#973d48', '#df7781'], frost: ['#518ca7', '#b0e1ed'],
  };
  function bakeMinerals(scene) {
    const texture = scene.textures.createCanvas('rogue_minerals', 16 * Object.keys(mineralColors).length, 16);
    const ctx = texture.context, source = scene.textures.get('rogue_stone').getSourceImage();
    Object.entries(mineralColors).forEach(([material, colors], frame) => {
      ctx.save(); ctx.translate(frame * 16, 0);
      ctx.drawImage(source, 0, 0);
      const crystal = ['quartz', 'topaz', 'amethyst', 'sapphire', 'ruby', 'emerald', 'diamond'].includes(material);
      const pixels = crystal
        ? [[6,4,2,6],[5,5,1,4],[8,6,2,5],[10,5,1,4]]
        : [[5,5,2,1],[6,6,2,1],[7,7,1,2],[8,9,2,1],[10,10,2,1],[4,9,2,1]];
      ctx.fillStyle = colors[0];
      for (const [x,y,w,h] of pixels) ctx.fillRect(x,y,w,h);
      ctx.fillStyle = colors[1];
      for (const [x,y,w,h] of pixels) ctx.fillRect(x,y,1,crystal ? Math.max(1,h-2) : 1);
      ctx.restore();
      texture.add(frame, 0, frame * 16, 0, 16, 16);
    });
    texture.refresh();
  }
  // Palette roles follow the installed RA trees: five warm bark shades and
  // restrained foliage highlights. Species retain different hues; lavender
  // keeps its plum canopy and conifers remain cooler than the olive hedge.
  // Explicit source colours leave transparency, shadows and shape untouched.
  const streetPalettes = Object.freeze({
    mossy_tree: Object.freeze({
      0x314a14:0x4c4d2b, 0x42631b:0x66663d, 0x42631a:0x66663d,
      0x557827:0x7f7f46, 0x527b20:0x7f7f46, 0x719828:0x99994c,
      0x98b21a:0xb2b247, 0xc8ce57:0xcccc47,
      0x4b4c31:0x332f23, 0x646641:0x3f3a29, 0x7e7f53:0x4c452d,
      0x8f9657:0x665b38, 0xaeb177:0x7f713f, 0x664531:0x4c452d,
    }),
    conifer_tree: Object.freeze({
      0x1f4d37:0x253526, 0x265c42:0x35482e, 0x2e6635:0x4a5f35,
      0x3e8948:0x637b3f, 0x53a641:0x85974c, 0x63c74d:0xaeb764,
      0x9ac77f:0xc1c681,
      0x3e2731:0x332f23, 0x733e39:0x4c452d, 0xb86f50:0x7f713f,
    }),
    lavender_tree: Object.freeze({
      0x3d4299:0x413b4d, 0x595eb2:0x5b516b, 0x7a7fcc:0x7b6e89,
      0xa0a4e5:0x9a8aa3, 0xc1c3f2:0xbcacbf,
    }),
    dead_tree: Object.freeze({
      0x19100f:0x332f23, 0x2d1d1b:0x3f3a29, 0x2d2216:0x45402b,
      0x3d2724:0x4c452d, 0x472e2a:0x665b38, 0x513d30:0x7f713f,
    }),
    hedge_strip: Object.freeze({
      0x2a594f:0x4c5132, 0x3b7d4f:0x727b40,
      0x63ab3f:0x999e4b, 0xa4c443:0xbfc35f,
    }),
  });
  function streetPalette(name) { return streetPalettes[name] || null; }
  function recolorStreetPixels(data, name) {
    const palette = streetPalette(name);
    if (!palette) return data;
    for (let i=0; i<data.length; i+=4) {
      // Soft source shadows are not foliage or bark, and retain their ink.
      if (data[i+3] !== 255) continue;
      const value=palette[(data[i]<<16)|(data[i+1]<<8)|data[i+2]];
      if (value == null) continue;
      data[i]=value>>>16; data[i+1]=(value>>>8)&255; data[i+2]=value&255;
    }
    return data;
  }
  function bakeStreetPalette(scene, name) {
    if (!streetPalette(name)) return;
    const key='street_decor_'+name, source=scene.textures.get(key).getSourceImage();
    const canvas=document.createElement('canvas');
    canvas.width=source.width; canvas.height=source.height;
    const ctx=canvas.getContext('2d'); ctx.drawImage(source,0,0);
    const image=ctx.getImageData(0,0,canvas.width,canvas.height);
    recolorStreetPixels(image.data,name); ctx.putImageData(image,0,0);
    scene.textures.remove(key);
    scene.textures.addSpriteSheet(key,canvas,{frameWidth:canvas.width,frameHeight:canvas.height});
  }
  // Approved road props remain exact source crops. Small mushroom palette
  // adjustments use the shared per-sprite tint, preserving alpha and source pixels.
  function installStreetArt(assets) {
    if (typeof STREET_DECORATION_ART === 'undefined') return;
    for (const [name, row] of Object.entries(STREET_DECORATION_ART)) {
      const key = 'street_decor_' + name;
      assets[key] = {kind:'spritesheet', path:row.path,
        frameWidth:row.bounds.fw, frameHeight:row.bounds.fh,
        ...(streetPalette(name) ? {onLoad:scene => bakeStreetPalette(scene,name)} : {})};
      SpriteLayout.ART_BOUNDS[key + ':0'] = {...row.bounds};
      SpriteLayout.ART_BOUNDS[key + ':__BASE'] = {...row.bounds};
    }
  }
  function streetSpec(o, original) {
    if (typeof STREET_DECORATION_ART === 'undefined' || o.kind === '_streetlamp') return null;
    const name = o._streetArt || (o.kind === 'tree' ? o._objectArt : null);
    const row = STREET_DECORATION_ART[name];
    if (!row || o._smashed) return null;
    const tree = o.kind === 'tree';
    const stage = tree ? treeArtFrame(o) : 3;
    const scale = row.scale * (tree ? (stage === 1 ? .42 : stage === 2 ? .7 : 1) : 1);
    return {...original, key:'street_decor_' + name, frame:0, scale,
      origin:[.5,.5], seat:true, groundAtOrigin:!!row.ground,
      dxPx:0, dyPx:0, scaleYMul:1, artBounds:undefined,
      layer:row.ground && typeof WorldLayers !== 'undefined' ? WorldLayers.GROUND_DECAL : original.layer,
      shadow:!row.ground,
      after: ['spotted_mushroom','red_mushroom'].includes(name)
        ? sprite => sprite.setTint(0xb0a27c) : undefined};
  }
  function install(assets) {
    installStreetArt(assets);
    // Source-preserving palette adaptation; the existing berry baker derives
    // fruiting/picked states from this same canopy, with unchanged 24px frames.
    if (assets.bushes) assets.bushes = {...assets.bushes,
      path:'assets/ArtTrials/RogueObjects/bushes-olive.png'};
    assets.selected_shrub = {kind:'spritesheet',
      path:'assets/ArtTrials/RogueObjects/shrub-olive.png',frameWidth:16,frameHeight:16};
    // Ambient shrubs use the planted-pool resolver, not spec(). Urban shrub
    // cells otherwise select the old mint clipped hedge and bypass this palette.
    // Keep explicitly authored hedge rows, brambles and palms in their own looks.
    if (typeof CROP_SPRITE !== 'undefined' && typeof BUSH_SPRITE !== 'undefined') {
      const shrub = CROP_SPRITE.shrub;
      CROP_SPRITE.shrub = {...BUSH_SPRITE, shadow:true,
        looks:{...shrub.looks, clipped:{...BUSH_SPRITE, shadow:true}}};
    }
    for (const [name,bounds] of Object.entries(ROGUE_OBJECT_BOUNDS)) {
      // Houses use the shared footprint-based renderer and its current scheme.
      if (name.startsWith('house_')) continue;
      const key='rogue_'+name;
      assets[key]={kind:'image',path:'assets/ArtTrials/RogueObjects/'+name.replaceAll('_','-')+'.png'};
      if (typeof SpriteLayout !== 'undefined') SpriteLayout.ART_BOUNDS[key+':__BASE']=bounds;
    }
    // Map fruit trees share the RA silhouettes. Sapling inventory icons retain
    // their compact legacy sheets; growth, harvests and fruit overlays stay shared.
    for (const [species, source] of Object.entries(fruitTrees)) {
      const bounds = ROGUE_OBJECT_BOUNDS[source];
      for (const suffix of ['', '_blossom']) {
        const key = 'rogue_fruit_' + species + suffix;
        assets[key] = {kind:'image', path:'assets/ArtTrials/RogueObjects/fruit-' + species + suffix.replace('_','-') + '.png',
          frameWidth:bounds.fw, frameHeight:bounds.fh};
        SpriteLayout.ART_BOUNDS[key+':__BASE'] = {...bounds};
        SpriteLayout.CROWN_BOUNDS[key+':__BASE'] = {...bounds, maxY:53};
      }
    }
    assets.rogue_stone.onLoad = bakeMinerals;
    Object.keys(mineralColors).forEach((material, frame) => {
      SpriteLayout.ART_BOUNDS['rogue_minerals:' + frame] = ROGUE_OBJECT_BOUNDS.stone;
    });
    // Replace atlas aliases and their legacy callbacks entirely. Reviewed PNGs
    // already contain alpha/palette treatment and must not be muted a second time.
    if (typeof ROGUE_PROP_PROFILE !== 'undefined') {
      for (const [key, asset] of Object.entries(ROGUE_PROP_PROFILE.assets)) assets[key] = {...asset};
      // Frame crops remove only ground-contact ink; dynamic shadows stay in
      // Render. Keep source coordinates so lit/unlit sheet frames cannot drift.
      for (const [key, frames] of Object.entries(ROGUE_PROP_PROFILE.frameCrops || {})) {
        assets[key].onLoad = scene => {
          const texture = scene.textures.get(key);
          for (const [frame, height] of Object.entries(frames)) {
            const source = texture.get(frame);
            const {sourceIndex, cutX, cutY, cutWidth} = source;
            texture.remove(frame);
            texture.add(frame, sourceIndex, cutX, cutY, cutWidth, height);
          }
        };
      }
      if (typeof SpriteLayout !== 'undefined') Object.assign(SpriteLayout.ART_BOUNDS, ROGUE_PROP_PROFILE.bounds);
    }
  }
  function installIcons(sheets) {
    if (typeof ROGUE_PROP_PROFILE === 'undefined') return;
    for (const [key, sheet] of Object.entries(ROGUE_PROP_PROFILE.icons)) {
      if (sheets[key]) sheets[key] = {...sheet};
    }
  }
  // Zones whose plain stone keeps its themed rock_variants block
  // (ZONE_ROCK_THEMES) instead of the shared Rogue stone: the quarries' cut
  // cubes.
  const ZONE_ROCK_ART = new Set(['quarry-strip-mine', 'quarry-abandoned']);
  function spec(o,scene,original) {
    const street = streetSpec(o, original);
    if (street) return street;
    if (o.kind === 'mineralrock' && ZONE_ROCK_ART.has(o.zoneVariant) && mineralRockUsesZoneArt(o)) return original;
    if (o.kind === 'mineralrock' && mineralRockMaterial(o) !== 'plain') {
      return {...original, key:'rogue_minerals', frame:Object.keys(mineralColors).indexOf(mineralRockMaterial(o)),
        scale:o.sightBlocking ? 2.4 : 1.6, origin:[.5,.5], seat:true,
        groundAtOrigin:false, dxPx:0, dyPx:0, scaleYMul:1, artBounds:undefined, after:undefined};
    }
    if (o.kind === 'mineralrock') {
      return {...original, key:hash(o.id)%2 ? 'rogue_stone' : 'rogue_rock_mid', frame:'__BASE',
        scale:o.sightBlocking ? 2.4 : 1.6, origin:[.5,.5], seat:true,
        groundAtOrigin:false, dxPx:0, dyPx:0, scaleYMul:1, artBounds:undefined, after:undefined};
    }
    // Access and shrine assets share the reviewed treatment above and below ground.
    if (o.kind === 'staircase') {
      const elevator = !!o.elevator, up = o.dir === 'up';
      return {...original, key: elevator ? 'rogue_elevators' : up ? 'rogue_ladder_up' : 'rogue_ladder_down',
        frame: elevator ? (Elevators.isRepaired(scene?.save) ? 1 : 0) : '__BASE',
        scale: 1, origin: [.5,.5], seat: elevator || up, groundAtOrigin: !elevator && !up,
        dxPx: 0, dyPx: 0, scaleYMul: 1, artBounds: undefined};
    }
    if (o.kind === 'grove_shrine' && SpriteLayout.groveShrineArt(o).key === 'grove_votive')
      return {...original, scale: SpriteLayout.SHRINE_KIND_ART.scale};
    if (o.kind === 'fruittree') {
      const state = (o, scene, pass) => Crops.fruitTreeState(o, scene.save?.fruitPicked?.[o.id], pass.fruitNow);
      return {...original,
        key:(o, scene, pass) => {
          const growth = state(o, scene, pass);
          return 'rogue_fruit_' + (o.species === 'worldpeach' ? 'worldpeach' : 'apple')
            + (growth.blossoming || growth.stage === 3 ? '_blossom' : '');
        },
        frame:'__BASE', origin:[.5,.5],
        scale:(o, scene, pass) => o.planted ? .35 + .125 * state(o, scene, pass).stage : .85,
        seat:true, groundAtOrigin:false, dxPx:0, dyPx:0, scaleYMul:1, artBounds:undefined};
    }
    if ((scene?.depth || 0)>0) return original;
    let key,scale;
    if (o.kind==='tree') {
      key=o._objectArt==='dead_tree' ? 'tree_dead' : trees[hash(o.id)%trees.length];
      // Keep growth legible. Full trees use the reference's broad canopy;
      // smaller living stages retain their data and scale the native artwork.
      const stage=treeArtFrame(o); scale=stage===1 ? .35 : stage===2 ? .6 : .85;
      // A bare snag has no canopy to fill the cell, so at the full-tree scale
      // it read oversized beside living trees.
      if (o._objectArt==='dead_tree') scale*=.75;
    }
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
  return {enabled,ZONE_ROCK_ART,install,installIcons,spec,status,streetPalette,recolorStreetPixels,bakeStreetPalette};
})();
if(typeof ASSETS!=='undefined') RogueObjects.install(ASSETS);
if(typeof window!=='undefined') window.RogueObjects=RogueObjects;
// Rogue is the sole active world art profile.
const WorldArtProfile=RogueObjects;
