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
