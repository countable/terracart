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

test('spokenDuration: the same ladder and rounding, in a speaking voice', () => {
  assert.eq(spokenDuration(DN_DAY), 'a day', 'a neighbour says "a day", never "1d"');
  assert.eq(spokenDuration(3 * DN_DAY), '3 days');
  assert.eq(spokenDuration(DN_HOUR), 'an hour');
  assert.eq(spokenDuration(5 * DN_MIN), '5 minutes');
  assert.eq(spokenDuration(DN_HOUR + 5 * DN_MIN), '2 hours', 'rounds up like shortDuration, never "1 hour 5 minutes"');
  assert.eq(spokenDuration(23.5 * DN_HOUR), 'a day');
  assert.eq(spokenDuration(0), 'no time at all');
  for (const ms of [1, 12 * DN_SEC, 90 * DN_SEC, 3 * DN_HOUR, DN_DAY + 3 * DN_HOUR, 20 * DN_DAY]) {
    const unit = shortDuration(ms).slice(-1), word = { s: 'second', m: 'minute', h: 'hour', d: 'day' }[unit];
    assert.truthy(spokenDuration(ms).includes(word), `${ms}ms: the two helpers agree on the unit`);
    assert.eq(String(parseInt(shortDuration(ms), 10)), spokenDuration(ms).match(/^(\d+|an?)/)[1].replace(/^an?$/, '1'), `${ms}ms: and the count`);
  }
});

test('UTC day identity and countdown share the same midnight', () => {
  const midnight = Date.UTC(2026, 8, 5);            // 2026-09-05T00:00:00Z
  const before = midnight - 1;
  assert.eq(utcDayKey(before), '20260904', 'the prior key holds until midnight');
  assert.eq(utcDayKey(new Date(midnight)), '20260905', 'Date inputs use the same UTC key');
  assert.eq(utcDayIndex(midnight) - utcDayIndex(before), 1, 'the index advances at midnight');
  assert.eq(utcDayIndex(new Date(midnight)), utcDayIndex(midnight), 'Date and epoch inputs agree');
  assert.eq(Delivery.dayKey, undefined, 'Delivery no longer carries a day-key alias');
  assert.eq(msToNextUtcDay(midnight), DN_DAY, 'a full day stands at the stroke of midnight');
  assert.eq(msToNextUtcDay(midnight + DN_HOUR), 23 * DN_HOUR);
  assert.eq(msToNextUtcDay(midnight + DN_DAY - DN_MIN), DN_MIN, 'a minute before the roll');
  assert.eq(shortDuration(msToNextUtcDay(midnight + DN_HOUR)), '23h');
});

test('UTC day consumers read util.js instead of inventing another boundary', () => {
  for (const f of ['delivery.js', 'scene_creatures.js', 'lairs.js', 'houses.js', 'macros.js']) {
    assert.falsy(/Delivery\.dayKey|function dayKey\(/.test(ALL_SRC[f]), `${f} reads utcDayKey directly`);
  }
  assert.truthy(/gateDay === utcDayKey\(\)/.test(ALL_SRC['scene_creatures.js']), 'the gate guard\'s day is the UTC owner\'s');
  assert.truthy(/String\(o\.dayKey \|\| utcDayKey\(\)\)/.test(ALL_SRC['lairs.js']), 'a daily guard\'s id carries the UTC owner\'s day');
  assert.falsy(/Delivery\.dayKey/.test(ALL_SRC['app.js']), 'app reads utcDayKey directly');
  assert.truthy(/const today = utcDayIndex\(Date\.now\(\)\);/.test(ALL_SRC['interactables.js']),
    'the spent ledger shares the UTC day index');
  assert.falsy(/const DAY = 86400000|Math\.floor\(now \/ DAY\)/.test(ALL_SRC['npc.js']),
    'NPC dialogue does not own another day constant');
  assert.truthy(/const day = utcDayIndex\(now\)/.test(ALL_SRC['npc.js']),
    'NPC dialogue rotates on the shared UTC day');
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
    'interactables.js': 1,   // shared fruit state covers growth and regrowth
    'interact.js': 3,        // produce cooldown, pet boost, crop stage wait
    'render.js': 1,          // crop stage badge (the shop's busy plaque is gone: no shop is ever busy)
    'app.js': 6,             // day gates, dragon, move pad, castle favour …
  };
  for (const [file, min] of Object.entries(needs)) {
    const src = DURATION_SOURCES[file];
    if (!src) throw new Error(`DURATION_SOURCES is missing ${file} — update run.js`);
    const n = (src.match(/shortDuration\(/g) || []).length;
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
  const src = SCENE_SRC;
  // Daily visits share Macros.beginDailyVisit; the inn and guildhall keep
  // their service dialogs. Each is keyed on a UTC day stamp,
  // each saying how long that is. (A fed delivery house is no longer
  // day-gated: one delivery per house, ever. The castle favour left the day
  // key for its own twelve-hour clock, Houses.CASTLE_SERVICE_MS.)
  const n = (src.match(/msToNextUtcDay\(\)/g) || []).length;
  assert.gte(n, 2, `expected the 2 service day-gated messages, found ${n}`);
  assert.truthy(/waitLine\(row\?\.spent \|\| SPENT_DEFAULT, msToNextUtcDay\(\)\)/.test(Macros.beginDailyVisit.toString()),
    'shared daily visits show the wait to the UTC roll');
  assert.eq(Macros.waitLine('Already visited', 90 * 60 * 1000), 'Already visited — 2h', 'the one refusal shape, shortDuration');
  const castle = SCENE_SRC.slice(SCENE_SRC.indexOf('  presentCastleServiceOffer('), SCENE_SRC.indexOf('  showQuestBoard('));
  assert.truthy(/Macros\.waitLine\(Macros\.DAILY_VISIT_KINDS\.castle\.spent, this\._castleServiceWaitMs\(house\)\)/.test(castle),
    'the castellan\'s refusal is the one shape, off the castle row\'s prefix and its twelve-hour wait');
  assert.truthy(/shortDuration\(Houses\.CASTLE_SERVICE_MS\)/.test(castle), 'and the blurb its length');
  assert.falsy(/msToNextUtcDay/.test(castle), 'neither counts to the UTC roll');
});

test('numeric consumable durations derive from CONSUMABLE_SPEC', () => {
  const timed = [
    'pairy', 'coffee', 'reach_potion', 'speed_potion', 'shielding_potion',
    'raven_scroll', 'blight_potion', 'dragon_powder', 'shadow_powder',
    'frost_powder', 'torch',
  ];
  for (const id of timed) {
    const spec = CONSUMABLE_SPEC[id];
    assert.truthy(spec && spec.durationMs > 0, `${id}: duration row`);
    const effect = ITEM_EFFECTS[id] || '';
    if (/\d/.test(effect)) {
      assert.truthy(effect.includes(shortDuration(spec.durationMs)),
        `${id}: numeric effect duration uses the owning value`);
    }
  }
  // The scene keeps no alias of a row's length: a timed buff is extended by
  // spec.durationMs at the use (_useTimedBuff), a cast reads its row
  // (CAST_ROWS), the eat lane reads CONSUMABLE_SPEC.<id>.durationMs.
  const app = DURATION_SOURCES['app.js'] + DURATION_SOURCES['scene_consumables.js'];
  assert.falsy(/const \w+_MS = CONSUMABLE_SPEC\.\w+\.durationMs;/.test(app), 'no duration alias in app.js');
  assert.truthy(/Buffs\.extend\(this\.save, this, buff, spec\.durationMs \* mul\);/.test(app), 'the row\'s length extends the buff');
  for (const id of ['frost_powder', 'sleep_powder', 'psychosis_powder', 'fear_scroll', 'coffee', 'dawnfruit'])
    assert.truthy(app.includes(`CONSUMABLE_SPEC.${id}.durationMs`), `${id}: app reads the row`);
});
