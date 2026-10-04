// THE POWDER OF PSYCHOSIS — the T1 magic item beside the Antidote.
//
// Every foe on screen loses its head for CONSUMABLE_SPEC.psychosis_powder
// .durationMs (ten seconds): it runs every which way at the flee pace and
// lands no blow. NOT a new mover — Combat.applyPsychosis stamps the one
// field (c._psychosisUntilT, fear's clock) and wanderCreatures reads it as
// `psychotic`, one more reason in the ROUT lane beside fear (standDown, the
// hurry pace, the yard refusal), with a random angle in the step chain where
// fear takes the away angle; rosterEnemyMove rolls the same random heading.
// app.js can't load headlessly, so its side is pinned as source text and its
// use method lifted, in the style of scroll_actions.test.js.
(function () {
const app = SCENE_SRC;
const ID = 'psychosis_powder';

function method(name, deps = {}) {
  const match = app.match(new RegExp('\\n  ' + name + '\\(([^\\n]*)\\) \\{\\n([\\s\\S]*?)\\n  \\}\\n'));
  assert.truthy(match, name + ' exists');
  return new Function(...Object.keys(deps), 'return function(' + match[1] + '){' + match[2] + '}')(...Object.values(deps));
}
function scene(creatures = []) {
  const s = {
    save: { energy: 50, inv: [{ id: ID, count: 2 }], selSlot: 0, caught: [] },
    startWorldM: { x: 100, y: 200 }, playerM: { x: 0, y: 0 }, depth: 3,
    cellM: 7, persisted: 0, rebuilt: 0, loot: [],
    buildInventoryDOM() { this.rebuilt++; }, flash() {}, flashAtPlayer() {}, flashLoot(...a) { this.loot.push(a); },
    playerToWorldCell() { return { tx: 0, ty: 0 }; },
    worldMetersToScreen(x, y) { return { x, y }; },
  };
  const deps = {
    getSelectedSlot: save => save.inv[save.selSlot], consumeSelected,
    persistSave: () => s.persisted++, setOf: arr => new Set(arr || []),
    WorldGen: { forEachItemNear: (_kind, _tx, _ty, visit) => creatures.forEach(visit) },
    Particles: { onScreen: (_scene, x, y) => x >= 0 && x < 100 && y >= 0 && y < 100 },
    shortDuration, monsterRout: () => {}, THUNDER_FLASH_MS: 350,
  };
  // The powder is a CAST_ROWS row cast by _castOnFoes: the table and the
  // refusal formatter are lifted from app.js beside the methods.
  Object.assign(deps, new Function(...Object.keys(deps),
    app.match(/\nconst CAST_ROWS = \{[\s\S]*?\n\};/)[0] + app.match(/\nfunction kept\(why, noun\) \{[^\n]*\n/)[0]
    + 'return { CAST_ROWS, kept };')(...Object.values(deps)));
  for (const name of ['_selectedConsumable', '_consumeSelected', '_finishInventoryChange', '_spendScroll', '_enemiesWhere', '_onscreenEnemies', '_castOnFoes']) s[name] = method(name, deps);
  s.usePsychosisPowder = () => s._castOnFoes(ID);
  return s;
}

test('psychosis powder: a T1 magic item — the Antidote is no longer the only one', () => {
  const it = ITEM_BY_ID[ID];
  assert.truthy(it, 'registered');
  assert.eq(it.kind, 'magic');
  assert.falsy(it.potion || it.scroll, 'a powder: neither thrown as a potion nor learnt as a scroll');
  assert.eq(it.baseTier, 1); assert.eq(BASE_TIER[ID], 1);
  assert.gt(PRICES[ID], 0); assert.lt(PRICES[ID], PRICES.sleep_powder, 'priced as the weak T1 trick');
  assert.truthy(ITEM_EFFECTS[ID], 'a description');
  assert.truthy(!('icon' in it), 'no emoji icon field (QC_RULES §1)');
  const t1 = ITEMS.filter(i => i.kind === 'magic' && i.baseTier === 1).map(i => i.id).sort().join(',');
  assert.eq(t1, 'antidote,hardworking_potion,psychosis_powder', 'the T1 magic items');
  // The green mortar on the potion sheet (row 0), a frame of its own.
  const src = MINERAL_ICON_SHEET[ID];
  assert.eq(src.sheet, MINERAL_ICON_SHEET.sleep_powder.sheet, 'the potion sheet, like the sleep dust');
  assert.eq(src.frame, 1);
  assert.falsy(Object.entries(MINERAL_ICON_SHEET).some(([id, r]) => id !== ID && r.sheet === src.sheet && r.frame === src.frame),
    'a frame no other item uses');
  assert.eq(inventoryIconSource(ID).frame, 1, 'inventory resolves the art');
});

test('psychosis powder: the first Magic shop and the combat chests hand it out', () => {
  assert.includes(Shops.themedStock('potion', 1), ID, 'T1 magic shop stocks it beside the Antidote');
  const pool = ChestThemes.resolve('combatMagic', 1, { theme: 'authority' });
  assert.includes(ChestThemes.selectableIds(pool), ID, 'a T1 combat-magic chest can hold it');
  assert.truthy(Object.values(ITEMS_BY_CLASS_TIER).some(p => (p[1] || []).includes(ID)), 'a T1 roll of the generic loot classes');
});

test('psychosis powder: the action row, its duration and the app constant', () => {
  const row = CONSUMABLE_SPEC[ID];
  assert.truthy(row, 'a CONSUMABLE_SPEC row');
  assert.eq(row.verb, 'Use'); assert.truthy(SCENE_SRC.includes(`\n  ${ID}: { noun:`), 'a CAST_ROWS row');
  assert.eq(row.durationMs, 10 * 1000, 'ten seconds');
  assert.truthy(/^Scatter the .*\?$/.test(row.title), 'the confirm title');
  assert.eq(ITEM_EFFECTS[ID], row.get, 'the description is the outcome line');
  assert.truthy(/psychosis_powder: [\s\S]*?Combat\.applyPsychosis\(c, CONSUMABLE_SPEC\.psychosis_powder\.durationMs, now\)/.test(app),
    'the cast reads the row\'s duration');
});

test('psychosis: Combat.applyPsychosis is fear\'s shape — hostile only, drops the wind-up, turns now', () => {
  const now = 50000;
  const c = { id: 'g', kind: 'goblin', x: 3, y: 4, _attackWindupUntil: 999, _moving: true, _targetX: 50, _nextChooseT: now + 4000 };
  assert.falsy(Combat.isPsychotic(c, now));
  assert.truthy(Combat.applyPsychosis(c, 10000, now));
  assert.truthy(Combat.isPsychotic(c, now + 9999));
  assert.falsy(Combat.isPsychotic(c, now + 10000), 'exactly the duration');
  assert.eq(c._attackWindupUntil, null); assert.falsy(c._moving); assert.eq(c._targetX, c.x);
  assert.eq(c._nextChooseT, now, 'turns now rather than finishing a hop at the player');
  assert.truthy(Combat.isEnemy(c), 'still hostile — it is mad, not charmed');
  assert.eq(c._statusPop?.label, Combat.STATUS_LOOKS.psychosis.label, 'announces itself');
  assert.falsy(Combat.applyPsychosis({ id: 'released_pet', kind: 'slime' }, 10000, now), 'never a pet');
  assert.falsy(Combat.applyPsychosis({ id: 'cow', kind: 'cow' }, 10000, now), 'never game');
  // A cleansing (Antidote thrown, Potion of Time) clears it with the rest.
  PotionEffects.clearDebuffs(c);
  assert.falsy(Combat.isPsychotic(c, now));
});

test('psychosis powder: use takes every foe on screen, spends once, and is kept when nobody is in sight', () => {
  const enemy = { id: 'enemy', kind: 'goblin', x: 80, y: 80 };
  const guard = { id: 'guard', kind: 'goblin', lair: 'ruin', x: 20, y: 20 };
  const creatures = [enemy, guard,
    { id: 'offscreen', kind: 'goblin', x: 101, y: 20 },
    { id: 'caught', kind: 'goblin', x: 20, y: 20 },
    { id: 'crow', kind: 'crow', x: 20, y: 20 },
    { id: 'released_pet', kind: 'slime', x: 20, y: 20 }];
  const s = scene(creatures);
  s.save.caught = ['caught'];
  const before = performance.now();
  assert.eq(s.usePsychosisPowder(), true);
  assert.eq(s.save.inv[0].count, 1); assert.eq(s.persisted, 1); assert.eq(s.rebuilt, 1);
  assert.falsy(s.save.usedScrolls, 'a powder teaches no scroll');
  for (const c of [enemy, guard]) {
    assert.truthy(c._psychosisUntilT >= before + CONSUMABLE_SPEC[ID].durationMs, `${c.id}: mad`);
  }
  for (const c of creatures.slice(2)) assert.falsy(c._psychosisUntilT, `${c.id}: untouched`);
  assert.eq(s.loot.length, 1, 'one loot flash');
  assert.eq(s.loot[0][1], Combat.STATUS_LOOKS.psychosis.color, 'in the status\'s own ink');
  assert.truthy(s.loot[0][0].includes(shortDuration(CONSUMABLE_SPEC[ID].durationMs)), 'says the wait');
  const none = scene([{ id: 'far', kind: 'goblin', x: 200, y: 200 }]);
  assert.eq(none.usePsychosisPowder(), false);
  assert.eq(none.save.inv[0].count, 2); assert.eq(none.persisted, 0);
  for (const invalid of ['downed', 'wrong', 'empty']) {
    const c = { id: 'enemy', kind: 'goblin', x: 20, y: 20 };
    const t = scene([c]);
    if (invalid === 'downed') t.save.energy = 0;
    if (invalid === 'wrong') t.save.inv[0].id = 'wood';
    if (invalid === 'empty') t.save.inv[0].count = 0;
    assert.eq(t.usePsychosisPowder(), false, invalid);
    assert.eq(t.persisted, 0); assert.falsy(c._psychosisUntilT);
  }
});

test('psychosis: one more reason in the rout lane of wanderCreatures, with a random angle (source pins)', () => {
  const w = app;
  assert.truthy(/const psychotic = enemy && Combat\.isPsychotic\(c, now\);/.test(w), 'read once per tick, beside fear');
  assert.truthy(/const frightened = enemy && Combat\.isFrightened\(c, now\);/.test(w), 'fear through the same table');
  assert.truthy(/const routed = warded \|\| wanderOff \|\| sated \|\| frightened \|\| psychotic;/.test(w), 'it runs at the rout pace');
  assert.truthy(/const standDown = frightened \|\| psychotic \|\| warded/.test(w), 'it lands no blow, shoots nothing, lays nothing');
  assert.truthy(/const lairState = c\.lair && !frightened && !psychotic \? Lairs\.guardState\(/.test(w), 'a mad guard is not holding its seat');
  assert.truthy(/if \(c\.immobile && !frightened && !psychotic && lairState/.test(w), 'and an immobile one still runs about');
  // The roster mover (every foe's) rolls the random heading inside its routed
  // branch: below the ward (Home still drives it out — `_wardFrom` wins).
  assert.truthy(/if \(!c\._wardFrom && Combat\.isPsychotic\(c, now\)\) \{[\s\S]{0,300}?c\._madAngle = Math\.random\(\) \* Math\.PI \* 2;/.test(CREATURE_AI_SRC), 'rosterEnemyMove: mad, and not warded — a fresh random heading');
  assert.truthy(/if \(!charmed && \(c\._fearUntilT > now \|\| Combat\.isPsychotic\(c, now\)\)\) return false;/.test(CREATURE_AI_SRC),
    'flowerCreatureTick hands a mad foe to the ordinary lanes like a frightened one');
});

test('psychosis: a mad roster foe runs a random heading, re-rolled, and never at the player', () => {
  const s = Object.assign(new SceneFire(), { cellM: 7, tileEdgeM: 224, startWorldM: { x: 0, y: 0 }, originPx: { x: 0, y: 0 },
    mPerPx: 7, cellsPerTile: WorldGen.TILE_PX, depth: 2, save: { energy: 100, caught: [], armor: {} },
    cellAt: () => ({ loaded: true, type: WorldGen.T.CAVE_FLOOR }),
    _cellBlocked: () => false, _nearAny: () => false, isUnnoticed: () => false, _shots: [], hits: [],
    _losePlayerEnergy(n) { this.save.energy -= n; return n; },
    _damageEnemy(c, n, source, opts) { this.hits.push({ c, n, source }); Combat.damage(c, n, opts); return Combat.hp(c) <= 0; } });
  const row = EnemyRoster.get('goblin');
  const c = { id: 'mad', kind: 'goblin', x: 0, y: 0 };
  const realRandom = Math.random;
  const headings = [0, Math.PI / 2];   // east, then south
  let draws = 0;
  Math.random = () => headings[Math.min(draws++, headings.length - 1)] / (Math.PI * 2);
  try {
    const now = 10000;
    Combat.applyPsychosis(c, 10000, now);
    // The player stands WEST; a hunting goblin would walk at them. Mad and
    // routed, it takes the rolled heading instead: east first…
    rosterEnemyMove(s, c, row, now, -50, 0, true, true, null, 0.1);
    assert.gt(c.x, 0, 'first heading: east, away from nothing in particular');
    assert.inRange(c.y, -1e-9, 1e-9);
    const x1 = c.x;
    rosterEnemyMove(s, c, row, now + 100, -50, 0, true, true, null, 0.1);
    assert.gt(c.x, x1, 'the heading holds between re-rolls');
    assert.eq(draws, 1, 'one roll so far');
    // …then, once PSYCHOSIS_TURN_MS has passed, a fresh roll: south.
    rosterEnemyMove(s, c, row, now + 1000, -50, 0, true, true, null, 0.1);
    assert.eq(draws, 2, 're-rolled');
    assert.gt(c.y, 0, 'second heading: south');
    // It lands no blow while mad (standDown passes `inactive`).
    rosterEnemyAttack(s, c, row, now, c.x + 1, c.y, true, 0.1);
    rosterEnemyAttack(s, c, row, now + row.windupSeconds * 1000 + 1, c.x + 1, c.y, true, 0.1);
    assert.eq(s.save.energy, 100); assert.eq(s._shots.length, 0);
    // Expired, the ordinary mover is back: it walks at the player again.
    const then = now + 20000;
    const bx = c.x;
    rosterEnemyMove(s, c, row, then, -50, c.y, false, false, null, 0.1);
    assert.lt(c.x, bx, 'sane again: at the player');
  } finally { Math.random = realRandom; }
});
})();
