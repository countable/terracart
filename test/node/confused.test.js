(function () {
  const lift = (name, args = '') => SCENE_SRC.match(new RegExp('\\n  '+name+'\\('+args+'\\) \\{([\\s\\S]*?)\\n  \\}\\n'))[1];
  const step = new Function('dt','capMS','WALK_M_S','intent',lift('_confusedStep','dt, capMS, intent = null'));
  const hold = new Function('WALK_M_S','SLOW_BODY_M_S',lift('_bodyHold'));
  function body() { return {save:{energy:100,conditions:{confused:{remainingMs:20000}}},playerM:{x:0,y:0},startWorldM:{x:0,y:0},
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
      assert.eq(Math.abs(s._confusedLoop.turn),0.3,'confusion turns slowly at a fixed rate');
      assert.lt(Math.hypot(s.playerM.x,s.playerM.y),10,'curved loops stay within walking distance');
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
  test('confused: walking input and collisions change movement without changing the steady heading', () => {
    const random=Math.random;
    try {
      Math.random=()=>0.5;
      const idle=body(), walking=body(), blocked=body();
      for(const s of [idle,walking,blocked]) s.save.conditions.confused.remainingMs=5000;
      blocked._cellBlocked=()=>true;
      // More than one revolution: neither speed nor direction resets at a circle.
      for(let i=0;i<500;i++) {
        const intent=i<250?{x:1,y:0}:{x:0,y:-1};
        step.call(idle,.05,null,2);
        step.call(walking,.05,null,2,intent);
        step.call(blocked,.05,null,2,intent);
        assert.eq(walking.compassDeg,idle.compassDeg);
        assert.eq(blocked.compassDeg,idle.compassDeg);
      }
      assert.inRange(idle._confusedLoop.angle-(Math.PI+0.3*25),-1e-9,1e-9);
      assert.truthy(Math.hypot(walking.playerM.x-idle.playerM.x,walking.playerM.y-idle.playerM.y)>1,
        'walking input still affects translation');
      assert.eq(blocked.playerM.x,0);assert.eq(blocked.playerM.y,0);
    } finally {Math.random=random;}
  });
  test('confused: remaining duration blends manual and GPS steering continuously into the compass', () => {
    for (const ms of [0,5000,10000,19000,20000,30000]) {
      for (const manual of [false,true]) {
        const s=body();s.save.conditions.confused.remainingMs=ms;
        s._targetM={x:0,y:-1000};
        s._confusedLoop={angle:0,turn:1.2,left:3};
        const intent=manual ? {x:0,y:-1} : null;
        step.call(s,.05,null,2,intent);
        const share=Math.min(1,ms/20000),angle=.06;
        assert.inRange(s.playerM.x-.1*Math.cos(angle)*share,-1e-9,1e-9);
        assert.inRange(s.playerM.y-.1*(-(1-share)+Math.sin(angle)*share),-1e-9,1e-9);
        if (ms<20000) {
          const opposite=body();opposite.save.conditions.confused.remainingMs=ms;
          opposite._targetM={x:0,y:1000};opposite._confusedLoop={angle:0,turn:1.2,left:3};
          step.call(opposite,.05,null,2,manual?{x:0,y:1}:null);
          assert.gt(opposite.playerM.y,s.playerM.y,'controls retain influence below twenty seconds');
        }
      }
    }
  });
  test('confused: countdown restores control gradually and strong durations survive normalization', () => {
    const s=body();
    Conditions.apply(s.save,'confused',0,{durationMs:30000});
    Conditions.normalize(s.save);assert.eq(s.save.conditions.confused.remainingMs,30000);
    Conditions.apply(s.save,'confused');assert.eq(s.save.conditions.confused.remainingMs,30000,'a weaker enemy puff cannot cure dense gas');
    assert.eq(Conditions.confusionSteering(s.save),1);
    Conditions.tick(s.save,11000);assert.eq(Conditions.confusionSteering(s.save),.95);
    Conditions.tick(s.save,9000);assert.eq(Conditions.confusionSteering(s.save),.5);
    Conditions.tick(s.save,5000);assert.eq(Conditions.confusionSteering(s.save),.25);
    Conditions.tick(s.save,5000);assert.eq(Conditions.confusionSteering(s.save),0);
  });
  test('confused: frame routes keyboard, stick and GPS intent through partial takeover', () => {
    const a=SCENE_SRC.indexOf('const bodyHold = this._bodyHold();');
    const b=SCENE_SRC.indexOf('\n    // THE DRAIN ROLL-UP flushes here',a);
    const move=new Function('stick','vx','vy','speedMul','dt',SCENE_SRC.slice(a,b));
    for (const mode of ['keyboard','stick','gps']) {
      for (const ms of [5000,19000,20000]) {
        const s=body();s.save.conditions.confused.remainingMs=ms;
        s._targetM=mode==='gps'?{x:0,y:-1000}:{x:0,y:1000};
        s._confusedLoop={angle:0,turn:1.2,left:3};
        s._bodyHold=()=>({pinned:false,capMS:null});s._tickWalkHazards=()=>{};
        let manualSeconds=0,targetSeconds=0;
        s._steerManual=(x,y,dt)=>{manualSeconds+=dt;};
        s._steerTarget=(x,y,mul,dt)=>{targetSeconds+=dt;};s._driftHome=()=>{};
        s._confusedStep=(dt,cap,intent)=>step.call(s,dt,cap,2,intent);
        move.call(s,mode==='stick'?{x:0,y:-1}:null,0,mode==='keyboard'?-1:0,100,.05);
        const share=ms/20000;
        assert.inRange(s.playerM.y-.1*(-(1-share)+Math.sin(.06)*share),-1e-9,1e-9,mode);
        assert.inRange(targetSeconds-.05*(1-share),-1e-9,1e-9,'target lead matches remaining control');
        if(mode==='stick')assert.inRange(manualSeconds-.05*(1-share),-1e-9,1e-9,'stick stamina matches remaining control');
      }
    }
  });
  test('confused: compass rotates with the forced circular walk and restores the fallback', () => {
    const s=body();s.facing={x:0,y:-1};s.compassDeg=null;s.mapRot=-0.8;
    const finish=new Function(lift('_endConfusedWalk'));
    step.call(s,.05,null,2);
    const before=s.compassDeg;
    for(let i=0;i<10;i++)step.call(s,.05,null,2);
    assert.truthy(s.compassDeg!==before,'compass visibly rotates');
    const rad=s.compassDeg*Math.PI/180;
    assert.inRange(s.facing.x-Math.sin(rad),-1e-9,1e-9);
    assert.inRange(s.facing.y+Math.cos(rad),-1e-9,1e-9);
    s.mapRot=1.7;
    finish.call(s);
    assert.eq(s.compassDeg,null,'movement facing fallback restored without device compass');
    assert.eq(s.facing.x,0);assert.eq(s.facing.y,-1);
    assert.eq(s.mapRot,-0.8,'map returns to its prior heading without a device sensor');
    assert.eq(s._confusedLoop,null);assert.truthy(s._confusedRecover);
  });
  test('confused: expiry and cure restore the usual heading even while movement is pinned', () => {
    const a=SCENE_SRC.indexOf('const bodyHold = this._bodyHold();');
    const b=SCENE_SRC.indexOf('\n    // THE DRAIN ROLL-UP flushes here',a);
    const move=new Function('stick','vx','vy','speedMul','dt',SCENE_SRC.slice(a,b));
    const finish=new Function(lift('_endConfusedWalk'));
    for(const end of ['expiry','cure']) {
      const s=body();s.facing={x:1,y:0};s.compassDeg=90;
      step.call(s,.1,null,2);
      s._bodyHold=()=>({pinned:true});s._tickWalkHazards=()=>{};
      s._endConfusedWalk=()=>finish.call(s);
      if(end==='expiry') Conditions.tick(s.save,20000);
      else Conditions.cure(s.save,'confused');
      move.call(s,null,0,0,1,.05);
      assert.eq(s.compassDeg,90,end);assert.eq(s.facing.x,1);assert.eq(s.facing.y,0);
      assert.eq(s._confusedLoop,null);
    }
  });
  test('confused: live orientation cannot overwrite spinning compass and latest heading restores', () => {
    const callbacks={};
    const win={screen:{orientation:{angle:0}},addEventListener(name,fn){callbacks[name]=fn;}};
    const attach=new Function('window','performance',lift('_attachCompass'));
    const finish=new Function(lift('_endConfusedWalk'));
    const s=body();s.facing={x:0,y:-1};
    let clock=100;
    attach.call(s,win,{now:()=>clock+=100});
    Conditions.apply(s.save,'confused');step.call(s,.05,null,2);
    const spinning=s.compassDeg;
    callbacks.deviceorientationabsolute({absolute:true,alpha:270});
    assert.eq(s.compassDeg,spinning,'real east heading cannot steer confused body');
    assert.inRange(s._deviceCompass.deg,89.999,90.001);
    Conditions.cure(s.save,'confused');finish.call(s);
    assert.inRange(s.compassDeg,89.999,90.001,'expiry restores the newest real sample');
    assert.inRange(s.facing.x,.99999,1.00001);
    callbacks.deviceorientationabsolute({absolute:true,alpha:180});
    assert.gt(s.compassDeg,90,'sensor resumes visible compass updates');
  });
  test('obstacle balance: Slowed is contextual and confusion applies its speed reduction once', () => {
    const plain=body(), balanced=body();
    plain._confusedLoop={angle:0,turn:1.2,left:3};
    balanced._confusedLoop={angle:0,turn:1.2,left:3};
    balanced._obstacleStep={liftPx:3};
    const state=hold.call(balanced,2,1.2);
    assert.truthy(state.slowed);assert.eq(state.capMS,null,'balance is a multiplier, not another cap');
    step.call(plain,.05,1,2);step.call(balanced,.05,1,2);
    assert.inRange(Math.hypot(balanced.playerM.x,balanced.playerM.y)/Math.hypot(plain.playerM.x,plain.playerM.y),.69999,.70001);
    balanced._obstacleStep={liftPx:0};assert.falsy(hold.call(balanced,2,1.2).slowed);
  });
  test('cube contact: nearby live overlap slows and leaving or defeating it releases the cap', () => {
    const s=body(),cube={kind:'gelatinous_cube',id:'cube',x:1,y:0};s._foeBodies=[cube];
    let state=hold.call(s,2,1.2);assert.eq(state.capMS,1);assert.truthy(state.slowed);
    cube.x=20;assert.falsy(hold.call(s,2,1.2).slowed);
    cube.x=1;s.save.caught=['cube'];assert.falsy(hold.call(s,2,1.2).slowed);
    s.save.caught=[];Conditions.apply(s.save,'jellyfish_stun');state=hold.call(s,2,1.2);
    assert.truthy(state.pinned);assert.falsy(state.slowed,'an actual hold uses its own condition');
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
    const b=SCENE_SRC.indexOf('\n    // THE DRAIN ROLL-UP flushes here',a);
    const move=new Function('stick','vx','vy','speedMul','dt',SCENE_SRC.slice(a,b));
    const s=body();let loops=0,normal=0;
    s._bodyHold=()=>({pinned:Conditions.active(s.save,'pinned'),capMS:null});
    s._tickWalkHazards=()=>{};s._confusedStep=()=>{loops++;};
    s._steerManual=s._steerTarget=s._followStep=s._driftHome=()=>{normal++;};
    s.save.conditions.confused.remainingMs=10000;move.call(s,{x:1,y:0},1,0,1,.1);
    assert.eq(loops,1);assert.eq(normal,2,'keyboard and stick retain their targets below twenty seconds');
    Conditions.apply(s.save,'confused',0,{durationMs:20000});
    move.call(s,{x:1,y:0},1,0,1,.1);
    assert.eq(loops,2);assert.eq(normal,2,'full confusion stops manual target steering');
    Conditions.apply(s.save,'pinned');move.call(s,{x:1,y:0},1,0,1,.1);
    assert.eq(loops,2,'pin stops forced walking too');
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
  test('confused: recovery ends CONFUSED_RECOVER_MS after the condition, so GPS following resumes', () => {
    const expire=new Function('CONFUSED_RECOVER_MS','now',lift('_expireConfusedRecover','now'));
    const ms=Number(SCENE_SRC.match(/const CONFUSED_RECOVER_MS = (\d+);/)[1]);
    const s=body();Conditions.apply(s.save,'confused');s._confusedRecover=true;
    expire.call(s,ms,1000);assert.truthy(s._confusedRecover,'held while still confused');
    Conditions.cure(s.save,'confused');
    expire.call(s,ms,2000);assert.truthy(s._confusedRecover,'the walk back starts');
    expire.call(s,ms,2000+ms-1);assert.truthy(s._confusedRecover);
    expire.call(s,ms,2000+ms);assert.falsy(s._confusedRecover,'then normal following, ramp and snap, takes over');
    assert.truthy(/this\._expireConfusedRecover\?\.\(performance\.now\(\)\);/.test(SCENE_SRC),'run every movement frame');
  });
})();
