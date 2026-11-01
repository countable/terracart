(function () {
  const lift = name => {
    const start = SCENE_SRC.indexOf('\n  ' + name + '(');
    return (0, eval)('({' + SCENE_SRC.slice(start + 1, SCENE_SRC.indexOf('\n  }\n', start) + 4) + '})')[name];
  };
  const methods = Object.fromEntries([
    '_consumeFoodEffects', '_firstTasteStories', '_enqueueCeremony', '_drainCeremonies',
  ].map(name => [name, lift(name)]));
  function scene(save = { energy: 10 }) {
    return { ...methods, save, panels: [], busy: false, held: false,
      getMaxEnergy() { return Energy.maxEnergy(this.save); },
      findNearestUnopenedChest: () => null,
      _dialogOpen() { return this.busy; }, _storyHeld() { return this.held; },
      showMessageModal(panel) { this.panels.push(panel); },
    };
  }
  test('first taste: every new food earns its own story, repeats earn none', () => {
    const s = scene();
    s._consumeFoodEffects('grilled_meat');
    s._consumeFoodEffects('grilled_meat');
    s._consumeFoodEffects('roast_onion');
    assert.eq(s.save.firstTastesPending.join(','), 'grilled_meat,roast_onion');
    s._firstTasteStories(); s._firstTasteStories();
    assert.eq(s.panels.length, 0, 'deferred until the story lane');
    s._drainCeremonies();
    assert.eq(s.panels.length, 1);
    assert.eq(s.panels[0].art, 'food_first_taste');
    assert.eq(s.panels[0].kind, 'story');
    assert.includes(s.panels[0].body, `+${Energy.tasteBonus('grilled_meat')} max`);
    assert.falsy(s.panels[0].itemId);
    s.panels[0].onDismiss();
    assert.eq(s.panels.length, 2);
    assert.eq(s.panels[1].art, s.panels[0].art, 'same unidentified dish for every food');
    s.panels[1].onDismiss();
    assert.eq(s.save.firstTastesPending.length, 0);
    s._consumeFoodEffects('roast_onion'); s._firstTasteStories(); s._drainCeremonies();
    assert.eq(s.panels.length, 2);
  });
  test('first taste: shrine gifts queue the story and pending stories survive holds and reload', () => {
    const s = scene();
    assert.truthy(Shrines.grant(s.save, 'wayfarer_post', Date.now(), s));
    const resumed = scene(JSON.parse(JSON.stringify(s.save)));
    resumed.busy = true; resumed._firstTasteStories(); resumed._drainCeremonies();
    assert.eq(resumed.panels.length, 0);
    resumed.busy = false; resumed.held = true; resumed._drainCeremonies();
    assert.eq(resumed.panels.length, 0);
    resumed.held = false; resumed._drainCeremonies();
    assert.eq(resumed.panels.length, 1);
    assert.eq(resumed.save.firstTastesPending[0], 'pairy', 'acknowledgement owns removal');
    resumed.panels[0].onDismiss();
    assert.eq(resumed.save.firstTastesPending.length, 0);
    assert.truthy(Shrines.grant(resumed.save, 'wayfarer_post', Date.now(), resumed));
    resumed._firstTasteStories(); resumed._drainCeremonies();
    assert.eq(resumed.panels.length, 1);
  });
  test('first taste: old meals are not replayed and failed presentation can retry', () => {
    const s = scene({ energy: 10, eaten: ['grilled_meat'] });
    s._consumeFoodEffects('grilled_meat'); s._firstTasteStories(); s._drainCeremonies();
    assert.eq(s.panels.length, 0);
    s._consumeFoodEffects('roast_onion');
    s.showMessageModal = () => { throw new Error('panel unavailable'); };
    s._firstTasteStories();
    let threw = false;
    try { s._drainCeremonies(); } catch (_) { threw = true; }
    assert.truthy(threw);
    assert.eq(s.save.firstTastesPending[0], 'roast_onion');
    s.showMessageModal = panel => s.panels.push(panel);
    s._firstTasteStories(); s._drainCeremonies();
    assert.eq(s.panels.length, 1);
  });
})();
