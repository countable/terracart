// Appended inside export_map_art_painters.js's closure: all painters below are
// the original runtime functions. This file only supplies sample inputs and
// tiny Phaser texture adapters; it does not reimplement their drawing styles.
const MapArtProcedural = (() => {
  function canvas(w, h = w) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function textureScene() {
    const textures = new Map();
    return {
      textures: {
        exists: key => textures.has(key),
        get: key => ({getSourceImage: () => textures.get(key)}),
        remove: key => textures.delete(key),
        createCanvas(key, w, h) {
          const c = canvas(w, h);
          textures.set(key, c);
          return { getContext: () => c.getContext('2d'), refresh() {} };
        },
      },
      result: key => textures.get(key),
    };
  }
  function building(spec) {
    const scene = textureScene();
    const tier = spec.tier || 9;
    const tile = scene.textures.createCanvas(`biome${tier}_0`, 32, 32);
    BIOME_TEX[tier].draw(tile.getContext(),32,seededRand((tier+1)*1000+1));
    Object.assign(scene, {
      viewSize:128,viewLeft:0,viewTop:0,
      buildingGeomContainer:{add() {}},
      add:{image() { return {setOrigin() {return this;}}; }},
      isClaimedKey:() => !spec.unclaimed,
    });
    const ring = new Float32Array([8,8,104,8,104,72,72,72,72,104,8,104]);
    window.BuildingOverlay.rebuild(scene,[{tx:0,ty:0,entry:{tileEdgeM:256,buildingShapes:[{ring,tier,key:'map-art-audit'}]}}],0,0);
    const output = canvas(128);
    // The runtime overlay includes its 64px camera-culling padding.
    output.getContext('2d').drawImage(scene.result('buildinggeom_overlay'),64,64,128,128,0,0,128,128);
    return output;
  }
  function biome(spec) {
    const size = spec.size || 32;
    const output = canvas(size), layer = canvas(size);
    const id = Number(spec.terrainId);
    const tex = BIOME_TEX[id];
    if (!tex || id === 30) throw new Error('Not an audited map terrain: ' + id);
    const cx = output.getContext('2d');
    cx.fillStyle = spec.color || cssOf(COLORS[id]);
    cx.fillRect(0, 0, size, size);
    tex.draw(layer.getContext('2d'), size, seededRand((id + 1) * 1000 + (spec.variant || 0) + 1), spec.phase || 0);
    cx.drawImage(layer, 0, 0);
    return output;
  }
  function road(spec) {
    const r = window.MapArtRoadPasses;
    const size = spec.size || 96;
    const out = canvas(size), layer = canvas(size);
    const cx = layer.getContext('2d');
    cx.lineCap = cx.lineJoin = 'round';
    const rail = spec.style === 'rail', path = spec.style === 'path';
    const restored = !!spec.restored && !rail;
    const color = spec.color || (rail ? r.RAIL_COLOR : restored
      ? (path ? r.RESTORED_PATH_COLOR : r.RESTORED_ROAD_COLOR)
      : (path ? r.PATH_COLOR : r.ROAD_COLOR));
    const pts = [{x:-10,y:size * .72},{x:size * .42,y:size * .49},{x:size+10,y:size * .35}];
    const pass = {
      ctx:cx, tex:{ refresh() {} }, size, pats:{}, phaseX:0, phaseY:0,
      ops:[{ w:rail ? 20 : path ? 20 : 36, c:color, pts:pts.flatMap(p => [p.x,p.y]) }],
      decorOps:[], erases:[],
    };
    if (rail) r.emitRailDecor({cellM:7}, {decorPath(w,c,points) { pass.decorOps.push({w,c,pts:points}); }}, pts);
    (restored ? r.commitRestored : r.commitBase)(pass);
    const ox = out.getContext('2d');
    ox.fillStyle = spec.background || '#596338';
    ox.fillRect(0,0,size,size);
    ox.globalAlpha = restored ? r.RESTORED_ALPHA : r.ALPHA;
    ox.drawImage(layer,0,0);
    return out;
  }
  function render(spec) {
    if (spec.kind === 'treasure') {
      // The two snapped 2px strokes in Render.drawCells/drawX; no new art.
      const c = canvas(14), ctx = c.getContext('2d'), s = 5.1, mid = 7;
      ctx.strokeStyle = spec.cave ? '#c9b48a' : '#2a1d10';
      ctx.globalAlpha = spec.cave ? 0.6 : 0.55;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(Math.round(mid-s), Math.round(mid-s));
      ctx.lineTo(Math.round(mid+s), Math.round(mid+s));
      ctx.moveTo(Math.round(mid+s), Math.round(mid-s));
      ctx.lineTo(Math.round(mid-s), Math.round(mid+s));
      ctx.stroke();
      return c;
    }
    if (spec.kind === 'biome') return biome(spec);
    if (spec.kind === 'road') return road(spec);
    if (spec.kind === 'building') return building(spec);
    if (spec.kind === 'tilled') {
      const c = canvas(spec.size || 32);
      drawTilledTex(c.getContext('2d'), c.width, seededRand(7919 + (spec.variant || 0)));
      return c;
    }
    if (spec.kind === 'lamp') {
      const c = canvas(window.RoadOverlay.LAMP_TEX_PX);
      window.RoadOverlay.paintLamp(c.getContext('2d'), c.width, spec.glow);
      return c;
    }
    const scene = textureScene();
    if (spec.kind === 'tower') {
      makeTowerTexture(scene, spec.unclaimed ? CASTLE_STONE_UNCLAIMED : CASTLE_STONE, 'sample');
      return scene.result('sample');
    }
    if (spec.kind === 'pad') {
      makeRoundPadTexture(scene, 'sample');
      return scene.result('sample');
    }
    if (spec.kind === 'potofgold') {
      makePotOfGoldTexture(scene);
      return scene.result('potofgold');
    }
    if (spec.kind === 'trap') {
      if (spec.sprung) makeSprungTrapTexture(scene); else makeHiddenTrapTexture(scene);
      return scene.result(spec.sprung ? 'trap_open' : 'trap_hidden');
    }
    throw new Error('Unknown map-art painter: ' + spec.kind);
  }
  return { render, biome, road, building };
})();
global.MapArtProcedural = MapArtProcedural;
