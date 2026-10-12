// ROOF SIGNS (the delivery callouts) are <body> overlays at
// fixed screen positions, hidden only by drawObjects' sign pass. Owner, Oct
// 2026: entering a cave, a roof sign rode along with the player for
// seconds. Anything that can skip the pass hides them itself.
(function () {
  test('roof signs: hideRoofSigns hides every pooled sign, through the style cache', () => {
    const el = () => ({ style: {}, _styleOnce: { display: 'flex' } });
    const scene = { _produceSignPool: [{ el: el() }, { el: el() }, {}] };
    Render.hideRoofSigns(scene);
    for (const s of scene._produceSignPool.slice(0, 2)) {
      assert.eq(s.el.style.display, 'none');
      assert.eq(s.el._styleOnce.display, 'none', 'the cache agrees, so the next pass can show it again');
    }
    Render.hideRoofSigns({});   // no pool yet: a no-op
  });
  test('roof signs: a floor change, a broken frame and an open dialog all hide them', () => {
    assert.truthy(/WorldGen\.setDepth\(target\);\n\s*\/\/[^\n]*\n\s*Render\.hideRoofSigns\(this\);/.test(APP_JS_SRC), 'changeDepth');
    assert.truthy(/catch \(e\) \{[\s\S]{0,200}Render\.hideRoofSigns\(this\)[\s\S]{0,120}this\._reportLoopError\(e\);/.test(APP_JS_SRC), 'a swallowed loop error');
  });
  // A ranked or themed building hangs ONE plate in its tier colour: glyph,
  // name and tier word together (owner, Oct 2026).
  test('shop signs: one tier-coloured plate carries the glyph, the name and the tier', () => {
    const scene = { save: { shopTiers: { h: 4 } }, shopLine: () => ({ theme: 'potion', tier: 4 }) };
    const badge = Render.shopTierBadge(scene, { kind: 'house', id: 'h' }, 'shop');
    const look = Render.shopSignLook(badge);
    assert.eq(look.background, badge.backgroundColor, 'the plate is the tier colour');
    assert.truthy(parseInt(look.ink.slice(1), 16) < parseInt(look.border.slice(1), 16), 'lettering and glyph a deeper shade of the tier than the rim');
    assert.truthy(look.border !== look.background, 'a darker rim of the same hue');
    assert.eq(Render.shopSignLook(null).background, '#ead4a0', 'an unranked shop keeps the plain board');
    for (const theme of Object.keys(Render.SHOP_SIGN_ICONS)) {
      const g = Render.shopSignGlyph(theme);
      assert.truthy(g && g.length === 9 && g.every((r) => r.length === 9), theme + ' has a 9x9 glyph');
    }
    const rects = [], fills = [];
    const gfx = { fillStyle(c, a) { fills.push([c, a]); return this; }, fillRect(x, y, w, h) { rects.push({ x, y, w, h }); return this; } };
    const text = (w, h) => ({ width: w, height: h, setColor() {}, setPosition(x, y) { this.x = x; this.y = y; return this; }, setAlpha(a) { this.alpha = a; return this; } });
    const item = { badge, theme: 'potion', name: text(60, 13), tier: text(30, 10) };
    const box = Render.drawShopPlate(gfx, item, { x: 200, y: 100 }, null, 400);
    const P = Render.SHOP_PLATE;
    assert.eq(box.h, 2 * P.pad + 23 + P.lead, 'the plate spans the name and the tier word');
    assert.eq(box.w, 2 * P.pad + 9 * P.cell + P.gap + 60, 'glyph then lettering');
    assert.truthy(item.name.x > box.x + 9 * P.cell && item.tier.y === item.name.y + 13 + P.lead, 'lettering right of the glyph, tier under the name');
    assert.truthy(item.name.y >= box.y && item.tier.y + 10 <= box.y + box.h, 'lettering inside the plate');
    assert.truthy(fills.some(([c]) => c === parseInt(badge.backgroundColor.slice(1), 16)), 'filled with the tier colour');
  });
})();
