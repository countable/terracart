// Exercise the real portal, depth-transition and status-row methods together.
(function () {
  function method(name, deps = {}) {
    const start = SCENE_SRC.indexOf(`\n  ${name}(`);
    assert.truthy(start >= 0, `${name} exists`);
    const end = SCENE_SRC.indexOf('\n  }', start) + 4;
    return new Function(...Object.keys(deps), `return ({${SCENE_SRC.slice(start, end)}}).${name};`)(...Object.values(deps));
  }
  function scene(over = {}) {
    const s = {
      save: { inv: [{ id: 'sapphire', count: 1 }], selSlot: 0, energy: 80, depth: 2 },
      depth: 2, startWorldM: { x: 101, y: 201 }, playerM: { x: 12, y: 20 }, feetOffsetM: 5,
      dugWallSet: new Set(), cellAt: () => ({ cellIX: 7, cellIY: 8 }),
      cameras: { main: { setBackgroundColor() {} } },
      ensureTilesAround: () => Promise.resolve(), syncMoveTarget() {},
      flash() {}, _storySplashOnce() {}, buildInventoryDOM() {}, _syncStatusRow() {},
      saved: [],
      ...over,
    };
    const deps = {
      getSelectedSlot: save => save.inv[save.selSlot],
      consumeSelected: save => { save.inv.splice(save.selSlot, 1); save.selSlot = -1; },
      persistSave: save => s.saved.push(JSON.parse(JSON.stringify(save))),
      CONSUMABLE_SPEC, cellKeyFromAbsCell: (x, y) => `${x}_${y}`,
      WorldGen: { setDepth() {} },
    };
    for (const name of ['useSapphirePortal', 'sapphireReturnPortal', 'returnThroughSapphire']) s[name] = method(name, deps);
    s.changeDepth = over.changeDepth || method('changeDepth', deps);
    return s;
  }

  test('sapphire: actual descent opens landing, spends last gem and persists a 60-second return', () => {
    const s = scene(), before = Date.now();
    assert.eq(s.useSapphirePortal(), true);
    assert.eq(s.depth, 3);
    assert.eq(s.save.inv.length, 0);
    assert.truthy(s.dugWallSet.has('3:7_8'), 'destination wall is opened');
    const p = s.save.sapphireReturn;
    assert.eq(p.fromDepth, 2); assert.eq(p.depth, 3);
    assert.eq(p.x, 113); assert.eq(p.y, 226, 'stores feet, not body coordinates');
    assert.truthy(p.until >= before + 60000 && p.until <= Date.now() + 60000);
    assert.eq(s.saved[s.saved.length - 1].sapphireReturn.until, p.until);
    assert.eq(s.saved[s.saved.length - 1].inv.length, 0, 'last write includes payment');
  });

  test('sapphire: exhausted or refused descent does not spend a gem or grant a return', () => {
    const tired = scene(); tired.save.energy = 0;
    assert.eq(tired.useSapphirePortal(), false);
    assert.eq(tired.save.inv.length, 1); assert.eq(tired.dugWallSet.size, 0);
    const failed = scene({ changeDepth() {} });
    assert.eq(failed.useSapphirePortal(), false);
    assert.eq(failed.save.inv.length, 1); assert.eq(failed.dugWallSet.size, 0);
    assert.falsy(failed.save.sapphireReturn);
    failed.dugWallSet.add('3:7_8');
    assert.eq(failed.useSapphirePortal(), false);
    assert.truthy(failed.dugWallSet.has('3:7_8'), 'failed move preserves an already-open landing');
  });

  test('sapphire: saved return works once without gems or energy and restores the original entry', () => {
    const original = scene(); original.useSapphirePortal();
    const s = scene({ save: JSON.parse(JSON.stringify(original.save)), depth: 3,
      startWorldM: { x: 300, y: -50 }, playerM: { x: 99, y: 99 } });
    s.save.energy = 0;
    assert.eq(s.returnThroughSapphire(), true);
    assert.eq(s.depth, 2); assert.eq(s.save.depth, 2);
    assert.eq(s.playerM.x + s.startWorldM.x, 113);
    assert.eq(s.playerM.y + s.startWorldM.y + s.feetOffsetM, 226);
    assert.falsy(s.save.sapphireReturn);
    assert.eq(s.returnThroughSapphire(), false, 'cannot reuse the return');
  });

  test('sapphire: expiration, another level and leaving the destination prevent reuse', () => {
    const s = scene(); s.useSapphirePortal();
    const p = s.save.sapphireReturn;
    assert.falsy(s.sapphireReturnPortal(p.until), 'expires at the deadline');
    p.until = Date.now() - 1;
    assert.eq(s.returnThroughSapphire(), false); assert.eq(s.depth, 3);
    p.until = Date.now() + 60000; s.depth = 4;
    assert.eq(s.returnThroughSapphire(), false); assert.eq(s.depth, 4);
    s.depth = 3;
    s.changeDepth(-1, { x: 999, y: 999 });
    assert.falsy(s.save.sapphireReturn, 'ordinary stairs close the portal');
    s.changeDepth(+1, { x: 999, y: 999 });
    assert.eq(s.returnThroughSapphire(), false, 're-entering the same depth cannot revive it');
  });

  test('sapphire: a refused return retains the unspent portal', () => {
    const s = scene(); s.useSapphirePortal();
    s.changeDepth = () => {};
    assert.eq(s.returnThroughSapphire(), false);
    assert.truthy(s.save.sapphireReturn);
  });

  test('sapphire: Return countdown is an actionable button after the last gem is spent', () => {
    const s = scene(); s.useSapphirePortal();
    function element(tag) {
      return { tag, style: {}, dataset: {}, children: [], textContent: '',
        addEventListener(name, fn) { this[name] = fn; },
        append(el) { this.children = this.children.filter(c => c !== el); this.children.push(el); el.parent = this; },
        remove() { this.parent.children = this.parent.children.filter(c => c !== this); },
        querySelector(selector) { const id = selector.match(/data-id="([^"]+)"/)[1]; return this.children.find(c => c.dataset.id === id); },
      };
    }
    const document = { getElementById: () => null, createElement: element,
      body: { classList: { contains: () => false } } };
    s.statusRowEl = element('div');
    s._syncStatusRow = method('_syncStatusRow', { document, window: {}, Buffs,
      Conditions: { DEFINITIONS: {} }, shortDuration: ms => `${Math.ceil(ms / 1000)}s` });
    s._syncStatusRow();
    const btn = s.statusRowEl.children.find(c => c.dataset.id === 'portal');
    assert.truthy(btn); assert.eq(btn.tag, 'button'); assert.eq(btn.type, 'button');
    assert.truthy(btn.textContent.startsWith('Return · '));
    btn.click({ stopPropagation() {} });
    assert.eq(s.depth, 2); assert.eq(s.statusRowEl.children.length, 0);
  });
})();
