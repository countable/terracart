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
})();
