// Native terrain transitions: one local base and up to three transparent masks.
// Selection uses the renderer's geographic ring; it never changes world data.
const TerrainTransitions = (() => {
  const SOURCE = GroundMaterials.atlas.key;
  const families = Object.freeze(GroundMaterials.families.map(row => row.id));
  const water = families.indexOf(GroundMaterials.atlas.waterFamily);
  const LAYER_ORDER = families.map((_, i) => i).filter(i => i !== water).concat(water);
  const MATERIALS = Object.fromEntries(GroundMaterials.families.flatMap((row, index) =>
    row.selectedMaterial ? [[row.selectedMaterial, index]] : []));
  const groups = GroundMaterials.families.map((row, index) => row.group || index);
  function material(type) { return GroundMaterials.terrainFamilies[type]?.[0] ?? -1; }
  function materialForGround(type, textureKey, x = 0, y = 0) {
    if (textureKey?.startsWith('zone_ground_')) return MATERIALS[textureKey.slice(12)] ?? -1;
    // Roads may inherit solid rock as their backdrop, without a mountain overlay.
    type = GroundMaterials.backdropTypes[type] ?? type;
    const variants = GroundMaterials.terrainFamilies[type];
    if (!variants) return -1;
    const hash = Math.abs(Math.imul(x,2246822519) ^ Math.imul(y,3266489917));
    return variants[hash % variants.length];
  }
  function maskFor(values, family) {
    let mask = 0;
    for (let i = 0; i < 4; i++) if (values[i] === family) mask |= 1 << i;
    return mask;
  }
  // Variants change the interior art, never the biome boundary. Neighbours
  // in the same material group inherit the first local variant for this cell.
  function transitionValues(values) {
    const normalized = values.slice();
    for (let i = 1; i < normalized.length; i++) for (let j = 0; j < i; j++) {
      if (groups[values[i]] === groups[values[j]]) { normalized[i] = normalized[j]; break; }
    }
    return normalized;
  }
  function layersFor(values) {
    values = transitionValues(values);
    const frames = [];
    for (const family of LAYER_ORDER) {
      const mask = maskFor(values, family);
      if (mask) frames.push(family * 16 + (frames.length ? mask : 15));
    }
    return frames;
  }
  function install(assets) {
    const atlas = GroundMaterials.atlas;
    assets[SOURCE] = {kind:'spritesheet', path:atlas.path, frameWidth:atlas.frameSize, frameHeight:atlas.frameSize};
  }
  function prepare(scene) { scene._terrainTransitionsReady = true; }
  function select(scene, ring, stride, index) {
    if (!scene._terrainTransitionsReady || ring[index] < 0) return null;
    const self = ring[index];
    const values = [self, ring[index+1], ring[index+stride], ring[index+stride+1]]
      .map(value => value == null || value < 0 ? self : value);
    const layers = layersFor(values);
    const audit = scene._terrainTransitionAudit;
    if (audit) {
      audit.drawnCells++;
      audit.materials[families[self]] = (audit.materials[families[self]] || 0) + 1;
    }
    return {key:SOURCE, frame:layers[0], layers:layers.slice(1)};
  }
  function status(scene) {
    return {ready:!!scene?._terrainTransitionsReady,
      drawnCells:scene?._terrainTransitionAudit?.drawnCells || 0,
      materials:{...scene?._terrainTransitionAudit?.materials}};
  }
  return {families, material,
    materialForGround, maskFor, transitionValues, layersFor, install, prepare, select, status};
})();
if (typeof ASSETS !== 'undefined') TerrainTransitions.install(ASSETS);
if (typeof window !== 'undefined') window.TerrainTransitions = TerrainTransitions;
