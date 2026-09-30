// Headless tests for the GLINT ROCK (interactables.js isGlintRock): one plain
// rock in twenty, the same rocks for every player, that catches the light
// for a moment every 10-60 s and is GUARANTEED one find on top of its stones,
// rolled off the plain rock's own rarity ladder (flint / bars / a crystal).
//
// Pinned here: the rate and its determinism; that only PLAIN rocks glint; the
// find table's weights are the shipping chances and nothing else; the drop
// pays exactly one find even when every chance roll loses; the glint's
// timing; and that render.js reads the same predicate the drop does.

const glintSurfaceRock = (id, extra) => ({ kind: 'mineralrock', id, x: 0, y: 0, yieldTier: 1, ...extra });
const glintIds = (n) => Array.from({ length: n }, (_, i) => `mineralrock_12_34_${i % 64}_${Math.floor(i / 64)}`);
const firstGlintRock = (glint) => glintSurfaceRock(glintIds(4000).find(id => isGlintRock(glintSurfaceRock(id)) === glint));

test('glint rock: one plain rock in twenty, off the rock id', () => {
  assert.eq(SHINY_RATE.rock, 1 / 20);
  const all = glintIds(20000);
  const n = all.filter(id => isGlintRock(glintSurfaceRock(id))).length;
  assert.inRange(n / all.length, 0.045, 0.055, `rate ${n / all.length}`);
  // The verdict is the id's alone: same id, same answer, in any frame.
  for (const id of all.slice(0, 500)) {
    assert.eq(isGlintRock(glintSurfaceRock(id)), isGlintRock({ kind: 'mineralrock', id, x: 99, y: -7, yieldTier: 1 }));
    assert.eq(isGlintRock(glintSurfaceRock(id)), isShiny(id, SHINY_RATE.rock));
  }
});

test('glint rock: only a PLAIN rock glints — ore and crystal never', () => {
  const g = firstGlintRock(true);
  assert.truthy(isGlintRock(g));
  assert.truthy(isGlintRock({ kind: 'mineralrock', id: g.id, caveVariant: 2 }), 'a cave rock is plain too');
  for (let t = 2; t <= 7; t++) assert.falsy(isGlintRock({ ...g, yieldTier: t }), `T${t} ore rock`);
  assert.falsy(isGlintRock({ ...g, deposit: 'crystal' }), 'a crystal deposit pays its gem, no glint');
  assert.falsy(isGlintRock(null));
});

test('glint rock: the find table IS the plain rock ladder, plus the crystal', () => {
  const byId = Object.fromEntries(GLINT_ROCK_FINDS.map(f => [f.id, f.weight]));
  assert.eq(byId.coal, PLAIN_ROCK_FLINT_P, 'flint at its base chance');
  for (let t = 2; t <= 7; t++) assert.eq(byId[mineralBarId(t)], plainRockBarChance(t), `T${t} bar at its bonus chance`);
  assert.eq(byId.sapphire, GEM_P_BY_TIER[4] * plainRockBarChance(4), 'the crystal at the gold rock gem odds against its bar');
  assert.eq(GLINT_ROCK_FINDS.length, 8, 'flint, six bars, one crystal — nothing else');
  for (const f of GLINT_ROCK_FINDS) {
    assert.truthy(ITEM_BY_ID[f.id], `${f.id} is a real item`);
    assert.eq(ITEM_BY_ID[f.id].kind, 'mineral');
    assert.gt(f.weight, 0);
  }
  // Rarity order holds: flint and copper lead, a crystal is a rare find.
  assert.gt(byId.coal, byId.sapphire); assert.gt(byId.copper_bar, byId.iron_bar);
  assert.gt(byId.iron_bar, byId.sapphire); assert.gt(byId.sapphire, byId.frost_bar);
  // The pick walks the table: rng 0 lands on flint, rng just under 1 on the last row.
  assert.eq(glintRockFind(() => 0), 'coal');
  assert.eq(glintRockFind(() => 1 - 1e-12), GLINT_ROCK_FINDS[GLINT_ROCK_FINDS.length - 1].id);
});

test('glint rock: pays exactly one find even when every chance roll loses', () => {
  const original = Math.random;
  const finds = new Set(GLINT_ROCK_FINDS.map(f => f.id));
  const bonusCount = (scene) => [...finds].reduce((n, id) => n + scene.invCount(id), 0);
  try {
    Math.random = () => 0.99;   // loses flint and every bar roll; the find still lands on a row
    const g = firstGlintRock(true), plain = firstGlintRock(false);
    for (let i = 0; i < 50; i++) {
      const scene = makeScene();
      const save = { relics: { pick: { tier: 7 } } };
      assert.eq(runInteractable(makeCtx(scene, save), g), true);
      assert.eq(scene.invCount('rockfruit'), SpriteLayout.plainRockStones(g), 'stones as drawn');
      assert.eq(bonusCount(scene), 1, 'one guaranteed find');
    }
    const scene = makeScene();
    runInteractable(makeCtx(scene, { relics: { pick: { tier: 7 } } }), plain);
    assert.eq(bonusCount(scene), 0, 'a plain rock with no glint pays only its stones on a losing roll');
    // A crystal find is a gem find: the jackpot fanfare fires with it.
    Math.random = () => 1 - 1e-12;   // chance rolls lose; the weighted pick lands on the last row
    assert.eq(GLINT_ROCK_FINDS[GLINT_ROCK_FINDS.length - 1].id, 'sapphire');
    let jackpots = 0;
    const s2 = makeScene(); s2.flashJackpot = () => { jackpots++; };
    runInteractable(makeCtx(s2, { relics: { pick: { tier: 7 } } }), g);
    assert.eq(s2.invCount('sapphire'), 1); assert.eq(jackpots, 1);
  } finally { Math.random = original; }
});

test('glint rock: glints once every 10-60 s, for GLINT_ROCK_SHOW_MS, on its own beat', () => {
  assert.eq(GLINT_ROCK_PERIOD_MS.min, 10000); assert.eq(GLINT_ROCK_PERIOD_MS.max, 60000);
  assert.inRange(GLINT_ROCK_SHOW_MS, 300, 1500, 'a moment, not a strobe and not a lamp');
  const periods = new Set();
  for (const id of glintIds(300)) {
    const period = glintRockPeriodMs(id);
    assert.inRange(period, GLINT_ROCK_PERIOD_MS.min, GLINT_ROCK_PERIOD_MS.max);
    periods.add(Math.round(period / 1000));
    // Over one period, sampled every 10 ms, the glint shows for its window and no more.
    let on = 0, rising = true, last = -1;
    for (let t = 0; t < period; t += 10) {
      const k = glintRockPhase(id, 1_700_000_000_000 + t);
      if (k >= 0) { on++; assert.inRange(k, 0, 1); if (last >= 0 && k < last) rising = false; }
      last = k;
    }
    assert.inRange(on * 10, GLINT_ROCK_SHOW_MS - 20, GLINT_ROCK_SHOW_MS + 20, `${id} shows ${on * 10} ms`);
    assert.truthy(rising, 'progress climbs 0→1 through the window');
  }
  assert.gt(periods.size, 30, 'rocks beat at different periods');
});

test('glint rock: the renderer reads the drop predicate, throws no light', () => {
  assert.includes(RENDER_SRC, 'isGlintRock(it.o)');
  assert.includes(RENDER_SRC, 'glintRockPhase(it.o.id');
  assert.includes(RENDER_SRC, 'if (it.glint == null) LIGHTS.offerShiny');
  // The existing boundary test in rock_yield.test.js counts Math.random calls
  // in order; its rock must stay a plain, non-glint one.
  assert.falsy(isGlintRock({ kind: 'mineralrock', id: 'bonus-boundary', yieldTier: 1 }));
});
