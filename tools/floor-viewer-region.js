// The representative fake region for the floor viewer (and its smoke test):
// one 60x35 viewport of MVT-shaped layers - grass base, forest,
// a parking lot, church, a residential grid with houses and a pitch, a commercial block,
// streets of every size, a southeast lake with a 5-cell beach (partly
// park-backed), a separate top-right park, and one nexus anchor of each kind
// (grove, quarry, beach, tar pit, old stones).
// Pure data: consumed by tools/floor-viewer.html and test/node/floor_viewer_region.test.js.
(function (root) {
  'use strict';
  const E = 4096;                       // MVT extent space
  const WIDTH = 60, HEIGHT = 35;        // visible cells
  const N = Math.max(WIDTH, HEIGHT);     // square backing tile required by WorldGen
  const CELL = E / N;                   // extent units per cell
  const lat = 47.62;                    // a mid-latitude row for cave loading
  const EDGE = Math.round(N * 7);       // tile edge in metres (7 m cells)

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
    landuse.push(poly({ class: 'commercial' }, [cellRect(0, 0, 39, 8)]));
    landuse.push(poly({ class: 'residential' }, [cellRect(0, 8, 39, 16)]));
    // Forest occupies the eastern grass below the grove and above the beach.
    landcover.push(poly({ class: 'wood' }, [cellRect(43, 10, 17, 7)]));
    landcover.push(poly({ class: 'wood' }, [cellRect(49, 17, 11, 5)]));
    // Paved commercial parking: a bare landuse=parking tag falls through to
    // wasteland. The parking POI and aisles supply the real lot identity.
    landuse.push(poly({ class: 'commercial', amenity: 'parking' }, [cellRect(1, 9, 13, 11)]));
    poi.push(point({ class: 'parking', name: 'Market Parking' }, 7, 14));
    // West-side parking-lot quarry, southern pitch and church.
    landuse.push(poly({ class: 'pitch' }, [cellRect(17, 27, 9, 7)]));
    poi.push(point({ class: 'fuel', subclass: 'fuel' }, 31, 17));
    // Parking aisles generate the quarry without a separate dirt-ground polygon.
    transportation.push(line({ class: 'service', service: 'parking_aisle' }, [[4, 10], [12, 10], [12, 18], [4, 18], [4, 10]]));
    for (const y of [13, 16])
      transportation.push(line({ class: 'service', service: 'parking_aisle' }, [[4, y], [12, y]]));
    building.push(poly({ building: 'church' }, [cellRect(3, 28, 3, 3)]));
    poi.push(point({ class: 'place_of_worship', subclass: 'christian', name: 'Sandbox Church' }, 4, 29));

    // North band: commercial block, then the separate top-right park
    building.push(poly({ building: 'retail' }, [cellRect(17, 2, 4, 4)]));
    building.push(poly({ building: 'retail' }, [cellRect(23, 2, 4, 4)]));
    poi.push(point({ class: 'shop' }, 18, 3));
    poi.push(point({ class: 'shop' }, 25, 4));
    // Compact park; oversized cave layouts report their placement limits.
    landuse.push(poly({ class: 'park' }, [cellRect(43, 1, 16, 8)]));
    poi.push(point({ class: 'park', subclass: 'park', name: 'Hilltop Park' }, 51, 4));

    // The house grid leaves the minor streets and nexus sites clear.
    for (const by of [9, 19]) for (const bx of [16, 27])
      building.push(poly({ building: 'house' }, [cellRect(bx, by, 4, 3)]));

    // Small southeast lake, with the 5-cell beach on its north
    // and west, and a park backing the west half of the north beach
    const lx = 48, ly = 27;
    water.push(poly({ natural: 'water' }, [cellRect(lx, ly, WIDTH - lx, HEIGHT - ly)]));
    landcover.push(poly({ class: 'sand' }, [
      cellRect(lx - 5, ly - 5, WIDTH - lx + 5, 5),   // north strip, 5 cells wide
      cellRect(lx - 5, ly, 5, HEIGHT - ly),           // west strip, 5 cells wide
    ]));
    landuse.push(poly({ class: 'park' }, [cellRect(43, 17, 6, 5)]));  // backs the west half of the north beach
    poi.push(point({ class: 'beach', name: 'Lakeside Strand' }, lx + 4, ly - 2));

    // Streets of every size; widths come from the classes
    transportation.push(line({ class: 'primary' }, [[39, 0], [39, HEIGHT - 1]]));       // LG, town height
    transportation.push(line({ class: 'secondary' }, [[0, 24], [42, 24]]));     // MD, town to beach
    transportation.push(line({ class: 'minor' }, [[22, 8], [22, 23]]));         // minor streets
    transportation.push(line({ class: 'minor' }, [[15, 16], [38, 16]]));
    transportation.push(line({ class: 'service' }, [[40, 3], [52, 3]]));        // service lane into the park
    transportation.push(line({ class: 'footway' }, [[50, 3], [50, 20]]));       // path down to the beach

    return [
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
    { text: 'Parking lot · Quarry nexus', x: 7.5, y: 12 },
    { text: 'Tar Yard nexus', x: 32, y: 18 },
    { text: 'Sports pitch', x: 21, y: 30 },
    { text: 'Church · Old Stones nexus', x: 8, y: 30 },
    { text: 'Park · Grove nexus', x: 51, y: 4 },
    { text: 'Forest', x: 55, y: 15 },
    { text: 'Grassland', x: 32, y: 30 },
    { text: 'Park', x: 46, y: 19 },
    { text: 'Beach nexus', x: 53, y: 23 },
    { text: 'Lake', x: 54, y: 31 }
  ];
  root.FloorViewerRegion = { E, WIDTH, HEIGHT, N, CELL, EDGE, lat, makeLayers, labels };
})(typeof globalThis !== 'undefined' ? globalThis : window);
