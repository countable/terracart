(() => {
  const lot=[[0,0],[100,0],[100,80],[0,80]].map(([x,y])=>({x,y}));
  const texel=13/35,H=64*texel,rise=24*texel;
  test('FDR ridge uses the native 24-texel rise and a distinct geometry cache entry',()=>{
    const normal=BuildingLowPoly.geometry(lot,'ridge',H,5);
    const native=BuildingLowPoly.geometry(lot,'ridge',H,5,null,null,rise);
    const top=g=>Math.max(...g.faces.filter(f=>f.kind==='wall'&&!f.chimney).flatMap(f=>f.points.map(p=>p.z)));
    assert.truthy(Math.abs(top(normal)-H-14)<1e-6);
    assert.truthy(Math.abs(top(native)-H-rise)<1e-6);
    assert.truthy(normal!==native,'roof rise participates in the cache key');
  });
  test('FDR real-lot gables map stone and timber at native texel scale',()=>{
    const skin={key:'fdr',spec:{left:112,right:224,posts:[113,118,217,222]},template:{},texel,flat:false,
      facade:{v:900,rows:64},roof:{u:256,v:616,w:240,h:240},door:{u:153,v:93,w:30,h:35,bottom:0},wall:[132,96],
      roofRise:rise,gable:{u:0,v:640,w:32,h:16},recolor:()=>{}};
    const mesh=BuildingLowPoly.authoredOutline(skin,lot),gables=mesh.faces.filter(f=>f.feature==='gable');
    assert.truthy(gables.length>0,'gable infill must use the native material');
    for(const f of gables){
      assert.truthy(new Set(f.points.map(p=>p.tu+','+p.tv)).size>1,'do not stretch a single grey texel');
      for(const p of f.points){
        assert.truthy(p.z>=H-1e-6&&p.z<=H+rise+1e-6);
        assert.truthy(p.tu*512>=.5&&p.tu*512<=31.5&&p.tv*1024>=640.5&&p.tv*1024<=655.5);
      }
    }
    assert.truthy(mesh.faces.some(f=>f.kind==='wall'&&f.points.some(p=>p.z===0)),'facade still reaches the original ground');
  });
})();
