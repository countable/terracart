// The same transaction serves Home bootstrap and an indoor/outdoor station.
(() => {
  function fixture(houseKey = null) {
    const record = { id: 'placed-bench', itemId: 'workbench', depth: 0, houseKey };
    const scene = {
      save: { inv: [{ id: 'wood', count: 5 }, { id: 'rubble', count: 3 }],
        furniture: [record], selSlot: -1 }, depth: 0, record, modals: [], flashes: [],
      showOfferModal(modal) { this.modals.push(modal); },
      iconSpanHTML: () => '', worldIconHTML: () => '',
      flash(message) { this.flashes.push(message); },
      flashAtPlayer(message) { this.flashes.push(message); }, flashLoot() {},
      invRoomFor(id) { return Inventory.roomFor(this.save, id); },
      addToInv(id, n, silent, opts) {
        assert.truthy(opts.notWild, 'crafting cannot teach recipes');
        return Inventory.add(this.save, id, n);
      },
      _clampSelSlot() {}, _finishInventoryChange() {},
      pickupFurniture(o) { this.save.furniture = this.save.furniture.filter(r => r.id !== o.id); return true; },
    };
    for (const name of ['_placedFurniture', 'presentWorkbench', 'presentHomeCraft',
      '_homeKindIcon', '_homeTabs', '_presentRecipePicker', '_presentRecipeOffer']) {
      scene[name] = liftSceneMethod(name);
    }
    return scene;
  }
  const last = scene => scene.modals.at(-1);

  test('workbench: a fresh save crafts the starter-known workbench only at Home', () => {
    const s = fixture(); s.save.furniture = [];
    assert.falsy(homeRecipeLocked(s.save, 'workbench'));
    s.presentHomeCraft(0, 0, 'throwing_spear');
    const modal = last(s);
    assert.eq(modal.pager.count, 1);
    assert.eq(modal.pager.options[0].label, itemName('workbench'));
    assert.truthy(modal.canAfford);
    modal.onAccept(); modal.repeat();
    assert.eq(Inventory.count(s.save, 'workbench'), 1);
    assert.eq(Inventory.count(s.save, 'wood'), 2);
    assert.eq(Inventory.count(s.save, 'rubble'), 2);
    assert.eq(last(s).pager.options[0].label, itemName('workbench'));
  });

  test('workbench: indoors and outdoors craft the spear and retain selection without Home selling', () => {
    for (const houseKey of [null, 'home']) {
      const s = fixture(houseKey);
      s.presentWorkbench(s.record, 'throwing_spear');
      const modal = last(s);
      assert.truthy(modal.canAfford);
      assert.eq(modal.pager.options[0].label, itemName('throwing_spear'));
      assert.falsy(modal.pager.options.some(o => o.label === itemName('workbench')));
      assert.falsy(modal.tabs, 'station cannot expose remote Home selling');
      modal.onAccept(); modal.repeat();
      assert.eq(Inventory.count(s.save, 'throwing_spear'), 1);
      assert.eq(Inventory.count(s.save, 'wood'), 4);
      assert.eq(last(s).pager.options[last(s).pager.index].label, itemName('throwing_spear'));
    }
  });

  test('workbench: a picked-up station refuses a stale craft without spending ingredients', () => {
    const s = fixture();
    s.presentWorkbench(s.record);
    const modal = last(s);
    assert.eq(modal.topAction.label, 'Pick up');
    modal.topAction.onClick();
    const before = JSON.stringify(s.save);
    modal.onAccept(); modal.repeat();
    assert.eq(JSON.stringify(s.save), before);
    assert.eq(s.modals.length, 1, 'removed station does not reopen');
    assert.includes(s.flashes.at(-1), 'Place a workbench');
  });

  test('workbench: tapping the furniture opens its crafting picker directly', () => {
    const s = fixture();
    s.presentFurniture = liftSceneMethod('presentFurniture');
    s.makeModalShell = () => { throw new Error('workbench must bypass the furniture dialog'); };
    assert.truthy(s.presentFurniture(s.record));
    assert.eq(last(s).kind, 'craft');
    assert.eq(last(s).topAction.label, 'Pick up');
  });

  test('workbench: recipe stations preserve the barricade salvage cost', () => {
    for (const recipe of HOME_RECIPES) {
      assert.eq(recipe.station, recipe.id === 'workbench' ? 'home' : 'workbench');
    }
    assert.eq(HOME_RECIPES.find(r => r.id === 'barricade').cost.find(c => c.id === 'wood').qty, 3);
  });

  test('workbench: top pickup is a ghost control and failed pickup keeps the picker open', () => {
    const old = document.createElement;
    const element = () => ({ children: [], style: {}, events: {},
      appendChild(child) { this.children.push(child); },
      addEventListener(event, fn) { this.events[event] = fn; },
      click() { this.events.click({ stopPropagation() {} }); },
      remove() { this.removed = true; },
    });
    document.createElement = element;
    try {
      const scene = new SceneModals(), wrap = element(), box = element();
      const buttons = [];
      scene.makeModalShell = () => ({ wrap, box, mount() {}, mkBtn(label, opts) {
        const button = Object.assign(element(), { label, opts }); buttons.push(button); return button;
      } });
      let canPickup = false, calls = 0;
      scene.showOfferModal({ get: 'Recipe', cost: '', canAfford: true, onAccept() {},
        topAction: { label: 'Pick up', onClick() { calls++; return canPickup; } } });
      const pickup = buttons.find(b => b.label === 'Pick up');
      assert.eq(pickup.opts.variant, 'ghost');
      assert.eq(box.children[0].className, 'offer-top-actions');
      pickup.click(); assert.falsy(wrap.removed);
      canPickup = true; pickup.click(); assert.truthy(wrap.removed);
      pickup.click(); assert.eq(calls, 2, 'closed station ignores repeated clicks');
    } finally { document.createElement = old; }
  });
})();
