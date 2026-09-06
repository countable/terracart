// Giant monsters — app.js MONSTERS derives a `giant_<kind>` for every base
// kind (4× HP, two levels deeper), and sprite_layout.js draws it on the base
// kind's art at GIANT_ART_SCALE with the wheel / bar / tap box following.

(() => {
  const baseKinds = Object.keys(MONSTERS).filter((k) => !MONSTERS[k].giant);
  const giantKinds = Object.keys(MONSTERS).filter((k) => MONSTERS[k].giant);

  test('giants: every base kind has one, at 4× HP and two levels deeper', () => {
    assert.eq(GIANT_HP_MUL, 4, 'four times the health, per the rule');
    assert.eq(GIANT_DEPTH_STEP, 2, 'plus two to the dungeon level');
    assert.gt(baseKinds.length, 0, 'there are base kinds');
    assert.eq(giantKinds.length, baseKinds.length, 'one giant per base kind');
    for (const kind of baseKinds) {
      const base = MONSTERS[kind], g = MONSTERS['giant_' + kind];
      assert.truthy(g, kind + ' has a giant');
      assert.eq(g.giant, kind, 'the giant names its base kind');
      assert.eq(g.hp, base.hp * GIANT_HP_MUL, kind + ' giant HP is 4× (after the cave doubling, both)');
      assert.eq(g.minDepth, base.minDepth + GIANT_DEPTH_STEP, kind + ' giant is two levels deeper');
      assert.eq(g.name, 'Giant ' + base.name, kind + ' giant is named');
      // Damage, reach and cadence are the base kind's — a bigger body, not a
      // new foe.
      for (const k of ['dmg', 'range', 'speed', 'fly']) assert.eq(g[k], base[k], kind + ' giant ' + k + ' is the base kind\'s');
      assert.lte(g.weight, base.weight, kind + ' giant is no commoner than its base');
      assert.gte(g.weight, 1, kind + ' giant can actually spawn');
      assert.eq(SpriteLayout.isGiantKind('giant_' + kind), true);
      assert.eq(SpriteLayout.baseKind('giant_' + kind), kind);
      assert.eq(SpriteLayout.isGiantKind(kind), false);
      assert.eq(SpriteLayout.baseKind(kind), kind);
      // combat.js reads the table, so the pool and the bounty follow.
      assert.eq(Combat.creatureMaxHp('giant_' + kind), g.hp, kind + ' giant pool from the table');
      assert.eq(Combat.maxHp({ kind: 'giant_' + kind, shiny: true }), g.hp * Combat.ELITE_MUL, 'an elite giant doubles again');
      assert.gt(enemyBounty('giant_' + kind, 0), enemyBounty(kind, 0), kind + ' giant pays more');
      // The deeper introduction buys the elite roll its +2 tier.
      assert.eq(eliteRollBonus('giant_' + kind, 1), eliteRollBonus(kind, 1) + GIANT_DEPTH_STEP, kind + ' giant elite rolls two tiers higher');
    }
  });

  test('giants: drawn on the base art at 1.8×, and everything seated on the body follows', () => {
    assert.eq(SpriteLayout.GIANT_ART_SCALE, 1.8, '1.8× art, per the rule');
    for (const kind of baseKinds) {
      const g = 'giant_' + kind;
      const base = SpriteLayout.CREATURE_ART[kind];
      assert.truthy(base, kind + ' has art');
      assert.falsy(SpriteLayout.CREATURE_ART[g], 'no giant row in the art table — it is derived');
      const art = SpriteLayout.creatureArt(g);
      assert.truthy(art, g + ' resolves to art');
      assert.eq(art.scale, base.scale * SpriteLayout.GIANT_ART_SCALE, g + ' is the base scaled up');
      for (const k of ['fw', 'fh', 'foot', 'float', 'minY', 'maxY']) assert.eq(art[k], base[k], g + ' keeps ' + k);
      assert.eq(SpriteLayout.creatureScale(g), art.scale, 'creatureScale reads the resolved art');
      assert.eq(SpriteLayout.creatureFoot(g), base.foot, 'same foot origin');
      assert.eq(SpriteLayout.creatureFloat(g), base.float, 'same float');
      // The crown is higher on a taller body, so the wheel and the bar seat
      // higher (more negative = further up the screen) than on the base kind.
      assert.lt(SpriteLayout.creatureWheelDy(g), SpriteLayout.creatureWheelDy(kind), g + ' wheel seats higher');
      assert.lt(SpriteLayout.creatureHealthBarTop(g), SpriteLayout.creatureHealthBarTop(kind), g + ' bar floats higher');
      // Crown rule, re-derived: the wheel's outer top edge sits on the art
      // top when the art is tall enough to carry a full radius.
      const anchorY = SpriteLayout.CREATURE_GROUND_DY - art.float;
      const artTop = anchorY - (art.foot * art.fh - art.minY) * art.scale;
      const artH = (art.maxY - art.minY) * art.scale;
      const R = SpriteLayout.CREATURE_WHEEL_R + 1;
      const expect = artTop + Math.min(R, artH / 2);
      assert.eq(SpriteLayout.creatureWheelDy(g), expect, g + ' wheel obeys the crown rule');
    }
    assert.eq(SpriteLayout.creatureArt('giant_nessie'), undefined, 'a giant of nothing has no art');
  });

  test('giants: the shipping consumers resolve a giant to its base kind', () => {
    const app = APP_JS_SRC;
    assert.truthy(/const questKind = MONSTERS\[victim\.kind\]\?\.giant \|\| victim\.kind;/.test(app),
      'a giant kill credits the base kind\'s quest');
    const render = RENDER_SRC;
    assert.truthy(/const bk = baseKind\(c\.kind\);/.test(render), 'render.js picks the sheet by base kind');
    assert.truthy(/CRITTER_SHADOW_W\[baseKind\(c\.kind\)\] \|\| 18\) \* giantMul\(c\.kind\)/.test(render),
      'the shadow follows the giant scale');
    assert.falsy(/CA\[kind\]\?\.scale/.test(render), 'render.js no longer reads the art table directly');
    const interact = INTERACT_SRC;
    assert.truthy(/const \[frame, baseScale, lift\] = SPRITE\[bk\] \|\| SPRITE\.chicken;/.test(interact),
      'the tap box is the base kind\'s');
    assert.truthy(/const scale = baseScale \* gMul;/.test(interact), 'scaled by the giant multiplier');
    assert.truthy(/const halfW = \(HALF_W\[bk\] \?\? 2\.0\) \* gMul;/.test(interact), 'and so is its half-width');
  });
})();
