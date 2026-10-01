// Headless tests for the CREATURE BEHAVIOUR table
// (src/sprite_layout.js › CREATURE_BEHAVIOUR, read by app.js's wander loop and
// kill payout, interact.js's tap handler and render.js's draw pass).
//
// Per-kind creature GEOMETRY has been one table since CREATURE_ART landed; per-
// kind BEHAVIOUR was a chain of kind literals spread over three files — a
// nine-name OR-chain for what wanders, a pair of prey Sets in app.js, a
// HUNT_KINDS set in interact.js, a crow/deer scarecrow test, a crow/deer drop
// ternary, a cow/chicken produce ternary written out twice. Each of those was a
// place a kind had to be REMEMBERED, and a new kind had to be remembered in all
// of them at once.
//
// What is pinned here is the contract the table has to keep for those readers:
// that every kind the renderer draws has a row, that a GIANT inherits its base
// kind's row exactly as it inherits its base kind's art, and that the three
// classifications the rest of the game asks about — game, pet, drop — still
// name the kinds they named before.
//
// THE ONE THING THIS TABLE MUST NOT DECIDE is whether a kind is HOSTILE. That
// is combat.js's MONSTERS registry, read everywhere through Combat.isEnemy
// (CLAUDE.md: "when you add a hostile kind, put it in the monster table"), so
// the last test below holds the line between them.

const CT_SL = SpriteLayout;
const CT_BEH = CT_SL.CREATURE_BEHAVIOUR;
const CT_MONSTERS = ['cave_slime', 'purple_slime', 'goblin', 'goblin_archer'];
const ctKinds = (fn) => Object.keys(CT_BEH).filter(fn).sort().join(',');

test('creature table: every kind with art has a behaviour row, and vice versa', () => {
  for (const kind of Object.keys(CT_SL.CREATURE_ART)) {
    assert.truthy(CT_BEH[kind], `${kind} draws but does not behave — no CREATURE_BEHAVIOUR row`);
  }
  for (const kind of Object.keys(CT_BEH)) {
    assert.truthy(CT_SL.CREATURE_ART[kind], `${kind} behaves but has no CREATURE_ART row`);
  }
});

test('creature table: everything in the table wanders — a row with no habits is furniture', () => {
  for (const kind of Object.keys(CT_BEH)) {
    assert.truthy(CT_SL.creatureWanders(kind), `${kind} should think in the sim bubble`);
  }
  // And nothing outside it does: the wander cull is this table's membership
  // test now, so a kind the table has never heard of stays frozen.
  assert.falsy(CT_SL.creatureWanders('nessie'), 'an unknown kind does not wander');
  assert.falsy(CT_SL.creatureWanders(undefined), 'and neither does a missing kind');
});

test('creature table: a GIANT resolves to its base kind\'s row, like its art', () => {
  for (const kind of CT_MONSTERS) {
    const g = CT_SL.GIANT_PREFIX + kind;
    assert.falsy(CT_BEH[g], `no ${g} row — a giant is derived, never authored`);
    assert.eq(CT_SL.creatureBehaviour(g), CT_SL.creatureBehaviour(kind),
      `${g} behaves as a ${kind}`);
    assert.truthy(CT_SL.creatureWanders(g), `${g} wanders`);
  }
  // The same resolution the art uses, so the two can never disagree about
  // which kind a giant IS.
  assert.eq(CT_SL.creatureSheet('giant_goblin'), CT_SL.creatureSheet('goblin'),
    'and it is still drawn on the base kind\'s sheet');
});

test('creature table: GAME is exactly the crow and the deer', () => {
  assert.eq(ctKinds((k) => CT_BEH[k].game), 'crow,deer');
  for (const k of ['crow', 'deer']) assert.truthy(CT_SL.isGame(k), `${k} is game`);
  for (const k of ['slime', 'chicken', 'cow', 'cat', 'dog', 'rabbit', 'butterfly'])
    assert.falsy(CT_SL.isGame(k), `${k} is not hunted`);
  // A giant of a hunted kind would be game too — but nothing hunted has one,
  // and the monsters are not game, so no giant is either.
  for (const k of CT_MONSTERS) {
    assert.falsy(CT_SL.isGame(k), `${k} is fought, not hunted`);
    assert.falsy(CT_SL.isGame(CT_SL.GIANT_PREFIX + k), `giant ${k} is fought, not hunted`);
  }
});

test('creature table: a PET is exactly the cat and the dog, and each hunts its own list', () => {
  assert.eq(ctKinds((k) => CT_BEH[k].pet), 'cat,dog');
  assert.eq([...CT_SL.creaturePrey('cat')].join(), 'crow', 'a cat takes crows');
  assert.eq([...CT_SL.creaturePrey('dog')].join(), 'deer,slime', 'a dog takes deer and slimes');
  // Every kind on a prey list is a real kind, or a pet would hunt a ghost.
  for (const k of ['cat', 'dog']) {
    for (const p of CT_SL.creaturePrey(k)) assert.truthy(CT_BEH[p], `${k}'s prey ${p} is a real kind`);
  }
  // Only a PET carries a prey list, and only a prey-carrying kind is a pet:
  // one row answers both halves of the wander loop's scan.
  assert.eq(ctKinds((k) => CT_BEH[k].prey), 'cat,dog');
  assert.eq(CT_SL.creaturePrey('chicken'), null, 'a chicken hunts nothing');
  // FOLLOWING is the cat's (interact.js arms the timer, wanderCreatures
  // honours it) and the spirit raven's (app.js _tickSpiritRaven arms it for
  // the bird's whole life) — and it is not the same question as being a pet.
  assert.eq(ctKinds((k) => CT_BEH[k].follows), 'cat,mercenary,spirit_raven');
  assert.truthy(CT_SL.creatureFollows('cat'));
  assert.falsy(CT_SL.creatureFollows('dog'), 'a dog does not trail you around');
});

test('creature table: what a kill drops is the kind\'s own row', () => {
  assert.eq(CT_SL.creatureDrop('crow'), 'crow_feather');
  assert.eq(CT_SL.creatureDrop('deer'), 'meat');
  // GAME drops a body part, and livestock is caught alive. Two ENEMIES carry
  // a drop too — the goblin trapper's Magic Trap and the tar yard's fire
  // slime's flint (src/zones.js) — paid ON TOP of the bounty (app.js
  // resolveDefeat asks Combat for the wage, this table for the drop).
  assert.eq(ctKinds((k) => CT_BEH[k].drop), 'crow,deer,fire_slime,goblin_trapper');
  assert.eq(CT_SL.creatureDrop('fire_slime'), 'coal', 'a fire slime drops a flint');
  assert.eq(CT_SL.creatureDrop('goblin_trapper'), 'magic_trap', 'a trapper drops its trap');
  assert.eq(CT_SL.creatureDrop('giant_goblin_trapper'), 'magic_trap', 'and so does its giant');
  assert.truthy(ITEM_BY_ID.magic_trap, 'which is a real item');
  for (const k of ['slime', 'chicken', 'cow', 'cat', 'dog', 'rabbit', 'butterfly', ...CT_MONSTERS])
    assert.eq(CT_SL.creatureDrop(k), null, `${k} drops no item on defeat`);
  assert.eq(CT_SL.creatureDrop('giant_goblin'), null, 'and neither does a giant');
  // Both ids are real items — the drop is added to the bag by id.
  for (const k of ['crow', 'deer'])
    assert.truthy(ITEM_BY_ID[CT_SL.creatureDrop(k)], `${k}'s drop is a real item`);
});

test('creature table: PRODUCE is the chicken, the cow and the crab, item and verb together', () => {
  assert.eq(ctKinds((k) => CT_BEH[k].produce), 'chicken,cow,crab');
  assert.eq(CT_SL.creatureProduce('crab').item, 'shell', 'a fed crab gives the beach pickup');
  assert.eq(CT_SL.creatureProduce('crab').verb, 'shed');
  assert.eq(CT_SL.creatureProduce('chicken').item, 'egg');
  assert.eq(CT_SL.creatureProduce('chicken').verb, 'laid');
  assert.eq(CT_SL.creatureProduce('cow').item, 'milk');
  assert.eq(CT_SL.creatureProduce('cow').verb, 'milked');
  assert.eq(CT_SL.creatureProduce('deer'), null, 'nothing milks a deer');
  for (const k of ['chicken', 'cow', 'crab'])
    assert.truthy(ITEM_BY_ID[CT_SL.creatureProduce(k).item], `${k}'s yield is a real item`);
});

test('creature table: animal interaction timing has one owner beside behaviour', () => {
  const a = CT_SL.ANIMAL_INTERACTION;
  assert.truthy(a, 'the interaction table is exported');
  assert.eq(a.produceCooldownMs, 60 * 60 * 1000, 'one yield per hour');
  assert.eq(a.petBoostMs, 10 * 60 * 1000, 'petting boosts the next yield for ten minutes');
  assert.eq(a.doubleYieldChance, 0.5, 'the boosted yield has a coin-flip chance');
  assert.eq(a.followMs, 5 * 60 * 1000, 'a following cat trails for five minutes');
  assert.truthy(/ANIMAL_INTERACTION\.petBoostMs/.test(INTERACT_SRC)
    && /ANIMAL_INTERACTION\.produceCooldownMs/.test(INTERACT_SRC)
    && /ANIMAL_INTERACTION\.doubleYieldChance/.test(INTERACT_SRC)
    && /ANIMAL_INTERACTION\.followMs/.test(INTERACT_SRC),
    'interact.js reads every number from the owner');
  assert.truthy(/SpriteLayout\.creatureProduce\(c\.kind\)/.test(SCENE_SRC),
    'honey asks the producer predicate instead of naming chicken and cow again');
});

test('creature table: a scarecrow turns back the crow and the deer, and nothing else', () => {
  assert.eq(ctKinds((k) => CT_SL.creatureAvoids(k, 'scarecrow')), 'crow,deer');
  assert.falsy(CT_SL.creatureAvoids('slime', 'scarecrow'),
    'a scarecrow is no answer to a slime — that is what a campfire is for');
  assert.falsy(CT_SL.creatureAvoids('crow', 'fire'),
    'and the fire ward is app.js\'s, derived from the monster table\'s depths');
});

test('creature table: a gait row is complete — a bolt says how fast, how far and how wide', () => {
  for (const [kind, b] of Object.entries(CT_BEH)) {
    if (b.stepMs != null) assert.gt(b.stepMs, 0, `${kind} step duration`);
    if (b.stepCells != null) assert.gt(b.stepCells, 0, `${kind} stride`);
    if (b.pauseMs) assert.eq(b.pauseMs.length, 2, `${kind} pause is [base, spread]`);
    if (!b.flee) continue;
    assert.gt(b.flee.jitter, 0, `${kind} bolts on a real spread`);
    assert.gt(b.flee.stepMs, 0, `${kind} bolts at a real cadence`);
    assert.gt(b.flee.stepCells, b.stepCells ?? 1, `${kind} covers more ground bolting than idling`);
    assert.lt(b.flee.stepMs, b.stepMs ?? 5000, `${kind} bolts on a quicker beat than it idles`);
    assert.truthy(b.flee.cells > 0 || b.flee.escapes,
      `${kind} has a bolt with nothing to trigger it`);
  }
  // The three kinds that bolt, and the one whose trigger is the failed catch.
  assert.eq(ctKinds((k) => CT_BEH[k].flee), 'butterfly,deer,rabbit');
  assert.eq(ctKinds((k) => CT_BEH[k].flee?.escapes), 'butterfly');
  // A tame rabbit or deer settles into the base wander; a butterfly flits on.
  assert.eq(ctKinds((k) => CT_BEH[k].tameSettles), 'deer,rabbit');
});

test('creature table: it says how a kind BEHAVES, never whether it is a FOE', () => {
  // Hostility is the monster table's registration, read through Combat.isEnemy.
  // Nothing here may stand in for it — so no monster is marked game or pet, and
  // no row carries a stat a fight would read.
  for (const kind of CT_MONSTERS) {
    for (const g of [kind, CT_SL.GIANT_PREFIX + kind]) {
      assert.falsy(CT_SL.isGame(g), `${g} is an enemy, not game`);
      assert.falsy(CT_SL.isPet(g), `${g} is an enemy, not a pet`);
      assert.falsy(CT_SL.creaturePrey(g), `${g} hunts through the monster table, not a prey list`);
    }
    assert.truthy(Combat.isEnemyKind(kind), `${kind} is an enemy where that is decided`);
  }
  // The surface slime is the case that proves it: it is IN this table (it
  // wanders, and a dog hunts it) and it is an enemy — and this table is not
  // what says so.
  assert.truthy(CT_SL.creatureWanders('slime'));
  assert.truthy(Combat.isEnemyKind('slime'), 'the slime is a foe, per Combat');
  assert.falsy(CT_SL.isGame('slime'), 'and never game');
  for (const b of Object.values(CT_BEH)) {
    for (const stat of ['hp', 'dmg', 'range', 'speed', 'enemy', 'hostile', 'minDepth']) {
      assert.falsy(stat in b, `no fight stat (${stat}) may live in the behaviour table`);
    }
  }
});

test('creatures: a hunted deer fights back — a row, wired through the one blow path', () => {
  const fb = SpriteLayout.creatureFightsBack('deer');
  assert.truthy(fb && fb.dmg > 0 && fb.hitMs > 0 && fb.rageMs > 0, 'the deer row carries fightsBack');
  assert.eq(SpriteLayout.creatureFightsBack('crow'), null, 'a crow still just flies off');
  assert.truthy(SpriteLayout.isGame('deer'), 'and the deer is still GAME');
  assert.falsy(Combat.isEnemy({ kind: 'deer', id: 'deer_1' }), 'never an enemy — nothing auto-fires at it');
  assert.truthy(/const fb = SpriteLayout\.creatureFightsBack\(victim\.kind\);\s*if \(fb\) victim\._rageUntil = Date\.now\(\) \+ fb\.rageMs;/.test(INTERACT_SRC),
    'starting a hunt enrages it');
  const w = SCENE_SRC;
  assert.truthy(/const gameCharge = enraged && !standDown && !unnoticed;/.test(w),
    'it charges only when noticed and not warded (NOTHING HUNTS A BODY; Home wards it)');
  assert.truthy(/Combat\.incomingDamage\(this\.save, raw\)/.test(w)
    && /const raw = fightsBack\.dmg;/.test(w), 'the butt is shielded and soaked before recipient difficulty');
  assert.truthy(/const bolting = !!bolt && !gameCharge &&/.test(w), 'a charging deer does not bolt');
});

test('creatures: no pest deer is dispatched underground', () => {
  assert.truthy(/if \(\(this\.depth \|\| 0\) === 0 && now - this\._lastPestT > 90000\)/.test(SCENE_CREATURES_SRC),
    'the pump is surface-only');
});
