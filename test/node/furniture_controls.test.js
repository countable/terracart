// Furniture pickup controls share the offer modal.
(() => {
  test('furniture: top pickup is a ghost control and failed pickup keeps the picker open', () => {
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
