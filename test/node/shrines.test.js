// Shrine kinds (src/shrines.js): the table, the boon levers, the daily visit.
(function () {
  const K = Shrines.SHRINE_KINDS;
  const T0 = 1_700_000_000_000;

  test('shrines: ten kinds, one frame each on the sheet, lit and seated', () => {
    assert.eq(Shrines.KIND_IDS.length, 10);
    const frames = Shrines.KIND_IDS.map(id => K[id].frame);
    assert.eq(new Set(frames).size, frames.length, 'one frame per kind');
    assert.eq(JSON.stringify([...frames].sort((a, b) => a - b)), JSON.stringify(SpriteLayout.SHRINE_KIND_ART.frames),
      'the sheet lists exactly the table\'s frames');
    for (const id of Shrines.KIND_IDS) {
      const art = SpriteLayout.groveShrineArt({ id: 'x', kind: 'grove_shrine', shrineKind: id });
      assert.eq(art.key, SpriteLayout.SHRINE_KIND_ART.key, id);
      assert.eq(art.frame, K[id].frame, id);
      assert.truthy(SpriteLayout.ART_BOUNDS[`${art.key}:${art.frame}`], `${id}: ART_BOUNDS`);
      assert.eq(Lighting.sourceKind({}, { kind: 'grove_shrine', shrineKind: id }), 'shrine_' + id);
      assert.eq(Lighting.KINDS['shrine_' + id].colour, K[id].light, `${id}: light colour from the table`);
      assert.eq(Lighting.KINDS['shrine_' + id].radiusCells, Lighting.KINDS.shrine.radiusCells, 'the shrine row\'s reach');
      assert.truthy(K[id].lever in Shrines.LEVERS, `${id}: a known lever`);
      assert.gt(K[id].durationMs, 0);
    }
    assert.eq(Lighting.sourceKind({}, { kind: 'grove_shrine' }), 'shrine', 'a plain grove shrine keeps its light');
    assert.eq(SpriteLayout.groveShrineArt({ id: 'x', kind: 'grove_shrine', shrineKind: 'nope' }).key !== 'shrines', true);
  });

  test('shrines: kinds map real zone and street variants, each at most once', () => {
    const zones = new Set(ZoneVariants.rows.map(r => r.id));
    const seenZ = new Set(), seenS = new Set();
    for (const id of Shrines.KIND_IDS) {
      assert.gt(K[id].zones.length + K[id].streets.length, 0, `${id} stands somewhere`);
      for (const z of K[id].zones) {
        assert.truthy(zones.has(z), `${id}: zone variant ${z} exists`);
        assert.falsy(seenZ.has(z), `${z} has one kind`); seenZ.add(z);
        assert.eq(Shrines.kindForZoneVariant(z), id);
      }
      for (const s of K[id].streets) {
        const row = StreetVariants.VARIANT_BY_ID[s];
        assert.truthy(row, `${id}: street variant ${s} exists`);
        assert.truthy(['minor', 'major', 'path'].includes(row.size), `${s}: a street or scenic path row`);
        assert.falsy(seenS.has(s), `${s} has one kind`); seenS.add(s);
        assert.eq(Shrines.kindForStreet(s), id);
      }
    }
    assert.eq(Shrines.kindForZoneVariant('pirate_cove'), null, 'the wreck keeps its gift');
  });

  test('shrines: copy fits the map and hints without numbers', () => {
    for (const id of Shrines.KIND_IDS) {
      const line = Shrines.boonFlash(id);
      assert.lte([...line].length, MAP_MSG_MAX, `${id}: "${line}"`);
      assert.falsy(/\d/.test(line + K[id].body), `${id}: no numbers in the copy`);
    }
  });

  test('shrines: a boon extends what is running (Buffs.extend), never stacks in strength, and runs out', () => {
    const save = {};
    Shrines.grant(save, 'bone_watcher', T0);
    assert.eq(save.shieldPotionUntil, T0 + K.bone_watcher.durationMs);
    save.shieldPotionUntil = T0 + 60 * 60 * 1000;
    Shrines.grant(save, 'bone_watcher', T0);
    assert.eq(save.shieldPotionUntil, T0 + 60 * 60 * 1000 + K.bone_watcher.durationMs, 'banked on top of the longer potion (owner, Oct 2026)');
    save.shieldPotionUntil = T0 - 1000;
    Shrines.grant(save, 'bone_watcher', T0);
    assert.eq(save.shieldPotionUntil, T0 + K.bone_watcher.durationMs, 'a lapsed one runs from now');
    Shrines.grant(save, 'wishing_well', T0);
    assert.truthy(Shrines.leverActive(save, 'fortune', T0 + 1));
    assert.falsy(Shrines.leverActive(save, 'fortune', T0 + K.wishing_well.durationMs));
    assert.eq(save.shrineBoon, undefined, 'no "last boon" — every running boon shows (Buffs)');
    const luck = Buffs.active(save, null, T0).find(r => r.id === 'fortune');
    assert.eq(luck.remainingMs, K.wishing_well.durationMs, 'the well\'s boon counts down as its own row');
    assert.eq(luck.name, K.wishing_well.boon, 'named by the kind\'s boon word');
    Shrines.normalize(save, T0 + K.wishing_well.durationMs + 1);
    assert.eq(save.boonUntil.fortune, undefined, 'an expired boon is dropped');
    const scene = {};
    Shrines.grant(save, 'lantern_saint', T0, scene);
    assert.eq(scene._torchUntil, T0 + K.lantern_saint.durationMs, 'the Torch\'s own timer');
    const ids = Buffs.active(save, scene, T0).map(r => r.id);
    assert.truthy(ids.includes('torch') && !ids.includes('light'), 'the saint shows as the Torch\'s countdown, not a row of its own');
    Shrines.grant(save, 'moss_cairn', T0, scene);
    assert.eq(save.boonUntil.hidden, T0 + K.moss_cairn.durationMs, 'Moss persists independently');
    assert.eq(scene._shadowUntil, undefined, 'Shadow Powder stays independent');
    assert.eq(Buffs.active(save, scene, T0).map(r => r.id).join(','), 'torch,shield,hidden',
      'every running boon shows, in table order — the torch, the shield and Moss at once');
    assert.falsy(Shrines.grant(save, 'nope', T0));
    save.shrineBoon = 'wishing_well';
    Shrines.normalize(save, T0);
    assert.eq(save.shrineBoon, undefined, 'the retired last-boon key is dropped from old saves');
  });

  test('shrines: revised boons use their requested durations and levers', () => {
    const save = {};
    for (const [id, lever, minutes] of [
      ['wishing_well', 'fortune', 15], ['harvest_idol', 'work', 15],
      ['toad_idol', 'regen', 8], ['ember_altar', 'wand', 5], ['rust_totem', 'melee', 5],
    ]) {
      Shrines.grant(save, id, T0);
      assert.eq(save.boonUntil[lever], T0 + minutes * 60000, id);
      assert.eq(K[id].art, 'shrine_' + id);
    }
    const sick = {};
    Conditions.apply(sick, 'poison');
    Shrines.grant(sick, 'toad_idol', T0);
    assert.truthy(Conditions.active(sick, 'poison'), 'toad heals HP rather than curing poison');
    assert.eq(Shrines.WORK_SPEED_MUL, 3);
    assert.eq(Shrines.WAND_TIER, 6);
    assert.eq(Shrines.REGEN_PER_SECOND, 1);
  });

  test('shrines: wishing luck joins existing ring luck and expires', () => {
    const save = { relics: { ring: { tier: 3 } } };
    const base = upgradeLuck(save, T0);
    Shrines.grant(save, 'wishing_well', T0);
    assert.eq(upgradeLuck(save, T0), base + Shrines.FORTUNE_LUCK_BONUS);
    assert.eq(upgradeLuck(save, T0 + 15 * 60000), base);
  });

  test('shrines: wishing luck improves both item quality and the separate gear roll', () => {
    const save = {};
    Shrines.grant(save, 'wishing_well');
    const ctx = { maxTier: 4, chainMax: 4, chainSteps: 1 };
    const roll = (player) => {
      let i = 0;
      return rollRewardQuality(ctx, 'chestQuality', player, () => i++ === 0 ? 0.28 : 0.99);
    };
    assert.eq(roll({}).tier, 1);
    assert.eq(roll(save).tier, 2, 'same roll favors tier with the boon');
    const plain = rollGearUpgrade(() => 0, {}, 2, {});
    const lucky = rollGearUpgrade(() => 0, {}, 2, {}, null, Shrines.FORTUNE_LUCK_BONUS);
    assert.eq(lucky.tier, plain.tier + 1, 'gear has a luck chance too');
    const capped = rollGearUpgrade(() => 0, {}, 1, {}, null, Shrines.FORTUNE_LUCK_BONUS);
    assert.eq(capped.tier, 1, 'luck preserves the chest ceiling');
  });

  test('shrines: toad regeneration banks fractions, caps HP and stops at expiry', () => {
    const save = { energy: 10 }, state = {};
    Shrines.grant(save, 'toad_idol', T0);
    for (let i = 1; i <= 60; i++) Energy.tickShrineRegen(save, state, 1 / 60, T0 + i * 1000 / 60);
    assert.eq(save.energy, 11, 'one HP per second');
    Energy.tickShrineRegen(save, state, 600, T0 + 30000);
    assert.eq(save.energy, 11, 'background time is not accumulated');
    Energy.set(save, Energy.maxEnergy(save) - 1);
    for (let i = 0; i < 8; i++) Energy.tickShrineRegen(save, state, 0.25, T0 + 31000 + i * 250);
    assert.eq(save.energy, Energy.maxEnergy(save), 'bounded at cap');
    assert.eq(state._shrineRegenAcc, 0, 'no banked healing at full health');
    Energy.set(save, 10);
    Energy.tickShrineRegen(save, state, 0.25, T0 + 8 * 60000 + 1000);
    assert.eq(save.energy, 10, 'expired');
  });

  test('shrines: Wayfarer consumes Pairy effects without inventory or eat cooldown', () => {
    const a = SCENE_SRC.indexOf('  _consumeFoodEffects(');
    const b = SCENE_SRC.indexOf('\n  }', a) + 4;
    const method = new Function('Energy', 'FOOD_ENERGY', 'CONSUMABLE_SPEC', 'shortDuration',
      'FEATHER_REVIVE_ENERGY', 'Buffs', 'return ({' + SCENE_SRC.slice(a,b) + '})._consumeFoodEffects;')(
        Energy, FOOD_ENERGY, CONSUMABLE_SPEC, shortDuration, FEATHER_REVIVE_ENERGY, Buffs);
    const save = { energy: 5, eatReadyAt: T0 + 99999 };
    const scene = { save, _consumeFoodEffects: method, getMaxEnergy: () => Energy.maxEnergy(save),
      findNearestUnopenedChest: () => ({ id: 'chest1', x: 12, y: 34 }) };
    assert.truthy(Shrines.grant(save, 'wayfarer_post', T0, scene));
    assert.eq(save.energy, 5 + FOOD_ENERGY.pairy);
    assert.truthy(save.eaten.includes('pairy'), 'first taste is recorded');
    assert.eq(scene.pairyCompass.until, T0 + CONSUMABLE_SPEC.pairy.durationMs);
    assert.eq(save.eatReadyAt, T0 + 99999, 'cooldown unchanged and bypassed');
    assert.eq(save.speedPotionUntil, undefined, 'no speed potion');
    assert.eq(Buffs.active(save, scene, T0).map(r => r.id).join(','), 'compass', 'the compass shows as the one countdown');
    scene.findNearestUnopenedChest = () => null;
    assert.truthy(Shrines.grant(save, 'wayfarer_post', T0, scene), 'no nearby chest still grants food');
    assert.eq(save.eaten.length, 1, 'first taste only once');
  });

  test('shrines: a kind shrine lends its boon once a UTC day, in place of the gift', () => {
    const scene = makeScene(), save = { energy: 50, coinBurstClaimed: {} };
    let flashed = null, gifts = 0;
    scene.flash = (msg) => { flashed = msg; };
    scene.showChestRewardModal = () => { gifts++; };
    scene.flashLoot = () => { gifts++; };
    const o = { kind: 'grove_shrine', id: 'zsh_1_2_3_4', x: 0, y: 0, shrineKind: 'bone_watcher' };
    runInteractable(makeCtx(scene, save), o);
    assert.eq(flashed, Shrines.boonFlash('bone_watcher'));
    assert.gt(save.shieldPotionUntil, Date.now(), 'the shield lever runs');
    assert.eq(gifts, 0, 'no treasure roll');
    assert.eq(Object.values(scene._inv).reduce((a, b) => a + b, 0), 0, 'nothing in the bag');
    assert.truthy(Macros.usedToday(save, o.id), 'the day ledger holds it');
    save.shieldPotionUntil = 0;
    runInteractable(makeCtx(scene, save), o);
    assert.truthy(/^Already visited — \d+[smhd]$/.test(flashed), 'a second visit waits, with its wait shown (the one refusal shape)');
    assert.eq(save.shieldPotionUntil, 0, 'no second boon today');
  });
  test('shrines: one scenic-path shrine per tile beside its stretch, on a reward seat, stable', () => {
    const N = 64, ext = 4096, cell = WorldGen.CELL_M;
    const at = (ix, iy) => ({ x: (ix + 0.5) * ext / N, y: (iy + 0.5) * ext / N });
    const make = (stretches) => {
      const grid = new Uint8Array(N * N).fill(WorldGen.T.PARK);
      const spawnOpts = { roadMask: new Uint8Array(N * N), roadClass: new Uint8Array(N * N),
        spawnWhy: new Uint16Array(N * N), occupied: new Set() };
      const out = Scenic.dress({ scenic: { ext, vistas: [], stretches, shore: null, grassSeats: [] },
        tx: 0, ty: 0, N, tileEdgeM: N * cell, grid, chests: [], spawnOpts });
      return { out, grid };
    };
    const stretches = [
      { key: '1,1|shore', kind: 'shore', at: at(10, 10), m: 200 },
      { key: '2,1|greenway', kind: 'greenway', at: at(40, 10), m: 200 },
      { key: '1,2|park', kind: 'park', at: at(10, 40), m: 200 },
    ];
    const { out } = make(stretches);
    const shrines = out.objects.filter(o => o.kind === 'grove_shrine');
    assert.eq(shrines.length, Shrines.SCENIC_SHRINES_PER_TILE, 'capped per tile');
    const sh = shrines[0];
    assert.eq(sh.shrineKind, Shrines.kindForStreet(sh._shrineStreet));
    assert.truthy(Object.values(Scenic.KIND_ROW).includes(sh._shrineStreet), 'a scenic path row');
    assert.eq(out.objects.filter(o => o.kind === 'chest').length, 3, 'every stretch keeps its vista chest');
    assert.eq(JSON.stringify(shrines), JSON.stringify(make([...stretches].reverse()).out.objects.filter(o => o.kind === 'grove_shrine')),
      'the pick is the stretch key\'s hash, not list order');
    for (const kind of ['shore', 'greenway', 'park']) {
      const one = make([{ key: `3,3|${kind}`, kind, at: at(30, 30), m: 200 }]).out.objects.find(o => o.kind === 'grove_shrine');
      assert.eq(one.shrineKind, Shrines.kindForStreet(Scenic.KIND_ROW[kind]), kind);
    }
  });
})();
