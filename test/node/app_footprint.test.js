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
  const app = APP_JS_SRC;
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
})();
