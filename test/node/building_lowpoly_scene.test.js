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
  test('low-poly wrecks: camera subtraction noise reuses the mesh but real footprint and road edits invalidate it', () => {
    const ring = [{x:0,y:0},{x:72,y:0},{x:72,y:64},{x:0,y:64}];
    const streets = [[{x:-40,y:90},{x:110,y:90}]];
    const recipe = BuildingLowPoly.recipeFor('wreck', {wall:0x777777,roof:0x555555,trim:0x333333});
    const first = BuildingLowPoly.specialGeometry(ring, recipe, streets, 'walking-cache');
    const jitter = p => ({x:p.x + 1e-8,y:p.y + 1e-8});
    assert.eq(BuildingLowPoly.specialGeometry(ring.map(jitter), recipe, streets.map(line=>line.map(jitter)), 'walking-cache'), first,
      'camera-origin floating-point noise must not retriangulate an unchanged wreck');
    assert.truthy(BuildingLowPoly.specialGeometry(ring.map(p=>({x:p.x*1.2,y:p.y})), recipe, streets, 'walking-cache') !== first,
      'a changed footprint needs its own mesh');
    assert.truthy(BuildingLowPoly.specialGeometry(ring, recipe, [[{x:-40,y:-30},{x:110,y:-30}]], 'walking-cache') !== first,
      'a changed street changes the opening');
  });
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
        createCanvas(key, w, h) { const t = { key, w, h, getSourceImage() { return { width: w, height: h }; }, _ctx: ctx2d(), getContext() { return this._ctx; },
          refresh() {}, setFilter() {}, source: [{ glTexture: {} }] }; textures.set(key, t); return t; } },
    };
  }
  const PHASER = { Textures: { FilterMode: { NEAREST: 0 } },
    GameObjects: { GetCalcMatrix: () => ({ calc: { getX: (x) => x, getY: (x, y) => y } }) },
    Renderer: { WebGL: { Utils: { getTintAppendFloatAlpha: (c) => c } } } };
  const withPhaser = (fn) => { const had = window.Phaser; window.Phaser = PHASER;
    try { return fn(); } finally { if (had === undefined) delete window.Phaser; else window.Phaser = had; } };
  const FOOT = [{ x: 100, y: 100 }, { x: 190, y: 100 }, { x: 190, y: 160 }, { x: 140, y: 160 }, { x: 140, y: 200 }, { x: 100, y: 200 }];
  test('low-poly fort: source shell retains its central inset and one mounted dice board', () => withPhaser(() => {
    const scene=stubScene(),texture=scene.textures.createCanvas('fort-source',512,1024);
    const spec=AuthoredBuildings.SPECS.city_storefront,unit=16/spec.door[3];
    const model={authoredKey:'city_storefront',texture,faces:CityBuildings.build({texture},spec,'city_storefront')};
    for(const f of model.faces)for(const p of f.points){p.x*=unit;p.y*=unit;p.z*=unit;}
    const saved={build:AuthoredBuildings.build,skin:AuthoredBuildings.skin,getEmblem:AuthoredRoofPalette.getEmblem};
    const emblem={sign:texture,signUV:[0,.1,.1,.2],signSideUV:[.3,.3]};
    const ring=[{x:100,y:100},{x:220,y:100},{x:220,y:200},{x:100,y:200}];
    try {
      AuthoredBuildings.build=()=>model;
      AuthoredBuildings.skin=()=>{throw Error('fort must retain its whole central shell');};
      AuthoredRoofPalette.getEmblem=()=>emblem;
      BuildingLowPoly.begin(scene);
      const recipe=BuildingLowPoly.recipeFor('fort');recipe.authored=AuthoredBuildings.recipeFor('fort','fort');
      const placed=BuildingLowPoly.add(scene,ring,recipe,null,'fort');
      const expected=BuildingLowPoly.authoredGeometry(model,ring.map(p=>({x:p.x-100,y:p.y-100})),.65,null,emblem);
      assert.eq(placed.height,expected.height,'sourceShell preserves the fort .65 fit margin');
      assert.eq(placed.mountedSign,true,'overlay can suppress its extra label');
      assert.eq(placed.faces.filter(f=>f.feature==='fort-sign').length,2,'one board remains on the native shell');
    } finally {
      AuthoredBuildings.build=saved.build;AuthoredBuildings.skin=saved.skin;AuthoredRoofPalette.getEmblem=saved.getEmblem;
    }
  }));
  test('Dreamland wrecks: native materials keep damaged geometry and never allocate during rebuild', () => withPhaser(() => {
    const scene=stubScene(),plain=BuildingLowPoly.recipeFor('wreck'),recipe={...plain,artProfile:'dreamland'};
    for(const key of ['dreamland_wreck_material','dreamland_wreck_interior']) scene.textures.createCanvas(key,512,512);
    scene.textures.createCanvas=()=>{throw Error('Dreamland wreck attempted a runtime material bake');};
    const local=FOOT.map(p=>({x:p.x-100,y:p.y-100}));
    const normal=BuildingLowPoly.specialGeometry(local,plain,[],'dreamland-wreck');
    const native=BuildingLowPoly.specialGeometry(local,recipe,[],'dreamland-wreck');
    assert.truthy(native!==normal,'profile palette must not reuse baseline-colored geometry');
    assert.eq(JSON.stringify(native.faces.map(f=>f.points)),JSON.stringify(normal.faces.map(f=>f.points)),'same footprint and collapse geometry');
    assert.eq(BuildingLowPoly.specialGeometry(local,plain,[],'dreamland-wreck'),normal,'Dreamland does not contaminate baseline cache');
    BuildingLowPoly.begin(scene);
    const mesh=BuildingLowPoly.add(scene,FOOT,recipe,'ridge','dreamland-wreck');
    assert.truthy(mesh.faces.some(f=>f.texture.key==='dreamland_wreck_material'),'masonry atlas selected');
    assert.truthy(mesh.faces.some(f=>f.texture.key==='dreamland_wreck_interior'),'interior masonry / rubble atlas selected');
    assert.truthy(mesh.faces.every(f=>f.texture.key.startsWith('dreamland_wreck_')),'no legacy material leak');
    assert.falsy(mesh.faces.some(f=>f.standingRoof||f.fallenRoof||f.rafter||f.beam||f.steel),'native profile keeps the roofless broken plinth');
    assert.truthy(mesh.faces.some(f=>f.rubbleTop&&f.rawUV&&f.color===0xffffff),'debris samples native masonry without a tint');
  }));
  test('Rogue wrecks: prewarmed study sheets preserve collapse geometry and allocate nothing on rebuild', () => withPhaser(() => {
    const scene=stubScene(),plain=BuildingLowPoly.recipeFor('wreck'),recipe={...plain,artProfile:'rogue'};
    BuildingLowPoly.prepareRogueWreck(scene);
    const material=scene.textures.get('rogue_wreck_material'),interior=scene.textures.get('rogue_wreck_interior');
    assert.truthy(material&&interior,'both profile sheets prewarmed');
    assert.eq(material.getContext().filter,'none','filter reset after bake');
    scene.textures.createCanvas=()=>{throw Error('Rogue wreck attempted a runtime material bake');};
    BuildingLowPoly.prepareRogueWreck(scene);
    assert.eq(scene.textures.get('rogue_wreck_material'),material,'prewarm is idempotent');
    const local=FOOT.map(p=>({x:p.x-100,y:p.y-100}));
    const baseline=BuildingLowPoly.specialGeometry(local,plain,[],'rogue-wreck');
    const native=BuildingLowPoly.specialGeometry(local,recipe,[],'rogue-wreck');
    assert.eq(JSON.stringify(native.faces.map(f=>f.points)),JSON.stringify(baseline.faces.map(f=>f.points)),'same collapse geometry');
    assert.truthy(native!==baseline,'palette cache isolated');
    BuildingLowPoly.begin(scene);
    const mesh=BuildingLowPoly.add(scene,FOOT,recipe,'ridge','rogue-wreck');
    assert.truthy(mesh.faces.every(f=>f.texture.key.startsWith('rogue_wreck_')),'all surfaces use RA adapted sheets');
    assert.truthy(mesh.faces.some(f=>f.rubbleTop&&f.rawUV&&f.color===0xffffff),'rubble samples its prewarmed masonry sheet');
  }));
  test('low-poly buildings: distant road filtering preserves full-network door choice, including crossing segments', () => withPhaser(() => {
    const scene=stubScene(),recipe=BuildingLowPoly.recipeFor('wreck',{wall:0x777777,roof:0x555555,trim:0x333333});
    const far=Array.from({length:100},(_,i)=>[{x:3000+i,y:3000},{x:4000+i,y:4000}]);
    for(const near of [
      [[{x:90,y:80},{x:220,y:80}]],
      [[{x:-10000,y:80},{x:10000,y:80}]],
      [[{x:220,y:-10000},{x:220,y:10000}]],
    ]) {
      const streets=[...far,...near],local=FOOT.map(p=>({x:p.x-100,y:p.y-100}));
      const full=BuildingLowPoly.specialGeometry(local,recipe,streets.map(line=>line.map(p=>({x:p.x-100,y:p.y-100}))),'door-filter');
      BuildingLowPoly.begin(scene);
      const actual=BuildingLowPoly.add(scene,FOOT,recipe,'ridge','door-filter',streets);
      assert.truthy(full.doorway,'fixture has a reachable street-facing opening');
      assert.eq(JSON.stringify(actual.doorway),JSON.stringify(full.doorway),'same opening as searching every road');
    }
  }));
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

  test('low-poly wrecks: standalone viewers draw rubble ground below every raised section', () => withPhaser(() => {
    const scene = stubScene();
    delete scene.worldContainer;
    scene.buildingWallContainer = {
      list: [],
      add(object) { this.list.push(object); },
      sort(key) { this.list.sort((a, b) => a[key] - b[key]); },
    };
    BuildingLowPoly.begin(scene);
    BuildingLowPoly.add(scene, FOOT, BuildingLowPoly.recipeFor('wreck'), 'ridge', 'standalone-plinth');
    const meshes = scene._lowpoly.buildings;
    const floors = meshes.filter(mesh => mesh.ground), raised = meshes.filter(mesh => !mesh.ground);
    assert.gt(floors.length, 0, 'the fixture has rubble ground');
    assert.gt(raised.length, 0, 'the fixture has raised plinth sections');
    for (const angle of [0, .7, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      scene.mapRot = angle;
      BuildingLowPoly.update(scene);
      for (const floor of floors) for (const section of raised) {
        assert.lt(floor.obj.depth, section.obj.depth, 'ground precedes every raised section at heading ' + angle);
        assert.lt(scene.buildingWallContainer.list.indexOf(floor.obj),
          scene.buildingWallContainer.list.indexOf(section.obj), 'the standalone container paints ground first');
      }
    }
  }));
  test('low-poly wrecks: north-up WebGL retains visible walls and rubble through compass changes', () => withPhaser(() => {
    const scene=stubScene();scene._headingUp=false;scene.mapRot=0;
    assert.truthy(BuildingLowPoly.active(scene),'north-up uses the same WebGL buildings');
    BuildingLowPoly.begin(scene);
    const recipe=BuildingLowPoly.recipeFor('wreck',{wall:0x777777,roof:0x555555,trim:0x333333});
    const mesh=BuildingLowPoly.add(scene,FOOT,recipe,'ridge','north-up-wreck');
    for(const headingUp of [false,true,false]){
      scene._headingUp=headingUp;scene.mapRot=headingUp?.7:0;
      BuildingLowPoly.update(scene);
      assert.truthy(mesh.obj.visible,'wreck remains visible in either compass mode');
      assert.truthy(scene._lowpoly.buildings.some(part=>part.visibleTriangles?.length),'visible projected geometry across the wall pieces');
      const pieces=BuildingLowPoly.worldPieces(scene);
      assert.gt(pieces.length,1,'wreck walls and floor join world sorting separately');
      assert.truthy(pieces.some(p=>p.layer===WorldLayers.GROUND_DECAL),'ground rubble stays beneath standing objects');
      assert.truthy(pieces.some(p=>p.layer===WorldLayers.STANDING_PROP),'low walls retain their own depth anchors');
      assert.truthy(BuildingLowPoly.covers(scene,{id:'north-up-wreck'}),'legacy art stays suppressed');
    }
    scene.depth=1;BuildingLowPoly.update(scene);
    assert.falsy(mesh.obj.visible,'surface wreck stays hidden underground');
    scene.game.renderer.type=1;
    assert.falsy(BuildingLowPoly.active(scene),'Canvas still uses its fallback');
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
  test('low-poly wrecks: broken walls are low, opaque and join standing scenery depth sorting', () => withPhaser(() => {
    const scene=stubScene();BuildingLowPoly.begin(scene);
    const recipe=BuildingLowPoly.recipeFor('wreck',{wall:0x777777,roof:0x555555,trim:0x333333});
    const mesh=BuildingLowPoly.add(scene,FOOT,recipe,'ridge','wreck');
    assert.truthy(mesh.faces.length,'rubble material remains');
    assert.truthy(mesh.faces.some(f=>f.footprintBorder&&f.debris&&f.solid&&f.color===0x3c352b),
      'ground border survives atlas conversion with its dark tint');
    const top=Math.max(...mesh.faces.flatMap(f=>f.points.map(p=>p.z)));
    assert.inRange(top,10,14,'every wall and rubble piece stays within the low plinth height');
    assert.falsy(mesh.faces.some(f=>f.standingRoof||f.fallenRoof||f.rafter||f.beam||f.steel),'no roof or metal framing remains');
    assert.truthy(new Set(mesh.faces.filter(f=>f.wallTop).map(f=>f.points[0].z.toFixed(1))).size>1,'stub heights vary');
    const pieces=BuildingLowPoly.worldPieces(scene);
    assert.gt(pieces.filter(p=>p.layer===WorldLayers.STANDING_PROP).length,1,'wall sections have independent standing anchors');
    assert.truthy(pieces.every(p=>p.sprite.alpha===1),'wreck pieces never fade');
  }));
  test('low-poly wrecks: a player inside sorts above the floor and between far and near walls', () => withPhaser(() => {
    const scene=stubScene();BuildingLowPoly.begin(scene);
    const recipe=BuildingLowPoly.recipeFor('wreck',{wall:0x777777,roof:0x555555,trim:0x333333});
    BuildingLowPoly.add(scene,FOOT,recipe,'ridge','wreck-player-depth');
    for(const heading of [0,Math.PI/2,Math.PI,Math.PI*1.5]){
      scene.mapRot=heading;
      const pieces=BuildingLowPoly.worldPieces(scene);
      const walls=pieces.filter(p=>p.layer===WorldLayers.STANDING_PROP).sort((a,b)=>a.groundY-b.groundY);
      assert.gt(walls.length,1,'separate wall anchors');
      const rear=walls[0],front=walls.at(-1);
      assert.gt(front.groundY-rear.groundY,.1,'near and far walls have distinct ground depths');
      const player={depth:0,setDepth(d){this.depth=d;}};
      Render.sortWorldDepth([...pieces,{sprite:player,groundY:(rear.groundY+front.groundY)/2,rank:1,layer:WorldLayers.STANDING_PROP}]);
      assert.lt(rear.sprite.depth,player.depth,'far wall stays behind the player at heading '+heading);
      assert.lt(player.depth,front.sprite.depth,'near wall covers the player at heading '+heading);
      const floor=pieces.filter(p=>p.layer===WorldLayers.GROUND_DECAL);
      assert.gt(floor.length,0,'rubble floor participates in world sorting');
      assert.truthy(floor.every(p=>p.sprite.depth<player.depth),'ground floor never covers the player');
    }
  }));
  test('low-poly wrecks: fallen wall chunks lie on the ground and the inside is not black', () => withPhaser(() => {
    const scene=stubScene();BuildingLowPoly.begin(scene);
    const recipe=BuildingLowPoly.recipeFor('wreck',{wall:0x777777,roof:0x555555,trim:0x333333});
    const mesh=BuildingLowPoly.add(scene,FOOT,recipe,'ridge','wreck-rubble');
    const lids=mesh.faces.filter(f=>f.rubbleTop);
    assert.gte(lids.length/2,3,'a few chunks of wall lie about: '+lids.length/2);
    assert.truthy(lids.every(f=>f.points.every(p=>p.z>=2&&p.z<4)),'chunks are shallow stone fragments');
    assert.truthy(mesh.faces.filter(f=>f.rubble).every(f=>Math.min(...f.points.map(p=>p.z))>=0),'chunks rest on the ground');
    // The cel pass's darkest step is light < .65: the floor and inner walls stay above it.
    for(const f of mesh.faces.filter(f=>f.debris||f.interior))assert.gte(f.light,.65,'interior faces take the middle cel step');
  }));
  test('low-poly wrecks: intermediate height breaks are perpendicular to their walls', () => withPhaser(() => {
    const scene=stubScene();BuildingLowPoly.begin(scene);
    const recipe=BuildingLowPoly.recipeFor('wreck',{wall:0x777777,roof:0x555555,trim:0x333333});
    const mesh=BuildingLowPoly.add(scene,FOOT,recipe,'ridge','square-breaks');
    const ring=FOOT.map(p=>({x:p.x-mesh.x,y:p.y-mesh.y}));
    let checked=0;
    for(const face of mesh.faces.filter(f=>f.wallEnd&&!f.wallBevel)){
      const edge=mesh.pieces[face.piece];
      // Corner stones keep their footprint mitres; interior joints cut square.
      if(ring.some(p=>[edge.a,edge.b].some(q=>Math.hypot(p.x-q.x,p.y-q.y)<1e-6)))continue;
      const [a,b]=face.points,dx=edge.b.x-edge.a.x,dy=edge.b.y-edge.a.y;
      if(Math.hypot(a.x-b.x,a.y-b.y)<1e-8)continue;
      assert.truthy(Math.abs((b.x-a.x)*dx+(b.y-a.y)*dy)<1e-6,
        'the main end face cuts perpendicular to the wall, between its corner chips');
      checked++;
    }
    assert.gt(checked,0,'checked interior wall breaks');
  }));
  test('low-poly wrecks: each house has distinct wall damage that survives rebuilding', () => withPhaser(() => {
    const recipe=BuildingLowPoly.recipeFor('wreck',{wall:0x777777,roof:0x555555,trim:0x333333});
    const footprint=[{x:100,y:100},{x:260,y:100},{x:260,y:196},{x:100,y:196}];
    const signatures=(key,dx=0)=>{
      const scene=stubScene();BuildingLowPoly.begin(scene);
      const mesh=BuildingLowPoly.add(scene,footprint.map(p=>({x:p.x+dx,y:p.y})),recipe,'ridge',key);
      const shape=predicate=>JSON.stringify(mesh.faces.filter(predicate).map(f=>
        f.points.map(p=>[p.x,p.y,p.z].map(n=>+n.toFixed(5)))));
      return {wall:shape(f=>f.wallTop),rubble:shape(f=>f.rubbleTop)};
    };
    const original=signatures('wreck-stable');
    assert.truthy(original.wall!=='[]','a large wreck retains broken wall prisms');
    assert.eq(signatures('wreck-stable').rubble,original.rubble,'rubble placement survives a scene rebuild');
    assert.eq(signatures('wreck-stable').wall,original.wall,'wall damage survives a scene rebuild');
    const houses=Array.from({length:8},(_,i)=>signatures('wreck-diverse:'+i,i*300));
    assert.gte(new Set(houses.map(s=>s.wall)).size,4,'same-size houses lose different wall areas');
  }));
  test('low-poly wrecks: small, narrow and large footprints have only low walls and rubble', () => withPhaser(() => {
    const recipe=BuildingLowPoly.recipeFor('wreck',{wall:0x777777,roof:0x555555,trim:0x333333});
    // The same low silhouette applies to annexes, small ruins and wide halls.
    for(const [width,height] of [[40,160],[60,60],[24,24],[240,180]]){
      const scene=stubScene();BuildingLowPoly.begin(scene);
      const footprint=[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}];
      const mesh=BuildingLowPoly.add(scene,footprint,recipe,'ridge','small-wreck:'+width);
      assert.falsy(mesh.faces.some(f=>f.standingRoof||f.fallenRoof||f.rafter||f.beam||f.steel),
        width+'x'+height+' has no surviving roof structure');
      assert.truthy(mesh.faces.some(f=>f.wallTop),'broken walls still remain');
      assert.truthy(mesh.faces.some(f=>f.debris),'the rubble floor still remains');
      assert.truthy(mesh.faces.every(f=>f.points.every(p=>p.z>=0&&p.z<=14)),'the whole wreck stays at most fourteen pixels high');
    }
  }));
  test('low-poly fade: translucent buildings omit filled outline passes that hide the player', () => withPhaser(() => {
    const scene=stubScene();BuildingLowPoly.begin(scene);
    const mesh=build(scene,'fade-render');
    BuildingLowPoly.update(scene);
    let vertices=0;
    const pipeline={shouldFlush:()=>false,setTexture2D:()=>0,batchVert:()=>{vertices++;}};
    const renderer={pipelines:{get:()=>pipeline,set:()=>pipeline,preBatch(){},postBatch(){}}};
    const camera={alpha:1,zoom:1,addToRenderList(){}};
    const visible=mesh.obj._lowpolyFaces.filter(f=>f.visible).length;
    assert.gt(visible,0,'the fixture draws visible faces');
    mesh.obj.alpha=.5;
    mesh.obj.renderWebGL(renderer,mesh.obj,camera);
    assert.eq(vertices,visible*3,'faded faces draw once without a filled ink pass');
    vertices=0;mesh.obj.alpha=1;
    mesh.obj.renderWebGL(renderer,mesh.obj,camera);
    assert.eq(vertices,visible*3*2,'opaque buildings retain one upper-edge ink pass');
  }));
  test('low-poly outlines: houses ink once and split wreck sections have no internal ink seams', () => withPhaser(() => {
    for(const role of ['market','blacksmith','wreck']){
      const scene=stubScene();BuildingLowPoly.begin(scene);
      const recipe=BuildingLowPoly.recipeFor(role,{wall:0xd4cdb4,roof:0x709b9a,trim:0x614534});
      BuildingLowPoly.add(scene,FOOT,recipe,recipe.variant||'ridge','outline:'+role);
      for(const heading of [0,.7,Math.PI]){
        scene.mapRot=heading;BuildingLowPoly.update(scene);
        let visiblePoints=0;
        for(const {sprite:obj} of BuildingLowPoly.worldPieces(scene)){
          const points=obj._lowpolyFaces.filter(f=>f.visible).flatMap(f=>f.projected);
          if(!points.length)continue;
          visiblePoints+=points.length;
          const vertices=[];
          const pipeline={shouldFlush:()=>false,setTexture2D:()=>0,batchVert:(x,y)=>vertices.push({x,y})};
          const renderer={pipelines:{get:()=>pipeline,set:()=>pipeline,preBatch(){},postBatch(){}}};
          obj.renderWebGL(renderer,obj,{alpha:1,zoom:2,addToRenderList(){}});
          const fills=role==='wreck'?0:points.length;
          assert.eq(vertices.length,points.length*(role==='wreck'?1:2),'wreck sections fill once; houses have one ink pass');
          for(let i=0;i<points.length;i++){
            if(role!=='wreck'){
              assert.eq(vertices[i].x,points[i].x,'ink never expands sideways');
              assert.eq(vertices[i].y,points[i].y-2*BuildingLowPoly.LOOK.inkPx,'ink expands only upward at camera zoom');
            }
            assert.eq(vertices[i+fills].x,points[i].x,'fill follows the actual silhouette');
            assert.eq(vertices[i+fills].y,points[i].y,'fill has no outline displacement');
          }
        }
        assert.gt(visiblePoints,0,'visible '+role+' at heading '+heading);
      }
    }
  }));
  test('street doors: face the nearest street with corner clearance, independent of winding', () => {
    const ring=[{x:0,y:0},{x:60,y:0},{x:60,y:40},{x:0,y:40}];
    const streets=[[{x:80,y:-20},{x:80,y:60}]];
    for(const points of [ring,[...ring].reverse()]){
      const door=BuildingLowPoly.streetDoor(points,streets);
      assert.eq(door.center.x,60);assert.eq(door.center.y,20);
      assert.eq(door.normal.x,1);assert.eq(door.normal.y,0);
      assert.eq(door.edge,1,'the east wall, by the triangulated ring\'s edge index');
      // The facade's painted door bay moves to that wall too (owner, Oct 2026:
      // doors face the nearest street); without a street the longest wall
      // lowest on screen keeps it.
      assert.eq(BuildingLowPoly.geometry(points,'ridge',29,0,null,door.edge).entranceEdge,1,'the entrance wall is the street wall');
      assert.eq(BuildingLowPoly.geometry(points,'ridge',29,0,null).entranceEdge,2,'else the south wall');
      // A named wall (Home's saved doorway): the same door, on that edge.
      const named=BuildingLowPoly.edgeDoor(points,1);
      assert.eq(named.center.x,60);assert.eq(named.center.y,20);assert.eq(named.normal.x,1);assert.eq(named.edge,1);
      assert.eq(BuildingLowPoly.ringEdgeNearest(points,{x:60,y:18}),1,'the edge nearest a doorway point');
      assert.eq(BuildingLowPoly.ringEdgeNearest(points,{x:30,y:40}),2);
    }
    assert.eq(BuildingLowPoly.streetDoor(ring,[]),null,'no street means no invented frontage');
    assert.eq(BuildingLowPoly.streetDoor(ring,[[{x:1000,y:0},{x:1000,y:100}]]),null,'distant roads do not choose a door');
    const tiny=[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];
    assert.eq(BuildingLowPoly.streetDoor(tiny,streets),null,'narrow walls leave no space for a door and its frame');
    assert.eq(BuildingLowPoly.edgeDoor(tiny,0),null,'a wall too short for a door names none');
  });
  test('street doors: retained decoration follows the building and leaves cached geometry unchanged', () => withPhaser(() => {
    const scene=stubScene();BuildingLowPoly.begin(scene);
    const recipe=BuildingLowPoly.recipeFor('plain');
    const street=[[{x:220,y:80},{x:220,y:220}]];
    const decorated=BuildingLowPoly.add(scene,FOOT,recipe,'ridge','door',street);
    const plain=BuildingLowPoly.add(scene,FOOT,recipe,'ridge','no-street');
    const faces=decorated.faces.filter(f=>f.door);
    assert.eq(faces.length,12,'frame, planks, brace and handle are retained triangles');
    assert.falsy(plain.faces.some(f=>f.door),'the shared roof/wall cache has no frontage decoration');
    scene.mapRot=Math.PI;BuildingLowPoly.update(scene);
    assert.truthy(faces.every(f=>f.projected.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))));
    assert.truthy(faces.every(f=>f.support===decorated.support),'door shares the building depth and fade');
  }));
})();
