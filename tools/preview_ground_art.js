// Resolve review ground swatches through the active surface terrain renderer.
// A uniform sample uses the same four equal material corners as an interior
// game cell. Site boundaries still belong to TerrainTransitions' live ring.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function previewGroundArt(context) {
  if (!vm.runInContext("typeof TerrainTransitions !== 'undefined'", context)) {
    const source = path.join(__dirname, '../src/terrain_transitions.js');
    vm.runInContext(fs.readFileSync(source, 'utf8'), context, { filename: 'terrain_transitions.js' });
  }
  return vm.runInContext(`(() => {
    const frameFor = family => {
      if (family < 0) return null;
      const layers = TerrainTransitions.layersFor([family, family, family, family]);
      if (layers.length !== 1) throw new Error('Uniform terrain must resolve to one native frame');
      return layers[0];
    };
    const zoneFrames = Object.fromEntries(Object.entries(ZONE_SELECTED_MATERIALS)
      .map(([id, material]) => [id, frameFor(TerrainTransitions.materialForGround(28, 'zone_ground_' + material))]));
    const types = [...new Set([...Object.keys(GroundMaterials.terrainFamilies), ...Object.keys(GroundMaterials.backdropTypes)])];
    const terrainFrames = Object.fromEntries(types.map(type => {
      const mapped = GroundMaterials.backdropTypes[type] ?? type;
      return [type, GroundMaterials.terrainFamilies[mapped].map(frameFor)];
    }));
    const zoneTerrainFrames = {};
    if (typeof zoneGroundTexture === 'function' && typeof ZoneVariantData !== 'undefined') {
      for (const variant of ZoneVariantData.variants) {
        const entry = {zone:{coverage:new Uint16Array([1]), anchors:[{kind:variant.zone, variant:variant.id}]}};
        for (const type of types) {
          const texture = zoneGroundTexture(entry, 0, Number(type));
          if (!texture) continue;
          const frame = frameFor(TerrainTransitions.materialForGround(Number(type), texture));
          if (frame != null) zoneTerrainFrames[type + ':' + variant.id] = frame;
        }
      }
    }
    const selectedFallback = typeof SELECTED_TERRAIN !== 'undefined' && ASSETS.selected_terrain
      ? {key:'preview_selected_terrain', asset:{...ASSETS.selected_terrain,
          kind:'spritesheet', frameWidth:16, frameHeight:16}, terrainFrames:SELECTED_TERRAIN}
      : null;
    return {key:GroundMaterials.atlas.key, asset:ASSETS[GroundMaterials.atlas.key],
      terrainFrames, zoneFrames, zoneTerrainFrames, selectedFallback, families:[...TerrainTransitions.families]};
  })()`, context);
};
