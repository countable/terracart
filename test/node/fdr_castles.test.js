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
  test('FDR castles: mapped Kelowna towers, flared feet and clipped walls stay inside their source footprints', () => {
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
          const outset=family==='bastion'?2:0;
          assert.truthy(L.contains(L.rect(tower.x,tower.y,tower.width+outset*2,tower.depth+outset*2),points),
            'the complete tower ground base cannot enter neighbouring map space');
        }
        const ground=group.blocks.flatMap(b=>b.materialFaces.flatMap(f=>f.points)).filter(p=>p.z===0);
        assert.gt(ground.length,0);
        assert.truthy(ground.every(p=>PolygonGeometry.pointInPolygon(points,p,1e-5)),
          `${tile}/${id}/${index}: every rendered ground vertex stays inside the mapped ring`);
        const retained=new Set(group.blocks);
        for(const heading of [0,17,73,135,211,315]) {
          scene.mapRot=heading*Math.PI/180;WallPerspective.update(scene);
          assert.truthy(group.blocks.every(b=>retained.has(b)&&[...b.projected].every(Number.isFinite)),
            'valid camera rotations retain finite, footprint-contained geometry');
        }
      }
    }
  });
  test('FDR castles: tower foot clearance is part of the cached layout', () => {
    const points=L.rect(0,0,240,180);
    for(const outset of [0,2,0]) {
      const layout=L.build(points,{towerWidth:36,towerBaseOutset:outset});
      assert.eq(layout.towers.length,4);
      for(const t of layout.towers)
        assert.truthy(L.contains(L.rect(t.x,t.y,36+outset*2,36+outset*2),points));
    }
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
  test('FDR castles: stone walls have a hard basal shadow and lit tops, without an upper shade band', () => {
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
        assert.falsy(lo<4-1e-7&&hi>4+1e-7,'no triangle interpolates across the basal shade step');
        (hi<=4+1e-7?lower:upper).push(face);
      }
      assert.gt(lower.length,0,'the wall foot has a shadow band');
      assert.gt(upper.length,0,'the main wall remains visible above the basal band');
      for(const low of lower) {
        const lit=upper.filter(f=>Math.abs(f.normal.x-low.normal.x)<1e-7&&Math.abs(f.normal.y-low.normal.y)<1e-7);
        assert.gt(lit.length,0);
        assert.truthy(lit.every(f=>luma(f.color)>luma(low.color)),'the wall face above the foot is lighter');
      }
      const byNormal=new Map();
      for(const face of upper) {
        const key=JSON.stringify(face.normal),colors=byNormal.get(key)||new Set();
        colors.add(face.color);byNormal.set(key,colors);
      }
      for(const colors of byNormal.values())assert.eq(colors.size,1,'the upper wall has no second horizontal shadow step');
      const caps=body.materialFaces.filter(f=>f.material==='stone'&&!f.normal&&f.points.every(p=>p.z===body.top));
      assert.gt(caps.length,0,'coping exposes a real upward-facing plane');
      assert.truthy(caps.every(f=>luma(f.color)>Math.max(...upper.map(q=>luma(q.color)))),'upward-facing surfaces are lit');
      const colors=group.blocks.flatMap(b=>b.materialFaces.map(f=>f.color)).sort((a,b)=>a-b).join(',');
      for(const angle of [0,.7,Math.PI/2,Math.PI,Math.PI*1.5]) {
        scene.mapRot=angle;WallPerspective.update(scene);
        assert.eq(group.blocks.flatMap(b=>b.materialFaces.map(f=>f.color)).sort((a,b)=>a-b).join(','),colors,
          'rotation only changes visibility, not the cel-shaded material values');
      }
    }
  });
  test('FDR castles: each keep has closed double doors without a banner across the entrance', () => {
    for(const family of ['citadel','bastion','archive'])for(const active of [true,false]) {
      const gfx={clear(){},fillStyle(){},fillTriangle(){}};
      const scene={_headingUp:true,depth:0,mapRot:0,buildingWallContainer:{add(){}},
        add:{graphics:()=>gfx},textures:{exists:()=>true,get:()=>({})}};
      const group=WallPerspective.begin(scene,'castles');
      const {layout}=FDRCastleGeometry.draw(scene,'castles',L.rect(0,0,240,180),{family,active});
      const keep=layout.keep;assert.truthy(keep);
      const faces=group.blocks.filter(b=>Math.abs(b.x-keep.x)<1e-7&&Math.abs(b.y-keep.y)<1e-7).flatMap(b=>b.materialFaces);
      for(const material of ['door','door-seam','door-handle'])
        assert.gt(faces.filter(f=>f.material===material).length,0,`${family}: closed doors retain ${material}`);
      for(const face of faces.filter(f=>f.material==='door')) {
        const center=face.points.reduce((sum,p)=>({u:sum.u+p.u/3,v:sum.v+p.v/3}),{u:0,v:0});
        assert.eq(Math.floor(center.u*4)+4*Math.floor(center.v*4),5,
          'closed door artwork uses the shared gate atlas rather than an open entrance');
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
        assert.eq(roof.length,active?4:2,'a roof is four planar triangles, or two surviving planes on a wreck');
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
          const dx=tooth.x-part.x,dy=tooth.y-part.y;
          if(Math.abs(dx)<part.width/4&&dy<-part.depth/3)sides.add('back');
          if(Math.abs(dx)<part.width/4&&dy>part.depth/3)sides.add('front');
          if(Math.abs(dy)<part.depth/4&&dx<-part.width/3)sides.add('left');
          if(Math.abs(dy)<part.depth/4&&dx>part.width/3)sides.add('right');
          assert.truthy(tooth.materialFaces.some(f=>!f.normal&&f.points.every(p=>p.z===tooth.top)),
            'each tooth has a real lit top plane');
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
      const wallKeys=new Set(layout.walls.map(w=>key(w.points)));
      const walls=group.blocks.filter(b=>b.bottom===0&&wallKeys.has(key(b.points)));
      assert.gt(walls.filter(b=>b.top<24).length,0,'the fixture contains genuinely lowered broken crests');
      let raised=0;
      for(const merlon of layout.merlons) {
        const tooth=group.blocks.find(b=>b.bottom===merlon.base&&b.top===merlon.top&&key(b.points)===key(merlon.points));
        if(!tooth)continue;
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
      assert.gt(raised,0,'damage leaves some supported battlements standing');
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
      FDRCastleGeometry.draw(scene,'castles',L.rect(0,0,240,180),{family,active});
      const faces=group.blocks.flatMap(b=>b.materialFaces);
      const upperStone=faces.filter(f=>f.material==='stone'&&f.normal&&f.points.every(p=>p.z>=4));
      assert.gt(upperStone.length,0);
      const slots=new Set(upperStone.map(atlasSlot));
      assert.eq([...slots].join(','),!active&&family!=='citadel'?'14':'13',
        'Bastion/Archive wrecks use shared moss marks; Citadel and intact walls use quiet stone');
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
})();
