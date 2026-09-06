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
  // Three drains, three calls, each right after the loss is banked.
  const sites = app.match(/\(before - this\.save\.energy\);\s*\n\s*this\._flashPlayerHit\(\);/g) || [];
  assert.eq(sites.length, 3, 'slime leech, monster melee, arrow');
  const arrow = app.match(/\n  _shotHitsPlayer\(shot\) \{([\s\S]*?)\n  \}\n/);
  assert.truthy(arrow && /this\._flashPlayerHit\(\);/.test(arrow[1]), 'the arrow is one of them');
});

test('hit flash: it is a flinch, not the throttled pop', () => {
  const m = app.match(/\n  _flashPlayerHit\(\) \{([\s\S]*?)\n  \}\n/);
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
