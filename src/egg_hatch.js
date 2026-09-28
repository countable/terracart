// A carried egg incubates on real GPS walks. Progress survives reloads, but
// GPS anchors do not: loading/resuming must never credit an unseen journey.
(function (root) {
  'use strict';
  const METERS = EGG_HATCH_METERS;
  // A walked leg is util.js's GPS SPEED lane — the same reliable-fix rule and
  // the same walking ceiling (GPS_MAX_WALK_MPS) the passenger gate reads.
  const MAX_SPEED = GPS_MAX_WALK_MPS;

  function progress(save) {
    return Number.isFinite(save.eggHatchM) ? Math.max(0, Math.min(METERS, save.eggHatchM)) : 0;
  }
  function remaining(save) { return Math.ceil(METERS - progress(save)); }
  function ready(save) { return Inventory.count(save, 'egg') > 0 && remaining(save) === 0; }


  // fix uses raw WGS84 coordinates, never playerM/control-stick movement.
  // The anchor waits through small fixes so ordinary slow walks still count.
  // Invalid fixes break continuity; the next reliable fix starts a new leg.
  function track(save, tracker, fix, now = Date.now()) {
    const none = { tracker: null, added: 0, changed: false };
    if (!Inventory.count(save, 'egg') || ready(save)) return none;
    if (!gpsFixReliable(fix, now)) return none;
    const session = save.eggHatchSession || 0;
    const fresh = { anchor: { ...fix }, last: { ...fix }, session };
    const unchanged = { tracker: fresh, added: 0, changed: false };
    if (!tracker || tracker.session !== session) return unchanged;
    const dt = fix.timestamp - tracker.last.timestamp;
    if (dt <= 0) return { tracker, added: 0, changed: false };
    const mps = gpsLegMps(tracker.last, fix);
    if (mps == null || mps > MAX_SPEED) return unchanged;
    const meters = gpsDistanceM(tracker.anchor, fix);
    const threshold = Math.max(5, Math.max(tracker.anchor.accuracy, fix.accuracy) / 2);
    if (meters < threshold) return { tracker: { ...tracker, last: { ...fix } }, added: 0, changed: false };
    const before = progress(save);
    save.eggHatchM = Math.min(METERS, before + meters);
    return { tracker: fresh, added: save.eggHatchM - before, changed: true };
  }

  // Choose once and check room before touching the egg or its progress. A full
  // pet stack leaves a ready egg intact so the player can free space and retry.
  function hatch(save, rng = Math.random) {
    if (!Inventory.count(save, 'egg')) return { ok: false, reason: 'no_egg' };
    if (!ready(save)) return { ok: false, reason: 'not_ready' };
    const pets = Shops.petItems().filter(id => ITEM_BY_ID[id]);
    if (!pets.length) return { ok: false, reason: 'no_pets' };
    const petId = pets[Math.min(pets.length - 1, Math.max(0, Math.floor(rng() * pets.length)))];
    if (Inventory.roomFor(save, petId) < 1) return { ok: false, reason: 'full', petId };
    Inventory.add(save, petId, 1);
    Inventory.remove(save, 'egg', 1);
    save.eggHatchM = 0;
    // Reset the GPS anchor even when another egg remains in the stack.
    save.eggHatchSession = (Number(save.eggHatchSession) || 0) + 1;
    return { ok: true, petId };
  }

  root.EggHatch = { METERS, remaining, ready, track, hatch };
})(typeof globalThis !== 'undefined' ? globalThis : this);
