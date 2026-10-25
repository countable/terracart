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
