// THE FORGE TELLS ITS STORY. A forged piece used to land as a loot toast, the
// same splash a picked berry gets. Forging now opens the forge's story pane:
// the Smithy kind (MODAL_KINDS.forge) on its own painting (forge_done), the
// piece's own art large over its name, and the smith's cheer — all read from
// app.js FORGE_CEREMONY.
//
// app.js needs Phaser, so presentBlacksmithOffer is lifted out of the source
// and run against a stub scene: accept the offer, and see what opened.

(function () {
const app = SCENE_SRC;

const constSrc = (name) => {
  const i = app.indexOf(`const ${name} = `);
  assert.truthy(i >= 0, `${name} is defined in app.js`);
  return app.slice(i, app.indexOf('\n};\n', i) + 3);
};
const methodSrc = (name) => {
  const i = app.indexOf(`  ${name}(`);
  assert.truthy(i >= 0, `${name} is a method in app.js`);
  return app.slice(i, app.indexOf('\n  }\n', i) + 4);
};
const FORGE = new Function(`${constSrc('FORGE_CEREMONY')} return FORGE_CEREMONY;`)();

// Run the forge offer end to end: present it, press Forge, return the scene.
function forgeOnce({ afford = true } = {}) {
  const held = { copper_bar: afford ? 5 : 0 };
  const recipe = [{ id: 'copper_bar', qty: 3 }];
  const offer = { kind: 'relic', slot: 'pick', tier: 2 };
  const calls = { offer: null, ceremony: [], loot: [], flash: [], equipped: [] };
  const scene = {
    save: { relics: {}, armor: {} },
    gearIconHTML: (kind, slot, tier, px) => `<img data-gear="${kind}:${slot}:${tier}" data-px="${px}">`,
    iconSpanHTML: (id) => `<i>${id}</i>`,
    showOfferModal: (o) => { calls.offer = o; },
    showChestRewardModal: (o) => calls.ceremony.push(o),
    flashLoot: (...a) => calls.loot.push(a),
    flash: (m) => calls.flash.push(m),
    _clampSelSlot() {}, markRelicsDirty() {}, updateHUD() {}, buildInventoryDOM() {},
    _equipGear: (...a) => calls.equipped.push(a),
    shopBucketState: () => null,
    _trailRewardBlurb: () => '',
    guildPrice: (_h, n) => n,
  };
  const env = {
    FORGE_CEREMONY: FORGE,
    SMITHY_PREVIEW_PX: 56,
    smithyPreviewHTML: (icon, name) => `${icon}${name}`,
    gearName: () => 'Copper Pick',
    ITEM_BY_ID: { copper_bar: { name: 'Copper Bar' } },
    Inventory: {
      count: (_s, id) => held[id] || 0,
      remove: (_s, id, n) => { held[id] -= n; },
    },
    Gear: { blacksmithRecipe: () => recipe, smeltUnlockedBars: () => [] },
    ShopsMath: { smithyRerollCost: () => 5 },
    persistSave() {},
  };
  const names = Object.keys(env);
  const proto = new Function(...names, `return { ${methodSrc('presentBlacksmithOffer')} };`)(
    ...names.map(n => env[n]));
  Object.setPrototypeOf(scene, proto);
  scene.presentBlacksmithOffer(0, 0, offer, () => {}, null, { noReroll: true });
  assert.truthy(calls.offer, 'the forge offer was presented');
  calls.offer.onAccept();
  return calls;
}

test('forge story: a successful forge opens the Smithy story pane with the piece', () => {
  const calls = forgeOnce();
  assert.eq(calls.equipped.length, 1, 'the piece was forged and equipped');
  assert.eq(calls.ceremony.length, 1, 'one story pane opens');
  const c = calls.ceremony[0];
  assert.eq(c.kind, 'forge', 'on the Smithy kind');
  assert.eq(c.art, 'forge_done', 'over the forge painting');
  assert.truthy(/data-gear="relic:pick:2"/.test(c.iconHTML), 'showing the forged piece itself');
  assert.truthy(/data-px="64"/.test(c.iconHTML), 'large, not toast-sized');
  assert.eq(c.name, 'Copper Pick', 'under its name');
  assert.eq(c.header, 'Forged!', 'with the painted label');
  assert.eq(c.sub, FORGE.sub, 'and the smith\'s cheer');
  assert.eq(calls.loot.length, 0, 'the pane replaces the loot toast rather than stacking under it');
});

test('forge story: a refused forge tells no story', () => {
  const calls = forgeOnce({ afford: false });
  assert.eq(calls.ceremony.length, 0, 'no pane without the bars');
  assert.eq(calls.equipped.length, 0, 'and nothing forged');
});

test('forge story: the copy keeps the dialog rules', () => {
  // A painted header is a bare label (CLAUDE.md: no emoji on a painted header).
  assert.falsy(/\p{Extended_Pictographic}/u.test(FORGE.header), 'no emoji in the label');
  assert.falsy(/\p{Extended_Pictographic}/u.test(FORGE.sub), 'none in the narrative either');
  // Told through the player’s experience: no digits or percentages.
  assert.falsy(/\d|%|tier/i.test(FORGE.sub), 'no exact mechanics');
  assert.truthy(/you feel/i.test(FORGE.sub) && /heat/.test(FORGE.sub), 'the player experiences the finished work');
  assert.falsy(/[“”]/.test(FORGE.sub), 'no separate speaker');
  assert.lte(FORGE.sub.length, 140, 'short enough for the quiet zone');
  // The painting is a scene() piece with a bare anvil and no lore of its own.
  const piece = STORY_ART_GEN_SRC.slice(STORY_ART_GEN_SRC.indexOf('  forge_done: scene('),
    STORY_ART_GEN_SRC.indexOf('  kind_relics: scene('));
  assert.truthy(/bare anvil/.test(piece), 'the anvil is left for the icon');
  assert.falsy(/,\s*'[a-z]+'\)/.test(piece), 'no LORE hint on this piece');
});
})();
