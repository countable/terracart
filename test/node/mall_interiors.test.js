// Indoor mall inference must reject a populous strip mall and preserve source
// points across tile buffers. Coordinates are metres unless explicitly scaled.
(function () {
  const rect = (x0, y0, x1, y1) => [
    {x:x0,y:y0}, {x:x1,y:y0}, {x:x1,y:y1}, {x:x0,y:y1}, {x:x0,y:y0},
  ];
  const building = (rings) => ({type:3,tags:{},geom:rings});
  const poi = (x,y,cls='shop',extra={}) => ({type:1,tags:{class:cls,...extra},geom:[[{x,y}]]});
  const hall = () => building([rect(0,0,100,80)]);
  const inside = () => Array.from({length:9}, (_,i) => poi(25+(i%3)*20,25+Math.floor(i/3)*15));
  function infer(buildings, pois, scale=1) {
    const it = WorldGen.indoorMallPoisSteps({name:'building',extent:4096,features:buildings},
      {name:'poi',extent:4096,features:pois},scale);
    let step;
    do { step=it.next(); } while (!step.done);
    return step.value;
  }
  const keys = (result) => [...result.poiKeys].sort().join(';');

  test('mall interiors: nine deep shops qualify but eight do not', () => {
    const pois=inside();
    assert.eq(infer([hall()],pois.slice(0,8)).poiKeys.size,0,'eight is below threshold');
    const result=infer([hall()],pois);
    assert.eq(result.poiKeys.size,9,'nine original locations kept');
    assert.eq(result.buildings[0].poiCount,9,'distinct source count');
    assert.eq(result.buildings[0].deepCount,9,'all safely interior');
  });
  test('mall interiors: a large populous strip mall stays at frontage', () => {
    const pois=Array.from({length:12},(_,i)=>poi(10+i*15,8));
    assert.eq(infer([building([rect(0,0,200,30)])],pois).poiKeys.size,0,
      '6000 square metres and twelve shops do not establish indoor access');
  });
  test('retail interiors: small strip centres expose floors without moving booths indoors', () => {
    const result=infer([building([rect(0,0,40,15)])],[poi(10,5),poi(30,5)]);
    assert.eq(result.poiKeys.size,0,'frontage placement preserved');
    assert.eq(result.retailInteriors.length,1,'two booths suffice regardless of area or depth');
    assert.eq(result.retailInteriors[0].indoorMall,false,'strip centre is not an enclosed mall');
    assert.eq(result.retailInteriors[0].commercialCount,2,'distinct public booths counted');
  });
  test('retail interiors: small or sparse buildings skip wall-distance work', () => {
    for (const [radius,count] of [[10,9],[50,2]]) {
      const ring=Array.from({length:300},(_,i)=>({x:radius*Math.cos(i*Math.PI/150),y:radius*Math.sin(i*Math.PI/150)}));
      const it=WorldGen.indoorMallPoisSteps({features:[building([ring])]},
        {features:Array.from({length:count},(_,i)=>poi(i/10,0))},1);
      let step, wallSlices=0;
      do { step=it.next(); if(step.value==='mall wall distance') wallSlices++; } while(!step.done);
      assert.eq(step.value.retailInteriors.length,1,'public booths still expose a floor');
      assert.eq(wallSlices,0,'area and density gates precede wall work');
    }
  });
  test('retail interiors: private offices, duplicate booths and courtyard pins do not qualify', () => {
    const outline=building([rect(0,0,100,80),rect(20,20,80,60).reverse()]);
    assert.eq(infer([hall()],inside().map(f=>({...f,tags:{class:'office'}}))).retailInteriors.length,0,'offices excluded');
    assert.eq(infer([hall()],[poi(10,10),poi(10,10)]).retailInteriors.length,0,'duplicate booth counted once');
    assert.eq(infer([outline],[poi(10,10),poi(30,30)]).retailInteriors.length,0,'courtyard pin excluded');
    const result=infer([outline],[poi(10,10),poi(90,10)]);
    assert.eq(result.retailInteriors[0].rings.length,2,'courtyard hole retained in footprint');
    assert.eq(infer([hall()],[poi(10,10,'unknown',{subclass:'shop'}),poi(90,10)]).retailInteriors.length,1,'existing public subclass lookup reused');
  });
  test('retail interiors: tile output uses world metres and stable buffered keys', () => {
    const raster=(tx,shift,edge=448) => WorldGen.rasterizeTile([
      {name:'building',extent:4096,features:[building([rect(shift+3800,100,shift+4300,700),rect(shift+3900,400,shift+4200,600).reverse()])]},
      {name:'poi',extent:4096,features:[poi(shift+3900,200),poi(shift+4200,200)]},
    ],64,tx,5,edge);
    const first=raster(10,0).retailInteriors[0], buffered=raster(11,-4096).retailInteriors[0];
    assert.truthy(first,'retail metadata exported');
    assert.eq(first.key,buffered.key,'same source geometry across buffer has same key');
    assert.eq(first.key,raster(10,0,896).retailInteriors[0].key,'save scale cannot alter key');
    assert.eq(first.rings[0][0].x,10*448+3800*448/4096,'absolute world x');
    assert.eq(first.rings[0][0].y,5*448+100*448/4096,'absolute world y');
    assert.eq(first.rings.length,2,'world rings preserve holes');
    assert.eq(first.rings[0][0].x,buffered.rings[0][0].x,'buffer copies occupy same world position');
  });
  test('mall interiors: majority depth boundary is inclusive', () => {
    const deep=inside().slice(0,5), shallow=Array.from({length:5},(_,i)=>poi(10+i*15,5));
    assert.eq(infer([hall()],deep.concat(shallow)).poiKeys.size,10,'exactly half are deep');
    assert.eq(infer([hall()],deep.slice(0,4).concat(shallow)).poiKeys.size,0,'less than half are deep');
  });
  test('mall interiors: only large buildings qualify and scale is metres', () => {
    const pois=Array.from({length:9},(_,i)=>poi(20+(i%3)*10,20+Math.floor(i/3)*10));
    assert.eq(infer([building([rect(0,0,60,60)])],pois).poiKeys.size,0,'3600 square metres rejected');
    const scaled=inside().map(f=>({...f,geom:f.geom.map(r=>r.map(p=>({x:p.x*2,y:p.y*2})))}));
    assert.eq(infer([building([rect(0,0,200,160)])],scaled,.5).poiKeys.size,9,'MVT units converted to metres');
  });
  test('mall interiors: outside points and coincident duplicates do not inflate count', () => {
    const eight=inside().slice(0,8);
    assert.eq(infer([hall()],eight.concat(poi(200,200))).poiKeys.size,0,'outside point excluded');
    assert.eq(infer([hall()],eight.concat({...eight[0]})).poiKeys.size,0,'duplicate point excluded');
  });
  test('mall interiors: separate retail buildings do not share their counts', () => {
    const second=inside().slice(0,5).map(f=>poi(f.geom[0][0].x+200,f.geom[0][0].y));
    assert.eq(infer([hall(),building([rect(200,0,300,80)])],inside().slice(0,5).concat(second)).poiKeys.size,0,
      'five shops in each building are not ten in one mall');
  });
  test('mall interiors: an open courtyard is not indoor retail space', () => {
    const court=building([rect(0,0,200,200),rect(40,40,160,160).reverse()]);
    const pois=Array.from({length:9},(_,i)=>poi(60+(i%3)*30,60+Math.floor(i/3)*30));
    assert.eq(infer([court],pois).poiKeys.size,0,'points inside polygon hole excluded');
  });
  test('mall interiors: POIs near courtyard walls are not deep interior', () => {
    const court=building([rect(0,0,200,200),rect(40,40,160,160).reverse()]);
    const pois=Array.from({length:9},(_,i)=>poi(34,45+i*12));
    assert.eq(infer([court],pois).poiKeys.size,0,'interior depth includes courtyard walls');
  });
  test('mall interiors: feature order does not change kept points', () => {
    const pois=inside();
    assert.eq(keys(infer([hall()],pois)),keys(infer([hall()],pois.slice().reverse())),'stable feature order');
  });
  test('mall interiors: buffered POIs contribute before seam ownership', () => {
    const shifted=inside().map(f=>poi(f.geom[0][0].x-50,f.geom[0][0].y));
    const result=infer([building([rect(-50,0,50,80)])],shifted);
    assert.eq(result.poiKeys.size,9,'negative buffered coordinates retained for classification');
    assert.truthy(result.poiKeys.has('-25,25'),'source point key is unchanged');
  });
  test('mall interiors: classification counts mapped POIs independently of loot classes', () => {
    const pois=inside().map((f,i)=>({...f,tags:{class:i===8?'office':'shop'}}));
    assert.eq(infer([hall()],pois).poiKeys.size,9,'office POI contributes to mapped density');
  });
  test('mall interiors: structural mall classification does not permit loot on Excluded building cells', () => {
    const source=Array.from({length:9},(_,i)=>poi(1200+(i%3)*300,1200+Math.floor(i/3)*300,'restaurant', {name:'Hall '+i}));
    const layers=[
      {name:'building',extent:4096,features:[building([rect(900,900,2200,2200)])]},
      {name:'transportation',extent:4096,features:[{type:2,tags:{class:'minor'},geom:[[{x:500,y:2700},{x:3000,y:2700}]]}]},
      {name:'poi',extent:4096,features:source},
    ];
    const raster=WorldGen.rasterizeTile(layers,64,10,5,448);
    const chests=raster.objects.filter(o=>o.kind==='chest'&&o.name&&o.name.startsWith('Hall '));
    assert.eq(chests.length,0,'indoor POIs cannot bypass Excluded building ground');
    assert.truthy(raster.buildingShapes.length>0,'structural building footprints remain');
    for(const f of source) {
      const p=f.geom[0][0],i=Math.floor(p.y/64)*64+Math.floor(p.x/64);
      assert.eq(raster.gameplayTiers[i],GameplayTiers.EXCLUDED);
    }
  });
  test('mall interiors: multipolygon components cannot pool shops', () => {
    const second=inside().slice(0,5).map(f=>poi(f.geom[0][0].x+200,f.geom[0][0].y));
    const separate=building([rect(0,0,100,80),rect(200,0,300,80)]);
    assert.eq(infer([separate],inside().slice(0,5).concat(second)).poiKeys.size,0,'two outer rings remain separate buildings');
  });
  test('mall interiors: courtyard area is deducted before size threshold', () => {
    const court=building([rect(0,0,100,50),rect(10,30,90,49).reverse()]);
    const pois=Array.from({length:9},(_,i)=>poi(20+i*7,15));
    assert.eq(infer([court],pois).poiKeys.size,0,'5000 exterior minus1520 courtyard is below threshold');
  });
  test('mall interiors: a civic POI cannot use frontage relocation to bypass Excluded source ground', () => {
    const layers=[
      {name:'building',extent:4096,features:[building([rect(900,900,2200,2200)])]},
      {name:'transportation',extent:4096,features:[{type:2,tags:{class:'minor'},geom:[[{x:500,y:2700},{x:3000,y:2700}]]}]},
      {name:'poi',extent:4096,features:[poi(1500,1500,'library',{name:'Civic library'})]},
    ];
    const raster=WorldGen.rasterizeTile(layers,64,10,5,448);
    const chest=raster.objects.find(o=>o.kind==='chest'&&o.name==='Civic library');
    assert.falsy(chest,'a civic chest cannot bypass excluded building ground');
    assert.truthy(raster.buildingShapes.length>0,'structural civic footprint remains');
  });
})();
