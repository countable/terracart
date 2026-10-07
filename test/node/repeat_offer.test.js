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

  test('repeat offer: a deal with no receipt of its own reprints its toasts in the reopened dialog', () => {
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
      let shell, wood = 2;
      scene.iconSpanHTML = (id) => `<i data-icon="${id}"></i>`;
      // The scene's toasts as app.js has them: capture first, then draw.
      scene.flashLoot = function (text, color, mul, itemId) { this._offerToastLog?.push({ text, color, itemId, loot: true }); };
      scene.flash = function (text) { this._offerToastLog?.push({ text }); };
      scene.makeModalShell = (id, opts) => {
        shell = { wrap: el(), box: el(), opts, buttons: [], mount() {} };
        const current = shell;
        shell.mkBtn = (label, primary, disabled) => { const b = Object.assign(el(), { label, disabled }); current.buttons.push(b); return b; };
        return shell;
      };
      const status = () => shell.box.children.find(c => c.role === 'status');
      const open = () => scene.showOfferModal({ get: 'Coins', cost: '1× Wood', canAfford: true, cancelLabel: 'Leave',
        onAccept: () => { if (wood <= 0) { scene.flash('Gone — already used.'); return; } wood--; scene.flashLoot('+25', '#fd0', 1, 'wood'); },
        repeat: open });
      open();
      assert.eq(status(), undefined, 'a fresh counter shows no receipt');
      shell.buttons[1].click();
      assert.eq(status().innerHTML, '✓ <i data-icon="wood"></i> +25', 'the sale is confirmed inside the reopened dialog, icon and amount');
      shell.buttons[1].click(); shell.buttons[1].click();
      assert.truthy(/Gone — already used\./.test(status().innerHTML) && !/✓/.test(status().innerHTML),
        'a refused deal says why, plainly, in the dialog');
      assert.eq(scene._offerToastLog, null); assert.eq(scene._offerToasts, null);
      scene.flashLoot('+1', '#fff', 1, 'torch');
      shell.buttons[0].click();
      open();
      assert.eq(status(), undefined, 'a toast outside an accept never leaks into a later dialog');
    } finally { document.createElement = oldCreate; }
  });
})();

