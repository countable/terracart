# Lane E review handoff - 120 Hz cadence and slice budget

## Scope and intent

This lane keeps the 30 fps default for battery life while making `?fps=0` an
honest display-rate path, including 120 Hz. It changes scheduling only; it does
not change gameplay timers, balance, or rendered output.

## Diff summary

- `src/app.js`
  - Replaces the 10-step modal/story housekeeping throttle with a 3 Hz elapsed-
    time accumulator. A long frame runs the work once and keeps only the phase
    remainder, so it cannot burst to catch up.
  - Relays Phaser's measured display rate to the tile-slice controller on that
    same 3 Hz housekeeping cadence.
  - Leaves `FPS_LIMIT_DEFAULT = 30` and the `?fps=0` limiter bypass unchanged.
- `src/scene_create.js`
  - Seeds the live tile-slice controller with Phaser's measured display interval
    as soon as the playable map replaces the boot overlay.
- `src/worldgen.js`
  - Lets `setSliceBudgetMs` accept the measured display interval.
  - Adds `noteSliceFrameTargetMs` so a later Phaser FPS measurement can tighten
    the controller immediately or let it relax gradually after a slower display
    rate.
  - Caps learned frame quantum by the measured display cadence. This prevents a
    starting 12 ms slice from hiding 120 Hz as a sequence of 16.7 ms frames.
  - Scales additive recovery/probing by the display interval, preserving the
    same wall-clock recovery speed at 60 and 120 Hz.
  - Keeps the existing no-hint behavior for node/device models and the existing
    3-12 ms live range.
- `test/node/frame_cadence.test.js`
  - Pins the 30 fps phase adapter on a 120 Hz display, including elapsed-time
    accounting and `resetDelta` debt clearing.
  - Pins `?fps=0` to all 120 display callbacks.
  - Pins wall-clock housekeeping and the display-rate relay.
- `test/node/slice_budget.test.js`
  - Adds a 120 Hz device model proving the controller discovers sub-8.3 ms
    headroom instead of accepting a false 60 Hz cadence, with under 5% steady-
    state dropped refreshes.
- `docs/design/rendering.md`
  - Records the 30 fps default, the uncapped display-rate path, wall-clock
    throttling, and the requirement to feed display cadence to tile slicing.
- `index.html`, `sw.js`
  - Generated cache-bust hashes only.

## Integration review checklist

### 1. Cadence and 120 Hz proof

- [ ] Confirm `FPS_LIMIT_DEFAULT` remains 30.
- [ ] Confirm `installFrameCadence` still returns without replacing Phaser
      methods when `hasFpsLimit` is false (`?fps=0`).
- [ ] Confirm the new test delivers 120 callbacks for 120 display frames in the
      uncapped path.
- [ ] Confirm the capped phase adapter delivers approximately 30 callbacks from
      480 display ticks at 120 Hz, never more than one callback per display
      tick, and preserves callback elapsed time plus pending delta.
- [ ] Confirm `resetDelta` clears scheduling phase and pre-reset elapsed time.

### 2. Slice-budget frame-rate awareness

- [ ] Confirm `scene_create.js` seeds the controller from
      `this.game.loop.actualFps`, which Phaser updates from display frames even
      while the 30 fps limiter skips game callbacks.
- [ ] Confirm `app.js` refreshes that hint at 3 Hz so a startup estimate of 60
      can tighten to 120 after Phaser has measured the display.
- [ ] Confirm a faster hint lowers `_sliceBaseMs` immediately, while a slower
      hint only raises its ceiling and lets normal relaxation prove the larger
      quantum.
- [ ] Confirm calls that omit the optional frame hint retain the prior 16.7 ms
      learned-base behavior. Existing 30/60 Hz tests exercise this path.
- [ ] Confirm the 120 Hz model starts at a 12 ms slice, converges to available
      8.3 ms-frame headroom, and stays below 5% dropped refreshes.
- [ ] Confirm boot remains non-adaptive and the live slice range remains 3-12
      ms.

### 3. Throttle audit

- [ ] Confirm `_modalGateTick % 10` is gone and the replacement accumulates
      `dtMs` against `1000 / 3`.
- [ ] Confirm modulo keeps phase but executes the housekeeping body at most once
      after a long frame.
- [ ] Confirm the housekeeping calls remain in the same order.
- [ ] Confirm the other `%` matches from the audit are data/animation indexing,
      generation layout, or authored cadence - not update-step throttles. The
      only update-step throttle found was `_modalGateTick`.

## Validation

- `node tools/cachebust.js --write` regenerated `index.html` and `sw.js`.
- `node test/node/run.js`: **4994 passed, 0 failed**.

## Residual risks

- The node tests model Phaser scheduling and quantised refreshes; they do not
  replace a browser run on a physical 120 Hz display.
- `actualFps` can be a startup estimate. The immediate seed may therefore start
  at 16.7 ms, but the 3 Hz relay tightens it once Phaser reports 120 Hz.
- This lane does not claim the rest of update/render fits 8.3 ms. It only keeps
  scheduling and background tile slices from masking or consuming that budget.
