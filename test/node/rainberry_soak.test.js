// THE RAINBERRY'S SOAK (owner, Sep 2026): eating one waters every crop in
// reach AS A GOLD (T4) CAN WOULD — the jump roll and the shortened hold are
// the can's, whoever eats it — and it RAINS over the plot while it does
// (particles.js 'rain', app.js _rainOver). The player's own better can is
// never undercut: the higher of the two tiers is the one that waters.
(() => {
const app = SCENE_SRC;
const lift = (sig) => {
  const a = app.indexOf(sig);
  assert.truthy(a > 0, `found ${sig}`);
  return app.slice(a, app.indexOf('\n  }\n', a));
};

test('rainberry: the spec names the can it counts as — Gold, T4', () => {
  assert.eq(CONSUMABLE_SPEC.rainberry.canTier, 4, 'a Gold can');
  assert.eq(TIER_BY_NUM[4].name, 'Gold');
  assert.eq(CONSUMABLE_SPEC.rainberry.radiusM, 20, 'over the same 20 m');
  assert.truthy(/^\s*const spec = CONSUMABLE_SPEC\.rainberry;$/m.test(app)
    && /this\.waterCropsWithin\(spec\.radiusM, spec\.canTier\);\s*\n\s*this\._rainOver\(spec\.radiusM\);/.test(app),
    'the eat branch soaks at the spec\'s tier, then rains');
});

test('rainberry: the soak waters with the better of the Gold can and the player\'s own', () => {
  const body = lift('  waterCropsWithin(radius, canTier = 0) {');
  assert.truthy(/const relics = \(canTier > \(own\.can\?\.tier \|\| 0\)\) \? \{ \.\.\.own, can: \{ \.\.\.\(own\.can \|\| \{\}\), tier: canTier \} \} : own;/.test(body),
    'the higher tier wins, the rest of the relics untouched');
  assert.truthy(/Crops\.waterWithin\(this\.save, pWX, pWY, radius, Date\.now\(\), relics,/.test(body),
    'and that is what Crops.waterWithin is handed');
  // The mechanism it rides: a can's tier is the jump chance (crops.js).
  assert.inRange(Crops.waterJumpChance({ can: { tier: 4 } }) - 4 / 7, -1e-9, 1e-9, 'Gold jumps 4 times in 7');
  const dry = () => ({ crop: 'potato', x: 0, y: 0, stage: 0, watered_t: 0 });
  const save = (p) => ({ planted: [p] });
  // rng 0.5: under 4/7 → a Gold soak jumps; bare hands (chance 0) never do.
  const gold = dry();
  assert.eq(Crops.waterWithin(save(gold), 0, 0, 5, 1000, { can: { tier: 4 } }, () => 0.5).jumped, 1, 'a Gold soak sprang the plant');
  assert.eq(gold.stage, 1);
  const bare = dry();
  assert.eq(Crops.waterWithin(save(bare), 0, 0, 5, 1000, null, () => 0.5).jumped, 0, 'bare hands did not');
  assert.eq(bare.stage, 0);
  assert.truthy(bare.watered_t > 0, 'but still watered it');
});

test('rainberry: it rains — a scatter of falling drops over the whole radius', () => {
  const p = Particles.PRESETS.rain;
  assert.truthy(p, 'the rain preset');
  assert.eq(p.tex.color, Particles.PRESETS.water.tex.color, 'the watering\'s own drop');
  // Phaser angles: 90 is straight DOWN. Rain falls.
  assert.inRange(p.angle[0], 80, 90, 'a narrow cone about straight down');
  assert.inRange(p.angle[1], 90, 100, 'a narrow cone about straight down');
  assert.gt(p.gravityY, 0, 'and it keeps falling');
  assert.lt(p.alpha[1], p.alpha[0], 'fading as it lands');
  const body = lift('  _rainOver(radiusM) {');
  assert.truthy(/const y = p\.y - RAIN_DROP_CELLS \* CELL_PX;/.test(body), 'each burst starts above its ground point');
  assert.truthy(/Particles\.onScreen\(this, p\.x, y, CELL_PX \* \(RAIN_DROP_CELLS \+ 1\)\)/.test(body), 'off-screen showers are free');
  assert.truthy(/Particles\.burst\(this, 'rain', p\.x, y\)/.test(body), 'the rain preset, per point');
  assert.truthy(/Math\.min\(RAIN_MAX_POINTS, Math\.round\(Math\.PI \* \(radiusM \/ cellM\) \*\* 2\)\)/.test(body),
    'one shower per cell of the disc, capped');
  // The drops from four cells up land near the ground point: fall at the
  // longest life and fastest launch, plus gravity, is about that height.
  const t = p.lifespan[1] / 1000;
  const fall = p.speed[1] * t + 0.5 * p.gravityY * t * t;
  const cell = (typeof CELL_PX === 'number') ? CELL_PX : 32;
  assert.inRange(fall, cell * 3, cell * 6, 'a drop from RAIN_DROP_CELLS up reaches the ground');
});
})();
