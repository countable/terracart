// The confirmation shell owns one close-before-callback lifecycle for simple
// accept/cancel decisions. Feed and Move Home provide content and actions.

(function () {
function fakeEl(tag) {
  return {
    tag, style: { cssText: '' }, children: [], innerHTML: '', removed: false, _on: {},
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(event, fn) { this._on[event] = fn; },
    remove() { this.removed = true; },
    click() { this._on.click?.({ stopPropagation() {} }); },
  };
}

function openConfirm(overrides = {}) {
  const scene = new SceneModals();
  const shell = { made: 0, mounted: false };
  scene.makeModalShell = (id, opts) => {
    shell.made++;
    shell.id = id;
    shell.opts = opts;
    shell.wrap = fakeEl('div');
    shell.box = fakeEl('div');
    shell.backdrop = () => { shell.wrap.remove(); opts.onClose?.(); };
    return {
      wrap: shell.wrap,
      box: shell.box,
      mount: () => { shell.mounted = true; },
      mkBtn: (label, primary, disabled) => Object.assign(fakeEl('button'), { innerHTML: label, primary, disabled }),
    };
  };
  const realGet = document.getElementById;
  const realCreate = document.createElement;
  document.getElementById = () => overrides.existing || null;
  document.createElement = fakeEl;
  try {
    scene.showConfirmModal({
      id: 'confirm-fixture', kind: 'note', title: 'Proceed?', body: '<b>Details</b>',
      acceptLabel: 'Yes', cancelLabel: 'No', canAfford: overrides.canAfford,
      onAccept: overrides.onAccept, onCancel: overrides.onCancel,
    });
  } finally {
    document.getElementById = realGet;
    document.createElement = realCreate;
  }
  shell.buttons = shell.box
    ? shell.box.children.flatMap((child) => child.tag === 'div' ? child.children : [])
      .filter((child) => child.tag === 'button')
    : [];
  return shell;
}

function button(shell, label) {
  return shell.buttons.find((candidate) => candidate.innerHTML === label);
}

test('confirm modal: accept closes before one accept callback', () => {
  let accepts = 0, cancels = 0, closedAtCallback = false;
  const shell = openConfirm({
    onAccept: () => { accepts++; closedAtCallback = shell.wrap.removed; },
    onCancel: () => { cancels++; },
  });
  assert.truthy(shell.mounted, 'the confirmation mounted');
  button(shell, 'Yes').click();
  button(shell, 'Yes').click();
  shell.backdrop();
  assert.truthy(closedAtCallback, 'the modal closes before acceptance runs');
  assert.eq(accepts, 1, 'accept fires once');
  assert.eq(cancels, 0, 'late dismissal cannot cancel an accepted choice');
});

test('confirm modal: unaffordable transactions disable acceptance but permit cancellation', () => {
  let accepts = 0, cancels = 0;
  const shell = openConfirm({ canAfford: false, onAccept: () => accepts++, onCancel: () => cancels++ });
  assert.truthy(button(shell, 'Yes').disabled);
  button(shell, 'Yes').click();
  assert.eq(accepts, 0);
  assert.falsy(shell.wrap.removed);
  button(shell, 'No').click();
  assert.eq(cancels, 1);
});

test('confirm modal: cancel closes before one cancel callback', () => {
  let accepts = 0, cancels = 0, closedAtCallback = false;
  const shell = openConfirm({
    onAccept: () => { accepts++; },
    onCancel: () => { cancels++; closedAtCallback = shell.wrap.removed; },
  });
  button(shell, 'No').click();
  button(shell, 'No').click();
  assert.truthy(closedAtCallback, 'the modal closes before cancellation runs');
  assert.eq(accepts, 0, 'cancel does not accept');
  assert.eq(cancels, 1, 'cancel fires once');
});

test('confirm modal: backdrop dismissal uses the cancel lifecycle once', () => {
  let cancels = 0;
  const shell = openConfirm({ onCancel: () => { cancels++; } });
  shell.backdrop();
  shell.backdrop();
  assert.eq(cancels, 1, 'backdrop dismissal fires cancel once');
});

test('confirm modal: an existing id blocks duplicate construction', () => {
  let accepted = 0;
  const shell = openConfirm({ existing: {}, onAccept: () => { accepted++; } });
  assert.eq(shell.made, 0, 'the duplicate did not replace the open confirmation');
  assert.eq(accepted, 0, 'the duplicate did not run an action');
});

test('confirm modal: feed and Move Home delegate to the shared shell', () => {
  assert.truthy(/showFeedConfirm\([\s\S]*?this\.showConfirmModal\(\{[\s\S]*?id: 'feed-confirm-modal'/.test(SCENE_SRC),
    'feeding delegates to the shared confirmation');
  assert.truthy(/confirmMoveHomeTrailer\([\s\S]*?this\.showConfirmModal\(\{[\s\S]*?id: 'move-home-modal'/.test(SCENE_SRC),
    'Move Home delegates to the shared confirmation');
});
})();
