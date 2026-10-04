(() => {
  const row = StreetVariants.STREET_VARIANTS[0];
  const anchor = { kind: 'grove', gx: 8192, gy: 12288, lx: 0, ly: 0, owned: true, variant: 'meadow' };
  test('variant labels: generated selections, shrine position and owned anchors win over buffered copies', () => {
    const owner = { tx: 2, ty: 3, objects: [{ kind: 'grove_shrine', _poiAt: '0,0', x: 205, y: 306 }],
      zone: { anchors: [anchor] } };
    const buffer = { tx: 1, ty: 3, zone: { anchors: [{ ...anchor, owned: false }] } };
    for (const entries of [[buffer, owner], [owner, buffer]]) {
      const labels = Render.variantLabelRecords(entries, 100, 200, 300, 20);
      assert.eq(labels.length, 1, 'one label across buffered copies');
      assert.eq(labels[0].text, 'Zone: Meadow');
      assert.eq(labels[0].x, 205); assert.eq(labels[0].y, 306, 'label follows the settled named shrine');
    }
    assert.eq(Render.variantLabelRecords([owner], 100, 500, 300, 20).length, 0, 'off-camera zones culled');
  });
  test('variant labels: visible road arclength midpoint, clipping and street-key deduplication', () => {
    const rec = { key: 'same street', variant: row.id, line: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 60 }] };
    const e = { tx: 1, ty: 1, streetIndex: { extent: 100, lines: [rec, rec] } };
    let labels = Render.variantLabelRecords([e], 100, 140, 110, 100);
    assert.eq(labels.length, 1); assert.eq(labels[0].text, `Road: ${row.title}`);
    assert.eq(labels[0].x, 140); assert.eq(labels[0].y, 110, 'midpoint follows arclength around the bend');
    e.streetIndex.lines = [{ ...rec, line: [{ x: -500, y: 0 }, { x: 200, y: 0 }] }];
    labels = Render.variantLabelRecords([e], 100, 110, 100, 10);
    assert.eq(labels.length, 1, 'a long road crossing the camera stays labelled');
    assert.eq(labels[0].x, 110); assert.eq(labels[0].y, 100);
    assert.eq(Render.variantLabelRecords([e], 100, 110, 150, 10).length, 0, 'nonintersecting road culled');
  });
  test('variant labels: a plain gap cannot hide the visible themed stretch', () => {
    const rec = { key: 'mixed street', size: 'minor', variant: 'golden',
      variantRanges: [[40, 80]], line: [{x:0,y:0},{x:100,y:0}] };
    const e = { tx:0,ty:0,streetIndex:{extent:100,lines:[rec]} };
    const labels = Render.variantLabelRecords([e],100,30,0,80);
    assert.truthy(labels.some(l => l.text === 'Road: Golden Road' && l.x >=40 && l.x <=80));
    assert.truthy(labels.some(l => l.text === 'Road: Plain street' && (l.x<40 || l.x>80)));
  });
  test('variant labels: pooled draw follows camera projection and clears on toggle or underground', () => {
    const previous = new Map(WorldGen.tileCache), made = [];
    const text = () => {
      const t = { setOrigin() { return this; }, setDepth() { return this; },
        setText(v) { this.text = v; return this; }, setPosition(x, y) { this.x = x; this.y = y; return this; },
        setVisible(v) { this.visible = v; return this; },
        // The pool's identity reset (render.js resetSlot) and the family shadow.
        setAlpha() { return this; }, setAngle() { return this; }, setScale() { return this; },
        setFlipX() { return this; }, clearTint() { return this; }, setShadow() { return this; } };
      made.push(t); return t;
    };
    const scene = { debugVariantLabels: true, depth: 0, tileEdgeM: 100, cellM: 10,
      viewCenterX: 100, viewCenterY: 100, add: { text }, labelContainer: { add() {} } };
    try {
      WorldGen.tileCache.clear();
      WorldGen.tileCache.set(WorldGen.tileKey(2, 3), { zone: { anchors: [anchor] } });
      Render.drawVariantLabels(scene, 200, 300, 30);
      assert.eq(made.length, 1); assert.eq(made[0].x, 100); assert.eq(made[0].y, 82);
      Render.drawVariantLabels(scene, 210, 300, 30);
      assert.eq(made.length, 1, 'reuse text'); assert.eq(made[0].x, 68, 'camera peek slides label one cell');
      scene.debugVariantLabels = false; Render.drawVariantLabels(scene, 210, 300, 30);
      assert.falsy(made[0].visible, 'toggle clears pooled text');
      scene.debugVariantLabels = true; scene.depth = 1; Render.drawVariantLabels(scene, 210, 300, 30);
      assert.falsy(made[0].visible, 'surface labels do not leak underground');
      scene.depth = 0; Render.drawVariantLabels(scene, 200, 300, 30);
      assert.truthy(made[0].visible); assert.eq(made.length, 1);
    } finally {
      WorldGen.tileCache.clear(); for (const [k, v] of previous) WorldGen.tileCache.set(k, v);
    }
  });
})();
