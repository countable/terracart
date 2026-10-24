// Source-native presentation for the opt-in Dreamland geographic trial.
// Object identities, growth, restoration and footprints remain gameplay data.
const DreamlandObjects = (() => {
  const enabled = typeof location !== 'undefined'
    && new URLSearchParams(location.search).get('artTrial') === 'dreamland';
  const files = ['house', 'house-wide', 'house-collapsed', 'chimney', 'chimney-right', 'wreck-material', 'wreck-interior', 'tree', 'tree-young', 'lamp', 'lamp-unlit', 'fountain', 'crate', 'sign', 'ground-base', 'ground-patch', 'ground-patch-small', 'ground-specks-a', 'ground-specks-b', 'ground-specks-c'];
  function install(assets) {
    if (!enabled) return;
    for (const name of ['tree-tall','shrub','shrub-flower','flower','flowers','short-grass','slab','slab-split','slab-small','well','crate-stack'])
      assets['dreamland_deco_' + name.replaceAll('-', '_')] = {kind:'image',path:`assets/ArtTrials/DreamlandEnrichment/${name}.png`};
    assets.dreamland_fountain_water = {kind:'spritesheet',path:'assets/ArtTrials/DreamlandEnrichment/fountain-water.png',frameWidth:48,frameHeight:48};
    assets.authored_source_dreamland_corner = {kind: 'image', path: 'assets/ArtTrials/DreamlandObjects/house-wide.png'};
    assets.authored_source_dreamland_wide = {kind: 'image', path: 'assets/ArtTrials/DreamlandObjects/house-wide.png'};
    assets.authored_source_dreamland_house = {kind: 'image', path: 'assets/ArtTrials/DreamlandObjects/house.png'};
    for (const file of files) assets['dreamland_' + file.replaceAll('-', '_')] = {
      kind: 'image', path: `assets/ArtTrials/DreamlandObjects/${file}.png`,
    };
  }
  function houseKey(o, scene, role) {
    // WebGL draws native materials on retained footprint geometry. Canvas
    // keeps the matching source sprite as its supported fallback.
    if (scene?.game?.renderer?.type === 2) return null;
    if (!enabled || (scene?.depth || 0) > 0 || !o || ![9, 11].includes(o.tier)
        || !['plain', 'trailer', 'shop', 'trader', 'blacksmith', 'fort', 'wreck'].includes(role)) return null;
    if (role === 'wreck') return o.tier === 9 && !o.castle ? 'dreamland_house_collapsed' : null;
    // Preserve the actual open-roof Home and its furniture while inside.
    if (role === 'trailer' && scene.homeInside?.()) return null;
    return o.tier === 11 ? 'dreamland_house_wide' : 'dreamland_house';
  }
  function buildingRecipe(o, scene, role) {
    if (!enabled || (scene?.depth ?? 0) > 0 || !o || ![9, 11].includes(o.tier)
        || o.castle || ['wreck', 'wizard', 'turret'].includes(role)) return null;
    let key = scene?.dreamlandReferenceShell && o.tier === 11 ? (o.referenceModel === 'dreamland_corner' ? 'dreamland_corner' : 'dreamland_wide') : 'dreamland_house';
    if(scene?.dreamlandReferenceShell && o.referenceChimney && ['dreamland_house','dreamland_corner'].includes(key))key += '_chimney';
    return {key, palette: 'native', ...(scene?.dreamlandReferenceShell ? {sourceShell: true} : {})};
  }
  function spec(o, scene, original) {
    if (!enabled || (scene?.depth || 0) > 0) return original;
    // House sizing and footprint offsets stay in the shared house spec.
    // The source assembly is already collapsed: retain its real height and
    // let upright wall remnants occlude in painter order, not the ground pass.
    if (o.kind === 'house' && houseKey(o, scene, Houses.displayRole(scene.save, o)) === 'dreamland_house_collapsed')
      return { ...original, scaleYMul: 1, layer: WorldLayers.STANDING_PROP };
    let key, scale;
    if (o.kind === 'tree' && o._objectArt !== 'dead_tree') {
      const young = treeArtFrame(o) < 3;
      key = young ? 'tree_young' : 'tree';
      scale = treeArtFrame(o) === 1 ? 0.8 : young ? 1.5 : 2;
    } else if (o.kind === '_streetlamp') {
      key = o.lit ? 'lamp' : 'lamp_unlit'; scale = 2;
    } else if (o.kind === 'well') {
      key = 'fountain_water'; scale = 2;
    } else if (o.kind === 'infoboard') {
      key = 'sign'; scale = 2;
    } else if (o.kind === 'chest' && !o._smashed && chestLook(o).texKey === 'box') {
      key = 'crate'; scale = 2;
    }
    if (!key) return original;
    if (o.kind === '_streetlamp') return { ...original,
      key: 'dreamland_' + key, frame: '__BASE', scale,
      // Source post contact is (3,25), glass centre (14,16). Keep the
      // asymmetric arm from moving the foot or the existing light's origin.
      origin: [3 / 21, 25 / 30], seat: false, groundAtOrigin: true,
      dxPx: 0, dyPx: 0, scaleYMul: 1, artBounds: undefined, after: animate };
    return { ...original, key: 'dreamland_' + key, frame: key === 'fountain_water' ? 0 : '__BASE', scale,
      origin: [0.5, 0.5], seat: true, groundAtOrigin: false,
      dxPx: 0, dyPx: 0, scaleYMul: 1, artBounds: undefined,
      // Native lamps use the existing lighting emitter; don't resize them
      // to the previous canvas glow square or tint DeepForest's tree crown.
      after: animate };
  }
  // One scene listener, no tweens or texture work during walking. Pooled
  // sprites are checked against their current texture before any animation.
  function animate(sprite, object, scene) {
    sprite._dreamlandMotion = {key:sprite.texture.key,kind:object.kind,
      scaleX:sprite.scaleX,scaleY:sprite.scaleY,phase:((String(object.id).length*137)%1000)/1000};
    if (scene._dreamlandMotionReady) return;
    scene._dreamlandMotionReady = true;
    scene.events.on('postupdate', time => {
      if (scene.depth > 0) return;
      for (const s of scene.objectPool || []) {
        const a=s._dreamlandMotion;
        if (!s.visible || !a || s.texture.key !== a.key) continue;
        const wave=Math.sin(time/900+a.phase*6.283);
        if (a.kind==='well') s.setFrame(Math.floor(time/220)%4);
        else if (a.kind==='tree') s.setScale(a.scaleX*(1+wave*0.004),a.scaleY);
        else if (a.kind==='_streetlamp' && a.key==='dreamland_lamp') {
          const blue=Math.round(244+wave*6);s.setTint((255<<16)|(253<<8)|blue);
        }
      }
    });
  }
  function lampLightOffset(scene) {
    return enabled && !(scene?.depth > 0) ? {dxPx: 22, dyPx: -18} : null;
  }
  function houseScale(o, scene, frameWidth) {
    // Fit the geographic footprint, keeping the native facade proportional.
    // The ordinary legacy sprite's 1.35-cell cap is not a polygon footprint.
    const cells = o.area > 0 && scene.cellM > 0 ? Math.sqrt(o.area) / scene.cellM : 2.5;
    return Math.max(1.5, Math.min(5, cells)) * CELL_PX / frameWidth;
  }
  function status(scene) {
    const textures = {};
    const houses = [];
    for (const sprite of scene?.objectPool || []) {
      const key = sprite?.texture?.key;
      if (sprite.visible && key?.startsWith('dreamland_')) textures[key] = (textures[key] || 0) + 1;
      if (sprite.visible && key?.startsWith('dreamland_house') && sprite._staticObject)
        houses.push({id: sprite._staticObject.id, role: Houses.displayRole(scene.save, sprite._staticObject)});
    }
    return { enabled, textures, houses };
  }
  return { enabled, install, houseKey, buildingRecipe, houseScale, spec, lampLightOffset, status };
})();
if (typeof ASSETS !== 'undefined') DreamlandObjects.install(ASSETS);
if (typeof window !== 'undefined') window.DreamlandObjects = DreamlandObjects;
