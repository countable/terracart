// The register of the lines a player actually reads.
//
// The game speaks in two voices and only one of them is on purpose. The
// written one is in-world and punctuated — "Already carry a finer one.",
// "The wizard nods — your sight already spans the world.", "Anvil's resting,
// friend." The other is a debug register that leaked out of the code: bare
// lowercase fragments, colon-separated key/value pairs, and raw internal ids
// printed straight to the screen.
//
// Three of those had shipped:
//   • `occupied: ${blocker}` — a key/value line whose value fell through to
//     `oo.kind`, so a plot could be refused with "occupied: mineralrock".
//   • `planted ${item.grows}` — the raw crop id, beside loot toasts that have
//     resolved names since QC_RULES §4 was written.
//   • 'bag full' and 'Bag full' — one sentence, two casings, two call sites.
//
// These pin the rules, not the sentences, so the copy stays free to be
// reworded and cannot slide back.

(function () {

// ── Names, never ids ────────────────────────────────────────────────────────

test('copy: cropName resolves an id to the name the catalog gives it', () => {
  assert.eq(cropName('rainberry'), ITEM_BY_ID.rainberry.name, 'a catalog item by its name');
  assert.eq(cropName('pairy'), ITEM_BY_ID.pairy.name, 'and another');
  // The fallback still has to read as English, not as a column.
  assert.eq(cropName('mystery_thing'), 'Mystery Thing', 'an unknown id is title-cased, not printed raw');
  assert.eq(cropName(null), 'Something', 'and a missing one still forms a sentence');
  assert.falsy(/_/.test(cropName('mystery_thing')), 'no underscore ever reaches the screen');
});

test('copy: the till refusal names the obstacle and, where there is one, the verb', () => {
  // A tree can be felled and a rock broken, so the line says so — that is the
  // half the old "occupied: tree" was missing, and the reason a player could
  // not tell a temporary blocker from a permanent one.
  assert.truthy(/fell it/i.test(tillBlockerLine({ kind: 'tree' })), 'a tree offers the verb');
  assert.truthy(/break it/i.test(tillBlockerLine({ kind: 'mineralrock' })), 'a rock offers the verb');
  // A house cannot be cleared, and offers no verb rather than a false hope.
  const house = tillBlockerLine({ kind: 'house' });
  assert.falsy(/first/i.test(house), 'a building promises no way to clear it');
  // A named chest keeps its rustic name; an unnamed one still reads as English.
  assert.truthy(/Scriptorium/.test(tillBlockerLine({ kind: 'chest', name: 'Library' })),
    'a named chest is named, through rusticifyName');
  assert.truthy(/chest/i.test(tillBlockerLine({ kind: 'chest' })), 'an unnamed one says what it is');
  // The catch-all is the point: ANY kind reaches a sentence, so a new object
  // kind can never print its own identifier at a player again.
  const unknown = tillBlockerLine({ kind: 'some_new_kind' });
  assert.falsy(/_/.test(unknown), 'an unregistered kind is not printed raw: ' + unknown);
  assert.truthy(/^[A-Z].*\.$/.test(unknown), 'and still forms a sentence: ' + unknown);
});

test('copy: no till refusal is a key/value debug line any more', () => {
  // Matched at the CALL SITE — the comment above the rewrite quotes the old
  // line to explain what it replaced, and a bare substring sweep would hit it.
  assert.falsy(/flash\(`occupied:/.test(INTERACT_SRC), 'nothing flashes the `occupied:` register');
  for (const kind of ['tree', 'mineralrock', 'house', 'staircase', 'shrine', 'chest']) {
    const line = tillBlockerLine({ kind });
    assert.falsy(/:/.test(line), `${kind} refusal carries no colon: ${line}`);
    assert.truthy(/^[A-Z]/.test(line) && /\.$/.test(line), `${kind} refusal is a sentence: ${line}`);
  }
});

test('copy: the plant flash says the crop by name, and what it needs next', () => {
  assert.falsy(/planted \$\{item\.grows\}/.test(INTERACT_SRC), 'the raw-id plant flash is gone');
  assert.truthy(/cropName\(item\.grows\)/.test(INTERACT_SRC), 'it resolves the name instead');
  // A seed does nothing until its first watering — the flash is the one moment
  // the player is looking at the cell, so it is where that belongs.
  assert.truthy(/Planted \$\{cropName\(item\.grows\)\} — water it\./.test(INTERACT_SRC),
    'and the line nudges the watering the crop is waiting on');
});

// ── One message, one wording ────────────────────────────────────────────────

test('copy: "bag full" is one line raised from both call sites', () => {
  assert.truthy(/const BAG_FULL_MSG = '[^']+';/.test(APP_JS_SRC), 'app.js owns one constant');
  assert.eq((APP_JS_SRC.match(/BAG_FULL_MSG/g) || []).length, 3,
    'declared once, used at both the drop and the buy refusal');
  assert.falsy(/flash\('bag full'/i.test(APP_JS_SRC), 'neither casing survives as a literal');
  const msg = APP_JS_SRC.match(/const BAG_FULL_MSG = '([^']+)';/)[1];
  assert.truthy(/bag/i.test(msg) && /\.$/.test(msg), 'it is a sentence about the bag: ' + msg);
});

// ── Refusals: the register, and the way out ─────────────────────────────────
// A refusal is the line a player reads most, and it has one job beyond saying
// no: telling them what would make it a yes. These were the last of the
// lowercase debug fragments — 'too tired', 'no deal', 'nobody home', 'not
// enough to smelt' — and three of the four named the state and stopped there.

test('copy: the out-of-energy refusal is one line, and it names the remedy', () => {
  assert.truthy(/const TOO_TIRED_MSG = '[^']+';/.test(APP_JS_SRC), 'app.js owns one constant');
  // Declared once, used at all three refusal sites (the stick, the cave dig,
  // and the shared spendEnergy gate).
  assert.eq((APP_JS_SRC.match(/TOO_TIRED_MSG/g) || []).length, 4,
    'one declaration, three call sites');
  assert.falsy(/flash\('too tired'/.test(APP_JS_SRC), 'the bare fragment is gone');
  const msg = APP_JS_SRC.match(/const TOO_TIRED_MSG = '([^']+)';/)[1];
  assert.truthy(/^[A-Z]/.test(msg) && /\.$/.test(msg), 'it is a sentence: ' + msg);
  // Energy comes back three ways (eat / Home / a campfire) and the line has to
  // point at them, or the player is told to solve a problem they cannot see.
  assert.truthy(/eat/i.test(msg) && /rest/i.test(msg), 'and it names the way out: ' + msg);
});

test('copy: a shop with nothing to offer says WHEN, not just no', () => {
  // shortDuration's rule: a wait the player can read gets a number. The
  // blacksmith's own version of this line has quoted shopWaitLabel for a
  // while; the storefront and the trader said a bare 'no deal'.
  assert.falsy(/flash\('no deal'/.test(APP_JS_SRC), 'the bare fragment is gone');
  const waits = APP_JS_SRC.match(/Come back \$\{this\.shopWaitLabel\(house\)\}/g) || [];
  assert.eq(waits.length, 2, 'both the storefront and the trader now name the wait');
});

test('copy: a short smelt names the ingredient and the shortfall', () => {
  assert.falsy(/flash\('not enough to smelt'/.test(APP_JS_SRC), 'the bare fragment is gone');
  assert.truthy(/const missing = recipe\.find\(r => heldCount\(r\.id\) < r\.qty \* q\);/.test(APP_JS_SRC),
    'it finds which ingredient is short');
  assert.truthy(/Need \$\{short\} more \$\{name\} to smelt that\./.test(APP_JS_SRC),
    'and says how many more of it are wanted');
});

test('copy: no player-facing refusal is a bare lowercase fragment', () => {
  // The sweep that keeps the register from regrowing. A flash whose literal
  // starts lowercase and carries no interpolation is the shape every one of
  // these bugs took.
  const bad = [];
  for (const m of APP_JS_SRC.matchAll(/this\.flash\('([a-z][^']{4,})'/g)) {
    const msg = m[1];
    // Debug/diagnostic lines are not player copy — they are behind __TEST_MODE
    // or the tap-diagnostics flag and read like the tools they are.
    if (/^(cycle reset|following the white arrow|no individual trees|loading)/.test(msg)) continue;
    bad.push(msg);
  }
  assert.eq(bad.length, 0, 'lowercase fragments left in player copy: ' + bad.join(' | '));
});

// ── Flavour prose does not quote relic tiers ────────────────────────────────

test('copy: a consumable dialog reads as a sensation, not a stat line', () => {
  // The powders and the Torch were written this way; the potions lagged, and
  // two of them had a relic TIER in the middle of the prose ("tier-9 amulet
  // walking for one minute") — a number that already lives on the potion's own
  // ✦ line, where a player reads it while holding the flask.
  const bodies = APP_JS_SRC.match(/_finishConsumable\(\s*[\s\S]{0,400}?\);/g) || [];
  assert.gt(bodies.length, 6, 'the consumable dialogs are still findable');
  for (const b of bodies) {
    assert.falsy(/tier-\d+ amulet/i.test(b), 'no dialog quotes a relic tier: ' + b.slice(0, 90));
  }
  // The effect lines are where the numbers belong, and they still carry them.
  assert.truthy(/tier-9 amulet/.test(ITEM_EFFECTS.speed_potion),
    'the speed potion still states its tier where the player can re-read it');
});
})();
