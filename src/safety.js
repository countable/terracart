// Road safety - the shared night-road state, copy and tuning.
//
// Rendering, taps and energy all ask this module because a hidden object must
// not remain tappable or rewarding. The roadClass bits come from worldgen's
// generated road geometry; Lighting owns the real sun clock.

(function (root) {
  'use strict';

  // The sun on the horizon. The dusk reminder reads this same value, so its
  // warning and the red road zone begin together.
  const NIGHT_DAYLIGHT = 0.5;
  const DRAIN_PER_SECOND = 0.5;
  const GROUND_COLOR = 0x6f2428;
  const GROUND_ALPHA = 0.52;

  const NIGHT_STORY = Object.freeze({
    key: 'road:night',
    art: 'safety_phone',
    title: 'Night Roads',
    body: "Major roads at night are dangerous. It's best you ascend (turn off device) to avoid energy drain and accidents.",
  });
  const ROAD_WARNING = Object.freeze({
    card: 'road',
    ledger: 'safety:roadstand',
    title: '⚠ ON THE ROAD',
    lines: Object.freeze([
      'Do not play when standing on the road.',
      'Step back to the pavement before you look at the screen.',
    ]),
  });

  function isNight(scene, now = Date.now(), daylight) {
    if ((scene?.depth || 0) !== 0 || typeof Lighting === 'undefined') return false;
    const day = daylight == null ? Lighting.daylight(scene, now) : daylight;
    return day < NIGHT_DAYLIGHT;
  }

  // Read the generated road bits under one world-metre point. A missing or
  // loading tile is open because no safety geometry exists to display yet.
  function roadClassAt(scene, x, y) {
    if ((scene?.depth || 0) !== 0 || !scene?.startWorldM || !scene?.originPx || !(scene.mPerPx > 0)) return 0;
    const cell = worldMetersToTileCell(scene, x, y);
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(cell.tx, cell.ty));
    if (!entry?.roadClass || !(entry.cellsPerEdge > 0)) return 0;
    if (cell.ix < 0 || cell.iy < 0 || cell.ix >= entry.cellsPerEdge || cell.iy >= entry.cellsPerEdge) return 0;
    return entry.roadClass[cell.iy * entry.cellsPerEdge + cell.ix] | 0;
  }

  function nightRoadZone(scene, x, y, now = Date.now(), daylight) {
    return isNight(scene, now, daylight)
      && !!(roadClassAt(scene, x, y) & WorldGen.ROAD_CLASS_MAJOR_BUFFER);
  }

  function majorRoadAt(scene, x, y) {
    return !!(roadClassAt(scene, x, y) & WorldGen.ROAD_CLASS_MAJOR_ROAD);
  }

  function objectHidden(scene, object, activeNight) {
    if (!object || !Number.isFinite(object.x) || !Number.isFinite(object.y)) return false;
    const active = activeNight == null ? isNight(scene) : activeNight;
    return active && !!(roadClassAt(scene, object.x, object.y) & WorldGen.ROAD_CLASS_MAJOR_BUFFER);
  }

  // Resolve the player's feet once for the runtime tick. The warning reads the
  // majority-covered band; the drain and story read the wider kerb buffer.
  function playerState(scene, now = Date.now(), daylight) {
    if (!scene?.startWorldM || !scene?.playerM || (scene.depth || 0) !== 0) {
      return { x: 0, y: 0, nightZone: false, majorRoad: false };
    }
    const feet = playerWorldM(scene);
    const bits = roadClassAt(scene, feet.x, feet.y);
    const night = isNight(scene, now, daylight);
    return {
      x: feet.x,
      y: feet.y,
      nightZone: night && !!(bits & WorldGen.ROAD_CLASS_MAJOR_BUFFER),
      majorRoad: !!(bits & WorldGen.ROAD_CLASS_MAJOR_ROAD),
    };
  }

  // Bank fractional exposure and return whole pips for app.js to spend through
  // its Energy.set lane. Leaving the zone drops the partial pip, so two short
  // visits do not combine into a delayed charge somewhere safe.
  function drainPips(scene, dt, active) {
    if (!active || !(dt > 0)) {
      scene._nightRoadDrainAccum = 0;
      return 0;
    }
    return bankWhole(scene, '_nightRoadDrainAccum', DRAIN_PER_SECOND * dt);
  }

  root.RoadSafety = {
    NIGHT_DAYLIGHT,
    DRAIN_PER_SECOND,
    GROUND_COLOR,
    GROUND_ALPHA,
    NIGHT_STORY,
    ROAD_WARNING,
    isNight,
    roadClassAt,
    nightRoadZone,
    majorRoadAt,
    objectHidden,
    playerState,
    drainPips,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
