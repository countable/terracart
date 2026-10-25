(function () {
  test('tutorial guidance: planting leads to a distinct watering step before repairs', () => {
    const save = {};
    Quests.onStarterEvent(save, 'pickup');
    assert.eq(Quests.starterCurrent(save).event, 'plant');
    assert.eq(Quests.onStarterEvent(save, 'till'), null, 'preparing soil alone is not planting');
    Quests.onStarterEvent(save, 'plant');
    assert.eq(Quests.starterCurrent(save).event, 'water');
    assert.eq(Quests.onStarterEvent(save, 'restore'), null, 'repair cannot skip watering');
    Quests.onStarterEvent(save, 'water');
    assert.eq(Quests.starterCurrent(save).event, 'tilly', 'the early repair is remembered after watering');
  });
  test('tutorial guidance: existing planting progress remains actionable and completed tutorials stay complete', () => {
    const waiting = { starter: { step: 2, dismissed: false } };
    assert.eq(Quests.starterCurrent(waiting).event, 'plant');
    Quests.onStarterEvent(waiting, 'plant');
    assert.eq(Quests.starterCurrent(waiting).event, 'water');
    assert.truthy(Quests.starterAllDone({ starter: { step: 6 } }));
    assert.eq(Quests.starterCurrent({ starter: { step: 3 } }).event, 'restore');
    assert.eq(Quests.starterCurrent({ starter: { sequence: 'seed-water', step: 5 } }).event, 'tilly');
  });

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
    liftSceneMethod('acknowledgeObjective', deps).call(scene);
    assert.eq(element.style.display, 'none', 'Got it hides the current instruction');
    assert.falsy(Quests.starterHidden(scene.save), 'acknowledgement keeps the tutorial active');
    const done = Quests.onStarterEvent(scene.save, 'pickup');
    scene.updateObjectiveDOM();
    assert.eq(element.style.display, 'block', 'the next instruction appears');
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

test('tutorial progression: early completed actions survive reload without repeating work', () => {
  const save = {};
  Quests.onStarterEvent(save, 'restore');
  Quests.onStarterEvent(save, 'plant');
  const loaded = JSON.parse(JSON.stringify(save));
  assert.eq(Quests.starterCurrent(loaded).event, 'pickup');
  Quests.onStarterEvent(loaded, 'pickup');
  assert.eq(Quests.starterCurrent(loaded).event, 'water');
  Quests.onStarterEvent(loaded, 'water');
  assert.eq(Quests.starterCurrent(loaded).event, 'tilly');
  Quests.onStarterEvent(loaded, 'tilly');
  assert.eq(Quests.starterCurrent(loaded).event, 'roads');
  assert.falsy(Quests.starterAllDone(loaded));
  Quests.onStarterEvent(loaded, 'roads');
  assert.truthy(Quests.starterAllDone(loaded));
});

test('tutorial progression: hidden road sign-off and explicit skips cannot strand introductions', () => {
  const hidden = {};
  Quests.starterDismiss(hidden);
  for (const event of ['pickup', 'plant', 'water', 'restore', 'tilly']) Quests.onStarterEvent(hidden,event);
  assert.truthy(Quests.starterAllDone(hidden));
  const skipped = {};
  Quests.starterSkipAll(skipped);
  assert.truthy(Quests.starterIntroductionsReady(skipped));
  const guided = {};
  for (const step of STARTER_CHAIN) Quests.onStarterEvent(guided,step.event);
  assert.falsy(Quests.starterIntroductionsReady(guided), 'wait for chicken entrance on Easy');
  guided.starter.chickenArrived = true;
  assert.truthy(Quests.starterIntroductionsReady(guided));
});

test('tutorial pickup: a loose starter material completes gathering without opening a chest', () => {
  const scene = makeScene();
  const save = SaveState.defaults({});
  scene.save = save;
  scene.questEvent = event => Quests.onStarterEvent(save,event);
  runInteractable(makeCtx(scene,save), {kind:'groundstack',id:'starter-pickup',itemId:'wood',qty:1,x:0,y:0});
  assert.eq(scene.invCount('wood'),1);
  assert.eq(Quests.starterCurrent(save).event,'plant');
});

test('tutorial collection: opening an empty chest is not picking up an item', () => {
  const save = {};
  assert.eq(Quests.onStarterEvent(save,'chest'),null);
  assert.eq(Quests.starterCurrent(save).event,'pickup');
});
