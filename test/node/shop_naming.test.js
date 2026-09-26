// A themed shop (role key 'market') is named for the LINE IT SELLS, not for the
// trade idiom: "Potion Shop" on the map sign, on the restoration card and in
// the offer modal — never a "Market". The line comes from its restore order
// (Shops.themeAt via app.js marketTheme), so no sign promises stock the shop
// doesn't have.
//
// The trap here is the same one shops.js already documents for shopLabel: THREE
// call sites name this building (render.js's sign, app.js's restoration card,
// app.js's offer title), and when each carried its own string they drifted —
// which is why they now all read Shops.roleLabel. These tests pin the table and
// then pin that nobody has re-inlined a name beside it.
//
// The role KEY stays 'market': it is persisted in save.restoredHouses and on
// save.firstMarketId, so renaming it would strand every existing save. Only the
// player-facing LABEL changed.

(function () {
const app = APP_JS_SRC;
const render = RENDER_SRC;

test('shop naming: a themed shop is named for its line, not "Market"', () => {
  assert.eq(Shops.roleLabel('market', 'seed'), 'Seed Shop');
  assert.eq(Shops.roleLabel('market', 'potion'), 'Potion Shop');
  assert.eq(Shops.roleLabel('market', 'pet'), 'Pet Shop');
  for (const t of Shops.THEMES) assert.truthy(Shops.roleLabel('market', t), 'every line has a name: ' + t);
  assert.eq(Shops.roleLabel('market'), 'Shop', 'no line to name → a bare Shop');
  for (const label of Object.values(Shops.ROLE_LABEL)) {
    assert.truthy(label !== 'Market', 'no role is labelled "Market"');
  }
});

test('shop naming: the other roles keep their names, and unknown roles get none', () => {
  assert.eq(Shops.roleLabel('blacksmith'), 'Blacksmith');
  assert.eq(Shops.roleLabel('trader'), 'Trader', 'a trader with no offer to name is a bare Trader');
  assert.eq(Shops.roleLabel('wizard'), 'Wizard');
  assert.eq(Shops.roleLabel('plain'), null, 'a plain house has no shop sign');
  assert.eq(Shops.roleLabel(null), null, 'no role → no label');
  // a theme only ever touches the themed shop.
  assert.eq(Shops.roleLabel('blacksmith', 'seed'), 'Blacksmith', 'theme is market-only');
});

// The trader is named for the item it barters away, not its street number: a
// "Trader XXVI" sign told the player nothing about whether the walk over was
// worth it. The goods name comes from the same seeded give-pick the barter
// modal hands over (app.js traderGivePick), so sign and deal can't disagree.
test('shop naming: the trader is named for its goods, never its address', () => {
  assert.eq(Shops.roleLabel('trader', null, 'Rockfruit'), 'Rockfruit Trader');
  assert.eq(Shops.roleLabel('trader', null, 'Potato Seed'), 'Potato Seed Trader');
  assert.eq(Shops.roleLabel('trader', null, null), 'Trader', 'no goods → bare Trader');
  assert.eq(Shops.roleLabel('trader', null, ''), 'Trader', 'empty goods → bare Trader');
  // goods only ever touches the trader.
  assert.eq(Shops.roleLabel('market', 'seed', 'Rockfruit'), 'Seed Shop', 'goods is trader-only');
  assert.eq(Shops.roleLabel('blacksmith', null, 'Rockfruit'), 'Blacksmith', 'goods is trader-only');
  assert.eq(Shops.roleLabel('wizard', null, 'Rockfruit'), 'Wizard', 'goods is trader-only');

  // render.js: the sign asks the scene for the goods. No sign — trader or
  // otherwise — carries an address numeral any more (Shops.toRoman is gone).
  assert.truthy(/role === 'trader' && typeof scene\.traderGoodsName === 'function' \? scene\.traderGoodsName\(o\)/.test(render),
    'the map sign passes the trader\'s goods into Shops.roleLabel');
  assert.falsy(/toRoman/.test(render), 'no building sign carries an address numeral');

  // app.js: ONE give-pick feeds both the sign and the barter modal.
  const pickCalls = app.match(/this\.traderGivePick\(house\)/g) || [];
  assert.eq(pickCalls.length, 2, 'traderGoodsName and peekOrBuildTraderOffer both read traderGivePick');
  assert.truthy(/traderGoodsName\(house\) \{[\s\S]{0,400}?itemName\(pick\.giveId\)/.test(app),
    'the sign names the offered item by its catalogue name');
  assert.falsy(/peekOrBuildTraderOffer\(house\) \{[\s\S]{0,300}?BUY_LIST\[Math\.floor/.test(app),
    'the modal no longer rolls its own give item beside the sign\'s');
});

test('shop naming: the role KEY is untouched — saves still say "market"', () => {
  const house = { kind: 'house', tier: WorldGen.T.BUILDING, address: 26 };
  assert.eq(Shops.shopType(house), 'market', 'the persisted role string is unchanged');
});

test('shop naming: every call site reads Shops.roleLabel, none inlines a name', () => {
  // render.js's sign.
  assert.truthy(/Shops\.roleLabel\(role,/.test(render), 'the map sign resolves through Shops.roleLabel');
  assert.falsy(/market: 'Market'/.test(render), 'render.js no longer carries its own label table');
  // app.js's offer title + restoration card.
  assert.truthy(/Shops\.roleLabel\('market', this\.marketTheme\(house\)\.theme\)/.test(app),
    'the offer title resolves through Shops.roleLabel');
  assert.truthy(/Shops\.roleLabel\(role, theme\)/.test(app),
    'the restoration card resolves through Shops.roleLabel');
  assert.falsy(/name: 'Market'/.test(app), 'the restoration card no longer hardcodes "Market"');
  assert.falsy(/The market has fresh stock/.test(app), 'the old offer title is gone');
});

test('shop naming: no player-facing copy still calls the building a market', () => {
  // Tips are shown verbatim in-game, so they are copy, not comments.
  for (const tip of PLAY_TIPS) {
    assert.falsy(/\bmarkets?\b/i.test(tip), 'tip must not call the building a market: ' + tip);
  }
});
})();
