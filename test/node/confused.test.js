(function () {
  const lift = (name, args = '') => SCENE_SRC.match(new RegExp('\\n  '+name+'\\('+args+'\\) \\{([\\s\\S]*?)\\n  \\}\\n'))[1];
  const step = new Function('dt','capMS','WALK_M_S',lift('_confusedStep','dt, capMS'));
  const hold = new Function('WALK_M_S','SLOW_BODY_M_S',lift('_bodyHold'));
  function body() { return {save:{energy:100},playerM:{x:0,y:0},startWorldM:{x:0,y:0},
    cellM:5,_targetM:{x:1000,y:1000},gpsM:{x:2000,y:2000},_cellBlocked:()=>false,_playDirected(){}}; }
  test('confused: ten gameplay seconds, refresh and cure use the shared condition lifecycle', () => {
    const save={energy:100};
    Conditions.apply(save,'confused');
    Conditions.tick(save,9999);assert.truthy(Conditions.active(save,'confused'));
    Conditions.tick(save,1);assert.falsy(Conditions.active(save,'confused'));
    assert.eq(save.energy,100);
    Conditions.apply(save,'confused');Conditions.tick(save,3000);Conditions.apply(save,'confused');
    assert.eq(save.conditions.confused.remainingMs,10000);
    assert.truthy(Conditions.useAntidote(save));assert.falsy(Conditions.active(save,'confused'));
  });
  test('confused: forced loops ignore distant GPS targets and honour walls and movement caps', () => {
    const s=body(), random=Math.random;
    try {
      Math.random=()=>0.5;
      for(let i=0;i<100;i++)step.call(s,.05,null,2);
      assert.lt(Math.hypot(s.playerM.x,s.playerM.y),4,'curved loops stay local');
      assert.eq(s._targetM.x,1000);assert.eq(s.gpsM.x,2000,'the real fix is never overwritten');
      const busy=body();busy._busyWheel=()=>true;
      step.call(busy,1,null,2);assert.eq(busy.playerM.x,0,'active work keeps its body hold');
      const blocked=body();blocked._cellBlocked=()=>true;
      step.call(blocked,1,null,2);assert.eq(blocked.playerM.x,0);assert.eq(blocked.playerM.y,0);
      const slow=body();step.call(slow,.1,.2,2);
      assert.lte(Math.hypot(slow.playerM.x,slow.playerM.y),.020001);
      const down=body();down.save.energy=0;step.call(down,1,null,2);assert.eq(down.playerM.x,0);
    } finally {Math.random=random;}
  });
  test('cube contact: nearby live overlap slows and leaving or defeating it releases the cap', () => {
    const s=body(),cube={kind:'gelatinous_cube',id:'cube',x:1,y:0};s._foeBodies=[cube];
    let state=hold.call(s,2,1.2);assert.eq(state.capMS,1);assert.truthy(state.slowed);
    cube.x=20;assert.falsy(hold.call(s,2,1.2).slowed);
    cube.x=1;s.save.caught=['cube'];assert.falsy(hold.call(s,2,1.2).slowed);
    s.save.caught=[];Conditions.apply(s.save,'jellyfish_stun');state=hold.call(s,2,1.2);
    assert.truthy(state.pinned);assert.falsy(state.slowed,'an actual hold uses its own condition');
    assert.eq(Conditions.CONTEXT_STATUS.slowed.label,'Slowed');
    assert.falsy(Conditions.CONTEXT_STATUS.slowed.durationMs,'contact status has no countdown');
  });
  test('confusion puff: actual projectile damage applies confusion, blocked damage does not', () => {
    const hit=new Function('shot',lift('_shotHitsPlayer','shot'));
    const s={save:{energy:100},_losePlayerEnergy(n){this.save.energy-=n;return n;},
      _applyCondition(id){Conditions.apply(this.save,id);}};
    assert.truthy(hit.call(s,{damage:1,condition:'confused'}));
    assert.truthy(Conditions.active(s.save,'confused'));
    Conditions.cure(s.save,'confused');s.save.immortalPotionUntil=Date.now()+10000;
    assert.falsy(hit.call(s,{damage:1,condition:'confused'}));assert.falsy(Conditions.active(s.save,'confused'));
  });
  test('confused: update routes inputs to forced loops and stronger holds take precedence', () => {
    const a=SCENE_SRC.indexOf('const bodyHold = this._bodyHold();');
    const b=SCENE_SRC.indexOf('\n    // One throttled flash for the stick-walking drain',a);
    const move=new Function('stick','vx','vy','speedMul','dt',SCENE_SRC.slice(a,b));
    const s=body();let loops=0,normal=0;
    s._bodyHold=()=>({pinned:Conditions.active(s.save,'pinned'),capMS:null});
    s._tickWalkHazards=()=>{};s._confusedStep=()=>{loops++;};
    s._steerManual=s._steerTarget=s._followStep=s._driftHome=()=>{normal++;};
    Conditions.apply(s.save,'confused');move.call(s,{x:1,y:0},1,0,1,.1);
    assert.eq(loops,1);assert.eq(normal,0,'GPS, keyboard and stick cannot steer the confused body');
    Conditions.apply(s.save,'pinned');move.call(s,{x:1,y:0},1,0,1,.1);
    assert.eq(loops,1,'pin stops forced walking too');
    Conditions.clearDebuffs(s.save);move.call(s,{x:1,y:0},1,0,1,.1);
    assert.gt(normal,0,'normal steering returns after cure');
  });
  test('confused: direct GPS placement cannot teleport a confused body', () => {
    const place=new Function(lift('_placeBodyOnFix'));
    const s=body();s._carveLanding=()=>{};Conditions.apply(s.save,'confused');
    place.call(s);assert.eq(s.playerM.x,0);
    Conditions.cure(s.save,'confused');s._confusedRecover=true;
    place.call(s);assert.eq(s.playerM.x,0);
  });
})();
