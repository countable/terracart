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
