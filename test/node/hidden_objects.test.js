(function () {
  function scene() {
    return { save: {}, depth: 0, tileEdgeM: 256, cellsPerTile: 16, cellM: 16,
      mPerPx: 1, originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 },
      playerM: { x: 88, y: 88 }, showMessageModal() {},
    };
  }
  function hidden(dx = 0, dy = 0) {
    return { id: `hidden_${dx}_${dy}`, hidden: true, kind: 'test_discovery', depth: 0,
      x: 88 + dx * 16, y: 88 + dy * 16 };
  }
  test('hidden objects: walking onto the same cell or any of eight adjacent cells reveals', () => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const s = scene(), o = hidden(dx, dy);
      assert.eq(HiddenObjects.isHidden(s.save, o), true);
      assert.eq(HiddenObjects.reveal(s, o), true);
      assert.eq(HiddenObjects.isHidden(s.save, o), false);
    }
  });
  test('concealed caches: passive discovery requires the exact cell even with Perception', () => {
    const s=scene(), o={...hidden(1,0),kind:'chest',concealed:true,cache:true,cacheTheme:'overgrown'};
    const perception=Gear.hasPerception;
    Gear.hasPerception=()=>true;
    try {
      assert.falsy(HiddenObjects.reveal(s,o),'adjacent and visible does not reveal');
      s.playerM={x:o.x-7,y:o.y+7};
      assert.truthy(HiddenObjects.reveal(s,o),'any position in the exact cell reveals');
      s.playerM={x:0,y:0};s.save=JSON.parse(JSON.stringify(s.save));
      assert.falsy(HiddenObjects.isHidden(s.save,{...o}),'discovery survives leaving and reload');
      assert.falsy(restocks(o),'cache never restocks');
      s.save.opened=[o.id];
      assert.truthy(isSpent(o,spentSets(s,s.save)),'normal opened ledger spends the cache');
    } finally {Gear.hasPerception=perception;}
  });
  test('concealed objects: direct cell tap reveals, neighbouring taps and cover do not',()=>{
    const s=scene(),o={...hidden(1,0),hidden:undefined,concealed:true,kind:'chest',cache:true};
    s.save.energy=100;
    const each=WorldGen.forEachItem,visibility=Visibility.hidden;
    WorldGen.forEachItem=(layer,fn)=>{if(layer==='objects')fn(o);};Visibility.hidden=()=>false;
    const handler=TAP_HANDLERS.find(h=>h.name==='concealed');
    try {
      assert.truthy(HiddenObjects.isHidden(s.save,o),'concealed alone hides all ordinary render/tap targets');
      assert.falsy(handler.try({scene:s,save:s.save,wm:{x:o.x+16,y:o.y}}));
      Visibility.hidden=()=>true;
      assert.falsy(handler.try({scene:s,save:s.save,wm:{x:o.x,y:o.y}}),'cover blocks direct revelation');
      Visibility.hidden=()=>false;
      o.coverRockId='cover';
      assert.falsy(handler.try({scene:s,save:s.save,wm:{x:o.x,y:o.y}}),'tap cannot bypass rock cover');
      assert.falsy(HiddenObjects.reveal(s,o,{x:o.x,y:o.y}),'shared discovery also respects cover');
      s.save.brokenRocks=['cover'];
      assert.truthy(handler.try({scene:s,save:s.save,wm:{x:o.x,y:o.y}}),'direct tap reveals before standing there');
      assert.falsy(HiddenObjects.isHidden(s.save,o));
      assert.falsy(handler.try({scene:s,save:s.save,wm:{x:o.x,y:o.y}}),'later tap goes to normal interaction');
    } finally {WorldGen.forEachItem=each;Visibility.hidden=visibility;}
  });
  test('concealed objects: full tap dispatch reveals without opening or granting loot',()=>{
    const s=scene(),o={id:'dispatch-cache',kind:'chest',x:104,y:88,cache:true,concealed:true};
    s.save.energy=100;Object.assign(s,{viewLeft:0,viewTop:0,viewSize:200,screenToWorldMeters:(x,y)=>({x,y})});
    const each=WorldGen.forEachItem,cover=Visibility.playerCover,hiddenCover=Visibility.hidden;
    const hit=Render.buildingHit,spill=Render.tallPropHit;
    const objectHandler=TAP_HANDLERS.find(h=>h.name==='object'),open=objectHandler.try;
    let opened=0;
    WorldGen.forEachItem=(layer,fn)=>{if(layer==='objects')fn(o);};
    Visibility.playerCover=()=>0;Visibility.hidden=()=>false;Render.buildingHit=()=>null;Render.tallPropHit=()=>null;
    objectHandler.try=()=>{opened++;return true;};
    try {
      interactTap(s,104,88);
      assert.falsy(HiddenObjects.isHidden(s.save,o));assert.eq(opened,0,'reveal consumes the first tap');
      assert.falsy(s.save.opened?.length);assert.falsy(s.save.inventory,'no loot granted by discovery');
    } finally {
      WorldGen.forEachItem=each;Visibility.playerCover=cover;Visibility.hidden=hiddenCover;
      Render.buildingHit=hit;Render.tallPropHit=spill;objectHandler.try=open;
    }
  });
  test('concealed objects: old exact-cell records retain discovery semantics',()=>{
    const s=scene(),o={...hidden(1,0),hidden:undefined,revealOnCell:true};
    assert.truthy(HiddenObjects.isHidden(s.save,o));assert.falsy(HiddenObjects.reveal(s,o));
    s.playerM.x+=16;assert.truthy(HiddenObjects.reveal(s,o));
  });
  test('hidden objects: two cells away remains hidden despite camera peek and extra reach', () => {
    const s = scene();
    s.cameraM = { x: 120, y: 88 }; s.peekM = { x: 32, y: 0 };
    s.save.reachUpgrades = 7; s.save.reachPotionUntil = Date.now() + 100000;
    const o = hidden(2, 0);
    assert.eq(HiddenObjects.reveal(s, o), false);
    assert.eq(HiddenObjects.isHidden(s.save, o), true);
    s.playerM.x += 16;
    assert.eq(HiddenObjects.reveal(s, o), true);
  });
  test('hidden objects: discovery survives reload and does not cross cave depths', () => {
    const s = scene(), o = hidden();
    o.depth = 1;
    assert.eq(HiddenObjects.reveal(s, o), false);
    s.depth = 1;
    assert.eq(HiddenObjects.reveal(s, o), true);
    s.save = JSON.parse(JSON.stringify(s.save));
    assert.eq(HiddenObjects.isHidden(s.save, o), false);
    assert.eq(HiddenObjects.reveal(s, o), false);
  });
  test('hidden objects: adjacency crosses a tile row with a different cell count', () => {
    const s = scene();
    s.cellsForRow = ty => ty <= 0 ? 16 : 20;
    s.playerM = { x: 200, y: 248 };
    const o = { ...hidden(), x: 198.4, y: 262.4 };
    assert.eq(HiddenObjects.reveal(s, o), true);
  });
  test('hidden objects: spirit discovery activates once without claiming shrine treasure', () => {
    const s = scene(), o = { ...hidden(1, 1), kind: 'shrine_spirit', templeZone: 'spirit-park' };
    let story;
    s.showMessageModal = row => { story = row; };
    assert.eq(HiddenObjects.reveal(s, o), true);
    assert.eq(story.body, `Shrine spirit discovered. The shrine begins to glow.\n\nCondition met: ${Temples.SPIRIT_CONDITION}`);
    assert.eq(Temples.isActive(s.save, o), true);
    assert.eq(s.save.temples['spirit-park'].rewardClaimed, false);
    assert.eq(HiddenObjects.reveal(s, o), false);
  });
  test('hidden objects: hidden generated and saved objects cannot intercept taps', () => {
    const s = scene(), o = { ...hidden(), kind: 'staircase' };
    const previous = WorldGen.forEachItem;
    WorldGen.forEachItem = (layer, fn) => { fn(o); };
    s.save.hiddenObjects = [{ ...hidden(), id: 'saved-spirit', kind: 'shrine_spirit' }];
    try {
      assert.eq(findItemInTapCell(s, 'objects', { x: 88, y: 88 }), null);
      assert.eq(TAP_HANDLERS.find(h => h.name === 'object').try({ scene: s, save: s.save, wm: { x: 88, y: 88 } }), false);
      HiddenObjects.reveal(s, o);
      assert.eq(findItemInTapCell(s, 'objects', { x: 88, y: 88 }), o);
    } finally { WorldGen.forEachItem = previous; }
  });
})();
