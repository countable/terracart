// Regression guard: THE FEET ARE ON THE FIX.
//
// playerM is the GPS position. The player sprite must be seated so its
// visible FEET land on that point — not its centre. Until Sep 2026 the sprite
// was centred on the fix (origin 0.5/0.5 at viewCentre, +1.4px) and the feet
// hung 14px = 3 m south of it, with every ground mark (footprint dots, contact
// shadow, GPS crosshair, walk-home line) carrying its own +13/+14 to follow
// them down. Standing on a road's centreline put the band through the
// character's waist and the feet on the south shoulder, so the whole map read
// as shifted a body-length NORTH of where the player stood.
//
// app.js needs Phaser and can't load headlessly, so the seating is pinned as
// source text (APP_JS_SRC / MULTIPLAYER_SRC are lifted by run.js). If one of
// these fails, the feet have left the fix — do not re-add an offset to
// compensate elsewhere; see feetOffsetM / playerFeetNudgeY in app.js create().

(function () {
const app = APP_JS_SRC;
const mp = MULTIPLAYER_SRC;

test('feet anchor: feetOffsetM is 0 — the feet stand on playerM', () => {
  assert.truthy(/this\.feetOffsetM = 0;/.test(app), 'feetOffsetM = 0');
  assert.falsy(/this\.feetOffsetM = \(14 \/ CELL_PX\)/.test(app),
    'the old 14px feet drop is not derived into feetOffsetM');
});

test('feet anchor: the sprite is raised by its own feet drop, so the feet sit on viewCentre', () => {
  const m = app.match(/this\.playerFeetNudgeY = -\((\d+) \/ ([\d.]+)\) \* this\.playerScale;/);
  assert.truthy(m, 'playerFeetNudgeY is the NEGATIVE feet drop');
  // The scale is written as a product of its history (1.35 × 0.9 × 0.85);
  // evaluate the factors rather than pinning the number.
  const sm = app.match(/this\.playerScale = ([\d.]+(?: \* [\d.]+)*);/);
  assert.truthy(sm, 'playerScale is a plain numeric product');
  const scale = sm[1].split(' * ').map(Number).reduce((a, b) => a * b, 1);
  assert.truthy(scale > 0.9 && scale < 1.1, `scale ${scale} is the 15%-shorter walker`);
  const nudge = -(Number(m[1]) / Number(m[2])) * scale;
  // The frame's feet are 14/1.35 texture px below its centre; at the sprite's
  // scale that drop plus the nudge must cancel to zero — feet ON the point.
  const feetDrop = (14 / 1.35) * scale;
  assert.truthy(Math.abs(nudge + feetDrop) < 1e-9, `nudge (${nudge}) cancels the feet drop (${feetDrop})`);
  assert.truthy(nudge < -10, 'the sprite is drawn well ABOVE its point, not on it');
  assert.truthy(/this\.player = this\.add\.sprite\(this\.viewCenterX, this\.viewCenterY \+ this\.playerFeetNudgeY/.test(app),
    'the player sprite is created at viewCentre + nudge');
});

test('feet anchor: ground marks sit on the point with no feet offset of their own', () => {
  // Footprint dots: no "+ 14" after the projection.
  assert.falsy(/\/ this\.cellM\) \* CELL_PX \+ 14;/.test(app), 'footprint dots carry no +14');
  // Contact shadow: at the feet (1px above the point, not 13px below).
  assert.truthy(/this\.playerShadow = this\.add\.image\(this\.viewCenterX, this\.viewCenterY - 1,/.test(app),
    'player shadow sits at the feet');
  assert.falsy(/this\.viewCenterY \+ 13,/.test(app), 'no +13 shadow anchor');
  // GPS crosshair and walk target: on their points, not nudged to a sprite centre.
  assert.truthy(/this\.gpsGhost\.setPosition\(Math\.round\(g\.x\), Math\.round\(g\.y\)\)/.test(app),
    'GPS marker on the fix');
  assert.truthy(/this\.targetGhost\.setPosition\(Math\.round\(p\.x\), Math\.round\(p\.y\)\)/.test(app),
    'target marker on the target');
  assert.falsy(/Math\.round\([gp]\.y \+ this\.playerFeetNudgeY\)/.test(app),
    'no marker is nudged to a sprite centre');
  // Walk-home line: both ends are ground points.
  assert.falsy(/const FEET = 13;/.test(app), 'walk-home hint has no FEET constant');
});

test('feet anchor: peers are seated exactly like the local player', () => {
  assert.truthy(/p\.spr\.setPosition\(p\.dx, p\.dy \+ scene\.playerFeetNudgeY\)/.test(mp),
    'peer sprite rises by the same nudge');
  assert.truthy(/p\.sh\.setPosition\(p\.dx, p\.dy - 1\)/.test(mp), 'peer shadow at the feet');
  assert.falsy(/p\.dy \+ 13\)/.test(mp), 'no +13 peer shadow anchor');
  assert.truthy(/p\.lbl\.setPosition\(p\.dx, p\.dy \+ scene\.playerFeetNudgeY - \d+\)/.test(mp),
    'peer name tag is measured from the sprite centre');
});

test('feet anchor: the creature hit-test scales pixels from cellPx, not from the feet offset', () => {
  assert.truthy(/this\.cellPx = CELL_PX;/.test(app), 'scene publishes cellPx');
  assert.truthy(/const px2m = scene\.cellM \/ scene\.cellPx;/.test(INTERACT_SRC),
    'interact.js derives metres-per-pixel from the cell size');
  assert.falsy(/scene\.feetOffsetM \/ 14/.test(INTERACT_SRC),
    'interact.js no longer divides feetOffsetM by 14 (which is 0 / 14 now)');
});
})();
