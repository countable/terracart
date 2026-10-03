(function () {
const key = WorldGen.tileKey(0, 0);
function quarryTest(fn) {
  const old = WorldGen.tileCache.get(key), random = Math.random;
  let chance = 0.99;
  const entry = { cellsPerEdge: 2, zone: {
    anchors: [{ kind: 'quarry', gx: 100, gy: 200 }],
    idx: new Uint8Array([1, 1, 0, 0]), s: new Uint8Array([255, 255, 0, 0]),
  } };
  WorldGen.tileCache.set(key, entry);
  Math.random = () => chance;
  const s = makeScene({ save: { relics: {}, caught: [], opened: [] },
    cellAt: () => ({ tx: 0, ty: 0, ix: 0, iy: 0 }), modals: [],
    showMessageModal(o) { this.modals.push(o); } });
  const mine = (id, extra = {}) => INTERACTABLES.mineralrock.complete(makeCtx(s, s.save), {
    id: `quarry-${id}`, kind: 'mineralrock', x: 1, y: 1, yieldTier: 1, ...extra,
  });
  try { fn(s, mine, entry, n => { chance = n; }); }
  finally {
    Math.random = random;
    if (old) WorldGen.tileCache.set(key, old); else WorldGen.tileCache.delete(key);
  }
}

test('quarry mining: first rock guarantees one sapphire, later rocks have a 10 percent chance', () => quarryTest((s, mine, entry, chance) => {
  mine('first');
  assert.eq(s.invCount('sapphire'), 1);
  assert.eq(s.modals[0].art, 'quarry_sapphire');
  assert.eq(s.modals[0].body, 'Inside the rock... a glowing sapphire.\n<em>precious...</em>');
  s.save = JSON.parse(JSON.stringify(s.save));
  mine('after-reload');
  assert.eq(s.invCount('sapphire'), 1, 'the saved quarry ledger survives reload');
  chance(0.1); mine('boundary');
  assert.eq(s.invCount('sapphire'), 1, 'exactly 10 percent is outside the bonus');
  chance(0.099); mine('bonus');
  assert.eq(s.invCount('sapphire'), 2);
  assert.eq(s.modals.length, 2);
  chance(0.99); entry.zone.anchors[0].gx++;
  mine('another-quarry');
  assert.eq(s.invCount('sapphire'), 3, 'a different quarry has its own first rock');
}));

test('quarry mining: existing crystal sapphire satisfies the guarantee without doubling it', () => quarryTest((s, mine) => {
  mine('crystal', { deposit: 'crystal' });
  assert.eq(s.invCount('sapphire'), 1);
  mine('next');
  assert.eq(s.invCount('sapphire'), 1);
}));

test('quarry mining: ordinary land and underground rocks get no quarry bonus', () => quarryTest((s, mine, entry) => {
  entry.zone.idx[0] = 0;
  mine('ordinary');
  assert.eq(s.invCount('sapphire'), 0);
  entry.zone.idx[0] = 1; s.depth = 1;
  mine('cave');
  assert.eq(s.invCount('sapphire'), 0);
  assert.eq(Object.keys(s.save.quarryMined).length, 0, 'no quarry recorded');
}));

test('quarry mining: canceled work does not consume the first sapphire', () => quarryTest((s) => {
  s.startWorkProgress = () => {};
  runInteractable(makeCtx(s, s.save), { id: 'canceled', kind: 'mineralrock', x: 1, y: 1, yieldTier: 1 });
  assert.eq(s.invCount('sapphire'), 0);
  assert.eq(Object.keys(s.save.quarryMined).length, 0, 'no quarry recorded');
}));
})();
