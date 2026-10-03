// THE TIER BADGE (owner, Sep 2026): when something is obtained, its tier's
// WORD on a chip of its ORE'S colour — the loot toast and the reward
// ceremony both wear it. One table for the words (items.js
// TIER_BADGE_NAMES), MATERIAL_TIERS' own colours for the chips.
(() => {
const app = SCENE_SRC;

test('tier badge: seven words on the seven ores, dark ink on the pale ones', () => {
  const words = ['basic', 'common', 'uncommon', 'rare', 'epic', 'legendary', 'godly'];
  words.forEach((w, i) => {
    const html = tierBadgeHTML(i + 1);
    // Epic is the one cheat: Platinum is near white, so its chip is a
    // lavender platinum — the material colour itself is untouched.
    const colour = i + 1 === 5 ? 0xc9a6f2 : TIER_BY_NUM[i + 1].color;
    const hex = '#' + colour.toString(16).padStart(6, '0');
    assert.truthy(html.includes(`>${w}<`), `T${i + 1} reads ${w}`);
    assert.truthy(html.includes(`background:${hex};`), `T${i + 1} sits on ${TIER_BY_NUM[i + 1].name}`);
    assert.truthy(html.includes(`data-tier="${i + 1}"`), 'carries its tier');
  });
  assert.truthy(tierBadgeHTML(4).includes('color:#1a1612'), 'dark ink on gold');
  assert.truthy(tierBadgeHTML(6).includes('color:#fff4e0'), 'pale ink on crimson');
  assert.eq(TIER_BY_NUM[5].color, 0xe8f1f6, 'Platinum itself is still platinum');
  assert.eq(tierBadgeHTML(0), '', 'no tier, no badge');
  assert.eq(tierBadgeHTML(9), tierBadgeHTML(7), 'clamped to the ladder');
  assert.truthy(tierBadgeHTML(3, 11).includes('font:700 11px'), 'the size is the caller\'s');
});

test('tier badge: an item\'s tier is its baseTier on the rarity ladder', () => {
  assert.eq(itemTierOf('rainberry'), ITEM_BY_ID.rainberry.baseTier);
  assert.eq(itemTierOf('potato'), 1, 'a starter crop is basic');
  assert.eq(itemTierOf('no_such_item'), 0, 'unknown: no badge');
  for (const it of ITEMS) assert.inRange(itemTierOf(it.id), 1, 7, `${it.id} has a badge`);
});

test('tier badge: the reward ceremony hangs it under the name', () => {
  const src = MODAL_SHELL_SRC;
  assert.truthy(/showChestRewardModal\(\{[^}]*cards = false, tier = 0,/.test(src), 'the ceremony takes a tier');
  assert.truthy(/const badge = \(tier > 0 && typeof tierBadgeHTML === 'function'\) \? tierBadgeHTML\(tier, 11\) : '';/.test(src));
  assert.truthy(/\$\{name\}<\/div>` \+\s*\n\s*tierHtml \+/.test(src), 'right under the name');
  // The chest's ceremonies take the one card ladder (Rewards.card): the
  // item's tier, and gear's own tier kept or beaten.
  const scene = makeScene();
  assert.eq(Rewards.card(scene, { kind: 'item', id: 'potato', qty: 1 }).tier, itemTierOf('potato'), 'chest loot: the item\'s tier');
  assert.eq(Rewards.card(scene, { kind: 'relic', slot: 'axe', tier: 3 }).tier, 3, 'gear: its own tier, kept');
  assert.eq(Rewards.card(scene, { kind: 'gold', amount: 3, slot: 'axe', tier: 2 }).tier, 2, 'gear: its own tier, beaten');
  assert.eq(Rewards.card(scene, { kind: 'gold', amount: 3 }).tier, undefined, 'plain cash wears none');
  const inter = INTERACTABLES_SRC;
  assert.eq((inter.match(/Rewards\.present\(scene, result,/g) || []).length, 2, 'the fits and the gear / cash ceremonies present the card');
  assert.truthy(/\.\.\.lootCard, kind: rewardKind, kindIcon,/.test(inter), 'the bag-full choice lays the card under its actions');
  assert.truthy(/tier: \(typeof itemTierOf === 'function'\) \? itemTierOf\(reward\.id\) : 0,/.test(app), 'a trail prize item');
  assert.truthy(/sub: 'equipped',\s*\n\s*color: UI_TREASURE,\s*\n\s*tier: reward\.tier,/.test(app), 'a trail prize relic');
});

test('tier badge: the loot toast hangs it off the text\'s right edge, and it leaves with the toast', () => {
  const a = app.indexOf('  flashLoot(text, color = UI_GOLD, dwellMul = 1, itemId = null, iconEl = null) {');
  const body = app.slice(a, app.indexOf('\n  }\n', a));
  assert.truthy(/const html = tierBadgeHTML\(itemTierOf\(itemId\), 9\);/.test(body), 'the item\'s badge');
  assert.truthy(/badgeEl\.className = 'loot-toast-icon';/.test(body), 'hidden under a dialog like the icon');
  assert.truthy(/const bx = r\.left \+ \(b\.right \+ 6 \* t\.scaleX\) \* sx;/.test(body), 'past the text\'s right edge');
  assert.eq((body.match(/badgeEl\?\.remove\(\);/g) || []).length, 2, 'removed on the toast\'s end and on an early exit');
});
})();
