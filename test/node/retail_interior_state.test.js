(function () {
  const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  function fixture() {
    const cache = new Map();
    const world = { tileCache: cache, tileKey: (x, y) => `${x}/${y}` };
    const active = liftSceneMethod('activeInterior', {
      WorldGen: world,
      worldMetersToTile: (s, x, y) => ({ tx: Math.floor(x / 100), ty: Math.floor(y / 100) }),
    });
    const scene = { depth: 0, save: { starterShopId: 'home' },
      startWorldM: { x: 1000, y: 1000 }, playerM: { x: 5, y: 5 },
      homeInterior: () => null, activeInterior: active };
    const retail = { key: 'mall', rings: [rect(1000, 1000, 50, 50), rect(1020, 1020, 10, 10)] };
    cache.set('10/10', { retailInteriors: [retail] });
    return { scene, cache, retail };
  }
  test('retail interior: exact body position enters and exits, including courtyard holes', () => {
    const { scene, retail } = fixture();
    const inside = scene.activeInterior();
    assert.eq(inside.kind, 'retail');
    assert.eq(inside.key, 'mall');
    assert.eq(inside.buildingKey, 'mall');
    assert.eq(inside.ring, retail.rings[0]);
    assert.eq(inside.holes[0], retail.rings[1]);
    scene.playerM = { x: 25, y: 25 };
    assert.eq(scene.activeInterior(), null, 'courtyard is outside');
    scene.playerM = { x: 50.01, y: 5 };
    assert.eq(scene.activeInterior(), null, 'exit follows the footprint, not the cell');
  });
  test('retail interior: surface only and Home takes precedence', () => {
    const { scene } = fixture();
    scene.homeInterior = () => ({ key: 'home@1005,1005', ring: rect(1000, 1000, 10, 10) });
    assert.eq(scene.activeInterior().kind, 'home');
    assert.eq(scene.activeInterior().buildingKey, 'home');
    scene.depth = 1;
    assert.eq(scene.activeInterior(), null);
  });
  test('retail interior: late loaded distant owning tile works without moving the player', () => {
    const { scene, cache, retail } = fixture();
    cache.clear();
    assert.eq(scene.activeInterior(), null);
    cache.set('5/5', { retailInteriors: [retail] });
    assert.eq(scene.activeInterior().key, 'mall', 'large footprints can cross several tiles');
    cache.clear();
    assert.eq(scene.activeInterior(), null, 'eviction drops occupancy');
  });
  test('retail interior: peeking out keeps the room, peeking in does not enter it', () => {
    const { scene } = fixture();
    scene._peekM = { x: 9000, y: 9000 };
    assert.eq(scene.activeInterior().key, 'mall');
    scene.playerM = { x: 90, y: 90 };
    scene._peekM = { x: -85, y: -85 };
    assert.eq(scene.activeInterior(), null);
  });
})();
