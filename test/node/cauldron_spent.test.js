// A golden cauldron (coin-burst POI) once tapped today is SPENT, the same
// state as an opened chest: hidden without an availability pulse until the
// UTC day rolls. Its ambient site light remains.

test('cauldron: a pot tapped today is spent, yesterday\'s is not', () => {
  const today = String(Delivery.dayKey());
  const pot = { kind: 'chest', id: 'c_12_34', poiClass: 'atm' };
  const save = { coinBurstClaimed: { [pot.id + today]: 1, ['c_9_9' + '20000101']: 1 } };
  const sets = spentSets(null, save);
  assert.truthy(isSpent(pot, sets), 'used today: hidden');
  assert.falsy(isSpent({ kind: 'chest', id: 'c_9_9', poiClass: 'atm' }, sets), 'a stale day is back');
  assert.falsy(isSpent(pot, spentSets(null, {})), 'never tapped: standing');
});

test('cauldron: a spent pot loses its availability pulse but keeps ambient light', () => {
  const src = RENDER_SRC;
  assert.truthy(/const burstSet = dayLedgerAges\(scene\.save\);/.test(src), 'built once per frame');
  assert.truthy(/opened: openedSet,\s*burst: burstSet,/.test(src), 'the frame sets carry the day ledger');
  assert.truthy(/const spent = isSpent\(o, spentIds\);[\s\S]{0,120}return !spent;/.test(src), 'and isSpent culls the sprite');
  const pot = { kind: 'chest', id: 'c_12_34', poiClass: 'atm' };
  const today = String(Delivery.dayKey());
  const save = { coinBurstClaimed: { [pot.id + today]: 1 } };
  const spent = spentSets(null, save);
  assert.falsy(poiLit(pot, spent), 'a used pot has no availability pulse');
  const scene = { save, cellM: 5, _lights: [] };
  const start = src.indexOf('  const offerPreCullLights = (o, dx, dy) => {');
  const end = src.indexOf('\n  };', start);
  const offer = new Function('scene', 'LIGHTS', 'Macros', 'isBuilding', 'poiLit', 'spentIds', 'halfM',
    src.slice(start, end + 5) + '; return offerPreCullLights;')(scene, Lighting, Macros, isBuilding, poiLit, spent, 30);
  offer(pot, 0, 0);
  assert.eq(scene._lights.length, 1, 'only the ambient light is offered');
  assert.eq(scene._lights[0].kind, Lighting.sourceKind(scene, pot));
  assert.falsy(scene._lights.some(light => light.kind === 'poi'), 'no duplicate availability light');
});

test('cauldron: a burst drops extra coins at the player\'s feet, and claims only what it pays', () => {
  const app = SCENE_SRC;
  const body = app.slice(app.indexOf('  _coinBurstInteract(sx, sy, poi) {'), app.indexOf('  _coinCellsNearPlayer(count, r, taken) {'));
  assert.truthy(/const nearN = Math\.min\(COIN_BURST_NEAR_PLAYER, Math\.floor\(burstN \/ 4\)\);/.test(body), 'a few by the player, a quarter at most');
  assert.truthy(/this\._coinCellsNearPlayer\(burstN - n, COIN_BURST_NEAR_R, taken\)/.test(body), 'the rest of the burst at the feet');
  // The claim comes AFTER the no-room bail, never before it — through the
  // ledger's one writer.
  const bail = body.indexOf("this.flash('No room to scatter!'");
  const claim = body.indexOf('visit.claim();');
  assert.truthy(bail > 0 && claim > bail, 'no room → nothing spent; the day is claimed only once coins land');
  assert.eq(body.split("'No room to scatter!'").length - 1, 1, 'one bail, after both searches');
  assert.truthy(/Scattered \$\{drops\.length\} coins!/.test(body), 'the flash says the real count');
});

test('cauldron: coins never lie in the road or a yard, wait ten minutes, and stay on the player\'s side', () => {
  // SAFETY (owner, Sep 2026): a coin used to be allowed in the carriageway and
  // in front gardens and to vanish after a minute — the strongest "run into
  // the street" push the audit found.
  const app = SCENE_SRC;
  assert.falsy(/function coinGround|function coinRoadCell/.test(app), 'the road-welcoming coin ground is gone');
  const life = Number(/const COIN_BURST_LIFE_MS = (\d+) \* 60 \* 1000;/.exec(app)?.[1]);
  assert.gte(life, 10, 'a burst waits at least ten minutes');
  const body = app.slice(app.indexOf('  _coinBurstInteract(sx, sy, poi) {'), app.indexOf('  _coinCellsNearPlayer(count, r, taken) {'));
  assert.truthy(/const expiresAt = Date\.now\(\) \+ COIN_BURST_LIFE_MS;/.test(body), 'the burst expires on it');
  assert.falsy(/60_000/.test(body), 'no one-minute coin');
  assert.truthy(/if \(!WorldGen\.isSpawnCell\(entry\.grid, N, N, cx, cy, burstOpts, 'attractor'\)\) continue;/.test(body),
    'the pot scatter is the shared spawn rule as an ATTRACTOR: off the road band, under nothing, no private yard, no buffer');
  assert.truthy(/spawnWhy: entry\.spawnWhy/.test(body), 'reading the tile\'s spawn gate');
  assert.truthy(/if \(WorldGen\.privateVetoAt\(tx, ty, cx, cy\)\) continue;/.test(body), 'and the live private-ground veto');
  assert.falsy(/strict|relax/i.test(body.replace(/\/\/.*$/gm, '')), 'no relaxed pass');
  assert.truthy(/sameSideAs\(this, /.test(body), 'and on the player\'s side of any major road');
  const near = app.slice(app.indexOf('  _coinCellsNearPlayer(count, r, taken) {'));
  const nearBody = near.slice(0, near.indexOf('\n  }\n'));
  assert.truthy(/WorldGen\.isSpawnCell\(entry\.grid, N, N, cx, cy, opts, 'minor'\)/.test(nearBody), 'the feet scatter too (a minor spawn: the player is there)');
  assert.truthy(/WorldGen\.privateVetoAt\(tx, ty, cx, cy\)/.test(nearBody), 'with the veto');
  assert.truthy(/sameSideAs\(this, /.test(nearBody), 'same side at the feet too');
  // A kill's coin is stepped off a road cell (or a yard) onto ground the
  // shared spawn rule allows, same as every other coin drop — not a bare
  // road/terrain test any more (Sep 2026: routed through THE SPAWN GATE).
  const drop = app.slice(app.indexOf('  _dropBountyCoin(victim, amount) {'));
  const dropBody = drop.slice(0, drop.indexOf('\n  }\n'));
  assert.truthy(/NEVER ON A ROAD OR IN A YARD/.test(dropBody), 'a bounty coin never lies in the road or a yard');
  assert.truthy(/WorldGen\.isSpawnCell\(entry\.grid, N, N, x, y, spawnOpts, 'minor'\)/.test(dropBody),
    'the nudge asks the shared spawn rule (a minor spawn), not a bare roadMask/terrain test');
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
  const body = SCENE_SRC.slice(SCENE_SRC.indexOf('  _coinBurstInteract(sx, sy, poi) {'), SCENE_SRC.indexOf('  _coinCellsNearPlayer(count, r, taken) {'));
  assert.truthy(/const burstN = potCoinsFor\(poi\.poiDensity\);/.test(body), 'the burst reads the pot\'s own count');
  assert.falsy(/COIN_BURST_MIN/.test(SCENE_SRC), 'the old flat floor is gone');
});

test('pot of gold: only an ATM — a bike rack is no pot', () => {
  assert.truthy(isPotOfGold({ kind: 'chest', poiClass: 'atm' }), 'an ATM');
  assert.falsy(isPotOfGold({ kind: 'chest', poiClass: 'bicycle_parking' }), 'not a bike rack');
  assert.falsy(isPotOfGold({ kind: 'chest', poiClass: 'atm', depth: 2 }), 'not underground');
  assert.eq(chestLook({ kind: 'chest', poiClass: 'bicycle_parking', poiDensity: 3 }).texKey, 'bike_rack', 'the rack wears its own art');
});
