// Approved marks are attenuated as a complete layer; zone accents are visual
// only and share the POI-phased pattern coordinates with the placement table.
(() => {
  const art = new Function('WorldGen', 'ZoneVariants', TEXTURES_SRC +
    '\nreturn { BIOME_TEX, drawBiomeTexture, zoneGroundColor, ZONE_GROUND_ACCENTS, makeRoundPadTexture };')(WorldGen, ZoneVariants);
  function recordingContext() {
    const ops = [], stack = [];
    const cx = { globalAlpha: 1, globalCompositeOperation: 'source-over',
      save() { stack.push([this.globalAlpha,this.globalCompositeOperation]); },
      restore() { [this.globalAlpha,this.globalCompositeOperation] = stack.pop(); },
      fillRect(...args) { ops.push({ alpha:this.globalAlpha, mode:this.globalCompositeOperation,args }); } };
    for (const method of ['clearRect','beginPath','arc','ellipse','fill','moveTo','lineTo','stroke','closePath','quadraticCurveTo']) cx[method] = () => {};
    return { cx, ops };
  }
  test('ground art: gameplay mark strength is applied once to the finished texture', () => {
    const expected = {1:.75,2:.925,4:.9,10:.9,17:.9,18:.9,19:.94,20:1,21:1,22:.9,24:.9,25:.9,27:.9,31:.9};
    for (const [id,opacity] of Object.entries(expected)) {
      const {cx,ops} = recordingContext();
      art.drawBiomeTexture(cx,32,id);
      const masks = ops.filter(o=>o.mode==='destination-in');
      assert.eq(masks.length,opacity===1?0:1,`${id}: one layer mask`);
      if (masks.length) assert.eq(masks[0].alpha,opacity,`${id}: halfway-restored opacity`);
      assert.eq(cx.globalAlpha,1,'restore caller alpha');
      assert.eq(cx.globalCompositeOperation,'source-over','restore caller blend');
      assert.truthy(ops.filter(o=>o.mode==='source-over').every(o=>o.alpha===1),'raw marks retain their overlap contrast before attenuation');
    }
  });
  test('ground art: POI pad uses warm ivory without changing the slab geometry', () => {
    const paint = inks => {
      const ops = [], cx = { clearRect(){},beginPath(){},clip(){},save(){},restore(){},
        moveTo(...p){ops.push(['move',...p]);},arcTo(...p){ops.push(['arc',...p]);},
        closePath(){},fill(){ops.push(['fill',this.fillStyle]);},
        fillRect(...p){ops.push(['rect',this.fillStyle,...p]);} };
      let size;
      art.makeRoundPadTexture({textures:{createCanvas(key,w,h){size=[w,h];return {getContext:()=>cx,refresh(){}};}}},'pad',inks);
      return {ops,size};
    };
    const current=paint(),before=paint({top:'#f4f8ff',side:'#dde5f2'});
    const fills=current.ops.filter(o=>o[0]==='fill').map(o=>o[1]);
    assert.eq(fills.join('|'),'#cbd2c9|#dce4da','darker side precedes warm-ivory top');
    assert.eq(JSON.stringify(current.size),JSON.stringify(before.size),'same texture dimensions');
    const geometry=r=>r.ops.filter(o=>o[0]!=='fill');
    assert.eq(JSON.stringify(geometry(current)),JSON.stringify(geometry(before)),'same outline, depth, sheen and shadow');
  });
  function entry(id,tx=0) {
    const N=64,step=4096/N;
    return {tx,ty:0,cellsPerEdge:N,zone:{coverage:new Uint8Array(N*N).fill(1),anchors:[{
      kind:ZoneVariants.byId(id).zone,variant:id,key:'ground-art',rotation:0,
      gx:tx*4096+32.5*step,gy:32.5*step,upm:WorldGen.CELL_M/step,
    }]}};
  }
  test('ground art: ancient grove shade follows only tree and shrub cluster cells', () => {
    const e=entry('ancient_grove'),c=art.ZONE_GROUND_ACCENTS.ancient_grove.color;
    assert.eq(art.zoneGroundColor(e,32,32,28),c,'cluster tree');
    assert.eq(art.zoneGroundColor(e,33,33,28),c,'shrub layer');
    assert.eq(art.zoneGroundColor(e,34,32,28),c,'expanded bramble rim is shaded');
    assert.eq(art.zoneGroundColor(e,33,34,28),null,'remaining grass accent stays warmer');
    assert.eq(art.zoneGroundColor(e,35,32,28),null,'open gap stays warmer');
    assert.eq(art.zoneGroundColor(e,38,32,28),c,'repeat is phased from POI');
    for(const t of [2,7,9,13,14,24,25]) assert.eq(art.zoneGroundColor(e,32,32,t),null,'roads, buildings, sand and caves retain their material');
    e.zone.coverage[32*64+32]=0;
    assert.eq(art.zoneGroundColor(e,32,32,28),null,'coverage ownership required');
  });
  test('ground art: mushroom grove shades its full coverage without repainting roads or buildings', () => {
    const e=entry('mushroom_grove'),c=art.ZONE_GROUND_ACCENTS.mushroom_grove.color;
    for (const [x,y] of [[0,0],[32,32],[38,32],[63,63]])
      assert.eq(art.zoneGroundColor(e,x,y,28),c,'empty ground and mushroom cells share the forest floor');
    for (const t of [2,7,9,13,14,20,24,25,29])
      assert.eq(art.zoneGroundColor(e,32,32,t),null,'other terrain retains its material');
    e.zone.coverage[32*64+32]=0;
    assert.eq(art.zoneGroundColor(e,32,32,28),null,'coverage ownership required');
  });
  test('ground art: silent circle ivory stays on its single POI cell, not repeated circles', () => {
    const e=entry('silent_circle',3),c=art.ZONE_GROUND_ACCENTS.silent_circle.color;
    assert.eq(art.zoneGroundColor(e,32,32,29),c);
    assert.eq(art.zoneGroundColor(e,33,32,29),null);
    assert.eq(art.zoneGroundColor(e,40,32,29),null,'no repeated ivory patches');
    delete e.tx; delete e.ty;
    assert.eq(art.zoneGroundColor(e,32,32,29,3,0),c,'real tile entries use caller tile coordinates');
  });
})();
