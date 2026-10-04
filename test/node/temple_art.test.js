(function () {
  function recorder() {
    const stack = [], c = { ops: [], path: [], shadowBlur: 0, shadowColor: '', clipDepth: 0,
      save() { stack.push({ clipDepth: this.clipDepth, shadowBlur: this.shadowBlur, shadowColor: this.shadowColor }); },
      restore() { Object.assign(this, stack.pop()); },
      beginPath() { this.path = []; },
      moveTo(x, y) { this.path.push(['M', x, y]); },
      lineTo(x, y) { this.path.push(['L', x, y]); },
      closePath() { this.path.push(['Z']); },
      arc(x, y, r) { this.path.push(['A', x, y, r]); },
      clip() { this.clipDepth++; this.ops.push({ op: 'clip', path: this.path.slice() }); },
      translate(x, y) { this.ops.push({ op: 'translate', x, y }); },
      fill() { this.ops.push({ op: 'fill', path: this.path.slice(), color: this.fillStyle }); },
      stroke() { this.ops.push({ op: 'stroke', path: this.path.slice(), color: this.strokeStyle,
        clipDepth: this.clipDepth, glow: this.shadowBlur }); },
      strokeRect() { this.ops.push({ op: 'slab', clipDepth: this.clipDepth }); },
    };
    return c;
  }
  const ring = [0, 0, 100, 0, 100, 40, 40, 40, 40, 100, 0, 100];
  test('temple art: keeps concave footprint and clips masonry and smooth coping inside it', () => {
    const ctx = recorder(); TempleArt.draw(ctx, ring, { faces: false });
    const floor = ctx.ops.find(o => o.op === 'fill');
    assert.eq(JSON.stringify(floor.path), JSON.stringify([
      ['M', 0, 0], ['L', 100, 0], ['L', 100, 40], ['L', 40, 40], ['L', 40, 100], ['L', 0, 100], ['Z'],
    ]), 'retains the notch instead of filling its bounding rectangle');
    const coping = ctx.ops.filter(o => o.op === 'stroke' && o.color === TempleArt.colors.coping);
    assert.eq(coping.length, 1, 'one continuous band; no repeated corner turrets');
    assert.eq(JSON.stringify(coping[0].path), JSON.stringify(floor.path));
    for (const op of ctx.ops.filter(o => o.op === 'stroke' || o.op === 'slab')) assert.gt(op.clipDepth, 0);
    assert.eq(ctx.clipDepth, 0, 'restores caller clipping state');
  });
  test('temple art: activation illuminates existing rune geometry without moving it', () => {
    const dormant = recorder(), lit = recorder();
    TempleArt.drawRunes(dormant, ring);
    TempleArt.drawRunes(lit, ring, { activated: true });
    const strokes = ctx => ctx.ops.filter(o => o.op === 'stroke');
    assert.gt(strokes(lit).length, 5, 'perimeter and altar runes are rendered');
    assert.eq(JSON.stringify(strokes(dormant).map(o => o.path)), JSON.stringify(strokes(lit).map(o => o.path)));
    for (const op of strokes(dormant)) { assert.eq(op.color, TempleArt.colors.dormant); assert.eq(op.glow, 0); }
    for (const op of strokes(lit)) { assert.eq(op.color, TempleArt.colors.active); assert.gt(op.glow, 0); }
    assert.eq(lit.shadowBlur, 0, 'light does not leak into the next painter');
    for (const op of strokes(lit)) for (const p of op.path.filter(p => p[0] === 'A')) {
      assert.truthy(p[1] < 40 || p[2] < 40, 'altar is inside an arm of the L, not in the courtyard notch');
    }
  });
  test('temple art: accepts projected points as well as flat source coordinates', () => {
    const flat = recorder(), projected = recorder();
    TempleArt.draw(flat, Float32Array.from(ring));
    TempleArt.draw(projected, Array.from({ length: ring.length / 2 }, (_, i) => ({ x: ring[i * 2], y: ring[i * 2 + 1] })));
    assert.eq(JSON.stringify(flat.ops), JSON.stringify(projected.ops));
  });
  test('temple art: tar pits use dark masonry and the same cyan rune light', () => {
    const marble = recorder(), tar = recorder();
    TempleArt.draw(marble, ring, { activated: true, faces: false });
    TempleArt.draw(tar, ring, { activated: true, dark: true, faces: false });
    assert.eq(marble.ops.find(o => o.op === 'fill').color, TempleArt.colors.floor);
    assert.eq(tar.ops.find(o => o.op === 'fill').color, TempleArt.darkColors.floor);
    assert.lt(TempleArt.palette(true, true).floor, TempleArt.palette(true).floor);
    const light = ctx => ctx.ops.filter(o => o.op === 'stroke' && o.glow > 0).map(o => [o.path, o.color]);
    assert.eq(JSON.stringify(light(marble)), JSON.stringify(light(tar)));
  });
  test('temple overlay: castle-sized temple bypasses ordinary building passes and repaints on activation', () => {
    const oldTiles = new Map(WorldGen.tileCache);
    const gfx = { ops: [], clears: 0, clear() { this.ops = []; this.clears++; },
      fillPoly(pts, color) { this.ops.push({ op: 'fill', color }); },
      strokePoly() { this.ops.push({ op: 'outline' }); },
      templePoly(pts, activated) { this.ops.push({ op: 'temple', activated, pts }); },
      insetStroke() { throw new Error('A temple must not draw castle battlements'); },
      texturePoly() { throw new Error('A temple must not draw ordinary building textures'); },
      blobsPoly() { throw new Error('A temple must not draw unclaimed building slime'); },
      gridPoly() {}, texturePhase() {}, commit() {} };
    const scene = { startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 }, mPerPx: 10,
      originPx: { x: 0, y: 0 }, cellM: 5, cellsPerTile: 512, depth: 0,
      save: { temples: { 'park-test': { active: false, hadEnemies: true } } },
      viewCenterX: 176, viewCenterY: 176, viewLeft: 0, viewTop: 0, viewSize: 352,
      buildingGeomGfx: gfx, buildingGeomContainer: { setVisible() {}, setPosition() {} },
      isClaimedKey() { throw new Error('Temples are not claimed castles'); },
      playerToWorldCell() { return { tx: 0, ty: 0, cx: 0, cy: 0 }; } };
    try {
      WorldGen.tileCache.clear();
      WorldGen.tileCache.set(WorldGen.tileKey(0, 0), { tileEdgeM: 2560, buildingShapes: [{
        ring: Float32Array.from([0, 0, 10, 0, 10, 10, 0, 10]), tier: WorldGen.T.BUILDING_LARGE,
        key: 'temple-test', templeZone: 'park-test', areaM2: 100,
      }] });
      BuildingOverlay.draw(scene);
      assert.eq(gfx.ops.find(o => o.op === 'temple').activated, false);
      const clearCount = gfx.clears;
      BuildingOverlay.draw(scene); assert.eq(gfx.clears, clearCount, 'unchanged temple is cached');
      scene.save.temples['park-test'].active = true;
      BuildingOverlay.draw(scene);
      assert.eq(gfx.clears, clearCount + 1, 'awakening invalidates floor cache');
      assert.eq(gfx.ops.find(o => o.op === 'temple').activated, true);
      assert.eq(gfx.ops.find(o => o.op === 'fill').color, TempleArt.palette().face);
    } finally {
      WorldGen.tileCache.clear(); for (const [key, entry] of oldTiles) WorldGen.tileCache.set(key, entry);
    }
  });
})();
