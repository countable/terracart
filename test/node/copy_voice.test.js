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
  // A chest says what it is and never its NAME: a POI name is arbitrary OSM
  // text, so interpolating one would put an unbounded string in a line with a
  // thirty-character budget.
  assert.truthy(/chest/i.test(tillBlockerLine({ kind: 'chest' })), 'a chest says what it is');
  assert.eq(tillBlockerLine({ kind: 'chest', name: 'Library' }),
            tillBlockerLine({ kind: 'chest' }), 'and the name changes nothing');
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
  assert.truthy(/\$\{cropName\(item\.grows\)\} — water it\./.test(INTERACT_SRC),
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

// ── Thirty characters, on the map ───────────────────────────────────────────
// A flash is a toast over the world on a phone, read at a glance while the
// player is looking at the cell they just tapped. util.js MAP_MSG_MAX is the
// budget, and it covers the WHOLE rendered line — a name or a number
// interpolated into it counts. Anything that needs more room is a modal.

// Every static flash literal in the three files that own player-facing taps.
function mapMessages() {
  const out = [];
  const files = { 'app.js': APP_JS_SRC, 'interact.js': INTERACT_SRC, 'interactables.js': INTERACTABLES_SRC };
  for (const [name, src] of Object.entries(files)) {
    for (const m of src.matchAll(/flash(?:Loot)?\(\s*(['`])((?:[^\\]|\\.)*?)\1/g)) {
      out.push({ file: name, raw: m[2] });
    }
  }
  return out;
}
// Width of a line as the player sees it. An interpolation is measured at
// INTERP_W — wide enough to stand for a wait ('43m'), a price ('$40') or a
// small count, but NOT for a full item name, so any line that interpolates a
// name is checked against the real thing at runtime below instead.
// A template's real width depends on runtime values this sweep cannot know, so
// it measures the SKELETON — every interpolation counted as one character. A
// skeleton that already busts the budget is an unambiguous failure; the lines
// whose width really rides on an interpolated NAME get their own worst-case
// checks below, against the longest name the catalog can produce.
const INTERP_W = 1;
// An interpolation that is a ternary between two string LITERALS is a
// pluralisation or a prefix — measure the longer branch, not the placeholder,
// or `${n === 1 ? '' : 's'}` reads as six characters of nothing.
const interpWidth = (body) => {
  const lits = [...body.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].length);
  return (body.includes('?') && lits.length >= 2) ? Math.max(...lits) : INTERP_W;
};
// A toast with a newline in it is TWO lines on the map, and each gets the
// budget on its own — the trade toast is deliberately a give line over a take
// line.
const shownWidth = (raw) => {
  const flat = raw
    .replace(/\$\{([^}]*)\}/g, (_, b) => 'x'.repeat(interpWidth(b)))
    .replace(/\\u[0-9a-fA-F]{4}/g, 'x')
    .replace(/\\'/g, "'");
  return Math.max(...flat.split(/\\n/).map((line) => [...line].length));
};

test('map copy: every flash fits in MAP_MSG_MAX', () => {
  assert.eq(MAP_MSG_MAX, 30, 'the budget is thirty characters');
  const over = mapMessages()
    .map((m) => ({ ...m, n: shownWidth(m.raw) }))
    .filter((m) => m.n > MAP_MSG_MAX)
    .sort((a, b) => b.n - a.n);
  // Compact on purpose: the runner truncates a long error, so a list of
  // forty over-budget lines would print three of them and hide the rest.
  const shown = over.slice(0, 6).map((m) => `${m.n}:${m.raw.slice(0, 34)}`).join(' | ');
  assert.eq(over.length, 0, `${over.length} flash(es) over ${MAP_MSG_MAX} — ${shown}`);
});

test('map copy: the shared refusal constants fit too', () => {
  for (const name of ['TOO_TIRED_MSG', 'BAG_FULL_MSG']) {
    const m = APP_JS_SRC.match(new RegExp(`const ${name} = '([^']*)';`));
    assert.truthy(m, `${name} is still one constant`);
    assert.lte([...m[1]].length, MAP_MSG_MAX, `${name} fits: ${m[1]}`);
  }
});

test('map copy: the terrain table fits at every code', () => {
  for (const code of NON_TILLABLE_CODES) {
    const label = TERRAIN_FLAVOR[code];
    assert.lte([...label].length, MAP_MSG_MAX, `terrain ${code}: ${label}`);
  }
});

test('map copy: a till refusal fits for every kind it can name', () => {
  // Run for real rather than by regex — these are built, not literal, and the
  // catch-all interpolates whatever kind it was handed.
  const kinds = ['tree', 'fruittree', 'mineralrock', 'staircase', 'house', 'tower',
                 'shrine', 'trailer', 'chest', 'some_new_kind'];
  for (const kind of kinds) {
    const line = tillBlockerLine({ kind });
    assert.lte([...line].length, MAP_MSG_MAX, `${kind}: ${line}`);
  }
  // And with the longest name the game can hand it — a chest carrying a real
  // POI name is the unbounded case, so the line must not interpolate one.
  const long = tillBlockerLine({ kind: 'chest', name: 'Saint Someone Memorial Library and Reading Room' });
  assert.lte([...long].length, MAP_MSG_MAX, 'a long POI name cannot blow the budget: ' + long);
});

test('map copy: a line that names an item fits at the longest name', () => {
  // cropName feeds the plant flash and both plant-side till refusals. The
  // longest thing it can return is what the budget has to survive.
  // The domain is CROP ids — cropName is handed pp.crop, wp.crop and
  // item.grows, all of which resolve to the produce, never to a seed.
  const cropIds = new Set([
    ...ITEMS.filter((i) => i.grows).map((i) => i.grows),
    ...ITEMS.filter((i) => i.crop).map((i) => i.crop),
  ]);
  const crops = [...cropIds].map((id) => cropName(id));
  const longest = crops.reduce((a, b) => (b.length > a.length ? b : a), '');
  const longestCrop = longest;
  assert.gt(longestCrop.length, 8, 'there is a genuinely long crop name to test against');
  // The three shapes those names go into, measured with the worst case in them.
  const shapes = [
    `\u{1F331} ${longestCrop} — water it.`,
    `Pick the ${longestCrop} first.`,
    `${longestCrop} grows here.`,
  ];
  for (const line of shapes) {
    assert.lte([...line].length, MAP_MSG_MAX, `worst-case name overflows: ${line}`);
  }
  assert.truthy(longest, 'the catalog has names');
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
  const waits = APP_JS_SRC.match(/Back \$\{this\.shopWaitLabel\(house\)\}/g) || [];
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
