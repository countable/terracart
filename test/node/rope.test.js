// THE ROPE GOES BOTH WAYS.
//
// A Rope is a consumable that moves the player one cave level UP or DOWN, in
// place, and — unlike every other consumable, whose Use dialog is a yes/no —
// its dialog is a CHOICE: Down on the primary button, Up on the secondary,
// with Up greyed on the surface where there is nothing to climb to.
//
// Two things here can only be pinned as text, because app.js needs Phaser:
// the CONSUMABLE row in syncConsumableButton (both directions, both methods)
// and useRope itself (the surface guard, the empty-tank guard, the landing
// cell stamped into dugWalls at the TARGET depth before the move — so a rope
// dropped down the tunnel you just dug never lands you inside the rock the
// next level still has there).
//
// The rest is the item registry: the two-table icon rule (MINERAL_ICON_SHEET
// → ICON_SHEETS → a real PNG at the size the row claims), a price, a tier,
// the effect line under the inventory bar, and a Book tip — and that the
// rarity picker can actually hand one out.

(function () {
const app = APP_JS_SRC;

// ── Registry ────────────────────────────────────────────────────────────────
test('rope: is a T2 consumable with a price and an effect line', () => {
  const it = ITEM_BY_ID.rope;
  assert.truthy(it, 'rope is registered');
  assert.eq(it.kind, 'consumable', 'kind — the Use button and the single-stack rarity class key off it');
  assert.eq(it.baseTier, 2, 'baseTier — T2, beside the potions');
  assert.eq(BASE_TIER.rope, 2, 'BASE_TIER row');
  assert.truthy(PRICES.rope > 0, 'a sell price');
  assert.truthy(PRICES.rope < PRICES.sapphire, 'cheaper than the sapphire, whose portal is one-way');
  // The climb is disclosed ONE place: the rope's own effect line, which the
  // player reads while holding it. It used to be said twice — a Book tip
  // repeated the same sentence — and a Book that restates an item description
  // spends a consumable to print what the inventory bar already showed.
  assert.truthy(/up/i.test(ITEM_EFFECTS.rope || '') && /down/i.test(ITEM_EFFECTS.rope || ''),
    'ITEM_EFFECTS discloses the climb, both ways');
  assert.falsy(PLAY_TIPS.some(t => /\bRope\b/.test(t)),
    'and no Book tip repeats it');
});

test('rope: two-table icon rule — MINERAL_ICON_SHEET → ICON_SHEETS → a real 16×16 PNG', () => {
  const src = MINERAL_ICON_SHEET.rope;
  assert.truthy(src, 'MINERAL_ICON_SHEET.rope');
  assert.eq(src.frame, 0, 'single-frame icon');
  const row = app.match(new RegExp(`\\n  ${src.sheet}:\\s*\\{ url: '([^']+)',\\s*cols: (\\d+),\\s*srcW: (\\d+),\\s*srcH: (\\d+) \\}`));
  assert.truthy(row, `ICON_SHEETS has a '${src.sheet}' row (else the icon falls through to Crops.png)`);
  const dims = pngDims(row[1]);
  assert.truthy(dims, `${row[1]} exists and is a PNG`);
  assert.eq(dims.w, Number(row[3]), 'srcW matches the file');
  assert.eq(dims.h, Number(row[4]), 'srcH matches the file');
  assert.eq(Number(row[2]), 1, 'one column');
});

test('rope: the rarity picker can hand one out of a consumable-heavy chest', () => {
  function seeded(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  let seen = 0;
  for (let s = 1; s <= 600; s++) {
    const r = pickReward('chest:civic', { relics: {}, armor: {} }, seeded(s), { tier: 2 });
    if (r && r.kind === 'item' && r.id === 'rope') seen++;
  }
  assert.truthy(seen > 0, 'rope rolled at least once in 600 T2 civic chests');
});

// ── The dialog is a choice ─────────────────────────────────────────────────
test('rope: the Use dialog offers Down (primary) and Up (secondary), Up greyed on the surface', () => {
  const m = app.match(/\n      rope: \{([\s\S]*?)\},\n    \};/);
  assert.truthy(m, 'a rope row in the CONSUMABLE table');
  const row = m[1];
  assert.truthy(/method: 'useRopeDown'/.test(row), 'primary → useRopeDown');
  assert.truthy(/acceptLabel: 'Down'/.test(row), 'primary button reads Down');
  assert.truthy(/secondary: \{ label: 'Up', method: 'useRopeUp', disabled: \(\) => !\(this\.depth > 0\) \}/.test(row),
    'secondary → useRopeUp, disabled unless underground');
  assert.truthy(/title: 'Use the rope — which way\?'/.test(row), 'the title asks which way');
  // The handler actually threads the row through to the modal.
  assert.truthy(/secondary,\n        onAccept: \(\) => \{ this\[fn\]\(\); this\.syncConsumableButton\(\); \},/.test(app),
    'syncConsumableButton passes `secondary` to showOfferModal');
  assert.truthy(/acceptLabel: entry\.acceptLabel \|\| entry\.verb,/.test(app),
    'the primary label honours acceptLabel');
});

// ── useRope ────────────────────────────────────────────────────────────────
test('rope: useRope moves one level either way and is consumed only once the move happens', () => {
  const m = app.match(/\n  useRope\(delta\) \{\n([\s\S]*?)\n  \}\n  useRopeUp\(\)/);
  assert.truthy(m, 'useRope(delta) exists');
  const body = m[1];
  assert.truthy(/useRopeUp\(\)\s*\{ return this\.useRope\(-1\); \}/.test(app), 'useRopeUp is delta -1');
  assert.truthy(/useRopeDown\(\)\s*\{ return this\.useRope\(\+1\); \}/.test(app), 'useRopeDown is delta +1');
  assert.truthy(/sel\.id !== 'rope'/.test(body), 'only a selected rope');
  assert.truthy(/if \(target < 0\) \{[\s\S]*?return false;/.test(body), 'no climbing up from the surface');
  assert.truthy(/if \(delta > 0 && \(this\.save\.energy \?\? 0\) <= 0\) \{[\s\S]*?return false;/.test(body),
    'no climbing down on an empty tank (the staircase gate)');
  const consumeAt = body.indexOf('consumeSelected(this.save);');
  const moveAt = body.indexOf('this.changeDepth(delta, anchor);');
  const guardAt = body.lastIndexOf('return false;');
  assert.truthy(consumeAt > guardAt, 'the rope is consumed AFTER every refusal');
  assert.truthy(moveAt > consumeAt, '…and before the move');
});

test('rope: the landing cell is stamped into dugWalls at the TARGET depth, before the move', () => {
  const m = app.match(/\n  useRope\(delta\) \{\n([\s\S]*?)\n  \}\n  useRopeUp\(\)/);
  const body = m[1];
  const stamp = body.match(/if \(target > 0\) \{([\s\S]*?)\n    \}/);
  assert.truthy(stamp, 'a target-depth block');
  assert.truthy(/this\.dugWallSet\.add\(`\$\{target\}:\$\{cellKeyFromAbsCell\(/.test(stamp[1]),
    'keyed on the TARGET depth, in digCaveWall\'s own "<depth>:<absIX>_<absIY>" format');
  assert.truthy(/this\.save\.dugWalls = \[\.\.\.this\.dugWallSet\];/.test(stamp[1]), 'persisted with the save');
  assert.truthy(body.indexOf('this.dugWallSet.add(') < body.indexOf('this.changeDepth(delta, anchor);'),
    'stamped before changeDepth, so the ensureTilesAround it triggers re-applies it');
  // And the re-apply really does run on every pass, cached tile or fresh —
  // otherwise a stamp on an already-loaded level would open nothing.
  assert.truthy(/if \(this\.depth > 0\) \{\n\s*this\._applyDugWalls\(entry, tx, ty\);/.test(app),
    '_applyDugWalls runs in the ensureTilesAround loop for every underground tile');
});
})();
