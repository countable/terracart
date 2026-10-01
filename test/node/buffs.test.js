// The timed-effect table (src/buffs.js) and the countdown stack over the
// row under the HUD that reads it (app.js _syncStatusRow). A new timed
// effect is a row of Buffs.KINDS — the sweep below fails on a
// `save.<x>Until =` writer with no row — and the status row is the only
// place a countdown is shown.
(function () {
  const T0 = 1_700_000_000_000;
  const app = SCENE_SRC;

  test('buffs: every row names itself, inks itself and reads a real expiry', () => {
    for (const [id, k] of Object.entries(Buffs.KINDS)) {
      assert.truthy(typeof k.name === 'string' && k.name.length > 0 && k.name.length <= 8, `${id}: a short word`);
      assert.truthy(/^#[0-9a-f]{6}$/.test(k.color), `${id}: a fill colour`);
      assert.truthy(/^#[0-9a-f]{6}$/.test(k.stroke), `${id}: a stroke colour`);
      const where = ['save', 'scene', 'read'].filter(w => k[w]);
      assert.eq(where.length, 1, `${id}: exactly one expiry reader`);
    }
  });

  test('buffs: every potion, powder and daily push the player can carry is a row', () => {
    // Every writer of a save.<x>Until expiry in the scene and the tap driver
    // has a row reading that field — except the mercenary's day
    // (companions.js), a whole-day countdown nobody wants over the head.
    const writers = new Set();
    for (const src of [app, INTERACTABLES_SRC]) {
      for (const m of src.matchAll(/save\.(\w+Until)\s*=/g)) writers.add(m[1]);
    }
    assert.truthy(writers.size >= 7, `found the potion writers (${[...writers].join(', ')})`);
    const rows = new Set(Object.values(Buffs.KINDS).map(k => k.save).filter(Boolean));
    for (const f of writers) assert.truthy(rows.has(f), `${f}: a row of Buffs.KINDS reads it`);
    for (const f of ['_dragonUntil', '_shadowUntil', '_torchUntil']) {
      assert.truthy(Object.values(Buffs.KINDS).some(k => k.scene === f), `${f}: the in-memory powders have rows`);
    }
    assert.eq(Buffs.KINDS.compass.read({}, { pairyCompass: { until: T0 + 7 } }), T0 + 7, 'the Pairy compass reads its own timer');
  });

  test('buffs: every boon-only shrine lever is a row named by its boon word, in its light', () => {
    for (const id of Shrines.KIND_IDS) {
      const row = Shrines.SHRINE_KINDS[id], L = Shrines.LEVERS[row.lever];
      if (L.instant) { assert.falsy(Buffs.KINDS[row.lever], `${id}: instant — the compass row shows its effect`); continue; }
      if (L.save || L.scene) {
        // Shield, reach and light pull a potion's timer: the potion's row
        // (reading the same field) is their countdown, not one of their own.
        assert.truthy(Object.values(Buffs.KINDS).some(k => (L.save && k.save === L.save) || (L.scene && k.scene === L.scene)),
          `${id}: shows as the potion / torch row reading ${L.save || L.scene}`);
        continue;
      }
      const k = Buffs.KINDS[row.lever];
      assert.truthy(k, `${id}: a row for lever ${row.lever}`);
      assert.eq(k.name, row.boon, `${id}: the kind's boon word`);
      assert.eq(k.color, '#' + row.light.toString(16).padStart(6, '0'), `${id}: inked in the kind's light`);
      const save = {};
      Shrines.grant(save, id, T0);
      assert.eq(Buffs.until(row.lever, save, null), T0 + row.durationMs, `${id}: reads the boon`);
    }
  });

  test('buffs: active() lists the running effects in table order with the time left', () => {
    const save = { speedPotionUntil: T0 + 30_000, shieldPotionUntil: T0 - 1, coffeeUntil: T0 + 90_000, boonUntil: { fortune: T0 + 5 } };
    const scene = { _torchUntil: T0 + 10 };
    const rows = Buffs.active(save, scene, T0);
    assert.eq(rows.map(r => r.id).join(','), 'torch,speed,coffee,fortune', 'running rows, expired shield dropped, table order');
    assert.eq(rows[1].remainingMs, 30_000);
    assert.eq(rows[1].name, 'Speed');
    assert.eq(Buffs.active({}, {}, T0).length, 0, 'nothing running');
    assert.eq(Buffs.active(null, null, T0).length, 0, 'no save yet');
  });

  test('buffs: the status row under the HUD is one chip per condition, then per running row', () => {
    const m = app.match(/\n  _syncStatusRow\(\) \{\n([\s\S]*?)\n  \}\n/);
    assert.truthy(m, '_syncStatusRow');
    const body = m[1];
    assert.truthy(/Object\.entries\(Conditions\.DEFINITIONS\)/.test(body), 'the conditions first, off their table');
    assert.truthy(/for \(const b of Buffs\.active\(this\.save, this\)\)/.test(body), 'then every running timed effect, off the table');
    assert.truthy(body.indexOf('Conditions.DEFINITIONS') < body.indexOf('Buffs.active'), 'statuses above buffs');
    assert.truthy(/`\$\{b\.name\} · \$\{shortDuration\(b\.remainingMs\)\}`/.test(body), 'name · shortDuration');
    assert.truthy(/if \(this\._statusRowDOM !== order\)/.test(body), 'the DOM is only rebuilt when the set or order changes');
    assert.truthy(/if \(el && el\.textContent !== c\.text\) el\.textContent = c\.text;/.test(body), 'text writes guarded');
    assert.truthy(/this\._syncStatusRow\(\);/.test(app.match(/\n  _tickConditions\(\) \{\n([\s\S]*?)\n  \}\n/)[1]), 'driven every frame from the condition tick');
    assert.truthy(/#status-row \{\n  position: fixed;\n  top: calc\(8px \+ env\(safe-area-inset-top, 0px\) \+ var\(--hud-chip-h\) \+ 6px\);/.test(app),
      'seated one chip height under the HUD row');
    assert.truthy(/body\.modal-open #status-row \{ opacity: 0\.25; \}/.test(app), 'dimmed with the HUD chips under a dialog');
    assert.falsy(/TimerText|_tickBuffTimers|buffTimerTexts/.test(app), 'nothing is drawn over the player\'s head');
    assert.falsy(/boonRemainingMs|shrineBoon = /.test(app + Object.values(Shrines).join('')), 'the last-boon countdown is gone');
  });
})();
