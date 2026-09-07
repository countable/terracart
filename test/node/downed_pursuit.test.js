// NOTHING HUNTS A BODY.
//
// At zero energy the player has collapsed: coords.js's reachRadiusM returns 0
// (no cell is tappable, nothing can be swung at), and all three places a foe
// reaches the player — the surface slime's leech, a cave monster's melee, a
// goblin archer's arrow — already refuse to take a point off an empty bar. A
// hostile that keeps stalking one is therefore chasing a body it is forbidden
// to bite: it parks on the wreck and, on hard mode (where nothing but Home
// lifts the bar off zero), escorts the player the whole way home.
//
// So a downed player is NOT THERE to be hunted, exactly as a Shadow Powder
// makes them. `Combat.playerDowned` is the one expression, and it is read on
// BOTH sides — the gate that drops the pursuit and the guard that refuses the
// damage — so a foe can never be chasing a player it cannot hurt. In
// wanderCreatures the two wards are ORed once per tick into `unnoticed`, and
// every hostile-interest branch reads that rather than `shadowed` alone: the
// leech, the monster's hit and arrow, the struck slime's charge, and both
// stalk branches, each falling back to the aimless wander.
//
// combat.js loads headlessly so the predicate runs for real; wanderCreatures
// needs Phaser, so its wiring is pinned as source text (APP_JS_SRC) the way
// home_ward.test.js pins the Home ward.

(function () {
const app = APP_JS_SRC;

// The method body: an inner brace is indented deeper than two spaces, so the
// first "\n  }\n" after the header closes the method (the zero_energy_lockout
// slice, same trick).
function methodBody(name) {
  const a = app.indexOf(`  ${name}(`);
  assert.truthy(a > 0, `found ${name} in app.js`);
  const b = app.indexOf('\n  }\n', a);
  assert.truthy(b > a, `found the end of ${name}`);
  return app.slice(a, b);
}
// Source with every comment line dropped — what the code actually reads.
const codeOnly = (src) => src.split('\n')
  .filter((l) => !l.trim().startsWith('//')).join('\n');

test('downed: an empty bar is down, and so is a bar that is not a number', () => {
  assert.truthy(Combat.playerDowned(0), 'zero energy is down');
  assert.truthy(Combat.playerDowned(-1), 'and nothing below it is up again');
  assert.truthy(Combat.playerDowned(undefined), 'a missing bar reads as down');
  assert.truthy(Combat.playerDowned(NaN), 'so does a NaN bar — the `> 0` guards it replaces did too');
  assert.falsy(Combat.playerDowned(1), 'one point of energy is still standing');
  assert.falsy(Combat.playerDowned(0.5), 'and so is half of one');
});

test('downed: wanderCreatures ORs the two wards once per tick', () => {
  const body = methodBody('wanderCreatures');
  assert.truthy(/const shadowed = this\.isShadowActive\(\);/.test(body),
    'the Shadow Powder ward is still read once per tick');
  assert.truthy(
    /const unnoticed = shadowed \|\| Combat\.playerDowned\(this\.save\.energy\);/.test(body),
    'the downed test is ORed with it into `unnoticed`, off the LIVE bar');
});

test('downed: every hostile-interest branch reads `unnoticed`, never `shadowed`', () => {
  const code = codeOnly(methodBody('wanderCreatures'));
  // `shadowed` survives only as its own definition and the OR above. Any other
  // code reading it is a branch the collapse ward would silently miss.
  const bare = (code.match(/shadowed/g) || []).length;
  assert.eq(bare, 2, 'shadowed appears only in its definition and in `unnoticed`');
  // The five branches, by the expression each is gated on.
  const gates = [
    [/c\.kind === 'slime' && !isTame && !unnoticed && !homeWard/, 'the slime leech'],
    [/isMonster\(c\.kind\) && !unnoticed && !homeWard/, "the monster's hit and arrow"],
    [/const charging = !isTame && !homeWard && !unnoticed && slimeCharging\(c\)/,
     "the struck slime's charge"],
    [/!unnoticed && Math\.random\(\) < 0\.5 && distToPlayer/, "the slime's meander"],
    [/if \(!unnoticed && distToPlayer > 0\.5 \* this\.cellM\)/, "the monsters' stalk"],
  ];
  for (const [re, what] of gates) {
    assert.truthy(re.test(code), `${what} is gated on unnoticed`);
  }
});

test('downed: the pursuit gate and the damage guard are the SAME expression', () => {
  // Three places a foe reaches the player; each guards with the predicate the
  // pursuit gate is built from, so "cannot be hurt" and "is not hunted" can
  // never drift apart into a foe chasing someone it may not bite.
  const wander = methodBody('wanderCreatures');
  const leech = wander.indexOf("c._nextStealT = now + 1000;");
  const melee = wander.indexOf('c._nextStealT = now + MONSTER_HIT_MS;');
  assert.truthy(leech > 0 && melee > 0, 'found both melee cooldown stamps');
  for (const [at, what] of [[leech, "the slime's leech"], [melee, "the monster's melee"]]) {
    assert.truthy(/if \(!Combat\.playerDowned\(before\)\) \{/.test(wander.slice(at, at + 220)),
      `${what} refuses a downed player through Combat.playerDowned`);
  }
  const arrow = methodBody('_shotHitsPlayer');
  assert.truthy(/if \(Combat\.playerDowned\(before\) \|\| !\(shot\.damage > 0\)\) return false;/.test(arrow),
    "an arrow already in flight lands for nothing on a downed player");
});
})();
