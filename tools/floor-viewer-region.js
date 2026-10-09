// The representative fake region for the floor viewer (and its smoke test):
// one 60x35 viewport of MVT-shaped layers - grass base, forest,
// a parking lot, church, a residential grid with houses, a commercial block,
// streets of every size, a southeast lake with a 5-cell beach,
// a separate top-right grove, and one nexus anchor of each kind
// (grove, quarry, beach, tar pit, old stones).
// Consumed by tools/floor-viewer.html and test/node/floor_viewer_region.test.js.
(function (root) {
  'use strict';
  const E = 4096;                       // MVT extent space
  const WIDTH = 60, HEIGHT = 35;        // visible cells
  const N = Math.max(WIDTH, HEIGHT);     // square backing tile required by WorldGen
  const CELL = E / N;                   // extent units per cell
  const lat = 47.62;                    // a mid-latitude row for cave loading
  const HOME = { x: 25.5, y: 12.5 };     // player start in the residential grid
  const EDGE = Math.round(N * 7);       // tile edge in metres (7 m cells)

  // Review-only: salt both coordinate RNG streams and stable habitat hashes.
  // Seed zero preserves the shipping generators' original draws. Restore the
  // shared hooks even on failure so another build cannot inherit this seed.
  async function withSeed(seed, build) {
    const originalHash = root.fnv1a;
    seed >>>= 0;
    root.WorldGen.setReviewSalt(seed);
    if (seed) root.fnv1a = value => originalHash(`floor-viewer:${seed}|${value}`);
    try { return await build(); }
    finally {
      root.fnv1a = originalHash;
      root.WorldGen.setReviewSalt(0);
    }
  }

  // Radius scales preserve the requested area reductions. Scope them to this
  // fixture so its compact preview never changes the live game's nexus sizes.
  async function withNexusSizes(build) {
    const sizes = { grove: Math.sqrt(.7), stones: Math.sqrt(.85) };
    const originals = Object.fromEntries(Object.keys(sizes).map(kind => [kind, root.Zones.ZONE_KINDS[kind].R]));
    try {
      for (const [kind, scale] of Object.entries(sizes)) root.Zones.ZONE_KINDS[kind].R *= scale;
      return await build();
    } finally {
      for (const [kind, radius] of Object.entries(originals)) root.Zones.ZONE_KINDS[kind].R = radius;
    }
  }

  const cellRect = (cx, cy, w, h) => [
    [cx * CELL, cy * CELL], [(cx + w) * CELL, cy * CELL],
    [(cx + w) * CELL, (cy + h) * CELL], [cx * CELL, (cy + h) * CELL],
  ];
  const poly = (tags, rings) => ({ type: 3, tags, geom: rings.map(ring => ring.map(([x, y]) => ({ x, y }))) });
  const line = (tags, pts) => ({ type: 2, tags, geom: [pts.map(([x, y]) => ({ x: x * CELL, y: y * CELL }))] });
  const point = (tags, cx, cy) => ({ type: 1, tags, geom: [[{ x: (cx + .5) * CELL, y: (cy + .5) * CELL }]] });

  function makeLayers() {
    const landcover = [], landuse = [], transportation = [], building = [], poi = [], water = [];

    // Urban zoning fills the quadrant bounded by the major and medium roads.
    // Nexus sources remain inside the urban background.
    landuse.push(poly({ class: 'commercial' }, [cellRect(0, 0, 36, 6)]));
    landuse.push(poly({ class: 'residential' }, [cellRect(15, 6, 23, 18)]));
    // Forest occupies the eastern grass below the grove and above the beach.
    landcover.push(poly({ class: 'wood' }, [cellRect(45, 10, 14, 9)]));
    // The parking POI and aisles define the lot without commercial zoning,
    // which would let nearby private POIs cut diagonally through its coverage.
    poi.push(point({ class: 'parking', name: 'Market Parking' }, 7, 15));
    // The southern tar yard replaces the sports pitch.
    poi.push(point({ class: 'fuel', subclass: 'fuel' }, 21, 30));
    // Parking aisles generate the quarry without a separate dirt-ground polygon.
    transportation.push(line({ class: 'service', service: 'parking_aisle' }, [[2, 8], [12, 8], [12, 21], [2, 21], [2, 8]]));
    for (const y of [12, 15, 18])
      transportation.push(line({ class: 'service', service: 'parking_aisle' }, [[2, y], [12, y]]));
    building.push(poly({ building: 'church' }, [cellRect(3, 28, 3, 2.5)]));
    poi.push(point({ class: 'place_of_worship', subclass: 'christian', name: 'Sandbox Church' }, 4, 29));

    // North band: commercial block, then the separate top-right grove.
    building.push(poly({ building: 'retail' }, [cellRect(17, 1, 4, 3)]));
    building.push(poly({ building: 'retail' }, [cellRect(23, 1, 4, 3)]));
    poi.push(point({ class: 'shop' }, 18, 3));
    poi.push(point({ class: 'shop' }, 25, 2));
    // Compact park; oversized cave layouts report their placement limits.
    landuse.push(poly({ class: 'park', name: 'Hilltop Park' }, [cellRect(44, 1, 14, 6.5)]));
    poi.push(point({ class: 'park', subclass: 'park', name: 'Hilltop Park' }, 51, 4));

    // The house grid leaves the minor streets and nexus sites clear.
    for (const by of [7, 12, 19]) for (const bx of [16, 27, 33])
      building.push(poly({ building: 'house' }, [cellRect(bx, by, 3, 2)]));

    // Small southeast lake, with the 5-cell beach on its north
    // and west. The former beach-side park is now open grass.
    const lx = 48, ly = 27;
    water.push(poly({ natural: 'water' }, [cellRect(lx, ly, WIDTH - lx, HEIGHT - ly)]));
    landcover.push(poly({ class: 'sand' }, [
      cellRect(lx - 5, ly - 5, WIDTH - lx + 5, 5),   // north strip, 5 cells wide
      cellRect(lx - 5, ly, 5, HEIGHT - ly),           // west strip, 5 cells wide
    ]));
    poi.push(point({ class: 'beach', name: 'Lakeside Strand' }, lx + 4, ly - 2));

    // Streets of every size; widths come from the classes
    transportation.push(line({ class: 'primary' }, [[39, 0], [39, HEIGHT - 1]]));       // LG, town height
    transportation.push(line({ class: 'secondary' }, [[0, 24], [42, 24]]));     // MD, town to beach
    transportation.push(line({ class: 'minor' }, [[22, 6], [22, 23]]));         // minor streets
    transportation.push(line({ class: 'minor' }, [[15, 16], [38, 16]]));
    transportation.push(line({ class: 'minor' }, [[31, 6], [31, 23]]));
    transportation.push(line({ class: 'minor' }, [[15, 10], [38, 10]]));
    transportation.push(line({ class: 'service' }, [[40, 3], [52, 3]]));        // service lane into the park
    transportation.push(line({ class: 'footway' }, [[50, 3], [50, 20]]));       // path down to the beach

    return [
      { name: 'park', extent: E, features: landuse.filter(f => f.tags.class === 'park') },
      { name: 'water', extent: E, features: water },
      { name: 'landcover', extent: E, features: landcover },
      { name: 'landuse', extent: E, features: landuse },
      { name: 'building', extent: E, features: building },
      { name: 'transportation', extent: E, features: transportation },
      { name: 'poi', extent: E, features: poi },
    ];
  }

  // Label seats in the same cell frame as the source geometry.
  const labels = [
    { text: 'Commercial', x: 16, y: 1 },
    { text: 'Residential', x: 25, y: 13 },
    { text: 'Parking lot · Quarry nexus', nexusKind: 'quarry', x: 7.5, y: 15 },
    { text: 'Tar Yard nexus', nexusKind: 'tar', x: 21.5, y: 30.5 },
    { text: 'Church · Old Stones nexus', nexusKind: 'stones', x: 8, y: 30 },
    { text: 'Park · Grove nexus', nexusKind: 'grove', x: 51, y: 4 },
    { text: 'Forest', x: 55, y: 15 },
    { text: 'Grassland', x: 32, y: 30 },
    { text: 'Beach nexus', nexusKind: 'beach', x: 53, y: 23 },
    { text: 'Lake', x: 54, y: 31 }
  ];
  root.FloorViewerRegion = { E, WIDTH, HEIGHT, N, CELL, EDGE, HOME, lat, makeLayers, labels, withNexusSizes, withSeed };
})(typeof globalThis !== 'undefined' ? globalThis : window);
