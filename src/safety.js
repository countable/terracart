// Road safety - the shared major-road warning and road-class lookup.
//
// The roadClass bits come from worldgen's generated road geometry.

(function (root) {
  'use strict';

  const ROAD_WARNING = Object.freeze({
    card: 'road',
    ledger: 'safety:roadstand',
    title: '⚠ ON THE ROAD',
    lines: Object.freeze([
      'Do not play when standing on the road.',
      'Step back to the pavement before you look at the screen.',
    ]),
  });

  // Underground floors retain the real-world road footprint. Sky and arena
  // spaces do not represent walking over the local road network.
  function hasRoadSafety(scene) {
    const depth = scene?.depth || 0;
    return depth >= 0 && depth !== WorldGen.ARENA_DEPTH;
  }

  // Read the generated road bits under one world-metre point. A missing or
  // loading tile is open because no safety geometry exists to display yet.
  function roadClassAt(scene, x, y) {
    if (!hasRoadSafety(scene) || !scene?.startWorldM || !scene?.originPx || !(scene.mPerPx > 0)) return 0;
    const cell = worldMetersToTileCell(scene, x, y);
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(cell.tx, cell.ty));
    if (!entry?.roadClass || !(entry.cellsPerEdge > 0)) return 0;
    if (cell.ix < 0 || cell.iy < 0 || cell.ix >= entry.cellsPerEdge || cell.iy >= entry.cellsPerEdge) return 0;
    return entry.roadClass[cell.iy * entry.cellsPerEdge + cell.ix] | 0;
  }

  function majorRoadAt(scene, x, y) {
    return !!(roadClassAt(scene, x, y) & WorldGen.ROAD_CLASS_MAJOR_ROAD);
  }

  // The warning reads the player's feet on the majority-covered band.
  function playerOnMajorRoad(scene) {
    if (!scene?.startWorldM || !scene?.playerM || !hasRoadSafety(scene)) return false;
    const feet = playerWorldM(scene);
    return majorRoadAt(scene, feet.x, feet.y);
  }

  root.RoadSafety = {
    ROAD_WARNING,
    roadClassAt,
    majorRoadAt,
    playerOnMajorRoad,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
