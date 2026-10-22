(function () {
  const L = FDRCastleLayout;
  const concave = [[-100,-80],[100,-80],[100,0],[0,0],[0,80],[-100,80]].map(([x,y])=>({x,y}));
  test('FDR castles: irregular walls and merlons remain contained and avoid tower intersections', () => {
    for (const points of [concave, L.rect(0,0,28,180), [{x:0,y:0},{x:180,y:20},{x:120,y:140},{x:-30,y:90}]]) {
      const layout = L.build(points);
      assert.truthy(layout);
      for (const wall of layout.walls) {
        assert.truthy(L.contains(wall.points, layout.points));
        for (const tower of layout.towers) assert.falsy(L.overlap(wall.points,tower.points));
      }
      for (const m of layout.merlons) {
        assert.truthy(L.contains(m.points,layout.points));
        assert.lt(Math.abs(m.coveredArea-64),1e-3,'merlon supported by wall');
        assert.eq(m.top-m.base,8,'physical crenellation height');
      }
      for (let i=0;i<layout.walls.length;i++) for(let j=i+1;j<layout.walls.length;j++)
        assert.falsy(L.overlap(layout.walls[i].points,layout.walls[j].points),'wall fragments do not interpenetrate');
    }
  });
  test('FDR castles: tiny and invalid footprints omit oversized structures safely', () => {
    const small=L.build(L.rect(0,0,4,4));
    assert.truthy(small);assert.eq(small.towers.length,0);assert.eq(small.keep,null);assert.eq(small.merlons.length,0);
    assert.eq(L.build([{x:0,y:0},{x:NaN,y:0},{x:1,y:1}]),null);
    assert.eq(L.build([{x:0,y:0},{x:5,y:0},{x:10,y:0}]),null);
    assert.eq(L.build([{x:0,y:0},{x:100,y:100},{x:0,y:100},{x:80,y:0}]),null);
  });
  test('FDR castles: winding and cyclic origin do not change layout', () => {
    const expected=JSON.stringify(L.build(concave));
    assert.eq(JSON.stringify(L.build(concave.slice().reverse())),expected);
    assert.eq(JSON.stringify(L.build(concave.slice(2).concat(concave.slice(0,2)))),expected);
  });
  test('FDR castles: off-grid translation preserves tower placement, keep and wall geometry', () => {
    const p=L.rect(.125,.375,240,180),a=L.build(p),dx=1234.375,dy=-749.125,b=L.build(p.map(v=>({x:v.x+dx,y:v.y+dy})));
    for(const key of ['walls','towers','merlons']) {
      assert.eq(a[key].length,b[key].length);
      a[key].forEach((part,i)=>part.points.forEach((v,j)=>{
        assert.lt(Math.abs(v.x+dx-b[key][i].points[j].x),1e-7);
        assert.lt(Math.abs(v.y+dy-b[key][i].points[j].y),1e-7);
      }));
    }
    assert.lt(Math.abs(a.keep.x+dx-b.keep.x),1e-7);
    assert.lt(Math.abs(a.keep.y+dy-b.keep.y),1e-7);
  });
  test('FDR castles: keep clearance is fully inside the courtyard and respects omission', () => {
    const layout=L.build(L.rect(0,0,240,180));assert.truthy(layout.keep);
    assert.truthy(L.contains(layout.keep.clearance,layout.points));
    for(const p of [...layout.walls,...layout.towers])assert.falsy(L.overlap(layout.keep.clearance,p.points));
    assert.eq(L.build(L.rect(0,0,240,180),{keep:false}).keep,null);
    assert.eq(L.build(L.rect(0,0,28,180)).keep,null);
  });
  test('FDR castles: stadium-sized footprints have bounded geometry independent of area', () => {
    const points=Array.from({length:64},(_,i)=>({x:10000*Math.cos(i*Math.PI/32),y:10000*Math.sin(i*Math.PI/32)}));
    const layout=L.build(points);assert.truthy(layout);
    assert.lte(layout.walls.length,L.LIMITS.pieces);assert.lte(layout.towers.length,L.LIMITS.towers);assert.lte(layout.merlons.length,L.LIMITS.merlons);
    assert.eq(L.build([...points,points[0]]),null,'oversized vertex input declines safely');
  });
  test('FDR castles: material UVs stay fixed on masonry when pixel origins move', () => {
    const oldView=WallPerspective.inView,oldPrism=WallPerspective.prism;
    WallPerspective.inView=()=>true;
    WallPerspective.prism=(scene,source,ring,bottom,top,colors,support,capped,options)=>scene._wallPerspective[source].blocks.push({materialFaces:options.materialFaces});
    const draw=(dx,dy)=>{
      const scene={_wallPerspective:{castles:{blocks:[]}},textures:{exists:()=>true,get:()=>({})}};
      FDRCastleGeometry.draw(scene,'castles',L.rect(dx,dy,200,160),{family:'citadel'});
      return scene._wallPerspective.castles.blocks.flatMap(b=>b.materialFaces.flatMap(f=>f.points));
    };
    try {
      const a=draw(0,0),b=draw(1234.375,-749.125);
      assert.eq(a.length,b.length);
      a.forEach((p,i)=>{assert.lt(Math.abs(p.u-b[i].u),1e-7);assert.lt(Math.abs(p.v-b[i].v),1e-7);});
    } finally { WallPerspective.inView=oldView;WallPerspective.prism=oldPrism; }
  });
  test('FDR castles: culled masses never append decals to absent geometry', () => {
    const old=WallPerspective.inView;
    WallPerspective.inView=()=>false;
    try {
      const scene={_wallPerspective:{castles:{blocks:[]}},textures:{exists:()=>true,get:()=>({})}};
      const result=FDRCastleGeometry.draw(scene,'castles',L.rect(0,0,240,180),{family:'citadel'});
      assert.truthy(result);assert.eq(result.blocksAdded,0);assert.eq(result.height,52);
    } finally { WallPerspective.inView=old; }
  });
})();
