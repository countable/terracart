// Browser-only capture harness. Load with page.add_script_tag({path:...}) after
// the sandbox installs, then await setupSandboxCapture(). No saved state writes.
window.setupSandboxCapture = async function setupSandboxCapture(options = {}) {
  const scene = __game.scene.getScene('map');
  if (!scene?._sandboxMode) throw new Error('Load index.html?sandbox=true first');
  const source = await fetch('src/sandbox.js',{cache:'no-store'}).then(r=>r.text());
  const hook = 'global.Sandbox = { detect, install };';
  if (!source.includes(hook)) throw new Error('Sandbox layout export hook changed');
  // Expose the existing authored layout, without invoking install a second time.
  (0,eval)(source.replace(hook,'global.SandboxCaptureLayout = LAYOUT;'));
  window.__renderScaleCap = 1;
  window.__onGameScaleChange?.();
  scene.scene.pause();
  scene.anims?.pauseAll?.();
  __game.anims?.pauseAll?.();
  scene.tweens?.pauseAll?.();
  scene.time.timeScale=0;
  const now = Date.now(), perf = performance.now();
  Date.now = () => now;
  Object.defineProperty(performance,'now',{configurable:true,value:()=>perf});
  scene.peekM = {x:0,y:0};
  document.querySelectorAll('#bootload,#story,#safety-card').forEach(e=>e.remove());
  const layout = SandboxCaptureLayout;
  const margin = options.marginCells == null ? 2 : Math.max(0,Math.floor(options.marginCells));
  const pc = scene.playerToWorldCell();
  const entry = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx,pc.ty));
  // Sandbox has no vector footprints. Use the game's existing tiled-building
  // mode so its authored floor/wall cells remain visible on both comparisons.
  if (!entry.buildingShapes?.length && options.tileBuildings !== false) BuildingOverlay.setEnabled(scene,false);
  const n = entry.cellsPerEdge;
  const cellM = entry.tileEdgeM/n;
  const ox = Math.floor((n-layout.width)/2), oy = Math.floor((n-layout.height)/2);
  const origin = {x:pc.tx*entry.tileEdgeM+ox*cellM,y:pc.ty*entry.tileEdgeM+oy*cellM};
  const labels = scene._sandboxLabelData.map(d=>({name:d.t.text,x:(d.wx-origin.x)/cellM-.5,y:(d.wy-origin.y)/cellM-.5}));
  // Phaser updates are paused: actors keep their captured positions and poses.
  const hidden = ['fogContainer','lightMap','atmosGroundGfx','atmosRimGfx','reachGfx','auraContainer','fxContainer','sparkContainer','labelContainer','letterContainer','_sandboxLabels','ghostGlowContainer','tierGfx','enemyHealthGfx','_workProgressGfx','player','playerShadow','playerHalo','gpsGhost','blightAura','facingGfx','projGfx','swordSwingGfx','boltContainer'];
  function hide() {
    for (const key of hidden) {
      const obj = scene[key];
      obj?.setVisible?.(false);
      obj?.image?.setVisible?.(false);
    }
    if (options.hideCreatures) {scene.creaturesContainer?.setVisible(false);scene.creatureShadowPool?.forEach(s=>s.setVisible(false));}
    scene.plantedTimerPool?.forEach(t=>t.setVisible(false));
  }
  function draw(x,y) {
    const wx=origin.x+(x+.5)*cellM, wy=origin.y+(y+.5)*cellM;
    scene.playerM.x=wx-scene.startWorldM.x; scene.playerM.y=wy-scene.startWorldM.y;
    scene.peekM.x=scene.peekM.y=0;
    // Force each cached pass to accept palette/texture changes on a paired redraw.
    scene._lastBorderIX=NaN; scene._lastBorderIY=NaN; scene._buildingGeomKey=null; scene._roadGeomKey=null;
    scene.drawCells(); scene.drawRoadGeometry(); scene.drawBuildingGeometry(); scene.drawObjects();
    hide();
    return {x,y,worldX:wx,worldY:wy};
  }
  function clip() {
    const box=__game.canvas.getBoundingClientRect();
    const scale=box.width/352;
    return {x:box.x+scene.viewLeft*scale,y:box.y+scene.viewTop*scale,width:scene.viewSize*scale,height:scene.viewSize*scale};
  }
  async function snapshot(x,y) {
    draw(x,y);
    return new Promise(resolve=>{
      const scale=__game.canvas.width/352;
      __game.renderer.snapshotArea(Math.round(scene.viewLeft*scale),Math.round(scene.viewTop*scale),Math.round(scene.viewSize*scale),Math.round(scene.viewSize*scale),image=>resolve(image.src),'image/png');
    });
  }
  async function snapshotPatch(x,y,width=Math.min(8,layout.width+margin-x),height=Math.min(8,layout.height+margin-y)) {
    draw(x+3.5,y+3.5);
    return new Promise(resolve=>{
      const scale=__game.canvas.width/352;
      __game.renderer.snapshotArea(Math.round((scene.viewLeft+48)*scale),Math.round((scene.viewTop+48)*scale),Math.round(width*32*scale),Math.round(height*32*scale),image=>resolve(image.src),'image/png');
    });
  }
  async function mosaic() {
    const output=document.createElement('canvas');output.width=(layout.width+2*margin)*32;output.height=(layout.height+2*margin)*32;
    const ctx=output.getContext('2d');ctx.imageSmoothingEnabled=false;
    for(let y=-margin;y<layout.height+margin;y+=8) for(let x=-margin;x<layout.width+margin;x+=8) {
      const url=await snapshotPatch(x,y), im=new Image();im.src=url;await im.decode();ctx.drawImage(im,(x+margin)*32,(y+margin)*32);
    }
    return output.toDataURL('image/png');
  }
  const scenes=layout.scenes.map(s=>({name:s.name,label:s.label,x:s.lx,y:s.ly,width:s.w,height:s.h,centerX:s.lx+Math.floor(s.w/2),centerY:s.ly+Math.floor(s.h/2)}));
  const info={width:layout.width,height:layout.height,cellM,origin,scenes,labels,windowCells:11,marginCells:margin,imageWidth:(layout.width+2*margin)*32,imageHeight:(layout.height+2*margin)*32,fullbright:true,frozenDate:now,frozenAnimationMs:perf,hasVectorRoads:!!entry.layers?.transportation?.length,hasBuildingPolygons:!!entry.buildingShapes?.length};
  window.sandboxCapture={scene,info,draw,clip,snapshot,snapshotPatch,mosaic};
  hide();
  return info;
};
