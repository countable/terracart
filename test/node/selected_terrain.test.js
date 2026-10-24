// Native terrain selection must use complete cells and preserve the legacy
// renderer contract: stable variant keys, authored cave overrides and shore layers.
(() => {
  const art = new Function('lerp', TEXTURES_SRC + '\nreturn { setSelectedTerrainSource, drawSelectedTerrain, drawBiomeTexture, drawInteriorFloorTexture, BIOME_TEX };')((a, b, t) => a + (b - a) * t);
  const source = { width: 112, height: 16 };
  function canvas() {
    const draws = [];
    return { draws, save() {}, restore() {}, drawImage(...args) { draws.push(args); } };
  }
  test('selected terrain: both grass and lava variants retain their native crop and repeat stably', () => {
    art.setSelectedTerrainSource(source);
    for (const [type, frames] of [[0, [9, 9]], [26, [2, 3]]]) {
      for (let variant = 0; variant < 8; variant++) {
        const ctx = canvas();
        art.drawBiomeTexture(ctx, 32, type, variant, 0.75);
        assert.eq(ctx.draws.length, 1, 'only the native tile is drawn, without procedural marks');
        assert.eq(ctx.draws[0][0], source, 'registered native atlas');
        assert.eq(ctx.draws[0].slice(1).join(','), `${frames[variant % 2] * 16},0,16,16,0,0,32,32`, 'complete native16 crop, stable variant');
        assert.eq(ctx.imageSmoothingEnabled, false, 'nearest-neighbour scaling');
      }
    }
  });
  test('selected terrain: water uses eight real source phases with coherent pier underlay', () => {
    art.setSelectedTerrainSource(source);
    for (let phase=0;phase<8;phase++) {
      const water=canvas(), pier=canvas();
      art.drawBiomeTexture(water,32,3,0,phase/8);
      art.drawBiomeTexture(pier,32,23,1,phase/8);
      assert.eq(water.draws[0][1],(40+phase)*16);
      assert.eq(JSON.stringify(water.draws),JSON.stringify(pier.draws));
    }
  });
  test('selected terrain: impassable exclusion bedrock uses a flat rock surface without cliff faces', () => {
    art.setSelectedTerrainSource(source);
    const rock = canvas();
    art.drawBiomeTexture(rock, 32, WorldGen.T.ROCK);
    for (const phase of [0, 0.5, 0.99]) {
      const bedrock = canvas();
      art.drawBiomeTexture(bedrock, 32, WorldGen.T.EXCLUSION_ROCK, 0, phase);
      assert.eq(bedrock.draws.length, 1, 'one ordinary ground tile, without a raised face');
      assert.eq(bedrock.draws[0].slice(1).join(','), '560,0,16,16,0,0,32,32', 'flat cold-slate crop replaces cliff-face frame 7');
      assert.eq(JSON.stringify(bedrock.draws), JSON.stringify(rock.draws), 'same level surface as ordinary rock');
      assert.eq(bedrock.imageSmoothingEnabled, false, 'native pixels retain their scale');
    }
    assert.falsy(WorldGen.isWalkable(WorldGen.T.EXCLUSION_ROCK), 'flat appearance retains terrain collision');
  });
  test('selected terrain: building polygon floors and grid cells share the same selected tile', () => {
    art.setSelectedTerrainSource(source);
    for (const type of [9, 12]) {
      const ground = canvas(), polygon = canvas();
      art.drawBiomeTexture(ground, 32, type);
      art.drawInteriorFloorTexture(polygon, 32, {}, type);
      assert.eq(JSON.stringify(ground.draws), JSON.stringify(polygon.draws), 'building representations agree');
    }
  });
  test('selected terrain: house wood and cave walls keep their existing painters', () => {
    art.setSelectedTerrainSource(source);
    for (const type of [11, 25]) {
      const ctx = canvas();
      assert.falsy(art.drawSelectedTerrain(ctx, 32, type), 'no native override');
      assert.eq(ctx.draws.length, 0, 'caller may use the existing painter');
    }
    art.setSelectedTerrainSource(null);
    assert.falsy(art.drawSelectedTerrain(canvas(), 32, 0), 'missing atlas falls back gracefully');
  });
})();

(() => {
  test('selected terrain: grass seam colour follows opaque native ground without per-cell readback', () => {
    let reads = 0;
    const data = new Uint8ClampedArray([
      99,199,77,255, 99,199,77,255, 135,207,94,255, 0,0,0,0,
    ]);
    const ctx = { clearRect() {}, drawImage() {}, getImageData() { reads++; return { data }; } };
    const doc = { createElement: () => ({ getContext: () => ctx }) };
    const art = new Function('document', 'lerp', TEXTURES_SRC +
      '\nreturn { setSelectedTerrainSource, selectedGrassBaseColor };')(doc, (a,b,t) => a + (b-a)*t);
    art.setSelectedTerrainSource({ width:112, height:16 });
    const bakedReads = reads;
    assert.truthy(bakedReads > 2, 'cache all selected material inks at atlas setup');
    for (let i=0; i<100; i++) assert.eq(art.selectedGrassBaseColor(0, 0x7b8d4e), 0x63c74d);
    assert.eq(reads, bakedReads, 'looking up fills and borders never reads pixels');
    assert.eq(art.selectedGrassBaseColor(12, 0x123456), 0x123456, 'castle shading remains independent');
    art.setSelectedTerrainSource(null);
    assert.eq(art.selectedGrassBaseColor(0, 0x7b8d4e), 0x7b8d4e, 'missing atlas restores procedural base');
  });
})();

(() => {
  const art = new Function('WorldGen','ZoneVariants','lerp',TEXTURES_SRC +
    '\nreturn { zoneGroundTexture, ZONE_SELECTED_MATERIALS, SELECTED_MATERIAL_FRAMES, SELECTED_TERRAIN };')(
      {zoneAnchorAt:(entry,index)=>entry.winner ? entry.zone.anchors[0] : null},
      {pick:anchor=>({id:anchor.id})},(a,b,t)=>a+(b-a)*t);
  test('selected terrain: every surface landcover has a material, houses and cave walls retain their owners',()=>{
    for (const t of [0,1,2,3,4,5,6,8,10,15,16,17,18,19,20,21,22,23,27,28,29,31,32]) {
      assert.truthy(art.SELECTED_TERRAIN[t]?.length,'terrain '+t);
    }
  });
  test('selected terrain: Nexus materials respect winning ownership and never replace roads or buildings',()=>{
    for (const [id,material] of Object.entries(art.ZONE_SELECTED_MATERIALS)) {
      assert.truthy(art.SELECTED_MATERIAL_FRAMES[material]!==undefined,'real source frame '+id);
      const entry={winner:true,zone:{anchors:[{id}]}};
      assert.eq(art.zoneGroundTexture(entry,0,28),'zone_ground_'+material);
      for(const type of [7,8,9,11,12,23,24,25,32]) assert.eq(art.zoneGroundTexture(entry,0,type),null);
      entry.winner=false;
      assert.eq(art.zoneGroundTexture(entry,0,28),null,'hidden anchor cannot paint ground');
    }
  });
})();

(() => {
  test('selected terrain: corner cutouts share one bounded startup atlas, including animated water',()=>{
    const art=new Function('lerp',TEXTURES_SRC+'\nreturn { makeSelectedRoundedTerrain, selectedRoundedTerrainFrames };')((a,b,t)=>a+(b-a)*t);
    let canvases=0,frames=0,clips=0;
    const ctx={};
    for(const method of ['save','restore','translate','beginPath','moveTo','lineTo','arcTo','closePath','drawImage'])ctx[method]=()=>{};
    ctx.clip=()=>clips++;
    const scene={textures:{get:()=>({getSourceImage:()=>({})}),createCanvas:(key,w,h)=>{
      canvases++;assert.eq(key,'selected_rounded_terrain');assert.truthy(w*h<2*1024*1024,'bounded atlas');
      return {getContext:()=>ctx,add:()=>frames++,refresh(){}};
    }}};
    art.makeSelectedRoundedTerrain(scene,32);
    assert.eq(canvases,1,'no canvas per cell or individual corner texture');
    assert.eq(frames,art.selectedRoundedTerrainFrames.size*15);
    assert.eq(clips,frames,'every corner combination clips the native source');
    for(const key of ['biome3_0p7','biome23_1p7','zone_ground_G04']) assert.truthy(art.selectedRoundedTerrainFrames.has(key),key);
    for(const key of ['biome9_0','biome11_0','biome12_0'])assert.falsy(art.selectedRoundedTerrainFrames.has(key),'house floor owner retained');
  });
})();

 test('native RA terrain: landcover materials do not change with world position', () => {
  const art = new Function(ALL_SRC['ra_terrain_trial.js'] + '\nreturn RATerrainTrial;')();
  for (const type of [0,1,2,3,4,5,6,15,16,17,18,19,20,21,22,23]) {
    const expected=art.material(type,0,0);
    for(let y=-30;y<=30;y+=2)for(let x=-30;x<=30;x+=2)
      assert.eq(art.material(type,x,y),expected,'landcover '+type+' keeps its material');
  }
});

test('native RA terrain: grass shares orchard and residential uses the lighter selected slate', () => {
  const native=new Function(ALL_SRC['ra_terrain_trial.js']+'\nreturn RATerrainTrial;')();
  const {SELECTED_TERRAIN:selected,SELECTED_MATERIAL_FRAMES:frames}=new Function(TEXTURES_SRC+'\nreturn {SELECTED_TERRAIN,SELECTED_MATERIAL_FRAMES};')();
  assert.eq(native.material(0,12,8),native.material(22,12,8));
  assert.eq(native.material(5,12,8),-1,'selected slate retains the ordinary renderer');
  assert.eq(selected[5].join(','),[frames['G09-light-slate'],frames['G09-light-slate']].join(','),'residential reads lighter than rock');
  assert.eq(selected[10].join(','),[frames['G09-cold'],frames['G09-cold']].join(','),'rock keeps its cold slate');
  assert.eq(selected[32].join(','),String(frames['G09-cold']),'bedrock stays with rock');
  assert.eq(selected[0].join(','),selected[22].join(','));
});

test('selected terrain: commercial pavers stay separate from native terrain and road stone', () => {
  const native=new Function(ALL_SRC['ra_terrain_trial.js']+'\nreturn RATerrainTrial;')();
  const art=new Function(TEXTURES_SRC+'\nreturn {SELECTED_TERRAIN,SELECTED_MATERIAL_FRAMES};')();
  assert.eq(native.material(16),-1);
  assert.eq(art.SELECTED_TERRAIN[16][0],art.SELECTED_MATERIAL_FRAMES['COMM-sandstone']);
  assert.truthy(art.SELECTED_TERRAIN[16][0]!==art.SELECTED_MATERIAL_FRAMES['ROAD-natural']);
});
