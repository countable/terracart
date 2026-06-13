// Headless tests for the inventory core (src/inventory.js) — the stack / cap /
// dedupe / autoselect rules extracted from app.js's MapScene.

test('stackCap: 9 with no bag, 249 at tier 7, monotonic between', () => {
  assert.eq(Inventory.stackCap({ relics: {} }), 9, 'no bag = 9');
  assert.eq(Inventory.stackCap({ relics: { bags: { tier: 7 } } }), 249, 'tier 7 = 249');
  let prev = -1;
  for (let t = 0; t <= 7; t++) {
    const c = Inventory.stackCap({ relics: { bags: { tier: t } } });
    assert.gt(c, prev, `tier ${t} cap rises`);
    prev = c;
  }
});

test('add: a fresh item creates one stack and accepts all of n', () => {
  const save = { inv: [], relics: {} };
  const r = Inventory.add(save, 'wood', 5);
  assert.eq(r.valid, true);
  assert.eq(r.accepted, 5, 'all 5 accepted');
  assert.eq(r.rejected, 0, 'nothing rejected');
  assert.eq(r.isNewStack, true, 'new stack created');
  assert.eq(save.inv.length, 1, 'exactly one stack');
  assert.eq(Inventory.count(save, 'wood'), 5);
});

test('add: caps at the bag limit and reports the overflow', () => {
  const save = { inv: [], relics: {} };        // no bag → cap 9
  const r = Inventory.add(save, 'wood', 20);
  assert.eq(r.accepted, 9, 'only 9 fit');
  assert.eq(r.rejected, 11, '11 rejected');
  assert.eq(Inventory.count(save, 'wood'), 9, 'stack pinned at cap');
});

test('add: tops up the existing stack (no second stack, no overflow)', () => {
  const save = { inv: [], relics: { bags: { tier: 7 } } };   // cap 249
  Inventory.add(save, 'wood', 5);
  const r = Inventory.add(save, 'wood', 3);
  assert.eq(r.isNewStack, false, 'reused the stack');
  assert.eq(save.inv.length, 1, 'still one stack');
  assert.eq(Inventory.count(save, 'wood'), 8);
});

test('add: folds legacy duplicate stacks into one canonical stack', () => {
  const save = { inv: [{ id: 'wood', count: 2 }, { id: 'wood', count: 3 }], relics: { bags: { tier: 7 } } };
  Inventory.add(save, 'wood', 1);
  const woodStacks = save.inv.filter((s) => s.id === 'wood');
  assert.eq(woodStacks.length, 1, 'duplicates folded to one');
  assert.eq(Inventory.count(save, 'wood'), 6, '2 + 3 + 1');
});

test('add: autoselect points selSlot/invPage at a new stack only when asked', () => {
  const save = { inv: [{ id: 'wood', count: 1 }], relics: {}, selSlot: 0, invPage: 0 };
  // Sixth distinct new item lands on page 1 (PAGE size 5).
  for (const id of ['rockfruit', 'coal', 'apple', 'potato']) Inventory.add(save, id, 1);  // fills slots 1-4
  Inventory.add(save, 'gold_bar', 1, { autoselect: true });  // slot 5 → page 1
  assert.eq(save.selSlot, 5, 'selected the new stack');
  assert.eq(save.invPage, 1, 'paged to it');
  // Without autoselect, selection is untouched.
  const before = save.selSlot;
  Inventory.add(save, 'ruby', 1);   // no autoselect opt
  assert.eq(save.selSlot, before, 'selection unchanged without autoselect');
});

test('add: topping up an existing stack never moves the selection', () => {
  const save = { inv: [{ id: 'wood', count: 1 }, { id: 'coal', count: 1 }], relics: {}, selSlot: 1, invPage: 0 };
  Inventory.add(save, 'wood', 1, { autoselect: true });   // existing stack → keep selection
  assert.eq(save.selSlot, 1, 'harvest→replant loop keeps its selection');
});

test('add: an unknown id or n<=0 is an invalid no-op', () => {
  const save = { inv: [], relics: {} };
  const bad = Inventory.add(save, 'not-a-real-item', 5);
  assert.eq(bad.valid, false, 'unknown id is invalid');
  assert.eq(save.inv.length, 0, 'inventory untouched');
  const zero = Inventory.add(save, 'wood', 0);
  assert.eq(zero.valid, false, 'n<=0 is invalid');
  assert.eq(save.inv.length, 0, 'still untouched');
});

test('capExempt: discovery badges ignore the bag cap entirely', () => {
  const save = { inv: [], relics: {} };        // no bag → cap 9 for normal items
  const r = Inventory.add(save, 'discovery', 20);
  assert.eq(r.accepted, 20, 'all 20 accepted past the bag cap');
  assert.eq(r.rejected, 0, 'nothing rejected');
  assert.eq(Inventory.count(save, 'discovery'), 20);
  assert.eq(Inventory.roomFor(save, 'discovery'), Infinity, 'always room for a badge');
});

test('remove: deducts across stacks, splices empties, reports the shortfall', () => {
  const save = { inv: [{ id: 'wood', count: 2 }, { id: 'discovery', count: 6 }], relics: {} };
  assert.eq(Inventory.remove(save, 'discovery', 5), 5, 'removed the full ask');
  assert.eq(Inventory.count(save, 'discovery'), 1, '6 - 5 left');
  assert.eq(Inventory.remove(save, 'discovery', 5), 1, 'short stack → partial removal reported');
  assert.eq(save.inv.find((s) => s.id === 'discovery'), undefined, 'emptied stack spliced out');
  assert.eq(Inventory.count(save, 'wood'), 2, 'other stacks untouched');
  assert.eq(Inventory.remove(save, 'wood', 0), 0, 'n<=0 is a no-op');
});

test('roomFor: cap minus held, floored at 0', () => {
  const save = { inv: [], relics: {} };   // cap 9
  assert.eq(Inventory.roomFor(save, 'wood'), 9, 'empty → full room');
  Inventory.add(save, 'wood', 4);
  assert.eq(Inventory.roomFor(save, 'wood'), 5, '9 - 4');
  Inventory.add(save, 'wood', 99);        // overfill attempt
  assert.eq(Inventory.roomFor(save, 'wood'), 0, 'full → no room');
});
