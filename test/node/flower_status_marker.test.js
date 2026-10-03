(() => {
  test('flower markers: sleep and charm both stay visible and disappear at their combat expiry', () => {
    const c = { id: 'foe', kind: 'slime' }, now = 1000;
    Combat.applyCharm(c, now);
    assert.eq(Render.flowerStatusMarker(c, now).text, '♥');
    assert.eq(Render.flowerStatusMarker(c, now + Combat.FLOWER_STATUS_MS - 1).text, '♥');
    assert.eq(Render.flowerStatusMarker(c, now + Combat.FLOWER_STATUS_MS), null);
    Combat.applySleep(c, now);
    Combat.applyCharm(c, now + 5000);
    assert.eq(Render.flowerStatusMarker(c, now + 1).text, '♥ Zzz');
    assert.eq(Render.flowerStatusMarker(c, now + Combat.FLOWER_STATUS_MS).text, '♥');
    assert.eq(Render.flowerStatusMarker(c, now + 5000 + Combat.FLOWER_STATUS_MS), null);
  });

  test('flower markers: pooled labels track creature crowns and clear after expiry or culling', () => {
    const texts = [], permanentHeart = {};
    const scene = {
      _petHeartPool: [permanentHeart],
      creaturesContainer: { add() {} },
      add: { text() {
        const t = {
          setOrigin(x, y) { this.originX = x; this.originY = y; return this; },
          setDepth(depth) { this.depth = depth; return this; },
          setText(text) { this.text = text; return this; },
          setPosition(x, y) { this.x = x; this.y = y; return this; },
          setVisible(visible) { this.visible = visible; return this; },
          setColor(color) { this.color = color; return this; },
          // The pool's identity reset (render.js resetSlot).
          setAlpha(a) { this.alpha = a; return this; }, setAngle(a) { this.angle = a; return this; },
          setScale(k) { this.scale = k; return this; }, setFlipX(f) { this.flipX = f; return this; },
          clearTint() { this.tint = null; return this; },
          setShadow() { return this; },   // the label family's drop shadow, set at creation
        };
        texts.push(t); return t;
      } },
    };
    const now = 1000, c = { id: 'foe', kind: 'slime' };
    const creatures = [{ c, dx: 30, dy: 70 }];
    const project = (dx, dy) => ({ x: dx, y: dy });   // coords.js deltaMToScreen's shape
    Combat.applyCharm(c, now);
    Render.drawFlowerStatusMarkers(scene, creatures, project, now);
    const marker = texts[0], charmColor = marker.color;
    assert.eq(marker.text, '♥');
    assert.eq(marker.x, 30);
    assert.eq(marker.y, Math.round(70 + SpriteLayout.creatureHealthBarTop(c.kind) - 2));
    assert.eq(marker.originY, 1, 'bottom of marker sits above health-bar line');
    assert.eq(marker.depth, 10000, 'same overlay band as other creature markers');
    Combat.applySleep(c, now);
    Render.drawFlowerStatusMarkers(scene, creatures, project, now);
    assert.eq(texts.length, 1, 'reuses existing label');
    assert.eq(marker.text, '♥ Zzz', 'a sleeping ally retains its heart');
    assert.eq(marker.color, charmColor, 'combined effects retain the charm ink');
    delete c._charmUntil;
    Render.drawFlowerStatusMarkers(scene, creatures, project, now);
    assert.eq(marker.text, 'Zzz');
    assert.truthy(marker.color !== charmColor, 'sleep alone uses its own ink');
    Render.drawFlowerStatusMarkers(scene, [], project, now);
    assert.falsy(marker.visible, 'culled creatures leave no label behind');
    Render.drawFlowerStatusMarkers(scene, creatures, project, now);
    assert.truthy(marker.visible, 'returning creatures reuse hidden labels');
    Render.drawFlowerStatusMarkers(scene, creatures, project, now + Combat.FLOWER_STATUS_MS);
    assert.falsy(marker.visible, 'expired status leaves no label behind');
    assert.eq(scene._petHeartPool[0], permanentHeart, 'permanent pet-heart pool is untouched');
  });
})();
