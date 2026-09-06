// What an item DOES is written on the item, not in the Book.
//
// The game has four description surfaces, and the player reads every one of
// them while HOLDING the thing, exactly when the answer is wanted:
//
//   ITEM_EFFECTS[id]          the "✦ …" line under the selected stack
//   RELIC_DEFS[slot].blurb    the same line for a relic, and the Stats panel row
//   the Eat button            "Eat +150⚡" for a food
//   the Stats panel           "+N max energy" for an armour slot
//
// PLAY_TIPS is not one of them. A Book is a consumable: spending one to be
// told what the inventory bar was already showing is a wasted read, and the
// two copies drift — until Sep 2026 a THIRD of the list was that. The Rope
// tip and ITEM_EFFECTS.rope said the same sentence twice; the Hoe tip was its
// blurb reworded ("cheaper tilling, sometimes free"); one tip explained what a
// Book does, which you could only read by burning a Book. And the drift was
// real: the Bow/Staff tip still said "one shot a second" long after
// Combat.FIRE_INTERVAL_MS was halved to 2000, and the tool tip still said a
// Wood relic was "three times quicker" after TOOL_DURATION_MS[1] moved
// 3000 → 4000 ms (it is 2.25×).
//
// So: a tip carries knowledge no single item can — where things grow, how a
// shop or a gate behaves, what an animal wants, what a readout means, a riddle
// — and the moment a tip and a description overlap, the description wins.
//
// The sweep below is the tripwire. It is deliberately word-overlap rather than
// a name ban: a tip may NAME an item ("Cows can't resist a ripe pairy", the
// sapphire riddle) as long as it isn't restating that item's effect line.

(function () {
const src = ITEMS_JS_SRC;

// Words that carry no meaning for the overlap measure, plus a crude plural
// stem so "cows" and "cow" count as the same word.
const STOP = new Set(('a an the and or of to in on at for it its is are be you your with '
  + 'from by one any every all this that not no never only also more most as into per '
  + 'when while then than they them their he she his her but so if up down out over under '
  + 'each other some what which who how why where new now here there').split(' '));
const words = (s) => (s.toLowerCase().match(/[a-z⚡]+/g) || [])
  .filter((w) => w.length > 2 && !STOP.has(w))
  .map((w) => w.replace(/s$/, ''));

// Every description line, keyed by what it describes.
const descriptions = () => [
  ...Object.entries(ITEM_EFFECTS).map(([k, v]) => [`ITEM_EFFECTS.${k}`, v]),
  ...Object.entries(RELIC_DEFS).map(([k, d]) => [`RELIC_DEFS.${k}.blurb`, d.blurb || '']),
].filter(([, v]) => v);

// How many distinct meaningful words a tip shares with a description. Three is
// the line: the tips that survive the prune peak at two (an animal tip that
// names a food, the sapphire riddle), and every tip removed in the Sep 2026
// pass scores 3-5 against the line that took its job.
const OVERLAP_MAX = 2;
const overlap = (tip, desc) => {
  const tw = new Set(words(tip));
  return new Set(words(desc).filter((w) => tw.has(w))).size;
};

test('tips: no Book tip restates an item or relic description', () => {
  const descs = descriptions();
  for (const tip of PLAY_TIPS) {
    for (const [key, desc] of descs) {
      const n = overlap(tip, desc);
      assert.lte(n, OVERLAP_MAX,
        `tip overlaps ${key} on ${n} words — the description owns this, drop the tip:\n` +
        `    tip:  ${tip}\n    desc: ${desc}`);
    }
  }
});

test('tips: the sweep actually catches a restatement', () => {
  // The real removed tips, against the real lines that took their job. If this
  // stops failing, the measure above has gone blind and the test above is
  // passing for the wrong reason.
  const cases = [
    ['A Hoe makes tilling cheaper — and, now and then, free.', RELIC_DEFS.hoe.blurb],
    ['A Rope goes both ways: use one to climb up a level or lower yourself down one, right where you stand.',
     ITEM_EFFECTS.rope],
    ['Rainberry waters every crop within 20m when you eat it.', ITEM_EFFECTS.rainberry],
    ['An Amulet powers the stick: higher tier walks you off the GPS faster, for less stamina.',
     RELIC_DEFS.amulet.blurb],
    ['Set out a jar of Honey to draw every chicken and cow within 30m toward you.', ITEM_EFFECTS.honey],
    ['Eat a Pairy to point the way to the nearest undiscovered chest for 5 minutes.', ITEM_EFFECTS.pairy],
  ];
  for (const [tip, desc] of cases) {
    assert.gt(overlap(tip, desc), OVERLAP_MAX, `the sweep must catch: ${tip.slice(0, 50)}…`);
  }
});

test('tips: no tip explains a Book, a Potion or a Rope — their own lines do', () => {
  // The self-referential class: a tip you can only read by spending the very
  // item it describes.
  for (const tip of PLAY_TIPS) {
    assert.falsy(/\bBook\b/.test(tip), 'a Book tip explaining Books: ' + tip);
    assert.falsy(/\bRope\b/.test(tip), 'the Rope is described by ITEM_EFFECTS.rope: ' + tip);
    assert.falsy(/\bPotions? (run|last)\b/.test(tip), 'potion durations are on each potion: ' + tip);
  }
});

// ── The facts the deleted tips were carrying landed on the items ──────────
test('items: every fact moved off a tip is readable on the thing itself', () => {
  // Placeables that look like plain sell-value in the bag.
  assert.truthy(/fence/i.test(ITEM_EFFECTS.rock || ''), 'rock says it drops a stone fence');
  assert.truthy(/campfire/i.test(ITEM_EFFECTS.coal || ''), 'coal says it burns into a campfire');
  // Caveats that had no other home.
  assert.truthy(/monster/i.test(ITEM_EFFECTS.mango || ''),
    'the mango names the cave-monster exception');
  assert.truthy(/30m/.test(ITEM_EFFECTS.honey || ''), 'the honey names its radius');
  // The weapons: their blurb is now the WHOLE disclosure, so it has to carry
  // how each one aims and what the staff charges.
  assert.truthy(/compass/i.test(RELIC_DEFS.bow.blurb), 'the bow says it aims by the compass');
  assert.truthy(/seek|nearest/i.test(RELIC_DEFS.staff.blurb), 'the staff says it seeks');
  assert.truthy(/⚡/.test(RELIC_DEFS.staff.blurb), 'the staff says a bolt costs energy');
  assert.truthy(/seed/i.test(RELIC_DEFS.can.blurb), 'the can says it yields bonus seeds');
  assert.truthy(/refill|water/i.test(RELIC_DEFS.can.blurb), 'and that it refills at water');
});

// ── The two survivors that had gone stale ─────────────────────────────────
test('tips: the surviving claims still match the code', () => {
  const tool = PLAY_TIPS.find((t) => /bare-handed/.test(t) && /Wood relic/.test(t));
  assert.truthy(tool, 'the tool-ladder tip is still there');
  // toolDurationMs: no relic = 9000 ms, wood = TOOL_DURATION_MS[1], frost = [7].
  const wood = Math.round(9000 / TOOL_DURATION_MS[1] * 100) / 100;
  const frost = Math.round(9000 / TOOL_DURATION_MS[7]);
  assert.eq(wood, 2.25, 'wood is 2.25× bare hands — if this moved, the tip has to');
  assert.eq(frost, 30, 'frost is 30×');
  assert.falsy(/three times/.test(tool), 'the stale 3× (wood was 3000 ms) is gone');
  assert.truthy(new RegExp(`${frost}`).test(tool) || /thirty/.test(tool), 'the tip says thirty');

  // Enemy health is a BAR above the crown; the ring is the work wheel, and
  // telling the two apart is the whole point of the two shapes.
  const health = PLAY_TIPS.find((t) => /health, not a timer/.test(t));
  assert.truthy(health, 'the health-readout tip is still there');
  assert.truthy(/\bbar\b/.test(health), 'it calls the readout a bar');
  assert.falsy(/\bring\b/.test(health), 'never a ring again');
});

test('tips: the source comment tells the next author where a description goes', () => {
  const m = src.match(/\/\/ === Book of Tips =+\n([\s\S]*?)\nconst PLAY_TIPS = \[/);
  assert.truthy(m, 'the Book of Tips header comment is still there');
  const note = m[1];
  assert.truthy(/ITEM_EFFECTS/.test(note) && /RELIC_DEFS/.test(note),
    'it names both description tables');
  assert.truthy(/does not|NOT/i.test(note), 'and says what does not belong in the list');
});
})();
