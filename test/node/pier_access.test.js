(function () {
  const W = WorldGen, N = 32, E = N * W.CELL_M;
  const p = (x,y) => ({x:(x+.5)*4096/N,y:(y+.5)*4096/N});
  const pier = tags => ({type:2,tags:{class:'pier',...tags},geom:[[p(4,16),p(27,16)]]});
  const tile = (features,poi=false) => W.rasterizeTile([
    {name:'transportation',features},
    ...(poi?[{name:'poi',features:[{type:1,tags:{class:'library'},geom:[[p(16,16)]]}]}]:[]),
  ],N,4,5615,E);
  test('pier access: affirmative pedestrian permission is required', () => {
    for(const tags of [{access:'yes'},{access:'public'},{foot:'yes'},{foot:'designated'}])
      assert.truthy(W.isPublicPier({class:'pier',...tags}),JSON.stringify(tags));
    for(const tags of [{},{name:'Public Pier'},{operator:'City of Kelowna'},
      {access:'permissive'},{access:'customers'},{access:'private',foot:'yes'},
      {access:'yes',foot:'no'},{access:'yes',foot:'customers'}])
      assert.falsy(W.isPublicPier({class:'pier',...tags}),JSON.stringify(tags));
  });
  test('pier access: private and unknown planks remain empty even beside a POI', () => {
    for(const tags of [{},{access:'private'},{access:'no'}]) {
      const r=tile([pier(tags)],true),i=16*N+16;
      assert.truthy(r.spawnWhy[i]&W.SPAWN_WHY.PIER_ACCESS,'source pier footprint stays blocked after POI paint');
      assert.truthy(W.landRefused(r.spawnWhy,i,[{ix:16,iy:16}],16,16),'POI cannot lift pier access');
      assert.falsy(r.objects.some(o=>Math.floor((o.x-4*E)/W.CELL_M)===16&&Math.floor((o.y-5615*E)/W.CELL_M)===16),'POI reward removed');
      for(const cls of Object.keys(W.SPAWN_CLASS_BLOCKS))
        assert.falsy(W.isSpawnCell(r.grid,N,N,16,16,{spawnWhy:r.spawnWhy,pois:[{ix:16,iy:16}]},cls),cls);
    }
  });
  test('pier access: public planks allow spawns and restrictions win overlaps', () => {
    const r=tile([pier({access:'yes'})]),i=16*N+16;
    assert.eq(r.grid[i],W.T.PIER);
    assert.falsy(r.spawnWhy[i]&W.SPAWN_WHY.PIER_ACCESS);
    assert.truthy(W.isSpawnCell(r.grid,N,N,16,16,{spawnWhy:r.spawnWhy},'minor'));
    assert.falsy(W.isSpawnCell(r.grid,N,N,16,16,null,'minor'),'no mask is not public evidence');
    for(const features of [[pier({}),pier({access:'yes'})],[pier({access:'yes'}),pier({})]]) {
      const blocked=tile(features);
      assert.truthy(blocked.spawnWhy[i]&W.SPAWN_WHY.PIER_ACCESS,'independent of feature order');
    }
  });
})();
