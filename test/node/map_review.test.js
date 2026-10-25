// tools/map-review.html runs the game's own code in the browser to review
// what the world generator places. Two handshakes it depends on:
//
// THE REVIEW SALT. The world has no global seed (CLAUDE.md "The world is
// GENERATED"); the review page's Reroll XORs a salt into WorldGen's makeRng.
// It must be 0 in the game — so no game code may ever call setReviewSalt —
// and at 0 every seed must be exactly what it was.
//
// THE MODULE LIST. The page loads the modules index.html lists, in order,
// then app.js — reading the script tags out of index.html at load.
(function () {
test('map review: texture hooks replace numeric frames and skip player animation', async () => {
  const L={Layer:{extend:methods=>function(options){Object.assign(this,methods);this.initialize(options);}},
    setOptions:(layer,options)=>{layer.options=options;}};
  const ASSETS={
    cave_props:{kind:'spritesheet',path:'props.png',frameWidth:24,frameHeight:24,onLoad(scene){
      const texture=scene.textures.get('cave_props');
      texture.remove('24');
      texture.add('24',0,0,99,24,21);
    }},
    dragon:{kind:'spritesheet',path:'dragon.png',frameWidth:96,frameHeight:96,onLoad(scene){
      scene._createAnim('dragon-fly','dragon',0,7,10);
      if(scene.isDragonActive())throw new Error('static review must not activate a player');
    }},
  };
  class Image { constructor(){this.width=192;this.height=192;} async decode(){} }
  const noop=()=>{};
  const art=new Function('L','ASSETS','Image','makeTowerTexture','makePotOfGoldTexture','makeTrapTextures','makeBerryBushTexture','BIOME_TEX',
    MAP_REVIEW_ART_SRC+'\nreturn MapReviewArt;')(L,ASSETS,Image,noop,noop,noop,noop,{});
  const layer=art.layer({});
  layer.redraw=noop;
  await layer._load();
  assert.eq(layer._assets.failures.length,0,'shipping texture hooks must not become missing assets');
  const texture=layer._assets.textures.get('cave_props');
  assert.eq(texture.get(24).y,99,'numeric frame lookup reads the replacement string frame');
  assert.eq(texture.get('24').height,21,'replacement clips the prior row contamination');
  assert.eq(texture.get(23).height,24,'neighbouring frame stays intact');
  assert.eq(texture.get(24),texture.get('24'),'both identifiers resolve to the same frame');
});

test('map review: pirate sand tint follows only the exact sand coverage cells', () => {
  const L={Layer:{extend:()=>function(){}}};
  const art=new Function('L','WorldGen',MAP_REVIEW_ART_SRC+'\nreturn MapReviewArt;')(L,WorldGen);
  const T=WorldGen.T;
  const e={grid:[T.SAND,T.SAND,T.SAND,T.WATER,T.PATH],zone:{
    anchors:[{variant:'pirate_cove'},{variant:'shellwater_strand'}],
    coverage:[1,2,0,1,1],idx:[0,1,1,1,1],
  }};
  assert.truthy(art.pirateSand(e,0),'pirate coverage wins even outside the influence core');
  for(let i=1;i<e.grid.length;i++)assert.eq(art.pirateSand(e,i),null,'ordinary sand, uncovered cells, water and paths stay unchanged');
  assert.eq(art.pirateSand({grid:[T.SAND]},0),null,'tiles without zones stay unchanged');
});

test('map review: source road bands have biome ground rather than a second raster road', () => {
  const L={Layer:{extend:methods=>function(options){Object.assign(this,methods);this.initialize(options);}},
    setOptions:(layer,options)=>{layer.options=options;}};
  const art=new Function('L','WorldGen','Render','tileCellToAbs','BIOME_TEX','COLORS','zoneGroundColor',
    MAP_REVIEW_ART_SRC+'\nreturn MapReviewArt;')(L,WorldGen,Render,tileCellToAbs,
    {0:{variants:1},1:{variants:1}}, {0:0x71845b,1:0x224422,7:0xff0000,8:0xff0000,13:0xff0000,14:0xff0000},()=>null);
  const layer=art.layer({getEdge:()=>32});
  const keys=[],fills=[];
  const e={tx:0,ty:0,cellsPerEdge:2,grid:[7,8,13,14]};
  layer._world={tiles:[e],scene:{cellsPerTile:2,neighborNonRoadType:(x)=>x===0?0:1}};
  layer._assets={textures:{get:key=>({getSourceImage:()=>{keys.push(key);return key;}})}};
  layer._roadsForTile=()=>[];
  const g={fillRect(){fills.push(this.fillStyle);},drawImage(){}};
  layer._paintGround(g,{x:32,y:32},(x,y)=>({x,y}));
  assert.eq(fills.join(','),'#71845b,#224422,#71845b,#224422','all road cells match their biome fill');
  assert.eq(keys.join(','),'biome0_0,biome1_0,biome0_0,biome1_0','all road cells match their biome texture');
});

test('map review: winning Nexus texture replaces the ordinary biome', () => {
  const L={Layer:{extend:methods=>function(options){Object.assign(this,methods);this.initialize(options);}},
    setOptions:(layer,options)=>{layer.options=options;}};
  const art=new Function('L','WorldGen','BIOME_TEX','COLORS','zoneGroundColor','zoneGroundTexture',
    MAP_REVIEW_ART_SRC+'\nreturn MapReviewArt;')(L,WorldGen,{2:{variants:1}},{2:0xccaa88},()=>null,
    (entry,index)=>index===0?'zone_ground_G10':null);
  const layer=art.layer({getEdge:()=>32}), keys=[];
  layer._world={tiles:[{tx:0,ty:0,cellsPerEdge:2,grid:[2,2,2,2]}],scene:{}};
  layer._assets={textures:{get:key=>({getSourceImage:()=>{keys.push(key);return key;}})}};
  layer._roadsForTile=()=>[];
  layer._paintGround({fillRect(){},drawImage(){}},{x:32,y:32},(x,y)=>({x,y}));
  assert.eq(keys.join(','),'zone_ground_G10,biome2_0,biome2_0,biome2_0');
});

test('map review: spawn overlays derive verdicts from tier permissions, not legacy source flags', () => {
  const review=new Function('WorldGen','GameplayTiers',MAP_REVIEW_GROUND_SRC+'\nreturn MapReviewGround;')(WorldGen,GameplayTiers);
  assert.eq(review.spawnVerdict(GameplayTiers.CORE),WorldGen.SPAWN_OPEN);
  assert.eq(review.spawnVerdict(GameplayTiers.CALM),WorldGen.SPAWN_SUPPRESSED);
  assert.eq(review.spawnVerdict(GameplayTiers.PASSING),WorldGen.SPAWN_SUPPRESSED);
  assert.eq(review.spawnVerdict(GameplayTiers.EXCLUDED),WorldGen.SPAWN_INVALID);
  assert.eq(review.spawnVerdict(0),WorldGen.SPAWN_INVALID);
  assert.falsy(/spawnClassOf\(/.test(MAP_REVIEW_HTML_SRC),'legacy evidence no longer drives overlay eligibility');
  assert.truthy(MAP_REVIEW_GROUND_SRC.includes('Source restriction evidence'));
});

test('map review: no game code sets the review salt', () => {
  assert.truthy(typeof WorldGen.setReviewSalt === 'function', 'the hook exists');
  for (const [name, src] of Object.entries(ALL_SRC)) {
    assert.falsy(/\bWorldGen\.setReviewSalt\s*\(/.test(src), `${name} never calls it`);
  }
  assert.truthy(/let _reviewSalt = 0;/.test(WORLDGEN_SRC), 'and it starts at 0');
});

test('map review: at salt 0 every seed is unchanged, and a salt reseeds', () => {
  const a = WorldGen.makeRng(12345)();
  WorldGen.setReviewSalt(0);
  assert.eq(WorldGen.makeRng(12345)(), a, 'salt 0 is the identity');
  WorldGen.setReviewSalt(0xabc);
  const b = WorldGen.makeRng(12345)();
  WorldGen.setReviewSalt(0);
  assert.truthy(a !== b, 'a salt rolls a different world');
  assert.eq(WorldGen.makeRng(12345)(), a, 'and clearing it restores the shipped one');
});

test('tool pages: the shared loader\'s own pattern still finds the game\'s modules in index.html', () => {
  // tools/game-loader.js (map-review.html, balancing.html) reads index.html's
  // script tags with THIS regex — lifted from the loader, not retyped.
  const m = GAME_LOADER_SRC.match(/html\.matchAll\((\/.+\/g)\)/);
  assert.truthy(m, 'the loader\'s script-tag pattern');
  const re = new RegExp(m[1].slice(1, m[1].lastIndexOf('/')), 'g');
  const srcs = [...INDEX_HTML_SRC.matchAll(re)].map((x) => x[1]);
  assert.truthy(srcs.includes('src/worldgen.js') && srcs.includes('src/rarity.js') && srcs.includes('src/scene_creatures.js'),
    'the generator, the loot roll and spawnInTile\'s module are found');
  assert.truthy(/const APP_SRC = 'src\/app\.js/.test(INDEX_HTML_SRC), 'app.js is still the boot line\'s (the loader appends it)');
});
})();

test('map review: all selected Nexus grounds use their own native transition families', () => {
  const L={Layer:{extend:methods=>function(options){Object.assign(this,methods);this.initialize(options);}},setOptions:(layer,options)=>{layer.options=options;}};
  const native=new Function(ALL_SRC['ground_materials.js']+'\n'+ALL_SRC['terrain_transitions.js']+'\nreturn TerrainTransitions;')();
  const art=new Function('L','WorldGen','TerrainTransitions','tileCellToAbs','zoneGroundColor','zoneGroundTexture','isBuildingType',MAP_REVIEW_ART_SRC+'\nreturn MapReviewArt;')(
    L,WorldGen,native,(_,tx,ty,x,y)=>({cellIX:tx*2+x,cellIY:ty*2+y}),()=>0x777777,(_e,_i,type)=>'zone_ground_'+({29:'G06-purple',31:'G09-smooth-grey',2:'G10',28:'G01'}[type]),()=>false);
  const e={tx:0,ty:0,cellsPerEdge:2,grid:new Uint8Array([29,31,2,28])};
  const layer=art.layer({});layer._world={tiles:[e],scene:{}};
  const ring=layer._terrainRing(e);
  for(let y=0;y<2;y++)for(let x=0;x<2;x++)
    layer._terrainMaterial(e,x,y,ring,{cellIX:x,cellIY:y});
  assert.eq(ring.materials[5],8,'Churchyard uses native tinted masks');
  assert.eq(ring.materials[6],9,'Tar Yard uses native tinted masks');
  assert.eq(ring.materials[9],20,'beach receives selected sand transition masks');
  assert.eq(ring.materials[10],15,'grove receives green grass transition masks');
});

test('map review: layered terrain paints the base and masks in the same cell rectangle', () => {
  const L={Layer:{extend:methods=>function(options){Object.assign(this,methods);this.initialize(options);}},setOptions:(layer,options)=>{layer.options=options;}};
  const native={select:(_scene,ring,stride,index)=>{
    assert.eq(ring.join(','),'1,1,1,1','review samples only the owning ground material');
    assert.eq(stride,2); assert.eq(index,0);
    return {key:'ra_terrain_source',frame:15,layers:[33,76]};
  }};
  const art=new Function('L','WorldGen','TerrainTransitions','tileCellToAbs','zoneGroundTexture','MountainEdges',MAP_REVIEW_ART_SRC+'\nreturn MapReviewArt;')(
    L,WorldGen,native,()=>({cellIX:0,cellIY:0}),()=>null,{select:()=>null});
  const layer=art.layer({getEdge:()=>32}),calls=[];
  layer._world={tiles:[{tx:0,ty:0,cellsPerEdge:1,grid:[0]}],scene:{}};
  layer._terrainRing=()=>({types:[],materials:[-1,-1,-1,-1,1,4,2,3,0],stride:3});
  layer._assets={scene:{_terrainTransitionsReady:true},textures:{get:()=>({get:f=>({cutX:f,cutY:0,width:16,height:16}),getSourceImage:()=> 'source'})}};
  layer._roadsForTile=()=>[];
  layer._paintGround({drawImage(...args){calls.push(args);}},{x:32,y:32},(x,y)=>({x,y}));
  assert.eq(calls.map(a=>a[1]).join(','),'15,33,76','base then masks');
  for(const args of calls)assert.eq(args.slice(5).join(','),'0,0,32,32','same full cell footprint');
});

test('map review: cheap building polygons retain concave rings, cull offscreen shapes and skip caves', () => {
  const L={Layer:{extend:methods=>function(options){Object.assign(this,methods);this.initialize(options);}},setOptions:(layer,options)=>{layer.options=options;}};
  const art=new Function('L','BUILDING_FACE_COLOR',MAP_REVIEW_ART_SRC+'\nreturn MapReviewArt;')(L,{9:0x7e4138});
  const layer=art.layer({getEdge:()=>100}),points=[],fills=[];
  layer._world={scene:{},tiles:[{tx:2,ty:3,buildingShapes:[
    {tier:9,ring:new Float32Array([0,0,20,0,20,10,10,10,10,20,0,20])},
    {tier:9,ring:new Float32Array([100,100,120,100,120,120])},
    {tier:9,ring:new Float32Array([0,0])},
  ]}]};
  const g={beginPath(){},moveTo(x,y){points.push([x,y]);},lineTo(x,y){points.push([x,y]);},closePath(){},fill(){fills.push(this.fillStyle);},stroke(){}};
  layer._paintBuildingFootprints(g,{x:40,y:40},(x,y)=>({x:x-195,y:y-295}));
  assert.eq(JSON.stringify(points),JSON.stringify([[5,5],[25,5],[25,15],[15,15],[15,25],[5,25]]),'tile-local metres retain the notch and project to world position');
  assert.eq(fills.join(','),'#7e4138','only the visible valid polygon paints');
  layer._world.scene.depth=1;
  layer._paintBuildingFootprints(g,{x:40,y:40},(x,y)=>({x,y}));
  assert.eq(fills.length,1,'surface footprints never leak into caves');
});

test('map review: polygon buildings replace square floor tiles with surrounding ground', () => {
  const L={Layer:{extend:methods=>function(options){Object.assign(this,methods);this.initialize(options);}},setOptions:(layer,options)=>{layer.options=options;}};
  const art=new Function('L','WorldGen','isBuildingType','tileCellToAbs','BIOME_TEX','COLORS','zoneGroundColor',
    MAP_REVIEW_ART_SRC+'\nreturn MapReviewArt;')(L,WorldGen,t=>t===9,()=>({cellIX:0,cellIY:0}),{0:{variants:1},9:{variants:1}},{0:0x71845b,9:0xff0000},()=>null);
  const layer=art.layer({getEdge:()=>32}),keys=[];
  layer._world={tiles:[{tx:0,ty:0,cellsPerEdge:1,grid:[9],buildingShapes:[{ring:[]}]}],scene:{neighborNonRoadType:()=>0}};
  layer._assets={textures:{get:key=>({getSourceImage:()=>{keys.push(key);return key;}})}};
  layer._roadsForTile=()=>[];
  layer._paintGround({fillRect(){},drawImage(){}},{x:32,y:32},(x,y)=>({x,y}));
  assert.eq(keys.join(','),'biome0_0','no square building floor under the source polygon');
});

test('map review: static creatures use the shared idle pose, mirroring and elite palette', () => {
  const L={Layer:{extend:()=>function(){}}},calls=[];
  const render={vividTexture:(scene,kind,key)=>{calls.push(kind);return 'elite-'+key;}};
  const combat={isElite:o=>!!o.elite,isTame:()=>false};
  const art=new Function('L','SpriteLayout','Combat','Render',MAP_REVIEW_ART_SRC+'\nreturn MapReviewArt;')(L,SpriteLayout,combat,render);
  for(const kind of ['ogre','treant','deer','sea_turtle','mushroom_monster']) {
    const o={kind,_facing:'left',_attackUntil:500,_moveUntil:500};
    const expected=SpriteLayout.creatureAppearance({...o,_attackUntil:0,_moveUntil:0},0);
    const actual=art.creatureAppearance(o,{});
    assert.eq(actual.frameVal,expected.frame,kind+' uses its idle row');
    assert.eq(actual.flipX,!!expected.flipX,kind+' keeps the shared mirroring');
    assert.eq(o._attackUntil,500,'review never mutates actor state');
  }
  const elite=art.creatureAppearance({kind:'ogre',elite:true},{});
  assert.truthy(elite.texKey.startsWith('elite-'),'elite palette replaces the ordinary sheet');
  assert.eq(calls.join(','),'ogre','palette preparation uses the runtime helper');
});

test('map review: plant sizing and seating come from the live placement rule', () => {
  const L={Layer:{extend:()=>function(){}}},plant={crop:'shrub',wildId:'plant',stage:4,_terrainScale:.7},scene={save:{}};
  const spec={custom:true,sheet:'flora',scale:2},calls=[];
  const render={plantPlacement(...args){calls.push(args);return {scl:1.4,oy:.5,dxPx:3,dyPx:7};}};
  const art=new Function('L','Render','wildplantSprite','wildplantFrame','MAX_GROWTH_STAGE','BiomeProfiles',MAP_REVIEW_ART_SRC+'\nreturn MapReviewArt;')(
    L,render,()=>spec,()=>2,5,{tint:()=>null});
  const result=art.cropAppearance(plant,scene);
  assert.eq(result.scl,1.4);assert.eq(result.dxPx,3);assert.eq(result.dyPx,7);
  assert.eq(calls[0][0],plant);assert.eq(calls[0][4],scene);
});

test('map review: building markers identify roles and sit inside concave footprints', () => {
  const L={Layer:{extend:()=>function(){}}};
  const art=new Function('L','Houses','Shops','Render',MAP_REVIEW_ART_SRC+'\nreturn MapReviewArt;')(L,Houses,Shops,Render);
  const scene={save:{starterShopId:'home'}};
  assert.eq(art.buildingSymbol({kind:'house',id:'home',tier:12},scene).key,'trailer','Home wins over building tier');
  assert.eq(art.buildingSymbol({kind:'house',id:'ruin',tier:9},scene).key,'wreck');
  assert.eq(art.buildingSymbol({kind:'house',tier:11},scene).key,'fort','missing IDs do not become Home');
  assert.eq(art.buildingSymbol({kind:'tower',castle:'castle'},scene).key,'castle');
  assert.eq(art.buildingSymbol({kind:'temple'},scene).key,'temple');
  const point=art.footprintPoint([0,0,30,0,30,10,10,10,10,30,0,30]);
  assert.truthy(point.x>0&&point.x<10&&point.y>10&&point.y<30,'L-shaped footprint marker stays inside its leg');
});


test('map review: tile inspection finds overlapping records, seam footprints and generated infrastructure', () => {
  const review = new Function('SpawnOwnership','tileCellToAbs',MAP_REVIEW_GROUND_SRC+'; return MapReviewGround;')(SpawnOwnership,tileCellToAbs);
  const scene = { cellsPerTile:4, tileEdgeM:28, cellM:7, mPerPx:28/WorldGen.TILE_PX,
    startWorldM:{x:0,y:0}, originPx:{x:0,y:0} };
  const prop = {id:'prop',kind:'mineralrock',x:24.5,y:10.5};
  const enemy = {id:'enemy',kind:'slime',x:24.5,y:10.5};
  const plant = {id:'plant',kind:'wildplant',crop:'grass',x:24.5,y:10.5};
  const seam = {id:'seam',kind:'grove_shrine',x:31.5,y:10.5,_footprintCells:{width:3,height:1}};
  const house = {id:'house',kind:'house',x:3.5,y:3.5};
  const e = {tx:0,ty:0,cellsPerEdge:4,objects:[prop,house],creatures:[enemy],wildplants:[plant],
    owners:new Uint8Array(16),ownerKeys:[null,'house']};
  e.owners[7]=1;
  const other = {tx:1,ty:0,cellsPerEdge:4,objects:[seam]};
  const world = {scene,tiles:[e,other],guards:[enemy]};
  const lamp = {id:'lamp',kind:'_streetlamp',x:24.5,y:10.5};
  const hit = {entry:e,x:3,y:1,cell:7};
  const items = review.objectsAt(world,hit,[{e,o:lamp,category:'infrastructure'},{e,o:prop,category:'object'}]);
  assert.eq(items.map(i=>i.object.id).sort().join(','),'enemy,house,lamp,plant,prop,seam',
    'all occupants are shown once, including the adjacent-tile footprint and building ownership');
  assert.eq(items.find(i=>i.object.id==='enemy').category,'creature');
  assert.eq(items.find(i=>i.object.id==='seam').entry,other,'metadata keeps its source tile');
  assert.eq(review.objectsAt(world,{entry:e,x:0,y:3,cell:12}).length,0,'nearby objects do not leak into empty cells');
  assert.eq(review.objectsAt(world,null).length,0,'unloaded ground has no occupants');
});
