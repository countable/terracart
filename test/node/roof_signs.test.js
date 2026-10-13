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
  // A ranked or themed building hangs ONE plate in its tier colour carrying
  // its symbol (owner, Oct 2026).
  test('shop signs: one tier-coloured board carries the symbol, the tier is its colour', () => {
    const scene = { save: { shopTiers: { h: 4 } }, shopLine: () => ({ theme: 'potion', tier: 4 }) };
    const badge = Render.shopTierBadge(scene, { kind: 'house', id: 'h' }, 'shop');
    const look = Render.shopSignLook(badge);
    const lum = (css) => { const c = parseInt(css.slice(1), 16); return (c >> 16) + ((c >> 8) & 255) + (c & 255); };
    const tierLum = lum(badge.backgroundColor);
    assert.truthy(lum(look.background) < tierLum && lum(look.rim) > lum(look.background), 'dark tier material, a light rim');
    assert.truthy(lum(look.ink) > tierLum, 'letters a pale tint of the tier');
    assert.truthy(Render.shopSignLook(null).background !== look.background, 'an unranked shop wears signboard wood');
    for (const theme of Object.keys(Render.SHOP_SIGN_ICONS)) {
      const g = Render.shopSignGlyph(theme);
      assert.truthy(g && g.length === 9 && g.every((r) => r.length === 9), theme + ' has a 9x9 glyph');
    }
    const rects = [], fills = [];
    const gfx = { fillStyle(c, a) { fills.push([c, a]); return this; }, fillRect(x, y, w, h) { rects.push({ x, y, w, h }); return this; } };
    const text = (w, h) => ({ width: w, height: h, setColor() {}, setShadow() {}, setPosition(x, y) { this.x = x; this.y = y; return this; }, setAlpha(a) { this.alpha = a; return this; } });
    const P = Render.SHOP_PLATE;
    assert.eq(Render.shopSignGlyph(null, 'blacksmith'), INV_CAT_BY_KEY.armor.px, 'a smithy shows the armour symbol');
    assert.eq(Render.shopSignGlyph(null, 'trader'), null, 'a trader has none');
    const item = { badge, glyph: Render.shopSignGlyph('potion'), name: text(60, 13) };
    const box = Render.drawShopPlate(gfx, item, { x: 200, y: 100 }, null, 400);
    assert.eq(box.w, 2 * P.padGlyph + Math.round(9 * P.cell), 'the board is just the symbol');
    assert.eq(Render.ROLE_SIGN_ICONS.blacksmith.dy, 3, 'a smithy\'s board sits 3px lower on its roof');
    assert.eq(box.h, 2 * P.padGlyph + 1 + Math.round(9 * P.cell), 'plus a row for its shadow');
    assert.eq(item.name.x, undefined, 'no lettering beside a symbol');
    assert.truthy(fills.some(([c]) => c === parseInt(look.background.slice(1), 16)), 'the board is the dark tier material');
    const lettered = { badge, glyph: null, name: text(60, 13) };
    const lbox = Render.drawShopPlate(gfx, lettered, { x: 200, y: 100 }, null, 400);
    assert.eq(lbox.w, 2 * P.padX + 60, 'without a symbol the board letters its name');
    assert.truthy(lettered.name.y >= lbox.y && lettered.name.y + 13 <= lbox.y + lbox.h, 'on the board');
  });
  // A trader shows its barter as a roof bubble, ask → give, in a hide unlike
  // the house quest bubble's (owner, Oct 2026).
  test('trader bubble: ask then arrow then give, never in the quest bubble\'s colours', () => {
    assert.truthy(Render.TRADER_BUBBLE.fill !== Render.QUEST_BUBBLE.fill, 'a different fill');
    assert.truthy(Render.TRADER_BUBBLE.border !== Render.QUEST_BUBBLE.border, 'and rim');
    assert.truthy(/<svg[^>]*viewBox="0 0 7 7"/.test(Render.tradeArrowHTML(14, '#fff')), 'the arrow is a crisp 7x7 bitmap');
    assert.truthy(/for \(const el of \[piece\(deal\.ask\), arrow, piece\(deal\.give\)\]\)/.test(RENDER_SRC), 'ask, arrow, give in that order');
    assert.truthy(/scene\.peekOrBuildTraderOffer\(o\)/.test(RENDER_SRC), 'the bubble reads the offer the modal opens with');
    assert.truthy(/ask: \{ kind: 'item', id: offer\.askId, qty: offer\.askQty \}/.test(RENDER_SRC) && /if \(!ic \|\| !\(p\.qty > 1\)\) return ic;/.test(RENDER_SRC), 'the asked count shows on the wanted icon past 1');
    assert.truthy(/if \(role === 'trader' && _traderDeal\(item\.o\)\) continue;/.test(RENDER_SRC), 'a trader with a deal hangs no board');
  });
})();
