// Source-exact Fantasy Dreamland Reborn ground for generated geographic geometry.
// Prototype: browser-route in place of ra_terrain_trial.js; no grid rewrite. This optional
// presentation never writes grid, occupancy, source polygons, objects or saves.
const RATerrainTrial = (() => {
  const enabled = new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('artTrial') === 'dreamland';
  const families = Object.freeze(['villageGrass', 'forestGrass', 'oliveSoil', 'darkSoil', 'water', 'sand', 'stone']);
  const SOURCE = 'dreamland_terrain_source', KEY = 'dreamland_terrain_composite';
  const COUNT = families.length, FRAMES = COUNT ** 4;
  const TYPES = Object.freeze({0:0, 1:1, 2:5, 3:4, 4:2, 5:0, 6:0, 15:6, 16:6, 17:6, 18:0, 19:0, 20:3, 21:0, 22:1, 23:4});
  const roadCanvases = {};
  // Called by the existing vector road painter, retaining its widths, clipping,
  // source polygons and world phase. Hazard/zone variants keep normal artwork.
  function roadTile(variant, restored) {
    return enabled && (!variant || ['plain','default','lantern','golden','golden_path','orchard','promenade'].includes(variant)) ? roadCanvases[restored ? 1 : 0] || null : null;
  }
  function material(type) { return TYPES[type] ?? -1; }
  function maskFor(values, family) {
    let mask = 0;
    for (let i = 0; i < 4; i++) if (values[i] === family) mask |= 1 << i;
    return mask;
  }
  function frameFor(values) { return values[0] + COUNT * (values[1] + COUNT * (values[2] + COUNT * values[3])); }
  function install(assets) {
    if (enabled) {
      assets.dreamland_path_source = {kind:'image',path:'tools/dreamland-square-study/assets/path.png'};
      assets.dreamland_path_restored_source = {kind:'image',path:'tools/dreamland-square-study/assets/path-restored.png'};
    }
    if (enabled) assets[SOURCE] = {kind:'spritesheet', path:'tools/dreamland-square-study/assets/terrain.png', frameWidth:16, frameHeight:16};
  }
  function prepare(scene) {
    if (!enabled) return;
    if (!scene.textures.exists(KEY)) {
      const canvas=document.createElement('canvas'),columns=Math.ceil(Math.sqrt(FRAMES));
      canvas.width=columns*16;canvas.height=Math.ceil(FRAMES/columns)*16;
      const ctx=canvas.getContext('2d'),source=scene.textures.get(SOURCE);
      ctx.imageSmoothingEnabled=false;
      const draw=(family,mask,x,y)=>{const f=source.get(family*16+mask);ctx.drawImage(f.source.image,f.cutX,f.cutY,16,16,x,y,16,16);};
      const values=[0,0,0,0];
      for(let frame=0;frame<FRAMES;frame++) {
        let code=frame;
        for(let i=0;i<4;i++){values[i]=code%COUNT;code=Math.floor(code/COUNT);}
        const x=frame%columns*16,y=Math.floor(frame/columns)*16;
        draw(0,15,x,y);
        for(const family of [1,2,3,5,6,4]){const mask=maskFor(values,family);if(mask)draw(family,mask,x,y);}
      }
      const texture=scene.textures.addCanvas(KEY,canvas);
      for(let frame=0;frame<FRAMES;frame++)texture.add(frame,0,frame%columns*16,Math.floor(frame/columns)*16,16,16);
    }
    scene._raTerrainReady=true;
    for(const [condition,key] of [[0,'dreamland_path_source'],[1,'dreamland_path_restored_source']]) {
      if(roadCanvases[condition])continue;
      const path=scene.textures.get(key).getSourceImage();
      const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
      const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
      ctx.drawImage(path,0,0,128,128);roadCanvases[condition]=canvas;
    }
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
    return {enabled, ready:!!scene?._raTerrainReady, atlasFrames:scene?._raTerrainReady ? FRAMES : 0,
      drawnCells:scene?._raTerrainAudit?.drawnCells || 0, materials:{...scene?._raTerrainAudit?.materials}};
  }
  return {enabled, families, material, maskFor, frameFor, install, prepare, select, status, roadTile};
})();
if (typeof ASSETS !== 'undefined') RATerrainTrial.install(ASSETS);
if (typeof window !== 'undefined') window.RATerrainTrial = RATerrainTrial;
