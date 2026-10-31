// ─────────────────────────────────────────────────────────────────────────
// CometRing — the COMET RING's aura (items.js UNIQUE_JEWELRY.comet_ring
// .cometAura): a ring of fire round the wearer's feet that grows, in reach
// and in bite, with the wearer's own PACE. Standing still it is an ember
// (`restIntensity` of its full strength, `minRadiusCells` wide); at `maxMps`
// it is a comet's tail (`maxRadiusCells`, `maxDps`). Faster than `maxMps`
// for `overspeedMs` running and the wind puts it out for `snuffedMs` (the
// `cometSnuffed` row of Buffs.KINDS, scene_consumables.js _tickCometAura
// is its one writer); then it relights by itself. The wearer is never
// inside their own fire: the scene's tick burns ENEMIES only.
//
// Pure — no Phaser, no DOM. `step` is a state machine fed one sample a
// frame; the scene keeps the state (scene._cometAura) and the save keeps
// nothing (a reload starts the pace at zero, like the quicksand's clock).
//
// The PACE is the player's actual world feet (playerWorldM) over the frame,
// so GPS, the stick and a blocked step agree, smoothed over SMOOTH_S so a
// jittery fix neither flares nor flickers the fire. A jump past TELEPORT_MPS
// is a placement (a GPS snap, a portal), not a run: the sample is dropped and
// the last pace kept. A floor change (`movedM` null) starts the pace afresh.
(function (root) {
  'use strict';

  // The pace reading's time constant, seconds: the aura swells and shrinks
  // over about a stride, and the 3 s over-speed clock dominates it.
  const SMOOTH_S = 0.3;
  // Faster than this between two frames is a placement, never running.
  const TELEPORT_MPS = 40;

  function spec() { return UNIQUE_JEWELRY.comet_ring.cometAura; }

  // The aura `mps` of pace lights: its radius in cells, its intensity (0..1,
  // `restIntensity` at a standstill, 1 at `maxMps` and above) and the HP a
  // second it burns into a foe inside it.
  function shape(mps, s = spec()) {
    const t = Math.max(0, Math.min(1, (Number(mps) || 0) / s.maxMps));
    const intensity = s.restIntensity + (1 - s.restIntensity) * t;
    return {
      radiusCells: s.minRadiusCells + (s.maxRadiusCells - s.minRadiusCells) * t,
      intensity,
      dps: s.maxDps * intensity,
    };
  }

  const OUT = Object.freeze({ radiusCells: 0, intensity: 0, dps: 0 });

  // One frame of the ring: `state` is the last step's result (or null),
  // `sample` is { movedM, dt, snuffed } — the metres the feet moved this
  // frame (null across a floor change), the frame's seconds, and whether
  // the `cometSnuffed` row still runs. Returns the next state:
  //   mps       the smoothed pace
  //   overMs    how long the pace has run past maxMps, continuously
  //   snuff     true on the one frame the over-speed clock fills: the caller
  //             lends the Buffs row snuffedMs and the fire is out
  //   lit       whether the aura burns this frame
  //   radiusCells / intensity / dps — shape(mps) while lit, zeros while out
  function step(state, sample, s = spec()) {
    const prev = state || { mps: 0, overMs: 0 };
    const dt = Number(sample?.dt) || 0;
    let mps = Number(prev.mps) || 0;
    if (sample?.movedM == null) mps = 0;
    else if (dt > 0) {
      const v = Math.max(0, sample.movedM) / dt;
      if (v <= TELEPORT_MPS) mps += (v - mps) * Math.min(1, dt / SMOOTH_S);
    }
    let overMs = Number(prev.overMs) || 0, snuff = false;
    if (sample?.snuffed) overMs = 0;
    else if (mps > s.maxMps) {
      overMs += dt * 1000;
      if (overMs >= s.overspeedMs) { snuff = true; overMs = 0; }
    } else overMs = 0;
    const lit = !sample?.snuffed && !snuff;
    return { mps, overMs, snuff, lit, ...(lit ? shape(mps, s) : OUT) };
  }

  root.CometRing = { SMOOTH_S, TELEPORT_MPS, spec, shape, step };
})(typeof globalThis !== 'undefined' ? globalThis : this);
