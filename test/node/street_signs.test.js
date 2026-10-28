(function () {
test('street signs: posts follow vector edges without snapping their feet to cell centres', () => {
  for (const angle of [0, Math.PI / 4, Math.PI / 2]) {
    const sign = {rec:{halfW:4},x:103,y:107,nx:Math.cos(angle),ny:Math.sin(angle)};
    const seats = StreetSigns.edgeSeats(sign, 7);
    seats.forEach((seat, i) => {
      const distance = (seat.x-sign.x)*sign.nx + (seat.y-sign.y)*sign.ny;
      assert.truthy(Math.abs(distance - (i ? -5.4 : 5.4)) < 1e-9);
      assert.eq(seat.ix, Math.floor(seat.x/7));
      assert.eq(seat.iy, Math.floor(seat.y/7));
    });
  }
});
test('street signs: directions describe only actual junction geometry', () => {
  const index = {mvtToM:1, lines:[
    {key:'a',variant:'hedgerow',line:[{x:100,y:100},{x:300,y:100}]},
    {key:'b',variant:'thorny',line:[{x:100,y:100},{x:100,y:300}]},
    {key:'far',variant:'pilgrim',line:[{x:900,y:900},{x:900,y:1200}]},
  ]};
  const sign = StreetSigns.candidates(index).find(s=>s.rec.key==='a');
  assert.truthy(sign.directions.some(d=>d.direction==='East'&&d.variant==='hedgerow'));
  assert.truthy(sign.directions.some(d=>d.direction==='South'&&d.variant==='thorny'));
  assert.falsy(sign.directions.some(d=>d.variant==='pilgrim'));
  const reversed = {...index,lines:index.lines.map(r=>({...r,line:r.line.slice().reverse()}))};
  assert.eq(JSON.stringify(StreetSigns.candidates(reversed).find(s=>s.rec.key==='a').directions),JSON.stringify(sign.directions));
});
test('street lamps: approved silhouettes retain restoration and suppression rules', () => {
  assert.eq(StreetLights.forVariant('hedgerow'),'hanging_lantern');
  assert.eq(StreetLights.forVariant('pilgrim'),'fire_pedestal');
  assert.eq(StreetLights.forVariant('poison_path'),'green_orb');
  assert.eq(StreetLights.forVariant('golden_path'),'paired_candles');
  assert.eq(StreetLights.forVariant('burned'),'flame_pillar');
  assert.eq(StreetLights.forVariant('fire_path'),'upright_flame');
  assert.truthy(StreetLights.ART.paired_candles.rise < StreetLights.ART.flame_pillar.rise, 'low candles emit nearer the ground than the standing pillar');
  for(const key of Object.keys(StreetLights.ART)) {
    assert.eq(StreetLights.key({_streetArt:key,lit:true}),'street_decor_'+key);
    assert.eq(StreetLights.key({_streetArt:key,lit:false}),'street_decor_'+key);
    assert.eq(StreetLights.key({_streetArt:key,lit:false,suppressed:true}),'rogue_lamp_unlit');
    let tint=null; StreetLights.after({setTint:n=>tint=n,clearTint:()=>tint=null},{_streetArt:key,lit:false});
    assert.truthy(tint);StreetLights.after({clearTint:()=>tint=null},{_streetArt:key,lit:true});assert.eq(tint,null);
  }
});
})();
