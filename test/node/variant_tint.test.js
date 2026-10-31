(function () {
  const N=24;
  const entry=()=>({cellsPerEdge:N,grid:new Uint8Array(N*N),streetIndex:{extent:N,dressingLines:[
    {key:'north',variant:'thorny',halfW:3.5,line:[{x:0,y:8.5},{x:24,y:8.5}]},
    {key:'south',variant:'orchard',halfW:3.5,line:[{x:0,y:14.5},{x:24,y:14.5}]},
  ]}});
  const influence = (e, ix, iy) => Render.roadInfluenceVariant(e, ix, iy)?.id ?? null;
  test('road influence: normal play uses only the recorded influence footprint', () => {
    const e = entry();
    e.streetArea = StreetVariants.area(e.streetIndex, N);
    e.streetAreaVariants = e.streetArea.variants;
    assert.eq(influence(e, 10, 8), 'thorny');
    assert.eq(influence(e, 10, 14), 'orchard');
    assert.eq(influence(e, 10, 0), null, 'distant nearest-road ownership is debug-only');
    const i = 8 * N + 10;
    e.streetAreaVariants[i] = StreetVariants.VARIANT_BY_ID.golden.code;
    assert.eq(influence(e, 10, 8), 'golden', 'recorded winner owns the cell');
    assert.eq(influence(e, -1, 8), null);
  });
  // A square per-cell wash has no transition: inside a Grassy Lane it read as
  // a second grass meeting the first on hard cell edges.
  test('road influence: no per-cell colour wash over the ground', () => {
    for (const symbol of ['roadInfluenceTintColor', 'beginRoadInfluenceTint', 'ROAD_INFLUENCE_TINT_ALPHA'])
      assert.eq(Render[symbol], undefined, symbol);
  });
  test('road influence ground: a groundFamily row redraws its footprint and minor-road cobble gaps', () => {
    const e = entry(), i = 8 * N + 10;
    e.streetArea = StreetVariants.area(e.streetIndex, N);
    e.streetAreaVariants = e.streetArea.variants;
    const brown = GroundMaterials.families.findIndex(row => row.id === 'brownSoil');
    assert.gt(brown, -1);
    assert.eq(Render.roadInfluenceGroundFamily(e, 10, 8), -1, 'a row without groundFamily keeps the source ground');
    e.streetAreaVariants[i] = StreetVariants.VARIANT_BY_ID.haunted_forest_path.code;
    assert.eq(Render.roadInfluenceGroundFamily(e, 10, 8), brown, 'Haunt draws RA brown soil');
    assert.eq(e.grid[i], WorldGen.T.GRASS, 'and leaves the terrain alone');
    e.grid[i] = WorldGen.T.ROAD;
    assert.eq(Render.roadInfluenceGroundFamily(e, 10, 8), brown, 'minor-road cobble gaps show it too');
    assert.eq(influence(e, 10, 8), null, 'the carriageway itself is not influence ground');
    e.grid[i] = WorldGen.T.ROAD_MD;
    assert.eq(Render.roadInfluenceGroundFamily(e, 10, 8), -1, 'MD/LG paving is never restyled');
  });
  test('road influence: Home, Nexus, cave, discarded and non-ground cells keep their own appearance', () => {
    const e = entry(), i = 8 * N + 10;
    e.streetArea = StreetVariants.area(e.streetIndex, N);
    for (const field of ['homeVariant', 'variantDiscarded']) {
      e[field] = new Uint8Array(N*N); e[field][i] = 1;
      assert.eq(influence(e, 10, 8), null, field);
      delete e[field];
    }
    e.zone = {coverage:new Uint8Array(N*N)}; e.zone.coverage[i] = 1;
    assert.eq(influence(e, 10, 8), null, 'Nexus priority');
    delete e.zone;
    e.caveAreas = {reserved:new Set([i])};
    assert.eq(influence(e, 10, 8), null, 'cave entrance priority');
    delete e.caveAreas;
    for (const terrain of [WorldGen.T.WATER, WorldGen.T.PIER, WorldGen.T.ROAD_MD, WorldGen.T.ROAD_LG]) {
      e.grid[i] = terrain;
      assert.eq(influence(e, 10, 8), null, 'not road-variant ground');
    }
    e.grid[i] = WorldGen.T.GRASS; e.depth = 1;
    assert.eq(influence(e, 10, 8), null, 'underground');
  });
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
