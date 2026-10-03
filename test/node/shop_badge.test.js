(() => {
  const match = SCENE_SRC.match(/^  shopTierBadgeHTML\([^\n]*\) \{[\s\S]*?^  \}/m);
  const modalBadge = new Function('return ({' + match[0] + '})')().shopTierBadgeHTML;
  const house = { id: 'supply', kind: 'house' };
  const scene = (tier, role = 'market') => ({
    save: {}, houseShopRole: () => role,
    marketTheme: () => ({ theme: 'supply', tier }),
  });

  test('shop badge: assigned tier survives lower-tier seed stock', () => {
    const s = scene(4);
    s.marketTheme = () => ({ theme: 'seed', tier: 4 });
    assert.truthy(Shops.themedStock('seed', 4).every(id => itemTierOf(id) !== 4));
    const badge = Render.shopTierBadge(s, house, s.houseShopRole());
    assert.eq(badge.text, 'RARE');
    assert.eq(badge.backgroundColor, '#' + (TIER_BADGE_TINT[4] ?? TIER_BY_NUM[4].color).toString(16).padStart(6, '0'));
    const html = modalBadge.call(s, house);
    assert.falsy(html.includes('Shop tier'), 'numeric tier jargon is not player-facing');
    assert.includes(html, tierBadgeHTML(4));
  });

  test('shop badge: high shop ranks use the top rarity badge without numeric jargon', () => {
    const s = scene(9);
    assert.eq(Render.shopTierBadge(s, house, s.houseShopRole()).text, 'GODLY');
    assert.falsy(modalBadge.call(s, house).includes('Shop tier'));
    assert.includes(modalBadge.call(s, house), tierBadgeHTML(7));
  });

  test('shop badge: unranked buildings have no map badge; a smithy and a trader wear theirs', () => {
    for (const role of ['wreck', 'plain', 'wizard', 'turret', 'trailer']) {
      const s = scene(4, role);
      assert.eq(Render.shopTierBadge(s, house, s.houseShopRole()), null);
      assert.eq(modalBadge.call(s, house), '');
    }
    assert.eq(Render.shopTierBadge(scene(4), house, scene(4).houseShopRole()).text, 'RARE');
    // The second smithy on the ledger is tier 2; a trader raised as the
    // tenth rebuild is tier 2 too (Shops.shopTier reads the ledger).
    const ledger = { restoredHouses: {} };
    for (let i = 0; i < 9; i++) ledger.restoredHouses['h' + i] = i === 1 ? 'blacksmith' : 'plain';
    ledger.restoredHouses[house.id] = 'blacksmith';
    const smith = scene(4, 'blacksmith'); smith.save = ledger;
    assert.eq(Render.shopTierBadge(smith, house, 'blacksmith').text, 'COMMON');
    assert.includes(modalBadge.call(smith, house), tierBadgeHTML(2));
    ledger.restoredHouses[house.id] = 'trader';
    const trader = scene(4, 'trader'); trader.save = ledger;
    assert.eq(Render.shopTierBadge(trader, house, 'trader').text, 'COMMON');
    assert.eq(Render.shopTierBadge(scene(4, 'trader'), house, 'trader').text, 'BASIC', 'off the ledger: tier 1');
  });
})();
