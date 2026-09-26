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

  // ── The RUNNER's ladder ──────────────────────────────────────────────────
  // The wizard's Runner calling (src/wizard.js CLASSES, save.playerClass)
  // pays road treasure twice as often: every goal is divided by
  // RUNNER_GOAL_DIV — 100, 200, 300 … instead of 200, 400, 600 … . It is the
  // GOAL that moves, never the metres banked, so a runner's counter, payout
  // and ceremony line all read the same halved rung.
  //
  // EVERY function below that derives a goal takes the same optional trailing
  // `playerClass` and resolves it through goalDiv — pass it to all of them or
  // to none, or the counter and the payout disagree about which rung paid.
  // The prize count (and so rollBonusFor) is unchanged: a runner reaches each
  // rung sooner, not a better rung.
  const RUNNER_GOAL_DIV = 2;
  function goalDiv(playerClass) {
    return playerClass === 'runner' ? RUNNER_GOAL_DIV : 1;
  }

  // Metres the NEXT prize wants, given how many are already won. (The nth
  // prize, 1-based, wants GOAL_STEP_M × n — over goalDiv for a runner.)
  function goalFor(prizes, playerClass) {
    return GOAL_STEP_M * (Math.max(0, prizes | 0) + 1) / goalDiv(playerClass);
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

  // Every metre of road restored so far: the goals already paid, plus what is
  // banked toward the next. (save.trail keeps only the remainder and the prize
  // count; the ladder is arithmetic, so the total is re-derived, never stored.)
  function totalMetres(metres, prizes, playerClass) {
    let sum = Math.max(0, Number.isFinite(metres) ? metres : 0);
    for (let k = 0; k < Math.max(0, prizes | 0); k++) sum += goalFor(k, playerClass);
    return sum;
  }
  // A distance at a glance: kilometres to TWO significant figures (0.72km,
  // 1.5km, 26km, 130km) — the road chip's number and the tap hint both print
  // the running total through this one formatter. FLOORED, never rounded up
  // past what is done; under 10 m that reads 0km (resolution 0.01 km).
  function distanceLabel(m) {
    const km = Math.max(0, m || 0) / 1000;
    if (km < 1) return `${(Math.floor(km * 100 + 1e-9) / 100).toFixed(km < 0.01 ? 0 : 2)}km`;
    if (km < 10) return `${(Math.floor(km * 10 + 1e-9) / 10).toFixed(1)}km`;
    const step = Math.pow(10, Math.floor(Math.log10(km)) - 1);
    return `${Math.round(Math.floor(km / step + 1e-9) * step)}km`;
  }

  // Metres banked toward the current goal — the "N/M m" the player sees.
  function progress(metres, prizes, playerClass) {
    const pos = Math.max(0, Number.isFinite(metres) ? metres : 0);
    const target = goalFor(prizes, playerClass);
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
  function readout(out, playerClass) {
    if (out && (out.owed | 0) > 0) {
      const goal = goalFor((out.prizes | 0) - 1, playerClass);
      return { pos: goal, target: goal, label: label(goal, goal) };
    }
    return progress(out ? out.metres : 0, out ? out.prizes : 0, playerClass);
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
  function bank(metres, prizes, addM, playerClass) {
    const base = Math.max(0, Number.isFinite(metres) ? metres : 0);
    const add = Math.max(0, Number.isFinite(addM) ? addM : 0);
    let s = base + add;
    let p = Math.max(0, prizes | 0);
    let owed = 0;
    for (let guard = 0; guard < 1000; guard++) {
      const goal = goalFor(p, playerClass);
      if (s < goal) break;
      s -= goal; p += 1; owed += 1;
    }
    return { metres: s, prizes: p, owed };
  }

  // ── Which pool the prize comes out of ────────────────────────────────────
  // Its OWN context (rarity.js › 'treasure:road'), not the lowtier chest curve
  // the ladder used to borrow: what the survivors hand over for a rebuilt
  // street is SEEDS, with coins and produce as the other faces of the pick.
  // The key lives here rather than in app.js so trail.test.js pins the pool
  // the shipping ceremony actually rolls.
  const PRIZE_CONTEXT = 'treasure:road';

  // ── The FIRST prize is an ONION SEED ─────────────────────────────────────
  // Prize #1 is not rolled. The road ladder pays in seeds, and the first rung
  // says so out loud instead of sampling a pool that might hand a new player
  // coins and leave them none the wiser about what the road is for — the same
  // reason the starter chests carry a fixed payload. Every rung after it rolls
  // PRIZE_CONTEXT normally.
  //
  // The shape is exactly what pickReward returns, so the ceremony, the card
  // and the payout all take it without a special case.
  const FIRST_PRIZE_ID = 'onion_seed';
  const FIRST_PRIZE_QTY = 3;
  function firstPrize(n) {
    if ((n | 0) !== 1) return null;
    return { kind: 'item', id: FIRST_PRIZE_ID, qty: FIRST_PRIZE_QTY,
             tier: 2, cls: 'seed', jackpot: 0, consolation: 0 };
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
  // Three, not two: with two the pick was usually "the seed or the coins".
  // A third card makes it a real comparison while the row still fits across
  // the ceremony (app.js lays the cards three across and keeps each one's
  // description behind an ⓘ so the row stays one line of pictures).
  const PRIZE_CHOICES = 3;
  // Rolls to spend looking for a distinct option before settling for fewer.
  // The road curve is seed-heavy and pays coins a fifth of the time, so rolls
  // land on the same card often enough that a few retries per option is the
  // difference between an offer and a formality; past that it's just burning
  // entropy. Three tries per card offered.
  const PRIZE_ROLL_TRIES = 3 * PRIZE_CHOICES;

  // ── The prize gets BETTER as the walks get longer ────────────────────────
  // Extra boost-chain steps the roll gets over a plain chest of the same tier
  // (app.js hands it to pickReward as opts.rollBonus): one to begin with, and
  // one more for every prize already won, so the tenth prize — two kilometres
  // of restored street — is visibly a better find than the first.
  //
  // BETTER, NOT BIGGER. A bonus step buys TIER only (see the bonus loop in
  // rarity.js pickReward). As an ordinary chain step it fell through to a
  // quantity bracket whenever the tier had nowhere left to climb — which, on
  // the curve the trail rolls at its own chainMax, was nearly every prize: the
  // ceremony handed over "× 2" so reliably that the quantity read as fixed.
  // The walk is meant to change WHAT you find: a finer seed, not a taller
  // stack of the same one.
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
    GOAL_STEP_M, RUNNER_GOAL_DIV, goalDiv, goalFor, totalMetres, distanceLabel, progress, bank, readout, label,
    PRIZE_CONTEXT, FIRST_PRIZE_ID, FIRST_PRIZE_QTY, firstPrize,
    PRIZE_CHOICES, PRIZE_ROLL_TRIES, rewardKey, rollChoices,
    PRIZE_ROLL_BONUS, PRIZE_ROLL_BONUS_MAX, rollBonusFor,
  };
})(typeof window !== 'undefined' ? window : globalThis);
