// The Comet Ring (items.js UNIQUE_JEWELRY.comet_ring.cometAura, read by
// comet_ring.js CometRing): a ring of fire round the wearer's feet that grows
// with their REAL pace (the GPS speed lane, never the body on the map),
// snuffed for a spell by outrunning it. The burn lives in a scene method
// (scene_consumables.js _tickCometAura), lifted here onto a stub scene so the
// whole clock — pace, snuff, relight, the bite — runs.
(function () {
  const S = UNIQUE_JEWELRY.comet_ring.cometAura;
  const bag = (...ids) => ({ inv: ids.map(id => ({ id, count: 1 })) });
  const T0 = 1700000000000;
  // Drive `step` at a steady `mps` for `seconds`, `dt` a frame; the state and
  // the frames on which the ring snuffed. The scene lends the Buffs row on a
  // snuff and tells the next steps so; here the run stops at the snuff and the
  // caller passes `snuffed` for the frames the row would cover.
  function run(state, mps, seconds, { dt = 0.1, snuffed = false } = {}) {
    const snuffs = [];
    for (let t = 0; t < seconds - 1e-9; t += dt) {
      state = CometRing.step(state, { mps, dt, snuffed }, S);
      if (state.snuff) { snuffs.push(+t.toFixed(3)); break; }
    }
    return { state, snuffs };
  }

  test('comet ring: a carried unique relic — icon, tier, price, drop and copy that quotes its numbers', () => {
    const item = ITEM_BY_ID.comet_ring;
    assert.truthy(item && item.kind === 'unique_relic' && item.uniqueJewelry, 'a carried unique relic');
    assert.eq(inventoryIconSource('comet_ring').sheet, 'icon_rings');
    assert.eq(inventoryIconSource('comet_ring').frame, 14);
    assert.eq(item.baseTier, 6);
    assert.eq(ITEM_BY_ID.meteor_ring.baseTier, 3, 'the Meteor Ring is the lesser rung');
    assert.gt(PRICES.comet_ring, PRICES.meteor_ring, 'and priced as such');
    assert.gt(PRICES.meteor_ring, 0);
    assert.eq(inventoryIconSource('meteor_ring').sheet, 'icon_rings');
    assert.eq(inventoryIconSource('meteor_ring').frame, 17);
    assert.truthy(Gear.uniqueRelics().some(i => i.id === 'comet_ring'), 'in the rare unique-relic lane');
    assert.eq(jewelryCometAura({}), null);
    assert.eq(jewelryCometAura(bag('ember_ring')), null);
    assert.eq(jewelryCometAura(bag('comet_ring')), S, 'the spec rides the carried ring');
    assert.eq(jewelryCometAura({ inv: [{ id: 'comet_ring', count: 0 }] }), null, 'an empty stack is absent');
    const copy = ITEM_EFFECTS.comet_ring;
    assert.truthy(/never touches you/.test(copy), 'copy says the wearer is immune to their own fire');
    assert.truthy(/faster/i.test(copy) && /snuffs/.test(copy), 'copy hints at pace and the snuff; the numbers stay on the chip');
    const drops = Combat.monster('fire_elemental').eliteDrops;
    assert.eq(drops[2].id, 'meteor_ring', 'the Fire Elemental\'s 10% signature');
    assert.falsy(drops[2].qtyBonus, 'a unique relic is always one');
    assert.eq(Combat.monster('fiend').eliteDrops[2].id, 'comet_ring', 'the Fiend\'s');
    for (const id of ['meteor_ring', 'comet_ring']) {
      assert.truthy(ITEM_BY_ID[id].uniqueJewelry && UNIQUE_JEWELRY[id].equippable, id + ': worn by choice');
      assert.truthy(ITEM_EFFECTS[id], id + ': effect copy');
    }
  });

  test('meteor ring: the same fire, a third of the burn; worn with the Comet, the Comet\'s burn is the one', () => {
    const M = UNIQUE_JEWELRY.meteor_ring.cometAura;
    for (const k of Object.keys(S)) if (k !== 'burnDurationMul') assert.eq(M[k], S[k], k + ': one shared fire (COMET_AURA)');
    assert.eq(S.burnDurationMul, 1);
    assert.inRange(M.burnDurationMul, 1 / 3 - 1e-9, 1 / 3 + 1e-9);
    assert.eq(jewelryCometAura(bag('meteor_ring')), M);
    assert.eq(jewelryCometAura(bag('meteor_ring', 'comet_ring')), S, 'the longer burn wins, nothing stacks');
    const both = bag('meteor_ring', 'comet_ring');
    Gear.wearJewelry(both, 'comet_ring', false);
    assert.eq(jewelryCometAura(both), M, 'the Comet taken off leaves the Meteor\'s fire');
    // Combat.ignite scales the burning row's duration for the lesser flame;
    // a body already alight keeps the clock it has.
    const def = Conditions.DEFINITIONS.burning;
    const a = { kind: 'skeleton' }, b = { kind: 'skeleton' };
    assert.truthy(Combat.ignite(a, 0, 'player', { durationMul: M.burnDurationMul }));
    assert.eq(a._burnState.remainingMs, Math.round(def.durationMs / 3), 'a third of the burn');
    assert.truthy(Combat.ignite(b, 0, 'player', { durationMul: S.burnDurationMul }));
    assert.eq(b._burnState.remainingMs, def.durationMs, 'the whole of it');
    assert.eq(Combat.ignite({ kind: 'skeleton' }, 0, 'player')._burnState, undefined);
    const plain = { kind: 'skeleton' }; Combat.ignite(plain, 0, 'player');
    assert.eq(plain._burnState.remainingMs, def.durationMs, 'no option: the row\'s duration, as the torch lights it');
    assert.truthy(Combat.ignite(a, 100, 'player', { durationMul: 1 }), 'already alight: a hit banks on top');
    assert.eq(a._burnState.remainingMs, Math.round(def.durationMs / 3) + def.durationMs);
    assert.truthy(/Combat\.ignite\(c, nowT, 'player', \{ durationMul: spec\.burnDurationMul \}\)/.test(SCENE_SRC), 'the tick lights for the worn ring\'s share');
    assert.truthy(/c\._cometLitT = nowT;/.test(SCENE_SRC) && /Conditions\.DEFINITIONS\.burning\.intervalMs/.test(SCENE_SRC),
      'one dose a burn interval while the foe stays inside, banked like any hit');
  });

  test('comet ring: shape — an ember at rest, a comet\'s tail at maxMps, never past it', () => {
    const rest = CometRing.shape(0, S);
    assert.eq(rest.radiusCells, S.minRadiusCells);
    assert.eq(rest.intensity, S.restIntensity);
    assert.inRange(rest.dps, S.maxDps * S.restIntensity - 1e-9, S.maxDps * S.restIntensity + 1e-9);
    assert.gt(rest.dps, 0, 'standing still still burns a little');
    const half = CometRing.shape(S.maxMps / 2, S);
    assert.inRange(half.radiusCells, (S.minRadiusCells + S.maxRadiusCells) / 2 - 1e-9, (S.minRadiusCells + S.maxRadiusCells) / 2 + 1e-9, 'linear in pace');
    assert.gt(half.intensity, rest.intensity); assert.gt(half.dps, rest.dps);
    const top = CometRing.shape(S.maxMps, S);
    assert.eq(top.radiusCells, S.maxRadiusCells);
    assert.eq(top.intensity, 1);
    assert.eq(top.dps, S.maxDps);
    assert.eq(CometRing.shape(S.maxMps * 3, S).radiusCells, S.maxRadiusCells, 'capped past maxMps');
    assert.eq(CometRing.shape(-2, S).radiusCells, S.minRadiusCells, 'no negative pace');
    assert.eq(CometRing.shape(NaN, S).intensity, S.restIntensity, 'no pace is rest');
  });

  test('comet ring: step smooths the pace and drops a GPS jump', () => {
    let { state } = run(null, 4, 2);
    assert.inRange(state.mps, 3.99, 4.01, 'two seconds of steady running reads as that pace');
    assert.truthy(state.lit); assert.falsy(state.snuff);
    assert.inRange(state.radiusCells, CometRing.shape(4, S).radiusCells - 0.01, CometRing.shape(4, S).radiusCells + 0.01);
    const one = CometRing.step(state, { mps: 0, dt: 0.1 }, S);
    assert.gt(one.mps, 2, 'a stop eases the fire down over a stride, not a frame');
    assert.lt(one.mps, 4);
    const jump = CometRing.step(state, { mps: 200, dt: 0.1 }, S);
    assert.inRange(jump.mps, 3.99, 4.01, 'a 200 m/s sample is a GPS jump: dropped');
    assert.eq(jump.overMs, 0);
    const none = CometRing.step(state, { mps: NaN, dt: 0.1 }, S);
    assert.inRange(none.mps, 3.99, 4.01, 'no reading keeps the last pace');
    const idle = CometRing.step(null, { mps: 0, dt: 0 }, S);
    assert.eq(idle.mps, 0); assert.truthy(idle.lit);
    assert.eq(idle.radiusCells, S.minRadiusCells);
  });

  test('comet ring: the pace is the GPS lane\'s last sample — fresh, never the stick, and standing without GPS', () => {
    assert.eq(CometRing.gpsPace(null, T0), 0, 'no gate (sandbox, stick override, teleport): standing');
    assert.eq(CometRing.gpsPace({ lastT: T0 }, T0), 0, 'a gate with no sample yet');
    assert.eq(CometRing.gpsPace({ mps: 3.2, mpsAt: T0, lastT: T0 }, T0 + 1000), 3.2, 'the sample, while fresh');
    assert.eq(CometRing.gpsPace({ mps: 3.2, mpsAt: T0, lastT: T0 }, T0 + CometRing.PACE_STALE_MS + 1), 0, 'stale: standing');
    assert.eq(CometRing.gpsPace({ mps: -1, lastT: T0 }, T0), 0, 'never negative');
    // util.js speedGateStep keeps the sample it judged: the device's own
    // speed when reported, else the leg from the last reliable fix.
    const fix = (i, speed) => ({ lat: 49.88 + (2 * i) / (6371000 * Math.PI / 180), lon: -119.49, accuracy: 8, timestamp: T0 + i * 1000, speed });
    let g = speedGateStep(null, fix(0), T0);
    assert.falsy(Number.isFinite(g.mps), 'the first fix has no leg');
    g = speedGateStep(g, fix(1), T0 + 1000);
    assert.inRange(g.mps, 1.99, 2.01, 'the leg: two metres a second'); assert.eq(g.mpsAt, T0 + 1000);
    g = speedGateStep(g, fix(2, 6.5), T0 + 2000);
    assert.eq(g.mps, 6.5, 'the device\'s own speed wins');
    g = speedGateStep(g, { ...fix(3), accuracy: 500 }, T0 + 3000);
    assert.eq(g.mps, 6.5, 'an unreliable fix leaves the sample as it was');
    assert.eq(CometRing.gpsPace(g, T0 + 3500), 6.5);
  });

  test('comet ring: past maxMps for overspeedMs it snuffs once, burns nothing while out, and relights after', () => {
    // Up to pace first (the smoothing lags the first frames), then the clock.
    let { state } = run(null, S.maxMps * 1.5, 2);
    assert.gt(state.mps, S.maxMps);
    assert.gt(state.overMs, 0, 'the over-speed clock runs once the pace reads past maxMps');
    assert.lt(state.overMs, S.overspeedMs, 'but has not filled within two seconds');
    assert.truthy(state.lit);
    const fast = run(state, S.maxMps * 1.5, 4);
    assert.eq(fast.snuffs.length, 1, 'one snuff');
    assert.falsy(fast.state.lit, 'the frame it snuffs on is already dark');
    // The scene lends the Buffs row now; while it runs the step is told so.
    const out = run(fast.state, S.maxMps * 1.5, 5, { snuffed: true });
    assert.eq(out.snuffs.length, 0, 'no second snuff while out');
    assert.falsy(out.state.lit);
    assert.eq(out.state.radiusCells, 0); assert.eq(out.state.dps, 0); assert.eq(out.state.intensity, 0);
    assert.eq(out.state.overMs, 0, 'the clock does not run while the fire is out');
    assert.gt(out.state.mps, S.maxMps, 'the pace is still read, so it relights at the right size');
    const back = CometRing.step(out.state, { movedM: 0.4, dt: 0.1 }, S);
    assert.truthy(back.lit, 'the row ended: lit again');
    assert.gt(back.radiusCells, S.minRadiusCells);
    // Slowing under maxMps resets the clock: a burst never banks toward a snuff.
    let { state: s2 } = run(null, S.maxMps * 1.5, 2.5);
    assert.gt(s2.overMs, 0);
    s2 = run(s2, 0, 2).state;
    assert.eq(s2.overMs, 0, 'under maxMps the clock clears');
    const again = run(s2, S.maxMps * 1.5, 4.5);
    assert.eq(again.snuffs.length, 1, 'a fresh three seconds is needed');
    assert.gt(again.snuffs[0], S.overspeedMs / 1000, 'and not a frame sooner');
  });

  test('comet ring: the scene tick burns enemies from the feet, as the player\'s fire, and writes the snuff through Buffs.extend', () => {
    const start = SCENE_SRC.indexOf('\n  _tickCometAura(');
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    assert.truthy(start > 0 && end > start, 'found _tickCometAura');
    const body = SCENE_SRC.slice(start, end);
    assert.truthy(/jewelryCometAura\(this\.save\)/.test(body), 'the carried ring gates it');
    assert.truthy(/playerWorldM\(this\)/.test(body), 'measured from the feet');
    assert.truthy(/Combat\.isEnemy\(c\)/.test(body) && /caughtSet\.has\(c\.id\)/.test(body) && /Combat\.canBurn\(c\)/.test(body),
      'enemies only, never a caught one, never one fire cannot touch');
    assert.truthy(/Combat\.ignite\(c, nowT, 'player', \{ durationMul: spec\.burnDurationMul \}\)/.test(body), 'alight as the player\'s own kill');
    assert.truthy(/this\._damageEnemy\(c, rate \* dt, 'player', \{ bypassArmor: true \}\)/.test(body), 'through the one damage lane');
    assert.truthy(/Buffs\.extend\(this\.save, this, 'cometSnuffed', spec\.snuffedMs\)/.test(body), 'the snuff is the Buffs row, through its one writer');
    assert.truthy(/CometRing\.step\(this\._cometAura/.test(body), 'the pure clock drives it');
    assert.truthy(/mps: CometRing\.gpsPace\(this\._speedGate, now\)/.test(body), 'the pace is the GPS lane, never the body');
    assert.falsy(/_cometSample|movedM/.test(body), 'nothing measures the feet on the map');
    assert.truthy(/this\._tickCometAura\(\);/.test(SCENE_SRC), 'the update loop runs it');

    // Lift it onto a stub scene and run the whole clock.
    const creatures = [];
    const hits = [];
    const deps = { WorldGen: { forEachItemNear: (kind, tx, ty, fn) => creatures.forEach(fn) } };
    const tick = new Function(...Object.keys(deps), 'return ({' + SCENE_SRC.slice(start, end + 4) + '})._tickCometAura')(...Object.values(deps));
    const scene = {
      save: { inv: [{ id: 'comet_ring', count: 1 }], caught: [], energy: 100 },
      startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 }, depth: 0, cellM: 10,
      playerToWorldCell: () => ({ tx: 0, ty: 0 }),
      flashes: 0, synced: 0,
      flashAtPlayer() { this.flashes++; }, _syncStatusRow() { this.synced++; },
      _damageEnemy(c, amount, source, options) { hits.push({ c, amount, source, options }); return false; },
    };
    const slime = { id: 'near', kind: 'slime', x: 5, y: 0, _hp: 20 };
    const far = { id: 'far', kind: 'slime', x: 25, y: 0, _hp: 20 };   // 2.5 cells: past the ember, inside the tail
    const fireSlime = { id: 'fire', kind: 'fire_slime', x: 3, y: 0, _hp: 20 };
    const pet = { id: 'pet', kind: 'slime', x: 2, y: 0, pet: true, _hp: 20 };
    creatures.push(slime, far, fireSlime, pet);
    const oldNow = Date.now; let now = T0; Date.now = () => now;
    try {
      // A frame: the phone reports `mps` (the gate's last sample, fresh).
      const frame = (mps) => { now += 100; scene._speedGate = { mps, mpsAt: now, lastT: now }; tick.call(scene); };
      tick.call(scene);                 // the first frame only starts the clock
      assert.eq(hits.length, 0);
      frame(0);                         // at rest: an ember half a cell wide bites the near slime
      assert.eq(hits.length, 1, 'only the slime inside the ember, not the pet, the far one or the fire slime');
      assert.eq(hits[0].c, slime);
      assert.eq(hits[0].source, 'player'); assert.truthy(hits[0].options.bypassArmor);
      const rest = Combat.mitigate(S.maxDps * S.restIntensity, 0) * 0.1;
      assert.inRange(hits[0].amount, rest - 1e-6, rest + 1e-6, 'a one-second packet mitigated, × dt');
      assert.truthy(Combat.burning(slime, now), 'set alight');
      assert.eq(slime._burnState.remainingMs, Conditions.DEFINITIONS.burning.durationMs, 'the Comet\'s whole dose');
      for (let i = 0; i < 25; i++) frame(0);   // 2.5 s inside: two more doses banked, one a burn interval
      const burnDef = Conditions.DEFINITIONS.burning;
      assert.eq(slime._burnState.remainingMs, burnDef.durationMs * 3, 'three doses banked, one a burn interval (the stub never runs the burn tick)');
      assert.falsy(Combat.burning(fireSlime, now), 'fire cannot touch a fire slime');
      assert.falsy(Combat.burning(pet, now), 'never a pet');
      // A stick walk away from the fix (the body moving, the phone still):
      // the ember does not stir.
      hits.length = 0;
      for (let i = 0; i < 20; i++) { scene.playerM.x -= 1.2; frame(0); }
      assert.eq(scene._cometAura.radiusCells, S.minRadiusCells, 'the body on the map is not the player running');
      assert.falsy(hits.some(h => h.c === far), 'the ember never reached the far slime');
      scene.playerM.x = 0;
      // No GPS at all (the sandbox, the stick taking over): an ember too.
      scene._speedGate = null; now += 100; tick.call(scene);
      assert.eq(scene._cometAura.radiusCells, S.minRadiusCells);
      // Run at 1.5× maxMps for real: the fire swells to the far slime, then the wind takes it.
      hits.length = 0;
      for (let i = 0; i < 20; i++) frame(S.maxMps * 1.5);
      assert.truthy(hits.some(h => h.c === far), 'the swollen aura reaches two and a half cells');
      assert.truthy(scene._cometAura.lit);
      const ranFrom = now;
      let snuffAt = null;
      for (let i = 0; i < 40 && snuffAt == null; i++) { frame(S.maxMps * 1.5); if (!scene._cometAura.lit) snuffAt = now; }
      assert.truthy(snuffAt, 'snuffed within four more seconds');
      assert.gt(snuffAt - ranFrom + 2000, S.overspeedMs, 'after at least the over-speed clock');
      assert.eq(Buffs.until('cometSnuffed', scene.save, scene), snuffAt + S.snuffedMs, 'the row runs from the snuff');
      assert.eq(scene.flashes, 1); assert.eq(scene.synced, 1);
      assert.truthy(Buffs.active(scene.save, scene, now).some(b => b.id === 'cometSnuffed'), 'its chip shows');
      hits.length = 0;
      for (let i = 0; i < 50; i++) frame(0);
      assert.eq(hits.length, 0, 'nothing burns while it is out');
      assert.eq(scene.flashes, 1, 'no second snuff while out');
      for (let i = 0; i < 60; i++) frame(0);
      assert.truthy(scene._cometAura.lit, 'relit once the row ended');
      assert.gt(hits.length, 0, 'and biting again');
      // Dropping the ring puts the fire out at once.
      scene.save.inv = [];
      frame(0);
      assert.eq(scene._cometAura, null);
    } finally { Date.now = oldNow; }
  });

  test('comet ring: worn by choice — Equip / Unequip through Gear.wearJewelry, found rings worn at once, the choice kept', () => {
    const save = bag('comet_ring', 'ember_ring');
    assert.truthy(UNIQUE_JEWELRY.comet_ring.equippable);
    assert.truthy(jewelryWorn(save, 'comet_ring'), 'a ring just found is worn');
    assert.eq(jewelryCometAura(save), S);
    assert.truthy(Gear.wearJewelry(save, 'comet_ring', false), 'taken off');
    assert.eq(save.wornJewelry.comet_ring, false);
    assert.falsy(jewelryWorn(save, 'comet_ring'));
    assert.eq(jewelryCometAura(save), null, 'off, no fire');
    const reloaded = SaveState.defaults(JSON.parse(JSON.stringify(save)));
    assert.falsy(jewelryWorn(reloaded, 'comet_ring'), 'a reload keeps it off');
    assert.truthy(Gear.wearJewelry(reloaded, 'comet_ring', true), 'put back on');
    assert.falsy('comet_ring' in reloaded.wornJewelry, 'worn is the absent default');
    assert.eq(jewelryCometAura(reloaded), S);
    assert.falsy(Gear.wearJewelry(save, 'ember_ring', false), 'the other jewelry has no Unequip');
    assert.eq(jewelryFireDamageMul(save), UNIQUE_JEWELRY.ember_ring.fireDamageMul, 'and works while carried');
    assert.truthy(jewelryWorn(save, 'ember_ring'));
    assert.falsy(Gear.wearJewelry({ inv: [] }, 'comet_ring', false), 'nothing to take off');
    assert.falsy(jewelryWorn({ inv: [], wornJewelry: {} }, 'comet_ring'));
    // The button under the bar and the "E" badge: source pins on the scene.
    const btn = SCENE_SRC.slice(SCENE_SRC.indexOf('syncEquipButton() {'), SCENE_SRC.indexOf('_makeEatButton() {'));
    assert.truthy(/UNIQUE_JEWELRY\[jewel\]\?\.equippable/.test(btn), 'a highlighted equippable piece shows the button');
    assert.truthy(/Gear\.wearJewelry\(this\.save, ring, !jewelryWorn\(this\.save, ring\)\)/.test(btn), 'the press toggles it through the one writer');
    assert.truthy(/jewelryWorn\(this\.save, item\.id\)\) slot\.appendChild\(this\._equippedBadge\('Equipped'\)\)/.test(SCENE_SRC), 'worn jewelry wears the E badge');
  });

  test('comet ring: the snuffed chip is a Buffs row with an icon; the fire is a light row and a baked disc', () => {
    const row = Buffs.KINDS.cometSnuffed;
    assert.truthy(row && row.scene === '_cometSnuffedUntil', 'an in-memory row like the torch');
    assert.truthy(Number.isInteger(StatusIcons.frames.cometSnuffed), 'an atlas icon');
    assert.truthy(Buffs.describe('cometSnuffed').includes(`${S.maxMps} m/s`), 'the chip quotes the spec');
    const light = Lighting.KINDS.comet_aura;
    assert.truthy(light && light.flicker > 0, 'a fire breathes');
    assert.eq(Lighting.radiusCells('comet_aura'), S.maxRadiusCells + 0.75, 'as wide as the aura can burn, plus its pad');
    assert.truthy(new RegExp(`\\[UNIQUE_JEWELRY\\.comet_ring\\.cometAura\\.texture, 0x[0-9a-f]{6}\\]`).test(SCENE_SRC), 'the disc is baked off the spec\'s texture');
    assert.truthy(/radiusCells: comet\.radiusCells/.test(RENDER_SRC), 'the drawn disc is exactly as wide as the aura burns');
  });
})();
