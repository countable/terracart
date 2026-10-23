(function () {
  test('tutorial guidance: completing every step preserves the purse and does not introduce coins', () => {
    const scene = { save: { money: 0 }, completed: [], buildInventoryDOM() {},
      _celebrateStarterStep(step) { this.completed.push(step.id); } };
    const event = liftSceneMethod('questEvent', { persistSave() {} });
    for (const step of STARTER_CHAIN) event.call(scene, step.event);
    assert.eq(scene.save.money, 0, 'guidance adds no money to ordinary action rewards');
    assert.falsy(scene.save.firstCoinPending, 'tutorial never introduces an unearned coin');
    assert.eq(scene.completed.length, STARTER_CHAIN.length);
    assert.truthy(Quests.starterAllDone(scene.save));
  });

  test('tutorial guidance: Spirit acknowledges a step then advances, respecting dismissal', () => {
    const fields = Object.fromEntries(['.step', '.title', '.body'].map(k => [k, { textContent: '' }]));
    const classes = new Set();
    const element = { style: {}, querySelector: k => fields[k],
      classList: { add: k => classes.add(k), remove: k => classes.delete(k) } };
    let finish;
    const deps = { document: { getElementById: () => element },
      setTimeout(fn) { finish = fn; return 1; }, clearTimeout() {}, persistSave() {} };
    const scene = { save: {}, _tilesReady: 1 };
    scene.updateObjectiveDOM = liftSceneMethod('updateObjectiveDOM', deps);
    const cheer = liftSceneMethod('_playStarterCheer', deps);
    scene.updateObjectiveDOM();
    assert.eq(fields['.body'].textContent, STARTER_CHAIN[0].body);
    const done = Quests.onStarterEvent(scene.save, 'chest');
    cheer.call(scene, done);
    assert.eq(fields['.body'].textContent, done.completion);
    assert.truthy(classes.has('done'));
    finish();
    assert.eq(fields['.body'].textContent, STARTER_CHAIN[1].body);
    assert.falsy(classes.has('done'));
    cheer.call(scene, done);
    liftSceneMethod('dismissObjective', deps).call(scene);
    finish();
    assert.eq(element.style.display, 'none', 'completion timer cannot reopen dismissed guidance');
    Quests.starterShow(scene.save); scene.updateObjectiveDOM();
    assert.eq(element.style.display, 'block', 'menu can restore the current instruction');
    scene._tilesReady = 0; scene.updateObjectiveDOM();
    assert.eq(element.style.display, 'none', 'no advice about unloaded ground');
  });
  test('tutorial guidance: Spirit waits for the opening, says hello once, then gives step 1', () => {
    const fields = Object.fromEntries(['.step', '.title', '.body'].map(k => [k, { textContent: '' }]));
    const element = { style: {}, querySelector: k => fields[k], classList: { add() {}, remove() {} } };
    let tick, later = [], introUp = true, clock = 0;
    const deps = { document: { getElementById: () => element }, persistSave() {},
      window: { __introUp: () => introUp }, performance: { now: () => clock },
      setInterval(fn) { tick = fn; return 1; }, clearInterval() { tick = null; },
      setTimeout(fn) { later.push(fn); return 1; } };
    const scene = { save: {}, _tilesReady: 0 };
    for (const m of ['updateObjectiveDOM', '_armStarterGuidance', '_playStarterIntro']) scene[m] = liftSceneMethod(m, deps);
    scene._armStarterGuidance();
    assert.eq(element.style.display, 'none', 'hidden while the intro is up');
    clock = 60000; tick();
    assert.eq(element.style.display, 'none', 'still hidden: intro overlay showing');
    introUp = false; tick(); clock += STARTER_INTRO.revealMs; tick();
    assert.eq(element.style.display, 'none', 'the delay waits for ground to speak over');
    scene._tilesReady = 1; tick(); clock += STARTER_INTRO.revealMs - 1; tick();
    assert.eq(element.style.display, 'none', 'waits the full reveal delay after the intro clears');
    clock += 1; tick();
    assert.eq(tick, null, 'poll stops once revealed');
    assert.eq(element.style.display, 'block');
    assert.eq(fields['.body'].textContent, STARTER_INTRO.lines[0]);
    for (let i = 1; i < STARTER_INTRO.lines.length; i++) {
      later.shift()();
      assert.eq(fields['.body'].textContent, STARTER_INTRO.lines[i]);
    }
    later.shift()();
    assert.eq(fields['.body'].textContent, STARTER_CHAIN[0].body, 'first instruction follows the hello');
    assert.eq(Quests.starterIntroLines(scene.save).length, 0, 'hello is heard once per save');
    assert.eq(Quests.starterIntroLines({ starter: { step: 2 } }).length, 0, 'no hello mid-ladder');
  });
})();
