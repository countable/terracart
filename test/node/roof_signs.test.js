// ROOF SIGNS (shop signboards, delivery callouts) are <body> overlays at
// fixed screen positions, hidden only by drawObjects' sign pass. Owner, Oct
// 2026: entering a cave, a shop sign rode along with the player for
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
    assert.truthy(/body\.modal-open \.shop-sign,/.test(INDEX_HTML_SRC), 'the CSS net covers the shop signboard class too');
  });
  // A shop's line board is coloured by its tier and sits on the tier chip's
  // row, just left of it (owner, Oct 2026).
  test('shop signs: the board wears its tier chip\'s colours and sits beside the chip', () => {
    const scene = { save: { shopTiers: { h: 4 } }, shopLine: () => ({ theme: 'potion', tier: 4 }) };
    const badge = Render.shopTierBadge(scene, { kind: 'house', id: 'h' }, 'shop');
    const look = Render.shopSignLook(badge);
    assert.eq(look.background, badge.backgroundColor, 'the board is the tier colour');
    assert.eq(look.ink, badge.color, 'its glyph is the chip\'s ink');
    assert.truthy(look.border !== look.background, 'a darker rim of the same hue');
    assert.eq(Render.shopSignLook(null).background, '#ead4a0', 'an unranked shop keeps the plain board');
    assert.truthy(/const lead = signed \? SHOP_SIGN_PX \+ SHOP_SIGN_GAP : 0;/.test(RENDER_SRC), 'the chip makes room for the board');
    assert.truthy(/signSeats\.set\(id, \{ x: left \+ SHOP_SIGN_PX \/ 2,/.test(RENDER_SRC), 'the board is seated left of the chip');
    assert.truthy(/const signX = shop \? seat\.x : sx;/.test(RENDER_SRC), 'the DOM board reads its seat');
  });
})();
