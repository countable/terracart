// A stall SELLS WHAT ITS SIGN SAYS.
//
// A market stall wears its POI name (render.js paints the rusticified name over
// it) and sells exactly one item, resolved from that name by loot.js
// produceStandFor. The two have to agree — the sign is a promise made before
// the player walks over. A juice bar in a mall food court sold STEAK: the name
// scan knew neither "freshly" nor "squeezed", so it fell through to the class
// guess for fast_food, which is meat.
//
// The rules these pin:
//   • a SPECIFIC product word anywhere in the name wins;
//   • a GENERIC venue word ("fresh", "market") only fills in when no product
//     word is present — it never outranks one, wherever each sits;
//   • the class guess is the LAST resort, not the second;
//   • a stem only counts when it lands on a real table key, so trimming a
//     suffix can never invent a product;
//   • every item any of the three tables can name is a real, priced item with
//     an awning frame — the stall can't advertise a family it can't sell.

(function () {

// A stall object as worldgen builds it: kind 'chest', a POI class, an OSM name.
const stall = (poiClass, name) => ({ kind: 'chest', poiClass, name });
const sells = (poiClass, name) => (produceStandFor(stall(poiClass, name)) || {}).item || null;

// ── The reported bug ──────────────────────────────────────────────────────
test('vendor parity: a juice bar sells juice, not steak', () => {
  assert.eq(sells('fast_food', 'Freshly Squeezed'), 'orange',
    'the mall juice bar that sold steak now sells oranges');
  assert.eq(sells('cafe', 'The Juicery'), 'orange', 'a juicery sells oranges');
  assert.eq(sells('fast_food', 'Juices & Smoothies'), 'orange', 'plural juice still reads');
  assert.eq(sells('shop', 'Cold Pressed'), 'orange', 'the other juice idiom reads too');
});

test('vendor parity: the awning matches the goods', () => {
  // frame is the product FAMILY the stall paints on its awning — a juice bar
  // must fly the fruit colour, not the meat one.
  const st = produceStandFor(stall('fast_food', 'Freshly Squeezed'));
  assert.eq(st.frame, STAND_ITEM_FRAME.orange, 'fruit awning over a fruit stall');
  assert.eq(st.frame, STAND_ITEM_FRAME[st.item], 'the frame is the item family, always');
});

// ── Specific beats generic, wherever each sits ────────────────────────────
test('vendor parity: a product word outranks a venue word before it', () => {
  assert.eq(sells('shop', 'Fresh Fish Market'), 'salmon', 'fish, not the "fresh" potato');
  assert.eq(sells('shop', 'Organic Flower Co'), 'flowers', 'flowers, not "organic" produce');
  assert.eq(sells('shop', 'The Harvest Bakery'), 'coffee', 'a bakery bakes');
  assert.eq(sells('convenience', 'Market Street Butchers'), 'meat', 'the butcher wins the sign');
});

test('vendor parity: a venue word still themes a stall that names no product', () => {
  assert.eq(sells('shop', 'Corner Market'), 'potato', 'a plain market is a produce stall');
  assert.eq(sells('shop', 'Fresh & Organic'), 'potato', 'adjectives alone → produce');
});

// ── Stems ────────────────────────────────────────────────────────────────
test('vendor parity: plurals and word forms resolve to their root', () => {
  const cases = [
    ['fast_food', 'Tacos',       'meat'],
    ['shop',      'Bakers',      'coffee'],
    ['shop',      'Petals',      'flowers'],
    ['shop',      'The Beanery', 'coffee'],
    ['cafe',      'Grilled',     'meat'],
    ['shop',      'Cherries',    'cherry'],
  ];
  for (const [cls, name, want] of cases) {
    assert.eq(sells(cls, name), want, `"${name}" sells ${want}`);
  }
});

test('vendor parity: a stem never invents a product', () => {
  // None of these contain a food word; each would only match if a suffix trim
  // were allowed to land somewhere it likes. They must fall to the class guess
  // (or to nothing at all for a class with none).
  for (const name of ['Barber Shop', 'Reddy Ltd', 'Ashling', 'Bassett Holdings']) {
    assert.eq(sells('shop', name), null, `"${name}" is not a food stall`);
  }
  // A brewery brews beer, not coffee — the exact key beats the `brew` stem.
  assert.eq(sells('shop', 'Old Mill Brewery'), 'potato', 'a brewery is not a coffee brew');
});

// ── The class guess is the last resort ───────────────────────────────────
test('vendor parity: the class only speaks when the name says nothing', () => {
  assert.eq(sells('cafe', ''), 'coffee', 'an unnamed cafe pours coffee');
  assert.eq(sells('fast_food', 'Chez Pierre'), 'meat', 'no product word → the class guess');
  assert.eq(sells('cafe', 'Chez Pierre Steakhouse'), 'meat', 'but a product word overrides it');
  assert.eq(sells('cafe', 'Le Petit Chou Florist'), 'flowers', 'even across the whole name');
});

test('vendor parity: only retail POIs run a stall at all', () => {
  // A library called "The Bakery Reading Room" is not a bakery.
  assert.eq(sells('library', 'The Bakery Reading Room'), null, 'civic POIs never sell produce');
  assert.eq(sells('bus', 'Fish Street'), null, 'street furniture never sells produce');
  assert.falsy(produceStandFor({ kind: 'tree', poiClass: 'cafe', name: 'Coffee' }),
    'only chest objects can be stalls');
});

test('vendor parity: a garden is a place, not a shop — always a crate', () => {
  // `garden` sits in the flora category for its LOOT (it hands out flower
  // seeds), which is what used to make it a flower stall. Nobody is behind a
  // counter in a public garden. The name is what would fool the check — a
  // garden POI is called "…Garden" almost by definition — so the exclusion is
  // pinned against exactly those names.
  for (const name of ['', 'Rose Garden', 'Botanical Gardens', 'Queen Elizabeth Garden',
                      'The Flower Garden']) {
    assert.eq(sells('garden', name), null, `a garden named "${name}" stays a crate`);
  }
  // Its retail NEIGHBOURS are still shops — the exclusion is one class, not a
  // category-wide retreat.
  assert.eq(sells('garden_centre', 'Garden Works'), 'flowers', 'a garden CENTRE still sells');
  assert.eq(sells('florist', ''), 'flowers', 'a florist still sells');
});

test('vendor parity: a restaurant behaves like fast food', () => {
  // Same kind of place to a passer-by; splitting them left a food court's
  // burger counter running a stall while the sit-down place beside it was a
  // crate whenever its name wasn't in English.
  const cases = ['', 'Chez Pierre', 'Osteria', '\u4e2d\u83ef\u6599\u7406'];
  for (const name of cases) {
    assert.eq(sells('restaurant', name), sells('fast_food', name),
      `"${name}" resolves the same either side`);
  }
  assert.eq(sells('restaurant', ''), 'meat', 'and that shared answer is the meat fallback');
  // A named product still outranks the class on both, as everywhere else.
  assert.eq(sells('restaurant', 'Sushi California'), 'salmon', 'the name still wins');
});

// ── Table hygiene: every promise is one the stall can keep ───────────────
test('vendor parity: every table item is real, priced, and has an awning', () => {
  const tables = { STAND_KEYWORD_ITEM, STAND_GENERIC_ITEM, STAND_CLASS_ITEM };
  const bad = [];
  for (const [tname, table] of Object.entries(tables)) {
    for (const [word, item] of Object.entries(table)) {
      if (!ITEM_BY_ID[item]) bad.push(`${tname}.${word} → ${item} is not an item`);
      else if (STAND_ITEM_FRAME[item] === undefined) bad.push(`${tname}.${word} → ${item} has no awning frame`);
      else if (!(PRICES[item] > 0)) bad.push(`${tname}.${word} → ${item} has no price`);
    }
  }
  assert.eq(bad.length, 0, 'every stall can sell what it advertises: ' + bad.join('; '));
});

test('vendor parity: no word is in both the specific and the generic table', () => {
  // A word in both would make its strength depend on lookup order rather than
  // on what it means — the exact ambiguity the two tables exist to remove.
  const dupes = Object.keys(STAND_GENERIC_ITEM).filter((w) => STAND_KEYWORD_ITEM[w]);
  assert.eq(dupes.length, 0, 'words claimed by both tables: ' + dupes.join(', '));
});

test('vendor parity: every stall class the fallback names can actually fire', () => {
  // A class guess for a POI that never renders a stall — a non-retail category,
  // or one excluded outright — is dead code pretending to be parity.
  const retail = (cls) => ['food', 'commerce', 'flora'].includes(POI_CATEGORY[cls]);
  const stray = Object.keys(STAND_CLASS_ITEM)
    .filter((c) => !retail(c) || STAND_NEVER_CLASSES.has(c));
  assert.eq(stray.length, 0, 'class fallbacks that can never fire: ' + stray.join(', '));
  // …and every excluded class is one that would otherwise have run a stall,
  // so the list can't quietly fill up with classes it has no effect on.
  const inert = [...STAND_NEVER_CLASSES].filter((c) => !retail(c));
  assert.eq(inert.length, 0, 'exclusions that exclude nothing: ' + inert.join(', '));
});

// ── Determinism ──────────────────────────────────────────────────────────
test('vendor parity: the same sign always sells the same thing', () => {
  const a = stall('fast_food', 'Freshly Squeezed');
  const b = stall('fast_food', 'Freshly Squeezed');
  assert.eq(produceStandFor(a).item, produceStandFor(b).item, 'two stalls, one answer');
  assert.eq(produceStandFor(a).item, produceStandFor(a).item, 'and the cache agrees with itself');
});

})();
