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
      assert.truthy(Shrines.LEVERS[K[id].lever], `${id}: a known lever`);
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
        assert.truthy(row.size === 'minor' || row.size === 'major', `${s}: a dressed street, not a scenic path`);
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

  test('shrines: a boon takes the later expiry, never a sum, and runs out', () => {
    const save = {};
    Shrines.grant(save, 'wayfarer_post', T0);
    assert.eq(save.speedPotionUntil, T0 + K.wayfarer_post.durationMs, 'the speed potion\'s own field');
    save.speedPotionUntil = T0 + 60 * 60 * 1000;
    Shrines.grant(save, 'wayfarer_post', T0);
    assert.eq(save.speedPotionUntil, T0 + 60 * 60 * 1000, 'a longer potion is not cut short');
    save.speedPotionUntil = T0 + 1000;
    Shrines.grant(save, 'wayfarer_post', T0);
    assert.eq(save.speedPotionUntil, T0 + K.wayfarer_post.durationMs, 'nor added to');
    Shrines.grant(save, 'wishing_well', T0);
    assert.truthy(Shrines.leverActive(save, 'fortune', T0 + 1));
    assert.falsy(Shrines.leverActive(save, 'fortune', T0 + K.wishing_well.durationMs));
    assert.eq(save.shrineBoon, 'wishing_well');
    assert.eq(Shrines.boonRemainingMs(save, null, T0), K.wishing_well.durationMs);
    Shrines.normalize(save, T0 + K.wishing_well.durationMs + 1);
    assert.eq(save.boonUntil.fortune, undefined, 'an expired boon is dropped');
    const scene = {};
    Shrines.grant(save, 'lantern_saint', T0, scene);
    assert.eq(scene._torchUntil, T0 + K.lantern_saint.durationMs, 'the Torch\'s own timer');
    assert.eq(Shrines.boonRemainingMs(save, scene, T0), 0, 'the Torch shows its own countdown');
    Shrines.grant(save, 'moss_cairn', T0, scene);
    assert.eq(scene._shadowUntil, T0 + K.moss_cairn.durationMs, 'Shadow Powder\'s own timer');
    assert.falsy(Shrines.grant(save, 'nope', T0));
  });

  test('shrines: the boon-only levers reach their one reader', () => {
    const now = Date.now();
    const save = { energy: 50, maxEnergy: 100 };
    Shrines.grant(save, 'rust_totem', now);
    assert.gt(Combat.trainingBonus(save, 'melee', now), Combat.trainingBonus({}, 'melee', now), 'the melee drill runs');
    const sick = { energy: 50 };
    Conditions.apply(sick, 'poison');
    assert.truthy(Conditions.active(sick, 'poison'));
    Shrines.grant(sick, 'toad_idol', now);
    assert.falsy(Conditions.active(sick, 'poison'), 'the toad cures what is there');
    assert.falsy(Conditions.apply(sick, 'poison'), 'and poison cannot take hold');
    assert.falsy(Conditions.active(sick, 'poison'));
    assert.truthy(/Shrines\.leverActive\(this\.save, 'thrift'\)/.test(SCENE_SRC), '_walkRelics reads thrift');
    assert.truthy(/Shrines\.leverActive\(this\.save, 'surefoot'\)/.test(SCENE_SRC), '_bodyHold reads surefoot');
    assert.truthy(/Shrines\.leverActive\(save, 'fortune'\)/.test(INTERACTABLES_SRC), 'the chest roll reads fortune');
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
    assert.truthy(/^The shrine rests\./.test(flashed), 'a second visit waits, with its wait shown');
    assert.eq(save.shieldPotionUntil, 0, 'no second boon today');
  });
})();
