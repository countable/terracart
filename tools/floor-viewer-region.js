// The representative fake region for the floor viewer (and its smoke test):
// one tile of MVT-shaped layers - grass, forest, farmland, a residential grid
// with houses and a pitch, a commercial block, streets of every size, a small
// lake with a 5-cell beach (partly park-backed), a separate top-right park,
// and one nexus anchor of each kind (grove, quarry, reef, tar pit).
// Pure data: consumed by tools/floor-viewer.html and tools/smoke-floor-region.mjs.
(function (root) {
  'use strict';
  const E = 4096;                       // MVT extent space
  const N = 80;                         // cells per edge
  const CELL = E / N;                   // extent units per cell
  const lat = 47.62;                    // a mid-latitude row (EDGE derives from it)
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

    // Layers carry pre-extracted classes (the OpenMapTiles schema the
    // rasterizer reads): landcover for wood/sand, landuse for the built
    // classes, class on lines and POIs.
    landcover.push(poly({ class: 'wood' }, [cellRect(3, 3, 14, 12)]));
    landuse.push(poly({ class: 'farmland' }, [cellRect(2, 34, 22, 16)]));

    // Residential belt: lots between streets, houses as building polygons
    landuse.push(poly({ class: 'residential' }, [cellRect(28, 4, 26, 46)]));
    landuse.push(poly({ class: 'pitch' }, [cellRect(26, 54, 8, 5)]));  // clear of the house grid
    for (let by = 6; by < 44; by += 7) for (let bx = 30; bx < 50; bx += 8)
      building.push(poly({ building: 'house' }, [cellRect(bx, by, 4, 3)]));

    // Commercial block north-centre; mid-rise shop buildings + shop POIs
    landuse.push(poly({ class: 'commercial' }, [cellRect(30, 2, 22, 12)]));
    for (let bx = 32; bx < 50; bx += 7) building.push(poly({ building: 'retail' }, [cellRect(bx, 4, 5, 6)]));
    poi.push(point({ class: 'shop' }, 34, 5));
    poi.push(point({ class: 'shop' }, 41, 6));
    poi.push(point({ class: 'shop' }, 46, 5));

    // Top-right park (separate) with the grove nexus POI
    landuse.push(poly({ class: 'park' }, [cellRect(64, 2, 14, 11)]));
    poi.push(point({ class: 'park', subclass: 'park', name: 'Hilltop Park' }, 70, 7));

    // South-east: a small lake with a 5-cell beach on its north and west,
    // a park backing the western half of that beach, and the reef POI.
    const lx = 58, ly = 66, lw = 18, lh = 11;
    water.push(poly({ natural: 'water' }, [cellRect(lx, ly, lw, lh)]));
    landcover.push(poly({ class: 'sand' }, [
      cellRect(lx - 5, ly - 5, lw + 5, 5),             // north strip, 5 cells
      cellRect(lx - 5, ly, 5, lh),                     // west strip, 5 cells
    ]));
    landuse.push(poly({ class: 'park' }, [cellRect(47, ly - 10, 7, 5)]));  // backs the west beach, west of the primary
    poi.push(point({ class: 'beach', name: 'Lakeside Strand' }, lx + 6, ly + 5));

    // Tar-pit nexus: a fuel POI on the farmland edge
    poi.push(point({ class: 'fuel', subclass: 'fuel' }, 24, 33));
    // Quarry nexus: a worked rock patch south-west, clear of the water
    landuse.push(poly({ class: 'quarry' }, [cellRect(8, 54, 10, 8)]));

    // Streets of every size (transportation lines; widths come from the tags)
    transportation.push(line({ class: 'primary' }, [[55, 0], [55, 79]]));            // LG, full height
    transportation.push(line({ class: 'secondary' }, [[0, 52], [79, 52]]));          // MD, full width
    transportation.push(line({ class: 'minor' }, [[30, 4], [30, 49]]));        // minor streets
    transportation.push(line({ class: 'minor' }, [[40, 4], [40, 49]]));
    transportation.push(line({ class: 'minor' }, [[46, 4], [46, 49]]));
    transportation.push(line({ class: 'minor' }, [[28, 14], [54, 14]]));
    transportation.push(line({ class: 'minor' }, [[28, 28], [54, 28]]));
    transportation.push(line({ class: 'service' }, [[64, 26], [76, 26]]));           // service lane to the park
    transportation.push(line({ class: 'footway' }, [[70, 13], [70, 60]]));           // path down to the beach

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
