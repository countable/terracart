(function () {
  const N=24;
  const entry=()=>({cellsPerEdge:N,grid:new Uint8Array(N*N),streetIndex:{extent:N,dressingLines:[
    {key:'north',variant:'thorny',halfW:3.5,line:[{x:0,y:8.5},{x:24,y:8.5}]},
    {key:'south',variant:'orchard',halfW:3.5,line:[{x:0,y:14.5},{x:24,y:14.5}]},
  ]}});
  test('variant tint: nearest owner includes extended dressing outside the reserved corridor',()=>{
    const e=entry();
    assert.eq(Render.variantTintColor(e,10,0),RoadOverlay.primaryColor('thorny'));
    assert.eq(Render.variantTintColor(e,10,11),RoadOverlay.primaryColor('thorny'));
    assert.eq(Render.variantTintColor(e,10,12),RoadOverlay.primaryColor('orchard'));
    e.streetIndex.dressingLines=e.streetIndex.dressingLines.map(r=>({...r,variant:'golden'}));
    assert.eq(Render.variantTintColor(e,10,12),RoadOverlay.primaryColor('golden'),'updated source rebuilds cached ownership');
    assert.eq(Render.variantTintColor(e,-1,12),null);
  });
  test('variant tint: higher-priority areas and discarded cells never show the road owner',()=>{
    const e=entry(),i=10*N+10;
    e.homeVariant=new Uint8Array(N*N);e.homeVariant[i]=1;
    assert.eq(Render.variantTintColor(e,10,10),null);
    e.homeVariant=null;e.variantDiscarded=new Uint8Array(N*N);e.variantDiscarded[i]=1;
    assert.eq(Render.variantTintColor(e,10,10),null);
    e.variantDiscarded=null;e.caveAreas={reserved:new Set([i])};
    assert.eq(Render.variantTintColor(e,10,10),null);
    e.caveAreas=null;e.zone={coverage:new Uint8Array(N*N),anchors:[{kind:'grove',variant:'meadow'}]};
    e.zone.coverage[i]=1;
    const row=ZoneVariants.byId('meadow');
    const material=Object.entries(row.background.materialDensity).sort((a,b)=>b[1]-a[1])[0][0];
    assert.eq(Render.variantTintColor(e,10,10),parseInt(ZoneVariants.materials[material].color.slice(1),16));
    e.depth=1;assert.eq(Render.variantTintColor(e,10,10),null);
  });
  test('variant tint: toggle reuses one ground graphic and clears when off or underground',()=>{
    let made=0,clears=0;
    const graphic={visible:false,clear(){clears++;return this;},setVisible(v){this.visible=v;return this;}};
    const scene={depth:0,debugVariantTint:false,add:{graphics(){made++;return graphic;}},cobbleContainer:{add(){}}};
    assert.eq(Render.beginVariantTint(scene),null);assert.eq(made,0);
    Render.setVariantTint(scene,true);assert.eq(Render.beginVariantTint(scene),graphic);assert.truthy(graphic.visible);
    Render.beginVariantTint(scene);assert.eq(made,1);assert.gt(clears,0);
    scene.depth=1;assert.eq(Render.beginVariantTint(scene),null);assert.falsy(graphic.visible);
    scene.depth=0;Render.beginVariantTint(scene);assert.truthy(graphic.visible);
    Render.setVariantTint(scene,false);assert.falsy(graphic.visible);assert.eq(Render.beginVariantTint(scene),null);
  });
})();
