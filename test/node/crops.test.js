// Headless tests for the crops core (src/crops.js) — growth-stage timing,
// watering, and the crow pest rule extracted from app.js.

const HOLD = () => Crops.STAGE_HOLD_MS;

test('crowEats: crows ignore potatoes, eat everything else', () => {
  assert.eq(Crops.crowEats({ crop: 'potato' }), false, 'potato is immune');
  assert.eq(Crops.crowEats({ crop: 'berry' }), true, 'berry is fair game');
  assert.eq(Crops.crowEats({ crop: 'cress' }), true);
});

test('isMature: at or past MAX_GROWTH_STAGE', () => {
  const max = Crops.maxStage();
  assert.eq(Crops.isMature({ stage: max }), true);
  assert.eq(Crops.isMature({ stage: max - 1 }), false);
  assert.eq(Crops.isMature({}), false, 'undefined stage = 0');
});

test('advanceGrowth: a watered crop past its hold advances ONE stage and needs re-water', () => {
  const t0 = 1_000_000;
  const save = { planted: [{ x: 0, y: 0, crop: 'berry', stage: 0, watered_t: t0 }] };
  const changed = Crops.advanceGrowth(save, t0 + HOLD());
  assert.eq(changed, true, 'something advanced');
  assert.eq(save.planted[0].stage, 1, 'advanced exactly one stage');
  assert.eq(save.planted[0].watered_t, 0, 'reset so it needs re-watering');
});

test('advanceGrowth: only advances once even after many holds elapse', () => {
  const t0 = 1_000_000;
  const save = { planted: [{ x: 0, y: 0, crop: 'berry', stage: 0, watered_t: t0 }] };
  Crops.advanceGrowth(save, t0 + HOLD() * 5);     // 5 holds late
  assert.eq(save.planted[0].stage, 1, 'still just one stage — catches up over re-waterings');
});

test('advanceGrowth: unwatered / not-yet-held / mature crops are left alone', () => {
  const t0 = 1_000_000;
  const save = { planted: [
    { x: 0, y: 0, crop: 'berry', stage: 0, watered_t: 0 },             // unwatered
    { x: 1, y: 0, crop: 'berry', stage: 0, watered_t: t0 },            // watered but too soon
    { x: 2, y: 0, crop: 'berry', stage: Crops.maxStage(), watered_t: t0 }, // already mature
  ] };
  const changed = Crops.advanceGrowth(save, t0 + HOLD() - 1);          // just before the hold
  assert.eq(changed, false, 'nothing advanced');
  assert.eq(save.planted[0].stage, 0);
  assert.eq(save.planted[1].stage, 0);
  assert.eq(save.planted[2].stage, Crops.maxStage());
});

test('waterWithin: waters un-watered, in-range, immature crops and counts them', () => {
  const now = 5_000_000;
  const save = { planted: [
    { x: 0,  y: 0, crop: 'berry', stage: 0, watered_t: 0 },   // in range, dry → water
    { x: 3,  y: 4, crop: 'berry', stage: 0, watered_t: 0 },   // exactly 5m away → in range
    { x: 50, y: 0, crop: 'berry', stage: 0, watered_t: 0 },   // far → skip
    { x: 1,  y: 0, crop: 'berry', stage: 0, watered_t: 999 }, // already watered → skip
    { x: 1,  y: 1, crop: 'berry', stage: Crops.maxStage(), watered_t: 0 }, // mature → skip
  ] };
  const { n } = Crops.waterWithin(save, 0, 0, 5, now);
  assert.eq(n, 2, 'two crops watered');
  assert.eq(save.planted[0].watered_t, now, 'nearest watered at now');
  assert.eq(save.planted[1].watered_t, now, '5m-away crop watered');
  assert.eq(save.planted[2].watered_t, 0, 'far crop untouched');
  assert.eq(save.planted[3].watered_t, 999, 'already-watered untouched');
  assert.eq(save.planted[4].watered_t, 0, 'mature untouched');
});

test('water → hold → advance is a coherent cycle', () => {
  const save = { planted: [{ x: 0, y: 0, crop: 'cress', stage: 0, watered_t: 0 }] };
  const t = 9_000_000;
  assert.eq(Crops.waterWithin(save, 0, 0, 2, t).n, 1, 'watered');
  assert.eq(Crops.advanceGrowth(save, t + HOLD() - 1), false, 'not yet');
  assert.eq(Crops.advanceGrowth(save, t + HOLD()), true, 'now it grows');
  assert.eq(save.planted[0].stage, 1);
});

// ── The watering can buys TIME ─────────────────────────────────────────────
// A can's tier is the chance a watering also jumps the plant a stage there and
// then. Before this, no relic touched growth at all: a Frost can watered
// exactly as fast as bare hands and only improved the produce that came out,
// so the one thing a crop actually costs — four waterings and four holds —
// was the same at the top of the ladder as at the bottom.

const canOf = (tier) => (tier ? { can: { tier } } : {});
const alwaysJump = () => 0;      // rng below every chance → always jumps
const neverJump = () => 0.999;   // rng at the top → only a 100% chance fires

test('watering can: no can never jumps a stage', () => {
  assert.eq(Crops.waterJumpChance({}), 0, 'bare hands');
  assert.eq(Crops.waterJumpChance(canOf(0)), 0, 'a tierless can');
  const p = { x: 0, y: 0, crop: 'berry', stage: 0, watered_t: 0 };
  assert.eq(Crops.waterOne({}, p, {}, 1000, alwaysJump), 'watered', 'watered, not jumped');
  assert.eq(p.stage, 0, 'still stage 0');
});

test('watering can: Frost always jumps a stage', () => {
  assert.eq(Crops.waterJumpChance(canOf(Crops.CAN_TOP_TIER)), 1, 'certain at the top');
  const p = { x: 0, y: 0, crop: 'berry', stage: 1, watered_t: 0 };
  assert.eq(Crops.waterOne({}, p, canOf(Crops.CAN_TOP_TIER), 1000, neverJump), 'jumped',
    'even the unluckiest roll jumps at 100%');
  assert.eq(p.stage, 2, 'a stage further on');
});

test('watering can: the chance scales straight up the ladder', () => {
  let prev = -1;
  for (let t = 0; t <= Crops.CAN_TOP_TIER; t++) {
    const c = Crops.waterJumpChance(canOf(t));
    assert.gt(c, prev, `tier ${t} beats tier ${t - 1}`);
    assert.inRange(c, 0, 1, `tier ${t} is a probability`);
    prev = c;
  }
  assert.eq(Crops.waterJumpChance(canOf(1)), 1 / Crops.CAN_TOP_TIER, 'Wood is one seventh');
  assert.eq(Crops.waterJumpChance(canOf(4)), 4 / Crops.CAN_TOP_TIER, 'Gold is four sevenths');
});

test('watering can: a tier past Frost is still a certainty, not more', () => {
  assert.eq(Crops.waterJumpChance(canOf(99)), 1, 'clamped');
});

test('watering can: a jump does NOT consume the watering', () => {
  // That is what makes a Frost can a DOUBLING rather than a shortcut: the
  // plant is watered and a stage on, so its normal advance is still coming.
  const p = { x: 0, y: 0, crop: 'berry', stage: 0, watered_t: 0 };
  Crops.waterOne({}, p, canOf(Crops.CAN_TOP_TIER), 1000, alwaysJump);
  assert.eq(p.stage, 1, 'jumped one');
  assert.eq(p.watered_t, 1000, 'and is still watered');
  const save = { planted: [p] };
  assert.truthy(Crops.advanceGrowth(save, 1000 + Crops.STAGE_HOLD_MS), 'the hold still pays out');
  assert.eq(p.stage, 2, 'two stages from one watering');
});

test('watering can: jumping to ripe clears the watering', () => {
  // A mature plant is never watered, so it must not be left holding one it can
  // no longer spend.
  const p = { x: 0, y: 0, crop: 'berry', stage: Crops.maxStage() - 1, watered_t: 0 };
  Crops.waterOne({}, p, canOf(Crops.CAN_TOP_TIER), 1000, alwaysJump);
  assert.truthy(Crops.isMature(p), 'ripe');
  assert.eq(p.watered_t, 0, 'and not holding a watering');
});

test('watering can: a mature or already-watered plant is not a candidate', () => {
  const ripe = { x: 0, y: 0, crop: 'berry', stage: Crops.maxStage(), watered_t: 0 };
  assert.eq(Crops.waterOne({}, ripe, canOf(7), 1000, alwaysJump), null, 'ripe');
  const wet = { x: 0, y: 0, crop: 'berry', stage: 0, watered_t: 5 };
  assert.eq(Crops.waterOne({}, wet, canOf(7), 1000, alwaysJump), null, 'already watered');
  assert.eq(wet.stage, 0, 'and it did not sneak a jump');
});

test('watering can: an area water reports what it pushed along', () => {
  const save = { planted: [
    { x: 0, y: 0, crop: 'berry', stage: 0, watered_t: 0 },
    { x: 1, y: 0, crop: 'berry', stage: 0, watered_t: 0 },
  ] };
  const dry = Crops.waterWithin(save, 0, 0, 5, 1000, {}, alwaysJump);
  assert.eq(dry.n, 2, 'both watered');
  assert.eq(dry.jumped, 0, 'no can, nothing jumped');
  for (const p of save.planted) { p.watered_t = 0; p.stage = 0; }
  const wet = Crops.waterWithin(save, 0, 0, 5, 1000, canOf(Crops.CAN_TOP_TIER), alwaysJump);
  assert.eq(wet.jumped, 2, 'a Frost can pushed both');
});
