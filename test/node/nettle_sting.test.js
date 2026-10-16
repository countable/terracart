// THE NETTLE STINGS — WILDPLANT_RULES `sting`: picking one says its line at
// the plant and costs its energy as a bare-handed blow (scene _sting, through
// Combat.playerDamage with no armour, so the damage shield still holds).
(function () {
const sting = wildplantRule('nettle')?.sting;

test('nettle sting: the row says Ouch! and seven energy', () => {
  assert.eq(sting.energy, 7);
  assert.eq(sting.line, 'Ouch!');
  assert.falsy(wildplantRule('petnip')?.sting, 'only the nettle stings');
  assert.eq(wildplantOutput('nettle'), 'nettle', 'still picked as itself');
});

test('nettle sting: picking a stinging plant calls the scene sting', () => {
  assert.truthy(/if \(rule\?\.sting\) scene\._sting\?\.\(rule\.sting, wp\.x, wp\.y\);/.test(INTERACT_SRC));
});

test('nettle sting: a bare blow through Combat.playerDamage, shielded like any other', () => {
  const src = SCENE_SRC.slice(SCENE_SRC.indexOf('  _sting(sting, x, y) {'));
  assert.truthy(/Conditions\.damageImmune\(this\.save\)\) return 0;/.test(src));
  assert.truthy(/Energy\.set\(this\.save, before - Combat\.playerDamage\(sting\.energy, \{\}, 1, this\.save\.mode\)\)/.test(src));
  assert.eq(Combat.playerDamage(sting.energy, {}, 1, 'normal'), 7, 'normal mode: exactly seven');
});
})();
