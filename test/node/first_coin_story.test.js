(function () {
  const lift = sig => {
    const start = SCENE_SRC.indexOf('\n  ' + sig);
    return SCENE_SRC.slice(start + 1, SCENE_SRC.indexOf('\n  }\n', start) + 4);
  };
  const methods = (0, eval)('({' + [
    '_firstCoinStory() {',
    '_enqueueCeremony(kind, open, { key, hold, defer = false } = {}) {', '_drainCeremonies() {',
  ].map(lift).join(',') + '})');
  function scene(save = { money: 50 }) {
    return { ...methods, save, panels: [], busy: false, held: false,
      _dialogOpen() { return this.busy; }, _storyHeld() { return this.held; },
      updateHUD() { this.moneyVisible = !!this.save.storySeen?.['coin:first']; },
      showMessageModal(panel) { this.panels.push(panel); },
    };
  }
  test('first coin: starting balance and spending cannot introduce money; earning queues it', () => {
    const s = scene();
    s._firstCoinStory();
    assert.eq(s.panels.length, 0);
    addMoney(s.save, -1); s._firstCoinStory();
    assert.falsy(s.save.firstCoinPending);
    addMoney(s.save, 1); s._firstCoinStory();
    assert.truthy(s.save.firstCoinPending);
    assert.falsy(s.save.storySeen?.['coin:first'], 'queued is not seen');
    assert.eq(s.panels.length, 0, 'wait for the story lane');
    s._drainCeremonies();
    assert.eq(s.panels.length, 1);
    assert.eq(s.panels[0].portrait, 'assets/Icons/coin.png');
    assert.eq(s.panels[0].kind, 'story');
    assert.truthy(s.moneyVisible);
  });
  test('first coin: busy and held stories preserve hidden money, even after spending and reload', () => {
    const s = scene({ money: 0 });
    addMoney(s.save, 1); addMoney(s.save, -1);
    const resumed = scene(JSON.parse(JSON.stringify(s.save)));
    resumed.busy = true; resumed._firstCoinStory(); resumed._drainCeremonies();
    assert.eq(resumed.panels.length, 0);
    resumed.busy = false; resumed.held = true; resumed._drainCeremonies();
    assert.eq(resumed.panels.length, 0);
    assert.falsy(resumed.save.storySeen?.['coin:first']);
    resumed.held = false; resumed._drainCeremonies();
    assert.truthy(resumed.moneyVisible, 'shown at zero balance after the introduction');
    resumed.panels[0].onDismiss();
    const unlocked = scene(JSON.parse(JSON.stringify(resumed.save)));
    unlocked.updateHUD();
    assert.truthy(unlocked.moneyVisible);
    addMoney(unlocked.save, 2); unlocked._firstCoinStory(); unlocked._drainCeremonies();
    assert.falsy(unlocked.save.firstCoinPending);
    assert.eq(unlocked.panels.length, 0, 'never repeat the introduction');
  });
  test('first coin: failed presentation neither reveals money nor loses its introduction', () => {
    const s = scene(); addMoney(s.save, 1);
    s.showMessageModal = () => { throw new Error('panel unavailable'); };
    s._firstCoinStory();
    let threw = false;
    try { s._drainCeremonies(); } catch (_) { threw = true; }
    assert.truthy(threw);
    assert.truthy(s.save.firstCoinPending);
    assert.falsy(s.save.storySeen?.['coin:first']);
    s.showMessageModal = panel => s.panels.push(panel);
    s._firstCoinStory(); s._drainCeremonies();
    assert.eq(s.panels.length, 1);
    assert.truthy(s.moneyVisible);
  });
})();
