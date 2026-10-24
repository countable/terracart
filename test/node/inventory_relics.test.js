// Fixed-tier carried relics share the equipment tab without becoming gear slots.
(function () {
  function harness(save) {
    function el(tag) {
      const out = { tag, style: {}, dataset: {}, attrs: {}, children: [], className: '',
        setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
        appendChild(child) { child.parent = this; this.children.push(child); return child; },
        remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); },
        addEventListener(name, fn) { this[name] = fn; }, scrollIntoView() {},
        querySelectorAll(selector) { return descendants(this).filter(e =>
          selector === 'button[data-slot],button[data-gear]'
            ? e.tag === 'button' && (e.dataset.slot != null || e.dataset.gear != null)
            : false); },
        querySelector(selector) { return descendants(this).find(e => selector === '.sel' && e.className.split(' ').includes('sel')); },
      };
      Object.defineProperty(out, 'textContent', { get() { return this._text || this.children.map(c => c.textContent).join(''); },
        set(text) { this._text = String(text); this.children = []; } });
      out.classList = { toggle(name, yes) { out.className = out.className.split(' ').filter(c => c !== name).concat(yes ? name : []).join(' '); } };
      return out;
    }
    function descendants(node) { return node.children.flatMap(c => [c, ...descendants(c)]); }
    const document = { body: el('body'), createElement: el,
      getElementById(id) { return descendants(this.body).find(e => e.id === id) || null; } };
    const scene = { save, document, gearIconHTML: () => '<gear>', renderItemIcon: () => el('span'),
      iconSpanHTML: () => '<item>', syncEatButton() { this.eatId = getSelectedSlot(this.save)?.id; },
      syncConsumableButton() { this.useMethod = CONSUMABLE_SPEC[getSelectedSlot(this.save)?.id]?.method; },
      syncEquipButton() { this.equipSlot = this.save.selGear?.slot; },
      _effectLineEl(nameLbl, text) { const row = el('div'); row.textContent = text; return row; },
    };
    const decl = ['INV_RELIC_ORDER', 'INV_ARMOR_ORDER', 'WEAPON_SLOTS'].map(name =>
      SCENE_SRC.match(new RegExp('const ' + name + ' = [^;]+;'))[0]).join('\n');
    for (const name of ['invEntriesForCat', 'invDisplayEntriesForCat', 'gearEntriesForCat', '_settleInvCatOnBoot',
      'syncFurnitureFlipButton', '_hudActionButton', 'selectInvCat', 'buildInventoryDOM', 'refreshInventoryHighlight', 'addToInv', '_finishInventoryChange', '_clampSelSlot', '_equipGear']) {
      const match = SCENE_SRC.match(new RegExp('^  ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?^  \\}', 'm'));
      assert.truthy(match, `${name} exists`);
      scene[name] = new Function('document', 'persistSave', decl + '\nreturn ({' + match[0] + '})')(document, () => {})[name];
    }
    scene.slots = () => document.getElementById('inv').querySelectorAll('button[data-slot],button[data-gear]');
    scene.click = button => button.click({ stopPropagation() {} });
    return scene;
  }

  test('inventory relics: permanent items use the existing Relics tab, not a separate tab', () => {
    assert.eq(INV_CATS.length, 9);
    assert.falsy(INV_CAT_BY_KEY.unique_relic);
    const ids = ITEMS.filter(i => i.kind === 'unique_relic').map(i => i.id);
    assert.eq(ids.length, 31, 'twenty finds, two progression relics and nine reusable tomes');
    for (const id of ids) assert.eq(invCatForItem(id), 'relics', id);
  });

  test('inventory categories: page arrows preserve the selected stack and five-item page', () => {
    const inv = ITEMS.filter(i => invCatForItem(i.id) === 'produce').slice(0, 6).map(i => ({ id: i.id, count: 1 }));
    const s = harness({ inv, relics: {}, armor: {},
      invCat: 'produce', invPage: 1, selSlot: 5 });
    s.buildInventoryDOM();
    let keys = s.document.getElementById('inv-tabs').children;
    assert.eq(keys.length, 8);
    assert.eq(keys.filter(k => k.dataset.cat).map(k => k.dataset.cat).join(','),
      'seeds,produce,pets,relics,magic,supplies');
    assert.eq(keys[6].tag, 'span'); assert.eq(keys[7].dataset.control, 'next-categories');
    assert.falsy(keys[7].className.includes('sel'));
    s.click(keys[7]);
    keys = s.document.getElementById('inv-tabs').children;
    assert.eq(keys.length, 8); assert.eq(keys[0].dataset.control, 'previous-categories');
    assert.eq(keys.filter(k => k.dataset.cat).map(k => k.dataset.cat).join(','), 'furniture,armour,ores');
    assert.eq(keys.slice(4).every(k => k.tag === 'span'), true);
    assert.eq(s.save.invCat, 'produce'); assert.eq(s.save.selSlot, 5); assert.eq(s.save.invPage, 1);
    s.click(keys[0]); assert.eq(s._invCatPage, 0);
    s.selectInvCat('armour'); assert.eq(s._invCatPage, 1);
    s.selectInvCat('magic'); assert.eq(s._invCatPage, 0);
  });

  test('inventory categories: boot and new furniture or ore stacks reveal page two', () => {
    for (const id of ['bed_quilted', 'wood']) {
      const s = harness({ inv: [], relics: {}, armor: {}, invCat: 'seeds', invPage: 0, selSlot: -1 });
      s.buildInventoryDOM();
      assert.eq(s.addToInv(id, 1), 1);
      assert.eq(s._invCatPage, 1); assert.eq(s.save.invCat, invCatForItem(id));
      assert.truthy(s.document.getElementById('inv-tabs').children.some(k => k.dataset.cat === s.save.invCat));
      s.selectInvCat('seeds');
      s.addToInv(id, 1); assert.eq(s._invCatPage, 0, 'topping up keeps the browsed page');
      s._settleInvCatOnBoot(); assert.eq(s._invCatPage, 1);
      s._invCatPage = 0; s._settleInvCatOnBoot(); assert.eq(s._invCatPage, 1, 'already stocked boot category');
    }
    const s = harness({ inv: [], relics: {}, armor: { helmet: { tier: 1 } }, invCat: 'armour', invPage: 0, selSlot: -1 });
    s._settleInvCatOnBoot(); assert.eq(s._invCatPage, 1);
  });

  test('inventory furniture: Flip is transient, metadata-gated and resets between items', () => {
    const s = harness({ inv: [{ id: 'bed_quilted', count: 1 }, { id: 'rug_burgundy', count: 1 }],
      relics: {}, armor: {}, invCat: 'furniture', invPage: 0, selSlot: 0 });
    s.buildInventoryDOM();
    const btn = s.document.getElementById('furniture-flip-btn');
    assert.truthy(btn); assert.eq(btn.textContent, 'Flip');
    s.click(btn); assert.eq(s._furnitureFlip, true); assert.eq(btn.ariaPressed, 'true');
    assert.falsy(Object.hasOwn(s.save, 'furnitureFlip'));
    s.click(s.slots()[1]); assert.falsy(s.document.getElementById('furniture-flip-btn'));
    assert.eq(s._furnitureFlip, false);
    s.click(s.slots()[0]); assert.eq(s._furnitureFlip, false);
  });

  test('inventory categories: new armor from rewards and shops reveals page two, upgrades keep the browsed page', () => {
    for (const acquire of [
      (s, tier) => Rewards.apply(s.save, { kind: 'armor', slot: 'helmet', tier }, s),
      (s, tier) => s._equipGear('armor', 'helmet', tier),
    ]) {
      const s = harness({ inv: [], relics: {}, armor: {}, invCat: 'seeds', invPage: 0, selSlot: -1 });
      s.buildInventoryDOM();
      acquire(s, 1);
      assert.eq(s.save.invCat, 'armour'); assert.eq(s._invCatPage, 1);
      assert.eq(s.save.selGear.slot, 'helmet');
      assert.truthy(s.document.getElementById('inv-tabs').children.some(k => k.dataset.cat === 'armour'));
      s.selectInvCat('seeds');
      acquire(s, 2);
      assert.eq(s.save.armor.helmet.tier, 2);
      assert.eq(s.save.invCat, 'seeds'); assert.eq(s._invCatPage, 0);
    }
  });

  test('inventory relics: gear and carried items render together, with correct selection, actions and tiers', () => {
    const s = harness({ inv: [{ id: 'orb', count: 1 }, { id: 'goblet', count: 1 }],
      relics: { sword: { tier: 2 } }, armor: {}, invCat: 'relics', invPage: 0, selSlot: -1, selGear: null });
    s.buildInventoryDOM();
    const slots = s.slots();
    assert.eq(slots[0].dataset.gear, 'relic:sword');
    assert.eq(slots[1].dataset.slot, 0); assert.eq(slots[2].dataset.slot, 1);
    assert.truthy(slots[1].children.some(c => c.innerHTML === tierBadgeHTML(itemTierOf('orb'), 6, 2)),
      'carried relic shows its colored rarity badge');
    assert.truthy(slots[0].children.some(c => c.innerHTML === tierBadgeHTML(2, 6, 2)),
      'equipment shows rarity without numeric tier jargon');
    s.click(slots[1]);
    assert.eq(getSelectedSlot(s.save).id, 'orb'); assert.falsy(s.save.selGear);
    assert.eq(s.useMethod, 'useOrb'); assert.falsy(s.equipSlot);
    s.buildInventoryDOM();
    assert.eq(getSelectedSlot(s.save).id, 'orb', 'rebuild preserves unique selection');
    assert.truthy(s.document.getElementById('inv-name').textContent.includes('Orb'));
    s.click(s.slots()[2]);
    assert.eq(s.eatId, 'goblet', 'Goblet retains its normal food-action selection');
    s.click(s.slots()[0]);
    assert.eq(s.save.selSlot, -1); assert.eq(s.save.selGear.slot, 'sword');
    assert.eq(s.useMethod, undefined); assert.eq(s.equipSlot, 'sword');
    assert.eq(s.save.inv.length, 2, 'carried items were not migrated into gear');
    assert.eq(s.slots().filter(slot => slot.className.split(' ').includes('sel')).length, 1,
      'only the sword is highlighted; empty cells are not selectable');
    assert.falsy(s.slots().some(slot => slot.dataset.slot === -1));
    s.click(s.slots()[1]);
    s.click(s.slots()[1]);
    s.buildInventoryDOM();
    assert.eq(s.save.selSlot, -1); assert.falsy(s.save.selGear, 'empty hands survive a rebuild beside owned gear');
    s.save.selGear = { kind: 'relic', slot: 'bow' };
    s.buildInventoryDOM();
    assert.falsy(s.save.selGear, 'removed gear is cleared instead of selecting a different weapon');
  });

  test('inventory relics: a pickup page includes preceding equipment and tab counts include both', () => {
    const relics = Object.fromEntries(['pickaxe', 'axe', 'sword', 'bow', 'staff', 'watering_can'].map(slot => [slot, { tier: 1 }]));
    const s = harness({ inv: [], relics, armor: {}, invCat: 'seeds', invPage: 0, selSlot: -1 });
    assert.eq(s.addToInv('field_scope', 1), 1);
    assert.eq(s.save.invCat, 'relics'); assert.eq(s.save.invPage, 1);
    assert.truthy(s.slots().some(slot => slot.dataset.slot === 0), 'pickup visible after six equipped slots');
    const tab = s.document.getElementById('inv-tabs').children.find(e => e.dataset.cat === 'relics');
    assert.eq(tab.children.at(-1).textContent, '7', 'six equipped plus one carried');
    assert.eq(s.save.selSlot, -1, 'pickup does not auto-select the carried item');
    s.click(s.slots().find(slot => slot.dataset.slot === 0));
    Inventory.remove(s.save, 'field_scope', 1);
    s._clampSelSlot(); s.buildInventoryDOM();
    assert.eq(s.save.selSlot, -1); assert.eq(s.invEntriesForCat('relics').length, 0);
    assert.eq(s.gearEntriesForCat('relics').length, 6, 'dropping/removing a carried item preserves gear');
  });

  test('inventory relics: alternate weapons have separate selectable slots and one active badge', () => {
    const s = harness({ inv: [], relics: { sword: { tier: 3 }, dagger: { tier: 1 },
      lance: { tier: 3 }, musket: { tier: 5 } }, armor: {}, activeWeapon: 'lance',
      invCat: 'relics', invPage: 0, selSlot: -1 });
    s.buildInventoryDOM();
    for (const slot of ['sword', 'dagger', 'lance', 'musket']) {
      const button = s.slots().find(b => b.dataset.gear === `relic:${slot}`);
      assert.truthy(button, `${slot} appears in Relics`);
      assert.eq(button.children.some(child => child.textContent === 'E'), slot === 'lance');
      s.click(button);
      assert.eq(s.save.selGear.slot, slot);
      assert.eq(s.save.activeWeapon, 'lance', 'highlight alone does not equip');
    }
  });

  test('inventory relics: boot keeps a carried-only Relics tab and tapping again clears selection', () => {
    const s = harness({ inv: [{ id: 'orb', count: 1 }], relics: {}, armor: {},
      invCat: 'relics', invPage: 0, selSlot: -1 });
    s._settleInvCatOnBoot(); assert.eq(s.save.invCat, 'relics');
    s.buildInventoryDOM(); s.click(s.slots()[0]);
    assert.eq(s.save.selSlot, 0);
    s.click(s.slots()[0]);
    assert.eq(s.save.selSlot, -1); assert.falsy(s.save.selGear);
    assert.eq(s.useMethod, undefined);
    assert.eq(s.document.getElementById('inv-name').textContent, '', 'no description without a selected item');
  });
})();

// The inventory's gear tabs list slots from these two arrays, so a slot
// missing from one (a renamed id left behind) never shows in the bag.
test('inventory relics: the gear tab orders name every relic and armour slot', () => {
  const order = (name) => (0, eval)(SCENE_SRC.match(new RegExp('const ' + name + ' = (\\[[^\\]]+\\]);'))[1]);
  assert.eq(order('INV_RELIC_ORDER').slice().sort().join(), Object.keys(RELIC_DEFS).sort().join());
  assert.eq(order('INV_ARMOR_ORDER').slice().sort().join(), Object.keys(ARMOR_DEFS).sort().join());
});
