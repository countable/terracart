// Tests for src/placed_floor.js — the consolidated per-level isolation helper
// for placed floor-tile interactables (crops / scarecrows / fires / rocks).
//
// Motivation: the "scarecrow shows on every floor" bug (2026-06). The world is
// GPS-mirrored across levels (scene.depth 0 = surface, 1+ = caves), so anything
// stored by world coords leaks onto every level unless it's level-isolated.

// ─── placedDepth: untagged objects default to surface ────────────────────────

test('placedDepth: untagged object reads as surface (0)', () => {
  assert.eq(PlacedFloor.placedDepth({ x: 1, y: 2 }), 0, 'no depth field → 0');
});

test('placedDepth: explicit depth is returned as-is', () => {
  assert.eq(PlacedFloor.placedDepth({ x: 1, y: 2, depth: 3 }), 3, 'depth 3 preserved');
});

test('placedDepth: depth 0 is honoured (not treated as missing)', () => {
  assert.eq(PlacedFloor.placedDepth({ depth: 0 }), 0, 'explicit 0 stays 0');
});

// ─── stampDepth: writes the tag, defaults a missing level to surface ─────────

test('stampDepth: writes the level onto the object and returns it', () => {
  const o = {};
  const r = PlacedFloor.stampDepth(o, 2);
  assert.eq(o.depth, 2, 'depth written');
  assert.eq(r, o, 'returns the same object for chaining');
});

test('stampDepth: undefined/null level stamps surface (0)', () => {
  assert.eq(PlacedFloor.stampDepth({}, undefined).depth, 0, 'undefined → 0');
  assert.eq(PlacedFloor.stampDepth({}, null).depth, 0, 'null → 0');
});

// ─── onDepth: single-object membership for the level in play ─────────────────

test('onDepth: matches an object tagged for the current level', () => {
  assert.truthy(PlacedFloor.onDepth({ depth: 2 }, 2), 'depth 2 on level 2');
  assert.falsy(PlacedFloor.onDepth({ depth: 2 }, 0), 'depth 2 not on surface');
});

test('onDepth: untagged (legacy) object belongs to the surface', () => {
  assert.truthy(PlacedFloor.onDepth({ x: 0, y: 0 }, 0), 'legacy obj on surface');
  assert.falsy(PlacedFloor.onDepth({ x: 0, y: 0 }, 1), 'legacy obj not underground');
});

test('onDepth: undefined current level is treated as surface', () => {
  assert.truthy(PlacedFloor.onDepth({ depth: 0 }, undefined), 'undefined level → 0');
});

// ─── forDepth: array filter, the scarecrow-leak fix ──────────────────────────

test('forDepth: keeps only objects on the current level', () => {
  const list = [
    { x: 0, y: 0, depth: 0 },
    { x: 1, y: 1, depth: 1 },
    { x: 2, y: 2, depth: 0 },
    { x: 3, y: 3 },             // legacy → surface
  ];
  const surface = PlacedFloor.forDepth(list, 0);
  assert.eq(surface.length, 3, 'three surface items (two tagged + one legacy)');
  const cave1 = PlacedFloor.forDepth(list, 1);
  assert.eq(cave1.length, 1, 'one item on cave level 1');
  assert.eq(cave1[0].x, 1, 'the depth-1 item is the one kept');
});

test('forDepth: a scarecrow placed on the surface does NOT render in the cave', () => {
  // The exact regression: one surface scarecrow, viewed from depth 2.
  const scarecrows = [{ x: 10, y: 10, depth: 0 }];
  assert.eq(PlacedFloor.forDepth(scarecrows, 0).length, 1, 'visible on surface');
  assert.eq(PlacedFloor.forDepth(scarecrows, 2).length, 0, 'hidden two levels down');
});

test('forDepth: null/empty list yields an empty array (no throw)', () => {
  assert.eq(PlacedFloor.forDepth(null, 0).length, 0, 'null → []');
  assert.eq(PlacedFloor.forDepth(undefined, 1).length, 0, 'undefined → []');
  assert.eq(PlacedFloor.forDepth([], 0).length, 0, 'empty → []');
});

// ─── isSurface: gate for the Set-based surface-locked interactables ──────────

test('isSurface: true only on the surface', () => {
  assert.truthy(PlacedFloor.isSurface(0), 'depth 0 is surface');
  assert.truthy(PlacedFloor.isSurface(undefined), 'undefined defaults to surface');
  assert.falsy(PlacedFloor.isSurface(1), 'depth 1 is not surface');
  assert.falsy(PlacedFloor.isSurface(5), 'depth 5 is not surface');
});
