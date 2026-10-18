// Regression guard: THE FEET ARE ON THE FIX.
//
// playerM is the GPS position. The player sprite must be seated so its
// visible FEET land on that point — not its centre. A sprite centred on the
// fix leaves the feet 3 m south of it, the road band through the character's
// waist, and every ground mark needing its own offset to follow.
//
// app.js needs Phaser and can't load headlessly, so the seating is pinned as
// source text (SCENE_SRC / MULTIPLAYER_SRC are lifted by run.js). If one of
// these fails, the feet have left the fix — do not re-add an offset to
// compensate elsewhere; see feetOffsetM / playerFeetNudgeY in app.js create().

(function () {
const app = SCENE_SRC;
const mp = MULTIPLAYER_SRC;

test('feet anchor: feetOffsetM is 0 — the feet stand on playerM', () => {
  assert.truthy(/this\.feetOffsetM = 0;/.test(app), 'feetOffsetM = 0');
  assert.falsy(/this\.feetOffsetM = \(14 \/ CELL_PX\)/.test(app),
    'the old 14px feet drop is not derived into feetOffsetM');
});

test('feet anchor: the sprite is raised by its own feet drop, so the feet sit on viewCentre', () => {
  // The drop is a fact about the ART — how far the visible feet sit below the
  // centre of the frame — so it is read off the art table that owns the base
  // sheet (SpriteLayout.PLAYER_ART.farmer, in texture px), and the nudge is
  // that number times whatever scale the sprite draws at. Written that way,
  // the feet stay on the fix when the scale changes; written as a number,
  // they do not.
  assert.truthy(/const PLAYER_FEET_DROP_PX = SpriteLayout\.PLAYER_ART\.farmer\.footDrop;/.test(app),
    'PLAYER_FEET_DROP_PX is the farmer row\'s measured drop, in texture px');
  const feetDropPx = SpriteLayout.PLAYER_ART.farmer.footDrop;
  assert.truthy(/this\.playerFeetNudgeY = -PLAYER_FEET_DROP_PX \* this\.playerScale;/.test(app),
    'playerFeetNudgeY is the NEGATIVE drop, scaled — never a literal');
  assert.truthy(/this\.playerScale = PLAYER_ART_SCALE;/.test(app), 'playerScale is the base art\'s own scale');
  const scale = SpriteLayout.PLAYER_ART.farmer.scale;
  // Feet ON the point: the nudge and the drawn drop must cancel exactly.
  const nudge = -feetDropPx * scale;
  assert.truthy(Math.abs(nudge + feetDropPx * scale) < 1e-9,
    `nudge (${nudge}) cancels the feet drop (${feetDropPx * scale})`);
  assert.truthy(nudge < -6, 'the sprite is drawn well ABOVE its point, not on it');
  assert.truthy(/this\.player = this\.add\.sprite\(this\.viewCenterX, this\.viewCenterY \+ this\.playerFeetNudgeY/.test(app),
    'the player sprite is created at viewCentre + nudge');
});

test('feet anchor: the base scale is the farmer row\'s, a whole-half-pixel ratio', () => {
  // Everything else on screen is an exact multiple of a texture pixel or is
  // geometry. The old 32px walker was once resampled at 1.033 and came out in
  // irregular pixel runs with the seam wandering as it moved. The cyan
  // farmer's 16px frames draw at 1.5 (assets/Character/README.md): every two
  // texture pixels are three device pixels, a regular run, so the character
  // stays the crisp thing on screen — and the number lives in the art table,
  // not here.
  assert.truthy(/const PLAYER_ART_SCALE = SpriteLayout\.PLAYER_ART\.farmer\.scale;/.test(app), 'PLAYER_ART_SCALE reads the farmer row');
  assert.eq(SpriteLayout.PLAYER_ART.farmer.scale, 1.5, 'the farmer draws at 1.5');
  assert.eq(SpriteLayout.PLAYER_ART.farmer.fw, 16, 'a 16px frame: 24 device px, a whole number');
});

test('feet anchor: ground marks sit on the point with no feet offset of their own', () => {
  // Footprint dots: no "+ 14" after the projection.
  assert.falsy(/\/ this\.cellM\) \* CELL_PX \+ 14;/.test(app), 'footprint dots carry no +14');
  // Contact shadow: at the feet (1px above the point, not 13px below).
  assert.truthy(/this\.playerShadow = this\.add\.image\(this\.viewCenterX, this\.viewCenterY - 1,/.test(app),
    'player shadow sits at the feet');
  assert.falsy(/this\.viewCenterY \+ 13,/.test(app), 'no +13 shadow anchor');
  // GPS ring: on its point, not nudged to a sprite centre. It is the only
  // ground marker beside the body — the walk-target dot is gone (see below).
  assert.truthy(/this\.gpsGhost\.setPosition\(Math\.round\(g\.x\), Math\.round\(g\.y\)\)/.test(app),
    'GPS marker on the fix');
  assert.falsy(/Math\.round\([gp]\.y \+ this\.playerFeetNudgeY\)/.test(app),
    'no marker is nudged to a sprite centre');
  // Walk-home line: both ends are ground points.
  assert.falsy(/const FEET = 13;/.test(app), 'walk-home hint has no FEET constant');
});

// The grey walk-target dot is gone at every depth, and the GPS ring is
// shown at every depth. The dot read as a blob floating ahead of the
// character. The ring marks where you REALLY are, which a descent
// GPS-mirrors, so it is as true underground as above.
test('ground marks: no walk-target dot, and the GPS ring at every depth', () => {
  assert.falsy(/targetGhost/.test(app), 'no walk-target marker anywhere in app.js');
  assert.truthy(/if \(this\.gpsM\) \{/.test(app), 'the GPS ghost block is not gated on depth');
  assert.falsy(/this\.gpsM && this\.depth === 0/.test(app), 'the old surface-only GPS ghost gate is gone');
});

// The GPS ring is ALWAYS drawn while there is a fix: around the feet when the
// body stands on it, left on the ground once the stick walks the body off.
// It used to hide within a cell of the body, so the player only ever met the
// mark after leaving it. And it is the same flat paint as the elite's rune
// circle (GROUND_MARK): baked top-down, laid flat by the shared tilt, drawn at
// the width its strokes were designed for.
test('ground marks: the GPS ring is always shown and is a flat ground mark', () => {
  assert.falsy(/> this\.cellM \*\* 2\) \{\s*const g = worldMetersToScreen/.test(app),
    'no one-cell slack hides the ring near the body');
  assert.truthy(/if \(this\.gpsM\) \{\s*const g = worldMetersToScreen\(this,[\s\S]{0,160}?this\.gpsGhost\.setPosition\(Math\.round\(g\.x\), Math\.round\(g\.y\)\)\.setVisible\(true\)\s*\.setFrame\(/.test(app),
    'with a fix, the ring is placed and shown unconditionally');
  assert.truthy(/this\.gpsGhost = this\.add\.image\(this\.viewCenterX, this\.viewCenterY, 'gps_ring'\)/.test(app),
    'the marker is the gps_ring bake');
  assert.truthy(/\.setDisplaySize\(GROUND_MARK\.px, GROUND_MARK\.px \* GROUND_MARK\.tilt\)/.test(app),
    'laid flat at the shared ground-mark width and tilt');
  assert.truthy(/bakeRingBand\('gps_ring', GPS_RING\.periodDeg, ctx => \{ ring\(ctx, GPS_RING\.r\); ticks\(ctx, GPS_RING\.r, 4, GPS_RING\.tick\); \}, '#ffe066'\)/.test(app),
    'baked by the shared ground-mark bake, in gold, as a ring with four ticks, a strip over the ticks\' period');
  assert.eq(GPS_RING.periodDeg, 90, 'four ticks repeat every quarter turn');
  assert.falsy(/gps_crosshair/.test(app), 'the old 20px crosshair bake is gone');
  // The walk-home lead stops on the ring's ellipse at the line's bearing.
  assert.truthy(/const FAR_GAP = 1 \/ Math\.hypot\(ux \/ rx, uy \/ ry\);/.test(app),
    'the lead\'s far gap is the flattened ring\'s radius along the line');
});

test('feet anchor: peers are seated exactly like the local player', () => {
  assert.truthy(/p\.spr\.setPosition\(p\.dx, p\.dy \+ scene\.playerFeetNudgeY\)/.test(mp),
    'peer sprite rises by the same nudge');
  assert.truthy(/p\.sh\.setPosition\(p\.dx, p\.dy - 1\)/.test(mp), 'peer shadow at the feet');
  assert.falsy(/p\.dy \+ 13\)/.test(mp), 'no +13 peer shadow anchor');
  assert.truthy(/const label = annotationPoint\(scene, p\.dx, p\.dy\);/.test(mp),
    'peer label anchor projects the eased ground feet');
  assert.truthy(/p\.lbl\.setPosition\(label\.x, label\.y \+ scene\.playerFeetNudgeY - \d+\)/.test(mp),
    'peer name tag keeps the vertical sprite-centre offset above projected feet');
});

test('feet anchor: the creature hit-test scales pixels from cellPx, not from the feet offset', () => {
  assert.truthy(/this\.cellPx = CELL_PX;/.test(app), 'scene publishes cellPx');
  assert.truthy(/const px2m = scene\.cellM \/ scene\.cellPx;/.test(INTERACT_SRC),
    'interact.js derives metres-per-pixel from the cell size');
  assert.falsy(/scene\.feetOffsetM \/ 14/.test(INTERACT_SRC),
    'interact.js no longer divides feetOffsetM by 14 (which is 0 / 14 now)');
});
})();
