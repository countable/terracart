// Source-native presentation for the opt-in Dreamland geographic trial.
// Object identities, growth, restoration and footprints remain gameplay data.
const DreamlandObjects = (() => {
  const enabled = typeof location !== 'undefined'
    && new URLSearchParams(location.search).get('artTrial') === 'dreamland';
  const files = ['house', 'house-wide', 'tree', 'tree-young', 'lamp', 'lamp-unlit', 'fountain', 'crate', 'sign'];
  function install(assets) {
    if (!enabled) return;
    for (const file of files) assets['dreamland_' + file.replaceAll('-', '_')] = {
      kind: 'image', path: `assets/ArtTrials/DreamlandObjects/${file}.png`,
    };
  }
  function houseKey(o, scene, role) {
    if (!enabled || (scene?.depth || 0) > 0 || !o || ![9, 11].includes(o.tier)
        || !['plain', 'trailer', 'shop', 'trader', 'blacksmith', 'fort'].includes(role)) return null;
    // Preserve the actual open-roof Home and its furniture while inside.
    if (role === 'trailer' && scene.homeInside?.()) return null;
    return o.tier === 11 ? 'dreamland_house_wide' : 'dreamland_house';
  }
  function spec(o, scene, original) {
    if (!enabled || (scene?.depth || 0) > 0) return original;
    let key, scale;
    if (o.kind === 'tree' && o._objectArt !== 'dead_tree') {
      const young = treeArtFrame(o) < 3;
      key = young ? 'tree_young' : 'tree';
      scale = treeArtFrame(o) === 1 ? 0.8 : young ? 1.5 : 2;
    } else if (o.kind === '_streetlamp') {
      key = o.lit ? 'lamp' : 'lamp_unlit'; scale = 2;
    } else if (o.kind === 'well') {
      key = 'fountain'; scale = 2;
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
      dxPx: 0, dyPx: 0, scaleYMul: 1, artBounds: undefined, after: undefined };
    return { ...original, key: 'dreamland_' + key, frame: '__BASE', scale,
      origin: [0.5, 0.5], seat: true, groundAtOrigin: false,
      dxPx: 0, dyPx: 0, scaleYMul: 1, artBounds: undefined,
      // Native lamps use the existing lighting emitter; don't resize them
      // to the previous canvas glow square or tint DeepForest's tree crown.
      after: undefined };
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
  return { enabled, install, houseKey, houseScale, spec, lampLightOffset, status };
})();
if (typeof ASSETS !== 'undefined') DreamlandObjects.install(ASSETS);
if (typeof window !== 'undefined') window.DreamlandObjects = DreamlandObjects;
