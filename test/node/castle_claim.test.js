// Claiming a castle: which castle it IS, what claiming does, and what it
// gives once it's the player's: a daily tax, and a feast every twelve hours.
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

// ── Claiming, and the daily favour ──────────────────────────────────────────

const ccScene = (over = {}) => Object.assign({
  save: SaveState.defaults({ energy: 40 }),
  _maxE: 100,
  getMaxEnergy() { return this._maxE; },
  buildInventoryDOM() {},
  _popEnergy() {},
  _flyTaxCoins(from, n) { (this._flights ||= []).push(n); },
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

test('castle service: an unclaimed castle gives nothing, either way', () => {
  const s = ccScene();
  s._castleFeast(0, 0, ccTower('b_1_1'));
  assert.eq(s.save.energy, 40, 'no claim, no feast');
  assert.eq(s._collectTax(ccTower('b_1_1'), 0), 0, 'no claim, no tax either');
  assert.eq(s.save.money ?? 0, 0);
});

test('castle service: a feast fills the bar and leaves you too full to eat for a minute', () => {
  const s = ccScene();
  const t = ccTower('b_1_1');
  s._claimCastle(t);
  const t0 = Date.now();
  s._castleFeast(0, 0, t);
  assert.eq(s.save.energy, 100, 'the whole bar, whatever it was');
  assert.falsy(Energy.canEat(s.save, t0 + 59_000), 'still full just short of the minute');
  assert.truthy(Energy.canEat(s.save, t0 + Energy.FEAST_COOLDOWN_MS + 1000), 'hungry again after it');
  assert.eq(s.save.money ?? 0, 0, 'and no coin changed hands');
});

test('castle service: the tax is Houses.TAX_GOLD.castle, flown in once a UTC day', () => {
  const s = ccScene();
  const t = ccTower('b_1_1');
  s._claimCastle(t);
  assert.eq(Houses.TAX_GOLD.castle, 10);
  assert.eq(s._collectTax(t, 0), Houses.TAX_GOLD.castle, 'the day\'s take');
  assert.eq(s.save.money, Houses.TAX_GOLD.castle, 'into the purse');
  assert.eq(JSON.stringify(s._flights), JSON.stringify([Houses.TAX_GOLD.castle]), 'and the coins fly');
  assert.eq(s._collectTax(t, 0), 0, 'once a day');
  assert.eq(s.save.money, Houses.TAX_GOLD.castle);
  assert.eq(s.save.energy, 40, 'the tax spends no feast');
  s._castleFeast(0, 0, t);
  assert.eq(s.save.energy, 100, 'and the feast is still on after it');
  assert.eq(s._collectTax(ccTower('b_9_9'), 0), 0, 'an unclaimed castle down the road pays nothing');
});

test('castle service: it will not feast twice', () => {
  const s = ccScene();
  const t = ccTower('b_1_1');
  s._claimCastle(t);
  s._castleFeast(0, 0, t);
  s.save.energy = 40;
  s._castleFeast(0, 0, t);
  assert.eq(s.save.energy, 40, 'walking in and out changes nothing');
});

test('castle service: twelve hours on it feasts again — not a minute sooner', () => {
  const s = ccScene();
  const t = ccTower('b_1_1');
  s._claimCastle(t);
  s._castleFeast(0, 0, t);
  s.save.energy = 40;
  assert.eq(Houses.CASTLE_SERVICE_MS, 12 * 60 * 60 * 1000, 'the feast comes round twice a day');
  s.save.castleServiceClaimed['b_1_1'] = Date.now() - Houses.CASTLE_SERVICE_MS + 60 * 1000;   // 11h59 ago
  s._castleFeast(0, 0, t);
  assert.eq(s.save.energy, 40, 'still spent a minute short');
  s.save.castleServiceClaimed['b_1_1'] = Date.now() - Houses.CASTLE_SERVICE_MS - 1;           // 12h ago
  s._castleFeast(0, 0, t);
  assert.eq(s.save.energy, 100, 'the twelve hours are up');
});

test('castle service: the gate is per castle, not global', () => {
  const s = ccScene();
  const a = ccTower('b_1_1'), b = ccTower('b_9_9');
  s._claimCastle(a); s._claimCastle(b);
  s._castleFeast(0, 0, a);
  s.save.energy = 40;
  s._castleFeast(0, 0, b);
  assert.eq(s.save.energy, 100, 'a second castle has its own feast');
});

// ── The guard for hire (owner, Nov 2026: "some restored castles should offer
// mercenaries for sale") ─────────────────────────────────────────────────────
// One claimed castle in CastleStyles.MERCENARY_ONE_IN hires out a sword: the
// wagon's own hire (Macros.offerMercenary — Companions.KINDS.mercenary's price
// and contract), offered beside the castellan's feast.

const ccKeys = (want, n = 2) => {
  const out = [];
  for (let x = 0; out.length < n; x++) {
    const key = `b_${x}_${x * 3}`;
    if (CastleStyles.hiresMercenaries(key) === want) out.push(key);
  }
  return out;
};
const ccHireScene = (over = {}) => {
  const s = ccScene(Object.assign({
    _offers: [], _confirms: [], _stories: [], _msgs: [],
    presentCastleServiceOffer: SceneShops.prototype.presentCastleServiceOffer,
    _castleHire: SceneShops.prototype._castleHire,
    moneyHTML: (n) => `${n}c`,
    showOfferModal(m) { this._offers.push(m); },
    showConfirmModal(m) { this._confirms.push(m); },
    showMessageModal(m) { this._stories.push(m); },
    flash(m) { this._msgs.push(m); },
  }, over));
  return s;
};

test('castle guard for hire: about one castle in three, fixed by its key, across every style', () => {
  assert.eq(CastleStyles.MERCENARY_ONE_IN, 3);
  let hit = 0, n = 0;
  const styles = new Map();
  for (let x = -40; x < 40; x++) for (let y = -40; y < 40; y++) {
    const key = `b_${x * 37}_${y * 53}`, h = CastleStyles.hiresMercenaries(key);
    assert.eq(CastleStyles.hiresMercenaries(key), h, 'the same castle answers the same');
    n++; hit += h ? 1 : 0;
    const v = CastleStyles.variantFor(key), row = styles.get(v) || [0, 0];
    row[0]++; row[1] += h ? 1 : 0; styles.set(v, row);
  }
  assert.gt(hit / n, 0.28, `about a third (${hit}/${n})`);
  assert.lt(hit / n, 0.39, `about a third (${hit}/${n})`);
  for (const [v, [all, hires]] of styles) assert.gt(hires / all, 0.2, `${v} castles hire out guards too`);
  assert.falsy(CastleStyles.hiresMercenaries(null), 'no key, no guard');
});

test('castle guard for hire: only a claimed castle hires, and only a picked one', () => {
  const s = ccHireScene();
  const [yes] = ccKeys(true, 1), [no] = ccKeys(false, 1);
  assert.falsy(Houses.castleHiresMercenaries(s.save, ccTower(yes)), 'not the player\'s yet');
  s._claimCastle(ccTower(yes)); s._claimCastle(ccTower(no));
  assert.truthy(Houses.castleHiresMercenaries(s.save, ccTower(yes)), 'claimed and picked');
  assert.falsy(Houses.castleHiresMercenaries(s.save, ccTower(no)), 'claimed but not picked');
  assert.falsy(Houses.castleHiresMercenaries(s.save, { kind: 'house', id: 'h_1_2' }), 'never a house');
});

test('castle guard for hire: the feast dialog adds the wagon\'s hire, at its price, and the feast is unchanged', () => {
  const [yes] = ccKeys(true, 1), [no] = ccKeys(false, 1);
  const s = ccHireScene();
  s._claimCastle(ccTower(yes)); s._claimCastle(ccTower(no));
  s.presentCastleServiceOffer(0, 0, ccTower(no));
  assert.eq(s._offers.length, 1);
  assert.eq(s._offers[0].secondary, undefined, 'an ordinary castle offers the feast alone');
  s.presentCastleServiceOffer(0, 0, ccTower(yes));
  const offer = s._offers[1];
  assert.eq(offer.acceptLabel, 'Feast', 'the feast stays the main act');
  assert.truthy(offer.secondary.label.includes(`${Companions.KINDS.mercenary.hireCost}c`), 'priced off Companions.KINDS.mercenary');
  const money = s.save.money;   // the day's tax has just flown in
  s.save.money = money + Companions.KINDS.mercenary.hireCost;
  offer.secondary.onClick();
  assert.eq(s._confirms.length, 1, 'the wagon\'s confirm');
  assert.eq(s.save.money, money + Companions.KINDS.mercenary.hireCost, 'nothing paid before the yes');
  const t0 = Date.now();
  s._confirms[0].onAccept(); s._confirms[0].onAccept();
  assert.eq(s.save.money, money, 'paid once');
  assert.gte(s.save.mercenaryUntil, t0 + Companions.KINDS.mercenary.durationMs, 'the wagon\'s contract');
  assert.eq(s._stories.length, 1);
  assert.eq(s._stories[0].title, Macros.DAILY_VISIT_KINDS.castle.mercenary.name);
  assert.eq(s.save.energy, 40, 'hiring spends no feast');
  offer.onAccept();
  assert.eq(s.save.energy, 100, 'and the feast is still there');
});

test('castle guard for hire: a spent feast goes straight to the hire; refusals are the wagon\'s', () => {
  const [yes] = ccKeys(true, 1), [no] = ccKeys(false, 1);
  const s = ccHireScene();
  const t = ccTower(yes);
  s._claimCastle(t); s._claimCastle(ccTower(no));
  s._castleFeast(0, 0, t); s._castleFeast(0, 0, ccTower(no));
  s.presentCastleServiceOffer(0, 0, ccTower(no));
  assert.eq(s._confirms.length + s._offers.length, 0, 'an ordinary castle only names its wait');
  assert.truthy(/^The castellan is away — /.test(s._msgs[0]), s._msgs[0]);
  s.save.money = 0;
  s.presentCastleServiceOffer(0, 0, t);   // its own day's tax: 10 coins
  assert.truthy(s._msgs.includes(`Need ${Companions.KINDS.mercenary.hireCost} coins to hire.`), 'too poor: the wagon\'s refusal');
  s.save.money = 100;
  s.presentCastleServiceOffer(0, 0, t);
  assert.eq(s._confirms.length, 1, 'with the feast spent, the guard is offered at once');
  s._confirms[0].onAccept();
  assert.truthy(Companions.active(s.save, 'mercenary'));
  const before = s._msgs.length;
  s.presentCastleServiceOffer(0, 0, t);
  assert.eq(s._confirms.length, 1, 'one sword at a time');
  assert.eq(s._msgs.length, before + 1, 'just the castellan\'s wait');
});

})();
