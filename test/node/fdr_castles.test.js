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
  test('FDR castles: clipped curtain bodies cannot paint over their own crowns at any heading', () => {
    const ringKey=points=>JSON.stringify(points.map(p=>[p.x,p.y]));
    for(const points of [L.rect(0,0,240,180),concave,concave.slice().reverse(),
      [{x:0,y:0},{x:180,y:20},{x:120,y:140},{x:-30,y:90}]]) {
      const gfx={clear(){},fillStyle(){},fillTriangle(){}};
      const scene={_headingUp:true,depth:0,mapRot:0,
        buildingWallContainer:{add(){}},add:{graphics:()=>gfx},
        textures:{exists:()=>true,get:()=>({})}};
      const group=WallPerspective.begin(scene,'castles');
      const {layout}=FDRCastleGeometry.draw(scene,'castles',points,{family:'citadel'});
      const edges=new Map(layout.walls.map(w=>[ringKey(w.points),w.edge]));
      for(const m of layout.merlons)edges.set(ringKey(m.points),m.edge);
      const retained=new Set(group.blocks);
      for(const degrees of [0,30,45,90,135,180,225,270,315]) {
        scene.mapRot=degrees*Math.PI/180;WallPerspective.update(scene);
        const lastBody=new Map(),firstCrown=new Map();
        group.blocks.forEach((block,index)=>{
          const edge=edges.get(ringKey(block.points));
          if(edge==null)return;
          if(block.top<=24)lastBody.set(edge,index);
          if(block.bottom===24&&!firstCrown.has(edge))firstCrown.set(edge,index);
        });
        assert.gt(firstCrown.size,0,'the fixture emits raised curtain crowns');
        for(const [edge,index] of firstCrown)
          assert.lt(lastBody.get(edge),index,`${degrees}° curtain ${edge}: every body/coping piece precedes its crowns`);
        assert.truthy(group.blocks.every(b=>retained.has(b)),'rotation reuses retained prisms');
      }
    }
  });
  test('FDR castles: a single halfway shade band follows each full wall height without UV seams', () => {
    const gfx={clear(){},fillStyle(){},fillTriangle(){}};
    for(const active of [true,false]) {
      const scene={_headingUp:true,depth:0,mapRot:0,buildingWallContainer:{add(){}},
        add:{graphics:()=>gfx},textures:{exists:()=>true,get:()=>({})}};
      const group=WallPerspective.begin(scene,'castles');
      FDRCastleGeometry.draw(scene,'castles',L.rect(0,0,240,180),{family:'citadel',active});
      // Curtain body, tower shaft, keep shaft: the surrounding base and roof
      // prisms must not introduce separate halfway bands.
      for(const [bottom,top,half] of [[0,22,12],[8,30,16],[8,46,24]]) {
        const blocks=group.blocks.filter(b=>b.bottom===bottom&&b.top===top);
        assert.gt(blocks.length,0,'representative wall structure is present');
        for(const block of blocks) {
          const sides=block.materialFaces.filter(f=>f.normal),lower=[],upper=[];
          for(const face of sides) {
            const zs=face.points.map(p=>p.z),lo=Math.min(...zs),hi=Math.max(...zs);
            assert.falsy(lo<half-1e-7&&hi>half+1e-7,'no triangle interpolates across the discrete shade step');
            (hi<=half+1e-7?lower:upper).push(face);
          }
          assert.gt(lower.length,0);assert.gt(upper.length,0);
          const lit=upper[0].color,dark=lower[0].color;
          assert.truthy(lower.every(f=>f.color===dark)&&upper.every(f=>f.color===lit),'each elevation band has one uniform tint');
          assert.lt(dark,lit,'lower half stays darker in both claim states');
          const boundary=faces=>faces.flatMap(f=>f.points).filter(p=>Math.abs(p.z-half)<1e-7);
          const below=boundary(lower),above=boundary(upper);
          const sameRepeat=(a,b)=>Math.abs(a-b)<1e-7||Math.abs(Math.abs(a-b)-112/512)<1e-7;
          assert.gt(below.length,0);
          for(const a of below)assert.truthy(above.some(b=>Math.hypot(a.x-b.x,a.y-b.y)<1e-7&&sameRepeat(a.u,b.u)&&sameRepeat(a.v,b.v)),'both bands meet at the same UV phase, including native tile wraps');
        }
      }
      for(const block of group.blocks.filter(b=>b.bottom===0&&b.top===8))
        assert.truthy(block.materialFaces.every(f=>f.color<0xffffff),'tower/keep bases inherit their full wall lower shade');
      const colors=group.blocks.flatMap(b=>b.materialFaces.map(f=>f.color)).join(',');
      for(const angle of [0,.7,Math.PI/2,Math.PI,Math.PI*1.5]) {
        scene.mapRot=angle;WallPerspective.update(scene);
        assert.eq(group.blocks.flatMap(b=>b.materialFaces.map(f=>f.color)).sort().join(','),colors.split(',').map(Number).sort().join(','),'heading changes visibility without moving the shade band');
      }
    }
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
  test('FDR castles: Canvas installs the complete camera matrix without composing it twice', () => {
    const previous=globalThis.Phaser,calls=[];
    const matrix={a:0,b:2,c:-2,d:0,e:100,f:200};
    globalThis.Phaser={GameObjects:{GetCalcMatrix:()=>({calc:matrix})}};
    const context={save(){},restore(){},getTransform:()=>({}),
      setTransform(...args){calls.push(['set',...args]);},transform(...args){calls.push(['compose',...args]);}};
    const target={_wallTriangles:[],_wallAtlas:{getSourceImage:()=>({width:512,height:512})},alpha:1};
    try { FDRCastleCanvas.attach(target);target.renderCanvas({currentContext:context},target,{alpha:1,addToRenderList(){}},null);
      assert.eq(JSON.stringify(calls),JSON.stringify([['set',0,2,-2,0,100,200]]));
    } finally { globalThis.Phaser=previous; }
  });
})();
