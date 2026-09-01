// The fog-of-war WASH (src/render.js).
//
// The fog used to be drawn as Graphics fills: concentric shells of 32px rects
// off the boundary of explored ground, with hashed corner bites. That softened
// the frontier without ever making it stop being made of cells — a 32px alpha
// step reads as a UI element laid on the world, and the bites just turned the
// staircase into chamfered tiles. It is a continuous ALPHA FIELD now, painted
// into a canvas texture at FOG_SUB samples per cell and smooth-upscaled.
//
// Four things about that field are easy to break silently, and this pins them:
//
//   • the DISTANCE field — how far each cell is from revealed ground
//     (fogDistField, pure);
//   • the RAMP — continuous, monotone, and still landing exactly on FOG_ALPHA
//     at the interior. Softening the edge must not lighten the claim;
//   • the WISPS — world-keyed (so they don't crawl as the player walks) and
//     TAPERED to nothing at both ends of the ramp, which is what keeps ground
//     the player has walked clear and the interior at full strength;
//   • the SAMPLING — a bilinear read lands exactly on a cell's own value at
//     that cell's centre, which is the other half of "explored stays clear".

const FIELD_R = FOG_FIELD_R;            // the kernel's reach in cells

// Build a W×W bit square with `seed(x, y)` deciding each cell, in the same
// coordinate space fogDistField reports on: (0,0) is the first REPORTED cell,
// so the margin runs from -FIELD_R.
function distField(D, seed) {
  const W = D + 2 * FIELD_R;
  const bits = new Uint8Array(W * W);
  for (let r = 0; r < W; r++) {
    for (let c = 0; c < W; c++) bits[r * W + c] = seed(c - FIELD_R, r - FIELD_R) ? 1 : 0;
  }
  const dist = fogDistField(bits, W, null);
  return { dist, D, at: (x, y) => dist[y * D + x] };
}

test('fog field: revealed ground is distance 0', () => {
  const { at } = distField(7, () => 1);
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
    assert.eq(at(x, y), 0, `fully explored ground at ${x},${y}`);
  }
});

test('fog field: unexplored ground with nothing near it saturates the ramp', () => {
  const { at } = distField(7, () => 0);
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
    assert.eq(at(x, y), FOG_RAMP_CELLS, `open unknown at ${x},${y}`);
  }
});

test('fog field: the distance is a real euclidean distance, clamped at the ramp', () => {
  // One revealed cell at the centre of an 11×11 window.
  const { at } = distField(11, (x, y) => x === 5 && y === 5);
  assert.eq(at(5, 5), 0, 'the revealed cell itself');
  assert.eq(at(6, 5), 1 - FOG_EDGE_BIAS, 'orthogonally touching it');
  assert.lt(Math.abs(at(6, 6) - (Math.SQRT2 - FOG_EDGE_BIAS)), 1e-6, 'diagonally touching it');
  assert.eq(at(7, 5), 2 - FOG_EDGE_BIAS, 'two cells out');
  assert.lt(Math.abs(at(7, 6) - (Math.sqrt(5) - FOG_EDGE_BIAS)), 1e-6, 'a knight-ish step out');
  assert.eq(at(9, 5), FOG_RAMP_CELLS, 'past the ramp, clamped');
});

test('fog field: the distance is monotone away from the frontier', () => {
  const { at } = distField(11, (x) => x <= 3);
  for (let y = 0; y < 11; y++) {
    for (let x = 1; x < 11; x++) {
      assert.gte(at(x, y), at(x - 1, y), `distance at ${x},${y} vs its neighbour`);
    }
  }
});

test('fog field: the margin is read, so an edge cell is not mis-measured', () => {
  // Revealed ground lives ENTIRELY in the margin — outside the reported window.
  // A field that only looked at what it reports would call the whole window
  // interior; it has to see the explored cells one step off the edge.
  const { at } = distField(7, (x) => x < 0);
  assert.eq(at(0, 3), 1 - FOG_EDGE_BIAS, 'the reported edge is one cell from revealed ground');
  assert.eq(at(1, 3), 2 - FOG_EDGE_BIAS, 'and it ramps inward from there');
});

// ── The ramp ──────────────────────────────────────────────────────────────
test('fog ramp: it hits the table exactly at every whole-cell distance', () => {
  for (let i = 0; i < FOG_RAMP_A.length; i++) {
    assert.lt(Math.abs(fogRampAlpha(i) - FOG_RAMP_A[i]), 1e-9,
      `distance ${i} composites to ${FOG_RAMP_A[i]}`);
  }
  assert.eq(fogRampAlpha(0), 0, 'revealed ground takes no wash at all');
  assert.lt(Math.abs(fogRampAlpha(FOG_RAMP_CELLS) - FOG_ALPHA), 1e-9,
    'the interior still lands on the old flat FOG_ALPHA — the edge softens, the claim does not');
  assert.lt(Math.abs(fogRampAlpha(97) - FOG_ALPHA), 1e-9, 'and stays there past the ramp');
});

test('fog ramp: it is continuous and monotone — no step anywhere in it', () => {
  let prev = 0, maxJump = 0;
  for (let d = 0; d <= FOG_RAMP_CELLS + 1; d += 1 / 512) {
    const a = fogRampAlpha(d);
    assert.gte(a, prev - 1e-9, `the ramp lightens going inward at d=${d}`);
    assert.inRange(a, 0, FOG_ALPHA, `alpha at d=${d}`);
    maxJump = Math.max(maxJump, a - prev);
    prev = a;
  }
  // A 32px shell edge was a 0.55 jump. Over a 1/512-cell step (a fifth of a
  // screen pixel) nothing may move more than a rounding error of one alpha byte.
  assert.lt(maxJump, 1 / 255, `the ramp jumps by ${maxJump} somewhere — it is a staircase again`);
});

test('fog ramp: the table only ever gets darker inward', () => {
  for (let i = 1; i < FOG_RAMP_A.length; i++) {
    assert.gt(FOG_RAMP_A[i], FOG_RAMP_A[i - 1], `${i} cells out is darker than ${i - 1}`);
  }
  assert.lt(FOG_RAMP_A[1], FOG_ALPHA, 'the frontier is lighter than the interior');
});

// ── The wisps ─────────────────────────────────────────────────────────────
test('fog wisps: the noise is world-keyed and stable', () => {
  // Same ground, same wisp — a jitter that moved with the player would read as
  // the fog boiling as you walk.
  assert.eq(fogWisp(12, -7), fogWisp(12, -7), 'the same cell twice');
  let varied = 0;
  for (let i = 0; i < 64; i++) if (fogWisp(i * 3.1, 5) !== fogWisp(0, 5)) varied++;
  assert.gt(varied, 32, 'the noise barely varies — the frontier would be a clean gradient');
  for (let i = 0; i < 200; i++) {
    assert.inRange(fogWisp(i * 1.7, i * -0.9), 0, 1, 'wisp value is a unit fraction');
  }
});

// The field the paint pass actually samples: one revealed disc, the shape
// walking leaves behind, in the same D×D space fogFieldAround reports.
const DISC = distField(21, (x, y) => (x - 10) * (x - 10) + (y - 10) * (y - 10) <= 9);
// The alpha at a point, wisps and all. `ax`/`ay` are absolute world cells; the
// field is at an arbitrary but fixed offset from them, as it is in the game.
const alphaAt = (fx, fy) => fogAlphaAt(DISC.dist, DISC.D, fx, fy, fx + 400, fy - 250);

test('fog wisps: explored ground stays clear — the taper vanishes at distance 0', () => {
  // Every revealed cell's own centre, at full sub-cell sampling resolution
  // around it: the wash may feather across the boundary, but the ground the
  // player has walked has to stay legible.
  for (let y = 0; y < DISC.D; y++) {
    for (let x = 0; x < DISC.D; x++) {
      if (DISC.at(x, y) !== 0) continue;
      assert.eq(alphaAt(x, y), 0, `revealed cell ${x},${y} takes fog at its centre`);
      // ...and the feather onto the rest of that cell stays a feather.
      for (const [dx, dy] of [[0.49, 0], [-0.49, 0], [0, 0.49], [0, -0.49]]) {
        assert.lt(alphaAt(x + dx, y + dy), FOG_RAMP_A[1] * 0.6,
          `revealed cell ${x},${y} is fogged over at its edge`);
      }
    }
  }
});

test('fog wisps: the interior still lands on FOG_ALPHA, wisps or not', () => {
  // Nothing revealed anywhere: the whole window is interior, and no wisp may
  // lighten it. This is the one the taper exists for — an untapered push would
  // open pale holes in the deep unknown.
  const open = distField(9, () => false);
  for (let y = 0; y < 9; y += 0.25) {
    for (let x = 0; x < 9; x += 0.25) {
      const a = fogAlphaAt(open.dist, open.D, x, y, x + 900, y + 40);
      assert.lt(Math.abs(a - FOG_ALPHA), 1e-9, `deep fog at ${x},${y} is ${a}, want ${FOG_ALPHA}`);
    }
  }
});

test('fog wisps: the frontier actually moves — the boundary is not a clean arc', () => {
  // Walk a ring at a fixed distance from the revealed disc's centre and watch
  // the alpha. On an unwisped field every sample on the ring is identical.
  const seen = [];
  for (let i = 0; i < 96; i++) {
    const th = i * Math.PI * 2 / 96;
    seen.push(alphaAt(10 + Math.cos(th) * 4.2, 10 + Math.sin(th) * 4.2));
  }
  const lo = Math.min(...seen), hi = Math.max(...seen);
  assert.gt(hi - lo, 0.04, `the frontier varies by only ${hi - lo} around the disc — no wisps`);
});

test('fog wisps: the wash is dark near the frontier and darker behind it', () => {
  // Averaged over the ring the wisps still have to leave a ramp: the further
  // from explored ground, the darker, all the way to the interior.
  const ringMean = (r) => {
    let sum = 0;
    for (let i = 0; i < 96; i++) {
      const th = i * Math.PI * 2 / 96;
      sum += alphaAt(10 + Math.cos(th) * r, 10 + Math.sin(th) * r);
    }
    return sum / 96;
  };
  const near = ringMean(4.2), mid = ringMean(5.2), deep = ringMean(7.5);
  assert.gt(mid, near, 'one cell further out is not darker');
  assert.gt(deep, mid, 'the interior is not darker still');
  assert.lt(Math.abs(deep - FOG_ALPHA), 1e-6, 'the interior does not reach full strength');
});

// ── The sampling ──────────────────────────────────────────────────────────
test('fog sampling: a bilinear read lands exactly on a cell value at its centre', () => {
  const D = 4;
  const arr = new Float32Array(D * D);
  for (let i = 0; i < arr.length; i++) arr[i] = i;
  for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
    assert.eq(fogSample(arr, D, x, y), y * D + x, `cell centre ${x},${y}`);
  }
  assert.eq(fogSample(arr, D, 0.5, 0), 0.5, 'halfway between two cells');
  assert.eq(fogSample(arr, D, -3, -3), 0, 'off the low edge, clamped');
  assert.eq(fogSample(arr, D, 99, 99), arr[D * D - 1], 'off the high edge, clamped');
});

test('fog sampling: the texture resolves the field it is given', () => {
  // FOG_SUB samples a cell is the budget the paint loop spends. Below the
  // wisps' own lattice it would alias them into blocks — the pixelation this
  // whole pass exists to get rid of.
  assert.gte(FOG_SUB, 4, 'too few samples a cell to resolve a wisp');
  assert.lte(FOG_SUB, CELL_PX, 'more samples than the texture has pixels is wasted work');
});
