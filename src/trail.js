// ─────────────────────────────────────────────────────────────────────────
// Trail — the arithmetic behind COBBLE TRAILS (paths and roads alike).
//
// A STONE is a cobble that actually draws a pebble (render.js thins them to
// one per Render.COBBLE_SPACING_M, so the stones you see and the stones that
// count are the same stones). Walking lights every stone inside the player's
// reach and adds it to ONE running total — every path, every street, every
// tile, one number. Reach the goal and a treasure lands; the next goal is
// GOAL_STEP longer and rolls a step better.
//
// ONE LADDER, NOT ONE PER PATH. Prizes used to be per named way per tile:
// each street and footpath carried its own counter, its own segment length,
// its own short-remainder rule, its own "too short to pay anything" floor and
// its own row in the save — and worldgen ran a whole wavefront pass to decide
// which stone belonged to which way. The same walk therefore paid differently
// depending on how OSM happened to split the ways under it, and the counter
// ("7/29") answered a question nobody had asked: how far along THIS way am I.
// None of it survives. A stone is a stone, wherever you pick it up.
//
// Pure arithmetic on purpose: app.js can't load headlessly (it needs Phaser),
// so keeping the rule here is what lets test/node/trail.test.js pin the real
// shipping numbers instead of a copy of them.
// ─────────────────────────────────────────────────────────────────────────
(function (root) {
  'use strict';

  // The ladder. The first prize wants GOAL_STEP stones, the second GOAL_STEP
  // more than that, and so on: 10, 20, 30, … Stones are ~20 m apart
  // (Render.COBBLE_SPACING_M), so the first prize is a couple of hundred
  // metres of walking and the tenth is a proper expedition.
  const GOAL_STEP = 10;

  // Stones the NEXT prize wants, given how many are already won. (The nth
  // prize, 1-based, wants GOAL_STEP × n.)
  function goalFor(prizes) {
    return GOAL_STEP * (Math.max(0, prizes | 0) + 1);
  }

  // The "N/M" the player sees: stones banked toward the current goal.
  function progress(stones, prizes) {
    return { pos: Math.max(0, stones | 0), target: goalFor(prizes) };
  }

  // Bank `lit` newly lit stones. Returns the new running total, the new prize
  // count and how many prizes that crossing owes.
  //
  // A LOOP, not an `if`: a wide reach can sweep up more stones in one step
  // than a goal is long, and each goal crossed makes the next one longer, so
  // the remainder has to be re-tested against the NEW goal. (The goals grow,
  // so it always terminates; the guard is belt and braces.)
  function bank(stones, prizes, lit) {
    let s = Math.max(0, stones | 0) + Math.max(0, lit | 0);
    let p = Math.max(0, prizes | 0);
    let owed = 0;
    for (let guard = 0; guard < 1000; guard++) {
      const goal = goalFor(p);
      if (s < goal) break;
      s -= goal; p += 1; owed += 1;
    }
    return { stones: s, prizes: p, owed };
  }

  // ── The prize is a CHOICE ────────────────────────────────────────────────
  // A prize pays PRIZE_CHOICES rolls and the player keeps ONE. Walking is the
  // one reward loop with no decision in it — a chest is what it is, a shop is
  // a price you accept or don't — so the trail is where a pick costs nothing
  // and makes the walk yours.
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

  // ── The prize gets BETTER as the walks get longer ────────────────────────
  // Extra boost-chain steps the roll gets over a plain chest of the same tier
  // (app.js hands it to pickReward as opts.rollBonus): one to begin with, and
  // one more for every prize already won, so the tenth prize — a hundred
  // stones of walking — is visibly a better find than the first.
  //
  // Capped, because a chain step stops buying tiers once the context's own
  // ceiling is reached and turns into consolation coins after that; past
  // PRIZE_ROLL_BONUS_MAX the ladder would be paying in small change and
  // pretending it was an upgrade.
  const PRIZE_ROLL_BONUS = 1;
  const PRIZE_ROLL_BONUS_MAX = 6;

  function rollBonusFor(prizes) {
    return Math.min(PRIZE_ROLL_BONUS + Math.max(0, prizes | 0), PRIZE_ROLL_BONUS_MAX);
  }

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
    GOAL_STEP, goalFor, progress, bank,
    PRIZE_CHOICES, PRIZE_ROLL_TRIES, rewardKey, rollChoices,
    PRIZE_ROLL_BONUS, PRIZE_ROLL_BONUS_MAX, rollBonusFor,
  };
})(typeof window !== 'undefined' ? window : globalThis);
