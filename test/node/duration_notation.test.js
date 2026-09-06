// The countdown notation (src/util.js shortDuration / msToNextUtcDay) and the
// rule that EVERY player-visible wait goes through it.
//
// Two halves:
//   1. The formatter itself — largest applicable unit, always a unit letter,
//      ceil that cascades, never "0m" while a gate still refuses.
//   2. A source sweep over the call sites that used to hand-roll their own
//      ladder. This is the half that matters: the bug this replaces was not a
//      wrong number, it was five different SHAPES of number ("3d", "43m", a
//      bare "7", "come back tomorrow") for the same question, and nothing but
//      a check like this stops the sixth from being added.

// Prefixed: the *.test.js files all share one lexical scope (see run.js), and
// shops_math.test.js already owns a bare `HOUR`.
const DN_SEC = 1000, DN_MIN = 60 * DN_SEC, DN_HOUR = 60 * DN_MIN, DN_DAY = 24 * DN_HOUR;

test('shortDuration: one unit, always lettered, largest that applies', () => {
  assert.eq(shortDuration(12 * DN_SEC), '12s');
  assert.eq(shortDuration(30 * DN_MIN), '30m');
  assert.eq(shortDuration(3 * DN_HOUR), '3h');
  assert.eq(shortDuration(20 * DN_DAY), '20d');
});

test('shortDuration: never mixes units — a remainder is rounded away, not appended', () => {
  assert.eq(shortDuration(DN_HOUR + 5 * DN_MIN), '2h', 'not "1h 5m"');
  assert.eq(shortDuration(DN_DAY + 3 * DN_HOUR), '2d', 'not "1d 3h"');
  assert.eq(shortDuration(90 * DN_SEC), '2m', 'not "1m 30s"');
});

test('shortDuration: rounds UP, and the rounding cascades to the next unit', () => {
  assert.eq(shortDuration(1), '1s', 'a sliver of a second is still a second');
  assert.eq(shortDuration(59.4 * DN_SEC), '1m', 'ceil to 60s reads as a minute, never "60s"');
  assert.eq(shortDuration(59.5 * DN_MIN), '1h', 'ceil to 60m reads as an hour, never "60m"');
  assert.eq(shortDuration(23.5 * DN_HOUR), '1d', 'ceil to 24h reads as a day, never "24h"');
});

test('shortDuration: only a finished wait reads zero', () => {
  assert.eq(shortDuration(0), '0s');
  assert.eq(shortDuration(-5000), '0s', 'an overdue timer is finished, not negative');
  // The important half: while a gate still refuses, the label must not claim 0.
  for (const ms of [1, 10, 999, DN_SEC - 1]) {
    assert.truthy(shortDuration(ms) !== '0s', `${ms}ms still pending, got ${shortDuration(ms)}`);
  }
});

test('shortDuration: every output carries a unit letter and a plain integer', () => {
  const samples = [1, 999, DN_SEC, 45 * DN_SEC, DN_MIN, 47 * DN_MIN, DN_HOUR,
                   5 * DN_HOUR, DN_DAY, 4 * DN_DAY, 99 * DN_DAY];
  for (const ms of samples) {
    const out = shortDuration(ms);
    assert.truthy(/^\d+[smhd]$/.test(out), `"${out}" is not <integer><unit> for ${ms}ms`);
  }
});

test('msToNextUtcDay: counts to the UTC midnight the day keys actually roll on', () => {
  const midnight = Date.UTC(2026, 8, 5);            // 2026-09-05T00:00:00Z
  assert.eq(msToNextUtcDay(midnight), DN_DAY, 'a full day stands at the stroke of midnight');
  assert.eq(msToNextUtcDay(midnight + DN_HOUR), 23 * DN_HOUR);
  assert.eq(msToNextUtcDay(midnight + DN_DAY - DN_MIN), DN_MIN, 'a minute before the roll');
  // The gate it has to agree with: Delivery.dayKey is a UTC YYYYMMDD stamp, so
  // the key must be unchanged right up to the instant this hits zero and
  // different immediately after.
  const dk = Delivery.dayKey(new Date(midnight + DN_HOUR));
  assert.eq(Delivery.dayKey(new Date(midnight + DN_DAY - 1)), dk, 'same day until the roll');
  assert.truthy(Delivery.dayKey(new Date(midnight + DN_DAY)) !== dk, 'new day at the roll');
  // And "in 23h" is what the message says an hour in.
  assert.eq(shortDuration(msToNextUtcDay(midnight + DN_HOUR)), '23h');
});

test('msToNextBucket: a busy shop counts to ITS OWN staggered hour', () => {
  const house = { id: 'shopWait' };
  const off = ShopsMath.bucketOffset(house.id);
  const boundary = ShopsMath.HOUR - off;      // this house's next rollover from t=0
  assert.eq(ShopsMath.msToNextBucket(house, 0), boundary);
  assert.eq(ShopsMath.msToNextBucket(house, boundary - 1), 1, 'a millisecond before it rolls');
  assert.eq(ShopsMath.msToNextBucket(house, boundary), ShopsMath.HOUR, 'a fresh hour after');
  // readiness carries the raw ms so the plaque and the tap format the SAME
  // number — waitMin alone could only ever say "60m" for a full bucket.
  const save = {};
  const cur = ShopsMath.bucketState(save, house, 0);
  cur.deals = 1;                                   // a plain house's cap
  const r = ShopsMath.readiness(save, house, 1, 0);
  assert.eq(r.ready, false);
  assert.eq(r.waitMs, boundary, 'waitMs is the exact wait, unrounded');
  assert.eq(r.waitMin, Math.ceil(boundary / DN_MIN), 'waitMin stays for number callers');
});

// ── The call sites ────────────────────────────────────────────────────────
// Source-text checks: these labels live inside Phaser scene methods and
// per-frame draw passes that can't be called headlessly, so what is pinned is
// that each one formats through the shared helper and none of them re-grows a
// hand-rolled ladder. Grep-shaped on purpose — the failure mode is someone
// adding a SIXTH format, and a text sweep is what catches that.

test('every timed readout formats through shortDuration', () => {
  for (const [label, src] of Object.entries(DURATION_SOURCES)) {
    // util.js is the DEFINITION site — shortDuration builds `${s}s` and the
    // rest by hand, which is the whole point of there being one of it.
    if (label === 'util.js') continue;
    // The old hand-rolled shapes, all of which this notation replaced. The
    // suffix rules are keyed on TIME-ish variable names on purpose: `${d}m` is
    // also how a distance in metres is written, and this sweep has no business
    // failing that.
    const banned = [
      [/\$\{\s*(mins?|minutes?|secs?|seconds?|hrs?|hours?|days?)(Left|Remaining|Left)?\s*\}\s*[smhd]\b/i,
       'a hand-written unit suffix on a time variable'],
      [/\$\{\s*\w*(Left|Remain\w*)\s*\}\s*[smhd]\b/i,
       'a hand-written unit suffix on a countdown variable'],
      [/\$\{\s*(wait\w*|\w+Min|\w+Hrs?|\w+Days?|\w+Secs?)\s*\}\s*[smhd]\b/,
       'a hand-written unit suffix on a wait variable'],
      [/\/\s*3600000\b/, 'a hand-rolled hours divisor'],
      [/\/\s*86400000\b/, 'a hand-rolled days divisor'],
      [/come back tomorrow/i, 'an unquantified "tomorrow"'],
      [/Already used today/i, 'an unquantified "today"'],
      [/Try again later/i, 'an unquantified "later"'],
    ];
    for (const [re, what] of banned) {
      const m = src.match(re);
      if (m) throw new Error(`${label}: ${what} — "${m[0]}" should format via shortDuration()`);
    }
  }
});

test('each timed readout that lost its hand-rolled ladder gained the helper', () => {
  // One assertion per file that owns a countdown the player reads.
  const needs = {
    'interactables.js': 2,   // fruit tree: sapling growth + regrow after picking
    'interact.js': 3,        // produce cooldown, pet boost, crop stage wait
    'render.js': 2,          // crop stage badge + the shop's busy plaque
    'app.js': 6,             // shop busy, blacksmith ×2 (via shopWaitLabel), day gates, dragon, move pad
  };
  for (const [file, min] of Object.entries(needs)) {
    const src = DURATION_SOURCES[file];
    if (!src) throw new Error(`DURATION_SOURCES is missing ${file} — update run.js`);
    const n = (src.match(/shortDuration\(|shopWaitLabel\(/g) || []).length;
    assert.gte(n, min, `${file}: expected at least ${min} shortDuration call sites, found ${n}`);
  }
});

test('the crop stage badge shows a unit, not a bare number', () => {
  // The one readout that printed an unlabelled integer: "7" over a crop meant
  // the same as "7m" over a house and did not look like it.
  const src = DURATION_SOURCES['render.js'];
  assert.truthy(/const label = remaining <= 0 \? '✓' : shortDuration\(remaining\)/.test(src),
    'the growth badge no longer formats its own minutes');
});

test('the day-gated messages name the wait to the UTC roll', () => {
  const src = DURATION_SOURCES['app.js'];
  // Delivery house, castle favour, coin-burst POI — all three keyed on a UTC
  // day stamp, all three now saying how long that is.
  const n = (src.match(/msToNextUtcDay\(\)/g) || []).length;
  assert.gte(n, 4, `expected the 3 day-gated messages + the castle blurb, found ${n}`);
});
