// Lighting a Torch (first or another) brings every running item cooldown
// closer by max(cooldownCutMs, cooldownCutFrac × that timer's own wait):
// the bite, each resting tome and the shared throw recovery.
(function () {
  const T = 1e12, P = 5e5;
  const row = CONSUMABLE_SPEC.torch;

  test('torch cooldowns: the torch row owns the cut, and nothing copies it', () => {
    assert.eq(row.cooldownCutMs, 5000);
    assert.eq(row.cooldownCutFrac, 0.05);
    assert.falsy(CONSUMABLE_SPEC.starflower.cooldownCutMs, 'the starflower borrows the torch\'s light, not this');
    assert.falsy(CONSUMABLE_SPEC.evertorch.cooldownCutMs);
  });

  test('torch cooldowns: each timer loses 5 s or 5% of its own wait, whichever is more', () => {
    const scene = { save: { eatReadyAt: T + 8000, tomeMagicCd: { tome_reach: T + 3600000, tome_speed: T + 3000, old: T - 10 } },
      _throwReadyAt: P + 1000 };
    const n = PlayerTime.shortenItemCooldowns(scene, row.cooldownCutMs, row.cooldownCutFrac, T, P);
    assert.eq(n, 4, 'bite, two resting tomes, the throw');
    assert.eq(scene.save.eatReadyAt, T + 3000, '8 s wait: 5 s off');
    assert.eq(scene.save.tomeMagicCd.tome_reach, T + 3600000 * 0.95, 'an hour: 5% (3 min) beats 5 s');
    assert.eq(scene.save.tomeMagicCd.tome_speed, T, 'never past ready');
    assert.eq(scene.save.tomeMagicCd.old, T - 10, 'a timer already run out is untouched');
    assert.eq(scene._throwReadyAt, P, 'the throw is ready');
  });

  test('torch cooldowns: no running timers, nothing moves', () => {
    const scene = { save: {} };
    assert.eq(PlayerTime.shortenItemCooldowns(scene, 5000, 0.05, T, P), 0);
    assert.eq(JSON.stringify(scene.save), '{}');
  });

  test('torch cooldowns: lighting through the one timed-buff route applies the cut', () => {
    const body = SCENE_SRC.slice(SCENE_SRC.indexOf('  _useTimedBuff(id, {'));
    assert.truthy(/Buffs\.extend\([^\n]+\n\s+hook\?\.after\?\.\(this, spec\);\n\s+if \(spec\.cooldownCutMs > 0\) PlayerTime\.shortenItemCooldowns\(this, spec\.cooldownCutMs, spec\.cooldownCutFrac \|\| 0\);/.test(body),
      'every light — a fresh torch or another on top — runs the cut');
  });
})();
