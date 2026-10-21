(() => {
  const makeSkin = ppFlat => ({spec:{left:0,right:96,ppFlat,slabHeight:16,eave:48},template:{},texel:13/28,flat:true,
    facade:{v:900,rows:32,period:96},roof:{u:256,v:616,w:16,h:16},door:{u:34,v:68,w:28,h:28,bottom:0},wall:[16,80],recolor(){}});
  // Real Kelowna outline z14-2754-5567-feature2228921870-ring922: oblique
  // returns exercise the production path rather than the orthogonal viewer.
  const kelowna=[[18.4827,0],[23.8735,2.3103],[21.5631,7.7011],[32.7298,12.7069],[30.4194,18.4827],[19.2528,13.8620],[4.2356,47.7470],[0,46.2067],[11.5517,20.4080],[9.6264,19.6379]].map(([x,y])=>({x:x*2,y:y*2}));
  const area=points=>Math.abs(points.reduce((s,a,i)=>{const b=points[(i+1)%points.length];return s+a.x*b.y-a.y*b.x;},0))/2;
  test('PP flat production: raised fascia and sealed outward lip follow oblique lots',()=>{
    const skin=makeSkin(true),mesh=BuildingLowPoly.authoredOutline(skin,kelowna),H=32*skin.texel,top=48*skin.texel;
    assert.eq(mesh.height,top);
    const deck=mesh.faces.filter(f=>f.feature==='flat-deck'),coping=mesh.faces.filter(f=>f.feature==='flat-coping'),fascia=mesh.faces.filter(f=>f.feature==='flat-fascia'),soffit=mesh.faces.filter(f=>f.feature==='flat-soffit');
    assert.truthy(deck.length&&coping.length&&fascia.length&&soffit.length,'all slab surfaces exist');
    assert.truthy(Math.abs(deck.reduce((s,f)=>s+area(f.points),0)-area(mesh.ring))<1e-5,'deck covers the entire actual lot exactly once');
    assert.truthy(coping.reduce((s,f)=>s+area(f.points),0)>0,'roof extends outward from the actual wall ring');
    assert.truthy(Math.abs(coping.reduce((s,f)=>s+area(f.points),0)-soffit.reduce((s,f)=>s+area(f.points),0))<1e-5,'overhang has matching upper and lower closure');
    for(const f of fascia)assert.truthy(f.points.every(p=>p.z===H||p.z===top),'fascia spans source slab height');
    for(const f of deck)assert.truthy(f.points.every(p=>p.tu*512>=256&&p.tu*512<=272&&p.tv*1024>=616&&p.tv*1024<=632),'deck never samples coping swatches');
    for(const f of mesh.faces)assert.truthy(f.points.every(p=>['x','y','z','tu','tv'].every(k=>Number.isFinite(p[k]))));
  });
  test('PP flat production: original flat adobe keeps its existing roof height',()=>{
    const skin=makeSkin(false),mesh=BuildingLowPoly.authoredOutline(skin,kelowna);
    assert.truthy(mesh.height<33*skin.texel,'PP slab elevation is limited to PP flat sources');
    assert.falsy(mesh.faces.some(f=>f.feature==='flat-fascia'));
  });
})();
