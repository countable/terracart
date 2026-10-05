(function () {
  function fixture(run) {
    const original = {
      each: WorldGen.forEachItem, near: WorldGen.forEachItemNear,
      reach: globalThis.cellInReach, cells: globalThis.worldMetersToAbsCell,
      persist: globalThis.persistSave, now: Date.now, getElement: document.getElementById,
      surface: EnemySpawns.surfaceActive,
    };
    let now = 100000;
    const pirates = ['pirate_grunt', 'pirate_gunner', 'pirate_captain'].map((kind, i) =>
      ({ kind, id: 'parley_' + i, x: i, y: 0, _attackWindupUntil: 999, _moving: true }));
    const s = {
      save: { money: 60, energy: 100, caught: [] }, offers: [], messages: [], persisted: 0,
      blocked: false, reached: true, node: null,
      _dialogOpen() { return this.blocked; },
      moneyHTML(n) { return `${n} coins`; },
      showOfferModal(offer) { this.offers.push(offer); this.node = { isConnected: true }; },
      showMessageModal(message) { this.messages.push(message); },
      playerToWorldCell() { return { tx: 9, ty: 12 }; },
      cancelWorkProgress() { this._workProgress = null; },
    };
    WorldGen.forEachItem = (kind, fn) => pirates.forEach(fn);
    WorldGen.forEachItemNear = (kind, tx, ty, fn) => {
      assert.eq(tx, 9); assert.eq(ty, 12); pirates.forEach(fn);
    };
    globalThis.worldMetersToAbsCell = (scene, x, y) => ({ cellIX: x + 100, cellIY: y + 100 });
    globalThis.cellInReach = (scene, x, y) => s.reached && x >= 100 && y >= 100;
    globalThis.persistSave = () => s.persisted++;
    EnemySpawns.surfaceActive = (scene, c) => !c._surfaceInactive;
    document.getElementById = () => s.node;
    Date.now = () => now;
    try { run(s, pirates, value => { now = value; }); }
    finally {
      WorldGen.forEachItem = original.each; WorldGen.forEachItemNear = original.near;
      globalThis.cellInReach = original.reach; globalThis.worldMetersToAbsCell = original.cells;
      globalThis.persistSave = original.persist; Date.now = original.now;
      EnemySpawns.surfaceActive = original.surface;
      if (original.getElement) document.getElementById = original.getElement;
      else delete document.getElementById;
    }
  }

  test('Pirates: payment costs 25 once and grants every pirate a saved 24-hour truce', () => fixture((s, pirates) => {
    s._workProgress = { combat: pirates[0] };
    assert.truthy(Pirates.present(s, pirates[0]));
    const offer = s.offers[0];
    assert.eq(offer.kind, 'trade'); assert.eq(offer.cost, '25 coins'); assert.truthy(offer.canAfford);
    assert.eq(s.save.money, 60, 'opening does not charge');
    assert.eq(s._workProgress, null, 'parley interrupts player attacks');
    for (const c of pirates) {
      assert.truthy(Combat.isPacified(c)); assert.falsy(Combat.isEnemy(c));
      assert.eq(c._attackWindupUntil, null); assert.falsy(c._moving);
    }
    offer.onAccept(); offer.onAccept(); offer.onCancel();
    assert.eq(s.save.money, 35); assert.eq(s.persisted, 1);
    assert.eq(s.save.piratePeaceUntil, 100000 + 86400000);
    assert.falsy(s._pirateParleyPending);
    pirates.forEach(c => assert.truthy(Combat.isPacified(c)));
    Pirates.present(s, pirates[1]);
    assert.eq(s.offers.length, 1); assert.eq(s.messages.length, 2);
    assert.includes(s.messages[0].body, shortDuration(Pirates.DURATION_MS));
  }));

  test('Pirates: cancellation releases all pirates and never pays', () => fixture((s, pirates) => {
    Pirates.present(s, pirates[0]);
    const newcomer = { kind: 'pirate_gunner', id: 'new', x: 0, y: 0 };
    Pirates.sync(s, newcomer);
    assert.truthy(Combat.isPacified(newcomer));
    pirates.push(newcomer);
    s.offers[0].onCancel(); s.offers[0].onAccept();
    assert.eq(s.save.money, 60); assert.eq(s.persisted, 0);
    pirates.forEach(c => assert.truthy(Combat.isEnemy(c)));
  }));

  test('Pirates: replaced transaction shells release their temporary truce', () => fixture((s, pirates) => {
    Pirates.present(s, pirates[0]);
    s.node.isConnected = false;
    Pirates.tick(s);
    assert.falsy(s._pirateParleyPending);
    pirates.forEach(c => assert.truthy(Combat.isEnemy(c)));
    assert.eq(s.offers.length, 1); assert.eq(s.save.money, 60);
  }));

  test('Pirates: stale or unaffordable offers cannot charge', () => {
    const invalidations = [
      s => { s.save.money = 24; }, s => { s.reached = false; },
      (s, c) => { c._hp = 0; }, (s, c) => { s.save.caught.push(c.id); },
      s => { s.save.energy = 0; }, s => { s._passingOut = true; },
      s => { s.save.piratePeaceUntil = Date.now() + 5000; },
    ];
    invalidations.forEach(invalidate => fixture((s, pirates) => {
      Pirates.present(s, pirates[0]); invalidate(s, pirates[0]);
      const money = s.save.money;
      s.offers[0].onAccept();
      assert.eq(s.save.money, money); assert.eq(s.persisted, 0);
      assert.falsy(s._pirateParleyPending);
    }));
    fixture((s, pirates) => {
      s.save.money = 24; Pirates.present(s, pirates[0]);
      assert.falsy(s.offers[0].canAfford);
      s.offers[0].onAccept(); assert.eq(s.save.money, 24);
    });
  });

  test('Pirates: restored truce covers new tiles and expires at exactly one day', () => fixture((s, pirates, time) => {
    Pirates.present(s, pirates[0]); s.offers[0].onAccept();
    const reloaded = { save: JSON.parse(JSON.stringify(s.save)) };
    const c = { kind: 'pirate_captain', id: 'new-session' };
    Pirates.sync(reloaded, c); assert.truthy(Combat.isPacified(c));
    time(reloaded.save.piratePeaceUntil - 1); assert.truthy(Combat.isPacified(c));
    time(reloaded.save.piratePeaceUntil); assert.falsy(Combat.isPacified(c)); assert.truthy(Combat.isEnemy(c));
    for (const invalid of [Infinity, NaN, '9999999999']) {
      reloaded.save.piratePeaceUntil = invalid; Pirates.sync(reloaded, c);
      assert.falsy(Combat.isPacified(c));
    }
    const deer = { kind: 'deer' }; Pirates.sync(s, deer);
    assert.falsy(deer._piratePeaceUntil);
  }));

  test('Pirates: automatic offers defer during dialogs and avoid repeat spam until reentry', () => fixture((s, pirates) => {
    s.blocked = true; Pirates.tick(s); assert.eq(s.offers.length, 0);
    s.blocked = false; s._passingOut = true; Pirates.tick(s); assert.eq(s.offers.length, 0);
    s._passingOut = false; s.save.energy = 0; Pirates.tick(s); assert.eq(s.offers.length, 0);
    s.save.energy = 100; Pirates.tick(s); assert.eq(s.offers.length, 1);
    s.offers[0].onCancel(); Pirates.tick(s); Pirates.tick(s); assert.eq(s.offers.length, 1);
    Pirates.present(s, pirates[1]); assert.eq(s.offers.length, 2, 'manual taps reopen');
    s.offers[1].onCancel(); s.reached = false; Pirates.tick(s);
    s.reached = true; Pirates.tick(s); assert.eq(s.offers.length, 3);
    s.offers[2].onAccept(); s.reached = false; Pirates.tick(s);
    s.reached = true; Pirates.tick(s); assert.eq(s.offers.length, 3, 'paid passage does not auto-interrupt');
  }));

  test('Pirates: inactive, concealed, caught and released pirates cannot trigger offers', () => {
    const hide = [c => { c._surfaceInactive = true; c._surfaceSpawn = true; },
      c => { c.hidden = true; }, c => { c._hp = 0; }, c => { c.id = 'released_pirate'; }];
    hide.forEach(change => fixture((s, pirates) => {
      pirates.forEach(change); Pirates.tick(s); assert.eq(s.offers.length, 0);
    }));
    fixture((s, pirates) => {
      s.save.caught = pirates.map(c => c.id); Pirates.tick(s); assert.eq(s.offers.length, 0);
    });
  });
  test('Pirates: creature taps open a transaction for all pirate kinds, including charmed pirates', () => {
    const handler = TAP_HANDLERS.find(h => h.name === 'creature');
    for (const kind of ['pirate_grunt', 'pirate_gunner', 'pirate_captain']) {
      for (const charmed of [false, true]) fixture((s, pirates) => {
        const target = { kind, id: `tap_${kind}`, x: 0, y: 0,
          _charmUntil: charmed ? Date.now() + 60000 : 0 };
        pirates.splice(0, pirates.length, target);
        Object.assign(s, { cellM: 7, cellPx: 32,
          flash() { throw new Error('Pirate taps must open a transaction, not flash a name'); },
          startCombat() { throw new Error('Pirate taps must not start combat'); } });
        s.save.inv = []; s.save.selSlot = -1;
        const span = SpriteLayout.creatureTapSpanPx(kind);
        const wm = { x: 0, y: (span.top + span.bottom) / 2 * s.cellM / s.cellPx };
        assert.eq(handler.try({ scene: s, save: s.save, wm, sx: 0, sy: 0 }), true, kind);
        assert.eq(s.offers.length, 1, `${kind}, charmed: ${charmed}`);
        assert.eq(s.offers[0].kind, 'trade');
        assert.eq(s.offers[0].cost, `${Pirates.PRICE} coins`);
        assert.eq(s.save.money, 60, 'tapping does not pay');
        s.offers[0].onCancel();
      });
    }
  });
  test('Pirates: hostile and hired pirates alternate their two cries with an eight-second cooldown', () => {
    for (const kind of ['pirate_grunt', 'pirate_gunner', 'pirate_captain', 'pirate_mercenary']) {
      fixture((s, pirates, time) => {
        const c = { kind, x: 12, y: 34 }, said = [];
        s.flashAtWorld = (line, x, y) => said.push({ line, x, y });
        assert.truthy(Pirates.say(s, c));
        assert.eq(said[0].line, 'Arr!'); assert.eq(said[0].x, 12); assert.eq(said[0].y, 34);
        assert.falsy(Pirates.say(s, c));
        time(107999); assert.falsy(Pirates.say(s, c)); assert.eq(said.length, 1);
        time(108000); assert.truthy(Pirates.say(s, c)); assert.eq(said[1].line, 'Shiver me timbers!');
        time(116000); assert.truthy(Pirates.say(s, c)); assert.eq(said[2].line, 'Arr!');
        assert.eq(Pirates.SPEECH_MS, 8000);
      });
    }
  });

  test('Pirates: other creatures stay silent and hired pirates cannot be bribed or rob the player', () => fixture((s) => {
    const said = []; s.flashAtWorld = line => said.push(line);
    for (const kind of ['mercenary', 'goblin', 'deer', 'npc']) {
      assert.falsy(Pirates.say(s, { kind, x: 0, y: 0 }));
    }
    assert.falsy(Pirates.say(s, null)); assert.eq(said.length, 0);
    const hired = { kind: 'pirate_mercenary', id: 'hired-pirate', x: 0, y: 0 };
    assert.falsy(Pirates.isPirate(hired)); assert.falsy(Pirates.present(s, hired));
    assert.eq(Pirates.onHit(s, hired), 0);
    assert.eq(s.offers.length, 0); assert.eq(s.save.money, 60);
    Pirates.sync(s, hired); assert.falsy(hired._piratePeaceUntil);
    assert.truthy(Pirates.say(s, hired)); assert.eq(said[0], 'Arr!');
  }));
})();
