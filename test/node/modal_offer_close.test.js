// A purchased Book waits until its counter closes, including an enemy hit.
(function () {
  const lift = name => {
    const start = SCENE_SRC.indexOf('\n  ' + name + '(');
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    return new Function('return ({' + SCENE_SRC.slice(start, end + 4) + '})')()[name];
  };
  test('offer lifecycle: hit after buying a Book releases its deferred reading once', () => {
    const original = { create: document.createElement, get: document.getElementById, query: document.querySelectorAll };
    const el = () => ({ style: {}, children: [], events: {}, removed: false,
      appendChild(child) { this.children.push(child); },
      setAttribute(name, value) { this[name] = value; },
      addEventListener(name, fn) { this.events[name] = fn; },
      remove() { this.removed = true; }, click() { this.events.click({ stopPropagation() {} }); },
    });
    let current, buttons;
    document.createElement = el;
    document.getElementById = () => current && !current.removed ? current : null;
    document.querySelectorAll = () => current && !current.removed ? [current] : [];
    try {
      const scene = new SceneModals();
      const reads = [];
      Object.assign(scene, {
        save: SaveState.defaults({ money: 10000 }),
        _presentStallOffer: lift('_presentStallOffer'),
        _closeShopOnHit: lift('_closeShopOnHit'),
        _revealPendingBookReads: lift('_revealPendingBookReads'),
        _enqueueCeremony(kind) { reads.push(kind); assert.truthy(current.removed, 'close before releasing reads'); },
        _drainCeremonies() {}, _settleDeal() {}, flash() {},
        invRoomFor: () => 100, moneyHTML: n => String(n), iconSpanHTML: () => '',
        addToInv(id, n, silent, opts) {
          assert.eq(id, 'book'); assert.truthy(opts.deferBookRead);
          this._pendingBookReads = (this._pendingBookReads || 0) + n;
          return n;
        },
        makeModalShell() {
          current = el(); buttons = [];
          return { wrap: current, box: el(), mount() {}, mkBtn(label, primary, disabled) {
            const b = Object.assign(el(), { innerHTML: label, disabled, _setEnabled(on) { this.disabled = !on; } });
            buttons.push(b); return b;
          } };
        },
      });
      scene._presentStallOffer(0, 0, { items: ['book'], title: 'Books' });
      buttons.find(b => b.innerHTML === 'Buy').click();
      assert.eq(scene._pendingBookReads, 1);
      assert.eq(reads.length, 0, 'repeat counter retains pending reading');
      const interrupted = current;
      scene._closeShopOnHit();
      assert.eq(scene._pendingBookReads, 0);
      assert.eq(reads.join(','), 'read');
      interrupted.closeModal('hit');
      buttons.find(b => b.innerHTML === 'Leave').click();
      assert.eq(reads.length, 1, 'repeated close cannot release another reading');
    } finally {
      document.createElement = original.create;
      document.getElementById = original.get;
      document.querySelectorAll = original.query;
    }
  });
})();
