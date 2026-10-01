(() => {
  const match = SCENE_SRC.match(/^  shopTierBadgeHTML\([^\n]*\) \{[\s\S]*?^  \}/m);
  const modalBadge = new Function('return ({' + match[0] + '})')().shopTierBadgeHTML;
  const house = { id: 'supply', kind: 'house' };
  const scene = (tier, role = 'market') => ({
    save: {}, houseShopRole: () => role,
    marketTheme: () => ({ theme: 'supply', tier }),
  });

  test('shop badge: assigned tier survives lower-tier supply stock', () => {
    const s = scene(4);
    assert.truthy(Shops.themedStock('supply', 4).every(id => itemTierOf(id) !== 4));
    const badge = Render.shopTierBadge(s, house, s.houseShopRole());
    assert.eq(badge.text, 'RARE · T4');
    assert.eq(badge.backgroundColor, '#f4cc4a');
    const html = modalBadge.call(s, house);
    assert.includes(html, 'Shop tier 4');
    assert.includes(html, tierBadgeHTML(4));
  });

  test('shop badge: high shop ranks retain their number above the rarity ladder', () => {
    const s = scene(9);
    assert.eq(Render.shopTierBadge(s, house, s.houseShopRole()).text, 'GODLY · T9');
    assert.includes(modalBadge.call(s, house), 'Shop tier 9');
    assert.includes(modalBadge.call(s, house), tierBadgeHTML(7));
  });

  test('shop badge: other buildings and active scarecrow sellers have no map badge', () => {
    for (const role of ['wreck', 'plain', 'blacksmith', 'trader', 'wizard', 'trailer']) {
      const s = scene(4, role);
      assert.eq(Render.shopTierBadge(s, house, s.houseShopRole()), null);
      assert.eq(modalBadge.call(s, house), '');
    }
    const s = scene(4);
    s.save.scarecrowShopId = house.id;
    assert.eq(Render.shopTierBadge(s, house, s.houseShopRole()), null);
    s.save.scarecrowShopUsed = true;
    assert.eq(Render.shopTierBadge(s, house, s.houseShopRole()).text, 'RARE · T4');
  });
})();
