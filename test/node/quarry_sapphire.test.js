(function () {
const key = WorldGen.tileKey(0, 0);
const gem = GEM_DEPOSITS[quarryGemDeposit('100,200')].item;
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

test('quarry mining: first rock guarantees the assigned gem, later rocks have a 10 percent chance', () => quarryTest((s, mine, entry, chance) => {
  mine('first');
  assert.eq(s.invCount(gem), 1);
  assert.eq(s.modals[0].art, gem === 'sapphire' ? 'quarry_sapphire' : undefined);
  assert.eq(s.modals[0].kind, 'story');
  assert.eq(s.modals[0].body, `Inside the rock... ${ITEM_BY_ID[gem].name}.\n<em>precious...</em>`);
  s.save = JSON.parse(JSON.stringify(s.save));
  mine('after-reload');
  assert.eq(s.invCount(gem), 1, 'the saved quarry ledger survives reload');
  chance(0.1); mine('boundary');
  assert.eq(s.invCount(gem), 1, 'exactly 10 percent is outside the bonus');
  chance(0.099); mine('bonus');
  assert.eq(s.invCount(gem), 2);
  assert.eq(s.modals.length, 2);
  chance(0.99); entry.zone.anchors[0].gx++;
  mine('another-quarry');
  const nextGem = GEM_DEPOSITS[quarryGemDeposit('101,200')].item;
  assert.eq(s.invCount(nextGem), nextGem === gem ? 3 : 1, 'a different quarry has its own first rock');
}));

test('quarry mining: existing assigned deposit satisfies the guarantee without doubling it', () => quarryTest((s, mine) => {
  mine('crystal', { deposit: quarryGemDeposit('100,200') });
  assert.eq(s.invCount(gem), 1);
  mine('next');
  assert.eq(s.invCount(gem), 1);
}));

test('quarry mining: ordinary land and underground rocks get no quarry bonus', () => quarryTest((s, mine, entry) => {
  entry.zone.idx[0] = 0;
  mine('ordinary');
  assert.eq(s.invCount(gem), 0);
  entry.zone.idx[0] = 1; s.depth = 1;
  mine('cave');
  assert.eq(s.invCount(gem), 0);
  assert.eq(Object.keys(s.save.quarryMined).length, 0, 'no quarry recorded');
}));

test('quarry mining: canceled work does not consume the first gem', () => quarryTest((s) => {
  s.startWorkProgress = () => {};
  runInteractable(makeCtx(s, s.save), { id: 'canceled', kind: 'mineralrock', x: 1, y: 1, yieldTier: 1 });
  assert.eq(s.invCount(gem), 0);
  assert.eq(Object.keys(s.save.quarryMined).length, 0, 'no quarry recorded');
}));
test('quarry mining: every allowed gem has a matching discovery panel without duplicate rewards', () => quarryTest((s, mine, entry) => {
  const found = new Set();
  s.renderItemIcon = (id, size) => `<span data-item="${id}" data-size="${size}"></span>`;
  for (let gx = 0; gx < 200 && found.size < 4; gx++) {
    entry.zone.anchors[0].gx = gx;
    const quarryId = `${gx},200`, deposit = quarryGemDeposit(quarryId), item = GEM_DEPOSITS[deposit].item;
    if (found.has(item)) continue;
    found.add(item);
    const before = s.invCount(item);
    mine('assigned-' + gx, { deposit, quarryId });
    assert.eq(s.invCount(item), before + 1);
    const panel = s.modals[s.modals.length - 1];
    assert.includes(panel.body, ITEM_BY_ID[item].name);
    assert.includes(panel.body, `data-item="${item}"`);
    assert.eq(panel.art, item === 'sapphire' ? 'quarry_sapphire' : undefined);
    s.depth = 1;
    mine('below-' + gx, { deposit, quarryId });
    assert.eq(s.invCount(item), before + 2, 'first cave floor pays once');
    s.depth = 0;
  }
  assert.eq(found.size, 4);
  for (const item of ['ruby', 'emerald', 'diamond']) assert.eq(s.invCount(item), 0);
}));
test('quarry mining: ore gem rolls never introduce ruby or higher into a quarry', () => quarryTest((s, mine, entry, chance) => {
  chance(0);
  for (const depth of [0, 1]) {
    s.depth = depth;
    for (const yieldTier of [4, 5, 6, 7]) {
      mine(`ore-${depth}-${yieldTier}`, { yieldTier, quarryId: '100,200' });
      for (const item of ['ruby', 'emerald', 'diamond']) assert.eq(s.invCount(item), 0);
    }
  }
  assert.eq(s.invCount(gem), 8, 'one assigned gem per successful ore gem roll');
}));
})();
