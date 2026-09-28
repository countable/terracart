// A golden cauldron (coin-burst POI) once tapped today is SPENT, the same
// state as an opened chest: hidden and unlit until the UTC day rolls.

test('cauldron: a pot tapped today is spent, yesterday\'s is not', () => {
  const today = String(Delivery.dayKey());
  const pot = { kind: 'chest', id: 'c_12_34', poiClass: 'atm' };
  const save = { coinBurstClaimed: { [pot.id + today]: 1, ['c_9_9' + '20000101']: 1 } };
  const sets = spentSets(null, save);
  assert.truthy(isSpent(pot, sets), 'used today: hidden');
  assert.falsy(isSpent({ kind: 'chest', id: 'c_9_9', poiClass: 'atm' }, sets), 'a stale day is back');
  assert.falsy(isSpent(pot, spentSets(null, {})), 'never tapped: standing');
});

test('cauldron: the draw pass hides and unlights it through the same set', () => {
  const src = RENDER_SRC;
  assert.truthy(/const burstSet = dayLedgerAges\(scene\.save\);/.test(src), 'built once per frame');
  assert.truthy(/o\.kind === 'chest' && poiLit\(o, spentIds\)\) LIGHTS\.consider/.test(src), 'no POI glow (poiLit reads the frame sets)');
  assert.truthy(/opened: openedSet,\s*burst: burstSet,/.test(src), 'the frame sets carry the day ledger');
  assert.truthy(/const spent = isSpent\(o, spentIds\);[\s\S]{0,120}return !spent;/.test(src), 'and isSpent culls the sprite');
  const pot = { kind: 'chest', id: 'c_12_34', poiClass: 'atm' };
  const today = String(Delivery.dayKey());
  assert.falsy(poiLit(pot, spentSets(null, { coinBurstClaimed: { [pot.id + today]: 1 } })), 'a used pot is unlit');
});

test('cauldron: a burst drops extra coins at the player\'s feet, and claims only what it pays', () => {
  const app = APP_JS_SRC;
  const body = app.slice(app.indexOf('  _coinBurstInteract(sx, sy, poi) {'), app.indexOf('  _coinCellsNearPlayer(count, r, taken) {'));
  assert.truthy(/const nearN = Math\.min\(COIN_BURST_NEAR_PLAYER, Math\.floor\(burstN \/ 4\)\);/.test(body), 'a few by the player, a quarter at most');
  assert.truthy(/this\._coinCellsNearPlayer\(burstN - n, COIN_BURST_NEAR_R, taken\)/.test(body), 'the rest of the burst at the feet');
  // The claim comes AFTER the no-room bail, never before it — through the
  // ledger's one writer.
  const bail = body.indexOf("this.flash('No room to scatter!'");
  const claim = body.indexOf('Macros.markToday(this.save, poi.id);');
  assert.truthy(bail > 0 && claim > bail, 'no room → nothing spent; the day is claimed only once coins land');
  assert.eq(body.split("'No room to scatter!'").length - 1, 1, 'one bail, after both searches');
  assert.truthy(/Scattered \$\{drops\.length\} coins!/.test(body), 'the flash says the real count');
});

test('cauldron: coins may lie on a road, never in water or under anything', () => {
  const app = APP_JS_SRC;
  assert.truthy(/function coinGround\(t\) \{ return WorldGen\.isWalkable\(t\) \|\| WorldGen\.isRoadTerrain\(t\); \}/.test(app),
    'walkable ground or the road');
  const T = WorldGen.T;
  assert.truthy(WorldGen.isRoadTerrain(T.ROAD) && WorldGen.isRoadTerrain(T.ROAD_LG), 'the road tiers');
  assert.falsy(WorldGen.isRoadTerrain(T.WATER) || WorldGen.isRoadTerrain(T.GRASS), 'nothing else');
  const body = app.slice(app.indexOf('  _coinBurstInteract(sx, sy, poi) {'), app.indexOf('  _coinCellsNearPlayer(count, r, taken) {'));
  assert.truthy(/const onRoad = coinRoadCell\(entry, i\);/.test(body), 'the pot scatter takes road cells');
  const near = app.slice(app.indexOf('  _coinCellsNearPlayer(count, r, taken) {'));
  assert.falsy(/roadMask/.test(near.slice(0, near.indexOf('\n  }\n'))), 'the feet scatter does not refuse the road');
});

test('pot of gold: the burst is its density on its tile — 30 alone, 3 at 50, 1 at 150+', () => {
  assert.eq(potCoinsFor(1), 30, 'a lone pot');
  assert.eq(potCoinsFor(50), 3, 'one of fifty');
  assert.eq(potCoinsFor(150), 1, 'one of a hundred and fifty');
  assert.eq(potCoinsFor(5000), 1, 'never below one');
  assert.eq(potCoinsFor(undefined), 30, 'an unstamped pot counts as alone');
  let prev = Infinity;
  for (let n = 1; n <= 200; n++) {
    const c = potCoinsFor(n);
    assert.truthy(c >= 1 && c <= prev, `monotone, never below one (${n} → ${c})`);
    prev = c;
  }
  // Log-linear between the anchors: the geometric midpoint of 1..50 pays the
  // arithmetic middle of 30..3.
  assert.eq(potCoinsFor(Math.sqrt(50)), Math.round((30 + 3) / 2), 'log-linear in the count');
  const body = APP_JS_SRC.slice(APP_JS_SRC.indexOf('  _coinBurstInteract(sx, sy, poi) {'), APP_JS_SRC.indexOf('  _coinCellsNearPlayer(count, r, taken) {'));
  assert.truthy(/const burstN = potCoinsFor\(poi\.poiDensity\);/.test(body), 'the burst reads the pot\'s own count');
  assert.falsy(/COIN_BURST_MIN/.test(APP_JS_SRC), 'the old flat floor is gone');
});

test('pot of gold: only an ATM — a bike rack is no pot', () => {
  assert.truthy(isPotOfGold({ kind: 'chest', poiClass: 'atm' }), 'an ATM');
  assert.falsy(isPotOfGold({ kind: 'chest', poiClass: 'bicycle_parking' }), 'not a bike rack');
  assert.falsy(isPotOfGold({ kind: 'chest', poiClass: 'atm', depth: 2 }), 'not underground');
  assert.eq(chestLook({ kind: 'chest', poiClass: 'bicycle_parking', poiDensity: 3 }).texKey, 'bike_rack', 'the rack wears its own art');
});
