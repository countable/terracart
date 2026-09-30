// ── The chunk index: drawObjects walks the chunks, never the tile ─────────
//
// A tile's objects / wildplants are flat arrays, and the sprite pass used to
// walk every one in the 3×3 ring on every step to keep the few dozen on
// screen (37,000 scanned to keep 37, on the Sep 2026 phone profile). Each
// array is bucketed once into CHUNK_M squares on the entry (WorldGen.chunkIndex)
// and forEachItemInBox opens only the chunks a query box touches. The index
// is derived, never stored — a rebuilt entry lays it again — and it is keyed
// on the array's identity, length AND last element, which is what every
// mutation the code makes (push, splice, filter, splice-then-push) moves.

(function () {

const C = WorldGen.CHUNK_M;
// The recording profiler boot_profiler.test.js uses (its helper is file-local).
function makeBootStub() {
  const counts = [];
  return { counts, tick() {}, count(name, n) { counts.push({ name, n }); },
    lastCount(name) { return counts.filter(c => c.name === name).pop(); } };
}
function entryWith(objects) { return { objects }; }
function visited(entry, prop, x0, y0, x1, y1) {
  const out = [];
  WorldGen.forEachItemInBox(entry, prop, x0, y0, x1, y1, (o) => out.push(o));
  return out;
}
function brute(arr, x0, y0, x1, y1) {
  // The chunk-level truth: everything in any chunk the box overlaps.
  const bx0 = Math.floor(x0 / C), bx1 = Math.floor(x1 / C), by0 = Math.floor(y0 / C), by1 = Math.floor(y1 / C);
  return arr.filter(o => { const bx = Math.floor(o.x / C), by = Math.floor(o.y / C); return bx >= bx0 && bx <= bx1 && by >= by0 && by <= by1; });
}

test('chunk index: a query visits everything in the box and nothing a chunk away', () => {
  const rng = WorldGen.makeRng(7, 11, 0);
  const objs = [];
  for (let i = 0; i < 4000; i++) objs.push({ id: 'o' + i, x: (rng() - 0.5) * 5000, y: (rng() - 0.5) * 5000 });
  const e = entryWith(objs);
  for (let q = 0; q < 200; q++) {
    const cx = (rng() - 0.5) * 5000, cy = (rng() - 0.5) * 5000, r = 20 + rng() * 200;
    const got = visited(e, 'objects', cx - r, cy - r, cx + r, cy + r);
    const want = brute(objs, cx - r, cy - r, cx + r, cy + r);
    assert.eq(got.length, want.length, `query ${q}: the chunks' contents, exactly`);
    const gs = new Set(got);
    for (const o of want) assert.truthy(gs.has(o), `query ${q}: an item inside the box was skipped`);
    // Nothing outside the box by more than a chunk can be visited.
    for (const o of got) assert.truthy(Math.abs(o.x - cx) <= r + C && Math.abs(o.y - cy) <= r + C, `query ${q}: an item a chunk away was walked`);
  }
  // A typical query opens a handful of chunks out of the tile's thousands.
  const r = 80;
  assert.lt(visited(e, 'objects', -r, -r, r, r).length, objs.length / 20, 'the walk is a small fraction of the array');
});

test('chunk index: negative coordinates and chunk edges are exact', () => {
  const objs = [
    { id: 'a', x: -1, y: -1 }, { id: 'b', x: 0, y: 0 }, { id: 'c', x: C - 0.001, y: 0 }, { id: 'd', x: C, y: 0 },
    { id: 'e', x: -C, y: -C }, { id: 'f', x: -C - 0.001, y: 0 },
  ];
  const e = entryWith(objs);
  const ids = (list) => list.map(o => o.id).sort().join(',');
  assert.eq(ids(visited(e, 'objects', 0, 0, 1, 1)), 'b,c', 'the box in chunk (0,0) sees that chunk only');
  assert.eq(ids(visited(e, 'objects', -1, -1, 1, 1)), 'a,b,c,e', 'straddling the origin opens the four chunks around it');
  assert.eq(ids(visited(e, 'objects', C, 0, C + 1, 1)), 'd', 'x = C is the next chunk');
  assert.eq(ids(visited(e, 'objects', -C - 1, 0, -C, 1)), 'f,a,b,c'.split(',').filter(k => k === 'f').join(',') || 'f',
    'x just under -C is chunk -2');
});

test('chunk index: built once, reused while the array stands, rebuilt on every mutation the code makes', () => {
  const e = entryWith([{ id: 'a', x: 1, y: 1 }, { id: 'b', x: 2, y: 2 }, { id: 'c', x: 3, y: 3 }]);
  assert.falsy(e._chunkIdx, 'nothing until the first query — a rebuilt entry starts with none');
  visited(e, 'objects', 0, 0, 10, 10);
  const idx1 = WorldGen.chunkIndex(e, 'objects');
  assert.eq(idx1.builds, 1, 'one build');
  visited(e, 'objects', 0, 0, 10, 10);
  assert.eq(WorldGen.chunkIndex(e, 'objects'), idx1, 'the same index object while the array stands');
  // push (spawnInTile, a placed thing)
  e.objects.push({ id: 'd', x: 4, y: 4 });
  assert.eq(visited(e, 'objects', 0, 0, 10, 10).length, 4, 'a pushed object is walked');
  assert.eq(WorldGen.chunkIndex(e, 'objects').builds, 2);
  // splice (a chop, a pickup)
  e.objects.splice(0, 1);
  assert.eq(visited(e, 'objects', 0, 0, 10, 10).map(o => o.id).join(','), 'b,c,d', 'a spliced object is gone');
  // filter() reassignment (a dedup)
  e.objects = e.objects.filter(o => o.id !== 'c');
  assert.eq(visited(e, 'objects', 0, 0, 10, 10).map(o => o.id).join(','), 'b,d', 'a reassigned array is re-read');
  // splice one, push another — the same length and identity (the trailer swap)
  const n = WorldGen.chunkIndex(e, 'objects').builds;
  e.objects.splice(0, 1);
  e.objects.push({ id: 'e', x: 5, y: 5 });
  assert.eq(visited(e, 'objects', 0, 0, 10, 10).map(o => o.id).join(','), 'd,e', 'a same-length swap is seen through the tail');
  assert.eq(WorldGen.chunkIndex(e, 'objects').builds, n + 1);
  // Emptied: no index, nothing walked, and no throw.
  e.objects.length = 0;
  assert.eq(visited(e, 'objects', 0, 0, 10, 10).length, 0);
  assert.eq(visited({ }, 'objects', 0, 0, 10, 10).length, 0, 'a tile with no array at all');
  // Each array is its own index.
  e.wildplants = [{ id: 'w', x: 1, y: 1 }];
  assert.eq(visited(e, 'wildplants', 0, 0, 10, 10).length, 1);
});

test('chunk index: drawObjects queries each walk with its own reach — sprites, object lights, plant lights', () => {
  const body = RENDER_SRC.slice(RENDER_SRC.indexOf('Render.drawObjects = function drawObjects(scene)'));
  // The sprite walk: the cull plus the house art pad (the widest art).
  assert.truthy(/const sM = halfM \+ HOUSE_PAD_M;/.test(body), 'the sprite box is the cull plus the house art pad');
  assert.truthy(/WorldGen\.forEachItemInBox\(entry, 'objects', sx0, sy0, sx1, sy1, \(o\) => \{/.test(body), 'objects come off the index, in the sprite box');
  // The light walk: only the tile's pre-cull lights, out to the widest one.
  assert.truthy(/const lM = halfM \+ \(LIGHTS \? LIGHTS\.objectLightPadCells\(\) \* scene\.cellM : 0\);/.test(body),
    'the object light box is the cull plus the widest scanned light');
  assert.truthy(/WorldGen\.forEachItemInBox\(entry, PRE_CULL_LIGHTS, pWorldX - lM, pWorldY - lM, pWorldX \+ lM, pWorldY \+ lM, \(o\) => \{/.test(body),
    'and walks the derived light list, not every object');
  assert.truthy(/if \(Math\.abs\(dx\) <= sM && Math\.abs\(dy\) <= sM\) return;   \/\/ the sprite walk's/.test(body),
    'what the sprite walk already offered is not offered twice');
  assert.truthy(/if \(Math\.abs\(dx\) > sM \|\| Math\.abs\(dy\) > sM\) return;/.test(body),
    'and the sprite walk leaves everything past its box to the light walk');
  // The plant walk: the cull plus the widest plant light.
  assert.truthy(/const wM = halfM \+ \(LIGHTS \? LIGHTS\.wildplantLightPadCells\(\) \* scene\.cellM : 0\);/.test(body),
    'the wildplant box is the cull plus the widest plant light');
  assert.truthy(/WorldGen\.forEachItemInBox\(entry, 'wildplants', pWorldX - wM, pWorldY - wM, pWorldX \+ wM, pWorldY \+ wM, \(wp\) => \{/.test(body), 'so do wildplants');
  assert.gte(Lighting.wildplantLightPadCells(), Lighting.radiusCells('mushroom'), "at least a mushroom's glow");
  assert.lt(Lighting.wildplantLightPadCells(), Lighting.objectLightPadCells(), 'and narrower than the object lights');
  assert.falsy(/for \(const o of entry\.objects\)/.test(body), 'the flat walk of objects is gone');
  assert.falsy(/for \(const wp of entry\.wildplants\)/.test(body), 'and of wildplants');
  // The pad is the widest light a scanned object can throw: Home's ring,
  // which is the largest row; and a new row widens it by itself.
  const pad = Lighting.objectLightPadCells();
  assert.gte(pad, HOME_R, "at least Home's light (a house can be Home)");
  assert.gte(pad, Lighting.radiusCells('building'));
  assert.gte(pad, Lighting.radiusCells('torch'));
  assert.gte(pad, Lighting.radiusCells('mushroom'));
  assert.lt(pad, Lighting.radiusCells('player'), "never the player's own viewport-sized ramp");
});

test('chunk index: a light past the sprite cull is still offered, one past the query is not walked', () => {
  // The same fixture shape as boot_profiler's count test: drawObjects throws
  // against the minimal stub once past the counting loop, and the counts
  // were recorded before that.
  WorldGen.tileCache.clear();
  const cellM = 7;
  const halfM = (VIEW_CELLS / 2 + 1) * cellM;
  const pad = Lighting.objectLightPadCells() * cellM;
  // Outside the sprite cull, inside Home's OWN light (the query's pad is the
  // widest row, which may be wider — the grove shrine's).
  const nearLight = halfM + Lighting.radiusCells('trailer') * cellM - 1;
  const farOut = halfM + pad + 3 * WorldGen.CHUNK_M;   // chunks away from any query
  WorldGen.tileCache.set(`${WorldGen.Z}/0/0`, {
    objects: [
      { kind: 'house', x: nearLight, y: 0, id: 'h1' },
      { kind: 'house', x: farOut, y: 0, id: 'h2' },
      { kind: 'tree', x: 5, y: 0, id: 't1' },
    ],
  });
  const scene = {
    startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 },
    cellM, depth: 0,
    save: { picked: [], caught: [], planted: [], starterShopId: 'h1' },   // h1 is Home: the widest light
    viewCenterX: 176, viewCenterY: 176,
    placedRockSet: null, brokenRockSet: new Set(),
    isClaimedKey: () => false,
    playerToWorldCell() { return { tx: 0, ty: 0, cx: 0, cy: 0 }; },
  };
  const boot = makeBootStub();
  window.__boot = boot;
  try {
    try { Render.drawObjects(scene); } catch (_) { /* expected — no Phaser stub past the loop */ }
    const scanned = boot.lastCount('drawObjects scanned');
    // The tree once (the sprite walk); the near house by the light walk, and
    // by the sprite walk too when its chunk is one the sprite box opens (it
    // is left to the light walk from there). The far house by neither.
    const sM = halfM + 2.2 * cellM, C = WorldGen.CHUNK_M;
    const inSpriteChunks = Math.floor(nearLight / C) <= Math.floor(sM / C);
    assert.eq(scanned.n, 2 + (inSpriteChunks ? 1 : 0), 'the near house and the tree are walked; the far house never is');
    const lit = (scene._lights || []).map(L => L.id);
    assert.includes(lit, 'h1', "Home's light a cell past the sprite cull still reaches the lightmap");
  } finally {
    window.__boot = undefined;
    WorldGen.tileCache.clear();
  }
});

function visibleTrapsFlat(entries, halfM, disarmed, sprung) {
  const out = [];
  let candidates = 0;
  for (const entry of entries) {
    for (const tr of entry.traps || []) {
      candidates++;
      if (disarmed.has(tr.id)) continue;
      if (Math.abs(tr.x) > halfM || Math.abs(tr.y) > halfM) continue;
      out.push(`${tr.id}:${sprung.has(tr.id)}`);
    }
  }
  return { out, candidates };
}

function visibleTrapsIndexed(entries, halfM, disarmed, sprung) {
  const out = [];
  let candidates = 0;
  for (const entry of entries) {
    WorldGen.forEachItemInBox(entry, 'traps', -halfM, -halfM, halfM, halfM, tr => {
      candidates++;
      if (disarmed.has(tr.id)) return;
      if (Math.abs(tr.x) > halfM || Math.abs(tr.y) > halfM) return;
      out.push(`${tr.id}:${sprung.has(tr.id)}`);
    }, true);
  }
  return { out, candidates };
}

test('chunk index: trap queries preserve flat-scan visibility and draw order at viewport and tile edges', () => {
  const halfM = WorldGen.CHUNK_M;
  // Tile iteration order stays outside the index. Within each tile, positions
  // cross chunk boundaries in source-array order so this pins the order that
  // Render.renderPool assigns to trap sprites.
  const entries = [
    { traps: [
      { id: 'west-edge', x: -halfM, y: 0 },
      { id: 'east-edge', x: halfM, y: 0 },
      { id: 'sprung', x: 4, y: 4 },
      { id: 'far', x: halfM + WorldGen.CHUNK_M + 1, y: 0 },
    ] },
    { traps: [
      { id: 'tile-east', x: halfM - 1, y: 3 },
      { id: 'tile-west', x: -halfM + 1, y: -3 },
      { id: 'disarmed', x: 0, y: 0 },
    ] },
  ];
  const disarmed = new Set(['disarmed']);
  const sprung = new Set(['sprung']);
  const flat = visibleTrapsFlat(entries, halfM, disarmed, sprung);
  const indexed = visibleTrapsIndexed(entries, halfM, disarmed, sprung);
  assert.eq(indexed.out.join('|'), flat.out.join('|'), 'the indexed query keeps visible traps and their flat-scan order');
});

test('chunk index: a dense hard-mode trap tile visits a bounded candidate set', () => {
  const traps = [];
  // Hard mode can lay hundreds of traps on a tile. Spread 450 static marks
  // across a 640 m tile, then query a 160 m viewport at its centre.
  for (let i = 0; i < 450; i++) {
    traps.push({ id: `hard_${i}`, x: -320 + (i % 30) * 22, y: -320 + Math.floor(i / 30) * 44 });
  }
  const halfM = 80;
  const flat = visibleTrapsFlat([{ traps }], halfM, new Set(), new Set());
  const indexed = visibleTrapsIndexed([{ traps }], halfM, new Set(), new Set());
  assert.eq(indexed.out.join('|'), flat.out.join('|'), 'the bounded walk keeps the dense tile result and order');
  assert.lt(indexed.candidates, flat.candidates / 3, `the index visits ${indexed.candidates} candidates instead of ${flat.candidates}`);
});

test('chunk index: drawObjects indexes generated traps and keeps laid traps flat', () => {
  const body = RENDER_SRC.slice(RENDER_SRC.indexOf('Render.drawObjects = function drawObjects(scene)'));
  assert.truthy(/WorldGen\.forEachItemInBox\(entry, 'traps',\s*pWorldX - halfM, pWorldY - halfM, pWorldX \+ halfM, pWorldY \+ halfM, \(tr\) => \{/.test(body),
    'generated traps query only the static chunks that can touch the viewport');
  assert.falsy(/for \(const tr of entry\.traps\)/.test(body), 'the generated flat scan is gone');
  const generated = body.slice(body.indexOf("WorldGen.forEachItemInBox(entry, 'traps'"), body.indexOf('if (entry.laidTraps'));
  assert.truthy(/\}, true\);/.test(generated), 'the indexed query preserves the old source-array draw order');
  assert.truthy(/for \(const tr of entry\.laidTraps\)/.test(body), 'mutable laid traps keep their flat scan');
});

})();
