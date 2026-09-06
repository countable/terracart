// ─────────────────────────────────────────────────────────────────────────
// Trail — the arithmetic behind the STREET RESTORATION ladder.
//
// The world is walked in METRES. A stretch of street or footpath that has sat
// inside the player's lit reach for the dwell turns from dilapidated to clean
// cobble (src/streets.js owns which metres those are), and every metre newly
// restored — anywhere in the world, on any way, in any tile — adds to ONE
// running total. Reach the goal and a treasure lands; the next goal is
// GOAL_STEP_M longer and rolls a step better.
//
// ONE LADDER, NOT ONE PER STREET. Prizes used to be per named way per tile:
// each street and footpath carried its own counter, its own segment length,
// its own short-remainder rule, its own "too short to pay anything" floor and
// its own row in the save — and worldgen ran a whole wavefront pass to decide
// which ground belonged to which way. The same walk therefore paid differently
// depending on how OSM happened to split the ways under it, and the counter
// ("7/29") answered a question nobody had asked: how far along THIS way am I.
// None of it survives. A metre is a metre, wherever it is restored.
//
// METRES, NOT COUNTS. The ladder counted lit pebbles until Sep 2026 — one
// sprite per 20 m of way, thinned by the renderer — so what a walk paid
// depended on where the thinning happened to drop a stone, and half a street
// restored between two of them paid nothing at all. Restoration is exact
// float arclength now, so the ladder is too: 200 m for the first prize is the
// same walk ten stones used to be, measured instead of counted.
//
// Pure arithmetic on purpose: app.js can't load headlessly (it needs Phaser),
// so keeping the rule here is what lets test/node/trail.test.js pin the real
// shipping numbers instead of a copy of them.
// ─────────────────────────────────────────────────────────────────────────
(function (root) {
  'use strict';

  // The ladder, in METRES of street restored. The first prize wants
  // GOAL_STEP_M, the second GOAL_STEP_M more than that, and so on: 200, 400,
  // 600, … The first prize is a couple of hundred metres of walking and the
  // tenth is a proper expedition.
  const GOAL_STEP_M = 200;

  // Metres the NEXT prize wants, given how many are already won. (The nth
  // prize, 1-based, wants GOAL_STEP_M × n.)
  function goalFor(prizes) {
    return GOAL_STEP_M * (Math.max(0, prizes | 0) + 1);
  }

  // ONE FORMATTER. The counter that pops on the street and the prize
  // ceremony's sub-line both print the same walk, so they both print it from
  // here — a second `${x}/${y} m` anywhere else is how the two came to
  // disagree about which rung had just been paid.
  //
  // Rounded, because the position is a float: restoration is exact arclength,
  // and "137.4183/200 m" is noise on a toast read at a glance.
  function label(pos, target) {
    return `${Math.round(pos)}/${target} m`;
  }

  // Metres banked toward the current goal — the "N/M m" the player sees.
  function progress(metres, prizes) {
    const pos = Math.max(0, Number.isFinite(metres) ? metres : 0);
    const target = goalFor(prizes);
    return { pos, target, label: label(pos, target) };
  }

  // The readout for the sweep that produced `out` (a bank() result). Normally
  // the running progress toward the NEXT goal — but on a sweep that PAYS, the
  // counter reads the goal just completed, full ("200/200 m"), not the carried
  // remainder against the goal after it ("60/400 m"). The ladder grows by
  // GOAL_STEP_M each rung, so at the very moment the prize ceremony opened the
  // counter used to say "out of 400" while the walk had paid at 200, and the
  // two read as a disagreement (Sep 2026). The remainder is still banked and
  // shows on the next sweep; only the readout of the paying sweep changes.
  function readout(out) {
    if (out && (out.owed | 0) > 0) {
      const goal = goalFor((out.prizes | 0) - 1);
      return { pos: goal, target: goal, label: label(goal, goal) };
    }
    return progress(out ? out.metres : 0, out ? out.prizes : 0);
  }

  // Bank `addM` newly restored metres. Returns the new running total, the new
  // prize count and how many prizes that crossing owes.
  //
  // FLOATS, not counts: a sweep restores whatever arclength was in reach, so
  // the total carries fractions and the remainder that carries into the next
  // goal is a fraction too.
  //
  // A LOOP, not an `if`: a wide reach can restore more street in one step than
  // a goal is long, and each goal crossed makes the next one longer, so the
  // remainder has to be re-tested against the NEW goal. (The goals grow, so it
  // always terminates; the guard is belt and braces.)
  function bank(metres, prizes, addM) {
    const base = Math.max(0, Number.isFinite(metres) ? metres : 0);
    const add = Math.max(0, Number.isFinite(addM) ? addM : 0);
    let s = base + add;
    let p = Math.max(0, prizes | 0);
    let owed = 0;
    for (let guard = 0; guard < 1000; guard++) {
      const goal = goalFor(p);
      if (s < goal) break;
      s -= goal; p += 1; owed += 1;
    }
    return { metres: s, prizes: p, owed };
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
  // one more for every prize already won, so the tenth prize — two kilometres
  // of restored street — is visibly a better find than the first.
  //
  // BETTER, NOT BIGGER. A bonus step buys TIER only (see the bonus loop in
  // rarity.js pickReward). As an ordinary chain step it fell through to a
  // quantity bracket whenever the tier had nowhere left to climb — which, on
  // the T4 curve the trail already rolls at its own chainMax, was nearly every
  // prize: the ceremony handed over "× 2" so reliably that the quantity read
  // as fixed. The walk is meant to change WHAT you find.
  //
  // Capped, because a bonus step stops buying tiers once the context's own
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
    GOAL_STEP_M, goalFor, progress, bank, readout, label,
    PRIZE_CHOICES, PRIZE_ROLL_TRIES, rewardKey, rollChoices,
    PRIZE_ROLL_BONUS, PRIZE_ROLL_BONUS_MAX, rollBonusFor,
  };
})(typeof window !== 'undefined' ? window : globalThis);
