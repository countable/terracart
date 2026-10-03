(function () {
  const W=WorldGen, T=W.T, N=64, edge=N*W.CELL_M;
  const point=(x,y)=>({x:x*4096/N,y:y*4096/N});
  const rect=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(p=>point(...p));
  const school=(x,y)=>({name:'poi',features:[{type:1,tags:{class:'school'},geom:[[point(x,y)]]}]});
  function verify(out,n) {
    const indices=Array.from(out.syntheticBuildingCells.keys()).filter(i=>out.syntheticBuildingCells[i]);
    assert.gt(indices.length,0);
    const keys=new Set();
    for(const i of indices) {
      assert.eq(out.grid[i],T.BUILDING_LARGE);
      assert.gt(out.owners[i],0);
      assert.truthy(out.ownerKeys[out.owners[i]]);
      keys.add(out.ownerKeys[out.owners[i]]);
    }
    const towers=out.objects.filter(o=>o.kind==='tower'&&keys.has(o.castle));
    assert.gt(towers.length,0,'synthetic floor and turrets share claim identity');
    return {indices,keys,towers};
  }
  test('synthetic civic floor: a school without a polygon has an owned visible floor for its four turrets',()=>{
    const out=W.rasterizeTile([school(32,32)],N,0,0,edge), result=verify(out,N);
    assert.eq(result.indices.length,63);
    assert.eq(result.towers.length,4);
    assert.eq([...result.keys][0],'b_32_32');
    assert.eq(out.buildingShapes.length,0,'exact-cell fallback needs no invented polygon');
    const repeat=W.rasterizeTile([school(32,32)],N,0,0,edge*1.1);
    assert.eq(JSON.stringify(repeat.ownerKeys),JSON.stringify(out.ownerKeys),'save frame scale cannot reroll ownership');
    assert.eq(JSON.stringify(Array.from(repeat.syntheticBuildingCells)),JSON.stringify(Array.from(out.syntheticBuildingCells)));
  });
  test('synthetic civic floor: protected road, water and source buildings remain outside its mask',()=>{
    const layers=[
      {name:'water',features:[{type:3,tags:{class:'lake'},geom:[rect(29,30,1,1)]}]},
      {name:'transportation',features:[{type:2,tags:{class:'minor'},geom:[[point(34.5,25),point(34.5,40)]]}]},
      {name:'building',features:[{type:3,tags:{},geom:[rect(30,33,1,1)]}]}];
    const baseline=W.rasterizeTile(layers,N,0,0,edge);
    const out=W.rasterizeTile([...layers,school(32,32)],N,0,0,edge);verify(out,N);
    let checked=0;
    for(let y=29;y<=35;y++) for(let x=28;x<=36;x++) {
      const i=y*N+x, before=baseline.grid[i];
      if(before===T.WATER||W.isCobbleTerrain(before)||W.isBuildingTerrain(before)) {
        checked++;assert.eq(out.grid[i],before);assert.eq(out.syntheticBuildingCells[i],0);
        assert.eq(out.owners[i],baseline.owners[i]);
      }
    }
    assert.gt(checked,5);
  });
  test('synthetic civic floor: tile-edge clipping retains the source POI identity',()=>{
    const out=W.rasterizeTile([school(1,1)],N,0,0,edge), result=verify(out,N);
    assert.eq(result.indices.length,30,'only the six by five in-bounds cells are painted');
    assert.eq([...result.keys][0],'b_1_1','clipped centroid does not move the claim');
  });
  test('synthetic civic floor: Casorso school field fixture shares floor and tower ownership',()=>{
    const tx=2754,ty=5566,n=W.cellsPerEdgeForTile(ty);
    const out=W.rasterizeTile(MVT.decodeTile(FIXTURE_TILES[`${tx}_${ty}`]),n,tx,ty,W.tileEdgeMeters(W.latOfRowCentre(ty)));
    const expected=`b_${tx*n+Math.floor(1312*n/4096)}_${ty*n+Math.floor(3693*n/4096)}`;
    const result=verify(out,n);
    assert.truthy(result.keys.has(expected),'the reported school field owns a synthetic floor');
    assert.gt(result.towers.filter(o=>o.castle===expected).length,0);
  });
})();
