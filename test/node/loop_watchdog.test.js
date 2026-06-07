// Headless tests for the loop/state-resilience invariants introduced in:
//   b86391f  "stuck-work-wheel watchdog" (interact.js TAP_HANDLERS work-progress guard)
//
// NOT testable here (lives in app.js / index.html which need Phaser + DOM):
//   3fc8055  MapScene.update() try/catch + _reportLoopError  → browser harness
//   b86391f  _drawWorkProgress watchdog timer                → browser harness
//   2885805  startStory idempotency + safety-dismiss guard   → browser harness
//
// Only the tap-side of the watchdog is reachable: the 'work-progress' entry in
// TAP_HANDLERS (interact.js, exported to globalThis via the run.js BRIDGE).

// ---- helper: find the handler by name so we're not relying on array index ----
function wpHandler() {
  const h = TAP_HANDLERS.find((h) => h.name === 'work-progress');
  if (!h) throw new Error('work-progress handler not found in TAP_HANDLERS');
  return h;
}

// Build a minimal scene whose _workProgress has the given startT and whose
// abortWorkProgress is a spy.
function makeWpScene(startT) {
  let aborted = 0;
  const scene = makeScene({
    _workProgress: { startT, durationMs: 3000 },
    abortWorkProgress: () => { aborted++; },
  });
  return { scene, getAborted: () => aborted };
}

// ---- tests -------------------------------------------------------------------

test('work-progress handler: returns false when no wheel is in progress', () => {
  const scene = makeScene();   // _workProgress is undefined
  const ctx = makeCtx(scene, {});
  const result = wpHandler().try(ctx);
  assert.eq(result, false, 'no wheel → handler should not consume the tap');
});

test('work-progress handler: swallows tap within 150 ms without aborting', () => {
  // startT is "just now" — well within the 150 ms debounce window
  const startT = performance.now();
  const { scene, getAborted } = makeWpScene(startT);
  const ctx = makeCtx(scene, {});
  const result = wpHandler().try(ctx);
  assert.eq(result, true, 'tap should be consumed (swallowed)');
  assert.eq(getAborted(), 0, 'abortWorkProgress must NOT be called within debounce window');
});

test('work-progress handler: aborts and consumes tap after debounce window', () => {
  // startT is 200 ms in the past — past the 150 ms debounce
  const startT = performance.now() - 200;
  const { scene, getAborted } = makeWpScene(startT);
  const ctx = makeCtx(scene, {});
  const result = wpHandler().try(ctx);
  assert.eq(result, true, 'tap should be consumed');
  assert.eq(getAborted(), 1, 'abortWorkProgress must be called exactly once');
});

test('work-progress handler: missing startT (0) falls outside debounce, aborts', () => {
  // startT = 0 (epoch origin) means performance.now() - 0 >> 150, so it aborts
  let aborted = 0;
  const scene = makeScene({
    _workProgress: { durationMs: 3000 },   // no startT → defaults to 0
    abortWorkProgress: () => { aborted++; },
  });
  const ctx = makeCtx(scene, {});
  const result = wpHandler().try(ctx);
  assert.eq(result, true, 'tap consumed');
  assert.eq(aborted, 1, 'missing startT treated as epoch origin → abort');
});

test('work-progress handler: is the very first entry in TAP_HANDLERS', () => {
  // The guard must run before any other tap handler so no interactable fires
  // while the wheel is running.
  assert.eq(TAP_HANDLERS[0].name, 'work-progress',
    'work-progress must be the highest-priority (index 0) tap handler');
});
