(() => {
  test('repeat offer: each live button transacts once, refreshes, and Leave exits', () => {
    const oldCreate = document.createElement;
    const el = () => ({ style: {}, children: [], events: {},
      setAttribute(name, value) { this[name] = value; },
      appendChild(c) { this.children.push(c); },
      addEventListener(name, fn) { this.events[name] = fn; },
      remove() { this.removed = true; },
      click() { this.events.click({ stopPropagation() {} }); },
    });
    document.createElement = el;
    try {
      const scene = new SceneModals();
      let shell, stock = 2, left = 0, receipt;
      scene.makeModalShell = (id, opts) => {
        shell = { wrap: el(), box: el(), opts, buttons: [], mount() {} };
        const current = shell;
        shell.mkBtn = (label, primary, disabled) => {
          const b = Object.assign(el(), { label, disabled });
          current.buttons.push(b); return b;
        };
        return shell;
      };
      const open = () => scene.showOfferModal({ get: 'One item', cost: 'One coin',
        canAfford: stock > 0, cancelLabel: 'Leave', receipt,
        onAccept: () => { assert.truthy(shell.wrap.removed); stock--; receipt = 'Bought 1× Book for 5 coins.'; },
        repeat: open, onCancel: () => { left++; },
      });
      open();
      const first = shell.buttons[1];
      assert.eq(shell.opts.onClose, undefined, 'backdrop does not exit the shop');
      first.click(); first.click();
      assert.eq(stock, 1, 'a detached button cannot charge twice');
      assert.eq(shell.box.children.find(c => c.role === 'status')?.textContent,
        `✓ ${receipt}`, 'confirmation stays visible inside the refreshed counter');
      shell.buttons[1].click();
      assert.eq(stock, 0);
      assert.truthy(shell.buttons[1].disabled);
      shell.buttons[1].click();
      assert.eq(stock, 0, 'exhausted counter cannot transact');
      shell.buttons[0].click();
      assert.truthy(shell.wrap.removed);
      assert.eq(left, 1);
    } finally { document.createElement = oldCreate; }
  });
})();
