// Multiplayer client — the pure pieces: name hygiene, colour pick, the wire
// coordinate frame (z=14 world px) round-tripping through a save's own
// metre frame, and the ping label a spot gets.

function mpScene() {
  // A save anchored somewhere at ~49°N: originPx is the z=14 world px of the
  // home fix, startWorldM = originPx * mPerPx (app.js create()).
  const originPx = { x: 1_312_345.5, y: 2_876_543.25 };
  const mPerPx = WorldGen.metersPerPixel(49.2, WorldGen.Z);
  return {
    originPx, mPerPx, cellsPerTile: WorldGen.cellsPerEdgeForLat(49.2), cellM: WorldGen.CELL_M,
    startWorldM: { x: originPx.x * mPerPx, y: originPx.y * mPerPx },
    playerM: { x: 37.5, y: -12.25 },
  };
}

test('cleanName mirrors the server: printable, single-spaced, ≤16', () => {
  assert.eq(Multiplayer.cleanName('  Ada   Lovelace '), 'Ada Lovelace');
  assert.eq(Multiplayer.cleanName('a b​c'), 'a bc');
  assert.eq(Multiplayer.cleanName('x'.repeat(30)).length, Multiplayer.NAME_MAX);
  assert.eq(Multiplayer.cleanName('   '), '');
  assert.eq(Multiplayer.cleanName(null), '');
});

test('pickColor draws from the light-tint palette, deterministic under a seeded rng', () => {
  const c = Multiplayer.pickColor(() => 0.31);
  assert.truthy(Multiplayer.COLORS.includes(c));
  assert.eq(Multiplayer.pickColor(() => 0.31), c);
  assert.eq(Multiplayer.pickColor(() => 0.999), Multiplayer.COLORS[Multiplayer.COLORS.length - 1]);
  // Every colour is light: each channel ≥ 0x80 so a tint never blackens the art.
  for (const col of Multiplayer.COLORS) {
    assert.gte((col >> 16) & 0xff, 0x80); assert.gte((col >> 8) & 0xff, 0x80); assert.gte(col & 0xff, 0x80);
  }
});

test('wire px round-trip: toWorldPx of me → fromWorldPx lands on my absolute metres', () => {
  const sc = mpScene();
  const px = Multiplayer.toWorldPx(sc);
  const wm = Multiplayer.fromWorldPx(sc, px.x, px.y);
  assert.inRange(wm.x - (sc.startWorldM.x + sc.playerM.x), -1e-6, 1e-6);
  assert.inRange(wm.y - (sc.startWorldM.y + sc.playerM.y), -1e-6, 1e-6);
  // Two saves with different homes agree on where a peer is: the peer's px
  // frame converts into each save's metre frame, and both project it to the
  // same offset from the same physical point.
  const other = mpScene();
  other.originPx = { x: sc.originPx.x + 200, y: sc.originPx.y - 50 };
  other.startWorldM = { x: other.originPx.x * other.mPerPx, y: other.originPx.y * other.mPerPx };
  const wmOther = Multiplayer.fromWorldPx(other, px.x, px.y);
  // Same absolute metres (same latitude → same mPerPx), whatever the origin.
  assert.inRange(wmOther.x - wm.x, -1e-6, 1e-6);
  assert.inRange(wmOther.y - wm.y, -1e-6, 1e-6);
});

test('mulTint stacks a state tint on the player colour; white is the identity', () => {
  assert.eq(mulTint(0xffffff, 0x9fd8ff), 0x9fd8ff);
  assert.eq(mulTint(0xff6b6b, undefined), 0xff6b6b);
  assert.eq(mulTint(0x808080, 0xffffff), 0x808080);
  assert.eq(mulTint(0x808080, 0x808080), 0x404040);
});

test('edgeDot clamps an off-screen point to the square view edge, inset intact', () => {
  const half = 176, inset = Multiplayer.PEER_DOT_INSET;
  // Straight east: the dot sits on the right edge, dead level.
  const e = Multiplayer.edgeDot(400, 0, half, inset);
  assert.eq(e.x, half - inset, 'east dot on the right edge');
  assert.eq(e.y, 0, 'east dot stays level');
  // Oblique: the dominant axis pins to the edge, the other keeps the ratio —
  // that's what makes the dot point AT the peer, not at a corner.
  const o = Multiplayer.edgeDot(400, 100, half, inset);
  assert.eq(o.x, half - inset, 'dominant axis on the edge');
  assert.inRange(o.y - (half - inset) / 4, -1e-9, 1e-9, 'minor axis keeps the ratio');
  // Wherever the peer is, the dot never leaves the inset square.
  for (const [vx, vy] of [[500, -500], [-9, 300], [-1000, -1], [3, -1000]]) {
    const d = Multiplayer.edgeDot(vx, vy, half, inset);
    assert.inRange(d.x, -(half - inset), half - inset, 'x inside the view');
    assert.inRange(d.y, -(half - inset), half - inset, 'y inside the view');
    assert.inRange(Math.max(Math.abs(d.x), Math.abs(d.y)) - (half - inset),
      -1e-9, 1e-9, 'on the edge, not short of it');
  }
  // Nothing to point at → no dot (guards a peer somehow at the view centre).
  assert.eq(Multiplayer.edgeDot(0, 0, half, inset), null);
});

test('the peer edge dot only reaches as far as a ping arrow does', () => {
  // 300 m — the same reach the off-screen ping arrow has, so "close enough to
  // signpost" means one thing on the rim. Retune them together or not at all.
  assert.eq(Multiplayer.PEER_DOT_MAX_M, 300);
});

test('describeAt names the rock / tree / wild plant / creature in the tapped cell', () => {
  const sc = mpScene();
  const at = (dx, dy) => ({ x: sc.startWorldM.x + dx, y: sc.startWorldM.y + dy });
  const rock = at(0, 0), tree = at(20, 0), plant = at(40, 0), cow = at(60, 0);
  const key = 'mp_test_tile';
  WorldGen.tileCache.set(key, {
    objects: [
      { kind: 'mineralrock', yieldTier: 3, ...rock },
      { kind: 'tree', species: 'oak', ...tree },
    ],
    wildplants: [{ crop: 'potato', ...plant }],
    creatures: [{ kind: 'cow', ...cow }],
  });
  try {
    assert.eq(Multiplayer.describeAt(sc, rock.x, rock.y), 'Iron rock');
    assert.eq(Multiplayer.describeAt(sc, tree.x, tree.y), 'Oak tree');
    assert.eq(Multiplayer.describeAt(sc, plant.x, plant.y), ITEM_BY_ID.potato.name);
    assert.eq(Multiplayer.describeAt(sc, cow.x, cow.y), 'Cow');
    // Same cell, different point inside it → same answer; empty cell → ''.
    assert.eq(Multiplayer.describeAt(sc, rock.x + 0.4, rock.y - 0.4), 'Iron rock');
    assert.eq(Multiplayer.describeAt(sc, rock.x + 500, rock.y + 500), '');
  } finally { WorldGen.tileCache.delete(key); }
});
