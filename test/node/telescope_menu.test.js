(() => {
  function method(name) {
    const match = SCENE_SRC.match(new RegExp('^  ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?^  \\}', 'm'));
    return new Function('return ({' + match[0] + '})')()[name];
  }
  test('telescope menu: no match keeps the menu and previous marker; a match saves the chosen target', () => {
    const create = document.createElement;
    const node = () => ({ style: {}, children: [], events: {},
      appendChild(c) { this.children.push(c); }, setAttribute() {},
      addEventListener(event, fn) { this.events[event] = fn; },
      click() { this.events.click({ stopPropagation() {} }); },
    });
    document.createElement = node;
    try {
      const buttons = [], box = node(), wrap = { remove() { this.removed = true; } };
      let next = null, searched;
      const original = { targetId: 'old' };
      const scene = { save: { telescopeCompass: original },
        makeModalShell: () => ({ box, wrap, mount() {},
          mkBtn(label) { const button = node(); button.label = label; buttons.push(button); return button; } }),
        _telescopeSearch(category) { searched = category; return next; }, flash() {},
      };
      method('presentTelescopeMenu').call(scene, 0, 0, {});
      assert.eq(box.children[0].textContent, 'You see... everything! Look for: treasure, danger or solace?');
      assert.eq(buttons.map(b => b.label).join(), 'Treasure,Danger,Solace,Leave');
      buttons[0].click();
      assert.eq(searched, 'chest');
      assert.eq(scene.save.telescopeCompass, original);
      assert.falsy(wrap.removed);
      next = { targetId: 'elite', category: 'elite', until: Date.now() + Scenic.TELESCOPE_DURATION_MS };
      buttons[1].click();
      assert.eq(searched, 'elite');
      assert.eq(scene.save.telescopeCompass, next);
      assert.truthy(wrap.removed);
    } finally { document.createElement = create; }
  });

  test('telescope tracking: follows a live creature, holds unloaded position, and clears collected targets', () => {
    const cache = WorldGen.tileCache;
    const oldEntries = new Map(cache);
    cache.clear();
    try {
      const scene = { save: {} };
      const track = method('_telescopeTrackedTarget').bind(scene);
      const marker = { targetId: 'find', type: 'creature', x: 10, y: 20 };
      assert.eq(track(marker), marker, 'unloaded is not collected');
      const creature = { id: 'find', kind: 'chicken', x: 40, y: 50, _hp: 10 };
      cache.set('test', { creatures: [creature] });
      assert.eq(track(marker), creature);
      assert.eq(marker.x, 40);
      creature.x = 60;
      assert.eq(track(marker).x, 60);
      cache.clear();
      assert.eq(track(marker).x, 60, 'last known position survives cache eviction');
      scene.save.caught = ['find'];
      assert.eq(track(marker), null);
      scene.save.caught = [];
      cache.set('test', { creatures: [{ ...creature, _hp: 0 }] });
      assert.eq(track(marker), null, 'defeated target clears');
      cache.clear();
      scene.save.picked = ['flower'];
      assert.eq(track({ targetId: 'flower', type: 'wildplant' }), null);
    } finally { cache.clear(); for (const [k,v] of oldEntries) cache.set(k,v); }
  });
})();
