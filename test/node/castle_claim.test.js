// Claiming a castle: which castle it IS, what claiming does, and the hearth.
//
// WHY THE IDENTITY HALF EXISTS. A castle is the one building the data model
// has no object for. worldgen skips the sprite for BUILDING_LARGE, so a castle
// is a block of tier-12 cells with a scatter of `tower` objects round its rim
// — one per ~5 perimeter cells, each carrying its own id. A tower id therefore
// names A TURRET, and anything recorded against one made the same castle read
// as claimed from one corner and unclaimed from another. Every turret now
// carries its footprint's stable key, and exactly one of them flies the flag.
(function () {
const T = WorldGen.T;

// One tile of round numbers, same basis as spawn_roads.test.js.
const CC_CPE = 64;
const CC_TILE_EDGE_M = CC_CPE * 7;
const CC_CELL_MVT = 4096 / CC_CPE;
const ccMvt = (c) => c * CC_CELL_MVT + CC_CELL_MVT / 2;
const ccBox = (x0, y0, x1, y1) =>
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => ({ x: ccMvt(x), y: ccMvt(y) }));

// A tile with `n` big footprints on it. 20x20 cells is 140 m a side — 19,600 m²,
// comfortably past buildingTier's 1500 m² castle threshold.
function ccRasterize(boxes) {
  return WorldGen.rasterizeTile([
    { name: 'landuse', features: [{ type: 3, tags: { class: 'residential' },
      geom: [ccBox(0, 0, CC_CPE - 1, CC_CPE - 1)] }] },
    { name: 'building', features: boxes.map(b => ({
      type: 3, tags: { class: 'residential', render_height: 30 }, geom: [ccBox(...b)] })) },
  ], CC_CPE, 0, 0, CC_TILE_EDGE_M);
}
const ccTowers = (entry) => (entry.objects || []).filter(o => o.kind === 'tower');

// ── Identity ──────────────────────────────────────────────────────────────

test('castle identity: a castle really does emit turrets and no house object', () => {
  // The premise of everything below. If worldgen ever starts emitting a house
  // object for BUILDING_LARGE, the whole key-on-the-turret scheme is redundant
  // and this test is the one that says so.
  const entry = ccRasterize([[8, 8, 28, 28]]);
  assert.gt(ccTowers(entry).length, 1, 'a castle is several turrets');
  const big = (entry.objects || []).filter(o => o.kind === 'house' && o.tier === T.BUILDING_LARGE);
  assert.eq(big.length, 0, 'and no house object of its own');
});

test('castle identity: every turret of one castle agrees on the key', () => {
  const entry = ccRasterize([[8, 8, 28, 28]]);
  const towers = ccTowers(entry);
  const keys = new Set(towers.map(o => o.castle));
  assert.eq(keys.size, 1, `one castle, one key (got ${[...keys].join(', ')})`);
  for (const o of towers) assert.truthy(o.castle, `${o.id} knows its castle`);
});

test('castle identity: two castles get two keys', () => {
  const entry = ccRasterize([[4, 4, 24, 24], [36, 36, 56, 56]]);
  const keys = new Set(ccTowers(entry).map(o => o.castle));
  assert.eq(keys.size, 2, 'separate footprints are separate castles');
});

test('castle identity: exactly one turret per castle flies the flag', () => {
  // A castle with six turrets is still one place. Six banners would read as
  // six castles crammed together.
  const entry = ccRasterize([[4, 4, 24, 24], [36, 36, 56, 56]]);
  const towers = ccTowers(entry);
  const byCastle = new Map();
  for (const o of towers) {
    byCastle.set(o.castle, (byCastle.get(o.castle) || 0) + (o.flagPost ? 1 : 0));
  }
  assert.eq(byCastle.size, 2, 'two castles');
  for (const [key, flags] of byCastle) assert.eq(flags, 1, `${key} flies one flag`);
});

test('castle identity: the key is stable across a rebuild', () => {
  // A tile is re-rasterized on reload and every 30 days. A key that moved would
  // un-claim a castle the player had earned.
  const a = ccTowers(ccRasterize([[8, 8, 28, 28]])).map(o => `${o.id}:${o.castle}`).sort();
  const b = ccTowers(ccRasterize([[8, 8, 28, 28]])).map(o => `${o.id}:${o.castle}`).sort();
  assert.eq(b.join('|'), a.join('|'), 'same tile, same keys');
});

// ── Claiming, and the hearth ──────────────────────────────────────────────

const ccScene = (over = {}) => Object.assign({
  save: { energy: 40 },
  _maxE: 100,
  getMaxEnergy() { return this._maxE; },
  buildInventoryDOM() {},
  flashLoot() { this._flashes = (this._flashes || 0) + 1; },
}, CastleMethods, over);

const ccTower = (key) => ({ kind: 'tower', id: 'tw_1_2', castle: key });

test('castle claim: an unclaimed castle is unclaimed', () => {
  const s = ccScene();
  assert.falsy(s.isCastleClaimed(ccTower('b_1_1')), 'nothing claimed yet');
});

test('castle claim: claiming marks that castle and only that castle', () => {
  const s = ccScene();
  assert.truthy(s._claimCastle(ccTower('b_1_1')), 'the claim took');
  assert.truthy(s.isCastleClaimed(ccTower('b_1_1')), 'this castle is claimed');
  assert.falsy(s.isCastleClaimed(ccTower('b_9_9')), 'the one down the road is not');
});

test('castle claim: a claim survives being made twice', () => {
  const s = ccScene();
  s._claimCastle(ccTower('b_1_1'));
  assert.falsy(s._claimCastle(ccTower('b_1_1')), 'the second claim is a no-op');
  assert.truthy(s.isCastleClaimed(ccTower('b_1_1')), 'and it is still claimed');
});

test('castle claim: a claimed castle that has never fed you is still claimed', () => {
  // The stored value is the last hearth draw, and "claimed, never drawn" is 0
  // — falsy. Reading it for truth instead of presence un-claims every castle
  // the moment it is claimed.
  const s = ccScene();
  s._claimCastle(ccTower('b_1_1'));
  assert.eq(s.save.claimedCastles['b_1_1'], 0, 'stored as never-drawn');
  assert.truthy(s.isCastleClaimed(ccTower('b_1_1')), 'presence, not truthiness');
});

test('castle claim: a building with no castle key can never be claimed', () => {
  const s = ccScene();
  assert.falsy(s._claimCastle({ kind: 'house', id: 'h_1_2' }), 'an ordinary house');
  assert.falsy(s.isCastleClaimed({ kind: 'house', id: 'h_1_2' }), 'and it stays unclaimed');
  assert.falsy(s.isCastleClaimed(null), 'nor does nothing');
});

test('castle hearth: an unclaimed castle gives nothing', () => {
  const s = ccScene();
  s._castleHearth(0, 0, ccTower('b_1_1'));
  assert.eq(s.save.energy, 40, 'no claim, no hearth');
});

test('castle hearth: arriving at a claimed castle gives back a tenth of the bar', () => {
  const s = ccScene();
  const t = ccTower('b_1_1');
  s._claimCastle(t);
  s._castleHearth(0, 0, t);
  assert.eq(s.save.energy, 40 + Math.round(100 * CASTLE_REST_FRAC), 'a tenth of max');
});

test('castle hearth: it will not pour twice within the hour', () => {
  const s = ccScene();
  const t = ccTower('b_1_1');
  s._claimCastle(t);
  s._castleHearth(0, 0, t);
  const after = s.save.energy;
  s._castleHearth(0, 0, t);
  s._castleHearth(0, 0, t);
  assert.eq(s.save.energy, after, 'walking in and out changes nothing');
});

test('castle hearth: an hour later it pours again', () => {
  const s = ccScene();
  const t = ccTower('b_1_1');
  s._claimCastle(t);
  s._castleHearth(0, 0, t);
  const after = s.save.energy;
  s.save.claimedCastles['b_1_1'] = Date.now() - CASTLE_REST_COOLDOWN_MS - 1;
  s._castleHearth(0, 0, t);
  assert.gt(s.save.energy, after, 'the cooldown has run out');
});

test('castle hearth: the cooldown is per castle, not global', () => {
  const s = ccScene();
  const a = ccTower('b_1_1'), b = ccTower('b_9_9');
  s._claimCastle(a); s._claimCastle(b);
  s._castleHearth(0, 0, a);
  const afterA = s.save.energy;
  s._castleHearth(0, 0, b);
  assert.gt(s.save.energy, afterA, 'a second castle has its own hearth');
});

test('castle hearth: a full bar spends no cooldown', () => {
  // Nothing to give back, so nothing is taken: the player who walks in full
  // can still draw on it when they come back tired.
  const s = ccScene({ save: { energy: 100 } });
  const t = ccTower('b_1_1');
  s._claimCastle(t);
  s._castleHearth(0, 0, t);
  assert.eq(s.save.energy, 100, 'still full');
  assert.eq(s.save.claimedCastles['b_1_1'], 0, 'and the hour has not started');
  s.save.energy = 50;
  s._castleHearth(0, 0, t);
  assert.gt(s.save.energy, 50, 'so it pours when they actually need it');
});

test('castle hearth: it never overfills', () => {
  const s = ccScene({ save: { energy: 97 } });
  const t = ccTower('b_1_1');
  s._claimCastle(t);
  s._castleHearth(0, 0, t);
  assert.eq(s.save.energy, 100, 'clamped to max');
});
})();
