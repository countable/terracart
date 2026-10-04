(function () {
  const rock = (extra = {}) => ({ kind: 'mineralrock', id: 'quarry-work', x: 1, y: 1,
    yieldTier: 1, rockVariant: 0, zoneKind: 'quarry', ...extra });

  test('quarry rocks: every pick tier costs fifty percent more on average with whole-pip spending', () => {
    const random = Math.random;
    try {
      for (let tier = 0; tier <= 7; tier++) {
        const save = { relics: tier ? { pickaxe: { tier } } : {} };
        let ordinary = 0, quarry = 0;
        for (let i = 0; i < 6; i++) for (const half of [.25, .75]) {
          const base = (i + .5) / 6;
          Math.random = () => base;
          ordinary += INTERACTABLES.mineralrock.energy(save, rock({ zoneKind: undefined }));
          let draws = 0;
          Math.random = () => draws++ ? half : base;
          const cost = INTERACTABLES.mineralrock.energy(save, rock());
          assert.eq(cost, Math.floor(cost), 'integer energy');
          quarry += cost;
        }
        assert.inRange(quarry / 12, ordinary / 12 * 1.5 - 1e-9, ordinary / 12 * 1.5 + 1e-9, `pick tier ${tier}`);
      }
    } finally { Math.random = random; }
  });

  test('quarry rocks: other biomes, cave rocks, deposits, ore and walls retain their cost and random draws', () => {
    const random = Math.random;
    try {
      for (const o of [rock({ zoneKind: 'stones' }), rock({ zoneKind: undefined, caveVariant: 0 }),
        rock({ deposit: 'crystal' }), rock({ yieldTier: 4 }), rock({ kind: 'stronghold_wall' })]) {
        for (let tier = 0; tier <= 7; tier++) {
          const save = { relics: tier ? { pickaxe: { tier } } : {} };
          let draws = 0;
          Math.random = () => { draws++; return .2; };
          const expected = Math.max(effectivePickCost(save.relics), 9 * ((mineralDeposit(o)?.yieldTier || o.yieldTier || 1) - tier));
          const expectedDraws = draws;
          draws = 0;
          assert.eq(INTERACTABLES.mineralrock.energy(save, o), expected);
          assert.eq(draws, expectedDraws, 'no extra random draws outside quarry rubble');
        }
      }
    } finally { Math.random = random; }
  });

  test('quarry rocks: one stone from every pile, with the ordinary flint, bar, glint and sapphire bonuses', () => {
    const random = Math.random, key = WorldGen.tileKey(0, 0), old = WorldGen.tileCache.get(key);
    try {
      WorldGen.tileCache.set(key, { cellsPerEdge: 2, zone: {
        anchors: [{ kind: 'quarry', gx: 100, gy: 200 }],
        idx: new Uint8Array([1, 1, 0, 0]), s: new Uint8Array([255, 255, 0, 0]),
      } });
      let glintId;
      for (let n = 0; !glintId; n++) if (isGlintRock(rock({ id: `quarry-glint-${n}` }))) glintId = `quarry-glint-${n}`;
      for (let variant = 0; variant < SpriteLayout.PLAIN_ROCK_VARIANTS.length; variant++) {
        const save = { relics: {}, caught: [], opened: [] };
        const scene = makeScene({ save, cellAt: () => ({ tx: 0, ty: 0, ix: 0, iy: 0 }) });
        Math.random = () => 0; // coal, all six independent bars, then the guaranteed glint's coal
        INTERACTABLES.mineralrock.complete(makeCtx(scene, save), rock({ id: glintId, rockVariant: variant }));
        assert.eq(scene.invCount('rubble'), 1, `quarry pile ${variant}`);
        assert.eq(scene.invCount('flint_shard'), 2, 'ordinary flint plus glint find');
        for (let tier = 2; tier <= 7; tier++) assert.eq(scene.invCount(mineralBarId(tier)), 1, `bar tier ${tier}`);
        assert.eq(scene.invCount('sapphire'), 1, 'first quarry sapphire still awarded');
      }
      Math.random = () => .99;
      const scene = makeScene(), save = { relics: {} };
      INTERACTABLES.stronghold_wall.complete(makeCtx(scene, save), rock({ kind: 'stronghold_wall' }));
      assert.eq(scene.invCount('rubble'), SpriteLayout.PLAIN_ROCK_VARIANTS[0].stones, 'wall yield unchanged');
    } finally {
      Math.random = random;
      if (old) WorldGen.tileCache.set(key, old); else WorldGen.tileCache.delete(key);
    }
  });
})();
