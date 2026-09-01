// A REBUILT TILE MUST RUN ITS SPAWN PASS AGAIN.
//
// WHAT BROKE. The starter crates vanished a few seconds into a session — "like
// something loaded over them" — and came back on refresh. What loaded over them
// was the tile itself: when a tile rasterizes before its Overpass bin arrives,
// rebuildTileWithBin builds a replacement entry with the real-world trees in it
// and swaps it into the cache. The replacement inherits the live creatures from
// the entry it replaces, because their wander positions and tamed state cannot
// be reconstructed — and app.js was reading exactly that field to decide
// whether the tile still needed spawning. So the replacement arrived already
// looking spawned, the pass was skipped, and everything it places that ISN'T
// creatures was gone with the old entry: the starter crate trail first, plus
// the buried X, the extra treasure scatter and the fruit trees. On reload the
// bin is already cached, the tile builds with it first time, no rebuild
// happens — hence "it comes back after refresh".
//
// THE CONTRACT, and why it takes both files. The spawn gate lives in app.js and
// the carry-over list lives in worldgen.js, and neither is wrong on its own:
// the bug is that they disagreed about which field means "already spawned".
// Nothing but a test that reads BOTH can hold them together, so run.js lifts
// the four source slices below straight out of the shipping files.
//
// (app.js needs Phaser and cannot be loaded headlessly, which is why this is
// read out of the source text rather than driven — the same trick NON_TILLABLE
// and the shop-offer tests use.)
(function () {
// The property the gate actually tests, read out of the shipping line rather
// than assumed — so this file pins whatever the gate is, not one spelling.
const gateProps = [...new Set(
  [...SPAWN_GATE_SRC.matchAll(/!entry\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1])
)];

// The shipping gate, RUN rather than pattern-matched: the two lines are lifted
// verbatim and called with a stub `this`, so these tests fail on the behaviour
// changing and not merely on the spelling. (Driving it this way is what the
// existing trail tests could not reach — they call _placeStarterTrail directly,
// which is why "a rebuild lays the same trail again" passed all along while the
// crates were disappearing: the trail was fine, the call to it was not.)
const runGate = (entry, depth = 0) => {
  const calls = [];
  const self = {
    depth,
    spawnInTile: (e) => { calls.push('surface'); e._spawned = true; },
    spawnCaveCreatures: (e) => { calls.push('cave'); e._spawned = true; },
  };
  new Function('entry', 'tx', 'ty', SPAWN_GATE_SRC).call(self, entry, 0, 0);
  return calls;
};

test('spawn gate: a freshly built tile is spawned into', () => {
  assert.eq(runGate({}).join(), 'surface', 'a new surface tile runs the spawn pass');
  assert.eq(runGate({}, 2).join(), 'cave', 'a new cave tile gets monsters');
});

test('spawn gate: a tile already spawned into is left alone', () => {
  // The pass places treasure and lays the crate trail; running it on every
  // ensureTilesAround (each walk check, each depth change) would re-roll them.
  const done = { _spawned: true, creatures: [{ kind: 'cow' }] };
  assert.eq(runGate(done).join(), '', 'no second pass over a tile that had one');
});

test('spawn gate: A REBUILT TILE IS SPAWNED INTO — the crates regression', () => {
  // Exactly what rebuildTileWithBin hands over: a brand-new entry carrying the
  // previous one's live creatures and nothing else. It has never been through
  // the spawn pass, so it has no crates, no buried X and no treasure scatter —
  // and it must not be mistaken for a tile that has.
  const rebuilt = { creatures: [{ kind: 'cow', x: 5, y: 5 }], coinDrops: [] };
  assert.eq(runGate(rebuilt).join(), 'surface',
    'a rebuilt tile arrived looking spawned — this is the bug where the starter crates vanished mid-session');
});

test('spawn gate: the field it reads is one a rebuild does NOT carry over', () => {
  // The behaviour above only holds while the two files agree. rebuildTileWithBin
  // hands the replacement a few live fields; anything on that list is already
  // set by the time app.js looks, so gating on it skips the pass for a tile
  // that never ran it. That is the whole regression, in one assertion.
  assert.eq(gateProps.length, 1, `the surface and cave paths must gate on the same field, got ${JSON.stringify(gateProps)}`);
  const gate = gateProps[0];
  assert.falsy(REBUILD_WITH_BIN_SRC.includes(gate),
    `rebuildTileWithBin carries "${gate}" across, so a rebuilt tile arrives looking spawned and its crates are never placed`);
});

test('spawn gate: creatures ARE carried, which is why they cannot be the gate', () => {
  // Pins the premise of the test above rather than leaving it as folklore: if
  // the rebuild ever stops carrying creatures, this fails and the reasoning
  // gets revisited instead of quietly going stale.
  assert.truthy(/creatures/.test(REBUILD_WITH_BIN_SRC),
    'the rebuild no longer carries live creatures — re-read the gate reasoning above');
});

test('spawn pass: both spawners raise the flag the gate reads', () => {
  // A gate on a field nobody sets runs the pass on every ensureTilesAround —
  // re-placing treasure and re-rolling the trail on every walk check.
  const gate = gateProps[0];
  const sets = new RegExp(`entry\\.${gate}\\s*=`);
  assert.truthy(sets.test(SPAWN_IN_TILE_SRC), `spawnInTile never sets entry.${gate}`);
  assert.truthy(sets.test(SPAWN_CAVE_SRC), `spawnCaveCreatures never sets entry.${gate}`);
});

test('spawn pass: it keeps creatures the entry already carries', () => {
  // The other half of the rebuild handover: now that the pass RUNS on a
  // rebuilt tile, it must not overwrite the live creatures that were carried
  // into it — that would teleport every animal back to its spawn point and
  // undo the reason they are carried at all.
  assert.truthy(/entry\.creatures = entry\.creatures \|\| creatures/.test(SPAWN_IN_TILE_SRC),
    'spawnInTile clobbers carried-over creatures instead of keeping them');
  assert.truthy(/entry\.creatures = entry\.creatures \|\| creatures/.test(SPAWN_CAVE_SRC),
    'spawnCaveCreatures clobbers carried-over creatures instead of keeping them');
});

test('starter trail: its own guard is per-entry, so a rebuild re-lays it', () => {
  // _placeStarterTrail short-circuits on a flag it sets on the entry. That flag
  // has to live on the ENTRY (a fresh one per rebuild) and not on the scene or
  // the save, or the re-run this whole file is about would still place nothing.
  assert.truthy(/entry\._starterTrail/.test(STARTER_TRAIL_SRC),
    'the trail guard is no longer per-entry — a rebuilt tile would skip it');
  assert.falsy(/this\.save\.[A-Za-z]*[Tt]rail[A-Za-z]*Placed/.test(STARTER_TRAIL_SRC),
    'the trail guard moved into the save — a rebuilt tile would never re-lay the crates');
});
})();
