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
  const n = Crops.waterWithin(save, 0, 0, 5, now);
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
  assert.eq(Crops.waterWithin(save, 0, 0, 2, t), 1, 'watered');
  assert.eq(Crops.advanceGrowth(save, t + HOLD() - 1), false, 'not yet');
  assert.eq(Crops.advanceGrowth(save, t + HOLD()), true, 'now it grows');
  assert.eq(save.planted[0].stage, 1);
});
