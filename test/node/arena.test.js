(function () {
  test('arena: boundary is exactly 100 metres and finite',()=>{
    const p={x:1000,y:2000};
    assert.truthy(Arena.inside(p,950,2050));
    assert.falsy(Arena.inside(p,1050.01,2000));
    assert.falsy(Arena.inside(p,NaN,2000));
  });
  test('arena: clearance measures the closest road edge, including segment ends',()=>{
    const roads=[{width:10,points:[{x:0,y:0},{x:100,y:0}]}];
    assert.eq(Arena.roadClearance({x:50,y:55},roads),50);
    assert.lt(Arena.roadClearance({x:50,y:54.9},roads),50);
    assert.eq(Arena.roadClearance({x:140,y:30},roads),45);
  });
  test('arena: star trial requires every distinct pickup',()=>{
    const run=Arena.start('sparks'),c=Arena.CHALLENGES.find(c=>c.id===run.id);
    for(let i=0;i<12;i++)Arena.tick(run,c.points[0],.1);
    assert.eq(run.collected.length,1);assert.eq(run.status,'playing');
    for(const point of c.points)Arena.tick(run,point,.1);
    assert.eq(run.status,'won');
  });
  test('arena: rune gates must be visited in order',()=>{
    const run=Arena.start('runes'),c=Arena.CHALLENGES.find(c=>c.id===run.id);
    Arena.tick(run,c.points[3],.1);assert.eq(run.collected.length,0);
    for(const p of c.points)Arena.tick(run,p,.1);
    assert.eq(run.status,'won');
  });
  test('arena: timed circuit fails without completed gates',()=>{
    const run=Arena.start('race');
    for(let i=0;i<602;i++)Arena.tick(run,{x:0,y:0},.1);
    assert.eq(run.status,'failed');
  });
  test('arena: a background time jump cannot solve survival',()=>{
    const run=Arena.start('beams');Arena.tick(run,{x:48,y:48},600);
    assert.eq(run.status,'playing');assert.eq(run.elapsed,.1);
    for(let i=0;i<301;i++) {
      const beam=Math.sin((run.elapsed+.1)*.7)*55;
      Arena.tick(run,{x:beam>0?-40:40,y:48},.1);
    }
    assert.eq(run.status,'won');
  });
  test('arena: survival cannot be won by camping in a corner',()=>{
    const run=Arena.start('beams');
    for(let i=0;i<301;i++)Arena.tick(run,{x:48,y:48},.1);
    assert.eq(run.status,'failed');
  });
  test('arena: hazard hits are debounced and three strikes fail',()=>{
    const run=Arena.start('beams');
    for(let i=0;i<50;i++)Arena.tick(run,{x:Math.sin((run.elapsed+.1)*.7)*55,y:0},.1);
    assert.eq(run.hits,3);assert.eq(run.status,'failed');
  });
  test('arena: vigil requires time in the sigil, not merely time elapsed',()=>{
    const run=Arena.start('vigil');
    for(let i=0;i<200;i++)Arena.tick(run,{x:48,y:48},.1);
    assert.eq(run.held,0);assert.eq(run.status,'playing');
    // Dodge rings only while they cross the sigil, returning immediately.
    for(let i=0;i<500&&run.status==='playing';i++) {
      const radius=((run.elapsed+.1)*9)%60;
      Arena.tick(run,{x:radius<15?20:0,y:0},.1);
    }
    assert.eq(run.status,'won');
  });
})();

(function () {
  const sceneSource = SCENE_SRC.match(/class SceneArena \{[\s\S]*?\n\}/)[0];
  const Scene = new Function(`return (${sceneSource});`)();
  function scene() {
    return Object.assign(new Scene(), {
      depth: Arena.DEPTH, save: { energy: 100, arena: { portal: { x: 0, y: 0 } } },
      startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 }, feetOffsetM: 0,
      _arenaTrial: Arena.start('sparks'), _dialogOpen: () => false,
      syncMoveTarget() {},
    });
  }
  test('arena scene: inactive tab and open dialog freeze trial time', () => {
    const s = scene(), before = document.hidden;
    try {
      document.hidden = true;
      s._tickArena(.1);
      assert.eq(s._arenaTrial.elapsed, 0);
      document.hidden = false;
      s._dialogOpen = () => true;
      s._tickArena(.1);
      assert.eq(s._arenaTrial.elapsed, 0);
      s._dialogOpen = () => false;
      s._tickArena(.1);
      assert.eq(s._arenaTrial.elapsed, .1);
    } finally { document.hidden = before; }
  });
  test('arena scene: an escaped position is clamped before trial evaluation', () => {
    const s = scene();
    s.playerM = { x: 500, y: -500 };
    s._tickArena(.1);
    assert.eq(s.playerM.x, 50);
    assert.eq(s.playerM.y, -50);
    assert.eq(s._arenaTrial.collected.length, 0);
  });
  test('arena scene: leaving cancels an unfinished challenge without a victory', () => {
    const s = scene();
    s.depth = 0;
    s._tickArena(.1);
    assert.eq(s._arenaTrial, null);
    assert.falsy(s.save.dungeonProgression?.level4Key);
  });
})();
