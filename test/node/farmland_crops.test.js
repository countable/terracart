// Field-edge crops use the ordinary generated wildplant stream, not saved
// player plants or soil beds. Drive the real rasterizer and shared farm gate.
(function () {
  const T = WorldGen.T, N = 64, edgeM = N * 7;
  const ring = [{x:512,y:512},{x:3584,y:512},{x:3584,y:3584},{x:512,y:3584}];
  const layers = [{name:'landuse',features:[{type:3,tags:{class:'farmland'},geom:[ring]}]}];
  const crops = BiomeProfiles.flora(T.FARMLAND).map(fl => fl.crop);
  test('farmland crops: T1-T2 ground plants have stable stages and stay on the open rim', () => {
    let count = 0, eligible = 0;
    const seen = new Set(), stages = new Set();
    for (let tx = 0; tx < 12; tx++) {
      const out = WorldGen.rasterizeTile(layers, N, tx, 5, edgeM);
      const plants = out.wildplants.filter(wp => crops.includes(wp.crop) && wp._biome === T.FARMLAND);
      const repeat = WorldGen.rasterizeTile(layers, N, tx, 5, edgeM);
      assert.eq(JSON.stringify(plants), JSON.stringify(repeat.wildplants.filter(wp => crops.includes(wp.crop) && wp._biome === T.FARMLAND)));
      for (let i = 0; i < out.grid.length; i++) {
        if (out.grid[i] === T.FARMLAND && WorldGen.isSpawnCell(out.grid,N,N,i%N,Math.floor(i/N),out,'minor')) eligible++;
      }
      for (const wp of plants) {
        count++; seen.add(wp.crop); stages.add(wp.stage);
        assert.eq(wp.kind, 'wildplant');
        assert.inRange(wp.stage, 0, MAX_GROWTH_STAGE);
        assert.falsy(wp.watered_t);
        assert.falsy(wp.bedQuality);
        const ix = Math.floor((wp.x - tx * edgeM) / 7), iy = Math.floor((wp.y - 5 * edgeM) / 7);
        assert.truthy(WorldGen.isSpawnCell(out.grid,N,N,ix,iy,out,'minor'), `${wp.id} obeys the shared gate`);
      }
    }
    assert.eq(seen.size, crops.length);
    assert.eq(stages.size, MAX_GROWTH_STAGE + 1);
    assert.inRange(count / eligible, .04, .12, 'modest scatter around 8% of eligible rim cells');
    for (const crop of crops) {
      assert.inRange(itemTierOf(crop), 1, 2);
      assert.truthy(BiomeProfiles.allows(crop,T.FARMLAND));
      assert.falsy(BiomeProfiles.allows(crop,T.GRASS), 'field crops do not spill beyond farmland');
    }
    assert.truthy(BiomeProfiles.allows('nut',T.FOREST), 'ordinary forest nuts keep their habitat');
  });
  test('farmland crops: final commercial overpaint cannot inherit staged field crops', () => {
    const commercial = [{x:512,y:512},{x:2048,y:512},{x:2048,y:3584},{x:512,y:3584}];
    const out = WorldGen.rasterizeTile(layers.concat([{name:'landuse',features:[
      {type:3,tags:{class:'commercial'},geom:[commercial]},
    ]}]), N, 3, 5, edgeM);
    assert.truthy(out.grid.includes(T.COMMERCIAL));
    for (const wp of out.wildplants.filter(wp => wp.stage != null)) {
      assert.eq(wp._biome, T.FARMLAND, 'wild crop stages belong to the surviving field terrain');
    }
  });
})();
