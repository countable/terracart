// modal_shell.js: ONE button factory for every button a modal shows.
//
// Regression guard for the footprint refactor: the pager arrows, choice
// cards, tabs and the reward card's actions used to be
// hand-built <button>s with two different ghost styles (#eee/#666 on
// Cancel, #ddd/#555 everywhere else), a local `dim()` and a second
// `_setEnabled` on Take. Every button now comes from mkBtn, in one of two
// variants, and carries the one _setEnabled.

test('modal buttons: mkBtn is the only button factory, with one ghost and one disabled look', () => {
  const src = MODAL_SHELL_SRC;
  assert.eq((src.match(/document\.createElement\('button'\)/g) || []).length, 1,
    'one <button> is created, inside mkBtn');
  assert.truthy(/const GHOST = 'background:transparent;color:#ddd;border:2px solid #555;';/.test(src),
    'the ghost style is one constant');
  assert.falsy(/#eee;border:2px solid #666/.test(src), 'the second ghost (#eee/#666) is gone');
  assert.falsy(/const dim = \(b, off\) =>/.test(src), 'the stepper\'s local dim() is gone');
  assert.eq((src.match(/\._setEnabled = \(on\) =>/g) || []).length, 1,
    'one _setEnabled, defined by mkBtn — Take no longer carries its own');
  // Every former hand-built button asks the factory for its variant.
  for (const site of [
    /const tb = mkBtn\(t\.label, \{ variant: 'ghost', css:/,
    /const b = mkBtn\(glyph, \{ variant: 'ghost', css:/,
    /const b = mkBtn\(a\.label, a\.primary \? \{ accent, css: cardCss \} : \{ variant: 'ghost', css: cardCss \}\);/,
    /take = mkBtn\(confirmLabel, \{ accent, css:/,
  ]) assert.truthy(site.test(src), `${site} builds through mkBtn`);
});

test('modal buttons: the delivery menu\'s house rows come from mkBtn too', () => {
  // scene_shops.js openDeliveryMenu used to build its two-line rows as its
  // own <button>; they are ghost buttons laid out by a row css now.
  const start = SCENE_SRC.indexOf('  openDeliveryMenu() {');
  const menu = SCENE_SRC.slice(start, SCENE_SRC.indexOf('\n  }\n', start));
  assert.truthy(start > 0 && menu.length > 0, 'openDeliveryMenu is a scene method');
  assert.falsy(/document\.createElement\('button'\)/.test(menu), 'no hand-built button in the menu');
  assert.truthy(/const row = mkBtn\(\n[\s\S]*?\{ variant: 'ghost', css: rowCss \}\);/.test(menu), 'each row asks the factory for a ghost with the row css');
  assert.truthy(/const close = mkBtn\('Close'\);/.test(menu), 'and the Close button');
});

test('modal buttons: the legacy (label, primary, disabled) spelling still reads', () => {
  // The offer modal's own Cancel / secondary / Buy calls, and the stubs the
  // other tests hand in, use the positional form.
  const src = MODAL_SHELL_SRC;
  assert.truthy(/const cancel = mkBtn\(cancelLabel, false, false\);/.test(src));
  assert.truthy(/const o = \(opts && typeof opts === 'object'\) \? opts : \{ variant: opts \? 'primary' : 'ghost', disabled \};/.test(src),
    'a boolean second argument is read as the variant');
});

test('modal buttons: choice action labels update on selection and retain the modal default', () => {
  const oldCreate = document.createElement;
  const el = () => ({ style: {}, children: [], events: {},
    appendChild(child) { this.children.push(child); },
    addEventListener(name, fn) { this.events[name] = fn; },
    remove() {}, click() { this.events.click({ stopPropagation() {} }); },
  });
  document.createElement = el;
  try {
    const scene = new SceneModals(), buttons = [];
    scene.makeModalShell = () => ({ wrap: el(), box: el(), mount() {},
      mkBtn(label) {
        const b = Object.assign(el(), { innerHTML: label, _setEnabled(on) { this.disabled = !on; } });
        buttons.push(b); return b;
      },
    });
    const choices = [{ key: 'single', label: 'Single', acceptLabel: 'Restore' },
      { key: 'multi', label: 'Multiple', acceptLabel: 'Choose tier' }, { key: 'default', label: 'Other' }];
    let accepted;
    scene.showOfferModal({ get: 'Building', choices, canAfford: true,
      acceptLabel: 'Continue', onAccept: key => { accepted = key; } });
    const accept = buttons[buttons.length - 1];
    assert.eq(accept.innerHTML, 'Continue'); assert.truthy(accept.disabled);
    buttons[0].click(); assert.eq(accept.innerHTML, 'Restore'); assert.falsy(accept.disabled);
    buttons[1].click(); assert.eq(accept.innerHTML, 'Choose tier');
    buttons[2].click(); assert.eq(accept.innerHTML, 'Continue', 'unlabelled choices use modal default');
    buttons[1].click(); accept.click(); assert.eq(accepted, 'multi');
    buttons.length = 0;
    scene.showOfferModal({ get: 'Single', choices: [choices[0]], canAfford: true, acceptLabel: 'Continue', onAccept() {} });
    assert.eq(buttons[buttons.length - 1].innerHTML, 'Restore', 'automatically selected sole choice updates immediately');
  } finally { document.createElement = oldCreate; }
});

(function () {
  function furnitureScene(itemId = 'workbench') {
    const scene = new SceneFurniture();
    scene.depth = 0;
    scene.save = { inv: [], selSlot: -1, furniture: [
      { id: 'furn:0:1:1', itemId, x: 5, y: 5, depth: 0, flip: false, houseKey: 'home' },
    ] };
    scene.draws = 0;
    scene.drawObjects = () => scene.draws++;
    scene.flashes = [];
    scene.flashAtPlayer = text => scene.flashes.push(text);
    scene.finishes = 0;
    scene._finishInventoryChange = () => scene.finishes++;
    scene.grants = [];
    scene.addToInv = (id, qty, silent, opts) => {
      scene.grants.push({ id, qty, silent, opts, placed: scene.save.furniture.length });
      return Inventory.add(scene.save, id, qty).accepted;
    };
    return scene;
  }

  test('furniture pickup: full bags and rejected grants preserve the placement', () => {
    const scene = furnitureScene(), record = scene.save.furniture[0];
    scene.save.inv.push({ id: record.itemId, count: Inventory.stackCap(scene.save) });
    assert.falsy(scene.pickupFurniture(record));
    assert.eq(scene.save.furniture.length, 1);
    assert.eq(scene.grants.length, 0, 'capacity refusal never grants');
    assert.eq(scene.flashes.length, 1, 'capacity refusal explains itself');
    scene.save.inv = [];
    scene.addToInv = () => 0;
    assert.falsy(scene.pickupFurniture(record));
    assert.eq(scene.save.furniture.length, 1, 'acceptance check preserves valuable property');
    assert.eq(scene.finishes, 0);
  });

  test('furniture pickup: accepts once before removing saved and live records, then persists', () => {
    const scene = furnitureScene(), record = scene.save.furniture[0];
    const cache = WorldGen.tileCache, slot = createSave('Furniture pickup test');
    const other = { id: 'other', kind: 'house' };
    const entry = { objects: [{ ...record, kind: 'furniture' }, other] };
    WorldGen.tileCache = new Map([['test', entry]]);
    try {
      assert.truthy(scene.pickupFurniture(record));
      assert.eq(scene.grants[0].placed, 1, 'grant precedes placement removal');
      assert.truthy(scene.grants[0].opts.notWild);
      assert.truthy(scene.grants[0].opts.deferRefresh);
      assert.eq(Inventory.count(scene.save, record.itemId), 1);
      assert.eq(scene.save.furniture.length, 0);
      assert.eq(entry.objects.length, 1);
      assert.eq(entry.objects[0], other);
      assert.eq(scene.finishes, 1);
      assert.eq(scene.draws, 1);
      assert.falsy(scene.pickupFurniture(record), 'stale callbacks cannot duplicate the item');
      flushSave();
      assert.eq(loadSave().furniture.length, 0, 'callback explicitly persisted after the tap');
    } finally { WorldGen.tileCache = cache; deleteSave(slot); }
  });

  test('furniture flip: saves supported orientation and rejects stale, other-floor and fixed art', () => {
    const scene = furnitureScene(), record = scene.save.furniture[0];
    const cache = WorldGen.tileCache, slot = createSave('Furniture flip test');
    const live = { ...record, kind: 'furniture' };
    WorldGen.tileCache = new Map([['test', { objects: [live] }]]);
    try {
      assert.truthy(scene.flipPlacedFurniture(record));
      assert.truthy(record.flip);
      assert.truthy(live.flip);
      flushSave();
      assert.truthy(loadSave().furniture[0].flip);
      scene.depth = 1;
      assert.falsy(scene.flipPlacedFurniture(record));
      assert.falsy(scene.pickupFurniture(record));
      scene.depth = 0;
      assert.falsy(scene.flipPlacedFurniture({ id: 'gone' }));
      record.itemId = 'rug_burgundy';
      assert.falsy(scene.flipPlacedFurniture(record), 'fixed art never mirrors');
    } finally { WorldGen.tileCache = cache; deleteSave(slot); }
  });

  test('modal buttons: furniture separates ghost pickup, enabled ability and optional flip', () => {
    const oldCreate = document.createElement;
    const el = () => ({ style: {}, children: [], events: {},
      appendChild(child) { this.children.push(child); },
      addEventListener(name, fn) { this.events[name] = fn; },
      remove() { this.removed = true; },
      click() { this.events.click?.(); },
    });
    document.createElement = el;
    try {
      const scene = furnitureScene('bed_quilted'), buttons = [], icons = [], shell = { wrap: el(), box: el() };
      scene.iconSpanHTML = (id, size) => { icons.push({ id, size }); return `<span>${id}</span>`; };
      scene.worldIconHTML = liftSceneMethod('worldIconHTML', { window: {} });
      // Stand in only for the pixel bake; the shipped world-icon renderer
      // must put the requested world sheet and frame into the dialog HTML.
      scene._worldIconUrl = (key, frame) => key === 'furniture'
        ? `assets/Objects/Furniture/furniture-32.png#frame=${frame}` : '';
      scene.makeModalShell = (id, opts) => {
        shell.opts = opts;
        shell.box = el();
        return { ...shell, mount() {}, mkBtn(label, options) {
          const button = Object.assign(el(), { label, options });
          buttons.push(button); return button;
        } };
      };
      const record = scene.save.furniture[0];
      record.flip = true;
      assert.truthy(runInteractable(makeCtx(scene, scene.save), { ...record, kind: 'furniture' }));
      assert.eq(shell.opts.kindLabel, 'Furniture');
      assert.eq(shell.opts.art, false, 'the catalog art is the subject');
      assert.eq(typeof shell.opts.onClose, 'function', 'ordinary backdrop/close dismissal');
      assert.eq(icons.length, 1, 'only the category badge uses the inventory icon');
      assert.eq(icons[0].size, 32, 'category icon retains its size');
      const art = shell.box.children.find(child => child.className === 'furniture-art');
      assert.includes(art.innerHTML, 'assets/Objects/Furniture/furniture-32.png');
      assert.includes(art.innerHTML, `#frame=${furnitureSpec(record.itemId).frame}`);
      assert.includes(art.innerHTML, 'width:128px;height:256px', 'world frame has exact 4× dimensions');
      assert.eq(art.style.transform, 'scaleX(-1)', 'portrait preserves the placed flip');
      const pickupRow = shell.box.children[0], actions = shell.box.children[shell.box.children.length - 1];
      assert.eq(pickupRow.children[0].label, 'Pick up');
      assert.eq(pickupRow.children[0].options.variant, 'ghost');
      assert.truthy(pickupRow.style.cssText.includes('justify-content:flex-end'));
      const ability = actions.children.find(button => button.label === 'Sleep');
      assert.falsy(ability.options?.disabled);
      assert.eq(ability.label, 'Sleep');
      assert.truthy(actions.children.some(button => button.label === 'Flip'));
      buttons.length = 0;
      record.itemId = 'rug_burgundy';
      scene.presentFurniture(record);
      assert.eq(buttons.length, 1, 'a fixed decorative rug only has pickup');
      record.itemId = 'clock_grandfather';
      record.flip = false;
      scene.presentFurniture(record);
      const clockArt = shell.box.children.find(child => child.className === 'furniture-art');
      assert.includes(clockArt.innerHTML, `assets/Objects/Furniture/furniture-32.png#frame=${furnitureFrame('clock_grandfather')}`,
        'tall clock uses its world frame instead of its fitted 16px icon');
      assert.includes(clockArt.innerHTML, 'width:128px;height:256px');
      assert.eq(clockArt.style.transform, '', 'unflipped clock stays upright');
    } finally { document.createElement = oldCreate; }
  });
})();
