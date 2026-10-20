// Exercise the actual gear renderers: atlas frames must survive DOM clipping
// and Phaser melee rendering, while unselected tiers keep their original art.
(function () {
  function lift(signature) {
    const start = SCENE_SRC.indexOf('\n  ' + signature);
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    assert.truthy(start >= 0 && end > start, 'found ' + signature);
    return SCENE_SRC.slice(start + 1, end + 4);
  }
  test('selected relic art: DOM gear icons clip selected frames; other tiers retain original files', () => {
    const sheet = { url: SelectedItemArt.url, cols: SelectedItemArt.cols,
      srcW: SelectedItemArt.width, srcH: SelectedItemArt.height };
    const render = new Function('SelectedItemArt', 'ICON_SHEETS', 'gearAssetPath',
      'AMULET_FRAME_BY_TIER', 'domIconSheet', 'IconNet',
      'return ({' + lift('gearIconHTML(kind, slot, tier, sizePx = 20) {') + '}).gearIconHTML;')(
      SelectedItemArt, { selected_items: sheet }, gearAssetPath, AMULET_FRAME_BY_TIER,
      (url, width, height) => ({ url, width, height, x: 0, y: 0 }), { ready: () => true });
    for (const [slot, tiers] of Object.entries(SelectedItemArt.relics)) {
      for (const [tier, art] of Object.entries(tiers)) {
        const html = render('relic', slot, Number(tier), 32);
        assert.truthy(html.includes(SelectedItemArt.url));
        assert.truthy(html.includes(`background-position:-${art.frame % sheet.cols * 32}px -${Math.floor(art.frame / sheet.cols) * 32}px`),
          `${slot} tier ${tier} clips its own frame`);
      }
    }
    for (const [slot, tier] of [['dagger', 3], ['dagger', 5], ['lance', 3], ['sword', 1]]) {
      assert.truthy(render('relic', slot, tier).includes(gearAssetPath('relic', slot, tier)),
        `${slot} ${tier} keeps its unselected art`);
    }
  });
  test('selected relic art: melee shares one preloaded sheet without per-tier loads', () => {
    const resolve = new Function('SelectedItemArt', 'gearAssetPath',
      'return ({' + lift('_toolTexture(slot, tier) {') + '})._toolTexture;')(SelectedItemArt, gearAssetPath);
    const loads = [];
    const scene = { textures: { exists: () => false }, load: {
      spritesheet: (...args) => loads.push(args), start() {} } };
    for (const [slot, tiers] of Object.entries(SelectedItemArt.relics)) {
      for (const tier of Object.keys(tiers)) assert.eq(resolve.call(scene, slot, tier), 'selected_items');
    }
    assert.eq(loads.length, 0);
    assert.eq(resolve.call(scene, 'dagger', 3), 'wheeltool:' + gearAssetPath('relic', 'dagger', 3));
    assert.eq(loads.length, 1);
    resolve.call(scene, 'dagger', 3);
    assert.eq(loads.length, 1, 'fallback load remains deduplicated');
  });
  test('selected relic art: melee renderer preserves the selected atlas frame', () => {
    const render = new Function('HeadingUp', 'Render', 'performance', 'Combat', 'CELL_PX',
      'return ({' + lift('_drawSwordSwing() {') + '})._drawSwordSwing;')(
      { active: () => false }, { meleePose: () => ({ angle: 0, alpha: 1 }), drawMelee() {},
        meleeWeaponPose: () => ({ handRadius: 1, grip: 0.5, scale: 1 }) },
      { now: () => 1 }, { meleeReachM: () => 1 }, 16);
    const seen = [];
    const icon = {};
    for (const method of ['setDepth', 'setVisible', 'setOrigin', 'setScale', 'setPosition', 'setRotation', 'setAlpha']) {
      icon[method] = () => icon;
    }
    icon.setTexture = (key, frame) => { seen.push([key, frame]); return icon; };
    const art = SelectedItemArt.relics.dagger[4];
    const scene = { swordSwingGfx: { clear() {} }, _swing: { texture: art.sheet, frame: art.frame, weapon: 'dagger' },
      textures: { exists: () => true }, add: { image: (x, y, key, frame) => { seen.push([key, frame]); return icon; } },
      playerScreen: () => ({ x: 0, y: 0 }), playerBodyDy: () => 0,
      playerWorldContainer: { add() {}, sort() {} } };
    render.call(scene);
    assert.eq(seen.length, 2);
    for (const [key, frame] of seen) { assert.eq(key, art.sheet); assert.eq(frame, art.frame); }
    scene._swing = { texture: 'original', weapon: 'sword' };
    render.call(scene);
    assert.eq(seen[2][1], 0, 'legacy swings default to frame zero');
  });
  test('dialog gear art: only large registered gear uses detailed frames', () => {
    const art = { cell: 48, columns: 8, size: 384,
      entries: { 'relic:sword:1': { sheet: 'dialog-gear.png', frame: 17 } } };
    const render = new Function('SelectedItemArt', 'ICON_SHEETS', 'gearAssetPath',
      'AMULET_FRAME_BY_TIER', 'domIconSheet', 'IconNet', 'DialogItemArt',
      'return ({' + lift('gearIconHTML(kind, slot, tier, sizePx = 20) {') + '}).gearIconHTML;')(
      { relics: {} }, {}, () => 'small-gear.png', AMULET_FRAME_BY_TIER,
      (url, width, height) => ({ url, width, height, x: 0, y: 0 }), { ready: () => false }, art);
    assert.truthy(render('relic', 'sword', 1, 47).includes('small-gear.png'));
    assert.truthy(render('relic', 'sword', 2, 96).includes('small-gear.png'), 'unregistered tier keeps its art');
    for (const size of [48, 96]) {
      const html = render('relic', 'sword', 1, size);
      assert.truthy(html.includes('dialog-gear.png'));
      assert.truthy(html.includes(`background-size:${8 * size}px ${8 * size}px`));
      assert.truthy(html.includes(`background-position:-${size}px -${2 * size}px`));
      assert.truthy(html.includes('class="px-icon icon-loading" data-iconsrc="dialog-gear.png"'));
    }
  });
})();
