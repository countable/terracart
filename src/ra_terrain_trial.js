// Native tileset ground on the ordinary generated world. This optional
// presentation never writes grid, occupancy, source polygons, objects or saves.
const RATerrainTrial = (() => {
  const mode = new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('artTrial');
  const profiles = Object.freeze({
    rogue: {source:'ra_terrain_source', key:'ra_terrain_composite', path:'assets/ArtTrials/RogueTerrain/tiles.png'},
    dreamland: {source:'dreamland_terrain_source', key:'dreamland_terrain_composite', path:'assets/ArtTrials/DreamlandTerrain/terrain.png', road:'assets/ArtTrials/DreamlandTerrain/path.png'},
  });
  const profile = profiles[mode];
  const enabled = !!profile;
  const families = Object.freeze(['villageGrass', 'forestGrass', 'oliveSoil', 'darkSoil', 'water', 'sand', 'stone', ...(mode === 'rogue' ? ['brownSoil'] : [])]);
  const SOURCE = profile?.source, KEY = profile?.key;
  const TILE = mode === 'dreamland' ? 32 : 16;
  const roadCanvases = [];
  const ROAD_VARIANTS = new Set(['plain','default','lantern','golden','golden_path','orchard','promenade']);
  function roadTile(variant, restored) {
    return profile?.road && (!variant || ROAD_VARIANTS.has(variant)) ? (roadCanvases[restored ? 1 : 0] || null) : null;
  }
  const COUNT = families.length, FRAMES = COUNT ** 4;
  const TYPES = Object.freeze({0:0, 1:1, 2:5, 3:4, 4:2, 5:0, 6:0, 15:6, 16:6, 17:6, 18:0, 19:0, 20:3, 21:0, 22:1, 23:4});
  function patchNoise(x, y) {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function material(type, cellX, cellY) {
    const family = TYPES[type] ?? -1;
    if (mode === 'rogue' && (family === 0 || family === 1)
        && Number.isFinite(cellX) && Number.isFinite(cellY)) {
      // Broad, stable ground islands use the reference's native soil edges;
      // this is a presentation sample, never a new terrain/collision class.
      const bx = Math.floor(cellX / 5), by = Math.floor(cellY / 5);
      const x = cellX / 5 - bx, y = cellY / 5 - by;
      const a = patchNoise(bx,by), b = patchNoise(bx+1,by);
      const c = patchNoise(bx,by+1), d = patchNoise(bx+1,by+1);
      const value = (a+(b-a)*x)*(1-y)+(c+(d-c)*x)*y;
      if (value > .56) return family === 0 ? 7 : 2;
      if (family === 1 && value < .25) return 3;
      return family;
    }
    if (mode !== 'dreamland'  || (family !== 0 && family !== 1)
        || !Number.isFinite(cellX) || !Number.isFinite(cellY)) return family;
    // Stable source-native grass islands. Both families share the reference's
    // olive fill; the island mask reveals its lighter irregular grass edge.
    // World coordinates keep patches fixed across walking and tile boundaries.
    const bx = Math.floor(cellX / 4), by = Math.floor(cellY / 4);
    const x = cellX / 4 - bx, y = cellY / 4 - by;
    const a = patchNoise(bx, by), b = patchNoise(bx + 1, by);
    const c = patchNoise(bx, by + 1), d = patchNoise(bx + 1, by + 1);
    return (a + (b - a) * x) * (1 - y) + (c + (d - c) * x) * y > 0.56 ? 1 : 0;
  }
  function maskFor(values, family) {
    let mask = 0;
    for (let i = 0; i < 4; i++) if (values[i] === family) mask |= 1 << i;
    return mask;
  }
  function frameFor(values) { return values[0] + COUNT * (values[1] + COUNT * (values[2] + COUNT * values[3])); }
  function install(assets) {
    if (enabled) assets[SOURCE] = {kind:'spritesheet', path:profile.path, frameWidth:TILE, frameHeight:TILE};
    if (profile?.road) {
      assets.dreamland_path_source = {kind:'image', path:profile.road};
      assets.dreamland_path_restored_source = {kind:'image', path:profile.road.replace('path.png','path-restored.png')};
    }
  }
  function prepare(scene) {
    if (!enabled) return;
    if (profile.road && !roadCanvases.length) {
      for (const key of ['dreamland_path_source','dreamland_path_restored_source']) {
        const source = scene.textures.get(key).getSourceImage();
        const canvas = document.createElement('canvas');
        canvas.width = source.width * 2; canvas.height = source.height * 2;
        const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
        roadCanvases.push(canvas);
      }
    }
    if (scene.textures.exists(KEY)) { scene._raTerrainReady = true; return; }
    const canvas = document.createElement('canvas');
    const columns = Math.ceil(Math.sqrt(FRAMES));
    canvas.width = columns * TILE; canvas.height = Math.ceil(FRAMES / columns) * TILE;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const source = scene.textures.get(SOURCE);
    const draw = (family, mask, x, y) => {
      const f = source.get(family * 16 + mask);
      ctx.drawImage(f.source.image, f.cutX, f.cutY, TILE, TILE, x, y, TILE, TILE);
    };
    const values = [0,0,0,0];
    for (let frame = 0; frame < FRAMES; frame++) {
      let code = frame;
      for (let i=0; i<4; i++) { values[i] = code % COUNT; code = Math.floor(code / COUNT); }
      const x = frame % columns * TILE, y = Math.floor(frame / columns) * TILE;
      // Fill with an actual local material, not unconditional village grass:
      // transparent authored corners on a sand shore must reveal sand.
      const layers = mode === 'rogue' ? [0,1,2,3,5,6,7,4] : [0,1,2,3,5,6,4];
      const base = layers.find(family => values.includes(family));
      draw(base, 15, x, y);
      // Water draws last, so the native bank remains intact at three-way joins.
      for (const family of layers) {
        if (family === base) continue;
        const mask = maskFor(values, family);
        if (mask) draw(family, mask, x, y);
      }
    }
    const texture = scene.textures.addCanvas(KEY, canvas);
    if (typeof Phaser !== 'undefined') texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    for (let frame=0; frame<FRAMES; frame++) texture.add(frame, 0, frame % columns * TILE, Math.floor(frame / columns) * TILE, TILE, TILE);
    scene._raTerrainReady = true;
  }
  // The renderer supplies its already seam-correct world ring. Missing and
  // excluded vertices inherit the current ground rather than punching holes.
  function select(scene, ring, stride, index) {
    if (!enabled || !scene._raTerrainReady || ring[index] < 0) return null;
    const self = ring[index];
    const a=ring[index+1], b=ring[index+stride], c=ring[index+stride+1];
    const frame = self + COUNT * ((a < 0 ? self : a) + COUNT * ((b < 0 ? self : b) + COUNT * (c < 0 ? self : c)));
    const audit = scene._raTerrainAudit;
    if (audit) { audit.drawnCells++; audit.materials[families[self]] = (audit.materials[families[self]] || 0) + 1; }
    return {key:KEY, frame};
  }
  function status(scene) {
    return {enabled, profile:enabled ? mode : null, ready:!!scene?._raTerrainReady, atlasFrames:scene?._raTerrainReady ? FRAMES : 0,
      drawnCells:scene?._raTerrainAudit?.drawnCells || 0, materials:{...scene?._raTerrainAudit?.materials}};
  }
  return {enabled, roadTile, families, material, maskFor, frameFor, install, prepare, select, status};
})();
if (typeof ASSETS !== 'undefined') RATerrainTrial.install(ASSETS);
if (typeof window !== 'undefined') window.RATerrainTrial = RATerrainTrial;
