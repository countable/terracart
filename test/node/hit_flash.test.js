// The body FLINCHES when it is hit.
//
// A blow on the player (the slime's leech, a monster's melee, an arrow
// striking in _shotHitsPlayer) flicks the character red for HIT_FLASH_MS and
// buzzes the phone, at the instant it lands. It is NOT tied to the throttled
// "−N⚡" pop, which rolls a second of bites into one number. Two channels,
// because setTint is a no-op under Phaser's Canvas fallback: the sprite tint
// AND the halo's red texture, which is a plain image and reads everywhere.
// app.js can't load headlessly, so this is pinned as source text.

(function () {
const app = APP_JS_SRC;

test('hit flash: every drain on the body flinches at the instant it lands', () => {
  // Four drains, four calls, each right after the loss is banked — and each
  // hands the exact amount just spent, which is also what sizes the burst
  // (playerHitSizeMul).
  const sites = app.match(/const spent = before - this\.save\.energy;[\s\S]{0,200}?this\._flashPlayerHit\(spent\);/g) || [];
  assert.eq(sites.length, 4, 'slime leech, monster melee, arrow, standing on a sprung trap');
  const arrow = app.match(/\n  _shotHitsPlayer\(shot\) \{([\s\S]*?)\n  \}\n/);
  assert.truthy(arrow && /this\._flashPlayerHit\(spent\);/.test(arrow[1]), 'the arrow is one of them');
  // …and the trap's BITE, which lands through the pain effect rather than in
  // that shape, because it carries the rim pulse and the shake with it.
  const pain = app.match(/\n  _painFlash\(amount\) \{([\s\S]*?)\n  \}\n/);
  assert.truthy(pain && /this\._flashPlayerHit\(amount\);/.test(pain[1]),
    'a trap springing flinches the body too — it is the biggest single hit there is');
});

test('hit flash: it is a flinch, not the throttled pop', () => {
  const m = app.match(/\n  _flashPlayerHit\(amount\) \{([\s\S]*?)\n  \}\n/);
  assert.truthy(m, '_flashPlayerHit exists');
  assert.truthy(/this\._hitFlashUntilT = performance\.now\(\) \+ HIT_FLASH_MS;/.test(m[1]), 'arms a deadline');
  assert.truthy(/this\.hapticHit\(\)/.test(m[1]), 'and buzzes');
  const ms = app.match(/const HIT_FLASH_MS = (\d+);/);
  assert.truthy(ms, 'HIT_FLASH_MS is a plain number');
  assert.inRange(Number(ms[1]), 80, 300, 'short: a flick, not a state');
  // Not from the throttled roll-ups.
  assert.falsy(/_popEnergy\(-drained[\s\S]{0,200}_flashPlayerHit/.test(app), 'not from the slime pop');
  assert.falsy(/_popEnergy\(-hit[\s\S]{0,200}_flashPlayerHit/.test(app), 'not from the monster pop');
});

test('hit flash: the pain burst scales with the blow, and lives in ONE place', () => {
  const m = app.match(/\n  _flashPlayerHit\(amount\) \{([\s\S]*?)\n  \}\n/);
  assert.truthy(m, '_flashPlayerHit exists');
  assert.truthy(/const maxEnergy = this\.getMaxEnergy \? this\.getMaxEnergy\(\) : undefined;/.test(m[1]),
    'the size is read against the player\'s OWN max HP, not a flat energy number');
  assert.truthy(/Particles\.burst\(this, 'pain', ps\.x, ps\.y \+ this\.playerFeetNudgeY,\s*\n\s*\{ sizeMul: playerHitSizeMul\(amount, maxEnergy\) \}\);/.test(m[1]),
    'every blow throws the pain burst, sized to what it actually cost as a share of max HP');
  // _painFlash calls _flashPlayerHit FIRST and must not ALSO burst — a trap
  // would otherwise throw the chip puff twice.
  const pain = app.match(/\n  _painFlash\(amount\) \{([\s\S]*?)\n  \}\n/);
  assert.truthy(pain, '_painFlash exists');
  assert.falsy(/Particles\.burst/.test(pain[1]), 'the burst lives in _flashPlayerHit only, not duplicated here');
  // The scaling formula itself, lifted and run for real: under 3% of max HP
  // is background noise (floor size), 10%+ maxes out, and it never goes out
  // of range at either end.
  const fn = app.match(/function playerHitSizeMul\(amount, maxEnergy\) \{([\s\S]*?)\n\}/);
  assert.truthy(fn, 'playerHitSizeMul exists');
  const minFrac = Number((app.match(/const PAIN_BURST_MIN_FRAC = ([\d.]+);/) || [])[1]);
  const maxFrac = Number((app.match(/const PAIN_BURST_MAX_FRAC = ([\d.]+);/) || [])[1]);
  assert.eq(minFrac, 0.03, 'a hit under 3% of max HP is the floor');
  assert.truthy(maxFrac > minFrac, 'the ceiling fraction is above the floor');
  /* eslint-disable no-new-func */
  const playerHitSizeMul = new Function('amount', 'maxEnergy',
    `const PAIN_BURST_MIN_FRAC = ${minFrac}, PAIN_BURST_MAX_FRAC = ${maxFrac};\n${fn[1]}`);
  const MAX = 100;
  assert.eq(playerHitSizeMul(0, MAX), 1, 'no loss → the plain preset (never asked to burst, but never NaN either)');
  assert.eq(playerHitSizeMul(5, 0), 1, 'no known max HP → the plain preset rather than a divide-by-zero');
  assert.eq(playerHitSizeMul(2, MAX), 0.7, 'a 2-HP hit (under 3% of 100) is the floor size');
  assert.eq(playerHitSizeMul(2.9, MAX), 0.7, 'and so is anything else still under the 3% line');
  assert.eq(playerHitSizeMul(10, MAX), 1.6, 'a 10% hit reaches the ceiling');
  assert.eq(playerHitSizeMul(50, MAX), 1.6, 'and never overshoots it');
  assert.truthy(playerHitSizeMul(4, MAX) > 0.7 && playerHitSizeMul(4, MAX) < playerHitSizeMul(8, MAX),
    'between the floor and the ceiling, a bigger hit reads bigger');
  // The SAME absolute hit reads smaller against a bigger bar (first-taste
  // bonuses) — it is a share of max HP, not a flat energy count.
  assert.truthy(playerHitSizeMul(4, 100) > playerHitSizeMul(4, 400),
    'a 4-energy hit matters less on a grown bar than on the starting one');
});

test('hit flash: the aura shows it on BOTH channels, and it wins over the states', () => {
  const m = app.match(/\n  _updatePlayerAura\(\) \{([\s\S]*?)\n  \}\n/);
  assert.truthy(m, '_updatePlayerAura exists');
  const body = m[1];
  assert.truthy(/const hit = hitLeft > 0;/.test(body), 'reads the deadline');
  assert.truthy(/if \(hit \|\| spent \|\| far\) \{/.test(body), 'a hit lights the aura on its own');
  assert.truthy(/if \(hit\) \{\s*\n\s*tint = HIT_FLASH_TINT;/.test(body), 'the tint channel, and it wins');
  assert.truthy(/const key = \(hit \|\| spent\) \? 'halo_red' : 'halo_dark';/.test(body),
    'the halo channel — the red texture, which reads without WebGL');
  assert.truthy(/const alpha = hit \? 0\.2 \+ 0\.6 \* \(hitLeft \/ HIT_FLASH_MS\)/.test(body),
    'the halo decays over the flash');
});

test('hit flash: the haptic sits between a pickup and a refusal', () => {
  const ok = Number((app.match(/hapticOk\(\)\s*\{ this\.haptic\((\d+)\); \}/) || [])[1]);
  const no = Number((app.match(/hapticReject\(\)\s*\{ this\.haptic\((\d+)\); \}/) || [])[1]);
  const hit = Number((app.match(/hapticHit\(\)\s*\{ this\.haptic\((\d+)\); \}/) || [])[1]);
  assert.truthy(ok > 0 && no > 0 && hit > 0, 'all three defined');
  assert.truthy(ok < hit && hit < no, `ok ${ok} < hit ${hit} < reject ${no}`);
});
})();
