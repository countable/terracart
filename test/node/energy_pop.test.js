// Numbers on the map land ON THE CELL they belong to, right by the player.
//
// Every "+N⚡" / "−N⚡" goes through app.js _popEnergy, which seats it on an
// absolute cell — the plot a till paid for, the wall a dig cost, the player's
// own cell for a rest tick or a slime's leech — through the projection, which
// is what tells the reader WHICH cell it was: the number is the whole mark,
// and nothing is drawn on the ground under it.
// Until Sep 2026 the rest splash was a 'note' at the viewport centre minus
// 70px (two cells over anyone's head, and under a peek drag two cells from
// nowhere) and the drains sat 40px above the same point. The coin pickup's
// "+$1" is the same cell pop, and the foe's "-N" damage number wears the
// same dress (stroke + drop shadow) from the same toast table.
//
// The placement (_energyPopAt / _cellToastAt / _cellAtScreen / playerScreen)
// is lifted out of app.js by run.js and run for real on a stub scene, the same
// way the trail counter's seating is. The wiring — which call sites go
// through it, what the tier wears — is pinned as source text, because app.js
// needs Phaser and can't load headlessly.

(function () {
const app = APP_JS_SRC;
const { _worldToastAt, _cellToastAt, _energyPopAt, _isPlayerCell, _cellAtScreen,
        playerScreen } = __trailCounter;
const near = (a, b, eps, m) => assert.inRange(a, b - eps, b + eps, m);

// Same shape as trail.test.js's counterScene — round numbers, shipping cellM.
// feetOffsetM is 0 in the game (the feet stand on playerM); playerReachCell
// reads it, so the stub carries it.
const popScene = (over) => Object.assign({
  startWorldM: { x: 10000, y: 20000 },
  mPerPx: 10,
  originPx: { x: 1000, y: 2000 },
  cellsPerTile: 51,
  cellM: 7,
  feetOffsetM: 0,
  playerM: { x: 0, y: 0 },
  peekM: { x: 0, y: 0 },
  viewCenterX: 176,
  viewCenterY: 200,
  worldMetersToScreen(wmx, wmy) { return worldMetersToScreen(this, wmx, wmy); },
  screenToWorldMeters(sx, sy) { return screenToWorldMeters(this, sx, sy); },
  _worldToastAt, _cellToastAt, _energyPopAt, _isPlayerCell, _cellAtScreen, playerScreen,
}, over || {});

const playerCell = (s) => playerReachCell(s);
const cellScreen = (s, ix, iy) => {
  const m = absCellCenterMeters(s, ix, iy);
  return worldMetersToScreen(s, m.x, m.y);
};

// ── Placement ─────────────────────────────────────────────────────────────
test('energy pop: on another cell it hangs just clear of that cell\'s top edge', () => {
  const s = popScene();
  const c = playerCell(s);
  const out = s._energyPopAt(c.cellIX + 1, c.cellIY - 1);   // a reachable neighbour
  const cell = cellScreen(s, c.cellIX + 1, c.cellIY - 1);
  assert.eq(out.x, Math.round(cell.x), 'horizontally centred on the cell');
  // The energy tier hangs its text from `y`; the cell's top edge is half a
  // cell above its centre, and the text clears it by the lift.
  const top = cell.y - CELL_PX / 2;
  near(top - out.y, ENERGY_POP_LIFT_PX, 0.5, 'its bottom sits the lift above the top edge');
  assert.lt(out.y, top, 'never across the cell');
});

test('energy pop: on the player\'s own cell it clears the head, on the body', () => {
  const s = popScene();
  const c = playerCell(s);
  const out = s._energyPopAt(c.cellIX, c.cellIY);
  const ps = s.playerScreen();
  assert.eq(out.x, Math.round(ps.x), 'centred on the body');
  assert.eq(ps.y - out.y, ENERGY_POP_HEAD_PX, 'hangs ENERGY_POP_HEAD_PX above the feet');
  // Derived from the art: the head is half the 32px frame plus the feet drop
  // above the fix, and the pop clears it by the same lift a cell edge gets.
  const head = PLAYER_FRAME_PX / 2 + PLAYER_FEET_DROP_PX;
  near(ENERGY_POP_HEAD_PX - head, ENERGY_POP_LIFT_PX, 0.5, 'clears the head by the lift');
  assert.truthy(ENERGY_POP_HEAD_PX > head, 'and is above it, not through it');
});

test('energy pop: the player-cell pop is not the cell seating (the head would be under it)', () => {
  const s = popScene();
  const c = playerCell(s);
  const onBody = s._energyPopAt(c.cellIX, c.cellIY);
  const onCell = s._cellToastAt(c.cellIX, c.cellIY, CELL_PX / 2 + ENERGY_POP_LIFT_PX);
  assert.truthy(onBody.y !== onCell.y || onBody.x !== onCell.x,
    'the two seatings differ (the body is not the cell centre in general)');
});

test('energy pop: a peek moves a cell pop with its cell, and a body pop with the body', () => {
  // The QC rule: a draw pass measured off the wrong anchor tears its layer off
  // the ground under a peek drag. A cell's pop slides with the ground; the
  // player's slides with the player (who slides off the viewport centre by the
  // same amount, in the same direction).
  const s = popScene();
  const c = playerCell(s);
  const cellBefore = s._energyPopAt(c.cellIX + 2, c.cellIY);
  const bodyBefore = s._energyPopAt(c.cellIX, c.cellIY);
  s.peekM = { x: 3 * s.cellM, y: 0 };      // camera three cells east
  const cellAfter = s._energyPopAt(c.cellIX + 2, c.cellIY);
  const bodyAfter = s._energyPopAt(c.cellIX, c.cellIY);
  near(cellBefore.x - cellAfter.x, 3 * CELL_PX, 1, 'the cell pop slid three cells west');
  near(bodyBefore.x - bodyAfter.x, 3 * CELL_PX, 1, 'and so did the body pop');
  assert.eq(cellBefore.y, cellAfter.y, 'neither moved vertically');
  assert.eq(bodyBefore.y, bodyAfter.y, 'neither moved vertically');
});

test('energy pop: an unprojectable scene falls back to the centred toast', () => {
  const s = popScene({ startWorldM: null });
  assert.eq(Object.keys(s._energyPopAt(4, 4)).length, 0, 'no override without a camera');
  const ok = popScene();
  assert.eq(Object.keys(ok._energyPopAt(null, null)).length, 0, 'no cell, no override');
  assert.eq(ok._cellAtScreen(null, null), null, 'no tap, no cell');
});

// ── The tapped cell is the cell the spend shows on ─────────────────────────
test('energy pop: a tap\'s screen point resolves to the cell it was over, peek or not', () => {
  const s = popScene();
  const c = playerCell(s);
  for (const peek of [{ x: 0, y: 0 }, { x: 2 * s.cellM, y: -1.5 * s.cellM }]) {
    s.peekM = peek;
    for (const [dx, dy] of [[0, 0], [2, -1], [-3, 2]]) {
      const ix = c.cellIX + dx, iy = c.cellIY + dy;
      const p = cellScreen(s, ix, iy);
      // Anywhere inside the drawn cell, not just its centre.
      const hit = s._cellAtScreen(p.x + 9, p.y - 11);
      assert.eq(hit.ix, ix, `cell ${dx},${dy} x under peek ${peek.x}`);
      assert.eq(hit.iy, iy, `cell ${dx},${dy} y under peek ${peek.x}`);
    }
  }
});

// ── Wiring, pinned as source text ──────────────────────────────────────────
// A tier's row runs to the next tier's key (its shadow is a nested brace).
const tierRow = (name) => {
  const m = app.match(new RegExp(`\\n  ${name}:\\s*\\{([\\s\\S]*?)\\n  \\w+:\\s*\\{`));
  assert.truthy(m, `TOAST_TIER has a ${name} row`);
  return m[1];
};
const assertMapNumberDress = (row, what) => {
  assert.truthy(/font: 'bold \d+px'/.test(row), `${what}: bold`);
  const stroke = row.match(/stroke: (\d+)/);
  assert.truthy(stroke && Number(stroke[1]) > 0, `${what}: a stroke outline`);
  assert.truthy(/shadow: \{ offsetX: \d+, offsetY: \d+, blur: \d+ \}/.test(row), `${what}: a drop shadow`);
  assert.truthy(/bg: null/.test(row), `${what}: no chip — it sits on the map over the thing`);
};

test('energy pop: the cell tier is bold, stroked AND drop-shadowed, with no chip', () => {
  assertMapNumberDress(tierRow('cell'), 'cell');
});

test('damage pop: the foe\'s "-N" wears the same dress, from the same table', () => {
  // The enemy damage number used to be a hand-set add.text (bold 11px, a
  // stroke, NO drop shadow) beside the toast table; now it is a tier of it.
  assertMapNumberDress(tierRow('damage'), 'damage');
  const m = app.match(/\n  _popDamageNumber\(c, amount\) \{([\s\S]*?)\n  \}\n/);
  assert.truthy(m, '_popDamageNumber exists');
  const body = m[1];
  assert.truthy(/this\._toast\(`-\$\{amount\}`, \{\s*\n\s*tier: 'damage'/.test(body), 'a damage toast');
  assert.falsy(/this\.add\.text\(/.test(body), 'no bespoke text builder');
  assert.truthy(/this\.worldMetersToScreen\(c\.x, c\.y\)/.test(body), 'still projected off the foe');
  assert.truthy(/stack: false/.test(body), 'does not stack — its own scatter keeps hits apart');
  assert.truthy(/mask: this\.enemyHealthGfx\?\.mask/.test(body), 'clipped to the map viewport');
  assert.truthy(/if \(opts\.mask\) t\.setMask\(opts\.mask\);/.test(app), '_toast honours a mask');
});

test('coin pop: the "+$1" lands on the cell the coin was picked from', () => {
  const src = INTERACT_SRC;
  assert.truthy(/const cc = worldMetersToAbsCell\(scene, coin\.x, coin\.y\);\s*\n\s*scene\._popCellNumber\('\+\$1', UI_GOLD, cc\.cellIX, cc\.cellIY\);/.test(src),
    'the coin cell, in gold, through the cell pop');
  // The flash at the finger survives ONLY as the stub-scene fallback.
  assert.truthy(/\} else \{\s*\n\s*scene\.flash\('\+\$1', sx, sy\);\s*\n\s*\}/.test(src),
    'the flash at the finger is the else branch of the cell pop');
  assert.eq((src.match(/scene\.flash\('\+\$1'/g) || []).length, 1, 'and the only one');
});

test('energy pop: every energy readout goes through _popEnergy, on a cell', () => {
  assert.truthy(/_splashEnergyGain\(amount\) \{[\s\S]*?this\._popEnergy\(amount\);/.test(app),
    'the rest / offline splash is a pop on the player');
  assert.truthy(/this\._popEnergy\(-drained, \{ label: /.test(app), 'the slime drain is a pop');
  assert.truthy(/this\._popEnergy\(-hit, \{ label: /.test(app), 'the monster hit is a pop');
  assert.falsy(/this\.flash\(`[^`]*⚡[^`]*`, this\.viewCenterX/.test(app),
    'no energy number is flashed at the viewport centre any more');
  assert.falsy(/this\._toast\(`\+\$\{amount\}⚡`, \{ tier: 'note'/.test(app),
    'the old centred note-tier splash is gone');
});

test('energy pop: a spend pops its price on the tapped cell, and a cancel hands it back there', () => {
  assert.truthy(/spendEnergy\(cost, sx, sy, cell = null\) \{/.test(app),
    'spendEnergy takes an explicit cell');
  assert.truthy(/const at = cell \|\| this\._cellAtScreen\(sx, sy\);\s*\n\s*if \(at && r\.spent > 0\) this\._popEnergy\(-r\.spent, at\);/.test(app),
    'the tapped cell is the cell the price shows on; a silent spend pops nothing');
  assert.truthy(/this\.spendEnergy\(cost, this\.viewCenterX, this\.viewCenterY, \{ ix: cellIX, iy: cellIY \}\)/.test(app),
    'the cave auto-dig names the wall it dug, not the viewport centre');
  assert.truthy(/const c = worldMetersToAbsCell\(this, wp\.worldX, wp\.worldY\);\s*\n\s*this\._popEnergy\(refunded, \{ ix: c\.cellIX, iy: c\.cellIY \}\);/.test(app),
    'abortWorkProgress refunds on the work cell');
});

test('energy pop: _popEnergy seats through the projection', () => {
  const m = app.match(/\n  _popEnergy\(delta, opts = \{\}\) \{([\s\S]*?)\n  \}\n/);
  assert.truthy(m, '_popEnergy exists');
  const body = m[1];
  assert.truthy(/return this\._popCellNumber\(text, color, ix, iy\);/.test(body), 'is a cell number');
  assert.falsy(/viewCenter[XY]/.test(body), 'never measures off the viewport centre');
  assert.truthy(/playerReachCell\(this\)/.test(body), 'defaults to the player\'s own cell');
  const cm = app.match(/\n  _popCellNumber\(text, color, ix, iy\) \{([\s\S]*?)\n  \}\n/);
  assert.truthy(cm, '_popCellNumber exists');
  assert.truthy(/const at = this\._energyPopAt\(ix, iy\);/.test(cm[1]), 'seated by _energyPopAt');
  assert.truthy(/tier: 'cell'/.test(cm[1]), 'wears the cell tier');
  assert.falsy(/viewCenter[XY]/.test(cm[1]), 'never measures off the viewport centre');
  // And the seating helpers project, never off the body for a cell.
  const seat = app.match(/\n  _energyPopAt\(ix, iy\) \{([\s\S]*?)\n  \}\n/);
  assert.truthy(/this\.playerScreen\(\)/.test(seat[1]), 'the body pop reads playerScreen');
  assert.truthy(/this\._cellToastAt\(ix, iy, CELL_PX \/ 2 \+ ENERGY_POP_LIFT_PX\)/.test(seat[1]),
    'a cell pop lifts from the cell centre to just past its top edge');
  // _cellToastAt is the CELL face of _worldToastAt, which is what the street
  // counter hangs on a rebuilt stretch with — so a number on a cell and a
  // number on a street go through the one projection.
  assert.truthy(/_cellToastAt\(ix, iy, liftPx\) \{[\s\S]*?return this\._worldToastAt\(c\.x, c\.y, liftPx\);/.test(app),
    'the cell seating is the world seating, at the cell centre');
  assert.truthy(/this\._worldToastAt\(at\.x, at\.y, STREET_COUNTER_LIFT_PX\)/.test(app),
    'and the street counter shares it');
});

test('energy pop: a body pop hangs on the player, and nothing is drawn on the ground', () => {
  // _isPlayerCell is what anchors a rest tick, a leech or a spend underfoot on
  // the character instead of the ground under them.
  const s = popScene();
  const c = playerCell(s);
  assert.truthy(s._isPlayerCell(c.cellIX, c.cellIY), 'the body cell is the player\'s');
  assert.falsy(s._isPlayerCell(c.cellIX + 1, c.cellIY), 'a neighbour is not');
  assert.falsy(s._isPlayerCell(c.cellIX, c.cellIY - 1), 'nor the cell above');
  assert.falsy(s._isPlayerCell(null, null), 'nor a missing cell');
  const seat = app.match(/\n  _energyPopAt\(ix, iy\) \{([\s\S]*?)\n  \}\n/);
  assert.truthy(/this\._isPlayerCell\(ix, iy\) && this\.playerScreen/.test(seat[1]),
    'the seating asks that test');
  // The cell number is the whole mark. Until Sep 2026 a thin outline ticked on
  // the cell under it, which read as a flash of damage on the tapped ground.
  const cm = app.match(/\n  _popCellNumber\(text, color, ix, iy\) \{([\s\S]*?)\n  \}\n/);
  assert.truthy(/return this\._toast\(text, \{ tier: 'cell', color, \.\.\.at \}\);/.test(cm[1]),
    'the pop is the toast and nothing else');
  assert.eq((app.match(/_flashCellOutline/g) || []).length, 0,
    'the cell outline is gone, caller and helper');
  assert.falsy(/strokeRoundedRect\([^)]*color/.test(app), 'no ring is stroked in a pop\'s ink');
});

})();
