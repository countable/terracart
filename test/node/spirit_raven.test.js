// The Potion of the Raven: a minute of a slime-strength ally — the crow
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

test('spirit raven: a potion with an icon, a tier, a price and a ✦ line quoting its length', () => {
  assert.eq(ITEM_BY_ID.raven_potion?.kind, 'magic', 'drunk, not eaten');
  assert.eq(FOOD_ENERGY.raven_potion, undefined, 'never on the Eat button');
  assert.eq(MINERAL_ICON_SHEET.raven_potion?.sheet, 'icon_potions', 'drawn from the potion sheet');
  const frame = MINERAL_ICON_SHEET.raven_potion.frame;
  for (const [id, ic] of Object.entries(MINERAL_ICON_SHEET)) {
    if (id !== 'raven_potion' && ic.sheet === 'icon_potions') {
      assert.truthy(ic.frame !== frame, `its flask is its own (frame ${frame} is not ${id}'s)`);
    }
  }
  assert.eq(BASE_TIER.raven_potion, BASE_TIER.blight_potion, 'Blight\'s tier');
  assert.eq(PRICES.raven_potion, PRICES.blight_potion, 'and Blight\'s price');
  const line = ITEM_EFFECTS.raven_potion;
  assert.truthy(line && line.length <= 55, `the ✦ line fits its row (${line && line.length} chars)`);
  assert.falsy(/\d/.test(line), 'the raven description leaves its duration for discovery');
  assert.eq(SPIRIT_RAVEN_MS, 60 * 1000, 'one minute');
  assert.eq(CONSUMABLE_SPEC.raven_potion.method, 'drinkRavenPotion', 'the Drink button offers it');
  assert.truthy(/foes/.test(CONSUMABLE_SPEC.raven_potion.get), 'the confirmation hints at an ally');
  assert.truthy(Shops.themedStock('potion', 3).includes('raven_potion'), 'a T3 potion shop stocks it');
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
  assert.eq(Combat.petBite('spirit_raven'), SLIME_LEECH_ENERGY, 'it bites with the slime\'s leech');
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
  const goblin = foeChaseMps({ kind: 'goblin', id: 'mon_goblin_1_1_1_0' }, WorldGen.CELL_M);
  assert.gt(mps, goblin, 'still faster than the quickest ground pursuer');
  assert.lt(mps, WorldGen.CELL_M, 'and slower than the full cell a second it flew before');
  assert.falsy(Combat.isEnemyKind('spirit_raven'), 'not an enemy kind');
  assert.falsy(Combat.isEnemy({ kind: 'spirit_raven', id: 'spirit_raven_1_2_3_4' }), 'nothing auto-fires at it');
  assert.falsy(Combat.isMonster('spirit_raven'), 'no MONSTERS row');
  assert.eq(Combat.enemyBounty('spirit_raven', 0), 0, 'and nothing pays for felling it');
  assert.falsy(SpriteLayout.isGame('spirit_raven'), 'not game either — no hunt wheel');
  assert.falsy(SpriteLayout.isPet('spirit_raven'), 'not a pet: summoned, not tamed');
  assert.truthy(SpriteLayout.isSummoned('spirit_raven'), 'summoned');
  assert.truthy(SpriteLayout.creatureFollows('spirit_raven'), 'it keeps to your side between fights');
  assert.truthy(Combat.isPlayerKill('pet'), 'its kills pay as the player\'s own');
});

test('spirit raven: it hunts every foe and the pest crow — not game, not the tame', () => {
  const R = 'spirit_raven';
  assert.truthy(huntsPrey(R, { kind: 'slime', id: 'slime_1_2_3' }), 'a wild slime');
  assert.truthy(huntsPrey(R, { kind: 'goblin', id: 'mon_goblin_2_1_1_0' }), 'a cave monster');
  assert.truthy(huntsPrey(R, { kind: 'giant_goblin_archer', id: 'mon_giant_goblin_archer_5_1_1_0' }), 'a giant');
  assert.truthy(huntsPrey(R, { kind: 'crow', id: 'pest_crow_3_4_1000_7' }), 'a pest crow');
  assert.falsy(huntsPrey(R, { kind: 'crow', id: 'crow_3_4_0' }), 'never a wild crow (game)');
  assert.falsy(huntsPrey(R, { kind: 'deer', id: 'deer_3_4_0' }), 'never a deer (game)');
  assert.falsy(huntsPrey(R, { kind: 'chicken', id: 'chicken_3_4_0' }), 'never livestock');
  assert.falsy(huntsPrey(R, { kind: 'slime', id: 'released_slime_1_2' }), 'never a tamed slime');
  assert.falsy(huntsPrey(R, { kind: R, id: 'spirit_raven_1_1_1_1' }), 'never another raven');
  // The pets' half of the same predicate is their own row, unchanged.
  assert.truthy(huntsPrey('cat', { kind: 'crow', id: 'crow_1_1_0' }), 'a cat still takes a crow');
  assert.truthy(huntsPrey('dog', { kind: 'deer', id: 'deer_1_1_0' }), 'a dog still takes a deer');
  assert.falsy(huntsPrey('dog', { kind: 'goblin', id: 'mon_goblin_1_1_1_0' }), 'but not a goblin');
  assert.falsy(huntsPrey('cat', { kind: 'crow', id: 'released_crow_1' }), 'and never a tame crow');
});

test('spirit raven: the pet lane is the raven\'s lane', () => {
  const sim = SCENE_SRC;
  assert.truthy(/const huntsForPlayer = \(isTame && SpriteLayout\.isPet\(c\.kind\)\) \|\| summoned;/.test(sim),
    'a summoned ally hunts through the pet scan, as a second reason');
  assert.truthy(/if \(!huntsPrey\(c\.kind, cr\)\) return;/.test(sim), 'the scan asks the one predicate');
  assert.truthy(/Combat\.damage\(tgt, Combat\.petBite\(c\.kind\)\)/.test(sim), 'the bite is Combat.petBite');
  assert.truthy(/this\.resolveDefeat\(tgt, 'pet'\)/.test(sim), 'and a kill pays as the pet\'s');
  assert.truthy(/pest_crow\|ghost\|fished_slime\|spirit_raven/.test(sim), 'a dismissed raven\'s id is pruned like the pest crow\'s');
  assert.truthy(/if \(SpriteLayout\.isSummoned\(c\.kind\)\) return;/.test(INTERACT_SRC),
    'a tap goes through it — nothing to catch, tame or pet');
});

test('spirit raven: the drink refreshes one timer; the keeper summons one bird', () => {
  const drink = methodBody('  drinkRavenPotion(opts = {}) {');
  assert.truthy(/sel\.id !== 'raven_potion'/.test(drink), 'only with the potion selected');
  assert.truthy(/this\.save\.spiritRavenUntil = Date\.now\(\) \+ SPIRIT_RAVEN_MS;/.test(drink),
    'the expiry is on the save, from the one constant');
  assert.truthy(/this\._finishConsumable\(/.test(drink), 'the one consume / channel exit');
  const keep = methodBody('  _tickSpiritRaven() {');
  assert.truthy(/if \(!live \|\| this\._spiritRaven\) return;/.test(keep), 'never a second raven while one is out');
  assert.truthy(/WorldGen\.makeCreature\('spirit_raven', px, py,/.test(keep), 'summoned at the player\'s feet');
  assert.truthy(/const px = this\.startWorldM\.x \+ this\.playerM\.x;/.test(keep), 'the player, not the camera');
  assert.truthy(/if \(!entry \|\| !entry\.creatures\) return;/.test(keep), 'never seeds a tile\'s creature list');
  assert.truthy(/\(this\.save\.caught = this\.save\.caught \|\| \[\]\)\.push\(r\.id\)/.test(keep), 'dismissed through save.caught');
  for (const m of keep.match(/'The spirit raven[^']*'/g) || []) {
    assert.lte(m.length - 2, MAP_MSG_MAX, `${m} fits a map message`);
  }
  assert.truthy(/this\._tickSpiritRaven\(\);/.test(app.slice(app.indexOf('this._tickBlightAura();'))),
    'kept once a frame, beside the Blight aura');
});
})();
