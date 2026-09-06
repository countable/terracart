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
  // The drop is a fact about the ART — how far the visible feet sit below the
  // centre of the 32px frame — so it is a named constant in texture px, and the
  // nudge is that constant times whatever scale the sprite draws at. Written
  // that way, the feet stay on the fix when the scale changes; written as a
  // number, they do not.
  const dm = app.match(/const PLAYER_FEET_DROP_PX = (\d+) \/ ([\d.]+);/);
  assert.truthy(dm, 'PLAYER_FEET_DROP_PX is the measured drop, in texture px');
  const feetDropPx = Number(dm[1]) / Number(dm[2]);
  assert.truthy(/this\.playerFeetNudgeY = -PLAYER_FEET_DROP_PX \* this\.playerScale;/.test(app),
    'playerFeetNudgeY is the NEGATIVE drop, scaled — never a literal');
  const sm = app.match(/this\.playerScale = ([\d.]+(?: \* [\d.]+)*);/);
  assert.truthy(sm, 'playerScale is a plain numeric product');
  const scale = sm[1].split(' * ').map(Number).reduce((a, b) => a * b, 1);
  assert.truthy(scale > 0.9 && scale < 1.1, `scale ${scale} is the human-sized walker`);
  // Feet ON the point: the nudge and the drawn drop must cancel exactly.
  const nudge = -feetDropPx * scale;
  assert.truthy(Math.abs(nudge + feetDropPx * scale) < 1e-9,
    `nudge (${nudge}) cancels the feet drop (${feetDropPx * scale})`);
  assert.truthy(nudge < -10, 'the sprite is drawn well ABOVE its point, not on it');
  assert.truthy(/this\.player = this\.add\.sprite\(this\.viewCenterX, this\.viewCenterY \+ this\.playerFeetNudgeY/.test(app),
    'the player sprite is created at viewCentre + nudge');
});

test('feet anchor: the walker draws one texture pixel to one game pixel', () => {
  // Everything else on screen is an exact multiple of a texture pixel or is
  // geometry. At 1.033 the walker alone was resampled at a near-but-not-1
  // ratio, so its pixels came out in irregular runs with the seam wandering as
  // it moved. Scale 1 is what makes the character the crisp thing on screen.
  const sm = app.match(/this\.playerScale = ([\d.]+(?: \* [\d.]+)*);/);
  const scale = sm[1].split(' * ').map(Number).reduce((a, b) => a * b, 1);
  assert.eq(scale, 1, 'playerScale is exactly 1');
});

test('feet anchor: ground marks sit on the point with no feet offset of their own', () => {
  // Footprint dots: no "+ 14" after the projection.
  assert.falsy(/\/ this\.cellM\) \* CELL_PX \+ 14;/.test(app), 'footprint dots carry no +14');
  // Contact shadow: at the feet (1px above the point, not 13px below).
  assert.truthy(/this\.playerShadow = this\.add\.image\(this\.viewCenterX, this\.viewCenterY - 1,/.test(app),
    'player shadow sits at the feet');
  assert.falsy(/this\.viewCenterY \+ 13,/.test(app), 'no +13 shadow anchor');
  // GPS crosshair: on its point, not nudged to a sprite centre. It is the only
  // ground marker beside the body — the walk-target dot is gone (see below).
  assert.truthy(/this\.gpsGhost\.setPosition\(Math\.round\(g\.x\), Math\.round\(g\.y\)\)/.test(app),
    'GPS marker on the fix');
  assert.falsy(/Math\.round\([gp]\.y \+ this\.playerFeetNudgeY\)/.test(app),
    'no marker is nudged to a sprite centre');
  // Walk-home line: both ends are ground points.
  assert.falsy(/const FEET = 13;/.test(app), 'walk-home hint has no FEET constant');
});

// The grey walk-target dot is gone at every depth, and the GPS crosshair is
// shown at every depth. The dot marked this._targetM — the point the body is
// auto-walking to — and read as a blob floating ahead of the character
// wherever it showed (it was surface-only, then underground-only). The
// crosshair marks where you REALLY are, which a descent GPS-mirrors, so it is
// as true underground as above; it used to be hidden there.
test('ground marks: no walk-target dot, and the GPS crosshair at every depth', () => {
  assert.falsy(/targetGhost/.test(app), 'no walk-target marker anywhere in app.js');
  assert.truthy(/if \(this\.gpsM\) \{/.test(app), 'the GPS ghost block is not gated on depth');
  assert.falsy(/this\.gpsM && this\.depth === 0/.test(app), 'the old surface-only GPS ghost gate is gone');
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
