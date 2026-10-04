// The app.js footprint refactor's consistency rules (Oct 2026):
//   1. ONE EXTEND RULE — every timed consumable (a CONSUMABLE_SPEC row with a
//      `buff`) is used by _useTimedBuff and written by Buffs.extend: a second
//      dose while one runs is banked on the first's end, never reset, never
//      refused. The eat lane's buffs and the Treasure Map take the same rule.
//   2. ONE REFUSAL ANCHOR — a note about the player's body (a refusal, a
//      spell's word) goes through flashAtPlayer, never the camera centre.
//   3. ONE CEREMONY QUEUE — deferred dialogs drain in priority order from
//      the modal-gate tick, with _dialogOpen the only busy test.
(function () {
  const T0 = 1_700_000_000_000;
  const app = SCENE_SRC;   // app.js plus its installSceneMixin mixins
  const kept = new Function(app.match(/\nfunction kept\(why, noun\) \{[^\n]*\n/)[0] + 'return kept;')();
  const tables = ['SUMMON_HOOK', 'TIMED_BUFF_HOOKS'].map((t) => {
    const m = app.match(new RegExp('\\nconst ' + t + ' = \\{[\\s\\S]*?\\n\\};'));
    assert.truthy(m, `${t} table in app.js`);
    return m[0];
  }).join('\n');
  const lift = (name) => {
    const start = SCENE_SRC.indexOf('\n  ' + name + '(');
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    assert.truthy(start >= 0 && end > start, `found ${name}`);
    return new Function(tables + '\nreturn ({' + SCENE_SRC.slice(start, end + 4) + '})[' + JSON.stringify(name) + ']')();
  };
  function clock(fn) {
    const old = Date.now; let now = T0; Date.now = () => now;
    try { fn((t) => { now = t; }); } finally { Date.now = old; }
  }
  function scene(id) {
    const s = {
      save: { energy: 100, inv: [{ id, count: 3 }], selSlot: 0 }, titles: [],
      showMessageModal({ title }) { this.titles.push(title); }, buildInventoryDOM() {},
      updateEnergyDOM() {}, _syncPlayerSkin() {}, _tickSpiritRaven() {}, cancelWorkProgress() {},
      isTorchActive() { return (this._torchUntil ?? 0) > Date.now(); },
    };
    for (const name of ['_useTimedBuff', '_selectedConsumable', '_spendScroll', '_consumeSelected', '_finishInventoryChange']) s[name] = lift(name);
    return s;
  }

  test('footprint: every timed consumable EXTENDS through Buffs.extend — a second dose is banked on the first', () => clock((setNow) => {
    let covered = 0;
    for (const [id, spec] of Object.entries(CONSUMABLE_SPEC)) {
      if (!spec.buff) continue;
      const row = Buffs.KINDS[spec.buff];
      assert.truthy(row, `${id}: its buff ${spec.buff} is a row of Buffs.KINDS`);
      assert.truthy(spec.durationMs > 0, `${id}: a length`);
      if (spec.summonKind) {
        // The summons reconcile a live ally around the extend (Companions.tick,
        // a scene with tiles); the field they extend is the companion's own.
        assert.eq(row.save, Companions.KINDS[spec.summonKind].field, `${id}: the buff row and the companion row read one field`);
        continue;
      }
      if (!(row.save || row.scene || row.boon)) continue;   // a read-only row (the pairy compass) extends by laterOf at its writer
      setNow(T0);
      const s = scene(id);
      assert.eq(s._useTimedBuff(id), true, `${id}: used`);
      assert.eq(Buffs.until(spec.buff, s.save, s), T0 + spec.durationMs, `${id}: runs its length`);
      setNow(T0 + 1000);
      assert.eq(s._useTimedBuff(id), true, `${id}: used again while running`);
      assert.eq(Buffs.until(spec.buff, s.save, s), T0 + 2 * spec.durationMs, `${id}: the second dose is banked on the first's end`);
      assert.eq(s.save.inv[0].count, 1, `${id}: two spent`);
      covered++;
    }
    assert.gt(covered, 12, `the potions, powders, torch, foods and the raven ran (${covered})`);
    // No writer of an expiry survives outside the one rule.
    assert.falsy(/save\.\w+Until\s*=[^=]/.test(app), 'no raw save.<x>Until writer in app.js');
    assert.falsy(/this\._(dragon|shadow|torch)Until\s*=[^=]/.test(app), 'no raw scene timer writer in app.js');
    assert.truthy(/until: Buffs\.laterOf\(this\.save\.treasureCompass\?\.until, CONSUMABLE_SPEC\.treasure_map\.durationMs\)/.test(app),
      'the Treasure Map\'s mark extends by the same rule');
    assert.truthy(/until: Buffs\.laterOf\(this\.pairyCompass\?\.until, CONSUMABLE_SPEC\.pairy\.durationMs, now\)/.test(app),
      'the Pairy\'s compass too');
    assert.falsy(/Drill again in/.test(app), 'the training drill no longer refuses while one runs (it extends)');
  }));

  test('footprint: one slot guard, one spend, one route from a row to its action', () => {
    assert.eq((app.match(/sel\.id !== '/g) || []).length, 1, 'the slot test is _selectedConsumable (the revive drink reads its own table of flasks)');
    assert.eq((app.match(/consumeSelected\(this\.save\);/g) || []).length, 5,
      '_consumeSelected owns the consume + persist + redraw triple; the stairs, the eat lane and the cauldron consume mid-method');
    const route = app.match(/\n  _useConsumable\(id\) \{\n([\s\S]*?)\n  \}\n/)[1];
    assert.truthy(/if \(row\.buff\) return this\._useTimedBuff\(id\);/.test(route) && /if \(row\.tome\) return this\._readTome\(id\);/.test(route)
      && /if \(CAST_ROWS\[id\]\) return this\._castOnFoes\(id\);/.test(route), 'a row is used by its column, never by a hand-named method');
    assert.truthy(/onAccept: \(\) => \{ this\._useConsumable\(id\); this\.syncConsumableButton\(\); \},/.test(app), 'the button goes through the route');
  });

  test('footprint: a note about the body anchors on the player, never the camera centre', () => {
    // 32 refusal / success notes used to flash at viewCenterX/Y and float off
    // the body under a peek drag; flashAtPlayer (scene.playerScreen) is the
    // one anchor. The road chip's help line is the HUD's, under the chip.
    const centred = (app.match(/this\.flash\([^\n]*this\.viewCenterX, this\.viewCenterY\b/g) || []);
    assert.eq(centred.length, 0, `no note at the camera centre: ${centred.join(' | ')}`);
    assert.gt((app.match(/this\.flashAtPlayer\(/g) || []).length, 15, 'the notes go through flashAtPlayer');
    assert.truthy(/else this\.flashAtPlayer\('Getting tired…', UI_DANGER_INK\);/.test(app), 'the tiring warning too, when no cell was tapped');
    // The refusal that keeps the item has one shape.
    assert.eq(kept('No foe in sight', 'scroll'), 'No foe in sight — scroll kept.');
    assert.falsy(/— \w+ kept\.'/.test(app.replace(/function kept\([^\n]*/, '')), 'no hand-typed "kept." line beside the formatter');
    assert.truthy(/this\.flashAtPlayer\(kept\(/.test(app), 'and it lands on the player');
  });

  test('footprint: one ceremony queue — priority order, one at a time, _dialogOpen the only busy test', () => {
    const q = ['_enqueueCeremony', '_drainCeremonies', '_dialogOpen'].map((n) => {
      const start = SCENE_SRC.indexOf('\n  ' + n + '('), end = SCENE_SRC.indexOf('\n  }\n', start);
      return SCENE_SRC.slice(start + 1, end + 4);
    }).join('\n');
    const K = new Function(`return class { ${q} }`)();
    const s = new K(), opened = [];
    let busy = true;
    s._dialogOpen = () => busy;
    const ceremony = (kind, label) => (done) => { opened.push(label); s._close = done; return true; };
    // Queued while a dialog is up: nothing opens, whatever the order of arrival.
    s._enqueueCeremony('story', ceremony('story', 'story'));
    s._enqueueCeremony('prize', ceremony('prize', 'prize A'));
    s._enqueueCeremony('cheer', ceremony('cheer', 'cheer'));
    s._enqueueCeremony('receipt', ceremony('receipt', 'receipt'));
    s._enqueueCeremony('prize', ceremony('prize', 'prize B'));
    s._enqueueCeremony('read', ceremony('read', 'read'));
    assert.eq(opened.length, 0, 'a busy screen holds every ceremony');
    s._enqueueCeremony('story', ceremony('story', 'keyed'), { key: 'k' });
    s._enqueueCeremony('story', () => { opened.push('never'); return true; }, { key: 'k' });   // the key queues once
    busy = false;
    assert.truthy(s._drainCeremonies(), 'the gate tick opens the first');
    assert.eq(opened.join(','), 'receipt', 'a receipt outranks everything (before the memories that follow the queue)');
    assert.falsy(s._drainCeremonies(), 'one at a time: nothing else opens while it is up');
    s._close();
    assert.eq(opened.join(','), 'receipt,read', 'then a Book read, ahead of the prizes');
    s._close(); s._close();
    assert.eq(opened.join(','), 'receipt,read,prize A,prize B', 'the prizes in the order they were won');
    s._close();
    assert.eq(opened.at(-1), 'cheer');
    s._close();
    assert.eq(opened.at(-1), 'story', 'the stories last');
    s._close();
    assert.eq(opened.at(-1), 'keyed', 'the key queued one of its two');
    s._close();
    assert.falsy(opened.includes('never'));
    assert.eq(s._ceremonies.length, 0, 'drained');
    // A declined ceremony (open returns false) is dropped and the next tried;
    // a held one waits while later ones pass.
    let hold = true;
    s._enqueueCeremony('prize', ceremony('prize', 'held'), { hold: () => hold });
    s._enqueueCeremony('story', () => false);
    s._enqueueCeremony('story', ceremony('story', 'after'));
    assert.eq(opened.at(-1), 'after', 'the decliner was skipped, the held prize waited');
    s._close(); hold = false; s._drainCeremonies();
    assert.eq(opened.at(-1), 'held', 'and opened once its hold lifted');
    // Every deferred dialog is an enqueue, and _dialogOpen the only busy test.
    for (const kind of ['receipt', 'read', 'intro', 'prize', 'cheer', 'story']) {
      assert.truthy(new RegExp(`_enqueueCeremony\\('${kind}'`).test(app), `${kind}: queued`);
    }
    assert.falsy(/_macroReceipts|_drainMacroTransactions|_trailPrizeQueue|_drainTrailPrizes/.test(app), 'no second queue');
    // (The modal shell's entrance animation asks the same class from module
    // code with no scene in hand; it is not a scene busy test.)
    assert.eq((app.replace(MODAL_SHELL_SRC, '').match(/classList\??\.contains\('modal-open'\)/g) || []).length, 1,
      '_dialogOpen is the one place the scene reads the class (its headless fallback)');
    assert.truthy(/this\._drainBadgeStories\(\);/.test(app) && /if \(this\._drainCeremonies\(\)\) return;\s*MemoryStory\.drain\(this\);/.test(app),
      'the modal-gate tick drains the queue before the memories');
  });
})();
