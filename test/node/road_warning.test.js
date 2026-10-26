function roadScene(bits, { depth = 0 } = {}) {
  WorldGen.tileCache.clear();
  const N = 4, tileEdgeM = 40;
  const roadClass = new Uint16Array(N * N);
  roadClass[1 * N + 1] = bits;
  WorldGen.tileCache.set(WorldGen.tileKey(0, 0), { cellsPerEdge: N, roadClass });
  return {
    depth,
    tileEdgeM,
    cellsPerTile: N,
    startWorldM: { x: 0, y: 0 },
    originPx: { x: 0, y: 0 },
    mPerPx: tileEdgeM / WorldGen.TILE_PX,
    playerM: { x: 15, y: 15 },
    save: { energy: 10, storySeen: {} },
  };
}

function liftedRoadSafetyClass() {
  const start = SCENE_SRC.indexOf('\n  _tickRoadSafety(now = Date.now()) {');
  const end = SCENE_SRC.indexOf('\n  }\n', start);
  assert.gte(start, 0, '_tickRoadSafety ships');
  return new Function(`return class {${SCENE_SRC.slice(start, end + 4)}}`)();
}

test('road warning: the majority-covered carriageway applies on the surface and every floor', () => {
  const B = WorldGen.ROAD_CLASS_MAJOR_BUFFER, R = WorldGen.ROAD_CLASS_MAJOR_ROAD;
  assert.falsy(RoadSafety.playerOnMajorRoad(roadScene(B)), 'the kerb buffer alone is not the road');
  for (const { depth } of WorldGen.FLOOR_PROFILES) {
    const cave = roadScene(B | R, { depth });
    assert.truthy(RoadSafety.majorRoadAt(cave, 15, 15), `depth ${depth}: road warning`);
    assert.truthy(RoadSafety.playerOnMajorRoad(cave), `depth ${depth}: player on the road`);
  }
  for (const depth of [WorldGen.SKY_DEPTH, WorldGen.ARENA_DEPTH]) {
    assert.falsy(RoadSafety.playerOnMajorRoad(roadScene(B | R, { depth })), `depth ${depth}: no road warning`);
  }
});

test('road warning: the carriageway card is once per UTC day and costs no energy', () => {
  const K = liftedRoadSafetyClass();
  const scene = Object.assign(new K(), roadScene(WorldGen.ROAD_CLASS_MAJOR_ROAD | WorldGen.ROAD_CLASS_MAJOR_BUFFER, { depth: 2 }));
  scene._bootOverlayGone = true;
  const cards = [];
  scene._showSafetyCard = which => cards.push(which);
  const day = Date.UTC(2026, 0, 2, 12);
  scene._tickRoadSafety(day);
  scene._tickRoadSafety(day + 1000);
  assert.eq(cards.join(','), 'road');
  assert.truthy(Macros.usedToday(scene.save, 'safety:roadstand', day));
  assert.eq(scene.save.energy, 10, 'standing on the road drains nothing');
  assert.eq(RoadSafety.ROAD_WARNING.lines[0], 'Do not play when standing on the road.');
});
