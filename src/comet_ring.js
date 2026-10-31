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
// The PACE is the player's REAL pace: the GPS speed lane (util.js — the
// device's own speed when it reports one, else the leg from the last
// reliable fix, as the passenger gate reads it; `gpsPace` takes the gate
// state's last sample). Never the body on the map: a stick walk away from
// the fix, the walk home after it and a GPS catch-up chase are the
// character moving, not the player, and light nothing (owner, Oct 2026).
// With no GPS (the sandbox, a desktop, the stick taking over) the ring is
// an ember. Smoothed over SMOOTH_S so a jittery fix neither flares nor
// flickers the fire; a sample past TELEPORT_MPS is a jump, not a run, and
// is dropped; a gate with no sample for PACE_STALE_MS reads as standing.
(function (root) {
  'use strict';

  // The pace reading's time constant, seconds: the aura swells and shrinks
  // over about a stride, and the 3 s over-speed clock dominates it.
  const SMOOTH_S = 0.3;
  // Faster than this is a jump between fixes, never running.
  const TELEPORT_MPS = 40;
  // A gate whose last sample is older than this reads as standing still:
  // fixes come about once a second, so a stopped phone goes dark quickly
  // rather than holding the last stride's fire for the gate's two minutes.
  const PACE_STALE_MS = 10000;

  function spec() { return UNIQUE_JEWELRY.comet_ring.cometAura; }

  // The real pace the GPS lane last read, in m/s: the speed gate state's
  // last sample (util.js speedGateStep `mps`, judged at `lastT` on the
  // caller's clock) while it is fresh, else 0. No gate (the sandbox, the
  // stick's manual override, a teleport) is 0 too.
  function gpsPace(gate, now = Date.now()) {
    if (!gate || gate.lastT == null || !Number.isFinite(gate.mps)) return 0;
    if (now - gate.lastT > PACE_STALE_MS) return 0;
    return Math.max(0, gate.mps);
  }

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
  // `sample` is { mps, dt, snuffed } — the real pace this frame (gpsPace),
  // the frame's seconds, and whether the `cometSnuffed` row still runs.
  // Returns the next state:
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
    const v = Number(sample?.mps);
    if (dt > 0 && Number.isFinite(v) && v <= TELEPORT_MPS) {
      mps += (Math.max(0, v) - mps) * Math.min(1, dt / SMOOTH_S);
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

  root.CometRing = { SMOOTH_S, TELEPORT_MPS, PACE_STALE_MS, spec, gpsPace, shape, step };
})(typeof globalThis !== 'undefined' ? globalThis : this);
