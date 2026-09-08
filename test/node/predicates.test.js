// The shared world-object predicates (src/interactables.js).
//
// isCastle / isTreeLike / isBuilding / isSpent used to be spelled out as
// `o.kind === 'a' || o.kind === 'b'` in render.js, interact.js, worldgen.js,
// multiplayer.js and shops_math.js — one copy per reader, each free to drift.
// interactables.js is the registry every one of those already loads before
// itself, so the group lives there and these pin it: the predicate's own
// answer, that the registry's `spent` rows are readers of isSpent rather than
// a second lane, and that no call site has grown its own copy back.

(function () {

// ── The three kind groups ──────────────────────────────────────────────────
test('isCastle: the tower kind OR tier 12, and nothing else', () => {
  assert.eq(isCastle({ kind: 'tower' }), true, 'a turret is the castle');
  assert.eq(isCastle({ kind: 'house', tier: 12 }), true, 'tier 12 is the castle');
  assert.eq(isCastle({ kind: 'tower', tier: 12 }), true, 'both at once');
  // A fort is tier 11 and gates at 5 deals/hour — the thing isCastle is NOT.
  assert.eq(isCastle({ kind: 'house', tier: 11 }), false, 'a fort is not a castle');
  assert.eq(isCastle({ kind: 'house' }), false, 'a plain house is not');
  assert.eq(isCastle({ kind: 'chest', tier: 12 }), true, 'tier 12 is tier 12');
  assert.eq(isCastle(null), false, 'no object is not a castle');
  assert.eq(isCastle(undefined), false, 'nor undefined');
});

test('isTreeLike: tree and fruittree, nothing else', () => {
  assert.eq(isTreeLike('tree'), true, 'a tree');
  assert.eq(isTreeLike('fruittree'), true, 'a fruit tree');
  for (const k of ['bush', 'pole', 'house', 'mineralrock', 'groundstack', '', undefined, null]) {
    assert.eq(isTreeLike(k), false, `${String(k)} is not tree-like`);
  }
});

test('isBuilding: the house/tower pair, not "has a footprint"', () => {
  assert.eq(isBuilding('house'), true, 'a house');
  assert.eq(isBuilding('tower'), true, 'a turret');
  // The exemption list for the seat rule is longer than this pair on purpose —
  // a market stall / pot-of-gold rides in on the `chest` kind, and a shrine is
  // not a building object at all.
  for (const k of ['chest', 'well', 'staircase', '_fire', 'torch', '_scarecrow',
                   'tree', 'fruittree', '', undefined, null]) {
    assert.eq(isBuilding(k), false, `${String(k)} is not a building`);
  }
});

// The predicate has to answer for every kind the registry knows, not just the
// ones that happen to be spelled at a call site.
test('the kind groups are subsets of the registry, and disjoint', () => {
  assert.eq(isBuilding('house') && !!INTERACTABLES.house, true, 'house is registered');
  assert.eq(isBuilding('tower') && !!INTERACTABLES.tower, true, 'tower is registered');
  assert.truthy(INTERACTABLES.tree, 'tree is registered');
  assert.truthy(INTERACTABLES.fruittree, 'fruittree is registered');
  for (const k of Object.keys(INTERACTABLES)) {
    assert.falsy(isTreeLike(k) && isBuilding(k), `${k} cannot be both a tree and a building`);
  }
});

// ── isSpent ────────────────────────────────────────────────────────────────
const setsFor = (save, scene) => spentSets(scene || { save }, save);

test('isSpent: the four "…except that one" lists, and nothing else', () => {
  const save = { opened: ['c1'], chopped: ['t1'], picked: ['g1'] };
  const scene = { save, brokenRockSet: new Set(['r1']) };
  const sets = setsFor(save, scene);

  assert.eq(isSpent({ kind: 'chest', id: 'c1' }, sets), true, 'an opened chest');
  assert.eq(isSpent({ kind: 'chest', id: 'c2' }, sets), false, 'an unopened chest');
  assert.eq(isSpent({ kind: 'tree', id: 't1' }, sets), true, 'a chopped tree (save)');
  // The in-memory flag the chop wheel sets, before the save has it.
  assert.eq(isSpent({ kind: 'tree', id: 't9', chopped: true }, sets), true, 'a chopped tree (flag)');
  assert.eq(isSpent({ kind: 'tree', id: 't9' }, sets), false, 'a standing tree');
  assert.eq(isSpent({ kind: 'mineralrock', id: 'r1' }, sets), true, 'a mined-out rock');
  assert.eq(isSpent({ kind: 'mineralrock', id: 'r2' }, sets), false, 'a fresh deposit');
  assert.eq(isSpent({ kind: 'groundstack', id: 'g1' }, sets), true, 'a picked-up stack');
  assert.eq(isSpent({ kind: 'groundstack', id: 'g2' }, sets), false, 'a stack still lying there');

  // It is not "can this be worked": these are un-spent whatever the save says.
  for (const kind of ['house', 'tower', 'well', 'fruittree', 'staircase', 'pole', 'torch']) {
    assert.eq(isSpent({ kind, id: 'c1' }, sets), false, `${kind} is never spent`);
  }
});

test('isSpent: an empty save spends nothing', () => {
  const sets = setsFor({}, { save: {} });
  for (const kind of ['chest', 'tree', 'mineralrock', 'groundstack']) {
    assert.eq(isSpent({ kind, id: 'x' }, sets), false, `${kind} on a fresh save`);
  }
});

// The registry's `spent` rows ARE readers of isSpent — that is what makes the
// tap gate and the draw filter one lane. If a row ever answers differently
// from isSpent, the thing you cannot see is still refusing your tap (or worse,
// accepting it).
test('every INTERACTABLES `spent` row agrees with isSpent, kind by kind', () => {
  const spentKinds = Object.keys(INTERACTABLES).filter((k) => INTERACTABLES[k].spent);
  assert.gte(spentKinds.length, 2, 'the registry still declares spent rows');
  for (const kind of spentKinds) {
    for (const spent of [false, true]) {
      const save = { opened: [], chopped: [], picked: [] };
      const scene = makeScene({ save });
      const o = { kind, id: `${kind}_pin`, x: 0, y: 0 };
      if (spent) {
        if (kind === 'tree') save.chopped.push(o.id);
        else if (kind === 'chest') save.opened.push(o.id);
        else if (kind === 'groundstack') save.picked.push(o.id);
        else if (kind === 'mineralrock') scene.brokenRockSet.add(o.id);
        else continue;   // a new spent kind: teach this test which list it uses
      }
      const viaRow = !!INTERACTABLES[kind].spent(o, makeCtx(scene, save));
      const viaPredicate = isSpent(o, spentSets(scene, save));
      assert.eq(viaRow, viaPredicate, `${kind} (${spent ? 'spent' : 'fresh'}): row === isSpent`);
      assert.eq(viaRow, spent, `${kind}: answers the list it was put on`);
    }
  }
});

test('spentSets: reads the save it is handed, and the scene\'s broken-rock Set', () => {
  const save = { opened: ['a'], chopped: ['b'], picked: ['c'] };
  const broken = new Set(['d']);
  const sets = spentSets({ save: { opened: ['zzz'] }, brokenRockSet: broken }, save);
  assert.eq(sets.opened.has('a'), true, 'the explicit save wins over scene.save');
  assert.eq(sets.opened.has('zzz'), false, '…and only that save is read');
  assert.eq(sets.chopped.has('b'), true, 'chopped');
  assert.eq(sets.picked.has('c'), true, 'picked');
  assert.eq(sets.broken, broken, 'the scene\'s Set is passed through, not rebuilt');
  // No scene, no save: every list is empty rather than a throw.
  const empty = spentSets(null, null);
  assert.eq(empty.opened.size + empty.chopped.size + empty.picked.size + empty.broken.size, 0,
            'nothing spent when nothing is known');
});

// ── The chest dedup ────────────────────────────────────────────────────────
test('chestCellDedup: first-seen-wins on the metre cell, one instance per pass', () => {
  const dedup = chestCellDedup(5);
  assert.eq(dedup({ x: 0.1, y: 0.1 }), false, 'the first chest in a cell survives');
  assert.eq(dedup({ x: 4.9, y: 4.9 }), true, 'a second in the same cell collapses');
  assert.eq(dedup({ x: 5.1, y: 0.1 }), false, 'the next cell east is its own');
  assert.eq(dedup({ x: -0.1, y: 0.1 }), false, 'floor, not trunc: west of zero is its own cell');
  assert.eq(dedup({ x: -4.9, y: 0.1 }), true, '…and holds only one');
  // Stateful: a fresh pass starts from nothing, or the second frame would
  // drop every chest it drew in the first.
  assert.eq(chestCellDedup(5)({ x: 0.1, y: 0.1 }), false, 'a new instance forgets');
});

test('chestCellDedup: the draw pass and the tap pass build the same predicate', () => {
  assert.truthy(/const isDupChest = chestCellDedup\(scene\.cellM\)/.test(RENDER_SRC),
                'render.js takes its dedup from interactables.js');
  assert.truthy(/const isDupTapChest = chestCellDedup\(scene\.cellM\)/.test(INTERACT_SRC),
                'interact.js takes the same one');
  // The copies both files used to keep are gone.
  for (const [name, src] of [['render.js', RENDER_SRC], ['interact.js', INTERACT_SRC]]) {
    assert.falsy(/Math\.floor\(o\.x \/ scene\.cellM\) \+ '_' \+/.test(src),
                 `${name} no longer spells the dedup key itself`);
  }
});

// ── No call site keeps a copy ──────────────────────────────────────────────
test('the literal spellings are gone from the readers', () => {
  const SOURCES = [['render.js', RENDER_SRC], ['interact.js', INTERACT_SRC],
                   ['worldgen.js', WORLDGEN_SRC], ['multiplayer.js', MULTIPLAYER_SRC],
                   ['shops_math.js', DURATION_SOURCES['shops_math.js']]];
  for (const [name, src] of SOURCES) {
    assert.falsy(/kind === 'tree' \|\| \w+(\.\w+)*\.kind === 'fruittree'/.test(src),
                 `${name}: no inline tree||fruittree`);
    assert.falsy(/kind === 'house' \|\| \w+(\.\w+)*\.kind === 'tower'/.test(src),
                 `${name}: no inline house||tower`);
    assert.falsy(/kind === 'tower' \|\| \w+(\.\w+)*\.kind === 'house'/.test(src),
                 `${name}: nor the other way round`);
  }
  assert.falsy(/kind === 'tower' \|\| \w+\.tier === 12/.test(DURATION_SOURCES['shops_math.js']),
               'shops_math.js: no inline castle test');
  assert.truthy(/isCastle\(house\)/.test(DURATION_SOURCES['shops_math.js']),
                'shops_math.js: dealCap asks isCastle');
  // The four-clause "is this spent" filter render.js used to carry.
  assert.falsy(/o\.kind === 'mineralrock' && brokenRockSet\.has/.test(RENDER_SRC),
               'render.js: the spent filter is isSpent now');
  assert.truthy(/objList\.filter\(\(\{ o \}\) => !isSpent\(o, spentIds\)\)/.test(RENDER_SRC),
                'render.js: …and it is the shared one');
});

// ── The shadow flag lives on the RENDER_SPEC row ───────────────────────────
// SEATED_SHADOW_KINDS was a nine-name Set beside the table it named rows of,
// so a new seated sprite could join one and not the other. It is derived now.
{
  const specStart = RENDER_SRC.indexOf('  const RENDER_SPEC = {');
  const specEnd = RENDER_SRC.indexOf('\n  };\n', specStart);
  const SPEC_SRC = specStart < 0 || specEnd < 0 ? '' : RENDER_SRC.slice(specStart, specEnd);

  test('SEATED_SHADOW_KINDS is derived from RENDER_SPEC, not a second list', () => {
    assert.gt(SPEC_SRC.length, 0, 'found the RENDER_SPEC block');
    assert.truthy(
      /const SEATED_SHADOW_KINDS = new Set\(\s*Object\.keys\(RENDER_SPEC\)\.filter\(\(k\) => RENDER_SPEC\[k\]\.shadow\)\)/
        .test(RENDER_SRC),
      'the set is Object.keys(RENDER_SPEC) filtered on the row flag');
    assert.falsy(/SEATED_SHADOW_KINDS = new Set\(\[/.test(RENDER_SRC),
                 'the hand-kept nine-name list is gone');
  });

  test('every shadow flag sits ON a RENDER_SPEC row', () => {
    // Nothing outside the table may claim a shadow — the derivation only reads
    // the table, so a flag anywhere else would be silently dead. (Comment lines
    // don't count: the derivation's own note names the flag.)
    const code = (src) => src.split('\n').filter((l) => !/^\s*\/\//.test(l));
    const inSpec = code(SPEC_SRC).filter((l) => /shadow: true/.test(l)).length;
    const inFile = code(RENDER_SRC).filter((l) => /shadow: true/.test(l)).length;
    assert.eq(inFile, inSpec, 'no shadow: true outside the RENDER_SPEC block');
    assert.gt(inSpec, 0, 'rows do carry it');

    // …and each flag hangs off a top-level row key of the table.
    const keys = [];
    const flagged = new Set();
    let cur = null;
    for (const line of code(SPEC_SRC)) {
      const m = line.match(/^    ([A-Za-z_][A-Za-z0-9_]*):/);
      if (m) { cur = m[1]; keys.push(cur); }
      if (/shadow: true/.test(line)) {
        assert.truthy(cur, 'a shadow flag before any row key');
        flagged.add(cur);
      }
    }
    assert.eq(flagged.size, inSpec, 'one flag per flagged row');
    for (const k of flagged) assert.includes(keys, k, `${k} is a RENDER_SPEC key`);

    // The nine that cast one, and the four that deliberately do not:
    // house/tower take the bespoke footprint math, groundstack already lies on
    // the ground, staircase is a hole cut into it.
    const expected = ['tree', 'fruittree', 'chest', 'mineralrock', 'well', 'pole',
                      '_scarecrow', '_fire', 'torch'];
    for (const k of expected) assert.truthy(flagged.has(k), `${k} casts a contact shadow`);
    for (const k of ['house', 'tower', 'groundstack', 'staircase']) {
      assert.falsy(flagged.has(k), `${k} does not`);
    }
    assert.eq(flagged.size, expected.length, 'and no others');
  });
}

})();
