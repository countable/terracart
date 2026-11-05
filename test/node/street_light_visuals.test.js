(() => {
  function pixels(width, height, points) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (const [x,y,rgba] of points) data.set(rgba, (y * width + x) * 4);
    return data;
  }
  const at = (data, width, x, y) => Array.from(data.slice((y * width + x) * 4, (y * width + x + 1) * 4)).join(',');
  test('street light visuals: extinguished flames disappear while their bases stay intact', () => {
    for (const [name, flame, x, y] of [
      ['fire_pedestal',[255,195,25,255],7,8], ['flame_pillar',[255,255,153,255],7,9],
      ['upright_flame',[250,83,68,255],7,10], ['paired_candles',[255,255,255,255],3,2],
    ]) {
      const base = [76,56,44,255], data = pixels(16,32,[[x,y,flame],[7,29,base]]);
      StreetLights.statePixels(data,16,name,false);
      assert.eq(at(data,16,x,y),'0,0,0,0',name+': no visible flame remains');
      assert.eq(at(data,16,7,29),base.join(','),name+': contact ink is unchanged');
    }
  });
  test('street light visuals: dark glass and orbs retain alpha and leave posts unchanged', () => {
    for (const [name,width,height,x,y] of [
      ['hanging_lantern',32,32,20,15],['wooden_lantern',16,32,12,13],
      ['street_lantern',16,48,7,14],['tall_lantern',48,96,24,20],['green_orb',16,32,7,6],
    ]) {
      const data=pixels(width,height,[[x,y,[255,240,170,200]],[5,height-1,[92,66,46,255]]]);
      StreetLights.statePixels(data,width,name,false);
      const i=(y*width+x)*4;
      assert.lt(Math.max(data[i],data[i+1],data[i+2]),80,name+': emitter reads dark');
      assert.eq(data[i+3],200,name+': source alpha retained');
      assert.eq(at(data,width,5,height-1),'92,66,46,255',name+': post foot unchanged');
    }
    const data=pixels(16,48,[[7,14,[69,74,106,255]],[7,47,[163,167,194,255]]]);
    StreetLights.statePixels(data,16,'street_lantern',true);
    assert.eq(at(data,16,7,14),'255,222,151,255','cold source glass lights up');
    assert.eq(at(data,16,7,47),'163,167,194,255','lit source keeps its metal foot');
  });
  test('street light visuals: every theme selects separate states without changing seating scale', () => {
    for (const name of Object.keys(StreetLights.ART)) {
      const lit={_streetArt:name,lit:true}, dark={...lit,lit:false};
      assert.truthy(StreetLights.key(lit)!==StreetLights.key(dark));
      assert.eq(StreetLights.scale(lit),StreetLights.scale(dark));
      assert.eq(StreetLights.key({...dark,suppressed:true}),'rogue_lamp_unlit');
      assert.eq(StreetLights.key({...lit,suppressed:true}),'rogue_lamp');
    }
  });
})();
