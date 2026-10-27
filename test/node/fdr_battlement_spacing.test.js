(function () {
  const L=FDRCastleLayout;
  const center=points=>points.reduce((p,q)=>({x:p.x+q.x/points.length,y:p.y+q.y/points.length}),{x:0,y:0});
  test('FDR battlements: native eight-pixel teeth and gaps keep their size on long walls', () => {
    for(const family of ['citadel','bastion','archive']) {
      const options={...CastleStyles.renderStyle(family,true).geometry,sectionLength:64};
      assert.eq(options.merlonPitch,16,'native curtain art repeats every sixteen game pixels');
      for(const width of [240,241,1024,12000]) {
        const layout=L.build(L.rect(0,0,width,120),options);
        assert.truthy(layout,`${family}: ${width}px curtain remains supported`);
        assert.eq(layout.pitch,16,'the perimeter budget never changes pitch');
        const teeth=layout.merlons.filter(m=>m.edge===0),centers=teeth.map(m=>center(m.points));
        assert.gt(teeth.length,5);
        for(let i=0;i<teeth.length;i++) {
          const p=teeth[i].points;
          assert.lt(Math.abs(Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y)-8),1e-6,'tooth width matches source artwork');
          if(i)assert.lt(Math.abs(Math.hypot(centers[i].x-centers[i-1].x,centers[i].y-centers[i-1].y)-16),1e-6,
            'successive supported teeth retain an eight-pixel open gap');
        }
        if(width===12000)assert.gt(layout.merlons.length,1000,'giant curtains add teeth instead of enlarging gaps');
      }
    }
  });
  test('FDR battlements: giant fixed-pitch layouts stay deterministic and bounded', () => {
    const points=L.rect(0,0,12000,120),options=CastleStyles.renderStyle('citadel').geometry;
    const layout=L.build(points,options),translated=L.build(points.map(p=>({x:p.x+15000,y:p.y-2000})),options);
    assert.lte(layout.merlons.length,L.LIMITS.merlons);
    assert.eq(layout.merlons.length,translated.merlons.length);
    for(let i=0;i<layout.merlons.length;i++) {
      const p=center(layout.merlons[i].points),q=center(translated.merlons[i].points);
      assert.lt(Math.abs(q.x-p.x-15000),1e-6);
      assert.lt(Math.abs(q.y-p.y+2000),1e-6);
    }
    const beyondBudget=L.rect(0,0,L.LIMITS.merlons*16,120);
    assert.eq(L.build(beyondBudget,options),null,'over-budget footprints use the existing tiled fallback instead of stretching teeth');
  });
  test('FDR towers: right-angle corners project a quarter cell outward without moving curtains', () => {
    const ring=L.rect(0,0,240,180),layout=L.build(ring,{towerWidth:32,towerBaseOutset:2});
    assert.eq(layout.towers.length,4);
    for(const tower of layout.towers) {
      assert.lt(Math.abs(Math.hypot(tower.outward.x,tower.outward.y)-8),1e-7);
      assert.lt(Math.abs(Math.abs(tower.outward.x)-8/Math.sqrt(2)),1e-7);
      assert.lt(Math.abs(Math.abs(tower.outward.y)-8/Math.sqrt(2)),1e-7);
      assert.truthy(L.contains(tower.seatPoints,ring),'original flared base fits before deliberate overhang');
      assert.falsy(L.contains(tower.basePoints,ring),'shifted base visibly projects beyond both walls');
      assert.eq(tower.angle,0);
      const source=layout.points[tower.corner];
      const prior=layout.points[(tower.corner+layout.points.length-1)%layout.points.length],next=layout.points[(tower.corner+1)%layout.points.length];
      assert.truthy(tower.basePoints.some(p=>PolygonGeometry.cross(prior,source,p)<-1));
      assert.truthy(tower.basePoints.some(p=>PolygonGeometry.cross(source,next,p)<-1));
      for(const wall of layout.walls){assert.truthy(L.contains(wall.points,ring));assert.falsy(L.overlap(wall.points,tower.points));}
    }
  });
  test('FDR towers: obtuse corners align to the longer adjoining curtain and remain deterministic', () => {
    const shape=[[0,0],[240,0],[180,180],[0,180]].map(([x,y])=>({x,y}));
    for(const rotation of [0,.37]) {
      const points=shape.map(p=>({x:p.x*Math.cos(rotation)-p.y*Math.sin(rotation),y:p.x*Math.sin(rotation)+p.y*Math.cos(rotation)}));
      const layout=L.build(points),shifted=L.build(points.map(p=>({x:p.x+1024,y:p.y-2048})));
      assert.eq(layout.towers.length,4);
      assert.eq(JSON.stringify(L.build(points.slice().reverse())),JSON.stringify(layout));
      let obtuse=0;
      for(let i=0;i<layout.towers.length;i++) {
        const tower=layout.towers[i],p=layout.points[tower.corner],previous=layout.points[(tower.corner+layout.points.length-1)%layout.points.length],next=layout.points[(tower.corner+1)%layout.points.length];
        const before={x:p.x-previous.x,y:p.y-previous.y},after={x:next.x-p.x,y:next.y-p.y};
        const long=Math.hypot(before.x,before.y)>Math.hypot(after.x,after.y)?before:after;
        const u={x:Math.cos(tower.angle),y:Math.sin(tower.angle)},parallel=Math.abs((u.x*long.x+u.y*long.y)/Math.hypot(long.x,long.y));
        assert.truthy(parallel<1e-6||Math.abs(parallel-1)<1e-6,'one square side follows the longer adjoining wall');
        if(before.x*after.x+before.y*after.y>1e-6) {
          obtuse++;
          const short=long===before?after:before,q=Math.abs((u.x*short.x+u.y*short.y)/Math.hypot(short.x,short.y));
          assert.gt(q,1e-3);assert.lt(q,1-1e-3,'the other wall meets the side at an angle');
        }
        for(const name of ['points','basePoints','seatPoints'])for(let j=0;j<4;j++){
          assert.lt(Math.abs(shifted.towers[i][name][j].x-tower[name][j].x-1024),1e-6);
          assert.lt(Math.abs(shifted.towers[i][name][j].y-tower[name][j].y+2048),1e-6);
        }
      }
      assert.gt(obtuse,0,'fixture exercises an obtuse corner');
    }
  });
  test('FDR towers: narrow wings retain curtains and shifted bases avoid unrelated notch edges', () => {
    assert.eq(L.build(L.rect(0,0,28,180)).towers.length,0,'a shift cannot make an undersized wing eligible');
    const points=[[0,0],[180,0],[180,180],[100,180],[100,45],[40,45],[40,180],[0,180]].map(([x,y])=>({x,y}));
    const layout=L.build(points);assert.gt(layout.towers.length,0);
    for(let i=0;i<layout.towers.length;i++) {
      const t=layout.towers[i];
      assert.truthy(L.contains(t.seatPoints,layout.points));
      for(let j=i+1;j<layout.towers.length;j++)assert.falsy(L.overlap(t.basePoints,layout.towers[j].basePoints));
      for(let edge=0;edge<layout.points.length;edge++) {
        if(edge===t.corner||edge===(t.corner+layout.points.length-1)%layout.points.length)continue;
        const a=layout.points[edge],b=layout.points[(edge+1)%layout.points.length];
        for(let k=0;k<4;k++) {
          const c=t.basePoints[k],d=t.basePoints[(k+1)%4],cross=PolygonGeometry.cross;
          assert.falsy(cross(a,b,c)*cross(a,b,d)<-1e-6&&cross(c,d,a)*cross(c,d,b)<-1e-6,'overhang cannot cross a non-adjoining boundary');
        }
      }
    }
  });
})();
