(function () {
  const L = FDRCastleLayout;
  const concave = [[-100,-80],[100,-80],[100,0],[0,0],[0,80],[-100,80]].map(([x,y])=>({x,y}));
  function assertTowerOverhang(tower,points) {
    assert.truthy(L.contains(tower.seatPoints,points),'unshifted flared tower base fits its source corner');
    assert.lt(Math.abs(Math.hypot(tower.outward.x,tower.outward.y)-8),1e-6,'tower overhang is a quarter-cell displacement');
    for(let i=0;i<4;i++) {
      assert.lt(Math.abs(tower.basePoints[i].x-tower.seatPoints[i].x-tower.outward.x),1e-6);
      assert.lt(Math.abs(tower.basePoints[i].y-tower.seatPoints[i].y-tower.outward.y),1e-6);
    }
  }
  function allowedGround(points,towers,p) {
    return PolygonGeometry.pointInPolygon(points,p,1e-5)
      ||towers.some(t=>PolygonGeometry.pointInPolygon(t.basePoints,p,1e-5));
  }
  function meshScene() {
    const shutdown=[];
    return {_headingUp:true,depth:0,mapRot:0,buildingWallContainer:{add(){}},
      add:{graphics:()=>({clear(){},fillStyle(){},fillTriangle(){}})},
      textures:{exists:()=>true,get:()=>({})},events:{once(name,fn){if(name==='shutdown')shutdown.push(fn);}},
      shutdown(){for(const fn of shutdown)fn();}};
  }
  function meshDraw(scene,points,options={}) {
    WallPerspective.begin(scene,'castles');
    return FDRCastleGeometry.draw(scene,'castles',points,options);
  }
  function meshSignature(scene) {
    return JSON.stringify(scene._wallPerspective.castles.blocks.map(b=>({
      points:b.points,bottom:b.bottom,top:b.top,support:b.support,
      faces:b.materialFaces.map(f=>({points:f.points,normal:f.normal,color:f.color,material:f.material})),
    })));
  }
  test('FDR castles: giant curtain masonry repeats at a constant world scale', () => {
    // The perimeter budget makes these curtain sections longer than one atlas
    // tile. Their source-edge phases must not stretch or escape that tile.
    for(const family of ['citadel','bastion','archive'])for(const active of [true,false]) {
      const scene=meshScene(),style=CastleStyles.renderStyle(family,active);
      const model=meshDraw(scene,L.rect(0,0,12000,120),{family,active});
      assert.truthy(model,`${family}: giant footprint retains generated geometry`);
      let horizontalEdges=0;
      for(const block of scene._wallPerspective.castles.blocks)for(const face of block.materialFaces) {
        if(face.material!=='stone'||!face.normal||!face.points.every(p=>p.z>=4))continue;
        const center=face.points.reduce((sum,p)=>({u:sum.u+p.u/3,v:sum.v+p.v/3}),{u:0,v:0});
        const slot=Math.floor(center.u*4)+4*Math.floor(center.v*4);
        if(![style.masonrySlot,style.towerMasonrySlot].includes(slot))continue;
        for(const p of face.points) {
          assert.gte(p.u*512,slot%4*128+8-1e-7,'masonry stays inside its atlas gutter');
          assert.lte(p.u*512,slot%4*128+120+1e-7,'masonry never samples the neighboring tile');
          assert.gte(p.v*512,Math.floor(slot/4)*128+8-1e-7);
          assert.lte(p.v*512,Math.floor(slot/4)*128+120+1e-7);
        }
        for(let i=0;i<3;i++) {
          const a=face.points[i],b=face.points[(i+1)%3];
          const length=Math.hypot(b.x-a.x,b.y-a.y);
          if(Math.abs(a.z-b.z)>1e-7||length<1e-7)continue;
          horizontalEdges++;
          assert.lt(Math.abs(Math.abs(b.u-a.u)*512/length-.5),1e-7,
            `${family}/${active}: horizontal masonry uses 112 texels per 224 world pixels`);
        }
      }
      assert.gt(horizontalEdges,100,'long curtain faces are checked across multiple source phases');
    }
  });
  test('FDR castles: translated mesh reuse skips face triangulation and owns projection state', () => {
    const scene=meshScene(),points=L.rect(0,0,240,180),triangulate=PolygonGeometry.triangulate;
    let calls=0;PolygonGeometry.triangulate=(...args)=>{calls++;return triangulate(...args);};
    try {
      const original=meshDraw(scene,points,{family:'bastion',active:false});
      const before=calls;assert.gt(before,0);
      const expected=meshSignature(scene),blocks=scene._wallPerspective.castles.blocks.slice();
      scene.mapRot=1.2;WallPerspective.update(scene);
      const moved=meshDraw(scene,points.map(p=>({x:p.x+32.375,y:p.y-64.125})),{family:'bastion',active:false});
      assert.eq(calls,before,'walking reuses material triangles, UVs and decorations');
      assert.eq(scene._fdrCastleMeshCache.hits,1);
      assert.falsy(scene._wallPerspective.castles.blocks.some(b=>blocks.includes(b)),
        'the current projection cannot mutate a retained template or prior draw');
      assert.lt(Math.abs(moved.layout.towers[0].x-original.layout.towers[0].x-32.375),1e-7);
      original.layout.towers[0].height=-999;original.layout.points[0].x=-999;
      meshDraw(scene,points,{family:'bastion',active:false});
      assert.eq(meshSignature(scene),expected,'returned layouts and renderer writes cannot poison a cache hit');
    } finally { PolygonGeometry.triangulate=triangulate; }
  });
  test('FDR castles: warm meshes recull exposed walls and tower crowns at the current view', () => {
    const points=L.rect(0,0,240,180),scene=meshScene();
    Object.assign(scene,{viewLeft:-40,viewTop:-30,viewSize:160});
    for(const family of ['citadel','bastion','archive'])for(const active of [false,true]) {
      meshDraw(scene,points,{family,active});
      for(const [dx,dy] of [[32.375,-64.125],[-180,100],[250,-120],[0,0]]) {
        const moved=points.map(p=>({x:p.x+dx,y:p.y+dy}));
        meshDraw(scene,moved,{family,active});
        const fresh=meshScene();Object.assign(fresh,{viewLeft:-40,viewTop:-30,viewSize:160});
        meshDraw(fresh,moved,{family,active});
        assert.eq(meshSignature(scene),meshSignature(fresh),'cached culling and depth supports match a cold view');
      }
    }
  });
  test('FDR castles: mesh cache separates claims, families, keep choice and footprint edits', () => {
    const scene=meshScene(),points=L.rect(0,0,240,180);
    const original=meshDraw(scene,points,{family:'citadel',active:false});
    const first=meshSignature(scene);
    const restored=meshDraw(scene,points,{family:'citadel',active:true});
    assert.truthy(restored.active);assert.falsy(meshSignature(scene)===first);
    const archive=meshDraw(scene,points,{family:'archive',active:false});
    assert.eq(archive.family,'archive');assert.falsy(meshSignature(scene)===first);
    assert.eq(meshDraw(scene,points,{family:'citadel',active:false,keep:false}).layout.keep,null);
    const changed=points.map(p=>({...p}));changed[1].x+=1e-4;
    assert.gt(Math.abs(L.area(meshDraw(scene,changed,{family:'citadel',active:false}).footprint)-L.area(original.footprint)),.001);
    assert.eq(scene._fdrCastleMeshCache.misses,5);
    meshDraw(scene,points,{family:'citadel',active:false});
    assert.eq(meshSignature(scene),first,'restoring then wrecking returns the correct original material');
  });
  test('FDR castles: mesh cache bounds retained faces and releases them at scene shutdown', () => {
    const scene=meshScene();
    for(let i=0;i<FDRCastleGeometry.MESH_CACHE_LIMIT+3;i++) {
      meshDraw(scene,L.rect(0,0,160+i,120),{family:'bastion'});
      assert.lte(scene._fdrCastleMeshCache.entries.size,FDRCastleGeometry.MESH_CACHE_LIMIT);
      assert.lte(scene._fdrCastleMeshCache.faces,FDRCastleGeometry.MESH_CACHE_FACES);
    }
    const cache=scene._fdrCastleMeshCache;
    scene.shutdown();
    assert.eq(cache.entries.size,0);assert.eq(cache.faces,0);assert.eq(scene._fdrCastleMeshCache,null);
  });
  test('FDR castles: city-sized first paints keep viewport culling instead of caching unseen walls', () => {
    const scene=meshScene();Object.assign(scene,{viewLeft:-40,viewTop:-30,viewSize:160});
    assert.truthy(meshDraw(scene,L.rect(0,0,3000,2000),{keep:false}));
    assert.eq(scene._fdrCastleMeshCache,undefined);
    assert.eq(scene._wallPerspective.castles.blocks.length,0,'distant boundary and keep stay unbuilt');
  });
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
        assert.lt(Math.abs(m.coveredArea-9.6*8),1e-3,'merlon supported by wall');
        assert.lt(Math.abs(m.top-m.base-5.6),1e-7,'physical crenellation height');
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
  test('FDR castles: mapped Kelowna towers have only deliberate corner overhang and contained walls', () => {
    // Production MVT rings behind real tier-12 castles, including narrow wings
    // and two subpixel notches that previously extrapolated during clipping.
    const sites=[['2753_5565',6767333750,0,'citadel'],['2753_5565',179969990,329,'citadel'],
      ['2753_5565',179969990,1007,'archive'],['2754_5566',1513231130,673,'bastion'],
      ['2754_5567',2228921870,963,'archive'],['2754_5567',2228921870,979,'archive']];
    const tiles=new Map(),edge=WorldGen.tileEdgeMeters(49.8801),scale=32/(edge/225);
    for(const [tile,id,index,family] of sites) {
      if(!tiles.has(tile))tiles.set(tile,MVT.decodeTile(FIXTURE_TILES[tile]).find(l=>l.name==='building'));
      const layer=tiles.get(tile),source=layer.features.find(f=>f.id===id)?.geom[index];
      assert.truthy(source,`real mapped footprint ${tile}/${id}/${index} exists`);
      const coords=new Float32Array(source.flatMap(p=>[p.x/4096*edge,p.y/4096*edge]));
      const points=Array.from({length:coords.length/2},(_,i)=>({x:(coords[i*2]-coords[0])*scale,y:(coords[i*2+1]-coords[1])*scale}));
      for(const active of [true,false]) {
        const gfx={clear(){},fillStyle(){},fillTriangle(){}};
        const scene={_headingUp:true,depth:0,mapRot:0,buildingWallContainer:{add(){}},
          add:{graphics:()=>gfx},textures:{exists:()=>true,get:()=>({})}};
        const group=WallPerspective.begin(scene,'castles');
        const model=FDRCastleGeometry.draw(scene,'castles',points,{family,active});
        assert.truthy(model,`mapped ${family} ring keeps its generated castle`);
        for(const tower of model.layout.towers) {
          assertTowerOverhang(tower,points);
        }
        const ground=group.blocks.flatMap(b=>b.materialFaces.flatMap(f=>f.points)).filter(p=>p.z===0);
        assert.gt(ground.length,0);
        assert.truthy(ground.every(p=>allowedGround(points,model.layout.towers,p)),
          `${tile}/${id}/${index}: ground stays in the ring or an intentional tower base`);
        const retained=new Set(group.blocks);
        for(const heading of [0,17,73,135,211,315]) {
          scene.mapRot=heading*Math.PI/180;WallPerspective.update(scene);
          assert.truthy(group.blocks.every(b=>retained.has(b)&&[...b.projected].every(Number.isFinite)),
            'valid camera rotations retain finite geometry');
        }
      }
    }
  });
  test('FDR castles: tower foot clearance is part of the cached layout', () => {
    const points=L.rect(0,0,240,180);
    for(const outset of [0,2,0]) {
      const layout=L.build(points,{towerWidth:36,towerBaseOutset:outset});
      assert.eq(layout.towers.length,4);
      for(const t of layout.towers) {
        assertTowerOverhang(t,points);
        assert.lt(Math.abs(Math.hypot(t.basePoints[1].x-t.basePoints[0].x,t.basePoints[1].y-t.basePoints[0].y)-(36+outset*2)),1e-6);
      }
    }
  });
  test('FDR castles: translated complex rings reuse cached triangulation without hiding real edits', () => {
    const source=MVT.decodeTile(FIXTURE_TILES['2753_5565']).find(l=>l.name==='building')
      .features.find(f=>f.id===179969990).geom[1061];
    const edge=WorldGen.tileEdgeMeters(49.8801),scale=32/WorldGen.CELL_M;
    const coords=new Float32Array(source.flatMap(p=>[p.x/4096*edge,p.y/4096*edge]));
    const points=Array.from({length:coords.length/2},(_,i)=>({x:(coords[i*2]-coords[0])*scale,y:(coords[i*2+1]-coords[1])*scale}));
    const triangulate=PolygonGeometry.triangulate,options={sectionLength:61.23456789};
    let calls=0;
    PolygonGeometry.triangulate=(...args)=>{calls++;return triangulate(...args);};
    try {
      assert.truthy(L.build(points,options));
      assert.eq(calls,1,'first unique complex contour triangulates once');
      for(const [dx,dy] of [[0,0],[32,-64],[32.375,-64.125]]) {
        assert.truthy(L.build(points.map(p=>({x:p.x+dx,y:p.y+dy})),options));
        assert.eq(calls,1,'exact and translated rebuilds reuse the same triangulation');
      }
      const changed=points.map(p=>({...p}));changed[1].x+=1e-4;
      assert.truthy(L.build(changed,options));
      assert.eq(calls,2,'a meaningful subpixel boundary edit recomputes geometry');
    } finally { PolygonGeometry.triangulate=triangulate; }
  });
  test('FDR castles: cache normalization preserves meaningful subpixel footprint changes', () => {
    const original=L.rect(0,0,200,160),changed=original.map(p=>({...p}));
    changed[1].x+=1e-4;changed[2].x+=1e-4;
    const a=L.build(original),b=L.build(changed);
    assert.truthy(a);assert.truthy(b);
    assert.gt(Math.abs(L.area(a.points)-L.area(b.points)),.01,
      'a real 0.0001px boundary change must not reuse the previous cached contour');
    assert.lt(Math.abs(L.area(b.points)-L.area(changed)),1e-7);
    for(const p of b.walls)assert.truthy(L.contains(p.points,changed));
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
    assert.truthy(L.build([...points,points[0]]),'closed source rings normalize the repeated endpoint');
    const oversized=Array.from({length:L.LIMITS.vertices+1},(_,i)=>({x:10000*Math.cos(i*2*Math.PI/(L.LIMITS.vertices+1)),y:10000*Math.sin(i*2*Math.PI/(L.LIMITS.vertices+1))}));
    assert.eq(L.build(oversized),null,'input beyond the hard vertex budget declines safely');
  });
  test('FDR castles: translating a footprint preserves material layout and relative face geometry', () => {
    const draw=(dx,dy)=>{
      const gfx={clear(){},fillStyle(){},fillTriangle(){}};
      const scene={_headingUp:true,depth:0,mapRot:0,buildingWallContainer:{add(){}},
        add:{graphics:()=>gfx},textures:{exists:()=>true,get:()=>({})}};
      const group=WallPerspective.begin(scene,'castles');
      FDRCastleGeometry.draw(scene,'castles',L.rect(dx,dy,200,160),{family:'archive',active:true});
      return group.blocks.flatMap(b=>b.materialFaces);
    };
    const dx=1234.375,dy=-749.125,a=draw(0,0),b=draw(dx,dy);
    assert.eq(a.length,b.length);
    a.forEach((face,i)=>{
      assert.eq(face.material,b[i].material);assert.eq(face.color,b[i].color);
      face.points.forEach((p,j)=>{
        const q=b[i].points[j];
        assert.lt(Math.abs(p.x+dx-q.x),1e-7);assert.lt(Math.abs(p.y+dy-q.y),1e-7);
        assert.lt(Math.abs(p.z-q.z),1e-7);
        if(p.u!=null)assert.lt(Math.abs(p.u-q.u),1e-7);
        if(p.v!=null)assert.lt(Math.abs(p.v-q.v),1e-7);
      });
    });
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
  test('FDR castles: stone walls sample baked lighting from ground to crown without a tint step', () => {
    const luma=c=>(c>>16)*.299+((c>>8)&255)*.587+(c&255)*.114;
    for(const family of ['citadel','bastion','archive'])for(const active of [true,false]) {
      const gfx={clear(){},fillStyle(){},fillTriangle(){}};
      const scene={_headingUp:true,depth:0,mapRot:0,buildingWallContainer:{add(){}},
        add:{graphics:()=>gfx},textures:{exists:()=>true,get:()=>({})}};
      const group=WallPerspective.begin(scene,'castles');
      FDRCastleGeometry.draw(scene,'castles',L.rect(0,0,240,180),{family,active});
      const body=group.blocks.find(b=>b.bottom===0&&b.top===24);
      assert.truthy(body,'a full curtain body is present');
      const sides=body.materialFaces.filter(f=>f.material==='stone'&&f.normal);
      const lower=[],upper=[];
      for(const face of sides) {
        const zs=face.points.map(p=>p.z),lo=Math.min(...zs),hi=Math.max(...zs);
        assert.falsy(lo<4-1e-7&&hi>4+1e-7,'the existing flared base keeps its geometric height boundary');
        (hi<=4+1e-7?lower:upper).push(face);
      }
      assert.gt(lower.length,0,'the wall foot retains textured faces');
      assert.gt(upper.length,0,'the main wall remains visible above the basal band');
      for(const low of lower) {
        const lit=upper.filter(f=>Math.abs(f.normal.x-low.normal.x)<1e-7&&Math.abs(f.normal.y-low.normal.y)<1e-7);
        assert.gt(lit.length,0);
        // Wreck masonry reserves tint headroom for green plants; bare stone
        // is pre-darkened by the reciprocal amount in its shared atlas tile.
        assert.truthy(lit.every(f=>f.color===low.color),'lighting is baked into the texture, with no hard basal tint step');
      }
      for(const face of sides)for(const p of face.points){
        const slot=Math.floor(p.u*4)+4*Math.floor(p.v*4);
        assert.eq(slot,CastleStyles.renderStyle(family,active).masonrySlot,'stone remains textured down to the ground');
        assert.lt(Math.abs(p.v*512-(Math.floor(slot/4)*128+8+(1-p.z/64)*112)),1e-7,'baked lighting follows world height');
      }
      const byNormal=new Map();
      for(const face of upper) {
        const key=JSON.stringify(face.normal),colors=byNormal.get(key)||new Set();
        colors.add(face.color);byNormal.set(key,colors);
      }
      for(const colors of byNormal.values())assert.eq(colors.size,1,'the upper wall has no second horizontal shadow step');
      const caps=body.materialFaces.filter(f=>f.material==='stone'&&!f.normal&&f.points.every(p=>p.z===body.top));
      assert.gt(caps.length,0,'coping exposes a real upward-facing plane');
      assert.truthy(caps.every(f=>luma(f.color)>Math.max(...upper.map(q=>luma(q.color)/(CastleStyles.renderStyle(family,active).masonryLightGain*(active?1:CastleStyles.renderStyle(family,active).masonryWeatheredCompensation))))),'upward-facing surfaces are lit');
      const colors=group.blocks.flatMap(b=>b.materialFaces.map(f=>f.color)).sort((a,b)=>a-b).join(',');
      for(const angle of [0,.7,Math.PI/2,Math.PI,Math.PI*1.5]) {
        scene.mapRot=angle;WallPerspective.update(scene);
        assert.eq(group.blocks.flatMap(b=>b.materialFaces.map(f=>f.color)).sort((a,b)=>a-b).join(','),colors,
          'rotation only changes visibility, not the cel-shaded material values');
      }
    }
  });
  test('FDR castles: each keep has backed entrance art without a banner across the entrance', () => {
    for(const family of ['citadel','bastion','archive'])for(const active of [true,false]) {
      const gfx={clear(){},fillStyle(){},fillTriangle(){}};
      const scene={_headingUp:true,depth:0,mapRot:0,buildingWallContainer:{add(){}},
        add:{graphics:()=>gfx},textures:{exists:()=>true,get:()=>({})}};
      const group=WallPerspective.begin(scene,'castles');
      const {layout}=FDRCastleGeometry.draw(scene,'castles',L.rect(0,0,240,180),{family,active});
      const keep=layout.keep;assert.truthy(keep);
      const faces=group.blocks.filter(b=>Math.abs(b.x-keep.x)<1e-7&&Math.abs(b.y-keep.y)<1e-7).flatMap(b=>b.materialFaces);
      for(const material of ['door','door-seam','door-handle'])
        assert.gt(faces.filter(f=>f.material===material).length,0,`${family}: backed entrance retains ${material}`);
      const seam=faces.filter(f=>f.material==='door-seam').flatMap(f=>f.points);
      assert.eq(Math.min(...seam.map(p=>p.z)),0,'closed door seam reaches its threshold');
      assert.truthy(seam.every(p=>Math.abs(p.x-keep.x)<=.5),'closed door seam stays centered');
      for(const face of faces.filter(f=>f.material==='door')) {
        const center=face.points.reduce((sum,p)=>({u:sum.u+p.u/3,v:sum.v+p.v/3}),{u:0,v:0});
        assert.eq(Math.floor(center.u*4)+4*Math.floor(center.v*4),family==='archive'?5:2,
          'backed entrance artwork uses its family atlas frame');
        if(family!=='archive')for(const p of face.points){
          const x=268+(active?56:0),y=12+(family==='bastion'?56:0);
          assert.gte(p.u*512,x);assert.lte(p.u*512,x+48);
          assert.gte(p.v*512,y);assert.lte(p.v*512,y+48);
          assert.lte(Math.abs(p.x-keep.x),keep.width/2,'facade art stays inside the keep wall');
          assert.lte(p.z,keep.height,'facade art cannot float above its wall');
        }
      }
      assert.eq(faces.filter(f=>f.material==='banner').length,0,'no keep banner covers its entrance');
    }
  });
  test('FDR castles: Archive towers and keep use simple roofs in both states without timber frameworks', () => {
    for(const active of [true,false]) {
      const gfx={clear(){},fillStyle(){},fillTriangle(){}};
      const scene={_headingUp:true,depth:0,mapRot:0,buildingWallContainer:{add(){}},
        add:{graphics:()=>gfx},textures:{exists:()=>true,get:()=>({})}};
      const group=WallPerspective.begin(scene,'castles');
      const {layout}=FDRCastleGeometry.draw(scene,'castles',L.rect(0,0,240,180),{family:'archive',active});
      assert.truthy(layout.keep);
      for(const part of [...layout.towers,layout.keep]) {
        const faces=group.blocks.filter(b=>Math.abs(b.x-part.x)<1e-7&&Math.abs(b.y-part.y)<1e-7).flatMap(b=>b.materialFaces);
        const roof=faces.filter(f=>f.material==='roof');
        assert.eq(roof.length,4,'both conditions retain four roof planes');
        assert.eq(new Set(roof.map(f=>f.color)).size,roof.length,
          'each retained roof plane has its own flat cel value without adding triangles');
        for(const face of roof) {
          assert.eq(face.points.length,3);
          assert.truthy(face.points.some(p=>p.z>part.height),'the roof has a visible peak above the shaft');
          assert.truthy(face.points.every(p=>p.x>=part.x-part.width/2-1e-7&&p.x<=part.x+part.width/2+1e-7
            &&p.y>=part.y-part.depth/2-1e-7&&p.y<=part.y+part.depth/2+1e-7),'roof planes stay flush with square tower/keep walls');
        }
      }
      const faces=group.blocks.flatMap(b=>b.materialFaces);
      assert.falsy(faces.some(f=>/wood|timber|beam|rafter/i.test(f.material||'')),'Archive wood and frameworks are absent in both states');
      assert.eq(faces.filter(f=>f.material==='banner').length,0,'Archive has no book flag');
    }
  });
  test('FDR castles: intact military crowns have raised teeth on all four sides', () => {
    for(const family of ['citadel','bastion']) {
      const gfx={clear(){},fillStyle(){},fillTriangle(){}};
      const scene={_headingUp:true,depth:0,mapRot:0,buildingWallContainer:{add(){}},
        add:{graphics:()=>gfx},textures:{exists:()=>true,get:()=>({})}};
      const group=WallPerspective.begin(scene,'castles');
      const {layout}=FDRCastleGeometry.draw(scene,'castles',L.rect(0,0,240,180),{family,active:true});
      for(const part of [...layout.towers,layout.keep]) {
        const shaft=group.blocks.find(b=>b.bottom===0&&b.top===part.height
          &&Math.abs(b.x-part.x)<1e-7&&Math.abs(b.y-part.y)<1e-7);
        assert.truthy(shaft);
        const teeth=group.blocks.filter(b=>b.support===shaft.support&&b.bottom===part.height&&b.top>part.height);
        const sides=new Set();
        for(const tooth of teeth) {
          const c=Math.cos(part.angle||0),s=Math.sin(part.angle||0),wx=tooth.x-part.x,wy=tooth.y-part.y;
          const dx=wx*c+wy*s,dy=-wx*s+wy*c;
          if(Math.abs(dx)<=part.width/4&&dy<-part.depth/3)sides.add('back');
          if(Math.abs(dx)<=part.width/4&&dy>part.depth/3)sides.add('front');
          if(Math.abs(dy)<=part.depth/4&&dx<-part.width/3)sides.add('left');
          if(Math.abs(dy)<=part.depth/4&&dx>part.width/3)sides.add('right');
          assert.truthy(tooth.materialFaces.some(f=>!f.normal&&f.points.every(p=>p.z===tooth.top)),
            'each tooth has a real lit top plane');
        }
        for(const tooth of teeth){
          assert.lt(Math.abs(Math.abs(L.area(tooth.points))-9.6*8),1e-6,'crown teeth are twenty percent wider along the row');
          assert.lt(Math.abs(tooth.top-tooth.bottom-5.6),1e-6,'restored crown teeth are thirty percent shorter');
          assert.falsy(teeth.some(other=>other!==tooth&&L.overlap(tooth.points,other.points)),'corner rows cannot overlap');
        }
        const c=Math.cos(part.angle||0),s=Math.sin(part.angle||0);
        const centers=teeth.map(t=>({x:(t.x-part.x)*c+(t.y-part.y)*s,y:-(t.x-part.x)*s+(t.y-part.y)*c}));
        for(const side of [-1,1]){
          const row=centers.filter(p=>Math.abs(p.y-side*(part.depth/2-4))<1e-6).sort((a,b)=>a.x-b.x);
          for(let i=1;i<row.length;i++)assert.lt(Math.abs(row[i].x-row[i-1].x-16),1e-6,'tower and wide keep rows repeat at the same pitch');
        }
        assert.eq([...sides].sort().join(','),'back,front,left,right',
          `${family}: tower and keep crowns remain complete from every camera heading`);
      }
    }
  });
  test('FDR castles: Bastion plinths taper into the exact wall-cutout shaft using existing basal faces', () => {
    for(const active of [true,false]) {
      const gfx={clear(){},fillStyle(){},fillTriangle(){}};
      const scene={_headingUp:true,depth:0,mapRot:0,buildingWallContainer:{add(){}},
        add:{graphics:()=>gfx},textures:{exists:()=>true,get:()=>({})}};
      const group=WallPerspective.begin(scene,'castles');
      const {layout}=FDRCastleGeometry.draw(scene,'castles',L.rect(0,0,240,180),{family:'bastion',active});
      for(const part of layout.towers) {
        const shaft=group.blocks.find(b=>b.bottom===0&&b.top===part.height
          &&Math.abs(b.x-part.x)<1e-7&&Math.abs(b.y-part.y)<1e-7);
        const sides=shaft.materialFaces.filter(f=>f.material==='stone'&&f.normal);
        const foot=sides.flatMap(f=>f.points).filter(p=>p.z===0);
        const above=sides.flatMap(f=>f.points).filter(p=>p.z>=4);
        for(const face of sides)for(let j=0;j<3;j++){
          const a=face.points[j],b=face.points[(j+1)%3];
          if(Math.abs(a.z-b.z)>1e-7)continue;
          const span=Math.hypot(b.x-a.x,b.y-a.y);
          if(span>1e-7)assert.lt(Math.abs(Math.abs(b.u-a.u)*512/span-.5),1e-7,'flared ground courses keep the same brick width as the shaft');
        }
        assert.eq(sides.filter(f=>f.points.every(p=>p.z<=4)).length,8,
          'four tapered basal quads reuse eight triangles rather than adding a plinth mesh');
        for(const p of above) {
          const dx=Math.abs(p.x-part.x),dy=Math.abs(p.y-part.y);
          assert.truthy(dx<=part.width/2+1e-7&&dy<=part.depth/2+1e-7
            &&(Math.abs(dx-part.width/2)<1e-7||Math.abs(dy-part.depth/2)<1e-7),
          'at z4 and above the shaft fills its exact curtain cutout, with no inset slots');
        }
        for(const [axis,size] of [['x',part.width],['y',part.depth]]) {
          assert.lt(Math.abs(Math.min(...foot.map(p=>p[axis]))-(part[axis]-size/2-2)),1e-7);
          assert.lt(Math.abs(Math.max(...foot.map(p=>p[axis]))-(part[axis]+size/2+2)),1e-7,
            'the foot extends only two pixels beyond the shaft');
        }
      }
    }
  });
  test('FDR castles: wreck curtain teeth always have full-height support under their complete footprint', () => {
    const key=points=>JSON.stringify(points.map(p=>[p.x,p.y]));
    for(const family of ['citadel','bastion','archive'])for(const points of [L.rect(0,0,240,180),concave,
      [{x:0,y:0},{x:180,y:20},{x:120,y:140},{x:-30,y:90}]]) {
      const gfx={clear(){},fillStyle(){},fillTriangle(){}};
      const scene={_headingUp:true,depth:0,mapRot:0,buildingWallContainer:{add(){}},
        add:{graphics:()=>gfx},textures:{exists:()=>true,get:()=>({})}};
      const group=WallPerspective.begin(scene,'castles');
      const {layout}=FDRCastleGeometry.draw(scene,'castles',points,{family,active:false});
      const restored=meshScene();
      const restoredModel=meshDraw(restored,points,{family,active:true});
      const geometry=blocks=>JSON.stringify(blocks.map(b=>({points:b.points,bottom:b.bottom,top:b.top})));
      assert.eq(geometry(group.blocks),geometry(restored._wallPerspective.castles.blocks),
        'wreck and restored castles retain identical walls, towers and battlements');
      assert.eq(layout.keep?.height,restoredModel.layout.keep?.height,'keep height is condition independent');
      const wallKeys=new Set(layout.walls.map(w=>key(w.points)));
      const walls=group.blocks.filter(b=>b.bottom===0&&wallKeys.has(key(b.points)));
      assert.truthy(walls.every(b=>b.top===24),'wreck curtains retain their full height');
      let raised=0;
      for(const merlon of layout.merlons) {
        const tooth=group.blocks.find(b=>b.bottom===merlon.base&&b.top===merlon.top&&key(b.points)===key(merlon.points));
        assert.truthy(tooth,'wrecks retain every full-height curtain tooth');
        raised++;
        const footprintArea=Math.abs(L.area(tooth.points));let supported=0;
        for(const wall of walls) {
          const overlap=Math.abs(L.area(L.intersect(tooth.points,wall.points)));
          if(overlap<1e-7)continue;
          assert.gte(wall.top,tooth.bottom,'no tooth floats above a lowered curtain fragment');
          supported+=overlap;
        }
        assert.lt(Math.abs(supported-footprintArea),1e-3,'the entire raised tooth remains supported');
      }
      assert.gt(raised,0,'the fixture contains supported battlements');
    }
  });
  test('FDR castles: ruin weathering stays in shared textures rather than extra moss geometry', () => {
    const atlasSlot=face=>{
      const center=face.points.reduce((sum,p)=>({u:sum.u+p.u/3,v:sum.v+p.v/3}),{u:0,v:0});
      return Math.floor(center.u*4)+4*Math.floor(center.v*4);
    };
    for(const family of ['citadel','bastion','archive'])for(const active of [true,false]) {
      const gfx={clear(){},fillStyle(){},fillTriangle(){}};
      const scene={_headingUp:true,depth:0,mapRot:0,buildingWallContainer:{add(){}},
        add:{graphics:()=>gfx},textures:{exists:()=>true,get:()=>({})}};
      const group=WallPerspective.begin(scene,'castles');
      const {layout}=FDRCastleGeometry.draw(scene,'castles',L.rect(0,0,240,180),{family,active});
      const faces=group.blocks.flatMap(b=>b.materialFaces);
      const upperStone=faces.filter(f=>f.material==='stone'&&f.normal&&f.points.every(p=>p.z>=4));
      assert.gt(upperStone.length,0);
      const style=CastleStyles.renderStyle(family,active);
      const parts=[...layout.towers,...(layout.keep?[layout.keep]:[])];
      for(const block of group.blocks){
        const shaft=block.bottom===0&&parts.some(p=>Math.abs(block.x-p.x)<1e-7&&Math.abs(block.y-p.y)<1e-7);
        const slot=shaft?style.towerMasonrySlot:style.masonrySlot;
        for(const face of block.materialFaces.filter(f=>f.material==='stone'&&f.normal&&f.points.every(p=>p.z>=4))){
          assert.eq(atlasSlot(face),slot,'shaft and curtain materials follow their family and condition');
          for(const p of face.points){
            assert.gte(p.u*512,slot%4*128+8-1e-7);
            assert.lte(p.u*512,slot%4*128+120+1e-7);
            assert.gte(p.v*512,Math.floor(slot/4)*128+8-1e-7);
            assert.lte(p.v*512,Math.floor(slot/4)*128+120+1e-7);
          }
        }
      }
      assert.falsy(faces.some(f=>/moss|ivy|vegetation/.test(f.material||'')),
        'surface weathering does not introduce modeled vegetation');
    }
  });
  test('FDR castles: three visual families preserve legacy quest identities and lighten after restoration', () => {
    const luma=c=>(c>>16)*.299+((c>>8)&255)*.587+(c&255)*.114;
    const rendered=new Set();
    for(let i=0;i<100;i++) {
      const key=`castle_${i}`,legacy=CastleStyles.variantFor(key);
      const lit=CastleStyles.renderStyle(key,true),wreck=CastleStyles.renderStyle(key,false);
      const expected=legacy==='ruin'?'bastion':legacy;
      assert.eq(lit.id,expected);assert.eq(wreck.id,expected);rendered.add(lit.id);
      assert.eq(CastleStyles.get(key).id,legacy,'render aliases do not rewrite gameplay identity');
      assert.eq(CastleStyles.questTypeFor(key,legacy),CastleStyles.questTypeFor(key),
        'family rendering never reroutes the historical quest');
      assert.gt(luma(lit.wall),luma(wreck.wall),'restoration lightens walls in every visual family');
      assert.gt(luma(lit.top),luma(lit.wall),'upward-facing stone has a lighter material value');
      assert.eq(JSON.stringify(lit.geometry),JSON.stringify(wreck.geometry),'condition preserves family proportions');
    }
    assert.eq([...rendered].sort().join(','),'archive,bastion,citadel');
    assert.eq(CastleStyles.renderStyle('ruin').id,'bastion','old ruins use Bastion architecture');
    const citadel=CastleStyles.renderStyle('citadel'),bastion=CastleStyles.renderStyle('bastion'),archive=CastleStyles.renderStyle('archive');
    assert.gt(citadel.geometry.towerHeight,bastion.geometry.towerHeight,'Citadel towers remain imposing');
    assert.gt(bastion.geometry.towerWidth,citadel.geometry.towerWidth,'Bastion towers have broader square masses');
    assert.gt(archive.geometry.roofHeight,0,'Archive keeps its roof silhouette');
  });
  test('FDR castles: alternating family draws retain their own dimensions and narrow keep clearance', () => {
    for(const family of ['citadel','bastion','archive','bastion','citadel']) {
      const gfx={clear(){},fillStyle(){},fillTriangle(){}};
      const scene={_headingUp:true,depth:0,mapRot:0,buildingWallContainer:{add(){}},
        add:{graphics:()=>gfx},textures:{exists:()=>true,get:()=>({})}};
      WallPerspective.begin(scene,'castles');
      const result=FDRCastleGeometry.draw(scene,'castles',L.rect(0,0,240,180),{family,active:true});
      const expected=CastleStyles.renderStyle(family).geometry;
      assert.eq(result.family,family);assert.truthy(result.layout.keep);
      for(const tower of result.layout.towers) {
        assert.eq(tower.width,expected.towerWidth);assert.eq(tower.depth,expected.towerWidth,'tower footprint stays square');
        assert.eq(tower.height,expected.towerHeight);
      }
      assert.eq(result.layout.keep.height,expected.keepHeight);
      for(const part of [...result.layout.towers,result.layout.keep])
        assert.gte(result.height,part.height+expected.roofHeight,'reported bounds include the complete roof');
      const narrow=FDRCastleGeometry.draw(scene,'castles',L.rect(0,0,240,52),{family,active:true});
      assert.eq(narrow.layout.keep,null,'narrow sites do not acquire an oversized family keep');
    }
  });
  test('FDR castles: culled masses never append decals to absent geometry', () => {
    const old=WallPerspective.inView;
    WallPerspective.inView=()=>false;
    try {
      const scene={_wallPerspective:{castles:{blocks:[]}},textures:{exists:()=>true,get:()=>({})}};
      const result=FDRCastleGeometry.draw(scene,'castles',L.rect(0,0,240,180),{family:'citadel'});
      assert.truthy(result);assert.eq(result.blocksAdded,0);assert.gt(result.height,0);
    } finally { WallPerspective.inView=old; }
  });
  test('FDR castles: Canvas fills white-patch materials without allocating tinted atlas copies', () => {
    const previous={Phaser:globalThis.Phaser,Path2D:globalThis.Path2D,document:globalThis.document};
    let allocations=0,images=0,affines=0;const fills=[];
    const matrix={a:1,b:0,c:0,d:1,e:0,f:0};
    globalThis.Phaser={GameObjects:{GetCalcMatrix:()=>({calc:matrix})}};
    globalThis.Path2D=class { moveTo(){} lineTo(){} closePath(){} };
    globalThis.document={createElement(){allocations++;throw Error('flat castle colors must not allocate Canvas textures');}};
    const context={save(){},restore(){},setTransform(){},getTransform:()=>({}),
      beginPath(){},moveTo(){},lineTo(){},closePath(){},clip(){},
      transform(){affines++;},drawImage(){images++;},
      fill(){fills.push({color:this.fillStyle,alpha:this.globalAlpha});}};
    const texture={getSourceImage:()=>({width:512,height:512})};
    const uv=z=>[{x:0,y:0,z,u:498/512,v:498/512},{x:24,y:0,z,u:502/512,v:498/512},
      {x:24,y:12,z,u:502/512,v:502/512}];
    const target={_wallAtlas:texture,alpha:.8,_wallTriangles:[
      {points:[{x:0,y:0},{x:24,y:0},{x:24,y:12}],uv:uv(4),color:0xc2c1b8,alpha:1},
      {points:[{x:30,y:0},{x:54,y:0},{x:54,y:12}],uv:uv(10),color:0x4d8293,alpha:1},
    ]};
    try {
      FDRCastleCanvas.attach(target);
      target.renderCanvas({currentContext:context},target,{alpha:.5,addToRenderList(){}},null);
      assert.eq(fills.length,2,'both lit top and roof colors remain visible');
      assert.eq(fills.map(f=>f.color).join(','),'#c2c1b8,#4d8293');
      assert.truthy(fills.every(f=>Math.abs(f.alpha-.4)<1e-7),'solid fills retain object and camera alpha');
      assert.eq(images,0);assert.eq(affines,0,'flat colors skip affine texture mapping');
      assert.eq(allocations,0,'new solid palette colors do not allocate 512px tinted copies');
      assert.falsy(texture._wallTintSources,'white-patch materials never enter the tint cache');
    } finally {
      for(const [key,value] of Object.entries(previous)) {
        if(value===undefined)delete globalThis[key];else globalThis[key]=value;
      }
    }
  });
  test('FDR castles: Canvas closes coping triangles without treating banner cloth as opaque', () => {
    const previous={Phaser:globalThis.Phaser,Path2D:globalThis.Path2D};
    const matrix={a:1,b:0,c:0,d:1,e:0,f:0};
    const identity={transformPoint:p=>({...p}),inverse(){return this;}};
    globalThis.Phaser={GameObjects:{GetCalcMatrix:()=>({calc:matrix})}};
    globalThis.Path2D=class {moveTo(){} lineTo(){} closePath(){}};
    const context={save(){},restore(){},setTransform(){},getTransform:()=>identity,
      beginPath(){},moveTo(){},lineTo(){},closePath(){},clip(){},transform(){},drawImage(){},fill(){}};
    const triangles=[];
    for(const [offset,rect] of [[0,[394,488,410,500]],[20,[392,392,504,481.6]],[40,[418,488,434,500]],[60,[268,12,316,60]]]){
      const points=[{x:offset,y:0,z:0},{x:offset+8,y:0,z:0},{x:offset+8,y:6,z:0},{x:offset,y:6,z:0}];
      const [left,top,right,bottom]=rect,uv=[[left,top],[right,top],[right,bottom],[left,bottom]];
      for(const indices of [[0,1,2],[0,2,3]])triangles.push({points:indices.map(i=>points[i]),
        uv:indices.map(i=>({...points[i],u:uv[i][0]/512,v:uv[i][1]/512})),color:0xffffff,alpha:1});
    }
    const target={alpha:1,_wallAtlas:{getSourceImage:()=>({width:512,height:512})},_wallTriangles:triangles};
    try {
      FDRCastleCanvas.attach(target);
      target.renderCanvas({currentContext:context},target,{alpha:1,addToRenderList(){}},null);
      const shared=target._fdrCanvasEdgeCache.shared;
      assert.truthy(shared[0][2]&&shared[1][0],'opaque coping covers its internal diagonal');
      assert.truthy(shared[4][2]&&shared[5][0],'opaque worn coping covers its internal diagonal');
      assert.truthy(shared[6][2]&&shared[7][0],'binary-alpha keep facade covers only its internal diagonal');
      assert.falsy(shared[6][0]||shared[6][1]||shared[7][1]||shared[7][2],'keep facade exterior edges retain exact clips');
      assert.falsy(shared[2].some(Boolean)||shared[3].some(Boolean),'transparent banner retains exact clips');
    } finally {
      for(const [key,value] of Object.entries(previous)) {
        if(value===undefined)delete globalThis[key];else globalThis[key]=value;
      }
    }
  });
  test('FDR castles: textured roof seams close without expanding the pale cap past the eaves', () => {
    const previous={Phaser:globalThis.Phaser,Path2D:globalThis.Path2D};
    const matrix={a:1,b:0,c:0,d:1,e:0,f:0};
    const identity={transformPoint:p=>({...p}),inverse(){return this;}};
    globalThis.Phaser={GameObjects:{GetCalcMatrix:()=>({calc:matrix})}};
    globalThis.Path2D=class {moveTo(){} lineTo(){} closePath(){}};
    const context={save(){},restore(){},setTransform(){},getTransform:()=>identity,
      beginPath(){},moveTo(){},lineTo(){},closePath(){},clip(){},transform(){},drawImage(){},fill(){}};
    const a={x:0,y:0,z:0},b={x:10,y:0,z:0},c={x:10,y:10,z:0},peak={x:5,y:5,z:6};
    const roofUV=[[8,376],[120,376],[64,264]],flatUV=[[498,498],[502,498],[502,502]];
    const face=(points,uv)=>({points:points.map(p=>({x:p.x,y:p.y-p.z})),
      uv:points.map((p,i)=>({...p,u:uv[i][0]/512,v:uv[i][1]/512})),color:0xffffff,alpha:1});
    const target={alpha:1,_wallAtlas:{getSourceImage:()=>({width:512,height:512})},
      _wallTriangles:[face([a,b,peak],roofUV),face([b,c,peak],roofUV),face([a,b,c],flatUV)]};
    try {
      FDRCastleCanvas.attach(target);
      target.renderCanvas({currentContext:context},target,{alpha:1,addToRenderList(){}},null);
      const shared=target._fdrCanvasEdgeCache.shared;
      assert.truthy(shared[0][1]&&shared[1][2],'adjacent roof slopes cover their common ridge');
      assert.falsy(shared[0][0]||shared[1][0],'roof eaves remain exact exterior edges');
      assert.falsy(shared[2].some(Boolean),'the pale underlying cap cannot bleed past the roof');
    } finally {
      for(const [key,value] of Object.entries(previous)) {
        if(value===undefined)delete globalThis[key];else globalThis[key]=value;
      }
    }
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
  test('FDR castles: all 26 formerly rejected mapped complex castles produce bounded contained meshes', () => {
    // Exact decoded source rings for every >64-vertex ordinary tier-12 castle
    // in the nine checked-in Kelowna tiles. No invented or simplified footprint.
    const sites=[
      ["2753_5565",179969990,1061,"archive","b_619616_1252140"],
      ["2753_5566",1762765930,142,"archive","b_619601_1252449"],
      ["2753_5567",2228921780,114,"bastion","b_619607_1252718"],
      ["2753_5567",2228921780,144,"bastion","b_619642_1252651"],
      ["2754_5565",29572670,139,"archive","b_619704_1252171"],
      ["2754_5565",29572670,260,"bastion","b_619743_1252148"],
      ["2754_5565",29572670,299,"bastion","b_619713_1252195"],
      ["2754_5565",29572670,300,"citadel","b_619710_1252201"],
      ["2754_5565",29572670,341,"bastion","b_619711_1252228"],
      ["2754_5565",29572670,1265,"bastion","b_619788_1252257"],
      ["2754_5565",29572670,1321,"archive","b_619790_1252280"],
      ["2754_5565",29572670,2205,"archive","b_619769_1252198"],
      ["2754_5566",1513231130,252,"archive","b_619688_1252448"],
      ["2754_5566",1513231130,261,"bastion","b_619672_1252423"],
      ["2754_5566",1513231130,287,"archive","b_619661_1252443"],
      ["2754_5566",1513231130,288,"citadel","b_619674_1252448"],
      ["2754_5566",1513231130,692,"archive","b_619764_1252555"],
      ["2754_5566",1513231130,997,"archive","b_619763_1252570"],
      ["2754_5566",1513231130,1038,"archive","b_619874_1252421"],
      ["2754_5566",1513231130,1052,"archive","b_619810_1252449"],
      ["2754_5567",2228921870,250,"bastion","b_619746_1252580"],
      ["2754_5567",2228921870,478,"bastion","b_619661_1252669"],
      ["2754_5567",2228921870,616,"archive","b_619703_1252701"],
      ["2754_5567",2228921870,625,"bastion","b_619697_1252717"],
      ["2755_5565",851036940,329,"archive","b_620075_1252150"],
      ["2755_5566",6757291610,63,"citadel","b_619879_1252421"]
    ];
    assert.eq(sites.length,26);
    const tiles=new Map(),edge=WorldGen.tileEdgeMeters(49.8801),scale=32/WorldGen.CELL_M;
    for(const [tile,id,index,family,key] of sites) {
      if(!tiles.has(tile))tiles.set(tile,MVT.decodeTile(FIXTURE_TILES[tile]).find(l=>l.name==='building'));
      const source=tiles.get(tile).features.find(f=>f.id===id)?.geom[index];
      assert.truthy(source,`${key}: original mapped ring exists`);
      assert.gt(source.length,64);
      const coords=new Float32Array(source.flatMap(p=>[p.x/4096*edge,p.y/4096*edge]));
      const points=Array.from({length:coords.length/2},(_,i)=>({x:(coords[i*2]-coords[0])*scale,y:(coords[i*2+1]-coords[1])*scale}));
      const options={...CastleStyles.renderStyle(family,true).geometry,sectionLength:64,towerBaseOutset:family==='bastion'?2:0};
      const layout=L.build(points,options);
      assert.truthy(layout,`${key}: complex mapped ring must use generated castle geometry`);
      assert.lte(layout.walls.length,L.LIMITS.pieces);
      assert.lte(layout.towers.length,L.LIMITS.towers);
      assert.lte(layout.merlons.length,L.LIMITS.merlons);
      for(const part of [...layout.walls,...layout.merlons])
        assert.truthy(L.contains(part.points,points),`${key}: complete part stays in original ground boundary`);
      for(const tower of layout.towers) {
        assertTowerOverhang(tower,points);
      }
      if(layout.keep)assert.truthy(L.contains(layout.keep.clearance,points),`${key}: keep clearance contained`);
      const reversed=L.build(points.slice().reverse(),options);
      assert.eq(JSON.stringify(reversed),JSON.stringify(layout),`${key}: source winding cannot alter layout`);
      const dx=1024,dy=-2048,translated=L.build(points.map(p=>({x:p.x+dx,y:p.y+dy})),options);
      assert.truthy(translated,`${key}: translated ring remains supported`);
      for(const name of ['towers','merlons']) {
        assert.eq(translated[name].length,layout[name].length,`${key}: translated ${name} count`);
        layout[name].forEach((part,i)=>part.points.forEach((p,j)=>{
          const q=translated[name][i].points[j];
          assert.truthy(q,`${key}: translated polygon vertex exists`);
          assert.lt(Math.abs(p.x+dx-q.x),1e-5);
          assert.lt(Math.abs(p.y+dy-q.y),1e-5);
        }));
      }
      assert.eq(!!translated.keep,!!layout.keep,`${key}: translation preserves keep placement`);
      if(layout.keep) {
        assert.lt(Math.abs(layout.keep.x+dx-translated.keep.x),1e-5);
        assert.lt(Math.abs(layout.keep.y+dy-translated.keep.y),1e-5);
      }
      const wallArea=parts=>parts.reduce((sum,p)=>sum+Math.abs(L.area(p.points)),0);
      assert.lt(Math.abs(wallArea(layout.walls)-wallArea(translated.walls)),1e-4,`${key}: translation preserves covered curtain area`);
      const shifted=points.map(p=>({x:p.x+dx,y:p.y+dy}));
      assert.truthy(translated.walls.every(w=>L.contains(w.points,shifted)),`${key}: translated walls stay contained`);
      const gfx={clear(){},fillStyle(){},fillTriangle(){}};
      const scene={_headingUp:true,depth:0,mapRot:0,buildingWallContainer:{add(){}},add:{graphics:()=>gfx},textures:{exists:()=>true,get:()=>({})}};
      const group=WallPerspective.begin(scene,'castles');
      const model=FDRCastleGeometry.draw(scene,'castles',points,{family,active:true});
      assert.truthy(model,`${key}: retained mesh builds`);
      const triangles=group.blocks.flatMap(b=>b.materialFaces);
      assert.gt(triangles.length,0);
      assert.lte(triangles.length,8192,`${key}: real-fixture triangle regression budget`);
      const ground=triangles.flatMap(f=>f.points).filter(p=>p.z===0);
      assert.truthy(ground.every(p=>allowedGround(points,model.layout.towers,p)),`${key}: ground stays in the ring or an intentional tower base`);
      const retained=new Set(group.blocks);
      for(const degrees of [0,17,73,135,211,315]) {
        scene.mapRot=degrees*Math.PI/180;WallPerspective.update(scene);
        assert.truthy(group.blocks.every(b=>retained.has(b)&&[...b.projected].every(Number.isFinite)),`${key}: finite retained projection at ${degrees} degrees`);
      }
    }
  });
})();
