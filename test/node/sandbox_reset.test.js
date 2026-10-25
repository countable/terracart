(() => {
  const source = INDEX_HTML_SRC.split('// Sandbox local reset must run')[1].split('// End sandbox local reset.')[0];
  function reset(search) {
    const data = new Map([['terracart.saves', 'registry'], ['terracart.save.v4.one', 'save'],
      ['terracart.save.v4.two', 'other slot'], ['terracart.teleport', 'position'],
      ['terracart.howtoSeen', '1'], ['another-app', 'keep']]);
    const storage = { get length() { return data.size; }, key: i => [...data.keys()][i], removeItem: key => data.delete(key) };
    new Function('window', 'location', 'localStorage', '// Sandbox local reset must run' + source)({}, { search }, storage);
    return data;
  }
  test('sandbox reset: explicit flag clears every game slot and preference, preserving other apps', () => {
    const data = reset('?sandbox=true&sandboxZone=castle&reset=true');
    assert.eq(data.size, 1); assert.eq(data.get('another-app'), 'keep');
  });
  test('sandbox reset: normal play and links without an explicit reset preserve storage', () => {
    for (const query of ['?reset=true', '?sandbox=false&reset=true', '?sandbox=0&reset=true',
      '?sandbox=no&reset=true', '?sandbox=true', '?sandbox=true&reset=false', '?sandbox=true&reset=1']) {
      assert.eq(reset(query).size, 6, query);
    }
  });
  test('sandbox reset: supported sandbox aliases also reset', () => {
    for (const value of ['', '1', 'yes', 'TRUE']) assert.eq(reset(`?sandbox=${value}&reset=true`).size, 1);
  });
  test('sandbox skip story: explicit sandbox-only flag is independent of reset', () => {
    for (const [search, expected] of [['?sandbox=true&skipStory=true', true],
      ['?sandbox=true&reset=true&skipStory=true', true], ['?skipStory=true', false],
      ['?sandbox=false&skipStory=true', false], ['?fakeGps=1&skipStory=true', true], ['?sandbox=true&skipStory=false', false]]) {
      const window = {};
      new Function('window', 'location', 'localStorage', '// Sandbox local reset must run' + source)(window, { search }, { length: 0 });
      assert.eq(window.__sandboxSkipStory, expected, search);
    }
  });
  test('skip intro: works outside the sandbox and follows the sandbox story skip', () => {
    for (const [search, expected] of [['?skipIntro=true', true], ['?sandbox=true&skipIntro=true', true],
      ['?sandbox=true&skipStory=true', true], ['?skipIntro=false', false], ['?skipStory=true', false], ['', false]]) {
      const window = {};
      new Function('window', 'location', 'localStorage', '// Sandbox local reset must run' + source)(window, { search }, { length: 0 });
      assert.eq(window.__skipIntro, expected, search);
    }
  });
  test('sandbox skip tutorial: only the explicit sandbox flag enables it', () => {
    for (const [search, expected] of [['?sandbox=true&skipTutorial=true', true],
      ['?sandbox=true&reset=true&skipStory=true&skipTutorial=true', true],
      ['?skipTutorial=true', false], ['?sandbox=false&skipTutorial=true', false],
      ['?fakeGps=1&skipTutorial=true', true], ['?sandbox=true&skipTutorial=false', false], ['?sandbox=true', false]]) {
      const window = {};
      new Function('window', 'location', 'localStorage', '// Sandbox local reset must run' + source)(window, { search }, { length: 0 });
      assert.eq(window.__sandboxSkipTutorial, expected, search);
    }
  });
  test('sandbox skip tutorial: hides guidance and unlock notices without consuming progress', () => {
    const before = window.__sandboxSkipTutorial;
    const save = { starter: { step: 0, dismissed: false }, compassModules: {
      active: { inventory: true }, pending: ['inventory'], walkedM: 0 } };
    const snapshot = JSON.stringify(save);
    try {
      window.__sandboxSkipTutorial = true;
      assert.truthy(Quests.starterHidden(save));
      for (const id of Object.keys(CompassModules.MODULES)) assert.truthy(CompassModules.isActive(save, id));
      assert.falsy(CompassModules.isActive(save, 'unknown'));
      assert.falsy(CompassModules.drain({ save, showMessageModal() { throw new Error('unexpected notice'); } }));
      assert.eq(JSON.stringify(save), snapshot, 'the flag is a session override');
      assert.eq(liftSceneMethod('_pendingStoryCount').call({ save }), 0, 'hidden activation panes do not light the story badge');
      window.__sandboxSkipTutorial = false;
      assert.falsy(Quests.starterHidden(save));
      assert.falsy(CompassModules.isActive(save, 'joystick'));
      assert.eq(save.compassModules.pending.length, 1, 'notices remain available when testing onboarding');
    } finally { window.__sandboxSkipTutorial = before; }
  });
  test('sandbox skip story: holds queued dialogs without consuming them or showing the badge', () => {
    const previous = window.__sandboxSkipStory;
    const scene = { save: { memoryStory: { pending: ['memory'] } }, _ceremonies: [{waits: true}],
      _storyRun: true, _dialogOpen: () => false };
    const before = JSON.stringify(scene);
    try {
      window.__sandboxSkipStory = true;
      assert.truthy(liftSceneMethod('_storyHeld').call(scene));
      assert.eq(liftSceneMethod('_pendingStoryCount').call(scene), 0);
      assert.eq(JSON.stringify(scene), before);
      window.__sandboxSkipStory = false;
      assert.falsy(liftSceneMethod('_storyHeld').call(scene));
    } finally { window.__sandboxSkipStory = previous; }
  });
  test('sandbox reset: executes before boot and settings readers', () => {
    assert.lt(INDEX_HTML_SRC.indexOf('// Sandbox local reset must run'), INDEX_HTML_SRC.indexOf('// Boot recovery stays inline:'));
  });
})();
