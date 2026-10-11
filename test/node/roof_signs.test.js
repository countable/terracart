// ROOF SIGNS (market signboards, delivery callouts) are <body> overlays at
// fixed screen positions, hidden only by drawObjects' sign pass. Owner, Oct
// 2026: entering a cave, a market sign rode along with the player for
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
    assert.truthy(/body\.modal-open \.market-sign,/.test(INDEX_HTML_SRC), 'the CSS net covers the market signboard class too');
  });
})();
