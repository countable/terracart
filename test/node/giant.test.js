// Giant monsters — combat.js MONSTERS derives a `giant_<kind>` for every base
// kind (4× HP, two levels deeper), and sprite_layout.js draws it on the base
// kind's art at GIANT_ART_SCALE with the wheel / bar / tap box following.

(() => {
  // A giant is a CAVE kind's: a row with its own `spawn` (the ghost, which
  // rises on the surface at night) has none, and is pinned so below.
  const baseKinds = Object.keys(MONSTERS).filter((k) => !MONSTERS[k].giant && Combat.spawnsUnderground(k));
  const giantKinds = Object.keys(MONSTERS).filter((k) => MONSTERS[k].giant);

  test('giants: only declared variants enter the roster, with their own final stats', () => {
    const declared = EnemyRoster.ROWS.filter(row => row.variantType === 'Giant');
    assert.eq(giantKinds.length, declared.length);
    for (const row of declared) {
      const live = Combat.monster(row.id);
      assert.eq(live.hp, row.hp);
      assert.eq(live.giant, row.variantOf);
      assert.eq(Combat.maxHp({ kind: row.id, shiny: true }), row.hp, 'size and elite do not stack');
      assert.eq(SpriteLayout.baseKind(row.id), row.variantOf);
    }
    assert.falsy(MONSTERS.giant_goblin, 'legacy giant is excluded from new encounters');
    assert.truthy(Combat.monster('giant_goblin'), 'old save still resolves');
  });

  test('giants: art and seated indicators scale with the declared giant body', () => {
    assert.eq(SpriteLayout.GIANT_ART_SCALE, 1.6);
    for (const row of EnemyRoster.ROWS.filter(row => row.variantType === 'Giant')) {
      const art = SpriteLayout.creatureArt(row.id), base = SpriteLayout.creatureArt(row.variantOf);
      assert.eq(art.scale, base.scale * SpriteLayout.GIANT_ART_SCALE * (row.artScale ?? 1));
      assert.lt(SpriteLayout.creatureWheelDy(row.id), SpriteLayout.creatureWheelDy(row.variantOf));
      assert.lt(SpriteLayout.creatureHealthBarTop(row.id), SpriteLayout.creatureHealthBarTop(row.variantOf));
    }
  });

  test('giants: a different kind on the quest board and in the Discovery ledger', () => {
    // Every monster kind, giants included, is a kill target the board can
    // name, with a name to print.
    // (Less a row that says `board: false` — the zone-only fire slime.)
    for (const kind of Object.keys(MONSTERS)) {
      if (!Combat.onQuestBoard(kind)) { assert.falsy(QUEST_ENEMIES.includes(kind), kind + ' is kept off the board'); continue; }
      assert.includes(QUEST_ENEMIES, kind, kind + ' is a quest target');
    }
    for (const kind of giantKinds) {
      assert.falsy(QUEST_ENEMIES.includes(kind), kind + ' remains compatible but no new quest requests it');
      assert.truthy(Combat.monster(kind), 'saved discoveries and kills still resolve');
    }
    for (let g = 0; g < 200; g++) {
      const q = Quests.generate(g % QUEST_SLOTS, g + 3, 100, 11);
      if (q.verb === 'kill') {
        assert.falsy(EnemyRoster.get(q.target)?.retired, 'new quests never require a retired enemy');
        assert.falsy(/undefined/.test(q.body), 'the enemy has a name');
      }
    }
    // Rank 0 still opens with the surface slime only.
    for (let g = 3; g < 40; g++) {
      const q = Quests.generate(g % QUEST_SLOTS, g, 0, 11);
      if (q.verb === 'kill') assert.eq(q.target, 'slime', 'rank 0 asks for the surface slime');
    }
    // No cross-credit either way.
    const save = { quests: { slots: [], gen: 0, done: 0 }, relicSalt: 1 };
    const q = Quests.board(save)[0];
    q.verb = 'kill'; q.event = 'kill'; q.target = 'goblin'; q.need = 2; q.have = 0;
    assert.falsy(Quests.onKill(save, 'giant_goblin'), 'a giant goblin is not a goblin');
    assert.eq(q.have, 0, 'no credit');
    assert.truthy(Quests.onKill(save, 'goblin'), 'a goblin is');
    q.target = 'giant_goblin'; q.have = 0;
    assert.falsy(Quests.onKill(save, 'goblin'), 'a goblin is not a giant goblin');
    assert.truthy(Quests.onKill(save, 'giant_goblin'), 'a giant goblin is');
    // The kill path credits the kind as-is, and the elite badge is keyed the
    // same way — so an elite giant goblin is a discovery of its own.
    const app = APP_JS_SRC;
    assert.truthy(/const qDone = Quests\.onKill\(save, victim\.kind\);/.test(app), 'quest credit is the kind as-is');
    assert.falsy(/\.giant \|\| victim\.kind/.test(app), 'no fold to the base kind anywhere');
    assert.truthy(/if \(this\._bankDiscovery\(victim\.kind, /.test(app), 'the elite badge is keyed by the kind as-is');
  });

  test('giants: the shipping consumers resolve a giant to its base kind for ART only', () => {
    const render = RENDER_SRC;
    // The sheet comes off SpriteLayout now rather than an if-else on the base
    // kind in the draw branch — creatureArt already resolves a giant to its
    // base row, so the resolution is the table's and this checks the ANSWER
    // rather than the shape of the code that used to compute it.
    assert.eq(SpriteLayout.creatureSheet('giant_goblin'), SpriteLayout.creatureSheet('goblin'),
      'a giant goblin draws the goblin sheet');
    assert.eq(SpriteLayout.creatureFrames('giant_goblin'), SpriteLayout.creatureFrames('goblin'),
      'and runs the same cycle');
    assert.truthy(/const texKey = npcArt \? npcArt\.sheet : creatureSheet\(c\.kind\);/.test(render),
      'render.js picks the sheet from the table');
    assert.truthy(/CRITTER_SHADOW_W\[baseKind\(c\.kind\)\] \|\| 18\) \* giantMul\(c\.kind\)/.test(render),
      'the shadow follows the giant scale');
    assert.falsy(/CA\[kind\]\?\.scale/.test(render), 'render.js no longer reads the art table directly');
    const interact = INTERACT_SRC;
    assert.truthy(/const span = SpriteLayout\.creatureTapSpanPx\(c\.kind(?:, inst)?\)/.test(interact),
      'the tap box is read off the art table (creatureArt resolves the giant)');
    assert.falsy(/const SPRITE = \{/.test(interact), 'no second hand table of frame/scale/lift');
    const g = SpriteLayout.creatureTapSpanPx('giant_goblin');
    const b = SpriteLayout.creatureTapSpanPx('goblin');
    assert.truthy(g.top < b.top && g.bottom >= b.bottom, 'a giant\'s tap box is taller than its base kind\'s');
    // The span IS the drawn art: the crown row is the wheel seat's art top.
    for (const kind of Object.keys(SpriteLayout.CREATURE_ART)) {
      const a = SpriteLayout.creatureArt(kind);
      const s = SpriteLayout.creatureTapSpanPx(kind);
      const anchor = SpriteLayout.CREATURE_GROUND_DY - a.float;
      const hop = SpriteLayout.creatureHop(kind)?.px ?? (a.hopRow != null ? SpriteLayout.HOP_PX : 0);
      assert.eq(s.top, anchor - (a.foot * a.fh - a.minY) * a.scale - hop, kind + ' tap top = art crown (+ hop)');
      assert.eq(s.bottom, anchor + (a.maxY - a.foot * a.fh) * a.scale, kind + ' tap bottom = art bottom row');
    }
    assert.truthy(/const halfW = \(HALF_W\[bk\] \?\? 2\.0\) \* gMul;/.test(interact), 'and so is its half-width');
  });
})();
