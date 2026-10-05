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

  // Hatching reveals a wild baby; favourite food and catching are still required.
  function hatch(save, rng = Math.random, location = { x: 0, y: 0, tx: 0, ty: 0 }) {
    if (!Inventory.count(save, 'egg')) return { ok: false, reason: 'no_egg' };
    if (!ready(save)) return { ok: false, reason: 'not_ready' };
    const pets = babyItems().filter(id => ITEM_BY_ID[id]);
    if (!pets.length) return { ok: false, reason: 'no_pets' };
    const petId = pets[Math.min(pets.length - 1, Math.max(0, Math.floor(rng() * pets.length)))];
    const kind = ITEM_BY_ID[petId].base;
    const creature = { ...location, kind, id: `hatch_${Date.now()}_${Math.floor(Math.random() * 1e9)}`,
      pet: false, raised: true, born: Date.now(), favouriteFeeds: 0, shiny: true };
    (save.wildAnimals ||= []).push(creature);
    Inventory.remove(save, 'egg', 1);
    save.eggHatchM = 0;
    // Reset the GPS anchor even when another egg remains in the stack.
    save.eggHatchSession = (Number(save.eggHatchSession) || 0) + 1;
    return { ok: true, petId, creature };
  }

  root.EggHatch = { METERS, remaining, ready, track, hatch };
})(typeof globalThis !== 'undefined' ? globalThis : this);
