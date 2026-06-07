// Headless unit tests for src/mvt.js — exercises MVT.decodeTile() against a
// hand-built, fully valid MVT protobuf tile.  No network, no files, no Phaser.
//
// Patch-history motivation: e8547c2 fixed an mvt decode bug; these tests pin
// the geometry decoder (zigzag SVarint + command/count unpacking) and the
// tag resolver against known byte fixtures so regressions are caught immediately.

// TextDecoder is available in Node.js >= 11 but is NOT injected into the VM
// sandbox by run.js.  Inject it here so Reader.readString works when called
// from test assertions below.
if (typeof TextDecoder === 'undefined') {
  globalThis.TextDecoder = (function() {
    // Inside the VM context require is not available; use the outer-scope util
    // module if present, otherwise provide a minimal ASCII-only fallback
    // (sufficient for all strings used in these tests: "roads", "highway", etc.)
    try {
      return require('util').TextDecoder;
    } catch(e) {
      return function TextDecoderFallback(enc) {
        this.decode = function(bytes) {
          let s = '';
          for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
          return s;
        };
      };
    }
  })();
}

// ─────────────────────────────────────────────────────────────────────────────
// Wire-format helpers (local to this test file only)
// ─────────────────────────────────────────────────────────────────────────────

// Encode a non-negative integer as a protobuf varint (base-128, little-endian).
function encodeVarint(n) {
  const out = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128); // avoid bitwise to stay exact for large values
  }
  out.push(n & 0x7f);
  return out;
}

// Zigzag-encode a signed integer for sint wire type (field 6/sint64 etc.).
// Note: the geometry decoder in decodeGeometry uses unsigned varints already
// zig-zag encoded at the command level — so to encode dx/dy we zigzag first,
// then varint-encode the result.
function zigzag(v) {
  return v >= 0 ? v * 2 : (-v) * 2 - 1;
}

// Encode a string as a protobuf LEN field value (varint length prefix + UTF-8).
function encodeString(s) {
  const enc = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    // ASCII-only for our test strings; good enough.
    enc.push(c & 0xff);
  }
  return [...encodeVarint(enc.length), ...enc];
}

// Build a LEN-prefixed byte sequence (the payload of a wire-type-2 field).
function lenPrefixed(bytes) {
  return [...encodeVarint(bytes.length), ...bytes];
}

// Build a complete field tag byte(s): (fieldNum << 3) | wireType.
function fieldTag(fieldNum, wireType) {
  return encodeVarint((fieldNum << 3) | wireType);
}

// ─────────────────────────────────────────────────────────────────────────────
// Hand-build a tiny but complete MVT tile
//
// Tile structure:
//   Tile.layer (field 3, wire 2):
//     Layer.version  field 15, wire 0 = varint → 2
//     Layer.name     field  1, wire 2 = LEN    → "roads"
//     Layer.extent   field  5, wire 0 = varint → 4096
//     Layer.keys     field  3, wire 2 = LEN    → "highway"
//     Layer.values   field  4, wire 2 = LEN    → Value{string_value: "primary"}
//     Layer.feature  field  2, wire 2 = LEN    → Feature{...}
//
// Feature structure (inside the layer):
//   Feature.id       field 1, wire 0 → 42
//   Feature.tags     field 2, wire 2 → packed varints [0, 0]  (key[0]→value[0])
//   Feature.type     field 3, wire 0 → 2 (LineString)
//   Feature.geometry field 4, wire 2 → packed varints encoding a 3-point line
//
// Geometry encoding:
//   MoveTo count=1:  cmdInt = (1<<3)|1 = 9
//     dx=1, dy=1  → zigzag = 2, 2
//   LineTo count=2:  cmdInt = (2<<3)|2 = 18
//     dx=2, dy=0  → zigzag = 4, 0
//     dx=0, dy=2  → zigzag = 0, 4
//
//   Decoded absolute coords: (1,1) → (3,1) → (3,3)
// ─────────────────────────────────────────────────────────────────────────────

function buildFixtureTile() {
  // ── Value message: string_value = "primary"
  // Value.string_value is field 1, wire 2.
  const valueMsgBytes = [
    ...fieldTag(1, 2),        // field 1 LEN
    ...encodeString('primary'),
  ];

  // ── Geometry: packed varints for the 3-point line
  // [MoveTo(1), dx=1(zz=2), dy=1(zz=2), LineTo(2), dx=2(zz=4), dy=0(zz=0), dx=0(zz=0), dy=2(zz=4)]
  const geomRaw = [9, 2, 2, 18, 4, 0, 0, 4];
  // Each value < 128, so each encodes as a single byte.
  const geomVarints = [];
  for (const v of geomRaw) geomVarints.push(...encodeVarint(v));

  // ── Tags packed varints: [key_index=0, value_index=0]
  const tagVarints = [...encodeVarint(0), ...encodeVarint(0)];

  // ── Feature message
  const featureBytes = [
    ...fieldTag(1, 0), ...encodeVarint(42),          // id = 42
    ...fieldTag(2, 2), ...lenPrefixed(tagVarints),   // tags = [0,0]
    ...fieldTag(3, 0), ...encodeVarint(2),            // type = 2 (line)
    ...fieldTag(4, 2), ...lenPrefixed(geomVarints),  // geometry
  ];

  // ── Layer message
  const layerBytes = [
    ...fieldTag(15, 0), ...encodeVarint(2),                    // version = 2
    ...fieldTag(1, 2),  ...encodeString('roads'),              // name = "roads"
    ...fieldTag(5, 0),  ...encodeVarint(4096),                 // extent = 4096
    ...fieldTag(3, 2),  ...encodeString('highway'),            // key[0] = "highway"
    ...fieldTag(4, 2),  ...lenPrefixed(valueMsgBytes),         // value[0] = Value{...}
    ...fieldTag(2, 2),  ...lenPrefixed(featureBytes),          // feature[0]
  ];

  // ── Tile: field 3 (layers), wire 2
  const tileBytes = [
    ...fieldTag(3, 2), ...lenPrefixed(layerBytes),
  ];

  return new Uint8Array(tileBytes);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

test('MVT.decodeTile: empty buffer returns zero layers', () => {
  const layers = MVT.decodeTile(new Uint8Array(0));
  assert.eq(layers.length, 0, 'no layers for empty tile');
});

test('MVT.decodeTile: fixture tile decodes to one layer', () => {
  const tile = buildFixtureTile();
  const layers = MVT.decodeTile(tile);
  assert.eq(layers.length, 1, 'exactly one layer');
});

test('MVT.decodeTile: layer name is "roads"', () => {
  const layers = MVT.decodeTile(buildFixtureTile());
  assert.eq(layers[0].name, 'roads', 'layer name');
});

test('MVT.decodeTile: layer extent is 4096', () => {
  const layers = MVT.decodeTile(buildFixtureTile());
  assert.eq(layers[0].extent, 4096, 'layer extent');
});

test('MVT.decodeTile: layer has exactly one feature', () => {
  const layers = MVT.decodeTile(buildFixtureTile());
  assert.eq(layers[0].features.length, 1, 'one feature');
});

test('MVT.decodeTile: feature id decoded correctly', () => {
  const layers = MVT.decodeTile(buildFixtureTile());
  assert.eq(layers[0].features[0].id, 42, 'feature id = 42');
});

test('MVT.decodeTile: feature type decoded correctly (2 = LineString)', () => {
  const layers = MVT.decodeTile(buildFixtureTile());
  assert.eq(layers[0].features[0].type, 2, 'feature type = 2 (line)');
});

test('MVT.decodeTile: feature tag "highway" resolves to "primary"', () => {
  const layers = MVT.decodeTile(buildFixtureTile());
  const tags = layers[0].features[0].tags;
  assert.eq(tags['highway'], 'primary', 'tag highway=primary');
});

test('MVT.decodeTile: geometry has one ring (one MoveTo = one ring)', () => {
  const layers = MVT.decodeTile(buildFixtureTile());
  const geom = layers[0].features[0].geom;
  assert.eq(geom.length, 1, 'one ring from single MoveTo');
});

test('MVT.decodeTile: geometry ring has 3 points (MoveTo+2×LineTo)', () => {
  const layers = MVT.decodeTile(buildFixtureTile());
  const ring = layers[0].features[0].geom[0];
  assert.eq(ring.length, 3, '3 points in ring');
});

test('MVT.decodeTile: first point at (1,1) — MoveTo zigzag decode', () => {
  // MoveTo cmdInt=9, dx=2(zz→1), dy=2(zz→1): absolute (1,1)
  const layers = MVT.decodeTile(buildFixtureTile());
  const ring = layers[0].features[0].geom[0];
  assert.eq(ring[0].x, 1, 'p0.x = 1');
  assert.eq(ring[0].y, 1, 'p0.y = 1');
});

test('MVT.decodeTile: second point at (3,1) — LineTo dx=2 dy=0', () => {
  // LineTo delta dx=2,dy=0: 1+2=3, 1+0=1
  const layers = MVT.decodeTile(buildFixtureTile());
  const ring = layers[0].features[0].geom[0];
  assert.eq(ring[1].x, 3, 'p1.x = 3');
  assert.eq(ring[1].y, 1, 'p1.y = 1');
});

test('MVT.decodeTile: third point at (3,3) — LineTo dx=0 dy=2', () => {
  // LineTo delta dx=0,dy=2: 3+0=3, 1+2=3
  const layers = MVT.decodeTile(buildFixtureTile());
  const ring = layers[0].features[0].geom[0];
  assert.eq(ring[2].x, 3, 'p2.x = 3');
  assert.eq(ring[2].y, 3, 'p2.y = 3');
});

test('MVT.decodeTile: geometry with negative deltas (zigzag for negative coords)', () => {
  // Build a minimal tile with a single MoveTo using negative deltas:
  // dx=-1 → zigzag=1, dy=-2 → zigzag=3
  // Expected absolute: x=-1, y=-2
  const geomRaw = [
    (1 << 3) | 1,         // MoveTo count=1
    zigzag(-1),           // dx=-1 → 1
    zigzag(-2),           // dy=-2 → 3
  ];
  const geomVarints = [];
  for (const v of geomRaw) geomVarints.push(...encodeVarint(v));

  const featureBytes = [
    ...fieldTag(1, 0), ...encodeVarint(7),
    ...fieldTag(3, 0), ...encodeVarint(1),  // type=1 point
    ...fieldTag(4, 2), ...lenPrefixed(geomVarints),
  ];
  const layerBytes = [
    ...fieldTag(1, 2), ...encodeString('neg'),
    ...fieldTag(5, 0), ...encodeVarint(4096),
    ...fieldTag(2, 2), ...lenPrefixed(featureBytes),
  ];
  const tileBytes = [...fieldTag(3, 2), ...lenPrefixed(layerBytes)];
  const layers = MVT.decodeTile(new Uint8Array(tileBytes));

  assert.eq(layers[0].features[0].geom[0][0].x, -1, 'negative x decoded correctly');
  assert.eq(layers[0].features[0].geom[0][0].y, -2, 'negative y decoded correctly');
});

test('MVT.decodeTile: ClosePath (cmd=7) appends copy of first point', () => {
  // Build a closed polygon: MoveTo(2,2), LineTo(4,2), LineTo(4,4), ClosePath
  // After close, ring has 4 points, last = first = (2,2).
  const geomRaw = [
    (1 << 3) | 1,    // MoveTo count=1
    zigzag(2),       // dx=2 → 4
    zigzag(2),       // dy=2 → 4
    (2 << 3) | 2,    // LineTo count=2
    zigzag(2),       // dx=2
    zigzag(0),       // dy=0
    zigzag(0),       // dx=0
    zigzag(2),       // dy=2
    7,               // ClosePath cmdInt: cmd=7, count=0 → (0<<3)|7
  ];
  const geomVarints = [];
  for (const v of geomRaw) geomVarints.push(...encodeVarint(v));

  const featureBytes = [
    ...fieldTag(3, 0), ...encodeVarint(3),  // type=3 polygon
    ...fieldTag(4, 2), ...lenPrefixed(geomVarints),
  ];
  const layerBytes = [
    ...fieldTag(1, 2), ...encodeString('poly'),
    ...fieldTag(5, 0), ...encodeVarint(4096),
    ...fieldTag(2, 2), ...lenPrefixed(featureBytes),
  ];
  const tileBytes = [...fieldTag(3, 2), ...lenPrefixed(layerBytes)];
  const layers = MVT.decodeTile(new Uint8Array(tileBytes));

  const ring = layers[0].features[0].geom[0];
  assert.eq(ring.length, 4, 'ClosePath adds a 4th point');
  assert.eq(ring[3].x, ring[0].x, 'close: last.x = first.x');
  assert.eq(ring[3].y, ring[0].y, 'close: last.y = first.y');
});

test('MVT.decodeTile: value decoded as uint (field 5 in Value)', () => {
  // Build a tile with a uint64 value (value field 5, wire 0).
  const valueMsgBytes = [
    ...fieldTag(5, 0), ...encodeVarint(999),
  ];
  const tagVarints = [...encodeVarint(0), ...encodeVarint(0)];
  const geomRaw = [(1 << 3) | 1, zigzag(0), zigzag(0)];
  const geomVarints = [];
  for (const v of geomRaw) geomVarints.push(...encodeVarint(v));

  const featureBytes = [
    ...fieldTag(1, 0), ...encodeVarint(1),
    ...fieldTag(2, 2), ...lenPrefixed(tagVarints),
    ...fieldTag(3, 0), ...encodeVarint(1),
    ...fieldTag(4, 2), ...lenPrefixed(geomVarints),
  ];
  const layerBytes = [
    ...fieldTag(1, 2), ...encodeString('meta'),
    ...fieldTag(5, 0), ...encodeVarint(4096),
    ...fieldTag(3, 2), ...encodeString('count'),
    ...fieldTag(4, 2), ...lenPrefixed(valueMsgBytes),
    ...fieldTag(2, 2), ...lenPrefixed(featureBytes),
  ];
  const tileBytes = [...fieldTag(3, 2), ...lenPrefixed(layerBytes)];
  const layers = MVT.decodeTile(new Uint8Array(tileBytes));
  assert.eq(layers[0].features[0].tags['count'], 999, 'uint64 value decoded = 999');
});

test('MVT.decodeTile: value decoded as bool (field 7 in Value)', () => {
  const valueMsgBytes = [
    ...fieldTag(7, 0), ...encodeVarint(1),
  ];
  const tagVarints = [...encodeVarint(0), ...encodeVarint(0)];
  const geomRaw = [(1 << 3) | 1, zigzag(0), zigzag(0)];
  const geomVarints = [];
  for (const v of geomRaw) geomVarints.push(...encodeVarint(v));

  const featureBytes = [
    ...fieldTag(2, 2), ...lenPrefixed(tagVarints),
    ...fieldTag(3, 0), ...encodeVarint(1),
    ...fieldTag(4, 2), ...lenPrefixed(geomVarints),
  ];
  const layerBytes = [
    ...fieldTag(1, 2), ...encodeString('flags'),
    ...fieldTag(5, 0), ...encodeVarint(4096),
    ...fieldTag(3, 2), ...encodeString('one_way'),
    ...fieldTag(4, 2), ...lenPrefixed(valueMsgBytes),
    ...fieldTag(2, 2), ...lenPrefixed(featureBytes),
  ];
  const tileBytes = [...fieldTag(3, 2), ...lenPrefixed(layerBytes)];
  const layers = MVT.decodeTile(new Uint8Array(tileBytes));
  assert.eq(layers[0].features[0].tags['one_way'], true, 'bool value decoded = true');
});

test('MVT.decodeTile: two features in one layer both decoded', () => {
  const geomRaw = [(1 << 3) | 1, zigzag(1), zigzag(1)];
  const geomVarints = [];
  for (const v of geomRaw) geomVarints.push(...encodeVarint(v));

  const featureBytes1 = [
    ...fieldTag(1, 0), ...encodeVarint(10),
    ...fieldTag(3, 0), ...encodeVarint(1),
    ...fieldTag(4, 2), ...lenPrefixed(geomVarints),
  ];
  const featureBytes2 = [
    ...fieldTag(1, 0), ...encodeVarint(20),
    ...fieldTag(3, 0), ...encodeVarint(1),
    ...fieldTag(4, 2), ...lenPrefixed(geomVarints),
  ];
  const layerBytes = [
    ...fieldTag(1, 2), ...encodeString('pts'),
    ...fieldTag(5, 0), ...encodeVarint(4096),
    ...fieldTag(2, 2), ...lenPrefixed(featureBytes1),
    ...fieldTag(2, 2), ...lenPrefixed(featureBytes2),
  ];
  const tileBytes = [...fieldTag(3, 2), ...lenPrefixed(layerBytes)];
  const layers = MVT.decodeTile(new Uint8Array(tileBytes));

  assert.eq(layers[0].features.length, 2, 'two features decoded');
  assert.eq(layers[0].features[0].id, 10, 'first feature id=10');
  assert.eq(layers[0].features[1].id, 20, 'second feature id=20');
});

test('MVT.decodeTile: two layers in one tile both decoded', () => {
  const makeLayer = (name) => {
    const geomRaw = [(1 << 3) | 1, zigzag(0), zigzag(0)];
    const geomVarints = [];
    for (const v of geomRaw) geomVarints.push(...encodeVarint(v));
    const featureBytes = [
      ...fieldTag(3, 0), ...encodeVarint(1),
      ...fieldTag(4, 2), ...lenPrefixed(geomVarints),
    ];
    return [
      ...fieldTag(1, 2), ...encodeString(name),
      ...fieldTag(5, 0), ...encodeVarint(4096),
      ...fieldTag(2, 2), ...lenPrefixed(featureBytes),
    ];
  };

  const tileBytes = [
    ...fieldTag(3, 2), ...lenPrefixed(makeLayer('water')),
    ...fieldTag(3, 2), ...lenPrefixed(makeLayer('land')),
  ];
  const layers = MVT.decodeTile(new Uint8Array(tileBytes));
  assert.eq(layers.length, 2, 'two layers decoded');
  assert.eq(layers[0].name, 'water', 'first layer name = water');
  assert.eq(layers[1].name, 'land', 'second layer name = land');
});

test('MVT.decodeTile: feature default id is 0 when absent', () => {
  const geomRaw = [(1 << 3) | 1, zigzag(0), zigzag(0)];
  const geomVarints = [];
  for (const v of geomRaw) geomVarints.push(...encodeVarint(v));
  const featureBytes = [
    ...fieldTag(3, 0), ...encodeVarint(1),
    ...fieldTag(4, 2), ...lenPrefixed(geomVarints),
  ];
  const layerBytes = [
    ...fieldTag(1, 2), ...encodeString('x'),
    ...fieldTag(5, 0), ...encodeVarint(4096),
    ...fieldTag(2, 2), ...lenPrefixed(featureBytes),
  ];
  const tileBytes = [...fieldTag(3, 2), ...lenPrefixed(layerBytes)];
  const layers = MVT.decodeTile(new Uint8Array(tileBytes));
  assert.eq(layers[0].features[0].id, 0, 'default id = 0 when omitted');
});

test('MVT.decodeTile: default extent is 4096 when absent', () => {
  const geomRaw = [(1 << 3) | 1, zigzag(0), zigzag(0)];
  const geomVarints = [];
  for (const v of geomRaw) geomVarints.push(...encodeVarint(v));
  const featureBytes = [
    ...fieldTag(3, 0), ...encodeVarint(1),
    ...fieldTag(4, 2), ...lenPrefixed(geomVarints),
  ];
  // No extent field in layer
  const layerBytes = [
    ...fieldTag(1, 2), ...encodeString('noext'),
    ...fieldTag(2, 2), ...lenPrefixed(featureBytes),
  ];
  const tileBytes = [...fieldTag(3, 2), ...lenPrefixed(layerBytes)];
  const layers = MVT.decodeTile(new Uint8Array(tileBytes));
  assert.eq(layers[0].extent, 4096, 'default extent = 4096');
});
