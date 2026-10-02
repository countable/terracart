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
  // Every metre of road TRULY restored — the road chip's number. The ladder
  // banks a SCENIC path's metres heavier (src/scenic.js SCENIC_MUL, through
  // app.js _bankStreetMetres), and keeps that extra apart in
  // save.trail.bonusM, so the total here is the ladder's less the bonus: a
  // kilometre walked by the water is one kilometre on the chip and more than
  // one toward the next prize. `trail` is save.trail.
  function restoredMetres(trail, playerClass) {
    const t = trail || {};
    const bonus = Math.max(0, Number.isFinite(t.bonusM) ? t.bonusM : 0);
    return Math.max(0, totalMetres(t.metres, t.prizes, playerClass) - bonus);
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

  // ── THE STICK PAYS 40% ───────────────────────────────────────────────────
  // Road metres earned off the GPS — the stick or keyboard carried the body
  // there, or there is no fix at all — bank at this share (a 60% penalty;
  // app.js _roadMetresMul). The ladder rewards walking, not steering.
  const STICK_METRES_MUL = 0.4;

  // ── Which pool the prize comes out of ────────────────────────────────────
  // Its OWN context (rarity.js › 'treasure:road'), not the lowtier chest curve
  // the ladder used to borrow: what the survivors hand over for a rebuilt
  // street includes seeds, walking supplies, fruit, boots and coins.
  // The key lives here rather than in app.js so trail.test.js pins the pool
  // the shipping ceremony actually rolls.
  const PRIZE_CONTEXT = 'treasure:road';

  // ── The FIRST prize is an ONION SEED ─────────────────────────────────────
  // Prize #1 always offers onion seeds to introduce planting. The remaining
  // cards come from the broader road pool, just like every later rung.
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
  // so rollCardRow keeps rolling for a distinct option and gives up rather
  // than presenting a fake one: it returns 1..PRIZE_CHOICES rewards and the
  // caller shows the plain single-reward ceremony when it gets one. Distinct
  // means "reads differently to the player" (rewardKey) — the same item at a
  // different quantity is still the same card, and gold is gold.
  // Three, not two: with two the pick was usually "the seed or the coins".
  // A third card makes it a real comparison while the row still fits across
  // the ceremony (app.js lays the cards three across and shows a card's
  // description only once it is selected, so the row stays one line of pictures).
  // ONE CARD PER GROUP (see rollCardRow): money, something to grow or carry,
  // and something to wear or drink.
  const PRIZE_CARDS = [['cash'], ['seed', 'supply'], ['boots', 'magic']];
  const PRIZE_CHOICES = PRIZE_CARDS.length;
  // Rolls to spend looking for a distinct option before settling for fewer.
  // Rolls can land on the same card, so a few retries per option is the
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
  // The walk is meant to change WHAT you find: finer gear or seeds, not a taller
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

  // ── ONE CARD PER GROUP ───────────────────────────────────────────────────
  // The three cards are three different KINDS of thing, never three rolls of
  // one bag (Sep 2026: boots came up so often, and so strong, that the pick
  // was always the boots): PRIZE_CARDS, above. Each card rolls pickReward on PRIZE_CONTEXT narrowed to
  // its group (opts.classes); the context's classBias still weighs the
  // classes inside a group, so it stays the one owner of those numbers.

  // BOOTS ARE EARNED BY DISTANCE: the road never offers boots above one tier
  // per kilometre walked to reach this rung (prize `n`, 1-based) — no boots
  // at all before the first kilometre, T1 from 1 km, T2 from 2 km … T7.
  const BOOTS_M_PER_TIER = 1000;
  function bootsTierCap(n, playerClass) {
    const walked = totalMetres(0, Math.max(0, n | 0), playerClass);
    return Math.max(0, Math.min(7, Math.floor(walked / BOOTS_M_PER_TIER + 1e-9)));
  }
  // The classes card `groupIdx` may roll for prize `n`: the boots drop out
  // while the cap is 0 or the player already wears boots at the cap (nothing
  // to offer but a cash-out, and the cash card is the next card over).
  function prizeCardClasses(groupIdx, n, playerClass, ownedBootsTier) {
    const group = PRIZE_CARDS[groupIdx] || [];
    const cap = bootsTierCap(n, playerClass);
    return group.filter(c => c !== 'boots' || cap > (ownedBootsTier | 0));
  }

  // Roll the row: one card per PRIZE_CARDS group, in order. `rollFor(idx)`
  // rolls card idx's group (null = nothing to give). A `preset` reward (the
  // first rung's onion seed) takes the card of the group naming its class.
  // A duplicate of an earlier card is re-rolled up to PRIZE_ROLL_TRIES / count
  // times, then dropped rather than shown twice.
  function rollCardRow(rollFor, preset = []) {
    const out = [], keys = new Set();
    // A preset's key is taken up front, so no earlier card can roll its twin.
    for (const r of preset || []) { const k = rewardKey(r); if (k !== null) keys.add(k); }
    const tries = Math.max(1, Math.floor(PRIZE_ROLL_TRIES / PRIZE_CARDS.length));
    for (let g = 0; g < PRIZE_CARDS.length; g++) {
      let card = (preset || []).find(r => r && PRIZE_CARDS[g].includes(r.cls)) || null;
      for (let i = 0; !card && i < tries; i++) {
        const r = typeof rollFor === 'function' ? rollFor(g) : null;
        if (!r) break;
        const k = rewardKey(r);
        if (k !== null && keys.has(k)) continue;
        card = r;
      }
      if (!card) continue;
      const k = rewardKey(card);
      // (a preset's key is already in `keys`; re-adding is a no-op)
      if (k !== null) keys.add(k);
      out.push(card);
    }
    return out;
  }

  root.Trail = {
    STICK_METRES_MUL, PRIZE_CARDS, BOOTS_M_PER_TIER, bootsTierCap, prizeCardClasses, rollCardRow,
    GOAL_STEP_M, RUNNER_GOAL_DIV, goalDiv, goalFor, totalMetres, restoredMetres, distanceLabel, progress, bank, readout, label,
    PRIZE_CONTEXT, FIRST_PRIZE_ID, FIRST_PRIZE_QTY, firstPrize,
    PRIZE_CHOICES, PRIZE_ROLL_TRIES, rewardKey,
    PRIZE_ROLL_BONUS, PRIZE_ROLL_BONUS_MAX, rollBonusFor,
  };
})(typeof window !== 'undefined' ? window : globalThis);
