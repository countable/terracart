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
//   Shadow  — for one minute (MINUTE_MS) no hostile takes an interest in the
//             player: wanderCreatures gates BOTH the pursuit (the slime's
//             meander and the monsters' stalk) and the hit (the leech and the
//             monster drain) on one `shadowed` read of isShadowActive(). The
//             player's own weapons are not gated. The minute is in memory only
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
const app = APP_JS_SRC;
const POWDERS = {
  growth_powder: { tier: 2, price: 60,  frame: 6, method: 'useGrowthPowder' },
  shadow_powder: { tier: 3, price: 110, frame: 8, method: 'useShadowPowder' },
  frost_powder:  { tier: 3, price: 100, frame: 9, method: 'useFrostPowder'  },
};
const methodBody = (name) => {
  const m = app.match(new RegExp(`\\n  ${name}\\(\\) \\{\\n([\\s\\S]*?)\\n  \\}\\n`));
  assert.truthy(m, `${name}() exists`);
  return m[1];
};

// ── Registry ────────────────────────────────────────────────────────────────
test('powders: three consumables with tiers, prices, effect lines and a Book tip', () => {
  for (const [id, want] of Object.entries(POWDERS)) {
    const it = ITEM_BY_ID[id];
    assert.truthy(it, `${id} is registered`);
    assert.eq(it.kind, 'consumable', `${id}: kind — the Use button and the rarity class key off it`);
    assert.eq(it.baseTier, want.tier, `${id}: baseTier`);
    assert.eq(BASE_TIER[id], want.tier, `${id}: BASE_TIER row`);
    assert.eq(PRICES[id], want.price, `${id}: price`);
    assert.truthy(/^Use /.test(ITEM_EFFECTS[id] || ''), `${id}: an ITEM_EFFECTS line that starts "Use"`);
    assert.truthy(!('icon' in it), `${id}: no emoji icon field (QC_RULES §1)`);
  }
  assert.truthy(PRICES.growth_powder < PRICES.dragon_powder, 'a T2 utility is cheaper than the T3 dragon');
  assert.truthy(PLAY_TIPS.some(t => /Growth/.test(t) && /Shadow/.test(t) && /Frost/.test(t)),
    'one Book tip covers all three powders');
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
      const r = pickReward('chest:civic', { relics: {}, armor: {} }, seeded(s * 7 + tier), { tier });
      if (r && r.kind === 'item' && seen[r.id] != null) seen[r.id]++;
    }
  }
  for (const id of Object.keys(seen)) assert.truthy(seen[id] > 0, `${id} rolled at least once`);
});

// ── The Use button ─────────────────────────────────────────────────────────
test('powders: each has a CONSUMABLE row (Use verb, its own method) and the method exists', () => {
  const table = app.match(/const CONSUMABLE = \{([\s\S]*?)\n    \};/);
  assert.truthy(table, 'the CONSUMABLE table in syncConsumableButton');
  for (const [id, want] of Object.entries(POWDERS)) {
    const row = table[1].match(new RegExp(`\\n      ${id}:\\s*\\{([^\\n]*)\\}`));
    assert.truthy(row, `${id}: a row`);
    assert.truthy(/verb: 'Use'/.test(row[1]), `${id}: Use verb`);
    assert.truthy(new RegExp(`method: '${want.method}'`).test(row[1]), `${id}: → ${want.method}`);
    assert.truthy(/title: 'Use the \w+ Powder\?'/.test(row[1]), `${id}: the confirm title`);
    const body = methodBody(want.method);
    assert.truthy(new RegExp(`sel\\.id !== '${id}'`).test(body), `${want.method}: only a selected ${id}`);
  }
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
  assert.truthy(/const GROWTH_POWDER_R_M = 20;/.test(app), 'the radius is the rainberry\'s 20 m');
  const wrap = app.match(/\n  advanceCropsWithin\(radius\) \{\n([\s\S]*?)\n  \}\n/);
  assert.truthy(wrap, 'advanceCropsWithin beside waterCropsWithin');
  assert.truthy(/return Crops\.advanceWithin\(this\.save, pWX, pWY, radius\);/.test(wrap[1]),
    'the crop model stays in crops.js');
  const body = methodBody('useGrowthPowder');
  assert.truthy(/const n = this\.advanceCropsWithin\(GROWTH_POWDER_R_M\);/.test(body), 'sweeps the radius');
  const refuseAt = body.indexOf('if (n <= 0) {');
  const consumeAt = body.indexOf('consumeSelected(this.save);');
  assert.truthy(refuseAt >= 0, 'refuses on zero');
  assert.truthy(body.slice(refuseAt, consumeAt).includes('return false;'), 'the refusal returns before the consume');
  assert.truthy(consumeAt > refuseAt, 'the powder is consumed AFTER the refusal');
  assert.truthy(/sprang ahead/.test(body), 'the flash says the count sprang ahead');
});

// ── Shadow ─────────────────────────────────────────────────────────────────
test('shadow: a 1-minute in-memory buff, read out with shortDuration beside the dragon\'s', () => {
  const body = methodBody('useShadowPowder');
  assert.truthy(/this\._shadowUntil = Date\.now\(\) \+ MINUTE_MS;/.test(body), 'one MINUTE_MS on this._shadowUntil');
  assert.truthy(/return this\._finishConsumable\(/.test(body), 'consumed through the shared tail');
  assert.truthy(/isShadowActive\(\) \{\n    return \(this\._shadowUntil \?\? 0\) > Date\.now\(\);/.test(app),
    'isShadowActive reads the timer');
  assert.truthy(!/save\.shadowUntil|save\._shadowUntil|shadowPowderUntil/.test(app), 'never written to the save');
  assert.truthy(/this\.shadowTimerText = this\.add\.text\(/.test(app), 'a countdown label of its own');
  assert.truthy(/this\.shadowTimerText\n\s*\.setText\(shortDuration\(this\._shadowUntil - Date\.now\(\)\)\)/.test(app),
    'the readout goes through shortDuration');
});

test('shadow: one `shadowed` read gates BOTH the pursuit and the hit in wanderCreatures', () => {
  const m = app.match(/\n  wanderCreatures\(\) \{\n([\s\S]*?)\n  \}\n/);
  assert.truthy(m, 'wanderCreatures');
  const w = m[1];
  assert.truthy(/const shadowed = this\.isShadowActive\(\);/.test(w), 'read once per tick');
  // The hits.
  assert.truthy(/if \(c\.kind === 'slime' && !isTame && !shadowed\) \{/.test(w), 'the slime leech is gated');
  assert.truthy(/if \(isMonster\(c\.kind\) && !shadowed\) \{\n\s*const m = MONSTERS\[c\.kind\];/.test(w),
    'the monster drain is gated');
  // The pursuits.
  assert.truthy(/if \(!shadowed && Math\.random\(\) < 0\.5 && distToPlayer > 0\.5 \* this\.cellM\) \{/.test(w),
    'the slime\'s meander toward the player is gated');
  assert.truthy(/if \(!shadowed && distToPlayer > 0\.5 \* this\.cellM\) \{\n\s*angle = Math\.atan2\(dyp, dxp\)/.test(w),
    'the monsters\' stalk is gated');
  // And NOT the player's weapons.
  const combat = app.match(/\n  _combatTick\(dt\) \{\n([\s\S]*?)\n  \}\n/);
  assert.truthy(combat && !/shadow/i.test(combat[1]), 'the sword/bow/staff tick knows nothing of the shadow');
});

// ── Frost ──────────────────────────────────────────────────────────────────
test('frost: freezes every Combat.isEnemy in cellInReach for 30 s, refusing BEFORE consuming when none is', () => {
  assert.truthy(/const FROST_POWDER_MS = 30 \* 1000;/.test(app), '30 s');
  const body = methodBody('useFrostPowder');
  assert.truthy(/if \(!Combat\.isEnemy\(c\)\) return;/.test(body), 'enemies only — never crow, deer or a pet');
  assert.truthy(/caughtSet\.has\(c\.id\)\) return;/.test(body), 'not a caught one');
  assert.truthy(/if \(!cellInReach\(this, fc\.cellIX, fc\.cellIY\)\) return;/.test(body),
    'the shipping reach test — the lit plateau the tap gate accepts');
  const refuseAt = body.indexOf('if (targets.length === 0) {');
  const consumeAt = body.indexOf('consumeSelected(this.save);');
  assert.truthy(refuseAt >= 0 && consumeAt > refuseAt, 'consumed AFTER the refusal');
  assert.truthy(body.slice(refuseAt, consumeAt).includes('return false;'), 'the refusal returns');
  assert.truthy(/c\._frozenUntil = until;/.test(body) && /const until = Date\.now\(\) \+ FROST_POWDER_MS;/.test(body),
    'stamps _frozenUntil = now + 30 s');
  assert.truthy(/c\._startX = c\._targetX = c\.x;/.test(body), 'pins the in-flight hop so the thaw does not snap it on');
  assert.truthy(/shortDuration\(FROST_POWDER_MS\)/.test(body), 'the flash prints the freeze with shortDuration');
});

test('frost: a frozen creature is skipped in the wander step before it can hit or move', () => {
  const m = app.match(/\n  wanderCreatures\(\) \{\n([\s\S]*?)\n  \}\n/);
  const w = m[1];
  const gate = w.indexOf('if (c._frozenUntil != null && Date.now() < c._frozenUntil) return;');
  assert.truthy(gate >= 0, 'the frozen gate');
  assert.truthy(gate < w.indexOf("if (c.kind === 'slime' && !isTame && !shadowed) {"), 'before the slime leech');
  assert.truthy(gate < w.indexOf('if (isMonster(c.kind) && !shadowed) {'), 'before the monster drain');
  assert.truthy(gate < w.indexOf('if (now >= c._nextChooseT) {'), 'before the step is chosen');
  assert.truthy(gate < w.indexOf('c.x = c._startX + (c._targetX - c._startX) * u;'), 'before the hop is interpolated');
  // The ice tint rides the same flag.
  assert.truthy(typeof FROZEN_TINT === 'number' && FROZEN_TINT !== SHINY_TINT, 'FROZEN_TINT is its own colour');
});
})();
