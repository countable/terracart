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

test('selected terrain: native masks replace the rounded-corner startup atlas', () => {
  for (const symbol of ['makeSelectedRoundedTerrain','selectedRoundedTerrainFrames','selected_rounded_terrain','TERRAIN_CORNER_RADIUS']) {
    assert.falsy(TEXTURES_SRC.includes(symbol), symbol+' is retired from texture baking');
    assert.falsy(RENDER_SRC.includes(symbol), symbol+' is retired from rendering');
  }
  assert.falsy(RENDER_SRC.includes('FLAT_ROUNDABLE'),'native materials do not calculate redundant per-cell corners');
});

 test('native RA terrain: landcover materials do not change with world position', () => {
  const art = new Function(ALL_SRC['ground_materials.js']+'\n'+ALL_SRC['terrain_transitions.js'] + '\nreturn TerrainTransitions;')();
  for (const type of [0,1,2,3,4,5,6,15,16,17,18,19,20,21,22,23]) {
    const expected=art.material(type,0,0);
    for(let y=-30;y<=30;y+=2)for(let x=-30;x<=30;x+=2)
      assert.eq(art.material(type,x,y),expected,'landcover '+type+' keeps its material');
  }
});

test('native RA terrain: grass shares orchard and residential uses the selected rock ground', () => {
  const native=new Function(ALL_SRC['ground_materials.js']+'\n'+ALL_SRC['terrain_transitions.js']+'\nreturn TerrainTransitions;')();
  const selected=new Function(TEXTURES_SRC+'\nreturn SELECTED_TERRAIN;')();
  assert.eq(native.material(0,12,8),native.material(22,12,8));
  assert.truthy(native.material(5,12,8)!==native.material(10,12,8),'public residential retains its light slate independently of rock');
  assert.truthy(native.material(5,12,8)>=0,'cold slate participates in stacked transitions');
  assert.eq(selected[5].join(','),'67,67','public residential retains the released light-slate crop');
  assert.eq(selected[0].join(','),selected[22].join(','));
});

test('selected terrain: Grove ground stays green through native masks and fallback tiles', () => {
  const native=new Function(ALL_SRC['ground_materials.js']+'\n'+ALL_SRC['terrain_transitions.js']+'\nreturn TerrainTransitions;')();
  const selected=new Function(TEXTURES_SRC+'\nreturn {SELECTED_TERRAIN,SELECTED_MATERIAL_FRAMES,ZONE_SELECTED_MATERIALS};')();
  const green=native.materialForGround(28,'zone_ground_G01');
  assert.eq(native.material(28),green,'plain Grove uses the green grass family');
  assert.eq(selected.SELECTED_TERRAIN[28].join(','),String(selected.SELECTED_MATERIAL_FRAMES.G01),'fallback uses the same green grass');
  for(const id of ['meadow','marine_meadow','orchard','formal_garden','hedge_garden','ancient_grove','sacred_grove','mushroom_grove','spooky_woods'])
    assert.eq(native.materialForGround(28,'zone_ground_'+selected.ZONE_SELECTED_MATERIALS[id]),green,id+' retains green ground');
});

test('selected terrain: commercial concrete restores the original square tiles with native transitions', () => {
  const native=new Function(ALL_SRC['ground_materials.js']+'\n'+ALL_SRC['terrain_transitions.js']+'\nreturn TerrainTransitions;')();
  const art=new Function(TEXTURES_SRC+'\nreturn {SELECTED_TERRAIN,SELECTED_MATERIAL_FRAMES};')();
  assert.truthy(native.material(16)>=0,'commercial participates in native transitions');
  assert.eq(art.SELECTED_TERRAIN[16].join(','),[art.SELECTED_MATERIAL_FRAMES.R01,art.SELECTED_MATERIAL_FRAMES.R02].join(','));
  assert.truthy(!art.SELECTED_TERRAIN[16].includes(art.SELECTED_MATERIAL_FRAMES['COMM-sandstone']),'sandstone is no longer commercial ground');
  assert.truthy(art.SELECTED_TERRAIN[16][0]!==art.SELECTED_MATERIAL_FRAMES['ROAD-natural']);
});


test('native RA terrain: every Nexus ground override has a masked material', () => {
  const native=new Function(ALL_SRC['ground_materials.js']+'\n'+ALL_SRC['terrain_transitions.js']+'\nreturn TerrainTransitions;')();
  const selected=new Function(TEXTURES_SRC+'\nreturn ZONE_SELECTED_MATERIALS;')();
  for (const [variant,id] of Object.entries(selected)) {
    const family=native.materialForGround(28,'zone_ground_'+id,0,0);
    assert.truthy(family>=0 && family<native.families.length,variant+' retains its selected texture through transitions');
  }
  for (const type of [5,10,16,27,28,33])
    assert.truthy(native.material(type)>=0,'previously missing ground '+type+' is covered');
});

test('selected terrain: game preparation omits redundant Nexus texture copies', () => {
  const start=TEXTURES_SRC.indexOf('function makeBiomeTextures(');
  const end=TEXTURES_SRC.indexOf('\nfunction ',start+1);
  const bake=TEXTURES_SRC.slice(start,end<0?undefined:end);
  assert.truthy(start>=0);
  assert.falsy(/bakeCanvas\(scene,\s*['"]zone_ground_/.test(bake),'registered Nexus surfaces use their shared atlas frames');
  assert.truthy(bake.includes('drawBiomeTexture'),'general biome fallbacks remain for underground and authored surfaces');
  assert.truthy(bake.includes('TILLED_VARIANTS'),'tilled beds retain their independent preparation');
});

test('terrain transitions: native selection bypasses legacy surface texture lookup', () => {
  const selected=RENDER_SRC.indexOf('const selected = transitionsActive');
  const fallback=RENDER_SRC.indexOf('if (!selected)',selected);
  const biome=RENDER_SRC.indexOf('BIOME_TEX[baseType]',selected);
  assert.truthy(selected>=0 && fallback>selected && biome>fallback,'covered cells choose atlas layers before entering fallback texture work');
  assert.falsy(/texKey\s*=\s*zoneGroundTexture/.test(RENDER_SRC),'Nexus materials cannot request retired duplicate textures');
  assert.truthy(RENDER_SRC.includes('FloorWallMaterials.groundTexture'),'underground keeps its floor material owner');
});

test('selected terrain: texture crops come from the authoritative ground registry', () => {
  const art=new Function(TEXTURES_SRC+'\nreturn {registry:GroundMaterials,selected:SELECTED_TERRAIN,frames:SELECTED_MATERIAL_FRAMES};')();
  assert.eq(art.selected,art.registry.selectedTerrain,'fallback and exporter share terrain source crops');
  assert.eq(art.frames,art.registry.selectedMaterialFrames,'selected material IDs have one frame mapping');
});
