// The Comet Ring (items.js UNIQUE_JEWELRY.comet_ring.cometAura, read by
// comet_ring.js CometRing): a ring of fire round the wearer's feet that grows
// with their own pace, snuffed for a spell by outrunning it. The burn lives in
// a scene method (scene_consumables.js _tickCometAura), lifted here onto a
// stub scene so the whole clock — pace, snuff, relight, the bite — runs.
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
      state = CometRing.step(state, { movedM: mps * dt, dt, snuffed }, S);
      if (state.snuff) { snuffs.push(+t.toFixed(3)); break; }
    }
    return { state, snuffs };
  }

  test('comet ring: a carried unique relic — icon, tier, price, drop and copy that quotes its numbers', () => {
    const item = ITEM_BY_ID.comet_ring;
    assert.truthy(item && item.kind === 'unique_relic' && item.uniqueJewelry, 'a carried unique relic');
    assert.eq(inventoryIconSource('comet_ring').sheet, 'icon_rings');
    assert.eq(inventoryIconSource('comet_ring').frame, 14);
    assert.eq(item.baseTier, 5);
    assert.gt(PRICES.comet_ring, PRICES.ember_ring, 'dearer than the Ember Ring it outshines');
    assert.truthy(Gear.uniqueRelics().some(i => i.id === 'comet_ring'), 'in the rare unique-relic lane');
    assert.eq(jewelryCometAura({}), null);
    assert.eq(jewelryCometAura(bag('ember_ring')), null);
    assert.eq(jewelryCometAura(bag('comet_ring')), S, 'the spec rides the carried ring');
    assert.eq(jewelryCometAura({ inv: [{ id: 'comet_ring', count: 0 }] }), null, 'an empty stack is absent');
    const copy = ITEM_EFFECTS.comet_ring;
    assert.truthy(/never touches you/.test(copy), 'copy says the wearer is immune to their own fire');
    assert.truthy(/faster/i.test(copy) && /snuffs/.test(copy), 'copy hints at pace and the snuff; the numbers stay on the chip');
    const drops = Combat.monster('fire_elemental').eliteDrops;
    assert.eq(drops[2].id, 'comet_ring', 'the Fire Elemental\'s 10% signature');
    assert.falsy(drops[2].qtyBonus, 'a unique relic is always one');
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

  test('comet ring: step smooths the pace, drops a teleport and starts afresh across a floor', () => {
    let { state } = run(null, 4, 2);
    assert.inRange(state.mps, 3.99, 4.01, 'two seconds of steady running reads as that pace');
    assert.truthy(state.lit); assert.falsy(state.snuff);
    assert.inRange(state.radiusCells, CometRing.shape(4, S).radiusCells - 0.01, CometRing.shape(4, S).radiusCells + 0.01);
    const one = CometRing.step(state, { movedM: 0, dt: 0.1 }, S);
    assert.gt(one.mps, 2, 'a stop eases the fire down over a stride, not a frame');
    assert.lt(one.mps, 4);
    const jump = CometRing.step(state, { movedM: 200, dt: 0.1 }, S);
    assert.inRange(jump.mps, 3.99, 4.01, 'a 2000 m/s jump is a placement: the sample is dropped');
    assert.eq(jump.overMs, 0);
    const floor = CometRing.step(state, { movedM: null, dt: 0.1 }, S);
    assert.eq(floor.mps, 0, 'a floor change starts the pace at zero');
    assert.truthy(floor.lit);
    const idle = CometRing.step(null, { movedM: 0, dt: 0 }, S);
    assert.eq(idle.mps, 0); assert.truthy(idle.lit);
    assert.eq(idle.radiusCells, S.minRadiusCells);
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
    assert.truthy(/Combat\.ignite\(c, nowT, 'player'\)/.test(body), 'alight as the player\'s own kill');
    assert.truthy(/this\._damageEnemy\(c, rate \* dt, 'player', \{ bypassArmor: true \}\)/.test(body), 'through the one damage lane');
    assert.truthy(/Buffs\.extend\(this\.save, this, 'cometSnuffed', spec\.snuffedMs\)/.test(body), 'the snuff is the Buffs row, through its one writer');
    assert.truthy(/CometRing\.step\(this\._cometAura/.test(body), 'the pure clock drives it');
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
    const far = { id: 'far', kind: 'slime', x: 40, y: 0, _hp: 20 };
    const fireSlime = { id: 'fire', kind: 'fire_slime', x: 3, y: 0, _hp: 20 };
    const pet = { id: 'pet', kind: 'slime', x: 2, y: 0, pet: true, _hp: 20 };
    creatures.push(slime, far, fireSlime, pet);
    const oldNow = Date.now; let now = T0; Date.now = () => now;
    try {
      const frame = (dx) => { now += 100; scene.playerM.x += dx; tick.call(scene); };
      tick.call(scene);                 // the first frame only samples
      assert.eq(hits.length, 0);
      frame(0);                         // at rest: an ember half a cell wide bites the near slime
      assert.eq(hits.length, 1, 'only the slime inside the ember, not the pet, the far one or the fire slime');
      assert.eq(hits[0].c, slime);
      assert.eq(hits[0].source, 'player'); assert.truthy(hits[0].options.bypassArmor);
      const rest = Combat.mitigate(S.maxDps * S.restIntensity, 0) * 0.1;
      assert.inRange(hits[0].amount, rest - 1e-6, rest + 1e-6, 'a one-second packet mitigated, × dt');
      assert.truthy(Combat.burning(slime, now), 'set alight');
      assert.falsy(Combat.burning(fireSlime, now), 'fire cannot touch a fire slime');
      assert.falsy(Combat.burning(pet, now), 'never a pet');
      // Run at 1.5× maxMps: the fire swells to the far slime, then the wind takes it.
      hits.length = 0;
      for (let i = 0; i < 20; i++) frame(S.maxMps * 1.5 * 0.1);
      assert.truthy(hits.some(h => h.c === far), 'the swollen aura reaches three cells');
      assert.truthy(scene._cometAura.lit);
      const ranFrom = now;
      let snuffAt = null;
      for (let i = 0; i < 40 && snuffAt == null; i++) { frame(S.maxMps * 1.5 * 0.1); if (!scene._cometAura.lit) snuffAt = now; }
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
