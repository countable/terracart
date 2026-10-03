// THE THREE OTHER POWDERS.
//
// The Dragon Powder is the red heap on the potion sheet's powder row; the
// green, purple and blue heaps beside it are the Growth, Shadow and Frost
// Powders — three consumables used through the same Use button and confirm
// dialog:
//
//   Growth  — every crop within 20 m springs ahead ONE stage on the spot,
//             watered or not. The crop model stays in crops.js
//             (Crops.advanceWithin); app.js only supplies the player's point.
//             Refused, and kept, when no unripe crop is in range.
//   Shadow  — for three minutes (3 × MINUTE_MS) no hostile takes an interest in the
//             player: wanderCreatures gates BOTH the pursuit (the slime's
//             meander and the monsters' stalk) and the hit (the leech and the
//             monster drain) on one `shadowed` read of isShadowActive() —
//             ORed once per tick into `unnoticed` with the OTHER way a player
//             stops being there to hunt, a bar run to zero
//             (downed_pursuit.test.js). The
//             player's own weapons are quiet for the spell too: startCombat
//             refuses (a tap is told with a flash, the auto-engage is silent),
//             the bow/staff cadence re-arms without loosing, and the powder
//             breaks off a wheel already running. The spell is in memory only
//             and its readout is shortDuration, like the dragon's.
//   Frost   — every ENEMY (Combat.isEnemy, never game or a pet) standing in
//             reach (cellInReach — the lit plateau the tap gate accepts) gets
//             c._frozenUntil 30 s out; wanderCreatures skips a frozen creature
//             before its hit and its step, and render.js tints it ice.
//             Refused, and kept, when nothing hostile is in reach.
//
// app.js needs Phaser, so its side is pinned as source text, in the style of
// rope.test.js. The crop helper is exercised for real.

(function () {
// wanderCreatures is the SceneCreatures mixin's (scene_creatures.js); the
// powders themselves are app.js's. Pinned across both.
const app = SCENE_SRC;
const POWDERS = {
  growth_powder: { tier: 2, price: 60,  frame: 6, method: 'useGrowthPowder' },
  shadow_powder: { tier: 2, price: 110, frame: 8, method: 'useShadowPowder' },
  frost_powder:  { tier: 3, price: 100, frame: 9, method: 'useFrostPowder'  },
};
const methodBody = (name) => {
  const sig = name.includes('(') ? name + ') {' : name + '() {';
  const a = app.indexOf('\n  ' + sig + '\n');
  assert.truthy(a > 0, `${name}() exists`);
  return app.slice(a + sig.length + 4, app.indexOf('\n  }\n', a));
};

// ── Registry ────────────────────────────────────────────────────────────────
test('powders: three consumables with tiers, prices, effect lines and a Book tip', () => {
  for (const [id, want] of Object.entries(POWDERS)) {
    const it = ITEM_BY_ID[id];
    assert.truthy(it, `${id} is registered`);
    assert.eq(it.kind, 'magic', `${id}: kind — the Use button and the rarity class key off it`);
    assert.eq(it.baseTier, want.tier, `${id}: baseTier`);
    assert.eq(BASE_TIER[id], want.tier, `${id}: BASE_TIER row`);
    assert.eq(PRICES[id], want.price, `${id}: price`);
    assert.truthy(ITEM_EFFECTS[id], `${id}: an item description`);
    assert.truthy(!('icon' in it), `${id}: no emoji icon field (QC_RULES §1)`);
  }
  assert.truthy(PRICES.growth_powder < PRICES.dragon_powder, 'a T2 utility is cheaper than the T4 dragon');
  // Shadow moved to T2 (it is a way to LEAVE a fight, like the potions);
  // its price stays where its effect is, as the T2 butterfly's does.
  assert.eq(ITEM_BY_ID.shadow_powder.baseTier, ITEM_BY_ID.growth_powder.baseTier,
    'Shadow sits at the potions/Growth tier, not the dragon/Frost one');
  // Each powder's ✦ line is its description; no Book tip restates them.
  assert.falsy(PLAY_TIPS.some(t => /Growth Powder|Shadow Powder|Frost Powder|\bPowders\b/.test(t)),
    'no Book tip restates the powders');
});

test('powders: two-table icon rule — the powder row of Potions.png, each heap its own frame', () => {
  const dragon = MINERAL_ICON_SHEET.dragon_powder;
  const seen = new Set([dragon.frame]);
  for (const [id, want] of Object.entries(POWDERS)) {
    const src = MINERAL_ICON_SHEET[id];
    assert.truthy(src, `MINERAL_ICON_SHEET.${id}`);
    assert.eq(src.sheet, dragon.sheet, `${id}: the same sheet as the dragon`);
    assert.eq(src.frame, want.frame, `${id}: frame`);
    assert.truthy(!seen.has(src.frame), `${id}: a frame no other powder uses`);
    seen.add(src.frame);
    assert.truthy(src.frame !== 5, `${id}: never the EMPTY slot at the head of the row`);
    assert.truthy(Math.floor(src.frame / 5) === 1, `${id}: on the powder row (row 1 of 5 columns)`);
  }
  const row = app.match(new RegExp(`\\n  ${dragon.sheet}:\\s*\\{ url: '([^']+?)(?:\\?v=\\d+)?',\\s*cols: (\\d+),\\s*srcW: (\\d+),\\s*srcH: (\\d+) \\}`));
  assert.truthy(row, `ICON_SHEETS has a '${dragon.sheet}' row`);
  const dims = pngDims(row[1]);
  assert.truthy(dims, `${row[1]} exists and is a PNG`);
  assert.eq(dims.w, Number(row[3]), 'srcW matches the file');
  assert.eq(dims.h, Number(row[4]), 'srcH matches the file');
  assert.eq(Number(row[2]), 5, 'five columns — frame 9 is the last of row 1');
  assert.truthy(dims.h / 16 >= 2, 'the sheet has a row 1 to draw from');
});

test('powders: the rarity picker can hand each one out', () => {
  function seeded(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const seen = { growth_powder: 0, shadow_powder: 0, frost_powder: 0 };
  for (let s = 1; s <= 1500; s++) {
    for (const tier of [2, 3]) {
      const r = pickReward('chest:civic', { relics: {}, armor: {} }, seeded(s * 7 + tier), { tier, depth: 1 });
      if (r && r.kind === 'item' && seen[r.id] != null) seen[r.id]++;
    }
  }
  for (const id of Object.keys(seen)) assert.truthy(seen[id] > 0, `${id} rolled at least once`);
});

// ── The Use button ─────────────────────────────────────────────────────────
test('powders: each has a CONSUMABLE_SPEC action row and the method exists', () => {
  for (const [id, want] of Object.entries(POWDERS)) {
    const row = CONSUMABLE_SPEC[id];
    assert.truthy(row, `${id}: a row`);
    assert.eq(row.verb, 'Use', `${id}: Use verb`);
    assert.eq(row.method, want.method, `${id}: method`);
    assert.truthy(/^Use the \w+ Powder\?$/.test(row.title), `${id}: the confirm title`);
    // Shadow is a `buff` row and Frost a CAST_ROWS row (both reached through
    // _useConsumable, guarded by _selectedConsumable there); Growth keeps a
    // method of its own with the same guard.
    if (row.buff) assert.truthy(Buffs.KINDS[row.buff], `${id}: a timed buff row`);
    else if (/_powder: \{ noun:/.test(app) && app.includes(`\n  ${id}: { noun:`)) assert.truthy(true, `${id}: a cast row`);
    else assert.truthy(methodBody(want.method).includes(`this._selectedConsumable('${id}')`), `${want.method}: only a selected ${id}`);
  }
  const use = methodBody('_useTimedBuff(id, { mul = 1, spend = true } = {}'), cast = methodBody('_castOnFoes(id, { damage = CONSUMABLE_SPEC[id]?.damage, spend = true, noun } = {}');
  assert.truthy(/this\._selectedConsumable\(id\)/.test(use) && /this\._selectedConsumable\(id\)/.test(cast), 'the one slot guard, in both lanes');
});

// ── Growth ─────────────────────────────────────────────────────────────────
test('growth: Crops.advanceWithin springs one stage, unwatered, within the radius, ripe untouched', () => {
  const max = Crops.maxStage();
  const save = { planted: [
    { x: 0,  y: 0,  crop: 'carrot', stage: 0, watered_t: 0 },      // dry, in range
    { x: 5,  y: 5,  crop: 'carrot', stage: 1, watered_t: 123 },    // watered, in range — keeps it
    { x: 0,  y: 19, crop: 'carrot', stage: max - 1, watered_t: 9 },// ripens — watering cleared
    { x: 0,  y: 3,  crop: 'carrot', stage: max, watered_t: 0 },    // ripe — untouched
    { x: 30, y: 0,  crop: 'carrot', stage: 0, watered_t: 0 },      // out of range
  ] };
  const n = Crops.advanceWithin(save, 0, 0, 20);
  assert.eq(n, 3, 'three unripe crops in range moved');
  assert.eq(save.planted[0].stage, 1, 'dry crop advanced without water');
  assert.eq(save.planted[0].watered_t, 0, '…and still unwatered');
  assert.eq(save.planted[1].stage, 2, 'watered crop advanced');
  assert.eq(save.planted[1].watered_t, 123, '…keeping its watering (the can\'s jump does not spend it either)');
  assert.eq(save.planted[2].stage, max, 'ripened');
  assert.eq(save.planted[2].watered_t, 0, 'a ripe plant holds no watering');
  assert.eq(save.planted[3].stage, max, 'ripe crop untouched');
  assert.eq(save.planted[4].stage, 0, 'out of range untouched');
  assert.eq(Crops.advanceWithin({ planted: [] }, 0, 0, 20), 0, 'nothing planted → 0');
});

test('growth: useGrowthPowder sweeps advanceCropsWithin(20m) and refuses BEFORE consuming when nothing moved', () => {
  assert.eq(CONSUMABLE_SPEC.growth_powder.radiusM, CONSUMABLE_SPEC.rainberry.radiusM,
    'growth and rainberry share the owned crop radius');
  assert.truthy(/const GROWTH_POWDER_R_M = CONSUMABLE_SPEC\.growth_powder\.radiusM;/.test(app),
    'runtime derives the radius');
  const wrap = app.match(/\n  advanceCropsWithin\(radius\) \{\n([\s\S]*?)\n  \}\n/);
  assert.truthy(wrap, 'advanceCropsWithin beside waterCropsWithin');
  assert.truthy(/Crops\.advanceWithin\(this\.save, pWX, pWY, radius, movedPlants\);/.test(wrap[1]),
    'the crop model stays in crops.js, and reports which plants moved');
  assert.truthy(/for \(const p of movedPlants\) this\._burstAtWorld\('sprout', p\.x, p\.y\);/.test(wrap[1]),
    'leaves over each one — the SAME cue the 15-min tick and the can\'s jump throw');
  const body = methodBody('useGrowthPowder');
  assert.truthy(/const n = this\.advanceCropsWithin\(GROWTH_POWDER_R_M\);/.test(body), 'sweeps the radius');
  const refuseAt = body.indexOf('if (n <= 0) {');
  const consumeAt = body.indexOf('this._consumeSelected();');
  assert.truthy(refuseAt >= 0, 'refuses on zero');
  assert.truthy(body.slice(refuseAt, consumeAt).includes('return false;'), 'the refusal returns before the consume');
  assert.truthy(consumeAt > refuseAt, 'the powder is consumed AFTER the refusal');
  assert.truthy(/sprang ahead/.test(body), 'the flash says the count sprang ahead');
  // THE BLAST: the green ring a street and a wreck already get, off the
  // powder's OWN radius so the flash says how far the scatter reached — not a
  // fourth spelling of "something came good here".
  assert.truthy(/sparks: 'greenspark',/.test(body), 'the shared green ring, not a copy of it');
  assert.truthy(/ringPx: GROWTH_POWDER_R_M \* CELL_PX \/ this\.cellM,/.test(body),
    'thrown off the scatter radius, in px');
  assert.truthy(/radiusCells: GROWTH_POWDER_R_M \/ this\.cellM,/.test(body),
    'and the light flash covers the same ground');
  assert.truthy(body.indexOf('this._blastAt(') < body.indexOf('this._consumeSelected();'),
    'the blast goes off on a use that actually moved something');
});

// ── Shadow ─────────────────────────────────────────────────────────────────
test('shadow: a 3-minute in-memory buff, read out with shortDuration beside the dragon\'s', () => {
  // A `buff` row: _useTimedBuff extends Buffs.KINDS.shadow (this._shadowUntil)
  // by the row's durationMs; its own work is the TIMED_BUFF_HOOKS.shadow hook.
  assert.eq(CONSUMABLE_SPEC.shadow_powder.buff, 'shadow', 'a timed buff row');
  const hooks = app.match(/\nconst TIMED_BUFF_HOOKS = \{[\s\S]*?\n\};/)[0];
  assert.truthy(/shadow: \{ after: \(s\) => \{ if \(s\._workProgress\?\.combat\) s\.cancelWorkProgress\(\); \} \}/.test(hooks),
    'the truce ends the fight you are in: the wheel drops');
  assert.eq(CONSUMABLE_SPEC.shadow_powder.durationMs, 3 * 60 * 1000, 'and that is three minutes');
  assert.falsy(/SHADOW_POWDER_MS/.test(app), 'no duration alias: the row is read at the use');
  const body = methodBody('_useTimedBuff(id, { mul = 1, spend = true } = {}');
  assert.truthy(/Buffs\.extend\(this\.save, this, buff, spec\.durationMs \* mul\);/.test(body), 'extended through the one writer');
  assert.truthy(/this\._spendScroll\(id\);/.test(body), 'consumed through the shared spend');
  assert.truthy(/isShadowActive\(\) \{\n    return \(this\._shadowUntil \?\? 0\) > Date\.now\(\);/.test(app),
    'isShadowActive reads the timer');
  assert.truthy(!/save\.shadowUntil|save\._shadowUntil|shadowPowderUntil/.test(app), 'never written to the save');
  assert.eq(Buffs.KINDS.shadow.scene, '_shadowUntil', 'its countdown is a chip of the status row under the HUD');
  assert.falsy(/shadowTimerText/.test(app), 'no label of its own');
});

test('shadow: one `unnoticed` read gates BOTH the pursuit and the hit in wanderCreatures', () => {
  const m = app.match(/\n  wanderCreatures\(\) \{\n([\s\S]*?)\n  \}\n/);
  assert.truthy(m, 'wanderCreatures');
  const w = m[1];
  // The powder reaches those four gates through `unnoticed` — the scene's OR of
  // the two wards that make the player not there to be hunted at all
  // (isUnnoticed, downed_pursuit.test.js), read per creature so Moss can
  // distinguish a provoked monster. The same expression fades the body, so a stealthed player LOOKS
  // like what the sim is doing.
  assert.truthy(/const unnoticed = this\.isUnnoticed\(c\);/.test(w), 'read for each creature');
  assert.truthy(/return this\.isShadowActive\(\) \|\| moss \|\|/.test(app),
    'and the powder is one of its two reasons');
  // The hits.
  // Other conjuncts may join these gates (Home's ward does — home_ward.test.js),
  // so pin that !unnoticed is IN the gate, not that it is the whole of it.
  assert.truthy(/rosterEnemyAttack\(this, c, rosterRow, now, px, py, unnoticed \|\| standDown, enemyDt\)/.test(w),
    'every foe\'s leech, blow, arrow and snare is gated');
  // The pursuits: the roster mover is told the same (`inactive`), and a
  // foe that is told so neither sees nor stalks.
  assert.truthy(/\(npcTarget \? NPC\.isDormant\(npcTarget\) : unnoticed\) \|\| standDown,\s*routed \|\| \(kerbTurn && !c\.lair\), lairState, enemyDt\)/.test(w),
    'every foe\'s stalk is gated');
  assert.truthy(/let sees = !inactive && /.test(CREATURE_AI_SRC), 'an inactive foe sees nothing');
  // And the player's own weapons, quiet BOTH ways: the cadence holds its fire
  // (and re-arms, so the first shot flies the instant the shadow lifts), and
  // the ONE lane both swing paths flow through refuses to spin a wheel up.
  const combat = app.match(/\n  _combatTick\(dt\) \{\n([\s\S]*?)\n  \}\n/);
  assert.truthy(combat && /const rangedArmed = !this\.isShadowActive\(\)\n\s*&& Combat\.anyEnemyWithin/.test(combat[1]),
    'the bow/staff cadence stays quiet under the shadow');
  const sc = app.match(/\n  startCombat\(victim, opts = \{\}\) \{\n([\s\S]*?)\n  \}\n/);
  assert.truthy(sc && /if \(this\.isShadowActive\(\)\) \{/.test(sc[1]), 'no melee wheel spins up while shadowed');
  assert.truthy(sc && /if \(!opts\.auto\) \{[\s\S]*?flash\('The shadows hold your arm\.'/.test(sc[1]),
    'a refused tap is told; the auto-engage stays silent');
  assert.truthy(sc && sc[1].indexOf('this.hapticReject') < sc[1].indexOf("this._toolActionStory('sword');"),
    'the gate sits before the story hook the wheel spins up with');
});

// ── Frost ──────────────────────────────────────────────────────────────────
test('frost: chills every Combat.isEnemy in cellInReach for 30 s, refusing BEFORE consuming when none is', () => {
  assert.eq(CONSUMABLE_SPEC.frost_powder.durationMs, 30 * 1000, '30 s');
  assert.falsy(/FROST_POWDER_MS/.test(app), 'no duration alias: the row is read at the cast');
  // A CAST_ROWS row with `scope: 'reach'`, cast by _castOnFoes over _enemiesInReach.
  const a = app.indexOf('  frost_powder: { noun:');
  assert.truthy(a > 0, 'the frost row of CAST_ROWS');
  const row = app.slice(a, app.indexOf('\n};', a));
  const cast = methodBody('_castOnFoes(id, { damage = CONSUMABLE_SPEC[id]?.damage, spend = true, noun } = {}');
  const where = methodBody('_enemiesWhere(where'), reach = methodBody('_enemiesInReach');
  assert.truthy(/Combat\.isEnemy\(c\) && !caught\.has\(c\.id\)/.test(where), 'enemies only — never crow, deer, a pet or a caught one');
  assert.truthy(/scope: 'reach'/.test(row) && /return cellInReach\(this, fc\.cellIX, fc\.cellIY\);/.test(reach)
    && /row\.scope === 'reach'/.test(cast) && /this\._enemiesInReach\(\)/.test(cast),
    'the shipping reach test — the lit plateau the tap gate accepts');
  const refuseAt = cast.indexOf('if (!targets.length) {');
  const consumeAt = cast.indexOf('this._spendScroll(id);');
  assert.truthy(refuseAt >= 0 && consumeAt > refuseAt, 'consumed AFTER the refusal');
  assert.truthy(cast.slice(refuseAt, consumeAt).includes('return false;'), 'the refusal returns');
  assert.truthy(/Combat\.applyFrost\(c, CONSUMABLE_SPEC\.frost_powder\.durationMs, now\)/.test(row),
    'lands the frost status (Combat.applyFrost — a slow, never a pin) for the row\'s 30 s');
  assert.truthy(/chilled for \$\{shortDuration\(CONSUMABLE_SPEC\.frost_powder\.durationMs\)\}/.test(row),
    'the flash says chilled, with shortDuration');
});

test('frost: a chilled creature is SLOWED, never pinned — half pace, half cadence, its tell untouched', () => {
  // FROST IS A SLOW (owner, Oct 2026): the `frozen` row of Combat.STATUS_LOOKS
  // carries `slow`, Combat.paceMul folds it into every speed site and the
  // attack / ability cadence stretches by it; nothing skips the foe's tick.
  const m = app.match(/\n  wanderCreatures\(\) \{\n([\s\S]*?)\n  \}\n/);
  assert.falsy(/_frozenUntil/.test(m[1]), 'no frozen gate in the sim loop');
  const row = Combat.STATUS_LOOKS.frozen;
  assert.eq(row.field, '_frozenUntil'); assert.eq(row.clock, 'wall'); assert.eq(row.slow, 0.5);
  assert.falsy(row.cancels, 'a slow does not interrupt a wind-up');
  const until = Date.now() + 60000;
  const c = { id: 'mon_cold', kind: 'goblin', _frozenUntil: until, _attackWindupUntil: 5000 };
  assert.truthy(Combat.isChilled(c));
  assert.eq(Combat.slowMul(c), 0.5);
  assert.eq(Combat.paceMul(c), 0.5, 'half pace');
  assert.eq(Combat.paceMul({ ...c, shiny: true }), 0.75, 'a shiny chilled: 1.5 × 0.5');
  assert.eq(Combat.paceMul({ kind: 'goblin' }), 1);
  // The cadence: the row's interval over the slow; the wind-up itself as declared.
  const g = EnemyRoster.get('goblin');
  const warm = { id: 'w', kind: 'goblin' }, cold = { id: 'c', kind: 'goblin', _frozenUntil: until };
  enemyAttackReady(warm, g, 10000, true); enemyAttackReady(cold, g, 10000, true);
  assert.eq(warm._attackNextT, 10000 + g.damageIntervalSeconds * 1000);
  assert.eq(cold._attackNextT, 10000 + g.damageIntervalSeconds * 1000 / row.slow, 'a chilled foe attacks half as often');
  assert.eq(cold._attackWindupUntil, warm._attackWindupUntil, 'the tell is as long as ever');
  // Landing it does not cancel what the foe was winding up, and it EXTENDS.
  const d = { id: 'mon_tell', kind: 'goblin', _attackWindupUntil: 7000, _frozenUntil: until + 5000 };
  assert.truthy(Combat.applyFrost(d, 1000));
  assert.eq(d._attackWindupUntil, 7000, 'the wind-up stands');
  assert.eq(d._frozenUntil, until + 5000, 'a shorter chill never cuts a longer one short');
  assert.falsy(Combat.applyFrost({ id: 'released_slime', kind: 'slime' }, 1000), 'never a pet');
  // The roster mover moves a chilled foe at half its pace.
  const s = { cellM: 7, depth: 2, cellAt: () => ({ loaded: true, type: WorldGen.T.CAVE_FLOOR }), _cellBlocked: () => false,
    _nearAny: () => false, isUnnoticed: () => false, save: { energy: 100 }, placedRockSet: null };
  const quick = { id: 'q', kind: 'zombie', x: 0, y: 0 }, slow = { id: 's', kind: 'zombie', x: 0, y: 0, _frozenUntil: until };
  for (const z of [quick, slow]) rosterEnemyMove(s, z, EnemyRoster.get('zombie'), 10000, 20, 0, false, false, null, 0.1);
  assert.gt(slow.x, 0, 'it still moves');
  assert.inRange(slow.x / quick.x, 0.5 - 1e-9, 0.5 + 1e-9, 'at half pace');
  // The ice tint rides the same flag.
  assert.truthy(typeof FROZEN_TINT === 'number' && FROZEN_TINT !== SHINY_TINT, 'FROZEN_TINT is its own colour');
});
})();
