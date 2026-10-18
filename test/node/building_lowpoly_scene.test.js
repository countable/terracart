// Headless drive of src/building_lowpoly.js — the retained WebGL meshes the
// building overlay hands its footprints to under heading-up — on a stub
// scene, the way building_overlay.test.js drives the canvas overlay.
//
// Two things bit once each and are pinned here:
//   1. the overlay's per-frame offset reached into `scene._lowpoly.obj`, which
//      is module STATE ({pool, buildings, faces, …}) and has no .obj — a
//      TypeError on every WebGL frame after the first rebuild, which the
//      headless suite never saw because it did not load this module;
//   2. the meshes sat in worldContainer at depth 0 (the ground-decal lane):
//      HeadingUp._upright skips a Graphics object, so nothing sorted them,
//      and a player north of a house drew over its roof. They join the world
//      depth sort through worldPieces (render.js), by their ground anchor.
(function () {
  const ctx2d = () => ({ fillStyle: '', fillRect() {}, drawImage() {}, save() {}, restore() {}, beginPath() {},
    rect() {}, clip() {}, imageSmoothingEnabled: false, putImageData() {}, createPattern() { return {}; },
    getImageData() { throw new Error('getImageData read back during a rebuild'); } });
  function stubScene() {
    const textures = new Map();
    return {
      _headingUp: true, depth: 0, mapRot: 0.7, cellM: 5, viewCenterX: 240, viewCenterY: 240,
      startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 },
      game: { renderer: { type: 2 } }, events: { once() {} },
      worldContainer: { list: [], add(o) { this.list.push(o); } },
      buildingWallContainer: { add() {}, sort() {} },
      add: { graphics() { return { visible: true, depth: 0, type: 'Graphics', alpha: 1, x: 0, y: 0,
        setPosition(x, y) { this.x = x; this.y = y; return this; }, setDepth(d) { this.depth = d; return this; } }; } },
      textures: { exists: (k) => textures.has(k), get: (k) => textures.get(k),
        createCanvas(key, w, h) { const t = { key, w, h, _ctx: ctx2d(), getContext() { return this._ctx; },
          refresh() {}, setFilter() {}, source: [{ glTexture: {} }] }; textures.set(key, t); return t; } },
    };
  }
  const PHASER = { Textures: { FilterMode: { NEAREST: 0 } },
    GameObjects: { GetCalcMatrix: () => ({ calc: { getX: (x) => x, getY: (x, y) => y } }) },
    Renderer: { WebGL: { Utils: { getTintAppendFloatAlpha: (c) => c } } } };
  const withPhaser = (fn) => { const had = window.Phaser; window.Phaser = PHASER;
    try { return fn(); } finally { if (had === undefined) delete window.Phaser; else window.Phaser = had; } };
  const FOOT = [{ x: 100, y: 100 }, { x: 190, y: 100 }, { x: 190, y: 160 }, { x: 140, y: 160 }, { x: 140, y: 200 }, { x: 100, y: 200 }];
  const build = (scene, key, dx = 0) => {
    const role = Object.keys(BuildingLowPoly.ROLES)[0];
    const recipe = BuildingLowPoly.recipeFor(role, { wall: 0xd4cdb4, roof: 0x709b9a, trim: 0x614534 });
    return BuildingLowPoly.add(scene, FOOT.map((p) => ({ x: p.x + dx, y: p.y })), recipe, recipe.variant || 'ridge', key);
  };

  test('low-poly buildings: the overlay offsets the meshes through BuildingLowPoly.offset, never module state', () => withPhaser(() => {
    const scene = stubScene();
    assert.truthy(BuildingLowPoly.active(scene), 'heading-up on a WebGL renderer');
    const state = BuildingLowPoly.begin(scene);
    assert.falsy('obj' in state, 'scene._lowpoly is the module state, not a mesh');
    const mesh = build(scene, 'house:1');
    assert.truthy(mesh.faces.length > 0, 'the footprint became faces');
    BuildingLowPoly.offset(scene, 3, 4);       // what BuildingOverlay.draw calls on every frame
    BuildingLowPoly.update(scene);
    assert.eq(state.offsetX, 3, 'the sub-cell offset is carried in state');
    assert.truthy(state.faces.every((f) => [f.light].every(Number.isFinite)), 'no NaN light');
    assert.falsy(/_lowpoly\.obj\b/.test(BUILDING_OVERLAY_SRC),
      'the overlay never reads scene._lowpoly.obj (a TypeError every WebGL frame once)');
    assert.truthy(/if \(scene\._lowpoly\) BuildingLowPoly\.offset\(scene, -offset\.fracX \* CELL_PX, -offset\.fracY \* CELL_PX\);/.test(BUILDING_OVERLAY_SRC),
      'it hands the fractional cell offset to the module');
  }));

  test('low-poly buildings: every mesh joins the world depth sort by its ground anchor', () => withPhaser(() => {
    const scene = stubScene();
    BuildingLowPoly.begin(scene);
    const a = build(scene, 'house:a'), b = build(scene, 'house:b', 300);
    const pieces = BuildingLowPoly.worldPieces(scene);
    assert.eq(pieces.length, 2, 'one piece per building');
    assert.eq(pieces[0].sprite, a.obj, 'the piece IS the mesh object the sorter sets depth on');
    assert.eq(pieces[1].sprite, b.obj);
    assert.truthy(pieces.every((p) => Number.isFinite(p.groundY) && p.rank === 1), 'a finite ground Y at prop rank');
    assert.truthy(a.obj._worldGeometry && a.obj._huAnchor, 'marked world geometry (HeadingUp leaves it) with its own anchor');
    assert.truthy(scene.worldContainer.list.includes(a.obj), 'in the world container the sorter orders');
    assert.truthy(/const zList = typeof BuildingLowPoly !== 'undefined' \? BuildingLowPoly\.worldPieces\(scene\) : \[\];/.test(RENDER_SRC),
      'drawObjects seeds its depth list with the meshes');
    BuildingLowPoly.clear(scene);
    assert.eq(BuildingLowPoly.worldPieces(scene).length, 0, 'a cleared pass contributes nothing');
    assert.falsy(a.obj.visible, 'and hides the pooled objects');
  }));
  test('low-poly buildings: opacity updates without rotating or rebuilding the mesh', () => withPhaser(() => {
    const scene=stubScene();scene.mapRot=0;scene.save={};
    scene.playerScreen=()=>({x:120,y:140});
    scene.player={visible:true,x:120,y:140,displayWidth:16,displayHeight:24,originX:.5,originY:1};
    BuildingLowPoly.begin(scene);const mesh=build(scene,'other');
    BuildingLowPoly.update(scene);assert.eq(mesh.obj.alpha,.5,'inside the footprint');
    const faces=mesh.faces;
    scene.playerScreen=()=>({x:400,y:400});scene.player.x=400;scene.player.y=400;
    BuildingLowPoly.update(scene);assert.eq(mesh.obj.alpha,1,'outside again at the same heading');
    assert.eq(mesh.faces,faces,'retained geometry is reused');
  }));
  test('low-poly wrecks: rubble is low, opaque and sorted below the player', () => withPhaser(() => {
    const scene=stubScene();BuildingLowPoly.begin(scene);
    const recipe=BuildingLowPoly.recipeFor('wreck',{wall:0x777777,roof:0x555555,trim:0x333333});
    const mesh=BuildingLowPoly.add(scene,FOOT,recipe,'ridge','wreck');
    assert.truthy(mesh.faces.length,'rubble material remains');
    // Check the broken walls themselves; surviving roof patches can stand higher.
    const top=Math.max(...mesh.faces.filter(f=>f.wallTop).flatMap(f=>f.points.map(p=>p.z)));
    assert.truthy(top>1&&top<14,'wall stubs and roof patches stay under a storey: '+top);
    assert.truthy(new Set(mesh.faces.filter(f=>f.wallTop).map(f=>f.points[0].z.toFixed(1))).size>1,'stub heights vary');
    const [piece]=BuildingLowPoly.worldPieces(scene);
    assert.eq(piece.layer,WorldLayers.GROUND_DECAL,'player always draws above the wreck');
    assert.eq(mesh.obj.alpha,1,'wreck never fades');
  }));
  test('low-poly wrecks: intermediate height breaks are perpendicular to their walls', () => withPhaser(() => {
    const scene=stubScene();BuildingLowPoly.begin(scene);
    const recipe=BuildingLowPoly.recipeFor('wreck',{wall:0x777777,roof:0x555555,trim:0x333333});
    const mesh=BuildingLowPoly.add(scene,FOOT,recipe,'ridge','square-breaks');
    const ring=FOOT.map(p=>({x:p.x-mesh.x,y:p.y-mesh.y}));
    let checked=0;
    for(const face of mesh.faces.filter(f=>f.wallTop)){
      const [a,b,c]=face.points;
      // First triangle of a top quad has two outer points and one inner point.
      if(Math.abs(a.x-b.x)<1e-8&&Math.abs(a.y-b.y)<1e-8)continue;
      const onEdge=ring.find((p,i)=>{
        const q=ring[(i+1)%ring.length],cross=r=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
        return Math.abs(cross(a))<1e-6&&Math.abs(cross(b))<1e-6;
      });
      if(!onEdge)continue;
      if(ring.some(p=>Math.hypot(p.x-b.x,p.y-b.y)<1e-6))continue;
      assert.truthy(Math.abs((b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y))<1e-6,
        'the cut across wall thickness is perpendicular to its length');
      checked++;
    }
    assert.gt(checked,0,'checked interior wall breaks');
  }));
})();
