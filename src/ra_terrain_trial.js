// Native tileset ground on the ordinary generated world. This optional
// presentation never writes grid, occupancy, source polygons, objects or saves.
const RATerrainTrial = (() => {
  const mode = 'rogue';
  const layered = new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('terrainLayers') === 'on';
  const LAYER_ORDER = [0,1,2,3,5,6,7,8,9,4];
  const profiles = Object.freeze({
    rogue: {source:'ra_terrain_source', key:'ra_terrain_composite', path:'assets/ArtTrials/RogueTerrain/tiles.png'},
  });
  const profile = profiles[mode];
  const enabled = !!profile;
  const families = Object.freeze(['villageGrass', 'forestGrass', 'oliveSoil', 'darkSoil', 'water', 'sand', 'stone', 'brownSoil', 'churchyard', 'tarYard']);
  const SOURCE = profile?.source, KEY = profile?.key;
  const TILE = mode === 'dreamland' ? 32 : 16;
  const roadCanvases = [];
  const ROAD_VARIANTS = new Set(['plain','default','lantern','golden','golden_path','orchard','promenade']);
  function roadTile(variant, restored) {
    return profile?.road && (!variant || ROAD_VARIANTS.has(variant)) ? (roadCanvases[restored ? 1 : 0] || null) : null;
  }
  // Ten families cap the startup atlas at 1600 × 1600 pixels (9.8 MiB RGBA).
  const COUNT = families.length, FRAMES = COUNT ** 4;
  // A 24px material repeat crosses the 32px grid in three world phases.
  // Only quiet interiors need extra frames; native transition masks stay intact.
  const DETAIL_REPEAT = 24, DETAIL_PHASES = 3;
  const GRASS_FRAMES = FRAMES + COUNT * DETAIL_PHASES ** 2;
  // Four native-size grass subtiles use nine shared binary vertices.
  const ATLAS_FRAMES = mode === 'dreamland' ? GRASS_FRAMES + 512 : FRAMES;
  // Residential uses the selected RA rock texture outside the native edge atlas.
  // Grass shares the orchard family; ownership and gameplay terrain stay unchanged.
  const TYPES = Object.freeze({0:1, 1:1, 2:5, 3:4, 4:2, 6:0, 15:6, 17:6, 18:0, 19:0, 20:3, 21:0, 22:1, 23:4, 29:8, 31:9});
  function patchNoise(x, y) {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function material(type, cellX, cellY) {
    const family = TYPES[type] ?? -1;
    if (mode !== 'dreamland'  || (family !== 0 && family !== 1)
        || !Number.isFinite(cellX) || !Number.isFinite(cellY)) return family;
    // Stable source-native grass islands. Both families share the reference's
    // olive fill; the island mask reveals its lighter irregular grass edge.
    // World coordinates keep patches fixed across walking and tile boundaries.
    const bx = Math.floor(cellX / 2), by = Math.floor(cellY / 2);
    const x = cellX / 2 - bx, y = cellY / 2 - by;
    const a = patchNoise(bx, by), b = patchNoise(bx + 1, by);
    const c = patchNoise(bx, by + 1), d = patchNoise(bx + 1, by + 1);
    return (a + (b - a) * x) * (1 - y) + (c + (d - c) * x) * y > 0.56 ? 1 : 0;
  }
  function maskFor(values, family) {
    let mask = 0;
    for (let i = 0; i < 4; i++) if (values[i] === family) mask |= 1 << i;
    return mask;
  }
  // One full local base followed by up to three native transparent masks.
  // Stable priority is shared with the reference bake, including water last.
  function layersFor(values) {
    const frames = [];
    for (const family of LAYER_ORDER) {
      const mask = maskFor(values, family);
      if (mask) frames.push(family * 16 + (frames.length ? mask : 15));
    }
    return frames;
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
    if (layered) { scene._raTerrainReady = true; return; }
    if (profile.road && !roadCanvases.length) {
      for (const key of ['dreamland_path_source','dreamland_path_restored_source']) {
        const source = scene.textures.get(key).getSourceImage();
        const canvas = document.createElement('canvas');
        // A native 16px slab occupies 24 display pixels. The road's vector
        // mask and gameplay cells stay unchanged; only its repeat is finer.
        canvas.width = source.width * 1.5; canvas.height = source.height * 1.5;
        const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
        roadCanvases.push(canvas);
      }
    }
    if (scene.textures.exists(KEY)) { scene._raTerrainReady = true; return; }
    const canvas = document.createElement('canvas');
    const columns = Math.ceil(Math.sqrt(ATLAS_FRAMES));
    canvas.width = columns * TILE; canvas.height = Math.ceil(ATLAS_FRAMES / columns) * TILE;
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
      const layers = LAYER_ORDER;
      const base = layers.find(family => values.includes(family));
      draw(base, 15, x, y);
      // Water draws last, so the native bank remains intact at three-way joins.
      for (const family of layers) {
        if (family === base) continue;
        const mask = maskFor(values, family);
        if (mask) draw(family, mask, x, y);
      }
    }
    if (mode === 'dreamland') {
      // Bake cropped repeats once, with no readback or per-cell canvas. Cropping
      // source and destination together avoids bleeding into adjacent atlas frames.
      for (let family = 0; family < COUNT; family++) {
        const f = source.get(family * 16 + 15);
        for (let py = 0; py < DETAIL_PHASES; py++) for (let px = 0; px < DETAIL_PHASES; px++) {
          const frame = FRAMES + family * DETAIL_PHASES ** 2 + py * DETAIL_PHASES + px;
          const ox = frame % columns * TILE, oy = Math.floor(frame / columns) * TILE;
          for (let y = 0; y < TILE;) {
            const sy = (py * TILE + y) % DETAIL_REPEAT;
            const h = Math.min(TILE - y, DETAIL_REPEAT - sy);
            for (let x = 0; x < TILE;) {
              const sx = (px * TILE + x) % DETAIL_REPEAT;
              const w = Math.min(TILE - x, DETAIL_REPEAT - sx);
              const scale = TILE / DETAIL_REPEAT;
              ctx.drawImage(f.source.image, f.cutX + sx * scale, f.cutY + sy * scale,
                w * scale, h * scale, ox + x, oy + y, w, h);
              x += w;
            }
            y += h;
          }
        }
      }
    }
    if (mode === 'dreamland') {
      // Each 32px gameplay cell contains four 16px art cells. Bake every
      // shared-vertex arrangement so walking still draws one cached frame.
      for (let code = 0; code < 512; code++) {
        const frame = GRASS_FRAMES + code;
        const ox = frame % columns * TILE, oy = Math.floor(frame / columns) * TILE;
        for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
          const bit = y * 3 + x;
          const mask = ((code >> bit) & 1) | (((code >> (bit + 1)) & 1) << 1)
            | (((code >> (bit + 3)) & 1) << 2) | (((code >> (bit + 4)) & 1) << 3);
          for (const sourceFrame of mask ? [15, 16 + mask] : [15]) {
            const f = source.get(sourceFrame);
            ctx.drawImage(f.source.image, f.cutX, f.cutY, TILE, TILE,
              ox + x * TILE / 2, oy + y * TILE / 2, TILE / 2, TILE / 2);
          }
        }
      }
    }
    const texture = scene.textures.addCanvas(KEY, canvas);
    if (typeof Phaser !== 'undefined') texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    for (let frame=0; frame<ATLAS_FRAMES; frame++) texture.add(frame, 0, frame % columns * TILE, Math.floor(frame / columns) * TILE, TILE, TILE);
    scene._raTerrainReady = true;
  }
  // The renderer supplies its already seam-correct world ring. Missing and
  // excluded vertices inherit the current ground rather than punching holes.
  function select(scene, ring, stride, index, cellX = 0, cellY = 0) {
    if (!enabled || !scene._raTerrainReady || ring[index] < 0) return null;
    const self = ring[index];
    const a=ring[index+1], b=ring[index+stride], c=ring[index+stride+1];
    let frame = self + COUNT * ((a < 0 ? self : a) + COUNT * ((b < 0 ? self : b) + COUNT * (c < 0 ? self : c)));
    if (mode === 'dreamland' && (a < 0 || a === self)
        && (b < 0 || b === self) && (c < 0 || c === self)) {
      const phase = value => ((Math.floor(value) % DETAIL_PHASES) + DETAIL_PHASES) % DETAIL_PHASES;
      frame = FRAMES + self * DETAIL_PHASES ** 2 + phase(cellY) * DETAIL_PHASES + phase(cellX);
    }
    if (mode === 'dreamland' && typeof scene._dreamlandGroundFamilyAt !== 'function'
        && self <= 1 && a >= 0 && a <= 1 && b >= 0 && b <= 1 && c >= 0 && c <= 1) {
      let code = 0;
      for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
        const corner = x % 2 === 0 && y % 2 === 0;
        const family = corner ? (y === 0 ? (x === 0 ? self : a) : (x === 0 ? b : c))
          : material(0, cellX + x / 2, cellY + y / 2);
        code |= family << (y * 3 + x);
      }
      frame = GRASS_FRAMES + code;
    }
    const values = layered ? [self, a < 0 ? self : a, b < 0 ? self : b, c < 0 ? self : c] : null;
    const audit = scene._raTerrainAudit;
    if (audit) { audit.drawnCells++; audit.materials[families[self]] = (audit.materials[families[self]] || 0) + 1; }
    if (layered) {
      const layers = layersFor(values);
      return {key:SOURCE, frame:layers[0], layers:layers.slice(1)};
    }
    return {key:KEY, frame};
  }
  function status(scene) {
    return {enabled, profile:enabled ? mode : null, ready:!!scene?._raTerrainReady, layered, atlasFrames:scene?._raTerrainReady && !layered ? ATLAS_FRAMES : 0,
      drawnCells:scene?._raTerrainAudit?.drawnCells || 0, materials:{...scene?._raTerrainAudit?.materials}};
  }
  return {enabled, layered, roadTile, families, material, maskFor, layersFor, frameFor, install, prepare, select, status};
})();
if (typeof ASSETS !== 'undefined') RATerrainTrial.install(ASSETS);
if (typeof window !== 'undefined') window.RATerrainTrial = RATerrainTrial;
