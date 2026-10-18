(function () {
  test('schoolyard: blue and red score full accumulated occupancy seconds', () => {
    const G = SchoolyardGame, run = G.start();
    G.tick(run, { x: 2, y: 0 }, .6);
    G.tick(run, { x: 0, y: 0 }, .2);
    assert.eq(run.score, 0);
    G.tick(run, { x: 2, y: 0 }, .4);
    assert.eq(run.score, 1);
    G.tick(run, { x: 4, y: 0 }, .5);
    G.tick(run, { x: 0, y: 0 }, .2);
    G.tick(run, { x: 4, y: 0 }, .5);
    assert.eq(run.score, -2);
  });

  test('schoolyard: purple awards once, becomes blue and resets after shifting', () => {
    const G = SchoolyardGame, run = G.start();
    G.tick(run, { x: 4, y: 1 }, 0);
    assert.eq(run.score, 5);
    assert.eq(G.color(run, 4, 1), 'blue');
    G.tick(run, { x: 4, y: 1 }, 1);
    assert.eq(run.score, 6);
    G.tick(run, { x: -1, y: -1 }, 2);
    assert.eq(G.color(run, 5, 1), 'purple');
    G.tick(run, { x: 5, y: 1 }, 0);
    assert.eq(run.score, 11);
  });

  test('schoolyard: preview matches the next eastward shift, including wrapped tiles', () => {
    const G = SchoolyardGame, run = G.start(), next = [];
    for (let y = 0; y < G.SPEC.size; y++) for (let x = 0; x < G.SPEC.size; x++) {
      assert.eq(G.color(run, (x + 1) % G.SPEC.size, y, true), G.color(run, x, y));
      next.push([x, y, G.color(run, x, y, true)]);
    }
    G.tick(run, null, G.SPEC.period);
    for (const [x, y, value] of next) assert.eq(G.color(run, x, y), value);
    assert.eq(G.color(run, -1, 0), null);
    assert.eq(G.color(run, 7, 0), null);
  });

  test('schoolyard: scoring is frame-independent across shifts and stops at thirty seconds', () => {
    const G = SchoolyardGame, big = G.start(), small = G.start();
    G.tick(big, { x: 4, y: 1 }, 100);
    for (let i = 0; i < 3000; i++) G.tick(small, { x: 4, y: 1 }, .01);
    G.tick(small, { x: 4, y: 1 }, .001);
    assert.eq(big.score, small.score);
    assert.eq(big.elapsed, 30);
    assert.eq(G.remaining(big), 0);
    assert.falsy(big.active);
    const score = big.score;
    G.tick(big, { x: 4, y: 1 }, 30);
    assert.eq(big.score, score);
    assert.eq(G.color(big, 4, 1), null);
    const fresh = G.start();
    assert.eq(fresh.score, 0);
    assert.eq(G.remaining(fresh), 30);
  });

  function sceneFixture() {
    const body = SCENE_SRC.match(/class SceneSchoolyard \{([\s\S]*?)\n  _drawSchoolyard\(\)/)[1];
    const Scene = new Function('SchoolyardGame', 'SchoolyardFields', 'performance', 'document',
      'Combat', 'Conditions', 'playerWorldM', `return class { ${body} };`)(
      SchoolyardGame, { fields: () => [field] }, { now: () => 0 }, { hidden: false },
      { playerDowned: () => false }, { flying: () => false }, s => ({ x: s.x, y: 0 }));
    const field = { id: 'school', cellIX: 3, cellIY: 3,
      cells: [{ cellIX: 3, cellIY: 3, x: 3, y: 3 }] };
    const scene = new Scene();
    Object.assign(scene, { depth: 0, feetOffsetM: 0, x: 3, save: { energy: 100 },
      _dialogOpen() { return !!this.dialog; },
      cellAt(x) { return { cellIX: x, cellIY: 3 }; },
      flashAtPlayer(message) { this.messages.push(message); }, messages: [] });
    return scene;
  }

  test('schoolyard scene: walking onto the flag starts once and replay requires leaving', () => {
    const scene = sceneFixture();
    scene.x = 2;
    scene._tickSchoolyard(0);
    assert.falsy(scene._schoolyardRound);
    scene.x = 3;
    scene._tickSchoolyard(0);
    const first = scene._schoolyardRound;
    assert.truthy(first.run.active);
    assert.eq(scene.messages.length, 1);
    SchoolyardGame.tick(first.run, null, 30);
    scene._tickSchoolyard(.05);
    assert.eq(scene._schoolyardRound, first);
    scene.x = 2;
    scene._tickSchoolyard(.05);
    scene.x = 3;
    scene._tickSchoolyard(0);
    assert.truthy(scene._schoolyardRound !== first);
    assert.eq(scene._schoolyardRound.run.elapsed, 0);
    assert.eq(scene._schoolyardRound.run.score, 0);
  });

  test('schoolyard scene: dialogs pause the clock and leaving surface clears the round', () => {
    const scene = sceneFixture();
    scene._tickSchoolyard(.05);
    const run = scene._schoolyardRound.run;
    assert.eq(run.elapsed, .05);
    scene.dialog = true;
    scene._tickSchoolyard(.05);
    assert.eq(run.elapsed, .05);
    scene.dialog = false;
    scene._tickSchoolyard(.05);
    assert.eq(run.elapsed, .1);
    scene._tickSchoolyard(1);
    assert.eq(run.elapsed, 1.1);
    scene.depth = 1;
    scene._tickSchoolyard(.05);
    assert.eq(scene._schoolyardRound, null);
    assert.eq(scene._schoolyardOnFlag, null);
  });
})();
