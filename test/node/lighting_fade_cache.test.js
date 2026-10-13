// Interrupted reach fades keep exact history, but only visible, meaningful
// contributions need full-size canvases. Exercise the real cache with tiny
// canvas stand-ins so aliasing is observable without a browser.
(function () {
  function helpers() {
    const begin = LIGHTING_SRC.indexOf('  function contributionKey(');
    const end = LIGHTING_SRC.indexOf('  function contributionPending(', begin);
    let serial = 0;
    const document = { createElement: () => {
      const canvas = { id: ++serial, width: 0, height: 0 };
      canvas.getContext = () => ({ canvas, clearRect() {} });
      return canvas;
    } };
    return new Function('document', 'CELL_PX', 'VIEW_CELLS',
      'LIGHT_CACHE_PAD_CELLS', 'LIGHT_CACHE_LIMIT_CELLS', 'viewAnchorAbsCell',
      'viewBand', 'absCellDelta', 'plateauPlacement', 'paintReachMask',
      LIGHTING_SRC.slice(begin, end) + '; return { visibleReachFrames, contributionFrames };')(
      document, 24, 11, 2, 1.5,
      (scene, pc) => ({ cellIX: pc.x, cellIY: pc.y }),
      scene => ({ dX: scene.bandShift || 0 }),
      (scene, ax, ay, bx, by) => ({ dx: bx - ax - (scene.bandShift || 0), dy: by - ay }),
      () => ({ x: 0, y: 0, structure: '' }),
      (ctx, scene, ox, oy, rp) => { ctx.canvas.mask = `${rp.cellIX}|${rp.cellIY}`; });
  }
  const frame = (x, y, weight) => ({ key: `${x}|${y}|17.5`,
    rp: { cellIX: x, cellIY: y }, reachM: 17.5, weight });

  test('lighting fade: render pruning bounds total alpha error and leaves history exact', () => {
    const { visibleReachFrames } = helpers();
    const scene = { depth: 0, cellM: 7 };
    const pc = { x: 0, y: 0 };
    for (let i = 0; i < 500; i++) {
      const frames = Lighting.reachFrames(scene,
        { cellIX: i % 7 - 3, cellIY: Math.floor(i / 7) % 7 - 3 }, 17.5, i * 50);
      const original = Lighting.reachFramesKey(frames);
      const retained = visibleReachFrames(scene, pc, frames);
      const omitted = frames.filter(f => !retained.includes(f)).reduce((sum, f) => sum + f.weight, 0);
      assert.lt(omitted, 1 / 255, 'even a fully opaque omitted pixel loses less than one alpha level');
      assert.eq(Lighting.reachFramesKey(frames), original, 'render filtering cannot mutate the exact fade');
      for (const f of retained) assert.truthy(frames.includes(f), 'weights remain exact without renormalisation');
    }
  });

  test('lighting fade: distant masks need no canvases without brightening the visible mixture', () => {
    const { contributionFrames, visibleReachFrames } = helpers();
    const scene = { cellM: 7 };
    const frames = [frame(0, 0, 0.4), frame(100, 0, 0.3), frame(0, 100, 0.3)];
    const visible = visibleReachFrames(scene, { x: 0, y: 0 }, frames);
    assert.eq(visible.length, 1);
    assert.eq(visible[0].weight, 0.4);
    const result = contributionFrames(scene, 264, 264, 0, 0, true, { x: 0, y: 0 }, frames);
    assert.eq(result.items.length, 1);
    assert.eq(scene._lightContribution.entries.length, 1);
    scene.bandShift = 100;
    assert.eq(visibleReachFrames(scene, { x: 0, y: 0 }, [frame(0, 0, 1)]).length, 1,
      'row-grid shifts use the same reach-distance transform as mask painting');
  });

  test('lighting fade: active canvases never alias and settled history releases surplus caches', () => {
    const { contributionFrames } = helpers();
    const scene = { cellM: 7 };
    const frames = Array.from({ length: 7 }, (_, i) => frame(i - 3, 0, 1 / 7));
    const draw = fs => contributionFrames(scene, 264, 264, 0, 0, true, { x: 0, y: 0 }, fs);
    const first = draw(frames);
    assert.eq(new Set(first.items.map(item => item.canvas)).size, 7);
    first.items.forEach((item, i) => assert.eq(item.canvas.mask,
      `${frames[i].rp.cellIX}|0`, 'later cache allocations cannot overwrite an earlier returned mask'));
    const builds = scene._lightContribution.rebuilds;
    draw([...frames].reverse());
    assert.eq(scene._lightContribution.rebuilds, builds, 'all active masks stay reusable across frames');
    const shifted = frames.slice(1).concat(frame(4, 0, 1 / 7));
    draw(shifted);
    assert.eq(scene._lightContribution.rebuilds, builds + 1, 'only the newly active mask rebuilds');
    const settled = draw([frame(0, 0, 1)]);
    assert.eq(settled.items.length, 1);
    assert.lte(scene._lightContribution.entries.length, 4, 'surplus active canvases are released after settling');
    draw(frames);
    for (const entry of scene._lightContribution.entries) entry.pending = true;
    const disabled = contributionFrames(scene, 264, 264, 0, 0, false, { x: 0, y: 0 }, frames);
    assert.eq(disabled.items.length, 0);
    assert.lte(scene._lightContribution.entries.length, 4, 'disabling the plateau also releases surplus canvases');
    assert.truthy(scene._lightContribution.entries.every(entry => !entry.pending),
      'disabled plateau clears pending rebuilds');
  });

  test('lighting fade: spatial culling preserves real row-seam reach cells during camera peeks', () => {
    const begin = LIGHTING_SRC.indexOf('  function visibleReachFrames(');
    const end = LIGHTING_SRC.indexOf('  // Build or crop each padded reach mask.', begin);
    const visible = new Function('VIEW_CELLS', 'viewAnchorAbsCell', 'viewBand', 'absCellDelta',
      LIGHTING_SRC.slice(begin, end) + '; return visibleReachFrames;')(
      VIEW_CELLS, viewAnchorAbsCell, viewBand, absCellDelta);
    const scene = { cellM: 7, cellsPerTile: 51,
      originPx: { x: 1000 * WorldGen.TILE_PX, y: 0 },
      cellsForRow: ty => ty <= 0 ? 51 : 52 };
    const body = tileCellToAbs(scene, 1000, 0, 25, 50);
    const half = (VIEW_CELLS - 1) / 2;
    let rejected = 0, retained = 0, shiftedBands = 0;
    for (const pc of [
      { tx: 1000, ty: 0, cx: 25.25, cy: 50.75 },
      { tx: 1000, ty: 1, cx: 25.75, cy: 0.25 },
      { tx: 1000, ty: 0, cx: 33.75, cy: 47.25 },
      { tx: 1000, ty: 1, cx: 17.25, cy: 3.75 },
    ]) {
      const base = viewAnchorAbsCell(scene, pc);
      const cells = [];
      for (let row = -1; row <= VIEW_CELLS; row++) {
        const iy = base.cellIY + row - half;
        const band = viewBand(scene, pc, iy);
        if (band.dX || band.phaseX) shiftedBands++;
        for (let col = -1; col <= VIEW_CELLS; col++) {
          cells.push({ cellIX: base.cellIX + col - half + band.dX, cellIY: iy });
        }
      }
      for (let dy = -18; dy <= 18; dy += 2) for (let dx = -24; dx <= 24; dx += 2) {
        const rp = absCellOffset(scene, body.cellIX, body.cellIY, dx, dy);
        const f = frame(rp.cellIX, rp.cellIY, 1);
        if (visible(scene, pc, [f]).length) { retained++; continue; }
        rejected++;
        for (const cell of cells) {
          const d = absCellDelta(scene, rp.cellIX, rp.cellIY, cell.cellIX, cell.cellIY);
          assert.gt((d.dx * scene.cellM) ** 2 + (d.dy * scene.cellM) ** 2,
            f.reachM ** 2, 'a culled mask has no cell the original reach painter could fill');
        }
      }
    }
    assert.gt(shiftedBands, 0, 'fixture crosses rows with different cell counts and screen phases');
    assert.gt(rejected, 0, 'distant masks actually exercise the cull');
    assert.gt(retained, 0, 'nearby masks survive camera peeks on both sides of the seam');
  });

  test('lighting fade: sustained straight crossings allocate only nearby meaningful masks', () => {
    const { contributionFrames } = helpers();
    const scene = { depth: 0, cellM: 7 };
    for (let i = 0; i < 300; i++) {
      const frames = Lighting.reachFrames(scene, { cellIX: i, cellIY: 0 }, 17.5, i * 50);
      contributionFrames(scene, 264, 264, 0, 0, true, { x: i, y: 0 }, frames);
      assert.lte(scene._lightContribution.entries.length, 12, 'offscreen history cannot accumulate canvas memory');
    }
  });
})();
