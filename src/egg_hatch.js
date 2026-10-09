// A carried egg incubates on real GPS walks. Progress survives reloads, but
// GPS anchors do not: loading/resuming must never credit an unseen journey.
(function (root) {
  'use strict';
  const METERS = EGG_HATCH_METERS;
  // A walked leg is util.js's GPS SPEED lane — the same reliable-fix rule and
  // the same walking ceiling (GPS_MAX_WALK_MPS) the passenger gate reads.
  const MAX_SPEED = GPS_MAX_WALK_MPS;

  function progress(save, id = 'egg') {
    return Number.isFinite(save[EGG_HATCH_SPEC[id].progress]) ? Math.max(0, Math.min(METERS, save[EGG_HATCH_SPEC[id].progress])) : 0;
  }
  function remaining(save, id = 'egg') { return Math.ceil(METERS - progress(save, id)); }
  function ready(save, id = 'egg') { return !!EGG_HATCH_SPEC[id] && Inventory.count(save, id) > 0 && remaining(save, id) === 0; }


  // fix uses raw WGS84 coordinates, never playerM/control-stick movement.
  // The anchor waits through small fixes so ordinary slow walks still count.
  // Invalid fixes break continuity; the next reliable fix starts a new leg.
  function track(save, tracker, fix, now = Date.now(), id = 'egg') {
    const none = { tracker: null, added: 0, changed: false };
    if (!Inventory.count(save, id) || ready(save, id)) return none;
    if (!gpsFixReliable(fix, now)) return none;
    const session = save[EGG_HATCH_SPEC[id].session] || 0;
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
    const before = progress(save, id);
    save[EGG_HATCH_SPEC[id].progress] = Math.min(METERS, before + meters);
    return { tracker: fresh, added: save[EGG_HATCH_SPEC[id].progress] - before, changed: true };
  }

  // Hatching reveals a wild baby; favourite food and catching are still required.
  function hatch(save, rng = Math.random, location = { x: 0, y: 0, tx: 0, ty: 0 }, id = 'egg') {
    if (!Inventory.count(save, id)) return { ok: false, reason: 'no_egg' };
    if (!ready(save, id)) return { ok: false, reason: 'not_ready' };
    const pets = (EGG_HATCH_SPEC[id].babies || babyItems()).filter(id => ITEM_BY_ID[id]);
    if (!pets.length) return { ok: false, reason: 'no_pets' };
    const petId = pets[Math.min(pets.length - 1, Math.max(0, Math.floor(rng() * pets.length)))];
    const kind = ITEM_BY_ID[petId].base;
    const creature = { ...location, kind, id: `hatch_${Date.now()}_${Math.floor(Math.random() * 1e9)}`,
      pet: false, raised: true, born: Date.now(), favouriteFeeds: 0, shiny: EGG_HATCH_SPEC[id].shiny };
    (save.wildAnimals ||= []).push(creature);
    Inventory.remove(save, id, 1);
    save[EGG_HATCH_SPEC[id].progress] = 0;
    // Reset the GPS anchor even when another egg remains in the stack.
    save[EGG_HATCH_SPEC[id].session] = (Number(save[EGG_HATCH_SPEC[id].session]) || 0) + 1;
    return { ok: true, petId, creature };
  }

  function trackAll(save, trackers, fix, now = Date.now()) {
    const next = {}, result = { tracker: null, changed: false };
    for (const id of Object.keys(EGG_HATCH_SPEC)) {
      const step = track(save, trackers?.[id], fix, now, id);
      if (step.tracker) next[id] = step.tracker;
      result.changed ||= step.changed;
    }
    if (Object.keys(next).length) result.tracker = next;
    return result;
  }

  const isEgg = id => !!EGG_HATCH_SPEC[id];
  root.EggHatch = { METERS, isEgg, remaining, ready, track, trackAll, hatch };
})(typeof globalThis !== 'undefined' ? globalThis : this);
