test('shrine footing lifts sprite and shadow together while preserving the world record', () => {
  const shrine = { kind: 'grove_shrine', shrineKind: 'bone_watcher', id: 'depth-shrine', x: 17.3, y: 24.7 };
  const saved = JSON.stringify(shrine);
  const art = Render.objectAppearance({ textures: { exists: () => true }, save: {} }, new Map());
  const look = art.resolveAppearance(shrine);
  const box = SpriteLayout.ART_BOUNDS[`${look.texKey}:${look.frameVal}`];
  const seat = SpriteLayout.contactSeat(box, look.origin[0], look.origin[1], look.scl, look.scl * look.scaleYMul, false);
  const lift = SHRINE_PAD.seatLiftPx * SpriteLayout.CELL_PX / SHRINE_PAD.sizePx;
  assert.eq(look.dyPx, seat.dyPx - lift);
  assert.eq(look.foot.footFromCentre, 5 * look.scl * look.scaleYMul - lift);
  assert.eq(JSON.stringify(shrine), saved, 'visual seating leaves GPS and interactions untouched');
  assert.falsy(Render.hasShrineFooting({ ...shrine, _shrineArt: 'shipwreck' }), 'large shipwreck keeps its own ground seating');
});
