// The inventory description plate (#inv-name: the selected item's title and
// its ✦ effect line) is ONE tap target for the full description. Title and
// line are each a nowrap ellipsis line, so either may be cut off on a phone;
// tapping anywhere on the plate opens the whole sentence through the one
// opener, _openSelectedDescription → showMessageModal. The plate is inert
// (pointer-events:none) whenever the selection has nothing to open, so a
// tap there still reaches the map, and the press is swallowed like every
// HUD button's so the map never sees a tap that opened a dialog.
(function () {
  const lift = (name) => {
    const start = SCENE_SRC.indexOf('\n  ' + name + '(');
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    assert.truthy(start >= 0 && end > start, `found ${name}`);
    return new Function('return ({' + SCENE_SRC.slice(start, end + 4) + '})[' + JSON.stringify(name) + ']')();
  };
  // The plate's wiring, as buildInventoryDOM installs it: from the first
  // listener to the append, run against a fake plate.
  const wiringSrc = (() => {
    const anchor = SCENE_SRC.indexOf("nameLbl.id = 'inv-name';");
    const start = SCENE_SRC.indexOf('nameLbl.addEventListener(', anchor);
    const end = SCENE_SRC.indexOf('document.body.appendChild(nameLbl);', start);
    assert.truthy(anchor >= 0 && start > anchor && end > start, 'buildInventoryDOM wires the plate before appending it');
    return SCENE_SRC.slice(start, end);
  })();
  const wire = new Function('nameLbl', wiringSrc);

  const element = (tag) => ({
    tag, style: {}, children: [], events: {}, attrs: {}, className: '', dataset: {},
    get textContent() { return this._text ?? ''; },
    set textContent(v) { this._text = v; this.children = []; },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(event, fn) { (this.events[event] ||= []).push(fn); },
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
    querySelectorAll() { return []; },
    fire(event, extra = {}) {
      const e = { stopped: 0, prevented: 0, stopPropagation() { this.stopped++; }, preventDefault() { this.prevented++; }, ...extra };
      for (const fn of this.events[event] || []) fn(e);
      return e;
    },
    click() { return this.fire('click'); },
  });

  function scene(save) {
    const plate = element('div');
    const bar = element('div');
    const s = {
      save, dialogs: [],
      showMessageModal(o) { this.dialogs.push(o); },
      renderItemIcon() { return element('img'); },
      iconSpanHTML(id, size) { return `<i data-size="${size}"></i>`; },
      gearIconHTML(kind, slot, tier, size) { return `<i data-size="${size}"></i>`; },
      syncEatButton() {}, syncConsumableButton() {}, syncEquipButton() {}, syncFurnitureFlipButton() {}, syncSeedButton() {},
    };
    for (const name of ['refreshInventoryHighlight', '_effectLineEl', '_openSelectedDescription']) s[name] = lift(name);
    wire.call(s, plate);
    const realGet = document.getElementById;
    document.getElementById = (id) => id === 'inv-name' ? plate : id === 'inv' ? bar : null;
    const realCreate = document.createElement;
    document.createElement = element;
    try { s.refreshInventoryHighlight(); } finally {
      document.getElementById = realGet;
      document.createElement = realCreate;
    }
    return { s, plate };
  }

  const described = Object.keys(ITEM_EFFECTS).find((id) => ITEM_BY_ID[id]);
  const bare = Object.keys(ITEM_BY_ID).find((id) => !ITEM_EFFECTS[id]);
  assert.truthy(described && bare, 'an item with a description and one without');
  const held = (id) => ({ invCat: 'seeds', selSlot: 0, selGear: null, inv: [{ id, count: 2 }] });

  test('description plate: a tap anywhere on the plate (title or ✦ line) opens the full description once, through the one opener', () => {
    const { s, plate } = scene(held(described));
    assert.eq(plate.children.length, 2, 'title and effect line');
    assert.eq(plate.style.pointerEvents, 'auto', 'the plate opts into taps');
    assert.eq(plate.style.cursor, 'pointer');
    assert.eq(plate.attrs.role, 'button');
    assert.eq(plate.tabIndex, 0);
    const line = plate.children[1];
    assert.eq(Object.keys(line.events).length, 0, 'the effect line carries no tap of its own — the plate is the target');
    assert.falsy((line.style.cssText || '').includes('pointer-events'), 'the line does not opt in separately');
    const down = plate.fire('pointerdown');
    assert.eq(down.stopped, 1, 'the press never reaches the map');
    const click = plate.click();
    assert.eq(click.stopped, 1, 'the tap never reaches the map or the item action');
    assert.eq(s.dialogs.length, 1, 'one dialog');
    assert.eq(s.dialogs[0].body, `✦ ${ITEM_EFFECTS[described]}`, 'the whole sentence');
    assert.includes(s.dialogs[0].title, ITEM_BY_ID[described].name, 'titled with the item');
    assert.includes(s.dialogs[0].title, 'data-size="96"', 'detail portrait is 96 pixels');
  });

  test('description plate: Enter and Space open it from the keyboard like other HUD buttons; other keys do not', () => {
    const { s, plate } = scene(held(described));
    const enter = plate.fire('keydown', { key: 'Enter' });
    assert.eq(enter.prevented, 1);
    plate.fire('keydown', { key: ' ' });
    plate.fire('keydown', { key: 'x' });
    assert.eq(s.dialogs.length, 2);
  });

  test('description plate: with nothing to open the plate is inert, so the tap falls through to the map', () => {
    const { s, plate } = scene(held(bare));
    assert.eq(plate.children.length, 1, 'title only');
    assert.eq(plate.style.pointerEvents, 'none');
    assert.falsy(plate.attrs.role);
    assert.falsy('tabindex' in plate.attrs);
    plate.click();
    assert.eq(s.dialogs.length, 0, 'nothing to open');
  });

  test('description plate: a refresh to an undescribed item lets go of the previous description', () => {
    const { s, plate } = scene(held(described));
    s.save.inv[0] = { id: bare, count: 1 };
    const realGet = document.getElementById;
    const realCreate = document.createElement;
    document.getElementById = (id) => id === 'inv-name' ? plate : id === 'inv' ? element('div') : null;
    document.createElement = element;
    try { s.refreshInventoryHighlight(); } finally { document.getElementById = realGet; document.createElement = realCreate; }
    assert.eq(plate.style.pointerEvents, 'none');
    plate.click();
    assert.eq(s.dialogs.length, 0);
  });

  test('description plate: showMessageModal for the description is called from the one opener only', () => {
    const openers = SCENE_SRC.match(/showMessageModal\(this\._selectedDescription\)/g) || [];
    assert.eq(openers.length, 1, 'one opener reads the recorded description');
    assert.eq((SCENE_SRC.match(/_openSelectedDescription\(\)/g) || []).length, 2, 'declared once, called once (the plate click)');
  });
})();
