// Movement must translate standing art and retained ground by the same pixels.
// Fractional GPS/joystick movement previously changed their rounding phases.
function panAlignmentScene(origin = 0) {
  const cellM = 7, cellsPerTile = 32;
  const mPerPx = cellM * cellsPerTile / WorldGen.TILE_PX;
  return {
    startWorldM: { x: origin, y: -origin },
    originPx: { x: origin / mPerPx, y: -origin / mPerPx },
    mPerPx, cellsPerTile, cellM,
    playerM: { x: 0, y: 0 }, peekM: { x: 0, y: 0 },
    viewCenterX: 176, viewCenterY: 200,
    viewLeft: 0, viewTop: 24, viewSize: 352,
  };
}
function panAlignmentNear(a, b, message) {
  assert.inRange(a, b - 1e-7, b + 1e-7, message);
}

test('render pan: stationary sprites retain their offset from cached ground while walking', () => {
  for (const origin of [0, 1234567.89, -1234567.89]) {
    const scene = panAlignmentScene(origin);
    scene.playerM = { x: -3.1, y: -2.9 };
    const anchor = viewAnchorWorldM(scene), pc = viewAnchorCell(scene);
    const fracX = pc.cx - Math.floor(pc.cx), fracY = pc.cy - Math.floor(pc.cy);
    const paint = overlayProjection(scene, fracX, fracY);
    const previous = { x: anchor.x - fracX * scene.cellM, y: anchor.y - fracY * scene.cellM };
    const world = { x: origin + 8.123, y: -origin + 7.456 };
    const baked = { x: paint.projX(world.x), y: paint.projY(world.y) };
    let initial;
    for (let i = 0; i <= 100; i++) {
      scene.playerM.x = -3.1 + i * .071;
      scene.playerM.y = -2.9 + i * .063;
      const point = worldMetersToScreen(scene, world.x, world.y);
      const offset = retainedOverlayOffset(scene, previous, {});
      assert.truthy(offset, 'retained ground remains inside its padding');
      const gap = {
        x: Math.round(point.x) - (baked.x - offset.fracX * CELL_PX),
        y: Math.round(point.y) - (baked.y - offset.fracY * CELL_PX),
      };
      initial ||= gap;
      panAlignmentNear(gap.x, initial.x, 'sprite does not slide across ground horizontally');
      panAlignmentNear(gap.y, initial.y, 'sprite does not slide across ground vertically');
    }
  }
});

test('render pan: terrain cells and standing art share movement across a cell boundary', () => {
  const scene = panAlignmentScene();
  const cell = worldMetersToAbsCell(scene, 10, 10);
  const world = absCellCenterMeters(scene, cell.cellIX, cell.cellIY);
  let initial;
  for (let i = 0; i <= 160; i++) {
    scene.playerM = { x: -7.2 + i * .091, y: 7.2 - i * .083 };
    const pc = viewAnchorCell(scene);
    const ground = absCellScreenCentre(scene, pc, cell.cellIX, cell.cellIY);
    const sprite = worldMetersToScreen(scene, world.x, world.y);
    const gap = { x: Math.round(sprite.x) - ground.x, y: Math.round(sprite.y) - ground.y };
    initial ||= gap;
    panAlignmentNear(gap.x, initial.x, 'terrain and sprite X stay attached across cells');
    panAlignmentNear(gap.y, initial.y, 'terrain and sprite Y stay attached across cells');
  }
});

test('render pan: rounded camera preserves inverse taps and exact gameplay positions', () => {
  const scene = panAlignmentScene(987654.321);
  scene.playerM = { x: -8.713, y: 5.143 };
  scene.peekM = { x: 1.119, y: -2.317 };
  const original = JSON.stringify([scene.playerM, scene.peekM, scene.startWorldM]);
  const player = playerWorldM(scene);
  for (const delta of [-10.57, 0, 11.43]) {
    const world = { x: player.x + delta, y: player.y - delta * .71 };
    const screen = worldMetersToScreen(scene, world.x, world.y);
    const back = screenToWorldMeters(scene, screen.x, screen.y);
    panAlignmentNear(back.x, world.x, 'tap inverse preserves world X');
    panAlignmentNear(back.y, world.y, 'tap inverse preserves world Y');
  }
  viewAnchorCell(scene);
  assert.eq(JSON.stringify([scene.playerM, scene.peekM, scene.startWorldM]), original,
    'render projection never mutates gameplay or peek positions');
  assert.eq(playerWorldM(scene).x, player.x, 'exact player X stays unchanged');
  assert.eq(playerWorldM(scene).y, player.y, 'exact player Y stays unchanged');
});
