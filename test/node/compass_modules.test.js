(function () {
  const copy = value => JSON.parse(JSON.stringify(value));
  function sceneFor(save = {}) {
    CompassModules.initialize(save);
    return { save, panels: [], toasts: [], held: false,
      flashAtPlayer(text) { this.toasts.push(text); },
      _dialogOpen() { return this.held; }, _storyHeld() { return this.held; },
      showMessageModal(panel) { this.panels.push(panel); },
      showConfirmModal(panel) { this.panels.push(panel); } };
  }
  function dismiss(scene) { scene.panels.at(-1).onDismiss(); }

  test('compass circuits: new player starts closed; ownership wakes inventory, memories and unread books once', () => {
    const scene = sceneFor();
    for (const id of Object.keys(CompassModules.MODULES)) assert.falsy(CompassModules.isActive(scene.save, id));
    scene.save.inv = [{ id: 'book', count: 1 }];
    scene.save.memories = 1;
    assert.truthy(CompassModules.sync(scene));
    assert.truthy(CompassModules.isActive(scene.save, 'books'), 'obtaining a book, not reading it');
    assert.eq(scene.save.compassModules.pending.join(','), 'inventory,memories,books');
    scene.save.inv = []; scene.save.memories = 0;
    assert.falsy(CompassModules.sync(scene));
    for (const id of ['inventory', 'memories', 'books']) assert.truthy(CompassModules.isActive(scene.save, id));
    assert.eq(scene.save.compassModules.pending.length, 3, 'no repeated ceremonies');
  });

  test('compass circuits: existing equipment and spent historical memories/books seed without replaying ceremonies', () => {
    const save = { relics: { pickaxe: { tier: 0 } }, discovered: { leaf: 1 }, tipsRead: 2 };
    CompassModules.initialize(save);
    for (const id of ['inventory', 'memories', 'books']) assert.truthy(CompassModules.isActive(save, id));
    assert.falsy(CompassModules.isActive(save, 'joystick'));
    assert.falsy(CompassModules.isActive(save, 'distance'), 'restored road ledgers are not actual walking');
    assert.eq(save.compassModules.pending.length, 0);
    const armor = sceneFor(); armor.save.armor = { boots: { tier: 1 } };
    assert.truthy(CompassModules.sync(armor));
    assert.truthy(CompassModules.isActive(armor.save, 'inventory'));
  });

  test('compass circuits: distance wakes at exactly 200 cumulative accepted metres and survives reload', () => {
    const first = sceneFor();
    for (const value of [NaN, Infinity, -1, 0]) assert.falsy(CompassModules.recordWalk(first, value));
    CompassModules.recordWalk(first, 120.5);
    const resumed = sceneFor(copy(first.save));
    CompassModules.recordWalk(resumed, 79.4);
    assert.falsy(CompassModules.isActive(resumed.save, 'distance'));
    assert.truthy(CompassModules.recordWalk(resumed, 0.1));
    assert.eq(resumed.save.compassModules.walkedM, 200);
    assert.falsy(CompassModules.recordWalk(resumed, 100));
    assert.eq(resumed.save.compassModules.pending.join(','), 'distance');
  });

  test('compass circuits: closed taps explain power; spirit walking requires explicit enable', () => {
    const scene = sceneFor();
    assert.falsy(CompassModules.tap(scene, 'inventory'));
    assert.truthy(scene.panels[0].body.includes('You have no items.'));
    assert.truthy(scene.panels[0].body.includes('Find an item'));
    assert.eq(scene.panels[0].kind, 'spirit');
    assert.falsy(CompassModules.tap(scene, 'joystick'), 'cannot replace the open dialog');
    assert.eq(scene.panels.length, 1);
    dismiss(scene);
    CompassModules.tap(scene, 'joystick');
    assert.eq(scene.panels[1].acceptLabel, 'Enable spirit walking');
    scene.panels[1].onCancel();
    assert.falsy(CompassModules.isActive(scene.save, 'joystick'));
    CompassModules.tap(scene, 'joystick'); scene.panels[2].onAccept();
    assert.falsy(scene._storyRun, 'enabling does not release automatic story dialogs');
    assert.eq(scene.panels.length, 3, 'enable does not open an activation dialog');
    assert.falsy(CompassModules.tap(scene, 'joystick'));
    assert.truthy(scene.panels[3].body.startsWith('Spirit walking activated.'));
    dismiss(scene);
    assert.truthy(CompassModules.tap(scene, 'joystick'));
    assert.eq(scene.save.compassModules.pending.join(','), 'joystick');
  });

  test('compass circuits: dormant and activation dialogs point to their own HUD control', () => {
    const previous = document.getElementById;
    const controls = Object.fromEntries(['inv', 'move-pad', 'roadchip', 'memories', 'bookchip']
      .map(id => [id, { id }]));
    document.getElementById = id => controls[id];
    try {
      for (const [id, control] of Object.entries({ inventory: 'inv', joystick: 'move-pad',
        distance: 'roadchip', memories: 'memories', books: 'bookchip' })) {
        const scene = sceneFor();
        CompassModules.tap(scene, id);
        assert.eq(scene.panels[0].source, controls[control]);
        if (id === 'joystick') scene.panels[0].onCancel();
        else dismiss(scene);
        CompassModules.activate(scene, id);
        CompassModules.drain(scene);
        assert.eq(scene.panels.length, 1, 'unlock stays silent until tapped');
        assert.falsy(CompassModules.tap(scene, id));
        assert.eq(scene.panels[1].source, controls[control]);
        dismiss(scene);
      }
    } finally { document.getElementById = previous; }
  });

  test('compass circuits: unlock feedback is silent even while another dialog is open', () => {
    const scene = sceneFor();
    CompassModules.activate(scene, 'inventory'); CompassModules.activate(scene, 'books');
    scene.held = true;
    assert.truthy(CompassModules.drain(scene));
    assert.eq(scene.panels.length, 0);
    assert.eq(scene.toasts.length, 0);
    assert.falsy(scene._compassSpiritOpen);
    assert.eq(scene.save.compassModules.pending.length, 0);
    assert.eq(scene.save.compassModules.unread.join(','), 'inventory,books');
    assert.falsy(CompassModules.drain(scene), 'feedback cannot repeat');
    assert.falsy(CompassModules.tap(scene, 'inventory'), 'tap cannot replace another dialog');
    assert.eq(scene.save.compassModules.unread.length, 2, 'blocked tap preserves information');
  });

  test('compass circuits: all newly enabled parts receive visual feedback in one drain', () => {
    const scene = sceneFor(), awakened = [];
    const previous = window.CompassHUD;
    window.CompassHUD = { awaken(owner, id) { assert.eq(owner, scene); awakened.push(id); } };
    try {
      for (const id of Object.keys(CompassModules.MODULES)) CompassModules.activate(scene, id);
      assert.truthy(CompassModules.drain(scene));
      assert.eq(awakened.join(','), Object.keys(CompassModules.MODULES).join(','));
      assert.eq(scene.panels.length, 0);
      assert.falsy(CompassModules.drain(scene));
      assert.eq(awakened.length, Object.keys(CompassModules.MODULES).length);
    } finally {
      if (previous === undefined) delete window.CompassHUD;
      else window.CompassHUD = previous;
    }
  });

  test('compass circuits: activation information waits for a tap and is shown once across reloads', () => {
    const scene = sceneFor();
    CompassModules.activate(scene, 'inventory'); CompassModules.activate(scene, 'books');
    CompassModules.drain(scene);
    const resumed = sceneFor(copy(scene.save));
    assert.falsy(CompassModules.drain(resumed));
    assert.eq(resumed.panels.length, 0);
    assert.falsy(CompassModules.tap(resumed, 'inventory'));
    assert.eq(resumed.panels[0].kind, 'spirit');
    assert.eq(resumed.panels[0].okLabel, 'Got it');
    assert.truthy(resumed.panels[0].body.startsWith('Inventory activated.'));
    assert.truthy(resumed._compassSpiritOpen);
    assert.falsy(CompassModules.tap(resumed, 'books'), 'next tapped notice waits for dismissal');
    dismiss(resumed);
    const reloaded = sceneFor(copy(resumed.save));
    assert.truthy(CompassModules.tap(reloaded, 'inventory'), 'normal control action resumes after information is read');
    assert.eq(reloaded.panels.length, 0);
    assert.falsy(CompassModules.tap(reloaded, 'books'));
    assert.truthy(reloaded.panels[0].body.startsWith('Books activated.'));
    dismiss(reloaded);
    assert.truthy(CompassModules.tap(reloaded, 'books'));
    assert.eq(reloaded.save.compassModules.unread.length, 0);
  });

  test('compass circuits: legacy queued dialogs migrate to tap-only information', () => {
    const scene = sceneFor({ compassModules: {
      active: { books: true }, pending: ['books', 'books', 'unknown'], walkedM: 0,
    } });
    assert.truthy(CompassModules.drain(scene));
    assert.eq(scene.panels.length, 0);
    assert.eq(scene.save.compassModules.unread.join(','), 'books');
    assert.falsy(CompassModules.tap(scene, 'books'));
    assert.truthy(scene.panels[0].body.startsWith('Books activated.'));
  });

  test('compass circuits: a failed tapped dialog preserves information for retry and releases the hold', () => {
    const scene = sceneFor(); CompassModules.activate(scene, 'books');
    CompassModules.drain(scene);
    scene.showMessageModal = () => { throw new Error('unavailable'); };
    let threw = false;
    try { CompassModules.tap(scene, 'books'); } catch (_) { threw = true; }
    assert.truthy(threw);
    assert.falsy(scene._compassSpiritOpen);
    assert.eq(scene.save.compassModules.unread.join(','), 'books');
    scene.showMessageModal = panel => scene.panels.push(panel);
    assert.falsy(CompassModules.tap(scene, 'books'));
    assert.eq(scene.save.compassModules.unread.length, 0);
    assert.eq(scene.panels.length, 1);
  });
})();
