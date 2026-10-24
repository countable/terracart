(function () {
  const rock = (id, extra = {}) => ({ id, kind: 'mineralrock', yieldTier: 1, ...extra });
  test('surface boulders: stable sparse selection preserves mining identity and yields', () => {
    let selected = 0;
    for (let i = 0; i < 1024; i++) {
      const a = rock(`surface-${i}`), b = { ...a, x: 99, y: -17 };
      const stones = SpriteLayout.plainRockStones(a);
      const chosen = assignSurfaceBoulder(a);
      assert.eq(assignSurfaceBoulder(b), chosen);
      assert.eq(mineralRockArtFrame(a), mineralRockArtFrame(b));
      assert.eq(SpriteLayout.plainRockStones(a), stones);
      assert.eq(a.yieldTier, 1);
      assert.eq(Visibility.objectCover(a), chosen ? Visibility.PARTIAL : Visibility.CLEAR);
      if (chosen) {
        selected++;
        assert.truthy(ROCK_VARIANT_ART.plainFrames.includes(mineralRockArtFrame(a) - 1));
        assert.eq(mineralRockArtFrame(a) % 2, 1, 'large art uses the odd column of its pair');
        const frame = mineralRockArtFrame(a);
        assert.falsy(assignSurfaceBoulder(a));
        assert.eq(mineralRockArtFrame(a), frame, 'repeated dressing retains an assigned appearance');
      }
    }
    assert.inRange(selected, 90, 170, 'about one eighth of rocks become large');
  });

  test('surface boulders: ore, deposits, cave and authored wall/road records keep their art', () => {
    for (const extra of [{ yieldTier: 2 }, { yieldTier: 7 }, { requiredTier: 2 }, { depth: 1 }, { deposit: 'quartz' },
      { caveVariant: 0 }, { _cave: true }, { _street: true }, { zoneLayer: 'wall' },
      { sightBlocking: false }]) {
      for (let i = 0; i < 64; i++) {
        const o = rock(`excluded-${i}`, extra), before = JSON.stringify(o);
        assert.falsy(assignSurfaceBoulder(o, WorldGen.T.ROCK));
        assert.eq(JSON.stringify(o), before);
      }
    }
  });

  test('neutral rocks: material and size alone select art across every biome', () => {
    const cases = [{ kind: 'mineralrock' }, { kind: 'mineralrock', rockMaterial: 'flint' },
      ...['quartz','topaz','amethyst','sapphire','ruby','emerald','diamond'].map(deposit => ({kind:'mineralrock',deposit})),
      ...[2,3,4,5,6,7].map(yieldTier => ({kind:'mineralrock',yieldTier}))];
    const scene = { save: {}, textures: { exists: () => true,
      get: () => ({ get: () => ({ width: 24, height: 24 }) }) } };
    const { resolveAppearance } = Render.objectAppearance(scene, new Map());
    for (let pair = 0; pair < cases.length; pair++) for (const _biome of Object.values(WorldGen.T)) {
      for (const sightBlocking of [false, true]) {
        const o = { ...cases[pair], _biome, _zoneObjectFrame: 65, zoneVariant: 'black_ring', sightBlocking };
        assert.eq(mineralRockArtFrame(o), pair === 0 ? 58 : pair * 2 + Number(sightBlocking));
        const art = resolveAppearance(o);
        assert.eq(art.texKey, 'rock_variants');
        assert.eq(art.frameVal, mineralRockArtFrame(o));
        assert.eq(art.scl, mineralRockArtScale(o));
        assert.eq(Render.spriteTint(o, scene, art.texKey), pair === 0 ? 0xffffff : ZONE_ROCK_THEMES.black_ring.tint,
          'zone colors shared materials but never double-tints its signature');
        assert.truthy(art.foot, 'normal seating and shadows apply');
        assert.eq(Visibility.objectCover(o), sightBlocking ? Visibility.PARTIAL : Visibility.CLEAR);
      }
    }
  });
  test('plain rocks: three stable shapes share size pairs without changing mining yields', () => {
    const seen = new Set();
    for (let i = 0; i < 128; i++) {
      const o = rock(`shape-${i}`), frame = mineralRockArtFrame(o), before = JSON.stringify(o);
      seen.add(frame);
      assert.truthy(ROCK_VARIANT_ART.plainFrames.includes(frame));
      assert.eq(mineralRockArtFrame({ ...o, sightBlocking: true }), frame + 1);
      assert.eq(mineralRockArtFrame({ ...o, _biome: WorldGen.T.SAND, x: i * 99 }), frame);
      assert.eq(mineralRockArtFrame({ ...o, rockVariant: 3, caveVariant: 2 }), frame);
      const plant = { kind: 'wildplant', crop: 'rubble', id: o.id };
      assert.eq(wildplantSprite(plant).sheet, 'selected_rubble', 'ordinary wild rubble uses the selected art');
      assert.eq(wildplantFrame(plant), 0);
      assert.eq(wildplantFrame({ crop: 'rubble', wildId: o.id }), 0, 'render view preserves shape');
      assert.eq(JSON.stringify(o), before, 'appearance never mutates the mining record');
    }
    assert.eq(seen.size, ROCK_VARIANT_ART.plainFrames.length);
    for (let i = 0; i < 16; i++) {
      assert.eq(mineralRockArtFrame(rock(`ore-${i}`, { yieldTier: 2 })), 18);
      assert.eq(mineralRockArtFrame(rock(`flint-${i}`, { rockMaterial: 'flint' })), 2);
    }
  });
  test('zone plain rocks: eight named contexts resolve paired art without changing minerals or yields', () => {
    for (const [zoneVariant, frame] of Object.entries(ZONE_PLAIN_ROCK_FRAMES)) {
      for (const sightBlocking of [false, true]) {
        const o = rock('zone-plain', { zoneVariant, sightBlocking });
        const expected = frame + Number(sightBlocking), before = JSON.stringify(o);
        assert.eq(mineralRockArtKey(o), 'rock_variants');
        assert.eq(mineralRockArtFrame(o), 52 + (frame - 36) / 2);
        assert.eq(mineralRockArtKey({ ...o, rockStyle: 'plain' }), 'rock_variants');
        assert.eq(mineralRockArtFrame({ ...o, rockStyle: 'plain' }), expected);
        assert.eq(zonePlainRockFrame({ ...o, zoneVariant: undefined, _objectArt: 'zone_rock_' + zoneVariant }), expected);
        assert.eq(zonePlainRockFrame({ ...o, zoneVariant: undefined, _zoneObjectFrame: 64 + (frame - 36) / 2 }), expected);
        const plant = { kind: 'wildplant', crop: 'rubble', id: o.id, _plantArt: 'zone_rock_' + zoneVariant, sightBlocking };
        assert.eq(wildplantSprite(plant).sheet, 'rock_variants');
        assert.eq(wildplantFrame(plant), 52 + (frame - 36) / 2);
        assert.eq(JSON.stringify(o), before, 'appearance leaves mining identity untouched');
        for (const mineral of [{ yieldTier: 2 }, { deposit: 'ruby' }, { rockMaterial: 'flint' }]) {
          const bearing = { ...o, ...mineral };
          assert.eq(mineralRockArtKey(bearing), 'rock_variants');
          assert.eq(zonePlainRockFrame(bearing), null);
        }
      }
    }
    for (const _zoneObjectFrame of [0, 1, 63, 72]) {
      assert.eq(zonePlainRockFrame({ _zoneObjectFrame }), null, 'only actual legacy rock frames qualify');
      assert.eq(mineralRockArtKey({ _zoneObjectFrame }), 'rock_variants');
    }
    assert.eq(zonePlainRockFrame({ zoneVariant: 'constructor' }), null);
  });
  test('zone recolors: themed zones automatically reuse shared material art and preserve authored colors', () => {
    for (const [zoneVariant, theme] of Object.entries(ZONE_ROCK_THEMES)) {
      for (const extra of [{ rockStyle: 'shared' }, { deposit: 'ruby' }, { yieldTier: 2 }, { rockMaterial: 'flint' }]) {
        const o = rock('recolor', { zoneVariant, ...extra });
        assert.eq(mineralRockArtKey(o), 'rock_variants');
        assert.eq(mineralRockTint(o), theme.tint, 'shared material art inherits the zone palette');
        assert.eq(mineralRockTint({ ...o, rockTheme: false }), 0xffffff, 'explicit neutral override remains available');
        assert.eq(mineralRockTint({ ...o, rockTheme: true }), theme.tint);
        assert.eq(mineralRockArtFrame({ ...o, rockTheme: true }), mineralRockArtFrame(o));
        assert.eq(Render.spriteTint({ ...o, rockTheme: true }, {}), theme.tint);
      }
      assert.eq(mineralRockTint({ rockTheme: zoneVariant }), theme.tint);
      assert.eq(mineralRockTint({ zoneVariant, rockTheme: true }), 0xffffff, 'themed art is not tinted twice');
      assert.eq(mineralRockTint({ zoneVariant, rockStyle: 'plain', rockTheme: true }), theme.tint);
    }
    assert.eq(mineralRockTint({ rockTheme: 'constructor' }), 0xffffff);
    assert.eq(mineralRockTint({ rockTheme: 'unknown' }), 0xffffff);
    for (const zoneVariant of ['marine_meadow', 'formal_garden', 'unknown']) {
      const o = { kind: 'mineralrock', zoneVariant, _zoneObjectFrame: 65 };
      assert.eq(mineralRockArtKey(o), 'rock_variants', 'other zones use regular rocks despite legacy frame');
      assert.eq(mineralRockTint(o), 0xffffff, 'other zones retain neutral colors');
    }
  });
  test('quarry and reef signatures: themes need no legacy neutral pair and preserve mining and cover', () => {
    const zones = ['quarry-strip-mine', 'quarry-stronghold', 'quarry-crater', 'quarry-abandoned', 'mystic_reef'];
    for (const [index, zoneVariant] of zones.entries()) for (const sightBlocking of [false, true]) {
      const o = rock('signature', { zoneVariant, sightBlocking }), before = JSON.stringify(o);
      assert.eq(zonePlainRockFrame(o), null, 'new signatures do not duplicate neutral pairs');
      assert.eq(mineralRockArtFrame(o), 60 + index);
      assert.eq(mineralRockArtScale(o), ROCK_VARIANT_ART.themedScale);
      assert.eq(mineralRockTint(o), 0xffffff);
      assert.eq(Visibility.objectCover(o), sightBlocking ? Visibility.PARTIAL : Visibility.CLEAR);
      assert.eq(wildplantFrame({ ...o, kind: 'wildplant', crop: 'rubble' }), 60 + index);
      const shared = mineralRockArtFrame({ ...o, rockStyle: 'shared' });
      assert.eq(mineralRockArtFrame({ ...o, rockStyle: 'plain' }), shared, 'plain falls back to shared shapes');
      assert.eq(mineralRockArtFrame({ ...o, yieldTier: 2 }), 18 + Number(sightBlocking));
      assert.eq(mineralRockArtFrame({ ...o, deposit: 'ruby' }), 12 + Number(sightBlocking));
      assert.eq(JSON.stringify(o), before, 'appearance preserves the mining record');
    }
  });
  test('neutral rocks: lucky cave rubble never advertises an ore or gem deposit', () => {
    assert.eq(mineralRockMaterial({ caveVariant: 2, yieldTier: 7 }), 'plain');
    assert.eq(mineralRockArtFrame({ caveVariant: 2, yieldTier: 7 }), ROCK_VARIANT_ART.plainFrames[0]);
    assert.eq(mineralRockArtFrame({ caveVariant: 2, yieldTier: 7, deposit: 'ruby' }), 12);
    assert.eq(mineralRockArtFrame({ deposit: 'crystal' }), 10, 'legacy crystal is sapphire');
    assert.eq(mineralRockArtFrame({ rockArtFrame: 13, zoneVariant: 'unknown' }), ROCK_VARIANT_ART.plainFrames[0],
      'unrelated old frame overrides cannot turn plain stone into ruby');
  });
})();
