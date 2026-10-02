// Fixed-tier carried relics share the equipment tab without becoming gear slots.
(function () {
  function harness(save) {
    function el(tag) {
      const out = { tag, style: {}, dataset: {}, children: [], className: '',
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
      _effectLineEl(text) { const row = el('div'); row.textContent = text; return row; },
    };
    const decl = ['INV_RELIC_ORDER', 'INV_ARMOR_ORDER', 'WEAPON_SLOTS'].map(name =>
      SCENE_SRC.match(new RegExp('const ' + name + ' = \\[[^;]+;'))[0]).join('\n');
    for (const name of ['invEntriesForCat', 'invDisplayEntriesForCat', 'gearEntriesForCat', '_settleInvCatOnBoot',
      'selectInvCat', 'buildInventoryDOM', 'refreshInventoryHighlight', 'addToInv', '_finishInventoryChange', '_clampSelSlot']) {
      const match = SCENE_SRC.match(new RegExp('^  ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?^  \\}', 'm'));
      assert.truthy(match, `${name} exists`);
      scene[name] = new Function('document', 'persistSave', decl + '\nreturn ({' + match[0] + '})')(document, () => {})[name];
    }
    scene.slots = () => document.getElementById('inv').querySelectorAll('button[data-slot],button[data-gear]');
    scene.click = button => button.click({ stopPropagation() {} });
    return scene;
  }

  test('inventory relics: permanent items use the existing Relics tab, not a ninth tab', () => {
    assert.eq(INV_CATS.length, 8);
    assert.falsy(INV_CAT_BY_KEY.unique_relic);
    const ids = ITEMS.filter(i => i.kind === 'unique_relic').map(i => i.id);
    assert.eq(ids.length, 18, 'eleven finds plus seven reusable tomes');
    for (const id of ids) assert.eq(invCatForItem(id), 'relic', id);
  });

  test('inventory relics: gear and carried items render together, with correct selection, actions and tiers', () => {
    const s = harness({ inv: [{ id: 'orb', count: 1 }, { id: 'goblet', count: 1 }],
      relics: { sword: { tier: 2 } }, armor: {}, invCat: 'relic', invPage: 0, selSlot: -1, selGear: null });
    s.buildInventoryDOM();
    const slots = s.slots();
    assert.eq(slots[0].dataset.gear, 'relic:sword');
    assert.eq(slots[1].dataset.slot, 0); assert.eq(slots[2].dataset.slot, 1);
    assert.truthy(slots[1].textContent.includes(`T${ITEM_BY_ID.orb.baseTier}`));
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
    s.click(s.slots().find(slot => slot.dataset.slot === -1));
    s.buildInventoryDOM();
    assert.eq(s.save.selSlot, -1); assert.falsy(s.save.selGear, 'empty hands survive a rebuild beside owned gear');
    s.save.selGear = { kind: 'relic', slot: 'bow' };
    s.buildInventoryDOM();
    assert.falsy(s.save.selGear, 'removed gear is cleared instead of selecting a different weapon');
  });

  test('inventory relics: a pickup page includes preceding equipment and tab counts include both', () => {
    const relics = Object.fromEntries(['pick', 'axe', 'sword', 'bow', 'staff', 'can'].map(slot => [slot, { tier: 1 }]));
    const s = harness({ inv: [], relics, armor: {}, invCat: 'seed', invPage: 0, selSlot: -1 });
    assert.eq(s.addToInv('telescope', 1), 1);
    assert.eq(s.save.invCat, 'relic'); assert.eq(s.save.invPage, 1);
    assert.truthy(s.slots().some(slot => slot.dataset.slot === 0), 'pickup visible after six equipped slots');
    const tab = s.document.getElementById('inv-tabs').children.find(e => e.dataset.cat === 'relic');
    assert.eq(tab.children.at(-1).textContent, '7', 'six equipped plus one carried');
    assert.eq(s.save.selSlot, -1, 'pickup does not auto-select the carried item');
    s.click(s.slots().find(slot => slot.dataset.slot === 0));
    Inventory.remove(s.save, 'telescope', 1);
    s._clampSelSlot(); s.buildInventoryDOM();
    assert.eq(s.save.selSlot, -1); assert.eq(s.invEntriesForCat('relic').length, 0);
    assert.eq(s.gearEntriesForCat('relic').length, 6, 'dropping/removing a carried item preserves gear');
  });

  test('inventory relics: boot keeps a carried-only Relics tab and empty-hand selection works', () => {
    const s = harness({ inv: [{ id: 'orb', count: 1 }], relics: {}, armor: {},
      invCat: 'relic', invPage: 0, selSlot: -1 });
    s._settleInvCatOnBoot(); assert.eq(s.save.invCat, 'relic');
    s.buildInventoryDOM(); s.click(s.slots()[0]);
    assert.eq(s.save.selSlot, 0);
    s.click(s.slots().find(slot => slot.dataset.slot === -1));
    assert.eq(s.save.selSlot, -1); assert.falsy(s.save.selGear);
    assert.eq(s.useMethod, undefined);
    assert.eq(s.document.getElementById('inv-name').textContent, 'Select a relic');
  });
})();
