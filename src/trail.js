// ─────────────────────────────────────────────────────────────────────────
// Trail — the arithmetic behind COBBLE TRAILS (paths and roads alike).
//
// A trail is one named run of cobble cells inside one tile (worldgen's
// entry.pathNames). Walking it lights the stones under the player's reach and
// counts them; every SEGMENT_CELLS stones pays one treasure.
//
// WHY A SEGMENT AT ALL: the reward used to require EVERY cell of the named
// component, which was fine for a 12-cell footpath and impossible for a road —
// a street can carry hundreds of cells across one tile, so "walk all of it or
// get nothing" would have made roads pay nothing at all. So the requirement is
// capped at SEGMENT_CELLS and restarts: a trail of N cells offers
// ceil(N / SEGMENT_CELLS) prizes, and the LAST segment is the short remainder
// (a 45-cell street pays at 20, at 40, and again when its final 5 are lit).
//
// The counter the player sees is the position INSIDE the current segment
// (`progress`), so a 9-cell trail reads 1/9 … 9/9 and a 45-cell street reads
// 1/20 … 20/20 then 1/20 … 20/20 then 1/5 … 5/5.
//
// Pure arithmetic on purpose: app.js can't load headlessly (it needs Phaser),
// so keeping the rule here is what lets test/node/trail.test.js pin the real
// shipping numbers instead of a copy of them.
// ─────────────────────────────────────────────────────────────────────────
(function (root) {
  'use strict';

  // Stones per prize. Also the cap on a segment's requirement.
  const SEGMENT_CELLS = 20;
  // A trail shorter than this pays nothing and shows no counter. Every cobble
  // cell is named now (worldgen's wavefront), so without a floor a 2-cell
  // service-road stub would pop the full treasure ceremony.
  const MIN_TRAIL_CELLS = 8;

  // Which segment the `claimed`-th stone belongs to (0-based). Stone 20 is the
  // last of segment 0, stone 21 the first of segment 1 — hence the -1.
  function segmentIndex(claimed) {
    if (!(claimed > 0)) return 0;
    return Math.floor((claimed - 1) / SEGMENT_CELLS);
  }

  // How many stones the segment containing `claimed` needs. Full segments want
  // SEGMENT_CELLS; the trail's last one wants whatever remainder is left.
  function segmentTarget(total, claimed) {
    const start = segmentIndex(claimed) * SEGMENT_CELLS;
    return Math.max(1, Math.min(SEGMENT_CELLS, total - start));
  }

  // The "N/M" the player sees: position within the current segment.
  function progress(total, claimed) {
    const segment = segmentIndex(claimed);
    return {
      segment,
      pos: claimed - segment * SEGMENT_CELLS,
      target: segmentTarget(total, claimed),
    };
  }

  // Prizes a trail can ever pay: one per segment, remainder included.
  function maxPrizes(total) {
    return total > 0 ? Math.ceil(total / SEGMENT_CELLS) : 0;
  }

  // Prizes owed once `claimed` stones are lit. One per completed full segment,
  // plus one when the trail is finished on a short remainder segment.
  function prizesEarned(total, claimed) {
    if (!(total > 0) || !(claimed > 0)) return 0;
    const c = Math.min(claimed, total);
    let n = Math.floor(c / SEGMENT_CELLS);
    if (c >= total && total % SEGMENT_CELLS !== 0) n += 1;
    return Math.min(n, maxPrizes(total));
  }

  // Long enough to be worth walking?
  function qualifies(total) { return total >= MIN_TRAIL_CELLS; }

  // ── The prize is a CHOICE ────────────────────────────────────────────────
  // A segment pays PRIZE_CHOICES rolls and the player keeps ONE. Walking is
  // the one reward loop with no decision in it — a chest is what it is, a shop
  // is a price you accept or don't — so the trail is where a pick costs
  // nothing and makes the walk yours.
  //
  // The offer has to be a real choice, which means the options must DIFFER.
  // Two piles of gold, or the same item twice, is a decision with one answer,
  // so rollChoices keeps rolling for a distinct option and gives up rather
  // than presenting a fake one: it returns 1..PRIZE_CHOICES rewards and the
  // caller shows the plain single-reward ceremony when it gets one. Distinct
  // means "reads differently to the player" (rewardKey) — the same item at a
  // different quantity is still the same card, and gold is gold.
  const PRIZE_CHOICES = 2;
  // Rolls to spend looking for a distinct option before settling for fewer.
  // The lowtier curve is gold-heavy, so a couple of retries is the difference
  // between an offer and a formality; past that it's just burning entropy.
  const PRIZE_ROLL_TRIES = 6;

  // What makes two rewards the same OFFER. Null for a reward with no shape we
  // recognise — an unkeyable roll is never treated as a duplicate, because
  // silently folding it into another would drop a prize the player earned.
  function rewardKey(r) {
    if (!r || !r.kind) return null;
    if (r.kind === 'item')  return r.id ? `item:${r.id}` : null;
    if (r.kind === 'gold')  return 'gold';
    if (r.kind === 'relic' || r.kind === 'armor') return `${r.kind}:${r.slot}:${r.tier}`;
    return null;
  }

  // Roll up to `count` rewards the player can choose between. `roll` is the
  // caller's picker (app.js hands it pickReward, the tests a stub); it may
  // return null, which ends the search — a picker with nothing to give won't
  // start having something on the next call.
  function rollChoices(roll, count = PRIZE_CHOICES, tries = PRIZE_ROLL_TRIES) {
    if (typeof roll !== 'function') return [];
    const out = [], keys = new Set();
    for (let i = 0; i < tries && out.length < count; i++) {
      const r = roll();
      if (!r) break;
      const k = rewardKey(r);
      if (k !== null && keys.has(k)) continue;   // same card — roll again
      if (k !== null) keys.add(k);
      out.push(r);
    }
    return out;
  }

  root.Trail = {
    SEGMENT_CELLS, MIN_TRAIL_CELLS,
    segmentIndex, segmentTarget, progress, maxPrizes, prizesEarned, qualifies,
    PRIZE_CHOICES, PRIZE_ROLL_TRIES, rewardKey, rollChoices,
  };
})(typeof window !== 'undefined' ? window : globalThis);
