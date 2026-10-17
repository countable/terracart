test('speech bubble: viewport anchors choose below top-half sources and above bottom-half sources', () => {
  const start = MODAL_SHELL_SRC.indexOf('\n  _placeSpeechBubble(');
  const method = MODAL_SHELL_SRC.slice(start + 1, MODAL_SHELL_SRC.indexOf('\n  }\n', start) + 4);
  const values = {};
  const box = { offsetHeight: 160, style: { setProperty(k, v) { values[k] = v; } } };
  const wrap = { isConnected: true, dataset: {} };
  const win = { innerWidth: 390, innerHeight: 844, addEventListener() {} };
  const doc = { body: {}, getElementById: () => ({ getBoundingClientRect: () => ({ left: 0, right: 390 }) }) };
  const Observer = class { observe() {} };
  const Scene = new Function('window', 'document', 'ResizeObserver', 'MutationObserver',
    `return class { ${method} }`)(win, doc, undefined, Observer);
  const scene = new Scene();
  scene._placeSpeechBubble(wrap, box, { left: 320, top: 50, width: 60, height: 60 });
  assert.eq(wrap.dataset.placement, 'below');
  assert.eq(values['--speech-top'], '128px', 'bubble clears the dial bottom and tail');
  assert.eq(values['--speech-left'], '50px', 'right edge stays on screen');
  scene._placeSpeechBubble(wrap, box, { left: 140, top: 700, width: 60, height: 60 });
  assert.eq(wrap.dataset.placement, 'above');
  assert.eq(values['--speech-top'], '522px', 'bubble clears inventory top and tail');
  assert.eq(values['--speech-max-height'], '670px', 'long conversation scrolls within available space');
});
