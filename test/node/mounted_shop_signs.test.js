(() => {
  const skin = () => ({spec: AuthoredBuildings.SPECS.pp_plaster, template: {}, texel: .5, flat: false,
    facade: {v:900,rows:40,period:60}, roof:{u:256,v:616,w:240,h:240},
    door:{u:30,v:50,w:20,h:26,bottom:0},wall:[16,80],recolor(faces){for(const f of faces)f.texture='wall';}});
  const lot=[{x:0,y:0},{x:70,y:0},{x:70,y:60},{x:0,y:60}];
  const textures={sign:{key:'sign'},roof:{key:'relief'},signUV:[0,0,32/512,32/1024],roofUV:[0,0,32/512,32/1024],signSideUV:[40/512,1/1024],roofSideUV:[41/512,1/1024]};
  test('mounted shop signs: every entrance edge seats a small board beside the door',()=>{
    for(let edge=0;edge<4;edge++){
      const mesh=BuildingLowPoly.authoredOutline(skin(),lot,edge,null,textures);
      assert.eq(mesh.mountedSign,true);
      const relief=mesh.faces.find(f=>f.feature==='shop-emblem');
      const [r0,r1]=relief.points,front=mesh.ring[edge],end=mesh.ring[(edge+1)%4];
      assert.gt((r1.x-r0.x)*(front.x-end.x)+(r1.y-r0.y)*(front.y-end.y),0,
        'glyph horizontal strokes read along the entrance, not an arbitrary roof triangle');
      const board=mesh.faces.filter(f=>f.feature==='shop-sign');
      assert.eq(board.length,10,'rounded twelve-vertex face');
      const sides=mesh.faces.filter(f=>f.feature==='shop-sign-side');
      assert.eq(sides.length,24,'each rounded edge has a solid side wall');
      for(let i=0;i<sides.length;i+=2){
        const base=sides[i].points[0],front=sides[i+1].points[2];
        assert.inRange(Math.hypot(front.x-base.x,front.y-base.y,front.z-base.z),1.199,1.201,
          'backing has visible depth along the wall normal');
      }
      assert.truthy(board.every(f=>f.texture===textures.sign&&f.roofPalette===false));
      const a=mesh.ring[edge],b=mesh.ring[(edge+1)%4],length=Math.hypot(b.x-a.x,b.y-a.y);
      const along=p=>((p.x-a.x)*(b.x-a.x)+(p.y-a.y)*(b.y-a.y))/length;
      const spans=fs=>fs.flatMap(f=>f.points.map(along));
      const sign=spans(board),door=spans(mesh.faces.filter(f=>f.layer===.1));
      assert.eq(Math.min(...board.flatMap(f=>f.points.map(p=>p.z))),6,'board hangs above the ground beside the upper doorway');
      assert.eq(Math.max(...board.flatMap(f=>f.points.map(p=>p.z))),13);
      assert.eq(Math.max(...sign)-Math.min(...sign),6,'smaller than the ten-unit doorway');
      assert.truthy(Math.max(...sign)<Math.min(...door)||Math.min(...sign)>Math.max(...door),'board never covers door');
      for(const f of board)for(const p of f.points){
        assert.truthy(along(p)>=0&&along(p)<=length,'board stays on the entrance wall');
        const normalDistance=Math.abs((p.x-a.x)*(b.y-a.y)-(p.y-a.y)*(b.x-a.x))/length;
        assert.inRange(normalDistance,1.39,1.41,'front face projects from its wall mount');
      }
    }
  });
  test('mounted shop signs: one roof relief retains its own texture after recoloring',()=>{
    const mesh=BuildingLowPoly.authoredOutline(skin(),lot,0,null,textures);
    const roof=mesh.faces.filter(f=>f.feature==='shop-emblem');
    assert.eq(roof.length,10,'one rounded roof plaque');
    const sides=mesh.faces.filter(f=>f.feature==='shop-emblem-side');
    assert.eq(sides.length,24,'the roof plaque has real thickness');
    for(let i=0;i<sides.length;i+=2){
      const base=sides[i].points[0];
      const other=sides[i+1].points[2];
      assert.inRange(Math.hypot(other.x-base.x,other.y-base.y,other.z-base.z),1.499,1.501);
    }
    assert.truthy(roof.some(f=>f.points.some(p=>p.tu!==f.points[0].tu||p.tv!==f.points[0].tv)),'face samples the complete textured emblem');
    assert.truthy(roof.every(f=>f.texture===textures.roof&&f.roofPalette===false));
    for(const f of roof)for(const p of f.points){
      assert.inRange(p.tu,0,32/512);assert.inRange(p.tv,0,32/1024);
      assert.gt(p.z,20,'relief sits above the eaves');
    }
    const ordinary=BuildingLowPoly.authoredOutline(skin(),lot,0);
    assert.eq(ordinary.mountedSign,false);
    assert.falsy(ordinary.faces.some(f=>f.feature==='shop-sign'||f.feature==='shop-emblem'));
  });
  test('mounted shop signs: only a successfully mounted board suppresses floating labels',()=>{
    assert.truthy(RENDER_SRC.includes('if (scene._proceduralBuildings?.get(item.o.id)?.mountedSign) continue;'));
    assert.truthy(ALL_SRC['building_overlay.js'].includes('mountedSign: !!model.mountedSign'));
  });
})();
