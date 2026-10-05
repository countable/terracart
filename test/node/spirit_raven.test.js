// The Scroll of the Raven: a minute of a slime-strength ally — the crow
// drawn at half opacity — that hunts the nearest FOE (Combat.isEnemy) or PEST
// CROW through wanderCreatures' pet lane, and whose kills pay as a pet's.
//
// The item, the creature rows, the borrowed stats and the prey predicate are
// pure and driven here; the drink and the keeper are Phaser scene methods and
// are pinned as source text.

(function () {
const app = SCENE_SRC;
const methodBody = (sig) => {
  const a = app.indexOf(sig);
  assert.truthy(a > 0, `found ${sig.trim()}`);
  return app.slice(a, app.indexOf('\n  }\n', a));
};

test('spirit raven: a scroll with an icon, a tier, a price and a story hint', () => {
  assert.eq(ITEM_BY_ID.raven_scroll?.kind, 'magic', 'read, not eaten');
  assert.truthy(ITEM_BY_ID.raven_scroll.scroll);
  assert.falsy(isPotion('raven_scroll'));
  assert.falsy(CONSUMABLE_SPEC.raven_scroll.channel);
  assert.eq(FOOD_ENERGY.raven_scroll, undefined, 'never on the Eat button');
  assert.eq(MINERAL_ICON_SHEET.raven_scroll?.sheet, 'icon_raven_scroll', 'drawn from raven-marked parchment');
  const frame = MINERAL_ICON_SHEET.raven_scroll.frame;
  for (const [id, ic] of Object.entries(MINERAL_ICON_SHEET)) {
    if (id !== 'raven_scroll' && ic.sheet === 'icon_raven_scroll') {
      assert.truthy(ic.frame !== frame, `its flask is its own (frame ${frame} is not ${id}'s)`);
    }
  }
  assert.eq(BASE_TIER.raven_scroll, 2, 'tier 2');
  assert.eq(PRICES.raven_scroll, 55);
  const line = ITEM_EFFECTS.raven_scroll;
  assert.truthy(line && line.length <= 55, `the ✦ line fits its row (${line && line.length} chars)`);
  assert.falsy(/\d/.test(line), 'the raven description leaves its duration for discovery');
  assert.eq(SPIRIT_RAVEN_MS, 60 * 1000, 'one minute');
  assert.eq(CONSUMABLE_SPEC.raven_scroll.buff, 'raven', 'the Read button routes it by its buff column');
  assert.truthy(/foes/.test(CONSUMABLE_SPEC.raven_scroll.get), 'the confirmation hints at an ally');
  assert.truthy(Shops.themedStock('potion', 2).includes('raven_scroll'), 'a T2 potion shop stocks it');
});

test('spirit raven: the crow\'s art at half opacity', () => {
  const SL = SpriteLayout;
  const art = SL.CREATURE_ART.spirit_raven, crow = SL.CREATURE_ART.crow;
  assert.truthy(art, 'it has an art row');
  assert.eq(SL.creatureAlpha('spirit_raven'), 0.5, 'half opacity');
  assert.eq(SL.creatureAlpha('crow'), 1, 'the crow stays solid');
  for (const k of ['sheet', 'fw', 'fh', 'scale', 'foot', 'float', 'minY', 'maxY', 'airborne']) {
    assert.eq(art[k], crow[k], `${k} is the crow's — one body, one ground line`);
  }
  assert.eq(SL.creatureTint('spirit_raven'), SL.creatureTint('crow'), 'and the crow\'s colour');
});

test('spirit raven: a slime\'s stats, derived — and never an enemy', () => {
  assert.eq(Combat.summonedAs('spirit_raven'), 'slime', 'summoned as a slime');
  assert.eq(Combat.FAUNA_HP.spirit_raven, Combat.FAUNA_HP.slime, 'the slime\'s HP pool');
  assert.eq(Combat.creatureMaxHp('spirit_raven'), Combat.FAUNA_HP.slime, 'what the fight seeds it with');
  assert.eq(Combat.petBite('spirit_raven'), EnemyRoster.get('slime').dmg, 'it bites with the slime\'s leech (the roster row\'s dmg)');
  assert.eq(Combat.petBite('dog'), Combat.PET_BITE, 'a tame pet still worries its prey a point a bite');
  assert.eq(Combat.PET_BITE, 1);
  // One bite per step, one step a second: the slime's own cadence.
  assert.eq(SpriteLayout.CREATURE_BEHAVIOUR.spirit_raven.stepMs, Combat.MELEE_INTERVAL_MS,
    'it steps (and so bites) once a second, as a slime leeches');
  // Its pace is the STRIDE (owner: a full cell a second was a little too
  // fast): under a cell a hop, over the quickest ground foe's chase so it
  // still catches its prey, under the brisk-walk line's four-fold.
  const stride = SpriteLayout.CREATURE_BEHAVIOUR.spirit_raven.stepCells;
  assert.eq(stride, 0.7, 'seven tenths of a cell a hop');
  const mps = faunaTopMps('spirit_raven', WorldGen.CELL_M);
  assert.eq(mps, stride * WorldGen.CELL_M, 'its top speed is that stride over the one-second beat');
  // Over every ground foe's chase but the goblins', which run at 7 m/s (and a goblin pursues, so it comes to the
  // raven anyway); the orc, the quickest of the rest, is still caught.
  const orc = foeChaseMps({ kind: 'orc', id: 'mon_orc_1_1_1_0' }, WorldGen.CELL_M);
  assert.gt(mps, orc, 'still faster than the quickest ground pursuer that does not come to it');
  assert.lt(mps, foeChaseMps({ kind: 'goblin', id: 'mon_goblin_1_1_1_0' }, WorldGen.CELL_M),
    'the doubled goblin is the one ground foe it no longer outruns');
  assert.lt(mps, WorldGen.CELL_M, 'and slower than the full cell a second it flew before');
  assert.falsy(Combat.isEnemyKind('spirit_raven'), 'not an enemy kind');
  assert.falsy(Combat.isEnemy({ kind: 'spirit_raven', id: 'spirit_raven_1_2_3_4' }), 'nothing auto-fires at it');
  assert.falsy(Combat.isMonster('spirit_raven'), 'no MONSTERS row');
  assert.eq(Combat.enemyBounty('spirit_raven', 0), 0, 'and nothing pays for felling it');
  assert.falsy(SpriteLayout.isGame('spirit_raven'), 'not game either — no hunt wheel');
  assert.falsy(SpriteLayout.isPet('spirit_raven'), 'not a pet: summoned, not tamed');
  assert.truthy(SpriteLayout.isSummoned('spirit_raven'), 'summoned');
  assert.truthy(Companions.follows({kind:'spirit_raven',_followUntilT:Infinity}), 'it keeps to your side between fights');
  assert.truthy(Combat.isPlayerKill('pet'), 'its kills pay as the player\'s own');
});

test('spirit raven: it hunts every foe and the pest deer — not game, not the tame', () => {
  const R = 'spirit_raven';
  assert.truthy(huntsPrey(R, { kind: 'slime', id: 'slime_1_2_3' }), 'a wild slime');
  assert.truthy(huntsPrey(R, { kind: 'goblin', id: 'mon_goblin_2_1_1_0' }), 'a cave monster');
  assert.truthy(huntsPrey(R, { kind: 'giant_spider', id: 'mon_giant_spider_5_1_1_0' }), 'a giant');
  assert.truthy(huntsPrey(R, { kind: 'deer', id: 'pest_deer_3_4_1000_7' }), 'a pest deer — the one dispatched at your field');
  assert.falsy(huntsPrey(R, { kind: 'crow', id: 'crow_3_4_0' }), 'never a wild crow (game, not a dispatched pest)');
  assert.falsy(huntsPrey(R, { kind: 'deer', id: 'deer_3_4_0' }), 'never a deer (game)');
  assert.falsy(huntsPrey(R, { kind: 'chicken', id: 'chicken_3_4_0' }), 'never livestock');
  assert.falsy(huntsPrey(R, { kind: 'slime', pet: true, id: 'released_slime_1_2' }), 'never a tamed slime');
  assert.falsy(huntsPrey(R, { kind: R, id: 'spirit_raven_1_1_1_1' }), 'never another raven');
  // The pets' half of the same predicate is their own row, unchanged.
  assert.truthy(huntsPrey('cat', { kind: 'crow', id: 'crow_1_1_0' }), 'a cat still takes a crow');
  assert.truthy(huntsPrey('dog', { kind: 'deer', id: 'deer_1_1_0' }), 'a dog still takes a deer');
  assert.falsy(huntsPrey('dog', { kind: 'goblin', id: 'mon_goblin_1_1_1_0' }), 'but not a goblin');
  assert.falsy(huntsPrey('cat', { kind: 'crow', pet: true, id: 'released_crow_1' }), 'and never a tame crow');
});

test('spirit raven: the pet lane is the raven\'s lane', () => {
  const sim = SCENE_SRC;
  assert.truthy(/const huntsForPlayer = \(isTame && SpriteLayout\.isPet\(c\.kind\)\) \|\| summoned;/.test(sim),
    'a summoned ally hunts through the pet scan, as a second reason');
  assert.truthy(/c\._chaseTarget = nearestCreature\(this, c, 8 \* this\.cellM, \(cr\) => \{\s*if \(!huntsPrey\(c\.kind, cr\)/.test(sim),
    'the scan is the one nearest scan, asking the one predicate');
  assert.truthy(/Combat\.damage\(tgt, Combat\.petBlow\(c\)\)/.test(sim), 'the bite is Combat.petBlow — petBite times the pet\'s own power');
  assert.truthy(/this\.resolveDefeat\(tgt, 'pet'\)/.test(sim), 'and a kill pays as the pet\'s');
  assert.truthy(/pest_deer\|pest_crow\|ghost\|fished_slime\|\$\{Object\.keys\(Companions\.KINDS\)\.join\('\|'\)\}/.test(sim),
    'a dismissed raven\'s id is pruned like the pest deer\'s — every Companions.KINDS row, derived');
  assert.truthy('spirit_raven' in Companions.KINDS);
  assert.truthy(/if \(SpriteLayout\.isSummoned\(c\.kind\)\) return;/.test(INTERACT_SRC),
    'a tap goes through it — nothing to catch, tame or pet');
});

test('spirit raven: the scroll refreshes one timer; the keeper summons one bird', () => {
  // A `buff` row: _useTimedBuff extends save.spiritRavenUntil (the `raven`
  // Buffs row — the companion row's own field) and the hook wakes the keeper.
  assert.eq(CONSUMABLE_SPEC.raven_scroll.buff, 'raven', 'a timed buff row');
  assert.eq(Buffs.KINDS.raven.save, Companions.KINDS.spirit_raven.field, 'the buff row and the companion row read one field');
  const hooks = app.match(/\nconst TIMED_BUFF_HOOKS = \{[\s\S]*?\n\};/)[0];
  assert.truthy(/raven: \{ after: \(s\) => s\._tickSpiritRaven\(\) \}/.test(hooks), 'summoned now, not a frame later');
  const drink = methodBody('  _useTimedBuff(id, { mul = 1, spend = true } = {}) {');
  assert.truthy(/this\._selectedConsumable\(id\)/.test(drink), 'only with the scroll selected');
  assert.truthy(/this\._spendScroll\(id\);/.test(drink), 'consumes and teaches the scroll recipe');
  const keep = methodBody('  _tickSpiritRaven() {');
  assert.truthy(/Companions\.tick\(this, 'spirit_raven'\)/.test(keep), 'the shared companion keeper');
  assert.eq(Companions.KINDS.spirit_raven.field, 'spiritRavenUntil', 'existing saves retain their timer');
  assert.truthy(/Companions\.tickAll\(this\);/.test(app.slice(app.indexOf('this._tickBlightAura();'))),
    'all companions kept once per frame');

});
})();
