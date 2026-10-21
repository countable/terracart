// Exercise real scene work lifecycle with one retained Phaser text stand-in.
(function () {
  function lift(signature) {
    const start = SCENE_SRC.indexOf('\n  ' + signature);
    assert.gte(start, 0, signature);
    return SCENE_SRC.slice(start + 1, SCENE_SRC.indexOf('\n  }\n', start) + 4);
  }
  let now = 1000;
  const declarations = APP_JS_SRC.match(/const WORK_ACTION_LABELS = [\s\S]*?;/)[0];
  const methods = new Function('performance', 'WORK_ACTION_LABELS', 'TOAST_TIER', 'phaserFontUI',
    'UI_INK', 'UI_SHADOW', 'ENERGY_POP_HEAD_PX', 'HeadingUp', 'clampTextX', 'W',
    'return ({' + [
      '_syncWorkActionLabel() {', 'cancelWorkProgress() {', '_stopDownedActions() {', '_drawWorkProgress() {',
      'startWorkProgress(worldX, worldY, onComplete, durationMs = 3000, energyRefund = 0, toolSlot = null, trackCreature = null) {',
    ].map(lift).join(',') + '});')(
      {now:()=>now}, new Function(declarations + 'return WORK_ACTION_LABELS;')(),
      {note:{font:'12px',stroke:0,pad:6,padY:4,depth:100,shadow:{offsetX:1,offsetY:1,blur:4}}},
      font=>({font}), '#fff', '#000', 30,
      {toOverlayPt:(_s,x,y,lift)=>({x:x+5,y:y+lift})}, x=>x, 352);
  function scene() {
    let creates=0, shutdown;
    const label={text:'',width:80,visible:false,
      setText(text){this.text=text;return this;},setVisible(v){this.visible=v;return this;},
      setPosition(x,y){this.x=x;this.y=y;return this;},setOrigin(){return this;},setDepth(){return this;}};
    const s=Object.assign({save:{energy:50,relics:{}},
      playerScreen:()=>({x:100,y:200}), add:{text(){creates++;return label;}},
      events:{once(event,fn){assert.eq(event,'shutdown');shutdown=fn;}},
      _setWorkProgressIcon(){},_drawSwordSwing(){},_drawWatering(){},
    },methods);
    return {s,label,creates:()=>creates,shutdown:()=>shutdown()};
  }
  test('work note: persists, follows the player, and reuses one text across tools',()=>{
    const {s,label,creates}=scene();
    s.startWorkProgress(0,0,()=>{},3000,0,'axe');
    assert.eq(label.text,'chopping...');assert.truthy(label.visible);
    for(let i=0;i<100;i++)s._syncWorkActionLabel();
    assert.eq(creates(),1);assert.truthy(label.visible);
    s.playerScreen=()=>({x:123,y:240});s._syncWorkActionLabel();
    assert.eq(label.x,128);assert.eq(label.y,188);assert.truthy(label._huUI);
    s.cancelWorkProgress();assert.falsy(label.visible);
    s.startWorkProgress(0,0,()=>{},3000,0,'pickaxe');
    assert.eq(label.text,'mining...');assert.eq(creates(),1);
  });
  test('work note: completion hides it before awarding the action',()=>{
    const {s,label}=scene();let complete=false;
    s.startWorkProgress(0,0,()=>{assert.falsy(label.visible);complete=true;},10,0,'axe');
    now=s._workProgress.startT+s._workProgress.durationMs+1;
    s._drawWorkProgress();assert.truthy(complete);assert.falsy(s._workProgress);
  });
  test('work note: death, invalid projection and scene shutdown cannot leave stale text',()=>{
    const {s,label,shutdown}=scene();
    s.startWorkProgress(0,0,()=>{},3000,0,'hoe');
    s.playerScreen=()=>null;s._syncWorkActionLabel();assert.falsy(label.visible);
    s.playerScreen=()=>({x:1,y:2});s._syncWorkActionLabel();assert.truthy(label.visible);
    s.save.energy=0;s._stopDownedActions();assert.falsy(label.visible);
    s.save.energy=50;s.startWorkProgress(0,0,()=>{},3000,0,'fishing_rod');
    assert.eq(label.text,'fishing...');shutdown();assert.falsy(label.visible);
    assert.eq(s._workActionLabel,null);assert.eq(s._workProgress,null);
  });
})();
