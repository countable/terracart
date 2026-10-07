// The representative fake region for the floor viewer (and its smoke test):
// one 50x50 tile of MVT-shaped layers - grass base, forest,
// a parking lot, church, a residential grid with houses and a pitch, a commercial block,
// streets of every size, a southeast lake with a 5-cell beach (partly
// park-backed), a separate top-right park, and one nexus anchor of each kind
// (grove, quarry, beach, tar pit, old stones).
// Pure data: consumed by tools/floor-viewer.html and test/node/floor_viewer_region.test.js.
(function (root) {
  'use strict';
  const E = 4096;                       // MVT extent space
  const N = 50;                         // cells per edge
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

    // Reuse the west strip: forest, parking-lot quarry, pitch, then church.
    landcover.push(poly({ class: 'wood' }, [cellRect(1, 1, 8, 7)]));
    landuse.push(poly({ class: 'parking' }, [cellRect(1, 9, 13, 11)]));
    landuse.push(poly({ class: 'pitch' }, [cellRect(1, 25, 9, 7)]));
    poi.push(point({ class: 'fuel', subclass: 'fuel' }, 12, 24));
    // Parking aisles are the live quarry-nexus source.
    transportation.push(line({ class: 'service', service: 'parking_aisle' }, [[4, 10], [12, 10], [12, 18], [4, 18], [4, 10]]));
    for (const y of [13, 16])
      transportation.push(line({ class: 'service', service: 'parking_aisle' }, [[4, y], [12, y]]));
    building.push(poly({ building: 'church' }, [cellRect(3, 40, 3, 3)]));
    poi.push(point({ class: 'place_of_worship', subclass: 'christian', name: 'Sandbox Church' }, 4, 41));

    // North band: commercial block, then the separate top-right park
    landuse.push(poly({ class: 'commercial' }, [cellRect(15, 1, 13, 6)]));
    building.push(poly({ building: 'retail' }, [cellRect(17, 2, 4, 4)]));
    building.push(poly({ building: 'retail' }, [cellRect(23, 2, 4, 4)]));
    poi.push(point({ class: 'shop' }, 18, 3));
    poi.push(point({ class: 'shop' }, 25, 4));
    // Compact park; oversized cave layouts report their placement limits.
    landuse.push(poly({ class: 'park' }, [cellRect(36, 1, 13, 8)]));
    poi.push(point({ class: 'park', subclass: 'park', name: 'Hilltop Park' }, 42, 4));

    // Residential belt between the west strip and the primary road, with a
    // house grid that leaves the minor streets clear
    landuse.push(poly({ class: 'residential' }, [cellRect(15, 8, 17, 22)]));
    for (const by of [9, 18, 25]) for (const bx of [16, 27])
      building.push(poly({ building: 'house' }, [cellRect(bx, by, 4, 3)]));

    // Small southeast lake, with the 5-cell beach on its north
    // and west, and a park backing the west half of the north beach
    const lx = 38, ly = 40;
    water.push(poly({ natural: 'water' }, [cellRect(lx, ly, 50 - lx, 50 - ly)]));
    landcover.push(poly({ class: 'sand' }, [
      cellRect(lx - 5, ly - 5, 50 - lx + 5, 5),   // north strip, 5 cells wide
      cellRect(lx - 5, ly, 5, 50 - ly),           // west strip, 5 cells wide
    ]));
    landuse.push(poly({ class: 'park' }, [cellRect(27, 35, 6, 5)]));  // backs the west half of the north beach
    poi.push(point({ class: 'beach', name: 'Lakeside Strand' }, lx + 4, ly - 2));

    // Streets of every size; widths come from the classes
    transportation.push(line({ class: 'primary' }, [[35, 0], [35, 49]]));       // LG, town height
    transportation.push(line({ class: 'secondary' }, [[0, 33], [49, 33]]));     // MD, town width
    transportation.push(line({ class: 'minor' }, [[22, 8], [22, 30]]));         // minor streets
    transportation.push(line({ class: 'minor' }, [[15, 16], [34, 16]]));
    transportation.push(line({ class: 'service' }, [[36, 3], [43, 3]]));        // service lane into the park
    transportation.push(line({ class: 'footway' }, [[40, 3], [40, 30]]));       // path down to the beach

    return [
      { name: 'water', extent: E, features: water },
      { name: 'landcover', extent: E, features: landcover },
      { name: 'landuse', extent: E, features: landuse },
      { name: 'building', extent: E, features: building },
      { name: 'transportation', extent: E, features: transportation },
      { name: 'poi', extent: E, features: poi },
    ];
  }

  root.FloorViewerRegion = { E, N, CELL, EDGE, lat, makeLayers };
})(typeof globalThis !== 'undefined' ? globalThis : window);
