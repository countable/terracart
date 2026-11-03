// Native transparent tile masks own ground transitions. The retired colour
// ramps must not reappear as a fallback for an unwired surface material.
test('terrain transitions: colour blur strips and their caches are retired', () => {
  for (const symbol of ['BLUR_STEPS','BLUR_W','BLUR_MIX','getBlend','_mixCache','edgeNeedsBorder'])
    assert.falsy(new RegExp('\b'+symbol+'\b').test(RENDER_SRC),symbol+' is not a second transition path');
});

test('terrain transitions: cold slate, concrete and trimmed rubble stack only local materials', () => {
  const art=new Function(ALL_SRC['ground_materials.js']+'\n'+ALL_SRC['terrain_transitions.js']+'\nreturn TerrainTransitions;')();
  const values=[art.material(5),art.material(16),art.material(33),art.material(3)];
  const frames=art.layersFor(values);
  assert.eq(frames.length,4);
  assert.eq(frames[0]%16,15,'opaque local ground beneath native corners');
  for (const frame of frames) assert.includes(values,Math.floor(frame/16));
  assert.eq(Math.floor(frames[frames.length-1]/16),art.material(3),'water banks retain final priority');
});

test('terrain transitions: structural surfaces retain their own boundary renderers', () => {
  const art=new Function(ALL_SRC['ground_materials.js']+'\n'+ALL_SRC['terrain_transitions.js']+'\nreturn TerrainTransitions;')();
  for (const type of [9,11,12,24,25,26]) assert.eq(art.material(type),-1,'structural terrain '+type);
});


test('terrain transitions: neighbouring concrete and rubble variants do not create terrain cutouts', () => {
  const art=new Function(ALL_SRC['ground_materials.js']+'\n'+ALL_SRC['terrain_transitions.js']+'\nreturn TerrainTransitions;')();
  for (const values of [[11,12,12,11],[12,11,11,12],[13,14,14,13],[21,22,23,24]]) {
    const frames=art.layersFor(values);
    assert.eq(frames.length,1,'same material variations use one complete ground tile');
    assert.eq(frames[0],values[0]*16+15,'the first local variation remains the opaque base');
  }
});

// A player's stone fence once swapped its cell to a square rock texture
// beside transitioning ground. The ring itself now carries the rock.
test('terrain transitions: placed rocks join the material ring instead of a square fallback', () => {
  const ring=RENDER_SRC.slice(RENDER_SRC.indexOf('transitionMaterials.fill(-1);'),RENDER_SRC.indexOf('const VEIL = (c, r)'));
  assert.truthy(/placedRockSet\?\.has\(cellKeyFromAbsCell\(AX\(c,r\), AY\(c,r\)\)\)\) t = 10;/.test(ring),'placed rock is ring material');
  assert.falsy(/transitionsActive && type === T\(col, row\)/.test(RENDER_SRC),'drawing never bypasses the ring for an overridden type');
});

// The lattice hash's low bits are the cell parity, so a raw modulo tiled the
// two scrub (WASTELAND) and concrete (COMMERCIAL) materials as a checkerboard.
test('terrain transitions: two-material families scatter instead of alternating by cell parity', () => {
  const art=new Function(ALL_SRC['ground_materials.js']+'\n'+ALL_SRC['terrain_transitions.js']+'\nreturn TerrainTransitions;')();
  for (const type of [27,16]) {
    const [a]=GroundMaterials.terrainFamilies[type];
    let parityMatches=0,first=0,n=0;
    for (let x=0;x<48;x++) for (let y=0;y<48;y++) {
      const m=art.materialForGround(type,null,x,y); n++;
      if (m===a) first++;
      if ((m===a)===((x+y)%2===0)) parityMatches++;
    }
    assert.truthy(parityMatches/n>0.4&&parityMatches/n<0.6,'variant choice is independent of cell parity for terrain '+type);
    assert.truthy(first/n>0.35&&first/n<0.65,'both materials appear in similar measure for terrain '+type);
    assert.eq(art.materialForGround(type,null,7,9),art.materialForGround(type,null,7,9),'stable per world cell');
  }
  assert.truthy(/avalanche32\(h\) % spec\.variants/.test(RENDER_SRC),'biome texture variants use the mixed hash too');
});
