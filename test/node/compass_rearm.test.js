// After a same-session reload the splash is skipped, so iOS compass permission
// is re-requested on a later tap (index.html __rearmCompassOnGesture). A drag
// on the movement or GPS stick earns no gesture credit and is refused without
// an answer; the re-arm must survive that and ask again on the next tap.
(() => {
  const start = INDEX_HTML_SRC.indexOf('    window.__rearmCompassOnGesture = () => {');
  const end = INDEX_HTML_SRC.indexOf('\n    };', start);
  const source = INDEX_HTML_SRC.slice(start, end + 7);
  // requestPermission settles in microtasks; a few turns drain .then/.catch.
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  function harness(answers) {
    const listeners = new Map(), calls = [];
    const window = { DeviceOrientationEvent: { requestPermission() {
      const answer = answers.shift();
      calls.push(answer);
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    } }, __scene: { started: 0, startSensors() { this.started++; } } };
    const document = {
      addEventListener(type, fn) { listeners.set(type, fn); },
      removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
    };
    new Function('window', 'document', source)(window, document);
    window.__rearmCompassOnGesture();
    const tap = async () => { listeners.get('touchend')?.(); await flush(); };
    return { window, listeners, calls, tap };
  }
  test('compass re-arm: a refused drag keeps listening; the next tap restores the compass', async () => {
    const h = harness([new Error('NotAllowedError'), 'granted']);
    await h.tap();
    assert.eq(h.window.__scene.started, 0, 'no answer, no sensors');
    assert.truthy(h.listeners.has('touchend') && h.listeners.has('click'), 'still listening after the refusal');
    await h.tap();
    assert.eq(h.window.__compassPerm, 'granted');
    assert.eq(h.window.__scene.started, 1);
    assert.falsy(h.listeners.has('touchend') || h.listeners.has('click'), 'done once answered');
  });
  test('compass re-arm: a denial is final; a pending request is not doubled', async () => {
    const h = harness(['denied']);
    h.listeners.get('touchend')(); h.listeners.get('click')();
    await flush();
    assert.eq(h.calls.length, 1, 'touchend and its click share one request');
    assert.eq(h.window.__compassPerm, 'denied');
    assert.eq(h.listeners.size, 0);
  });
})();
